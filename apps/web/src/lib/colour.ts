/**
 * What colour somebody is, when nobody chose one.
 *
 * A face carries an optional `colour` — a token name from `docs/07`, not a hex
 * value — and most faces do not have one. The first face an account gets is
 * made from its handle at sign-in and never asked about colour, so *most*
 * people in a room have none at all.
 *
 * Every caller used to fall back on its own: `lilac` in `Avatar`, `violet` in
 * search, and `grey` in `MessageRow` — which is not a token that exists, so a
 * message from anybody who had not picked a colour rendered an avatar with **no
 * background**, a bare letter floating in the list. Your own looked fine,
 * because you are the one person likely to have picked.
 *
 * So: derive one from the face's id. Deterministic, so the same person is the
 * same colour on every device, for every viewer, forever — a colour that
 * reshuffled on reload would be worse than no colour, because a face colour is
 * identity (`docs/32` transitions it rather than snapping for that reason).
 */

import type { FaceColour } from './fake/data.js';

/** `docs/07`'s face palette, in token order. */
export const FACE_COLOURS: FaceColour[] = [
  'gold',
  'rose',
  'violet',
  'sky',
  'mint',
  'coral',
  'lilac',
  'aqua',
];

/**
 * A stable colour for an id.
 *
 * FNV-1a rather than anything clever: it is four lines, it has no dependencies,
 * and the only property needed here is that similar ids land in different
 * buckets — `face-1` and `face-2` being adjacent would put every early face in
 * a room in the same colour.
 */
export function colourFor(id: string): FaceColour {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return FACE_COLOURS[hash % FACE_COLOURS.length] as FaceColour;
}

/** Whether a string is one of the tokens, rather than something a peer made up. */
export function isFaceColour(value: string | undefined): value is FaceColour {
  return !!value && (FACE_COLOURS as string[]).includes(value);
}

/**
 * The colour to paint a face in.
 *
 * **Validated, not trusted.** `FaceRef.colour` is `z.string().max(32)` on the
 * wire, so it is whatever the sending client put there — and it goes straight
 * into `var(--face-{...})`. An unknown value resolves to nothing and paints a
 * transparent avatar, which is how this broke; a hostile one is at worst a
 * missing background, since a CSS custom-property name cannot escape its own
 * `var()`. Falling back to the derived colour fixes both.
 */
export function faceColour(face: { id?: string; colour?: string } | null | undefined): FaceColour {
  if (isFaceColour(face?.colour)) return face.colour;
  return colourFor(face?.id ?? '');
}
