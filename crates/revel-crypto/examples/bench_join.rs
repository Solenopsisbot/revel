//! What does ONE person joining a room of N actually download?
//!
//! Earlier benchmarks batch-added everyone at once, so the Welcome carried
//! secrets for every new member — realistic for a migration, not for the normal
//! case of a single person joining an existing room. This measures the normal
//! case, with the ratchet tree served out of band per `docs/03` §5.
//!
//! Run: cargo run --release -p revel-crypto --features pq --example bench_join

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

fn one_join(name: &str, cs_id: CipherSuite, target: usize) {
    let account = ed25519_dalek::SigningKey::generate(&mut OsRng);
    let creator = device(&account, "creator", cs_id);
    let mut group = creator
        .create_group(ExtensionList::default(), Default::default(), None)
        .unwrap();

    // Build the room first — this cost is not what a joiner pays.
    let members: Vec<_> = (1..target)
        .map(|i| device(&account, &format!("d{i}"), cs_id))
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
    let _ = b.build().unwrap();
    group.apply_pending_commit().unwrap();

    // Now ONE new person joins.
    let joiner = device(&account, "the-joiner", cs_id);
    let kp = joiner
        .generate_key_package_message(Default::default(), Default::default(), None)
        .unwrap();
    let commit = group.commit_builder().add_member(kp).unwrap().build().unwrap();
    group.apply_pending_commit().unwrap();

    let welcome_kib = commit.welcome_messages.first().map(size_of).unwrap_or(0) as f64 / 1024.0;
    let tree_kib = group.export_tree().to_bytes().unwrap().len() as f64 / 1024.0;

    println!(
        "{:<22} {:>7} {:>14.1} KiB {:>15.1} KiB {:>14.1} KiB",
        name,
        group.roster().members().len(),
        welcome_kib,
        tree_kib,
        welcome_kib + tree_kib
    );
}

fn main() {
    println!("What a single joiner downloads (ratchet tree served out of band)\n");
    println!(
        "{:<22} {:>7} {:>18} {:>19} {:>18}",
        "suite", "leaves", "welcome", "tree (cacheable)", "total first join"
    );
    println!("{}", "-".repeat(90));
    for n in [50usize, 500, 2000] {
        one_join("classical x25519", CipherSuite::CURVE25519_AES128, n);
        one_join("PQ hybrid mlkem768", CipherSuite::ML_KEM_768_X25519, n);
        println!();
    }
}
