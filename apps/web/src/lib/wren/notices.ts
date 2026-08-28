/**
 * Wren's notice copy deck, as data.
 *
 * Every string here is pasted from `docs/13-wren-notices.md`, which is the
 * authority: if this file and a mockup disagree, the doc wins. Bodies are
 * functions of context rather than templates with holes, because half of them
 * need to pluralise or name a device and a format string that does that gets
 * unreadable fast.
 *
 * Two fields carry the design's teeth:
 *
 * - `severity` drives the ambient dot's colour, nothing else.
 * - `ceiling` is the highest rung this notice may *ever* reach. It is declared
 *   here, next to the copy, so that adding a notice means making the call
 *   deliberately. `docs/12`: a heuristic without a declared ceiling doesn't
 *   ship.
 *
 * Nothing in this file decides what rung a notice actually gets. That is
 * `wren.svelte.ts`, in one function, on purpose.
 */

/** Drives the dot colour and the ordering in the panel. Nothing else. */
export type Severity = 'neutral' | 'gold' | 'coral';

/**
 * The escalation ladder from `docs/12`.
 *
 * 1 panel · 2 dot · 3 inline card · 4 popup that takes focus.
 */
export type Rung = 1 | 2 | 3 | 4;

/** Groups match the headings in `docs/13`. Silencing works per category. */
export type Category = 'keys' | 'readers' | 'more' | 'housekeeping';

export const CATEGORIES: { id: Category; name: string; blurb: string }[] = [
  { id: 'keys', name: 'Keys and devices', blurb: 'Recovery, devices, key changes' },
  { id: 'readers', name: 'Who can read this', blurb: 'Agents, history, invite links' },
  { id: 'more', name: 'Getting more out of it', blurb: 'Translation, transcription, the command bar' },
  { id: 'housekeeping', name: 'Housekeeping', blurb: 'Storage, models, leftover history' },
];

export interface Action {
  /** Returned to the panel's handler. */
  id: string;
  label: string;
  /**
   * The action that resolves the notice without doing the thing — "It's fine",
   * "No thanks", "Leave it". Drawn quieter, and never the first button.
   */
  dismissive?: boolean;
  /** Irreversible. Confirms in her voice before running (`docs/12`). */
  destructive?: boolean;
}

export interface Notice {
  /** Stable per subject, so a notice about the iPad and one about the phone
      are two notices rather than one that flickers between them. */
  id: string;
  category: Category;
  severity: Severity;
  ceiling: Rung;
  title: string;
  body: string;
  actions: Action[];
  /**
   * Set on the one notice allowed past the interruption budget: a contact's
   * key changing in a conversation you are currently in. Suppressing that
   * would be the single genuinely dangerous silence (`docs/12`).
   */
  exemptFromBudget?: boolean;
  /**
   * Only offered at Chatty. The low-value hygiene heuristics live here — true
   * enough to be worth an opt-in, not worth anyone's default attention.
   */
  chattyOnly?: boolean;
}

/**
 * The heuristics that were considered and deliberately not built, kept here
 * because the reasoning is the useful part and it will otherwise be
 * rediscovered and re-argued.
 *
 * `docs/13` still lists copy for the busy-room notice. `docs/12` cut it during
 * review, and the cut is the later and better-reasoned decision, so it wins:
 * it reads as state (counts, recency) but is one abstraction step from "we
 * noticed you're not engaging", which is where every bad notification system
 * ends up. Lurking is not a problem to solve.
 */
export const NOT_BUILT = [
  {
    name: 'Busy room you never post in → offer to mute',
    why: 'Cut in `docs/12` review. Muting stays a normal feature one click away; Wren just does not bring it up.',
  },
] as const;
