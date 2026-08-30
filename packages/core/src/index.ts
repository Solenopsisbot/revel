/**
 * @revel/core — the headless client.
 *
 * `docs/02`: the sync engine, the room reducer, the local store, search, and
 * the notification rules. No DOM, no framework — it runs in a browser, in
 * Tauri, in Bun, and in a test.
 *
 * The reducer is `docs/04` §3; the store is `docs/02`'s "one `Store` interface"
 * with two implementations behind it. The sync engine is next; see the README.
 */

export type {
  AttachMeta,
  ConnectionCore,
  ConnectionState,
  ConversationCore,
  DirectoryCore,
  IdentityCore,
  RevelCore,
  SendOptions,
} from './app/core.js';
export { LiveCore, type LiveCoreOptions } from './app/live.js';
export { Attachments, type AttachmentsOptions } from './blobs/attachments.js';
export { openBlob, type SealedBlob, type SealOptions, sealBlob } from './blobs/seal.js';
export {
  addPending,
  dropPending,
  emptyRoom,
  markFailed,
  markPurged,
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
export {
  type Hit,
  isEmptyQuery,
  parseQuery,
  type Query,
  type SearchOptions,
  search,
  textOf,
  type Window,
} from './search/search.js';
export { IndexedDbStore, type IndexedDbStoreOptions } from './store/indexeddb.js';
export { MemoryStore } from './store/memory.js';
export type {
  ListEventsOptions,
  LocalStore,
  SealedKind,
  SealedRecord,
} from './store/types.js';
export {
  type RoomListener,
  RoomSync,
  type RoomSyncOptions,
  type TypingPerson,
  toAccountId,
} from './sync/engine.js';
export {
  GroupSync,
  type GroupSyncOptions,
  type GroupTransport,
  HttpGroupTransport,
  type HttpGroupTransportOptions,
  type InviteResult,
  isEpochConflict,
  KEY_PACKAGE_FLOOR,
} from './sync/groups.js';
export { HostSession, type HostSessionOptions } from './sync/session.js';
export {
  type SocketLike,
  WebSocketStream,
  type WebSocketStreamOptions,
} from './sync/socket.js';
export {
  type EventStream,
  type FetchOptions,
  HttpTransport,
  type HttpTransportOptions,
  type SendResult,
  type Transport,
  TransportError,
} from './sync/transport.js';
