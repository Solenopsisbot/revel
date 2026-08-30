import {
  DEFAULT_EVERYONE,
  encodePayload,
  Permission,
  SnowflakeFactory,
  serialize,
} from '@revel/protocol';
import { createApp } from '../src/app.js';
import { type Connection, Hub } from '../src/hub.js';
import { MemoryStore } from '../src/store/memory.js';

export const EVERYONE = 'role-everyone';

/** A server with one space, one room, and whoever you ask for in it. */
export function harness(opts: { streamPaging?: boolean; notifyHints?: boolean } = {}) {
  const store = new MemoryStore();
  const hub = new Hub();
  const ids = new SnowflakeFactory(1);

  store.rooms.set('room1', {
    id: 'room1',
    kind: 'space',
    spaceId: 'space1',
    groupId: null,
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

  // -------------------------------------------------------------------------
  // The handshake surface
  // -------------------------------------------------------------------------

  const json = (device: string, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-revel-device': device },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const get = (device: string, path: string) =>
    app.request(path, { headers: { 'x-revel-device': device } });

  /** Fill a device's shelf. Contents are opaque to the server, so these are labels. */
  const publish = (device: string, packages: string[], lastResort?: string) =>
    json(device, 'PUT', `/idp/devices/${device}/key-packages`, {
      packages: packages.map(b64),
      ...(lastResort ? { lastResort: b64(lastResort) } : {}),
    });

  const supply = (device: string, of = device) => get(device, `/idp/devices/${of}/key-packages`);

  const createGroup = (device: string, roomId = 'room1') =>
    json(device, 'POST', '/groups', { roomId });

  const groupInfo = (device: string, groupId: string) => get(device, `/groups/${groupId}`);

  const claim = (device: string, groupId: string, accounts: string[]) =>
    json(device, 'POST', `/groups/${groupId}/key-packages/claim`, { accounts });

  const handshake = (device: string, groupId: string, body: unknown) =>
    json(device, 'POST', `/groups/${groupId}/handshake`, body);

  const handshakeLog = (device: string, groupId: string, qs = '') =>
    get(device, `/groups/${groupId}/handshake${qs}`);

  const putTree = (device: string, groupId: string, epoch: number, tree: string) =>
    json(device, 'PUT', `/groups/${groupId}/tree`, { epoch, tree: b64(tree) });

  const getTree = (device: string, groupId: string) => get(device, `/groups/${groupId}/tree`);

  const welcomes = (device: string) => get(device, '/welcomes');

  const ackWelcome = (device: string, groupId: string) =>
    json(device, 'DELETE', `/groups/${groupId}/welcome`);

  /** Open a group with `device` as its only leaf, and return the id. */
  async function openGroup(device: string, roomId = 'room1'): Promise<string> {
    const res = await createGroup(device, roomId);
    if (res.status !== 201) throw new Error(`createGroup failed: ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }

  return {
    store,
    hub,
    app,
    join,
    stranger,
    role,
    send,
    list,
    purge,
    Permission,
    publish,
    supply,
    createGroup,
    openGroup,
    groupInfo,
    claim,
    handshake,
    handshakeLog,
    putTree,
    getTree,
    welcomes,
    ackWelcome,
  };
}

/** The server never looks inside these, so the tests use readable labels. */
export function b64(label: string): string {
  return Buffer.from(label, 'utf8').toString('base64');
}

export function unb64(s: string): string {
  return Buffer.from(s, 'base64').toString('utf8');
}

/**
 * A fake live connection, so a test can assert what the server pushed at a
 * device without opening a socket.
 */
export function wire(hub: { register(c: Connection): void }, devicePub: string, accountId: string) {
  const frames: any[] = [];
  const conn: Connection = { devicePub, accountId, send: (f) => frames.push(f) };
  hub.register(conn);
  return {
    conn,
    frames,
    ofOp: (op: string) => frames.filter((f) => f.op === op),
  };
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
