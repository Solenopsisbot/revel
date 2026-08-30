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

    let mut group = laptop.create_group(b"room-general", None).ok().unwrap();
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
    let mut theirs = phone.join_group(&welcome, &out.tree()).ok().unwrap();
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

    let mut group = laptop.create_group(b"room-design", None).ok().unwrap();
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

    let mut group = laptop.create_group(b"room-voice", None).ok().unwrap();
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

    let mut group = laptop.create_group(b"room-lab", None).ok().unwrap();
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

/// The whole reason persistence exists: close the page, come back, still read.
///
/// "Reloading" is modelled the only way it can be — throw the `Device` away and
/// build a new one from nothing but the bytes a client would have written down:
/// the account secret, the device secret, and the sealed group state.
#[wasm_bindgen_test]
fn a_group_survives_a_reload() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();

    let mut group = laptop.create_group(b"g-general", None).ok().unwrap();
    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    let out = group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();
    let mut theirs = phone.join_group(&out.welcome().unwrap(), &out.tree()).ok().unwrap();

    // A message sent before the reload, which must still be readable after.
    let sealed_message = group.encrypt(b"sent before the reload").ok().unwrap();

    // Everything a client would have persisted, and nothing else. Exported
    // *after* the send, which is the order a client has to use — see
    // `restoring_behind_the_last_send_is_refused_by_the_far_side`.
    let account_secret = account.secret_key();
    let device_secret = laptop.secret_key();
    let sealed = laptop.export_group(b"g-general").ok().unwrap();

    // The page goes away.
    drop(group);
    drop(laptop);
    drop(account);

    let account = Account::from_secret(&account_secret).ok().unwrap();
    let laptop = Device::restore(&account, "laptop", &device_secret).ok().unwrap();
    assert_eq!(
        laptop.import_group(&sealed).ok().unwrap(),
        b"g-general",
        "importing should report the group id it restored"
    );

    let mut group = laptop.load_group(b"g-general").ok().unwrap();
    assert_eq!(group.epoch(), 1, "the restored group is at the epoch it was left at");
    assert_eq!(group.size(), 2);

    // And it is still the same leaf, which is what restoring the device key
    // buys: a new key would have been a new member.
    assert_eq!(group.own_leaf(), 0);

    // The other side, which never reloaded, can still read what we sent before
    // the reload, and we can still talk to it afterwards.
    let got = theirs.process(&sealed_message).ok().unwrap();
    assert_eq!(got.data().unwrap(), b"sent before the reload");

    let after = group.encrypt(b"and after it").ok().unwrap();
    assert_eq!(theirs.process(&after).ok().unwrap().data().unwrap(), b"and after it");
}

/// Restoring is only possible with the same account. A sealed group is not a
/// portable document.
#[wasm_bindgen_test]
fn another_account_cannot_open_a_sealed_group() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    laptop.create_group(b"g-secret", None).ok().unwrap();
    let sealed = laptop.export_group(b"g-secret").ok().unwrap();

    let stranger = Account::new();
    let theirs = Device::new(&stranger, "laptop").ok().unwrap();
    assert!(
        theirs.import_group(&sealed).is_err(),
        "a sealed group opened under the wrong account"
    );
}

/// Changes mark the group dirty; exporting clears it. This is what lets the
/// TypeScript store write lazily without ever missing a change.
#[wasm_bindgen_test]
fn the_store_tracks_what_still_needs_writing() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();

    // Creating a group is itself a change worth persisting.
    let mut group = laptop.create_group(b"g-dirty", None).ok().unwrap();
    assert_eq!(laptop.dirty_groups().ok().unwrap().length(), 1);

    laptop.export_group(b"g-dirty").ok().unwrap();
    assert_eq!(laptop.dirty_groups().ok().unwrap().length(), 0);

    // A commit is an epoch change, so it must come back dirty.
    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();
    assert_eq!(laptop.dirty_groups().ok().unwrap().length(), 1);

    laptop.export_group(b"g-dirty").ok().unwrap();
    assert_eq!(laptop.dirty_groups().ok().unwrap().length(), 0);
    assert_eq!(laptop.stored_groups().ok().unwrap().length(), 1);

    laptop.forget_group(b"g-dirty").ok().unwrap();
    assert_eq!(laptop.stored_groups().ok().unwrap().length(), 0);
}

/// A device that comes back with a fresh key is a *different* device.
///
/// Asserted so that nobody "simplifies" `restore` away: without the stored
/// secret the reloaded client is a new leaf, its old leaf is still in the
/// group, and the group it loads is not one it can speak in.
#[wasm_bindgen_test]
fn a_device_that_forgets_its_key_is_not_the_same_device() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let restored = Device::restore(&account, "laptop", &laptop.secret_key()).ok().unwrap();
    let forgetful = Device::new(&account, "laptop").ok().unwrap();

    assert_eq!(laptop.certificate(), restored.certificate());
    assert_ne!(laptop.certificate(), forgetful.certificate());
}

/// Restoring to a state older than the last message sent is a real hazard, and
/// this is what it looks like.
///
/// Sending advances this device's position in the secret tree, and the key and
/// nonce come from that position. Come back behind it and the next send
/// re-derives a key and nonce that have already been used — under AES-GCM,
/// two plaintexts under one key and nonce is a total loss for both.
///
/// The far side refuses the message, which is mls-rs's replay protection doing
/// its job, and is what makes this observable at all. It does **not** undo the
/// reuse. So the rule the layer above has to keep is: **the new state must be
/// durable before the ciphertext is handed to anyone.** This test exists so
/// that rule has a failing test behind it rather than a comment.
#[wasm_bindgen_test]
fn restoring_behind_the_last_send_is_refused_by_the_far_side() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();

    let mut group = laptop.create_group(b"g-rewind", None).ok().unwrap();
    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    let out = group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();
    let mut theirs = phone.join_group(&out.welcome().unwrap(), &out.tree()).ok().unwrap();

    // Saved here, deliberately too early.
    let stale = laptop.export_group(b"g-rewind").ok().unwrap();
    let account_secret = account.secret_key();
    let device_secret = laptop.secret_key();

    // Then a message goes out, and the far side reads it.
    let first = group.encrypt(b"the first message").ok().unwrap();
    assert_eq!(theirs.process(&first).ok().unwrap().data().unwrap(), b"the first message");

    // The page dies before that state reached disk.
    drop(group);
    drop(laptop);
    drop(account);

    let account = Account::from_secret(&account_secret).ok().unwrap();
    let laptop = Device::restore(&account, "laptop", &device_secret).ok().unwrap();
    laptop.import_group(&stale).ok().unwrap();
    let mut group = laptop.load_group(b"g-rewind").ok().unwrap();

    // It looks fine from here — same epoch, same leaf, encrypts happily.
    assert_eq!(group.epoch(), 1);
    let reused = group.encrypt(b"a different message").ok().unwrap();

    // And the far side throws it away, because that generation is spent.
    assert!(
        theirs.process(&reused).is_err(),
        "a rewound sender's message was accepted; replay protection is not working"
    );
}

/// A pending invite has to survive a reload too.
///
/// Publish a key package, close the tab, get added while away. Without the
/// private half the Welcome that comes back cannot be opened — a member of a
/// group they cannot read, which is a worse state than not being added at all.
#[wasm_bindgen_test]
fn a_pending_invite_survives_a_reload() {
    let host_account = Account::new();
    let host = Device::new(&host_account, "host").ok().unwrap();
    let mut group = host.create_group(b"g-invited", None).ok().unwrap();

    // Our device publishes a key package, then everything is written down.
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let kp = laptop.key_package().ok().unwrap();

    assert!(laptop.key_packages_dirty().ok().unwrap());
    assert_eq!(laptop.pending_key_packages().ok().unwrap(), 1);
    let account_secret = account.secret_key();
    let device_secret = laptop.secret_key();
    let sealed_packages = laptop.export_key_packages().ok().unwrap();
    assert!(!laptop.key_packages_dirty().ok().unwrap());

    // The tab closes.
    drop(laptop);
    drop(account);

    // Meanwhile, someone adds us.
    group.stage_add(&kp).ok().unwrap();
    let out = group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();

    // And we come back.
    let account = Account::from_secret(&account_secret).ok().unwrap();
    let laptop = Device::restore(&account, "laptop", &device_secret).ok().unwrap();
    assert_eq!(
        laptop.import_key_packages(&sealed_packages).ok().unwrap(),
        1
    );

    let mut ours = laptop.join_group(&out.welcome().unwrap(), &out.tree()).ok().unwrap();
    assert_eq!(ours.id(), b"g-invited");

    let sealed = group.encrypt(b"welcome in").ok().unwrap();
    assert_eq!(ours.process(&sealed).ok().unwrap().data().unwrap(), b"welcome in");

    // Joining consumed it, so there is nothing left outstanding — and that
    // deletion is itself a change the store must persist.
    assert_eq!(laptop.pending_key_packages().ok().unwrap(), 0);
    assert!(laptop.key_packages_dirty().ok().unwrap());
}

/// Without the key packages, the same reload leaves us unable to join.
///
/// The negative of the test above, asserted rather than assumed — this is the
/// bug the store exists to prevent, and it should stay visible.
#[wasm_bindgen_test]
fn a_reload_without_key_packages_cannot_open_the_welcome() {
    let host_account = Account::new();
    let host = Device::new(&host_account, "host").ok().unwrap();
    let mut group = host.create_group(b"g-lost", None).ok().unwrap();

    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let kp = laptop.key_package().ok().unwrap();
    let account_secret = account.secret_key();
    let device_secret = laptop.secret_key();

    drop(laptop);
    drop(account);

    group.stage_add(&kp).ok().unwrap();
    let out = group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();

    // Same account, same device key — and still no way in, because the private
    // half of the key package went with the tab.
    let account = Account::from_secret(&account_secret).ok().unwrap();
    let laptop = Device::restore(&account, "laptop", &device_secret).ok().unwrap();
    assert!(
        laptop.join_group(&out.welcome().unwrap(), &out.tree()).is_err(),
        "a Welcome opened without the key package secret it was sealed to"
    );
}

/// The ratchet tree travels out of band, and the Welcome is small because of it.
///
/// `docs/03` §5 rejects the `ratchet_tree` extension and `docs/31` §2 measured
/// what it costs: with the tree inlined, one join at 2,000 members is 627 KiB
/// of Welcome. Off, the Welcome carries the joiner's secrets and nothing else.
#[wasm_bindgen_test]
fn the_welcome_does_not_carry_the_tree() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();

    let mut group = laptop.create_group(b"g-wide", None).ok().unwrap();
    let mut phones = Vec::new();
    for i in 0..8 {
        let d = Device::new(&account, &format!("phone-{i}")).ok().unwrap();
        group.stage_add(&d.key_package().ok().unwrap()).ok().unwrap();
        phones.push(d);
    }
    let out = group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();

    let welcome = out.welcome().unwrap();
    let tree = out.tree();

    // The tree is the bulky part and it grows with the group; the Welcome grows
    // only with the number of people being added. Asserting the relationship
    // rather than an absolute size, because the absolute one is a benchmark and
    // this is a test.
    assert!(!tree.is_empty(), "no tree came out of the commit");
    assert!(
        welcome.len() < tree.len(),
        "welcome {} bytes vs tree {} bytes — is the extension back on?",
        welcome.len(),
        tree.len()
    );

    // And it is genuinely required: the Welcome alone is not enough.
    assert!(
        phones[0].join_group(&welcome, &[]).is_err(),
        "joined with no tree at all"
    );
    let mut joined = phones[0].join_group(&welcome, &tree).ok().unwrap();
    assert_eq!(joined.id(), b"g-wide");

    let sealed = group.encrypt(b"out of band").ok().unwrap();
    assert_eq!(joined.process(&sealed).ok().unwrap().data().unwrap(), b"out of band");
}

/// A tree from the wrong epoch is refused, not quietly accepted.
///
/// The failure this prevents is a joiner whose view of the roster disagrees
/// with everyone else's — which would not show up until somebody committed and
/// the two trees produced different secrets.
#[wasm_bindgen_test]
fn a_tree_from_the_wrong_epoch_is_refused() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();
    let tablet = Device::new(&account, "tablet").ok().unwrap();

    let mut group = laptop.create_group(b"g-epochs", None).ok().unwrap();
    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    let first = group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();

    group.stage_add(&tablet.key_package().ok().unwrap()).ok().unwrap();
    let second = group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();

    // The tablet's Welcome is for epoch 2; the tree from epoch 1 does not match.
    assert!(
        tablet.join_group(&second.welcome().unwrap(), &first.tree()).is_err(),
        "a stale tree was accepted"
    );
    assert!(
        tablet.join_group(&second.welcome().unwrap(), &second.tree()).is_ok(),
        "the matching tree was refused"
    );
}

/// Local state is sealed under the **device** key, not the account key.
///
/// `docs/03` §1 asks for this and the reason is not subtle: the account secret
/// is the thing that gets backed up and wrapped for recovery (`docs/03` §3), so
/// sealing local state under it means anybody who recovers an account can open
/// a stolen disk image from any device that account ever used — including ones
/// signed out years earlier.
///
/// Sealed under the device key, a local store is worth exactly as much as the
/// device it came from.
#[wasm_bindgen_test]
fn local_state_is_sealed_to_the_device_not_the_account() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let phone = Device::new(&account, "phone").ok().unwrap();

    let mut group = laptop.create_group(b"g-sealed", None).ok().unwrap();
    group.stage_add(&phone.key_package().ok().unwrap()).ok().unwrap();
    let out = group.commit().ok().unwrap();
    group.apply_pending().ok().unwrap();

    let sealed = laptop.export_group(b"g-sealed").ok().unwrap();

    // The same account, a different device. Same account key, and it is no
    // help — which is the entire property.
    assert!(
        phone.import_group(&sealed).is_err(),
        "another device of the same account opened this device's local state"
    );

    // And the device that sealed it still can.
    let restored = Device::restore(&account, "laptop", &laptop.secret_key()).ok().unwrap();
    assert!(restored.import_group(&sealed).is_ok(), "the sealing device could not reopen it");

    let _ = out;
}

/// A blob from before the derivation changed is refused by name.
///
/// The magic moved with the key (`REVELGS\x01` → `\x02`), so an older blob
/// fails as "not our format" rather than as an authentication failure — the
/// difference between "this is from an older build" and "your crypto is
/// broken", at exactly the moment somebody is trying to work out which.
#[wasm_bindgen_test]
fn a_blob_from_the_previous_format_is_refused_clearly() {
    let account = Account::new();
    let laptop = Device::new(&account, "laptop").ok().unwrap();
    let mut group = laptop.create_group(b"g-old", None).ok().unwrap();
    group.encrypt(b"anything").ok().unwrap();

    let mut sealed = laptop.export_group(b"g-old").ok().unwrap();
    sealed[7] = 1; // the version byte inside the magic

    assert!(laptop.import_group(&sealed).is_err(), "a v1 blob was accepted");
}
