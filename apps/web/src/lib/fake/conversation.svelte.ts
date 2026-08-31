/**
 * The fake core, wearing the read side of `ConversationCore`.
 *
 * All of the translation lives in `messageShape.ts`, which reaches for nothing
 * and is therefore testable. This file is the part that has to know about the
 * `core` singleton, and it is deliberately four one-line methods.
 *
 * ## Reactivity
 *
 * Plain methods, not `$derived`. That works because runes track at the signal
 * level: reading `core.messages` inside a method called from a `$derived`
 * subscribes the caller. So components stay reactive without this file knowing
 * how they are written — which is the property that lets the same components
 * sit on `LiveCore` later, where the reactivity comes from `watch()` instead.
 */

import { live } from '../live.svelte.js';
import { core } from './core.svelte.js';
import {
  allOf,
  findIn,
  fromCoreMessage,
  repliesOf,
  roomStateOf,
  type ThreadSummary,
  threadLabelOf,
  threadsOf,
  timelineCount,
  timelineOf,
  timelinePosition,
  type UiMessage,
} from './messageShape.js';

export { asCoreMessage, type ThreadSummary, type UiMessage } from './messageShape.js';

/**
 * The live room, when a signed-in device is running the real core.
 *
 * `null` means fixtures — which is every screen reachable without an account,
 * and is not a degraded mode. The two are different sources of truth and the
 * seam is where they are told apart, exactly as `docs/33` intended.
 */
function liveRoom(roomId: string) {
  return live.running ? live.room(roomId) : null;
}

export const conversation = {
  /**
   * The room timeline, newest last.
   *
   * `limit` returns only that many from the end, which is what the message list
   * asks for: it renders a window, and building the rest is pure waste that
   * scales with how long the conversation has been going.
   */
  timeline(roomId: string = core.currentRoomId, limit?: number): UiMessage[] {
    const room = liveRoom(roomId);
    if (room) {
      // `timeline` on the core already excludes thread replies, which is the
      // same rule `timelineOf` applies to the fixtures (`docs/16`: a thread is
      // a branch inside a room, not part of its main line).
      const all = live.stack!.core.conversation.timeline(roomId);
      const wanted = limit === undefined ? all : all.slice(Math.max(0, all.length - limit));
      return wanted.map(fromCoreMessage);
    }
    return timelineOf(core.messages[roomId] ?? [], core.faces, limit);
  },

  /** How many the timeline has, without building any of them. */
  count(roomId: string = core.currentRoomId): number {
    const room = liveRoom(roomId);
    if (room) return live.stack!.core.conversation.timeline(roomId).length;
    return timelineCount(core.messages[roomId] ?? []);
  },

  /** Where a message sits in it, or -1. For widening the window to reach one. */
  position(messageId: string, roomId: string = core.currentRoomId): number {
    const room = liveRoom(roomId);
    if (room) {
      return live.stack!.core.conversation.timeline(roomId).findIndex((m) => m.id === messageId);
    }
    return timelinePosition(core.messages[roomId] ?? [], messageId);
  },

  all(roomId: string = core.currentRoomId): UiMessage[] {
    return allOf(core.messages[roomId] ?? [], core.faces);
  },

  replies(parentId: string, roomId: string = core.currentRoomId): UiMessage[] {
    return repliesOf(core.messages[roomId] ?? [], core.faces, parentId);
  },

  find(messageId: string, roomId: string = core.currentRoomId): UiMessage | undefined {
    const room = liveRoom(roomId);
    if (room) {
      const found = room.byId.get(messageId);
      return found ? fromCoreMessage(found) : undefined;
    }
    return findIn(core.messages[roomId] ?? [], core.faces, messageId);
  },

  /**
   * A room in the shape `packages/core` reduces to.
   *
   * What `search` takes: rooms are passed in rather than looked up because
   * *what is searchable* is a policy question (`docs/03`), and the matcher
   * should not be the layer deciding it.
   */
  roomState(roomId: string = core.currentRoomId) {
    return roomStateOf(roomId, core.messages[roomId] ?? [], core.faces, core.threadNames);
  },

  /** Threads in a room, newest activity first. */
  threads(roomId: string = core.currentRoomId): ThreadSummary[] {
    return threadsOf(core.messages[roomId] ?? [], core.threadNames, core.speakingAs);
  },

  /** Only the ones you are actually in — what belongs under a room. */
  myThreads(roomId: string = core.currentRoomId): ThreadSummary[] {
    return this.threads(roomId).filter((t) => t.joined);
  },

  /** What to show it as. Its name, or the parent's first line. */
  label(summary: ThreadSummary, roomId: string = core.currentRoomId): string {
    return threadLabelOf(
      summary,
      (core.messages[roomId] ?? []).find((m) => m.id === summary.parent),
    );
  },
};

/**
 * The room timeline, for `core` itself to read.
 *
 * A named export rather than `conversation.timeline`, because `core` cannot
 * import the object that imports it — and the empty state and the arrival
 * counter both live on `core` and have to agree with what the list renders.
 */
export function conversationTimeline(roomId: string) {
  return conversation.timeline(roomId);
}
