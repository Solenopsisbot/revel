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
    const role = await alice.core.directory.createRole(space.id, { name: 'Mods', bits: '2' });
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

  it('names its rooms and its roles in the ciphertext, never on the Host', async () => {
    // Same argument as the space's own name, one level down. The Host holds a
    // role's bits because it enforces them (`docs/04` §1 — "bitfield per
    // role") and has no business knowing that the bundle is called "Mods".
    const { world, alice, bob } = await two();

    // The `#general` a space arrives with — the one every member is in, and
    // therefore the one that carries what the space is called.
    const space = await alice.core.directory.createSpace('Solexsis');
    const general = (await alice.core.directory.spaceRooms(space.id))[0]!;
    await alice.core.directory.createRole(space.id, { name: 'Mods', colour: 'rose', bits: '2' });
    await world.settle();

    await alice.core.directory.inviteToSpace(space.id, [bob.account]);
    await world.settle();
    await bob.sync();
    await world.settle();

    await bob.core.conversation.open(general.id);
    const seen = bob.rooms.state(general.id);
    expect(seen.name).toBe('general');
    expect([...seen.spaceRoles.values()]).toEqual([{ name: 'Mods', colour: 'rose' }]);

    // The role exists on the Host with its bits, and with no name anywhere.
    const roles = await bob.core.directory.spaceRoles(space.id);
    expect(roles.map((r) => r.bits)).toContain('2');
    expect(JSON.stringify(world.store.events.get(general.id) ?? [])).not.toContain('Mods');
    await world.close();
  });

  it('stops naming a role once it is deleted', async () => {
    // `space.roles` is whole-list last-writer-wins precisely so this needs no
    // tombstone: the newest list simply does not mention it.
    const { world, alice } = await two();

    const space = await alice.core.directory.createSpace('Solexsis');
    const general = (await alice.core.directory.spaceRooms(space.id))[0]!;
    const role = await alice.core.directory.createRole(space.id, { name: 'Mods', bits: '2' });
    await world.settle();
    expect(alice.rooms.state(general.id).spaceRoles.get(role.id)?.name).toBe('Mods');

    await alice.core.directory.deleteRole(space.id, role.id);
    await world.settle();
    expect(alice.rooms.state(general.id).spaceRoles.has(role.id)).toBe(false);
    await world.close();
  });

  it('takes the keys back when somebody is removed, not just the membership row', async () => {
    // The half the server cannot do (`docs/03` §5). A kick that only deletes a
    // row leaves somebody reading every message their client is still handed.
    const { world, alice, bob } = await two();

    const space = await alice.core.directory.createSpace('Solexsis');
    const room = (await alice.core.directory.spaceRooms(space.id))[0]!;
    await world.settle();
    await alice.core.directory.inviteToSpace(space.id, [bob.account]);
    await world.settle();
    await bob.sync();
    await world.settle();

    await alice.core.conversation.send(room.id, 'before');
    await world.settle();
    await bob.sync();
    await world.settle();
    expect(bob.texts(room.id)).toEqual(['before']);

    await alice.core.directory.removeFromSpace(space.id, bob.account);
    await world.settle();
    await alice.core.conversation.send(room.id, 'after');
    await world.settle();
    await bob.sync();
    await world.settle();

    // Still 'before'. The epoch moved past him, so 'after' is bytes he holds
    // no key for — which is the point, and is not something a row could do.
    expect(bob.texts(room.id)).toEqual(['before']);
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
