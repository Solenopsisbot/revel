/**
 * The local store — the real database the UI reads from (`docs/04` §Client-side).
 *
 * `docs/02` puts Dexie over IndexedDB in a browser and SQLite under Tauri and
 * Bun, "behind one `Store` interface". This is that interface. Two
 * implementations ship: [`MemoryStore`](./memory.ts), which is also what the
 * tests run against, and [`IndexedDbStore`](./indexeddb.ts).
 *
 * ## What it holds, and why each of it
 *
 * - **Events**, decrypted. The room is a function of its event log, so the log
 *   is the thing that must survive; a materialised room can always be rebuilt
 *   from it, and a room that disagrees with its log is a bug you can fix by
 *   replaying rather than a corruption you cannot.
 * - **Room snapshots**, materialised. `docs/29` §5 budgets **300 ms** from cold
 *   open to a painted room, which replaying tens of thousands of events does
 *   not fit inside. The snapshot is a cache of the log, and is treated as one.
 * - **Sealed crypto state**, opaque. `@revel/crypto` hands out ciphertext and
 *   this writes it down without being able to read a byte — which is exactly
 *   what `docs/04` means by "sealed at rest".
 * - **Account-level values**: the device secret, cursors, preferences.
 *
 * ## What it does not do
 *
 * No decryption, no policy, no network. It is a place to put bytes, and the
 * ordering rules that matter live in the sync engine above it.
 */
import type { LocalEvent, RoomState } from '../rooms/state.js';

/**
 * The two kinds of sealed blob `@revel/crypto` produces.
 *
 * Group state is per group; key packages are one blob for the whole device
 * (there is one per pending invite and their ids are mls-rs internals).
 */
export type SealedKind = 'group' | 'keyPackages';

export interface SealedRecord {
  kind: SealedKind;
  /** The group id, or `'self'` for the device-wide key package blob. */
  id: string;
  bytes: Uint8Array;
  /** When it was written. Useful for spotting a store that stopped keeping up. */
  at: number;
}

export interface ListEventsOptions {
  /** Only events with an id strictly greater than this one. */
  after?: string;
  /** Only events with an id strictly less than this one. */
  before?: string;
  /** Most this many, taken from the end nearest the cursor. */
  limit?: number;
}

export interface LocalStore {
  // -- events --------------------------------------------------------------

  /**
   * Write decrypted events. Idempotent by event id — the same event arriving
   * from a history page and a live socket must not become two rows.
   */
  putEvents(roomId: string, events: LocalEvent[]): Promise<void>;

  /** Events for a room, in id order. */
  listEvents(roomId: string, options?: ListEventsOptions): Promise<LocalEvent[]>;

  /** The highest event id stored for a room, or null if it is empty. */
  lastEventId(roomId: string): Promise<string | null>;

  // -- materialised rooms ---------------------------------------------------

  /** Cache a room's reduced state so a cold open does not replay the log. */
  putRoom(state: RoomState): Promise<void>;
  getRoom(roomId: string): Promise<RoomState | null>;
  /** Every room with either a snapshot or events. */
  listRoomIds(): Promise<string[]>;
  /** Drop a room's snapshot and events. Local only; the server keeps its copy. */
  forgetRoom(roomId: string): Promise<void>;

  // -- sealed crypto state --------------------------------------------------

  putSealed(kind: SealedKind, id: string, bytes: Uint8Array): Promise<void>;
  getSealed(kind: SealedKind, id: string): Promise<Uint8Array | null>;
  listSealed(kind: SealedKind): Promise<SealedRecord[]>;
  deleteSealed(kind: SealedKind, id: string): Promise<void>;

  // -- account-level values -------------------------------------------------

  put(key: string, value: unknown): Promise<void>;
  get<T = unknown>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;

  // -- housekeeping ---------------------------------------------------------

  /** Everything, gone. Sign-out, and the "this device forgets you" button. */
  clear(): Promise<void>;
  close(): Promise<void>;
}
