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
  has,
  MemberRolesInput,
  Permission,
  parse,
  type RoleInfo,
  RoleInput,
  type SnowflakeFactory,
  type SpaceInfo,
  SpaceMembersInput,
  serialize,
} from '@revel/protocol';
import type { Hono } from 'hono';
import { type Actor, spacePermissionsFor } from './policy.js';
import type { Store } from './store/types.js';

export interface SpaceDeps {
  store: Store;
  ids: SnowflakeFactory;
  authenticate(req: Request): Promise<Actor | null>;
}

/**
 * `@everyone`'s starting permissions.
 *
 * Enough to take part and nothing that changes the space. A new member can
 * read, say something, and attach a file; everything else is a decision
 * somebody has to make on purpose.
 */
const DEFAULT_EVERYONE =
  Permission.VIEW | Permission.SEND | Permission.SEND_MEDIA | Permission.MENTION_EVERYONE;

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

    const rooms = await deps.store.listSpaceRooms(c.req.param('id'));
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

    for (const account of parsed.data.accounts) {
      // No roles to start. Adding somebody and granting them something are two
      // decisions, and rolling them into one invite is how people end up with
      // permissions nobody remembers giving them.
      await deps.store.putSpaceMember(spaceId, account, []);
      // Into every room whose audience they now match. Membership is delivery;
      // a member's client still has to commit them into the MLS group before
      // they can read a word (`docs/03` §5).
      for (const room of await deps.store.listSpaceRooms(spaceId)) {
        await deps.store.addMember(room.id, account);
      }
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
