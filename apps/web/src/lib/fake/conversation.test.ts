/**
 * The seam, tested at the one place it can silently lie.
 *
 * Everything downstream of `asCoreMessage` is typed, and `svelte-check` proves
 * the components read fields that exist. What it cannot prove is that those
 * fields are *populated* — a mapping that forgets `face` produces a perfectly
 * well-typed message that renders as "someone" in grey, and no type checker
 * will ever say a word about it.
 *
 * So: every field the UI renders, asserted against a real fixture.
 */
import { describe, expect, it } from 'vitest';
import { faces as seedFaces, messages as seedMessages } from './data.js';
import { allOf, asCoreMessage, findIn, repliesOf, timelineOf } from './messageShape.js';

/**
 * The fixtures directly, not through `core`.
 *
 * `core.svelte.ts` is full of runes and needs the Svelte compiler; the mapping
 * under test needs neither, which is exactly why it was pulled out of the
 * singleton in the first place.
 */
const faces = seedFaces;
const rooms = seedMessages;

/** A real fixture message from a real fixture room, not a hand-made one. */
function sample() {
  const found = every().find((m) => !m.deleted && typeof m.body === 'string' && m.body.length > 0);
  if (!found) throw new Error('no usable fixture message');
  return found;
}

const every = () => Object.values(rooms).flat();
const roomOf = (id: string) =>
  Object.keys(rooms).find((r) => (rooms[r] ?? []).some((x) => x.id === id)) as string;

describe('translating a fixture message', () => {
  it('carries the face as a snapshot rather than an id', () => {
    // `docs/04` §2: the face travels with the message, which is why renaming a
    // face does not rewrite everything it ever said. A mapping that dropped
    // this renders "someone" in grey and type-checks perfectly.
    const m = sample();
    const mapped = asCoreMessage(m, faces);
    const face = faces[m.faceId];

    expect(mapped.face).toBeDefined();
    expect(mapped.face?.id).toBe(m.faceId);
    expect(mapped.face?.name).toBe(face?.name);
    expect(mapped.face?.colour).toBe(face?.colour);
  });

  it('carries the account, which is what "is this mine" is decided by', () => {
    const m = sample();
    expect(asCoreMessage(m, faces).account).toBe(faces[m.faceId]?.accountId);
  });

  it('narrows the body to text exactly once', () => {
    // A real body is a node tree. Every fixture body is a string, and the day
    // one is not, this is the line that grows a renderer rather than twenty
    // components each doing their own `typeof`.
    const m = sample();
    const mapped = asCoreMessage(m, faces);
    expect(mapped.text).toBe(m.body);
    expect(mapped.body).toBe(m.body);
  });

  it('keeps ids and timestamps intact', () => {
    const m = sample();
    const mapped = asCoreMessage(m, faces);
    expect(mapped.id).toBe(m.id);
    expect(mapped.at).toBe(m.at);
  });

  it('renames `deleted` to the protocol‘s `redacted`, keeping who and when', () => {
    // A redaction is an in-band act by a person; a purge is the server dropping
    // the bytes and nobody choosing it. They are different facts and the UI
    // says different words, so they cannot share a field.
    const deleted = every().find((m) => m.deleted);
    if (!deleted) return; // no fixture exercises it; nothing to check
    const mapped = asCoreMessage(deleted, faces);
    expect(mapped.redacted).toEqual(deleted.deleted);
    expect(mapped.purged).toBeUndefined();
  });

  it('re-keys reactions to accounts while keeping the faces the UI shows', () => {
    // A reaction is a person's; a face is a presentation of one (`docs/11`).
    // The protocol keys by account and the hover tooltip names faces, so the
    // mapping has to carry both or one of them breaks silently.
    const reacted = every().find((m) => m.reactions?.length);
    if (!reacted) throw new Error('no fixture message has reactions');

    const mapped = asCoreMessage(reacted, faces);
    const first = mapped.reactions?.[0];
    expect(first?.key).toBe(reacted.reactions?.[0]?.key);
    expect(first?.faces).toEqual(reacted.reactions?.[0]?.by);
    expect(first?.accounts).toHaveLength(first?.faces.length ?? 0);
  });

  it('turns the single annotation into the list the protocol allows', () => {
    // `docs/04` §2 allows one per (target, author, kind), so a translation and
    // a transcript coexist. The fixtures only ever have one.
    const annotated = every().find((m) => m.annotation);
    if (!annotated) throw new Error('no fixture message is annotated');

    const [a] = asCoreMessage(annotated, faces).annotations ?? [];
    expect(a?.author).toBe(annotated.annotation?.by);
    expect(a?.kind).toBe(annotated.annotation?.kind);
    expect(a?.body).toBe(annotated.annotation?.body);
  });

  it('keeps replies, threads, pins and attachments', () => {
    const all = every();
    const reply = all.find((m) => m.replyTo);
    const thread = all.find((m) => m.thread);
    const pinned = all.find((m) => m.pinned);
    const withFile = all.find((m) => m.attachments?.length);

    if (reply) expect(asCoreMessage(reply, faces).replyTo).toBe(reply.replyTo);
    if (thread) expect(asCoreMessage(thread, faces).thread).toBe(thread.thread);
    if (pinned) expect(asCoreMessage(pinned, faces).pinned).toBe(true);
    if (withFile) {
      const mapped = asCoreMessage(withFile, faces).attachments ?? [];
      expect(mapped).toHaveLength(withFile.attachments?.length ?? 0);
      // And each one gained a MIME type. `packages/core`'s `has:image` filter
      // reads `mime`; the fixtures carry a `kind`. Without the translation the
      // app's search and the core's would disagree about what an image is.
      expect(mapped.every((a: { mime?: string }) => !!a.mime)).toBe(true);
    }
  });
});

describe('the timeline it hands the UI', () => {
  it('leaves thread replies out of the room', () => {
    // `docs/16`: a thread is a branch inside a room, and the room does not
    // show the branch inline.
    for (const [roomId, list] of Object.entries(rooms)) {
      expect(timelineOf(list, faces).some((m) => m.thread)).toBe(false);
      expect(allOf(list, faces).length).toBeGreaterThanOrEqual(timelineOf(list, faces).length);
      void roomId;
    }
  });

  it('finds a message by id', () => {
    const m = sample();
    expect(findIn(rooms[roomOf(m.id)] ?? [], faces, m.id)?.id).toBe(m.id);
  });

  it('gathers a thread‘s replies', () => {
    const reply = every().find((m) => m.thread);
    if (!reply) throw new Error('no fixture thread');
    const replies = repliesOf(rooms[roomOf(reply.id)] ?? [], faces, reply.thread as string);
    expect(replies.map((r) => r.id)).toContain(reply.id);
    expect(replies.every((r) => r.thread === reply.thread)).toBe(true);
  });

  it('gives every message a face, so nothing renders as an anonymous grey blob', () => {
    // The failure mode this whole file exists for.
    const missing = Object.values(rooms)
      .flatMap((list) => allOf(list, faces))
      .filter((m) => !m.face)
      .map((m) => m.id);
    expect(missing).toEqual([]);
  });
});

describe('a message whose face cannot be resolved', () => {
  it('comes out with no face rather than a guessed one', () => {
    // The mapping must not invent. What it hands over is the absence, and the
    // renderer is what decides to say "Unknown" — one decision, one place.
    const m = sample();
    const mapped = asCoreMessage({ ...m, faceId: 'nobody-has-this-face' }, faces);
    expect(mapped.face).toBeUndefined();
  });

  it('does not let two unknown senders look like one', () => {
    // The grouping rule compares `prev.face.id === m.face.id`, and without an
    // explicit presence check `undefined === undefined` is true — two different
    // strangers under one avatar and one name. This asserts the shape that rule
    // depends on: an unresolved face is absent, not a shared empty object.
    const m = sample();
    const a = asCoreMessage({ ...m, id: 'a', faceId: 'ghost-one' }, faces);
    const b = asCoreMessage({ ...m, id: 'b', faceId: 'ghost-two' }, faces);
    expect(a.face).toBeUndefined();
    expect(b.face).toBeUndefined();
    expect(a.account).not.toBe(b.account);
  });
});
