/**
 * The crypto seam.
 *
 * `docs/26` §Option C names this file: "`packages/crypto/src/engine.ts` is
 * defined as an interface precisely so the MLS implementation can be swapped".
 * Everything above it — the sync engine, the room reducer, the store, the UI —
 * talks to `CryptoEngine` and never to wasm.
 *
 * ## Everything is async, on purpose
 *
 * Not because the crypto is asynchronous — mls-rs is synchronous and the
 * binding under this is too — but because it must not run on the thread that
 * paints. `docs/31` §5 measured the reason: removing one member from a
 * 2,000-leaf group is **804 ms** in a browser, a 500-leaf removal is 212 ms,
 * and a first join is 1.7 s. Those are ordinary operations — signing out a
 * device, a kick, a ban, opening a room — and every one of them would freeze
 * the app.
 *
 * So the only implementation that ships runs in a Worker, and this interface is
 * async even where an implementation could answer instantly. An engine that is
 * sometimes synchronous is one whose callers accidentally depend on it.
 *
 * ## Groups, not rooms
 *
 * Keyed by **group id**, never room id. `docs/03` §4: a space has one implicit
 * "everyone" audience and therefore *one* MLS group shared by every room with
 * that visibility; only a narrower room gets its own. Room → group is
 * many-to-one, and which group a room uses is policy the server decides. This
 * layer does not know what a room is.
 */

/** One member's leaf, as the roster and the members screen need it. */
export interface Member {
  /** Leaf index in the ratchet tree. Stable until the tree is rebuilt. */
  leaf: number;
  /** The account this leaf speaks for, from its (already verified) certificate. */
  account: Uint8Array;
  /** The device's label — "laptop", "phone". Covered by the signature. */
  label: string;
}

/** Where a group currently is. Cheap to ask for; safe to poll. */
export interface GroupState {
  groupId: string;
  /** Advances by one per commit. Ordering, and the reason a stale reader fails. */
  epoch: number;
  /** Leaves, not people: three devices of one person are three leaves. */
  size: number;
  /** This device's own leaf. */
  ownLeaf: number;
}

/** What a commit produced. */
export interface CommitOutput {
  /** For everyone already in the group. */
  commit: Uint8Array;
  /** For whoever this commit added. Absent when it added nobody. */
  welcome?: Uint8Array;
  /**
   * The public ratchet tree at the epoch this commit produces.
   *
   * Always present, because the `ratchet_tree` extension is off — `docs/03` §5
   * rejects it and `docs/31` §2 has the reason: inlined, one join at 2,000
   * members costs 627 KiB of Welcome instead of 0.4 KiB.
   *
   * It comes out of the commit rather than out of the group afterwards, and
   * that ordering is the point. `commit` does not apply, so asking the group
   * for its tree here would hand back the *previous* epoch's. Publishing this
   * one alongside the commit is what stops a joiner racing the publish and
   * fetching a tree that does not match the Welcome it was given.
   */
  tree: Uint8Array;
}

/** The result of feeding the engine something that arrived. */
export type Incoming =
  | { kind: 'application'; sender: number; data: Uint8Array }
  | { kind: 'commit'; sender: number }
  | { kind: 'proposal' }
  | { kind: 'other' };

/** Who this device is, once a session is open. */
export interface Identity {
  /** The account id everyone else sees. */
  accountPublicKey: Uint8Array;
  /** This device's certificate, as MLS carries it. */
  certificate: Uint8Array;
}

export interface OpenOptions {
  /**
   * The account's 32-byte secret. Omit to generate a new account — after which
   * `exportAccountSecret` is the only chance to persist it.
   */
  accountSecret?: Uint8Array;
  /** Shown in the devices screen. Signed into the certificate, so it is fixed. */
  deviceLabel: string;
  /**
   * This device's stored signature secret. Omit to enrol a new device.
   *
   * Coming back **without** it is not a reload, it is a new device: a new leaf
   * in every group, and the old leaf still sitting in all of them. `docs/03`
   * §1 wants this stored durably so that "reloading the app does not require a
   * password" — which was Kith's biggest UX cliff.
   */
  deviceSecret?: Uint8Array;
}

/**
 * The one interface everything above the crypto talks to.
 *
 * ## Staging, then committing, then applying
 *
 * Three steps, and the seams between them are load-bearing:
 *
 * ```ts
 * await engine.stageAdd(groupId, keyPackages);
 * const out = await engine.commit(groupId);
 * await send(out);                       // the server may still refuse
 * await engine.applyPending(groupId);    // only now is it our state
 * ```
 *
 * `commit` does not apply. Applying before the server accepts **forks the
 * group**: this device reaches an epoch nobody else ever will, and every
 * message after it is unreadable by everyone, sender included. If the server
 * refuses, call `clearStaged` and the group has not moved.
 *
 * Staging exists because mls-rs batches — `docs/03` §5 specifies one commit for
 * a mass membership change rather than one per person.
 */
export interface CryptoEngine {
  /** Start a session. Everything else fails until this resolves. */
  open(options: OpenOptions): Promise<Identity>;

  /**
   * The account secret, for the caller to store.
   *
   * Separate from `open` and awkwardly named on purpose: it is the one value
   * whose loss cannot be recovered from (`docs/08`), and a call site that hands
   * it around should be visible in a grep.
   */
  exportAccountSecret(): Promise<Uint8Array>;

  /**
   * This device's signature secret, for the caller to store durably.
   *
   * Losing it does not lose the account. It costs a re-enrolment and a fresh
   * leaf in every group, which is visible to everyone else as a new device
   * appearing.
   */
  exportDeviceSecret(): Promise<Uint8Array>;

  /**
   * A key package: what someone else needs to add this device to a group.
   * **Single use** — the private half is erased once a join consumes it, so a
   * device needs a fresh one per pending invite.
   */
  keyPackage(): Promise<Uint8Array>;

  /** Open a new group. The id is whatever the server assigned. */
  createGroup(groupId: string): Promise<GroupState>;

  /**
   * Join from a Welcome and the matching ratchet tree.
   *
   * The group id comes out of the Welcome itself. The tree is required and
   * required at the right epoch: a Welcome carries the joiner's secrets and
   * nothing else, so without the public tree there is no group to join, and
   * with the wrong one the join fails rather than producing a device whose
   * roster silently disagrees with everyone else's.
   */
  joinGroup(welcome: Uint8Array, tree: Uint8Array): Promise<GroupState>;

  /** Which groups this session currently holds in memory. */
  groups(): Promise<string[]>;

  /** Where a group is now. */
  state(groupId: string): Promise<GroupState>;

  /** Everyone in the group. */
  members(groupId: string): Promise<Member[]>;

  /**
   * Stage one key package, or many, for the next commit. Returns how many
   * changes are now staged.
   *
   * The plural form exists because the round trips are real: staging 500
   * members one call at a time is 500 messages to the Worker, which eats a
   * chunk of the saving batching was supposed to buy (`docs/03` §5).
   */
  stageAdd(groupId: string, keyPackages: Uint8Array | Uint8Array[]): Promise<number>;

  /**
   * Stage one removal or many. This is what signing out a device, a kick and a
   * ban cost.
   */
  stageRemove(groupId: string, leaves: number | number[]): Promise<number>;

  /** Throw away staged changes — after the server refuses one, say. */
  clearStaged(groupId: string): Promise<void>;

  /**
   * Build one commit covering everything staged.
   *
   * Committing with nothing staged is legal and useful: it flushes proposals
   * the server appended as an external sender, which is exactly the
   * `COMMIT_REQUESTED` path in `docs/03` §5.
   *
   * Does not apply. See the note above.
   */
  commit(groupId: string): Promise<CommitOutput>;

  /** Adopt the commit this device built, once the server has accepted it. */
  applyPending(groupId: string): Promise<GroupState>;

  /** Encrypt an application message for a group. */
  encrypt(groupId: string, plaintext: Uint8Array): Promise<Uint8Array>;

  /** Feed the engine something that arrived for a group. */
  process(groupId: string, message: Uint8Array): Promise<Incoming>;

  /**
   * Release a group from memory, keeping its stored state.
   *
   * `loadGroup` brings it back. Use this to keep a session's footprint down
   * when someone has fifty rooms and is reading one.
   */
  forget(groupId: string): Promise<void>;

  /**
   * Release a group *and* drop its stored state.
   *
   * Still not a deletion on the server, and nobody is removed from anything —
   * this only forgets locally, and the group comes back from a Welcome.
   */
  discard(groupId: string): Promise<void>;

  // -- persistence ---------------------------------------------------------
  //
  // mls-rs persists synchronously and IndexedDB does not, so getting state out
  // is an explicit second step rather than a callback: ask what changed, seal
  // each one, write them at your own pace. Nothing is lost by the delay — a
  // group that never reached disk is re-fetched from the server, which is a
  // slow start rather than a lost room.
  //
  // With one exception, and it is sharp:
  //
  // **A new state must be durable before a ciphertext from it is sent.**
  // Sending advances this device's position in the secret tree, and the key and
  // nonce come from that position. Restore behind it and the next send
  // re-derives a key and nonce already used — two plaintexts under one AES-GCM
  // key and nonce, which is a total loss for both. The far side refuses the
  // message, which is how you would notice, but refusing does not undo it.

  /** Groups changed since they were last exported. */
  dirtyGroups(): Promise<string[]>;

  /**
   * One group's state, sealed, with its dirty flag cleared.
   *
   * What comes back is ciphertext — the local store never holds MLS key
   * material in the clear (`docs/04` §Client-side). If writing it fails, just
   * ask again; the state is still here.
   */
  exportGroup(groupId: string): Promise<Uint8Array>;

  /** Put a sealed group back. Returns the group id it turned out to be. */
  importGroup(sealed: Uint8Array): Promise<string>;

  /** Re-open a group whose state was put back with `importGroup`. */
  loadGroup(groupId: string): Promise<GroupState>;

  /**
   * Whether a key package has been published or consumed since the last
   * export.
   *
   * The private half of a published key package is what lets a Welcome be
   * opened. Publish one, close the tab, get added while away, and without it
   * the room is unreachable — a member of a group they cannot read, which is
   * worse than not having been added.
   */
  keyPackagesDirty(): Promise<boolean>;

  /** How many published key packages are still unused. */
  pendingKeyPackages(): Promise<number>;

  /** Seal the private halves of every unused key package. */
  exportKeyPackages(): Promise<Uint8Array>;

  /**
   * Put them back, **replacing** whatever is loaded. Returns how many.
   *
   * Replacing rather than merging: the stored copy is the authority on which
   * key packages are still unused, and merging would resurrect ones a join has
   * already consumed. A key package used twice costs the joiner forward
   * secrecy for the epoch they joined at.
   */
  importKeyPackages(sealed: Uint8Array): Promise<number>;

  /** End the session and release everything. The engine is unusable after. */
  close(): Promise<void>;
}
