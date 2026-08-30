/**
 * Search.
 *
 * `docs/19` §Search, and the reason it looks like this is `docs/03`: **the
 * server is the search adversary.** There is nothing to query server-side
 * because there is nothing legible server-side, so the index is local by
 * construction rather than as a privacy feature bolted on afterwards. That is
 * worth saying in the UI once, plainly, and never again.
 *
 * It also means the failure mode is different from every other chat app's. A
 * server-side search is either up or down. A local one can be *partially
 * built* — a new device that has pulled six rooms out of a hundred can answer
 * a query, just not completely. `docs/19` is explicit that this has to be
 * visible: "a search that can't see everything must say so, or people will
 * conclude the message doesn't exist." Silently returning half the results is
 * the one behaviour that would make search worse than useless.
 */

import { parseQuery as coreParseQuery, search as coreSearch, isEmptyQuery } from '@revel/core';
import type { UiMessage as Message } from '../fake/conversation.svelte.js';
import { conversation } from '../fake/conversation.svelte.js';
import { core } from '../fake/core.svelte.js';
import { directory } from '../fake/directory.svelte.js';

/** Where to look. Defaults to the room you are in and widens in one click. */
export type Scope = 'room' | 'space' | 'everywhere';

/** How far back. A control rather than query syntax — nobody types a date. */
export type Window = 'any' | 'day' | 'week' | 'month';

const WINDOW_MS: Record<Window, number> = {
  any: Infinity,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  month: 30 * 24 * 60 * 60_000,
};

/** A parsed query: the words, and the filters lifted out of them. */
interface Parsed {
  terms: string[];
  /** Lower-cased phrase, for the exact-match bonus. */
  phrase: string;
  from?: string;
  has?: 'file' | 'image' | 'link';
  /** `in:thread` — `docs/19`'s fourth filter. Thread replies are out of the
      timeline by design, which makes them exactly the thing you end up
      searching for. */
  inThread?: boolean;
}

export interface Hit {
  message: Message;
  roomId: string;
  /** `#design` or a DM's title — whatever the result row should say. */
  where: string;
  /** The space it lives in, or undefined for a DM. */
  spaceId?: string;
  spaceName: string;
  score: number;
  /** The body, trimmed to a window around the first match. */
  excerpt: string;
  /** `[start, end)` pairs into `excerpt`, already sorted and non-overlapping. */
  marks: [number, number][];
}

/** Enough results to scroll; past this nobody is reading, they are refining. */
const MAX_HITS = 120;
/** Characters of body either side of the first match. */

/** Every index of `needle` in `hay`, both already lower-cased. */
function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + needle.length);
  }
  return out;
}

/** A match that starts a word scores higher than one buried inside one. */
function atWordStart(hay: string, i: number) {
  return i === 0 || !/[a-z0-9]/i.test(hay[i - 1]!);
}

class Search {
  open = $state(false);
  query = $state('');
  scope = $state<Scope>('room');
  window = $state<Window>('any');

  /**
   * Index progress, in rooms. Real counts, not a decorative bar: `build()`
   * genuinely walks the rooms and this genuinely tracks it. On this device
   * with this fixture it finishes in about a millisecond, which is why
   * `?indexing=slow` exists — a state nobody can reach is a state nobody
   * reviews, and this one is the whole difference between an honest search
   * and a quietly incomplete one.
   */
  ready = $state<string[]>([]);
  roomsToIndex = $state(0);

  get indexed() {
    return this.ready.length;
  }

  get indexing() {
    return this.roomsToIndex > 0 && this.indexed < this.roomsToIndex;
  }

  /** Every room this account can search, in a stable order. */
  private allRooms(): { roomId: string; spaceId?: string }[] {
    const out: { roomId: string; spaceId?: string }[] = [];
    for (const s of core.spaces) {
      for (const r of s.rooms) {
        if (r.kind === 'voice') continue; // nothing written to find
        out.push({ roomId: r.id, spaceId: s.id });
      }
    }
    for (const d of core.dms) out.push({ roomId: d.id });
    return out;
  }

  /**
   * Walk the rooms, marking each one searchable.
   *
   * The real core will be reading a local database that the sync engine is
   * still filling, so this is the shape rather than the substance: the useful
   * part is that the UI is built against an index with a *build state*, and
   * so cannot accidentally assume completeness.
   */
  async build(pace = 0) {
    const rooms = this.allRooms();
    this.roomsToIndex = rooms.length;
    this.ready = [];
    for (const room of rooms) {
      if (pace) await new Promise((r) => setTimeout(r, pace));
      else await Promise.resolve();
      this.ready = [...this.ready, room.roomId];
    }
  }

  /** Start indexing, honouring the `?indexing=slow` review affordance. */
  start() {
    if (typeof location === 'undefined') return;
    const slow = new URLSearchParams(location.search).get('indexing') === 'slow';
    void this.build(slow ? 420 : 0);
  }

  /**
   * Which rooms a given scope covers.
   *
   * Takes the scope rather than reading `this.scope`, because the widen
   * buttons need the count for a scope that isn't the current one. The
   * tempting version — set the field, measure, set it back — is a state write
   * inside a template expression, which Svelte refuses outright and is right
   * to: a getter that mutates is a getter that can be called twice and give
   * two answers.
   */
  private roomsIn(scope: Scope): { roomId: string; spaceId?: string }[] {
    // Only what has actually been indexed. This is what makes the "searching
    // 12 of 148 rooms" banner true rather than decorative: while the index is
    // building, the results really are partial, and they really do grow. A
    // banner that warns about incompleteness over a complete result set is
    // dishonest in the other direction, and just as bad.
    const all =
      scope === 'everywhere'
        ? this.allRooms()
        : scope === 'space'
          ? core.scope === 'home'
            ? core.dms.map((d) => ({ roomId: d.id }))
            : (core.spaces.find((x) => x.id === core.currentSpaceId)?.rooms ?? [])
                .filter((r) => r.kind !== 'voice')
                .map((r) => ({ roomId: r.id, spaceId: core.currentSpaceId }))
          : [
              {
                roomId: core.currentRoomId,
                spaceId: core.scope === 'home' ? undefined : core.currentSpaceId,
              },
            ];

    if (!this.indexing) return all;
    const done = new Set(this.ready);
    return all.filter((r) => done.has(r.roomId));
  }

  /** How many rooms a scope would search. Shown on the widen buttons, because
      "widen to the space" means nothing until you know the space is nine
      rooms and everywhere is eleven. */
  countFor(scope: Scope) {
    return this.roomsIn(scope).length;
  }

  private label(roomId: string, spaceId?: string) {
    if (spaceId) {
      const r = core.spaces.find((s) => s.id === spaceId)?.rooms.find((x) => x.id === roomId);
      return `#${r?.name ?? roomId}`;
    }
    // Named by the faces in it, never collapsed by account: `docs/11`'s
    // linking control is off by default and each face is its own person.
    return core.dms.some((d) => d.id === roomId) ? directory.title(roomId) : roomId;
  }

  /**
   * Results for the current query, scope and window.
   *
   * A live scan of the local store rather than a lookup in a inverted index:
   * at this size that is both faster and more obviously correct, and it can
   * never go stale against a message sent a second ago. When the real core
   * lands this is the method that gets a real index behind it — the shape of
   * what it returns is what the UI was designed against.
   */
  readonly results = $derived.by<Hit[]>(() => {
    // The matching is `packages/core`'s. This method decides *what is
    // searchable* — scope, window, which rooms — because `docs/03` makes that a
    // policy question and the core's `search` takes rooms as an argument for
    // exactly that reason. It does not decide what a match is, or how a match
    // is scored, or where an excerpt is cut. There were two implementations of
    // those and one of them was going to drift.
    const q = coreParseQuery(this.query);
    if (isEmptyQuery(q)) return [];

    const scoped = this.roomsIn(this.scope);
    const states = scoped.map(({ roomId }) => conversation.roomState(roomId));

    return coreSearch(states, q, { window: this.window, limit: 200 }).map((hit): Hit => {
      const found = scoped.find((r) => r.roomId === hit.roomId);
      const spaceId = found?.spaceId;
      return {
        message: hit.message as unknown as Hit['message'],
        roomId: hit.roomId,
        where: this.label(hit.roomId, spaceId),
        ...(spaceId ? { spaceId } : {}),
        spaceName: spaceId
          ? (core.spaces.find((s) => s.id === spaceId)?.name ?? '')
          : 'Direct messages',
        score: hit.score,
        excerpt: hit.excerpt,
        marks: hit.marks,
      };
    });
  });

  /** True when there is a query but nothing came back. */
  readonly empty = $derived(this.query.trim().length > 0 && this.results.length === 0);

  // ── surface ───────────────────────────────────────────────────────────────

  show(scope: Scope = 'room') {
    this.scope = scope;
    this.open = true;
  }

  close() {
    this.open = false;
  }

  /**
   * Go to a result: open its room and flash the message in place (`docs/19`).
   * The panel deliberately stays open — the point of a panel rather than a
   * modal is that you can walk a list of results without losing it.
   */
  go(hit: Hit) {
    if (hit.spaceId) core.openRoom(hit.spaceId, hit.roomId);
    else core.openHome(hit.roomId);
    // A thread reply is not in the room's timeline, so landing in the room
    // would scroll to nothing. Open the branch it lives in.
    if (hit.message.thread) core.openThread(hit.message.thread);
    core.jumpTo = hit.message.id;
  }

  /** Add or replace a `key:value` token in the query, for the filter chips. */
  setToken(key: 'from' | 'has' | 'in', value: string | null) {
    const kept = this.query
      .trim()
      .split(/\s+/)
      .filter((t) => t && !new RegExp(`^${key}:`, 'i').test(t));
    if (value) kept.push(`${key}:${value}`);
    this.query = kept.join(' ') + (value ? ' ' : '');
  }

  /** What `key` is currently set to in the query, if anything. */
  token(key: 'from' | 'has' | 'in'): string | undefined {
    const m = new RegExp(`(?:^|\\s)${key}:(\\S+)`, 'i').exec(this.query);
    return m?.[1]?.toLowerCase();
  }
}

export const search = new Search();
