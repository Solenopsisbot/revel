/**
 * Spaces: creating one, who is in it, and what they may do.
 *
 * `docs/06` phase 3. The permission model this leans on shipped in phase 2 and
 * had nothing above it that could make a space to use it — `resolve()` has been
 * running on every event since, over tables nothing wrote to.
 *
 * Two rules run through everything here:
 *
 * 1. **The server is the policy authority and not the confidentiality
 *    boundary.** Every check below decides who may *ask*; who may *read* is the
 *    MLS group, and a member the server forgets to remove can still decrypt
 *    until somebody commits them out (`docs/03` §4). Nothing here should ever
 *    be described to a person as making something private.
 * 2. **Hierarchy is enforced and explained.** You cannot grant what you do not
 *    hold, and the refusal names the missing permission rather than greying out
 *    mysteriously (`docs/18`).
 */
import {
  audienceKey,
  CreateSpace,
  CreateSpaceRoom,
  canGrant,
  CreateInvite,
  DEFAULT_EVERYONE,
  fromBase64,
  has,
  MemberRolesInput,
  Permission,
  parse,
  type RoleInfo,
  RedeemInvite,
  RoleInput,
  type SnowflakeFactory,
  type SpaceInfo,
  SpaceMembersInput,
  serialize,
  verifyInviteRedemption,
} from '@revel/protocol';
import type { Hono } from 'hono';
import { type Actor, canRead, spacePermissionsFor } from './policy.js';
import type { Invite, Store } from './store/types.js';

export interface SpaceDeps {
  store: Store;
  ids: SnowflakeFactory;
  authenticate(req: Request): Promise<Actor | null>;
}

export function mountSpaces(app: Hono, deps: SpaceDeps): void {
  /** The space, plus what *you* may do in it — so the client gates on the same numbers. */
  async function describe(spaceId: string, accountId: string): Promise<SpaceInfo | null> {
    const [space, bits, owner] = await Promise.all([
      deps.store.getSpace(spaceId),
      spacePermissionsFor(deps.store, spaceId, accountId),
      deps.store.isOwner(spaceId, accountId),
    ]);
    if (!space || bits === null) return null;
    return {
      id: space.id,
      visibility: space.visibility as SpaceInfo['visibility'],
      owner,
      permissions: serialize(bits),
    };
  }

  /** Every check in this file starts here: are you in it, and what do you hold? */
  async function gate(
    req: Request,
    spaceId: string,
    needed?: bigint,
  ): Promise<{ actor: Actor; bits: bigint } | { error: string; status: 401 | 403 | 404 }> {
    const actor = await deps.authenticate(req);
    if (!actor) return { error: 'unauthenticated', status: 401 };
    if (!(await deps.store.getSpace(spaceId))) return { error: 'no_such_space', status: 404 };

    const bits = await spacePermissionsFor(deps.store, spaceId, actor.accountId);
    // Not a member is a 404, not a 403. A space you are not in should not be
    // distinguishable from one that does not exist, or membership of every
    // private space on a Host is enumerable by anybody with an account.
    if (bits === null) return { error: 'no_such_space', status: 404 };
    if (needed !== undefined && !has(bits, needed)) {
      return { error: 'missing_permission', status: 403 };
    }
    return { actor, bits };
  }

  // -- the space itself ------------------------------------------------------

  app.post('/spaces', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const parsed = CreateSpace.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    // No cap. A space is four rows until somebody puts a room in it, and a
    // limit here would be a number invented to look responsible.
    const id = deps.ids.next();
    await deps.store.createSpace({
      id,
      owner: actor.accountId,
      everyoneBits: serialize(DEFAULT_EVERYONE),
    });
    return c.json(await describe(id, actor.accountId), 201);
  });

  app.get('/spaces', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const spaces = await deps.store.listAccountSpaces(actor.accountId);
    const out = [];
    for (const space of spaces) {
      const info = await describe(space.id, actor.accountId);
      if (info) out.push(info);
    }
    return c.json({ spaces: out });
  });

  app.get('/spaces/:id', async (c) => {
    const gated = await gate(c.req.raw, c.req.param('id'));
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);
    return c.json(await describe(c.req.param('id'), gated.actor.accountId));
  });

  // -- rooms -----------------------------------------------------------------

  app.get('/spaces/:id/rooms', async (c) => {
    const gated = await gate(c.req.raw, c.req.param('id'));
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    // Filtered by the same read check a fetch of the room would make, which is
    // what `docs/03` §4 means by an audience: a room you have no audience for
    // is a room you never learn exists. Unfiltered, being in a space was enough
    // to enumerate its moderator-only rooms by name — no contents, since those
    // are keys nobody can hand over, but their existence, their ids, and a
    // handle to ask the event log about.
    //
    // `GET /groups/:id` already filters its own room list exactly this way.
    // This is the same rule, applied where somebody actually goes looking.
    const rooms = [];
    for (const room of await deps.store.listSpaceRooms(c.req.param('id'))) {
      if (await canRead(deps.store, room.id, gated.actor)) continue;
      rooms.push(room);
    }

    return c.json({
      rooms: rooms.map((r) => ({
        id: r.id,
        kind: r.kind,
        space: r.spaceId,
        group: r.groupId,
        audience: r.audience ?? undefined,
        streamPaging: r.streamPaging,
        notifyHints: r.notifyHints,
      })),
    });
  });

  app.post('/spaces/:id/rooms', async (c) => {
    const spaceId = c.req.param('id');
    const gated = await gate(c.req.raw, spaceId, Permission.MANAGE_ROOMS);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const parsed = CreateSpaceRoom.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const audience = parsed.data.audience ?? { kind: 'everyone' as const };

    // A role-gated room can only name roles that exist, or its audience is a
    // rule nobody can ever match and the room is unreachable by construction.
    if (audience.kind === 'roles') {
      const known = new Set((await deps.store.listRoles(spaceId)).map((r) => r.id));
      const missing = audience.roles.filter((r) => !known.has(r));
      if (missing.length) return c.json({ error: 'no_such_role', roles: missing }, 400);
    }

    // The audience decides the group, not the room. Rooms whose audience is
    // "everyone in this space" share one, so joining a twelve-room space is one
    // commit rather than twelve (`docs/03` §4).
    const key = audienceKey(audience);
    const groupId = await deps.store.groupForAudience(spaceId, key);

    const room = {
      id: deps.ids.next(),
      kind: 'space' as const,
      spaceId,
      // Null when this audience has no group yet: a member's client creates it
      // and binds it, because the server cannot make an MLS group — it has no
      // keys and never will.
      groupId,
      streamPaging: parsed.data.streamPaging ?? false,
      notifyHints: parsed.data.notifyHints ?? false,
      // Recorded, not recomputed later. When a client creates the group for
      // this room, the server has to know which audience that group serves
      // before a sibling room can reuse it.
      audience: key,
    };

    // Everyone in the space is a member of an `everyone` room. A narrower
    // audience is delivered to the accounts it names; role-gated membership is
    // recomputed whenever roles change.
    const audienceMembers =
      audience.kind === 'list'
        ? audience.accounts
        : (await deps.store.listSpaceMembers(spaceId))
            .filter((m) => audience.kind === 'everyone' || holdsAny(m.roleIds, audience.roles))
            .map((m) => m.accountId);

    // **Plus whoever made it.** A room's MLS group has to be created by a
    // client, and only a member's client can do it — so a moderator who makes
    // a room gated on a role they do not hold would create a room nobody can
    // ever open, including them. Being in a room you made is also the less
    // surprising of the two behaviours.
    const members = [...new Set([...audienceMembers, gated.actor.accountId])];

    const created = await deps.store.createRoom(room, members);
    return c.json(
      {
        id: created.room.id,
        kind: created.room.kind,
        space: created.room.spaceId,
        group: created.room.groupId,
        members,
        streamPaging: created.room.streamPaging,
        notifyHints: created.room.notifyHints,
        audience: key,
      },
      201,
    );
  });

  /**
   * Delete a room and everything encrypted to it.
   *
   * `MANAGE_ROOMS`, like creating one. The events go with it — they were
   * encrypted to this room and nothing else references them — and the **group
   * does not**: it may serve sibling rooms with the same audience (`docs/03`
   * §4), and tearing it down would take their history too.
   *
   * This cannot un-send what members already hold, which is why `docs/18` says
   * so on the button rather than here. What it does is stop the Host serving
   * those bytes to anyone else, ever.
   *
   * The last room is refusable and is not refused: a space with no rooms is a
   * space you can still add one to, whereas a space with one room you cannot
   * delete is a mistake with no way out.
   */
  app.delete('/spaces/:id/rooms/:room', async (c) => {
    const spaceId = c.req.param('id');
    const roomId = c.req.param('room');
    const gated = await gate(c.req.raw, spaceId, Permission.MANAGE_ROOMS);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const room = await deps.store.getRoom(roomId);
    // 404 rather than 403 for a room in a different space: the answer to "does
    // this room exist" must not depend on permissions the asker does not have.
    if (!room || room.spaceId !== spaceId) return c.json({ error: 'no_such_room' }, 404);

    await deps.store.deleteRoom(roomId);
    return c.body(null, 204);
  });

  // -- invite links (`docs/03` §4 — the Wormhole trick) -----------------------
  //
  // What the Host holds is deliberately not enough to use: the private half of
  // an invite's key lives in the URL fragment and never arrives here, so
  // redeeming means signing a challenge with something no row contains.
  //
  // That bounds a *leak*. It is not a defence against this server, which can
  // write a membership row for anyone at any time — and does not need to,
  // because a membership row is not access. Only a member's client can commit
  // somebody into an MLS group (`docs/03` §5), which is the property doing the
  // real work here and the reason this route is allowed to be this simple.

  app.post('/spaces/:id/invites', async (c) => {
    const spaceId = c.req.param('id');
    const gated = await gate(c.req.raw, spaceId, Permission.INVITE);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const parsed = CreateInvite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const now = Date.now();
    const invite = {
      code: inviteCode(),
      spaceId,
      createdBy: gated.actor.accountId,
      pub: parsed.data.pub,
      uses: 0,
      maxUses: parsed.data.maxUses ?? null,
      expiresAt: parsed.data.ttl ? now + parsed.data.ttl : null,
      createdAt: now,
    };
    await deps.store.putInvite(invite);
    return c.json(wireInvite(invite), 201);
  });

  app.get('/spaces/:id/invites', async (c) => {
    const spaceId = c.req.param('id');
    const gated = await gate(c.req.raw, spaceId, Permission.INVITE);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const invites = await deps.store.listInvites(spaceId);
    return c.json({ invites: invites.map(wireInvite) });
  });

  app.delete('/spaces/:id/invites/:code', async (c) => {
    const spaceId = c.req.param('id');
    const gated = await gate(c.req.raw, spaceId, Permission.INVITE);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    // Anyone who may invite may revoke, including somebody else's link. A link
    // is a way into a space rather than a possession of the person who made
    // it, and a leaked one that only its author can kill is a leak with a
    // single point of failure.
    await deps.store.deleteInvite(spaceId, c.req.param('code'));
    return c.body(null, 204);
  });

  /**
   * What an invite looks like to somebody who has not joined.
   *
   * **Unauthenticated on purpose** — the whole point of a link is that you
   * follow it before you have an account. And deliberately almost empty: the
   * Host has never been told what the space is called (`docs/04` §1), so it
   * cannot put a name here, and inventing one would be putting a name exactly
   * where the design says one may not go. A member count is a true thing it
   * genuinely knows.
   */
  app.get('/invites/:code', async (c) => {
    const invite = await deps.store.getInvite(c.req.param('code'));
    // 404 for a code that never existed *and* for one that was revoked. The
    // difference is not a stranger's business, and telling them would make
    // this endpoint an oracle for which codes have ever been real.
    if (!invite) return c.json({ error: 'no_such_invite' }, 404);

    const now = Date.now();
    const status =
      invite.expiresAt !== null && invite.expiresAt <= now
        ? 'expired'
        : invite.maxUses !== null && invite.uses >= invite.maxUses
          ? 'used_up'
          : 'ok';

    // The inviter's handle, and nothing else about them. `docs/18` asks for
    // "who invited you" because it is the one thing here somebody can check
    // against the message the link arrived in.
    const inviter = await deps.store.getAccount(invite.createdBy).catch(() => null);

    return c.json({
      code: invite.code,
      space: invite.spaceId,
      members: (await deps.store.listSpaceMembers(invite.spaceId)).length,
      ...(inviter?.handle ? { invitedBy: inviter.handle } : {}),
      status,
    });
  });

  /**
   * Redeem: a membership row, and nothing else.
   *
   * Signed rather than bearer, so the code alone is not enough — a database
   * dump is a list of codes nobody can use. The challenge names the redeeming
   * account, so a signature captured off one redemption cannot be replayed to
   * join a different one.
   *
   * This hands over **no keys**, and could not: the Host has none. Somebody
   * whose row exists and whose leaf does not can see a room and read nothing
   * in it, until a member's client reconciles them in.
   */
  app.post('/invites/:code/redeem', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const code = c.req.param('code');
    const parsed = RedeemInvite.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const peek = await deps.store.getInvite(code);
    if (!peek) return c.json({ error: 'no_such_invite' }, 404);

    // Verified **before** the use is spent, so a wrong signature cannot burn
    // somebody else's link.
    const ok = await verifyInviteRedemption(
      fromBase64(peek.pub),
      code,
      actor.accountId,
      fromBase64(parsed.data.signature),
    ).catch(() => false);
    if (!ok) return c.json({ error: 'bad_signature' }, 403);

    // Already in. Idempotent rather than an error, and *without* spending a
    // use: a link opened twice in two tabs is not two joins.
    if (await deps.store.getSpaceMember(peek.spaceId, actor.accountId)) {
      return c.json({ space: peek.spaceId, joined: false });
    }

    const invite = await deps.store.redeemInvite(code, Date.now());
    if (!invite) return c.json({ error: 'invite_spent' }, 410);

    await joinSpace(deps.store, invite.spaceId, actor.accountId);
    return c.json({ space: invite.spaceId, joined: true }, 201);
  });

  // -- membership ------------------------------------------------------------

  app.get('/spaces/:id/members', async (c) => {
    const gated = await gate(c.req.raw, c.req.param('id'));
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const members = await deps.store.listSpaceMembers(c.req.param('id'));
    return c.json({ members: members.map((m) => ({ account: m.accountId, roles: m.roleIds })) });
  });

  app.post('/spaces/:id/members', async (c) => {
    const spaceId = c.req.param('id');
    const gated = await gate(c.req.raw, spaceId, Permission.INVITE);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const parsed = SpaceMembersInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    for (const account of parsed.data.accounts) {
      if (!(await deps.store.accountExists(account))) {
        return c.json({ error: 'no_such_account', account }, 404);
      }
    }

    // Membership is delivery; a member's client still has to commit them into
    // the MLS group before they can read a word (`docs/03` §5).
    for (const account of parsed.data.accounts) {
      await joinSpace(deps.store, spaceId, account);
    }
    return c.json({ added: parsed.data.accounts }, 201);
  });

  app.delete('/spaces/:id/members/:account', async (c) => {
    const spaceId = c.req.param('id');
    const target = c.req.param('account');
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    // Leaving is not kicking. You may always leave; removing somebody else
    // needs KICK, and neither is possible for the owner.
    const leaving = target === actor.accountId;
    const gated = await gate(c.req.raw, spaceId, leaving ? undefined : Permission.KICK);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    if (await deps.store.isOwner(spaceId, target)) {
      return c.json({ error: 'cannot_remove_owner' }, 403);
    }
    if (!(await deps.store.getSpaceMember(spaceId, target))) {
      return c.json({ error: 'not_a_member' }, 404);
    }

    await deps.store.removeSpaceMember(spaceId, target);
    for (const room of await deps.store.listSpaceRooms(spaceId)) {
      await deps.store.removeMember(room.id, target);
    }
    return c.body(null, 204);
  });

  app.put('/spaces/:id/members/:account/roles', async (c) => {
    const spaceId = c.req.param('id');
    const gated = await gate(c.req.raw, spaceId, Permission.MANAGE_ROLES);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const parsed = MemberRolesInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const target = c.req.param('account');
    if (!(await deps.store.getSpaceMember(spaceId, target))) {
      return c.json({ error: 'not_a_member' }, 404);
    }

    const roles = await deps.store.listRoles(spaceId);
    const byId = new Map(roles.map((r) => [r.id, r]));
    const owner = await deps.store.isOwner(spaceId, gated.actor.accountId);

    for (const roleId of parsed.data.roles) {
      const role = byId.get(roleId);
      if (!role || roleId === spaceId) return c.json({ error: 'no_such_role', role: roleId }, 400);
      // You cannot hand out what you do not hold. `docs/18` wants the refusal
      // to name the permission, so the missing bits go back with it.
      if (!canGrant(gated.bits, parse(role.bits), owner)) {
        return c.json(
          {
            error: 'cannot_grant',
            role: roleId,
            missing: serialize(parse(role.bits) & ~gated.bits),
          },
          403,
        );
      }
    }

    await deps.store.putSpaceMember(spaceId, target, parsed.data.roles);
    return c.json({ account: target, roles: parsed.data.roles });
  });

  // -- roles -----------------------------------------------------------------

  app.get('/spaces/:id/roles', async (c) => {
    const gated = await gate(c.req.raw, c.req.param('id'));
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const roles = await deps.store.listRoles(c.req.param('id'));
    return c.json({
      roles: roles.map((r): RoleInfo => ({ id: r.id, bits: r.bits, position: r.position })),
    });
  });

  app.post('/spaces/:id/roles', async (c) => {
    const spaceId = c.req.param('id');
    const gated = await gate(c.req.raw, spaceId, Permission.MANAGE_ROLES);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const parsed = RoleInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const wanted = parse(parsed.data.bits);
    const owner = await deps.store.isOwner(spaceId, gated.actor.accountId);
    if (!canGrant(gated.bits, wanted, owner)) {
      return c.json({ error: 'cannot_grant', missing: serialize(wanted & ~gated.bits) }, 403);
    }

    const role = {
      id: deps.ids.next(),
      spaceId,
      bits: serialize(wanted),
      position: parsed.data.position ?? 1,
    };
    await deps.store.putRole(role);
    return c.json({ id: role.id, bits: role.bits, position: role.position }, 201);
  });

  app.patch('/spaces/:id/roles/:role', async (c) => {
    const spaceId = c.req.param('id');
    const roleId = c.req.param('role');
    const gated = await gate(c.req.raw, spaceId, Permission.MANAGE_ROLES);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    const parsed = RoleInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const existing = (await deps.store.listRoles(spaceId)).find((r) => r.id === roleId);
    if (!existing) return c.json({ error: 'no_such_role' }, 404);

    const wanted = parse(parsed.data.bits);
    const owner = await deps.store.isOwner(spaceId, gated.actor.accountId);
    // Both directions: you cannot add what you lack, and you cannot take away
    // what you lack either — otherwise somebody without BAN could strip it from
    // a role and lock out the people who had it.
    const changed = wanted ^ parse(existing.bits);
    if (!canGrant(gated.bits, changed, owner)) {
      return c.json({ error: 'cannot_grant', missing: serialize(changed & ~gated.bits) }, 403);
    }

    const role = {
      ...existing,
      bits: serialize(wanted),
      position: parsed.data.position ?? existing.position,
    };
    await deps.store.putRole(role);
    return c.json({ id: role.id, bits: role.bits, position: role.position });
  });

  app.delete('/spaces/:id/roles/:role', async (c) => {
    const spaceId = c.req.param('id');
    const roleId = c.req.param('role');
    const gated = await gate(c.req.raw, spaceId, Permission.MANAGE_ROLES);
    if ('error' in gated) return c.json({ error: gated.error }, gated.status);

    // `@everyone` shares the space's id. Deleting it would leave every member
    // with no permissions at all and no way to grant themselves any.
    if (roleId === spaceId) return c.json({ error: 'cannot_delete_everyone' }, 400);

    const existing = (await deps.store.listRoles(spaceId)).find((r) => r.id === roleId);
    if (!existing) return c.json({ error: 'no_such_role' }, 404);

    const owner = await deps.store.isOwner(spaceId, gated.actor.accountId);
    if (!canGrant(gated.bits, parse(existing.bits), owner)) {
      return c.json(
        { error: 'cannot_grant', missing: serialize(parse(existing.bits) & ~gated.bits) },
        403,
      );
    }

    await deps.store.deleteRole(spaceId, roleId);
    return c.body(null, 204);
  });
}

/** Whether any of `held` is in `wanted`. */
function holdsAny(held: readonly string[], wanted: readonly string[]): boolean {
  return held.some((h) => wanted.includes(h));
}

/** Six characters of unambiguous alphabet, three groups. `docs/18`'s shape. */
function inviteCode(): string {
  // No `l`, `1`, `0` or `o`: this is a thing people read off a screen and type
  // into another one, and a code that cannot be transcribed is a code that
  // generates a support conversation instead of a join.
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

/** The wire shape of an invite. Null becomes absent, per the schema. */
function wireInvite(i: Invite) {
  return {
    code: i.code,
    space: i.spaceId,
    pub: i.pub,
    createdBy: i.createdBy,
    createdAt: i.createdAt,
    uses: i.uses,
    ...(i.maxUses !== null ? { maxUses: i.maxUses } : {}),
    ...(i.expiresAt !== null ? { expiresAt: i.expiresAt } : {}),
  };
}

/**
 * Put somebody in a space, and in the rooms they actually match.
 *
 * **Rooms whose audience covers them, not every room.** The membership loop
 * this replaces added a new member to every room in the space including
 * role-gated ones — and a room membership is what `canRead` resolves against,
 * so a brand new member with no roles could fetch a moderators-only room's
 * event log. Not its contents: they hold no keys and never would. But its
 * sizes, its timings and who sent what, which is exactly the metadata
 * `docs/03` §7 is careful about.
 *
 * It mattered less when the only way in was somebody typing your handle. An
 * invite link goes to strangers.
 */
async function joinSpace(store: Store, spaceId: string, account: string): Promise<void> {
  // No roles to start. Adding somebody and granting them something are two
  // decisions, and rolling them into one invite is how people end up with
  // permissions nobody remembers giving them.
  await store.putSpaceMember(spaceId, account, []);
  const roles: string[] = [];

  for (const room of await store.listSpaceRooms(spaceId)) {
    const audience = room.audience ?? 'everyone';
    if (audience === 'everyone') {
      await store.addMember(room.id, account);
    } else if (audience.startsWith('roles:')) {
      const wanted = audience.slice('roles:'.length).split(',').filter(Boolean);
      if (holdsAny(roles, wanted)) await store.addMember(room.id, account);
    } else if (audience.startsWith('list:')) {
      const named = audience.slice('list:'.length).split(',').filter(Boolean);
      if (named.includes(account)) await store.addMember(room.id, account);
    }
  }
}
