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

// ---------------------------------------------------------------------------
// The web binding (src/wasm.rs)
// ---------------------------------------------------------------------------
//
// The tests above prove the *crate* works under wasm. These prove the exported
// surface does, which is a different claim: the binding has its own staging
// buffer, its own commit/apply split, and its own certificate decoding, none of
// which the flows above go anywhere near.
//
// `JsError` has no Debug, so failures are unwrapped through `ok()`.

use revel_crypto::wasm::{Account, Device};

/// The whole path a client takes, through the exported API only: enrol two
/// devices, open a group, admit the second, send, receive.
#[wasm_bindgen_test]
fn the_binding_carries_a_full_exchange() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();

    let mut group = laptop.create_group(b"room-general").ok().unwrap();
    assert_eq!(group.id(), b"room-general", "the group id is the caller's");
    assert_eq!(group.size(), 1);

    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    assert_eq!(group.staged(), 1);

    let out = group.commit().ok().unwrap();
    assert_eq!(group.staged(), 0, "committing consumes the staged changes");
    assert_eq!(group.size(), 1, "commit alone must not move the group");

    group.apply_pending().ok().unwrap();
    assert_eq!(group.size(), 2, "applying does");
    assert_eq!(group.epoch(), 1);

    let welcome = out.welcome().expect("adding somebody produces a Welcome");
    let mut theirs = phone.join_group(&welcome).ok().unwrap();
    assert_eq!(theirs.id(), b"room-general");

    let sealed = group.encrypt(b"the buttons need to feel pressable").ok().unwrap();
    let got = theirs.process(&sealed).ok().unwrap();
    assert_eq!(got.kind(), "application");
    assert_eq!(got.data().unwrap(), b"the buttons need to feel pressable");
    assert_eq!(got.sender(), Some(group.own_leaf()));
}

/// `commit()` must not advance the group; only `applyPending()` may.
///
/// This is the property the split exists for. Applying before the server has
/// accepted forks the group — the committer reaches an epoch nobody else does,
/// and every message after it is unreadable by everyone, sender included.
#[wasm_bindgen_test]
fn committing_without_applying_leaves_the_group_where_it_was() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();

    let mut group = laptop.create_group(b"room-design").ok().unwrap();
    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    let _ = group.commit().ok().unwrap();

    assert_eq!(group.epoch(), 0, "a built-but-unapplied commit moved the epoch");
    assert_eq!(group.size(), 1);
}

/// Staged changes survive a refused batch, so a caller can drop one member and
/// retry rather than rebuilding the list.
#[wasm_bindgen_test]
fn a_refused_batch_leaves_the_staged_changes_alone() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();

    let mut group = laptop.create_group(b"room-voice").ok().unwrap();
    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    // Leaf 9 does not exist in a one-member group, so the batch cannot build.
    group.stage_remove(9);
    assert_eq!(group.staged(), 2);

    assert!(group.commit().is_err(), "removing a nonexistent leaf should refuse");
    assert_eq!(group.staged(), 2, "a failed commit threw away the staged changes");

    group.clear_staged();
    assert_eq!(group.staged(), 0);
}

/// The roster crossing the boundary carries the account and label out of each
/// leaf's certificate — the data the members screen is built from.
#[wasm_bindgen_test]
fn members_come_back_with_their_account_and_label() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();

    let mut group = laptop.create_group(b"room-lab").ok().unwrap();
    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();

    let members = group.members();
    assert_eq!(members.length(), 2);

    let labels: Vec<String> = (0..members.length())
        .map(|i| {
            let m = members.get(i);
            js_sys::Reflect::get(&m, &"label".into()).unwrap().as_string().unwrap()
        })
        .collect();
    assert!(labels.contains(&"laptop".to_string()));
    assert!(labels.contains(&"phone".to_string()));
}

/// A certificate that does not verify must not yield readable contents. The
/// label shows in the devices screen, so returning it unverified would be a
/// spoofing surface — the same property `device.rs` tests natively, asserted
/// again at the boundary the UI actually calls.
#[wasm_bindgen_test]
fn a_tampered_certificate_is_refused_at_the_boundary() {
    let account = Account::new();
    let device = Device::new(&account, "unknown device").ok().unwrap();
    let cert = device.certificate();

    assert!(revel_crypto::wasm::read_device_cert(&cert).is_ok());

    let mut forged = cert.clone();
    let n = forged.len();
    forged[n - 1] ^= 0xff;
    assert!(
        revel_crypto::wasm::read_device_cert(&forged).is_err(),
        "a tampered certificate was readable through the web binding"
    );
}

/// An account survives the round trip through the bytes a client would store.
#[wasm_bindgen_test]
fn an_account_restores_from_its_secret() {
    let a = Account::new();
    let restored = Account::from_secret(&a.secret_key()).ok().unwrap();
    assert_eq!(a.public_key(), restored.public_key());

    assert!(Account::from_secret(&[0u8; 16]).is_err(), "a short secret should refuse");
}
