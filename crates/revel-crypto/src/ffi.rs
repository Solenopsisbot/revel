//! UniFFI surface — the same core, reachable from Swift and Kotlin.
//!
//! `docs/26-platform-and-stack.md` bets that one Rust crypto core serves every
//! platform: `wasm-bindgen` for web, UniFFI for iOS and Android. That bet is
//! only worth anything if the native binding actually works, so this exists to
//! prove it rather than assume it.
//!
//! Deliberately narrow. The FFI boundary is a place bugs hide, so it exposes
//! plain values — no lifetimes, no generics, no borrowed slices crossing over.

use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;

use crate::device::{CertError, DeviceCert};

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum FfiError {
    #[error("device certificate is invalid: {reason}")]
    InvalidCert { reason: String },
    #[error("account key must be 32 bytes, got {len}")]
    BadAccountKey { len: u32 },
}

impl From<CertError> for FfiError {
    fn from(e: CertError) -> Self {
        FfiError::InvalidCert { reason: e.to_string() }
    }
}

/// A device certificate, flattened for the FFI boundary.
#[derive(uniffi::Record)]
pub struct FfiDeviceCert {
    pub account_pub: Vec<u8>,
    pub device_pub: Vec<u8>,
    pub label: String,
    pub encoded: Vec<u8>,
}

impl From<DeviceCert> for FfiDeviceCert {
    fn from(c: DeviceCert) -> Self {
        Self {
            account_pub: c.account_pub.to_vec(),
            device_pub: c.device_pub.clone(),
            label: c.label.clone(),
            encoded: c.encode(),
        }
    }
}

/// Generate a fresh account key. Returns the 32-byte seed — the caller is
/// responsible for putting it somewhere the OS protects (Keychain, Keystore).
#[uniffi::export]
pub fn generate_account_key() -> Vec<u8> {
    SigningKey::generate(&mut OsRng).to_bytes().to_vec()
}

/// Sign a device into an account. Runs during enrolment, on a device that
/// already holds the account key (`docs/17` §3).
#[uniffi::export]
pub fn issue_device_cert(
    account_key: Vec<u8>,
    device_pub: Vec<u8>,
    label: String,
) -> Result<FfiDeviceCert, FfiError> {
    let bytes: [u8; 32] = account_key
        .as_slice()
        .try_into()
        .map_err(|_| FfiError::BadAccountKey { len: account_key.len() as u32 })?;
    let key = SigningKey::from_bytes(&bytes);
    Ok(DeviceCert::issue(&key, &device_pub, &label).into())
}

/// Verify a certificate that arrived over the wire.
#[uniffi::export]
pub fn verify_device_cert(encoded: Vec<u8>) -> Result<FfiDeviceCert, FfiError> {
    let cert = DeviceCert::decode(&encoded)?;
    cert.verify()?;
    Ok(cert.into())
}

/// Whether a certificate is valid, for callers that only want a yes/no.
#[uniffi::export]
pub fn is_device_cert_valid(encoded: Vec<u8>) -> bool {
    DeviceCert::decode(&encoded).and_then(|c| c.verify().map(|_| c)).is_ok()
}
