/**
 * The server as a library.
 *
 * `index.ts` is the Bun entrypoint: it constructs a store, a hub and a port,
 * and it prints. That is the right shape for something you run and the wrong
 * shape for something you import — a test that wants `createApp` should not
 * get a listening socket and a log line as well.
 *
 * So the package's export is this, and the entrypoint stays a script.
 */
export { type AccountDeps, mountAccounts, resolveAddress } from './accounts.js';
export { type AppDeps, createApp } from './app.js';
export {
  type AuthDeps,
  createHostIdentity,
  mountAuth,
  sessionAuthenticator,
} from './auth.js';
export { type BlobDeps, mountBlobs } from './blobs.js';
export { type Connection, Hub } from './hub.js';
export { mountPush, notify, type PushDeps, type PushRouteDeps, type PushSender } from './push.js';
export {
  type Bucket,
  classify,
  LIMITS,
  type LimitClass,
  type RateLimitDeps,
  RateLimiter,
  rateLimit,
  type Verdict,
} from './ratelimit.js';
export { mountRooms, type RoomDeps } from './rooms.js';
export { type Actor, type SocketDeps, SocketSession } from './socket.js';
export { MemoryStore } from './store/memory.js';
export { PostgresStore, type PostgresStoreOptions } from './store/postgres.js';
export type {
  Account,
  Blob,
  Challenge,
  Device,
  Group,
  GroupMember,
  Membership,
  Override,
  Role,
  Room,
  Session,
  Store,
  StoredPushSubscription,
} from './store/types.js';
export { mountWellKnown, type SecurityContact, type WellKnownDeps } from './wellknown.js';
