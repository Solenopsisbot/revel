/**
 * Spaces, with real MLS underneath.
 *
 * The server tests in `apps/server/test/spaces.test.ts` prove the policy: who
 * may create, who may grant, who is a 404 to whom. None of that touches
 * crypto. This is the other half — that the audience model actually produces
 * the groups it claims to, and that somebody invited to a space can *read*
 * rather than merely appear in a member list.
 *
 * The property the whole design rests on: **rooms sharing an audience share a
 * group**, so joining a space is one commit per audience rather than one per
 * room (`docs/03` §4).
 */
import { describe, expect, it } from 'vitest';
import { type Client, World, wasmBuilt } from './harness.js';

const scenarios = wasmBuilt ? describe : describe.skip;

async function two() {
  const world = await World.create();
  const alice = await world.join('alice');
  const bob = await world.join('bob');
  await bob.replenish();
  await alice.replenish();
  await world.settle();
  return { world, alice, bob };
}

scenarios('a space', () => {
  it('shares one group across every room with the same audience', async () => {
    const { world, alice } = await two();

    const space = await alice.core.directory.createSpace('Solexsis');
    const first = await alice.core.directory.createSpaceRoom(space.id);
    const second = await alice.core.directory.createSpaceRoom(space.id);
    await world.settle();

    // Both are "everyone in this space", so the second is handed the group the
    // first one made. Twelve rooms would still be one group.
    expect(first.group).toBeTruthy();
    expect(second.group).toBe(first.group);
    await world.close();
  });

  it('gives a role-gated room its own group, so it is private by construction', async () => {
    const { world, alice } = await two();

    const space = await alice.core.directory.createSpace('Solexsis');
    const open = await alice.core.directory.createSpaceRoom(space.id);
    const role = await alice.core.directory.createRole(space.id, { bits: '2' });
    const shut = await alice.core.directory.createSpaceRoom(space.id, {
      audience: { kind: 'roles', roles: [role.id] },
    });
    await world.settle();

    // Different audience, different group — and that is the *lock*, not the
    // policy. Somebody outside the role does not hold the keys, whatever the
    // server would or would not let them ask for.
    expect(shut.group).not.toBe(open.group);
    await world.close();
  });

  it('carries the space name to everybody in it, and never to the server', async () => {
    // `docs/04` §1 keeps names off the server, and a community's name is more
    // identifying than any one room's. So the space's name is an encrypted
    // event in the one audience every member is in.
    const { world, alice, bob } = await two();

    const space = await alice.core.directory.createSpace('Solexsis', 'violet');
    await world.settle();
    await alice.core.directory.inviteToSpace(space.id, [bob.account]);
    await world.settle();
    await bob.sync();
    await world.settle();

    const rooms = await bob.core.directory.spaceRooms(space.id);
    const general = rooms.find((r) => r.audience === 'everyone');
    await bob.core.conversation.open(general?.id as string);
    expect(bob.rooms.state(general?.id as string).spaceName).toBe('Solexsis');

    // And the Host has the event without knowing what it says.
    const stored = world.store.events.get(general?.id as string) ?? [];
    expect(stored.length).toBeGreaterThan(0);
    expect(JSON.stringify(stored)).not.toContain('Solexsis');
    await world.close();
  });

  it('lets somebody invited to a space actually read its rooms', async () => {
    // The half a membership row cannot do. `docs/03` §5: the server hands out
    // membership and cannot hand out keys, so an invite that stops at the
    // database is somebody who can see a room exists and not a word in it.
    const { world, alice, bob } = await two();

    const space = await alice.core.directory.createSpace('Solexsis');
    const room = await alice.core.directory.createSpaceRoom(space.id);
    await world.settle();

    await alice.core.directory.inviteToSpace(space.id, [bob.account]);
    await world.settle();
    await bob.sync();
    await world.settle();

    await alice.core.conversation.send(room.id, 'can you read this');
    await world.settle();
    await bob.sync();
    await world.settle();

    expect(bob.texts(room.id)).toEqual(['can you read this']);
    await world.close();
  });

  it('invites once per audience, not once per room', async () => {
    // The number this design exists for. Three rooms, one audience: bob is
    // committed into one group, and every one of the three opens for him.
    const { world, alice, bob } = await two();

    const space = await alice.core.directory.createSpace('Solexsis');
    const rooms: string[] = [];
    for (let i = 0; i < 3; i++) {
      rooms.push((await alice.core.directory.createSpaceRoom(space.id)).id);
    }
    await world.settle();

    const before = world.handshakePosts;
    await alice.core.directory.inviteToSpace(space.id, [bob.account]);
    await world.settle();
    const commits = world.handshakePosts - before;

    await bob.sync();
    await world.settle();
    for (const roomId of rooms) {
      await alice.core.conversation.send(roomId, `room ${roomId}`);
    }
    await world.settle();
    await bob.sync();
    await world.settle();

    expect(commits).toBe(1);
    for (const roomId of rooms) {
      expect(bob.texts(roomId)).toEqual([`room ${roomId}`]);
    }
    await world.close();
  });
});
