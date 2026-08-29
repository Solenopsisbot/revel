/**
 * @revel/crypto — the seam between the app and the crypto.
 *
 * `docs/26` §Option C: Rust owns MLS, device keys and envelope encryption;
 * TypeScript owns the sync engine, the room reducer, the local store, search
 * and all UI. This package is the join, and it puts the whole Rust side in a
 * Worker — see `engine.ts` for why that is not optional.
 */

export { type SpawnOptions, spawnCryptoEngine, WorkerCryptoEngine } from './client.js';
export type {
  CommitOutput,
  CryptoEngine,
  GroupState,
  Identity,
  Incoming,
  Member,
  OpenOptions,
} from './engine.js';
export { Dispatcher } from './handlers.js';
export { Session } from './session.js';
export type { WasmSource } from './wire.js';
