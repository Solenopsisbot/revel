/**
 * The fake core, wearing `ConversationCore`.
 *
 * `docs/33`'s plan was to build the UI against mocks and then swap the fake
 * core for the real one *behind the same interface*. `docs/31` §20 records what
 * happened when that was measured: there was no interface — the fake core is
 * one object with 94 members — so the swap needs a seam built first. This is
 * that seam for the conversation half.
 *
 * ## What it actually does
 *
 * Translates shapes. The fixtures in `data.ts` and `history.ts` store a
 * `faceId` and look the face up in a global map; a real `Message` carries a
 * **`FaceRef` snapshot** taken when the message was sent, which is `docs/04`
 * §2's rule and the reason renaming a face does not silently rewrite every
 * message that face ever sent.
 *
 * Doing the translation here rather than in the fixtures is deliberate: it is
 * one function instead of fifty edits to test data, and it means the fixtures
 * stay readable as fixtures.
 *
 * ## Why the faces come in as an argument
 *
 * This module reaches for nothing. It used to read the `core` singleton, which
 * made it untestable — a mapping that silently drops a field produces a
 * perfectly well-typed message that renders as an anonymous grey blob, and no
 * type checker will ever mention it. Taking the face map as an argument is what
 * lets that be a test instead of a bug report.
 *
 * `conversation.svelte.ts` is the thin thing that binds these to `core`.
 */

import type { Message, RoomState } from '@revel/core';
import type { FaceRef } from '@revel/protocol';
import type { Face, Message as FakeMessage } from './data.js';

/**
 * What the UI renders.
 *
 * The real `Message`, plus the fields the fixtures exercise that the protocol
 * has not grown yet. Spelled out rather than quietly added to `Message`,
 * because each one is a decision somebody has to make: a link preview is
 * `docs/22`'s "built by the sender's client and shipped inside the event", and
 * it needs a protocol field before it can be more than a mock.
 */
export type UiMessage = Omit<Message, 'reactions'> & {
  /** As the protocol has them, plus the faces that reacted — which is what a
   *  hover tooltip shows and what the protocol carries inside the ciphertext. */
  reactions?: { key: string; accounts: string[]; faces: string[] }[];
  /** A link preview. `docs/22` says the sender builds it; there is no event
   *  field for it yet, so this is fixture-only. */
  link?: FakeMessage['link'];
  /** The plaintext body. The protocol's is a node tree (`RichText`); every
   *  fixture body is a string, and the renderer only handles strings today. */
  text: string;
};

/** A fixture message, as the rest of the app should see it. */
export function asCoreMessage(m: FakeMessage, faces: Record<string, Face>): UiMessage {
  const face = faces[m.faceId];
  return {
    id: m.id,
    account: face?.accountId ?? m.faceId,
    // The snapshot. In the real core this was written into the ciphertext when
    // the message was sent; here it is looked up now, which is the one way this
    // adapter is not faithful and the one that stops mattering after the swap.
    ...(face
      ? {
          face: {
            id: face.id,
            name: face.name,
            ...(face.colour ? { colour: face.colour } : {}),
            ...(face.pronouns ? { pronouns: face.pronouns } : {}),
          } satisfies FaceRef,
        }
      : {}),
    body: m.body,
    at: m.at,
    ...(m.pending ? { pending: true } : {}),
    ...(m.failed ? { failed: true } : {}),
    // The only name a message that never reached the server has. A retry needs
    // it, so it has to survive the mapping into the UI's shape.
    ...(m.clientNonce ? { clientNonce: m.clientNonce } : {}),
    ...(m.editedAt ? { editedAt: m.editedAt } : {}),
    // `deleted` in the fixtures, `redacted` in the protocol. The protocol word
    // is the right one: a redaction is an in-band act by a person, and it is a
    // different fact from the server having purged the bytes (`purged`), which
    // nobody chose.
    ...(m.deleted ? { redacted: m.deleted } : {}),
    ...(m.pinned ? { pinned: true } : {}),
    // The fixtures key a reaction by *face*; the protocol keys it by account,
    // because a reaction is a person's and a face is a presentation of one
    // (`docs/11`). Mapped here so nothing downstream has to know both.
    ...(m.reactions
      ? {
          reactions: m.reactions.map((r) => ({
            key: r.key,
            accounts: r.by.map((faceId) => faces[faceId]?.accountId ?? faceId),
            /** Which faces reacted, which is what the UI shows on hover. */
            faces: r.by,
          })),
        }
      : {}),
    // Singular in the fixtures, a list in the protocol: `docs/04` §2 allows one
    // per (target, author, kind), so a translation and a transcript can coexist.
    ...(m.annotation
      ? {
          annotations: [
            { author: m.annotation.by, kind: m.annotation.kind, body: m.annotation.body, at: m.at },
          ],
        }
      : {}),
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(m.thread ? { thread: m.thread } : {}),
    // Given a MIME type, because that is what a real `BlobRef` carries and
    // what `packages/core`'s `has:image` filter reads. The fixtures carry a
    // `kind` instead, and translating here is the difference between the app's
    // search and the core's agreeing about what an image is.
    ...(m.attachments
      ? {
          attachments: m.attachments.map((a) => ({
            ...a,
            mime: mimeOf(a.kind, a.name),
          })),
        }
      : {}),
    // `mentions` and `expression` exist on the real `Message` and not on the
    // fixture one. Left out rather than faked: an empty field the UI could
    // start relying on is worse than an absent one it has to handle.
    ...(m.link ? { link: m.link } : {}),
    // Narrowed once, here, rather than at every render site. A real body is a
    // node tree; every fixture body is a string, and the day one is not, this
    // is the line that has to grow a renderer rather than twenty components.
    text: typeof m.body === 'string' ? m.body : '',
  } as UiMessage;
}

/**
 * The read side of `ConversationCore`, over the fixtures.
 *
 * Only the read side: the write side of the fake core mutates `$state` directly
 * and calling it through here would add a layer that does nothing. What matters
 * for the swap is that **every component reads through this shape**, so that
 * replacing the source is a change to one file rather than to twenty.
 */

/** The room's own timeline: everything that is not a branch (`docs/16`). */
export function timelineOf(
  messages: FakeMessage[],
  faces: Record<string, Face>,
  limit?: number,
): UiMessage[] {
  const inRoom = messages.filter((m) => !m.thread);
  // **Slice before mapping.** The filter is a scan and costs almost nothing;
  // `asCoreMessage` allocates an object and resolves a face per message, and
  // doing that for the whole room on every change is what made an arriving
  // message take 15 seconds to paint in a large one (`docs/31` §31). The list
  // only ever renders a window, so only the window needs building.
  const wanted = limit === undefined ? inRoom : inRoom.slice(Math.max(0, inRoom.length - limit));
  return wanted.map((m) => asCoreMessage(m, faces));
}

/** How many messages the room timeline has, without building any of them. */
export function timelineCount(messages: FakeMessage[]): number {
  let n = 0;
  for (const m of messages) if (!m.thread) n++;
  return n;
}

/** Where a message sits in the room timeline, or -1. Also without building. */
export function timelinePosition(messages: FakeMessage[], messageId: string): number {
  let n = 0;
  for (const m of messages) {
    if (m.thread) continue;
    if (m.id === messageId) return n;
    n++;
  }
  return -1;
}

/** Everything in the room, branches included. */
export function allOf(messages: FakeMessage[], faces: Record<string, Face>): UiMessage[] {
  return messages.map((m) => asCoreMessage(m, faces));
}

/** Replies branching off one message, oldest first. */
export function repliesOf(
  messages: FakeMessage[],
  faces: Record<string, Face>,
  parentId: string,
): UiMessage[] {
  return messages.filter((m) => m.thread === parentId).map((m) => asCoreMessage(m, faces));
}

export function findIn(
  messages: FakeMessage[],
  faces: Record<string, Face>,
  messageId: string,
): UiMessage | undefined {
  const found = messages.find((m) => m.id === messageId);
  return found ? asCoreMessage(found, faces) : undefined;
}

/**
 * Threads in a room, newest activity first.
 *
 * Derived from the messages, exactly as `packages/core`'s `threadsIn` is, and
 * for the same reason: a reply that arrives or is removed updates the summary
 * by existing or not existing, so there is no count to keep in step.
 *
 * `docs/16`: a thread is "a branch inside a room. **Not a room.**" There is no
 * thread object here because there is nothing for one to hold.
 */
export interface ThreadSummary {
  parent: string;
  name?: string;
  count: number;
  /** Faces that have said something in it, in the order they first did. */
  faces: string[];
  lastAt: number;
  /** The newest reply's id — what the order is actually decided by. */
  lastId: string;
  /** Whether the face you are speaking as has said anything in it. */
  joined: boolean;
}

export function threadsOf(
  messages: FakeMessage[],
  names: Record<string, string>,
  meFaceId?: string,
): ThreadSummary[] {
  const byParent = new Map<string, FakeMessage[]>();
  for (const m of messages) {
    if (!m.thread) continue;
    byParent.set(m.thread, [...(byParent.get(m.thread) ?? []), m]);
  }

  const out: ThreadSummary[] = [];
  for (const [parent, replies] of byParent) {
    const faceIds: string[] = [];
    for (const r of replies) if (!faceIds.includes(r.faceId)) faceIds.push(r.faceId);
    const name = names[parent];
    const last = replies.reduce((a, b) => (a.id >= b.id ? a : b));
    out.push({
      parent,
      ...(name ? { name } : {}),
      count: replies.length,
      faces: faceIds,
      lastAt: last.at,
      lastId: last.id,
      joined: !!meFaceId && faceIds.includes(meFaceId),
    });
  }
  // By id, not by timestamp: two replies in the same millisecond tie, and a
  // thread list that reshuffles on a tie is one nobody can keep their place in.
  return out.sort((a, b) => (a.lastId < b.lastId ? 1 : a.lastId > b.lastId ? -1 : 0));
}

/**
 * What to call a thread nobody named: the parent's first line.
 *
 * Not a generic "Thread" — six identical labels is a list you have to click
 * through one at a time, which is the failure a name is supposed to fix.
 */
export function threadLabelOf(summary: ThreadSummary, parent?: FakeMessage): string {
  if (summary.name) return summary.name;
  const line = (typeof parent?.body === 'string' ? parent.body : '').split('\n')[0]?.trim() ?? '';
  if (!line) return 'Thread';
  return line.length > 44 ? `${line.slice(0, 41)}…` : line;
}

/**
 * A MIME type for a fixture attachment.
 *
 * The fixtures describe an attachment by `kind` — the thing a renderer needs —
 * and a real `BlobRef` carries a MIME type, which is what a filter needs. One
 * is derivable from the other; the reverse is not, which is why the protocol
 * carries the type.
 */
function mimeOf(kind: string, name: string): string {
  if (kind === 'image') return 'image/png';
  if (kind === 'gif') return 'image/gif';
  if (kind === 'video') return 'video/mp4';
  if (kind === 'audio') return 'audio/mpeg';
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'pdf' ? 'application/pdf' : 'application/octet-stream';
}

/**
 * A room, in the shape `packages/core` reduces to.
 *
 * Enough of a `RoomState` for the parts that read one — search, above all,
 * which takes rooms as an argument precisely because *what is searchable* is a
 * policy question (`docs/03`) and not the matcher's business.
 *
 * The fields that are genuinely absent stay empty rather than being invented:
 * a fixture has no receipts and no applied-event set, and filling them with
 * plausible values would be inviting something to depend on them.
 */
export function roomStateOf(
  roomId: string,
  messages: FakeMessage[],
  faces: Record<string, Face>,
  names: Record<string, string>,
): RoomState {
  return {
    roomId,
    messages: allOf(messages, faces) as unknown as RoomState['messages'],
    pinned: messages.filter((m) => m.pinned).map((m) => m.id),
    receipts: new Map(),
    threadNames: new Map(Object.entries(names)),
    threadNamesAt: new Map(),
    applied: new Set(),
    deferred: new Map(),
    faces: new Map(),
    facesAt: new Map(),
    nameAt: undefined,
  } as unknown as RoomState;
}

// ---------------------------------------------------------------------------
// The other direction: a real `Message`, as this UI renders them
// ---------------------------------------------------------------------------

/**
 * A core `Message` in the shape the components read.
 *
 * The two are nearly the same — `UiMessage` is `Message` plus the fields the
 * fixtures exercise that the protocol has not grown — so this adds the two that
 * are genuinely missing and is honest about the one it cannot fill.
 */
export function fromCoreMessage(m: Message): UiMessage {
  return {
    ...m,
    ...(m.reactions
      ? {
          reactions: m.reactions.map((r) => ({
            key: r.key,
            accounts: r.accounts,
            // **Empty, and not guessable.** A reaction is by *account*
            // (`docs/04` §2) because a reaction is a person's and a face is a
            // presentation of one. Which face somebody was wearing when they
            // reacted is not on the wire, so the hover tooltip shows accounts
            // for real rooms and faces for fixtures — rather than this
            // inventing an answer that would be wrong the moment anybody used
            // two faces in a room.
            faces: [],
          })),
        }
      : {}),
    // Narrowed once, here. A real body is a node tree; every renderer today
    // handles strings, and the day one is not a string this is the line that
    // has to grow a renderer rather than twenty components.
    text: typeof m.body === 'string' ? m.body : '',
  } as UiMessage;
}
