/**
 * Which faces this account has, and which one is speaking where (`docs/11`).
 *
 * ## Where faces live, which is not where you would guess
 *
 * `docs/03` §7 is specific: **the headmate roster is a per-room encrypted state
 * event**, so the server never learns a system's members. A face reaches other
 * people two ways, and neither of them is a profile the Host can read:
 *
 * 1. Snapshotted onto each message as a `FaceRef`, so an old message keeps the
 *    name it was sent under even after a rename (`docs/04` §2);
 * 2. Declared in a `room.faces` event, which is what tells a room the roster —
 *    and which is why a device that joins a room later learns the faces from
 *    the room's own history rather than from an account-wide list somewhere.
 *
 * This module owns the third thing, which is local: **the book** — the faces
 * this account has defined, including ones not yet used anywhere, and which one
 * is selected in which room.
 *
 * ## Why the selection is per room
 *
 * Somebody who is Ash in one place and June in another should not have to
 * remember which, and must never be one mis-click from speaking as the wrong
 * one. It is also load-bearing rather than convenient: `docs/11`'s
 * "would this reveal a link" question is asked about the room you are in, so a
 * single account-wide selection would let you switch where it is harmless and
 * arrive where it is not, already set to the face that gives you away.
 */
import type { FaceRef } from '@revel/protocol';
import { deleteSealed, getSealed, putSealed } from './sealed.js';

export interface Face {
  /**
   * A snowflake, because `FaceRef.id` is one (`/^\d{1,20}$/`).
   *
   * Worth stating: an id like `face-viola` type-checks perfectly here, fails
   * the payload schema on the way out, and the whole event then arrives at the
   * other end as an *unknown type* — no face, no roster, no error anywhere.
   * That is exactly how it was found.
   */
  id: string;
  name: string;
  /** A face-palette name, not a hex value — themes re-map them. */
  colour?: string;
  pronouns?: string;
  /** Blob id of an avatar, once attachments carry one. */
  avatar?: string;
  /**
   * The one-line note on the profile card — `docs/11`'s "does the actual work".
   *
   * **Local only, for now.** `FaceRef` carries id, name, colour, pronouns and
   * avatar, and not this — so a note shows on your own card and not on anybody
   * else's. Fixing that means a new field in a payload that goes into encrypted
   * history, which `docs/29` §1 says can never be rewritten, so it is a decision
   * rather than an oversight and it is not made here.
   */
  note?: string;
}

export interface FaceBook {
  faces: Face[];
  /** Used where no room-specific choice has been made. */
  primary: string;
  /** roomId → face id. See the note above on why this is not one value. */
  byRoom: Record<string, string>;
}

/**
 * A fresh face id.
 *
 * A snowflake, because `FaceRef.id` is one. Minting it here rather than letting
 * callers invent one is the difference between a face that travels and a face
 * that fails its own schema on the way out and arrives as an unknown event.
 */
export function newFaceId(now = Date.now()): string {
  // Millisecond timestamp plus randomness, in the snowflake's decimal range.
  const random = Math.floor(Math.random() * 1_000_000);
  return String(BigInt(now) * 1_000_000n + BigInt(random));
}

/** One book per account, so two accounts on one device do not share faces. */
const bookId = (accountPub: string) => `faces:${accountPub}`;
const store = { name: 'revel-faces' };

const empty = (): FaceBook => ({ faces: [], primary: '', byRoom: {} });

/** Load this account's book. An account with none gets an empty one. */
export async function loadFaces(accountPub: string): Promise<FaceBook> {
  return (await getSealed<FaceBook>(bookId(accountPub), store)) ?? empty();
}

export async function saveFaces(accountPub: string, book: FaceBook): Promise<void> {
  await putSealed(bookId(accountPub), book, store);
}

export async function forgetFaces(accountPub: string): Promise<void> {
  await deleteSealed(bookId(accountPub), store);
}

/**
 * The face that speaks in a room.
 *
 * The room's choice, else the primary, else the first — and `null` only when
 * there are no faces at all, which is an account that has never made one and
 * should be sending without a `FaceRef` rather than inventing a name.
 */
export function speakerIn(book: FaceBook, roomId: string): Face | null {
  const chosen = book.byRoom[roomId];
  const byId = (id: string | undefined) => book.faces.find((f) => f.id === id);
  return byId(chosen) ?? byId(book.primary) ?? book.faces[0] ?? null;
}

/** The `FaceRef` to stamp on a message. Only the fields the protocol carries. */
export function refOf(face: Face): FaceRef {
  return {
    id: face.id,
    name: face.name,
    ...(face.colour ? { colour: face.colour } : {}),
    ...(face.pronouns ? { pronouns: face.pronouns } : {}),
    ...(face.avatar ? { avatar: face.avatar } : {}),
  };
}

/**
 * Whether speaking as `faceId` here would newly connect two of this account's
 * faces (`docs/11`).
 *
 * `spokenHere` is the faces of *mine* that have already appeared in this room —
 * available from `RoomState.faces` filtered to the book. The condition is
 * narrow and self-limiting on purpose: nothing to reveal if none of mine has
 * spoken here, and nothing to reveal if this one already has. It fires at most
 * once per face per room, because friction on a privacy control is how people
 * learn to click through it.
 */
export function revealsLink(spokenHere: readonly string[], faceId: string): boolean {
  return spokenHere.length > 0 && !spokenHere.includes(faceId);
}

/** Add a face. The first one becomes the primary, because something has to be. */
export function addFace(book: FaceBook, face: Face): FaceBook {
  const faces = [...book.faces.filter((f) => f.id !== face.id), face];
  return { ...book, faces, primary: book.primary || face.id };
}

export function updateFace(book: FaceBook, id: string, patch: Partial<Omit<Face, 'id'>>): FaceBook {
  return { ...book, faces: book.faces.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

/**
 * Remove a face from the book.
 *
 * **It does not unsay anything.** Messages already sent carry a `FaceRef`
 * snapshot and rooms already told carry a `room.faces` entry; neither is
 * reachable from here, and pretending otherwise would be the worst kind of
 * privacy promise — one that reads as "this never happened" and means "it is
 * not in this list any more".
 */
export function removeFace(book: FaceBook, id: string): FaceBook {
  const faces = book.faces.filter((f) => f.id !== id);
  const byRoom = Object.fromEntries(
    Object.entries(book.byRoom).filter(([, chosen]) => chosen !== id),
  );
  return {
    faces,
    byRoom,
    primary: book.primary === id ? (faces[0]?.id ?? '') : book.primary,
  };
}

/** Choose a face for one room. Unknown faces are ignored rather than stored. */
export function speakAs(book: FaceBook, roomId: string, faceId: string): FaceBook {
  if (!book.faces.some((f) => f.id === faceId)) return book;
  return { ...book, byRoom: { ...book.byRoom, [roomId]: faceId } };
}
