/**
 * The real `RevelCore`, over everything in this package.
 *
 * `core.ts` says what an app talks to; this is the one that actually talks to a
 * Host. It is thin on purpose — almost every method is one line — because the
 * work is already done underneath and the value here is the *shape*: named
 * operations instead of "send an event whose type happens to be `m.edit`", and
 * four interfaces instead of one object with ninety-four members.
 */
import type { CryptoEngine, Member } from '@revel/crypto';
import type {
  AccountProfile,
  BlobRef,
  DeviceInfo,
  FaceRef,
  RoomInfo,
  UpdateProfile,
} from '@revel/protocol';
import { Attachments } from '../blobs/attachments.js';
import type { Message, RoomState } from '../rooms/state.js';
import { type ThreadSummary, threadsIn } from '../rooms/threads.js';
import { type Hit, type Query, type SearchOptions, search } from '../search/search.js';
import type { RoomSync, TypingPerson } from '../sync/engine.js';
import type { GroupSync } from '../sync/groups.js';
import type { WebSocketStream } from '../sync/socket.js';
import type { Transport } from '../sync/transport.js';
import type {
  AttachMeta,
  ConnectionCore,
  ConnectionState,
  ConversationCore,
  DirectoryCore,
  IdentityCore,
  RevelCore,
  SendOptions,
} from './core.js';

export interface LiveCoreOptions {
  rooms: RoomSync;
  groups: GroupSync;
  crypto: CryptoEngine;
  transport: Transport;
  stream?: WebSocketStream;
  /** This device's account, so a thread can say whether you are in it. */
  account: string;
  /** Shared, so an attachment is decrypted once per app rather than per view. */
  attachments?: Attachments;
}

class LiveConversation implements ConversationCore {
  #rooms: RoomSync;
  #files: Attachments;
  #account: string;

  constructor(rooms: RoomSync, files: Attachments, account: string) {
    this.#rooms = rooms;
    this.#files = files;
    this.#account = account;
  }

  room(roomId: string): RoomState {
    return this.#rooms.state(roomId);
  }

  timeline(roomId: string): Message[] {
    // Branches are excluded here and shown as a summary on the parent. The fake
    // core did this and this did not, which is precisely the divergence one
    // interface with two implementations is supposed to make impossible — and
    // a test caught it, which is why the test drives the interface and not the
    // engine underneath.
    return this.#rooms.state(roomId).messages.filter((m) => !m.thread);
  }

  threadMessages(roomId: string, parentId: string): Message[] {
    return this.#rooms.state(roomId).messages.filter((m) => m.thread === parentId);
  }

  watch(roomId: string, listener: (state: RoomState) => void): () => void {
    return this.#rooms.watch(roomId, listener);
  }

  async open(roomId: string): Promise<RoomState> {
    const state = await this.#rooms.open(roomId);
    // Painted from local state first, filled in behind. `docs/29` §5's 300 ms
    // budget is for the first of those and says nothing about the second.
    void this.#rooms.catchUp(roomId).catch(() => {});
    this.#rooms.listen(roomId);
    return state;
  }

  backfill(roomId: string, limit?: number): Promise<RoomState> {
    return this.#rooms.backfill(roomId, limit);
  }

  /**
   * Send a message.
   *
   * Attachments arrive as already-uploaded refs, because a ref carries the key
   * and must therefore be inside the ciphertext. Uploading here instead would
   * read more tidily and would mean a failed upload had already put an
   * optimistic message in the timeline.
   */
  async send(roomId: string, body: unknown, options: SendOptions = {}): Promise<void> {
    await this.#rooms.send(roomId, {
      type: 'm.message',
      body,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.thread ? { thread: options.thread } : {}),
      ...(options.face ? { face: options.face } : {}),
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    });
    // Sending is the end of typing, and saying so beats waiting for the notice
    // to time out on the other side. In the same place it was sent — a reply
    // into a thread ends typing in the thread, not in the room.
    await this.#rooms.stopTyping(roomId, options.thread);
  }

  async edit(roomId: string, messageId: string, body: unknown): Promise<void> {
    await this.#rooms.send(roomId, { type: 'm.edit', target: messageId, body });
  }

  async redact(roomId: string, messageId: string, reason?: string): Promise<void> {
    // `silent`: stored, never notifies. A deletion must not buzz a phone.
    await this.#rooms.send(
      roomId,
      { type: 'm.redact', target: messageId, ...(reason ? { reason } : {}) },
      { class: 'silent' },
    );
  }

  async react(roomId: string, messageId: string, key: string, remove = false): Promise<void> {
    await this.#rooms.send(
      roomId,
      { type: 'm.reaction', target: messageId, key, ...(remove ? { remove: true } : {}) },
      { class: 'silent' },
    );
  }

  async pin(roomId: string, messageId: string, unpin = false): Promise<void> {
    await this.#rooms.send(
      roomId,
      { type: 'm.pin', target: messageId, ...(unpin ? { unpin: true } : {}) },
      { class: 'silent' },
    );
  }

  attach(roomId: string, bytes: Uint8Array, meta: AttachMeta): Promise<BlobRef> {
    return this.#files.upload(roomId, bytes, meta);
  }

  openAttachment(ref: BlobRef): Promise<Uint8Array> {
    return this.#files.open(ref);
  }

  threads(roomId: string): ThreadSummary[] {
    return threadsIn(this.#rooms.state(roomId), this.#account);
  }

  async nameThread(roomId: string, parentId: string, name: string): Promise<void> {
    await this.#rooms.nameThread(roomId, parentId, name);
  }

  typing(roomId: string, thread?: string): TypingPerson[] {
    return this.#rooms.typing(roomId, thread);
  }

  watchTyping(
    roomId: string,
    listener: (who: TypingPerson[]) => void,
    thread?: string,
  ): () => void {
    return this.#rooms.watchTyping(roomId, listener, thread);
  }

  async setTyping(
    roomId: string,
    options: { face?: FaceRef; thread?: string } = {},
  ): Promise<void> {
    await this.#rooms.setTyping(roomId, options);
  }

  async stopTyping(roomId: string, thread?: string): Promise<void> {
    await this.#rooms.stopTyping(roomId, thread);
  }

  unread(roomId: string): number {
    return this.#rooms.unread(roomId);
  }

  async markRead(roomId: string, upTo?: string): Promise<void> {
    await this.#rooms.markRead(roomId, upTo);
  }

  /**
   * Search every room this client has open.
   *
   * Rooms are passed in rather than looked up because what is searchable is a
   * policy question (`search.ts`), and "everything this client has decrypted"
   * is this layer's answer to it.
   */
  search(query: Query, options?: SearchOptions): Hit[] {
    return search(this.#rooms.openRooms(), query, options);
  }
}

class LiveDirectory implements DirectoryCore {
  #transport: Transport;
  #rooms: RoomSync;
  #groups: GroupSync;
  #crypto: CryptoEngine;
  #known: RoomInfo[] = [];
  #listeners = new Set<(rooms: RoomInfo[]) => void>();
  #account: string;

  constructor(options: LiveCoreOptions) {
    this.#transport = options.transport;
    this.#rooms = options.rooms;
    this.#groups = options.groups;
    this.#crypto = options.crypto;
    this.#account = options.account;
  }

  rooms(): RoomInfo[] {
    return this.#known;
  }

  async refresh(): Promise<RoomInfo[]> {
    this.#known = await this.#transport.listRooms();
    // Bound here rather than at open time: a `RoomInfo` carries the group id,
    // and it is the only thing that says which MLS group opens which
    // conversation. A client that skipped this could join a group and not know
    // what it had joined.
    for (const room of this.#known) {
      if (room.group) await this.#rooms.bind(room.id, room.group);
    }
    for (const listener of this.#listeners) listener(this.#known);
    return this.#known;
  }

  watchRooms(listener: (rooms: RoomInfo[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async openDm(who: { account?: string; address?: string }): Promise<RoomInfo> {
    const room = who.address
      ? await this.#transport.createDmWith(who.address)
      : await this.#transport.createDm(who.account as string);
    const started = await this.#start(room, room.members ?? []);
    await this.refresh();
    return started;
  }

  async openGroupRoom(accounts: string[]): Promise<RoomInfo> {
    const room = await this.#transport.createGroupRoom(accounts);
    const started = await this.#start(room, accounts);
    await this.refresh();
    return started;
  }

  /**
   * Give a brand-new room a group, and invite the people in it.
   *
   * **Without this, opening a conversation produces one nobody can use.** The
   * server creates a *room* — a membership list and a place for events — and
   * that is all it can do: it has no group secret and never will (`docs/03`
   * §5). Somebody has to create the MLS group and commit the other members in,
   * and it has to be a client, and it may as well be the one that just asked
   * for the room.
   *
   * Idempotent by the `room.group` check, because two devices opening the same
   * derived DM id at once is an ordinary race — the loser gets the winner's
   * room back from the server, already bound, and does nothing here.
   */
  async #start(room: RoomInfo, invite: string[]): Promise<RoomInfo> {
    if (room.group) {
      await this.#rooms.bind(room.id, room.group);
      this.#rooms.listen(room.id);
      return room;
    }

    // Key packages first: creating a group is useless if there is nothing on
    // the shelf for the people being invited to be added with.
    await this.#groups.replenish();
    const groupId = await this.#groups.create(room.id);
    await this.#rooms.bind(room.id, groupId);
    // **And listen.** Binding says which keys open this room; listening is what
    // makes the socket deliver into it. A caller that opened a conversation and
    // then had to remember to subscribe would eventually not, and the symptom
    // is "messages only appear when I switch rooms".
    this.#rooms.listen(room.id);

    const others = invite.filter((account) => account !== this.#account);
    if (others.length) await this.#groups.invite(groupId, others);

    return { ...room, group: groupId };
  }

  async addMembers(roomId: string, accounts: string[]): Promise<RoomInfo> {
    const room = await this.#transport.addMembers(roomId, accounts);
    // Membership is delivery, not access. Somebody added to the room can see it
    // exists and cannot read a word until a member commits them into the group,
    // so do that here rather than leaving a room full of people who cannot
    // read it.
    if (room.group) await this.#groups.invite(room.group, accounts);
    return room;
  }

  async leave(roomId: string): Promise<void> {
    const group = this.#known.find((r) => r.id === roomId)?.group;
    await this.#transport.leaveRoom(roomId);
    // The membership row and the MLS leaf are different things and only one is
    // the server's. Dropping the local group state is what stops this device
    // pretending it is still in a conversation it has left.
    if (group) await this.#groups.leave(group).catch(() => {});
    await this.refresh();
  }

  async roster(roomId: string): Promise<Member[]> {
    return this.#crypto.members(await this.#rooms.groupFor(roomId));
  }
}

class LiveIdentity implements IdentityCore {
  #transport: Transport;
  #account: AccountProfile | { id: string; handle: null } | null = null;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  account() {
    return this.#account;
  }

  async refreshAccount() {
    this.#account = await this.#transport.me();
    return this.#account;
  }

  async claimHandle(handle: string): Promise<AccountProfile> {
    const profile = await this.#transport.claimHandle(handle);
    this.#account = profile;
    return profile;
  }

  async updateProfile(patch: UpdateProfile): Promise<AccountProfile> {
    const profile = await this.#transport.updateProfile(patch);
    this.#account = profile;
    return profile;
  }

  resolve(address: string): Promise<AccountProfile> {
    return this.#transport.resolveAddress(address);
  }

  devices(): Promise<DeviceInfo[]> {
    return this.#transport.listDevices();
  }

  async revokeDevice(devicePub: string): Promise<void> {
    await this.#transport.revokeDevice(devicePub);
  }
}

class LiveConnection implements ConnectionCore {
  #stream: WebSocketStream | undefined;
  #status: ConnectionState = 'closed';
  #listeners = new Set<(status: ConnectionState) => void>();

  constructor(stream?: WebSocketStream) {
    this.#stream = stream;
  }

  /** Fed by whatever wired the stream's `onStatus`. */
  set(status: ConnectionState): void {
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
  }

  status(): ConnectionState {
    return this.#status;
  }

  watchStatus(listener: (status: ConnectionState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  reconnect(): void {
    this.#stream?.start();
  }
}

export class LiveCore implements RevelCore {
  readonly conversation: ConversationCore;
  readonly directory: DirectoryCore;
  readonly identity: IdentityCore;
  readonly connection: LiveConnection;

  #rooms: RoomSync;

  constructor(options: LiveCoreOptions) {
    const files = options.attachments ?? new Attachments({ transport: options.transport });
    this.#rooms = options.rooms;
    this.conversation = new LiveConversation(options.rooms, files, options.account);
    this.directory = new LiveDirectory(options);
    this.identity = new LiveIdentity(options.transport);
    this.connection = new LiveConnection(options.stream);
  }

  async close(): Promise<void> {
    await this.#rooms.close();
  }
}
