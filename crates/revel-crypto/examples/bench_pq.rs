//! Is post-quantum realistic? (`docs/03-identity-and-crypto.md` §12, still open)
//!
//! Compares the classical suite against ML-KEM-768 + X25519 — the X-Wing-style
//! hybrid, which is the only sensible PQ choice here: it stays secure if EITHER
//! primitive holds, so adopting it is not a bet on lattices.
//!
//! The decision is cheap now and expensive later: a ciphersuite is fixed per
//! MLS group, so switching afterwards means new groups, not an upgrade
//! (`docs/29` §1).
//!
//! Run: cargo run --release -p revel-crypto --features pq --example bench_pq

use std::time::Instant;

use mls_rs::{
    client_builder::MlsConfig,
    group::mls_rules::{CommitOptions, DefaultMlsRules},
    identity::basic::BasicCredential,
    identity::SigningIdentity,
    CipherSuite, CipherSuiteProvider, Client, CryptoProvider, ExtensionList, MlsMessage,
};
use mls_rs_crypto_awslc::AwsLcCryptoProvider;
use rand::rngs::OsRng;
use revel_crypto::{DeviceCert, DeviceCertIdentityProvider};

fn device(
    account: &ed25519_dalek::SigningKey,
    label: &str,
    cs_id: CipherSuite,
) -> Client<impl MlsConfig> {
    let crypto = AwsLcCryptoProvider::default();
    let cs = crypto.cipher_suite_provider(cs_id).unwrap();
    let (secret, public) = cs.signature_key_generate().unwrap();
    let cert = DeviceCert::issue(account, public.as_bytes(), label);
    let credential = BasicCredential::new(cert.encode()).into_credential();
    Client::builder()
        .identity_provider(DeviceCertIdentityProvider)
        .crypto_provider(crypto)
        .mls_rules(
            DefaultMlsRules::new()
                .with_commit_options(CommitOptions::new().with_ratchet_tree_extension(false)),
        )
        .signing_identity(SigningIdentity::new(credential, public), secret, cs_id)
        .build()
}

fn size_of(m: &MlsMessage) -> usize {
    m.to_bytes().map(|b| b.len()).unwrap_or(0)
}

fn run(name: &str, cs_id: CipherSuite, target: usize) {
    let account = ed25519_dalek::SigningKey::generate(&mut OsRng);
    let creator = device(&account, "creator", cs_id);
    let mut group = creator
        .create_group(ExtensionList::default(), Default::default(), None)
        .unwrap();

    let members: Vec<_> = (1..target)
        .map(|i| device(&account, &format!("d{i}"), cs_id))
        .collect();
    let kp_t = Instant::now();
    let kps: Vec<_> = members
        .iter()
        .map(|c| {
            c.generate_key_package_message(Default::default(), Default::default(), None)
                .unwrap()
        })
        .collect();
    let kp_ms = kp_t.elapsed().as_secs_f64() * 1000.0 / (target.max(2) - 1) as f64;
    let kp_bytes = kps.first().map(size_of).unwrap_or(0);

    let t = Instant::now();
    let mut b = group.commit_builder();
    for kp in kps {
        b = b.add_member(kp).unwrap();
    }
    let commit = b.build().unwrap();
    group.apply_pending_commit().unwrap();
    let build_ms = t.elapsed().as_secs_f64() * 1000.0;
    let welcome = commit.welcome_messages.first().map(size_of).unwrap_or(0);

    let joiner = device(&account, "joiner", cs_id);
    let kp = joiner
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();
    let t = Instant::now();
    let _ = group.commit_builder().add_member(kp).unwrap().build().unwrap();
    group.apply_pending_commit().unwrap();
    let add_ms = t.elapsed().as_secs_f64() * 1000.0;

    let t = Instant::now();
    for _ in 0..50 {
        let _ = group
            .encrypt_application_message(b"hello", Default::default())
            .unwrap();
    }
    let enc_us = t.elapsed().as_secs_f64() * 1_000_000.0 / 50.0;

    let tree_kib = group.export_tree().to_bytes().unwrap().len() as f64 / 1024.0;
    println!(
        "{:<22} {:>6} {:>10.0} ms {:>9.1} ms {:>11.1} KiB {:>11.1} KiB {:>9} B {:>8.0} us",
        name,
        group.roster().members().len(),
        build_ms,
        add_ms,
        welcome as f64 / 1024.0,
        tree_kib,
        kp_bytes,
        enc_us
    );
    let _ = kp_ms;
}

fn main() {
    println!(
        "{:<22} {:>6} {:>13} {:>12} {:>16} {:>16} {:>11} {:>11}",
        "suite", "leaves", "build", "1 add", "welcome", "tree(cached)", "keypkg", "encrypt"
    );
    println!("{}", "-".repeat(112));
    for n in [2usize, 50, 500] {
        run("classical x25519", CipherSuite::CURVE25519_AES128, n);
        run("PQ hybrid mlkem768", CipherSuite::ML_KEM_768_X25519, n);
        println!();
    }
}
