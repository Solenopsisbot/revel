/**
 * The sync engine: crypto, store and network, wired together.
 *
 * Everything below it is passive. The reducer is pure, the store is a place to
 * put bytes, the crypto engine answers questions. This is the only thing that
 * decides what happens in what order — which matters more than it sounds,
 * because one of those orderings is a security property.
 *
 * ## The ordering that is not negotiable
 *
 * `docs/31` §7, learned by breaking it: **a new crypto state must be durable
 * before a ciphertext from it is sent.**
 *
 * Encrypting advances this device's position in the MLS secret tree, and the
 * key *and nonce* for a message come from that position. If the page dies
 * between sending and persisting, the device comes back at the old position and
 * the next message it sends re-derives a key and nonce that have already been
 * used. Two plaintexts under one AES-GCM key and nonce is a total loss of
 * confidentiality and authenticity for both of them. The far side rejects the
 * message, which is how you would notice, but noticing does not undo it.
 *
 * So [`RoomSync.send`] persists between encrypting and sending, and if the
 * persist fails it does not send. Burning a generation costs nothing; sending
 * from a state that was never written down costs everything.
 */
import type { CryptoEngine } from '@revel/crypto';
import {
  type Event,
  encodePayload,
  parseEncrypted,
  payloadBytes,
  toAccountId,
} from '@revel/protocol';
import { addPending, markFailed, markPurged, reduceAll } from '../rooms/reduce.js';
import { emptyRoom, type LocalEvent, type Message, type RoomState } from '../rooms/state.js';
import type { LocalStore } from '../store/types.js';
import type { EventStream, Transport } from './transport.js';

/** Where the room → group binding lives in the store. */
const groupKey = (roomId: string) => `room:group:${roomId}`;

/** The device-wide key package blob has no natural id; this is it. */
const KEY_PACKAGES = 'self';

export interface RoomSyncOptions {
  crypto: CryptoEngine;
  store: LocalStore;
  transport: Transport;
  /** Live delivery, when something is delivering. Optional by design. */
  stream?: EventStream;

  /** This device's account, as the reducer spells accounts. */
  account: string;

  /** `docs/04` §4: the client honours redactions from non-authors only here. */
  mayModerate?: (account: string) => boolean;

  /** Overridable for tests. */
  nonce?: () => string;
  now?: () => number;
}

export type RoomListener = (state: RoomState) => void;

/**
 * One room's worth of syncing, and the state it produces.
 *
 * Holds rooms in memory once opened, so the UI can read synchronously; every
 * change is written through to the store, so a reload starts from a snapshot
 * rather than a replay.
 */
export class RoomSync {
  #crypto: CryptoEngine;
  #store: LocalStore;
  #transport: Transport;
  #stream?: EventStream;
  #account: string;
  #mayModerate: ((account: string) => boolean) | undefined;
  #nonce: () => string;
  #now: () => number;

  #rooms = new Map<string, RoomState>();
  #groups = new Map<string, string>();
  #listeners = new Map<string, Set<RoomListener>>();
  #unsubscribes = new Map<string, () => void>();
  /** `groupId:epoch` → leaf → account. Rebuilt when the epoch moves. */
  #roster = new Map<string, Map<number, string>>();
  /**
   * Nonce → the payload we sent under it, until the echo comes back.
   *
   * MLS will not decrypt your own application messages — you hold the sending
   * side of your ratchet, not the receiving side — so the echo of something
   * this device sent cannot be opened the way everything else is. It does not
   * need to be: we have the plaintext. What the echo adds is the server's id,
   * and that is the only thing taken from it.
   *
   * This is also why sent events are persisted locally rather than re-fetched.
   * A client that threw away its own messages could never read them again.
   */
  #outbox = new Map<string, Record<string, unknown>>();

  constructor(options: RoomSyncOptions) {
    this.#crypto = options.crypto;
    this.#store = options.store;
    this.#transport = options.transport;
    this.#stream = options.stream;
    this.#account = options.account;
    this.#mayModerate = options.mayModerate;
    this.#nonce = options.nonce ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => Date.now());
  }

  // -- rooms and groups -----------------------------------------------------

  /**
   * Record which MLS group encrypts a room.
   *
   * Many rooms share one group: `docs/03` §4 gives a space's "everyone"
   * audience a single group covering every room with that visibility, and only
   * a narrower room gets its own. The mapping is policy the server decides, so
   * it is told to us rather than derived here.
   */
  async bind(roomId: string, groupId: string): Promise<void> {
    this.#groups.set(roomId, groupId);
    await this.#store.put(groupKey(roomId), groupId);
  }

  async groupFor(roomId: string): Promise<string> {
    const cached = this.#groups.get(roomId);
    if (cached) return cached;

    const stored = await this.#store.get<string>(groupKey(roomId));
    if (!stored) throw new Error(`room ${roomId} is not bound to a group; call bind() first`);
    this.#groups.set(roomId, stored);
    return stored;
  }

  /** The room as it stands, without touching the network. */
  state(roomId: string): RoomState {
    return this.#rooms.get(roomId) ?? emptyRoom(roomId);
  }

  /**
   * Open a room from local state alone.
   *
   * `docs/29` §5 budgets 300 ms from cold open to a painted room, which is why
   * this never waits on the network: it takes the snapshot if there is one and
   * replays the log if there is not. Call [`catchUp`] afterwards, and let the
   * room fill in while somebody is already reading it.
   */
  async open(roomId: string): Promise<RoomState> {
    const cached = this.#rooms.get(roomId);
    if (cached) return cached;

    const snapshot = await this.#store.getRoom(roomId);
    if (snapshot) {
      this.#rooms.set(roomId, snapshot);
      return snapshot;
    }

    // No snapshot: rebuild from the log, which is the thing that is actually
    // authoritative. A snapshot is a cache and is allowed to be missing.
    const events = await this.#store.listEvents(roomId);
    const state = reduceAll(emptyRoom(roomId), events, { mayModerate: this.#mayModerate });
    this.#rooms.set(roomId, state);
    if (events.length) await this.#store.putRoom(state);
    return state;
  }

  /** Watch a room. Returns an unsubscribe. */
  watch(roomId: string, listener: RoomListener): () => void {
    let set = this.#listeners.get(roomId);
    if (!set) {
      set = new Set();
      this.#listeners.set(roomId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(roomId);
    };
  }

  // -- receiving ------------------------------------------------------------

  /**
   * Catch up on everything since the last event we hold.
   *
   * Pages forward until the server stops giving us anything new, so a client
   * that was away for a week does not need to know how far behind it was.
   */
  async catchUp(roomId: string, pageSize = 200): Promise<RoomState> {
    await this.open(roomId);
    let cursor = await this.#store.lastEventId(roomId);

    for (;;) {
      const page = await this.#transport.fetchEvents(roomId, { limit: pageSize });
      // Hoisted so the closure sees a `string`, not a `string | null` that
      // TypeScript will not narrow across a function boundary.
      const since = cursor;
      const fresh = since ? page.filter((e) => compare(e.id, since) > 0) : page;
      if (fresh.length === 0) break;

      await this.receive(roomId, fresh);
      const newest = fresh.reduce((a, b) => (compare(a.id, b.id) >= 0 ? a : b));
      if (newest.id === cursor) break;
      cursor = newest.id;
      if (page.length < pageSize) break;
    }

    return this.state(roomId);
  }

  /**
   * Page backwards through history.
   *
   * Separate from `catchUp` because they are different acts: catching up is the
   * client being wrong about the present, backfilling is somebody scrolling.
   */
  async backfill(roomId: string, limit = 50): Promise<RoomState> {
    const state = await this.open(roomId);
    const oldest = state.messages.find((m) => !m.pending)?.id;
    const page = await this.#transport.fetchEvents(roomId, { before: oldest, limit });
    if (page.length === 0) return state;
    return this.receive(roomId, page);
  }

  /** Apply events that arrived, from anywhere. */
  async receive(roomId: string, events: Event | Event[]): Promise<RoomState> {
    const batch = Array.isArray(events) ? events : [events];
    await this.open(roomId);

    const decrypted: LocalEvent[] = [];
    const purges: Event[] = [];

    for (const event of batch) {
      // A purge tombstone carries the id of the event it erased and no payload
      // — there is nothing to decrypt, and feeding it through the reducer would
      // hit the applied set as a duplicate of its own victim.
      if (event.purgedAt != null && event.payload === '') {
        purges.push(event);
        continue;
      }
      // One unreadable event is not a reason to stop syncing a room. It might
      // be a newer client's key, a replay we have already consumed, or someone
      // sending something malformed — none of which the rest of the room
      // should have to wait for.
      const local = await this.#decrypt(roomId, event).catch(() => null);
      if (local) decrypted.push(local);
    }

    if (decrypted.length) await this.#store.putEvents(roomId, decrypted);

    let state = reduceAll(this.state(roomId), decrypted, { mayModerate: this.#mayModerate });
    for (const purge of purges) {
      state = markPurged(state, purge.id, purge.purgedAt ?? this.#now());
    }

    // Crypto state moved: processing anything advances the ratchet, and a
    // commit moves the epoch outright.
    await this.persistCrypto();
    await this.#commit(roomId, state);
    return state;
  }

  /**
   * Turn one server event into a local one, or nothing.
   *
   * Nothing happens for a commit or a proposal: they change the group rather
   * than the conversation, and there is no row for "the membership changed" in
   * a timeline the server cannot see.
   */
  async #decrypt(roomId: string, event: Event): Promise<LocalEvent | null> {
    // Our own echo. See `#outbox`.
    const mine = event.clientNonce ? this.#outbox.get(event.clientNonce) : undefined;
    if (mine) {
      this.#outbox.delete(event.clientNonce as string);
      return {
        id: event.id,
        account: this.#account,
        at: event.createdAt,
        clientNonce: event.clientNonce,
        purgedAt: event.purgedAt,
        payload: parseEncrypted(mine),
      };
    }

    const groupId = await this.groupFor(roomId);
    const incoming = await this.#crypto.process(groupId, payloadBytes(event));
    if (incoming.kind !== 'application') return null;

    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(incoming.data));
    } catch {
      // Decrypted, and then not what we expected. Someone in this room is
      // sending something we cannot read at all — which is their problem, not
      // a reason to stop syncing the room.
      return null;
    }

    return {
      id: event.id,
      account: await this.#accountFor(groupId, incoming.sender),
      at: event.createdAt,
      clientNonce: event.clientNonce,
      purgedAt: event.purgedAt,
      payload: parseEncrypted(json),
    };
  }

  /** Which account a leaf belongs to, cached per epoch. */
  async #accountFor(groupId: string, leaf: number): Promise<string> {
    const { epoch } = await this.#crypto.state(groupId);
    const key = `${groupId}:${epoch}`;

    let roster = this.#roster.get(key);
    if (!roster) {
      roster = new Map();
      for (const member of await this.#crypto.members(groupId)) {
        roster.set(member.leaf, toAccountId(member.account));
      }
      // One epoch's roster is enough; the previous one is not coming back.
      this.#roster.clear();
      this.#roster.set(key, roster);
    }

    // A leaf we have no name for is still a real sender — the roster may have
    // moved on since. Naming it by leaf keeps the message rather than dropping
    // it, and reads as "someone" rather than as somebody wrong.
    return roster.get(leaf) ?? `leaf:${leaf}`;
  }

  // -- sending --------------------------------------------------------------

  /**
   * Encrypt, persist, send, apply.
   *
   * The optimistic copy goes in first so the UI is instant, and the order of
   * the three steps after it is the security property described at the top of
   * this file. Read that before reordering anything here.
   */
  async send(
    roomId: string,
    payload: Record<string, unknown>,
    options: { class?: Event['class']; localId?: string } = {},
  ): Promise<RoomState> {
    const groupId = await this.groupFor(roomId);
    await this.open(roomId);

    const clientNonce = this.#nonce();
    const localId = options.localId ?? `local:${clientNonce}`;

    // 1. Show it immediately. This is the only step a person can see.
    const optimistic: Message & { clientNonce: string } = {
      id: localId,
      account: this.#account,
      at: this.#now(),
      body: (payload as { body?: unknown }).body ?? '',
      replyTo: (payload as { replyTo?: string }).replyTo,
      thread: (payload as { thread?: string }).thread,
      clientNonce,
    };
    this.#commitSync(roomId, addPending(this.state(roomId), optimistic));

    try {
      // 2. Encrypt. The ratchet has now moved, and this device's state on disk
      //    is out of date until step 3.
      const body = { v: 1, ...payload };
      const sealed = await this.#crypto.encrypt(
        groupId,
        new TextEncoder().encode(JSON.stringify(body)),
      );
      // Remembered so the echo can be applied without decrypting it, which MLS
      // will not let this device do for its own messages.
      this.#outbox.set(clientNonce, body);

      // 3. Persist, before anything leaves. If this throws we have burned a
      //    generation and sent nothing, which is the safe way to fail.
      await this.persistCrypto();

      // 4. Send.
      const { epoch } = await this.#crypto.state(groupId);
      const result = await this.#transport.send(roomId, {
        epoch,
        class: options.class ?? 'normal',
        payload: encodePayload(sealed),
        clientNonce,
      });

      // 5. Apply the echo. It carries the same nonce, which is what lets the
      //    reducer swap it for the optimistic copy.
      return await this.receive(roomId, result.event);
    } catch (error) {
      this.#outbox.delete(clientNonce);
      const failed = markFailed(this.state(roomId), clientNonce);
      await this.#commit(roomId, failed);
      throw error;
    }
  }

  // -- crypto persistence ---------------------------------------------------

  /**
   * Write down whatever crypto state has changed.
   *
   * Public because the ordering rule is a caller's problem too: anything that
   * makes the crypto engine do work — a commit, a join, a removal — has to get
   * the result onto disk before acting on it.
   */
  async persistCrypto(): Promise<void> {
    for (const groupId of await this.#crypto.dirtyGroups()) {
      await this.#store.putSealed('group', groupId, await this.#crypto.exportGroup(groupId));
    }
    if (await this.#crypto.keyPackagesDirty()) {
      await this.#store.putSealed(
        'keyPackages',
        KEY_PACKAGES,
        await this.#crypto.exportKeyPackages(),
      );
    }
  }

  /**
   * Load every sealed blob back into the crypto engine.
   *
   * The other half of a reload. Groups are imported but not loaded — opening a
   * room does that, and importing fifty groups' worth of MLS state on startup
   * would spend the cold-open budget on rooms nobody is looking at.
   */
  async restoreCrypto(): Promise<string[]> {
    const packages = await this.#store.getSealed('keyPackages', KEY_PACKAGES);
    if (packages) await this.#crypto.importKeyPackages(packages);

    const restored: string[] = [];
    for (const record of await this.#store.listSealed('group')) {
      restored.push(await this.#crypto.importGroup(record.bytes));
    }
    return restored;
  }

  /** Bring a bound room's group into memory, from state already imported. */
  async loadGroup(roomId: string): Promise<void> {
    await this.#crypto.loadGroup(await this.groupFor(roomId));
  }

  // -- live delivery --------------------------------------------------------

  /**
   * Catch up on every room this engine has open.
   *
   * What a reconnect needs. The socket cannot replay what it missed while it
   * was down, so the gap is closed here or not at all.
   */
  async catchUpAll(rooms: string[] = [...this.#rooms.keys()]): Promise<void> {
    for (const roomId of rooms) {
      // One room failing to catch up must not stop the others: a room whose
      // membership was revoked while we were offline will refuse forever.
      await this.catchUp(roomId).catch(() => {});
    }
  }

  /** Subscribe to live events for a room, if a stream was provided. */
  listen(roomId: string): void {
    if (!this.#stream || this.#unsubscribes.has(roomId)) return;
    this.#unsubscribes.set(
      roomId,
      this.#stream.subscribe(roomId, (event) => {
        // Fire and forget: a socket callback cannot be awaited, and a failure
        // here is recoverable by the next catch-up.
        void this.receive(roomId, event).catch(() => {});
      }),
    );
  }

  stopListening(roomId: string): void {
    this.#unsubscribes.get(roomId)?.();
    this.#unsubscribes.delete(roomId);
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.#unsubscribes.values()) unsubscribe();
    this.#unsubscribes.clear();
    this.#listeners.clear();
    this.#rooms.clear();
  }

  // -- internals ------------------------------------------------------------

  /** Publish new state, and write the snapshot through. */
  async #commit(roomId: string, state: RoomState): Promise<void> {
    this.#commitSync(roomId, state);
    await this.#store.putRoom(state);
  }

  /** Publish without waiting for the store — used where the UI must not wait. */
  #commitSync(roomId: string, state: RoomState): void {
    this.#rooms.set(roomId, state);
    for (const listener of this.#listeners.get(roomId) ?? []) listener(state);
  }
}

/** Snowflake order, duplicated here to keep `state.ts` free of imports. */
function compare(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * An account's bytes as the string the reducer keys by.
 *
 * Re-exported rather than defined here. It used to live in this file and the
 * server grew its own copy the moment it had to read a device certificate —
 * two spellings of an account id is the kind of thing that works until one of
 * them meets a `+` and stops.
 */
export { toAccountId } from '@revel/protocol';
