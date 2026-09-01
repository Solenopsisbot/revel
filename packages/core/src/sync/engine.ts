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
  type FaceRef,
  parseEncrypted,
  payloadBytes,
  toAccountId,
} from '@revel/protocol';
import {
  type Candidate,
  type Decision,
  decide,
  type NotificationSettings,
} from '../notify/rules.js';
import {
  addPending,
  dropPending,
  markFailed,
  markPending,
  markPurged,
  reduceAll,
} from '../rooms/reduce.js';
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

  /**
   * How to decide whether an incoming event deserves a notification.
   *
   * Optional, and absent in every test that is not about notifications. The
   * engine deliberately does not own settings or room metadata — it knows a
   * room id and a ciphertext — so the decision is assembled from what the
   * caller injects here (`docs/35`).
   */
  notify?: NotifyDeps;

  /** Overridable for tests. */
  nonce?: () => string;
  now?: () => number;
  /**
   * How to wake up later. Paired with `now`: a test that moves the clock by
   * hand needs to move the timers with it, and a real `setTimeout` would still
   * be sitting there waiting for wall-clock seconds that never pass.
   */
  schedule?: (fn: () => void, ms: number) => () => void;
}

/** What the engine needs in order to run `decide` on an incoming event. */
export interface NotifyDeps {
  /** Current settings. A function, because they change while the app runs. */
  settings(): NotificationSettings;
  /**
   * Where this room sits. `null` for a room the directory has not loaded yet,
   * which suppresses the decision rather than guessing at it.
   */
  place(roomId: string): { spaceId: string | null; kind: 'space' | 'dm' | 'group' } | null;
  /** Local minutes from midnight. Injected, so the decision stays reproducible. */
  minuteOfDay?(): number;
  /**
   * Role ids the reading account holds in this room.
   *
   * Needed for `@role` pings. Absent means "no roles", which suppresses them —
   * the safe direction, since the failure is a missed ping rather than a ping
   * somebody was not entitled to send.
   */
  roles?(roomId: string): string[];
  /**
   * Whether `account` may address the whole room (`MENTION_EVERYONE`).
   *
   * **This is a permission check the reader has to do**, because the server
   * cannot. `mentionsEveryone` is inside the ciphertext, so a member without
   * the permission can set it and the Host will never know; `docs/04` puts
   * enforcement on the client, "on rendering the ping". Absent means nobody
   * may, which makes an unwired client quiet rather than exploitable.
   */
  mayBroadcast?(roomId: string, account: string): boolean;
  /**
   * Called for **every** decrypted event, notifying or not.
   *
   * Not filtered to `notify === true`, because the other half of `docs/05` §8
   * lives in the decision too: a muted room still gets its quiet dot, and the
   * caller needs `mark` to know which. Filtering here would mean the room list
   * had to work the rest out again.
   */
  deliver(roomId: string, event: LocalEvent, decision: Decision): void;
}

export type RoomListener = (state: RoomState) => void;

/** What `send` accepts beyond the payload itself. */
export interface RoomSendOptions {
  class?: Event['class'];
  localId?: string;
}

/** Somebody currently typing, and the face they are typing as. */
export interface TypingPerson {
  account: string;
  face?: FaceRef;
}

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
  #notify: NotifyDeps | undefined;
  #mayModerate: ((account: string) => boolean) | undefined;
  #nonce: () => string;
  #now: () => number;
  #schedule: (fn: () => void, ms: number) => () => void;

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

  /**
   * Failed sends, by nonce, so a retry has the original payload.
   *
   * Not the row on screen: that carries what a message *renders* as, and a
   * retry has to send what was actually sent — the same reply target, the same
   * thread, the same face, the same attachments.
   */
  #unsent = new Map<
    string,
    { roomId: string; payload: Record<string, unknown>; options: RoomSendOptions }
  >();

  constructor(options: RoomSyncOptions) {
    this.#crypto = options.crypto;
    this.#store = options.store;
    this.#transport = options.transport;
    this.#stream = options.stream;
    this.#account = options.account;
    this.#mayModerate = options.mayModerate;
    this.#notify = options.notify;
    this.#nonce = options.nonce ?? (() => crypto.randomUUID());
    this.#now = options.now ?? (() => Date.now());
    this.#schedule =
      options.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        // Never hold a process open just to say somebody stopped typing.
        (timer as { unref?: () => void }).unref?.();
        return () => clearTimeout(timer);
      });
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

  /**
   * Every room this engine currently holds.
   *
   * What local search runs over: `docs/03` makes the server the search
   * adversary, so "searchable" means "already decrypted here", and this is that
   * set.
   */
  openRooms(): RoomState[] {
    return [...this.#rooms.values()];
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
    // In a turn for the same reason `receive` is: on a cold room this reads
    // the store and then writes memory, and a `receive` landing in between
    // would have its reduce overwritten by the older snapshot.
    return await this.#inTurn(roomId, () => this.#open(roomId));
  }

  /** `open` without taking a turn, for callers that already hold one. */
  async #open(roomId: string): Promise<RoomState> {
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
      // A purge tombstone carries the **id of the event it erased**, so it is
      // never "newer than the cursor" and an id-filtered catch-up walks
      // straight past it. A device that was offline when a message was purged
      // would then keep its decrypted copy forever while everybody else
      // dropped theirs — the client silently diverging from the room, which is
      // the one outcome a tombstone exists to prevent. Re-applying one is
      // idempotent, so letting them through costs nothing.
      const fresh = since
        ? page.filter((e) => compare(e.id, since) > 0 || e.purgedAt != null)
        : page;
      if (fresh.length === 0) break;

      await this.receive(roomId, fresh);
      const newest = fresh.reduce((a, b) => (compare(a.id, b.id) >= 0 ? a : b));
      // Only messages move the cursor. A tombstone that came through the
      // filter above is older than the cursor by construction, and letting one
      // set it would walk the catch-up backwards.
      if (compare(newest.id, cursor ?? '') <= 0) break;
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
    return await this.#inTurn(roomId, () => this.#receive(roomId, events));
  }

  async #receive(roomId: string, events: Event | Event[]): Promise<RoomState> {
    const batch = Array.isArray(events) ? events : [events];
    await this.#open(roomId);

    const decrypted: LocalEvent[] = [];
    const purges: Event[] = [];
    const typingMoved = new Set<string>();

    for (const event of batch) {
      // Ephemeral events never touch the store and never reach the reducer.
      // `docs/03` §7: not stored, dropped if nobody is listening, meaningless a
      // second later. Persisting one would mean writing a row to disk to say
      // somebody might be about to type, and replaying it later as though they
      // still were.
      if (event.class === 'ephemeral') {
        const local = await this.#decrypt(roomId, event).catch(() => null);
        const moved = local && this.#applyEphemeral(roomId, local);
        if (moved) typingMoved.add(moved);
        continue;
      }
      // A purge tombstone carries the id of the event it erased and no payload
      // — there is nothing to decrypt, and feeding it through the reducer would
      // hit the applied set as a duplicate of its own victim.
      if (event.purgedAt != null && event.payload === '') {
        purges.push(event);
        continue;
      }
      // Already applied. Delivery is at-least-once — the socket pushes an
      // event and a catch-up page hands over the same one — and the reducer
      // has always deduplicated by id. Doing it *here* rather than there
      // matters because the work in between is not free and not idempotent:
      //
      // - Feeding the same ciphertext to MLS twice is a replay, and for this
      //   device's *own* message it is worse than that. The echo is recognised
      //   by client nonce and the nonce is consumed on first sight, so the
      //   second copy misses the outbox and goes to `process`, which answers
      //   "message from self can't be processed" into a `.catch(() => null)`
      //   that nobody reads.
      // - It is also a write to the store and a second notification decision
      //   for an event the room has already seen.
      //
      // Safe to read `applied` synchronously here because `receive` holds the
      // room's turn, so the first copy has finished committing before a second
      // copy of it can start.
      if (this.state(roomId).applied.has(event.id)) continue;

      // One unreadable event is not a reason to stop syncing a room. It might
      // be a newer client's key, a replay we have already consumed, or someone
      // sending something malformed — none of which the rest of the room
      // should have to wait for.
      const local = await this.#decrypt(roomId, event).catch(() => null);
      if (local) decrypted.push(local);
    }

    if (decrypted.length) await this.#store.putEvents(roomId, decrypted);
    if (this.#notify && decrypted.length) this.#decideNotifications(roomId, batch, decrypted);

    let state = reduceAll(this.state(roomId), decrypted, { mayModerate: this.#mayModerate });
    for (const purge of purges) {
      state = markPurged(state, purge.id, purge.purgedAt ?? this.#now());
    }

    // Crypto state moved: processing anything advances the ratchet, and a
    // commit moves the epoch outright.
    //
    // **Failing to write the crypto snapshot must not take the conversation
    // down with it.** The events are already decrypted, already in the store
    // and have already been decided on for notifications; throwing here used
    // to discard the reduce, so a message would be on disk, notified for, and
    // absent from the screen until something reopened the room. That is the
    // worst shape a bug can have: everything says it arrived except the part
    // you look at.
    //
    // Not rethrowing is deliberate too. The group stays dirty, so the next
    // persist retries it, and the local event log — not the snapshot — is what
    // a reload rebuilds from. A loud log beats an exception that the socket
    // handler above would swallow anyway.
    try {
      await this.persistCrypto();
    } catch (error) {
      console.error(`revel: could not persist crypto state for ${roomId}`, error);
    }
    for (const key of typingMoved) this.#notifyPlace(key);
    await this.#commit(roomId, state);
    return state;
  }

  // -- typing ---------------------------------------------------------------
  //
  // Transient, in memory, never written down. The reducer deliberately drops
  // `m.typing` for exactly that reason, so this is the only place it lives.

  /**
   * How long a typing notice is worth believing.
   *
   * **Chosen, not specified.** It has to be longer than the resend interval
   * below or somebody typing steadily flickers, and short enough that a client
   * that dies mid-sentence stops claiming to be typing quickly. A `stop` is
   * sent when typing ends; this is what covers the case where it never arrives.
   */
  static readonly TYPING_TTL_MS = 6000;
  /** Resend while still typing. Comfortably inside the TTL. */
  static readonly TYPING_RESEND_MS = 4000;

  /**
   * `roomId` or `roomId/threadId` → account → when their notice arrived.
   *
   * Keyed by *place*, not by room. A thread is a branch inside a room
   * (`docs/16`), and somebody typing in a branch is not typing in the room —
   * showing it there is how a busy room ends up permanently claiming that
   * three people are about to say something in it.
   */
  #typing = new Map<string, Map<string, { at: number; face?: FaceRef }>>();
  #typingListeners = new Map<string, Set<(who: TypingPerson[]) => void>>();
  /** When this device last told a room it was typing, so it can throttle. */
  #typingSent = new Map<string, number>();

  /**
   * Who is currently typing here, excluding this device's account.
   *
   * `thread` narrows it to one branch. Omitted means the room itself, and a
   * notice from a thread does not appear there.
   */
  typing(roomId: string, thread?: string): TypingPerson[] {
    const held = this.#typing.get(place(roomId, thread));
    if (!held) return [];

    const cutoff = this.#now() - RoomSync.TYPING_TTL_MS;
    const out: TypingPerson[] = [];
    for (const [account, entry] of held) {
      // Expired entries are dropped as they are noticed rather than on a timer:
      // a timer per room is a resource, and nobody asks about typing except a
      // room somebody is looking at.
      if (entry.at <= cutoff) held.delete(account);
      else if (account !== this.#account)
        out.push({ account, ...(entry.face ? { face: entry.face } : {}) });
    }
    return out;
  }

  /** Watch it. Returns an unsubscribe. */
  watchTyping(
    roomId: string,
    listener: (who: TypingPerson[]) => void,
    thread?: string,
  ): () => void {
    const key = place(roomId, thread);
    let set = this.#typingListeners.get(key);
    if (!set) {
      set = new Set();
      this.#typingListeners.set(key, set);
    }
    set.add(listener);
    this.#armTypingExpiry(key);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.#typingListeners.delete(key);
        this.#typingExpiry.get(key)?.();
        this.#typingExpiry.delete(key);
      }
    };
  }

  /**
   * Say this device is typing. Throttled, and safe to call per keystroke.
   *
   * That is the point of the throttle being here rather than in the caller: an
   * ephemeral event per keystroke is absurd, and the only way to guarantee
   * nobody does it is to make the obvious call site correct.
   */
  async setTyping(
    roomId: string,
    options: { face?: FaceRef; thread?: string } = {},
  ): Promise<void> {
    // Throttled per *place*: typing in a thread and typing in the room are two
    // separate claims, and one must not silence the other.
    const key = place(roomId, options.thread);
    const last = this.#typingSent.get(key) ?? 0;
    if (this.#now() - last < RoomSync.TYPING_RESEND_MS) return;
    this.#typingSent.set(key, this.#now());

    // Failing to say you are typing is not worth surfacing, and definitely not
    // worth throwing into a keystroke handler.
    await this.send(
      roomId,
      {
        type: 'm.typing',
        ...(options.face ? { face: options.face } : {}),
        ...(options.thread ? { thread: options.thread } : {}),
      },
      { class: 'ephemeral' },
    ).catch(() => {});
  }

  /** Say this device has stopped — sent when a composer empties or sends. */
  async stopTyping(roomId: string, thread?: string): Promise<void> {
    if (!this.#typingSent.delete(place(roomId, thread))) return;
    await this.send(
      roomId,
      { type: 'm.typing', stop: true, ...(thread ? { thread } : {}) },
      { class: 'ephemeral' },
    ).catch(() => {});
  }

  /** Returns the place that changed, so `receive` knows what to notify. */
  #applyEphemeral(roomId: string, local: LocalEvent): string | null {
    // `payload` is the discriminated parse result, not the event — reading
    // `.type` off it gives `undefined` for everything the schema *does* know,
    // which is a silent no-op rather than an error. Unwrap first.
    if (!local.payload.known) return null;
    const payload = local.payload.event as {
      type: string;
      stop?: boolean;
      face?: FaceRef;
      thread?: string;
    };
    if (payload.type !== 'm.typing') return null;

    const key = place(roomId, payload.thread);
    let held = this.#typing.get(key);
    if (!held) {
      held = new Map();
      this.#typing.set(key, held);
    }

    if (payload.stop) return held.delete(local.account) ? key : null;
    held.set(local.account, { at: this.#now(), ...(payload.face ? { face: payload.face } : {}) });
    return key;
  }

  /**
   * One pending expiry wake-up per place, while somebody is typing there.
   *
   * `typing()` drops stale entries as it notices them, which is enough for a
   * caller that polls. A caller that *watches* never asks again on its own, so
   * without this the indicator for somebody who stopped typing without sending
   * a `stop` — a closed laptop, a dropped socket — stays on screen forever.
   * Bounded by construction: one timer per place that has live typing, cleared
   * as soon as the place goes quiet.
   */
  #typingExpiry = new Map<string, () => void>();

  #notifyPlace(key: string): void {
    const [roomId, thread] = key.split('/');
    const who = this.typing(roomId as string, thread);
    for (const listener of this.#typingListeners.get(key) ?? []) listener(who);
    this.#armTypingExpiry(key);
  }

  /** Wake up when the longest-standing notice here goes stale, and re-notify. */
  #armTypingExpiry(key: string): void {
    this.#typingExpiry.get(key)?.();
    this.#typingExpiry.delete(key);
    if (!this.#typingListeners.has(key)) return;

    const held = this.#typing.get(key);
    if (!held?.size) return;
    // The soonest moment this place could look different: when the *oldest*
    // notice still standing crosses the TTL.
    const oldest = Math.min(...[...held.values()].map((e) => e.at));
    const due = oldest + RoomSync.TYPING_TTL_MS - this.#now();
    this.#typingExpiry.set(
      key,
      this.#schedule(() => {
        this.#typingExpiry.delete(key);
        this.#notifyPlace(key);
      }, Math.max(due, 0) + 1),
    );
  }

  /**
   * Give a thread a name.
   *
   * Last writer wins by event id, and anyone in the room may — a thread is a
   * shared thing and `docs/04` §4 has no permission for "may name a branch", so
   * inventing one here would be inventing policy.
   */
  async nameThread(roomId: string, parentId: string, name: string): Promise<RoomState> {
    // `silent`: stored, so the name survives and reaches everybody, and never
    // notifies — renaming a branch is not worth a phone buzzing.
    return this.send(roomId, { type: 'm.thread', target: parentId, name }, { class: 'silent' });
  }

  // -- read state -----------------------------------------------------------

  /**
   * Mark a room read up to an event.
   *
   * `silent` (`docs/04` §2): stored, so it survives a reload and reaches the
   * account's other devices, and never notifies — a read receipt that woke a
   * phone would be the most annoying feature ever shipped.
   *
   * Defaults to the newest message that is actually there. Passing an id is for
   * "mark as read up to here", which is a real thing people do.
   */
  async markRead(roomId: string, upTo?: string): Promise<RoomState> {
    const state = await this.open(roomId);
    const target = upTo ?? [...state.messages].reverse().find((m) => !m.pending)?.id;
    if (!target) return state;

    // Monotonic on the way out as well as in the reducer. Re-sending a receipt
    // for something already read is a stored event for no reason, on the one
    // event type a client would otherwise emit on every scroll.
    const current = state.receipts.get(this.#account);
    if (current && compare(current, target) >= 0) return state;

    return this.send(roomId, { type: 'm.receipt', upTo: target }, { class: 'silent' });
  }

  /** How far this account has read, or null. */
  lastRead(roomId: string): string | null {
    return this.state(roomId).receipts.get(this.#account) ?? null;
  }

  /**
   * How many messages are unread.
   *
   * Own messages never count: sending something is the strongest possible
   * signal that you have seen it, and a room that shows one unread because you
   * spoke in it is a room whose badge nobody trusts.
   */
  unread(roomId: string): number {
    const state = this.state(roomId);
    const upTo = state.receipts.get(this.#account);
    let count = 0;
    for (const message of state.messages) {
      if (message.pending || message.purged || message.redacted) continue;
      if (message.account === this.#account) continue;
      if (upTo && compare(message.id, upTo) <= 0) continue;
      count += 1;
    }
    return count;
  }

  /**
   * Turn one server event into a local one, or nothing.
   *
   * Nothing happens for a commit or a proposal: they change the group rather
   * than the conversation, and there is no row for "the membership changed" in
   * a timeline the server cannot see.
   */
  /**
   * Run `docs/35`'s rules over a batch that has just been decrypted.
   *
   * Deliberately after the store write and before the reducer commit: the event
   * is durable by the time anything is told about it, so a notification can
   * never point at something a reload would lose.
   */
  #decideNotifications(roomId: string, batch: Event[], decrypted: LocalEvent[]): void {
    const deps = this.#notify;
    if (!deps) return;
    const place = deps.place(roomId);
    // A room the directory has not loaded yet. Suppressing beats guessing: a
    // wrong `kind` here turns a DM into a space room and silently downgrades it
    // to the global default.
    if (!place) return;

    const settings = deps.settings();
    const classes = new Map(batch.map((e) => [e.id, e.class]));
    const state = this.state(roomId);

    for (const local of decrypted) {
      const payload = local.payload;
      const message =
        payload.known && payload.event.type === 'm.message'
          ? (payload.event as {
              mentions?: string[];
              replyTo?: string;
              mentionsEveryone?: boolean;
              mentionsRoles?: string[];
            })
          : null;

      const candidate: Candidate = {
        roomId,
        spaceId: place.spaceId,
        kind: place.kind,
        class: classes.get(local.id) ?? 'normal',
        sender: local.account,
        ...(message?.mentions ? { mentions: message.mentions } : {}),
        // Whose message this replies to, not which message — the rule is "a
        // reply to *you*". Resolved from room state, which is where the answer
        // already is; a reply to a message that has been backfilled away simply
        // does not match, which is the right failure.
        ...(message?.replyTo && state.byId.get(message.replyTo)?.account
          ? { replyTo: state.byId.get(message.replyTo)?.account }
          : {}),
        // A room-wide or role-wide ping, **and only if the sender was allowed
        // to send one**. The claim is inside the ciphertext, so the server
        // cannot check it and the reader must (`docs/04`: "client, on rendering
        // the ping"). Without this half, `@everyone` is a field anybody can set
        // to wake a whole room.
        ...(message && this.#broadcasts(deps, roomId, local.account, message)
          ? { broadcast: true }
          : {}),
      };

      deps.deliver(
        roomId,
        local,
        decide(candidate, settings, {
          account: this.#account,
          ...(deps.minuteOfDay ? { minuteOfDay: deps.minuteOfDay() } : {}),
        }),
      );
    }
  }

  /**
   * Whether this message pings the reader room-wide, permission included.
   *
   * Two conditions, and both have to hold: the message has to *claim* a
   * broadcast that covers this reader, and the sender has to be entitled to
   * make it. Checking only the first would make `mentionsEveryone` a way for
   * any member to wake everybody; checking only the second would ping people
   * for ordinary messages from moderators.
   */
  #broadcasts(
    deps: NotifyDeps,
    roomId: string,
    sender: string,
    message: { mentionsEveryone?: boolean; mentionsRoles?: string[] },
  ): boolean {
    const mine = deps.roles?.(roomId) ?? [];
    const claimed =
      message.mentionsEveryone === true ||
      (message.mentionsRoles?.some((role) => mine.includes(role)) ?? false);
    if (!claimed) return false;
    // Unwired means nobody may, so a client that has not been given this is
    // quiet rather than exploitable.
    return deps.mayBroadcast?.(roomId, sender) ?? false;
  }

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
    options: RoomSendOptions = {},
  ): Promise<RoomState> {
    const groupId = await this.groupFor(roomId);
    await this.open(roomId);

    const clientNonce = this.#nonce();
    const localId = options.localId ?? `local:${clientNonce}`;

    // An ephemeral event is not a message and must not become one. It gets no
    // optimistic row, no outbox entry and no echo applied: there is nothing to
    // reconcile, because there is nothing that will ever be stored. Sending a
    // typing notice through the message path put a blank pending message in the
    // timeline, which is how this was found.
    if (options.class === 'ephemeral') {
      const body = { v: 1, ...payload };
      const sealed = await this.#crypto.encrypt(
        groupId,
        new TextEncoder().encode(JSON.stringify(body)),
      );
      await this.persistCrypto();
      const { epoch } = await this.#crypto.state(groupId);
      await this.#transport.send(roomId, {
        epoch,
        class: 'ephemeral',
        payload: encodePayload(sealed),
        clientNonce,
      });
      return this.state(roomId);
    }

    // 1. Show it immediately — **but only if it is a message.**
    //
    // An optimistic row exists for one reason: somebody typed something and has
    // to see it before the network has heard of it. Nothing else has that
    // property. A reaction, an edit, a redaction, a read receipt, a thread
    // name, a face roster — all of them go through here, none of them is a
    // message, and each one was quietly inserting a **blank pending row** that
    // never resolved, because there is no incoming message for it to reconcile
    // against.
    //
    // The ephemeral branch above already learned this from typing notices. This
    // is the same lesson for the other twelve event types, found when a
    // `room.faces` announcement put a faceless row in a real timeline and the
    // avatar renderer fell over on it.
    if (payload.type === 'm.message') {
      const optimistic: Message & { clientNonce: string } = {
        id: localId,
        account: this.#account,
        at: this.#now(),
        body: (payload as { body?: unknown }).body ?? '',
        replyTo: (payload as { replyTo?: string }).replyTo,
        thread: (payload as { thread?: string }).thread,
        // The face it is being sent as. Without this the row renders as
        // **Unknown** until the echo replaces it — which is 100 ms on a good
        // connection and forever on a bad one, so the first place anybody sees
        // it is the place it matters least to be wrong: your own message,
        // sitting there attributed to nobody, while the network is down.
        face: (payload as { face?: Message['face'] }).face,
        clientNonce,
      };
      this.#commitSync(roomId, addPending(this.state(roomId), optimistic));
    }

    return await this.#deliver(roomId, groupId, payload, options, clientNonce);
  }

  /**
   * Send something that already has a nonce and a row on screen.
   *
   * Shared by `send` and `retry`, and the nonce is what makes sharing it safe:
   * the transport is idempotent on it, so a retry after a response that was
   * dropped in flight is the *same* message arriving again rather than a
   * second one.
   */
  async #deliver(
    roomId: string,
    groupId: string,
    payload: Record<string, unknown>,
    options: RoomSendOptions,
    clientNonce: string,
  ): Promise<RoomState> {
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
      this.#unsent.delete(clientNonce);
      return await this.receive(roomId, result.event);
    } catch (error) {
      this.#outbox.delete(clientNonce);
      // Kept so `retry` has something to send. Only for messages: nothing
      // else has a row on screen to retry *from*, and a read receipt that
      // failed is one the next one supersedes anyway.
      if (payload.type === 'm.message') {
        this.#unsent.set(clientNonce, { roomId, payload, options });
      }
      const failed = markFailed(this.state(roomId), clientNonce);
      await this.#commit(roomId, failed);
      throw error;
    }
  }

  /**
   * Send a failed message again.
   *
   * `docs/29`'s dogfooding condition is "unplug the network mid-conversation;
   * nothing is lost". A send that fails is *marked* failed rather than
   * pretending — which is the honest half — and without this it was also the
   * end of that message, because the only copy of what you typed was a row on
   * screen with no way to send it.
   *
   * Same nonce as the original. If the first attempt actually reached the
   * server and only the response was lost, the server recognises the nonce and
   * this resolves to the message that is already there.
   */
  async retry(roomId: string, clientNonce: string): Promise<RoomState> {
    const held = this.#unsent.get(clientNonce);
    if (!held) return this.state(roomId);

    // Pending again while it is in flight, so the row stops offering a retry
    // it is already doing.
    this.#commitSync(roomId, markPending(this.state(roomId), clientNonce));
    const groupId = await this.groupFor(roomId);
    return await this.#deliver(roomId, groupId, held.payload, held.options, clientNonce);
  }

  /** Give up on a failed send and take it off the screen. */
  async discard(roomId: string, clientNonce: string): Promise<RoomState> {
    this.#unsent.delete(clientNonce);
    const next = dropPending(this.state(roomId), clientNonce);
    await this.#commit(roomId, next);
    return next;
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

  /**
   * Drop everything this device holds about a room.
   *
   * For a room that is *gone* — deleted on the Host — rather than one this
   * account has left. The distinction matters for the group: leaving takes the
   * MLS state with it, and a deleted room may have been sharing its group with
   * siblings that are still there (`docs/03` §4), so this deliberately touches
   * only the room.
   *
   * Listeners are notified with an empty room before the store write, because
   * the UI is holding the old state and must not keep rendering a room that no
   * longer exists while a disk write completes.
   */
  async forget(roomId: string): Promise<void> {
    this.stopListening(roomId);
    this.#commitSync(roomId, emptyRoom(roomId));
    this.#rooms.delete(roomId);
    this.#listeners.delete(roomId);
    await this.#store.forgetRoom(roomId);
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.#unsubscribes.values()) unsubscribe();
    this.#unsubscribes.clear();
    this.#listeners.clear();
    this.#rooms.clear();
  }

  // -- internals ------------------------------------------------------------

  /**
   * One room's turn at a time.
   *
   * Every path that changes a room's state is a read-modify-write: read
   * `state(roomId)`, reduce, commit. Two of those interleaving is a lost
   * update — both reduce from the same base and the later commit throws the
   * earlier one's events away. The event survives in the store, because the
   * store write is not the thing that raced, so the symptom is a message that
   * is on disk and missing from the screen until something reopens the room.
   *
   * That is not hypothetical: it happens whenever a message arrives while this
   * device is sending in the same room — a read receipt, say — which is a
   * thing that happens constantly and never once in a single-threaded test.
   *
   * Per room rather than global, so a busy room cannot hold up a quiet one.
   */
  #turns = new Map<string, Promise<unknown>>();

  async #inTurn<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#turns.get(roomId) ?? Promise.resolve();
    // `.then` rather than `await`, so a failed turn does not poison the queue
    // for every turn behind it.
    const mine = previous.then(work, work);
    // What the *next* turn waits on: `mine` with its rejection absorbed, so a
    // failed turn does not reject the whole chain behind it.
    const queued = mine.catch(() => {});
    this.#turns.set(roomId, queued);
    try {
      return await mine;
    } finally {
      // Let the map go once this is the last turn, so a long-lived client does
      // not accumulate a settled promise per room it has ever touched.
      if (this.#turns.get(roomId) === queued) this.#turns.delete(roomId);
    }
  }

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

/**
 * A room, or a thread inside one.
 *
 * Typing is per *place*: `docs/16` calls a thread "a branch inside a room, not
 * a room", and that is exactly right for delivery and exactly wrong for a
 * typing indicator — somebody typing in a branch is not typing in the room, and
 * showing it there is how a busy room permanently claims three people are about
 * to say something in it.
 */
function place(roomId: string, thread?: string): string {
  return thread ? `${roomId}/${thread}` : roomId;
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
