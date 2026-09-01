/**
 * The face book.
 *
 * These are privacy rules wearing convenience clothes, so they get tested like
 * rules — the same argument `apps/web`'s `faceShape.test.ts` makes about the
 * fixture version, now against the real one.
 */
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { FaceCard, FaceRef } from '@revel/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addFace,
  cardOf,
  type Face,
  type FaceBook,
  forgetFaces,
  loadFaces,
  refOf,
  removeFace,
  revealsLink,
  saveFaces,
  speakAs,
  speakerIn,
  updateFace,
} from '../src/index.js';

const face = (id: string, name = id): Face => ({ id, name, colour: 'violet' });
const book = (...faces: Face[]): FaceBook =>
  faces.reduce((b, f) => addFace(b, f), { faces: [], primary: '', byRoom: {} } as FaceBook);

beforeEach(() => {
  // A clean origin per test; `fake-indexeddb/auto` puts one on `globalThis`.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe('the book', () => {
  it('makes the first face the primary, because something has to be', () => {
    const b = book(face('viola'), face('ash'));
    expect(b.primary).toBe('viola');
    expect(b.faces.map((f) => f.id)).toEqual(['viola', 'ash']);
  });

  it('replaces a face rather than adding a second with the same id', () => {
    const b = addFace(book(face('viola')), { ...face('viola'), name: 'Viola B' });
    expect(b.faces).toHaveLength(1);
    expect(b.faces[0]?.name).toBe('Viola B');
  });

  it('renames without disturbing anything else', () => {
    const b = updateFace(book(face('viola'), face('ash')), 'ash', { name: 'Ash!' });
    expect(b.faces.find((f) => f.id === 'ash')?.name).toBe('Ash!');
    expect(b.primary).toBe('viola');
  });
});

describe('who speaks where', () => {
  it('prefers the room choice, then the primary, then the first', () => {
    const b = speakAs(book(face('viola'), face('ash')), 'room-1', 'ash');
    expect(speakerIn(b, 'room-1')?.id).toBe('ash');
    // A room with no choice falls back to the primary.
    expect(speakerIn(b, 'room-2')?.id).toBe('viola');
  });

  it('keeps one room choice out of another', () => {
    // The regression this exists to prevent: one selection shared across rooms,
    // where switching in one moved the other. It is also the reason the
    // reveal check below can be trusted — it asks about the room you are in.
    let b = book(face('viola'), face('ash'), face('june'));
    b = speakAs(b, 'a', 'ash');
    b = speakAs(b, 'b', 'june');
    expect(speakerIn(b, 'a')?.id).toBe('ash');
    expect(speakerIn(b, 'b')?.id).toBe('june');
  });

  it('ignores a choice of a face that does not exist', () => {
    const b = speakAs(book(face('viola')), 'room-1', 'nobody');
    expect(b.byRoom['room-1']).toBeUndefined();
    expect(speakerIn(b, 'room-1')?.id).toBe('viola');
  });

  it('is null for an account with no faces, rather than inventing a name', () => {
    expect(speakerIn({ faces: [], primary: '', byRoom: {} }, 'room-1')).toBeNull();
  });
});

describe('removing a face', () => {
  it('drops it, its room choices, and hands on the primary', () => {
    let b = book(face('viola'), face('ash'));
    b = speakAs(b, 'room-1', 'viola');
    b = removeFace(b, 'viola');

    expect(b.faces.map((f) => f.id)).toEqual(['ash']);
    expect(b.byRoom['room-1']).toBeUndefined();
    expect(b.primary).toBe('ash');
  });

  it('leaves an empty book empty rather than pointing at nothing', () => {
    const b = removeFace(book(face('viola')), 'viola');
    expect(b.faces).toEqual([]);
    expect(b.primary).toBe('');
  });
});

describe('what speaking here would reveal', () => {
  it('reveals nothing in a room none of my faces has spoken in', () => {
    expect(revealsLink([], 'ash')).toBe(false);
  });

  it('reveals nothing for a face that has already spoken here', () => {
    // The link is already out, and asking again is theatre — friction on a
    // privacy control is how people learn to click through it.
    expect(revealsLink(['ash'], 'ash')).toBe(false);
    expect(revealsLink(['viola', 'ash'], 'ash')).toBe(false);
  });

  it('reveals a link when a different face of mine has spoken here', () => {
    // Attribution is per account and the face is inside the message, so the
    // second face to speak is what joins them up (`docs/11`).
    expect(revealsLink(['viola'], 'ash')).toBe(true);
  });
});

describe('the ref that goes on a message', () => {
  it('carries only what the protocol has, and drops what it does not', () => {
    const ref = refOf({ id: 'viola', name: 'Viola', colour: 'violet', pronouns: 'she/her' });
    expect(ref).toEqual({ id: 'viola', name: 'Viola', colour: 'violet', pronouns: 'she/her' });
  });

  it('omits absent fields rather than sending empty ones', () => {
    // An empty string in encrypted history is permanent, and `docs/29` §1 is
    // blunt that encrypted history cannot be rewritten.
    expect(refOf({ id: 'ash', name: 'Ash' })).toEqual({ id: 'ash', name: 'Ash' });
  });

  it('never carries the note, however the face is written', () => {
    // The whole reason `FaceCard` exists. A note on `FaceRef` would ride on
    // every message anyone ever sends, forever, for something that changes
    // about twice a year — and `docs/29` §1 means it could never be taken off
    // again. This is the assertion that keeps it off.
    const ref = refOf({ id: 'viola', name: 'Viola', note: 'building the thing' });
    expect(ref).not.toHaveProperty('note');
    expect(ref).toEqual({ id: 'viola', name: 'Viola' });
  });
});

describe('the card that goes on the roster', () => {
  it('is the ref plus the note', () => {
    const face = { id: 'viola', name: 'Viola', colour: 'violet', note: 'building the thing' };
    expect(cardOf(face)).toEqual({
      id: 'viola',
      name: 'Viola',
      colour: 'violet',
      note: 'building the thing',
    });
  });

  it('omits the note when there is not one', () => {
    expect(cardOf({ id: 'ash', name: 'Ash' })).toEqual({ id: 'ash', name: 'Ash' });
  });

  it('is what `room.faces` accepts and a message payload does not', () => {
    const withNote = { id: '1', name: 'Viola', note: 'building the thing' };
    expect(FaceCard.safeParse(withNote).success).toBe(true);
    // `FaceRef` is a plain object schema, so it does not reject the extra key
    // — it strips it. Which is the property that matters: a note put on a
    // message by a future client does not survive the parse into history.
    expect(FaceRef.parse(withNote)).toEqual({ id: '1', name: 'Viola' });
  });
});

describe('storage', () => {
  it('round-trips through a sealed store', async () => {
    const b = speakAs(book(face('viola'), face('ash')), 'room-1', 'ash');
    await saveFaces('acct-a', b);
    expect(await loadFaces('acct-a')).toEqual(b);
  });

  it('gives an account with no book an empty one', async () => {
    expect(await loadFaces('acct-nobody')).toEqual({ faces: [], primary: '', byRoom: {} });
  });

  it('keeps two accounts on one device apart', async () => {
    // Two accounts is `docs/17`'s answer to "nobody may know these are the same
    // person". Sharing a face book between them would undo that on the device
    // where it matters most.
    await saveFaces('acct-a', book(face('viola')));
    await saveFaces('acct-b', book(face('ash')));

    expect((await loadFaces('acct-a')).faces.map((f) => f.id)).toEqual(['viola']);
    expect((await loadFaces('acct-b')).faces.map((f) => f.id)).toEqual(['ash']);
  });

  it('forgets one account without touching the other', async () => {
    await saveFaces('acct-a', book(face('viola')));
    await saveFaces('acct-b', book(face('ash')));
    await forgetFaces('acct-a');

    expect((await loadFaces('acct-a')).faces).toEqual([]);
    expect((await loadFaces('acct-b')).faces).toHaveLength(1);
  });
});
