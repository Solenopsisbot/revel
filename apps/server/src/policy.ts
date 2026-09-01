/**
 * "What may you do?" — the only question the server answers about an event.
 *
 * It never asks "what does this say", because it cannot. Every check here is
 * about membership, roles and shape.
 */
import { has, Permission, parse, resolve } from '@revel/protocol';
import type { Store } from './store/types.js';

export type Denial =
  | 'no_such_room'
  | 'not_a_member'
  | 'missing_permission'
  | 'stream_not_enabled'
  | 'notify_not_enabled'
  | 'notify_everyone_denied';

export interface Actor {
  accountId: string;
  devicePub: string;
}

/** Effective permission bits for an actor in a room. */
export async function permissionsFor(store: Store, roomId: string, accountId: string) {
  const room = await store.getRoom(roomId);
  if (!room) return null;
  const membership = await store.getMembership(roomId, accountId);
  if (!membership) return null;

  // A DM has no space, so no roles and no overrides — membership IS the
  // permission. Roles only exist inside a space.
  if (!room.spaceId)
    return { room, bits: Permission.VIEW | Permission.SEND | Permission.SEND_MEDIA };

  const [roles, overrides, owner] = await Promise.all([
    // `@everyone` is added here, not read from the membership row. It applies
    // to every member of the space by definition and shares the space's id
    // (`docs/04` §4) — relying on it having been *stored* means every write
    // that touches `role_ids` has to remember not to drop it, and the one that
    // forgot resolved a legitimate member to zero permissions: no VIEW, so not
    // entitled to the group, so nobody could commit them into it. A member who
    // can see a room exists and can never be given its keys.
    store.getRoles(room.spaceId, [room.spaceId, ...membership.roleIds]),
    store.getOverrides(roomId),
    store.isOwner(room.spaceId, accountId),
  ]);

  const bits = resolve({
    roleBits: roles.map((r) => ({ roleId: r.id, bits: parse(r.bits) })),
    overrides: overrides.map((o) => ({
      roleId: o.roleId,
      allow: parse(o.allow),
      deny: parse(o.deny),
    })),
    isOwner: owner,
  });
  return { room, bits };
}

/**
 * What an account may do in a space, before any room's overrides.
 *
 * `@everyone` is added here rather than stored on the member: it applies to
 * every member by definition, and storing it would mean every role change had
 * to remember not to drop it. It shares the space's id (`docs/04` §4).
 *
 * `null` means not a member — distinct from "a member with no permissions",
 * which is a real and different state.
 */
export async function spacePermissionsFor(
  store: Store,
  spaceId: string,
  accountId: string,
): Promise<bigint | null> {
  const member = await store.getSpaceMember(spaceId, accountId);
  if (!member) return null;

  const [roles, owner] = await Promise.all([
    store.getRoles(spaceId, [spaceId, ...member.roleIds]),
    store.isOwner(spaceId, accountId),
  ]);

  return resolve({
    roleBits: roles.map((r) => ({ roleId: r.id, bits: parse(r.bits) })),
    isOwner: owner,
  });
}

/** May this actor append this event to this room? */
export async function canSend(
  store: Store,
  roomId: string,
  actor: Actor,
  input: { stream?: string; notify?: string[] },
): Promise<Denial | null> {
  const room = await store.getRoom(roomId);
  if (!room) return 'no_such_room';

  const resolved = await permissionsFor(store, roomId, actor.accountId);
  if (!resolved) return 'not_a_member';
  if (!has(resolved.bits, Permission.SEND)) return 'missing_permission';

  // These two hints are metadata the room has opted into leaking. Accepting
  // one on a room that disabled it would leak more than the room agreed to.
  if (input.stream !== undefined && !room.streamPaging) return 'stream_not_enabled';
  if (input.notify !== undefined) {
    if (!room.notifyHints) return 'notify_not_enabled';
    // A notify list covering the whole room is @everyone by another name.
    if (input.notify.length > 32 && !has(resolved.bits, Permission.MENTION_EVERYONE)) {
      return 'notify_everyone_denied';
    }
  }
  return null;
}

export async function canRead(store: Store, roomId: string, actor: Actor): Promise<Denial | null> {
  const resolved = await permissionsFor(store, roomId, actor.accountId);
  if (!resolved) return (await store.getRoom(roomId)) ? 'not_a_member' : 'no_such_room';
  return has(resolved.bits, Permission.VIEW) ? null : 'missing_permission';
}

export async function canPurge(store: Store, roomId: string, actor: Actor): Promise<Denial | null> {
  const resolved = await permissionsFor(store, roomId, actor.accountId);
  if (!resolved) return 'not_a_member';
  return has(resolved.bits, Permission.MANAGE_EVENTS) ? null : 'missing_permission';
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type GroupDenial = 'no_such_group' | 'not_in_group' | 'not_entitled';

/**
 * May this account legitimately hold this group's keys?
 *
 * Derived from the rooms the group serves, never stored: a group exists to
 * decrypt some set of rooms, so the people entitled to it are exactly the
 * people who may read one of them. Room → group is many-to-one (`docs/03` §4),
 * hence the union rather than a single lookup.
 *
 * This is the "authorised claim" check from Kith's audit (`docs/03` §5). It is
 * what stops someone claiming a stranger's one-time key packages: you may only
 * spend a package on a person who is already allowed in the group.
 */
export async function entitledToGroup(
  store: Store,
  groupId: string,
  accountId: string,
): Promise<boolean> {
  for (const room of await store.getGroupRooms(groupId)) {
    const resolved = await permissionsFor(store, room.id, accountId);
    if (resolved && has(resolved.bits, Permission.VIEW)) return true;
  }
  return false;
}

/**
 * May this device append to the group's handshake log?
 *
 * Membership of the *group*, not entitlement to it — being allowed to join is
 * not the same as having joined, and only a device with a leaf can produce a
 * commit MLS will accept. The server checking this saves everyone else the
 * work of rejecting garbage; it is not what makes forgery impossible. That is
 * the client-side validation in `docs/03` §5.
 */
export async function canHandshake(
  store: Store,
  groupId: string,
  actor: Actor,
): Promise<GroupDenial | null> {
  if (!(await store.getGroup(groupId))) return 'no_such_group';
  return (await store.getGroupMember(groupId, actor.devicePub)) ? null : 'not_in_group';
}
