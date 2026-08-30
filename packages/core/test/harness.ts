/**
 * The multi-client harness.
 *
 * `docs/29` §4 calls this "the project's actual safety net" and "the one that
 * would have caught Kith's bugs": N in-process clients, a real server, and
 * scripted scenarios for the things that only go wrong when several people are
 * doing several things at once — own-leaf commits, Welcome lag, commit races,
 * device revocation mid-conversation, offline reconnect with queued sends.
 *
 * Nothing here is a mock. The MLS is real (`LocalCryptoEngine` over the actual
 * wasm), the store is real, the server is `apps/server` in the same process,
 * and the socket is the real `WebSocketStream` talking to the real
 * `SocketSession` through a pipe instead of a TCP connection. The only thing
 * simulated is the wire, and only so a test does not need a port.
 *
 * ## Using it
 *
 * ```ts
 * const world = await World.create();
 * const alice = await world.join('alice');
 * const bob = await world.join('bob');
 * const room = world.room();
 *
 * const group = await alice.open(room);
 * await alice.invite(group, [bob.account]);
 * await world.settle();
 *
 * await bob.sync();
 * await bob.bind(room, group);
 * await alice.say(room, 'hello');
 * await world.settle();
 *
 * expect(bob.texts(room)).toEqual(['hello']);
 * ```
 *
 * `settle()` is the one piece of ceremony. Delivery is asynchronous — a frame
 * arrives, a handler kicks off a decrypt — and a test that asserted immediately
 * after `say()` would be asserting about a message still in flight.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LocalCryptoEngine } from '@revel/crypto';
import init from '@revel/crypto-wasm';
import {
  DEFAULT_EVERYONE,
  Permission,
  SnowflakeFactory,
  serialize,
  toBase64,
} from '@revel/protocol';
import {
  type Actor,
  createApp,
  Hub,
  MemoryStore as ServerStore,
  SocketSession,
} from '@revel/server';
import {
  GroupSync,
  HttpGroupTransport,
  HttpTransport,
  MemoryStore,
  type Message,
  RoomSync,
  type SocketLike,
  toAccountId,
  WebSocketStream,
} from '../src/index.js';

const WASM = fileURLToPath(new URL('../../crypto-wasm/revel_crypto_bg.wasm', import.meta.url));

/** Whether the wasm has been built. Suites skip themselves rather than fail. */
export const wasmBuilt = existsSync(WASM);

let started: Promise<unknown> | null = null;
export function startWasm(): Promise<unknown> {
  started ??= init({ module_or_path: readFileSync(WASM) });
  return started;
}

const SPACE = 'space1';
const EVERYONE = 'role-everyone';

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export class World {
  readonly store = new ServerStore();
  readonly hub = new Hub();
  readonly ids = new SnowflakeFactory(1);
  readonly app: ReturnType<typeof createApp>;
  readonly clients: Client[] = [];

  /** Promises kicked off by socket callbacks, which nobody is awaiting. */
  readonly pending: Promise<unknown>[] = [];

  #rooms = 9000;

  private constructor() {
    this.store.roles.set(EVERYONE, {
      id: EVERYONE,
      spaceId: SPACE,
      bits: serialize(DEFAULT_EVERYONE),
      position: 0,
    });

    this.app = createApp({
      store: this.store,
      hub: this.hub,
      ids: this.ids,
      // The device-key challenge-response is `docs/17` §2 and does not exist
      // yet. What matters for these scenarios is that a request is attributable
      // to a device and that a revoked device stops working — both of which are
      // true here.
      authenticate: async (req) => {
        const pub = req.headers.get('x-revel-device');
        if (!pub) return null;
        const device = await this.store.getDevice(pub);
        if (!device || device.revokedAt) return null;
        return { accountId: device.accountId, devicePub: device.pub };
      },
    });
  }

  static async create(): Promise<World> {
    await startWasm();
    return new World();
  }

  /**
   * Start a DM the way a person does: through the server, no store poking.
   *
   * `room()` below is the shortcut for scenarios that are about something else
   * — it invents a space room and puts everyone in it. This is the real path,
   * and the difference matters for any scenario about *starting* a
   * conversation rather than having one.
   */
  async dm(from: Client, to: Client): Promise<string> {
    return (await from.transport.createDm(to.account)).id;
  }

  async groupRoom(from: Client, others: Client[]): Promise<string> {
    return (await from.transport.createGroupRoom(others.map((o) => o.account))).id;
  }

  /** A room in the shared space, with everyone who has joined so far in it. */
  room(): string {
    const id = String(++this.#rooms);
    this.store.rooms.set(id, {
      id,
      kind: 'space',
      spaceId: SPACE,
      groupId: null,
      streamPaging: false,
      notifyHints: false,
    });
    for (const client of this.clients) this.admit(client, id);
    return id;
  }

  /** Put an account in a room. Room membership is not group membership. */
  admit(client: Client, roomId: string, roleIds: string[] = [EVERYONE]): void {
    this.store.memberships.set(`${roomId}:${client.account}`, {
      roomId,
      accountId: client.account,
      roleIds,
    });
  }

  /** Take an account back out — a kick, from the server's point of view. */
  expel(client: Client, roomId: string): void {
    this.store.memberships.delete(`${roomId}:${client.account}`);
  }

  /** A role with exactly these permissions, for the permission scenarios. */
  role(id: string, bits: bigint): string {
    this.store.roles.set(id, { id, spaceId: SPACE, bits: serialize(bits), position: 1 });
    return id;
  }

  /**
   * A new person with one device, connected, in every room that exists.
   *
   * One device per call: a second device of the same person is `client.device`,
   * which is the interesting case and deserves to be spelled out rather than
   * being an option nobody passes.
   */
  async join(label: string): Promise<Client> {
    const client = await Client.create(this, label);
    for (const roomId of this.store.rooms.keys()) this.admit(client, roomId);
    this.clients.push(client);
    await client.connect();
    return client;
  }

  /**
   * Run everything that delivery kicked off, until nothing new appears.
   *
   * Frames arrive on callbacks that cannot be awaited — a socket handler
   * returns void — so the work they start is tracked here instead. Looping
   * matters: applying a handshake record can trigger a catch-up that fetches
   * more records that start more work.
   */
  async settle(): Promise<void> {
    for (let i = 0; i < 50 && this.pending.length; i++) {
      const batch = this.pending.splice(0, this.pending.length);
      await Promise.allSettled(batch);
      // Give anything queued on a microtask a chance to be tracked.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  /** Let real timers — the socket's reconnect backoff — run. */
  async idle(ms = 10): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await this.settle();
  }

  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.push(promise);
    return promise;
  }

  /**
   * Cut the network without closing the socket.
   *
   * Two different failures that clients confuse constantly: a dead socket means
   * no live delivery and a working fetch; a dead network means neither.
   */
  offline = false;

  /** In-process fetch. No port, no listener, the real routing. */
  fetchAs(devicePub: string): typeof globalThis.fetch {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
      if (this.offline) return Promise.reject(new TypeError('fetch failed'));
      const request = new Request(String(input), init);
      request.headers.set('x-revel-device', devicePub);
      return this.app.fetch(request);
    }) as typeof globalThis.fetch;
  }

  /** Sign a device out. It stops working now, not at the next epoch. */
  revoke(client: Client): void {
    this.store.devices.set(client.device, {
      pub: client.device,
      accountId: client.account,
      revokedAt: Date.now(),
    });
  }

  /**
   * A second device of somebody who has already joined.
   *
   * The interesting case, and the one Kith never did: two devices of one
   * account are two leaves in every group, each with its own key packages, and
   * each has to be added on its own (`docs/03` §1).
   */
  async joinAs(label: string, sameAccountAs: Client): Promise<Client> {
    const secret = await sameAccountAs.crypto.exportAccountSecret();
    const client = await Client.create(this, label, { accountSecret: secret });
    for (const roomId of this.store.rooms.keys()) this.admit(client, roomId);
    this.clients.push(client);
    await client.connect();
    return client;
  }

  async close(): Promise<void> {
    for (const client of this.clients) await client.close();
  }
}

// ---------------------------------------------------------------------------
// One client
// ---------------------------------------------------------------------------

export class Client {
  readonly crypto = new LocalCryptoEngine();
  readonly store: MemoryStore;
  readonly label: string;
  readonly world: World;

  /** Base64url of the account public key, as the reducer and server spell it. */
  account!: string;
  /**
   * This device's identifier at the server.
   *
   * Not derived from the MLS device signature key, because there is no device
   * registration flow yet (`docs/06` phase 1). It does not need to be for these
   * scenarios: the client attributes messages from the MLS leaf inside the
   * ciphertext, never from `Event.sender`, so this is purely who the server
   * thinks is talking to it.
   */
  device!: string;

  rooms!: RoomSync;
  groups!: GroupSync;
  transport!: HttpTransport;
  groupTransport!: HttpGroupTransport;
  ws!: WebSocketStream;

  /** Groups this device has discovered it is no longer in. */
  readonly removedFrom: string[] = [];

  #session: SocketSession | null = null;
  #socket: SocketLike | null = null;
  #counter = 0;
  #online = false;

  private constructor(world: World, label: string, store?: MemoryStore) {
    this.world = world;
    this.label = label;
    this.store = store ?? new MemoryStore();
  }

  static async create(
    world: World,
    label: string,
    over: { accountSecret?: Uint8Array; device?: string; store?: MemoryStore } = {},
  ): Promise<Client> {
    const client = new Client(world, label, over.store);
    const identity = await client.crypto.open({
      deviceLabel: label,
      ...(over.accountSecret ? { accountSecret: over.accountSecret } : {}),
    });
    client.account = toAccountId(identity.accountPublicKey);
    client.device = over.device ?? `dev-${label}-${world.clients.length}`;

    world.store.devices.set(client.device, {
      pub: client.device,
      accountId: client.account,
      revokedAt: null,
    });

    const fetch = world.fetchAs(client.device);
    const transport = new HttpTransport({ baseUrl: 'http://host', fetch });
    const groupTransport = new HttpGroupTransport({ baseUrl: 'http://host', fetch });
    client.transport = transport;
    client.groupTransport = groupTransport;

    client.ws = new WebSocketStream({
      connect: () => client.#pipe(),
      backoff: () => 1,
      // Reconnecting closes a gap the socket cannot replay, so the catch-up
      // that `docs/31`'s socket notes insist on is wired here rather than left
      // to each test to remember.
      onReconnect: (rooms) => {
        world.track(client.rooms.catchUpAll(rooms));
        world.track(client.sync());
      },
      onHandshake: (record) => void world.track(client.groups.receiveHandshake(record)),
      onWelcome: () => void world.track(client.sync()),
      // `docs/03` §5's nudge. Committing here is what makes a Remove effective
      // no later than the next message.
      onCommitRequested: (groupId) => void world.track(client.groups.flush(groupId)),
    });

    client.rooms = new RoomSync({
      crypto: client.crypto,
      store: client.store,
      transport,
      stream: client.ws,
      account: client.account,
      nonce: () => `${label}-${++client.#counter}-nonce`,
    });

    client.groups = new GroupSync({
      crypto: client.crypto,
      store: client.store,
      transport: groupTransport,
      device: client.device,
      persist: () => client.rooms.persistCrypto(),
      onRemoved: (groupId) => {
        client.removedFrom.push(groupId);
      },
    });

    return client;
  }

  // -- the wire -------------------------------------------------------------

  /**
   * One end of a socket, wired straight into a `SocketSession`.
   *
   * Both halves are the real implementations. Frames sent before the client has
   * attached its handlers are buffered rather than dropped, which is what a
   * real socket does and what makes the Welcome-on-connect path testable —
   * `SocketSession.start()` pushes it the instant the session opens.
   */
  #pipe(): SocketLike {
    const buffered: unknown[] = [];
    const actor: Actor = { accountId: this.account, devicePub: this.device };

    const socket: SocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data) => void this.world.track(this.#session?.receive(data) ?? Promise.resolve()),
      close: () => {
        this.#session?.close();
        this.#session = null;
      },
    };

    const deliver = (frame: unknown) => {
      if (socket.onmessage) socket.onmessage({ data: JSON.stringify(frame) });
      else buffered.push(frame);
    };

    this.#session = new SocketSession(
      { store: this.world.store, hub: this.world.hub },
      actor,
      deliver,
    );
    this.world.track(this.#session.start());
    this.#socket = socket;

    // After the caller has attached its handlers, which happens synchronously
    // once `connect()` returns.
    queueMicrotask(() => {
      socket.onopen?.({});
      for (const frame of buffered.splice(0)) deliver(frame);
    });

    return socket;
  }

  /**
   * Come back deliberately — the app being reopened, not a blip.
   *
   * The catch-up is explicit because `WebSocketStream.onReconnect` fires only
   * on an *unexpected* reconnect, and rightly: after `stop()` the caller knows
   * it went away and knows to resync. See `drop()` for the other path, where
   * nobody knew and the stream has to say so.
   */
  async connect(): Promise<void> {
    if (this.#online) return;
    this.#online = true;
    this.ws.start();
    await this.world.settle();
    if (this.bound.size) {
      await this.sync();
      await this.rooms.catchUpAll([...this.bound]);
    }
    await this.world.settle();
  }

  /**
   * The socket dies without anyone asking it to.
   *
   * Different from `disconnect()` in the way that matters: nobody called
   * `stop()`, so the client does not know it missed anything. Recovering has to
   * come from the stream noticing and saying so.
   */
  async drop(): Promise<void> {
    this.#socket?.onclose?.({});
    this.#session?.close();
    this.#session = null;
    // Let the backoff timer fire, then let the catch-up it starts finish.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await this.world.settle();
  }

  /** Pull the plug. Anything sent while down is missed, not queued. */
  async disconnect(): Promise<void> {
    if (!this.#online) return;
    this.#online = false;
    this.ws.stop();
    this.#session?.close();
    this.#session = null;
    await this.world.settle();
  }

  get online(): boolean {
    return this.#online;
  }

  // -- groups ---------------------------------------------------------------

  /** Every room the server says this account is in. */
  async knownRooms() {
    return this.transport.listRooms();
  }

  /**
   * The cold-start path: ask what rooms exist, bind the ones that have a group,
   * open one for the rest.
   *
   * A `RoomInfo` carries the group id, which is the only way a client that has
   * lost its local state learns which MLS group opens which conversation.
   */
  async discover(): Promise<string[]> {
    const found: string[] = [];
    for (const room of await this.knownRooms()) {
      found.push(room.id);
      if (this.bound.has(room.id)) continue;
      if (!room.group) continue;
      this.bound.add(room.id);
      await this.bind(room.id, room.group);
    }
    return found;
  }

  /** Open a group for a room and bind it. Returns the group id. */
  async open(roomId: string): Promise<string> {
    await this.groups.replenish();
    const groupId = await this.groups.create(roomId);
    this.bound.add(roomId);
    await this.rooms.bind(roomId, groupId);
    this.rooms.listen(roomId);
    return groupId;
  }

  async invite(groupId: string, accounts: string[]) {
    return this.groups.invite(groupId, accounts);
  }

  /** Bind a group to a room and start listening. */
  async bind(roomId: string, groupId: string): Promise<void> {
    await this.rooms.bind(roomId, groupId);
    this.rooms.listen(roomId);
    await this.rooms.catchUp(roomId);
  }

  /**
   * Everything a client does when it comes back: take any Welcome waiting,
   * bind whatever rooms the new groups turn out to serve, and catch up.
   *
   * The binding step is not a convenience. A Welcome carries a group id and
   * nothing else, so a device that has just joined has no idea which
   * conversation it can now read until it asks.
   */
  async sync(): Promise<string[]> {
    const joined = await this.groups.acceptWelcomes();

    for (const groupId of await this.crypto.groups()) {
      await this.groups.catchUp(groupId).catch(() => {});
      for (const roomId of await this.groups.roomsOf(groupId).catch(() => [])) {
        if (this.bound.has(roomId)) continue;
        this.bound.add(roomId);
        await this.bind(roomId, groupId);
      }
    }
    return joined;
  }

  /** Rooms this client has bound, so `sync` is idempotent. */
  readonly bound = new Set<string>();

  // -- messages -------------------------------------------------------------

  async say(roomId: string, text: string) {
    return this.rooms.send(roomId, { type: 'm.message', body: text });
  }

  async pull(roomId: string) {
    return this.rooms.catchUp(roomId);
  }

  messages(roomId: string): Message[] {
    return this.rooms.state(roomId).messages;
  }

  /** Just the words, for an assertion that reads like a conversation. */
  texts(roomId: string): string[] {
    return this.messages(roomId)
      .filter((m) => !m.redacted && !m.purged)
      .map((m) => (typeof m.body === 'string' ? m.body : JSON.stringify(m.body)));
  }

  /** Publish a fresh shelf of key packages. */
  async replenish(floor?: number) {
    return this.groups.replenish(floor);
  }

  /** This device's key package, for a test that wants to claim one by hand. */
  async keyPackage(): Promise<string> {
    return toBase64(await this.crypto.keyPackage());
  }

  // -- membership -----------------------------------------------------------

  /** Commit whatever is staged, or nothing — the empty-commit path. */
  async flush(groupId: string) {
    return this.groups.flush(groupId);
  }

  /**
   * Remove every leaf belonging to someone. One person, several devices, one
   * commit: `docs/03` §5 wants a mass membership change to be one epoch.
   */
  async removePerson(groupId: string, other: Client) {
    const leaves = (await this.crypto.members(groupId))
      .filter((m) => toAccountId(m.account) === other.account)
      .map((m) => m.leaf);
    if (leaves.length === 0) throw new Error(`${other.label} has no leaf in ${groupId}`);
    return this.groups.remove(groupId, leaves);
  }

  // -- inspection -----------------------------------------------------------

  async groupOf(roomId: string): Promise<string> {
    return this.rooms.groupFor(roomId);
  }

  /** This device's own idea of where the group is. */
  async epoch(groupId: string): Promise<number> {
    return (await this.crypto.state(groupId)).epoch;
  }

  /** The server's, which should always agree with everyone's. */
  async serverEpoch(groupId: string): Promise<number> {
    return (await this.groupTransport.groupInfo(groupId)).epoch;
  }

  async supply() {
    return this.groupTransport.keyPackageSupply(this.device);
  }

  async pendingWelcomes() {
    return this.groupTransport.welcomes();
  }

  /** Somebody else's queue, read through the server rather than their client. */
  async pendingWelcomesFor(other: Client) {
    return this.world.store.listWelcomes(other.device);
  }

  /** The public tree at the group's current epoch. */
  async treeOf(groupId: string): Promise<string> {
    const tree = await this.groupTransport.getTree(groupId);
    if (!tree) throw new Error(`no tree published for ${groupId}`);
    return tree.tree;
  }

  async handshakeLog(groupId: string) {
    return this.groupTransport.fetchHandshake(groupId);
  }

  /**
   * Throw this group's MLS state away without leaving the group.
   *
   * A diverged session, as far as everything above the crypto can tell: the
   * server still lists this device as a member, the room is still bound, and
   * nothing that arrives can be opened. The only way out is to be added again.
   */
  async diverge(groupId: string): Promise<void> {
    await this.crypto.discard(groupId);
    await this.store.deleteSealed('group', groupId);
  }

  /** Give up on a group — the reset a UI offers after a divergence. */
  async leave(groupId: string): Promise<void> {
    this.bound.clear();
    return this.groups.leave(groupId);
  }

  /** Try to send a Welcome to a device nobody claimed a key package for. */
  async forgeWelcome(groupId: string, target: string) {
    return this.groupTransport.appendHandshake(groupId, {
      kind: 'commit',
      epoch: await this.epoch(groupId),
      bytes: toBase64(new Uint8Array([1, 2, 3])),
      welcome: { bytes: toBase64(new Uint8Array([4, 5, 6])), devices: [target] },
    });
  }

  /**
   * Close this client and open a new one over the same store and account.
   *
   * A reload, as far as anything below the UI can tell: same device id, same
   * sealed blobs on disk, a brand new engine that has to import all of it.
   */
  async reload(): Promise<Client> {
    await this.disconnect();
    const secret = await this.crypto.exportAccountSecret();
    await this.crypto.close();

    const next = await Client.create(this.world, this.label, {
      accountSecret: secret,
      device: this.device,
      store: this.store,
    });
    this.world.clients[this.world.clients.indexOf(this)] = next;

    // What `restoreCrypto` returns, not `crypto.groups()`: importing a group
    // does not load it, and a cold start that loaded fifty groups' MLS state
    // would spend the whole 300 ms cold-open budget on rooms nobody opened.
    const restored = await next.rooms.restoreCrypto();
    await next.connect();
    for (const groupId of restored) {
      await next.crypto.loadGroup(groupId);
      for (const roomId of await next.groups.roomsOf(groupId)) await next.bind(roomId, groupId);
    }
    await next.world.settle();
    return next;
  }

  async close(): Promise<void> {
    await this.disconnect();
    await this.rooms.close();
    await this.crypto.close();
  }
}

export { Permission };
