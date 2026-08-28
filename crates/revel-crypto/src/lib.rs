//! Revel's crypto core.
//!
//! Per `docs/26-platform-and-stack.md` this crate is the one implementation of
//! everything security-critical, shared by every platform: WASM for web and
//! desktop, UniFFI for iOS and Android. It is also the single thing a future
//! audit has to cover.

uniffi::setup_scaffolding!();

pub mod device;
pub mod ffi;
pub mod identity;
pub use device::{CertError, DeviceCert};
pub use identity::{DeviceCertIdentityProvider, IdentityError};
