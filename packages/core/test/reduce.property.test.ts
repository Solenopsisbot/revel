/**
 * The reducer's invariants, rather than its examples.
 *
 * The example tests say what happens for a redaction. These say the things the
 * whole architecture rests on: that a room is a function of its event log and
 * nothing else. If any of these break, "replay the log and you get the room
 * back" stops being true, and with it every recovery path in the client.
 *
 * The randomness is seeded. A property test with an unseeded generator finds a
 * bug once and then never again, and the failure it printed is not reproducible
 * by the person who has to fix it.
 */
import { parseEncrypted } from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import { emptyRoom, type LocalEvent, type RoomState, reduce, reduceAll } from '../src/index.js';

/** mulberry32 — small, fast, and the same sequence on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const ACCOUNTS = ['alice', 'bob', 'carol'];

/**
 * A corpus of events in which every reference points **backwards**.
 *
 * That is what a real Host produces: ids are assigned in time order, and an
 * edit or a reaction is only ever sent after the thing it refers to has been
 * acknowledged. The reducer's order-independence depends on it — an edit whose
 * id is *lower* than its target's is applied before the target exists and is
 * dropped, and whether that happens depends on how the events were batched.
 * Real ids make that unreachable; this generator makes the assumption explicit
 * rather than accidental.
 */
function corpus(seed: number, count: number): LocalEvent[] {
  const random = rng(seed);
  const events: LocalEvent[] = [];
  const messages: string[] = [];
  const authors = new Map<string, string>();

  // Ids of a realistic width, so nothing here accidentally depends on short
  // ids sorting the same lexically and numerically.
  let next = 1767225600000000000n;

  const push = (account: string, payload: Record<string, unknown>) => {
    const raw = next++;
    const id = String(raw);
    events.push({
      id,
      account,
      at: Number(raw % 1_000_000n),
      payload: parseEncrypted({ v: 1, ...payload }),
    });
    return id;
  };

  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)] as T;

  for (let i = 0; i < count; i++) {
    const account = pick(ACCOUNTS);
    const roll = random();

    if (messages.length === 0 || roll < 0.35) {
      const thread = messages.length && random() < 0.2 ? pick(messages) : undefined;
      const id = push(account, { type: 'm.message', body: `message ${i}`, thread });
      messages.push(id);
      authors.set(id, account);
      continue;
    }

    const target = pick(messages);
    if (roll < 0.45) {
      // Only the author may edit, and an edit from anybody else is a no-op —
      // so both cases are generated, and both must be order-independent.
      push(random() < 0.8 ? (authors.get(target) as string) : account, {
        type: 'm.edit',
        target,
        body: `edited ${i}`,
      });
    } else if (roll < 0.5) {
      push(authors.get(target) as string, { type: 'm.redact', target });
    } else if (roll < 0.7) {
      push(account, {
        type: 'm.reaction',
        target,
        key: pick(['🔥', '👀', '💜']),
        remove: random() < 0.3,
      });
    } else if (roll < 0.78) {
      push(account, { type: 'm.receipt', upTo: target });
    } else if (roll < 0.84) {
      push(account, { type: 'm.pin', target, unpin: random() < 0.4 });
    } else if (roll < 0.9) {
      push(account, {
        type: 'm.annotation',
        target,
        kind: pick(['note', 'translation:de']),
        body: `annotation ${i}`,
      });
    } else if (roll < 0.94) {
      push(account, { type: 'room.name', name: `room ${i}`, topic: `topic ${i}` });
    } else if (roll < 0.97) {
      push(account, {
        type: 'room.faces',
        faces: [{ id: String(100 + (i % 5)), name: `face ${i % 5}` }],
      });
    } else {
      // A type this build does not know. It has to keep its place, and keep it
      // in the same place however the events arrived.
      push(account, { type: 'm.poll', question: `poll ${i}` });
    }
  }

  return events;
}

const apply = (events: LocalEvent[]) =>
  reduceAll(emptyRoom('room'), events, { mayModerate: (a) => a === 'carol' });

/** Compared by value: `toEqual` walks Maps and Sets, which this state is full of. */
const same = (a: RoomState, b: RoomState) => expect(a).toEqual(b);

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe('the reducer, as a function of its log', () => {
  it('produces the same room whatever order the events arrive in', () => {
    // The invariant the whole design rests on. A history page, a socket burst
    // and a replay all deliver the same events in different orders, and the
    // room a person sees must not depend on which one got there first.
    for (const seed of SEEDS) {
      const events = corpus(seed, 120);
      const expected = apply(events);
      const random = rng(seed * 7919);

      for (let attempt = 0; attempt < 6; attempt++) {
        same(apply(shuffle(events, random)), expected);
      }
    }
  });

  it('does not care how a forward stream was chopped into batches', () => {
    // One page of 120, or 120 pages of one, or anything between. This is live
    // delivery: ids only ever increase.
    for (const seed of SEEDS) {
      const events = corpus(seed, 120);
      const expected = apply(events);

      for (const size of [1, 2, 7, 40, 119, 500]) {
        let state = emptyRoom('room');
        for (let i = 0; i < events.length; i += size) {
          state = reduceAll(state, events.slice(i, i + size), {
            mayModerate: (a) => a === 'carol',
          });
        }
        same(state, expected);
      }
    }
  });

  it('reaches the same room by backfilling as by having been there', () => {
    // The scenario that made the deferral necessary, and the one that loses
    // data without it: live messages arrive, somebody scrolls up, and the
    // history that arrives is *older* than everything already held. A reaction
    // to a message that had not been loaded yet must not be lost.
    for (const seed of SEEDS) {
      const events = corpus(seed, 120);
      const expected = apply(events);

      for (const split of [10, 37, 60, 90, 119]) {
        const older = events.slice(0, split);
        const newer = events.slice(split);

        // Live first, then page backwards through what came before.
        let state = reduceAll(emptyRoom('room'), newer, { mayModerate: (a) => a === 'carol' });
        for (let i = older.length; i > 0; i -= 17) {
          state = reduceAll(state, older.slice(Math.max(0, i - 17), i), {
            mayModerate: (a) => a === 'carol',
          });
        }
        same(state, expected);
      }
    }
  });

  it('is unchanged by re-delivery, however much of it', () => {
    // A reconnect replays; a history page overlaps a socket burst; a retry
    // arrives twice. None of it may change the room.
    for (const seed of SEEDS) {
      const events = corpus(seed, 80);
      const expected = apply(events);
      const random = rng(seed * 15485863);

      // Every event twice, shuffled together.
      same(apply(shuffle([...events, ...events], random)), expected);

      // And forwards, re-delivering an already-applied event at every step.
      let state = emptyRoom('room');
      const seen: LocalEvent[] = [];
      for (const event of events) {
        state = reduceAll(state, [event], { mayModerate: (a) => a === 'carol' });
        seen.push(event);
        const again = seen[Math.floor(random() * seen.length)] as LocalEvent;
        state = reduceAll(state, [again], { mayModerate: (a) => a === 'carol' });
      }
      same(state, expected);
    }
  });

  it('never mutates the state it was handed', () => {
    for (const seed of SEEDS) {
      const events = corpus(seed, 60);
      let state = emptyRoom('room');
      const history: RoomState[] = [state];

      for (const event of events) {
        state = reduce(state, event, { mayModerate: (a) => a === 'carol' });
        history.push(state);
      }

      // Every earlier state must still be exactly what it was when it was
      // produced — which is what makes it safe to hand one to a UI and keep
      // reducing.
      let replay = emptyRoom('room');
      expect(history[0]).toEqual(replay);
      for (const [index, event] of events.entries()) {
        replay = reduce(replay, event, { mayModerate: (a) => a === 'carol' });
        expect(history[index + 1]).toEqual(replay);
      }
    }
  });

  it('keeps its indexes agreeing with its messages', () => {
    // `byId`, `threads` and `pinned` are caches over `messages`. A cache that
    // disagrees with the thing it caches is how a UI ends up rendering a
    // message that is not there.
    for (const seed of SEEDS) {
      const state = apply(corpus(seed, 150));

      expect(state.byId.size).toBe(state.messages.length);
      for (const message of state.messages) {
        expect(state.byId.get(message.id)).toBe(message);
      }

      for (const id of state.pinned) {
        expect(state.byId.get(id)?.pinned).toBe(true);
      }
      for (const message of state.messages) {
        if (message.pinned) expect(state.pinned).toContain(message.id);
      }

      for (const [root, replies] of state.threads) {
        expect([...replies].sort()).toEqual(replies);
        for (const reply of replies) {
          expect(state.byId.get(reply)?.thread).toBe(root);
        }
      }
      for (const message of state.messages) {
        if (message.thread) expect(state.threads.get(message.thread)).toContain(message.id);
      }
    }
  });

  it('keeps messages in id order', () => {
    for (const seed of SEEDS) {
      const state = apply(corpus(seed, 150));
      const ids = state.messages.map((m) => m.id);
      expect(ids).toEqual([...ids].sort());
      // Realistic ids are all the same width, so a plain sort is the right
      // comparison here — which is the point: it should already be sorted.
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('never leaves a redacted message with content', () => {
    // The tombstone is the whole point. Anything still hanging off it — a
    // reaction, an annotation, an edit history — is content that survived a
    // deletion.
    for (const seed of SEEDS) {
      for (const message of apply(corpus(seed, 150)).messages) {
        if (!message.redacted) continue;
        expect(message.body).toBe('');
        expect(message.attachments).toBeUndefined();
        expect(message.reactions).toBeUndefined();
        expect(message.annotations).toBeUndefined();
        expect(message.edits).toBeUndefined();
      }
    }
  });

  it('only ever moves a read marker forwards', () => {
    for (const seed of SEEDS) {
      const events = corpus(seed, 150);
      const state = apply(events);

      for (const [account, upTo] of state.receipts) {
        // The marker must be the highest any of that account's receipts named.
        const theirs = events
          .filter(
            (e) => e.account === account && e.payload.known && e.payload.event.type === 'm.receipt',
          )
          .map((e) => (e.payload as { event: { upTo: string } }).event.upTo);
        expect(upTo).toBe(theirs.sort().at(-1));
      }
    }
  });
});
