//! Group-scaling benchmark (`docs/06-roadmap.md` Phase 0).
//!
//! What we actually need to know:
//!   * how long a Commit takes as a group grows — the committer is a phone
//!     sometimes, and `docs/03` §5 makes the next sender flush pending proposals;
//!   * how big a Welcome is — `docs/03` §11 sets a ~2,000-leaf ceiling largely
//!     because of Welcome size and tree fan-out. That number was an estimate.
//!     This measures it.
//!
//! Run: cargo run --release -p revel-crypto --example bench

use std::time::Instant;

use mls_rs::{
    client_builder::MlsConfig, identity::basic::BasicCredential, identity::SigningIdentity,
    CipherSuite, CipherSuiteProvider, Client, CryptoProvider, ExtensionList, MlsMessage,
};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use rand::rngs::OsRng;
use revel_crypto::{DeviceCert, DeviceCertIdentityProvider};

const CIPHERSUITE: CipherSuite = CipherSuite::CURVE25519_AES128;

fn device(account: &ed25519_dalek::SigningKey, label: &str) -> Client<impl MlsConfig> {
    let crypto = RustCryptoProvider::default();
    let cs = crypto.cipher_suite_provider(CIPHERSUITE).unwrap();
    let (secret, public) = cs.signature_key_generate().unwrap();
    let cert = DeviceCert::issue(account, public.as_bytes(), label);
    let credential = BasicCredential::new(cert.encode()).into_credential();
    Client::builder()
        .identity_provider(DeviceCertIdentityProvider)
        .crypto_provider(crypto)
        .signing_identity(SigningIdentity::new(credential, public), secret, CIPHERSUITE)
        .build()
}

fn size_of(m: &MlsMessage) -> usize {
    m.to_bytes().map(|b| b.len()).unwrap_or(0)
}

fn main() {
    println!(
        "{:>7}  {:>12}  {:>12}  {:>13}  {:>12}  {:>11}",
        "leaves", "build", "1 add", "welcome", "1 remove", "encrypt"
    );
    println!("{}", "-".repeat(78));

    for target in [2usize, 50, 500, 2000] {
        let account = ed25519_dalek::SigningKey::generate(&mut OsRng);
        let creator = device(&account, "creator");
        let mut group = creator
            .create_group(ExtensionList::default(), Default::default(), None)
            .unwrap();

        // Fill to `target` leaves. Batched into one Commit — the pattern
        // docs/03 §5 specifies for mass changes.
        let members: Vec<_> = (1..target)
            .map(|i| device(&account, &format!("d{i}")))
            .collect();
        let kps: Vec<_> = members
            .iter()
            .map(|c| {
                c.generate_key_package_message(Default::default(), Default::default(), None)
                    .unwrap()
            })
            .collect();

        let t = Instant::now();
        let mut b = group.commit_builder();
        for kp in kps {
            b = b.add_member(kp).unwrap();
        }
        let commit = b.build().unwrap();
        group.apply_pending_commit().unwrap();
        let build_ms = t.elapsed().as_secs_f64() * 1000.0;
        let welcome = commit.welcome_messages.first().map(size_of).unwrap_or(0);

        // One further add, at size — the steady-state cost of someone joining.
        let joiner = device(&account, "joiner");
        let kp = joiner
            .generate_key_package_message(Default::default(), Default::default(), None)
            .unwrap();
        let t = Instant::now();
        let _ = group.commit_builder().add_member(kp).unwrap().build().unwrap();
        group.apply_pending_commit().unwrap();
        let add_ms = t.elapsed().as_secs_f64() * 1000.0;

        // One remove — this is what "sign out this device" and a kick cost.
        let victim = group.roster().members().last().unwrap().index;
        let t = Instant::now();
        let _ = group
            .commit_builder()
            .remove_member(victim)
            .unwrap()
            .build()
            .unwrap();
        group.apply_pending_commit().unwrap();
        let rm_ms = t.elapsed().as_secs_f64() * 1000.0;

        // Sending a message shouldn't care about group size; confirm it doesn't.
        let t = Instant::now();
        for _ in 0..50 {
            let _ = group
                .encrypt_application_message(b"the buttons need to feel pressable", Default::default())
                .unwrap();
        }
        let enc_us = t.elapsed().as_secs_f64() * 1_000_000.0 / 50.0;

        println!(
            "{:>7}  {:>10.0} ms  {:>10.1} ms  {:>10.1} KiB  {:>10.1} ms  {:>8.0} us",
            group.roster().members().len(),
            build_ms,
            add_ms,
            welcome as f64 / 1024.0,
            rm_ms,
            enc_us
        );
    }
}
