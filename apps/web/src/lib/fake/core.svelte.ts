/**
 * The fake core.
 *
 * Deliberately shaped like the interface `packages/core` will expose
 * (`docs/05` §4): the UI reads reactive state and calls actions, and never
 * knows whether the data came from a local database or from here. Swapping the
 * implementation should not touch a single component.
 */
import { faces, messages, myFaces, rosters, spaces, type Message } from './data.js';

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

  openRoom(spaceId: string, roomId: string) {
    this.currentSpaceId = spaceId;
    this.currentRoomId = roomId;
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
    list.push({ id, faceId: this.speakingAs, body: trimmed, at: Date.now(), pending: true });
    this.messages[this.currentRoomId] = list;

    setTimeout(() => {
      const m = this.messages[this.currentRoomId]?.find((x) => x.id === id);
      if (m) m.pending = false;
    }, 420);
  }

  react(messageId: string, key: string) {
    const m = this.thread.find((x) => x.id === messageId);
    if (!m) return;
    m.reactions ??= [];
    const existing = m.reactions.find((r) => r.key === key);
    if (!existing) {
      m.reactions.push({ key, count: 1, mine: true });
    } else if (existing.mine) {
      existing.count -= 1;
      existing.mine = false;
      if (existing.count <= 0) m.reactions = m.reactions.filter((r) => r.key !== key);
    } else {
      existing.count += 1;
      existing.mine = true;
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
