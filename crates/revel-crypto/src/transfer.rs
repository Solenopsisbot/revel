//! Handing an account key to a device you are holding (`docs/03` §3).
//!
//! The convenient path: a new device shows a QR, an existing one scans it,
//! confirms a fingerprint, and sends the account key over. Nothing is typed.
//!
//! ## Why a single-use key rather than the device's own
//!
//! `docs/03` describes sealing to "the new device's HPKE key", which would mean
//! every device carrying a long-lived decryption key in its certificate. This
//! uses an **ephemeral X25519 keypair generated for one handoff and discarded**,
//! for two reasons:
//!
//! 1. A device certificate goes into encrypted history, and `docs/29` §1 is
//!    blunt that encrypted history cannot be re-encrypted. A field added there
//!    is a field forever, so adding one to support a flow that does not need it
//!    is a permanent cost for a temporary convenience.
//! 2. A long-lived decryption key is a long-lived liability. This one exists
//!    between showing a QR and reading the reply, and a device that is
//!    compromised afterwards has nothing to decrypt with.
//!
//! ## What the fingerprint is for
//!
//! The QR carries a public key, and a QR is a thing an attacker can also put on
//! a screen. The confirmation tap on the *existing* device shows a fingerprint
//! of the key it is about to seal to, and the new device shows the same one — so
//! a swapped QR is a mismatch a person can see. It is the same trick as a safety
//! number, at a moment when both devices are in the same pair of hands.

use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::{Digest, Sha256};
use thiserror::Error;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

/// Domain separation. A transfer key must never collide with a wrap key.
const TRANSFER_INFO: &[u8] = b"revel/device-transfer/v1";
/// Bound into the seal, so a blob from another purpose cannot open here.
const TRANSFER_AAD: &[u8] = b"revel/device-transfer-aad/v1";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransferError {
    /// Wrong key or tampered bytes. One error, deliberately — telling them
    /// apart would say which half an attacker got right.
    #[error("transfer did not open")]
    NotOurs,
    #[error("malformed transfer")]
    Malformed,
}

/// A fresh single-use transfer keypair. The secret never leaves the new device.
pub fn generate_transfer_key() -> (Zeroizing<[u8; 32]>, [u8; 32]) {
    let mut bytes = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(bytes.as_mut());
    let secret = StaticSecret::from(*bytes);
    let public = PublicKey::from(&secret);
    (bytes, public.to_bytes())
}

/// The public half, from a secret. For a device recomputing its own.
pub fn transfer_public(secret: &[u8; 32]) -> [u8; 32] {
    PublicKey::from(&StaticSecret::from(*secret)).to_bytes()
}

/// Seal a payload to a transfer public key: `ephemeral_pub | nonce | ciphertext`.
///
/// The ephemeral key is per-seal, so two handoffs to the same device share no
/// key material and neither reveals the other.
pub fn seal_to(recipient: &[u8; 32], plaintext: &[u8]) -> Vec<u8> {
    let mut ephemeral_bytes = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(ephemeral_bytes.as_mut());
    let ephemeral = StaticSecret::from(*ephemeral_bytes);
    let ephemeral_pub = PublicKey::from(&ephemeral).to_bytes();

    let shared = ephemeral.diffie_hellman(&PublicKey::from(*recipient));
    // Both public keys go into the KDF, so a shared secret is bound to the
    // exact pair it came from — without that, a key agreed with one recipient
    // could be replayed toward another.
    let key = derive(shared.as_bytes(), &ephemeral_pub, recipient);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_ref()));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let payload = aes_gcm::aead::Payload { msg: plaintext, aad: TRANSFER_AAD };

    let mut out = ephemeral_pub.to_vec();
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&cipher.encrypt(&nonce, payload).expect("aes-gcm encrypt"));
    out
}

/// Open a sealed payload with the transfer secret.
pub fn open_with(secret: &[u8; 32], sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>, TransferError> {
    if sealed.len() < 32 + 12 {
        return Err(TransferError::Malformed);
    }
    let (ephemeral_pub, rest) = sealed.split_at(32);
    let (nonce, ciphertext) = rest.split_at(12);

    let ephemeral: [u8; 32] = ephemeral_pub.try_into().map_err(|_| TransferError::Malformed)?;
    let mine = StaticSecret::from(*secret);
    let recipient = PublicKey::from(&mine).to_bytes();
    let shared = mine.diffie_hellman(&PublicKey::from(ephemeral));
    let key = derive(shared.as_bytes(), &ephemeral, &recipient);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_ref()));
    let payload = aes_gcm::aead::Payload { msg: ciphertext, aad: TRANSFER_AAD };
    cipher
        .decrypt(Nonce::from_slice(nonce), payload)
        .map(Zeroizing::new)
        .map_err(|_| TransferError::NotOurs)
}

fn derive(shared: &[u8], ephemeral_pub: &[u8; 32], recipient: &[u8; 32]) -> Zeroizing<[u8; 32]> {
    let mut salt = Vec::with_capacity(64);
    salt.extend_from_slice(ephemeral_pub);
    salt.extend_from_slice(recipient);

    let mut out = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(&salt), shared)
        .expand(TRANSFER_INFO, out.as_mut())
        .expect("32 is a valid HKDF length");
    out
}

/// A short, readable fingerprint of a transfer key, for the confirmation tap.
///
/// Six groups of four decimal digits, like a safety number and for the same
/// reason: it is compared by a person looking at two screens, so it has to be
/// short enough to actually compare and unambiguous enough to do it out loud.
/// Digits rather than letters because there is no `0`/`O` problem in digits.
pub fn fingerprint(public: &[u8; 32]) -> String {
    let digest = Sha256::digest(public);
    let mut out = String::with_capacity(29);
    for i in 0..6 {
        if i > 0 {
            out.push(' ');
        }
        let chunk = u32::from_be_bytes([
            digest[i * 4],
            digest[i * 4 + 1],
            digest[i * 4 + 2],
            digest[i * 4 + 3],
        ]);
        out.push_str(&format!("{:04}", chunk % 10_000));
    }
    out
}
