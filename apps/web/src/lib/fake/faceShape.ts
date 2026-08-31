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
export function speakerIn(dm: Dm | undefined, globalFace: string): string {
  if (!dm) return globalFace;
  if (dm.speakingAs && dm.mineIds.includes(dm.speakingAs)) return dm.speakingAs;
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
