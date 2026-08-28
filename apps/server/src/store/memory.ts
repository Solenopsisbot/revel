/** In-memory Store. Used by the tests and by `revel dev`. */
import type { Event } from '@revel/protocol';
import { compareIds } from '@revel/protocol';
import type { Device, Membership, Override, Role, Room, Store } from './types.js';

export class MemoryStore implements Store {
  rooms = new Map<string, Room>();
  memberships = new Map<string, Membership>();
  roles = new Map<string, Role>();
  overrides: Override[] = [];
  owners = new Set<string>();
  devices = new Map<string, Device>();
  events = new Map<string, Event[]>();
  #nonces = new Map<string, Event>();

  async getRoom(id: string) {
    return this.rooms.get(id) ?? null;
  }
  async getMembership(roomId: string, accountId: string) {
    return this.memberships.get(`${roomId}:${accountId}`) ?? null;
  }
  async getRoles(spaceId: string, roleIds: string[]) {
    return roleIds
      .map((r) => this.roles.get(r))
      .filter((r): r is Role => !!r && r.spaceId === spaceId);
  }
  async getOverrides(roomId: string) {
    return this.overrides.filter((o) => o.roomId === roomId);
  }
  async isOwner(spaceId: string, accountId: string) {
    return this.owners.has(`${spaceId}:${accountId}`);
  }
  async getDevice(pub: string) {
    return this.devices.get(pub) ?? null;
  }

  async appendEvent(e: Event) {
    // Idempotency is scoped per device: two devices may legitimately pick the
    // same nonce, and one must not shadow the other.
    const key = `${e.sender}:${e.clientNonce}`;
    const existing = this.#nonces.get(key);
    if (existing) return { event: existing, deduped: true };

    const list = this.events.get(e.room) ?? [];
    list.push(e);
    this.events.set(e.room, list);
    this.#nonces.set(key, e);
    return { event: e, deduped: false };
  }

  async listEvents(roomId: string, opts: { before?: string; limit?: number } = {}) {
    const all = [...(this.events.get(roomId) ?? [])].sort((a, b) => compareIds(a.id, b.id));
    const filtered = opts.before ? all.filter((e) => compareIds(e.id, opts.before!) < 0) : all;
    const limit = opts.limit ?? 50;
    return filtered.slice(-limit);
  }

  async purgeEvent(roomId: string, eventId: string) {
    const list = this.events.get(roomId);
    const found = list?.find((e) => e.id === eventId);
    if (!found) return false;
    found.payload = '';
    found.size = 0;
    found.purgedAt = Date.now();
    return true;
  }
}
