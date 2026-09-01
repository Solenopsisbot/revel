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

  it('lets a member who was never committed in be repaired by anyone on sync', async () => {
    // The half an invite *link* needs and `inviteToSpace` does not: when a
    // person follows a link there is no inviter present to add their leaf, so
    // whoever syncs next has to notice and do it (`docs/03` §5).
    //
    // Simulated by putting the membership row in behind the client's back —
    // which is exactly what redeeming an invite does, and also exactly the
    // state an `inviteToSpace` whose commit failed used to leave behind
    // permanently.
    const { world, alice, bob } = await two();

    const space = await alice.core.directory.createSpace('Solexsis');
    const room = (await alice.core.directory.spaceRooms(space.id))[0]!;
    await world.settle();

    // Membership only — the raw HTTP call, without the commit `inviteToSpace`
    // wraps around it. So bob is a member and holds no keys.
    await alice.transport.inviteToSpace(space.id, [bob.account]);
    await world.settle();
    await bob.sync();
    await world.settle();

    await alice.core.conversation.send(room.id, 'before the repair');
    await world.settle();
    await bob.sync();
    await world.settle();
    expect(bob.texts(room.id)).toEqual([]);

    // Alice syncs. Nothing told her to do this and nothing knows bob is stuck.
    await alice.core.directory.refresh();
    await alice.core.directory.reconcileGroups();
    await world.settle();
    await bob.sync();
    await world.settle();

    await alice.core.conversation.send(room.id, 'after the repair');
    await world.settle();
    await bob.sync();
    await world.settle();

    // Only what was sent after his leaf existed. MLS keys move forward, so the
    // repair lets him in from now on and never retroactively.
    expect(bob.texts(room.id)).toEqual(['after the repair']);
    await world.close();
  });

  it('commits nothing when everybody is already in', async () => {
    // The reason it is safe to run on every client on every sync. `claim`
    // returns nothing for a device already in the group, so the steady state
    // is one request that changes no epoch.
    const { world, alice, bob } = await two();

    const space = await alice.core.directory.createSpace('Solexsis');
    await world.settle();
    await alice.core.directory.inviteToSpace(space.id, [bob.account]);
    await world.settle();
    await bob.sync();
    await world.settle();

    const before = world.handshakePosts;
    await alice.core.directory.reconcileGroups();
    await bob.core.directory.refresh();
    await bob.core.directory.reconcileGroups();
    await world.settle();
    expect(world.handshakePosts).toBe(before);
    await world.close();
  });

  it('lets somebody join by link and then actually read the room', async () => {
    // The whole point, end to end. `docs/06` phase 3's exit condition is a
    // friend group moving off Discord, and that means a link somebody pastes
    // in a chat — not "sign up and tell me your handle".
    //
    // Three steps, and only the first two are the Host's: the fragment proves
    // entitlement, the row is written, and then *a member* has to commit the
    // new leaf. Nobody is present to do it, so alice's next sync does.
    const { world, alice, bob } = await two();

    // She speaks as somebody, so there is a roster for bob to arrive to — and
    // so the assertion at the end is about the announcement rather than about
    // a harness that never had a face to announce.
    alice.face = { id: '1', name: 'Viola', colour: 'aqua' };

    const space = await alice.core.directory.createSpace('Solexsis');
    const room = (await alice.core.directory.spaceRooms(space.id))[0]!;
    await world.settle();
    await alice.core.conversation.send(room.id, 'said before he had the link');
    await world.settle();

    const { invite, secret } = await alice.core.directory.createInvite(space.id, { maxUses: 5 });
    // The Host got the public half and nothing else.
    expect(invite.pub).not.toBe(secret);

    // Bob follows it. He can see the link is real before joining, and what he
    // is told is deliberately almost nothing — the Host has never been given
    // the space's name.
    const preview = await bob.core.directory.previewInvite(invite.code);
    expect(preview).toMatchObject({ space: space.id, status: 'ok', members: 1 });
    expect(JSON.stringify(preview)).not.toContain('Solexsis');

    expect(await bob.core.directory.redeemInvite(invite.code, secret)).toMatchObject({
      space: space.id,
      joined: true,
    });
    await world.settle();

    // A row, and no keys. This is the state the architecture guarantees and
    // the one a client must not mistake for having joined.
    await bob.sync();
    await world.settle();
    expect(bob.texts(room.id)).toEqual([]);

    // Alice syncs — nothing told her bob exists — and repairs him in.
    await alice.core.directory.refresh();
    await alice.core.directory.reconcileGroups();
    await world.settle();
    await bob.sync();
    await world.settle();

    await alice.core.conversation.send(room.id, 'and now he can read');
    await world.settle();
    await bob.sync();
    await world.settle();

    // Only from his leaf onwards. The message from before the link is bytes he
    // holds no key for, which is the property working rather than a gap.
    expect(bob.texts(room.id)).toEqual(['and now he can read']);
    // And everything a newcomer cannot read for himself, because whoever
    // committed his leaf said it again: the space's name, and the roster.
    // Both were encrypted to epochs before he existed.
    expect(bob.rooms.state(room.id).spaceName).toBe('Solexsis');
    expect([...bob.rooms.state(room.id).faces.values()].length).toBeGreaterThan(0);
    await world.close();
  });

  it('refuses a link whose fragment is wrong, without spending it', async () => {
    const { world, alice, bob } = await two();
    const space = await alice.core.directory.createSpace('Solexsis');
    await world.settle();

    const { invite } = await alice.core.directory.createInvite(space.id, { maxUses: 1 });
    // Somebody else's fragment. Having the code is not having the link.
    const other = await alice.core.directory.createInvite(space.id);
    await expect(bob.core.directory.redeemInvite(invite.code, other.secret)).rejects.toThrow();

    // Still spendable, so a wrong signature cannot burn a link for everyone.
    expect((await alice.core.directory.listInvites(space.id))[0]?.uses).toBe(0);
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
