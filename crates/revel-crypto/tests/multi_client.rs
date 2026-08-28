//! The distributed, stateful scenarios (`docs/29` §4). Every bug Kith actually
//! hit lives in this shape: several clients, imperfect ordering, and time.

mod common;
use common::*;

use mls_rs::{group::ReceivedMessage, ExtensionList};

fn body(m: ReceivedMessage) -> Vec<u8> {
    match m {
        ReceivedMessage::ApplicationMessage(a) => a.data().to_vec(),
        o => panic!("expected an application message, got {o:?}"),
    }
}

#[test]
fn two_devices_of_one_account_both_send_and_both_read() {
    // Kith could not do this: one shared key meant a device could not process
    // its own leaf's Commit, so it reloaded state another device had persisted.
    let viola = account();
    let ash = account();
    let laptop = device(&viola, "laptop");
    let phone = device(&viola, "phone");
    let theirs = device(&ash, "ash");

    let mut gl = laptop.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let mut b = gl.commit_builder();
    for c in [&phone, &theirs] {
        b = b.add_member(c.generate_key_package_message(Default::default(), Default::default(), None).unwrap()).unwrap();
    }
    let commit = b.build().unwrap();
    gl.apply_pending_commit().unwrap();
    let (mut gp, _) = phone.join_group(None, &commit.welcome_messages[0], None).unwrap();
    let (mut gt, _) = theirs.join_group(None, &commit.welcome_messages[0], None).unwrap();

    // Laptop speaks.
    let m1 = gl.encrypt_application_message(b"from the laptop", Default::default()).unwrap();
    assert_eq!(body(gp.process_incoming_message(m1.clone()).unwrap()), b"from the laptop");
    assert_eq!(body(gt.process_incoming_message(m1).unwrap()), b"from the laptop");

    // Phone speaks — the same account, a different leaf.
    let m2 = gp.encrypt_application_message(b"from the phone", Default::default()).unwrap();
    assert_eq!(body(gl.process_incoming_message(m2.clone()).unwrap()), b"from the phone");
    assert_eq!(body(gt.process_incoming_message(m2).unwrap()), b"from the phone");
}

#[test]
fn a_device_can_commit_and_the_others_follow() {
    // The "designated committer" pattern (docs/03 §5): whoever is online
    // commits, everyone else applies.
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let c = device(&acct, "c");

    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp_b = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let commit = ga.commit_builder().add_member(kp_b).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &commit.welcome_messages[0], None).unwrap();

    // B, not the creator, adds C.
    let kp_c = c.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let commit2 = gb.commit_builder().add_member(kp_c).unwrap().build().unwrap();
    gb.apply_pending_commit().unwrap();
    ga.process_incoming_message(commit2.commit_message).unwrap();
    let (mut gc, _) = c.join_group(None, &commit2.welcome_messages[0], None).unwrap();

    assert_eq!(ga.current_epoch(), gb.current_epoch());
    assert_eq!(gb.current_epoch(), gc.current_epoch());

    let msg = gc.encrypt_application_message(b"c is here", Default::default()).unwrap();
    assert_eq!(body(ga.process_incoming_message(msg.clone()).unwrap()), b"c is here");
    assert_eq!(body(gb.process_incoming_message(msg).unwrap()), b"c is here");
}

#[test]
fn a_concurrent_commit_loses_cleanly_instead_of_corrupting_state() {
    // Two members commit against the same epoch. One must win and the other
    // must fail loudly — a silent divergence here is what produced Kith's
    // "you and X have drifted apart" (docs/22).
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let c0 = ga.commit_builder().add_member(kp).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &c0.welcome_messages[0], None).unwrap();

    // Both build a commit at the same epoch.
    let from_a = ga.commit_builder().build().unwrap();
    let from_b = gb.commit_builder().build().unwrap();

    // A's lands first.
    ga.apply_pending_commit().unwrap();
    gb.process_incoming_message(from_a.commit_message).unwrap();

    // B's is now stale and must be refused, not silently applied.
    assert!(
        ga.process_incoming_message(from_b.commit_message).is_err(),
        "a stale concurrent commit was accepted — state would have diverged"
    );
    assert_eq!(ga.current_epoch(), gb.current_epoch(), "epochs diverged after a commit race");

    // And the group still works.
    let msg = ga.encrypt_application_message(b"still fine", Default::default()).unwrap();
    assert_eq!(body(gb.process_incoming_message(msg).unwrap()), b"still fine");
}

#[test]
fn a_device_that_was_offline_catches_up_across_several_epochs() {
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let c0 = ga.commit_builder().add_member(kp).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &c0.welcome_messages[0], None).unwrap();

    // B goes offline; A advances the group five times, queueing the commits.
    let mut queued = Vec::new();
    for _ in 0..5 {
        let c = ga.commit_builder().build().unwrap();
        ga.apply_pending_commit().unwrap();
        queued.push(c.commit_message);
    }
    let missed = ga.encrypt_application_message(b"while you were out", Default::default()).unwrap();

    // B comes back and replays in order.
    for c in queued {
        gb.process_incoming_message(c).unwrap();
    }
    assert_eq!(ga.current_epoch(), gb.current_epoch(), "catch-up did not converge");
    assert_eq!(body(gb.process_incoming_message(missed).unwrap()), b"while you were out");
}

#[test]
fn commits_applied_out_of_order_are_refused() {
    // The sync engine must deliver commits in order. If it doesn't, MLS should
    // refuse rather than half-apply.
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let c0 = ga.commit_builder().add_member(kp).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &c0.welcome_messages[0], None).unwrap();

    // The first commit is deliberately withheld to simulate a lost/reordered
    // delivery — the sync engine's ordering guarantee failing.
    let _withheld = ga.commit_builder().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let second = ga.commit_builder().build().unwrap();
    ga.apply_pending_commit().unwrap();

    // Deliver the second before the first.
    assert!(
        gb.process_incoming_message(second.commit_message).is_err(),
        "an out-of-order commit was applied"
    );
}

#[test]
fn a_late_joiner_cannot_read_what_came_before() {
    // Forward secrecy at the join boundary — this is the mechanism behind the
    // room setting "new members can read past messages" (docs/18).
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let late = device(&acct, "late");

    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let c0 = ga.commit_builder().add_member(kp).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &c0.welcome_messages[0], None).unwrap();

    let before = ga.encrypt_application_message(b"said before they joined", Default::default()).unwrap();
    assert_eq!(body(gb.process_incoming_message(before.clone()).unwrap()), b"said before they joined");

    let kp_l = late.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let c1 = ga.commit_builder().add_member(kp_l).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    gb.process_incoming_message(c1.commit_message).unwrap();
    let (mut gl, _) = late.join_group(None, &c1.welcome_messages[0], None).unwrap();

    assert!(
        gl.process_incoming_message(before).is_err(),
        "a late joiner read a message sent before they arrived"
    );

    let after = ga.encrypt_application_message(b"said after", Default::default()).unwrap();
    assert_eq!(body(gl.process_incoming_message(after).unwrap()), b"said after");
}

#[test]
fn many_epochs_in_sequence_stay_converged() {
    // A soak test: 40 epochs with traffic between each. Drift shows up here.
    let acct = account();
    let a = device(&acct, "a");
    let b = device(&acct, "b");
    let mut ga = a.create_group(ExtensionList::default(), Default::default(), None).unwrap();
    let kp = b.generate_key_package_message(Default::default(), Default::default(), None).unwrap();
    let c0 = ga.commit_builder().add_member(kp).unwrap().build().unwrap();
    ga.apply_pending_commit().unwrap();
    let (mut gb, _) = b.join_group(None, &c0.welcome_messages[0], None).unwrap();

    for i in 0..40u32 {
        let (sender, receiver) = if i % 2 == 0 { (&mut ga, &mut gb) } else { (&mut gb, &mut ga) };
        let payload = format!("message {i}");
        let msg = sender.encrypt_application_message(payload.as_bytes(), Default::default()).unwrap();
        assert_eq!(body(receiver.process_incoming_message(msg).unwrap()), payload.as_bytes());

        let commit = sender.commit_builder().build().unwrap();
        sender.apply_pending_commit().unwrap();
        receiver.process_incoming_message(commit.commit_message).unwrap();
        assert_eq!(ga.current_epoch(), gb.current_epoch(), "diverged at iteration {i}");
    }
}
