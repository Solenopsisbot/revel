/**
 * Waking a device that is not listening.
 *
 * Almost every test here is about somebody who **does not** get woken, because
 * that is where the whole design is: a push carries nothing, so the only thing
 * it can leak is the fact that it happened, and the only defence is being
 * careful about who it happens to.
 */
import {
  DEFAULT_EVERYONE,
  Permission,
  PushSubscription,
  SnowflakeFactory,
  serialize,
} from '@revel/protocol';
import { createApp, Hub, MemoryStore, notify, type PushSender } from '@revel/server';
import { describe, expect, it } from 'vitest';

const ALICE = 'k7Yb3QzL0pW9xNvR2sTgHfMdEcJaUiOb1nKlPqRsTuV';
const BOB = 'Qa2Wd4Rf6Tg8Yh0Uj1Ik3Ol5Pz7Xc9Vb2Nm4As6Dfg';

/** Records what it was asked to send, and nothing else — like a push service. */
function recorder() {
  const sent: { endpoint: string; hint: { room?: string } }[] = [];
  const sender: PushSender = {
    async send(subscription, hint) {
      sent.push({ endpoint: subscription.endpoint, hint });
    },
  };
  return { sender, sent };
}

async function world(opts: { includeRoom?: boolean } = {}) {
  const store = new MemoryStore();
  const hub = new Hub();
  const { sender, sent } = recorder();

  store.rooms.set('9001', {
    id: '9001',
    kind: 'group',
    spaceId: 'space1',
    groupId: null,
    streamPaging: false,
    notifyHints: false,
  });
  store.roles.set('role-everyone', {
    id: 'role-everyone',
    spaceId: 'space1',
    bits: serialize(DEFAULT_EVERYONE),
    position: 0,
  });

  const device = (pub: string, accountId: string) =>
    store.devices.set(pub, { pub, accountId, label: 'x', registeredAt: 0, revokedAt: null });
  device('dev-a', ALICE);
  device('dev-b', BOB);
  device('dev-b2', BOB);
  for (const account of [ALICE, BOB]) {
    await store.addMember('9001', account, ['role-everyone']);
  }
  for (const pub of ['dev-a', 'dev-b', 'dev-b2']) {
    await store.putPushSubscription({
      devicePub: pub,
      kind: 'webpush',
      endpoint: `https://push.example/${pub}`,
      createdAt: 0,
    });
  }

  const app = createApp({
    store,
    hub,
    ids: new SnowflakeFactory(1),
    push: { sender, ...(opts.includeRoom ? { includeRoom: true } : {}) },
    async authenticate(req) {
      const pub = req.headers.get('x-revel-device');
      if (!pub) return null;
      const found = await store.getDevice(pub);
      return found && !found.revokedAt
        ? { accountId: found.accountId, devicePub: found.pub }
        : null;
    },
  });

  const send = (device: string, cls: 'normal' | 'silent' | 'ephemeral' = 'normal') =>
    app.request('/rooms/9001/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revel-device': device },
      body: JSON.stringify({
        epoch: 1,
        class: cls,
        payload: btoa('ciphertext'),
        clientNonce: `push-${Math.random().toString(36).slice(2)}-abcdefgh`,
      }),
    });

  return { store, hub, app, sender, sent, send };
}

const online = (hub: Hub, devicePub: string) =>
  hub.register({ devicePub, accountId: 'x', send: () => {} });

describe('who gets woken', () => {
  it('everybody in the room who is not listening', async () => {
    const w = await world();
    await w.send('dev-a');
    expect(w.sent.map((s) => s.endpoint).sort()).toEqual([
      'https://push.example/dev-b',
      'https://push.example/dev-b2',
    ]);
  });

  it('not a device that already has a socket', async () => {
    // It already has the event. Pushing anyway doubles every message and tells
    // the push service about traffic it would otherwise never see.
    const w = await world();
    online(w.hub, 'dev-b');
    await w.send('dev-a');
    expect(w.sent.map((s) => s.endpoint)).toEqual(['https://push.example/dev-b2']);
  });

  it('not the sender, and not the sender‘s other devices', async () => {
    // Bob has two devices. Sending from one must not buzz the other: he sent
    // it, which is the strongest possible signal that he has seen it. This is
    // an account-level rule, not a device-level one, and writing it at the
    // device level is how a laptop ends up notifying you about your own phone.
    const w = await world();
    await w.send('dev-b');
    expect(w.sent.map((s) => s.endpoint)).toEqual(['https://push.example/dev-a']);
  });

  it('not a device that has been signed out', async () => {
    const w = await world();
    await w.store.revokeDevice('dev-b', Date.now());
    await w.send('dev-a');
    expect(w.sent.map((s) => s.endpoint)).toEqual(['https://push.example/dev-b2']);
  });

  it('not somebody who is not in the room', async () => {
    const w = await world();
    await w.store.removeMember('9001', BOB);
    await w.send('dev-a');
    expect(w.sent).toEqual([]);
  });

  it('not a device that never asked to be', async () => {
    const w = await world();
    await w.store.deletePushSubscription('dev-b2');
    await w.send('dev-a');
    expect(w.sent.map((s) => s.endpoint)).toEqual(['https://push.example/dev-b']);
  });
});

describe('what wakes them', () => {
  it('a normal event', async () => {
    const w = await world();
    await w.send('dev-a', 'normal');
    expect(w.sent).toHaveLength(2);
  });

  it('never a silent one', async () => {
    // `docs/04` §2: silent means stored and never notifies. A read receipt that
    // woke a phone would be the most annoying feature ever shipped, and a
    // reaction that did would be the second.
    const w = await world();
    await w.send('dev-a', 'silent');
    expect(w.sent).toEqual([]);
  });

  it('never an ephemeral one', async () => {
    const w = await world();
    await w.send('dev-a', 'ephemeral');
    expect(w.sent).toEqual([]);
  });

  it('never a retry that was deduplicated', async () => {
    // A dropped response is not a second message, and must not be a second
    // buzz on somebody's phone.
    const w = await world();
    const body = {
      epoch: 1,
      class: 'normal',
      payload: btoa('ciphertext'),
      clientNonce: 'the-same-nonce-twice',
    };
    const post = () =>
      w.app.request('/rooms/9001/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revel-device': 'dev-a' },
        body: JSON.stringify(body),
      });
    await post();
    await post();
    expect(w.sent).toHaveLength(2);
  });
});

describe('what a push may say', () => {
  it('nothing at all, by default', async () => {
    // The strongest reading of "content-free" (`docs/04` §5): a push with no
    // body needs no payload encryption and tells the push service nothing
    // beyond "this endpoint had something happen".
    const w = await world();
    await w.send('dev-a');
    expect(w.sent.map((s) => s.hint)).toEqual([{}, {}]);
  });

  it('a room id, when a deployment turns that on', async () => {
    const w = await world({ includeRoom: true });
    await w.send('dev-a');
    expect(w.sent[0]?.hint).toEqual({ room: '9001' });
  });

  it('never a sender, a count, or a word of content', async () => {
    // The server has none of those and must not learn to want them.
    const w = await world({ includeRoom: true });
    await w.send('dev-a');
    const wire = JSON.stringify(w.sent);
    expect(wire).not.toContain('ciphertext');
    expect(wire).not.toContain('dev-a');
    expect(Object.keys(w.sent[0]?.hint as object)).toEqual(['room']);
  });
});

describe('subscribing', () => {
  const put = (app: ReturnType<typeof createApp>, device: string, body: unknown) =>
    app.request('/push/subscription', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-revel-device': device },
      body: JSON.stringify(body),
    });

  it('registers where to wake this device', async () => {
    const w = await world();
    const res = await put(w.app, 'dev-a', {
      kind: 'webpush',
      endpoint: 'https://push.example/new',
    });
    expect(res.status).toBe(204);
    expect((await w.store.getPushSubscription('dev-a'))?.endpoint).toBe('https://push.example/new');
  });

  it('replaces rather than accumulating', async () => {
    // A device has one push channel. Keeping the old one means waking a
    // browser profile somebody deleted.
    const w = await world();
    await put(w.app, 'dev-a', { kind: 'webpush', endpoint: 'https://push.example/one' });
    await put(w.app, 'dev-a', { kind: 'webpush', endpoint: 'https://push.example/two' });
    expect((await w.store.getPushSubscription('dev-a'))?.endpoint).toBe('https://push.example/two');
  });

  it('is per device, never per account', async () => {
    // `docs/17`: account switching uses "separate device keys, separate
    // sessions, **separate push subscriptions**", because a shared token across
    // accounts is the correlation leak that would undo unlinkability.
    const w = await world();
    await put(w.app, 'dev-b', { kind: 'webpush', endpoint: 'https://push.example/phone' });
    expect((await w.store.getPushSubscription('dev-b2'))?.endpoint).toBe(
      'https://push.example/dev-b2',
    );
  });

  it('is dropped when the device is signed out', async () => {
    // The one action whose entire purpose is "stop talking to that device"
    // must not leave the loudest channel open.
    const w = await world();
    await w.store.revokeDevice('dev-b', Date.now());
    expect(await w.store.getPushSubscription('dev-b')).toBeNull();
  });

  it('can be withdrawn', async () => {
    const w = await world();
    const res = await w.app.request('/push/subscription', {
      method: 'DELETE',
      headers: { 'x-revel-device': 'dev-a' },
    });
    expect(res.status).toBe(204);
    expect(await w.store.getPushSubscription('dev-a')).toBeNull();
  });

  it('needs a session, and refuses nonsense', async () => {
    const w = await world();
    expect((await w.app.request('/push/subscription', { method: 'PUT' })).status).toBe(401);
    expect((await put(w.app, 'dev-a', { kind: 'carrier-pigeon' })).status).toBe(400);
  });

  it('accepts the shape the protocol describes', async () => {
    expect(
      PushSubscription.safeParse({
        kind: 'webpush',
        endpoint: 'https://push.example/x',
        keys: { p256dh: 'a', auth: 'b' },
      }).success,
    ).toBe(true);
  });
});

describe('with no sender configured', () => {
  it('wakes nobody, which is a working deployment', async () => {
    // Everything arrives on the next open. Poor on a phone; not broken.
    const store = new MemoryStore();
    const hub = new Hub();
    expect(
      await notify(
        { store, hub },
        {
          id: '1',
          room: '9001',
          sender: 'dev-a',
          class: 'normal',
          epoch: 1,
          payload: '',
          size: 0,
          createdAt: 0,
          purgedAt: null,
          clientNonce: 'nonce-abcdefgh',
        },
      ),
    ).toEqual([]);
  });
});
