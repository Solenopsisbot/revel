//! Handing an account key to a device you are holding.
//!
//! The properties are the ones the flow's safety rests on: only the intended
//! device can open it, a swapped QR is visible as a fingerprint mismatch, and a
//! failure is a failure rather than a wrong answer.

use revel_crypto::transfer::{
    fingerprint, generate_transfer_key, open_with, seal_to, transfer_public, TransferError,
};

#[test]
fn the_new_device_can_open_what_was_sealed_to_it() {
    let (secret, public) = generate_transfer_key();
    let account_key = [7u8; 32];

    let sealed = seal_to(&public, &account_key);
    assert_eq!(open_with(&secret, &sealed).unwrap().as_slice(), &account_key);
}

#[test]
fn nobody_else_can() {
    // The whole point: this travels through the IdP, which must not be able to
    // read it — and neither must any other device that happens to be listening.
    let (_, public) = generate_transfer_key();
    let (eavesdropper, _) = generate_transfer_key();

    let sealed = seal_to(&public, b"the account key");
    assert_eq!(open_with(&eavesdropper, &sealed), Err(TransferError::NotOurs));
}

#[test]
fn a_tampered_seal_fails_rather_than_returning_something_else() {
    let (secret, public) = generate_transfer_key();
    let mut sealed = seal_to(&public, b"the account key");

    let last = sealed.len() - 1;
    sealed[last] ^= 0xff;
    assert_eq!(open_with(&secret, &sealed), Err(TransferError::NotOurs));
}

#[test]
fn swapping_the_ephemeral_key_does_not_help() {
    // Both public keys go into the KDF, so a shared secret is bound to the pair
    // it came from — a seal cannot be re-pointed at a different recipient.
    let (secret, public) = generate_transfer_key();
    let (_, other) = generate_transfer_key();

    let mut sealed = seal_to(&public, b"the account key");
    sealed[..32].copy_from_slice(&other);
    assert_eq!(open_with(&secret, &sealed), Err(TransferError::NotOurs));
}

#[test]
fn two_seals_to_one_device_share_nothing() {
    // A fresh ephemeral key per seal. Identical ciphertext would mean two
    // handoffs of the same key were linkable by anybody watching the channel.
    let (secret, public) = generate_transfer_key();
    let a = seal_to(&public, b"same payload");
    let b = seal_to(&public, b"same payload");

    assert_ne!(a, b);
    assert_eq!(open_with(&secret, &a).unwrap(), open_with(&secret, &b).unwrap());
}

#[test]
fn a_truncated_seal_is_malformed_rather_than_a_panic() {
    let (secret, _) = generate_transfer_key();
    for len in 0..44 {
        assert_eq!(open_with(&secret, &vec![0u8; len]), Err(TransferError::Malformed));
    }
}

#[test]
fn the_public_key_can_be_recomputed_from_the_secret() {
    // The new device shows a QR, then waits — possibly across a reload. It has
    // to be able to get back to the same public key from what it kept.
    let (secret, public) = generate_transfer_key();
    assert_eq!(transfer_public(&secret), public);
}

#[test]
fn the_fingerprint_is_comparable_by_a_person() {
    // Shown on both screens so a swapped QR is something somebody can see. Six
    // groups of four digits — short enough to actually compare, and no `0`/`O`
    // problem because there are no letters in it.
    let (_, public) = generate_transfer_key();
    let print = fingerprint(&public);

    assert_eq!(print.len(), 29);
    assert_eq!(print.split(' ').count(), 6);
    assert!(print.chars().all(|c| c.is_ascii_digit() || c == ' '));
    // Stable, or the two screens would disagree.
    assert_eq!(fingerprint(&public), print);
}

#[test]
fn different_keys_have_different_fingerprints() {
    let (_, a) = generate_transfer_key();
    let (_, b) = generate_transfer_key();
    assert_ne!(fingerprint(&a), fingerprint(&b));
}
