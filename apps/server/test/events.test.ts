import { everything, Permission, serialize } from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import { body, EVERYONE, harness } from './helpers.js';

describe('sending an event', () => {
  it('stores it and returns it with a server-assigned id', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const res = await h.send('dev-a', body());
    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.event.id).toMatch(/^\d+$/);
    expect(json.event.sender).toBe('dev-a');
    expect(json.stored).toBe(true);
  });

  it('refuses an unauthenticated request', async () => {
    const h = harness();
    const res = await h.app.request('/rooms/room1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body()),
    });
    expect(res.status).toBe(401);
  });

  it('refuses a device that is not in the room, without confirming it exists', async () => {
    // 404, not 403. The answer to "is this a real room" must not depend on
    // permissions the asker does not have — `docs/03` §4: a room you have no
    // audience for is one you never learn exists.
    const h = harness();
    h.stranger('mallory', 'dev-m');
    expect((await h.send('dev-m', body())).status).toBe(404);
  });

  it('refuses a revoked device', async () => {
    // "Sign out this device" has to mean it stops working immediately, not at
    // the next epoch (`docs/17`).
    const h = harness();
    h.join('alice', 'dev-a');
    h.store.devices.set('dev-a', {
      pub: 'dev-a',
      accountId: 'alice',
      label: 'test-device',
      registeredAt: 0,
      revokedAt: Date.now(),
    });
    expect((await h.send('dev-a', body())).status).toBe(401);
  });

  it('404s an unknown room without leaking whether it exists to a non-member', async () => {
    const h = harness();
    h.stranger('mallory', 'dev-m');
    expect((await h.send('dev-m', body(), 'nope')).status).toBe(404);
  });

  it('rejects a malformed body', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    expect((await h.send('dev-a', { nonsense: true })).status).toBe(400);
    expect((await h.send('dev-a', body({ epoch: -1 }))).status).toBe(400);
    expect((await h.send('dev-a', body({ class: 'urgent' }))).status).toBe(400);
  });

  it('refuses to SEND without the permission', async () => {
    const h = harness();
    const readonly = h.role('role-readonly', Permission.VIEW);
    h.join('alice', 'dev-a', [readonly]);
    const res = await h.send('dev-a', body());
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error).toBe('missing_permission');
  });
});

describe('idempotency', () => {
  it('returns the original event for a repeated nonce and does not fan out twice', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const received: unknown[] = [];
    h.hub.subscribe('room1', {
      devicePub: 'dev-b',
      accountId: 'bob',
      send: (f) => received.push(f),
    });

    const b = body();
    const first = (await (await h.send('dev-a', b)).json()) as any;
    const second = await h.send('dev-a', b);
    const secondJson = (await second.json()) as any;

    expect(second.status).toBe(200);
    expect(secondJson.deduped).toBe(true);
    expect(secondJson.event.id).toBe(first.event.id);
    // The important half: a retry after a dropped response must not show the
    // room the message twice.
    expect(received).toHaveLength(1);
  });

  it('scopes nonces per device, so two devices can pick the same one', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    const shared = body({ clientNonce: 'same-nonce-value' });
    const a = (await (await h.send('dev-a', shared)).json()) as any;
    const b = (await (await h.send('dev-b', shared)).json()) as any;
    expect(b.deduped).toBe(false);
    expect(a.event.id).not.toBe(b.event.id);
  });
});

describe('metadata hints the room did not opt into', () => {
  it('rejects a stream id when the room has stream paging off', async () => {
    const h = harness({ streamPaging: false });
    h.join('alice', 'dev-a');
    const res = await h.send('dev-a', body({ stream: '123' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe('stream_not_enabled');
  });

  it('accepts it when the room opted in', async () => {
    const h = harness({ streamPaging: true });
    h.join('alice', 'dev-a');
    expect((await h.send('dev-a', body({ stream: '123' }))).status).toBe(201);
  });

  it('rejects notify hints when the room has them off', async () => {
    const h = harness({ notifyHints: false });
    h.join('alice', 'dev-a');
    expect((await h.send('dev-a', body({ notify: ['1'] }))).status).toBe(400);
  });

  it('treats a room-wide notify list as @everyone and gates it', async () => {
    const h = harness({ notifyHints: true });
    h.join('alice', 'dev-a');
    const many = Array.from({ length: 40 }, (_, i) => String(i + 1));
    const res = await h.send('dev-a', body({ notify: many }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error).toBe('notify_everyone_denied');
  });

  it('allows it with MENTION_EVERYONE', async () => {
    const h = harness({ notifyHints: true });
    const shouty = h.role(
      'role-shouty',
      Permission.VIEW | Permission.SEND | Permission.MENTION_EVERYONE,
    );
    h.join('alice', 'dev-a', [shouty]);
    const many = Array.from({ length: 40 }, (_, i) => String(i + 1));
    expect((await h.send('dev-a', body({ notify: many }))).status).toBe(201);
  });
});

describe('ephemeral events', () => {
  it('are relayed but never stored', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const seen: unknown[] = [];
    h.hub.subscribe('room1', { devicePub: 'dev-b', accountId: 'bob', send: (f) => seen.push(f) });

    const res = await h.send('dev-a', body({ class: 'ephemeral' }));
    expect(res.status).toBe(202);
    expect(((await res.json()) as any).stored).toBe(false);
    expect(seen).toHaveLength(1);
    expect(await h.store.listEvents('room1')).toHaveLength(0);
  });
});

describe('reading and purging', () => {
  it('lists events newest-last and pages with before', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(((await (await h.send('dev-a', body())).json()) as any).event.id);
    }
    const all = (await (await h.list('dev-a')).json()) as any;
    expect(all.events.map((e: any) => e.id)).toEqual(ids);

    const page = (await (await h.list('dev-a', 'room1', `?before=${ids[2]}`)).json()) as any;
    expect(page.events.map((e: any) => e.id)).toEqual(ids.slice(0, 2));
  });

  it('refuses to list to a non-member, and answers as if the room were not there', async () => {
    const h = harness();
    h.stranger('mallory', 'dev-m');
    expect((await h.list('dev-m')).status).toBe(404);
  });

  it('purges bytes but keeps a tombstone, and tells live clients', async () => {
    const h = harness();
    const mod = h.role('role-mod', Permission.VIEW | Permission.SEND | Permission.MANAGE_EVENTS);
    h.join('alice', 'dev-a');
    h.join('mod', 'dev-mod', [mod]);
    const seen: any[] = [];
    h.hub.subscribe('room1', { devicePub: 'dev-b', accountId: 'bob', send: (f) => seen.push(f) });

    const id = ((await (await h.send('dev-a', body())).json()) as any).event.id;
    expect((await h.purge('dev-mod', id)).status).toBe(204);

    const after = (await (await h.list('dev-a')).json()) as any;
    const tomb = after.events.find((e: any) => e.id === id);
    expect(tomb.payload).toBe('');
    expect(tomb.purgedAt).toBeTypeOf('number');
    expect(seen.at(-1).d.purgedAt).toBeTypeOf('number');
  });

  it('refuses a purge without MANAGE_EVENTS', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const id = ((await (await h.send('dev-a', body())).json()) as any).event.id;
    expect((await h.purge('dev-a', id)).status).toBe(403);
  });
});

describe('the server does not understand what it stores', () => {
  it('accepts payloads it cannot possibly parse', async () => {
    // The property the whole design rests on: the server never looks inside.
    // Random bytes must be as acceptable as a real message.
    const h = harness();
    h.join('alice', 'dev-a');
    const random = new Uint8Array(512);
    for (let i = 0; i < random.length; i++) random[i] = (Math.random() * 256) | 0;
    const { encodePayload } = await import('@revel/protocol');
    const res = await h.send('dev-a', body({ payload: encodePayload(random) }));
    expect(res.status).toBe(201);
    const stored = (await h.store.listEvents('room1'))[0]!;
    expect(stored.payload).toBe(encodePayload(random));
  });

  it('an owner bypasses every role check', async () => {
    const h = harness();
    const nothing = h.role('role-nothing', 0n);
    h.join('boss', 'dev-boss', [nothing]);
    h.store.owners.add('space1:boss');
    expect((await h.send('dev-boss', body())).status).toBe(201);
  });
});
