//! Adversarial tests (`docs/29` §4): tampered ciphertext, replays, forged
//! commits, garbage input. These are the tests that matter — a crypto layer
//! that only works on well-formed input isn't a crypto layer.

mod common;
use common::*;

use mls_rs::{group::ReceivedMessage, ExtensionList, MlsMessage};

/// Two devices in a group, plus the raw commit that created it.
fn pair() -> (
    mls_rs::Group<impl mls_rs::client_builder::MlsConfig>,
    mls_rs::Group<impl mls_rs::client_builder::MlsConfig>,
) {
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let commit = ga.commit_builder().add_member(kp).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (gb, _) = b.join_group(None, &commit.welcome_messages[0], None).unwrap();
    (ga, gb)
}

#[test]
fn a_flipped_bit_in_the_ciphertext_is_rejected() {
    let (mut ga, mut gb) = pair();
    let msg = ga.encrypt_application_message(b"hello there", Default::default()).unwrap();

    let mut bytes = msg.to_bytes().unwrap();
    let n = bytes.len();
    bytes[n - 5] ^= 0x01; // inside the AEAD ciphertext/tag

    let tampered = MlsMessage::from_bytes(&bytes);
    let rejected = match tampered {
        Err(_) => true,
        Ok(m) => gb.process_incoming_message(m).is_err(),
    };
    assert!(rejected, "a tampered message was accepted");
}

#[test]
fn replaying_a_message_is_rejected() {
    // MLS generation numbers make each application message single-use. Without
    // that, an attacker who captured a message could re-deliver it later.
    let (mut ga, mut gb) = pair();
    let msg = ga.encrypt_application_message(b"only once", Default::default()).unwrap();

    assert!(gb.process_incoming_message(msg.clone()).is_ok(), "first delivery should work");
    assert!(
        gb.process_incoming_message(msg).is_err(),
        "REPLAY ACCEPTED: the same message was processed twice"
    );
}

#[test]
fn a_message_from_a_stale_epoch_does_not_forge_membership() {
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let evicted = device(&acct, "evicted");

    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let mut builder = ga.commit_builder();
    for c in [&b, &evicted] {
        builder = builder
            .add_member(c.generate_key_package_message(Default::default(), Default::default(), None).unwrap())
            .unwrap();
    }
    let commit = builder.build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &commit.welcome_messages[0], None).unwrap();
    let (mut ge, _) = evicted.join_group(None, &commit.welcome_messages[0], None).unwrap();

    // The soon-to-be-evicted device prepares a message but doesn't send it yet.
    let held_back = ge.encrypt_application_message(b"sent from the past", Default::default()).unwrap();

    // It's removed.
    let idx = leaf_of(&ga, "evicted");
    let removal = ga.commit_builder().remove_member(idx).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    gb.process_incoming_message(removal.commit_message).unwrap();

    // Now the held-back message arrives. It belongs to a dead epoch.
    assert!(
        gb.process_incoming_message(held_back).is_err(),
        "a message from a removed member's old epoch was accepted"
    );
}

#[test]
fn garbage_input_never_panics() {
    // process_incoming_message parses attacker-controlled bytes. It may error,
    // it must not panic. docs/29 §4 says fuzz the decoder; this is the floor.
    let (_, mut gb) = pair();
    let cases: Vec<Vec<u8>> = vec![
        vec![],
        vec![0],
        vec![0xff; 16],
        vec![0x00; 1024],
        (0u8..=255).collect(),
        b"not an mls message at all".to_vec(),
    ];
    for c in cases {
        if let Ok(m) = MlsMessage::from_bytes(&c) {
            let _ = gb.process_incoming_message(m);
        }
    }
}

#[test]
fn a_member_cannot_decrypt_its_own_message() {
    // Not a flaw — MLS senders can't open their own application messages, which
    // is why the client keeps a local plaintext echo. Kith hit this and it is
    // worth pinning so nobody "fixes" it later.
    let (mut ga, _gb) = pair();
    let msg = ga.encrypt_application_message(b"echo", Default::default()).unwrap();
    assert!(
        ga.process_incoming_message(msg).is_err(),
        "sender decrypted its own message — the local-echo assumption changed"
    );
}

#[test]
fn plaintext_does_not_appear_in_the_wire_bytes() {
    // A blunt but genuinely useful check: if someone accidentally ships a
    // cleartext path, this fails loudly.
    let (mut ga, _) = pair();
    let secret = b"the-buttons-need-to-feel-pressable";
    let msg = ga.encrypt_application_message(secret, Default::default()).unwrap();
    let bytes = msg.to_bytes().unwrap();
    assert!(
        !bytes.windows(secret.len()).any(|w| w == secret),
        "PLAINTEXT ON THE WIRE: the message body appears in the encoded frame"
    );
}

#[test]
fn every_epoch_produces_a_different_exporter_secret() {
    // Voice keys derive from the exporter (docs/03 §6), and mid-call rekey
    // depends on this changing per epoch.
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let commit = ga.commit_builder().add_member(kp).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let _ = b.join_group(None, &commit.welcome_messages[0], None).unwrap();

    let e1 = ga.export_secret(b"revel/voice", b"", 32).unwrap();
    let _ = ga.commit_builder().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let e2 = ga.export_secret(b"revel/voice", b"", 32).unwrap();

    assert_ne!(
        e1.as_bytes(),
        e2.as_bytes(),
        "exporter secret did not change across an epoch — voice rekey would be a no-op"
    );
}

#[test]
fn a_removed_device_cannot_read_but_a_remaining_one_can() {
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let c = device(&acct, "c");
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

    let idx = leaf_of(&ga, "c");
    let rm = ga.commit_builder().remove_member(idx).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    gb.process_incoming_message(rm.commit_message.clone()).unwrap();
    let _ = gc.process_incoming_message(rm.commit_message);

    let after = ga.encrypt_application_message(b"after", Default::default()).unwrap();
    match gb.process_incoming_message(after.clone()).unwrap() {
        ReceivedMessage::ApplicationMessage(m) => assert_eq!(m.data(), b"after"),
        o => panic!("expected an application message, got {o:?}"),
    }
    assert!(gc.process_incoming_message(after).is_err(), "removed device still reading");
}
