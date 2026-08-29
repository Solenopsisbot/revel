/**
 * The reducer, exhaustively — `docs/04` §3 asks for exactly that.
 *
 * Payloads go through the real `parseEncrypted` rather than being hand-built,
 * so these test the reducer against the actual protocol schema. A test that
 * feeds a shape the schema would have rejected proves nothing about a message
 * that ever came off a wire.
 */
import { parseEncrypted } from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import {
  addPending,
  compareIds,
  dropPending,
  emptyRoom,
  type LocalEvent,
  type Message,
  markFailed,
  type RoomState,
  reduce,
  reduceAll,
} from '../src/index.js';

/** An event, with the payload validated by the real schema on the way in. */
function ev(
  id: string,
  account: string,
  payload: Record<string, unknown>,
  extra: Partial<LocalEvent> = {},
): LocalEvent {
  const parsed = parseEncrypted({ v: 1, ...payload });
  return { id, account, at: Number(id), payload: parsed, ...extra };
}

const message = (id: string, account: string, body: string, rest: Record<string, unknown> = {}) =>
  ev(id, account, { type: 'm.message', body, ...rest });

/** A room with three messages from two people. */
function room(): RoomState {
  return reduceAll(emptyRoom('100'), [
    message('1', 'a', 'first'),
    message('2', 'b', 'second'),
    message('3', 'a', 'third'),
  ]);
}

const bodies = (s: RoomState) => s.messages.map((m) => m.body);
const ids = (s: RoomState) => s.messages.map((m) => m.id);

describe('compareIds', () => {
  it('orders snowflakes numerically, not lexically', () => {
    // The whole reason this function exists: "9" sorts after "10" as a string.
    expect(compareIds('9', '10')).toBeLessThan(0);
    expect(compareIds('10', '9')).toBeGreaterThan(0);
    expect(compareIds('100', '100')).toBe(0);
    expect(['9', '10', '100', '11'].sort(compareIds)).toEqual(['9', '10', '11', '100']);
  });
});

describe('ordering and idempotency', () => {
  it('places messages in event-id order however they arrive', () => {
    const out = reduceAll(emptyRoom('100'), [
      message('3', 'a', 'third'),
      message('1', 'a', 'first'),
      message('2', 'b', 'second'),
    ]);
    expect(bodies(out)).toEqual(['first', 'second', 'third']);
  });

  it('places a late arrival in the middle rather than at the end', () => {
    let out = reduceAll(emptyRoom('100'), [message('1', 'a', 'first'), message('9', 'a', 'ninth')]);
    out = reduce(out, message('5', 'b', 'fifth'));
    expect(bodies(out)).toEqual(['first', 'fifth', 'ninth']);
  });

  it('applying the same event twice changes nothing', () => {
    const one = reduce(emptyRoom('100'), message('1', 'a', 'hello'));
    const twice = reduce(one, message('1', 'a', 'hello'));
    expect(twice).toBe(one);
    expect(twice.messages).toHaveLength(1);
  });

  it('ignores a duplicate inside a single batch', () => {
    const out = reduceAll(emptyRoom('100'), [
      message('1', 'a', 'hello'),
      message('1', 'a', 'hello'),
    ]);
    expect(out.messages).toHaveLength(1);
  });

  it('tracks the highest id applied, not the last one seen', () => {
    const out = reduceAll(emptyRoom('100'), [message('9', 'a', 'x'), message('2', 'a', 'y')]);
    expect(out.lastEventId).toBe('9');
  });

  it('does not touch the state it was given', () => {
    const before = room();
    const snapshot = { messages: [...before.messages], applied: new Set(before.applied) };
    reduce(before, message('4', 'b', 'fourth'));
    expect(before.messages).toEqual(snapshot.messages);
    expect(before.applied).toEqual(snapshot.applied);
  });
});

describe('optimistic sends', () => {
  const pending = (state: RoomState) =>
    addPending(state, {
      id: 'local-1',
      account: 'a',
      at: 10,
      body: 'sending',
      clientNonce: 'nonce-1',
    });

  it('shows a pending message before the server has said anything', () => {
    const out = pending(emptyRoom('100'));
    expect(out.messages[0]).toMatchObject({ pending: true, body: 'sending' });
  });

  it("replaces it with the server's echo, matched by nonce", () => {
    // The nonce is the only link between the two: the local copy has no server
    // id yet, which is the whole reason it was optimistic.
    let s = pending(emptyRoom('100'));
    s = reduce(s, ev('7', 'a', { type: 'm.message', body: 'sending' }, { clientNonce: 'nonce-1' }));

    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]?.id).toBe('7');
    expect(s.messages[0]?.pending).toBeUndefined();
    expect(s.byId.has('local-1')).toBe(false);
  });

  it('sits at the bottom of the room, not the top', () => {
    // A local id is a placeholder, and `compareIds` orders by length first —
    // so a short local id would sort before every 19-digit snowflake and the
    // message someone just sent would appear above the whole conversation.
    const s = pending(
      reduceAll(emptyRoom('100'), [
        message('1767225600000000001', 'a', 'first'),
        message('1767225600000000002', 'b', 'second'),
      ]),
    );
    expect(bodies(s)).toEqual(['first', 'second', 'sending']);
  });

  it('stays at the bottom when a real event arrives behind it', () => {
    let s = pending(reduceAll(emptyRoom('100'), [message('1767225600000000001', 'a', 'first')]));
    s = reduce(s, message('1767225600000000002', 'b', 'theirs'));
    expect(bodies(s)).toEqual(['first', 'theirs', 'sending']);
  });

  it('keeps somebody else, with a different nonce, as a separate message', () => {
    let s = pending(emptyRoom('100'));
    s = reduce(s, ev('7', 'b', { type: 'm.message', body: 'theirs' }, { clientNonce: 'other' }));
    expect(s.messages).toHaveLength(2);
  });

  it('can be marked failed and retried, or given up on', () => {
    let s = pending(emptyRoom('100'));
    s = markFailed(s, 'nonce-1');
    expect(s.messages[0]?.failed).toBe(true);

    s = dropPending(s, 'nonce-1');
    expect(s.messages).toHaveLength(0);

    // Both are no-ops for a nonce nobody is waiting on.
    expect(dropPending(s, 'gone')).toBe(s);
    expect(markFailed(s, 'gone')).toBe(s);
  });
});

describe('edits', () => {
  it('takes the latest and keeps the history', () => {
    let s = room();
    s = reduce(s, ev('4', 'a', { type: 'm.edit', target: '1', body: 'first, revised' }));
    s = reduce(s, ev('5', 'a', { type: 'm.edit', target: '1', body: 'first, again' }));

    const m = s.byId.get('1') as Message;
    expect(m.body).toBe('first, again');
    expect(m.editedAt).toBe(5);
    expect(m.edits).toEqual([
      { body: 'first', at: 1 },
      { body: 'first, revised', at: 4 },
    ]);
  });

  it('refuses an edit from anyone but the author', () => {
    // Not a moderation action at any permission level: editing someone's words
    // would be a forgery with their name on it.
    const s = reduce(room(), ev('4', 'b', { type: 'm.edit', target: '1', body: 'not mine' }));
    expect(s.byId.get('1')?.body).toBe('first');
  });

  it('ignores an edit of a message that is not here', () => {
    const s = reduce(room(), ev('4', 'a', { type: 'm.edit', target: '99', body: 'nothing' }));
    expect(bodies(s)).toEqual(['first', 'second', 'third']);
  });

  it('will not resurrect a redacted message', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.redact', target: '1' }));
    s = reduce(s, ev('5', 'a', { type: 'm.edit', target: '1', body: 'back again' }));
    expect(s.byId.get('1')?.body).toBe('');
    expect(s.byId.get('1')?.redacted).toBeDefined();
  });
});

describe('redactions', () => {
  it('drops the body and keeps a tombstone saying the author did it', () => {
    const s = reduce(room(), ev('4', 'a', { type: 'm.redact', target: '1', reason: 'typo' }));
    const m = s.byId.get('1') as Message;
    expect(m.body).toBe('');
    expect(m.redacted).toEqual({ by: 'author', at: 4, reason: 'typo' });
    // The row survives, so the conversation around it still makes sense.
    expect(ids(s)).toEqual(['1', '2', '3']);
  });

  it('ignores a redaction from a stranger', () => {
    // Fails closed: the default is that nobody may moderate.
    const s = reduce(room(), ev('4', 'b', { type: 'm.redact', target: '1' }));
    expect(s.byId.get('1')?.redacted).toBeUndefined();
  });

  it('honours one from a moderator, and says it was a moderator', () => {
    const s = reduce(room(), ev('4', 'b', { type: 'm.redact', target: '1' }), {
      mayModerate: (account) => account === 'b',
    });
    expect(s.byId.get('1')?.redacted).toMatchObject({ by: 'moderator' });
  });

  it('takes the reactions and attachments with it', () => {
    let s = reduce(room(), ev('4', 'b', { type: 'm.reaction', target: '1', key: '🔥' }));
    expect(s.byId.get('1')?.reactions).toHaveLength(1);

    s = reduce(s, ev('5', 'a', { type: 'm.redact', target: '1' }));
    const m = s.byId.get('1') as Message;
    // A tombstone with six laughing faces on it reads as a joke about the
    // deletion rather than a record of one.
    expect(m.reactions).toBeUndefined();
    expect(m.attachments).toBeUndefined();
    expect(m.edits).toBeUndefined();
  });

  it('is not applied twice', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.redact', target: '1' }));
    s = reduce(s, ev('5', 'a', { type: 'm.redact', target: '1', reason: 'again' }));
    expect(s.byId.get('1')?.redacted).toMatchObject({ at: 4, reason: undefined });
  });
});

describe('reactions', () => {
  it('aggregates by key across accounts', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.reaction', target: '1', key: '🔥' }));
    s = reduce(s, ev('5', 'b', { type: 'm.reaction', target: '1', key: '🔥' }));
    s = reduce(s, ev('6', 'b', { type: 'm.reaction', target: '1', key: '👀' }));

    expect(s.byId.get('1')?.reactions).toEqual([
      { key: '🔥', accounts: ['a', 'b'] },
      { key: '👀', accounts: ['b'] },
    ]);
  });

  it('counts one account once per key', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.reaction', target: '1', key: '🔥' }));
    s = reduce(s, ev('5', 'a', { type: 'm.reaction', target: '1', key: '🔥' }));
    expect(s.byId.get('1')?.reactions?.[0]?.accounts).toEqual(['a']);
  });

  it('removes one, and drops the key when it empties', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.reaction', target: '1', key: '🔥' }));
    s = reduce(s, ev('5', 'b', { type: 'm.reaction', target: '1', key: '🔥' }));
    s = reduce(s, ev('6', 'a', { type: 'm.reaction', target: '1', key: '🔥', remove: true }));
    expect(s.byId.get('1')?.reactions).toEqual([{ key: '🔥', accounts: ['b'] }]);

    s = reduce(s, ev('7', 'b', { type: 'm.reaction', target: '1', key: '🔥', remove: true }));
    expect(s.byId.get('1')?.reactions).toBeUndefined();
  });

  it('ignores a reaction to something redacted or missing', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.redact', target: '1' }));
    s = reduce(s, ev('5', 'b', { type: 'm.reaction', target: '1', key: '🔥' }));
    s = reduce(s, ev('6', 'b', { type: 'm.reaction', target: '99', key: '🔥' }));
    expect(s.byId.get('1')?.reactions).toBeUndefined();
  });
});

describe('receipts', () => {
  it('records the furthest each account has read', () => {
    let s = reduce(room(), ev('4', 'b', { type: 'm.receipt', upTo: '2' }));
    expect(s.receipts.get('b')).toBe('2');

    s = reduce(s, ev('5', 'b', { type: 'm.receipt', upTo: '3' }));
    expect(s.receipts.get('b')).toBe('3');
  });

  it('never moves a marker backwards', () => {
    // Out-of-order delivery would otherwise make an unread count flicker, and
    // un-read messages somebody has already seen.
    let s = reduce(room(), ev('5', 'b', { type: 'm.receipt', upTo: '3' }));
    s = reduce(s, ev('6', 'b', { type: 'm.receipt', upTo: '1' }));
    expect(s.receipts.get('b')).toBe('3');
  });
});

describe('pins', () => {
  it('pins, newest first, and marks the message', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.pin', target: '1' }));
    s = reduce(s, ev('5', 'a', { type: 'm.pin', target: '3' }));
    expect(s.pinned).toEqual(['3', '1']);
    expect(s.byId.get('3')?.pinned).toBe(true);
  });

  it('pinning twice does not double up', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.pin', target: '1' }));
    s = reduce(s, ev('5', 'b', { type: 'm.pin', target: '1' }));
    expect(s.pinned).toEqual(['1']);
  });

  it('unpins', () => {
    let s = reduce(room(), ev('4', 'a', { type: 'm.pin', target: '1' }));
    s = reduce(s, ev('5', 'a', { type: 'm.pin', target: '1', unpin: true }));
    expect(s.pinned).toEqual([]);
    expect(s.byId.get('1')?.pinned).toBeUndefined();
  });
});

describe('annotations', () => {
  const annotate = (id: string, account: string, kind: string, body: string) =>
    ev(id, account, { type: 'm.annotation', target: '1', kind, body });

  it('keeps one per target, author and kind', () => {
    let s = reduce(room(), annotate('4', 'bot', 'translation:de', 'erste'));
    s = reduce(s, annotate('5', 'bot', 'translation:de', 'die erste'));
    const annotations = s.byId.get('1')?.annotations ?? [];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ body: 'die erste', author: 'bot' });
  });

  it('keeps different kinds and different authors side by side', () => {
    let s = reduce(room(), annotate('4', 'bot', 'translation:de', 'erste'));
    s = reduce(s, annotate('5', 'bot', 'note', 'a note'));
    s = reduce(s, annotate('6', 'b', 'note', 'their note'));
    expect(s.byId.get('1')?.annotations).toHaveLength(3);
  });
});

describe('threads', () => {
  it('indexes replies under their root, in order', () => {
    let s = room();
    s = reduce(s, message('7', 'b', 'reply two', { thread: '1' }));
    s = reduce(s, message('5', 'a', 'reply one', { thread: '1' }));
    expect(s.threads.get('1')).toEqual(['5', '7']);
    // A thread is a branch inside the room, not a room — the replies are in
    // the timeline like anything else (`docs/16`).
    expect(ids(s)).toEqual(['1', '2', '3', '5', '7']);
  });

  it('forgets a reply whose optimistic copy was dropped', () => {
    let s = addPending(room(), {
      id: 'local-1',
      account: 'a',
      at: 10,
      body: 'in a thread',
      thread: '1',
      clientNonce: 'n',
    });
    expect(s.threads.get('1')).toEqual(['local-1']);
    s = dropPending(s, 'n');
    expect(s.threads.has('1')).toBe(false);
  });
});

describe('room metadata', () => {
  it('takes the name and topic', () => {
    const s = reduce(room(), ev('4', 'a', { type: 'room.name', name: 'design', topic: 'radii' }));
    expect(s.name).toBe('design');
    expect(s.topic).toBe('radii');
  });

  it('collects the faces roster', () => {
    const s = reduce(
      room(),
      ev('4', 'a', {
        type: 'room.faces',
        faces: [
          { id: '11', name: 'Kiko' },
          { id: '12', name: 'June' },
        ],
      }),
    );
    expect([...s.faces.values()].map((f) => f.name)).toEqual(['Kiko', 'June']);
  });
});

describe('the awkward cases', () => {
  it('ignores typing, because it is ephemeral', () => {
    // Never stored, dropped if nobody is listening, meaningless a second later.
    // Folding it into room state would mean replaying it later as though
    // somebody were still about to type.
    const s = reduce(room(), ev('4', 'b', { type: 'm.typing' }));
    expect(ids(s)).toEqual(['1', '2', '3']);
  });

  it('keeps an event type it does not understand', () => {
    // `docs/29` §1 rule 3. Encrypted history cannot be re-fetched into
    // existence once a client has decided it was noise.
    const parsed = parseEncrypted({ v: 1, type: 'm.poll', question: 'lunch?' });
    expect(parsed.known).toBe(false);

    const s = reduce(room(), { id: '4', account: 'b', at: 4, payload: parsed });
    const m = s.byId.get('4') as Message;
    expect(m.unknown).toMatchObject({ type: 'm.poll' });
    expect(m.unknown?.raw).toMatchObject({ question: 'lunch?' });
    expect(ids(s)).toEqual(['1', '2', '3', '4']);
  });

  it('marks a purged message as purged rather than redacted', () => {
    // Nobody chose it, so it is a different fact and gets different words.
    const s = reduce(emptyRoom('100'), { ...message('1', 'a', 'gone'), purgedAt: 500 });
    const m = s.byId.get('1') as Message;
    expect(m.purged).toBe(true);
    expect(m.body).toBe('');
    expect(m.redacted).toBeUndefined();
  });

  it('survives a message whose target arrives after it', () => {
    // Events reference each other by id, and nothing guarantees the target has
    // arrived. Each of these is a no-op rather than a crash.
    let s = emptyRoom('100');
    s = reduce(s, ev('1', 'a', { type: 'm.reaction', target: '99', key: '🔥' }));
    s = reduce(s, ev('2', 'a', { type: 'm.pin', target: '99' }));
    s = reduce(s, ev('3', 'a', { type: 'm.annotation', target: '99', kind: 'n', body: 'x' }));
    s = reduce(s, ev('4', 'a', { type: 'm.redact', target: '99' }));
    expect(s.messages).toHaveLength(0);
    expect(s.applied.size).toBe(4);
  });
});
