//! The spike that gates Phase 1 (`docs/06-roadmap.md`).
//!
//! Three questions Kith never answered, because it shared one key per account:
//!
//!   1. Can several devices of ONE account sit as separate leaves in one group?
//!   2. Does a device certificate bind a leaf to an account?
//!   3. Does removing a device actually cut it off — post-compromise security?
//!
//! If (3) failed, "sign out this device" would be a lie and the whole devices
//! design in `docs/17` would need rethinking.

use mls_rs::{
    client_builder::MlsConfig,
    identity::{basic::BasicCredential, SigningIdentity},
    group::ReceivedMessage,
    CipherSuite, CipherSuiteProvider, Client, CryptoProvider, ExtensionList,
};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use rand::rngs::OsRng;
use revel_crypto::{DeviceCert, DeviceCertIdentityProvider};

const CIPHERSUITE: CipherSuite = CipherSuite::CURVE25519_AES128;

/// One enrolled device: its own MLS signature key, carrying a certificate that
/// the account key signed.
fn device(
    account_key: &ed25519_dalek::SigningKey,
    label: &str,
) -> (Client<impl MlsConfig>, DeviceCert) {
    let crypto = RustCryptoProvider::default();
    let cs = crypto.cipher_suite_provider(CIPHERSUITE).unwrap();
    let (secret, public) = cs.signature_key_generate().unwrap();

    // The account signs THIS device's MLS signature key. That signature is what
    // makes the leaf attributable to a person rather than to a stranger.
    let cert = DeviceCert::issue(account_key, public.as_bytes(), label);

    let credential = BasicCredential::new(cert.encode()).into_credential();
    let signing_identity = SigningIdentity::new(credential, public);
    let client = Client::builder()
        .identity_provider(DeviceCertIdentityProvider)
        .crypto_provider(crypto)
        .signing_identity(signing_identity, secret, CIPHERSUITE)
        .build();
    (client, cert)
}

#[test]
fn several_devices_of_one_account_are_independent_leaves() {
    let viola = ed25519_dalek::SigningKey::generate(&mut OsRng);
    let ash = ed25519_dalek::SigningKey::generate(&mut OsRng);

    let (laptop, laptop_cert) = device(&viola, "laptop");
    let (phone, phone_cert) = device(&viola, "phone");
    let (ash_laptop, ash_cert) = device(&ash, "ash-laptop");

    // Same account, genuinely different device keys.
    assert_eq!(laptop_cert.account_pub, phone_cert.account_pub);
    assert_ne!(laptop_cert.device_pub, phone_cert.device_pub);
    assert_ne!(laptop_cert.account_pub, ash_cert.account_pub);

    // Every certificate verifies against the account that issued it. This is
    // the check a committer runs before admitting a leaf.
    for c in [&laptop_cert, &phone_cert, &ash_cert] {
        assert_eq!(c.verify(), Ok(()), "certificate should verify");
    }

    let mut group = laptop
        .create_group(ExtensionList::default(), Default::default(), None)
        .unwrap();

    let phone_kp = phone
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();
    let ash_kp = ash_laptop
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();

    let commit = group
        .commit_builder()
        .add_member(phone_kp)
        .unwrap()
        .add_member(ash_kp)
        .unwrap()
        .build()
        .unwrap();
    group.apply_pending_commit().unwrap();

    // Three leaves: two of them the same person's.
    assert_eq!(group.roster().members().len(), 3);

    let (mut phone_group, _) = phone.join_group(None, &commit.welcome_messages[0], None).unwrap();
    let (mut ash_group, _) = ash_laptop
        .join_group(None, &commit.welcome_messages[0], None)
        .unwrap();

    // The laptop speaks; the phone and Ash both read it.
    let msg = group
        .encrypt_application_message(b"the buttons need to feel pressable", Default::default())
        .unwrap();
    for g in [&mut phone_group, &mut ash_group] {
        match g.process_incoming_message(msg.clone()).unwrap() {
            ReceivedMessage::ApplicationMessage(m) => {
                assert_eq!(m.data(), b"the buttons need to feel pressable");
            }
            other => panic!("expected an application message, got {other:?}"),
        }
    }
}

#[test]
fn revoking_a_device_cuts_it_off_from_the_next_epoch() {
    let viola = ed25519_dalek::SigningKey::generate(&mut OsRng);
    let ash = ed25519_dalek::SigningKey::generate(&mut OsRng);

    let (laptop, _) = device(&viola, "laptop");
    let (phone, _) = device(&viola, "phone");
    let (ash_laptop, _) = device(&ash, "ash-laptop");

    let mut group = laptop
        .create_group(ExtensionList::default(), Default::default(), None)
        .unwrap();
    let phone_kp = phone
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();
    let ash_kp = ash_laptop
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();

    let commit = group
        .commit_builder()
        .add_member(phone_kp)
        .unwrap()
        .add_member(ash_kp)
        .unwrap()
        .build()
        .unwrap();
    group.apply_pending_commit().unwrap();
    let (mut phone_group, _) = phone.join_group(None, &commit.welcome_messages[0], None).unwrap();
    let (mut ash_group, _) = ash_laptop
        .join_group(None, &commit.welcome_messages[0], None)
        .unwrap();

    // The phone can read while it is a member.
    let before = group
        .encrypt_application_message(b"before revocation", Default::default())
        .unwrap();
    assert!(phone_group.process_incoming_message(before).is_ok());

    // Viola loses the phone and signs it out from the laptop.
    let phone_leaf = group
        .roster()
        .members()
        .iter()
        .find(|m| {
            DeviceCert::decode(&m.signing_identity.credential.as_basic().unwrap().identifier)
                .map(|c| c.label == "phone")
                .unwrap_or(false)
        })
        .expect("phone should be in the roster")
        .index;

    let removal = group
        .commit_builder()
        .remove_member(phone_leaf)
        .unwrap()
        .build()
        .unwrap();
    group.apply_pending_commit().unwrap();
    ash_group.process_incoming_message(removal.commit_message.clone()).unwrap();

    assert_eq!(group.roster().members().len(), 2, "phone should be gone");

    // The revoked phone applies the commit that removed it, then a message
    // from the new epoch arrives.
    let _ = phone_group.process_incoming_message(removal.commit_message);
    let after = group
        .encrypt_application_message(b"after revocation", Default::default())
        .unwrap();

    // Ash, still a member, reads it.
    assert!(
        ash_group.process_incoming_message(after.clone()).is_ok(),
        "a remaining member should still read the room"
    );

    // The phone must not. This is the whole promise behind "sign out".
    assert!(
        phone_group.process_incoming_message(after).is_err(),
        "POST-COMPROMISE SECURITY FAILURE: a revoked device could still read"
    );
}

/// The point of the custom identity provider: a device whose certificate wasn't
/// signed by the account it claims cannot get into the group at all. Before
/// this, verification depended on the caller remembering to check.
#[test]
fn a_leaf_with_a_forged_certificate_is_refused_by_the_protocol() {
    let viola = ed25519_dalek::SigningKey::generate(&mut OsRng);
    let attacker = ed25519_dalek::SigningKey::generate(&mut OsRng);

    let (laptop, _) = device(&viola, "laptop");

    // The attacker builds a leaf claiming to be Viola's account, but signs the
    // certificate with their own key — which is all they have.
    let crypto = RustCryptoProvider::default();
    let cs = crypto.cipher_suite_provider(CIPHERSUITE).unwrap();
    let (secret, public) = cs.signature_key_generate().unwrap();
    let mut forged = DeviceCert::issue(&attacker, public.as_bytes(), "totally-viola");
    forged.account_pub = viola.verifying_key().to_bytes(); // claim to be her

    let credential = BasicCredential::new(forged.encode()).into_credential();
    let impostor = Client::builder()
        .identity_provider(DeviceCertIdentityProvider)
        .crypto_provider(crypto)
        .signing_identity(SigningIdentity::new(credential, public), secret, CIPHERSUITE)
        .build();

    let mut group = laptop
        .create_group(ExtensionList::default(), Default::default(), None)
        .unwrap();

    // The impostor can't even produce a key package the group would accept.
    let kp = impostor.generate_key_package_message(Default::default(), Default::default(), None);
    let admitted = match kp {
        Err(_) => false,
        Ok(kp) => group
            .commit_builder()
            .add_member(kp)
            .and_then(|b| b.build())
            .is_ok(),
    };
    assert!(!admitted, "IDENTITY FAILURE: a forged device certificate was admitted");
}
