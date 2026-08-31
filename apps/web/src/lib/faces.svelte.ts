/**
 * This account's faces, in the browser.
 *
 * The book lives in `@revel/core` (`identity/faces.ts`) and is sealed on this
 * device; this is the reactive wrapper the UI reads, and the thing that decides
 * whether "my faces" means the real book or the fixtures.
 *
 * ## Two modes, and saying which
 *
 * Signed in, faces are real: loaded from the book, saved back on every change,
 * and stamped onto messages. Not signed in — `?demo=1`, the reference page,
 * every screen somebody wants to look at without making an account — they are
 * the fixtures, exactly as before.
 *
 * `live` is how everything else tells the difference, and it exists because the
 * two are genuinely different and pretending otherwise is how a fixture ends up
 * on the wire. The fixture faces are ids like `viola`; a real one is a
 * snowflake, because `FaceRef.id` is. A fixture face that reached a real room
 * would fail the payload's own schema and arrive as an unknown event.
 */
import {
  addFace,
  type Face,
  type FaceBook,
  loadFaces,
  newFaceId,
  removeFace,
  revealsLink,
  saveFaces,
  speakAs,
  speakerIn,
  updateFace,
} from '@revel/core';

const empty = (): FaceBook => ({ faces: [], primary: '', byRoom: {} });

class MyFaces {
  /** The book. Empty until `load`, and empty for an account with no faces. */
  book = $state<FaceBook>(empty());
  /** Whose book this is. Empty when running on fixtures. */
  account = $state('');

  /** Whether the real book is in use. See the note above. */
  get live(): boolean {
    return this.account !== '';
  }

  /** Load an account's faces. Called once the session has restored. */
  async load(accountPub: string): Promise<void> {
    this.account = accountPub;
    this.book = await loadFaces(accountPub);
  }

  /** Back to fixtures — on sign-out, so the next person sees no trace. */
  forget(): void {
    this.account = '';
    this.book = empty();
    // Deliberately not deleting the stored book: signing out of a device you
    // own should not destroy the faces you made on it, and the book is sealed
    // and per account. `forgetFaces` exists for actually removing one.
  }

  async #commit(next: FaceBook): Promise<void> {
    this.book = next;
    if (this.live) await saveFaces(this.account, next);
  }

  /** Create a face. Its id is minted, never chosen — see `newFaceId`. */
  async create(name: string, patch: Partial<Omit<Face, 'id' | 'name'>> = {}): Promise<Face> {
    const face: Face = { id: newFaceId(), name, ...patch };
    await this.#commit(addFace(this.book, face));
    return face;
  }

  async update(id: string, patch: Partial<Omit<Face, 'id'>>): Promise<void> {
    await this.#commit(updateFace(this.book, id, patch));
  }

  async remove(id: string): Promise<void> {
    await this.#commit(removeFace(this.book, id));
  }

  /** Choose a face for one room. Per room — see `identity/faces.ts` for why. */
  async speak(roomId: string, faceId: string): Promise<void> {
    await this.#commit(speakAs(this.book, roomId, faceId));
  }

  /** Who speaks in a room. `null` for an account that has made no faces. */
  speaking(roomId: string): Face | null {
    return speakerIn(this.book, roomId);
  }

  /**
   * Would speaking as this face here newly connect two of mine?
   *
   * `spokenHere` is the faces of *mine* already seen in this room. The caller
   * supplies it because it comes from room state, which this module does not
   * have and should not reach for.
   */
  reveals(spokenHere: readonly string[], faceId: string): boolean {
    return revealsLink(spokenHere, faceId);
  }
}

export const myFaces = new MyFaces();
