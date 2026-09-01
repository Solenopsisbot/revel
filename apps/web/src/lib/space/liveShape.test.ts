/**
 * The join between a Host's half of a space and the ciphertext's half.
 *
 * `docs/04` §1 splits a space deliberately: the Host has ids, bits and
 * membership because it enforces policy on them, and it has never been told
 * what any of it is *called*. `shapeSpace` is where the two halves meet, and
 * these tests are mostly about what happens when the second half has not
 * arrived yet — which is the normal state of a space on a device that has just
 * signed in, and the state every one of these screens renders in first.
 */
import { describe, expect, it } from 'vitest';
import type { RoomState } from '@revel/core';
import { emptyRoom } from '@revel/core';
import type { LiveSpace } from '../live.svelte.js';
import { bitsOf, colourFor, initialOf, shapeSpace } from './liveShape.js';

const ME = 'me-account';

/** A room's state with whatever facts this test cares about set on it. */
function state(roomId: string, patch: Partial<RoomState> = {}): RoomState {
  return { ...emptyRoom(roomId), ...patch };
}

function space(patch: Partial<LiveSpace> = {}): LiveSpace {
  return {
    info: { id: 'sp1', visibility: 'invite', owner: false, permissions: '0' },
    rooms: [{ id: 'r1', kind: 'space', space: 'sp1', audience: 'everyone' }],
    members: [{ account: ME, roles: [] }],
    roles: [],
    ...patch,
  } as LiveSpace;
}

const ctx = (states: Record<string, RoomState> = {}) => ({
  stateOf: (id: string) => states[id] ?? null,
  unreadOf: () => 0,
  faceFor: (a: string) => a,
  me: ME,
});

describe('a space that has not decrypted yet', () => {
  it('renders rather than crashing, and says nothing it does not know', () => {
    const shaped = shapeSpace(space(), ctx());
    // Not the id, and not an empty string that renders as a blank rail button.
    expect(shaped.name).toBe('Unnamed space');
    expect(shaped.rooms[0]!.name).toBe('untitled');
    expect(shaped.initial).toBe('U');
  });

  it('gives a space the same colour every time, so a reload is not a reshuffle', () => {
    expect(colourFor('sp1')).toBe(colourFor('sp1'));
    expect(shapeSpace(space(), ctx()).from).toBe(colourFor('sp1'));
  });

  it('leaves moderation empty rather than borrowing the fixtures', () => {
    // A queue showing somebody else's reports is worse than an empty one.
    const shaped = shapeSpace(space(), ctx());
    expect([shaped.invites, shaped.reports, shaped.bans, shaped.purges]).toEqual([[], [], [], []]);
  });
});

describe('a space whose names have arrived', () => {
  it('reads them off the `everyone` room, which is the one every member is in', () => {
    const shaped = shapeSpace(
      space({
        rooms: [
          // A restricted room first, to prove the search is by audience and not
          // by position — a name carried by a moderators-only room would be a
          // name most of the space could never read.
          { id: 'r0', kind: 'space', space: 'sp1', audience: 'roles' },
          { id: 'r1', kind: 'space', space: 'sp1', audience: 'everyone' },
        ],
      } as Partial<LiveSpace>),
      ctx({
        r0: state('r0', { spaceName: 'Wrong', name: 'mods' }),
        r1: state('r1', { spaceName: 'Solexsis', spaceColour: 'violet', name: 'general' }),
      }),
    );
    expect(shaped.name).toBe('Solexsis');
    expect(shaped.from).toBe('violet');
    expect(shaped.rooms.map((r) => r.name)).toEqual(['mods', 'general']);
  });

  it('takes the first grapheme for the rail, not the first code unit', () => {
    // "🌱 seedlings" must not render as half a surrogate pair.
    expect(initialOf('🌱 seedlings')).toBe('🌱');
    expect(initialOf('  solexsis ')).toBe('S');
    expect(initialOf('')).toBe('?');
  });
});

describe('roles', () => {
  it('joins the Host’s bits to the ciphertext’s names, highest rank first', () => {
    const shaped = shapeSpace(
      space({
        roles: [
          { id: 'sp1', bits: '1', position: 0 },
          { id: 'role-a', bits: bitsOf(['SEND', 'BAN']), position: 5 },
        ],
      } as Partial<LiveSpace>),
      ctx({ r1: state('r1', { spaceRoles: new Map([['role-a', { name: 'Mods' }]]) }) }),
    );
    expect(shaped.roles.map((r) => r.name)).toEqual(['Mods', '@everyone']);
    expect(shaped.roles[0]!.perms.sort()).toEqual(['BAN', 'SEND']);
  });

  it('knows `@everyone` by its id, because that is how the Host stores it', () => {
    // It shares the space's id (`docs/04` §1), which is why it needs no name —
    // and why it must not be offered as something to assign or delete.
    const shaped = shapeSpace(
      space({ roles: [{ id: 'sp1', bits: '1', position: 0 }] } as Partial<LiveSpace>),
      ctx(),
    );
    expect(shaped.roles[0]).toMatchObject({ name: '@everyone', everyone: true });
  });

  it('names a role it has no name for, rather than showing a snowflake', () => {
    const shaped = shapeSpace(
      space({ roles: [{ id: 'role-a', bits: '2', position: 1 }] } as Partial<LiveSpace>),
      ctx(),
    );
    expect(shaped.roles[0]!.name).toBe('unnamed role');
  });
});

describe('membership', () => {
  it('marks the owner flag on my row only, from the answer the server gave', () => {
    // `SpaceInfo.owner` is "does the asking account own this" — the same answer
    // the server enforced, rather than a second opinion computed here.
    const shaped = shapeSpace(
      space({
        info: { id: 'sp1', visibility: 'invite', owner: true, permissions: '0' },
        members: [{ account: ME, roles: [] }, { account: 'somebody-else', roles: [] }],
      } as Partial<LiveSpace>),
      ctx(),
    );
    expect(shaped.members.find((m) => m.accountId === ME)?.owner).toBe(true);
    expect(shaped.members.find((m) => m.accountId !== ME)?.owner).toBeUndefined();
  });

  it('does not invent a join time it was never sent', () => {
    // The Host does not send one. Zero sorts equal and renders as nothing,
    // where a plausible-looking `Date.now()` would render as a lie.
    expect(shapeSpace(space(), ctx()).members[0]!.joinedAt).toBe(0);
  });
});

describe('permission bits', () => {
  it('round-trips through the base-10 string the wire uses', () => {
    const shaped = shapeSpace(
      space({
        roles: [{ id: 'r', bits: bitsOf(['VIEW', 'SEND', 'MANAGE_ROLES']), position: 1 }],
      } as Partial<LiveSpace>),
      ctx(),
    );
    expect(shaped.roles[0]!.perms.sort()).toEqual(['MANAGE_ROLES', 'SEND', 'VIEW']);
  });

  it('treats ADMINISTRATOR as the one bit that is not a list', () => {
    // `listPermissions` reports what is literally held; the short-circuit is
    // `has`'s job, and `perms.ts` re-expands it for the UI.
    const shaped = shapeSpace(
      space({
        roles: [{ id: 'r', bits: bitsOf(['ADMINISTRATOR']), position: 1 }],
      } as Partial<LiveSpace>),
      ctx(),
    );
    expect(shaped.roles[0]!.perms).toEqual(['ADMINISTRATOR']);
  });
});
