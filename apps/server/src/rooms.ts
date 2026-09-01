/**
 * Rooms: how a conversation starts, and how a client finds the ones it is in.
 *
 * `docs/04` §5's `/rooms`. Until this existed the server could carry a
 * conversation perfectly well and there was no way to begin one — every room in
 * every test was poked straight into the store — and a client that reloaded had
 * no way to discover what it was a member of except its own local copy, which
 * is exactly the thing a reload is supposed to be able to lose.
 *
 * Spaces are not here — they are in `spaces.ts`, and the split is deliberate.
 * A room in a space is reached through its space, because that is where the
 * permission check lives: everything in this file is a room with no space and
 * an explicit-list audience (`docs/03` §4), where membership *is* the policy
 * and there are no roles to resolve against.
 */
import {
  CreateDm,
  CreateGroupRoom,
  dmRoomId,
  type RoomInfo,
  RoomMembersInput,
  type SnowflakeFactory,
} from '@revel/protocol';
import type { Hono } from 'hono';
import { resolveAddress } from './accounts.js';
import { type Actor, canRead } from './policy.js';
import type { Room, Store } from './store/types.js';

export interface RoomDeps {
  store: Store;
  ids: SnowflakeFactory;
  /** For resolving a handle in `POST /rooms/dm`. */
  idp: string;
  authenticate(req: Request): Promise<Actor | null>;
}

export function mountRooms(app: Hono, deps: RoomDeps): void {
  /**
   * Every room this account is in.
   *
   * The first thing a cold client asks for. `docs/29` §5 budgets 300 ms to a
   * painted room from *local* state, so this is not on that path — it is how a
   * client learns about a room it has never seen, or one it was added to while
   * it was gone.
   */
  app.get('/rooms', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const rooms: RoomInfo[] = [];
    for (const room of await deps.store.listAccountRooms(actor.accountId)) {
      rooms.push(await describe(deps.store, room));
    }
    return c.json({ rooms });
  });

  app.get('/rooms/:id', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const roomId = c.req.param('id');
    const denial = await canRead(deps.store, roomId, actor);
    if (denial) return c.json({ error: denial }, denial === 'no_such_room' ? 404 : 403);

    const room = await deps.store.getRoom(roomId);
    return room ? c.json(await describe(deps.store, room)) : c.json({ error: 'no_such_room' }, 404);
  });

  /**
   * Open a DM. Idempotent, because the id is derived from the pair.
   *
   * Two people opening each other at the same instant get one room rather than
   * racing to create two, and a client can name the room before it exists —
   * which is what makes a DM deep link resolve without a round trip.
   */
  app.post('/rooms/dm', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const parsed = CreateDm.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    // By key or by name. The name is the point of handles existing, and the key
    // stays available because a handle can be given up and taken by somebody
    // else while a key cannot (`docs/17`).
    let other: string;
    if (parsed.data.account) {
      other = parsed.data.account;
    } else {
      const resolved = await resolveAddress(deps, parsed.data.address as string);
      if ('error' in resolved) {
        return c.json({ error: resolved.error }, resolved.error === 'foreign_idp' ? 501 : 404);
      }
      other = resolved.id;
    }

    // A DM with yourself is a note to self, which is a real feature and not
    // this one: it would be a room with a single-account audience and a
    // derived id that collides with nothing, so it needs its own kind.
    if (other === actor.accountId) return c.json({ error: 'cannot_dm_yourself' }, 400);
    if (!(await deps.store.accountExists(other))) return c.json({ error: 'no_such_account' }, 404);

    const id = await dmRoomId(actor.accountId, other);
    const members = [actor.accountId, other];
    const { room, created } = await deps.store.createRoom(
      { id, kind: 'dm', spaceId: null, groupId: null, streamPaging: false, notifyHints: false },
      members,
    );

    // The id is sixty-three bits of hash, so a collision is far past accident —
    // but a *deliberate* one would be a way to squat somebody's DM. Refusing
    // here turns the worst case from two pairs sharing a room into an error
    // somebody can report.
    const existing = await deps.store.listRoomMembers(id);
    const same =
      existing.length === members.length &&
      members.every((m) => existing.some((e) => e.accountId === m));
    if (!same) return c.json({ error: 'room_id_conflict' }, 409);

    return c.json(await describe(deps.store, room), created ? 201 : 200);
  });

  /**
   * Open a group DM.
   *
   * Not idempotent, deliberately: two group DMs with the same people are two
   * different conversations, which is what somebody starting a second one
   * means by it.
   */
  app.post('/rooms/group', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const parsed = CreateGroupRoom.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const members = [...new Set([actor.accountId, ...parsed.data.accounts])];
    for (const account of members) {
      if (!(await deps.store.accountExists(account))) {
        return c.json({ error: 'no_such_account', account }, 404);
      }
    }

    const { room } = await deps.store.createRoom(
      {
        id: deps.ids.next(),
        kind: 'group',
        spaceId: null,
        groupId: null,
        streamPaging: false,
        notifyHints: false,
      },
      members,
    );
    return c.json(await describe(deps.store, room), 201);
  });

  /**
   * Add people to a group DM.
   *
   * Any member may, which is how group DMs work everywhere and the only rule
   * available without roles. Adding somebody to the *room* does not put them in
   * the MLS group — a member's client has to commit them in (`docs/03` §5), and
   * until it does the new member can see that the room exists and not a word in
   * it. That gap is the honest one: the server cannot hand out keys.
   */
  app.post('/rooms/:id/members', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const roomId = c.req.param('id');
    const denial = await canRead(deps.store, roomId, actor);
    if (denial) return c.json({ error: denial }, denial === 'no_such_room' ? 404 : 403);

    const room = await deps.store.getRoom(roomId);
    if (room?.kind !== 'group') return c.json({ error: 'not_a_group_room' }, 400);

    const parsed = RoomMembersInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    for (const account of parsed.data.accounts) {
      if (!(await deps.store.accountExists(account))) {
        return c.json({ error: 'no_such_account', account }, 404);
      }
    }
    for (const account of parsed.data.accounts) await deps.store.addMember(roomId, account);

    return c.json(await describe(deps.store, room));
  });

  /**
   * Leave a room. Yourself only.
   *
   * Leaving does not remove your MLS leaf. A member has to commit that away,
   * and until one does you can still decrypt what arrives — which is why the
   * client calls `GroupSync.leave` alongside this, and why a kick that has to
   * be immediate is a Remove first and a membership row second.
   */
  app.delete('/rooms/:id/members/me', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const roomId = c.req.param('id');
    const room = await deps.store.getRoom(roomId);
    if (!room) return c.json({ error: 'no_such_room' }, 404);
    // A 1:1 DM has exactly two members by construction and its id says so.
    // Leaving one would leave a room whose id describes a pair that is not in
    // it; hiding a DM is a client-side act, not a membership change.
    if (room.kind === 'dm') return c.json({ error: 'cannot_leave_a_dm' }, 400);

    await deps.store.removeMember(roomId, actor.accountId);
    return c.body(null, 204);
  });

  /**
   * Remove somebody else from a group DM. Any member may.
   *
   * **Decided, and the reasoning is the crypto rather than the product.** MLS
   * lets any member commit a Remove; the server cannot prevent that and has no
   * way to know it happened. So a rule like "only the creator may" is one the
   * server can enforce on *its* membership table and nowhere else — and when
   * the two disagree the person is still listed in the room while no longer
   * able to decrypt a word in it. A dead room with no explanation is a worse
   * outcome than the thing the rule was trying to prevent.
   *
   * Matching what the crypto already permits is the only arrangement where
   * "who is in this room" has one answer. It does mean any member can eject
   * any other, which is a real griefing surface — but it is one that exists
   * with or without this route. The choice is only whether it happens as a
   * supported action or as a mysterious loss of access.
   *
   * Group DMs only. A 1:1 DM has exactly two members by construction and its
   * id says which two; removing one would leave a room whose id describes a
   * pair that is not in it.
   *
   * **Still open: attribution.** Nothing marks *who* removed somebody, because
   * the server cannot write into the ciphertext and `docs/04` deliberately has
   * no timeline row for a membership change ("there is no row for 'the
   * membership changed' in a timeline the server cannot see"). Making a
   * removal visible needs an encrypted event the removing client sends, which
   * is a protocol addition rather than a route.
   *
   * Registered *after* `members/me` on purpose: Hono matches in registration
   * order, and a parameterised segment declared first swallows the literal one
   * — `me` arrives as an account id that is not a member, and leaving a room
   * answers 404.
   */
  app.delete('/rooms/:id/members/:account', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const roomId = c.req.param('id');
    const denial = await canRead(deps.store, roomId, actor);
    if (denial) return c.json({ error: denial }, denial === 'no_such_room' ? 404 : 403);

    const room = await deps.store.getRoom(roomId);
    if (room?.kind !== 'group') return c.json({ error: 'not_a_group_room' }, 400);

    // Removing yourself is `members/me`, which has its own rules — it does not
    // require the room to still have anyone else in it, and this does.
    const target = c.req.param('account');
    if (target === actor.accountId) return c.json({ error: 'use_leave' }, 400);

    const members = await deps.store.listRoomMembers(roomId);
    if (!members.some((m) => m.accountId === target)) {
      return c.json({ error: 'not_a_member' }, 404);
    }

    await deps.store.removeMember(roomId, target);
    return c.body(null, 204);
  });
}

async function describe(store: Store, room: Room): Promise<RoomInfo> {
  const members = await store.listRoomMembers(room.id);
  return {
    id: room.id,
    kind: room.kind,
    space: room.spaceId,
    group: room.groupId,
    members: members.map((m) => m.accountId),
    streamPaging: room.streamPaging,
    notifyHints: room.notifyHints,
  };
}
