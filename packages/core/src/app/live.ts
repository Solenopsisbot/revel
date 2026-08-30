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
  /** Shared, so an attachment is decrypted once per app rather than per view. */
  attachments?: Attachments;
}

class LiveConversation implements ConversationCore {
  #rooms: RoomSync;
  #files: Attachments;

  constructor(rooms: RoomSync, files: Attachments) {
    this.#rooms = rooms;
    this.#files = files;
  }

  room(roomId: string): RoomState {
    return this.#rooms.state(roomId);
  }

  timeline(roomId: string): Message[] {
    return this.#rooms.state(roomId).messages;
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
    // to time out on the other side.
    await this.#rooms.stopTyping(roomId);
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

  typing(roomId: string): TypingPerson[] {
    return this.#rooms.typing(roomId);
  }

  watchTyping(roomId: string, listener: (who: TypingPerson[]) => void): () => void {
    return this.#rooms.watchTyping(roomId, listener);
  }

  async setTyping(roomId: string, face?: FaceRef): Promise<void> {
    await this.#rooms.setTyping(roomId, face ? { face } : {});
  }

  async stopTyping(roomId: string): Promise<void> {
    await this.#rooms.stopTyping(roomId);
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

  constructor(options: LiveCoreOptions) {
    this.#transport = options.transport;
    this.#rooms = options.rooms;
    this.#groups = options.groups;
    this.#crypto = options.crypto;
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
    await this.refresh();
    return room;
  }

  async openGroupRoom(accounts: string[]): Promise<RoomInfo> {
    const room = await this.#transport.createGroupRoom(accounts);
    await this.refresh();
    return room;
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
    this.conversation = new LiveConversation(options.rooms, files);
    this.directory = new LiveDirectory(options);
    this.identity = new LiveIdentity(options.transport);
    this.connection = new LiveConnection(options.stream);
  }

  async close(): Promise<void> {
    await this.#rooms.close();
  }
}
