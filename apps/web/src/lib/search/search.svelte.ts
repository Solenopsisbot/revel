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
const CONTEXT = 90;

function parse(raw: string): Parsed {
  const terms: string[] = [];
  let from: string | undefined;
  let has: Parsed['has'];
  let inThread: boolean | undefined;

  for (const tok of raw.trim().split(/\s+/)) {
    if (!tok) continue;
    const m = /^(from|has|in):(.+)$/i.exec(tok);
    if (!m) {
      terms.push(tok.toLowerCase());
      continue;
    }
    const [, key, value] = m;
    const k = key!.toLowerCase();
    if (k === 'from') from = value!.toLowerCase();
    else if (k === 'in' && value!.toLowerCase() === 'thread') inThread = true;
    else if (k === 'has' && (value === 'file' || value === 'image' || value === 'link'))
      has = value;
  }

  return { terms, phrase: terms.join(' '), from, has, inThread };
}

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
    const named = core.dms.find((d) => d.id === roomId)?.name;
    if (named) return named;
    // Through the seam, so a conversation is named by who is in it rather than
    // by which of their faces happened to be listed (`docs/11`).
    const info = directory.dms().find((r) => r.id === roomId);
    return info ? directory.title(info) : roomId;
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
    const q = parse(this.query);
    // A bare `from:` or `has:` with no words is a legitimate query — "every
    // file Rae has sent me" is a real thing to want.
    if (!q.terms.length && !q.from && !q.has && !q.inThread) return [];

    const cutoff = Date.now() - WINDOW_MS[this.window];
    const hits: Hit[] = [];

    for (const { roomId, spaceId } of this.roomsIn(this.scope)) {
      // Through the seam, so search sees the same shape the timeline does.
      const list = conversation.all(roomId);
      if (!list.length) continue;
      const spaceName = spaceId
        ? (core.spaces.find((s) => s.id === spaceId)?.name ?? '')
        : 'Direct messages';
      const where = this.label(roomId, spaceId);

      for (const m of list) {
        if (m.redacted) continue; // the text is genuinely gone
        if (m.at < cutoff) continue;
        if (q.from) {
          const f = m.face;
          if (!f || !f.name.toLowerCase().startsWith(q.from)) continue;
        }
        if (q.has === 'file' && !m.attachments?.length) continue;
        if (
          q.has === 'image' &&
          !m.attachments?.some((a) => a.kind === 'image' || a.kind === 'gif')
        )
          continue;
        if (q.has === 'link' && !m.link) continue;
        if (q.inThread && !m.thread) continue;

        const body = m.text;
        const lower = body.toLowerCase();

        let score = 0;
        let first = -1;
        const marks: [number, number][] = [];

        if (q.terms.length) {
          // Every term has to appear somewhere, or it isn't a match. Partial
          // matching would drown a two-word query in noise.
          let all = true;
          for (const term of q.terms) {
            const at = occurrences(lower, term);
            if (!at.length) {
              all = false;
              break;
            }
            for (const i of at) marks.push([i, i + term.length]);
            score += 3 + at.length - 1 + (at.some((i) => atWordStart(lower, i)) ? 2 : 0);
            if (first === -1 || at[0]! < first) first = at[0]!;
          }
          if (!all) continue;
          // The whole query, in order, in one place: much more likely to be
          // what was meant than the same words scattered.
          if (q.terms.length > 1 && lower.includes(q.phrase)) score += 10;
        } else {
          score = 1; // a pure filter query; recency decides the order
        }

        // A gentle recency tilt, not a sort key. What you searched for beats
        // when it was said, but a fresher one of two equal matches wins.
        const ageDays = (Date.now() - m.at) / 86_400_000;
        score += Math.max(0, 2 - ageDays / 10);

        const { excerpt, marks: shifted } = this.excerpt(body, marks, Math.max(0, first));
        hits.push({
          message: m,
          roomId,
          // A thread reply found on its own is context-free — "#design" is
          // true but not where you would look for it.
          where: m.thread ? `${where} · thread` : where,
          spaceId,
          spaceName,
          score,
          excerpt,
          marks: shifted,
        });
      }
    }

    hits.sort((a, b) => b.score - a.score || b.message.at - a.message.at);
    return hits.slice(0, MAX_HITS);
  });

  /** True when there is a query but nothing came back. */
  readonly empty = $derived(this.query.trim().length > 0 && this.results.length === 0);

  /**
   * A window of the body around the first match, with the mark ranges moved to
   * match. Long messages are common here and a result row that shows the first
   * 90 characters of a paragraph whose match is at character 400 is a result
   * row that looks wrong.
   */
  private excerpt(body: string, marks: [number, number][], first: number) {
    if (body.length <= CONTEXT * 2) {
      return { excerpt: body, marks: this.merge(marks) };
    }
    let start = Math.max(0, first - CONTEXT);
    // Snap to a word boundary so the excerpt doesn't begin mid-word.
    while (start > 0 && /[a-z0-9]/i.test(body[start - 1]!)) start--;
    const end = Math.min(body.length, start + CONTEXT * 2);

    const slice = (start ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
    const shift = start - (start ? 1 : 0);
    const moved = marks
      .map(([a, b]) => [a - shift, b - shift] as [number, number])
      .filter(([a, b]) => a >= 0 && b <= slice.length);
    return { excerpt: slice, marks: this.merge(moved) };
  }

  /** Sorted, non-overlapping — two terms can land on the same characters. */
  private merge(marks: [number, number][]): [number, number][] {
    if (marks.length < 2) return marks;
    const sorted = [...marks].sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [sorted[0]!];
    for (const [a, b] of sorted.slice(1)) {
      const last = out[out.length - 1]!;
      if (a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  }

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
