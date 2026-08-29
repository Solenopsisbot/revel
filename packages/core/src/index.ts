/**
 * @revel/core — the headless client.
 *
 * `docs/02`: the sync engine, the room reducer, the local store, search, and
 * the notification rules. No DOM, no framework — it runs in a browser, in
 * Tauri, in Bun, and in a test.
 *
 * What exists so far is the reducer (`docs/04` §3). The store and the sync
 * engine are next; see the README.
 */
export {
  addPending,
  dropPending,
  emptyRoom,
  markFailed,
  type ReduceOptions,
  reduce,
  reduceAll,
} from './rooms/reduce.js';
export {
  type Annotation,
  compareIds,
  type Edit,
  type KnownEvent,
  type LocalEvent,
  type Message,
  type ParsedPayload,
  type Reaction,
  type RoomState,
} from './rooms/state.js';
