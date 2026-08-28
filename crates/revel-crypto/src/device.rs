//! Device certificates: the piece Kith never built.
//!
//! Revel keys by ACCOUNT for identity and by DEVICE for messaging
//! (`docs/03-identity-and-crypto.md` §1). Every device holds its own MLS
//! signature key and sits in the group as its own leaf; what binds that leaf to
//! a person is a **device certificate** — the account key signing the device's
//! public key.
//!
//! Kith shared one key across an account's devices, which meant a device could
//! not process its own leaf's Commit and had to reload state another device had
//! persisted, with a retry loop for persist lag. Per-device leaves remove that
//! whole class of problem, at the cost of needing this certificate to exist.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

/// Domain separation, so an account-key signature over a device certificate can
/// never be replayed as a signature over anything else this key signs.
const CERT_CONTEXT: &[u8] = b"revel/device-cert/v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceCert {
    /// The account this device speaks for — the stable, public identity.
    pub account_pub: [u8; 32],
    /// The device's MLS signature public key. This is the leaf's key.
    pub device_pub: Vec<u8>,
    /// Human label, shown in the devices screen ("laptop", "phone").
    pub label: String,
    /// The account key's signature over the above.
    pub signature: [u8; 64],
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CertError {
    #[error("device certificate signature is not valid for this account")]
    BadSignature,
    #[error("device certificate is malformed")]
    Malformed,
}

/// Exactly the bytes the account key signs. Length-prefixed so that no two
/// distinct certificates can produce the same signed payload.
fn signed_payload(account_pub: &[u8; 32], device_pub: &[u8], label: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(CERT_CONTEXT.len() + 32 + device_pub.len() + label.len() + 16);
    out.extend_from_slice(CERT_CONTEXT);
    out.extend_from_slice(account_pub);
    out.extend_from_slice(&(device_pub.len() as u32).to_be_bytes());
    out.extend_from_slice(device_pub);
    out.extend_from_slice(&(label.len() as u32).to_be_bytes());
    out.extend_from_slice(label.as_bytes());
    out
}

impl DeviceCert {
    /// Sign a device into an account. Only ever runs on a device that already
    /// holds the account key — enrolment (`docs/17` §3) or sign-in.
    pub fn issue(account_key: &SigningKey, device_pub: &[u8], label: &str) -> Self {
        let account_pub = account_key.verifying_key().to_bytes();
        let sig = account_key.sign(&signed_payload(&account_pub, device_pub, label));
        Self {
            account_pub,
            device_pub: device_pub.to_vec(),
            label: label.to_string(),
            signature: sig.to_bytes(),
        }
    }

    /// Verify this device really was signed into this account.
    pub fn verify(&self) -> Result<(), CertError> {
        let vk = VerifyingKey::from_bytes(&self.account_pub).map_err(|_| CertError::Malformed)?;
        let sig = Signature::from_bytes(&self.signature);
        vk.verify(
            &signed_payload(&self.account_pub, &self.device_pub, &self.label),
            &sig,
        )
        .map_err(|_| CertError::BadSignature)
    }

    /// Wire form carried as the MLS credential payload.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&self.account_pub);
        out.extend_from_slice(&self.signature);
        out.extend_from_slice(&(self.device_pub.len() as u32).to_be_bytes());
        out.extend_from_slice(&self.device_pub);
        out.extend_from_slice(self.label.as_bytes());
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, CertError> {
        if bytes.len() < 32 + 64 + 4 {
            return Err(CertError::Malformed);
        }
        let account_pub: [u8; 32] = bytes[0..32].try_into().map_err(|_| CertError::Malformed)?;
        let signature: [u8; 64] = bytes[32..96].try_into().map_err(|_| CertError::Malformed)?;
        let dlen = u32::from_be_bytes(bytes[96..100].try_into().map_err(|_| CertError::Malformed)?)
            as usize;
        if bytes.len() < 100 + dlen {
            return Err(CertError::Malformed);
        }
        let device_pub = bytes[100..100 + dlen].to_vec();
        let label = String::from_utf8(bytes[100 + dlen..].to_vec()).map_err(|_| CertError::Malformed)?;
        Ok(Self { account_pub, device_pub, label, signature })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    fn account() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    #[test]
    fn issued_cert_verifies() {
        let acct = account();
        let cert = DeviceCert::issue(&acct, b"device-public-key", "laptop");
        assert_eq!(cert.verify(), Ok(()));
    }

    #[test]
    fn cert_round_trips_through_the_wire_form() {
        let acct = account();
        let cert = DeviceCert::issue(&acct, b"device-public-key", "phone");
        let decoded = DeviceCert::decode(&cert.encode()).unwrap();
        assert_eq!(decoded, cert);
        assert_eq!(decoded.verify(), Ok(()));
    }

    #[test]
    fn another_account_cannot_claim_this_device() {
        let acct = account();
        let attacker = account();
        let mut cert = DeviceCert::issue(&acct, b"device-public-key", "laptop");
        // Swap in the attacker's account id, keeping the real signature.
        cert.account_pub = attacker.verifying_key().to_bytes();
        assert_eq!(cert.verify(), Err(CertError::BadSignature));
    }

    #[test]
    fn a_device_key_cannot_be_substituted() {
        let acct = account();
        let mut cert = DeviceCert::issue(&acct, b"real-device", "laptop");
        cert.device_pub = b"attacker-device".to_vec();
        assert_eq!(cert.verify(), Err(CertError::BadSignature));
    }

    #[test]
    fn the_label_is_covered_by_the_signature() {
        // The label shows in the devices screen, so a device that could rename
        // itself to "laptop" after the fact would be a real spoofing surface.
        let acct = account();
        let mut cert = DeviceCert::issue(&acct, b"real-device", "unknown device");
        cert.label = "laptop".into();
        assert_eq!(cert.verify(), Err(CertError::BadSignature));
    }

    #[test]
    fn truncated_input_is_rejected_rather_than_panicking() {
        // decode() parses attacker-influenced bytes; docs/29 §4 says fuzz it.
        for n in 0..200usize {
            let _ = DeviceCert::decode(&vec![0u8; n]);
        }
    }

    #[test]
    fn a_declared_length_larger_than_the_buffer_is_rejected() {
        // The classic parser bug: trust a length prefix, index past the end.
        let acct = account();
        let cert = DeviceCert::issue(&acct, b"device", "laptop");
        let mut bytes = cert.encode();
        bytes[96..100].copy_from_slice(&u32::MAX.to_be_bytes());
        assert_eq!(DeviceCert::decode(&bytes), Err(CertError::Malformed));
    }

    #[test]
    fn a_label_that_is_not_utf8_is_rejected() {
        let acct = account();
        let cert = DeviceCert::issue(&acct, b"device", "laptop");
        let mut bytes = cert.encode();
        let n = bytes.len();
        bytes[n - 1] = 0xff;
        assert_eq!(DeviceCert::decode(&bytes), Err(CertError::Malformed));
    }

    // ---- property tests (docs/29 §4) --------------------------------------

    proptest::proptest! {
        /// Any certificate we issue must survive the wire form unchanged and
        /// still verify — for arbitrary labels and device keys, including
        /// empty ones and awkward unicode.
        #[test]
        fn round_trips_for_arbitrary_inputs(
            label in ".{0,120}",
            device_pub in proptest::collection::vec(proptest::num::u8::ANY, 0..300),
        ) {
            let acct = account();
            let cert = DeviceCert::issue(&acct, &device_pub, &label);
            let decoded = DeviceCert::decode(&cert.encode()).unwrap();
            proptest::prop_assert_eq!(&decoded, &cert);
            proptest::prop_assert_eq!(decoded.verify(), Ok(()));
        }

        /// decode() must never panic, whatever it is handed.
        #[test]
        fn decode_never_panics(bytes in proptest::collection::vec(proptest::num::u8::ANY, 0..600)) {
            let _ = DeviceCert::decode(&bytes);
        }

        /// Flipping any single bit of the signed payload must break the
        /// signature. This is the property the whole certificate rests on.
        #[test]
        fn any_single_bit_flip_invalidates_the_signature(
            byte in 0usize..96,
            bit in 0u8..8,
        ) {
            let acct = account();
            let cert = DeviceCert::issue(&acct, b"a-device-key", "laptop");
            let mut bytes = cert.encode();
            bytes[byte] ^= 1 << bit;
            // Either it no longer parses, or it parses and fails to verify.
            // What it must never do is verify.
            if let Ok(tampered) = DeviceCert::decode(&bytes) {
                proptest::prop_assert!(
                    tampered.verify().is_err(),
                    "a tampered certificate verified"
                );
            }
        }

        /// Two different accounts never produce the same certificate for the
        /// same device — i.e. the account key really is bound in.
        #[test]
        fn different_accounts_produce_different_certificates(
            label in "[a-z]{1,20}",
        ) {
            let a = account();
            let b = account();
            let ca = DeviceCert::issue(&a, b"same-device", &label);
            let cb = DeviceCert::issue(&b, b"same-device", &label);
            proptest::prop_assert_ne!(ca.signature, cb.signature);
            proptest::prop_assert_ne!(ca.account_pub, cb.account_pub);
        }
    }
}
