/**
 * The room list, when the Host will not answer.
 *
 * A device that has been used holds everything it needs to show you your
 * conversations: sealed MLS state, materialised room snapshots, and every
 * message it has ever decrypted. What it did *not* hold was the list of which
 * rooms exist — that came from the Host on every start and from nowhere else.
 *
 * So a rate limit, or a Host restarting, or a train tunnel, produced an app
 * that looked like a device nobody had ever signed in on, with all of the data
 * sitting on disk one key away. This is the key.
 */
import { describe, expect, it } from 'vitest';
import { LiveCore, MemoryStore, type RoomInfo } from '../src/index.js';

const ROOMS: RoomInfo[] = [
  { id: 'r1', kind: 'dm', members: ['a', 'b'], group: 'g1' } as RoomInfo,
  { id: 'r2', kind: 'space', members: ['a'], group: 'g2', space: 's1' } as RoomInfo,
];

/** Just enough of the collaborators `Directory.refresh` actually touches. */
function core(listRooms: () => Promise<RoomInfo[]>, store?: MemoryStore) {
  const bound: string[] = [];
  const live = new LiveCore({
    account: 'a',
    transport: { listRooms } as never,
    rooms: {
      bind: async (roomId: string) => {
        bound.push(roomId);
      },
      watch: () => () => {},
    } as never,
    groups: {} as never,
    crypto: {} as never,
    ...(store ? { store } : {}),
  });
  return { live, bound };
}

describe('the room list', () => {
  it('comes from the Host and is written down on the way past', async () => {
    const store = new MemoryStore();
    const { live } = core(async () => ROOMS, store);
    expect(await live.directory.refresh()).toHaveLength(2);
    // Not awaited by `refresh` — a cache that cannot be written is a worse
    // next start, not a broken this one — so let the microtask land.
    await new Promise((r) => setTimeout(r, 0));
    expect(await store.get('directory.rooms')).toHaveLength(2);
  });

  it('comes off disk when the Host refuses', async () => {
    const store = new MemoryStore();
    await store.put('directory.rooms', ROOMS);
    const { live, bound } = core(async () => {
      throw new Error('rate_limited');
    }, store);

    expect(await live.directory.refresh()).toHaveLength(2);
    // Binding runs for the cached list too. It is a local operation, and it is
    // what makes an offline room openable rather than merely listed.
    expect(bound).toEqual(['r1', 'r2']);
  });

  it('still throws when there is nothing cached, rather than inventing an empty list', async () => {
    // A client with no cache and no Host genuinely knows nothing, and the
    // caller has to be able to tell that apart from "you are in no rooms" —
    // one is a failure to show and the other is a fact about the account.
    const store = new MemoryStore();
    const { live } = core(async () => {
      throw new Error('rate_limited');
    }, store);
    await expect(live.directory.refresh()).rejects.toThrow('rate_limited');
  });

  it('prefers the Host, so a working client never reads a stale answer', async () => {
    const store = new MemoryStore();
    await store.put('directory.rooms', ROOMS);
    const { live } = core(async () => [ROOMS[0] as RoomInfo], store);
    expect(await live.directory.refresh()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    // And the cache follows it down, rather than keeping a room that is gone.
    expect(await store.get('directory.rooms')).toHaveLength(1);
  });

  it('works with no store at all, which is what every test harness passes', async () => {
    const { live } = core(async () => ROOMS);
    expect(await live.directory.refresh()).toHaveLength(2);
  });
});
