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
//! ## Persistence
//!
//! A [`Device`] owns a [`LocalGroupStore`], and every change to a group is
//! written into it synchronously. Getting those bytes *out* is a separate
//! step, because mls-rs's storage trait is synchronous and IndexedDB is not:
//! ask [`Device::dirty_groups`] what changed, then [`Device::export_group`]
//! for each, and write the sealed blobs wherever you like. On the way back in,
//! [`Device::import_group`] then [`Device::load_group`].
//!
//! What crosses the boundary is **sealed** — MLS state is key material and
//! `docs/04` says the local store holds it encrypted. See `store.rs`.

use core::fmt::Display;

use ed25519_dalek::SigningKey;
use mls_rs::{
    client_builder::{
        BaseConfig, WithCryptoProvider, WithGroupStateStorage, WithIdentityProvider,
        WithKeyPackageRepo, WithMlsRules,
    },
    crypto::{SignaturePublicKey, SignatureSecretKey},
    extension::built_in::ExternalSendersExt,
    group::{ExportedTree, ReceivedMessage},
    identity::{basic::BasicCredential, Credential, SigningIdentity},
    mls_rules::{CommitOptions, DefaultMlsRules},
    CipherSuite, CipherSuiteProvider, Client as MlsClient, CryptoProvider, ExtensionList,
    MlsMessage,
};
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use wasm_bindgen::prelude::*;

use crate::envelope;
use crate::{
    device::DeviceCert,
    identity::DeviceCertIdentityProvider,
    store::{LocalGroupStore, LocalKeyPackageStore},
};

/// The suite `docs/03` §1 settles on. Post-quantum is a separate build
/// (`--features pq`) and a separate measurement; see `docs/31` §4.
const CS: CipherSuite = CipherSuite::CURVE25519_AES128;

/// The concrete client configuration.
///
/// The tests can say `Client<impl MlsConfig>` because they never store one. A
/// struct field needs a real type, so the builder's aliases are spelled out
/// here in the order the builder applies them.
type Config = WithMlsRules<
    DefaultMlsRules,
    WithGroupStateStorage<
        LocalGroupStore,
        WithKeyPackageRepo<
            LocalKeyPackageStore,
            WithCryptoProvider<
                RustCryptoProvider,
                WithIdentityProvider<DeviceCertIdentityProvider, BaseConfig>,
            >,
        >,
    >,
>;

/// The ratchet tree travels **out of band**, not inside the Welcome.
///
/// `docs/03` §5 requires this and `docs/31` §2 has the numbers: with the
/// `ratchet_tree` extension on, one join at 2,000 members costs 627 KiB because
/// the whole public tree rides along in every Welcome. Off, the Welcome is
/// 0.4 KiB at any group size and the tree is one cacheable fetch per epoch that
/// every joiner shares.
///
/// The cost of turning it off is that a Welcome is no longer self-contained: a
/// joiner needs the matching tree, and the wrong epoch's tree is no use. That is
/// why the tree is published in the same request as the commit that produced it
/// — see `HandshakeInput.tree`.
fn mls_rules() -> DefaultMlsRules {
    let options = CommitOptions::new().with_ratchet_tree_extension(false);
    DefaultMlsRules::new().with_commit_options(options)
}

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
    /// Kept so it can be persisted. A device that comes back with a *new*
    /// signature key is a new leaf, and its old leaf is still sitting in every
    /// group it was ever in — which is to say, reloading would silently fork
    /// this device's identity.
    secret: Vec<u8>,
    /// Shared with the client's config — mls-rs writes here, we read here.
    store: LocalGroupStore,
    /// Likewise, for the private halves of published key packages.
    packages: LocalKeyPackageStore,
}

#[wasm_bindgen]
impl Device {
    /// Sign a **new** device into an account, with a freshly generated key.
    ///
    /// Enrolment only. Coming back after a reload is [`Device::restore`].
    #[wasm_bindgen(constructor)]
    pub fn new(account: &Account, label: &str) -> Result<Device, JsError> {
        let crypto = RustCryptoProvider::default();
        let cs = crypto.cipher_suite_provider(CS).ok_or_else(|| {
            JsError::new("this build has no provider for the configured cipher suite")
        })?;
        let (secret, _public) = cs.signature_key_generate().map_err(js)?;
        Device::build(account, label, secret.as_bytes().to_vec())
    }

    /// Bring a device back with the key it already had.
    ///
    /// `docs/03` §1: a device key is stored durably on the device, and
    /// "reloading the app does not require a password". This is the call that
    /// makes that true — the certificate is re-issued rather than stored,
    /// because signing the same device key and label with the same account key
    /// reproduces it exactly.
    pub fn restore(account: &Account, label: &str, secret: &[u8]) -> Result<Device, JsError> {
        Device::build(account, label, secret.to_vec())
    }

    fn build(account: &Account, label: &str, secret: Vec<u8>) -> Result<Device, JsError> {
        let crypto = RustCryptoProvider::default();
        let cs = crypto.cipher_suite_provider(CS).ok_or_else(|| {
            JsError::new("this build has no provider for the configured cipher suite")
        })?;
        let signer = SignatureSecretKey::from(secret.clone());
        let public = cs.signature_key_derive_public(&signer).map_err(js)?;

        let cert = DeviceCert::issue(&account.key, public.as_bytes(), label);
        let encoded = cert.encode();
        let credential = BasicCredential::new(encoded.clone()).into_credential();
        let store = LocalGroupStore::new();
        let packages = LocalKeyPackageStore::new();

        Ok(Device {
            client: MlsClient::builder()
                .identity_provider(DeviceCertIdentityProvider)
                .crypto_provider(crypto)
                .key_package_repo(packages.clone())
                .group_state_storage(store.clone())
                .mls_rules(mls_rules())
                .signing_identity(SigningIdentity::new(credential, public), signer, CS)
                .build(),
            cert: encoded,
            secret,
            store,
            packages,
        })
    }

    /// This device's certificate, in the wire form MLS carries as a credential.
    #[wasm_bindgen(getter)]
    pub fn certificate(&self) -> Vec<u8> {
        self.cert.clone()
    }

    /// The device's MLS signature public key.
    ///
    /// The same bytes the certificate binds to the account, and the same bytes
    /// a Host knows this device by (`docs/31` §8: the two identifiers are one).
    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> Vec<u8> {
        // Read back out of the certificate rather than kept separately: one
        // source of truth, and it is the copy everyone else verifies against.
        DeviceCert::decode(&self.cert)
            .map(|c| c.device_pub)
            .unwrap_or_default()
    }

    /// Sign a Host's authentication challenge.
    ///
    /// `docs/03` §2's device-key challenge-response. The payload's *shape* is
    /// protocol and is built in `@revel/protocol`; the domain separation is
    /// applied here, so this key can never be asked to sign something that
    /// could be replayed as an MLS handshake.
    #[wasm_bindgen(js_name = signAuth)]
    pub fn sign_auth(&self, payload: &[u8]) -> Result<Vec<u8>, JsError> {
        // mls-rs hands back the expanded form — 32-byte seed followed by the
        // 32-byte public key, RFC 8032's "secret || public" layout. Taking the
        // seed is right; taking all 64 would be signing with nonsense.
        let seed: [u8; 32] = self
            .secret
            .get(..32)
            .and_then(|s| s.try_into().ok())
            .ok_or_else(|| JsError::new("device signature key is too short for ed25519"))?;
        let key = SigningKey::from_bytes(&seed);

        // Checked against the certificate rather than assumed. If the layout
        // ever changes, this fails here — loudly, at the first signature —
        // instead of producing a signature nobody can verify and a sign-in that
        // fails for no visible reason.
        let derived = key.verifying_key().to_bytes();
        let expected = DeviceCert::decode(&self.cert)
            .map(|c| c.device_pub)
            .unwrap_or_default();
        if derived.as_slice() != expected.as_slice() {
            return Err(JsError::new(
                "device signature key does not match the certificate; key layout changed?",
            ));
        }

        Ok(crate::device::sign_auth(&key, payload).to_vec())
    }

    /// The device's signature secret, for the caller to store durably.
    ///
    /// This is the key that makes this device *this* device. Losing it does not
    /// lose the account, but it does cost a re-enrolment and a new leaf in
    /// every group.
    #[wasm_bindgen(getter, js_name = secretKey)]
    pub fn secret_key(&self) -> Vec<u8> {
        self.secret.clone()
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
    ///
    /// `external_sender` is the Host's device certificate. `docs/03` §5: "The
    /// Host is configured in every group as an **MLS external sender**. On any
    /// audience change it appends external Add/Remove proposals... It can
    /// propose; it cannot Commit or forge a roster."
    ///
    /// **It has to be set here or never.** `external_senders` is a group
    /// context extension, fixed at creation unless somebody commits a
    /// `GroupContextExtensions` proposal to change it — so a group opened
    /// without one needs a commit per group to gain it later. `docs/29` §1's
    /// whole framing: nearly free now, expensive to retrofit.
    ///
    /// Passing nothing produces a group no external sender may propose to,
    /// which is the right answer for a Host that has not published one rather
    /// than a reason to refuse.
    #[wasm_bindgen(js_name = createGroup)]
    pub fn create_group(
        &self,
        group_id: &[u8],
        external_sender: Option<Vec<u8>>,
    ) -> Result<Group, JsError> {
        let mut extensions = ExtensionList::default();
        if let Some(cert) = external_sender {
            extensions
                .set_from(external_senders(&cert)?)
                .map_err(js)?;
        }

        let mut inner = self
            .client
            .create_group_with_id(group_id.to_vec(), extensions, Default::default(), None)
            .map_err(js)?;
        // Persisted immediately: a group that exists only in memory between
        // creation and its first commit is a group that can be lost before it
        // has ever been saved.
        inner.write_to_storage().map_err(js)?;
        Ok(Group::wrap(inner))
    }

    /// Join a group from a Welcome and the matching ratchet tree.
    ///
    /// The tree is **required**, and required at the right epoch: with the
    /// `ratchet_tree` extension off (see [`mls_rules`]) the Welcome carries the
    /// joiner's secrets and nothing else, so the public tree has to arrive
    /// beside it. A tree from a different epoch fails here rather than
    /// producing a group that disagrees with everyone else's.
    ///
    /// Making it an argument rather than an option is deliberate. A signature
    /// you can forget is one that gets forgotten, and forgetting it would mean
    /// every join failing at run time on a code path nobody tests locally.
    #[wasm_bindgen(js_name = joinGroup)]
    pub fn join_group(&self, welcome: &[u8], tree: &[u8]) -> Result<Group, JsError> {
        let msg = MlsMessage::from_bytes(welcome).map_err(js)?;
        let exported = ExportedTree::from_bytes(tree).map_err(js)?;
        let (mut inner, _info) = self
            .client
            .join_group(Some(exported), &msg, None)
            .map_err(js)?;
        inner.write_to_storage().map_err(js)?;
        Ok(Group::wrap(inner))
    }

    /// Re-open a group whose state was put back with [`Device::import_group`].
    ///
    /// This is the other half of a reload: the bytes come out of the local
    /// store, go in through `importGroup`, and the group comes back here.
    #[wasm_bindgen(js_name = loadGroup)]
    pub fn load_group(&self, group_id: &[u8]) -> Result<Group, JsError> {
        Ok(Group::wrap(self.client.load_group(group_id).map_err(js)?))
    }

    /// Group ids written since they were last exported.
    ///
    /// The caller drains this whenever it likes. Nothing is lost by waiting —
    /// a group that never made it to disk is re-fetched from the server, which
    /// is a slow start rather than a lost room.
    #[wasm_bindgen(js_name = dirtyGroups)]
    pub fn dirty_groups(&self) -> Result<js_sys::Array, JsError> {
        let out = js_sys::Array::new();
        for id in self.store.dirty().map_err(js)? {
            out.push(&js_sys::Uint8Array::from(&id[..]).into());
        }
        Ok(out)
    }

    /// Every group this device is holding state for, changed or not.
    #[wasm_bindgen(js_name = storedGroups)]
    pub fn stored_groups(&self) -> Result<js_sys::Array, JsError> {
        let out = js_sys::Array::new();
        for id in self.store.stored().map_err(js)? {
            out.push(&js_sys::Uint8Array::from(&id[..]).into());
        }
        Ok(out)
    }

    /// One group's state, sealed for the local store, and its dirty flag
    /// cleared.
    ///
    /// The account is needed because it is what the seal is keyed from. It is
    /// passed in rather than held so that there is one copy of the account
    /// secret in a session rather than one per device.
    #[wasm_bindgen(js_name = exportGroup)]
    pub fn export_group(&self, group_id: &[u8]) -> Result<Vec<u8>, JsError> {
        self.store
            .export(group_id, &self.secret)
            .map_err(js)
    }

    /// Put a sealed group back. Returns the group id it turned out to be.
    #[wasm_bindgen(js_name = importGroup)]
    pub fn import_group(&self, sealed: &[u8]) -> Result<Vec<u8>, JsError> {
        self.store.import(sealed, &self.secret).map_err(js)
    }

    /// Drop a group's stored state. Local only — nothing on the server changes
    /// and nobody is removed from anything.
    #[wasm_bindgen(js_name = forgetGroup)]
    pub fn forget_group(&self, group_id: &[u8]) -> Result<(), JsError> {
        self.store.forget(group_id).map_err(js)
    }

    /// Whether any key package has been published or consumed since the last
    /// export.
    #[wasm_bindgen(getter, js_name = keyPackagesDirty)]
    pub fn key_packages_dirty(&self) -> Result<bool, JsError> {
        self.packages.is_dirty().map_err(js)
    }

    /// How many published key packages are still unused.
    #[wasm_bindgen(getter, js_name = pendingKeyPackages)]
    pub fn pending_key_packages(&self) -> Result<usize, JsError> {
        self.packages.len().map_err(js)
    }

    /// Seal the private halves of every unused key package.
    ///
    /// Exported whole rather than one at a time: there is one per pending
    /// invite, they are small, and their ids are mls-rs internals that nothing
    /// outside this crate can interpret.
    #[wasm_bindgen(js_name = exportKeyPackages)]
    pub fn export_key_packages(&self) -> Result<Vec<u8>, JsError> {
        self.packages.export(&self.secret).map_err(js)
    }

    /// Put them back, **replacing** whatever is here. Returns how many.
    ///
    /// Replacing rather than merging, because the stored copy is the authority
    /// on which key packages are still unused — merging would resurrect ones a
    /// join has already consumed, and a key package used twice costs the joiner
    /// forward secrecy for the epoch they joined at.
    #[wasm_bindgen(js_name = importKeyPackages)]
    pub fn import_key_packages(&self, sealed: &[u8]) -> Result<usize, JsError> {
        self.packages.import(sealed, &self.secret).map_err(js)
    }
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

/// The bytes a commit produces: one commit for the existing members, a Welcome
/// for anyone it added, and the public ratchet tree at the new epoch.
#[wasm_bindgen]
pub struct Commit {
    commit: Vec<u8>,
    welcome: Option<Vec<u8>>,
    tree: Vec<u8>,
}

#[wasm_bindgen]
impl Commit {
    /// Send this to the room. Everyone already in the group applies it.
    #[wasm_bindgen(getter)]
    pub fn commit(&self) -> Vec<u8> {
        self.commit.clone()
    }

    /// The public tree at the epoch this commit produces.
    ///
    /// Comes from the commit itself rather than from the group afterwards, and
    /// that is the whole point: `commit()` deliberately does not apply what it
    /// builds, so asking the group for its tree here would give the *old* one.
    /// Publishing it in the same request as the commit is what stops a joiner
    /// racing the publish and fetching a tree from the wrong epoch.
    #[wasm_bindgen(getter)]
    pub fn tree(&self) -> Vec<u8> {
        self.tree.clone()
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

        // Always present, because `mls_rules()` turns the inlined tree off. If
        // that ever changes this becomes `None` and every join breaks, so it is
        // an error here rather than an empty vector nobody notices.
        let tree = out
            .ratchet_tree
            .as_ref()
            .ok_or_else(|| JsError::new("commit produced no ratchet tree; is the extension on?"))?
            .to_bytes()
            .map_err(js)?;

        Ok(Commit {
            commit: out.commit_message.to_bytes().map_err(js)?,
            tree,
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
        self.inner.apply_pending_commit().map_err(js)?;
        self.save()
    }

    /// Write this group's state into the device's store.
    ///
    /// Called for you on every epoch change — creating, joining, applying a
    /// commit, and processing someone else's. Exposed anyway because "I know
    /// something changed, persist it" is a reasonable thing for a caller to
    /// want, and finding out it is impossible is a bad afternoon.
    pub fn save(&mut self) -> Result<(), JsError> {
        self.inner.write_to_storage().map_err(js)
    }

    /// Throw away staged changes the server refused.
    #[wasm_bindgen(js_name = clearStaged)]
    pub fn clear_staged(&mut self) {
        self.adds.clear();
        self.removes.clear();
    }

    /// Encrypt an application message for this group.
    ///
    /// Persists afterwards, and that is **not** optional caution.
    ///
    /// Sending advances this device's position in the secret tree, and the key
    /// and nonce for a message are derived from that position. A group restored
    /// from a state saved before the send comes back with its counter rewound,
    /// and the next message it sends re-derives a key and nonce that have
    /// already been used — under AES-GCM, encrypting two different plaintexts
    /// under one key and nonce is a total loss of confidentiality and
    /// authenticity for both.
    ///
    /// The first version of this saved only on epoch changes, on the reasoning
    /// that a stored epoch secret is enough to re-derive anything. That is true
    /// for *reading* and false for *writing*, and the test named
    /// `a_group_survives_a_reload` is what noticed.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, JsError> {
        let sealed = self
            .inner
            .encrypt_application_message(plaintext, Default::default())
            .map_err(js)?
            .to_bytes()
            .map_err(js)?;
        self.save()?;
        Ok(sealed)
    }

    /// Process anything that arrived for this group: an application message, a
    /// commit from someone else, or a proposal.
    pub fn process(&mut self, message: &[u8]) -> Result<Received, JsError> {
        let msg = MlsMessage::from_bytes(message).map_err(js)?;
        let received = self.inner.process_incoming_message(msg).map_err(js)?;

        // A commit moves the epoch, and an epoch we failed to persist is one we
        // cannot come back to.
        //
        // Receiving an application message is deliberately *not* persisted.
        // What it advances is the replay window for that sender, so a reload
        // can re-accept a message it has already seen — which the layer above
        // discards anyway, because events carry server-assigned ids and it
        // deduplicates on them. That is a much smaller thing to lose than the
        // cost of re-serialising a whole group's state on every message that
        // arrives, and unlike the sending side there is no key reuse in it.
        if matches!(received, ReceivedMessage::Commit(_)) {
            self.save()?;
        }

        Ok(match received {
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
    /// The certificates this group's context authorises to send proposals.
    ///
    /// What the *group* believes, which is the only thing that matters: the
    /// `external_senders` extension was fixed when the group was created, so a
    /// Host that has since changed or lost its key cannot change this, and a
    /// Host that never published one produces an empty list.
    ///
    /// Useful beyond a test — a "who can propose in this room" line is exactly
    /// the sort of thing `docs/22` wants to be able to show without lying.
    #[wasm_bindgen(js_name = externalSenders)]
    pub fn external_senders(&self) -> js_sys::Array {
        let out = js_sys::Array::new();
        let Ok(Some(ext)) = self.inner.context().extensions().get_as::<ExternalSendersExt>() else {
            return out;
        };
        for identity in &ext.allowed_senders {
            if let Credential::Basic(basic) = &identity.credential {
                out.push(&js_sys::Uint8Array::from(basic.identifier.as_slice()).into());
            }
        }
        out
    }

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

/// Build the `external_senders` extension from a Host's device certificate.
///
/// The Host presents a device certificate like anybody else — that is what
/// `DeviceCertIdentityProvider::validate_external_sender` already expects, and
/// it means members can see exactly which key is allowed to propose and who
/// vouched for it, using the machinery they already trust for leaves.
fn external_senders(cert_bytes: &[u8]) -> Result<ExternalSendersExt, JsError> {
    let cert = DeviceCert::decode(cert_bytes).map_err(js)?;
    // Verified here rather than trusted: a Host that published a certificate
    // its account key never signed would otherwise end up baked into a group
    // context that cannot be changed without a commit.
    cert.verify().map_err(js)?;

    let key = SignaturePublicKey::from(cert.device_pub.clone());
    let credential = BasicCredential::new(cert_bytes.to_vec()).into_credential();
    Ok(ExternalSendersExt::new(vec![SigningIdentity::new(credential, key)]))
}

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

// ---------------------------------------------------------------------------
// The account key envelope (`docs/03` §1)
// ---------------------------------------------------------------------------

/// The three wraps, from the browser.
///
/// Thin on purpose — every decision lives in `envelope.rs`, and this exists so
/// the web client never has to hold a wrapping key in JavaScript for longer
/// than the call. The account key crosses this boundary exactly twice in a
/// lifetime: once at sign-up, once at recovery.
#[wasm_bindgen]
pub struct Envelope;

#[wasm_bindgen]
impl Envelope {
    /// A fresh account key. Random, never derived from a password.
    #[wasm_bindgen(js_name = generateAccountKey)]
    pub fn generate_account_key() -> Vec<u8> {
        envelope::generate_account_key().to_vec()
    }

    /// The public half, which *is* the account's identity.
    #[wasm_bindgen(js_name = accountPublic)]
    pub fn account_public(seed: &[u8]) -> Result<Vec<u8>, JsError> {
        let seed: [u8; 32] = seed.try_into().map_err(|_| JsError::new("bad account key"))?;
        Ok(envelope::account_public(&seed).to_vec())
    }

    /// KEK from OPAQUE's `exportKey`.
    #[wasm_bindgen(js_name = kekFromExportKey)]
    pub fn kek_from_export_key(export_key: &[u8]) -> Vec<u8> {
        envelope::kek_from_export_key(export_key).to_vec()
    }

    /// RK from a recovery code, via Argon2id. The slow one, by design.
    #[wasm_bindgen(js_name = recoveryKey)]
    pub fn recovery_key(code: &str, salt: &[u8]) -> Result<Vec<u8>, JsError> {
        envelope::recovery_key(code, salt)
            .map(|k| k.to_vec())
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Seal the account key under a 32-byte wrapping key.
    #[wasm_bindgen(js_name = wrap)]
    pub fn wrap(seed: &[u8], wrapping_key: &[u8]) -> Result<Vec<u8>, JsError> {
        let seed: [u8; 32] = seed.try_into().map_err(|_| JsError::new("bad account key"))?;
        let key: [u8; 32] = wrapping_key.try_into().map_err(|_| JsError::new("bad wrapping key"))?;
        envelope::wrap_account_key(&seed, &key).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Open a wrap. A wrong key and tampered bytes give the same error.
    #[wasm_bindgen(js_name = unwrap)]
    pub fn unwrap(wrap: &[u8], wrapping_key: &[u8]) -> Result<Vec<u8>, JsError> {
        let key: [u8; 32] = wrapping_key.try_into().map_err(|_| JsError::new("bad wrapping key"))?;
        envelope::unwrap_account_key(wrap, &key)
            .map(|s| s.to_vec())
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// A fresh recovery code, grouped for transcription.
    #[wasm_bindgen(js_name = generateRecoveryCode)]
    pub fn generate_recovery_code() -> String {
        envelope::generate_recovery_code().to_string()
    }

    /// Uppercase, dashes removed, ambiguous letters folded. Errors if it is not
    /// a recovery code at all — cheaper than finding out after Argon2id.
    #[wasm_bindgen(js_name = normaliseRecoveryCode)]
    pub fn normalise_recovery_code(code: &str) -> Result<String, JsError> {
        envelope::normalise_recovery_code(code).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Proof of the recovery code, for the IdP. Never the key that opens a wrap.
    #[wasm_bindgen(js_name = recoveryVerifier)]
    pub fn recovery_verifier(rk: &[u8]) -> Result<Vec<u8>, JsError> {
        let rk: [u8; 32] = rk.try_into().map_err(|_| JsError::new("bad recovery key"))?;
        Ok(envelope::recovery_verifier(&rk).to_vec())
    }

    /// A fresh per-account salt for [`Envelope::recovery_key`]. Not secret.
    #[wasm_bindgen(js_name = generateSalt)]
    pub fn generate_salt() -> Vec<u8> {
        envelope::generate_salt().to_vec()
    }
}
