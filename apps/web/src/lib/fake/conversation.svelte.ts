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
import { core } from './core.svelte.js';
import {
  allOf,
  findIn,
  repliesOf,
  type ThreadSummary,
  threadLabelOf,
  threadsOf,
  timelineOf,
  type UiMessage,
} from './messageShape.js';

export { asCoreMessage, type ThreadSummary, type UiMessage } from './messageShape.js';

export const conversation = {
  timeline(roomId: string = core.currentRoomId): UiMessage[] {
    return timelineOf(core.messages[roomId] ?? [], core.faces);
  },

  all(roomId: string = core.currentRoomId): UiMessage[] {
    return allOf(core.messages[roomId] ?? [], core.faces);
  },

  replies(parentId: string, roomId: string = core.currentRoomId): UiMessage[] {
    return repliesOf(core.messages[roomId] ?? [], core.faces, parentId);
  },

  find(messageId: string, roomId: string = core.currentRoomId): UiMessage | undefined {
    return findIn(core.messages[roomId] ?? [], core.faces, messageId);
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
