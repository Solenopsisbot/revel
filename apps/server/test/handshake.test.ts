/**
 * The handshake log, and the three things about it that are load-bearing:
 * its own sequence, the commit race, and Welcome delivery.
 *
 * Nothing here decrypts anything — the bytes are labels, because the server
 * never looks inside them. What is being tested is ordering, refusal and
 * routing, which is the entire job.
 */

import { PendingWelcome } from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import { SocketSession } from '../src/socket.js';
import { b64, body, EVERYONE, harness, unb64, wire } from './helpers.js';

/** A commit built from `epoch`. */
const commit = (epoch: number, over: Record<string, unknown> = {}) => ({
  kind: 'commit',
  epoch,
  bytes: b64(`commit@${epoch}`),
  ...over,
});

const proposal = (epoch: number) => ({ kind: 'proposal', epoch, bytes: b64(`proposal@${epoch}`) });

describe('opening a group', () => {
  it('binds it to the room with the caller as its only leaf', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const res = await h.createGroup('dev-a');
    expect(res.status).toBe(201);

    const info = (await res.json()) as any;
    expect(info).toMatchObject({ epoch: 0, pendingProposals: 0, size: 1 });
    expect(info.id).toMatch(/^\d+$/);
    expect((await h.store.getRoom('room1'))?.groupId).toBe(info.id);
  });

  it('refuses a room that already has one', async () => {
    // A room's group never changes. `docs/29` §1: changing ciphersuite means a
    // new group, not an upgraded one, and rebinding a room would strand every
    // event already sealed under the old keys.
    const h = harness();
    h.join('alice', 'dev-a');
    const group = await h.openGroup('dev-a');

    const res = await h.createGroup('dev-a');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_bound', group });
  });

  it('refuses a room the caller cannot read', async () => {
    const h = harness();
    h.stranger('mallory', 'dev-m');
    expect((await h.createGroup('dev-m')).status).toBe(403);
  });

  it('404s a room that does not exist', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    expect((await h.createGroup('dev-a', 'nope')).status).toBe(404);
  });

  it('refuses an unauthenticated request', async () => {
    const h = harness();
    const res = await h.app.request('/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomId: 'room1' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a request with no room', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const res = await h.app.request('/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revel-device': 'dev-a' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('names the rooms it opens, so a joiner knows what it just gained', async () => {
    // A Welcome carries a group id and nothing else. Without this a device that
    // has successfully joined has no idea which conversation it can now read.
    const h = harness();
    h.join('alice', 'dev-a');
    const group = await h.openGroup('dev-a');
    const info = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(info.rooms).toEqual(['room1']);
  });

  it('only names the rooms the asker may actually read', async () => {
    // A group can serve rooms a given member is not in — `docs/03` §4's
    // audiences are per-visibility, not per-room. Listing those would be a
    // directory of rooms somebody cannot open.
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    const group = await h.openGroup('dev-a');

    h.store.rooms.set('room2', {
      id: 'room2',
      spaceId: 'space1',
      groupId: group,
      streamPaging: false,
      notifyHints: false,
    });
    h.store.memberships.set('room2:alice', {
      roomId: 'room2',
      accountId: 'alice',
      roleIds: [EVERYONE],
    });

    await h.publish('dev-b', ['kp1']);
    await h.claim('dev-a', group, ['bob']);
    await h.handshake('dev-a', group, {
      ...commit(0, { added: ['dev-b'], welcome: { bytes: b64('w'), devices: ['dev-b'] } }),
    });

    const mine = (await (await h.groupInfo('dev-a', group)).json()) as any;
    const theirs = (await (await h.groupInfo('dev-b', group)).json()) as any;
    expect(mine.rooms.sort()).toEqual(['room1', 'room2']);
    expect(theirs.rooms).toEqual(['room1']);
  });

  it('hides the group from a device that is not in it', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    const group = await h.openGroup('dev-a');
    // Bob may read the room, and is still not in the group until a commit puts
    // him there. Entitlement is not membership.
    expect((await h.groupInfo('dev-b', group)).status).toBe(403);
  });
});

describe('the commit race', () => {
  /** Alice and Bob both in one group, both able to commit. */
  async function pair() {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    await h.publish('dev-b', ['kp1', 'kp2']);
    const group = await h.openGroup('dev-a');

    await h.claim('dev-a', group, ['bob']);
    const res = await h.handshake('dev-a', group, {
      ...commit(0, { added: ['dev-b'], welcome: { bytes: b64('welcome'), devices: ['dev-b'] } }),
    });
    expect(res.status).toBe(201);
    return { h, group };
  }

  it('accepts a commit and advances the epoch', async () => {
    const { h, group } = await pair();
    const res = await h.handshake('dev-a', group, commit(1));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ seq: 1, epoch: 2 });
  });

  it('refuses a commit built from a stale epoch, and says where the group is', async () => {
    // Everything the loser needs: it never applied its own commit, so it
    // clears what it staged, catches up on the log, and rebuilds. That is
    // exactly why `CryptoEngine.commit` does not apply what it builds.
    const { h, group } = await pair();
    await h.handshake('dev-a', group, commit(1));

    const res = await h.handshake('dev-b', group, commit(1));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'epoch_conflict', epoch: 2 });
  });

  it('lets exactly one of two simultaneous commits through', async () => {
    const { h, group } = await pair();
    const [a, b] = await Promise.all([
      h.handshake('dev-a', group, commit(1, { bytes: b64('from-alice') })),
      h.handshake('dev-b', group, commit(1, { bytes: b64('from-bob') })),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    // And the group moved exactly once. A fork here is unrepairable: both
    // devices reach an epoch the other never will, and every message after it
    // fails to decrypt for everyone, sender included.
    const info = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(info.epoch).toBe(2);

    const { records } = (await (await h.handshakeLog('dev-a', group, '?since=0')).json()) as any;
    expect(records).toHaveLength(1);
  });

  it('leaves the log untouched when a commit is refused', async () => {
    const { h, group } = await pair();
    await h.handshake('dev-a', group, commit(1));
    await h.handshake('dev-b', group, commit(1));

    const { records } = (await (await h.handshakeLog('dev-a', group)).json()) as any;
    expect(records.map((r: any) => r.seq)).toEqual([0, 1]);
  });

  it('refuses a commit from the future too, not just a stale one', async () => {
    const { h, group } = await pair();
    const res = await h.handshake('dev-a', group, commit(9));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ epoch: 1 });
  });
});

describe('proposals', () => {
  async function group() {
    const h = harness();
    h.join('alice', 'dev-a');
    return { h, group: await h.openGroup('dev-a') };
  }

  it('does not advance the epoch', async () => {
    const { h, group: g } = await group();
    expect((await h.handshake('dev-a', g, proposal(0))).status).toBe(201);

    const info = (await (await h.groupInfo('dev-a', g)).json()) as any;
    expect(info).toMatchObject({ epoch: 0, pendingProposals: 1 });
  });

  it('is refused at the wrong epoch, because a stale proposal is unusable', async () => {
    const { h, group: g } = await group();
    expect((await h.handshake('dev-a', g, proposal(3))).status).toBe(409);
  });

  it('is swept up by the next commit whether or not it was included', async () => {
    // The ones a commit missed are stale at the new epoch anyway, so leaving
    // them pending would mean a group that permanently believes it owes a
    // commit and nags its members forever.
    const { h, group: g } = await group();
    await h.handshake('dev-a', g, proposal(0));
    await h.handshake('dev-a', g, proposal(0));
    await h.handshake('dev-a', g, commit(0));

    const info = (await (await h.groupInfo('dev-a', g)).json()) as any;
    expect(info).toMatchObject({ epoch: 1, pendingProposals: 0 });
  });

  it('batches: `docs/03` §5 wants one commit for a mass change, not one each', async () => {
    const { h, group: g } = await group();
    for (let i = 0; i < 20; i++) await h.handshake('dev-a', g, proposal(0));
    await h.handshake('dev-a', g, commit(0));

    const info = (await (await h.groupInfo('dev-a', g)).json()) as any;
    expect(info.epoch).toBe(1);
  });
});

describe('the log', () => {
  async function group() {
    const h = harness();
    h.join('alice', 'dev-a');
    const g = await h.openGroup('dev-a');
    await h.handshake('dev-a', g, proposal(0));
    await h.handshake('dev-a', g, commit(0));
    await h.handshake('dev-a', g, commit(1));
    return { h, group: g };
  }

  it('is sequenced from zero and gapless', async () => {
    const { h, group: g } = await group();
    const { records } = (await (await h.handshakeLog('dev-a', g)).json()) as any;
    expect(records.map((r: any) => r.seq)).toEqual([0, 1, 2]);
    expect(records.map((r: any) => r.kind)).toEqual(['proposal', 'commit', 'commit']);
  });

  it('records the epoch each entry was built from, not the one it produced', async () => {
    const { h, group: g } = await group();
    const { records } = (await (await h.handshakeLog('dev-a', g)).json()) as any;
    expect(records.map((r: any) => r.epoch)).toEqual([0, 0, 1]);
  });

  it('names the device that sent it', async () => {
    const { h, group: g } = await group();
    const { records } = (await (await h.handshakeLog('dev-a', g)).json()) as any;
    expect(records.every((r: any) => r.sender === 'dev-a')).toBe(true);
  });

  it('returns the bytes untouched', async () => {
    const { h, group: g } = await group();
    const { records } = (await (await h.handshakeLog('dev-a', g)).json()) as any;
    expect(unb64(records[2].bytes)).toBe('commit@1');
  });

  it('catches up from a cursor, exclusive', async () => {
    const { h, group: g } = await group();
    const { records } = (await (await h.handshakeLog('dev-a', g, '?since=0')).json()) as any;
    expect(records.map((r: any) => r.seq)).toEqual([1, 2]);
  });

  it('returns nothing when the cursor is current', async () => {
    const { h, group: g } = await group();
    const { records } = (await (await h.handshakeLog('dev-a', g, '?since=2')).json()) as any;
    expect(records).toEqual([]);
  });

  it('honours a limit', async () => {
    const { h, group: g } = await group();
    const { records } = (await (await h.handshakeLog('dev-a', g, '?limit=2')).json()) as any;
    expect(records.map((r: any) => r.seq)).toEqual([0, 1]);
  });

  it('rejects a cursor that is not a number', async () => {
    const { h, group: g } = await group();
    expect((await h.handshakeLog('dev-a', g, '?since=banana')).status).toBe(400);
  });

  it('is closed to a device that is not in the group', async () => {
    const { h, group: g } = await group();
    h.join('bob', 'dev-b');
    expect((await h.handshakeLog('dev-b', g)).status).toBe(403);
    expect((await h.handshake('dev-b', g, commit(2))).status).toBe(403);
  });

  it('404s an unknown group', async () => {
    const { h } = await group();
    expect((await h.handshakeLog('dev-a', '999')).status).toBe(404);
  });

  it('rejects a malformed entry', async () => {
    const { h, group: g } = await group();
    expect(
      (await h.handshake('dev-a', g, { kind: 'nonsense', epoch: 2, bytes: b64('x') })).status,
    ).toBe(400);
    expect(
      (await h.handshake('dev-a', g, { kind: 'commit', epoch: -1, bytes: b64('x') })).status,
    ).toBe(400);
    expect(
      (await h.handshake('dev-a', g, { kind: 'commit', epoch: 2, bytes: 'not b64!' })).status,
    ).toBe(400);
  });
});

describe('membership, as the server tracks it for delivery', () => {
  async function trio() {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    await h.publish('dev-b', ['kp1', 'kp2']);
    const group = await h.openGroup('dev-a');
    await h.claim('dev-a', group, ['bob']);
    await h.handshake('dev-a', group, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-bob'), devices: ['dev-b'] },
      }),
    });
    return { h, group };
  }

  it('adds the devices a commit says it added', async () => {
    const { h, group } = await trio();
    expect((await h.store.getGroupMember(group, 'dev-b'))?.accountId).toBe('bob');
    const info = (await (await h.groupInfo('dev-b', group)).json()) as any;
    expect(info.size).toBe(2);
  });

  it('removes the ones it says it removed', async () => {
    const { h, group } = await trio();
    await h.handshake('dev-a', group, commit(1, { removed: ['dev-b'] }));
    expect(await h.store.getGroupMember(group, 'dev-b')).toBeNull();
    expect((await h.groupInfo('dev-b', group)).status).toBe(403);
  });

  it('rejects a commit that claims to add a device nobody has heard of', async () => {
    const { h, group } = await trio();
    const res = await h.handshake('dev-a', group, commit(1, { added: ['dev-ghost'] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_device' });
  });

  it('rejects a commit that claims to add a revoked device', async () => {
    const { h, group } = await trio();
    h.store.devices.set('dev-x', { pub: 'dev-x', accountId: 'carol', revokedAt: Date.now() });
    expect((await h.handshake('dev-a', group, commit(1, { added: ['dev-x'] }))).status).toBe(400);
  });

  it('fans a record out to the other members and not back to its sender', async () => {
    // The sender already has these bytes, and MLS refuses to process a commit
    // it built itself. A second tab on the same device misses this frame and
    // picks it up from `?since=` — which is what the sequence is for.
    const { h, group } = await trio();
    const alice = wire(h.hub, 'dev-a', 'alice');
    const bob = wire(h.hub, 'dev-b', 'bob');

    await h.handshake('dev-a', group, commit(1));
    expect(alice.ofOp('HANDSHAKE')).toHaveLength(0);
    expect(bob.ofOp('HANDSHAKE')).toHaveLength(1);
    expect(bob.ofOp('HANDSHAKE')[0].d).toMatchObject({ seq: 1, kind: 'commit', epoch: 1 });
  });

  it('does not fan out to a device that was just removed', async () => {
    const { h, group } = await trio();
    const bob = wire(h.hub, 'dev-b', 'bob');
    await h.handshake('dev-a', group, commit(1, { removed: ['dev-b'] }));
    // The removal itself is the last thing Bob is not told about: he learns he
    // is gone by failing to decrypt, which is the only signal that cannot lie.
    expect(bob.ofOp('HANDSHAKE')).toHaveLength(0);
  });
});

describe('leaving', () => {
  async function pairInGroup() {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    await h.publish('dev-b', ['kp1', 'kp2']);
    const group = await h.openGroup('dev-a');
    await h.claim('dev-a', group, ['bob']);
    await h.handshake('dev-a', group, {
      ...commit(0, { added: ['dev-b'], welcome: { bytes: b64('w'), devices: ['dev-b'] } }),
    });
    return { h, group };
  }

  const leave = (h: ReturnType<typeof harness>, device: string, group: string) =>
    h.app.request(`/groups/${group}/membership`, {
      method: 'DELETE',
      headers: { 'x-revel-device': device },
    });

  it('drops the device‘s own row', async () => {
    const { h, group } = await pairInGroup();
    expect((await leave(h, 'dev-b', group)).status).toBe(204);
    expect(await h.store.getGroupMember(group, 'dev-b')).toBeNull();
  });

  it('is what makes rejoining possible at all', async () => {
    // A claim skips devices the server already lists, so a stale row is a
    // person who can never be added back — the case a diverged session or a
    // removal lands in.
    const { h, group } = await pairInGroup();
    let claimed = (await (await h.claim('dev-a', group, ['bob'])).json()) as any;
    expect(claimed.missing).toEqual(['bob']);

    await leave(h, 'dev-b', group);
    claimed = (await (await h.claim('dev-a', group, ['bob'])).json()) as any;
    expect(claimed.claims).toHaveLength(1);
  });

  it('is not a removal — the leaf is not the server‘s to take', async () => {
    // The tree only ever changes through a commit signed by a member
    // (`docs/03` §5). All this clears is the delivery list.
    const { h, group } = await pairInGroup();
    const before = (await (await h.groupInfo('dev-a', group)).json()) as any;
    await leave(h, 'dev-b', group);
    const after = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(after.epoch).toBe(before.epoch);
  });

  it('cannot be done on somebody else‘s behalf', async () => {
    const { h, group } = await pairInGroup();
    await leave(h, 'dev-a', group);
    // Alice left her own row, not bob's.
    expect(await h.store.getGroupMember(group, 'dev-b')).not.toBeNull();
    expect(await h.store.getGroupMember(group, 'dev-a')).toBeNull();
  });

  it('throws away a Welcome that was still waiting', async () => {
    const { h, group } = await pairInGroup();
    expect(((await (await h.welcomes('dev-b')).json()) as any).welcomes).toHaveLength(1);
    await leave(h, 'dev-b', group);
    expect(((await (await h.welcomes('dev-b')).json()) as any).welcomes).toEqual([]);
  });

  it('is quiet about a group the device was never in', async () => {
    const { h, group } = await pairInGroup();
    h.join('carol', 'dev-c');
    expect((await leave(h, 'dev-c', group)).status).toBe(204);
  });

  it('refuses an unauthenticated request', async () => {
    const { h, group } = await pairInGroup();
    const res = await h.app.request(`/groups/${group}/membership`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

describe('welcomes', () => {
  async function invited() {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    await h.publish('dev-b', ['kp1', 'kp2']);
    const group = await h.openGroup('dev-a');
    await h.claim('dev-a', group, ['bob']);
    return { h, group };
  }

  it('is refused for a device nobody claimed a package for', async () => {
    // Otherwise any member could push arbitrary bytes at any device, which is
    // an unsolicited "you have been added to a group" from a stranger.
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    const group = await h.openGroup('dev-a');

    const res = await h.handshake('dev-a', group, {
      ...commit(0, { welcome: { bytes: b64('unsolicited'), devices: ['dev-b'] } }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'unclaimed_welcome', devices: ['dev-b'] });

    // And the group did not move. A refusal that half-applied would be worse
    // than the thing it refused.
    const info = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(info.epoch).toBe(0);
    const { records } = (await (await h.handshakeLog('dev-a', group)).json()) as any;
    expect(records).toEqual([]);
  });

  it('queues for a device that is offline', async () => {
    const { h, group } = await invited();
    await h.handshake('dev-a', group, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-bob'), devices: ['dev-b'] },
      }),
    });

    const { welcomes } = (await (await h.welcomes('dev-b')).json()) as any;
    expect(welcomes).toHaveLength(1);
    expect(unb64(welcomes[0].bytes)).toBe('welcome-bob');

    // Checked against the schema, not against a remembered field name. The
    // store's row calls this `groupId` and the wire calls it `group` — the
    // route maps between them, and asserting the shape by hand is how the wrong
    // one shipped in the first place.
    expect(PendingWelcome.safeParse(welcomes[0]).success).toBe(true);
    expect(welcomes[0].group).toBe(group);
  });

  it('is pushed straight at a device that is online', async () => {
    const { h, group } = await invited();
    const bob = wire(h.hub, 'dev-b', 'bob');

    await h.handshake('dev-a', group, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-bob'), devices: ['dev-b'] },
      }),
    });
    expect(bob.ofOp('WELCOME')).toHaveLength(1);
    expect(unb64(bob.ofOp('WELCOME')[0].d.bytes)).toBe('welcome-bob');
  });

  it('is served on the next connect', async () => {
    // `docs/03` §5. Being added to a group while your laptop was shut is not
    // something you should have to go looking for.
    const { h, group } = await invited();
    await h.handshake('dev-a', group, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-bob'), devices: ['dev-b'] },
      }),
    });

    const frames: any[] = [];
    const session = new SocketSession(
      { store: h.store, hub: h.hub },
      { accountId: 'bob', devicePub: 'dev-b' },
      (f) => frames.push(f),
    );
    await session.start();

    expect(frames[0].op).toBe('READY');
    expect(frames[1]).toMatchObject({ op: 'WELCOME', d: { group } });
  });

  it('is re-delivered until it is acknowledged', async () => {
    // At-least-once on purpose. A Welcome dropped the moment it is handed to a
    // socket is lost if that socket dies a millisecond later, and the failure
    // is silent on both sides: the invited device never learns it was invited,
    // and the inviter's client believes it worked.
    const { h, group } = await invited();
    await h.handshake('dev-a', group, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-bob'), devices: ['dev-b'] },
      }),
    });

    expect(((await (await h.welcomes('dev-b')).json()) as any).welcomes).toHaveLength(1);
    expect(((await (await h.welcomes('dev-b')).json()) as any).welcomes).toHaveLength(1);

    expect((await h.ackWelcome('dev-b', group)).status).toBe(204);
    expect(((await (await h.welcomes('dev-b')).json()) as any).welcomes).toEqual([]);
  });

  it('is dropped when the device is removed, or a removal would not stick', async () => {
    const { h, group } = await invited();
    await h.handshake('dev-a', group, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-bob'), devices: ['dev-b'] },
      }),
    });
    await h.handshake('dev-a', group, commit(1, { removed: ['dev-b'] }));

    const { welcomes } = (await (await h.welcomes('dev-b')).json()) as any;
    expect(welcomes).toEqual([]);
  });

  it('only drops the removing group‘s, not every group‘s', async () => {
    const { h, group } = await invited();
    await h.handshake('dev-a', group, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-one'), devices: ['dev-b'] },
      }),
    });
    // A second room, a second group, the same person invited to both.
    h.store.rooms.set('room2', {
      id: 'room2',
      spaceId: 'space1',
      groupId: null,
      streamPaging: false,
      notifyHints: false,
    });
    h.store.memberships.set('room2:alice', {
      roomId: 'room2',
      accountId: 'alice',
      roleIds: ['role-everyone'],
    });
    h.store.memberships.set('room2:bob', {
      roomId: 'room2',
      accountId: 'bob',
      roleIds: ['role-everyone'],
    });
    const other = await h.openGroup('dev-a', 'room2');
    await h.claim('dev-a', other, ['bob']);
    await h.handshake('dev-a', other, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-two'), devices: ['dev-b'] },
      }),
    });

    await h.handshake('dev-a', group, commit(1, { removed: ['dev-b'] }));

    const { welcomes } = (await (await h.welcomes('dev-b')).json()) as any;
    expect(welcomes.map((w: any) => unb64(w.bytes))).toEqual(['welcome-two']);
  });

  it('consumes the claim, so a second welcome needs a second claim', async () => {
    const { h, group } = await invited();
    await h.handshake('dev-a', group, {
      ...commit(0, {
        added: ['dev-b'],
        welcome: { bytes: b64('welcome-bob'), devices: ['dev-b'] },
      }),
    });
    expect(await h.store.hasClaim(group, 'dev-b')).toBe(false);

    const res = await h.handshake('dev-a', group, {
      ...commit(1, { welcome: { bytes: b64('again'), devices: ['dev-b'] } }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses an unauthenticated read', async () => {
    const { h } = await invited();
    expect((await h.app.request('/welcomes')).status).toBe(401);
  });
});

describe('the ratchet tree, out of band', () => {
  async function group() {
    const h = harness();
    h.join('alice', 'dev-a');
    return { h, group: await h.openGroup('dev-a') };
  }

  it('round-trips', async () => {
    const { h, group: g } = await group();
    expect((await h.putTree('dev-a', g, 1, 'tree@1')).status).toBe(204);

    const res = await h.getTree('dev-a', g);
    expect(res.status).toBe(200);
    const tree = (await res.json()) as any;
    expect(tree.epoch).toBe(1);
    expect(unb64(tree.tree)).toBe('tree@1');
  });

  it('is published by the commit that produced it, in the same request', async () => {
    // Separately would be a race. The server publishes the Welcome the instant
    // it accepts a commit, so a joiner that got there between two requests
    // would fetch the previous epoch's tree and fail to join.
    const { h, group: g } = await group();
    await h.handshake('dev-a', g, commit(0, { tree: b64('tree@1') }));

    const tree = (await (await h.getTree('dev-a', g)).json()) as any;
    expect(tree.epoch).toBe(1);
    expect(unb64(tree.tree)).toBe('tree@1');
  });

  it('is not written when the commit is refused', async () => {
    const { h, group: g } = await group();
    await h.handshake('dev-a', g, commit(0, { tree: b64('tree@1') }));
    await h.handshake('dev-a', g, commit(0, { tree: b64('never') }));

    const tree = (await (await h.getTree('dev-a', g)).json()) as any;
    expect(unb64(tree.tree)).toBe('tree@1');
  });

  it('404s before anything is published', async () => {
    const { h, group: g } = await group();
    expect((await h.getTree('dev-a', g)).status).toBe(404);
  });

  it('never goes backwards', async () => {
    // A retried request carrying an older tree would hand joiners a tree that
    // does not match the epoch their Welcome is for, and the join just fails.
    const { h, group: g } = await group();
    await h.putTree('dev-a', g, 5, 'tree@5');
    await h.putTree('dev-a', g, 2, 'tree@2');

    const tree = (await (await h.getTree('dev-a', g)).json()) as any;
    expect(unb64(tree.tree)).toBe('tree@5');
  });

  it('is closed to non-members in both directions', async () => {
    const { h, group: g } = await group();
    h.join('bob', 'dev-b');
    expect((await h.getTree('dev-b', g)).status).toBe(403);
    expect((await h.putTree('dev-b', g, 1, 'forged')).status).toBe(403);
  });

  it('rejects a malformed tree', async () => {
    const { h, group: g } = await group();
    const res = await h.app.request(`/groups/${g}/tree`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-revel-device': 'dev-a' },
      body: JSON.stringify({ epoch: 1, tree: 'not base64!' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('the designated committer', () => {
  /** Alice and Bob in one group, Bob added most recently. */
  async function pair() {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    await h.publish('dev-b', ['kp1']);
    const group = await h.openGroup('dev-a');
    await h.claim('dev-a', group, ['bob']);
    await h.handshake('dev-a', group, {
      ...commit(0, { added: ['dev-b'], welcome: { bytes: b64('w'), devices: ['dev-b'] } }),
    });
    return { h, group };
  }

  it('is nobody when nobody is online', async () => {
    // Derived, never stored. A `designated_committer_device` column goes stale
    // the moment that laptop shuts, and a nudge sent into the void is a group
    // that quietly stops committing.
    const { h, group } = await pair();
    const info = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(info.committer).toBeNull();
  });

  it('is the online member that acted most recently', async () => {
    const { h, group } = await pair();
    wire(h.hub, 'dev-a', 'alice');
    wire(h.hub, 'dev-b', 'bob');

    await h.store.touchGroupMember(group, 'dev-a', 1000);
    await h.store.touchGroupMember(group, 'dev-b', 2000);
    let info = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(info.committer).toBe('dev-b');

    await h.store.touchGroupMember(group, 'dev-a', 3000);
    info = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(info.committer).toBe('dev-a');
  });

  it('falls back past a member who is offline', async () => {
    const { h, group } = await pair();
    await h.store.touchGroupMember(group, 'dev-b', 9999);
    wire(h.hub, 'dev-a', 'alice');
    const info = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(info.committer).toBe('dev-a');
  });

  it('is nudged when a proposal lands', async () => {
    const { h, group } = await pair();
    const bob = wire(h.hub, 'dev-b', 'bob');
    await h.store.touchGroupMember(group, 'dev-b', Date.now() + 1000);

    await h.handshake('dev-a', group, proposal(1));
    const nudges = bob.ofOp('COMMIT_REQUESTED');
    expect(nudges).toHaveLength(1);
    expect(nudges[0].d.group).toBe(group);
    expect(nudges[0].d.deadline).toBeGreaterThan(Date.now());
  });

  it('is not nudged when there is nothing pending', async () => {
    const { h, group } = await pair();
    const bob = wire(h.hub, 'dev-b', 'bob');
    await h.handshake('dev-a', group, commit(1));
    expect(bob.ofOp('COMMIT_REQUESTED')).toHaveLength(0);
  });

  it('becomes whoever just sent an event', async () => {
    // `docs/03` §5: "the online device of the group that most recently sent an
    // event. The Host tracks this trivially." This is the tracking.
    const { h, group } = await pair();
    wire(h.hub, 'dev-a', 'alice');
    wire(h.hub, 'dev-b', 'bob');
    // Alice was the most recent until now. Timestamps are server-assigned, so
    // "now" always beats whatever is on record.
    await h.store.touchGroupMember(group, 'dev-a', Date.now() - 1000);
    await h.store.touchGroupMember(group, 'dev-b', Date.now() - 5000);
    expect(((await (await h.groupInfo('dev-a', group)).json()) as any).committer).toBe('dev-a');

    expect((await h.send('dev-b', body())).status).toBe(201);
    const info = (await (await h.groupInfo('dev-a', group)).json()) as any;
    expect(info.committer).toBe('dev-b');
  });

  it('is nudged by the same send, because sending proves the device is awake', async () => {
    const { h, group } = await pair();
    const bob = wire(h.hub, 'dev-b', 'bob');
    await h.handshake('dev-a', group, proposal(1));
    bob.frames.length = 0;

    await h.send('dev-b', body());
    expect(bob.ofOp('COMMIT_REQUESTED')).toHaveLength(1);
  });
});
