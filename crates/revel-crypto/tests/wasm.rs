//! The same MLS flows, executed **inside wasm**.
//!
//! `26-platform-and-stack.md` bets one Rust core serves every platform.
//! `cargo build --target wasm32` only proves it compiles — a crate can compile
//! to wasm and then fail at runtime on entropy, time, or a missing intrinsic.
//! These run in Node against the real wasm artifact.
//!
//!   cargo test -p revel-crypto --target wasm32-unknown-unknown --test wasm
#![cfg(target_arch = "wasm32")]

use mls_rs::{
    client_builder::MlsConfig, group::ReceivedMessage, identity::basic::BasicCredential,
    identity::SigningIdentity, CipherSuite, CipherSuiteProvider, Client, CryptoProvider,
    ExtensionList,
};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use revel_crypto::{DeviceCert, DeviceCertIdentityProvider};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_node_experimental);

const CS: CipherSuite = CipherSuite::CURVE25519_AES128;

fn account() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng)
}

fn device(acct: &ed25519_dalek::SigningKey, label: &str) -> Client<impl MlsConfig> {
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

/// Entropy is the classic wasm failure: `OsRng` has no OS underneath. If
/// getrandom's js backend weren't wired up, this panics rather than fails.
#[wasm_bindgen_test]
fn randomness_works_in_wasm() {
    let a = account().to_bytes();
    let b = account().to_bytes();
    assert_ne!(a, b, "two generated account keys were identical");
}

#[wasm_bindgen_test]
fn device_certificates_work_in_wasm() {
    let acct = account();
    let cert = DeviceCert::issue(&acct, b"device-key", "laptop");
    assert!(cert.verify().is_ok());
    assert_eq!(DeviceCert::decode(&cert.encode()).unwrap(), cert);

    let mut forged = cert.clone();
    forged.label = "somebody-else".into();
    assert!(forged.verify().is_err(), "a tampered certificate verified inside wasm");
}

/// The real proof: a full two-device MLS exchange, in wasm.
#[wasm_bindgen_test]
fn a_two_device_mls_exchange_works_in_wasm() {
    let acct = account();
    let a = device(&acct, "laptop");
    let b = device(&acct, "phone");

    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let commit = ga.commit_builder().add_member(kp).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &commit.welcome_messages[0], None).unwrap();

    let msg = ga.encrypt_application_message(b"hello from wasm", Default::default()).unwrap();
    match gb.process_incoming_message(msg).unwrap() {
        ReceivedMessage::ApplicationMessage(m) => assert_eq!(m.data(), b"hello from wasm"),
        o => panic!("expected an application message, got {o:?}"),
    }
}

/// Revocation — the property "sign out this device" depends on — inside wasm.
#[wasm_bindgen_test]
fn revocation_still_cuts_a_device_off_in_wasm() {
    let acct = account();
    let a = device(&acct, "laptop");
    let b = device(&acct, "phone");
    let c = device(&acct, "tablet");

    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let mut builder = ga.commit_builder();
    for cl in [&b, &c] {
        builder = builder
            .add_member(cl.generate_key_package_message(Default::default(), Default::default(), None).unwrap())
            .unwrap();
    }
    let commit = builder.build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &commit.welcome_messages[0], None).unwrap();
    let (mut gc, _) = c.join_group(None, &commit.welcome_messages[0], None).unwrap();

    let victim = ga
        .roster()
        .members()
        .iter()
        .find(|m| {
            DeviceCert::decode(&m.signing_identity.credential.as_basic().unwrap().identifier)
                .map(|x| x.label == "tablet")
                .unwrap_or(false)
        })
        .unwrap()
        .index;

    let rm = ga.commit_builder().remove_member(victim).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    gb.process_incoming_message(rm.commit_message.clone()).unwrap();
    let _ = gc.process_incoming_message(rm.commit_message);

    let after = ga.encrypt_application_message(b"after", Default::default()).unwrap();
    assert!(gb.process_incoming_message(after.clone()).is_ok(), "remaining member lost access");
    assert!(gc.process_incoming_message(after).is_err(), "revoked device still reading, in wasm");
}
