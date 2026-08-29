/**
 * The engine's actual behaviour, synchronously, in whatever thread it is given.
 *
 * Split out from the Worker so it can be tested without one: the Worker is
 * ~60 lines of `postMessage` plumbing, and everything worth getting wrong —
 * handle lifetimes, the group map, the commit/apply split, error messages — is
 * in here and runs under `vitest` in Node.
 *
 * Nothing in this file is async. That is the point of the Worker: the blocking
 * happens somewhere it cannot freeze a frame.
 */
import { Account, Device, type Group, readDeviceCert } from '@revel/crypto-wasm';
import type {
  CommitOutput,
  GroupState,
  Identity,
  Incoming,
  Member,
  OpenOptions,
} from './engine.js';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/**
 * One open crypto session: one account, one device, and the groups it holds.
 *
 * ## On handles
 *
 * wasm-bindgen objects are not garbage. Each one owns memory on the Rust side
 * until something frees it, and at 2,000 leaves that is a lot of memory. So
 * this class is the only thing that ever holds one, and every path that drops
 * a group frees it first. The interface above deals in ids for exactly this
 * reason — a handle that crosses a thread boundary is a handle nobody owns.
 */
export class Session {
  #account: Account;
  #device: Device;
  #groups = new Map<string, Group>();
  #closed = false;

  constructor(options: OpenOptions) {
    this.#account = options.accountSecret
      ? Account.fromSecret(options.accountSecret)
      : new Account();
    // With a stored device secret this is a reload; without one it is an
    // enrolment, and the difference is visible to everyone else in every group.
    this.#device = options.deviceSecret
      ? Device.restore(this.#account, options.deviceLabel, options.deviceSecret)
      : new Device(this.#account, options.deviceLabel);
  }

  identity(): Identity {
    this.#alive();
    return {
      accountPublicKey: this.#account.publicKey,
      certificate: this.#device.certificate,
    };
  }

  exportAccountSecret(): Uint8Array {
    this.#alive();
    return this.#account.secretKey;
  }

  exportDeviceSecret(): Uint8Array {
    this.#alive();
    return this.#device.secretKey;
  }

  keyPackage(): Uint8Array {
    this.#alive();
    return this.#device.keyPackage();
  }

  createGroup(groupId: string): GroupState {
    this.#alive();
    if (this.#groups.has(groupId)) {
      throw new Error(`already holding group ${groupId}; forget it first`);
    }
    const group = this.#device.createGroup(ENC.encode(groupId));
    this.#groups.set(groupId, group);
    return stateOf(groupId, group);
  }

  joinGroup(welcome: Uint8Array): GroupState {
    this.#alive();
    const group = this.#device.joinGroup(welcome);
    const groupId = DEC.decode(group.id);
    // Re-joining a group we already hold is legitimate — a fresh Welcome after
    // losing local state, say — but the old handle has to go or it leaks.
    this.#groups.get(groupId)?.free();
    this.#groups.set(groupId, group);
    return stateOf(groupId, group);
  }

  groups(): string[] {
    this.#alive();
    return [...this.#groups.keys()];
  }

  state(groupId: string): GroupState {
    return stateOf(groupId, this.#group(groupId));
  }

  members(groupId: string): Member[] {
    const raw = this.#group(groupId).members();
    // `members()` hands back a js_sys::Array of wasm objects. Copy the fields
    // out here: they have to survive being structured-cloned to another thread,
    // which a wasm handle cannot do.
    return Array.from(raw, (m: { leaf: number; account: Uint8Array; label: string }) => ({
      leaf: m.leaf,
      account: m.account,
      label: m.label,
    }));
  }

  stageAdd(groupId: string, keyPackages: Uint8Array | Uint8Array[]): number {
    const group = this.#group(groupId);
    for (const kp of Array.isArray(keyPackages) ? keyPackages : [keyPackages]) {
      group.stageAdd(kp);
    }
    return group.staged;
  }

  stageRemove(groupId: string, leaves: number | number[]): number {
    const group = this.#group(groupId);
    for (const leaf of Array.isArray(leaves) ? leaves : [leaves]) {
      group.stageRemove(leaf);
    }
    return group.staged;
  }

  clearStaged(groupId: string): void {
    this.#group(groupId).clearStaged();
  }

  commit(groupId: string): CommitOutput {
    const out = this.#group(groupId).commit();
    const commit = out.commit;
    const welcome = out.welcome;
    return welcome ? { commit, welcome } : { commit };
  }

  applyPending(groupId: string): GroupState {
    const group = this.#group(groupId);
    group.applyPending();
    return stateOf(groupId, group);
  }

  encrypt(groupId: string, plaintext: Uint8Array): Uint8Array {
    return this.#group(groupId).encrypt(plaintext);
  }

  process(groupId: string, message: Uint8Array): Incoming {
    const got = this.#group(groupId).process(message);
    switch (got.kind) {
      case 'application':
        return {
          kind: 'application',
          sender: got.sender ?? -1,
          data: got.data ?? new Uint8Array(),
        };
      case 'commit':
        return { kind: 'commit', sender: got.sender ?? -1 };
      case 'proposal':
        return { kind: 'proposal' };
      default:
        return { kind: 'other' };
    }
  }

  forget(groupId: string): void {
    this.#groups.get(groupId)?.free();
    this.#groups.delete(groupId);
  }

  discard(groupId: string): void {
    this.#alive();
    this.forget(groupId);
    this.#device.forgetGroup(ENC.encode(groupId));
  }

  // -- persistence -----------------------------------------------------------

  dirtyGroups(): string[] {
    this.#alive();
    return Array.from(this.#device.dirtyGroups(), (id: Uint8Array) => DEC.decode(id));
  }

  exportGroup(groupId: string): Uint8Array {
    this.#alive();
    return this.#device.exportGroup(ENC.encode(groupId), this.#account);
  }

  importGroup(sealed: Uint8Array): string {
    this.#alive();
    return DEC.decode(this.#device.importGroup(sealed, this.#account));
  }

  loadGroup(groupId: string): GroupState {
    this.#alive();
    // Replacing rather than refusing: loading a group we already hold is what
    // happens when state arrives from another tab, and the newer one wins.
    this.#groups.get(groupId)?.free();
    const group = this.#device.loadGroup(ENC.encode(groupId));
    this.#groups.set(groupId, group);
    return stateOf(groupId, group);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const group of this.#groups.values()) group.free();
    this.#groups.clear();
    this.#device.free();
    this.#account.free();
  }

  /**
   * Read a device certificate outside any group — for the devices screen.
   * Throws if it does not verify, so an unverified label can never be rendered.
   */
  static readCertificate(bytes: Uint8Array): { account: Uint8Array; label: string } {
    const info = readDeviceCert(bytes);
    return { account: info.account, label: info.label };
  }

  #group(groupId: string): Group {
    this.#alive();
    const group = this.#groups.get(groupId);
    if (!group) {
      // Naming what we do hold, because "no such group" during a sync bug is a
      // question about which ids exist, every time.
      const held = this.#groups.size ? [...this.#groups.keys()].join(', ') : 'none';
      throw new Error(`no group ${groupId} in this session (holding: ${held})`);
    }
    return group;
  }

  #alive(): void {
    if (this.#closed) throw new Error('this crypto session is closed');
  }
}

function stateOf(groupId: string, group: Group): GroupState {
  return {
    groupId,
    // `epoch` is a u64 and arrives as a BigInt. Epochs will not reach 2^53 in
    // any universe where this app still exists, and a BigInt does not survive
    // JSON, so it is narrowed once, here, rather than at every call site.
    epoch: Number(group.epoch),
    size: group.size,
    ownLeaf: group.ownLeaf,
  };
}
