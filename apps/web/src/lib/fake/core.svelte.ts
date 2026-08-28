/**
 * The fake core.
 *
 * Deliberately shaped like the interface `packages/core` will expose
 * (`docs/05` §4): the UI reads reactive state and calls actions, and never
 * knows whether the data came from a local database or from here. Swapping the
 * implementation should not touch a single component.
 */
import {
  faces,
  lastRead,
  messages,
  myFaces,
  rosters,
  spaces,
  type Message,
} from './data.js';
import { untoned } from '../emoji.js';

/** The account these faces belong to. Exported because 'is this face one of
    mine' is a question components ask too, and routing it through a named
    constant beats reaching into faces.viola for an id that is incidental. */
export const MY_ACCOUNT = 'acct-v';
const EMOJI_KEY = 'revel.emoji';

class Core {
  spaces = $state(spaces);
  currentSpaceId = $state('solexsis');
  currentRoomId = $state('design');
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
  get room() {
    return this.space.rooms.find((r) => r.id === this.currentRoomId) ?? this.space.rooms[0]!;
  }
  get thread() {
    return this.messages[this.currentRoomId] ?? [];
  }
  get roster() {
    return (rosters[this.currentRoomId] ?? []).map((id) => faces[id]!);
  }
  get myFaces() {
    return myFaces.map((id) => faces[id]!);
  }
  get plural() {
    // Plurality is invisible until you use it (`docs/11`). One face, no chip.
    return this.myFaces.length > 1;
  }

  /** Anything one of my faces said. Edit and delete hang off this. */
  mine(m: Message) {
    return faces[m.faceId]?.accountId === MY_ACCOUNT;
  }

  find(id: string | null) {
    if (!id) return undefined;
    return this.thread.find((m) => m.id === id);
  }

  openRoom(spaceId: string, roomId: string) {
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

  /** Someone else typing, so the indicator has something to show. */
  simulateTyping(faceId: string, ms = 3200) {
    if (!this.typing.includes(faceId)) this.typing = [...this.typing, faceId];
    setTimeout(() => {
      this.typing = this.typing.filter((f) => f !== faceId);
    }, ms);
  }
}

export const core = new Core();
export { faces };
