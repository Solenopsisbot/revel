/**
 * "What may you do?" — the only question the server answers about an event.
 *
 * It never asks "what does this say", because it cannot. Every check here is
 * about membership, roles and shape.
 */
import { Permission, has, parse, resolve } from '@revel/protocol';
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
  if (!room.spaceId) return { room, bits: Permission.VIEW | Permission.SEND | Permission.SEND_MEDIA };

  const [roles, overrides, owner] = await Promise.all([
    store.getRoles(room.spaceId, membership.roleIds),
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
