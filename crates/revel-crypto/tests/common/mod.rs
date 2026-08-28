//! Shared harness. `docs/29-engineering-plan.md` §4 calls for a multi-client
//! harness because "the hard bugs are distributed and stateful" — this is the
//! seed of it.

use mls_rs::{
    client_builder::MlsConfig, identity::basic::BasicCredential, identity::SigningIdentity,
    CipherSuite, CipherSuiteProvider, Client, CryptoProvider,
};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use revel_crypto::{DeviceCert, DeviceCertIdentityProvider};

pub const CS: CipherSuite = CipherSuite::CURVE25519_AES128;

pub fn account() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng)
}

/// One enrolled device of `acct`, carrying a certificate that account signed.
pub fn device(acct: &ed25519_dalek::SigningKey, label: &str) -> Client<impl MlsConfig> {
    let crypto = RustCryptoProvider::default();
    let cs = crypto.cipher_suite_provider(CS).unwrap();
    let (secret, public) = cs.signature_key_generate().unwrap();
    let cert = DeviceCert::issue(acct, public.as_bytes(), label);
    let credential = BasicCredential::new(cert.encode()).into_credential();
    Client::builder()
        .identity_provider(DeviceCertIdentityProvider)
        .crypto_provider(crypto)
        .signing_identity(SigningIdentity::new(credential, public), secret, CS)
        .build()
}

/// Leaf index of the member whose certificate carries `label`.
///
/// Each test binary compiles this module separately, so it is dead code in
/// the ones that don't use it — hence the allow rather than a split module.
#[allow(dead_code)]
pub fn leaf_of<C: MlsConfig>(group: &mls_rs::Group<C>, label: &str) -> u32 {
    group
        .roster()
        .members()
        .iter()
        .find(|m| {
            DeviceCert::decode(&m.signing_identity.credential.as_basic().unwrap().identifier)
                .map(|c| c.label == label)
                .unwrap_or(false)
        })
        .unwrap_or_else(|| panic!("no member labelled {label}"))
        .index
}
