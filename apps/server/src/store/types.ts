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
}

export interface Membership {
  roomId: string;
  accountId: string;
  /** Role ids held in this room's space, `@everyone` included. */
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

  putSession(tokenHash: string, session: Session): Promise<void>;
  getSession(tokenHash: string): Promise<Session | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Every session of one device, at once. What revocation means immediately. */
  deleteDeviceSessions(devicePub: string): Promise<void>;

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
