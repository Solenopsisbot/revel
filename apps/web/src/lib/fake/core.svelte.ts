/**
 * The fake core.
 *
 * Deliberately shaped like the interface `packages/core` will expose
 * (`docs/05` §4): the UI reads reactive state and calls actions, and never
 * knows whether the data came from a local database or from here. Swapping the
 * implementation should not touch a single component.
 */
import {
  account,
  devices,
  dmId,
  dms,
  faces as seedFaces,
  keyChanges,
  language,
  lastRead,
  messages,
  myFaces,
  notifications,
  privacy,
  rosters,
  spaces,
  storage,
  type Dm,
  type Face,
  type FaceColour,
  type Message,
  type NotifyLevel,
  type Room,
} from './data.js';
import { untoned } from '../emoji.js';

/** The account these faces belong to. Exported because 'is this face one of
    mine' is a question components ask too, and routing it through a named
    constant beats reaching into faces.viola for an id that is incidental. */
export const MY_ACCOUNT = 'acct-v';
const EMOJI_KEY = 'revel.emoji';

class Core {
  /**
   * The faces, made reactive.
   *
   * `data.ts` is a plain module and cannot hold `$state`, so the record it
   * exports notifies nothing when a field on it changes — editing a face
   * repainted the editor and nothing else.
   *
   * This lives on the class rather than as a module-level `const faces =
   * $state(...)` because the bare-export version *looks* right and silently
   * isn't: the mutation lands on the proxy but subscribers never fire. Every
   * other reactive thing in this file is a class field, so this one is too.
   */
  faces: Record<string, Face> = $state(seedFaces);
  spaces = $state(spaces);
  dms = $state(structuredClone(dms));
  currentSpaceId = $state('solexsis');
  /**
   * What you are looking at. A DM's id sits here exactly like a room's does,
   * because a DM *is* a room (`docs/16`) — keeping one "current thing" id is
   * what lets the message list, composer, roster and member panel work in a
   * DM without knowing DMs exist.
   */
  currentRoomId = $state('design');
  /**
   * Home is where rooms-without-a-space live (`docs/05` §2). It is a peer of
   * the space rail rather than a space itself, because a DM belongs to no
   * space and pretending otherwise would need a fake one.
   */
  scope = $state<'space' | 'home'>('space');
  /** Which face you are speaking as. Only surfaced when you have several. */
  speakingAs = $state('june');
  messages = $state<Record<string, Message[]>>(structuredClone(messages));
  /** Faces currently typing in the open room. */
  typing = $state<string[]>([]);
  membersOpen = $state(true);
  /** The message being replied to, if any. Cleared on send or Escape. */
  replyTo = $state<string | null>(null);
  /** The message being edited in place, if any. */
  editing = $state<string | null>(null);
  /** The message a delete is waiting on confirmation for. */
  confirmingDelete = $state<string | null>(null);
  /** Where the unread divider sits, per room. Frozen while you read. */
  lastRead = $state<Record<string, string>>({ ...lastRead });
  /** Which face's profile card is open, if any. */
  profileFor = $state<string | null>(null);
  /** A message the view should scroll to and flash — reply jumps, search hits. */
  jumpTo = $state<string | null>(null);

  /** Emoji the picker offers first. Persisted; most recent leads. */
  recentEmoji = $state<string[]>(['👍', '🔥', '💯', '👀', '😂', '❤️']);
  /** Fitzpatrick index, 0 = none. Applies to the hands and people groups. */
  emojiTone = $state(0);

  // --- account, keys and devices -------------------------------------------
  // Wren reads all of this (`docs/12`), and so do the settings screens. One
  // source, so her notices can never contradict the panel next to them.
  account = $state(structuredClone(account));
  devices = $state(structuredClone(devices));
  keyChanges = $state(structuredClone(keyChanges));
  storage = $state(structuredClone(storage));
  notifications = $state(structuredClone(notifications));
  privacy = $state(structuredClone(privacy));
  language = $state(structuredClone(language));
  /** Whether the command surface has ever been opened on this device. */
  commandSurfaceUsed = $state(false);
  /**
   * Rooms you have posted in this session. Wren's "you may have forgotten
   * this bot is here" notice needs a trigger — without one it fires on mere
   * presence, never resolves, and becomes wallpaper.
   */
  postedIn = $state<string[]>([]);

  constructor() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(EMOJI_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.recent)) this.recentEmoji = saved.recent;
        if (typeof saved.tone === 'number') this.emojiTone = saved.tone;
      }
    } catch {
      /* corrupt or unavailable storage is not worth failing a page load over */
    }
  }

  get space() {
    return this.spaces.find((s) => s.id === this.currentSpaceId) ?? this.spaces[0]!;
  }
  /** The DM you are in, if you are in one. */
  get dm(): Dm | undefined {
    return this.scope === 'home' ? this.dms.find((d) => d.id === this.currentRoomId) : undefined;
  }

  /**
   * The open conversation, as a `Room`.
   *
   * A DM is presented as a synthesized room rather than a separate type, so
   * every consumer — header, message list, composer, the "what can the server
   * see" explainer — keeps working without a branch. Its audience is the
   * explicit participant list, which is literally true.
   */
  get room(): Room {
    const dm = this.dm;
    if (dm) {
      return {
        id: dm.id,
        name: dm.name ?? this.dmTitle(dm),
        kind: 'text',
        category: 'Direct messages',
        notify: dm.notify,
        // Bubbles, per `docs/07`: DMs and group DMs get them by default.
        style: 'bubbles',
        audience: { kind: 'picked', faceIds: [this.speakingAs, ...dm.withIds] },
      };
    }
    return this.space.rooms.find((r) => r.id === this.currentRoomId) ?? this.space.rooms[0]!;
  }

  /** "Rae", or "Rae and Emeri" for an unnamed group. */
  dmTitle(dm: Dm) {
    const names = dm.withIds.map((id) => this.faces[id]?.name ?? id);
    if (names.length <= 2) return names.join(' and ');
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  get thread() {
    return this.messages[this.currentRoomId] ?? [];
  }
  /** Who is in a given room, without opening it. */
  rosterFor(roomId: string) {
    return rosters[roomId] ?? [];
  }

  get roster() {
    const dm = this.dm;
    if (dm) return [this.faces[this.speakingAs]!, ...dm.withIds.map((id) => this.faces[id]!)];
    return (rosters[this.currentRoomId] ?? []).map((id) => this.faces[id]!);
  }
  get myFaces() {
    return myFaces.map((id) => this.faces[id]!);
  }
  get plural() {
    // Plurality is invisible until you use it (`docs/11`). One face, no chip.
    return this.myFaces.length > 1;
  }

  /** Anything one of my faces said. Edit and delete hang off this. */
  mine(m: Message) {
    return this.faces[m.faceId]?.accountId === MY_ACCOUNT;
  }

  find(id: string | null) {
    if (!id) return undefined;
    return this.thread.find((m) => m.id === id);
  }

  /**
   * Open a conversation with someone, creating it if it doesn't exist.
   *
   * Idempotent by construction: the id comes from the sorted account pair, so
   * opening the same person's DM twice lands in the same room rather than
   * making a second one (`docs/03`).
   */
  openDm(faceId: string) {
    const face = this.faces[faceId];
    if (!face || face.accountId === MY_ACCOUNT) return;
    const id = dmId(MY_ACCOUNT, face.accountId);
    let dm = this.dms.find((d) => d.id === id);
    if (!dm) {
      dm = { id, kind: 'dm', withIds: [faceId] };
      this.dms.push(dm);
      this.messages[id] ??= [];
    }
    this.scope = 'home';
    this.currentRoomId = id;
    dm.unread = undefined;
    dm.mention = false;
    this.replyTo = null;
    this.editing = null;
    this.profileFor = null;
  }

  /**
   * Hide a conversation from Home.
   *
   * Not a delete: the messages stay, and messaging them again brings the same
   * room back because the id is derived from the account pair rather than
   * stored. Calling it "close" rather than "delete" is the honest label for
   * what it does.
   */
  closeDm(id: string) {
    this.dms = this.dms.filter((d) => d.id !== id);
    if (this.currentRoomId === id) {
      if (this.dms.length) this.openHome(this.dms[0]!.id);
      else this.openRoom(this.currentSpaceId, this.space.rooms[0]!.id);
    }
  }

  openHome(dmId?: string) {
    this.scope = 'home';
    const target = dmId ?? this.dms[0]?.id;
    if (target) {
      this.currentRoomId = target;
      const dm = this.dms.find((d) => d.id === target);
      if (dm) {
        dm.unread = undefined;
        dm.mention = false;
      }
    }
    this.replyTo = null;
    this.editing = null;
  }

  openRoom(spaceId: string, roomId: string) {
    this.scope = 'space';
    this.currentSpaceId = spaceId;
    this.currentRoomId = roomId;
    this.replyTo = null;
    this.editing = null;
    this.confirmingDelete = null;
    const room = this.space.rooms.find((r) => r.id === roomId);
    if (room) {
      room.unread = undefined;
      room.mention = false;
    }
  }

  /**
   * Optimistic send. The message appears immediately as provisional and is
   * confirmed later — it never moves, because moving it would imply it went
   * somewhere (`docs/32`).
   */
  send(body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (!this.postedIn.includes(this.currentRoomId)) {
      this.postedIn = [...this.postedIn, this.currentRoomId];
    }
    const id = `local-${crypto.randomUUID()}`;
    const list = this.messages[this.currentRoomId] ?? [];
    list.push({
      id,
      faceId: this.speakingAs,
      body: trimmed,
      at: Date.now(),
      pending: true,
      replyTo: this.replyTo ?? undefined,
    });
    this.messages[this.currentRoomId] = list;
    this.replyTo = null;
    // Anything you send is read by definition; the divider goes away.
    delete this.lastRead[this.currentRoomId];

    setTimeout(() => {
      const m = this.messages[this.currentRoomId]?.find((x) => x.id === id);
      if (m) m.pending = false;
    }, 420);
  }

  /**
   * Editing keeps the message in place and marks it. It does not resend: the
   * row you were reading is the row that changed, which is the only way an
   * edit stays legible in a conversation.
   */
  saveEdit(id: string, body: string) {
    const m = this.find(id);
    this.editing = null;
    if (!m) return;
    const trimmed = body.trim();
    // An edit down to nothing is a delete, and should say so rather than
    // leaving an empty bubble behind.
    if (!trimmed && !m.attachments?.length) return this.remove(id);
    if (trimmed === m.body) return;
    m.body = trimmed;
    m.editedAt = Date.now();
  }

  /** Tombstone, not removal. The row stays so the thread still reads. */
  remove(id: string, by: 'author' | 'moderator' = 'author') {
    const m = this.find(id);
    if (!m) return;
    m.deleted = { by, at: Date.now() };
    m.body = '';
    m.attachments = undefined;
    m.link = undefined;
    m.reactions = undefined;
    m.annotation = undefined;
    this.confirmingDelete = null;
    if (this.editing === id) this.editing = null;
    if (this.replyTo === id) this.replyTo = null;
  }

  pin(id: string) {
    const m = this.find(id);
    if (m) m.pinned = !m.pinned;
  }

  /**
   * Toggle my reaction. Tone variants collapse onto one key, so 👍🏽 and 👍
   * are the same reaction with two people on it rather than two piles of one.
   */
  react(messageId: string, key: string) {
    const m = this.find(messageId);
    if (!m) return;
    const k = untoned(key);
    const me = this.speakingAs;
    m.reactions ??= [];
    const existing = m.reactions.find((r) => r.key === k);
    if (!existing) {
      m.reactions.push({ key: k, by: [me] });
    } else if (existing.by.includes(me)) {
      existing.by = existing.by.filter((f) => f !== me);
      if (existing.by.length === 0) m.reactions = m.reactions.filter((r) => r.key !== k);
    } else {
      existing.by = [...existing.by, me];
    }
    if (m.reactions.length === 0) m.reactions = undefined;
    this.rememberEmoji(k);
  }

  /** Most recent first, capped. The picker's first row. */
  rememberEmoji(c: string) {
    this.recentEmoji = [c, ...this.recentEmoji.filter((x) => x !== c)].slice(0, 24);
    this.persistEmoji();
  }

  setTone(tone: number) {
    this.emojiTone = tone;
    this.persistEmoji();
  }

  private persistEmoji() {
    try {
      localStorage.setItem(
        EMOJI_KEY,
        JSON.stringify({ recent: this.recentEmoji, tone: this.emojiTone }),
      );
    } catch {
      /* private mode; the choice just won't persist */
    }
  }

  /**
   * The level a room actually gets, and where that came from.
   *
   * Every notification screen in every app answers "what is this set to" and
   * none of them answer "why", which is the only question anyone has. This
   * returns both.
   */
  notifyFor(spaceId: string, roomId: string): { level: NotifyLevel; from: 'room' | 'space' | 'global' } {
    const room = this.spaces.find((s) => s.id === spaceId)?.rooms.find((r) => r.id === roomId);
    if (room?.notify) return { level: room.notify, from: 'room' };
    const space = this.notifications.spaces[spaceId];
    if (space) return { level: space, from: 'space' };
    return { level: this.notifications.global, from: 'global' };
  }

  /** Set or clear a room's override. `undefined` returns it to inheriting. */
  setRoomNotify(spaceId: string, roomId: string, level: NotifyLevel | undefined) {
    const room = this.spaces.find((s) => s.id === spaceId)?.rooms.find((r) => r.id === roomId);
    if (room) room.notify = level;
  }

  setSpaceNotify(spaceId: string, level: NotifyLevel | undefined) {
    if (level) this.notifications.spaces[spaceId] = level;
    else delete this.notifications.spaces[spaceId];
  }

  // --- rooms and spaces ----------------------------------------------------

  markRead(spaceId: string, roomId: string) {
    const room = this.spaces.find((s) => s.id === spaceId)?.rooms.find((r) => r.id === roomId);
    if (!room) return;
    room.unread = undefined;
    room.mention = false;
  }

  /** Leaving is a local removal here. In the real client it is an MLS group
      exit, which is why the history stops rather than disappearing. */
  leaveRoom(spaceId: string, roomId: string) {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space || space.rooms.length <= 1) return;
    space.rooms = space.rooms.filter((r) => r.id !== roomId);
    if (this.currentRoomId === roomId) this.openRoom(spaceId, space.rooms[0]!.id);
  }

  createRoom(spaceId: string, name: string, kind: 'text' | 'voice' = 'text', category = 'General') {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space) return;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id || space.rooms.some((r) => r.id === id)) return;
    space.rooms.push({ id, name: id, kind, category, audience: { kind: 'everyone' } });
    this.messages[id] ??= [];
    this.openRoom(spaceId, id);
  }

  deleteRoom(spaceId: string, roomId: string) {
    this.leaveRoom(spaceId, roomId);
  }

  renameRoom(spaceId: string, roomId: string, name: string, topic?: string) {
    const room = this.spaces.find((s) => s.id === spaceId)?.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const trimmed = name.trim();
    if (trimmed) room.name = trimmed;
    room.topic = topic?.trim() || undefined;
  }

  updateSpace(spaceId: string, patch: { name?: string; description?: string; visibility?: 'invite' | 'link' | 'public' }) {
    const space = this.spaces.find((s) => s.id === spaceId);
    if (!space) return;
    if (patch.name?.trim()) {
      space.name = patch.name.trim();
      space.initial = space.name[0]!.toUpperCase();
    }
    if (patch.description !== undefined) space.description = patch.description.trim() || undefined;
    if (patch.visibility) space.visibility = patch.visibility;
  }

  /** A space is a row and a key group, not a machine (`docs/18`), so deleting
      one is an ordinary — if irreversible — operation rather than a teardown. */
  deleteSpace(spaceId: string) {
    if (this.spaces.length <= 1) return;
    this.spaces = this.spaces.filter((s) => s.id !== spaceId);
    const first = this.spaces[0]!;
    this.openRoom(first.id, first.rooms[0]!.id);
  }

  // --- faces ---------------------------------------------------------------

  /** Edit one of your own faces. Refuses other people's, which is not a
      security boundary here but is the shape the real core will need. */
  updateFace(faceId: string, patch: Partial<Pick<Face, 'name' | 'pronouns' | 'note' | 'bio' | 'colour' | 'status'>>) {
    const face = this.faces[faceId];
    if (!face || face.accountId !== MY_ACCOUNT) return;
    if (patch.name !== undefined && patch.name.trim()) face.name = patch.name.trim();
    if (patch.pronouns !== undefined) face.pronouns = patch.pronouns.trim() || undefined;
    if (patch.note !== undefined) face.note = patch.note.trim() || undefined;
    if (patch.bio !== undefined) face.bio = patch.bio.trim() || undefined;
    if (patch.colour) face.colour = patch.colour;
    if (patch.status) face.status = patch.status;
  }

  addFace(name: string, colour: FaceColour = 'sky') {
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!id || this.faces[id]) return;
    this.faces[id] = { id, name: name.trim(), colour, accountId: MY_ACCOUNT, status: 'here' };
    myFaces.push(id);
  }

  // --- actions Wren's buttons call -----------------------------------------
  // Every one of these is the same method the settings UI calls. Wren gets no
  // privileged path (`docs/12`): if she can do it, you can do it by hand.

  /** Marks the recovery code confirmed saved. The honest version of this in a
      real client is "the user pressed the button on the code screen". */
  confirmRecoveryCode() {
    this.account.recoveryCodeConfirmed = true;
  }

  enrolPasskey() {
    this.account.passkeyEnrolled = true;
  }

  /** Signs a device out. The current device cannot revoke itself — that is
      "sign out", which is a different action with a different consequence. */
  revokeDevice(id: string) {
    this.devices = this.devices.filter((d) => d.id !== id || d.current);
  }

  /** "It's fine" on a stale device: stop asking without signing it out. */
  keepDevice(id: string) {
    const d = this.devices.find((x) => x.id === id);
    if (d) d.seenDays = 0;
  }

  /** Acknowledge a contact's key change, either way. Verifying and expecting
      it resolve the same state; what differs is what you did about it. */
  acknowledgeKeyChange(faceId: string) {
    const k = this.keyChanges.find((c) => c.faceId === faceId);
    if (k) k.acknowledged = true;
  }

  /** Reversible: cached media re-downloads on demand. Said so in the UI. */
  clearCachedMedia() {
    this.storage.media = 0;
  }

  /** Not reversible: this drops decrypted history the room may not re-serve. */
  clearLeftRoomHistory() {
    this.storage.leftRooms = [];
  }

  deleteModel(id: string) {
    const m = this.storage.models_.find((x) => x.id === id);
    if (!m) return;
    this.storage.models = Math.max(0, this.storage.models - m.mb);
    this.storage.models_ = this.storage.models_.filter((x) => x.id !== id);
  }

  /** Someone else typing, so the indicator has something to show. */
  simulateTyping(faceId: string, ms = 3200) {
    if (!this.typing.includes(faceId)) this.typing = [...this.typing, faceId];
    setTimeout(() => {
      this.typing = this.typing.filter((f) => f !== faceId);
    }, ms);
  }
}

export const core = new Core();
