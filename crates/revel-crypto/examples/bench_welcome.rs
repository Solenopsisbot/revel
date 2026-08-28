//! Does serving the ratchet tree out of band actually shrink the Welcome?
//!
//! `docs/03-identity-and-crypto.md` §5 says the Host serves the tree separately
//! "so Welcomes stay small". mls-rs defaults `ratchet_tree_extension` to TRUE,
//! i.e. the tree is inlined in every Welcome — so the first benchmark measured
//! the configuration our own design rejects. This measures both.
//!
//! The tree is public and identical for every joiner, so serving it out of band
//! also makes it cacheable, which an inlined copy can never be.
//!
//! Run: cargo run --release -p revel-crypto --example bench_welcome

use mls_rs::{
    client_builder::MlsConfig,
    group::mls_rules::{CommitOptions, DefaultMlsRules},
    identity::basic::BasicCredential,
    identity::SigningIdentity,
    CipherSuite, CipherSuiteProvider, Client, CryptoProvider, ExtensionList, MlsMessage,
};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use rand::rngs::OsRng;
use revel_crypto::{DeviceCert, DeviceCertIdentityProvider};

const CS: CipherSuite = CipherSuite::CURVE25519_AES128;

fn device(
    account: &ed25519_dalek::SigningKey,
    label: &str,
    inline_tree: bool,
) -> Client<impl MlsConfig> {
    let crypto = RustCryptoProvider::default();
    let cs = crypto.cipher_suite_provider(CS).unwrap();
    let (secret, public) = cs.signature_key_generate().unwrap();
    let cert = DeviceCert::issue(account, public.as_bytes(), label);
    let credential = BasicCredential::new(cert.encode()).into_credential();
    Client::builder()
        .identity_provider(DeviceCertIdentityProvider)
        .crypto_provider(crypto)
        .mls_rules(
            DefaultMlsRules::new()
                .with_commit_options(CommitOptions::new().with_ratchet_tree_extension(inline_tree)),
        )
        .signing_identity(SigningIdentity::new(credential, public), secret, CS)
        .build()
}

fn size_of(m: &MlsMessage) -> usize {
    m.to_bytes().map(|b| b.len()).unwrap_or(0)
}

fn measure(target: usize, inline_tree: bool) -> (f64, f64) {
    let account = ed25519_dalek::SigningKey::generate(&mut OsRng);
    let creator = device(&account, "creator", inline_tree);
    let mut group = creator
        .create_group(ExtensionList::default(), Default::default(), None)
        .unwrap();

    let members: Vec<_> = (1..target)
        .map(|i| device(&account, &format!("d{i}"), inline_tree))
        .collect();
    let mut b = group.commit_builder();
    for m in &members {
        b = b
            .add_member(
                m.generate_key_package_message(Default::default(), Default::default(), None)
                    .unwrap(),
            )
            .unwrap();
    }
    let commit = b.build().unwrap();
    group.apply_pending_commit().unwrap();

    let welcome_kib = commit
        .welcome_messages
        .first()
        .map(size_of)
        .unwrap_or(0) as f64
        / 1024.0;

    // What a joiner must fetch separately when the tree isn't inlined. Public,
    // identical for everyone, and therefore cacheable and CDN-able.
    let tree_kib = group.export_tree().to_bytes().unwrap().len() as f64 / 1024.0;

    (welcome_kib, tree_kib)
}

fn main() {
    println!(
        "{:>7}  {:>16}  {:>16}  {:>14}  {:>10}",
        "leaves", "welcome (inline)", "welcome (out-of-band)", "tree (cacheable)", "saving"
    );
    println!("{}", "-".repeat(80));
    for n in [50usize, 500, 2000] {
        let (inline, _) = measure(n, true);
        let (oob, tree) = measure(n, false);
        println!(
            "{:>7}  {:>13.1} KiB  {:>13.1} KiB  {:>11.1} KiB  {:>9.0}x",
            n,
            inline,
            oob,
            tree,
            inline / oob.max(0.001)
        );
    }
}
