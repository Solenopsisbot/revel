/**
 * Local search.
 *
 * `docs/02` lists search among the core's jobs, and `docs/03` says why it has
 * to be: **the server is the search adversary**. It holds ciphertext and cannot
 * index it, so either the client searches its own store or nobody searches
 * anything. Every query here runs against messages this device has already
 * decrypted, and nothing about a query ever leaves it — not the words, not the
 * result count, not the fact that somebody searched.
 *
 * That constraint is also the design: there is no server to ask for ranking, so
 * ranking is here, and it is deliberately simple. Substring matching over a
 * room's messages, scored by how word-like the match is and how recent the
 * message is. A real inverted index is worth building when a room is big enough
 * to need one; a scan over a few thousand messages is faster than the round
 * trip we are not making.
 */
import type { Message, RoomState } from '../rooms/state.js';

export type Window = 'any' | 'day' | 'week' | 'month';

const WINDOW_MS: Record<Window, number> = {
  any: Number.POSITIVE_INFINITY,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  month: 30 * 24 * 60 * 60_000,
};

/** A query, with its filters lifted out of the words. */
export interface Query {
  terms: string[];
  /** The terms rejoined, lower-cased, for the exact-phrase bonus. */
  phrase: string;
  /** `from:` — matched against a face name or an account id. */
  from?: string;
  has?: 'file' | 'image' | 'link';
  /**
   * `in:thread`.
   *
   * Thread replies are out of the main timeline by design (`docs/16`), which
   * makes them exactly the thing you end up searching for.
   */
  inThread?: boolean;
}

export interface Hit {
  roomId: string;
  message: Message;
  score: number;
  /** The body, trimmed to a window around the first match. */
  excerpt: string;
  /** `[start, end)` pairs into `excerpt` — sorted, merged, non-overlapping. */
  marks: [number, number][];
}

export interface SearchOptions {
  window?: Window;
  /** Overridable so a test is not a function of the wall clock. */
  now?: number;
  /** Enough to scroll; past this nobody is reading, they are refining. */
  limit?: number;
  /** Characters of body either side of the first match. */
  context?: number;
}

const DEFAULTS = { limit: 120, context: 90 } as const;

/**
 * Pull `from:`, `has:` and `in:` out of a raw query string.
 *
 * A token that looks like a filter but is not one — `has:cheese` — stays a
 * search term rather than becoming an error. Somebody typing into a search box
 * is not writing a program, and the useful response to an unrecognised filter
 * is to search for it.
 */
export function parseQuery(raw: string): Query {
  const terms: string[] = [];
  let from: string | undefined;
  let has: Query['has'];
  let inThread: boolean | undefined;

  for (const token of raw.trim().split(/\s+/)) {
    if (!token) continue;
    const match = /^(from|has|in):(.+)$/i.exec(token);
    if (!match) {
      terms.push(token.toLowerCase());
      continue;
    }

    const key = (match[1] as string).toLowerCase();
    const value = (match[2] as string).toLowerCase();
    if (key === 'from') from = value;
    else if (key === 'in' && value === 'thread') inThread = true;
    else if (key === 'has' && (value === 'file' || value === 'image' || value === 'link')) {
      has = value;
    } else terms.push(token.toLowerCase());
  }

  return { terms, phrase: terms.join(' '), from, has, inThread };
}

/** Whether a query would match anything at all. */
export function isEmptyQuery(query: Query): boolean {
  return query.terms.length === 0 && !query.from && !query.has && !query.inThread;
}

/**
 * Search a set of rooms.
 *
 * Rooms are passed in rather than looked up: what is searchable is a policy
 * question — this room, this space, everything — and this layer should not be
 * the one deciding it.
 */
export function search(
  rooms: Iterable<RoomState>,
  query: Query,
  options: SearchOptions = {},
): Hit[] {
  if (isEmptyQuery(query)) return [];

  const now = options.now ?? Date.now();
  const limit = options.limit ?? DEFAULTS.limit;
  const context = options.context ?? DEFAULTS.context;
  const horizon = WINDOW_MS[options.window ?? 'any'];

  const hits: Hit[] = [];

  for (const room of rooms) {
    for (const message of room.messages) {
      // A message that is not there any more is not a search result. Finding a
      // deletion by its old contents would defeat the deletion.
      if (message.redacted || message.purged || message.pending) continue;
      if (horizon !== Number.POSITIVE_INFINITY && now - message.at > horizon) continue;
      if (query.inThread && !message.thread) continue;
      if (query.from && !matchesFrom(message, query.from)) continue;
      if (query.has && !matchesHas(message, query.has)) continue;

      const body = textOf(message.body);
      const lower = body.toLowerCase();

      let score = 0;
      const spans: [number, number][] = [];

      if (query.terms.length) {
        for (const term of query.terms) {
          const at = occurrences(lower, term);
          if (at.length === 0) {
            score = -1;
            break;
          }
          for (const index of at) spans.push([index, index + term.length]);
          // More occurrences is a little better. Where the match sits in a word
          // matters more: a whole word beats a prefix beats something buried
          // mid-word, because "cat" in "catalogue" is rarely what was meant and
          // "cat" in "concatenate" almost never is.
          score += 3 + at.length - 1;
          if (at.some((i) => wholeWord(lower, i, term.length))) score += 4;
          else if (at.some((i) => atWordStart(lower, i))) score += 2;
        }
        if (score < 0) continue;
        // The words in the order they were typed beats the same words scattered.
        if (query.terms.length > 1 && lower.includes(query.phrase)) score += 10;
      } else {
        // A bare `from:` or `has:` is a legitimate query — "everything they
        // sent" — and there is nothing to rank it by except recency.
        score = 1;
      }

      const ageDays = (now - message.at) / 86_400_000;
      score += Math.max(0, 2 - ageDays / 10);

      hits.push({
        roomId: room.roomId,
        message,
        score,
        ...excerpt(body, merge(spans), context),
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || b.message.at - a.message.at);
  return hits.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function matchesFrom(message: Message, from: string): boolean {
  // Either the name shown on the message or the account behind it. A person
  // searching `from:kiko` means the name; a tool means the id.
  const name = message.face?.name?.toLowerCase();
  if (name?.includes(from)) return true;
  return message.account.toLowerCase() === from;
}

const IMAGE = /^image\//;
const LINK = /\bhttps?:\/\/\S+/i;

function matchesHas(message: Message, has: NonNullable<Query['has']>): boolean {
  if (has === 'link') return LINK.test(textOf(message.body));

  const attachments = (message.attachments ?? []) as { mime?: string }[];
  if (attachments.length === 0) return false;
  if (has === 'image') return attachments.some((a) => IMAGE.test(a.mime ?? ''));
  // `has:file` means "something is attached", including images: somebody
  // looking for the thing they were sent does not remember its MIME type.
  return true;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Flatten a `RichText` body to searchable text.
 *
 * The body is a node tree, not HTML (`docs/04`), and the shape is open: a
 * newer client can send nodes this build has never seen. Walking it for
 * anything string-shaped finds the words in those too, which is the difference
 * between a message from a newer client being unfindable and being findable.
 */
export function textOf(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Array.isArray(body)) return body.map(textOf).join('');
  if (body && typeof body === 'object') {
    const node = body as Record<string, unknown>;
    // `text` and `content` are where a node's words live; `t` is its type.
    return [node.text, node.content, node.children]
      .filter((v) => v !== undefined)
      .map(textOf)
      .join('');
  }
  return '';
}

function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  let index = hay.indexOf(needle);
  while (index !== -1) {
    out.push(index);
    index = hay.indexOf(needle, index + needle.length);
  }
  return out;
}

const WORDISH = /[a-z0-9]/i;

function atWordStart(hay: string, index: number): boolean {
  return index === 0 || !WORDISH.test(hay[index - 1] as string);
}

function wholeWord(hay: string, index: number, length: number): boolean {
  const after = index + length;
  return atWordStart(hay, index) && (after >= hay.length || !WORDISH.test(hay[after] as string));
}

/** Sorted, non-overlapping. Two terms can match the same characters. */
function merge(spans: [number, number][]): [number, number][] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [sorted[0] as [number, number]];

  for (const [start, end] of sorted.slice(1)) {
    const last = out[out.length - 1] as [number, number];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * A window of the body around the first match, with the marks moved into it.
 *
 * Cut on a word boundary where there is one nearby: a snippet that starts
 * mid-word reads as corruption rather than as an excerpt.
 */
function excerpt(
  body: string,
  spans: [number, number][],
  context: number,
): { excerpt: string; marks: [number, number][] } {
  const first = spans[0]?.[0] ?? 0;
  if (body.length <= context * 2) return { excerpt: body, marks: spans };

  let start = Math.max(0, first - context);
  if (start > 0) {
    const space = body.indexOf(' ', start);
    if (space !== -1 && space - start < 20) start = space + 1;
  }
  let end = Math.min(body.length, start + context * 2);
  if (end < body.length) {
    const space = body.lastIndexOf(' ', end);
    if (space > start && end - space < 20) end = space;
  }

  const slice = body.slice(start, end);
  const marks = spans
    .map(([a, b]) => [a - start, b - start] as [number, number])
    .filter(([a, b]) => a >= 0 && b <= slice.length);

  return {
    excerpt: (start > 0 ? '…' : '') + slice + (end < body.length ? '…' : ''),
    // The leading ellipsis shifts everything one character.
    marks: start > 0 ? marks.map(([a, b]) => [a + 1, b + 1] as [number, number]) : marks,
  };
}
