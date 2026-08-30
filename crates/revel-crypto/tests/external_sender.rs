//! The Host as an MLS external sender (`docs/03` §5).
//!
//! > The Host is configured in every group as an **MLS external sender**. On
//! > any audience change (join, leave, kick, ban, role change, device
//! > enrol/revoke, override change) it appends **external Add/Remove
//! > proposals** to the group's handshake log. **It can propose; it cannot
//! > Commit or forge a roster** — every client validates that the tree only
//! > ever changes through proposals it saw and Commits signed by a member.
//!
//! Two claims in there, and both are load-bearing. The first is a capability:
//! a proposal signed by the Host has to be *accepted* by members. The second is
//! a limit: the Host must not be able to move the group on its own.
//!
//! This proves both. The extension is set at group creation and cannot be added
//! later without a commit, so getting it right now is the difference between
//! free and one commit per group forever.

use mls_rs::{
    client_builder::MlsConfig as ClientConfig,
    external_client::{
        builder::{ExternalClientBuilder, MlsConfig as HostConfig},
        ExternalClient,
    },
    extension::built_in::ExternalSendersExt,
    group::ReceivedMessage,
    identity::{basic::BasicCredential, SigningIdentity},
    CipherSuite, CipherSuiteProvider, Client, CryptoProvider, ExtensionList,
};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use rand::rngs::OsRng;
use revel_crypto::{DeviceCert, DeviceCertIdentityProvider};

const CS: CipherSuite = CipherSuite::CURVE25519_AES128;

fn account() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::generate(&mut OsRng)
}

/// A device, and the signing identity its certificate carries.
fn device(
    account_key: &ed25519_dalek::SigningKey,
    label: &str,
) -> (Client<impl ClientConfig>, SigningIdentity) {
    let crypto = RustCryptoProvider::default();
    let cs = crypto.cipher_suite_provider(CS).unwrap();
    let (secret, public) = cs.signature_key_generate().unwrap();
    let cert = DeviceCert::issue(account_key, public.as_bytes(), label);
    let identity =
        SigningIdentity::new(BasicCredential::new(cert.encode()).into_credential(), public);

    let client = Client::builder()
        .identity_provider(DeviceCertIdentityProvider)
        .crypto_provider(crypto)
        .signing_identity(identity.clone(), secret, CS)
        .build();
    (client, identity)
}

/// The Host, which is a device like any other as far as the protocol cares.
///
/// It presents a device certificate signed by its own account key, which is
/// what `DeviceCertIdentityProvider::validate_external_sender` already checks.
/// Members can therefore see exactly which key may propose, and who vouched for
/// it, using the machinery they already trust for leaves.
fn host() -> (ExternalClient<impl HostConfig>, SigningIdentity) {
    let crypto = RustCryptoProvider::default();
    let cs = crypto.cipher_suite_provider(CS).unwrap();
    let (secret, public) = cs.signature_key_generate().unwrap();
    let cert = DeviceCert::issue(&account(), public.as_bytes(), "host");
    let identity =
        SigningIdentity::new(BasicCredential::new(cert.encode()).into_credential(), public);

    let client = ExternalClientBuilder::new()
        .identity_provider(DeviceCertIdentityProvider)
        .crypto_provider(crypto)
        .signer(secret, identity.clone())
        .build();
    (client, identity)
}

fn with_external_sender(identity: &SigningIdentity) -> ExtensionList {
    let mut extensions = ExtensionList::default();
    extensions
        .set_from(ExternalSendersExt::new(vec![identity.clone()]))
        .unwrap();
    extensions
}

#[test]
fn a_host_proposal_is_accepted_and_a_member_commits_it() {
    let viola = account();
    let ash = account();
    let (alice, _) = device(&viola, "laptop");
    let (bob, _) = device(&ash, "phone");
    let (server, server_identity) = host();

    // The extension goes in at creation. This is the whole reason the shape of
    // `createGroup` changed: adding it afterwards costs a commit per group.
    let mut group = alice
        .create_group(with_external_sender(&server_identity), Default::default(), None)
        .unwrap();

    // The Host watches the group the only way it can — from its public state.
    let info = group.group_info_message(true).unwrap();
    let mut watched = server.observe_group(info, None, None).unwrap();

    // It proposes that Bob be added. It has never held a group secret.
    let key_package = bob
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();
    let proposal = watched.propose_add(key_package, vec![]).unwrap();

    // A member accepts it, because the group context says this key may propose.
    let received = group.process_incoming_message(proposal).unwrap();
    assert!(
        matches!(received, ReceivedMessage::Proposal(_)),
        "a member refused a proposal from the configured external sender: {received:?}"
    );

    // And a *member* commits it. That is the division `docs/03` §5 draws.
    let commit = group.commit(vec![]).unwrap();
    group.apply_pending_commit().unwrap();
    assert_eq!(group.roster().members().len(), 2, "the proposal was not committed");

    // No out-of-band tree here: this test builds a plain client, which leaves
    // mls-rs's `ratchet_tree` extension on. The binding turns it off
    // (`wasm.rs::mls_rules`); this file is about the external sender and keeps
    // the default so the two concerns do not tangle.
    let (bobs, _) = bob
        .join_group(None, &commit.welcome_messages[0], None)
        .unwrap();
    assert_eq!(bobs.roster().members().len(), 2);
}

#[test]
fn a_group_without_the_extension_refuses_the_host_entirely() {
    // The retrofit cost, made visible. A group opened without the extension is
    // one no external sender can ever propose to until somebody commits a
    // `GroupContextExtensions` change — which is why `createGroup` sets it.
    let viola = account();
    let (alice, _) = device(&viola, "laptop");
    let (server, _) = host();

    let mut group = alice
        .create_group(ExtensionList::default(), Default::default(), None)
        .unwrap();
    let info = group.group_info_message(true).unwrap();
    let mut watched = server.observe_group(info, None, None).unwrap();

    let (bob, _) = device(&account(), "phone");
    let key_package = bob
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();

    assert!(
        watched.propose_add(key_package, vec![]).is_err(),
        "an external sender proposed into a group that never authorised one"
    );
    let _ = group.commit(vec![]);
}

#[test]
fn a_host_that_was_never_configured_cannot_propose_into_someone_else_s_group() {
    // The limit that matters. Being *an* external sender somewhere is not being
    // one here: the group context names a specific key, and a different Host —
    // or the same Host with a rotated key — is refused.
    let viola = account();
    let (alice, _) = device(&viola, "laptop");
    let (_authorised, authorised_identity) = host();
    let (impostor, _) = host();

    let mut group = alice
        .create_group(with_external_sender(&authorised_identity), Default::default(), None)
        .unwrap();
    let info = group.group_info_message(true).unwrap();
    let mut watched = impostor.observe_group(info, None, None).unwrap();

    let (bob, _) = device(&account(), "phone");
    let key_package = bob
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();

    assert!(
        watched.propose_add(key_package, vec![]).is_err(),
        "an unauthorised external sender produced a proposal"
    );
}

#[test]
fn the_host_can_propose_a_removal_too() {
    // The other half of "on any audience change": a ban or a revoked device is
    // a Remove, and it is the same path.
    let viola = account();
    let (alice, _) = device(&viola, "laptop");
    let (bob, _) = device(&account(), "phone");
    let (server, server_identity) = host();

    let mut group = alice
        .create_group(with_external_sender(&server_identity), Default::default(), None)
        .unwrap();
    let key_package = bob
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();
    group
        .commit_builder()
        .add_member(key_package)
        .unwrap()
        .build()
        .unwrap();
    group.apply_pending_commit().unwrap();
    assert_eq!(group.roster().members().len(), 2);

    let info = group.group_info_message(true).unwrap();
    let mut watched = server.observe_group(info, None, None).unwrap();

    let proposal = watched.propose_remove(1, vec![]).unwrap();

    group.process_incoming_message(proposal).unwrap();
    group.commit(vec![]).unwrap();
    group.apply_pending_commit().unwrap();
    assert_eq!(group.roster().members().len(), 1, "the removal was not committed");
}
