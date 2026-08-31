/**
 * Which of my faces is in a conversation, and which one is speaking.
 *
 * Pulled out of `core.svelte.ts` for the reason `messageShape.ts` was: the rules
 * are pure, the singleton is full of runes, and this is logic where being wrong
 * is a *privacy* failure rather than a rendering one — so it wants tests that do
 * not need a Svelte compiler to run.
 *
 * The distinction these encode (`docs/11`, `docs/03` §4):
 *
 * - **A DM is a list of faces.** Being in one is a fact the other people can
 *   see, so which of my faces are present is membership, not presentation.
 * - **A space room is a list of accounts.** Roles and audiences are
 *   account-level however many faces you speak as, so every face is available
 *   and none of them is a participant in its own right.
 */
import type { Dm } from './data.js';

/**
 * The faces of mine that are in this conversation, or `null` where the question
 * does not apply (a space room).
 *
 * `null` rather than "all of them" on purpose: the caller has to notice the
 * difference between *unrestricted* and *everyone happens to be in it*, because
 * only one of those should grey anything out.
 */
export function facesIn(dm: Dm | undefined): string[] | null {
  return dm ? dm.mineIds : null;
}

/** Whether a face may speak here without joining first. */
export function isHere(dm: Dm | undefined, faceId: string): boolean {
  const here = facesIn(dm);
  return here === null || here.includes(faceId);
}

/**
 * The face that speaks here: the conversation's choice, else its first member,
 * else the account-wide one.
 *
 * The fallback matters. A stored choice can name a face that has since left the
 * conversation, and speaking as somebody who is not in the room would be a
 * worse outcome than ignoring the preference.
 */
export function speakerIn(
  dm: Dm | undefined,
  chosen: string | undefined,
  globalFace: string,
): string {
  // A choice made *in this room* wins, wherever the room is.
  //
  // Per room rather than per account, and that is load-bearing rather than a
  // convenience: the "would this reveal a link" check runs against the room you
  // are in, so a global selection would let you switch in a room where it is
  // harmless and arrive in one where it is not, already set to the face that
  // gives you away. A local choice cannot leak out of the room it was made in.
  if (chosen && isHere(dm, chosen)) return chosen;
  if (!dm) return globalFace;
  return dm.mineIds[0] ?? globalFace;
}

/**
 * Everyone in the conversation, mine and theirs, in that order.
 *
 * Never de-duplicated by account, and never derived from whichever face is
 * selected — both of which this used to do. `docs/11`: with linking off each
 * face is an independent person, and collapsing two of them announces that they
 * are one system to anybody who can count.
 */
export function participantsIn(dm: Dm): string[] {
  return [...dm.mineIds, ...dm.withIds];
}

/**
 * Which of my faces have already spoken in a room.
 *
 * The basis for the *other* half of this, which applies to space rooms — where
 * there is no participant list to join. See [`revealsLink`].
 */
export function facesSpokenIn(
  messages: { faceId: string }[] | undefined,
  mine: readonly string[],
): string[] {
  const seen: string[] = [];
  for (const m of messages ?? []) {
    if (mine.includes(m.faceId) && !seen.includes(m.faceId)) seen.push(m.faceId);
  }
  return seen;
}

/**
 * Whether speaking as `faceId` here would newly reveal that two of my faces are
 * one account.
 *
 * **This is the leak, stated exactly.** It has nothing to do with membership —
 * a space room's membership is per account and every face is already allowed to
 * post. What tells people something is *two of my faces appearing in the same
 * room*: attribution is per account and the face is a field inside the message
 * (`docs/11`), so the second one to speak is the one that joins them up.
 *
 * Which makes the condition narrow, and deliberately self-limiting:
 *
 * - Nothing to reveal if none of my faces has spoken here — nobody can connect
 *   a face to anything yet.
 * - Nothing to reveal if *this* face has already spoken here — the link is
 *   already out, and asking again would be theatre. Friction on a privacy
 *   control is how people learn to click through it.
 *
 * So it fires at most once per face per room, ever.
 */
export function revealsLink(spokenHere: readonly string[], faceId: string): boolean {
  return spokenHere.length > 0 && !spokenHere.includes(faceId);
}
