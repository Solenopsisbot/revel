/**
 * A `LocalStore` on IndexedDB — the browser one.
 *
 * `docs/02` names Dexie for this. This is the same shape without the
 * dependency: four object stores, one index, and about two hundred lines. Dexie
 * is a good library and most of what it gives you is a query builder this
 * interface does not have a use for — `LocalStore` has eleven methods and every
 * one of them is a get, a put, or a cursor over one index.
 *
 * ## Two things IndexedDB will do to you
 *
 * **Transactions die when you await something that is not part of them.** A
 * transaction stays alive only while it has pending requests; `await` a promise
 * that resolves from a different task and the transaction commits underneath
 * you, and the next request against it throws `TransactionInactiveError`. So
 * every method here opens its transaction, issues its requests, and awaits the
 * transaction as a whole — never a promise from outside it in between.
 *
 * **It structured-clones.** That is why `Map`, `Set` and `Uint8Array` survive a
 * round trip, which the reducer's state is full of, and it is also why nothing
 * here needs its own serialisation format.
 */
import type { LocalEvent, RoomState } from '../rooms/state.js';
import type { ListEventsOptions, LocalStore, SealedKind, SealedRecord } from './types.js';

const DB_VERSION = 1;

const EVENTS = 'events';
const ROOMS = 'rooms';
const SEALED = 'sealed';
const VALUES = 'values';

/**
 * `[roomId, paddedEventId]`, so a room's events are one contiguous key range
 * *and* that range is in event order.
 *
 * The padding is load-bearing. IndexedDB compares strings lexically, and event
 * ids are decimal snowflakes, so `"9"` would sort after `"10"` — cursors,
 * ranges and limits would all silently page the wrong events, which looks
 * exactly like the server having lost something. Left-padding to a fixed width
 * makes lexical order and numeric order the same order, and then every range
 * query below is just a range query.
 */
type EventKey = [string, string];

/** Snowflakes are at most 20 digits (`docs/04` §6). */
const ID_WIDTH = 20;

const pad = (id: string) => id.padStart(ID_WIDTH, '0');

/** Above every padded id, so `[room, HIGH]` ends a room's range. */
const HIGH = '\uffff';

interface StoredEvent {
  roomId: string;
  event: LocalEvent;
}

export interface IndexedDbStoreOptions {
  /** Database name. One per account keeps two signed-in accounts apart. */
  name?: string;
  /** For tests, or a non-browser host with a shim. Defaults to `indexedDB`. */
  factory?: IDBFactory;
}

export class IndexedDbStore implements LocalStore {
  #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
  }

  static async open(options: IndexedDbStoreOptions = {}): Promise<IndexedDbStore> {
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('no IndexedDB here; use MemoryStore instead');

    const opening = factory.open(options.name ?? 'revel', DB_VERSION);
    const db = await request<IDBDatabase>(opening, () => {
      opening.onupgradeneeded = () => {
        const database = opening.result;
        // Compound key so `listEvents` is a range scan over one room rather
        // than a filter over every event this device has ever seen.
        if (!database.objectStoreNames.contains(EVENTS)) {
          database.createObjectStore(EVENTS);
        }
        if (!database.objectStoreNames.contains(ROOMS)) database.createObjectStore(ROOMS);
        if (!database.objectStoreNames.contains(SEALED)) database.createObjectStore(SEALED);
        if (!database.objectStoreNames.contains(VALUES)) database.createObjectStore(VALUES);
      };
    });

    return new IndexedDbStore(db);
  }

  // -- events ---------------------------------------------------------------

  async putEvents(roomId: string, events: LocalEvent[]): Promise<void> {
    if (events.length === 0) return;
    const tx = this.#db.transaction(EVENTS, 'readwrite');
    const store = tx.objectStore(EVENTS);
    for (const event of events) {
      // `add` rather than `put`, so an event that is already here is left
      // alone rather than overwritten. Re-delivery is not new information.
      const req = store.add({ roomId, event } satisfies StoredEvent, key(roomId, event.id));
      // **Only a duplicate.** Re-delivery is not new information and a
      // `ConstraintError` is the expected case, so it is swallowed and the
      // transaction carries on.
      //
      // Everything else is allowed through to abort the transaction. This used
      // to swallow every error, which meant `QuotaExceededError` — the disk
      // being full, which is the one storage failure that actually happens —
      // completed the transaction reporting success while writing nothing, and
      // the message was gone with no trace anywhere.
      req.onerror = (e: Event) => {
        if (req.error?.name !== 'ConstraintError') return;
        e.preventDefault();
        e.stopPropagation();
      };
    }
    await done(tx);
  }

  async listEvents(roomId: string, options: ListEventsOptions = {}): Promise<LocalEvent[]> {
    const tx = this.#db.transaction(EVENTS, 'readonly');
    const store = tx.objectStore(EVENTS);

    const out: LocalEvent[] = [];
    const limit = options.limit;
    // Paging backwards wants the newest of what is older, so walk down from
    // `before`; everything else walks up from the start.
    const backwards = options.before !== undefined;

    if (!backwards) {
      // **One request, not one per row.** This used to walk a cursor and call
      // `continue()` for every event, which is an event-loop round trip each
      // time — and this is the cold-open path, so it was 2,000 of them before
      // the first paint. Measuring `docs/29` §5's budget found it: writing
      // 2,000 events took 78 ms and *reading them back* took 5,639 ms. A slow
      // storage layer would have been slow at both.
      //
      // `getAll` cannot walk backwards, which is why the cursor survives below
      // — but that path is `backfill`, bounded by a page size of 50, where the
      // round trips are 50 and nobody is waiting on a first paint.
      const rows = await request<StoredEvent[]>(
        limit === undefined
          ? store.getAll(rangeFor(roomId, options))
          : store.getAll(rangeFor(roomId, options), limit),
      );
      await done(tx);
      return rows.map((row) => row.event);
    }

    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(rangeFor(roomId, options), backwards ? 'prev' : 'next');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        out.push((cursor.value as StoredEvent).event);
        if (limit !== undefined && out.length >= limit) return resolve();
        cursor.continue();
      };
    });

    await done(tx);
    if (backwards) out.reverse();
    return out;
  }

  async lastEventId(roomId: string): Promise<string | null> {
    const tx = this.#db.transaction(EVENTS, 'readonly');
    const store = tx.objectStore(EVENTS);
    const found = await new Promise<string | null>((resolve, reject) => {
      // A value cursor, not a key cursor: the key holds the *padded* id and the
      // caller wants the real one.
      const req = store.openCursor(rangeFor(roomId, {}), 'prev');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result ? (req.result.value as StoredEvent).event.id : null);
    });
    await done(tx);
    return found;
  }

  // -- materialised rooms ---------------------------------------------------

  async putRoom(state: RoomState): Promise<void> {
    const tx = this.#db.transaction(ROOMS, 'readwrite');
    tx.objectStore(ROOMS).put(state, state.roomId);
    await done(tx);
  }

  async getRoom(roomId: string): Promise<RoomState | null> {
    const tx = this.#db.transaction(ROOMS, 'readonly');
    const value = await request<RoomState | undefined>(tx.objectStore(ROOMS).get(roomId));
    await done(tx);
    return value ?? null;
  }

  async listRoomIds(): Promise<string[]> {
    const tx = this.#db.transaction([ROOMS, EVENTS], 'readonly');
    const snapshots = await request<IDBValidKey[]>(tx.objectStore(ROOMS).getAllKeys());

    // A room can have events and no snapshot — it has been synced but never
    // opened. Leaving it out would make it invisible to a caller enumerating
    // what this device knows about.
    const withEvents = new Set<string>();
    await new Promise<void>((resolve, reject) => {
      const req = tx.objectStore(EVENTS).openKeyCursor();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        const [room] = cursor.key as EventKey;
        withEvents.add(room);
        // Skip the rest of this room's events: we only need it once, and a
        // busy room has tens of thousands of them.
        cursor.continue([room, HIGH]);
      };
    });

    await done(tx);
    return [...new Set([...snapshots.map(String), ...withEvents])].sort();
  }

  async forgetRoom(roomId: string): Promise<void> {
    const tx = this.#db.transaction([ROOMS, EVENTS], 'readwrite');
    tx.objectStore(ROOMS).delete(roomId);
    tx.objectStore(EVENTS).delete(rangeFor(roomId, {}));
    await done(tx);
  }

  // -- sealed crypto state --------------------------------------------------

  async putSealed(kind: SealedKind, id: string, bytes: Uint8Array): Promise<void> {
    const tx = this.#db.transaction(SEALED, 'readwrite');
    const record: SealedRecord = { kind, id, bytes, at: Date.now() };
    tx.objectStore(SEALED).put(record, `${kind} ${id}`);
    await done(tx);
  }

  async getSealed(kind: SealedKind, id: string): Promise<Uint8Array | null> {
    const tx = this.#db.transaction(SEALED, 'readonly');
    const record = await request<SealedRecord | undefined>(
      tx.objectStore(SEALED).get(`${kind} ${id}`),
    );
    await done(tx);
    return record?.bytes ?? null;
  }

  async listSealed(kind: SealedKind): Promise<SealedRecord[]> {
    const tx = this.#db.transaction(SEALED, 'readonly');
    const all = await request<SealedRecord[]>(tx.objectStore(SEALED).getAll());
    await done(tx);
    return all
      .filter((r) => r.kind === kind)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  async deleteSealed(kind: SealedKind, id: string): Promise<void> {
    const tx = this.#db.transaction(SEALED, 'readwrite');
    tx.objectStore(SEALED).delete(`${kind} ${id}`);
    await done(tx);
  }

  // -- account-level values -------------------------------------------------

  async put(key: string, value: unknown): Promise<void> {
    const tx = this.#db.transaction(VALUES, 'readwrite');
    tx.objectStore(VALUES).put({ value }, key);
    await done(tx);
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const tx = this.#db.transaction(VALUES, 'readonly');
    // Wrapped in an object so that a stored `null` or `undefined` is
    // distinguishable from "not here", which `get` alone cannot express.
    const record = await request<{ value: T } | undefined>(tx.objectStore(VALUES).get(key));
    await done(tx);
    return record ? record.value : null;
  }

  async delete(key: string): Promise<void> {
    const tx = this.#db.transaction(VALUES, 'readwrite');
    tx.objectStore(VALUES).delete(key);
    await done(tx);
  }

  // -- housekeeping ---------------------------------------------------------

  async clear(): Promise<void> {
    const tx = this.#db.transaction([EVENTS, ROOMS, SEALED, VALUES], 'readwrite');
    for (const name of [EVENTS, ROOMS, SEALED, VALUES]) tx.objectStore(name).clear();
    await done(tx);
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}

function key(roomId: string, eventId: string): EventKey {
  return [roomId, pad(eventId)];
}

/** The key range for a room, honouring `after` and `before` as exclusive bounds. */
function rangeFor(roomId: string, options: ListEventsOptions): IDBKeyRange {
  const lower: EventKey = [roomId, options.after ? pad(options.after) : ''];
  const upper: EventKey = [roomId, options.before ? pad(options.before) : HIGH];
  return IDBKeyRange.bound(lower, upper, options.after !== undefined, options.before !== undefined);
}

/** Wrap an IDBRequest, with a hook to run before the handlers are attached. */
function request<T>(req: IDBRequest, before?: () => void): Promise<T> {
  before?.();
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

/** Wait for a transaction, not for a request inside it. See the module note. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}
