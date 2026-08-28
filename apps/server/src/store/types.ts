/**
 * What the server needs to persist.
 *
 * Deliberately an interface: the in-memory implementation lets the whole test
 * suite run with no database, which is how Kith kept 175 tests fast and
 * hermetic (`docs/29` §4). Postgres is the production implementation.
 *
 * Note what is absent — there is no `content` column anywhere. The server
 * stores opaque bytes and policy, nothing else (`docs/04` §1).
 */
import type { Event } from '@revel/protocol';

export interface Room {
  id: string;
  spaceId: string | null;
  /** Whether a `stream` hint may be attached to events here (`docs/03` §7). */
  streamPaging: boolean;
  /** Whether a `notify` hint may be attached. */
  notifyHints: boolean;
}

export interface Membership {
  roomId: string;
  accountId: string;
  /** Role ids held in this room's space, `@everyone` included. */
  roleIds: string[];
}

export interface Role {
  id: string;
  spaceId: string;
  /** Permission bits, base-10 string — JSON has no bigint. */
  bits: string;
  position: number;
}

export interface Override {
  roomId: string;
  roleId: string;
  allow: string;
  deny: string;
}

export interface Device {
  pub: string;
  accountId: string;
  revokedAt: number | null;
}

export interface Store {
  getRoom(id: string): Promise<Room | null>;
  getMembership(roomId: string, accountId: string): Promise<Membership | null>;
  getRoles(spaceId: string, roleIds: string[]): Promise<Role[]>;
  getOverrides(roomId: string): Promise<Override[]>;
  isOwner(spaceId: string, accountId: string): Promise<boolean>;

  getDevice(pub: string): Promise<Device | null>;

  /**
   * Append an event. Returns the stored event, or the existing one when
   * `clientNonce` has already been used by this device — so a retry after a
   * dropped response cannot duplicate (`docs/04` §2).
   */
  appendEvent(e: Event): Promise<{ event: Event; deduped: boolean }>;
  listEvents(roomId: string, opts?: { before?: string; limit?: number }): Promise<Event[]>;
  /** Delete the bytes, keep the tombstone so clients can drop their copies. */
  purgeEvent(roomId: string, eventId: string): Promise<boolean>;
}
