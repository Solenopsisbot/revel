/**
 * A live space, in the shape every space screen already reads.
 *
 * The UI was built against `fake/data.ts`'s `Space`: one object with rooms,
 * roles, members and names all on it. The real thing is deliberately split in
 * two — the Host holds ids, bits and membership (`docs/04` §1) and has never
 * been told what any of it is *called*, so the names arrive separately as
 * encrypted events and are read off each room's state.
 *
 * This is the join. It exists so that "wire spaces up" did not mean rewriting
 * 1,700 lines of components that were already right, and it is a pure function
 * of its arguments so it can be tested without a browser or a Host.
 */

import type { RoomState } from '@revel/core';
import {
  combine,
  listPermissions,
  parse,
  Permission,
  type RoleInfo,
  type RoomInfo,
  serialize,
} from '@revel/protocol';
import type { LiveSpace } from '../live.svelte.js';
import type { Audience, FaceColour, Member, Perm, Role, Room, Space } from '../fake/data.js';

const COLOURS: FaceColour[] = ['gold', 'rose', 'violet', 'sky', 'mint', 'coral', 'lilac', 'aqua'];

/**
 * A stable colour for something that has never been given one.
 *
 * Derived from the id rather than random, so the same space is the same colour
 * on every device and after every reload — a rail whose colours shuffled on
 * refresh would be worse than a rail with no colours at all.
 */
export function colourFor(id: string): FaceColour {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLOURS[Math.abs(hash) % COLOURS.length]!;
}

/** The second colour of a space's gradient: the next one round the wheel. */
function partner(colour: FaceColour): FaceColour {
  return COLOURS[(COLOURS.indexOf(colour) + 3) % COLOURS.length]!;
}

/**
 * The letter in the rail.
 *
 * `Array.from` rather than `[0]`, because a space called "🌱 seedlings" should
 * show the seedling and not half a surrogate pair.
 */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return (first ?? '?').toUpperCase();
}

/** Which state to read a space's shared facts from — see `#everyoneRoom`. */
function nameSource(space: LiveSpace, stateOf: (id: string) => RoomState | null): RoomState | null {
  const everyone = space.rooms.find((r) => r.audience === 'everyone') ?? space.rooms[0];
  if (!everyone) return null;
  return stateOf(everyone.id);
}

/**
 * A room's audience, back from the canonical key the Host stores it under.
 *
 * `audienceKey` flattens the rule to a string because that is what the server
 * needs to compare — it is the one thing that decides which rooms share a
 * group. Reading it back is what lets "who can see what" group rooms by their
 * *rule* rather than by which ones happen to have the same members today.
 *
 * An unrecognised prefix falls back to `everyone`. That is the wrong-but-safe
 * direction for a *display*: it says "this room is as open as the space",
 * which cannot mislead somebody into thinking a room is more private than it
 * is. The lock is key possession either way — this string never gates anything.
 */
function toAudience(key: string | undefined): Audience {
  if (!key || key === 'everyone') return { kind: 'everyone' };
  if (key.startsWith('roles:')) {
    const roles = key.slice('roles:'.length).split(',').filter(Boolean);
    return roles.length ? { kind: 'roles', roles } : { kind: 'everyone' };
  }
  if (key.startsWith('list:')) {
    const accounts = key.slice('list:'.length).split(',').filter(Boolean);
    return accounts.length ? { kind: 'picked', faceIds: accounts } : { kind: 'everyone' };
  }
  return { kind: 'everyone' };
}

/** A room, as the sidebar wants it. Its name lives in its own state. */
function toRoom(info: RoomInfo, state: RoomState | null, unread: number): Room {
  return {
    id: info.id,
    // An unnamed room is shown as "untitled" rather than as its snowflake: the
    // id is true and unreadable, and a room can genuinely sit unnamed for the
    // moment between being created and its `room.name` arriving.
    name: state?.name ?? 'untitled',
    kind: 'text',
    // Categories are a space-settings feature that has no server representation
    // yet, so every room is in the one bucket rather than in a fabricated one.
    category: 'Rooms',
    ...(state?.topic ? { topic: state.topic } : {}),
    ...(unread ? { unread } : {}),
    audience: toAudience(info.audience),
  };
}

/**
 * Roles, highest first.
 *
 * `position` on the wire is the hierarchy; `rank` is what the UI calls it. They
 * are the same number, and the rename is the one piece of translation here that
 * is not a join — worth doing rather than renaming the field in eleven
 * components that read `rank`.
 */
function toRoles(
  spaceId: string,
  roles: RoleInfo[],
  named: Map<string, { name: string; colour?: string }>,
): Role[] {
  return roles
    .map((role): Role => {
      // `@everyone` shares the space's id — that is how the Host stores it, and
      // it is why it needs no name of its own.
      const everyone = role.id === spaceId;
      const label = named.get(role.id);
      return {
        id: role.id,
        name: everyone ? '@everyone' : (label?.name ?? 'unnamed role'),
        colour: (label?.colour as FaceColour) ?? colourFor(role.id),
        rank: everyone ? 0 : role.position,
        perms: listPermissions(parse(role.bits)) as Perm[],
        ...(everyone ? { everyone: true } : {}),
      };
    })
    .sort((a, b) => b.rank - a.rank);
}

export interface ShapeContext {
  /** A room's decrypted state, or null if it has not loaded yet. */
  stateOf: (roomId: string) => RoomState | null;
  /** How many unread messages a room is holding. */
  unreadOf: (roomId: string) => number;
  /** The face to show a given account as. Cosmetic; membership is the account. */
  faceFor: (account: string) => string;
  /** This account. Which member row is yours, and whether it is the owner's. */
  me: string;
}

/** Join a live space with the names its rooms are carrying. */
export function shapeSpace(space: LiveSpace, ctx: ShapeContext): Space {
  const source = nameSource(space, ctx.stateOf);
  const name = source?.spaceName ?? 'Unnamed space';
  const colour = (source?.spaceColour as FaceColour) ?? colourFor(space.info.id);

  return {
    id: space.info.id,
    name,
    initial: initialOf(name),
    from: colour,
    to: partner(colour),
    visibility: space.info.visibility,
    rooms: space.rooms.map((r) => toRoom(r, ctx.stateOf(r.id), ctx.unreadOf(r.id))),
    roles: toRoles(space.info.id, space.roles, source?.spaceRoles ?? new Map()),
    members: space.members.map(
      (m): Member => ({
        accountId: m.account,
        faceId: ctx.faceFor(m.account),
        roles: m.roles,
        // The Host does not send a join time and the UI only sorts by it, so
        // every member sorts equal rather than being given a plausible lie.
        joinedAt: 0,
        // Only ever about *me*. `SpaceInfo.owner` is "does the asking account
        // own this", which is the one owner flag the wire carries — and it is
        // the right one, because it is the same answer the server enforced
        // rather than a second opinion computed here (`docs/04` §4).
        ...(m.account === ctx.me && space.info.owner ? { owner: true } : {}),
      }),
    ),
    // Invites, reports, bans and purges have no live representation yet. Empty
    // arrays rather than fixtures: a moderation queue showing somebody else's
    // reports is worse than one that is honestly empty.
    invites: [],
    reports: [],
    bans: [],
    purges: [],
  };
}

/**
 * A role's permissions, as the base-10 string the wire wants.
 *
 * `docs/04` §1: JSON has no bigint, so bits travel as decimal text. The UI
 * works in names because that is what the checkboxes are; this is the one
 * place the two representations meet.
 */
export function bitsOf(perms: Perm[]): string {
  return serialize(combine(...perms.map((p) => Permission[p] ?? 0n)));
}
