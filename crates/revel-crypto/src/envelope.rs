//! The account key and its three wraps (`docs/03` §1).
//!
//! ```text
//!              password ──OPAQUE──▶ exportKey ──HKDF──▶ KEK ─┐
//!         recovery code ──Argon2id──────────────────▶ RK  ─┤ each wraps
//!   passkey (WebAuthn PRF) ─────────────────────────▶ PK  ─┘    │
//!                                                                ▼
//!                                          ACCOUNT KEY (Ed25519, long-lived)
//! ```
//!
//! ## Why three, and why they are separate blobs
//!
//! The account key is **never derived from a password** — it is random, and its
//! public half is the account's identity, so deriving it would mean a password
//! change was an identity change. Instead the key is generated once and sealed
//! under three independent wrapping keys, each stored as its own blob at the
//! IdP.
//!
//! That shape is what makes the two flows people actually hit cheap:
//!
//! - **Changing your password** re-wraps one blob. Nothing else moves, no
//!   history is touched, no other device notices.
//! - **Forgetting your password** opens a different blob. The IdP *cannot* reset
//!   a password — that is what OPAQUE means — so without a second wrap "I forgot
//!   my password" would be the end of the account. `docs/03` is explicit that
//!   the recovery code is therefore not optional and the passkey is offered as a
//!   second low-friction one.
//!
//! And it is why losing every wrap loses the account, by design (`docs/03`
//! §10). There is no fourth copy held by anybody.
//!
//! ## What this module does not do
//!
//! It does not know where a wrapping key came from. `KEK`, `RK` and `PK` arrive
//! as 32 bytes and are used identically — OPAQUE, Argon2id and WebAuthn PRF are
//! three ways of producing a secret and none of them changes what a wrap is.
//! The one exception is [`recovery_key`], which is here because a recovery code
//! is short enough to be typed by a human and therefore needs a memory-hard KDF
//! rather than a bare hash.

use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use ed25519_dalek::SigningKey;
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use thiserror::Error;
use zeroize::Zeroizing;

/// Domain separation, so a KEK can never be mistaken for a state key.
const KEK_INFO: &[u8] = b"revel/account-kek/v1";
/// Bound into every wrap, so a blob from one purpose cannot open under another.
const WRAP_AAD: &[u8] = b"revel/account-key-wrap/v1";

/// How much work the recovery-code KDF does.
///
/// 64 MiB and 3 passes is the OWASP-recommended Argon2id floor at the time of
/// writing. Deliberately at the low end of "acceptable" rather than the high
/// end: this runs in a browser, possibly on a phone, during account recovery —
/// and a KDF that takes eight seconds on the device somebody is panicking with
/// is one they will assume has hung.
///
/// **Measured at 122 ms** natively in release on an M5 (`--test argon_bench`,
/// not kept). Wasm on a mid-range phone is a few times that, which is the right
/// side of the line where a progress spinner stops being a lie.
///
/// The recovery code carries ~128 bits of entropy (see
/// [`generate_recovery_code`]), so this KDF is defence in depth against a *bad*
/// code rather than the only thing between an attacker and the key. That is why
/// it is tuned for the person rather than for the attacker: there is no
/// realistic offline attack on 128 bits to make expensive.
const ARGON_MEM_KIB: u32 = 64 * 1024;
const ARGON_PASSES: u32 = 3;
const ARGON_LANES: u32 = 1;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EnvelopeError {
    /// The wrap did not open. Wrong key, or tampered bytes — and from out here
    /// those are the same event, deliberately: distinguishing them would tell
    /// an attacker which half they got right.
    #[error("wrap did not open")]
    NotOurs,
    #[error("malformed wrap")]
    Malformed,
    #[error("recovery code is not a recovery code")]
    BadRecoveryCode,
    #[error("key derivation failed")]
    Kdf,
}

/// A wrapped account key: `nonce | ciphertext`, AES-256-GCM.
///
/// Stored at the IdP, which cannot open it. Three of these exist per account
/// and they are interchangeable — whichever opens, opens.
pub type Wrap = Vec<u8>;

/// A fresh account key. Random, never derived.
///
/// Returns the 32-byte seed rather than an expanded key: the seed is what gets
/// wrapped, and `ed25519_dalek` will expand it again on the way back.
pub fn generate_account_key() -> Zeroizing<[u8; 32]> {
    let mut seed = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(seed.as_mut());
    seed
}

/// The public half, which *is* the account's identity (`docs/03` §1).
pub fn account_public(seed: &[u8; 32]) -> [u8; 32] {
    SigningKey::from_bytes(seed).verifying_key().to_bytes()
}

/// KEK from OPAQUE's `exportKey`.
///
/// HKDF rather than using the export key directly: `exportKey` is already a
/// uniformly random secret, so this is domain separation rather than
/// strengthening — it guarantees that the same OPAQUE session cannot produce a
/// key that collides with one derived for any other purpose.
pub fn kek_from_export_key(export_key: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut out = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(None, export_key)
        .expand(KEK_INFO, out.as_mut())
        .expect("32 is a valid HKDF length");
    out
}

/// RK from a recovery code, via Argon2id.
///
/// The salt is stored alongside the wrap at the IdP. It is not secret and does
/// not need to be — its job is to stop one precomputed table covering every
/// account, and a per-account random value does that.
pub fn recovery_key(code: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, EnvelopeError> {
    let normalised = normalise_recovery_code(code)?;
    let params = Params::new(ARGON_MEM_KIB, ARGON_PASSES, ARGON_LANES, Some(32))
        .map_err(|_| EnvelopeError::Kdf)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(normalised.as_bytes(), salt, out.as_mut())
        .map_err(|_| EnvelopeError::Kdf)?;
    Ok(out)
}

/// Seal the account key under a 32-byte wrapping key.
pub fn wrap_account_key(seed: &[u8; 32], wrapping_key: &[u8; 32]) -> Result<Wrap, EnvelopeError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(wrapping_key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let payload = aes_gcm::aead::Payload { msg: seed, aad: WRAP_AAD };
    let mut out = nonce.to_vec();
    out.extend_from_slice(&cipher.encrypt(&nonce, payload).map_err(|_| EnvelopeError::Kdf)?);
    Ok(out)
}

/// Open a wrap. Wrong key and tampered bytes are the same error, on purpose.
pub fn unwrap_account_key(
    wrap: &[u8],
    wrapping_key: &[u8; 32],
) -> Result<Zeroizing<[u8; 32]>, EnvelopeError> {
    if wrap.len() < 12 {
        return Err(EnvelopeError::Malformed);
    }
    let (nonce, ciphertext) = wrap.split_at(12);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(wrapping_key));
    let payload = aes_gcm::aead::Payload { msg: ciphertext, aad: WRAP_AAD };
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce), payload)
        .map_err(|_| EnvelopeError::NotOurs)?;

    let seed: [u8; 32] = plain.as_slice().try_into().map_err(|_| EnvelopeError::Malformed)?;
    Ok(Zeroizing::new(seed))
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/// Crockford base32 without `I`, `L`, `O` or `U`.
///
/// `U` is excluded as well as the three that look like digits — it is the one
/// Crockford leaves out to avoid accidentally spelling things, and a recovery
/// code that reads as a word is one people repeat out loud.
const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// A fresh recovery code: 26 characters, grouped, ~128 bits.
///
/// Formatted `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-X` because this is the one secret
/// in the product a person has to copy onto paper, and an undelimited run of 26
/// characters is one nobody transcribes correctly.
pub fn generate_recovery_code() -> Zeroizing<String> {
    let mut bytes = Zeroizing::new([0u8; 26]);
    OsRng.fill_bytes(bytes.as_mut());

    let mut out = String::with_capacity(31);
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && i % 5 == 0 {
            out.push('-');
        }
        out.push(ALPHABET[(*b as usize) % ALPHABET.len()] as char);
    }
    Zeroizing::new(out)
}

/// Uppercase, dashes removed, and the four ambiguous letters folded.
///
/// Somebody reading a code off paper will type `O` for `0` and `l` for `1`, and
/// refusing that is refusing the one flow that exists because everything else
/// has already gone wrong. Crockford's mapping, which is why the alphabet is
/// Crockford's.
pub fn normalise_recovery_code(code: &str) -> Result<String, EnvelopeError> {
    let mut out = String::with_capacity(26);
    for ch in code.chars() {
        let c = ch.to_ascii_uppercase();
        let mapped = match c {
            '-' | ' ' => continue,
            'O' => '0',
            'I' | 'L' => '1',
            // `U` is not in the alphabet at all; Crockford maps it to `V`.
            'U' => 'V',
            other => other,
        };
        if !ALPHABET.contains(&(mapped as u8)) {
            return Err(EnvelopeError::BadRecoveryCode);
        }
        out.push(mapped);
    }
    if out.len() != 26 {
        return Err(EnvelopeError::BadRecoveryCode);
    }
    Ok(out)
}

/// A fresh salt for [`recovery_key`]. Not secret; per-account.
pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    salt
}
