import { DEFAULT_EVERYONE, Permission, SnowflakeFactory, encodePayload, serialize } from '@revel/protocol';
import { createApp } from '../src/app.js';
import { Hub } from '../src/hub.js';
import { MemoryStore } from '../src/store/memory.js';

export const EVERYONE = 'role-everyone';

/** A server with one space, one room, and whoever you ask for in it. */
export function harness(opts: { streamPaging?: boolean; notifyHints?: boolean } = {}) {
  const store = new MemoryStore();
  const hub = new Hub();
  const ids = new SnowflakeFactory(1);

  store.rooms.set('room1', {
    id: 'room1',
    spaceId: 'space1',
    streamPaging: opts.streamPaging ?? false,
    notifyHints: opts.notifyHints ?? false,
  });
  store.roles.set(EVERYONE, {
    id: EVERYONE,
    spaceId: 'space1',
    bits: serialize(DEFAULT_EVERYONE),
    position: 0,
  });

  const app = createApp({
    store,
    hub,
    ids,
    async authenticate(req) {
      const pub = req.headers.get('x-revel-device');
      if (!pub) return null;
      const d = await store.getDevice(pub);
      if (!d || d.revokedAt) return null;
      return { accountId: d.accountId, devicePub: d.pub };
    },
  });

  /** Enrol a device for an account and put that account in the room. */
  function join(accountId: string, devicePub: string, roleIds: string[] = [EVERYONE]) {
    store.devices.set(devicePub, { pub: devicePub, accountId, revokedAt: null });
    store.memberships.set(`room1:${accountId}`, { roomId: 'room1', accountId, roleIds });
    return devicePub;
  }

  /** A device that exists but is in no room. */
  function stranger(accountId: string, devicePub: string) {
    store.devices.set(devicePub, { pub: devicePub, accountId, revokedAt: null });
    return devicePub;
  }

  function role(id: string, bits: bigint, position = 1) {
    store.roles.set(id, { id, spaceId: 'space1', bits: serialize(bits), position });
    return id;
  }

  const send = (device: string, body: unknown, room = 'room1') =>
    app.request(`/rooms/${room}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revel-device': device },
      body: JSON.stringify(body),
    });

  const list = (device: string, room = 'room1', qs = '') =>
    app.request(`/rooms/${room}/events${qs}`, { headers: { 'x-revel-device': device } });

  const purge = (device: string, id: string, room = 'room1') =>
    app.request(`/rooms/${room}/events/${id}`, {
      method: 'DELETE',
      headers: { 'x-revel-device': device },
    });

  return { store, hub, app, join, stranger, role, send, list, purge, Permission };
}

let n = 0;
/** A minimal valid event body. `payload` is opaque to the server by design. */
export function body(over: Record<string, unknown> = {}) {
  return {
    epoch: 1,
    class: 'normal',
    payload: encodePayload(new TextEncoder().encode('ciphertext-would-go-here')),
    clientNonce: `nonce-${++n}-abcdefgh`,
    ...over,
  };
}
