/**
 * Turning a `Request` into an answer.
 *
 * Kept out of `worker.ts` so it can be tested without a Worker — the Worker is
 * plumbing, this is behaviour. Everything here is synchronous; the whole reason
 * a Worker exists is that some of these calls take the better part of a second
 * (`docs/31` §5) and must not do that where a frame can see it.
 */
import type { OpenOptions } from './engine.js';
import { Session } from './session.js';
import type { Args, Op, Request } from './wire.js';

/**
 * Every operation except the two that manage the session itself.
 *
 * A table rather than a switch, and typed against the interface, so a method
 * added to `CryptoEngine` and forgotten here is a compile error rather than a
 * runtime "unknown op" from inside a Worker at three in the morning.
 */
const TABLE: {
  [K in Exclude<Op, 'open' | 'close'>]: (session: Session, ...args: Args<K>) => unknown;
} = {
  exportAccountSecret: (s) => s.exportAccountSecret(),
  exportDeviceSecret: (s) => s.exportDeviceSecret(),
  externalSenders: (s, groupId) => s.externalSenders(groupId),
  identity: (s) => s.identity(),
  keyPackage: (s) => s.keyPackage(),
  signAuth: (s, payload) => s.signAuth(payload),
  createGroup: (s, groupId, externalSender) => s.createGroup(groupId, externalSender),
  joinGroup: (s, welcome, tree) => s.joinGroup(welcome, tree),
  groups: (s) => s.groups(),
  state: (s, groupId) => s.state(groupId),
  members: (s, groupId) => s.members(groupId),
  stageAdd: (s, groupId, keyPackages) => s.stageAdd(groupId, keyPackages),
  stageRemove: (s, groupId, leaves) => s.stageRemove(groupId, leaves),
  clearStaged: (s, groupId) => s.clearStaged(groupId),
  commit: (s, groupId) => s.commit(groupId),
  applyPending: (s, groupId) => s.applyPending(groupId),
  encrypt: (s, groupId, plaintext) => s.encrypt(groupId, plaintext),
  process: (s, groupId, message) => s.process(groupId, message),
  forget: (s, groupId) => s.forget(groupId),
  discard: (s, groupId) => s.discard(groupId),
  dirtyGroups: (s) => s.dirtyGroups(),
  exportGroup: (s, groupId) => s.exportGroup(groupId),
  importGroup: (s, sealed) => s.importGroup(sealed),
  loadGroup: (s, groupId) => s.loadGroup(groupId),
  keyPackagesDirty: (s) => s.keyPackagesDirty(),
  pendingKeyPackages: (s) => s.pendingKeyPackages(),
  exportKeyPackages: (s) => s.exportKeyPackages(),
  importKeyPackages: (s, sealed) => s.importKeyPackages(sealed),
};

/**
 * Holds the one open session and routes calls to it.
 *
 * One session per dispatcher, one dispatcher per Worker, and the Worker is
 * single-threaded — so operations on a group are serialised by construction.
 * That is not incidental: MLS epochs are a sequence, and two commits racing on
 * one group is not a thing that should be *possible*, let alone guarded
 * against.
 */
export class Dispatcher {
  #session: Session | null = null;

  handle(request: Request): unknown {
    switch (request.op) {
      case 'open': {
        // Re-opening replaces the session rather than erroring. Sign-out then
        // sign-in as a different account is the same worker, and leaving the
        // old account's keys resident would be the wrong kind of tidy.
        this.#session?.close();
        this.#session = new Session(request.args[0] as OpenOptions);
        return this.#session.identity();
      }
      case 'close': {
        this.#session?.close();
        this.#session = null;
        return undefined;
      }
      default: {
        const fn = TABLE[request.op] as (session: Session, ...args: unknown[]) => unknown;
        return fn(this.#open(), ...request.args);
      }
    }
  }

  #open(): Session {
    if (!this.#session) {
      throw new Error('no crypto session is open; call open() first');
    }
    return this.#session;
  }
}
