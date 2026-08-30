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

import type { Message } from '@revel/core';
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
    ...(m.attachments ? { attachments: m.attachments } : {}),
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
export function timelineOf(messages: FakeMessage[], faces: Record<string, Face>): UiMessage[] {
  return messages.filter((m) => !m.thread).map((m) => asCoreMessage(m, faces));
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
