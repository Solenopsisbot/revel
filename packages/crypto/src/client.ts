/**
 * The main-thread side: a `CryptoEngine` that is really a Worker.
 *
 * Callers never see a message, an id, or a Worker. They see the interface in
 * `engine.ts` and every method returns a promise, which it would have to do
 * anyway — see the note there about why the seam is async even where it need
 * not be.
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
import type { Args, BootResponse, Op, Request, Response, Result, WasmSource } from './wire.js';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface SpawnOptions {
  /**
   * Where the wasm module is.
   *
   * A URL (the normal case — your bundler emitted the asset and told you where
   * it landed), or the bytes themselves. This package does not go looking:
   * every bundler has its own opinion about how a `.wasm` becomes a URL, and
   * guessing wrong fails at runtime in a Worker, which is the worst place to
   * debug anything.
   */
  wasm: WasmSource;

  /**
   * Supply your own Worker. Useful for a bundler with different ideas about
   * worker URLs, and for tests.
   */
  worker?: Worker;
}

/**
 * A `CryptoEngine` backed by a Worker.
 *
 * ## Ordering
 *
 * Requests are answered in whatever order the Worker finishes them, which for
 * a single-threaded Worker is the order they were sent. Callers still should
 * not fire two commits at one group concurrently — but they *cannot* interleave
 * one, which is the property that matters: an MLS epoch is a sequence, and the
 * failure mode for racing it is a group nobody can read.
 */
export class WorkerCryptoEngine implements CryptoEngine {
  #worker: Worker;
  #pending = new Map<number, Pending>();
  #next = 1;
  #booted: Promise<void>;
  #dead: Error | null = null;

  constructor(worker: Worker, wasm: WasmSource) {
    this.#worker = worker;

    this.#booted = new Promise<void>((resolve, reject) => {
      const onBoot = (event: MessageEvent<BootResponse>) => {
        const data = event.data;
        if (!data || typeof data !== 'object' || !('booted' in data)) return;
        worker.removeEventListener('message', onBoot);
        if (data.booted) resolve();
        else reject(new Error(`the crypto worker could not load its wasm: ${data.error}`));
      };
      worker.addEventListener('message', onBoot);
    });

    worker.addEventListener('message', (event: MessageEvent<Response>) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || !('id' in data)) return;
      const pending = this.#pending.get(data.id);
      if (!pending) return;
      this.#pending.delete(data.id);
      if (data.ok) pending.resolve(data.value);
      else pending.reject(new Error(data.error));
    });

    // A Worker that dies takes every in-flight call with it. Rejecting them is
    // the difference between one visible error and a screen that never loads.
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.#die(new Error(`the crypto worker failed: ${event.message || 'unknown error'}`));
    });

    worker.postMessage({ boot: wasm });
  }

  #die(error: Error): void {
    this.#dead = error;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  async #call<K extends Op>(op: K, ...args: Args<K>): Promise<Result<K>> {
    if (this.#dead) throw this.#dead;
    await this.#booted;
    if (this.#dead) throw this.#dead;

    const id = this.#next++;
    return new Promise<Result<K>>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      // `Args<K>` is the argument tuple *for this K*, so the pairing is correct
      // by construction — but TypeScript cannot see that while K is still a
      // type variable, and checks the object against every arm of the union.
      // The narrowing happens at each public method below, where K is concrete.
      this.#worker.postMessage({ id, op, args } as unknown as Request);
    });
  }

  open(options: OpenOptions): Promise<Identity> {
    return this.#call('open', options);
  }

  exportAccountSecret(): Promise<Uint8Array> {
    return this.#call('exportAccountSecret');
  }

  exportDeviceSecret(): Promise<Uint8Array> {
    return this.#call('exportDeviceSecret');
  }

  keyPackage(): Promise<Uint8Array> {
    return this.#call('keyPackage');
  }

  createGroup(groupId: string): Promise<GroupState> {
    return this.#call('createGroup', groupId);
  }

  joinGroup(welcome: Uint8Array): Promise<GroupState> {
    return this.#call('joinGroup', welcome);
  }

  groups(): Promise<string[]> {
    return this.#call('groups');
  }

  state(groupId: string): Promise<GroupState> {
    return this.#call('state', groupId);
  }

  members(groupId: string): Promise<Member[]> {
    return this.#call('members', groupId);
  }

  stageAdd(groupId: string, keyPackages: Uint8Array | Uint8Array[]): Promise<number> {
    return this.#call('stageAdd', groupId, keyPackages);
  }

  stageRemove(groupId: string, leaves: number | number[]): Promise<number> {
    return this.#call('stageRemove', groupId, leaves);
  }

  clearStaged(groupId: string): Promise<void> {
    return this.#call('clearStaged', groupId);
  }

  commit(groupId: string): Promise<CommitOutput> {
    return this.#call('commit', groupId);
  }

  applyPending(groupId: string): Promise<GroupState> {
    return this.#call('applyPending', groupId);
  }

  encrypt(groupId: string, plaintext: Uint8Array): Promise<Uint8Array> {
    return this.#call('encrypt', groupId, plaintext);
  }

  process(groupId: string, message: Uint8Array): Promise<Incoming> {
    return this.#call('process', groupId, message);
  }

  forget(groupId: string): Promise<void> {
    return this.#call('forget', groupId);
  }

  discard(groupId: string): Promise<void> {
    return this.#call('discard', groupId);
  }

  dirtyGroups(): Promise<string[]> {
    return this.#call('dirtyGroups');
  }

  exportGroup(groupId: string): Promise<Uint8Array> {
    return this.#call('exportGroup', groupId);
  }

  importGroup(sealed: Uint8Array): Promise<string> {
    return this.#call('importGroup', sealed);
  }

  loadGroup(groupId: string): Promise<GroupState> {
    return this.#call('loadGroup', groupId);
  }

  async close(): Promise<void> {
    if (this.#dead) return;
    try {
      await this.#call('close');
    } finally {
      this.#die(new Error('this crypto engine is closed'));
      this.#worker.terminate();
    }
  }
}

/**
 * Start a crypto engine in its own Worker.
 *
 * ```ts
 * import wasm from '@revel/crypto-wasm/revel_crypto_bg.wasm?url';
 * const crypto = spawnCryptoEngine({ wasm });
 * await crypto.open({ deviceLabel: 'laptop' });
 * ```
 *
 * The `new URL(..., import.meta.url)` form is the one every modern bundler
 * recognises as "this is a worker, emit it". If yours does not, pass a `worker`
 * you built yourself.
 */
export function spawnCryptoEngine(options: SpawnOptions): CryptoEngine {
  const worker =
    options.worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new WorkerCryptoEngine(worker, options.wasm);
}
