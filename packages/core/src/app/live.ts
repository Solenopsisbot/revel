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
import {
  type AccountProfile,
  type BlobRef,
  type CreateSpaceRoom,
  type DeviceInfo,
  type FaceCard,
  type FaceRef,
  type RoleInfo,
  type RoleInput,
  type RoomInfo,
  type SpaceInfo,
  type SpaceMemberInfo,
  toAccountId,
  type UpdateProfile,
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
  /**
   * Which face speaks in a room, if this account has any.
   *
   * A function rather than a value because the answer is per room and changes
   * while the app runs — and because a core that *owned* the face book would
   * have to own its storage too, which belongs with the session rather than
   * with the sync engines.
   */
  faceFor?: (roomId: string) => FaceCard | undefined;
}

class LiveConversation implements ConversationCore {
  #rooms: RoomSync;
  #files: Attachments;
  #account: string;
  #faceFor: ((roomId: string) => FaceCard | undefined) | undefined;
  /** Rooms already told about a face, so the roster is announced once. */
  #announced = new Set<string>();

  constructor(
    rooms: RoomSync,
    files: Attachments,
    account: string,
    faceFor?: (roomId: string) => FaceCard | undefined,
  ) {
    this.#rooms = rooms;
    this.#files = files;
    this.#account = account;
    this.#faceFor = faceFor;
  }

  /**
   * Tell the room this face exists, once.
   *
   * `docs/03` §7: the roster is a **per-room encrypted state event**, which is
   * how a plural system's members stay invisible to the Host and visible to the
   * room. Without it a face arrives only as a snapshot on a message, and a
   * device that joins later has no roster to render a member list from.
   *
   * Once per room per session, keyed by both — announcing on every message
   * would put a state event between every pair of messages, and announcing once
   * globally would miss the next room.
   */
  async #announceFace(roomId: string, face: FaceCard): Promise<void> {
    const key = `${roomId}:${face.id}`;
    if (this.#announced.has(key)) return;
    this.#announced.add(key);
    // `silent`: a roster change is not something to wake a phone for.
    await this.#rooms
      .send(roomId, { type: 'room.faces', faces: [face] }, { class: 'silent' })
      .catch(() => {
        // Failing to announce must not fail the message. The face is still on
        // the message itself, so the room can render it; the roster catches up
        // on the next send.
        this.#announced.delete(key);
      });
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

    // Say who is here, on arrival rather than on the first message.
    //
    // The roster is `room.faces` and nothing else writes it (`docs/03` §7), so
    // a room announced only on send reads "In this room — 0" to the person
    // standing in it — which is exactly what a new space looks like, and reads
    // as broken rather than as empty. Being in a room is the thing being
    // claimed, and opening it is when that becomes true.
    //
    // `#announceFace` is once per room per session, so this costs one silent
    // state event the first time and nothing afterwards.
    const face = this.#faceFor?.(roomId);
    if (face) void this.#announceFace(roomId, face);
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
    // The face this room is being spoken in, unless the caller named one.
    // Stamped onto the message rather than looked up later: `docs/04` §2 makes
    // it a snapshot, which is why renaming a face does not silently rewrite
    // every message it ever sent.
    const card = options.face ?? this.#faceFor?.(roomId);
    if (card) await this.#announceFace(roomId, card);
    // The roster gets the card, the message gets the ref. The note is profile
    // data that belongs on `room.faces`, once per face per room, not on every
    // message forever — see `FaceCard`.
    const face = card && refOnly(card);

    await this.#rooms.send(roomId, {
      type: 'm.message',
      body,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.thread ? { thread: options.thread } : {}),
      ...(face ? { face } : {}),
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    });
    // Sending is the end of typing, and saying so beats waiting for the notice
    // to time out on the other side. In the same place it was sent — a reply
    // into a thread ends typing in the thread, not in the room.
    await this.#rooms.stopTyping(roomId, options.thread);
  }

  async retry(roomId: string, clientNonce: string): Promise<void> {
    await this.#rooms.retry(roomId, clientNonce);
  }

  async discard(roomId: string, clientNonce: string): Promise<void> {
    await this.#rooms.discard(roomId, clientNonce);
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
    options: { face?: FaceCard; thread?: string } = {},
  ): Promise<void> {
    // Same default as `send`. A typing notice that arrived facelessly while the
    // message that followed it wore a face would show the room two different
    // people for one person's sentence.
    const card = options.face ?? this.#faceFor?.(roomId);
    const face = card && refOnly(card);
    await this.#rooms.setTyping(roomId, { ...options, face });
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

  // -- spaces ----------------------------------------------------------------

  spaces(): Promise<SpaceInfo[]> {
    return this.#transport.spaces();
  }

  /**
   * Make a space, name it, and give it somewhere to talk.
   *
   * `docs/18`: "A new space arrives with `#general`, an `@everyone` role, one
   * audience, and you in it. No wizard." The role and the audience are the
   * server's; the room and the name are this.
   *
   * The name is an encrypted event, not a column — `docs/04` §1 keeps names off
   * the server, and a community's name is more identifying than any one room's.
   * It goes into the `everyone` room, the only audience every member is in.
   */
  async createSpace(name: string, colour?: string): Promise<SpaceInfo> {
    const space = await this.#transport.createSpace();
    // Named here, not left to the caller: `docs/18` promises the room arrives
    // *as* `#general`, and a room with no `room.name` renders as "untitled".
    const general = await this.createSpaceRoom(space.id, { name: 'general' });
    await this.#rooms.send(general.id, {
      type: 'space.name',
      space: space.id,
      name,
      ...(colour ? { colour } : {}),
    });
    await this.refresh();
    return space;
  }

  /** Rename a space. Same event, same room, last writer wins. */
  async nameSpace(spaceId: string, name: string, colour?: string): Promise<void> {
    const target = await this.#everyoneRoom(spaceId);
    await this.#rooms.send(target.id, {
      type: 'space.name',
      space: spaceId,
      name,
      ...(colour ? { colour } : {}),
    });
  }

  spaceRooms(spaceId: string): Promise<RoomInfo[]> {
    return this.#transport.spaceRooms(spaceId);
  }

  /**
   * Make a room in a space, and open it.
   *
   * `#start` does the rest: if the audience already has a group, the room is
   * bound to it and nothing is committed — which is why a twelve-room space is
   * one commit and not twelve (`docs/03` §4). If it does not, this is the
   * client that creates it, and everybody the audience covers is invited.
   */
  async createSpaceRoom(
    spaceId: string,
    input: CreateSpaceRoom & { name?: string; topic?: string } = {},
  ): Promise<RoomInfo> {
    const { name, topic, ...wire } = input;
    const room = await this.#transport.createSpaceRoom(spaceId, wire);
    const started = await this.#start(room, room.members ?? []);
    // After `#start`, never before: the name is an encrypted event and there is
    // no group to encrypt it to until the room has been bound to one.
    if (name) await this.nameRoom(started.id, name, topic);
    await this.refresh();
    return started;
  }

  /**
   * Delete a room, and forget it locally.
   *
   * The MLS group is *not* torn down: sibling rooms with the same audience use
   * it (`docs/03` §4), and leaving it would take their history with it. When
   * this was the only room using the group it simply goes unreferenced, which
   * costs a row and loses nothing.
   */
  async deleteSpaceRoom(spaceId: string, roomId: string): Promise<void> {
    await this.#transport.deleteSpaceRoom(spaceId, roomId);
    await this.#rooms.forget(roomId);
    await this.refresh();
  }

  /** Name a room. `room.name` carries the topic too, so both move together. */
  async nameRoom(roomId: string, name: string, topic?: string): Promise<void> {
    await this.#rooms.send(roomId, {
      type: 'room.name',
      name,
      ...(topic ? { topic } : {}),
    });
  }

  spaceMembers(spaceId: string): Promise<SpaceMemberInfo[]> {
    return this.#transport.spaceMembers(spaceId);
  }

  /**
   * Invite people to a space, and into the groups its rooms already use.
   *
   * Two halves, and only the first is the server's. Membership is delivery;
   * until a member's client commits the newcomer into each room's MLS group
   * they can see the rooms exist and cannot read a word (`docs/03` §5). Doing
   * it here rather than leaving it to whoever opens a room next is the
   * difference between "they joined" and "they joined and it worked".
   */
  async inviteToSpace(spaceId: string, accounts: string[]): Promise<void> {
    await this.#transport.inviteToSpace(spaceId, accounts);

    // One commit per *group*, not per room. Rooms sharing an audience share a
    // group, so a twelve-room space with one audience is one invite.
    const groups = new Set<string>();
    for (const room of await this.#transport.spaceRooms(spaceId)) {
      if (room.group) groups.add(room.group);
    }
    for (const groupId of groups) {
      await this.#groups.invite(groupId, accounts);
    }

    await this.#reannounce(spaceId);
    await this.refresh();
  }

  /**
   * Say everything a space is *called*, again, after a commit.
   *
   * MLS keys move forward, so somebody who has just joined cannot read a word
   * sent before their leaf existed — including the `space.name` from the day
   * the space was made. Without this they arrive in a space with no name, no
   * named rooms and no named roles, and no way to ever learn any of them.
   * `room.faces` has the same shape for the same reason.
   *
   * Read from local state rather than passed in: whoever is inviting already
   * knows what things are called, and asking the caller to supply it all would
   * make forgetting it the default.
   */
  async #reannounce(spaceId: string): Promise<void> {
    const known = this.#knownSpaceName(spaceId);
    if (known) await this.nameSpace(spaceId, known.name, known.colour);

    const named = this.#knownRoleNames(spaceId);
    if (named.size) {
      await this.nameRoles(
        spaceId,
        [...named].map(([id, r]) => ({ id, ...r })),
      );
    }

    // Room names are per room, and a room the newcomer cannot see is a room
    // this send would fail on — so only the ones they are actually in.
    for (const room of await this.#transport.spaceRooms(spaceId)) {
      const state = this.#rooms.state(room.id);
      if (!state.name) continue;
      await this.nameRoom(room.id, state.name, state.topic);
    }
  }

  /** What this client currently believes a space is called. */
  #knownSpaceName(spaceId: string): { name: string; colour?: string } | null {
    for (const room of this.#known) {
      if (room.space !== spaceId) continue;
      const state = this.#rooms.state(room.id);
      if (state.spaceName) {
        return {
          name: state.spaceName,
          ...(state.spaceColour ? { colour: state.spaceColour } : {}),
        };
      }
    }
    return null;
  }

  async leaveSpace(spaceId: string): Promise<void> {
    await this.removeFromSpace(spaceId, this.#account);
  }

  /**
   * Take someone out of a space — a kick, or your own exit.
   *
   * The membership row is delivery and the MLS Remove is access, and only the
   * second one takes the keys away (`docs/03` §5). Removing the row alone means
   * a kicked member keeps reading every message their client is still handed,
   * which is the whole reason this does both.
   *
   * Every group the space uses, and every leaf that account holds — a person is
   * as many leaves as they have devices, and removing three of four removes
   * nothing.
   */
  async removeFromSpace(spaceId: string, account: string): Promise<void> {
    const rooms = await this.#transport.spaceRooms(spaceId);
    await this.#transport.leaveSpace(spaceId, account);

    const mine = account === this.#account;
    const groups = new Set<string>();
    for (const room of rooms) if (room.group) groups.add(room.group);

    for (const groupId of groups) {
      if (mine) {
        // Leaving my own space: drop the local group state rather than trying
        // to commit a Remove against keys I am about to stop holding.
        await this.#groups.leave(groupId).catch((err) => {
          console.error(`revel: could not leave group ${groupId}`, err);
        });
        continue;
      }
      const leaves = (await this.#crypto.members(groupId).catch(() => []))
        .filter((m) => toAccountId(m.account) === account)
        .map((m) => m.leaf);
      if (leaves.length) await this.#groups.remove(groupId, leaves);
    }
    await this.refresh();
  }

  spaceRoles(spaceId: string): Promise<RoleInfo[]> {
    return this.#transport.spaceRoles(spaceId);
  }

  /**
   * Make a role, and say what it is called.
   *
   * Two writes because they go to two different places: the bits are policy
   * and the Host enforces them, the name is a word about a community and the
   * Host never sees it (`space.roles`). Doing both here rather than asking
   * every caller to remember the second one is what stops a role existing
   * without a name.
   */
  async createRole(
    spaceId: string,
    input: RoleInput & { name: string; colour?: string },
  ): Promise<RoleInfo> {
    const { name, colour, ...wire } = input;
    const role = await this.#transport.createRole(spaceId, wire);
    await this.#renameRoles(spaceId, (named) => {
      named.set(role.id, { name, ...(colour ? { colour } : {}) });
    });
    return role;
  }

  async updateRole(
    spaceId: string,
    roleId: string,
    input: RoleInput & { name?: string; colour?: string },
  ): Promise<RoleInfo> {
    const { name, colour, ...wire } = input;
    const role = await this.#transport.updateRole(spaceId, roleId, wire);
    if (name !== undefined || colour !== undefined) {
      await this.#renameRoles(spaceId, (named) => {
        const was = named.get(roleId);
        named.set(roleId, {
          name: name ?? was?.name ?? roleId,
          ...(colour ?? was?.colour ? { colour: colour ?? was?.colour } : {}),
        });
      });
    }
    return role;
  }

  async deleteRole(spaceId: string, roleId: string): Promise<void> {
    await this.#transport.deleteRole(spaceId, roleId);
    // Drop the name in the same breath. A `space.roles` list that still names a
    // role nobody holds is a name that outlives its role forever — the event is
    // whole-list last-writer-wins precisely so this is one send, not a tombstone.
    await this.#renameRoles(spaceId, (named) => {
      named.delete(roleId);
    });
  }

  /** Say what every role in a space is called. Whole list, last writer wins. */
  async nameRoles(
    spaceId: string,
    roles: { id: string; name: string; colour?: string }[],
  ): Promise<void> {
    const target = await this.#everyoneRoom(spaceId);
    await this.#rooms.send(target.id, { type: 'space.roles', space: spaceId, roles });
  }

  /** Read the current names, apply an edit, send the whole list back. */
  async #renameRoles(
    spaceId: string,
    edit: (named: Map<string, { name: string; colour?: string }>) => void,
  ): Promise<void> {
    const named = this.#knownRoleNames(spaceId);
    edit(named);
    await this.nameRoles(
      spaceId,
      [...named].map(([id, r]) => ({ id, ...r })),
    );
  }

  /** What this client currently believes the roles in a space are called. */
  #knownRoleNames(spaceId: string): Map<string, { name: string; colour?: string }> {
    for (const room of this.#known) {
      if (room.space !== spaceId) continue;
      const state = this.#rooms.state(room.id);
      if (state.spaceRoles.size) return new Map(state.spaceRoles);
    }
    return new Map();
  }

  /**
   * The room a space's shared facts go in.
   *
   * The `everyone` audience is the only group every member of the space is in,
   * so it is the only room where a name reaches all of them (`docs/03` §4).
   */
  async #everyoneRoom(spaceId: string): Promise<RoomInfo> {
    const rooms = await this.#transport.spaceRooms(spaceId);
    const target = rooms.find((r) => r.audience === 'everyone') ?? rooms[0];
    if (!target) throw new Error('a space with no rooms has nowhere to put its name');
    return target;
  }
  setMemberRoles(spaceId: string, account: string, roles: string[]): Promise<void> {
    return this.#transport.setMemberRoles(spaceId, account, roles);
  }

  async removeMember(roomId: string, account: string): Promise<void> {
    const group = this.#known.find((r) => r.id === roomId)?.group;
    await this.#transport.removeMember(roomId, account);
    // The membership row is delivery; the Remove commit is access. Only the
    // second one takes the keys away, and until some member sends it the
    // person removed can still read everything that arrives.
    // Every leaf that account holds, not one — a person is as many leaves as
    // they have devices (`docs/03` §5), and taking away three of four is
    // taking away nothing.
    if (group) {
      const leaves = (await this.#crypto.members(group).catch(() => []))
        .filter((m) => toAccountId(m.account) === account)
        .map((m) => m.leaf);
      if (leaves.length) await this.#groups.remove(group, leaves).catch(() => {});
    }
    await this.refresh();
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

  lookup(accountPub: string): Promise<AccountProfile> {
    return this.#transport.lookupAccount(accountPub);
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
    this.conversation = new LiveConversation(
      options.rooms,
      files,
      options.account,
      options.faceFor,
    );
    this.directory = new LiveDirectory(options);
    this.identity = new LiveIdentity(options.transport);
    this.connection = new LiveConnection(options.stream);
  }

  async close(): Promise<void> {
    await this.#rooms.close();
  }
}

/**
 * A roster card, narrowed to what a message carries.
 *
 * Explicit rather than a spread, because the whole point is that this list is
 * short and stays short: anything added to `FaceCard` should have to be added
 * here on purpose before it starts riding on every message.
 */
function refOnly(card: FaceCard): FaceRef {
  return {
    id: card.id,
    name: card.name,
    ...(card.colour ? { colour: card.colour } : {}),
    ...(card.avatar ? { avatar: card.avatar } : {}),
    ...(card.pronouns ? { pronouns: card.pronouns } : {}),
  };
}
