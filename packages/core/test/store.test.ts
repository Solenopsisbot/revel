/**
 * One suite, two stores.
 *
 * `docs/02` says IndexedDB in a browser and SQLite elsewhere, "behind one
 * `Store` interface". An interface with two implementations and one test suite
 * each is an interface in name only — the moment they disagree, whichever one
 * the tests were written against becomes the real contract and the other one
 * quietly rots. So everything below runs twice.
 */
// Installs the IndexedDB globals, which is the shape a browser has: the
// factory and `IDBKeyRange` come together. Tests still pass their own
// `IDBFactory` so no two of them share a database.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptyRoom,
  IndexedDbStore,
  type LocalEvent,
  type LocalStore,
  MemoryStore,
  reduceAll,
} from '../src/index.js';

const ev = (id: string, body: string): LocalEvent => ({
  id,
  account: 'a',
  at: Number(id),
  payload: { known: true, event: { v: 1, type: 'm.message', body } },
});

/** Realistic snowflakes — 19 digits — because that is where ordering bites. */
const snowflake = (n: number) => String(1767225600000000000n + BigInt(n));

interface Implementation {
  name: string;
  open: () => Promise<LocalStore>;
}

const implementations: Implementation[] = [
  { name: 'MemoryStore', open: async () => new MemoryStore() },
  {
    name: 'IndexedDbStore',
    // A fresh factory per store, so one test's database cannot be another's.
    open: () => IndexedDbStore.open({ factory: new IDBFactory(), name: 'test' }),
  },
];

for (const implementation of implementations) {
  describe(implementation.name, () => {
    let store: LocalStore;

    beforeEach(async () => {
      store = await implementation.open();
    });

    describe('events', () => {
      it('keeps them in id order however they went in', async () => {
        await store.putEvents('r1', [ev('3', 'third'), ev('1', 'first')]);
        await store.putEvents('r1', [ev('2', 'second')]);
        const events = await store.listEvents('r1');
        expect(events.map((e) => e.id)).toEqual(['1', '2', '3']);
      });

      it('orders long ids numerically, not lexically', async () => {
        // The case that breaks a naive key: "…9" must come before "…10".
        const ids = [snowflake(9), snowflake(10), snowflake(100), snowflake(11)];
        await store.putEvents(
          'r1',
          ids.map((id) => ev(id, id)),
        );
        const back = await store.listEvents('r1');
        expect(back.map((e) => e.id)).toEqual([
          snowflake(9),
          snowflake(10),
          snowflake(11),
          snowflake(100),
        ]);
      });

      it('is idempotent by event id', async () => {
        await store.putEvents('r1', [ev('1', 'first')]);
        await store.putEvents('r1', [ev('1', 'first')]);
        expect(await store.listEvents('r1')).toHaveLength(1);
      });

      it('does not let a re-delivery overwrite what is stored', async () => {
        // Re-delivery is not new information. If the two ever differ, the first
        // one won the race and the second is a duplicate, not a correction.
        await store.putEvents('r1', [ev('1', 'original')]);
        await store.putEvents('r1', [ev('1', 'tampered')]);
        const [only] = await store.listEvents('r1');
        expect((only?.payload as { event: { body: string } }).event.body).toBe('original');
      });

      it('keeps rooms apart', async () => {
        await store.putEvents('r1', [ev('1', 'ours')]);
        await store.putEvents('r2', [ev('1', 'theirs')]);
        expect(await store.listEvents('r1')).toHaveLength(1);
        expect(await store.listEvents('r2')).toHaveLength(1);
      });

      it('pages forwards with `after`', async () => {
        await store.putEvents(
          'r1',
          ['1', '2', '3', '4'].map((id) => ev(id, id)),
        );
        const page = await store.listEvents('r1', { after: '2' });
        expect(page.map((e) => e.id)).toEqual(['3', '4']);
      });

      it('pages backwards with `before`, taking the newest of what is older', async () => {
        await store.putEvents(
          'r1',
          ['1', '2', '3', '4', '5'].map((id) => ev(id, id)),
        );
        const page = await store.listEvents('r1', { before: '5', limit: 2 });
        // Scrolling up wants 3 and 4, not 1 and 2.
        expect(page.map((e) => e.id)).toEqual(['3', '4']);
      });

      it('limits forwards from the start', async () => {
        await store.putEvents(
          'r1',
          ['1', '2', '3', '4'].map((id) => ev(id, id)),
        );
        const page = await store.listEvents('r1', { limit: 2 });
        expect(page.map((e) => e.id)).toEqual(['1', '2']);
      });

      it('treats the cursors as exclusive', async () => {
        await store.putEvents(
          'r1',
          ['1', '2', '3'].map((id) => ev(id, id)),
        );
        expect((await store.listEvents('r1', { after: '1' })).map((e) => e.id)).toEqual(['2', '3']);
        expect((await store.listEvents('r1', { before: '3' })).map((e) => e.id)).toEqual([
          '1',
          '2',
        ]);
      });

      it('reports the highest id it holds', async () => {
        expect(await store.lastEventId('r1')).toBeNull();
        await store.putEvents('r1', [ev(snowflake(9), 'a'), ev(snowflake(100), 'b')]);
        expect(await store.lastEventId('r1')).toBe(snowflake(100));
      });

      it('is empty for a room it has never heard of', async () => {
        expect(await store.listEvents('nobody')).toEqual([]);
        expect(await store.putEvents('r1', [])).toBeUndefined();
      });
    });

    describe('room snapshots', () => {
      const room = () =>
        reduceAll(emptyRoom('r1'), [
          ev('1', 'first'),
          { ...ev('2', 'second'), account: 'b' },
          {
            id: '3',
            account: 'b',
            at: 3,
            payload: { known: true, event: { v: 1, type: 'm.reaction', target: '1', key: '🔥' } },
          },
        ]);

      it('round-trips the Maps and Sets the reducer produces', async () => {
        // JSON would turn every one of these into `{}`, silently.
        const before = room();
        await store.putRoom(before);
        const after = await store.getRoom('r1');

        expect(after?.messages.map((m) => m.id)).toEqual(['1', '2']);
        expect(after?.byId).toBeInstanceOf(Map);
        expect(after?.applied).toBeInstanceOf(Set);
        expect(after?.applied.has('3')).toBe(true);
        expect(after?.byId.get('1')?.reactions).toEqual([{ key: '🔥', accounts: ['b'] }]);
      });

      it('a stored snapshot can be reduced onward', async () => {
        await store.putRoom(room());
        const restored = (await store.getRoom('r1')) as NonNullable<
          Awaited<ReturnType<LocalStore['getRoom']>>
        >;
        const next = reduceAll(restored, [ev('4', 'fourth')]);
        expect(next.messages.map((m) => m.id)).toEqual(['1', '2', '4']);
        // And the applied set came back, so replaying an old event is still a
        // no-op after a reload.
        expect(reduceAll(next, [ev('1', 'first')]).messages).toHaveLength(3);
      });

      it('is null for a room with no snapshot', async () => {
        expect(await store.getRoom('r1')).toBeNull();
      });

      it('overwrites rather than accumulating', async () => {
        await store.putRoom(room());
        await store.putRoom(reduceAll(emptyRoom('r1'), [ev('9', 'only')]));
        expect((await store.getRoom('r1'))?.messages.map((m) => m.id)).toEqual(['9']);
      });

      it('lists rooms with a snapshot, with events, or with both', async () => {
        await store.putRoom(room());
        await store.putEvents('r2', [ev('1', 'x')]);
        await store.putEvents('r1', [ev('1', 'x')]);
        expect(await store.listRoomIds()).toEqual(['r1', 'r2']);
      });

      it('forgets a room entirely', async () => {
        await store.putRoom(room());
        await store.putEvents('r1', [ev('1', 'x')]);
        await store.forgetRoom('r1');

        expect(await store.getRoom('r1')).toBeNull();
        expect(await store.listEvents('r1')).toEqual([]);
        expect(await store.listRoomIds()).toEqual([]);
      });

      it('forgetting one room leaves the others alone', async () => {
        await store.putEvents('r1', [ev('1', 'x')]);
        await store.putEvents('r2', [ev('1', 'y')]);
        await store.forgetRoom('r1');
        expect(await store.listEvents('r2')).toHaveLength(1);
      });
    });

    describe('sealed crypto state', () => {
      const bytes = (...n: number[]) => Uint8Array.from(n);

      it('round-trips bytes unchanged', async () => {
        await store.putSealed('group', 'g1', bytes(1, 2, 3, 255, 0));
        expect(await store.getSealed('group', 'g1')).toEqual(bytes(1, 2, 3, 255, 0));
      });

      it('keeps the two kinds apart', async () => {
        await store.putSealed('group', 'g1', bytes(1));
        await store.putSealed('keyPackages', 'g1', bytes(2));
        expect(await store.getSealed('group', 'g1')).toEqual(bytes(1));
        expect(await store.getSealed('keyPackages', 'g1')).toEqual(bytes(2));
      });

      it('overwrites, because a newer state supersedes an older one', async () => {
        await store.putSealed('group', 'g1', bytes(1));
        await store.putSealed('group', 'g1', bytes(2));
        expect(await store.getSealed('group', 'g1')).toEqual(bytes(2));
      });

      it('lists one kind, in id order', async () => {
        await store.putSealed('group', 'g2', bytes(2));
        await store.putSealed('group', 'g1', bytes(1));
        await store.putSealed('keyPackages', 'self', bytes(9));

        const groups = await store.listSealed('group');
        expect(groups.map((r) => r.id)).toEqual(['g1', 'g2']);
        expect(groups[0]?.bytes).toEqual(bytes(1));
        expect(await store.listSealed('keyPackages')).toHaveLength(1);
      });

      it('is null for something it does not have', async () => {
        expect(await store.getSealed('group', 'nope')).toBeNull();
        expect(await store.listSealed('group')).toEqual([]);
      });

      it('deletes', async () => {
        await store.putSealed('group', 'g1', bytes(1));
        await store.deleteSealed('group', 'g1');
        expect(await store.getSealed('group', 'g1')).toBeNull();
        // Deleting something that is not there is not an error.
        await expect(store.deleteSealed('group', 'g1')).resolves.toBeUndefined();
      });
    });

    describe('account-level values', () => {
      it('round-trips a value', async () => {
        await store.put('cursor', { room: 'r1', at: '12' });
        expect(await store.get('cursor')).toEqual({ room: 'r1', at: '12' });
      });

      it('round-trips bytes, which is what the secrets are', async () => {
        await store.put('deviceSecret', Uint8Array.from([7, 8, 9]));
        expect(await store.get('deviceSecret')).toEqual(Uint8Array.from([7, 8, 9]));
      });

      it('is null for a key that was never set', async () => {
        expect(await store.get('nope')).toBeNull();
      });

      it('can tell a stored null from a missing key', async () => {
        // `get` returning null for both would make "the user turned this off"
        // indistinguishable from "the user has never seen this setting".
        await store.put('explicit', null);
        expect(await store.get('explicit')).toBeNull();
        await store.put('explicit', false);
        expect(await store.get('explicit')).toBe(false);
      });

      it('deletes', async () => {
        await store.put('k', 1);
        await store.delete('k');
        expect(await store.get('k')).toBeNull();
      });
    });

    describe('housekeeping', () => {
      it('clears everything', async () => {
        await store.putEvents('r1', [ev('1', 'x')]);
        await store.putRoom(emptyRoom('r1'));
        await store.putSealed('group', 'g1', Uint8Array.from([1]));
        await store.put('k', 1);

        await store.clear();

        expect(await store.listRoomIds()).toEqual([]);
        expect(await store.listEvents('r1')).toEqual([]);
        expect(await store.listSealed('group')).toEqual([]);
        expect(await store.get('k')).toBeNull();
      });

      it('survives being cleared twice', async () => {
        await store.clear();
        await expect(store.clear()).resolves.toBeUndefined();
      });
    });

    describe('isolation', () => {
      it('does not hand out a reference a caller can mutate', async () => {
        // Whatever is stored has to stop being reachable from the caller, or a
        // caller editing what they read edits the database.
        const event = ev('1', 'first');
        await store.putEvents('r1', [event]);
        (event.payload as { event: { body: string } }).event.body = 'changed underneath';

        const [stored] = await store.listEvents('r1');
        expect((stored?.payload as { event: { body: string } }).event.body).toBe('first');

        (stored?.payload as { event: { body: string } }).event.body = 'changed after reading';
        const [again] = await store.listEvents('r1');
        expect((again?.payload as { event: { body: string } }).event.body).toBe('first');
      });

      it('does not hand out a room snapshot a caller can mutate', async () => {
        await store.putRoom(reduceAll(emptyRoom('r1'), [ev('1', 'first')]));
        const first = await store.getRoom('r1');
        first?.messages.push({ id: '99', account: 'x', at: 99, body: 'injected' });

        expect((await store.getRoom('r1'))?.messages).toHaveLength(1);
      });

      it('does not hand out sealed bytes a caller can mutate', async () => {
        await store.putSealed('group', 'g1', Uint8Array.from([1, 2, 3]));
        const got = await store.getSealed('group', 'g1');
        got?.set([9, 9, 9]);
        expect(await store.getSealed('group', 'g1')).toEqual(Uint8Array.from([1, 2, 3]));
      });
    });
  });
}

describe('MemoryStore, specifically', () => {
  it('refuses everything once closed', async () => {
    const store = new MemoryStore();
    await store.close();
    await expect(store.listEvents('r1')).rejects.toThrow(/closed/);
  });
});

describe('IndexedDbStore, specifically', () => {
  it('keeps what it wrote across a close and re-open', async () => {
    // The entire point of it. A `MemoryStore` cannot test this because for a
    // MemoryStore it is not true.
    const factory = new IDBFactory();
    const first = await IndexedDbStore.open({ factory, name: 'persist' });
    await first.putEvents('r1', [ev('1', 'survives')]);
    await first.putSealed('group', 'g1', Uint8Array.from([4, 2]));
    await first.close();

    const second = await IndexedDbStore.open({ factory, name: 'persist' });
    expect(await second.listEvents('r1')).toHaveLength(1);
    expect(await second.getSealed('group', 'g1')).toEqual(Uint8Array.from([4, 2]));
    await second.close();
  });

  it('keeps two databases apart', async () => {
    const factory = new IDBFactory();
    const mine = await IndexedDbStore.open({ factory, name: 'account-a' });
    const theirs = await IndexedDbStore.open({ factory, name: 'account-b' });

    await mine.putEvents('r1', [ev('1', 'mine')]);
    expect(await theirs.listEvents('r1')).toEqual([]);

    await mine.close();
    await theirs.close();
  });
});
