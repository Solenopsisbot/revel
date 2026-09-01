/**
 * What an app talks to.
 *
 * `docs/33`: "When the real core lands, the work is swapping the fake core for
 * the real one behind the same interface. **If that turns out to be a large
 * change, the interface was wrong** — and finding that out costs one refactor
 * rather than a rewrite."
 *
 * It turned out to be a large change, and this file is the answer to why. The
 * fake core `apps/web` was built against is **one object with 94 members**,
 * mixing four unrelated things:
 *
 * 1. **Conversation** — messages, sending, reactions, typing, read state.
 * 2. **Directory** — which rooms and people exist, and how to open one.
 * 3. **Identity** — this account, its handle, its devices, its faces.
 * 4. **View state** — `replyTo`, `editing`, `membersOpen`, `profileFor`,
 *    `emojiTone`. Which is not core at all and must never move here: it is per
 *    window, it dies with the tab, and a headless agent host (`docs/06` phase
 *    4) has no opinion about whether a member list is open.
 *
 * A single object cannot be swapped behind "the same interface" because it was
 * never one interface. These are three, and the fourth stays where it is.
 *
 * ## What this is not
 *
 * Not a store, not reactive, and deliberately not Svelte-shaped. It exposes
 * plain reads and `watch` callbacks, and the app wraps whatever it likes around
 * them — `$state` in the web client, nothing at all in an agent host. A core
 * that knew about runes would be a core one platform could use.
 */
import type { Member } from '@revel/crypto';
import type {
  AccountProfile,
  BlobRef,
  CreateSpaceRoom,
  DeviceInfo,
  FaceRef,
  RoleInfo,
  RoleInput,
  RoomInfo,
  SpaceInfo,
  InviteInfo,
  InvitePreview,
  SpaceMemberInfo,
  UpdateProfile,
} from '@revel/protocol';
import type { Message, RoomState } from '../rooms/state.js';
import type { ThreadSummary } from '../rooms/threads.js';
import type { Hit, Query, SearchOptions } from '../search/search.js';
import type { TypingPerson } from '../sync/engine.js';

/** Everything about one conversation. */
export interface ConversationCore {
  /**
   * The room as it stands, without touching the network.
   *
   * Synchronous because the cold-open budget is 300 ms to a painted room
   * (`docs/29` §5) and a promise here would mean a spinner on every room
   * switch. What is not loaded yet is empty, not pending.
   */
  room(roomId: string): RoomState;
  /**
   * The room's own timeline, in order.
   *
   * **Thread replies are not in it.** `docs/16`: a thread is a branch inside a
   * room, and the room shows that a branch happened rather than what is in it.
   * Use [`threadMessages`] for the branch.
   */
  timeline(roomId: string): Message[];
  /** One thread's replies, oldest first. The parent stays in the room. */
  threadMessages(roomId: string, parentId: string): Message[];
  watch(roomId: string, listener: (state: RoomState) => void): () => void;

  /** Load from the local store, then catch up in the background. */
  open(roomId: string): Promise<RoomState>;
  /** Page backwards. Somebody scrolling, as distinct from being behind. */
  backfill(roomId: string, limit?: number): Promise<RoomState>;

  send(roomId: string, body: unknown, options?: SendOptions): Promise<void>;
  edit(roomId: string, messageId: string, body: unknown): Promise<void>;
  /** In-band, and carries a reason. The bytes go separately (`docs/04` §2). */
  redact(roomId: string, messageId: string, reason?: string): Promise<void>;
  react(roomId: string, messageId: string, key: string, remove?: boolean): Promise<void>;
  pin(roomId: string, messageId: string, unpin?: boolean): Promise<void>;

  /** Attach a file. Sealed and uploaded before the message is sent. */
  attach(roomId: string, bytes: Uint8Array, meta: AttachMeta): Promise<BlobRef>;
  /** Fetch and decrypt one. Cached by blob id. */
  openAttachment(ref: BlobRef): Promise<Uint8Array>;

  /**
   * Threads in a room, newest activity first.
   *
   * Derived from the messages rather than stored beside them, so a reply that
   * arrives or is redacted updates the summary by existing or not existing.
   * `joined` is what a "your threads" list filters on — every branch anybody
   * ever started is a list nobody reads.
   */
  threads(roomId: string): ThreadSummary[];
  /** Give a thread a name. Anyone in the room may; last writer wins. */
  nameThread(roomId: string, parentId: string, name: string): Promise<void>;

  /**
   * Send a failed message again, or give up on it.
   *
   * Keyed by client nonce rather than by message id, because a message that
   * never reached the server has no id — the nonce is the only name it has.
   */
  retry(roomId: string, clientNonce: string): Promise<void>;
  discard(roomId: string, clientNonce: string): Promise<void>;

  /**
   * Who is typing. `thread` narrows it to one branch.
   *
   * A room and each of its threads are separate places: somebody typing in a
   * branch is not typing in the room.
   */
  typing(roomId: string, thread?: string): TypingPerson[];
  watchTyping(roomId: string, listener: (who: TypingPerson[]) => void, thread?: string): () => void;
  /** Safe to call per keystroke; the throttle is inside, and it is per place. */
  setTyping(roomId: string, options?: { face?: FaceRef; thread?: string }): Promise<void>;
  stopTyping(roomId: string, thread?: string): Promise<void>;

  unread(roomId: string): number;
  markRead(roomId: string, upTo?: string): Promise<void>;

  /** Local-only, because the server is the search adversary (`docs/03`). */
  /**
   * Say who is here again, because the group's keys moved.
   *
   * The roster is announced once per room per session, which is right while a
   * group is stable and wrong the moment somebody joins — their leaf did not
   * exist at the epoch the announcement was encrypted to, so they arrive to an
   * empty member list. Called by whoever committed the new leaf.
   */
  reannounceFaces(roomIds: string[]): Promise<void>;

  search(query: Query, options?: SearchOptions): Hit[];
}

export interface SendOptions {
  replyTo?: string;
  /** The message this branches off (`docs/16`: a branch, not a room). */
  thread?: string;
  face?: FaceRef;
  attachments?: BlobRef[];
}

export interface AttachMeta {
  mime: string;
  name: string;
  alt?: string;
}

/** Which rooms and people exist, and how to start something. */
export interface DirectoryCore {
  /** Every room this account is in, as last fetched. */
  rooms(): RoomInfo[];
  /** Ask the server. What a cold client does first, and after a reconnect. */
  refresh(): Promise<RoomInfo[]>;
  watchRooms(listener: (rooms: RoomInfo[]) => void): () => void;

  /**
   * Open a DM by key or by name.
   *
   * Idempotent: the id is derived from the pair (`docs/03` §4), so both people
   * opening each other at once get one room.
   */
  openDm(who: { account?: string; address?: string }): Promise<RoomInfo>;
  openGroupRoom(accounts: string[]): Promise<RoomInfo>;
  addMembers(roomId: string, accounts: string[]): Promise<RoomInfo>;
  /**
   * Take somebody else out of a group DM, and out of the group.
   *
   * Both halves matter and they are different things: the membership row is
   * delivery, the MLS Remove is access. Doing only the first leaves somebody
   * who cannot be sent to and can still read anything a member forwards them.
   */
  removeMember(roomId: string, account: string): Promise<void>;

  // -- spaces ----------------------------------------------------------------
  //
  // `docs/06` phase 3. A space is a room's *container* and an audience's
  // authority: the server resolves who may see what from its roles, and the
  // client turns that into MLS groups (`docs/03` §4).

  /**
   * Commit anyone the Host says is a member but the group has never heard of.
   *
   * The half a membership row cannot do, done by whoever notices first — which
   * is what makes an invite *link* work at all, since nobody is present to
   * commit the person who followed it. Safe to run on every client at once.
   */
  reconcileGroups(): Promise<void>;
  spaces(): Promise<SpaceInfo[]>;
  /** Makes it, gives it a `#general`, and names it — `docs/18`, no wizard. */
  createSpace(name: string, colour?: string): Promise<SpaceInfo>;
  nameSpace(spaceId: string, name: string, colour?: string): Promise<void>;
  spaceRooms(spaceId: string): Promise<RoomInfo[]>;
  /**
   * Makes the room, and its group if this audience does not have one yet.
   *
   * `name` is not part of `CreateSpaceRoom` and never will be: it is an
   * encrypted event, so it cannot be sent until the room has a group to encrypt
   * it to. Accepting it here means one call rather than two and one fewer way
   * to end up with an unnamed room.
   */
  createSpaceRoom(
    spaceId: string,
    input?: CreateSpaceRoom & { name?: string; topic?: string },
  ): Promise<RoomInfo>;
  /** Name a room, and set its topic. Both ride one `room.name` event. */
  nameRoom(roomId: string, name: string, topic?: string): Promise<void>;
  /**
   * Delete a room and everything encrypted to it. `MANAGE_ROOMS`.
   *
   * Leaves the MLS group alone — it may serve sibling rooms with the same
   * audience, and tearing it down would take their history too.
   */
  deleteSpaceRoom(spaceId: string, roomId: string): Promise<void>;
  spaceMembers(spaceId: string): Promise<SpaceMemberInfo[]>;
  /** Adds them to the space *and* commits them into the groups its rooms use. */
  inviteToSpace(spaceId: string, accounts: string[]): Promise<void>;
  leaveSpace(spaceId: string): Promise<void>;
  /** A kick. Drops the membership row *and* removes their leaves from the groups. */
  removeFromSpace(spaceId: string, account: string): Promise<void>;

  // -- invite links (`docs/03` §4 — the Wormhole trick) ----------------------

  /**
   * Make one. The private half comes back to you and belongs in a URL
   * fragment; it must never be sent anywhere, which is the whole trick.
   */
  createInvite(
    spaceId: string,
    options?: { maxUses?: number; ttl?: number },
  ): Promise<{ invite: InviteInfo; secret: string }>;
  listInvites(spaceId: string): Promise<InviteInfo[]>;
  revokeInvite(spaceId: string, code: string): Promise<void>;
  /** Unauthenticated: a link is something you follow before you have an account. */
  previewInvite(code: string): Promise<InvitePreview>;
  /** Prove the fragment and take the membership. Keys come later, from a member. */
  redeemInvite(code: string, secret: string): Promise<{ space: string; joined: boolean }>;

  spaceRoles(spaceId: string): Promise<RoleInfo[]>;
  /**
   * Make a role.
   *
   * `name` and `colour` are not `RoleInput` because they are not the Host's:
   * it holds the bits it enforces and has never been told what the role is
   * called (`space.roles`). Taking both here is what stops a role existing
   * without a name.
   */
  createRole(
    spaceId: string,
    input: RoleInput & { name: string; colour?: string },
  ): Promise<RoleInfo>;
  updateRole(
    spaceId: string,
    roleId: string,
    input: RoleInput & { name?: string; colour?: string },
  ): Promise<RoleInfo>;
  deleteRole(spaceId: string, roleId: string): Promise<void>;
  /** Say what every role in a space is called. Whole list, last writer wins. */
  nameRoles(spaceId: string, roles: { id: string; name: string; colour?: string }[]): Promise<void>;
  setMemberRoles(spaceId: string, account: string, roles: string[]): Promise<void>;
  /** Yourself only. Does not take your keys back — a member must commit that. */
  leave(roomId: string): Promise<void>;

  /**
   * Who actually holds this room's keys.
   *
   * The MLS roster, not the membership list. They differ, and the difference is
   * the whole architecture: the server can add somebody to a room and cannot
   * give them the keys.
   */
  roster(roomId: string): Promise<Member[]>;
}

/** This account, and the devices that speak for it. */
export interface IdentityCore {
  account(): AccountProfile | { id: string; handle: null } | null;
  refreshAccount(): Promise<AccountProfile | { id: string; handle: null }>;
  claimHandle(handle: string): Promise<AccountProfile>;
  updateProfile(patch: UpdateProfile): Promise<AccountProfile>;
  /** Look somebody up. `viola` or `viola@revel.chat`. */
  resolve(address: string): Promise<AccountProfile>;
  /**
   * Look somebody up by account key.
   *
   * What a room needs: its membership is a list of keys, so naming the people
   * in it means asking what each key is called. `resolve` goes the other way,
   * for when somebody typed a name.
   */
  lookup(accountPub: string): Promise<AccountProfile>;

  devices(): Promise<DeviceInfo[]>;
  /** Sign one out. Its sessions and push channel die immediately (`docs/03` §3). */
  revokeDevice(devicePub: string): Promise<void>;
}

export type ConnectionState = 'connecting' | 'open' | 'closed';

/** Whether the live socket is up. Not whether the network is. */
export interface ConnectionCore {
  status(): ConnectionState;
  watchStatus(listener: (status: ConnectionState) => void): () => void;
  /** Reconnect now, rather than waiting out the backoff. */
  reconnect(): void;
}

/**
 * The whole thing.
 *
 * Composed rather than inherited so a caller can hold one slice: an agent host
 * wants conversation and directory and has no use for a connection indicator,
 * and a settings screen wants identity and nothing else.
 */
export interface RevelCore {
  readonly conversation: ConversationCore;
  readonly directory: DirectoryCore;
  readonly identity: IdentityCore;
  readonly connection: ConnectionCore;
  close(): Promise<void>;
}
