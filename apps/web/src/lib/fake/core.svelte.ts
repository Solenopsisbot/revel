/**
 * The fake core.
 *
 * Deliberately shaped like the interface `packages/core` will expose
 * (`docs/05` §4): the UI reads reactive state and calls actions, and never
 * knows whether the data came from a local database or from here. Swapping the
 * implementation should not touch a single component.
 */

import { resolveSetting } from '@revel/core';
import { untoned } from '../emoji.js';
import {
  account,
  type Dm,
  devices,
  dmId,
  dms,
  type Face,
  type FaceColour,
  keyChanges,
  language,
  lastRead,
  type Message,
  messages,
  myFaces,
  type NotifyLevel,
  notifications,
  type Perm,
  privacy,
  type Room,
  rosters,
  faces as seedFaces,
  spaces,
  storage,
} from './data.js';
import { facesIn, facesSpokenIn, participantsIn, revealsLink, speakerIn } from './faceShape.js';

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
  /**
   * Faces currently typing, **per place**.
   *
   * Keyed by room id, or `roomId/threadId` for a branch. A thread is a branch
   * inside a room (`docs/16`) and that is exactly wrong for a typing
   * indicator: showing branch typing in the room is how a busy room ends up
   * permanently claiming somebody is about to say something in it.
   */
  typingIn = $state<Record<string, string[]>>({});

  /** Who is typing here. Omit `thread` for the room itself. */
  typing(roomId = this.currentRoomId, thread?: string): string[] {
    return this.typingIn[thread ? `${roomId}/${thread}` : roomId] ?? [];
  }
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
  /**
   * Whether the "speaking as" switcher is open.
   *
   * Up here with the rest of the shell's transient state rather than inside
   * the composer, because on touch it is a bottom sheet (`docs/24`) and the
   * back button has to be able to close it — and the back ladder reads one
   * list, in one place, or it stops agreeing with itself.
   */
  speakingAsOpen = $state(false);
  /**
   * The face chosen in each room, by room id.
   *
   * `speakingAs` remains the account-wide default for a room with no choice
   * yet; this is every deliberate switch, and it stays where it was made.
   */
  speakingByRoom = $state<Record<string, string>>({});

  /**
   * Connection state.
   *
   * `docs/24`: "Connection state is **one small dot** in the header. Not a red
   * banner, not a modal, not a toast per reconnect." A phone's connection
   * drops constantly and comes back; making each of those an event the user
   * has to acknowledge is how an app becomes exhausting to carry around.
   */
  connection = $state<'online' | 'connecting' | 'offline'>('online');

  /** Follow the browser. Returns a teardown, for `$effect`. */
  watchConnection() {
    if (typeof window === 'undefined') return () => {};
    const set = () => this.setConnection(navigator.onLine ? 'online' : 'offline');
    set();
    window.addEventListener('online', set);
    window.addEventListener('offline', set);
    return () => {
      window.removeEventListener('online', set);
      window.removeEventListener('offline', set);
    };
  }

  setConnection(next: 'online' | 'connecting' | 'offline') {
    const was = this.connection;
    this.connection = next;
    if (next === 'online' && was !== 'online') this.flushPending();
  }

  /**
   * Everything queued while the connection was down, sent at once.
   *
   * Retrying is safe rather than merely convenient: the id is minted here,
   * on this device, exactly once — the `client_nonce` dedup from `docs/04`
   * §2 — so a resend can never become a duplicate. That property is what
   * lets an outbox exist at all.
   */
  /**
   * Coming back online, in a mock.
   *
   * The real core does not do this: `RoomSync` re-sends nothing on reconnect
   * and a message that failed stays failed until somebody retries it, because
   * flipping `pending` to delivered would claim a success the server never
   * gave (`docs/32`: an optimistic message must not animate as though it
   * succeeded). This is a fixture standing in for a real outbox.
   */
  flushPending() {
    for (const list of Object.values(this.messages)) {
      for (const m of list) if (m.pending) m.pending = false;
    }
  }
  /** A message the view should scroll to and flash — reply jumps, search hits. */
  jumpTo = $state<string | null>(null);
  /**
   * A message someone linked to that this device does not have yet.
   *
   * `docs/19`: "opening a message link you can't decrypt yet shows the
   * 'catching up on keys' banner, not an error." It is genuinely not an error
   * — the message exists, the keys are on their way — and showing a failure
   * would teach people that shared links are unreliable when they are not.
   */
  awaitingKeys = $state<string | null>(null);
  /**
   * The thread currently open, as the id of the message that started it.
   *
   * A thread belongs to a room, so this is cleared whenever the room changes:
   * `docs/24`'s back table has "a thread → its room", which only makes sense
   * if a thread cannot outlive the room it branches from.
   */
  openThreadId = $state<string | null>(null);
  /**
   * Thread names, by the id of the message each branches from.
   *
   * Only the name is kept. Count, who is in it and when it last moved are all
   * facts about which messages carry a `thread`, and deriving them means there
   * is no second number to keep in step.
   */
  threadNames = $state<Record<string, string>>({});

  nameThread(parentId: string, name: string) {
    const trimmed = name.trim();
    if (trimmed) this.threadNames[parentId] = trimmed;
    else delete this.threadNames[parentId];
  }

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
        // Every face in the conversation, mine and theirs — not "the one I
        // happen to have selected", which made the audience change when I
        // switched face somewhere else entirely.
        audience: { kind: 'picked', faceIds: participantsIn(dm) },
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
  /**
   * The open room's timeline.
   *
   * Renamed off `thread`, which used to mean "this room's messages" and now
   * means something specific and different (`docs/16`: a thread is a branch
   * inside a room). Two meanings for one word in a codebase about threads is
   * a bug waiting to be written.
   *
   * Thread replies are excluded: that is the whole point of a branch. The
   * parent keeps a summary line so the conversation still leads to them.
   */
  get timeline() {
    return (this.messages[this.currentRoomId] ?? []).filter((m) => !m.thread);
  }

  /**
   * Everything in the open room, thread replies included.
   *
   * The distinction matters wherever the subject is *the server's* view rather
   * than yours: a thread reply is an event the server counted, timed and
   * stored like any other, so "what the server can see" must not quietly leave
   * it out. That screen is only persuasive while it is exactly true.
   */
  get everythingInRoom() {
    return this.messages[this.currentRoomId] ?? [];
  }
  // ── membership, roles and moderation ──────────────────────────────────────

  /** Your membership of the open space, if you have one. */
  get myMembership() {
    return this.space.members.find((m) => m.accountId === MY_ACCOUNT);
  }

  /**
   * Someone's roles in the open space, sorted highest rank first.
   *
   * Looked up by *account*, because permissions live on the account and
   * authorship on the face (`docs/01`). A plural member has one membership no
   * matter which of their faces you happened to click on.
   */
  rolesOf(accountId: string) {
    const names = this.space.members.find((m) => m.accountId === accountId)?.roles ?? [];
    return this.space.roles.filter((r) => names.includes(r.name)).sort((a, b) => b.rank - a.rank);
  }

  /** Add or remove a permission from a role. */
  toggleRolePerm(roleId: string, perm: Perm) {
    const role = this.space.roles.find((r) => r.id === roleId);
    if (!role) return;
    role.perms = role.perms.includes(perm)
      ? role.perms.filter((p) => p !== perm)
      : [...role.perms, perm];
  }

  /** Give or take a role from a member. */
  toggleMemberRole(accountId: string, roleName: string) {
    const m = this.space.members.find((x) => x.accountId === accountId);
    if (!m) return;
    m.roles = m.roles.includes(roleName)
      ? m.roles.filter((r) => r !== roleName)
      : [...m.roles, roleName];
  }

  /** Remove a member. They can come back through a new invite. */
  kick(accountId: string) {
    this.space.members = this.space.members.filter((m) => m.accountId !== accountId);
  }

  /**
   * Remove a member and keep them out.
   *
   * Kept as one call rather than kick-then-record, because the two halves
   * going out of step is how someone ends up banned and still in the room.
   */
  ban(accountId: string, reason?: string) {
    const m = this.space.members.find((x) => x.accountId === accountId);
    if (!m) return;
    this.space.bans = [
      ...this.space.bans,
      { accountId, faceId: m.faceId, byFaceId: this.speakingAs, at: Date.now(), reason },
    ];
    this.kick(accountId);
  }

  unban(accountId: string) {
    this.space.bans = this.space.bans.filter((b) => b.accountId !== accountId);
  }

  /**
   * A new invite link (`docs/03` §4 — the Wormhole trick).
   *
   * The key half is minted here, on this device, and belongs in the URL
   * fragment. It is generated rather than stored server-side because the
   * server is not supposed to be able to open what it is holding.
   */
  createInvite(opts: { maxUses?: number; days?: number; history: boolean }) {
    const rand = (n: number) =>
      Array.from(crypto.getRandomValues(new Uint8Array(n)))
        .map((b) => 'abcdefghijkmnopqrstuvwxyz23456789'[b % 33])
        .join('');
    this.space.invites = [
      {
        code: `${rand(5)}-${rand(5)}-${Math.floor(Math.random() * 90 + 10)}`,
        key: rand(16),
        byFaceId: this.speakingAs,
        createdAt: Date.now(),
        uses: 0,
        maxUses: opts.maxUses,
        expiresAt: opts.days ? Date.now() + opts.days * 86_400_000 : undefined,
        history: opts.history,
      },
      ...this.space.invites,
    ];
  }

  revokeInvite(code: string) {
    this.space.invites = this.space.invites.filter((i) => i.code !== code);
  }

  /** Take a report off the queue. Nothing else happens to the message. */
  dismissReport(id: string) {
    this.space.reports = this.space.reports.filter((r) => r.id !== id);
  }

  /**
   * Act on a report by deleting the message it is about.
   *
   * Goes through the same tombstone the author's own delete does, with
   * `by: 'moderator'` — "you deleted this" and "a moderator removed this" are
   * different facts and the row says which.
   */
  removeReported(report: { id: string; roomId: string; messageId: string }) {
    const m = this.messages[report.roomId]?.find((x) => x.id === report.messageId);
    if (m) m.deleted = { by: 'moderator', at: Date.now() };
    this.dismissReport(report.id);
  }

  // ── threads ───────────────────────────────────────────────────────────────

  /** Replies in a thread, oldest first. Excludes the message that started it. */
  repliesTo(parentId: string, roomId = this.currentRoomId) {
    return (this.messages[roomId] ?? []).filter((m) => m.thread === parentId);
  }

  /** The message a thread branches from, wherever it lives. */
  parentOf(parentId: string, roomId = this.currentRoomId) {
    return (this.messages[roomId] ?? []).find((m) => m.id === parentId);
  }

  /**
   * A one-line summary for the parent message: how many replies, who is in it,
   * and when it last moved. Faces in reply order and de-duplicated, so a
   * back-and-forth between two people reads as two people.
   */
  threadSummary(parentId: string, roomId = this.currentRoomId) {
    const replies = this.repliesTo(parentId, roomId);
    if (!replies.length) return null;
    const faces: string[] = [];
    for (const r of replies) if (!faces.includes(r.faceId)) faces.push(r.faceId);
    return { count: replies.length, faces, lastAt: replies[replies.length - 1]!.at };
  }

  openThread(parentId: string) {
    this.openThreadId = parentId;
  }

  closeThread() {
    this.openThreadId = null;
  }

  /**
   * Post into a thread.
   *
   * Deliberately the same path as `send` rather than a parallel one — a thread
   * reply is an ordinary message in the same room with the same audience and
   * the same key (`docs/03`), and the only difference is one field. Writing a
   * second send path would be inventing a distinction the protocol does not
   * have.
   */
  sendToThread(parentId: string, body: string) {
    this.send(body, parentId);
  }

  /** Who is in a given room, without opening it. */
  rosterFor(roomId: string) {
    return rosters[roomId] ?? [];
  }

  get roster() {
    const dm = this.dm;
    if (dm) return participantsIn(dm).map((id) => this.faces[id]!);
    return (rosters[this.currentRoomId] ?? []).map((id) => this.faces[id]!);
  }
  get myFaces() {
    return myFaces.map((id) => this.faces[id]!);
  }

  /**
   * Which of my faces are in the current conversation, or `null` where the
   * question does not apply.
   *
   * `null` for a space room: membership there is per **account** (`docs/03` §4
   * — roles and audiences are account-level no matter how many faces you speak
   * as), so every face is available and none of them is a participant in its
   * own right. A DM is the opposite: it is a list of faces, and being in it is
   * a fact the other people can see.
   */
  get facesHere(): string[] | null {
    return facesIn(this.dm);
  }

  /**
   * The face I am speaking as *right here*.
   *
   * Per conversation for a DM, global otherwise. Somebody who is Ash in one
   * group and June in another should not have to remember which, and must never
   * be one mis-click from saying something as the wrong one.
   */
  get speakingHere(): string {
    return speakerIn(this.dm, this.speakingByRoom[this.currentRoomId], this.speakingAs);
  }

  /**
   * Switch face, **in this room only**.
   *
   * Per room rather than per account, and not merely for convenience: the
   * "would this reveal a link" check runs against the room you are in, so a
   * global selection would let you switch somewhere it is harmless and arrive
   * somewhere it is not, already set to the face that gives you away. A choice
   * cannot leak out of the room it was made in.
   */
  speakHere(faceId: string) {
    const dm = this.dm;
    if (dm && !dm.mineIds.includes(faceId)) return;
    if (!myFaces.includes(faceId)) return;
    this.speakingByRoom[this.currentRoomId] = faceId;
  }

  /**
   * Bring one of my faces into this conversation.
   *
   * Deliberately its own method rather than a side effect of selecting: the
   * other people in here will see that this face exists, and — if they were
   * already talking to another of my faces — that the two are the same account.
   * `docs/11` is blunt that faces are *not* cryptographically unlinkable to
   * somebody in the same room, so this is the moment that fact becomes true,
   * and the UI asks first.
   */
  /** My faces that have already spoken in the current room or DM. */
  get facesSpokenHere(): string[] {
    return facesSpokenIn(this.messages[this.currentRoomId], myFaces);
  }

  /**
   * Would speaking as this face newly connect two of my faces, here?
   *
   * The question a space room asks instead of "is this face a member", because
   * a space room has no per-face membership to join (`docs/03` §4) — every face
   * is already allowed to post. What is disclosable is two of them turning up
   * in the same place.
   */
  revealsLinkHere(faceId: string): boolean {
    return revealsLink(this.facesSpokenHere, faceId);
  }

  addFaceHere(faceId: string) {
    const dm = this.dm;
    if (!dm || dm.mineIds.includes(faceId) || !myFaces.includes(faceId)) return;
    dm.mineIds = [...dm.mineIds, faceId];
    this.speakingByRoom[dm.id] = faceId;
  }
  get plural() {
    // Plurality is invisible until you use it (`docs/11`). One face, no chip.
    return this.myFaces.length > 1;
  }

  /** Anything one of my faces said. Edit and delete hang off this. */
  mine(m: Message) {
    return this.faces[m.faceId]?.accountId === MY_ACCOUNT;
  }

  /**
   * A message in the open room, by id.
   *
   * Searches everything in the room rather than the visible timeline: a reply
   * target or a jump can point at a thread reply, and "the message exists but
   * this function can't see it" is the kind of gap that turns into a broken
   * reply banner much later.
   */
  find(id: string | null) {
    if (!id) return undefined;
    return (this.messages[this.currentRoomId] ?? []).find((m) => m.id === id);
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
    let dm: Dm | undefined = this.dms.find((d) => d.id === id);
    if (!dm) {
      // Opened as whoever I am right now. A new 1:1 has exactly one of my faces
      // in it, and adding another is the same deliberate act it is in a group.
      dm = { id, kind: 'dm', withIds: [faceId], mineIds: [this.speakingAs] };
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
    this.openThreadId = null;
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
    this.openThreadId = null;
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
  send(body: string, thread?: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (!this.postedIn.includes(this.currentRoomId)) {
      this.postedIn = [...this.postedIn, this.currentRoomId];
    }
    const id = `local-${crypto.randomUUID()}`;
    const list = this.messages[this.currentRoomId] ?? [];
    list.push({
      id,
      faceId: this.speakingHere,
      body: trimmed,
      at: Date.now(),
      pending: true,
      // A reply-to inside a thread would be a branch off a branch, which is
      // not a thing this product has; the thread is already the grouping.
      replyTo: thread ? undefined : (this.replyTo ?? undefined),
      thread,
    });
    this.messages[this.currentRoomId] = list;
    this.replyTo = null;
    // Anything you send is read by definition; the divider goes away.
    delete this.lastRead[this.currentRoomId];

    // Offline, it stays pending and goes out on reconnect (`docs/24`). Never
    // silently dropped, and never duplicated — see `flushPending`.
    if (this.connection !== 'online') return;
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
    const me = this.speakingHere;
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
  notifyFor(
    spaceId: string,
    roomId: string,
  ): { level: NotifyLevel; from: 'room' | 'space' | 'global' } {
    // Delegated to `@revel/core` rather than walked here. This used to be its
    // own room → space → global chain, which made two implementations of the
    // rule `docs/35` calls the specification — and two implementations of a
    // precedence rule agree right up until somebody changes one.
    const room = this.spaces.find((s) => s.id === spaceId)?.rooms.find((r) => r.id === roomId);
    const resolved = resolveSetting(
      { roomId, spaceId, kind: 'space', class: 'normal', sender: '' },
      {
        default: this.notifications.global,
        spaces: this.notifications.spaces,
        ...(room?.notify ? { rooms: { [roomId]: room.notify } } : {}),
      },
    );
    // The engine calls the last rung `default` after the field it reads; this
    // surface has always called it `global`, and it is the one users see.
    return { level: resolved.level, from: resolved.from === 'default' ? 'global' : resolved.from };
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
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
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

  updateSpace(
    spaceId: string,
    patch: { name?: string; description?: string; visibility?: 'invite' | 'link' | 'public' },
  ) {
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
  updateFace(
    faceId: string,
    patch: Partial<Pick<Face, 'name' | 'pronouns' | 'note' | 'bio' | 'colour' | 'status'>>,
  ) {
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
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
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
  simulateTyping(faceId: string, ms = 3200, thread?: string) {
    const key = thread ? `${this.currentRoomId}/${thread}` : this.currentRoomId;
    const here = this.typingIn[key] ?? [];
    if (!here.includes(faceId)) this.typingIn[key] = [...here, faceId];
    setTimeout(() => {
      this.typingIn[key] = (this.typingIn[key] ?? []).filter((f) => f !== faceId);
    }, ms);
  }
}

export const core = new Core();
