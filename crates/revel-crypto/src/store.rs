//! Group state that can survive a reload.
//!
//! An MLS group is a running cryptographic state machine, not a document. Lose
//! it and the messages already on disk stay unreadable forever — the keys that
//! open them were in that state. So it has to be persisted, and `docs/04`
//! §Client-side says exactly where: the local store holds "the MLS session
//! state and era roots (**sealed at rest under the device key**)".
//!
//! ## The shape, and why
//!
//! mls-rs persists through a [`GroupStateStorage`], and its trait is
//! **synchronous**. The store that has to end up holding these bytes is
//! IndexedDB, which is not. Those two facts cannot be reconciled by making the
//! storage call out to JavaScript — a synchronous callback cannot await a
//! transaction.
//!
//! So the storage is in memory, and export is a separate, explicit step:
//!
//! 1. mls-rs writes group state into [`LocalGroupStore`], synchronously,
//!    whenever the group changes.
//! 2. The store remembers **which** groups changed.
//! 3. The caller drains those ids whenever it likes, asks for each group's
//!    sealed bytes, and writes them wherever it wants, at its own pace.
//!
//! Nothing is lost by the delay: a group that fails to persist is re-fetched
//! from the server, which is a slow start rather than a lost room.
//!
//! ## Sealed with what
//!
//! A key derived from the account secret, domain-separated, HKDF-SHA256 then
//! AES-256-GCM. Two honest notes about that:
//!
//! - The bytes leaving here are *ciphertext*, so the local store never holds
//!   MLS key material in the clear. That is the property `docs/04` asks for.
//! - `docs/03` §1 wants the sealing key to be the **device** key — a
//!   non-extractable `CryptoKey` in IndexedDB — so that a compromised account
//!   backup does not also open local state. That needs a WebCrypto path that
//!   does not exist yet. Deriving from the account is the interim, and it is
//!   only the derivation in [`state_key`] that has to change.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use hkdf::Hkdf;
use mls_rs_core::error::IntoAnyError;
use mls_rs_core::group::{EpochRecord, GroupState, GroupStateStorage};
use mls_rs_core::key_package::{KeyPackageData, KeyPackageStorage};
use mls_rs_core::mls_rs_codec::{MlsDecode, MlsEncode};
use sha2::Sha256;
use zeroize::Zeroizing;

/// Domain separation for the key that seals local state. Changing this string
/// makes every stored group unreadable, which is the correct behaviour if the
/// format under it ever changes incompatibly.
const STATE_KEY_INFO: &[u8] = b"revel/group-state/v1";

/// Magic and version on every sealed blob, so a stored group from a future
/// build is refused rather than misparsed.
const SEAL_MAGIC: &[u8; 8] = b"REVELGS\x01";

/// The same, for the key package store. A different magic so that handing one
/// kind of blob to the other's importer fails immediately instead of
/// half-parsing into nonsense.
const KP_MAGIC: &[u8; 8] = b"REVELKP\x01";

/// How many prior epochs to keep, matching mls-rs's own default.
///
/// Prior epochs exist so a message that arrives after the group has moved on is
/// still readable. Three is the library's answer to "how far behind is worth
/// tolerating", and there is no reason for us to disagree with it.
const EPOCH_RETENTION: usize = 3;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("the group state store was poisoned by a panic in another thread")]
    Poisoned,
    #[error("sealed group state is malformed")]
    Malformed,
    #[error("sealed group state is from an incompatible version")]
    WrongVersion,
    #[error("sealed group state could not be opened with this account's key")]
    NotOurs,
    #[error("no state stored for that group")]
    NoSuchGroup,
}

impl<T> From<PoisonError<T>> for StoreError {
    fn from(_: PoisonError<T>) -> Self {
        StoreError::Poisoned
    }
}

impl IntoAnyError for StoreError {
    fn into_dyn_error(self) -> Result<Box<dyn std::error::Error + Send + Sync>, Self> {
        Ok(self.into())
    }
}

/// One group's persisted form: the current state plus a few prior epochs.
#[derive(Debug, Clone, Default)]
struct GroupData {
    state: Vec<u8>,
    /// Ordered so trimming keeps the newest, which is what retention means.
    epochs: BTreeMap<u64, Vec<u8>>,
}

/// The 32 bytes that seal local state for this account.
fn state_key(account_secret: &[u8]) -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0u8; 32]);
    // No salt: the input is already a uniformly random 32-byte secret, and a
    // salt we would have to store alongside the ciphertext buys nothing here.
    Hkdf::<Sha256>::new(None, account_secret)
        .expand(STATE_KEY_INFO, key.as_mut())
        .expect("32 bytes is a valid HKDF output length");
    key
}

/// Where mls-rs writes group state, and where sealed exports come from.
///
/// Cloning shares the underlying map — mls-rs holds one clone inside the client
/// config and the binding holds another, and they must see the same data.
#[derive(Debug, Clone, Default)]
pub struct LocalGroupStore {
    groups: Arc<Mutex<HashMap<Vec<u8>, GroupData>>>,
    /// Groups written since the caller last exported them. This is the whole
    /// reason the export can be lazy without being lossy.
    dirty: Arc<Mutex<HashSet<Vec<u8>>>>,
}

impl LocalGroupStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Group ids written since they were last exported, oldest state first is
    /// not meaningful here — the set is unordered on purpose.
    pub fn dirty(&self) -> Result<Vec<Vec<u8>>, StoreError> {
        Ok(self.dirty.lock()?.iter().cloned().collect())
    }

    /// Every group this store is holding, changed or not.
    pub fn stored(&self) -> Result<Vec<Vec<u8>>, StoreError> {
        Ok(self.groups.lock()?.keys().cloned().collect())
    }

    /// Seal one group's state for the caller to store.
    ///
    /// Clears the group's dirty flag: what comes back is a complete snapshot,
    /// so once the caller has it there is nothing outstanding. If the write
    /// fails on their side they can simply ask again — the state is still here.
    pub fn export(&self, group_id: &[u8], account_secret: &[u8]) -> Result<Vec<u8>, StoreError> {
        let data = self
            .groups
            .lock()?
            .get(group_id)
            .cloned()
            .ok_or(StoreError::NoSuchGroup)?;

        let sealed = seal(&encode(group_id, &data), account_secret)?;
        self.dirty.lock()?.remove(group_id);
        Ok(sealed)
    }

    /// Put a sealed group back, returning its group id.
    ///
    /// Does not mark it dirty: it came from storage, so storage already has it.
    pub fn import(&self, sealed: &[u8], account_secret: &[u8]) -> Result<Vec<u8>, StoreError> {
        let plain = open(sealed, account_secret)?;
        let (group_id, data) = decode(&plain)?;
        self.groups.lock()?.insert(group_id.clone(), data);
        Ok(group_id)
    }

    /// Forget a group entirely. Local only — nothing on the server changes.
    pub fn forget(&self, group_id: &[u8]) -> Result<(), StoreError> {
        self.groups.lock()?.remove(group_id);
        self.dirty.lock()?.remove(group_id);
        Ok(())
    }
}

impl GroupStateStorage for LocalGroupStore {
    type Error = StoreError;

    fn state(&self, group_id: &[u8]) -> Result<Option<Zeroizing<Vec<u8>>>, Self::Error> {
        Ok(self
            .groups
            .lock()?
            .get(group_id)
            .map(|g| Zeroizing::new(g.state.clone())))
    }

    fn epoch(&self, group_id: &[u8], epoch_id: u64) -> Result<Option<Zeroizing<Vec<u8>>>, Self::Error> {
        Ok(self
            .groups
            .lock()?
            .get(group_id)
            .and_then(|g| g.epochs.get(&epoch_id))
            .map(|e| Zeroizing::new(e.clone())))
    }

    fn write(
        &mut self,
        state: GroupState,
        epoch_inserts: Vec<EpochRecord>,
        epoch_updates: Vec<EpochRecord>,
    ) -> Result<(), Self::Error> {
        let mut groups = self.groups.lock()?;
        let entry = groups.entry(state.id.clone()).or_default();
        entry.state = state.data.to_vec();

        for record in epoch_inserts.into_iter().chain(epoch_updates) {
            entry.epochs.insert(record.id, record.data.to_vec());
        }

        // Trim the oldest. mls-rs's own storage does this rather than being
        // told to; without it a long-lived group's state grows without bound.
        while entry.epochs.len() > EPOCH_RETENTION {
            let oldest = *entry.epochs.keys().next().expect("non-empty");
            entry.epochs.remove(&oldest);
        }

        drop(groups);
        self.dirty.lock()?.insert(state.id);
        Ok(())
    }

    fn max_epoch_id(&self, group_id: &[u8]) -> Result<Option<u64>, Self::Error> {
        Ok(self
            .groups
            .lock()?
            .get(group_id)
            .and_then(|g| g.epochs.keys().next_back().copied()))
    }
}

// ---------------------------------------------------------------------------
// Wire form
// ---------------------------------------------------------------------------

/// `magic | u32 id_len | id | u32 state_len | state | u32 count | (u64 id, u32 len, bytes)*`
///
/// Hand-rolled and length-prefixed, in the same shape as `device.rs`, so the
/// crate has one encoding style rather than one per module. Everything here is
/// produced by us and read by us; the parser still assumes nothing.
fn encode(group_id: &[u8], data: &GroupData) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.state.len() + 64);
    out.extend_from_slice(SEAL_MAGIC);
    out.extend_from_slice(&(group_id.len() as u32).to_be_bytes());
    out.extend_from_slice(group_id);
    out.extend_from_slice(&(data.state.len() as u32).to_be_bytes());
    out.extend_from_slice(&data.state);
    out.extend_from_slice(&(data.epochs.len() as u32).to_be_bytes());
    for (id, bytes) in &data.epochs {
        out.extend_from_slice(&id.to_be_bytes());
        out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        out.extend_from_slice(bytes);
    }
    out
}

/// Reads what `encode` wrote, and nothing else.
///
/// Every length is checked against what is actually left in the buffer before
/// it is used, because "trust the length prefix, index past the end" is the
/// classic parser bug and `device.rs` has a test named after it.
fn decode(bytes: &[u8]) -> Result<(Vec<u8>, GroupData), StoreError> {
    let mut r = Reader { bytes, at: 0 };
    if r.take(SEAL_MAGIC.len())? != SEAL_MAGIC {
        return Err(StoreError::WrongVersion);
    }

    let group_id = r.length_prefixed()?.to_vec();
    let state = r.length_prefixed()?.to_vec();

    let count = r.u32()? as usize;
    let mut epochs = BTreeMap::new();
    for _ in 0..count {
        let id = r.u64()?;
        let data = r.length_prefixed()?.to_vec();
        epochs.insert(id, data);
    }

    Ok((group_id, GroupData { state, epochs }))
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], StoreError> {
        let end = self.at.checked_add(n).ok_or(StoreError::Malformed)?;
        let slice = self.bytes.get(self.at..end).ok_or(StoreError::Malformed)?;
        self.at = end;
        Ok(slice)
    }

    fn u32(&mut self) -> Result<u32, StoreError> {
        let b: [u8; 4] = self.take(4)?.try_into().map_err(|_| StoreError::Malformed)?;
        Ok(u32::from_be_bytes(b))
    }

    fn u64(&mut self) -> Result<u64, StoreError> {
        let b: [u8; 8] = self.take(8)?.try_into().map_err(|_| StoreError::Malformed)?;
        Ok(u64::from_be_bytes(b))
    }

    fn length_prefixed(&mut self) -> Result<&'a [u8], StoreError> {
        let n = self.u32()? as usize;
        self.take(n)
    }
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

/// `nonce | ciphertext`, AES-256-GCM under the account's state key.
///
/// A fresh random nonce per seal. Group state is re-sealed on every change, so
/// a counter would have to be persisted alongside it and would be the thing
/// that breaks after a restore — 96 random bits per seal is the safer trade.
fn seal(plain: &[u8], account_secret: &[u8]) -> Result<Vec<u8>, StoreError> {
    let key = state_key(account_secret);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_ref()));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let mut out = nonce.to_vec();
    out.extend_from_slice(&cipher.encrypt(&nonce, plain).map_err(|_| StoreError::Malformed)?);
    Ok(out)
}

fn open(sealed: &[u8], account_secret: &[u8]) -> Result<Zeroizing<Vec<u8>>, StoreError> {
    if sealed.len() < 12 {
        return Err(StoreError::Malformed);
    }
    let (nonce, ciphertext) = sealed.split_at(12);

    let key = state_key(account_secret);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_ref()));

    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        // A GCM failure means the key is wrong or the bytes were tampered with,
        // and from out here those are the same event: this is not ours.
        .map(Zeroizing::new)
        .map_err(|_| StoreError::NotOurs)
}

// ---------------------------------------------------------------------------
// Key packages
// ---------------------------------------------------------------------------

/// Where mls-rs keeps the private half of a key package until it is used.
///
/// This is small but not optional. A key package is what someone else needs in
/// order to add this device to a group, and the private half never leaves the
/// device that made it. Publish one, close the tab, and get added while away:
/// without this the Welcome that comes back cannot be opened, and the room is
/// unreachable — a member of a group they cannot read.
///
/// mls-rs deletes an entry the moment a join consumes it, and **that deletion
/// matters as much as the insert**. A key package is single use; resurrecting a
/// consumed one from stale storage would let it be used twice, which costs the
/// joiner forward secrecy for the epoch they joined at.
///
/// Exported whole rather than per entry. There is one of these per pending
/// invite, they are a few hundred bytes each, and an id nobody outside mls-rs
/// can interpret is a poor thing to key a public API on.
#[derive(Debug, Clone, Default)]
pub struct LocalKeyPackageStore {
    /// Ordered so the exported bytes are deterministic for a given content.
    packages: Arc<Mutex<BTreeMap<Vec<u8>, Vec<u8>>>>,
    dirty: Arc<Mutex<bool>>,
}

impl LocalKeyPackageStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether anything has been inserted or deleted since the last export.
    pub fn is_dirty(&self) -> Result<bool, StoreError> {
        Ok(*self.dirty.lock()?)
    }

    /// How many key packages are outstanding — i.e. published and not yet used.
    pub fn len(&self) -> Result<usize, StoreError> {
        Ok(self.packages.lock()?.len())
    }

    pub fn is_empty(&self) -> Result<bool, StoreError> {
        Ok(self.packages.lock()?.is_empty())
    }

    /// Seal the whole store, and clear the dirty flag.
    pub fn export(&self, account_secret: &[u8]) -> Result<Vec<u8>, StoreError> {
        let plain = encode_map(KP_MAGIC, &*self.packages.lock()?);
        let sealed = seal(&plain, account_secret)?;
        *self.dirty.lock()? = false;
        Ok(sealed)
    }

    /// Put the whole store back, **replacing** what is here.
    ///
    /// Replacing rather than merging: the stored copy is the authority on which
    /// key packages are still unused, and merging would bring deleted ones back
    /// from the dead.
    pub fn import(&self, sealed: &[u8], account_secret: &[u8]) -> Result<usize, StoreError> {
        let plain = open(sealed, account_secret)?;
        let map = decode_map(KP_MAGIC, &plain)?;
        let n = map.len();
        *self.packages.lock()? = map;
        Ok(n)
    }
}

impl KeyPackageStorage for LocalKeyPackageStore {
    type Error = StoreError;

    fn delete(&mut self, id: &[u8]) -> Result<(), Self::Error> {
        self.packages.lock()?.remove(id);
        *self.dirty.lock()? = true;
        Ok(())
    }

    fn insert(&mut self, id: Vec<u8>, pkg: KeyPackageData) -> Result<(), Self::Error> {
        let encoded = pkg.mls_encode_to_vec().map_err(|_| StoreError::Malformed)?;
        self.packages.lock()?.insert(id, encoded);
        *self.dirty.lock()? = true;
        Ok(())
    }

    fn get(&self, id: &[u8]) -> Result<Option<KeyPackageData>, Self::Error> {
        self.packages
            .lock()?
            .get(id)
            .map(|bytes| KeyPackageData::mls_decode(&mut &bytes[..]).map_err(|_| StoreError::Malformed))
            .transpose()
    }
}

/// `magic | u32 count | (u32 klen, k, u32 vlen, v)*`
fn encode_map(magic: &[u8; 8], map: &BTreeMap<Vec<u8>, Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(magic);
    out.extend_from_slice(&(map.len() as u32).to_be_bytes());
    for (k, v) in map {
        out.extend_from_slice(&(k.len() as u32).to_be_bytes());
        out.extend_from_slice(k);
        out.extend_from_slice(&(v.len() as u32).to_be_bytes());
        out.extend_from_slice(v);
    }
    out
}

fn decode_map(magic: &[u8; 8], bytes: &[u8]) -> Result<BTreeMap<Vec<u8>, Vec<u8>>, StoreError> {
    let mut r = Reader { bytes, at: 0 };
    if r.take(magic.len())? != magic {
        return Err(StoreError::WrongVersion);
    }
    let count = r.u32()? as usize;
    let mut map = BTreeMap::new();
    for _ in 0..count {
        let k = r.length_prefixed()?.to_vec();
        let v = r.length_prefixed()?.to_vec();
        map.insert(k, v);
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(state: &[u8]) -> GroupData {
        let mut epochs = BTreeMap::new();
        epochs.insert(7, b"seven".to_vec());
        epochs.insert(8, b"eight".to_vec());
        GroupData {
            state: state.to_vec(),
            epochs,
        }
    }

    #[test]
    fn a_group_round_trips_through_the_sealed_form() {
        let secret = [3u8; 32];
        let store = LocalGroupStore::new();
        store.groups.lock().unwrap().insert(b"g-1".to_vec(), data(b"state bytes"));

        let sealed = store.export(b"g-1", &secret).unwrap();
        assert_ne!(sealed.windows(11).position(|w| w == b"state bytes"), Some(0));

        let other = LocalGroupStore::new();
        assert_eq!(other.import(&sealed, &secret).unwrap(), b"g-1");
        assert_eq!(
            other.state(b"g-1").unwrap().map(|s| s.to_vec()),
            Some(b"state bytes".to_vec())
        );
        assert_eq!(other.epoch(b"g-1", 7).unwrap().map(|e| e.to_vec()), Some(b"seven".to_vec()));
        assert_eq!(other.max_epoch_id(b"g-1").unwrap(), Some(8));
    }

    #[test]
    fn the_sealed_form_does_not_contain_the_plaintext() {
        // The whole point of sealing: what the local store holds must not be
        // MLS key material in the clear.
        let store = LocalGroupStore::new();
        store
            .groups
            .lock()
            .unwrap()
            .insert(b"g-1".to_vec(), data(b"a very secret ratchet"));
        let sealed = store.export(b"g-1", &[3u8; 32]).unwrap();
        assert!(
            !sealed.windows(21).any(|w| w == b"a very secret ratchet"),
            "the plaintext survived sealing"
        );
    }

    #[test]
    fn another_account_cannot_open_it() {
        let store = LocalGroupStore::new();
        store.groups.lock().unwrap().insert(b"g-1".to_vec(), data(b"state"));
        let sealed = store.export(b"g-1", &[3u8; 32]).unwrap();

        let other = LocalGroupStore::new();
        assert!(matches!(
            other.import(&sealed, &[4u8; 32]),
            Err(StoreError::NotOurs)
        ));
    }

    #[test]
    fn a_tampered_blob_is_refused() {
        let store = LocalGroupStore::new();
        store.groups.lock().unwrap().insert(b"g-1".to_vec(), data(b"state"));
        let mut sealed = store.export(b"g-1", &[3u8; 32]).unwrap();
        let n = sealed.len();
        sealed[n - 1] ^= 0xff;

        let other = LocalGroupStore::new();
        assert!(matches!(
            other.import(&sealed, &[3u8; 32]),
            Err(StoreError::NotOurs)
        ));
    }

    #[test]
    fn writing_marks_dirty_and_exporting_clears_it() {
        let secret = [3u8; 32];
        let mut store = LocalGroupStore::new();
        assert!(store.dirty().unwrap().is_empty());

        store
            .write(
                GroupState {
                    id: b"g-1".to_vec(),
                    data: Zeroizing::new(b"state".to_vec()),
                },
                vec![EpochRecord::new(1, Zeroizing::new(b"one".to_vec()))],
                vec![],
            )
            .unwrap();

        assert_eq!(store.dirty().unwrap(), vec![b"g-1".to_vec()]);
        store.export(b"g-1", &secret).unwrap();
        assert!(store.dirty().unwrap().is_empty());
    }

    #[test]
    fn only_the_newest_epochs_are_kept() {
        let mut store = LocalGroupStore::new();
        for id in 0..10u64 {
            store
                .write(
                    GroupState {
                        id: b"g-1".to_vec(),
                        data: Zeroizing::new(b"state".to_vec()),
                    },
                    vec![EpochRecord::new(id, Zeroizing::new(vec![id as u8]))],
                    vec![],
                )
                .unwrap();
        }

        let groups = store.groups.lock().unwrap();
        let epochs = &groups.get(b"g-1".as_slice()).unwrap().epochs;
        assert_eq!(epochs.len(), EPOCH_RETENTION);
        assert_eq!(epochs.keys().copied().collect::<Vec<_>>(), vec![7, 8, 9]);
    }

    #[test]
    fn a_truncated_blob_is_rejected_rather_than_panicking() {
        let store = LocalGroupStore::new();
        store.groups.lock().unwrap().insert(b"g-1".to_vec(), data(b"state"));
        let sealed = store.export(b"g-1", &[3u8; 32]).unwrap();

        for n in 0..sealed.len() {
            let other = LocalGroupStore::new();
            let _ = other.import(&sealed[..n], &[3u8; 32]);
        }
    }

    #[test]
    fn a_declared_length_larger_than_the_buffer_is_rejected() {
        let mut plain = encode(b"g-1", &data(b"state"));
        // The id length prefix sits right after the magic.
        plain[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(matches!(decode(&plain), Err(StoreError::Malformed)));
    }

    #[test]
    fn key_packages_round_trip_and_track_dirtiness() {
        let secret = [9u8; 32];
        let mut store = LocalKeyPackageStore::new();
        assert!(!store.is_dirty().unwrap());

        // KeyPackageData is opaque here, so drive the map directly — the codec
        // is mls-rs's and has its own tests.
        store
            .packages
            .lock()
            .unwrap()
            .insert(b"kp-1".to_vec(), b"encoded".to_vec());
        *store.dirty.lock().unwrap() = true;

        let sealed = store.export(&secret).unwrap();
        assert!(!store.is_dirty().unwrap());

        let other = LocalKeyPackageStore::new();
        assert_eq!(other.import(&sealed, &secret).unwrap(), 1);
        assert_eq!(other.len().unwrap(), 1);

        // Deleting is a change too — a consumed key package that comes back
        // from stale storage could be used twice.
        store.delete(b"kp-1").unwrap();
        assert!(store.is_dirty().unwrap());
        assert!(store.is_empty().unwrap());
    }

    #[test]
    fn importing_replaces_rather_than_merges() {
        let secret = [9u8; 32];
        let empty = LocalKeyPackageStore::new().export(&secret).unwrap();

        let store = LocalKeyPackageStore::new();
        store
            .packages
            .lock()
            .unwrap()
            .insert(b"kp-1".to_vec(), b"encoded".to_vec());

        assert_eq!(store.import(&empty, &secret).unwrap(), 0);
        assert!(
            store.is_empty().unwrap(),
            "a deleted key package came back from the dead"
        );
    }

    #[test]
    fn the_two_stores_do_not_accept_each_others_blobs() {
        let secret = [9u8; 32];
        let groups = LocalGroupStore::new();
        groups.groups.lock().unwrap().insert(b"g-1".to_vec(), data(b"state"));
        let group_blob = groups.export(b"g-1", &secret).unwrap();

        let packages = LocalKeyPackageStore::new();
        assert!(matches!(
            packages.import(&group_blob, &secret),
            Err(StoreError::WrongVersion)
        ));
    }

    #[test]
    fn a_blob_with_the_wrong_magic_is_refused() {
        let mut plain = encode(b"g-1", &data(b"state"));
        plain[0] = b'X';
        assert!(matches!(decode(&plain), Err(StoreError::WrongVersion)));
    }
}
