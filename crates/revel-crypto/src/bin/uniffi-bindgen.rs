//! Binding generator for the native (Swift/Kotlin) targets.
//!
//! Not applicable on wasm32 — the web reaches the same core through
//! wasm-bindgen — so the body is compiled out rather than the whole bin being
//! excluded, which keeps `cargo test --target wasm32` from failing to build it.

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    uniffi::uniffi_bindgen_main()
}

#[cfg(target_arch = "wasm32")]
fn main() {}
