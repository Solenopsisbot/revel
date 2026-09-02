/**
 * A `CryptoEngine` with no Worker under it.
 *
 * The Worker exists because a browser has a thread that paints and MLS commits
 * are slow enough to be visible on it (`docs/31` §6). Nothing else has that
 * problem. An agent host, a bot, a Bun process, a test — all of them have a
 * main thread whose only job is this work, and for them a Worker is two
 * instantiations of the wasm and a message protocol in exchange for nothing.
 *
 * So this is the same engine, running here. Every method is still async,
 * because the interface is async and callers must not be able to tell the
 * difference; see the note in `engine.ts` about why that is deliberate.
 *
 * **Do not use it in a browser.** A 500-leaf removal is 212 ms and a 2,000-leaf
 * one is 804 ms, and on the main thread that is 13 and 48 dropped frames.
 */
import type {
  CommitOutput,
  CryptoEngine,
  GroupState,
  Identity,
  Incoming,
  Member,
  OpenOptions,
} from './engine.js';
import { Session } from './session.js';

export class LocalCryptoEngine implements CryptoEngine {
  #session: Session | null = null;

  async open(options: OpenOptions): Promise<Identity> {
    this.#session?.close();
    this.#session = new Session(options);
    return this.#session.identity();
  }

  async exportAccountSecret(): Promise<Uint8Array> {
    return this.#open().exportAccountSecret();
  }

  async exportDeviceSecret(): Promise<Uint8Array> {
    return this.#open().exportDeviceSecret();
  }

  async keyPackage(): Promise<Uint8Array> {
    return this.#open().keyPackage();
  }

  async createGroup(groupId: string, externalSender?: Uint8Array): Promise<GroupState> {
    return this.#open().createGroup(groupId, externalSender);
  }

  async identity(): Promise<Identity> {
    return this.#open().identity();
  }

  async externalSenders(groupId: string): Promise<Uint8Array[]> {
    return this.#open().externalSenders(groupId);
  }

  async signAuth(payload: Uint8Array): Promise<Uint8Array> {
    return this.#open().signAuth(payload);
  }

  async joinGroup(welcome: Uint8Array, tree: Uint8Array): Promise<GroupState> {
    return this.#open().joinGroup(welcome, tree);
  }

  async groups(): Promise<string[]> {
    return this.#open().groups();
  }

  async state(groupId: string): Promise<GroupState> {
    return this.#open().state(groupId);
  }

  async members(groupId: string): Promise<Member[]> {
    return this.#open().members(groupId);
  }

  async stageAdd(groupId: string, keyPackages: Uint8Array | Uint8Array[]): Promise<number> {
    return this.#open().stageAdd(groupId, keyPackages);
  }

  async stageRemove(groupId: string, leaves: number | number[]): Promise<number> {
    return this.#open().stageRemove(groupId, leaves);
  }

  async clearStaged(groupId: string): Promise<void> {
    this.#open().clearStaged(groupId);
  }

  async commit(groupId: string): Promise<CommitOutput> {
    return this.#open().commit(groupId);
  }

  async applyPending(groupId: string): Promise<GroupState> {
    return this.#open().applyPending(groupId);
  }

  async encrypt(groupId: string, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    return this.#open().encrypt(groupId, plaintext, aad);
  }

  async decrypt(groupId: string, message: Uint8Array, aad: Uint8Array): Promise<Incoming> {
    return this.#open().decrypt(groupId, message, aad);
  }

  async process(groupId: string, message: Uint8Array): Promise<Incoming> {
    return this.#open().process(groupId, message);
  }

  async forget(groupId: string): Promise<void> {
    this.#open().forget(groupId);
  }

  async discard(groupId: string): Promise<void> {
    this.#open().discard(groupId);
  }

  async dirtyGroups(): Promise<string[]> {
    return this.#open().dirtyGroups();
  }

  async exportGroup(groupId: string): Promise<Uint8Array> {
    return this.#open().exportGroup(groupId);
  }

  async importGroup(sealed: Uint8Array): Promise<string> {
    return this.#open().importGroup(sealed);
  }

  async loadGroup(groupId: string): Promise<GroupState> {
    return this.#open().loadGroup(groupId);
  }

  async keyPackagesDirty(): Promise<boolean> {
    return this.#open().keyPackagesDirty();
  }

  async pendingKeyPackages(): Promise<number> {
    return this.#open().pendingKeyPackages();
  }

  async exportKeyPackages(): Promise<Uint8Array> {
    return this.#open().exportKeyPackages();
  }

  async importKeyPackages(sealed: Uint8Array): Promise<number> {
    return this.#open().importKeyPackages(sealed);
  }

  async close(): Promise<void> {
    this.#session?.close();
    this.#session = null;
  }

  #open(): Session {
    if (!this.#session) throw new Error('no crypto session is open; call open() first');
    return this.#session;
  }
}
