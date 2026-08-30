/**
 * Search.
 *
 * The property that matters most is the one that is easiest to lose by
 * accident: a redacted message must not be findable by the words it used to
 * contain. Finding a deletion by its old contents defeats the deletion, and it
 * would happen silently, because the index would simply still be there.
 */
import { parseEncrypted } from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import {
  emptyRoom,
  isEmptyQuery,
  type LocalEvent,
  parseQuery,
  type RoomState,
  reduceAll,
  search,
  textOf,
} from '../src/index.js';

const NOW = 1_700_000_000_000;
const day = 86_400_000;

let next = 1767225600000000000n;
function ev(payload: Record<string, unknown>, over: Partial<LocalEvent> = {}): LocalEvent {
  const id = String(next++);
  return {
    id,
    account: 'alice',
    at: NOW,
    payload: parseEncrypted({ v: 1, ...payload }),
    ...over,
  };
}

const message = (
  body: unknown,
  over: Partial<LocalEvent> = {},
  rest: Record<string, unknown> = {},
) => ev({ type: 'm.message', body, ...rest }, over);

/**
 * A valid `BlobRef`. The schema wants all of it, and it is right to — a test
 * built on a shape the protocol would reject proves nothing about a real
 * message.
 */
const blob = (id: string, mime: string) => ({
  id,
  key: 'AAAAAAAAAAAAAAAAAAAAAA==',
  nonce: 'AAAAAAAAAAAAAAAA',
  size: 1,
  mime,
  name: `${id}.bin`,
  hash: 'AAAAAAAAAAAAAAAAAAAAAA==',
});

function room(events: LocalEvent[], roomId = 'r1'): RoomState {
  return reduceAll(emptyRoom(roomId), events);
}

const bodies = (hits: { message: { body: unknown } }[]) => hits.map((h) => textOf(h.message.body));
const find = (state: RoomState, query: string, options = {}) =>
  search([state], parseQuery(query), { now: NOW, ...options });

describe('parseQuery', () => {
  it('lifts the filters out of the words', () => {
    const q = parseQuery('from:Kiko has:image in:thread the radii');
    expect(q).toMatchObject({
      from: 'kiko',
      has: 'image',
      inThread: true,
      terms: ['the', 'radii'],
      phrase: 'the radii',
    });
  });

  it('keeps an unrecognised filter as a search term', () => {
    // Somebody typing into a search box is not writing a program. The useful
    // response to `has:cheese` is to look for it.
    expect(parseQuery('has:cheese').terms).toEqual(['has:cheese']);
    expect(parseQuery('in:space').terms).toEqual(['in:space']);
    expect(parseQuery('has:cheese').has).toBeUndefined();
  });

  it('is case-insensitive about the filter and its value', () => {
    expect(parseQuery('FROM:Ash').from).toBe('ash');
    expect(parseQuery('In:Thread').inThread).toBe(true);
  });

  it('knows when there is nothing to search for', () => {
    expect(isEmptyQuery(parseQuery(''))).toBe(true);
    expect(isEmptyQuery(parseQuery('   '))).toBe(true);
    expect(isEmptyQuery(parseQuery('from:ash'))).toBe(false);
    expect(isEmptyQuery(parseQuery('radii'))).toBe(false);
  });
});

describe('textOf', () => {
  it('flattens the node tree a body can be', () => {
    expect(textOf('plain')).toBe('plain');
    expect(textOf(['a ', 'b'])).toBe('a b');
    expect(textOf([{ t: 'b', text: 'bold' }, ' rest'])).toBe('bold rest');
  });

  it('finds the words inside a node it has never seen', () => {
    // A newer client's node type must not make its message unfindable.
    expect(textOf([{ t: 'spoiler', content: [{ t: 'text', text: 'hidden words' }] }])).toBe(
      'hidden words',
    );
  });

  it('is empty rather than "[object Object]" for something unreadable', () => {
    expect(textOf({ t: 'mystery' })).toBe('');
    expect(textOf(null)).toBe('');
    expect(textOf(42)).toBe('');
  });
});

describe('search', () => {
  it('finds a word', () => {
    const state = room([message('the radii need auditing'), message('unrelated')]);
    expect(bodies(find(state, 'radii'))).toEqual(['the radii need auditing']);
  });

  it('requires every term, not any of them', () => {
    const state = room([message('radii and contrast'), message('radii alone')]);
    expect(bodies(find(state, 'radii contrast'))).toEqual(['radii and contrast']);
  });

  it('is case-insensitive', () => {
    const state = room([message('The Radii')]);
    expect(find(state, 'radii')).toHaveLength(1);
    expect(find(state, 'RADII')).toHaveLength(1);
  });

  it('ranks a whole word above a prefix above something buried mid-word', () => {
    const state = room([
      message('concatenate the parts'),
      message('the catalogue of things'),
      message('the cat sat'),
    ]);
    expect(bodies(find(state, 'cat'))).toEqual([
      'the cat sat',
      'the catalogue of things',
      'concatenate the parts',
    ]);
  });

  it('ranks the exact phrase above the same words scattered', () => {
    const state = room([
      message('corner radius, and separately, audit'),
      message('radius audit today'),
    ]);
    expect(bodies(find(state, 'radius audit'))[0]).toBe('radius audit today');
  });

  it('breaks a tie by recency', () => {
    const state = room([message('radii', { at: NOW - 5 * day }), message('radii', { at: NOW })]);
    expect(find(state, 'radii')[0]?.message.at).toBe(NOW);
  });

  it('searches every room it is given, and says which', () => {
    const a = room([message('radii here')], 'r1');
    const b = room([message('radii there')], 'r2');
    const hits = search([a, b], parseQuery('radii'), { now: NOW });
    expect(hits.map((h) => h.roomId).sort()).toEqual(['r1', 'r2']);
  });

  it('finds nothing for an empty query', () => {
    const state = room([message('anything')]);
    expect(find(state, '')).toEqual([]);
  });
});

describe('what search must not find', () => {
  it('will not find a redacted message by what it used to say', () => {
    // Finding a deletion by its old contents defeats the deletion, and it
    // would happen quietly.
    const body = message('the thing I regret saying');
    const state = room([body, ev({ type: 'm.redact', target: body.id })]);
    expect(find(state, 'regret')).toEqual([]);
  });

  it('will not find a purged message either', () => {
    const body = message('gone from the server');
    const state = room([{ ...body, purgedAt: NOW }]);
    expect(find(state, 'gone')).toEqual([]);
  });

  it('will not find a message that has not been sent yet', () => {
    // A pending message is not in the room for anybody else, and turning up in
    // your own search results before it has been accepted is a lie about it.
    const state = room([message('sent'), message('typed')]);
    const withPending = {
      ...state,
      messages: [...state.messages, { ...(state.messages[0] as never), pending: true }],
    } as RoomState;
    expect(find(withPending, 'sent')).toHaveLength(1);
  });
});

describe('filters', () => {
  const withFace = (body: string, name: string) => message(body, {}, { face: { id: '11', name } });

  it('from: matches the name on the message', () => {
    const state = room([withFace('mine', 'Kiko'), withFace('theirs', 'June')]);
    expect(bodies(find(state, 'from:kiko'))).toEqual(['mine']);
  });

  it('from: matches part of a name', () => {
    const state = room([withFace('mine', 'Kiko Yamada')]);
    expect(find(state, 'from:yamada')).toHaveLength(1);
  });

  it('from: matches an account id exactly', () => {
    const state = room([message('mine', { account: 'acct-1' })]);
    expect(find(state, 'from:acct-1')).toHaveLength(1);
    expect(find(state, 'from:acct')).toHaveLength(0);
  });

  it('from: on its own is a legitimate query', () => {
    const state = room([withFace('one', 'Kiko'), withFace('two', 'Kiko')]);
    expect(find(state, 'from:kiko')).toHaveLength(2);
  });

  it('has:image needs an image, not just an attachment', () => {
    const state = room([
      message('a picture', {}, { attachments: [blob('a', 'image/png')] }),
      message('a document', {}, { attachments: [blob('b', 'application/pdf')] }),
      message('nothing attached'),
    ]);
    expect(bodies(find(state, 'has:image'))).toEqual(['a picture']);
  });

  it('has:file means anything attached, images included', () => {
    // Somebody looking for the thing they were sent does not remember its MIME
    // type.
    const state = room([
      message('a picture', {}, { attachments: [blob('a', 'image/png')] }),
      message('a document', {}, { attachments: [blob('b', 'application/pdf')] }),
      message('nothing attached'),
    ]);
    expect(find(state, 'has:file')).toHaveLength(2);
  });

  it('has:link finds a URL in the body', () => {
    const state = room([message('see https://example.com/thing'), message('no link here')]);
    expect(bodies(find(state, 'has:link'))).toEqual(['see https://example.com/thing']);
  });

  it('in:thread finds only replies', () => {
    // Thread replies are out of the timeline by design, which makes them
    // exactly the thing you end up searching for.
    const root = message('the root');
    const state = room([root, message('a reply', {}, { thread: root.id })]);
    expect(bodies(find(state, 'in:thread'))).toEqual(['a reply']);
  });

  it('combines filters with words', () => {
    const root = message('root');
    const state = room([
      root,
      message('radii in a thread', {}, { thread: root.id, face: { id: '11', name: 'Kiko' } }),
      message('radii not in a thread', {}, { face: { id: '11', name: 'Kiko' } }),
      message('other in a thread', {}, { thread: root.id, face: { id: '12', name: 'June' } }),
    ]);
    expect(bodies(find(state, 'from:kiko in:thread radii'))).toEqual(['radii in a thread']);
  });
});

describe('the time window', () => {
  const state = () =>
    room([
      message('radii today', { at: NOW }),
      message('radii last week', { at: NOW - 5 * day }),
      message('radii last year', { at: NOW - 300 * day }),
    ]);

  it('takes everything by default', () => {
    expect(find(state(), 'radii')).toHaveLength(3);
  });

  it('narrows to a day, a week, a month', () => {
    expect(find(state(), 'radii', { window: 'day' })).toHaveLength(1);
    expect(find(state(), 'radii', { window: 'week' })).toHaveLength(2);
    expect(find(state(), 'radii', { window: 'month' })).toHaveLength(2);
  });
});

describe('excerpts', () => {
  const long = `${'filler '.repeat(40)}the radii need auditing${' filler'.repeat(40)}`;

  it('returns the whole body when it is short', () => {
    const state = room([message('the radii')]);
    const [hit] = find(state, 'radii');
    expect(hit?.excerpt).toBe('the radii');
    expect(hit?.excerpt.slice(...(hit.marks[0] as [number, number]))).toBe('radii');
  });

  it('trims a long body to a window around the match', () => {
    const state = room([message(long)]);
    const [hit] = find(state, 'radii');
    expect(hit?.excerpt.length).toBeLessThan(long.length);
    expect(hit?.excerpt).toContain('radii');
    expect(hit?.excerpt.startsWith('…')).toBe(true);
    expect(hit?.excerpt.endsWith('…')).toBe(true);
  });

  it('points its marks at the right characters after trimming', () => {
    // The thing that goes wrong quietly: an excerpt whose highlights are
    // offset by one because of the leading ellipsis.
    const state = room([message(long)]);
    const [hit] = find(state, 'radii');
    for (const [start, end] of hit?.marks ?? []) {
      expect(hit?.excerpt.slice(start, end).toLowerCase()).toBe('radii');
    }
  });

  it('marks every occurrence, merged where they overlap', () => {
    const state = room([message('radii radii radius')]);
    const [hit] = find(state, 'radi');
    expect(hit?.marks).toHaveLength(3);
    for (const [start, end] of hit?.marks ?? []) {
      expect(hit?.excerpt.slice(start, end).toLowerCase()).toBe('radi');
    }
  });

  it('does not produce overlapping marks for overlapping terms', () => {
    const state = room([message('the radii audit')]);
    const [hit] = find(state, 'radii radi');
    const marks = hit?.marks ?? [];
    for (let i = 1; i < marks.length; i++) {
      expect((marks[i] as [number, number])[0]).toBeGreaterThanOrEqual(
        (marks[i - 1] as [number, number])[1],
      );
    }
  });
});

describe('limits', () => {
  it('stops at the limit', () => {
    const events = Array.from({ length: 200 }, (_, i) => message(`radii ${i}`));
    const state = room(events);
    expect(find(state, 'radii')).toHaveLength(120);
    expect(find(state, 'radii', { limit: 5 })).toHaveLength(5);
  });
});
