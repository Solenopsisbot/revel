/**
 * A face, reaching the other person.
 *
 * `docs/03` §7 says a plural system's roster is a **per-room encrypted state
 * event**, so the Host never learns it. That is two claims — the room finds
 * out, and the server does not — and only a second client can check the first.
 */
import { describe, expect, it } from 'vitest';
import { type Client, World, wasmBuilt } from './harness.js';

const scenarios = wasmBuilt ? describe : describe.skip;

async function pair() {
  const world = await World.create();
  const alice = await world.join('alice');
  const bob = await world.join('bob');
  await bob.replenish();

  const room = world.room();
  const group = await alice.open(room);
  await alice.invite(group, [bob.account]);
  await world.settle();
  await bob.sync();
  await world.settle();
  return { world, alice, bob, room };
}

// **Snowflakes.** `FaceRef.id` is `/^\d{1,20}$/`, so `face-viola` is not a face
// id — it fails the payload's own schema, and the whole event then arrives as
// an unknown type with no face and no roster. Which is how this was found.
const VIOLA = { id: '1767225600000000001', name: 'Viola', colour: 'violet' };
const ASH = { id: '1767225600000000002', name: 'Ash', colour: 'aqua' };

/** The roster the reducer built for a client, as ids. */
const roster = (who: Client, room: string) => [...who.rooms.state(room).faces.keys()].sort();

/**
 * Send through the **app-facing** surface, not the harness helper.
 *
 * `Client.say` calls `rooms.send` directly, which is the right shortcut for
 * tests about delivery — but the face is stamped by `LiveCore`, so a test about
 * faces that used it would be testing the layer underneath the one that does
 * the work.
 */
const say = (who: Client, room: string, text: string) => who.core.conversation.send(room, text);

scenarios('speaking as a face', () => {
  it('puts the face on the message, so it survives a later rename', async () => {
    // `docs/04` §2: a snapshot, not a lookup. It is why renaming a face does
    // not silently rewrite every message that face ever sent.
    const { world, alice, bob, room } = await pair();
    alice.face = VIOLA;

    await say(alice, room, 'hello');
    await world.settle();

    const seen = bob.messages(room).find((m) => m.body === 'hello');
    expect(seen?.face).toMatchObject({ id: VIOLA.id, name: 'Viola' });
    await world.close();
  });

  it('tells the room the roster, which is how a member list is possible', async () => {
    const { world, alice, bob, room } = await pair();
    alice.face = VIOLA;

    await say(alice, room, 'hello');
    await world.settle();

    expect(roster(bob, room)).toEqual([VIOLA.id]);
    await world.close();
  });

  it('announces once, not on every message', async () => {
    // A state event between every pair of messages would be a roster update
    // per sentence — and `room.faces` is stored, so that is permanent noise.
    const { world, alice, bob, room } = await pair();
    alice.face = VIOLA;

    await say(alice, room, 'one');
    await say(alice, room, 'two');
    await say(alice, room, 'three');
    await world.settle();

    // Three messages, and one roster entry — not three of them. `room.faces`
    // is a stored event, so announcing per message would be permanent noise
    // between every pair of sentences.
    expect(bob.messages(room).filter((m) => typeof m.body === 'string')).toHaveLength(3);
    expect(roster(bob, room)).toEqual([VIOLA.id]);
    // And exactly one roster event reached the Host for this face.
    const stored = world.store.events.get(room) ?? [];
    expect(stored.filter((e) => e.class === 'silent')).toHaveLength(1);
    await world.close();
  });

  it('announces a second face when one starts speaking', async () => {
    // The other half of `docs/11`: two faces in one room *are* linkable by
    // anybody in it, and the roster is one of the ways. That is the documented
    // limit, not a leak — but it has to actually work, or the member list is
    // wrong.
    const { world, alice, bob, room } = await pair();
    alice.face = VIOLA;
    await say(alice, room, 'as viola');
    await world.settle();

    alice.face = ASH;
    await say(alice, room, 'as ash');
    await world.settle();

    expect(roster(bob, room)).toEqual([ASH.id, VIOLA.id].sort());
    await world.close();
  });

  it('sends no face at all when the account has none', async () => {
    // An account that has never made a face is a normal account, and inventing
    // a name for it would put a fiction in encrypted history.
    const { world, alice, bob, room } = await pair();
    alice.face = undefined;

    await say(alice, room, 'plain');
    await world.settle();

    const seen = bob.messages(room).find((m) => m.body === 'plain');
    expect(seen?.face).toBeUndefined();
    expect(roster(bob, room)).toEqual([]);
    await world.close();
  });

  it('keeps the roster out of the Host', async () => {
    // The claim `docs/03` §7 actually makes. The roster is an ordinary
    // encrypted event, so this is the same check as for a message — but it is
    // the one somebody would most want to be wrong about.
    const { world, alice, room } = await pair();
    alice.face = VIOLA;
    await say(alice, room, 'hello');
    await world.settle();

    const stored = world.store.events.get(room) ?? [];
    expect(stored.length).toBeGreaterThan(0);
    for (const event of stored) {
      expect(atob(event.payload)).not.toContain('Viola');
      expect(atob(event.payload)).not.toContain(VIOLA.id);
    }
    await world.close();
  });
});
