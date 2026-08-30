/**
 * The transport — first on its own, then against the real server.
 *
 * The second half is the only place in the repo where the client and the Host
 * are in the same process. Everything else tests one side against an
 * understanding of the other, which is exactly how two halves of a protocol
 * drift apart: both suites pass, and the contract they each assume is not the
 * same contract.
 *
 * `@revel/server` is a devDependency of this package for that reason and no
 * other. A client does not depend on a server; a test of an agreement depends
 * on both parties to it.
 */

import {
  DEFAULT_EVERYONE,
  encodePayload,
  Permission,
  SnowflakeFactory,
  serialize,
} from '@revel/protocol';
import { createApp, Hub, MemoryStore as ServerStore } from '@revel/server';
import { describe, expect, it } from 'vitest';
import { HttpTransport, TransportError } from '../src/index.js';

// ---------------------------------------------------------------------------
// On its own, against a stub
// ---------------------------------------------------------------------------

/** Records what it was called with, and answers however the test wants. */
function stub(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(url, init);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'text/json' } });

describe('HttpTransport', () => {
  it('builds the history URL, with paging when asked for it', async () => {
    const { calls, fetch } = stub(() => ok({ events: [] }));
    const transport = new HttpTransport({ baseUrl: 'https://host.example', fetch });

    await transport.fetchEvents('room1');
    await transport.fetchEvents('room1', { before: '99', limit: 25 });

    expect(calls[0]?.url).toBe('https://host.example/rooms/room1/events');
    expect(calls[1]?.url).toBe('https://host.example/rooms/room1/events?before=99&limit=25');
  });

  it('escapes a room id rather than pasting it into a path', async () => {
    const { calls, fetch } = stub(() => ok({ events: [] }));
    await new HttpTransport({ baseUrl: 'https://host.example', fetch }).fetchEvents('a/b?c');
    expect(calls[0]?.url).toBe('https://host.example/rooms/a%2Fb%3Fc/events');
  });

  it('does not care whether the base URL has a trailing slash', async () => {
    const { calls, fetch } = stub(() => ok({ events: [] }));
    await new HttpTransport({ baseUrl: 'https://host.example///', fetch }).fetchEvents('r');
    expect(calls[0]?.url).toBe('https://host.example/rooms/r/events');
  });

  it('asks for credentials on every request, not once at construction', async () => {
    // A device-key challenge-response produces a token with a lifetime
    // (`docs/17` §2). A transport that captured one would start failing an
    // hour in, on a schedule nobody would connect to the transport.
    let token = 'first';
    const { calls, fetch } = stub(() => ok({ events: [] }));
    const transport = new HttpTransport({
      baseUrl: 'https://host.example',
      fetch,
      headers: () => ({ authorization: token }),
    });

    await transport.fetchEvents('r');
    token = 'second';
    await transport.fetchEvents('r');

    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('first');
    expect((calls[1]?.init.headers as Record<string, string>).authorization).toBe('second');
  });

  it('reports the server’s own reason for a refusal', async () => {
    const { fetch } = stub(
      () => new Response(JSON.stringify({ error: 'not_a_member' }), { status: 403 }),
    );
    const transport = new HttpTransport({ baseUrl: 'https://host.example', fetch });

    await expect(transport.fetchEvents('r')).rejects.toThrow(/not_a_member/);
    await expect(transport.fetchEvents('r')).rejects.toBeInstanceOf(TransportError);
  });

  it('still says something useful when the refusal came from a proxy', async () => {
    // A captive portal or a load balancer answers with HTML, not our JSON.
    const { fetch } = stub(() => new Response('<html>go away</html>', { status: 502 }));
    const transport = new HttpTransport({ baseUrl: 'https://host.example', fetch });
    await expect(transport.fetchEvents('r')).rejects.toThrow(/http_502/);
  });

  it('knows which failures are worth a retry button', async () => {
    // The difference decides whether a failed send offers a retry or an
    // explanation. A 403 will still be a 403 in ten seconds.
    expect(new TransportError(500, 'x').retryable).toBe(true);
    expect(new TransportError(503, 'x').retryable).toBe(true);
    expect(new TransportError(429, 'x').retryable).toBe(true);
    expect(new TransportError(408, 'x').retryable).toBe(true);
    expect(new TransportError(403, 'x').retryable).toBe(false);
    expect(new TransportError(401, 'x').retryable).toBe(false);
    expect(new TransportError(400, 'x').retryable).toBe(false);
    expect(new TransportError(404, 'x').retryable).toBe(false);
  });

  it('defaults `deduped` and `stored` when a server omits them', async () => {
    const { fetch } = stub(() => ok({ event: { id: '1' } }));
    const transport = new HttpTransport({ baseUrl: 'https://host.example', fetch });
    const result = await transport.send('r', {
      epoch: 1,
      class: 'normal',
      payload: '',
      clientNonce: 'nonce-abcdefgh',
    });
    expect(result).toMatchObject({ deduped: false, stored: true });
  });
});

// ---------------------------------------------------------------------------
// Against the real server
// ---------------------------------------------------------------------------

const DEVICE = 'device-pub-alice';
const STRANGER = 'device-pub-nobody';

/** The same shape as `apps/server`'s own harness, wired to a client transport. */
function host() {
  const store = new ServerStore();
  const hub = new Hub();

  store.rooms.set('room1', {
    id: 'room1',
    spaceId: 'space1',
    streamPaging: false,
    notifyHints: false,
  });
  store.roles.set('role-everyone', {
    id: 'role-everyone',
    spaceId: 'space1',
    bits: serialize(DEFAULT_EVERYONE),
    position: 0,
  });
  store.devices.set(DEVICE, { pub: DEVICE, accountId: 'account-alice', revokedAt: null });
  store.memberships.set('room1:account-alice', {
    roomId: 'room1',
    accountId: 'account-alice',
    roleIds: ['role-everyone'],
  });
  store.devices.set(STRANGER, { pub: STRANGER, accountId: 'account-nobody', revokedAt: null });

  const app = createApp({
    store,
    hub,
    ids: new SnowflakeFactory(1),
    async authenticate(req) {
      const pub = req.headers.get('x-revel-device');
      if (!pub) return null;
      const device = await store.getDevice(pub);
      if (!device || device.revokedAt) return null;
      return { accountId: device.accountId, devicePub: device.pub };
    },
  });

  const transportAs = (device: string | null) =>
    new HttpTransport({
      baseUrl: 'http://host',
      headers: () => (device ? { 'x-revel-device': device } : {}),
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        app.fetch(new Request(String(input), init))) as typeof globalThis.fetch,
    });

  return { store, hub, app, transportAs };
}

const payload = (text: string) => encodePayload(new TextEncoder().encode(text));

let nonces = 0;
const nonce = () => `nonce-${++nonces}-abcdefgh`;

describe('HttpTransport against the real server', () => {
  it('sends an event and gets it back with a server-assigned id', async () => {
    const transport = host().transportAs(DEVICE);
    const result = await transport.send('room1', {
      epoch: 1,
      class: 'normal',
      payload: payload('ciphertext'),
      clientNonce: nonce(),
    });

    expect(result.stored).toBe(true);
    expect(result.deduped).toBe(false);
    expect(result.event.id).toMatch(/^\d+$/);
    expect(result.event.room).toBe('room1');
    expect(result.event.sender).toBe(DEVICE);
  });

  it('treats a retry with the same nonce as the same event', async () => {
    // The property that makes a dropped response safe to retry, agreed on by
    // both sides rather than assumed by one.
    const transport = host().transportAs(DEVICE);
    const input = {
      epoch: 1,
      class: 'normal' as const,
      payload: payload('once'),
      clientNonce: nonce(),
    };

    const first = await transport.send('room1', input);
    const second = await transport.send('room1', input);

    expect(second.deduped).toBe(true);
    expect(second.event.id).toBe(first.event.id);
    expect(await transport.fetchEvents('room1')).toHaveLength(1);
  });

  it('reads history back in order', async () => {
    const transport = host().transportAs(DEVICE);
    for (const text of ['one', 'two', 'three']) {
      await transport.send('room1', {
        epoch: 1,
        class: 'normal',
        payload: payload(text),
        clientNonce: nonce(),
      });
    }

    const events = await transport.fetchEvents('room1');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.id)).toEqual([...events.map((e) => e.id)].sort());
  });

  it('pages backwards with `before`', async () => {
    const transport = host().transportAs(DEVICE);
    const ids: string[] = [];
    for (const text of ['one', 'two', 'three']) {
      const { event } = await transport.send('room1', {
        epoch: 1,
        class: 'normal',
        payload: payload(text),
        clientNonce: nonce(),
      });
      ids.push(event.id);
    }

    const older = await transport.fetchEvents('room1', { before: ids[2] });
    expect(older.map((e) => e.id)).toEqual([ids[0], ids[1]]);
  });

  it('does not store an ephemeral event', async () => {
    // Typing must not cost a row. `docs/03` §7 is the whole reason the class
    // exists, and this is the two sides agreeing about it.
    const transport = host().transportAs(DEVICE);
    const result = await transport.send('room1', {
      epoch: 1,
      class: 'ephemeral',
      payload: payload('typing'),
      clientNonce: nonce(),
    });

    expect(result.stored).toBe(false);
    expect(await transport.fetchEvents('room1')).toHaveLength(0);
  });

  it('refuses an unauthenticated request', async () => {
    const transport = host().transportAs(null);
    await expect(transport.fetchEvents('room1')).rejects.toMatchObject({
      status: 401,
      reason: 'unauthenticated',
    });
  });

  it('refuses a device that is not in the room', async () => {
    const transport = host().transportAs(STRANGER);
    await expect(transport.fetchEvents('room1')).rejects.toMatchObject({ reason: 'not_a_member' });
  });

  it('does not tell a non-member whether an unknown room exists', async () => {
    // A 404 for a room you cannot see and a 404 for a room that is not there
    // have to be the same answer, or the difference is a directory.
    const transport = host().transportAs(STRANGER);
    await expect(transport.fetchEvents('no-such-room')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a stream hint the room did not opt into', async () => {
    const transport = host().transportAs(DEVICE);
    await expect(
      transport.send('room1', {
        epoch: 1,
        class: 'normal',
        payload: payload('x'),
        clientNonce: nonce(),
        stream: '12345',
      }),
    ).rejects.toMatchObject({ reason: 'stream_not_enabled' });
  });

  it('rejects a body the schema will not accept', async () => {
    const transport = host().transportAs(DEVICE);
    await expect(
      // A nonce below the minimum length — the client should not be able to
      // send this, and the server should not accept it if it does.
      transport.send('room1', {
        epoch: 1,
        class: 'normal',
        payload: payload('x'),
        clientNonce: 'short',
      }),
    ).rejects.toMatchObject({ status: 400, reason: 'invalid_event' });
  });

  it('is refused when the sending device has been revoked', async () => {
    const { store, transportAs } = host();
    store.devices.set(DEVICE, { pub: DEVICE, accountId: 'account-alice', revokedAt: Date.now() });

    await expect(transportAs(DEVICE).fetchEvents('room1')).rejects.toMatchObject({ status: 401 });
  });

  it('needs SEND to send, and only VIEW to read', async () => {
    const { store, transportAs } = host();
    // A role with everything except SEND.
    store.roles.set('role-everyone', {
      id: 'role-everyone',
      spaceId: 'space1',
      bits: serialize(DEFAULT_EVERYONE & ~Permission.SEND),
      position: 0,
    });

    const transport = transportAs(DEVICE);
    await expect(transport.fetchEvents('room1')).resolves.toEqual([]);
    await expect(
      transport.send('room1', {
        epoch: 1,
        class: 'normal',
        payload: payload('x'),
        clientNonce: nonce(),
      }),
    ).rejects.toMatchObject({ reason: 'missing_permission', status: 403 });
  });
});
