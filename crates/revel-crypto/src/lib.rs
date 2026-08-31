//! Revel's crypto core.
//!
//! Per `docs/26-platform-and-stack.md` this crate is the one implementation of
//! everything security-critical, shared by every platform: WASM for web and
//! desktop, UniFFI for iOS and Android. It is also the single thing a future
//! audit has to cover.

#[cfg(not(target_arch = "wasm32"))]
uniffi::setup_scaffolding!();

pub mod device;
pub mod envelope;
/// Native FFI surface (Swift/Kotlin). Not built for wasm — the web reaches the
/// same core through wasm-bindgen instead.
#[cfg(not(target_arch = "wasm32"))]
pub mod ffi;
pub mod identity;
pub mod store;
/// Web FFI surface (wasm-bindgen). Native platforms reach the same core
/// through UniFFI instead — see `ffi`.
#[cfg(target_arch = "wasm32")]
pub mod wasm;
pub use device::{CertError, DeviceCert};
pub use envelope::{EnvelopeError, Wrap};
pub use identity::{DeviceCertIdentityProvider, IdentityError};
pub use store::{LocalGroupStore, LocalKeyPackageStore, StoreError};
