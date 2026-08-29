//! The web binding.
//!
//! `docs/26` §Option C picks the seam: Rust owns MLS, device keys and envelope
//! encryption; TypeScript owns the sync engine, the room reducer, the local
//! store, search and all UI. This module is that seam, from the web side —
//! `tests/wasm.rs` already proved the crypto *runs* under wasm, but nothing was
//! exported, so JavaScript could not call a line of it.
//!
//! ## Shape
//!
//! Three handles, held by the caller:
//!
//! - [`Account`] — the long-lived identity keypair. One per person.
//! - [`Device`] — one enrolled device of an account: an MLS client carrying a
//!   device certificate that account signed.
//! - [`Group`] — one MLS group. In Revel terms, one **audience** (`docs/03`
//!   §2): the set of devices that can read a particular room.
//!
//! Everything crossing the boundary is bytes or a plain value. No borrowed
//! slices are held across a call, and no JavaScript object is retained on the
//! Rust side — the FFI boundary is where bugs hide, and the way to keep it
//! honest is to make it boring.
//!
//! ## What this deliberately does not do yet
//!
//! **Group state is not persisted.** A [`Group`] lives in wasm memory and dies
//! with the page. Real clients must survive a reload, which means group state
//! has to cross this boundary and land in the TypeScript store — mls-rs has a
//! `GroupStateStorage` seam for exactly that. It is the next piece, and it is
//! deliberately absent rather than half-built, because a persistence layer that
//! *looks* like it works is worse than one that is obviously missing.

use core::fmt::Display;

use ed25519_dalek::SigningKey;
use mls_rs::{
    client_builder::{BaseConfig, WithCryptoProvider, WithIdentityProvider},
    group::ReceivedMessage,
    identity::{basic::BasicCredential, SigningIdentity},
    CipherSuite, CipherSuiteProvider, Client as MlsClient, CryptoProvider, ExtensionList,
    MlsMessage,
};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use wasm_bindgen::prelude::*;

use crate::{device::DeviceCert, identity::DeviceCertIdentityProvider};

/// The suite `docs/03` §1 settles on. Post-quantum is a separate build
/// (`--features pq`) and a separate measurement; see `docs/31` §4.
const CS: CipherSuite = CipherSuite::CURVE25519_AES128;

/// The concrete client configuration.
///
/// The tests can say `Client<impl MlsConfig>` because they never store one. A
/// struct field needs a real type, so the builder's aliases are spelled out
/// here in the order the builder applies them.
type Config = WithCryptoProvider<
    RustCryptoProvider,
    WithIdentityProvider<DeviceCertIdentityProvider, BaseConfig>,
>;

/// Every error crossing into JavaScript becomes a plain `Error` with a message.
///
/// Deliberately lossy: mls-rs error enums are an implementation detail, and a
/// caller that branches on them is a caller coupled to the MLS library we
/// promised ourselves we could swap (`docs/03` §12).
fn js(e: impl Display) -> JsError {
    JsError::new(&e.to_string())
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/// An account keypair — the stable, public identity behind every device.
///
/// This is the key that signs device certificates, and the one thing a person
/// genuinely cannot lose (`docs/08`: the recovery code exists to protect it).
#[wasm_bindgen]
pub struct Account {
    key: SigningKey,
}

#[wasm_bindgen]
impl Account {
    /// Generate a fresh account.
    ///
    /// Entropy on wasm has no OS underneath; the `getrandom` js backend is
    /// wired up in `.cargo/config.toml`, and `tests/wasm.rs` asserts two
    /// generated keys actually differ rather than trusting it.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Account {
        Account {
            key: SigningKey::generate(&mut rand::rngs::OsRng),
        }
    }

    /// Restore an account from its 32-byte secret.
    #[wasm_bindgen(js_name = fromSecret)]
    pub fn from_secret(secret: &[u8]) -> Result<Account, JsError> {
        let bytes: [u8; 32] = secret
            .try_into()
            .map_err(|_| JsError::new("an account secret is 32 bytes"))?;
        Ok(Account {
            key: SigningKey::from_bytes(&bytes),
        })
    }

    /// The public half — the account id everyone else sees.
    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> Vec<u8> {
        self.key.verifying_key().to_bytes().to_vec()
    }

    /// The secret half, for the caller to store. Leaving the boundary once, on
    /// request, beats a design where the only copy lives in wasm memory and
    /// vanishes on reload.
    #[wasm_bindgen(getter, js_name = secretKey)]
    pub fn secret_key(&self) -> Vec<u8> {
        self.key.to_bytes().to_vec()
    }
}

impl Default for Account {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

/// One enrolled device: its own MLS signature key, its own leaf in every group.
///
/// Per-device leaves are the thing Kith never had (`docs/31` §1). Enrolling
/// requires the account key, because that is what signs the certificate binding
/// this device to the account — so this constructor only ever runs during
/// enrolment or sign-in, never from a device that merely holds a session.
#[wasm_bindgen]
pub struct Device {
    client: MlsClient<Config>,
    cert: Vec<u8>,
}

#[wasm_bindgen]
impl Device {
    /// Sign a new device into an account.
    #[wasm_bindgen(constructor)]
    pub fn new(account: &Account, label: &str) -> Result<Device, JsError> {
        let crypto = RustCryptoProvider::default();
        let cs = crypto.cipher_suite_provider(CS).ok_or_else(|| {
            JsError::new("this build has no provider for the configured cipher suite")
        })?;
        let (secret, public) = cs.signature_key_generate().map_err(js)?;
        let cert = DeviceCert::issue(&account.key, public.as_bytes(), label);
        let encoded = cert.encode();
        let credential = BasicCredential::new(encoded.clone()).into_credential();

        Ok(Device {
            client: MlsClient::builder()
                .identity_provider(DeviceCertIdentityProvider)
                .crypto_provider(crypto)
                .signing_identity(SigningIdentity::new(credential, public), secret, CS)
                .build(),
            cert: encoded,
        })
    }

    /// This device's certificate, in the wire form MLS carries as a credential.
    #[wasm_bindgen(getter)]
    pub fn certificate(&self) -> Vec<u8> {
        self.cert.clone()
    }

    /// A key package: what someone else needs in order to add this device to a
    /// group. **Single use** — mls-rs erases the private half once it is
    /// consumed by a join, so a device needs a fresh one per pending invite.
    #[wasm_bindgen(js_name = keyPackage)]
    pub fn key_package(&self) -> Result<Vec<u8>, JsError> {
        self.client
            .generate_key_package_message(Default::default(), Default::default(), None)
            .map_err(js)?
            .to_bytes()
            .map_err(js)
    }

    /// Start a new group with a caller-chosen id. In Revel the id is the room's
    /// id, so that the audience and the room it serves are the same thing to
    /// look up.
    #[wasm_bindgen(js_name = createGroup)]
    pub fn create_group(&self, group_id: &[u8]) -> Result<Group, JsError> {
        let inner = self
            .client
            .create_group_with_id(
                group_id.to_vec(),
                ExtensionList::default(),
                Default::default(),
                None,
            )
            .map_err(js)?;
        Ok(Group::wrap(inner))
    }

    /// Join a group from a Welcome.
    ///
    /// The ratchet tree rides in the Welcome under mls-rs's default commit
    /// options, so no out-of-band tree is needed. If that default ever changes,
    /// this is the call that breaks, loudly, in tests.
    #[wasm_bindgen(js_name = joinGroup)]
    pub fn join_group(&self, welcome: &[u8]) -> Result<Group, JsError> {
        let msg = MlsMessage::from_bytes(welcome).map_err(js)?;
        let (inner, _info) = self.client.join_group(None, &msg, None).map_err(js)?;
        Ok(Group::wrap(inner))
    }
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

/// The bytes a commit produces: one commit for the existing members, and a
/// Welcome for anyone the commit added.
#[wasm_bindgen]
pub struct Commit {
    commit: Vec<u8>,
    welcome: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl Commit {
    /// Send this to the room. Everyone already in the group applies it.
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.commit.clone()
    }

    /// Send this to whoever was added. Absent when the commit added nobody.
    #[wasm_bindgen(getter)]
    pub fn welcome(&self) -> Option<Vec<u8>> {
        self.welcome.clone()
    }
}

/// What came back out of [`Group::process`].
#[wasm_bindgen]
pub struct Received {
    kind: String,
    data: Option<Vec<u8>>,
    sender: Option<u32>,
}

#[wasm_bindgen]
impl Received {
    /// `"application"`, `"commit"`, `"proposal"`, or `"other"`.
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.clone()
    }

    /// The plaintext, for an application message. Absent otherwise.
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Option<Vec<u8>> {
        self.data.clone()
    }

    /// Leaf index of whoever sent it, where the message names one.
    #[wasm_bindgen(getter)]
    pub fn sender(&self) -> Option<u32> {
        self.sender
    }
}

/// One member's leaf, flattened for the boundary.
#[wasm_bindgen]
pub struct MemberInfo {
    leaf: u32,
    account: Vec<u8>,
    label: String,
}

#[wasm_bindgen]
impl MemberInfo {
    #[wasm_bindgen(getter)]
    pub fn leaf(&self) -> u32 {
        self.leaf
    }

    /// The account this leaf speaks for, taken from its device certificate —
    /// which the identity provider has already verified, or the leaf would not
    /// be in the group.
    #[wasm_bindgen(getter)]
    pub fn account(&self) -> Vec<u8> {
        self.account.clone()
    }

    /// The device's label ("laptop", "phone"). Covered by the certificate
    /// signature, so it cannot be changed after the fact.
    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }
}

/// One MLS group — in Revel, one audience.
///
/// ## Staging, then committing
///
/// Changes are staged and then committed in a batch, which is both what
/// `docs/03` §5 specifies for mass membership changes and the only shape that
/// survives the FFI boundary: mls-rs's `CommitBuilder` borrows the group and is
/// consumed by chaining, so it cannot be held across two JavaScript calls.
///
/// ```js
/// for (const kp of keyPackages) group.stageAdd(kp);
/// const out = group.commit();
/// await send(out.commit, out.welcome);   // the server may still refuse
/// group.applyPending();                  // only now is it our state
/// ```
///
/// `commit()` deliberately does **not** apply. Applying before the server has
/// accepted forks the group: the committer moves to an epoch nobody else ever
/// reaches, and every message after it is undecryptable by everyone including
/// the sender. One extra call is a cheap price for not being able to write that
/// bug by accident.
#[wasm_bindgen]
pub struct Group {
    inner: mls_rs::Group<Config>,
    adds: Vec<MlsMessage>,
    removes: Vec<u32>,
}

impl Group {
    fn wrap(inner: mls_rs::Group<Config>) -> Group {
        Group {
            inner,
            adds: Vec::new(),
            removes: Vec::new(),
        }
    }
}

#[wasm_bindgen]
impl Group {
    /// The group id — the room this audience serves.
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> Vec<u8> {
        self.inner.group_id().to_vec()
    }

    /// The current epoch. Every commit moves it forward by one.
    #[wasm_bindgen(getter)]
    pub fn epoch(&self) -> u64 {
        self.inner.current_epoch()
    }

    /// How many leaves are in the group — devices, not people. Three of one
    /// person's devices are three leaves.
    #[wasm_bindgen(getter)]
    pub fn size(&self) -> usize {
        self.inner.roster().members().len()
    }

    /// This device's own leaf index.
    #[wasm_bindgen(getter, js_name = ownLeaf)]
    pub fn own_leaf(&self) -> u32 {
        self.inner.current_member_index()
    }

    /// Stage an add. Takes a key package from [`Device::key_package`].
    #[wasm_bindgen(js_name = stageAdd)]
    pub fn stage_add(&mut self, key_package: &[u8]) -> Result<(), JsError> {
        self.adds
            .push(MlsMessage::from_bytes(key_package).map_err(js)?);
        Ok(())
    }

    /// Stage a removal by leaf index. This is what "sign out this device", a
    /// kick and a ban all cost.
    #[wasm_bindgen(js_name = stageRemove)]
    pub fn stage_remove(&mut self, leaf: u32) {
        self.removes.push(leaf);
    }

    /// How many changes are staged but not yet committed.
    #[wasm_bindgen(getter)]
    pub fn staged(&self) -> usize {
        self.adds.len() + self.removes.len()
    }

    /// Build one commit covering everything staged.
    ///
    /// The staged changes survive a failure: if mls-rs refuses the batch, the
    /// caller can drop one member and try again rather than having to rebuild
    /// the whole list from nothing.
    pub fn commit(&mut self) -> Result<Commit, JsError> {
        let mut builder = self.inner.commit_builder();
        for kp in &self.adds {
            builder = builder.add_member(kp.clone()).map_err(js)?;
        }
        for leaf in &self.removes {
            builder = builder.remove_member(*leaf).map_err(js)?;
        }
        let out = builder.build().map_err(js)?;

        self.adds.clear();
        self.removes.clear();

        Ok(Commit {
            commit: out.commit_message.to_bytes().map_err(js)?,
            welcome: out
                .welcome_messages
                .first()
                .map(|w| w.to_bytes())
                .transpose()
                .map_err(js)?,
        })
    }

    /// Adopt the commit this device just built. Call it once the server has
    /// accepted; see the type-level note on why it is separate.
    #[wasm_bindgen(js_name = applyPending)]
    pub fn apply_pending(&mut self) -> Result<(), JsError> {
        self.inner.apply_pending_commit().map(|_| ()).map_err(js)
    }

    /// Throw away staged changes the server refused.
    #[wasm_bindgen(js_name = clearStaged)]
    pub fn clear_staged(&mut self) {
        self.adds.clear();
        self.removes.clear();
    }

    /// Encrypt an application message for this group.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, JsError> {
        self.inner
            .encrypt_application_message(plaintext, Default::default())
            .map_err(js)?
            .to_bytes()
            .map_err(js)
    }

    /// Process anything that arrived for this group: an application message, a
    /// commit from someone else, or a proposal.
    pub fn process(&mut self, message: &[u8]) -> Result<Received, JsError> {
        let msg = MlsMessage::from_bytes(message).map_err(js)?;
        Ok(match self.inner.process_incoming_message(msg).map_err(js)? {
            ReceivedMessage::ApplicationMessage(m) => Received {
                kind: "application".into(),
                sender: Some(m.sender_index),
                data: Some(m.data().to_vec()),
            },
            ReceivedMessage::Commit(c) => Received {
                kind: "commit".into(),
                sender: Some(c.committer),
                data: None,
            },
            ReceivedMessage::Proposal(_) => Received {
                kind: "proposal".into(),
                sender: None,
                data: None,
            },
            _ => Received {
                kind: "other".into(),
                sender: None,
                data: None,
            },
        })
    }

    /// Everyone in the group, as a list of [`MemberInfo`].
    ///
    /// Built as a `js_sys::Array` by hand rather than serialised: it is one
    /// allocation per member either way, and this keeps `serde` out of the
    /// bundle for a payload this small.
    pub fn members(&self) -> js_sys::Array {
        let out = js_sys::Array::new();
        for m in self.inner.roster().members() {
            let (account, label) = m
                .signing_identity
                .credential
                .as_basic()
                .and_then(|b| DeviceCert::decode(&b.identifier).ok())
                .map(|c| (c.account_pub.to_vec(), c.label))
                .unwrap_or_default();
            out.push(&JsValue::from(MemberInfo {
                leaf: m.index,
                account,
                label,
            }));
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Device certificates, standalone
// ---------------------------------------------------------------------------

/// Read a device certificate without a group in hand — for the devices screen,
/// which lists what an account has signed.
///
/// Verifies before returning. There is no way through this function to look at
/// the contents of a certificate that does not check out, because a screen that
/// renders an unverified label is a spoofing surface (`docs/31` §1).
#[wasm_bindgen(js_name = readDeviceCert)]
pub fn read_device_cert(bytes: &[u8]) -> Result<MemberInfo, JsError> {
    let cert = DeviceCert::decode(bytes).map_err(js)?;
    cert.verify().map_err(js)?;
    Ok(MemberInfo {
        leaf: u32::MAX, // not in a group; there is no leaf to speak of
        account: cert.account_pub.to_vec(),
        label: cert.label,
    })
}
