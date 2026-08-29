/**
 * The permission catalogue, and the rules for editing it.
 *
 * `docs/04` §4 is the flag list — Kith's bitfield model pruned for a server
 * that cannot read content. `docs/18` is the editor: "a list of permissions
 * with toggles, grouped, with a plain sentence under each rather than a bare
 * flag name."
 *
 * The sentences are the work. `MANAGE_EVENTS` tells you nothing; "delete other
 * people's messages, and ask the server to forget the bytes" tells you what
 * you are about to hand someone. A permission editor where every row is a
 * SCREAMING_CONSTANT is one where admins guess, and guessing about
 * `MANAGE_AGENTS` means guessing about who holds keys.
 */
import type { Perm, Role, Space } from '../fake/data.js';

export interface PermSpec {
  id: Perm;
  name: string;
  /** What it actually lets someone do, in a sentence. */
  blurb: string;
  /** Worth a second look before granting. Drawn warmer, never blocked. */
  heavy?: boolean;
}

export interface PermGroup {
  name: string;
  /** One line about the group, where the grouping itself needs explaining. */
  note?: string;
  perms: PermSpec[];
}

export const PERM_GROUPS: PermGroup[] = [
  {
    name: 'Taking part',
    perms: [
      { id: 'SEND', name: 'Send messages', blurb: 'Post in rooms they can see.' },
      { id: 'SEND_MEDIA', name: 'Attach files', blurb: 'Upload images, video and files.' },
      {
        id: 'MENTION_EVERYONE',
        name: 'Mention everyone',
        blurb: 'Ping a whole room at once, waking every phone in it.',
      },
    ],
  },
  {
    name: 'Other people’s messages',
    perms: [
      {
        id: 'MANAGE_EVENTS',
        name: 'Delete and purge messages',
        blurb:
          'Remove messages they did not write, and ask the server to forget the bytes. People who already read one may have kept it.',
        heavy: true,
      },
    ],
  },
  {
    name: 'The space',
    perms: [
      { id: 'MANAGE_ROOMS', name: 'Manage rooms', blurb: 'Create, rename, recategorise and delete rooms.' },
      {
        id: 'MANAGE_ROLES',
        name: 'Manage roles',
        blurb: 'Create roles and change what they can do — including, eventually, their own.',
        heavy: true,
      },
      { id: 'MANAGE_SPACE', name: 'Manage the space', blurb: 'Change its name, description and whether it is listed.' },
      {
        id: 'MANAGE_AGENTS',
        name: 'Manage agents',
        blurb:
          'Add and remove agents. An agent in a room holds that room’s keys and reads everything in it, so this is the heaviest thing on this list.',
        heavy: true,
      },
    ],
  },
  {
    name: 'Membership',
    perms: [
      { id: 'INVITE', name: 'Create invites', blurb: 'Make links that let new people in.' },
      { id: 'KICK', name: 'Remove members', blurb: 'Take someone out. A new invite lets them back.' },
      { id: 'BAN', name: 'Ban members', blurb: 'Take someone out and keep them out, across rejoins.', heavy: true },
    ],
  },
  {
    name: 'Everything',
    note: 'One switch that turns on every switch above, now and in future.',
    perms: [
      {
        id: 'ADMINISTRATOR',
        name: 'Administrator',
        blurb: 'Every permission here, plus immunity to per-room restrictions. Give it to people, not to roles you hand out.',
        heavy: true,
      },
    ],
  },
];

/**
 * `VIEW` is deliberately absent from the editor.
 *
 * `docs/04`: "the *actual* gate is key possession". A toggle called "can view"
 * would be the single most misleading control in the product — it would look
 * like the thing that keeps people out, when the thing that keeps people out
 * is not being in the audience. The rooms tab owns that decision and says so;
 * this editor points at it rather than offering a switch that cannot deliver.
 */
export const VIEW_LIVES_IN_AUDIENCES = true;

/** Everything a set of roles adds up to. Owner is handled by the caller. */
export function resolve(space: Space, roleNames: string[]): Set<Perm> {
  const out = new Set<Perm>();
  for (const r of space.roles) {
    if (!roleNames.includes(r.name)) continue;
    for (const p of r.perms) out.add(p);
  }
  if (out.has('ADMINISTRATOR')) for (const g of PERM_GROUPS) for (const p of g.perms) out.add(p.id);
  return out;
}

/** The highest rank among a set of roles. Nobody is rank 0. */
export function rankOf(space: Space, roleNames: string[]): number {
  return space.roles.reduce((max, r) => (roleNames.includes(r.name) ? Math.max(max, r.rank) : max), 0);
}

export type Refusal = { ok: true } | { ok: false; why: string };

/**
 * Whether you may edit a role at all (`docs/18`: hierarchy is enforced *and
 * explained* at the point of failure).
 *
 * Returns the sentence rather than a boolean, because "greying out
 * mysteriously" is exactly what the doc says not to do — the refusal has to
 * carry its own reason to the place it happens.
 */
export function canEditRole(
  space: Space,
  role: Role,
  me: { owner: boolean; perms: Set<Perm>; rank: number },
): Refusal {
  if (me.owner) return { ok: true };
  if (!me.perms.has('MANAGE_ROLES')) {
    return { ok: false, why: 'You can’t change roles here because you don’t have Manage roles.' };
  }
  if (role.rank >= me.rank) {
    return {
      ok: false,
      why: `${role.name} is at or above your own rank, so you can’t change what it can do.`,
    };
  }
  return { ok: true };
}

/** Whether you may grant one specific permission. You cannot give what you lack. */
export function canGrant(perm: PermSpec, me: { owner: boolean; perms: Set<Perm> }): Refusal {
  if (me.owner) return { ok: true };
  if (!me.perms.has(perm.id)) {
    return { ok: false, why: `You can’t grant ${perm.name} because you don’t have it.` };
  }
  return { ok: true };
}
