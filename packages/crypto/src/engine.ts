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
   * A key package: what someone else needs to add this device to a group.
   * **Single use** — the private half is erased once a join consumes it, so a
   * device needs a fresh one per pending invite.
   */
  keyPackage(): Promise<Uint8Array>;

  /** Open a new group. The id is whatever the server assigned. */
  createGroup(groupId: string): Promise<GroupState>;

  /** Join from a Welcome. The group id comes out of the Welcome itself. */
  joinGroup(welcome: Uint8Array): Promise<GroupState>;

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
   * Drop a group from memory. Not a deletion — nothing on the server changes
   * and nothing is revoked. This only releases what the session is holding.
   */
  forget(groupId: string): Promise<void>;

  /** End the session and release everything. The engine is unusable after. */
  close(): Promise<void>;
}
