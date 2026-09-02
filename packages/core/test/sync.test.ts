/**
 * The sync engine, against real crypto.
 *
 * The only fake here is the network. The MLS is real — `LocalCryptoEngine`
 * running the actual wasm — and so is the store, so these exercise the thing
 * that will ship rather than a mock of it. Two clients talk to each other
 * through a fake Host that behaves the way `apps/server` does: it assigns
 * snowflakes, dedupes by `clientNonce`, and fans out to whoever is listening.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LocalCryptoEngine } from '@revel/crypto';
import init from '@revel/crypto-wasm';
import type { Event, EventInput } from '@revel/protocol';
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type EventStream,
  MemoryStore,
  RoomSync,
  type SendResult,
  type Transport,
  TransportError,
  toAccountId,
} from '../src/index.js';

const WASM = fileURLToPath(new URL('../../crypto-wasm/revel_crypto_bg.wasm', import.meta.url));
const built = existsSync(WASM);
const describeIfBuilt = built ? describe : describe.skip;
if (!built) console.warn(`\n  ${WASM} is missing — run \`pnpm build:wasm\`.\n`);

// ---------------------------------------------------------------------------
// A Host, as far as a client can tell
// ---------------------------------------------------------------------------

/**
 * Behaves like `apps/server`: assigns ids, dedupes retries by nonce, stores,
 * fans out. Records what it was asked to do, so ordering can be asserted.
 */
class FakeHost implements Transport, EventStream {
  events = new Map<string, Event[]>();
  /** Every call, in order, across the whole system under test. */
  log: string[] = [];
  /** Set to make the next send fail. */
  failNext: { status: number; reason: string } | null = null;

  #next = 1767225600000000000n;
  #nonces = new Map<string, Event>();
  #listeners = new Map<string, Set<(e: Event) => void>>();

  async fetchEvents(
    roomId: string,
    options: { before?: string; after?: string; limit?: number } = {},
  ): Promise<Event[]> {
    this.log.push(`fetch ${roomId}`);
    let all = [...(this.events.get(roomId) ?? [])];
    // Forwards, from the oldest thing the caller has not seen — taken from the
    // *start* of the window, which is the whole difference between catching up
    // and re-reading the newest page.
    if (options.after) {
      const after = options.after as string;
      all = all.filter((e) => e.id > after);
      return options.limit === undefined ? all : all.slice(0, options.limit);
    }
    if (options.before) all = all.filter((e) => e.id < (options.before as string));
    if (options.limit !== undefined) all = all.slice(-options.limit);
    return all;
  }

  async send(roomId: string, input: EventInput, sender = 'device'): Promise<SendResult> {
    this.log.push(`send ${roomId}`);
    if (this.failNext) {
      const { status, reason } = this.failNext;
      this.failNext = null;
      throw new TransportError(status, reason);
    }

    const existing = this.#nonces.get(input.clientNonce);
    if (existing) return { event: existing, deduped: true, stored: true };

    const event: Event = {
      ...input,
      id: String(this.#next++),
      room: roomId,
      sender,
      size: input.payload.length,
      createdAt: Date.now(),
      purgedAt: null,
    };
    this.#nonces.set(input.clientNonce, event);

    if (input.class !== 'ephemeral') {
      const room = this.events.get(roomId) ?? [];
      room.push(event);
      this.events.set(roomId, room);
    }
    for (const listener of this.#listeners.get(roomId) ?? []) listener(event);
    return { event, deduped: false, stored: input.class !== 'ephemeral' };
  }

  subscribe(roomId: string, onEvent: (e: Event) => void): () => void {
    let set = this.#listeners.get(roomId);
    if (!set) {
      set = new Set();
      this.#listeners.set(roomId, set);
    }
    set.add(onEvent);
    return () => set.delete(onEvent);
  }

  /** The tombstone `apps/server` broadcasts after a purge. */
  purge(roomId: string, eventId: string): Event {
    const tombstone: Event = {
      id: eventId,
      room: roomId,
      sender: 'moderator-device',
      class: 'silent',
      epoch: 0,
      payload: '',
      size: 0,
      createdAt: Date.now(),
      purgedAt: Date.now(),
      clientNonce: `purge-${eventId}`,
    };
    for (const listener of this.#listeners.get(roomId) ?? []) listener(tombstone);
    return tombstone;
  }
}

/** A store that records its writes into a shared log, for ordering assertions. */
class LoggingStore extends MemoryStore {
  constructor(private readonly log: string[]) {
    super();
  }

  override async putSealed(
    kind: 'group' | 'keyPackages',
    id: string,
    bytes: Uint8Array,
  ): Promise<void> {
    this.log.push(`seal ${kind} ${id}`);
    await super.putSealed(kind, id, bytes);
  }
}

// ---------------------------------------------------------------------------
// Two clients in one group
// ---------------------------------------------------------------------------

interface Client {
  crypto: LocalCryptoEngine;
  store: MemoryStore;
  sync: RoomSync;
  account: string;
}

const ROOM = 'room-1';
const GROUP = 'group-1';

/**
 * The host as one device sees it, stamping that device onto what it sends.
 *
 * The real server sets `sender` from the authenticated actor, and the engine
 * checks its own echo against it — matching on the client nonce alone let a
 * Host place this device's message in a room of its choosing. A shared fake
 * that stamped one hardcoded name could not express that.
 */
function asDevice(host: FakeHost, devicePub: string): Transport & EventStream {
  return {
    fetchEvents: (roomId, options) => host.fetchEvents(roomId, options),
    send: (roomId, input) => host.send(roomId, input, devicePub),
    subscribe: (roomId, onEvent) => host.subscribe(roomId, onEvent),
  };
}

async function client(host: FakeHost, label: string, log: string[] = []): Promise<Client> {
  const crypto = new LocalCryptoEngine();
  const identity = await crypto.open({ deviceLabel: label });
  const account = toAccountId(identity.accountPublicKey);
  const store = new LoggingStore(log);
  const mine = asDevice(host, toAccountId(identity.devicePublicKey));

  let counter = 0;
  const sync = new RoomSync({
    crypto,
    store,
    transport: mine,
    stream: mine,
    account,
    nonce: () => `${label}-${++counter}`,
    now: () => 1_000_000,
  });
  await sync.bind(ROOM, GROUP);
  return { crypto, store, sync, account };
}

/** Alice opens a group and adds Bob, the long way, as a real client would. */
async function pair(host: FakeHost, log: string[] = []) {
  const alice = await client(host, 'alice', log);
  const bob = await client(host, 'bob', log);

  await alice.crypto.createGroup(GROUP);
  await alice.crypto.stageAdd(GROUP, await bob.crypto.keyPackage());
  const commit = await alice.crypto.commit(GROUP);
  await alice.crypto.applyPending(GROUP);
  await bob.crypto.joinGroup(commit.welcome as Uint8Array, commit.tree);

  await alice.sync.persistCrypto();
  await bob.sync.persistCrypto();
  return { alice, bob };
}

const bodyOf = (m: { body: unknown }) => m.body;

describeIfBuilt('RoomSync', () => {
  beforeAll(async () => {
    await init({ module_or_path: readFileSync(WASM) });
  });

  describe('binding a room to a group', () => {
    it('remembers the binding across a new engine over the same store', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);

      const second = new RoomSync({
        crypto: alice.crypto,
        store: alice.store,
        transport: host,
        account: alice.account,
      });
      expect(await second.groupFor(ROOM)).toBe(GROUP);
    });

    it('says so when a room was never bound', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);
      await expect(alice.sync.groupFor('unbound')).rejects.toThrow(/not bound to a group/);
    });
  });

  describe('sending', () => {
    it('carries a message from one client to the other', async () => {
      const host = new FakeHost();
      const { alice, bob } = await pair(host);

      await alice.sync.send(ROOM, { type: 'm.message', body: 'hello' });
      await bob.sync.catchUp(ROOM);

      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual(['hello']);
      // And it is attributed to Alice's account, from the MLS roster.
      expect(bob.sync.state(ROOM).messages[0]?.account).toBe(alice.account);
    });

    it('shows the message optimistically before the server has answered', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);

      const seen: string[] = [];
      alice.sync.watch(ROOM, (state) => {
        seen.push(state.messages.map((m) => `${m.id}:${m.pending ? 'pending' : 'live'}`).join(','));
      });

      await alice.sync.send(ROOM, { type: 'm.message', body: 'hello' });
      // First the optimistic copy, then the echo replacing it.
      expect(seen[0]).toMatch(/^local:alice-1:pending$/);
      expect(seen.at(-1)).toMatch(/:live$/);
      expect(alice.sync.state(ROOM).messages).toHaveLength(1);
    });

    it('replaces the optimistic copy rather than duplicating it', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'hello' });

      const messages = alice.sync.state(ROOM).messages;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.pending).toBeUndefined();
      expect(messages[0]?.id).not.toMatch(/^local:/);
    });

    it('marks the message failed and rethrows when the server refuses', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);
      host.failNext = { status: 403, reason: 'missing_permission' };

      await expect(alice.sync.send(ROOM, { type: 'm.message', body: 'nope' })).rejects.toThrow(
        /missing_permission/,
      );

      const [message] = alice.sync.state(ROOM).messages;
      expect(message?.pending).toBe(true);
      expect(message?.failed).toBe(true);
    });

    it('does not lose the message when the failure is retryable', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);
      host.failNext = { status: 503, reason: 'unavailable' };

      await alice.sync.send(ROOM, { type: 'm.message', body: 'later' }).catch(() => {});
      expect(alice.sync.state(ROOM).messages[0]?.failed).toBe(true);
      // A retryable failure is the one the UI offers a button for.
      expect(new TransportError(503, 'unavailable').retryable).toBe(true);
      expect(new TransportError(403, 'missing_permission').retryable).toBe(false);
    });
  });

  describe('the durability rule', () => {
    it('persists the new crypto state BEFORE the ciphertext leaves', async () => {
      // `docs/31` §7. Sending advances this device's position in the secret
      // tree, and the key and nonce come from that position — so a state that
      // reaches the network before it reaches the disk can be rewound by a
      // crash into reusing both.
      const log: string[] = [];
      const host = new FakeHost();
      host.log = log;
      const { alice } = await pair(host, log);

      log.length = 0;
      await alice.sync.send(ROOM, { type: 'm.message', body: 'ordered' });

      const sealed = log.indexOf(`seal group ${GROUP}`);
      const sent = log.indexOf(`send ${ROOM}`);
      expect(sealed).toBeGreaterThanOrEqual(0);
      expect(sent).toBeGreaterThanOrEqual(0);
      expect(sealed).toBeLessThan(sent);
    });

    it('sends nothing at all if the state cannot be persisted', async () => {
      // Burning a generation costs nothing. Sending from a state that was never
      // written down costs both messages that share the key and nonce.
      const host = new FakeHost();
      const { alice } = await pair(host);

      alice.store.putSealed = async () => {
        throw new Error('disk is full');
      };

      await expect(alice.sync.send(ROOM, { type: 'm.message', body: 'unsafe' })).rejects.toThrow(
        /disk is full/,
      );
      expect(host.log.filter((l) => l.startsWith('send'))).toHaveLength(0);
    });
  });

  describe('receiving', () => {
    it('applies live events from the stream', async () => {
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      bob.sync.listen(ROOM);
      await bob.sync.open(ROOM);

      await alice.sync.send(ROOM, { type: 'm.message', body: 'live' });
      await new Promise((r) => setTimeout(r, 10));

      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual(['live']);
      bob.sync.stopListening(ROOM);
    });

    it('is idempotent across the socket and a catch-up', async () => {
      // The overlap is the normal case: a socket delivers an event and then a
      // reconnect re-fetches the page it was in.
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      bob.sync.listen(ROOM);
      await bob.sync.open(ROOM);

      await alice.sync.send(ROOM, { type: 'm.message', body: 'once' });
      await new Promise((r) => setTimeout(r, 10));
      await bob.sync.catchUp(ROOM);

      expect(bob.sync.state(ROOM).messages).toHaveLength(1);
      bob.sync.stopListening(ROOM);
    });

    it('applies a purge tombstone to the message it names', async () => {
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'gone soon' });
      await bob.sync.catchUp(ROOM);

      const id = bob.sync.state(ROOM).messages[0]?.id as string;
      await bob.sync.receive(ROOM, host.purge(ROOM, id));

      const message = bob.sync.state(ROOM).byId.get(id);
      // A purge is the bytes being gone, not somebody deciding. Different fact,
      // different words in the UI.
      expect(message?.purged).toBe(true);
      expect(message?.body).toBe('');
      expect(message?.redacted).toBeUndefined();
    });

    it('keeps syncing when one message is undecryptable garbage', async () => {
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'before' });

      // Something in the room sent a payload that is not our JSON at all.
      await alice.crypto.encrypt(
        GROUP,
        new TextEncoder().encode('not json'),
        new TextEncoder().encode(`revel/room/v1\n${ROOM}`),
      );
      await alice.sync.persistCrypto();

      await alice.sync.send(ROOM, { type: 'm.message', body: 'after' });
      await bob.sync.catchUp(ROOM);
      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual(['before', 'after']);
    });
  });

  describe('opening and catching up', () => {
    it('opens from the local snapshot without touching the network', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'stored' });

      const fresh = new RoomSync({
        crypto: alice.crypto,
        store: alice.store,
        transport: host,
        account: alice.account,
      });
      host.log.length = 0;
      const state = await fresh.open(ROOM);

      expect(state.messages.map(bodyOf)).toEqual(['stored']);
      expect(host.log).toEqual([]);
    });

    it('rebuilds from the event log when there is no snapshot', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'from the log' });

      // The snapshot is a cache and is allowed to be missing; the log is not.
      await alice.store.putRoom({ ...(await alice.store.getRoom(ROOM)) } as never);
      const store = alice.store;
      const cached = await store.getRoom(ROOM);
      expect(cached).not.toBeNull();

      const withoutSnapshot = new MemoryStore();
      await withoutSnapshot.putEvents(ROOM, await store.listEvents(ROOM));
      await withoutSnapshot.put(`room:group:${ROOM}`, GROUP);

      const fresh = new RoomSync({
        crypto: alice.crypto,
        store: withoutSnapshot,
        transport: host,
        account: alice.account,
      });
      expect((await fresh.open(ROOM)).messages.map(bodyOf)).toEqual(['from the log']);
    });

    it('catches up past a single page, rather than losing the middle', async () => {
      // The bug: `catchUp` computed a cursor, updated it at the bottom of the
      // loop, and never sent it — so every iteration asked for the newest page
      // and the loop ended as soon as that page was applied. Anything older
      // than the last page was lost for good, because `backfill` only pages
      // *older* than the oldest event held, so nothing ever went looking.
      const host = new FakeHost();
      const { alice, bob } = await pair(host);

      // Bob is up to date, so he has a cursor — which is the situation this is
      // about. A client starting from nothing takes the newest page and pages
      // *backwards* on scroll, which is `backfill`'s job.
      await alice.sync.send(ROOM, { type: 'm.message', body: 'before' });
      await bob.sync.catchUp(ROOM, 5);

      // Then he goes away, and misses more than one page.
      for (let i = 0; i < 12; i++) {
        await alice.sync.send(ROOM, { type: 'm.message', body: `m${i}` });
      }

      await bob.sync.catchUp(ROOM, 5);
      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual([
        'before',
        ...Array.from({ length: 12 }, (_, i) => `m${i}`),
      ]);
    });

    it('refuses an event the Host serves under the wrong room', async () => {
      // Every room in a space sharing an audience shares one MLS group, so a
      // message from a sibling room decrypts perfectly here. The only thing
      // that ever said which room it belonged to was the envelope, and the
      // envelope is the Host's.
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'for this room only' });

      const [sent] = host.events.get(ROOM) as [Event];
      // The same ciphertext, relabelled.
      const moved = { ...sent, id: '9999999999999999999', room: 'room-2' };
      await bob.sync.bind('room-2', GROUP).catch(() => {});
      await bob.sync.receive('room-2', moved);

      expect(bob.sync.state('room-2').messages).toHaveLength(0);
    });

    it('catches up on everything sent while away', async () => {
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      for (const body of ['one', 'two', 'three']) {
        await alice.sync.send(ROOM, { type: 'm.message', body });
      }

      await bob.sync.catchUp(ROOM);
      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual(['one', 'two', 'three']);
    });

    it('does not re-apply what it already has', async () => {
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'one' });
      await bob.sync.catchUp(ROOM);
      await bob.sync.catchUp(ROOM);
      expect(bob.sync.state(ROOM).messages).toHaveLength(1);
    });
  });

  describe('a reload', () => {
    it('comes back able to read the room and to send into it', async () => {
      // The whole stack: real MLS, a real store, and nothing carried over but
      // the bytes a client would have written down.
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'before the reload' });
      await bob.sync.catchUp(ROOM);

      const accountSecret = await alice.crypto.exportAccountSecret();
      const deviceSecret = await alice.crypto.exportDeviceSecret();
      const store = alice.store;
      await alice.crypto.close();

      // A new page: new crypto engine, same store.
      const crypto = new LocalCryptoEngine();
      await crypto.open({ accountSecret, deviceSecret, deviceLabel: 'alice' });
      const sync = new RoomSync({
        crypto,
        store,
        transport: host,
        account: alice.account,
        nonce: () => 'alice-reloaded',
        now: () => 2_000_000,
      });

      expect(await sync.restoreCrypto()).toContain(GROUP);
      await sync.loadGroup(ROOM);

      expect((await sync.open(ROOM)).messages.map(bodyOf)).toEqual(['before the reload']);

      await sync.send(ROOM, { type: 'm.message', body: 'after the reload' });
      await bob.sync.catchUp(ROOM);
      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual([
        'before the reload',
        'after the reload',
      ]);
    });

    it('restores a pending invite too', async () => {
      const host = new FakeHost();
      const alice = await client(host, 'alice');
      await alice.crypto.createGroup(GROUP);

      const carol = await client(host, 'carol');
      const keyPackage = await carol.crypto.keyPackage();
      await carol.sync.persistCrypto();

      const accountSecret = await carol.crypto.exportAccountSecret();
      const deviceSecret = await carol.crypto.exportDeviceSecret();
      await carol.crypto.close();

      // Added while away.
      await alice.crypto.stageAdd(GROUP, keyPackage);
      const commit = await alice.crypto.commit(GROUP);
      await alice.crypto.applyPending(GROUP);

      const crypto = new LocalCryptoEngine();
      await crypto.open({ accountSecret, deviceSecret, deviceLabel: 'carol' });
      const sync = new RoomSync({ crypto, store: carol.store, transport: host, account: 'carol' });
      await sync.restoreCrypto();

      // Without the key package secret this Welcome could not be opened.
      await expect(
        crypto.joinGroup(commit.welcome as Uint8Array, commit.tree),
      ).resolves.toMatchObject({
        groupId: GROUP,
      });
    });
  });

  describe('catching up everything at once', () => {
    it('catches up every room it has open', async () => {
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      await bob.sync.open(ROOM);

      await alice.sync.send(ROOM, { type: 'm.message', body: 'while away' });
      await bob.sync.catchUpAll();

      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual(['while away']);
    });

    it('does not let one room stop the others', async () => {
      // A room whose membership was revoked while we were offline refuses
      // forever; it must not take the rest of the app down with it.
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      await bob.sync.open(ROOM);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'still works' });

      const failing = 'room-gone';
      await bob.sync.bind(failing, 'group-gone');
      await bob.sync.open(failing);
      const original = host.fetchEvents.bind(host);
      host.fetchEvents = async (roomId, options) => {
        if (roomId === failing) throw new TransportError(403, 'not_a_member');
        return original(roomId, options);
      };

      await expect(bob.sync.catchUpAll()).resolves.toBeUndefined();
      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual(['still works']);
    });
  });

  describe('a socket that dropped', () => {
    it('closes the gap it could not deliver', async () => {
      // The whole reason `onReconnect` exists. A socket cannot replay, so a
      // client that reconnects and says nothing loses everything that arrived
      // while it was down — and the room looks fine, which is worse.
      const host = new FakeHost();
      const { alice, bob } = await pair(host);
      const stop = host.subscribe(ROOM, (event) => {
        void bob.sync.receive(ROOM, event);
      });
      await bob.sync.open(ROOM);

      await alice.sync.send(ROOM, { type: 'm.message', body: 'delivered' });
      await new Promise((r) => setTimeout(r, 10));
      expect(bob.sync.state(ROOM).messages).toHaveLength(1);

      // The socket goes away, and two messages arrive that nobody delivers.
      stop();
      await alice.sync.send(ROOM, { type: 'm.message', body: 'missed one' });
      await alice.sync.send(ROOM, { type: 'm.message', body: 'missed two' });
      expect(bob.sync.state(ROOM).messages).toHaveLength(1);

      // Which is exactly what a reconnect has to do about it.
      await bob.sync.catchUpAll();
      expect(bob.sync.state(ROOM).messages.map(bodyOf)).toEqual([
        'delivered',
        'missed one',
        'missed two',
      ]);
    });
  });

  describe('watching', () => {
    it('notifies and then stops when unsubscribed', async () => {
      const host = new FakeHost();
      const { alice } = await pair(host);

      let calls = 0;
      const stop = alice.sync.watch(ROOM, () => calls++);
      await alice.sync.send(ROOM, { type: 'm.message', body: 'one' });
      const during = calls;
      expect(during).toBeGreaterThan(0);

      stop();
      await alice.sync.send(ROOM, { type: 'm.message', body: 'two' });
      expect(calls).toBe(during);
    });
  });
});

describe('toAccountId', () => {
  it('is url-safe and unpadded, so it survives being a key or a fragment', () => {
    const bytes = Uint8Array.from([251, 255, 190, 0, 1, 2]);
    const id = toAccountId(bytes);
    expect(id).not.toMatch(/[+/=]/);
    expect(toAccountId(bytes)).toBe(id);
    expect(toAccountId(Uint8Array.from([1]))).not.toBe(id);
  });
});
