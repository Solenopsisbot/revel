//! The account key and its three wraps.
//!
//! The properties here are the ones a person's account depends on, so they are
//! tested as properties rather than as "the function returns something":
//!
//! - Any wrap opens the *same* account key. Three keys would be three accounts.
//! - A wrong key fails, and fails identically to tampered bytes.
//! - Changing your password re-wraps one blob and leaves the others working.
//! - A recovery code survives being copied off paper by a human.

use revel_crypto::envelope::{
    account_public, generate_account_key, generate_recovery_code, generate_salt,
    kek_from_export_key, normalise_recovery_code, recovery_key, unwrap_account_key,
    wrap_account_key, EnvelopeError,
};

/// A stand-in for a WebAuthn PRF output — 32 bytes from somewhere.
fn prf(byte: u8) -> [u8; 32] {
    [byte; 32]
}

#[test]
fn every_wrap_opens_the_same_account_key() {
    // The whole point of the envelope: one key, three doors. If these differed
    // the account would silently become three accounts, and only the one you
    // last signed in with would own your history.
    let account = generate_account_key();
    let salt = generate_salt();
    let code = generate_recovery_code();

    let kek = kek_from_export_key(b"an opaque export key");
    let rk = recovery_key(&code, &salt).unwrap();
    let pk = prf(7);

    let by_password = wrap_account_key(&account, &kek).unwrap();
    let by_code = wrap_account_key(&account, &rk).unwrap();
    let by_passkey = wrap_account_key(&account, &pk).unwrap();

    assert_eq!(*unwrap_account_key(&by_password, &kek).unwrap(), *account);
    assert_eq!(*unwrap_account_key(&by_code, &rk).unwrap(), *account);
    assert_eq!(*unwrap_account_key(&by_passkey, &pk).unwrap(), *account);

    // And therefore one identity, whichever door was used.
    let identity = account_public(&account);
    assert_eq!(account_public(&unwrap_account_key(&by_code, &rk).unwrap()), identity);
}

#[test]
fn a_wrong_key_fails_the_same_way_tampering_does() {
    // Distinguishing them would tell an attacker which half they got right.
    let account = generate_account_key();
    let kek = kek_from_export_key(b"right");
    let wrong = kek_from_export_key(b"wrong");

    let mut wrap = wrap_account_key(&account, &kek).unwrap();
    assert_eq!(unwrap_account_key(&wrap, &wrong), Err(EnvelopeError::NotOurs));

    let last = wrap.len() - 1;
    wrap[last] ^= 0xff;
    assert_eq!(unwrap_account_key(&wrap, &kek), Err(EnvelopeError::NotOurs));
}

#[test]
fn changing_the_password_rewraps_one_blob_and_leaves_the_rest() {
    // `docs/03` §1: "Password change = re-wrap one blob." The test is that the
    // other two still open afterwards — a change that quietly invalidated the
    // recovery code would turn a routine action into an account loss.
    let account = generate_account_key();
    let salt = generate_salt();
    let code = generate_recovery_code();
    let rk = recovery_key(&code, &salt).unwrap();

    let old_kek = kek_from_export_key(b"export key from the old password");
    let by_code = wrap_account_key(&account, &rk).unwrap();
    let _by_old = wrap_account_key(&account, &old_kek).unwrap();

    // New password → new OPAQUE registration → new export key → new KEK.
    let new_kek = kek_from_export_key(b"export key from the new password");
    let by_new = wrap_account_key(&unwrap_account_key(&by_code, &rk).unwrap(), &new_kek).unwrap();

    assert_eq!(*unwrap_account_key(&by_new, &new_kek).unwrap(), *account);
    assert_eq!(*unwrap_account_key(&by_code, &rk).unwrap(), *account);
    // The old one no longer opens under the new key, which is the point.
    assert_eq!(unwrap_account_key(&by_new, &old_kek), Err(EnvelopeError::NotOurs));
}

#[test]
fn a_wrap_is_never_the_same_twice() {
    // A fresh nonce per wrap. Identical ciphertext for identical input would
    // leak that two accounts share a password, and that a password change was
    // a change back to an old one.
    let account = generate_account_key();
    let kek = kek_from_export_key(b"same key");
    let a = wrap_account_key(&account, &kek).unwrap();
    let b = wrap_account_key(&account, &kek).unwrap();
    assert_ne!(a, b);
    assert_eq!(*unwrap_account_key(&a, &kek).unwrap(), *unwrap_account_key(&b, &kek).unwrap());
}

#[test]
fn a_truncated_wrap_is_malformed_rather_than_a_panic() {
    let kek = kek_from_export_key(b"k");
    for len in 0..12 {
        assert_eq!(unwrap_account_key(&vec![0u8; len], &kek), Err(EnvelopeError::Malformed));
    }
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

#[test]
fn a_recovery_code_survives_being_copied_off_paper() {
    // This is the flow that only ever runs when everything else has already
    // gone wrong, so it has to tolerate a person: lowercase, missing dashes,
    // and the four characters everybody mistypes.
    let code = generate_recovery_code();
    let canonical = normalise_recovery_code(&code).unwrap();

    let lowered = code.to_lowercase();
    let no_dashes = code.replace('-', "");
    let spaced = code.replace('-', " ");

    for variant in [lowered, no_dashes, spaced] {
        assert_eq!(normalise_recovery_code(&variant).unwrap(), canonical);
    }
}

#[test]
fn the_four_ambiguous_letters_are_folded() {
    // Somebody reading off paper types `O` for zero and `l` for one. Refusing
    // that is refusing the one flow that exists because everything else failed.
    assert_eq!(normalise_recovery_code("O1234-56789-01234-56789-01234-5").unwrap(),
               normalise_recovery_code("01234-56789-01234-56789-01234-5").unwrap());
    assert_eq!(normalise_recovery_code("I1234-56789-01234-56789-01234-5").unwrap(),
               normalise_recovery_code("11234-56789-01234-56789-01234-5").unwrap());
    assert_eq!(normalise_recovery_code("L1234-56789-01234-56789-01234-5").unwrap(),
               normalise_recovery_code("11234-56789-01234-56789-01234-5").unwrap());
    assert_eq!(normalise_recovery_code("U1234-56789-01234-56789-01234-5").unwrap(),
               normalise_recovery_code("V1234-56789-01234-56789-01234-5").unwrap());
}

#[test]
fn a_code_of_the_wrong_length_is_rejected() {
    // Better than deriving a key from it and reporting "wrong recovery code"
    // after eight seconds of Argon2id.
    assert_eq!(normalise_recovery_code("TOOSHORT"), Err(EnvelopeError::BadRecoveryCode));
    assert_eq!(normalise_recovery_code(""), Err(EnvelopeError::BadRecoveryCode));
    let long = "0".repeat(27);
    assert_eq!(normalise_recovery_code(&long), Err(EnvelopeError::BadRecoveryCode));
}

#[test]
fn a_code_with_characters_that_are_not_in_the_alphabet_is_rejected() {
    assert_eq!(
        normalise_recovery_code("!1234-56789-01234-56789-01234-5"),
        Err(EnvelopeError::BadRecoveryCode)
    );
}

#[test]
fn codes_are_not_repeated() {
    // Not a serious statistical test — just the one that catches a constant.
    let a = generate_recovery_code();
    let b = generate_recovery_code();
    assert_ne!(*a, *b);
    assert_eq!(normalise_recovery_code(&a).unwrap().len(), 26);
}

#[test]
fn the_same_code_and_salt_give_the_same_key_and_a_different_salt_does_not() {
    // The salt's job: one precomputed table must not cover every account.
    let code = generate_recovery_code();
    let salt = generate_salt();
    let other = generate_salt();

    assert_eq!(*recovery_key(&code, &salt).unwrap(), *recovery_key(&code, &salt).unwrap());
    assert_ne!(*recovery_key(&code, &salt).unwrap(), *recovery_key(&code, &other).unwrap());
}

#[test]
fn a_recovery_key_is_derived_from_the_normalised_form() {
    // Otherwise a code typed in lowercase would derive a different key and the
    // recovery flow would fail for exactly the people who needed it.
    let code = generate_recovery_code();
    let salt = generate_salt();
    assert_eq!(
        *recovery_key(&code, &salt).unwrap(),
        *recovery_key(&code.to_lowercase(), &salt).unwrap()
    );
}
