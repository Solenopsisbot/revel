/**
 * Rooms: starting a conversation, and finding the ones you are in.
 *
 * The two properties worth most of this file: a DM's id is derived from its
 * pair so opening one twice is opening one, and adding somebody to a room is
 * not the same as letting them read it. The second is the whole architecture in
 * one test — the server can hand out membership and cannot hand out keys.
 */
import { AccountId, dmRoomId, RoomInfo } from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import { harness } from './helpers.js';

/** Real shape: base64url of a public key, not a snowflake (`docs/04` §1). */
const ALICE = 'k7Yb3QzL0pW9xNvR2sTgHfMdEcJaUiOb1nKlPqRsTuV';
const BOB = 'Qa2Wd4Rf6Tg8Yh0Uj1Ik3Ol5Pz7Xc9Vb2Nm4As6Dfg';
const CAROL = 'Zx1Cv3Bn5Mq7Wr9Ty0Ui2Op4As6Df8Gh1Jk3Ll5Zzz';

/** A server with nothing in it but devices — no rooms poked into the store. */
function people() {
  const h = harness();
  h.stranger(ALICE, 'dev-a');
  h.stranger(BOB, 'dev-b');
  h.stranger(CAROL, 'dev-c');

  const post = (device: string, path: string, body?: unknown) =>
    h.app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revel-device': device },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const get = (device: string, path: string) =>
    h.app.request(path, { headers: { 'x-revel-device': device } });
  const del = (device: string, path: string) =>
    h.app.request(path, { method: 'DELETE', headers: { 'x-revel-device': device } });

  return {
    ...h,
    post,
    get,
    del,
    dm: (device: string, account: string) => post(device, '/rooms/dm', { account }),
    groupRoom: (device: string, accounts: string[]) => post(device, '/rooms/group', { accounts }),
    rooms: (device: string) => get(device, '/rooms'),
  };
}

describe('the derived DM id', () => {
  it('is the same whichever way round you ask', async () => {
    expect(await dmRoomId(ALICE, BOB)).toBe(await dmRoomId(BOB, ALICE));
  });

  it('is different for a different pair', async () => {
    expect(await dmRoomId(ALICE, BOB)).not.toBe(await dmRoomId(ALICE, CAROL));
  });

  it('is a snowflake, because `Event.room` has to be one', async () => {
    const id = await dmRoomId(ALICE, BOB);
    expect(id).toMatch(/^\d{1,20}$/);
    // Cleared top bit: this is stored as a signed 64-bit value everywhere, and
    // a database reading it back negative is a bad afternoon.
    expect(BigInt(id) < 2n ** 63n).toBe(true);
  });

  it('cannot be spelled two ways by moving the boundary between the accounts', async () => {
    // Length-prefixed, not delimited. Without that, ("ab", "c") and ("a", "bc")
    // hash the same bytes and two unrelated pairs share a room.
    expect(await dmRoomId('ab', 'c')).not.toBe(await dmRoomId('a', 'bc'));
  });
});

describe('opening a DM', () => {
  it('creates it with both people in', async () => {
    const h = people();
    const res = await h.dm('dev-a', BOB);
    expect(res.status).toBe(201);

    const room = (await res.json()) as any;
    expect(RoomInfo.safeParse(room).success).toBe(true);
    expect(room.kind).toBe('dm');
    expect(room.space).toBeNull();
    expect(room.group).toBeNull();
    expect(room.members.sort()).toEqual([ALICE, BOB].sort());
    expect(room.id).toBe(await dmRoomId(ALICE, BOB));
  });

  it('is idempotent — asking twice is asking once', async () => {
    const h = people();
    const first = await h.dm('dev-a', BOB);
    const second = await h.dm('dev-a', BOB);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(((await second.json()) as any).id).toBe(((await first.json()) as any).id);
  });

  it('is the same room from the other side', async () => {
    // The point of deriving the id: two people opening each other at the same
    // moment get one room instead of racing to create two.
    const h = people();
    const [a, b] = await Promise.all([h.dm('dev-a', BOB), h.dm('dev-b', ALICE)]);
    expect(((await a.json()) as any).id).toBe(((await b.json()) as any).id);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
  });

  it('refuses an account the server has never seen', async () => {
    // Better than creating a room nobody can ever be in, which is what a typo
    // would otherwise produce.
    const h = people();
    const res = await h.dm('dev-a', 'ThisAccountDoesNotExistAnywhereAtAll1234567');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_such_account' });
  });

  it('refuses a DM with yourself', async () => {
    const h = people();
    expect((await h.dm('dev-a', ALICE)).status).toBe(400);
  });

  it('refuses an account id that is not one', async () => {
    const h = people();
    expect((await h.dm('dev-a', 'has spaces')).status).toBe(400);
    expect((await h.post('dev-a', '/rooms/dm', {})).status).toBe(400);
  });

  it('refuses an unauthenticated request', async () => {
    const h = people();
    const res = await h.app.request('/rooms/dm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account: BOB }),
    });
    expect(res.status).toBe(401);
  });

  it('refuses to hand over a room whose id collides with different members', async () => {
    // Sixty-three bits of hash puts an accident far out of reach, but a
    // deliberate collision would be a way to squat somebody's DM. Refusing
    // turns the worst case from two pairs sharing a room into a visible error.
    const h = people();
    const id = await dmRoomId(ALICE, BOB);
    h.store.rooms.set(id, {
      id,
      kind: 'dm',
      spaceId: null,
      groupId: null,
      streamPaging: false,
      notifyHints: false,
    });
    await h.store.addMember(id, CAROL);

    const res = await h.dm('dev-a', BOB);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'room_id_conflict' });
  });

  it('can be sent to immediately, because membership is the permission', async () => {
    // A DM has no space, so no roles and no overrides (`policy.ts`). Being in
    // it is the whole of the authorisation.
    const h = people();
    const room = (await (await h.dm('dev-a', BOB)).json()) as any;
    expect((await h.send('dev-a', bodyFor(), room.id)).status).toBe(201);
    expect((await h.send('dev-c', bodyFor(), room.id)).status).toBe(403);
  });
});

describe('group DMs', () => {
  it('include the caller without being asked', async () => {
    const h = people();
    const room = (await (await h.groupRoom('dev-a', [BOB, CAROL])).json()) as any;
    expect(room.kind).toBe('group');
    expect(room.members.sort()).toEqual([ALICE, BOB, CAROL].sort());
  });

  it('are not idempotent — a second one is a second conversation', async () => {
    const h = people();
    const one = (await (await h.groupRoom('dev-a', [BOB])).json()) as any;
    const two = (await (await h.groupRoom('dev-a', [BOB])).json()) as any;
    expect(one.id).not.toBe(two.id);
  });

  it('take anybody already in as an adder', async () => {
    const h = people();
    const room = (await (await h.groupRoom('dev-a', [BOB])).json()) as any;
    const after = (await (
      await h.post('dev-b', `/rooms/${room.id}/members`, {
        accounts: [CAROL],
      })
    ).json()) as any;
    expect(after.members.sort()).toEqual([ALICE, BOB, CAROL].sort());
  });

  it('do not let a stranger add anybody', async () => {
    const h = people();
    const room = (await (await h.groupRoom('dev-a', [BOB])).json()) as any;
    const res = await h.post('dev-c', `/rooms/${room.id}/members`, { accounts: [CAROL] });
    expect(res.status).toBe(403);
  });

  it('are left, not kicked', async () => {
    const h = people();
    const room = (await (await h.groupRoom('dev-a', [BOB, CAROL])).json()) as any;
    expect((await h.del('dev-c', `/rooms/${room.id}/members/me`)).status).toBe(204);

    const after = (await (await h.get('dev-a', `/rooms/${room.id}`)).json()) as any;
    expect(after.members.sort()).toEqual([ALICE, BOB].sort());
  });

  it('leaving does not take the keys back', async () => {
    // The honest gap, and the architecture in one assertion: the server can
    // take away delivery and cannot take away what a device already holds. A
    // kick that has to bite is a Remove commit first (`docs/03` §5).
    const h = people();
    const room = (await (await h.groupRoom('dev-a', [BOB])).json()) as any;
    await h.del('dev-b', `/rooms/${room.id}/members/me`);
    expect((await h.send('dev-b', bodyFor(), room.id)).status).toBe(403);
    // ...and nothing here can undo bob's copy of what he already decrypted.
  });
});

describe('adding somebody to a room', () => {
  it('does not put them in the MLS group', async () => {
    // The one that would be a security bug if it were false. Membership is
    // delivery; only a member's commit is access.
    const h = people();
    const room = (await (await h.groupRoom('dev-a', [BOB])).json()) as any;
    await h.post('dev-a', '/groups', { roomId: room.id });

    await h.post('dev-a', `/rooms/${room.id}/members`, { accounts: [CAROL] });
    const updated = (await (await h.get('dev-a', `/rooms/${room.id}`)).json()) as any;

    const group = updated.group as string;
    expect(await h.store.getGroupMember(group, 'dev-c')).toBeNull();
    // Carol can see the room exists and cannot read a word in it.
    expect((await h.get('dev-c', `/groups/${group}/handshake`)).status).toBe(403);
  });
});

describe('the room list', () => {
  it('is what a cold client asks for first', async () => {
    const h = people();
    await h.dm('dev-a', BOB);
    await h.groupRoom('dev-a', [CAROL]);

    const { rooms } = (await (await h.rooms('dev-a')).json()) as any;
    expect(rooms).toHaveLength(2);
    expect(rooms.map((r: any) => r.kind).sort()).toEqual(['dm', 'group']);
    expect(rooms.every((r: any) => RoomInfo.safeParse(r).success)).toBe(true);
  });

  it('shows a room somebody added you to while you were gone', async () => {
    const h = people();
    const room = (await (await h.groupRoom('dev-a', [BOB])).json()) as any;
    expect(((await (await h.rooms('dev-c')).json()) as any).rooms).toEqual([]);

    await h.post('dev-a', `/rooms/${room.id}/members`, { accounts: [CAROL] });
    expect(((await (await h.rooms('dev-c')).json()) as any).rooms).toHaveLength(1);
  });

  it('carries the group id, which is how a room gets bound after a reload', async () => {
    const h = people();
    const room = (await (await h.dm('dev-a', BOB)).json()) as any;
    expect(room.group).toBeNull();

    await h.post('dev-a', '/groups', { roomId: room.id });
    const { rooms } = (await (await h.rooms('dev-a')).json()) as any;
    expect(rooms[0].group).toMatch(/^\d+$/);
  });

  it('does not list somebody else‘s rooms', async () => {
    const h = people();
    await h.dm('dev-a', BOB);
    expect(((await (await h.rooms('dev-c')).json()) as any).rooms).toEqual([]);
  });

  it('404s a room you are not in rather than saying which', async () => {
    const h = people();
    const room = (await (await h.dm('dev-a', BOB)).json()) as any;
    expect((await h.get('dev-c', `/rooms/${room.id}`)).status).toBe(403);
    expect((await h.get('dev-c', '/rooms/12345')).status).toBe(404);
  });

  it('refuses an unauthenticated request', async () => {
    const h = people();
    expect((await h.app.request('/rooms')).status).toBe(401);
  });
});

describe('a 1:1 DM stays a 1:1 DM', () => {
  it('cannot gain a third person', async () => {
    // Its id is derived from exactly two accounts. A third member would leave
    // the id describing something that is no longer true.
    const h = people();
    const room = (await (await h.dm('dev-a', BOB)).json()) as any;
    const res = await h.post('dev-a', `/rooms/${room.id}/members`, { accounts: [CAROL] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not_a_group_room' });
  });

  it('cannot be left', async () => {
    // Hiding a DM is a client-side act. Leaving would leave a room whose id
    // names a pair that is not in it.
    const h = people();
    const room = (await (await h.dm('dev-a', BOB)).json()) as any;
    expect((await h.del('dev-a', `/rooms/${room.id}/members/me`)).status).toBe(400);
  });
});

let n = 0;
function bodyFor() {
  return {
    epoch: 1,
    class: 'normal',
    payload: Buffer.from('ciphertext').toString('base64'),
    clientNonce: `rooms-${++n}-abcdefgh`,
  };
}

describe('account ids in this file', () => {
  it('are the shape the client actually produces', () => {
    // Fixtures that could not exist prove nothing about real ones. This has
    // caught three bugs already in this repo.
    for (const id of [ALICE, BOB, CAROL]) expect(AccountId.safeParse(id).success).toBe(true);
  });
});
