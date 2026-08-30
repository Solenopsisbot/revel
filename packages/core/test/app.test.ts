/**
 * The app-facing surface, driven the way an app would drive it.
 *
 * `docs/33` set the test for whether the interface is right: swapping the fake
 * core for the real one behind it should be a small change. This file is the
 * other half of that — proving the real one can actually answer everything a
 * client needs, using nothing but `RevelCore`.
 *
 * Every scenario below goes through `client.core`. If something can only be
 * done by reaching past it into `RoomSync`, the interface has a hole.
 */

import { describe, expect, it } from 'vitest';
import type { RevelCore } from '../src/index.js';
import { type Client, World, wasmBuilt } from './harness.js';

const scenarios = wasmBuilt ? describe : describe.skip;
const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** Two people in a DM, set up entirely through the app surface. */
async function pair() {
  const world = await World.create();
  const alice = await world.join('alice');
  const bob = await world.join('bob');
  await world.name(alice, 'alice');
  await world.name(bob, 'bob');
  await bob.replenish();

  const room = await alice.core.directory.openDm({ address: 'bob' });
  const group = await alice.open(room.id);
  await alice.invite(group, [bob.account]);
  await world.settle();

  await bob.core.directory.refresh();
  await bob.sync();
  await world.settle();

  return { world, alice, bob, room: room.id, group };
}

const textsOf = (core: RevelCore, roomId: string) =>
  core.conversation
    .timeline(roomId)
    .filter((m) => !m.redacted && !m.purged)
    .map((m) => (typeof m.body === 'string' ? m.body : JSON.stringify(m.body)));

scenarios('the conversation surface', () => {
  it('sends and receives', async () => {
    const { world, alice, bob, room } = await pair();
    await alice.core.conversation.send(room, 'hello through the interface');
    await world.settle();

    expect(textsOf(bob.core, room)).toEqual(['hello through the interface']);
    await world.close();
  });

  it('edits, and the edit is attributed to the message rather than replacing it', async () => {
    const { world, alice, bob, room } = await pair();
    await alice.core.conversation.send(room, 'frist');
    await world.settle();

    const id = alice.core.conversation.timeline(room)[0]?.id as string;
    await alice.core.conversation.edit(room, id, 'first');
    await world.settle();

    const message = bob.core.conversation.timeline(room)[0];
    expect(message?.body).toBe('first');
    expect(message?.editedAt).toBeGreaterThan(0);
    await world.close();
  });

  it('redacts, leaving a tombstone rather than a hole', async () => {
    // The row stays so the conversation still makes sense; the content is gone.
    const { world, alice, bob, room } = await pair();
    await alice.core.conversation.send(room, 'regrettable');
    await world.settle();

    const id = alice.core.conversation.timeline(room)[0]?.id as string;
    await alice.core.conversation.redact(room, id, 'typo');
    await world.settle();

    const message = bob.core.conversation.timeline(room)[0];
    expect(message?.redacted).toMatchObject({ by: 'author' });
    expect(textsOf(bob.core, room)).toEqual([]);
    await world.close();
  });

  it('reacts, and un-reacts', async () => {
    const { world, alice, bob, room } = await pair();
    await alice.core.conversation.send(room, 'a good point');
    await world.settle();
    const id = alice.core.conversation.timeline(room)[0]?.id as string;

    await bob.core.conversation.react(room, id, '👍');
    await world.settle();
    expect(alice.core.conversation.timeline(room)[0]?.reactions?.[0]).toMatchObject({
      key: '👍',
      accounts: [bob.account],
    });

    await bob.core.conversation.react(room, id, '👍', true);
    await world.settle();
    expect(alice.core.conversation.timeline(room)[0]?.reactions ?? []).toEqual([]);
    await world.close();
  });

  it('pins, and the noticeboard is ordered by the log', async () => {
    const { world, alice, bob, room } = await pair();
    await alice.core.conversation.send(room, 'one');
    await alice.core.conversation.send(room, 'two');
    await world.settle();

    const [first, second] = alice.core.conversation.timeline(room);
    await alice.core.conversation.pin(room, first?.id as string);
    await alice.core.conversation.pin(room, second?.id as string);
    await world.settle();

    // Most recently pinned first, derived from the log rather than from the
    // order pins happened to be applied in.
    expect(bob.core.conversation.room(room).pinned).toEqual([second?.id, first?.id]);
    await world.close();
  });

  it('attaches a file and opens it again', async () => {
    const { world, alice, bob, room } = await pair();
    const photo = ENC.encode('a photograph of a very good dog');

    const ref = await alice.core.conversation.attach(room, photo, {
      mime: 'image/png',
      name: 'dog.png',
    });
    await alice.core.conversation.send(room, '', { attachments: [ref] });
    await world.settle();

    const theirs = bob.core.conversation.timeline(room)[0]?.attachments?.[0];
    expect(DEC.decode(await bob.core.conversation.openAttachment(theirs))).toBe(DEC.decode(photo));
    await world.close();
  });

  it('carries typing, and stops it when a message is sent', async () => {
    // Sending is the end of typing, and saying so beats waiting for the notice
    // to time out on the other side.
    const { world, alice, bob, room } = await pair();
    await alice.core.conversation.setTyping(room);
    await world.settle();
    expect(bob.core.conversation.typing(room)).toHaveLength(1);

    await alice.core.conversation.send(room, 'done');
    await world.settle();
    expect(bob.core.conversation.typing(room)).toEqual([]);
    await world.close();
  });

  it('counts unread and clears it', async () => {
    const { world, alice, bob, room } = await pair();
    await alice.core.conversation.send(room, 'one');
    await alice.core.conversation.send(room, 'two');
    await world.settle();

    expect(bob.core.conversation.unread(room)).toBe(2);
    await bob.core.conversation.markRead(room);
    await world.settle();
    expect(bob.core.conversation.unread(room)).toBe(0);
    await world.close();
  });

  it('searches what this client has decrypted, and nothing else', async () => {
    // The server is the search adversary (`docs/03`), so "searchable" means
    // "already here". Nothing about the query leaves.
    const { world, alice, bob, room } = await pair();
    await alice.core.conversation.send(room, 'the quick brown fox');
    await alice.core.conversation.send(room, 'something else');
    await world.settle();

    const hits = bob.core.conversation.search({ terms: ['brown'], phrase: 'brown' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.roomId).toBe(room);
    await world.close();
  });

  it('notifies a watcher when the room moves', async () => {
    const { world, alice, bob, room } = await pair();
    const seen: number[] = [];
    const stop = bob.core.conversation.watch(room, (state) => seen.push(state.messages.length));

    await alice.core.conversation.send(room, 'one');
    await world.settle();
    stop();
    const after = seen.length;

    await alice.core.conversation.send(room, 'two');
    await world.settle();
    expect(seen.length).toBe(after);
    expect(seen.at(-1)).toBeGreaterThan(0);
    await world.close();
  });
});

scenarios('the directory surface', () => {
  it('opens a DM by name and lists it', async () => {
    const { world, alice, room } = await pair();
    expect(alice.core.directory.rooms().map((r) => r.id)).toContain(room);
    await world.close();
  });

  it('is idempotent about opening the same DM twice', async () => {
    const { world, alice, room } = await pair();
    const again = await alice.core.directory.openDm({ address: 'bob' });
    expect(again.id).toBe(room);
    await world.close();
  });

  it('adds somebody to a group room *and* gives them the keys', async () => {
    // The one place the app surface does more than the transport: adding to a
    // room is delivery, and the commit is access. A caller that had to know to
    // do both would eventually forget.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    const carol = await world.join('carol');
    await bob.replenish();
    await carol.replenish();

    const room = await alice.core.directory.openGroupRoom([bob.account]);
    const group = await alice.open(room.id);
    await alice.invite(group, [bob.account]);
    await world.settle();
    await bob.core.directory.refresh();
    await bob.sync();

    await alice.core.directory.addMembers(room.id, [carol.account]);
    await world.settle();
    await carol.core.directory.refresh();
    await carol.sync();

    await alice.core.conversation.send(room.id, 'welcome carol');
    await world.settle();
    expect(textsOf(carol.core, room.id)).toEqual(['welcome carol']);
    await world.close();
  });

  it('reports who actually holds the keys, not who is in the room', async () => {
    // They differ, and the difference is the architecture.
    const { world, alice, room } = await pair();
    const roster = await alice.core.directory.roster(room);
    expect(roster).toHaveLength(2);
    await world.close();
  });

  it('leaves, locally and at the server', async () => {
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    const room = await alice.core.directory.openGroupRoom([bob.account]);

    await bob.core.directory.refresh();
    expect(bob.core.directory.rooms().map((r) => r.id)).toContain(room.id);

    await bob.core.directory.leave(room.id);
    expect(bob.core.directory.rooms()).toEqual([]);
    await world.close();
  });
});

scenarios('the identity surface', () => {
  it('knows who it is, and what it is called', async () => {
    const { world, alice } = await pair();
    const me = await alice.core.identity.refreshAccount();
    expect(me).toMatchObject({ id: alice.account, handle: 'alice' });
    await world.close();
  });

  it('resolves somebody else by name', async () => {
    const { world, alice, bob } = await pair();
    expect((await alice.core.identity.resolve('bob')).id).toBe(bob.account);
    await world.close();
  });

  it('lists devices and signs one out', async () => {
    const world = await World.create();
    const laptop = await world.join('alice');
    const phone = await world.joinAs('alice-phone', laptop);

    const devices = await laptop.core.identity.devices();
    expect(devices).toHaveLength(2);

    await laptop.core.identity.revokeDevice(phone.device);
    const after = await laptop.core.identity.devices();
    expect(after.find((d) => d.pub === phone.device)?.revokedAt).toBeGreaterThan(0);
    await world.close();
  });

  it('updates a profile', async () => {
    const { world, alice } = await pair();
    const profile = await alice.core.identity.updateProfile({ displayName: 'Viola' });
    expect(profile.displayName).toBe('Viola');
    expect(alice.core.identity.account()).toMatchObject({ displayName: 'Viola' });
    await world.close();
  });
});
