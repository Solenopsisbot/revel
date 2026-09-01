/**
 * What the server needs to persist.
 *
 * Deliberately an interface: the in-memory implementation lets the whole test
 * suite run with no database, which is how Kith kept 175 tests fast and
 * hermetic (`docs/29` §4). Postgres is the production implementation.
 *
 * Note what is absent — there is no `content` column anywhere. The server
 * stores opaque bytes and policy, nothing else (`docs/04` §1).
 */
import type {
  Event,
  HandshakeKind,
  HandshakeRecord,
  KeyPackageSupply,
  KeyPackageUpload,
  RoomKind,
} from '@revel/protocol';

export interface Room {
  id: string;
  /**
   * `docs/04` §1's `rooms.kind`. Decides what may be done to the membership: a
   * 1:1 DM's id is derived from exactly two accounts, so it can never gain a
   * third without the id describing something untrue.
   */
  kind: RoomKind;
  spaceId: string | null;
  /**
   * The MLS group whose keys open this room's events, or null before one
   * exists. Many-to-one: `docs/03` §4 gives a space one implicit "everyone"
   * audience and therefore one group shared by every room with that
   * visibility, and only a narrower room gets its own.
   */
  groupId: string | null;
  /** Whether a `stream` hint may be attached to events here (`docs/03` §7). */
  streamPaging: boolean;
  /** Whether a `notify` hint may be attached. */
  notifyHints: boolean;
  /**
   * The canonical audience key (`audienceKey()`), or null for a DM.
   *
   * Stored rather than recomputed because it is what `group_audiences` joins
   * on. Two spellings of the same rule would be two audiences, and the second
   * one written would get its own group for a room that should have shared one.
   */
  audience?: string | null;
}

export interface Membership {
  roomId: string;
  accountId: string;
  /** Role ids held in this room's space, `@everyone` included. */
  roleIds: string[];
}

export interface Space {
  id: string;
  /** `invite` / `link` / `public` (`docs/18`). */
  visibility: string;
}

export interface SpaceMember {
  spaceId: string;
  accountId: string;
  /** `@everyone` is not listed — it applies to every member by definition. */
  roleIds: string[];
}

export interface Role {
  id: string;
  spaceId: string;
  /** Permission bits, base-10 string — JSON has no bigint. */
  bits: string;
  position: number;
}

export interface Override {
  roomId: string;
  roleId: string;
  allow: string;
  deny: string;
}

export interface Device {
  /** The device's MLS signature public key, base64url. One identifier, not two. */
  pub: string;
  accountId: string;
  /** From the certificate, so it is covered by the account key's signature. */
  label: string;
  registeredAt: number;
  /** Set the moment it is signed out. Its sessions die with it (`docs/03` §3). */
  revokedAt: number | null;
}

/**
 * A challenge handed to a device, waiting to be signed.
 *
 * Single-use and short-lived. A nonce that can be spent twice is a signature
 * that can be replayed, and one that outlives its connection is a window for a
 * signature collected somewhere else.
 */
/**
 * `docs/04` §1's `accounts`, IdP role.
 *
 * The row is a *handle binding*, not the account: an account is a public key
 * and exists whether or not any IdP has heard of it. What lives here is the
 * name somebody chose and the profile they attached to it.
 */
export interface Account {
  /** The account public key. Stable; outlives any handle. */
  id: string;
  handle: string;
  displayName: string | null;
  avatar: string | null;
  status: 'active' | 'suspended';
  createdAt: number;
  movedTo: string | null;
}

/**
 * `docs/04` §1's `blobs`. Ciphertext, and metadata that is not a lie.
 *
 * No name, no MIME type, no dimensions: the server has never seen the
 * plaintext. `docs/22`'s "the blob store holds ciphertext with no filename or
 * type" is this row.
 */
export interface Blob {
  id: string;
  roomId: string;
  uploader: string;
  size: number;
  /** SHA-256 of the ciphertext. Integrity at rest, not end-to-end. */
  hash: string;
  createdAt: number;
  purgedAt: number | null;
}

/** `docs/04` §1's `push_subscriptions`. One per device; a new one replaces. */
export interface StoredPushSubscription {
  devicePub: string;
  kind: 'webpush' | 'apns' | 'fcm';
  endpoint: string;
  keys?: { p256dh: string; auth: string };
  createdAt: number;
}

export interface Challenge {
  devicePub: string;
  expiresAt: number;
}

/** A live session. Bound to a device, never to an account (`docs/03` §2). */
export interface Session {
  devicePub: string;
  accountId: string;
  expiresAt: number;
}

export interface Store {
  getRoom(id: string): Promise<Room | null>;

  /**
   * Create a room, or return the one already at that id.
   *
   * Idempotent because a 1:1 DM's id is derived from its two accounts
   * (`dmRoomId`), so two people opening each other at the same moment must end
   * up in one room rather than racing to create two. `created` is how the route
   * tells 201 from 200.
   */
  createRoom(room: Room, members: string[]): Promise<{ room: Room; created: boolean }>;

  /** Every room this account is a member of. What a cold client asks for first. */
  listAccountRooms(accountId: string): Promise<Room[]>;
  listRoomMembers(roomId: string): Promise<Membership[]>;
  addMember(roomId: string, accountId: string, roleIds?: string[]): Promise<void>;
  removeMember(roomId: string, accountId: string): Promise<void>;
  /**
   * Delete a room, its memberships, and its events.
   *
   * The events go because there is nothing else they could be for: they were
   * encrypted to this room and no other row references them. The **group does
   * not** — it may serve other rooms with the same audience (`docs/03` §4), and
   * tearing it down would take their history with it.
   *
   * Nothing here can un-send what members already hold. `docs/18` says so on
   * the button; this is the server's half of it.
   */
  deleteRoom(roomId: string): Promise<void>;

  getAccount(id: string): Promise<Account | null>;
  /**
   * Resolve a handle. Case-folded by the caller — the store compares bytes.
   *
   * `Viola` and `viola` being two accounts is an impersonation vector, so
   * folding happens once, at the edge, and everything below sees the folded
   * form. A store that folded too would be a second place to get it wrong.
   */
  getAccountByHandle(handle: string): Promise<Account | null>;
  /**
   * Bind a handle to an account, if nobody has it.
   *
   * Returns the existing binding when the handle is taken — including when it
   * is taken by the caller, which is how re-claiming your own handle is a
   * no-op rather than an error.
   */
  claimHandle(account: Account): Promise<{ account: Account; claimed: boolean }>;
  updateAccount(
    id: string,
    patch: Partial<Pick<Account, 'displayName' | 'avatar'>>,
  ): Promise<Account | null>;

  /**
   * Whether the server has ever seen this account.
   *
   * There is no `accounts` table yet — registration is phase 1 (`docs/06`) —
   * so an account exists exactly when a device has been enrolled for it. Good
   * enough for the one thing this is for: refusing to open a DM with a string
   * somebody typed wrong, rather than creating a room nobody can ever be in.
   */
  accountExists(accountId: string): Promise<boolean>;
  getMembership(roomId: string, accountId: string): Promise<Membership | null>;
  getRoles(spaceId: string, roleIds: string[]): Promise<Role[]>;
  getOverrides(roomId: string): Promise<Override[]>;
  isOwner(spaceId: string, accountId: string): Promise<boolean>;

  // -- spaces ----------------------------------------------------------------
  //
  // The tables under the permission model, which shipped in 001 and had
  // nothing above it that could create a space to use it.

  /**
   * Make a space, its owner, and its `@everyone` role, in one go.
   *
   * One call because they are one fact. A space with no owner cannot be
   * administered and a space with no `@everyone` gives its members no
   * permissions at all, so a partial failure leaves something nobody can use
   * and nobody can delete.
   */
  createSpace(input: {
    id: string;
    owner: string;
    /** `@everyone`'s permission bits, base-10. */
    everyoneBits: string;
  }): Promise<Space>;
  getSpace(spaceId: string): Promise<Space | null>;
  /** Spaces this account is a member of. */
  listAccountSpaces(accountId: string): Promise<Space[]>;
  listSpaceRooms(spaceId: string): Promise<Room[]>;

  /** Join, or update the roles of somebody already in. */
  putSpaceMember(spaceId: string, accountId: string, roleIds: string[]): Promise<void>;
  removeSpaceMember(spaceId: string, accountId: string): Promise<void>;
  getSpaceMember(spaceId: string, accountId: string): Promise<SpaceMember | null>;
  listSpaceMembers(spaceId: string): Promise<SpaceMember[]>;

  /** Every role in a space, for the editor. `getRoles` fetches a named few. */
  listRoles(spaceId: string): Promise<Role[]>;
  putRole(role: Role): Promise<void>;
  deleteRole(spaceId: string, roleId: string): Promise<void>;

  /**
   * The group serving an audience, created if this is the first room to want
   * it. Keyed on the audience *rule* — see `group_audiences` in migration 006.
   */
  groupForAudience(spaceId: string, audience: string): Promise<string | null>;
  bindAudience(spaceId: string, audience: string, groupId: string): Promise<void>;

  getDevice(pub: string): Promise<Device | null>;

  /**
   * Register a device, or return the one already there.
   *
   * Idempotent: a client that retries after a dropped response must not be
   * told its own device belongs to somebody else. Re-registering a *revoked*
   * device does not un-revoke it — signing out has to stay signed out, or
   * revocation is a suggestion.
   */
  registerDevice(device: Device): Promise<{ device: Device; created: boolean }>;
  revokeDevice(pub: string, at: number): Promise<boolean>;

  /**
   * Hand out a challenge. Keyed by the hash of the nonce, not the nonce:
   * a database that leaks should not hand out anything spendable.
   */
  putChallenge(nonceHash: string, challenge: Challenge): Promise<void>;
  /** Spend it. Single-use — this deletes as it reads (Kith's `DELETE … RETURNING`). */
  takeChallenge(nonceHash: string): Promise<Challenge | null>;

  /**
   * Store a device's push subscription, replacing any it had.
   *
   * One per device rather than a list: a device has one push channel, and
   * keeping stale ones means waking a browser profile somebody deleted.
   */
  putPushSubscription(subscription: StoredPushSubscription): Promise<void>;
  getPushSubscription(devicePub: string): Promise<StoredPushSubscription | null>;
  deletePushSubscription(devicePub: string): Promise<void>;

  putSession(tokenHash: string, session: Session): Promise<void>;
  getSession(tokenHash: string): Promise<Session | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Every session of one device, at once. What revocation means immediately. */
  deleteDeviceSessions(devicePub: string): Promise<void>;

  /**
   * Delete expired challenges and sessions. Returns how many rows went.
   *
   * Both tables clean themselves only on the read path, and the read that would
   * clean them is the one that never arrives: an abandoned sign-in never spends
   * its challenge, and a client holding an expired token does not present it
   * again. In memory that is a leak a restart fixes; in a database it is a
   * table that only grows, and this is the store meant to survive restarts.
   *
   * Called on a timer by the entrypoint. Safe to call concurrently and safe to
   * never call — nothing depends on it for correctness, because every read
   * already checks expiry itself.
   */
  sweepExpired(now: number): Promise<{ challenges: number; sessions: number }>;

  /**
   * Append an event. Returns the stored event, or the existing one when
   * `clientNonce` has already been used by this device — so a retry after a
   * dropped response cannot duplicate (`docs/04` §2).
   */
  appendEvent(e: Event): Promise<{ event: Event; deduped: boolean }>;
  listEvents(roomId: string, opts?: { before?: string; limit?: number }): Promise<Event[]>;
  /** Delete the bytes, keep the tombstone so clients can drop their copies. */
  purgeEvent(roomId: string, eventId: string): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Blobs (`docs/04` §1)
  // -------------------------------------------------------------------------

  /** Store ciphertext. The bytes and the row go together or neither does. */
  putBlob(blob: Blob, bytes: Uint8Array): Promise<Blob>;
  getBlob(id: string): Promise<Blob | null>;
  /** Null when the row exists and the bytes are gone — a purge, not a 404. */
  readBlob(id: string): Promise<Uint8Array | null>;
  /**
   * Drop the bytes, keep the row.
   *
   * Same shape as an event purge and for the same reason: a client that has
   * the ciphertext cached needs to be told it is gone, and a missing row
   * cannot tell it anything.
   */
  purgeBlob(id: string, at: number): Promise<boolean>;

  // -------------------------------------------------------------------------
  // The handshake surface (`docs/04` §1, Host role)
  // -------------------------------------------------------------------------

  /**
   * Every device enrolled to an account, so a claim can cover all their leaves.
   *
   * Live devices by default. The safe direction: a caller that forgets to
   * filter gives a revoked device a leaf in a group, which is the exact thing
   * revocation exists to prevent. The devices *screen* opts in to the full
   * list, because showing what you have signed out is most of its job.
   */
  listAccountDevices(accountId: string, opts?: { includeRevoked?: boolean }): Promise<Device[]>;

  /** Replace this device's shelf. Returns what it now holds. */
  publishKeyPackages(devicePub: string, upload: KeyPackageUpload): Promise<KeyPackageSupply>;
  keyPackageSupply(devicePub: string): Promise<KeyPackageSupply>;

  /**
   * Take one key package for `devicePub`, on behalf of `groupId`.
   *
   * **One store call on purpose.** Selecting a package and then deleting it in
   * two round trips is a race in which two concurrent adds hand out the same
   * one-time package, and a one-time package used twice is the forward secrecy
   * it exists to provide, gone. Postgres does this as a single
   * `DELETE … RETURNING` — Kith's pattern, already cited in `docs/04` §1 for
   * single-use tokens.
   *
   * Reuses an outstanding unconsumed claim rather than burning a second
   * package: a commit refused for an epoch conflict is retried, and a retry
   * loop that ate a package per attempt would be a way to drain somebody's
   * shelf (`docs/03` §5, the authorised-claim fix).
   */
  claimKeyPackage(devicePub: string, groupId: string): Promise<ClaimedPackage | null>;

  /** Groups this device currently has an unconsumed claim in. */
  hasClaim(groupId: string, devicePub: string): Promise<boolean>;

  getGroup(id: string): Promise<Group | null>;
  /** Create the group and bind `roomId` to it, atomically. */
  createGroup(id: string, roomId: string, creator: GroupMemberInput): Promise<Group>;
  /** Every room whose events this group's keys open. Group policy derives from these. */
  getGroupRooms(groupId: string): Promise<Room[]>;

  listGroupMembers(groupId: string): Promise<GroupMember[]>;
  getGroupMember(groupId: string, devicePub: string): Promise<GroupMember | null>;
  /** Record that a device did something, for the designated-committer ordering. */
  touchGroupMember(groupId: string, devicePub: string, at: number): Promise<void>;

  /**
   * Drop a device's own membership row.
   *
   * Not a removal — the leaf stays in the tree until a member commits one away,
   * and this cannot touch that. It is a device saying "I am not in this group",
   * which it knows because MLS told it so or because it lost its state.
   *
   * The reason this has to exist: the server skips devices it already lists
   * when claiming key packages, so without a way to clear the row, a person who
   * has been removed or whose session has diverged can never be added back.
   */
  leaveGroup(groupId: string, devicePub: string): Promise<void>;

  /**
   * Append to the handshake log, if and only if the epoch still matches.
   *
   * The atomicity is the point, and it is why the epoch check lives here
   * rather than in the route. Read-then-write across two calls is exactly the
   * commit race: both devices read epoch 4, both are told to go ahead, and the
   * group forks in a way that cannot be repaired — everyone after the fork
   * fails to decrypt, sender included.
   */
  appendHandshake(input: HandshakeAppend): Promise<HandshakeResult>;
  listHandshake(
    groupId: string,
    opts?: { since?: number; limit?: number },
  ): Promise<HandshakeRecord[]>;

  /**
   * This device's pending Welcomes, without consuming them.
   *
   * At-least-once, acknowledged, rather than take-and-clear. A Welcome removed
   * the moment it is handed to a socket is a Welcome lost if that socket dies
   * a millisecond later — and the failure is silent and permanent: the invited
   * device never learns it was invited, and the inviter's client believes it
   * succeeded. Re-delivering one that was already used costs nothing, because
   * a client that is already in the group just acks it.
   */
  listWelcomes(devicePub: string, groupId?: string): Promise<StoredWelcome[]>;
  ackWelcome(devicePub: string, groupId: string): Promise<void>;

  /** The public ratchet tree, kept out of band so Welcomes stay small. */
  putTree(groupId: string, epoch: number, tree: string): Promise<void>;
  getTree(groupId: string): Promise<{ epoch: number; tree: string } | null>;

  // -------------------------------------------------------------------------
  // Enrolment: OPAQUE, wraps, second factors (`docs/03` §3)
  // -------------------------------------------------------------------------

  /**
   * Create an enrolment, if the handle is free.
   *
   * Returns `null` when it is taken. Not an upsert: overwriting an enrolment
   * would let anybody who knows a handle replace the record and the wraps, and
   * "sign up with somebody else's handle" would be an account takeover with no
   * password involved at all.
   */
  createEnrolment(enrolment: Enrolment): Promise<Enrolment | null>;
  getEnrolment(handle: string): Promise<Enrolment | null>;
  getEnrolmentByAccount(accountPub: string): Promise<Enrolment | null>;

  /**
   * Replace one wrap, leaving the others.
   *
   * The whole reason the wraps are separate blobs: changing a password is one
   * write, and it must not disturb the recovery wrap (`docs/03` §1).
   */
  putWrap(accountPub: string, wrap: StoredWrap): Promise<void>;
  /** Every wrap an account has. Released only after a finished login. */
  wrapsFor(accountPub: string): Promise<StoredWrap[]>;
  /**
   * Remove one wrap. Only ever `passkey` — removing `password` or `recovery`
   * would leave an account with fewer ways back in than it needs.
   */
  deleteWrap(accountPub: string, kind: 'passkey'): Promise<void>;

  /** Replace the OPAQUE record. What a password change actually is, server-side. */
  putRegistrationRecord(accountPub: string, record: string): Promise<void>;

  /**
   * A login exchange in flight.
   *
   * OPAQUE is two round trips and the server holds state between them. Kept
   * here rather than in memory so it survives the process, short-lived because
   * a login half-finished an hour ago is not a login.
   */
  putLoginSession(id: string, session: LoginSession): Promise<void>;
  /** Single use — taken, not read, for the same reason a challenge is. */
  takeLoginSession(id: string): Promise<LoginSession | null>;

  /**
   * A device-handoff channel (`docs/03` §3's convenient case).
   *
   * The IdP relays and cannot read: what crosses it is sealed under a key it
   * never had. Short-lived, because a QR on a screen is not a durable thing —
   * and because a channel that outlived the moment would be a place to leave
   * something for a device that never came.
   */
  putChannel(id: string, channel: EnrolChannel): Promise<void>;
  getChannel(id: string): Promise<EnrolChannel | null>;
  /** Delivered exactly once, then gone. */
  deliverChannel(id: string, delivery: string): Promise<boolean>;
  takeChannel(id: string): Promise<EnrolChannel | null>;

  /** The account's second factor, if it has one. */
  getTotp(accountPub: string): Promise<TotpSecret | null>;
  putTotp(accountPub: string, secret: TotpSecret): Promise<void>;
  deleteTotp(accountPub: string): Promise<void>;
}

/** An account as the IdP knows it: a record it cannot invert, wraps it cannot open. */
export interface Enrolment {
  handle: string;
  accountPub: string;
  /** The OPAQUE registration record, base64. Opaque to us, permanently. */
  record: string;
  /**
   * `HKDF(RK, …)`, base64 — proof the holder knows the recovery code.
   *
   * Compared at recovery, never used to open anything. A dump of this table
   * yields verifiers, and a verifier neither opens a wrap nor inverts to a
   * code (see `revel-crypto/src/envelope.rs`).
   */
  recoveryVerifier: string;
  createdAt: number;
}

export interface StoredWrap {
  kind: 'password' | 'recovery' | 'passkey';
  blob: string;
  /** Argon2id salt, `recovery` only. Not secret. */
  salt?: string;
  /**
   * Proof that the caller holds the secret behind this wrap, for the wraps that
   * can be fetched without a password — `recovery` and `passkey`.
   *
   * `password` wraps have none and never will: that one is released by
   * finishing an OPAQUE login, which is a stronger check than comparing a hash
   * and does not need this.
   */
  verifier?: string;
}

export interface LoginSession {
  accountPub: string;
  handle: string;
  /** The server's half of the OPAQUE exchange, base64. */
  state: string;
  expiresAt: number;
}

export interface EnrolChannel {
  /** The new device's single-use transfer public key, base64. */
  transferPub: string;
  /** What the existing device delivered, JSON, or null while waiting. */
  delivery: string | null;
  expiresAt: number;
}

export interface TotpSecret {
  secret: string;
  /**
   * The highest counter step already spent, or null before the first use.
   *
   * This is what makes a code single-use. Without it a phished code stays valid
   * for its whole window, which is most of what a second factor is for.
   */
  lastCounter: number | null;
  /** Null until the first correct code proves the app was actually set up. */
  confirmedAt: number | null;
}

/**
 * A group, as the server knows it.
 *
 * `docs/04` §1 sketches a `designated_committer_device` column; there isn't
 * one, because the designated committer is "the online device that most
 * recently sent" (`docs/03` §5) and online-ness lives in the Hub, not the
 * database. Deriving it from `lastActiveAt` at read time cannot go stale;
 * a stored column can, and a nudge sent to a device that logged out an hour
 * ago is a group that quietly stops committing.
 */
export interface Group {
  id: string;
  epoch: number;
  pendingProposals: number;
}

export interface GroupMemberInput {
  devicePub: string;
  accountId: string;
}

export interface GroupMember extends GroupMemberInput {
  groupId: string;
  addedEpoch: number;
  /** Last event sent or handshake appended. Orders the committer fallback. */
  lastActiveAt: number;
}

export interface ClaimedPackage {
  keyPackage: string;
  lastResort: boolean;
}

export interface StoredWelcome {
  groupId: string;
  bytes: string;
  createdAt: number;
}

export interface HandshakeAppend {
  groupId: string;
  /** A member's device pub, or `server` for an external-sender proposal. */
  sender: string;
  kind: HandshakeKind;
  /** The epoch this was built from. Must equal the group's current epoch. */
  epoch: number;
  bytes: string;
  /** Rowed per device, and only for devices with an unconsumed claim. */
  welcome?: { bytes: string; devices: string[] };
  /**
   * The public tree at the new epoch, written in the same transaction.
   *
   * Separately would be a race: the Welcome is readable the instant the commit
   * is accepted, and a joiner that got there first would fetch the previous
   * epoch's tree and fail to join.
   */
  tree?: string;
  added?: GroupMemberInput[];
  removed?: string[];
  at: number;
}

export type HandshakeResult =
  | { accepted: true; record: HandshakeRecord; epoch: number }
  /** The epoch moved under this commit. `epoch` is where the group actually is. */
  | { accepted: false; reason: 'epoch_conflict'; epoch: number }
  /** A Welcome aimed at a device nobody claimed a key package for. */
  | { accepted: false; reason: 'unclaimed_welcome'; epoch: number; devices: string[] };
