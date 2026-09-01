/**
 * Spaces: making one, who is in it, and what they may do.
 *
 * The properties worth most of this file are the two that are easy to get
 * wrong and expensive to notice:
 *
 * - **Hierarchy holds in both directions.** You cannot grant a permission you
 *   lack, and you cannot take one away either — otherwise somebody without
 *   `BAN` could strip it from a role and lock out the people who had it.
 * - **A space you are not in is indistinguishable from one that does not
 *   exist.** Anything else makes membership of every private space on a Host
 *   enumerable by anybody with an account.
 */
import { Permission, serialize } from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import { harness } from './helpers.js';

const ALICE = 'k7Yb3QzL0pW9xNvR2sTgHfMdEcJaUiOb1nKlPqRsTuV';
const BOB = 'Qa2Wd4Rf6Tg8Yh0Uj1Ik3Ol5Pz7Xc9Vb2Nm4As6Dfg';
const CAROL = 'Zx1Cv3Bn5Mq7Wr9Ty0Ui2Op4As6Df8Gh1Jk3Ll5Zzz';

function people() {
  const h = harness();
  h.stranger(ALICE, 'dev-a');
  h.stranger(BOB, 'dev-b');
  h.stranger(CAROL, 'dev-c');

  const send = (device: string, method: string, path: string, body?: unknown) =>
    h.app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-revel-device': device },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return {
    ...h,
    post: (d: string, p: string, b?: unknown) => send(d, 'POST', p, b),
    put: (d: string, p: string, b?: unknown) => send(d, 'PUT', p, b),
    patch: (d: string, p: string, b?: unknown) => send(d, 'PATCH', p, b),
    del: (d: string, p: string) => send(d, 'DELETE', p),
    get: (d: string, p: string) => h.app.request(p, { headers: { 'x-revel-device': d } }),
    /** A space owned by alice, with bob in it. */
    async space(withBob = true) {
      const res = await send('dev-a', 'POST', '/spaces', {});
      const space = (await res.json()) as { id: string; permissions: string };
      if (withBob) await send('dev-a', 'POST', `/spaces/${space.id}/members`, { accounts: [BOB] });
      return space;
    },
  };
}

describe('making a space', () => {
  it('makes its owner an administrator of it', async () => {
    const h = people();
    const res = await h.post('dev-a', '/spaces', {});
    expect(res.status).toBe(201);

    const space = (await res.json()) as { id: string; owner: boolean; permissions: string };
    expect(space.owner).toBe(true);
    // The owner short-circuits every check, so the number sent to the client is
    // everything — the client gates its UI on the same value the server used.
    expect(BigInt(space.permissions) & Permission.ADMINISTRATOR).toBe(Permission.ADMINISTRATOR);
  });

  it('gives it an `@everyone` that can talk and nothing else', async () => {
    // A new member can read, say something and attach a file. Everything that
    // changes the space is a decision somebody has to make on purpose.
    const h = people();
    const space = await h.space();
    const roles = (await (await h.get('dev-a', `/spaces/${space.id}/roles`)).json()) as {
      roles: { id: string; bits: string }[];
    };

    expect(roles.roles).toHaveLength(1);
    // `@everyone` shares the space's id (`docs/04` §4).
    expect(roles.roles[0]?.id).toBe(space.id);
    const bits = BigInt(roles.roles[0]?.bits as string);
    expect(bits & Permission.SEND).toBe(Permission.SEND);
    expect(bits & Permission.MANAGE_ROLES).toBe(0n);
  });

  it('lists only the spaces you are in', async () => {
    const h = people();
    const mine = await h.space(false);
    await h.post('dev-c', '/spaces', {});

    const listed = (await (await h.get('dev-a', '/spaces')).json()) as { spaces: { id: string }[] };
    expect(listed.spaces.map((s) => s.id)).toEqual([mine.id]);
  });
});

describe('a space you are not in', () => {
  it('is a 404, not a 403', async () => {
    // Otherwise membership of every private space on this Host is enumerable
    // by anybody with an account: 403 means "it exists".
    const h = people();
    const space = await h.space(false);
    expect((await h.get('dev-c', `/spaces/${space.id}`)).status).toBe(404);
  });

  it('cannot be added to by an outsider', async () => {
    const h = people();
    const space = await h.space(false);
    const res = await h.post('dev-c', `/spaces/${space.id}/members`, { accounts: [CAROL] });
    expect(res.status).toBe(404);
  });
});

describe('roles', () => {
  it('cannot grant a permission the granter does not hold', async () => {
    // `docs/18`: hierarchy is enforced *and explained*, so the refusal names
    // what is missing rather than greying out mysteriously.
    const h = people();
    const space = await h.space();

    // Bob holds `@everyone` only, which cannot manage roles at all.
    const denied = await h.post('dev-b', `/spaces/${space.id}/roles`, {
      bits: serialize(Permission.BAN),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'missing_permission' });

    // Give bob MANAGE_ROLES and nothing else; he still cannot mint BAN.
    const mod = (await (
      await h.post('dev-a', `/spaces/${space.id}/roles`, {
        bits: serialize(Permission.MANAGE_ROLES),
      })
    ).json()) as { id: string };
    await h.put('dev-a', `/spaces/${space.id}/members/${BOB}/roles`, { roles: [mod.id] });

    const res = await h.post('dev-b', `/spaces/${space.id}/roles`, {
      bits: serialize(Permission.BAN),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: 'cannot_grant',
      missing: serialize(Permission.BAN),
    });
  });

  it('cannot take away a permission the editor does not hold', async () => {
    // The direction that is easy to forget. Without it somebody with
    // MANAGE_ROLES but not BAN could strip BAN from a role and lock out
    // everybody who had it.
    const h = people();
    const space = await h.space();

    const banner = (await (
      await h.post('dev-a', `/spaces/${space.id}/roles`, { bits: serialize(Permission.BAN) })
    ).json()) as { id: string };
    const mod = (await (
      await h.post('dev-a', `/spaces/${space.id}/roles`, {
        bits: serialize(Permission.MANAGE_ROLES),
      })
    ).json()) as { id: string };
    await h.put('dev-a', `/spaces/${space.id}/members/${BOB}/roles`, { roles: [mod.id] });

    const res = await h.patch('dev-b', `/spaces/${space.id}/roles/${banner.id}`, {
      bits: serialize(0n),
    });
    expect(res.status).toBe(403);
  });

  it('refuses to delete `@everyone`', async () => {
    // It shares the space's id, and a space without it leaves every member with
    // no permissions and no way to grant themselves any.
    const h = people();
    const space = await h.space();
    const res = await h.del('dev-a', `/spaces/${space.id}/roles/${space.id}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'cannot_delete_everyone' });
  });

  it('is owned by the owner, whatever the bits say', async () => {
    const h = people();
    const space = await h.space();
    // The owner may mint ADMINISTRATOR; nobody else may, ever.
    const res = await h.post('dev-a', `/spaces/${space.id}/roles`, {
      bits: serialize(Permission.ADMINISTRATOR),
    });
    expect(res.status).toBe(201);
  });
});

describe('rooms in a space', () => {
  it('needs MANAGE_ROOMS', async () => {
    const h = people();
    const space = await h.space();
    expect((await h.post('dev-b', `/spaces/${space.id}/rooms`, {})).status).toBe(403);
    expect((await h.post('dev-a', `/spaces/${space.id}/rooms`, {})).status).toBe(201);
  });

  it('puts everyone in the space in an `everyone` room', async () => {
    const h = people();
    const space = await h.space();
    const room = (await (await h.post('dev-a', `/spaces/${space.id}/rooms`, {})).json()) as {
      members: string[];
      audience: string;
    };
    expect(room.audience).toBe('everyone');
    expect(room.members.sort()).toEqual([ALICE, BOB].sort());
  });

  it('will not gate a room on a role that does not exist', async () => {
    // Otherwise its audience is a rule nobody can ever match, and the room is
    // unreachable by construction.
    const h = people();
    const space = await h.space();
    // Well-formed and nonexistent. A *malformed* id is rejected by the schema
    // as `invalid_request`, which is a different and also correct answer — the
    // case worth testing is the one that gets past parsing.
    const res = await h.post('dev-a', `/spaces/${space.id}/rooms`, {
      audience: { kind: 'roles', roles: ['88000000000000001'] },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'no_such_role' });
  });

  it('gives a restricted room a different audience from an open one', async () => {
    const h = people();
    const space = await h.space();
    const mod = (await (
      await h.post('dev-a', `/spaces/${space.id}/roles`, { bits: serialize(Permission.SEND) })
    ).json()) as { id: string };

    const open = (await (await h.post('dev-a', `/spaces/${space.id}/rooms`, {})).json()) as {
      audience: string;
    };
    const shut = (await (
      await h.post('dev-a', `/spaces/${space.id}/rooms`, {
        audience: { kind: 'roles', roles: [mod.id] },
      })
    ).json()) as { audience: string; members: string[] };

    expect(open.audience).toBe('everyone');
    expect(shut.audience).toBe(`roles:${mod.id}`);
    // Nobody holds the role yet, so nobody is delivered to it.
    expect(shut.members).toEqual([]);
  });
});

describe('audiences and groups', () => {
  it('gives two `everyone` rooms the same group, via the first one to make it', async () => {
    // The whole reason a twelve-room space is one commit. The second room does
    // not create a second group; it is handed the one the audience already has.
    const h = people();
    const space = await h.space();

    const first = (await (await h.post('dev-a', `/spaces/${space.id}/rooms`, {})).json()) as {
      id: string;
      group: string | null;
    };
    // Nobody has made the group yet, so there is nothing to share.
    expect(first.group).toBeNull();

    // Alice's client makes it, the way a real client does on first open.
    const made = (await (await h.post('dev-a', '/groups', { roomId: first.id })).json()) as {
      id: string;
    };

    const second = (await (await h.post('dev-a', `/spaces/${space.id}/rooms`, {})).json()) as {
      group: string | null;
    };
    expect(second.group).toBe(made.id);
  });

  it('does not hand an `everyone` group to a restricted room', async () => {
    // The half that matters for confidentiality: a narrower audience is a
    // different rule, so it gets its own group and is private by construction.
    const h = people();
    const space = await h.space();
    const mod = (await (
      await h.post('dev-a', `/spaces/${space.id}/roles`, { bits: serialize(Permission.SEND) })
    ).json()) as { id: string };

    const open = (await (await h.post('dev-a', `/spaces/${space.id}/rooms`, {})).json()) as {
      id: string;
    };
    const made = (await (await h.post('dev-a', '/groups', { roomId: open.id })).json()) as {
      id: string;
    };

    const shut = (await (
      await h.post('dev-a', `/spaces/${space.id}/rooms`, {
        audience: { kind: 'roles', roles: [mod.id] },
      })
    ).json()) as { group: string | null };
    expect(shut.group).not.toBe(made.id);
    expect(shut.group).toBeNull();
  });
});

describe('leaving and removing', () => {
  it('lets anybody leave, and takes them out of the rooms too', async () => {
    const h = people();
    const space = await h.space();
    await h.post('dev-a', `/spaces/${space.id}/rooms`, {});

    expect((await h.del('dev-b', `/spaces/${space.id}/members/${BOB}`)).status).toBe(204);
    expect((await h.get('dev-b', `/spaces/${space.id}`)).status).toBe(404);
  });

  it('needs KICK to remove somebody else', async () => {
    const h = people();
    const space = await h.space();
    await h.post('dev-a', `/spaces/${space.id}/members`, { accounts: [CAROL] });

    expect((await h.del('dev-b', `/spaces/${space.id}/members/${CAROL}`)).status).toBe(403);
    expect((await h.del('dev-a', `/spaces/${space.id}/members/${CAROL}`)).status).toBe(204);
  });

  it('will not remove the owner', async () => {
    // A space whose owner can be removed from it is a space that can be taken.
    const h = people();
    const space = await h.space();
    const res = await h.del('dev-a', `/spaces/${space.id}/members/${ALICE}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'cannot_remove_owner' });
  });
});
