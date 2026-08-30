/**
 * The client half of the handshake surface.
 *
 * `RoomSync` moves messages inside a group that already exists. This is how one
 * comes to exist and how people get into it: publish key packages, claim
 * somebody else's, batch a commit, survive losing the race for it, and open a
 * Welcome that arrived while the laptop was shut.
 *
 * ## Three steps, and the seams matter
 *
 * ```ts
 * const out = await crypto.commit(groupId);   // built, not applied
 * await transport.appendHandshake(...);       // the server may refuse
 * await crypto.applyPending(groupId);         // only now is it ours
 * ```
 *
 * Applying before the server accepts **forks the group**: this device reaches
 * an epoch nobody else ever will, and every message after it is unreadable by
 * everyone including its sender. There is no repair. So the loser of a commit
 * race is in perfect shape — it never applied anything — and [`GroupSync.invite`]
 * simply clears, catches up and tries again.
 *
 * ## And the ordering rule from `docs/31` §7
 *
 * Every crypto mutation here is persisted before anything is done with its
 * result. Same reason as `RoomSync.send`: a state that was never written down
 * can be restored behind, and a restored MLS state re-derives keys and nonces
 * it has already used.
 */
import type { CryptoEngine } from '@revel/crypto';
import type {
  Claim,
  ClaimResponse,
  GroupInfo,
  HandshakeAccepted,
  HandshakeInput,
  HandshakeRecord,
  HostInfo,
  KeyPackageSupply,
  KeyPackageUpload,
  PendingWelcome,
  RatchetTree,
} from '@revel/protocol';
import { fromBase64, toBase64 } from '@revel/protocol';
import type { LocalStore } from '../store/types.js';
import { TransportError } from './transport.js';

/** How far this device has applied a group's handshake log. */
const cursorKey = (groupId: string) => `group:cursor:${groupId}`;

/**
 * `docs/03` §5: every device keeps at least twenty one-time key packages at the
 * IdP. Below this, top up; running dry means falling back to the reusable
 * last-resort package and losing forward secrecy for that one add.
 */
export const KEY_PACKAGE_FLOOR = 20;

/** How many times to rebuild a commit after losing the race for it. */
const COMMIT_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * The handshake routes, as an interface.
 *
 * Separate from [`Transport`] because they are separate concerns that happen to
 * share a server: one moves opaque events, this one moves the key agreement
 * that makes those events mean anything. A host that split the IdP and Host
 * roles across two machines (`docs/02`) would implement them against two
 * different base URLs.
 */
export interface GroupTransport {
  publishKeyPackages(devicePub: string, upload: KeyPackageUpload): Promise<KeyPackageSupply>;
  keyPackageSupply(devicePub: string): Promise<KeyPackageSupply>;

  createGroup(roomId: string): Promise<GroupInfo>;
  groupInfo(groupId: string): Promise<GroupInfo>;

  claim(groupId: string, accounts: string[]): Promise<ClaimResponse>;

  /** Throws `TransportError` with reason `epoch_conflict` when the race is lost. */
  appendHandshake(groupId: string, input: HandshakeInput): Promise<HandshakeAccepted>;
  fetchHandshake(
    groupId: string,
    options?: { since?: number; limit?: number },
  ): Promise<HandshakeRecord[]>;

  /**
   * Publish a tree on its own.
   *
   * Not the normal path — a commit carries its own tree in `HandshakeInput`,
   * because publishing separately races the Welcome. This is the repair: a
   * group whose tree is missing or wrong at the current epoch, which any member
   * can fix because the tree is public and every member can check it.
   */
  putTree(groupId: string, tree: RatchetTree): Promise<void>;
  getTree(groupId: string): Promise<RatchetTree | null>;

  /**
   * What this Host is, before you have talked to it.
   *
   * Needed *before* the first group is opened: the external sender goes into
   * the group context at creation and cannot be added for free afterwards.
   */
  hostInfo(): Promise<HostInfo>;

  welcomes(): Promise<PendingWelcome[]>;
  ackWelcome(groupId: string): Promise<void>;

  /** Tell the server this device is not in the group. Not a removal. */
  leaveGroup(groupId: string): Promise<void>;
}

export interface HttpGroupTransportOptions {
  baseUrl: string;
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  fetch?: typeof globalThis.fetch;
}

export class HttpGroupTransport implements GroupTransport {
  #baseUrl: string;
  #headers: NonNullable<HttpGroupTransportOptions['headers']>;
  #fetch: typeof globalThis.fetch;

  constructor(options: HttpGroupTransportOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#headers = options.headers ?? (() => ({}));
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  publishKeyPackages(devicePub: string, upload: KeyPackageUpload): Promise<KeyPackageSupply> {
    return this.#json(`/idp/devices/${encodeURIComponent(devicePub)}/key-packages`, {
      method: 'PUT',
      body: JSON.stringify(upload),
    });
  }

  keyPackageSupply(devicePub: string): Promise<KeyPackageSupply> {
    return this.#json(`/idp/devices/${encodeURIComponent(devicePub)}/key-packages`, {
      method: 'GET',
    });
  }

  createGroup(roomId: string): Promise<GroupInfo> {
    return this.#json('/groups', { method: 'POST', body: JSON.stringify({ roomId }) });
  }

  hostInfo(): Promise<HostInfo> {
    return this.#json('/.well-known/revel/host', { method: 'GET' });
  }

  groupInfo(groupId: string): Promise<GroupInfo> {
    return this.#json(`/groups/${encodeURIComponent(groupId)}`, { method: 'GET' });
  }

  claim(groupId: string, accounts: string[]): Promise<ClaimResponse> {
    return this.#json(`/groups/${encodeURIComponent(groupId)}/key-packages/claim`, {
      method: 'POST',
      body: JSON.stringify({ accounts }),
    });
  }

  appendHandshake(groupId: string, input: HandshakeInput): Promise<HandshakeAccepted> {
    return this.#json(`/groups/${encodeURIComponent(groupId)}/handshake`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async fetchHandshake(
    groupId: string,
    options: { since?: number; limit?: number } = {},
  ): Promise<HandshakeRecord[]> {
    const query = new URLSearchParams();
    if (options.since !== undefined) query.set('since', String(options.since));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const suffix = query.size ? `?${query}` : '';

    const body = await this.#json<{ records: HandshakeRecord[] }>(
      `/groups/${encodeURIComponent(groupId)}/handshake${suffix}`,
      { method: 'GET' },
    );
    return body.records;
  }

  async putTree(groupId: string, tree: RatchetTree): Promise<void> {
    await this.#send(`/groups/${encodeURIComponent(groupId)}/tree`, {
      method: 'PUT',
      body: JSON.stringify(tree),
    });
  }

  async getTree(groupId: string): Promise<RatchetTree | null> {
    try {
      return await this.#json<RatchetTree>(`/groups/${encodeURIComponent(groupId)}/tree`, {
        method: 'GET',
      });
    } catch (error) {
      // No tree yet is an ordinary state, not a failure: nobody has committed
      // one since the group opened.
      if (error instanceof TransportError && error.status === 404) return null;
      throw error;
    }
  }

  async welcomes(): Promise<PendingWelcome[]> {
    const body = await this.#json<{ welcomes: PendingWelcome[] }>('/welcomes', { method: 'GET' });
    return body.welcomes;
  }

  async ackWelcome(groupId: string): Promise<void> {
    await this.#send(`/groups/${encodeURIComponent(groupId)}/welcome`, { method: 'DELETE' });
  }

  async leaveGroup(groupId: string): Promise<void> {
    await this.#send(`/groups/${encodeURIComponent(groupId)}/membership`, { method: 'DELETE' });
  }

  async #send(path: string, init: RequestInit): Promise<Response> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(await this.#headers()),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const reason = await response
        .json()
        .then((b: unknown) => (b as { error?: string })?.error)
        .catch(() => undefined);
      throw new TransportError(response.status, reason ?? `http_${response.status}`);
    }
    return response;
  }

  async #json<T>(path: string, init: RequestInit): Promise<T> {
    return (await (await this.#send(path, init)).json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface GroupSyncOptions {
  crypto: CryptoEngine;
  store: LocalStore;
  transport: GroupTransport;
  /** This device's public key, as the server spells it on `Event.sender`. */
  device: string;
  /**
   * Write crypto state down. `RoomSync.persistCrypto` is exactly this, and
   * passing it in rather than duplicating it means one implementation of the
   * rule in `docs/31` §7 rather than two that can drift.
   */
  persist(): Promise<void>;
  /** Called when a group's epoch moves, so the caller can refresh a roster. */
  onEpoch?: (groupId: string, epoch: number) => void;

  /**
   * Called when this device turns out not to be in a group any more.
   *
   * Worth a UI: `docs/22` should be able to say "you were removed from this
   * room" rather than showing a room that has quietly stopped working. By the
   * time this fires the local state is already gone.
   */
  onRemoved?: (groupId: string) => void;
}

export interface InviteResult {
  /** Devices that got a leaf. */
  added: string[];
  /** Accounts nobody could claim a package for — no devices, or none left. */
  missing: string[];
  /** Claims that fell back to the reusable package. Worth surfacing. */
  lastResort: Claim[];
  /** The epoch the group is now at. */
  epoch: number;
  /** How many times the commit had to be rebuilt after losing a race. */
  attempts: number;
}

/**
 * Membership, from this device's side.
 *
 * Holds no state of its own beyond a per-group cursor into the handshake log:
 * the crypto engine owns the MLS state and the store owns everything durable,
 * so this can be constructed and thrown away.
 */
export class GroupSync {
  #crypto: CryptoEngine;
  #store: LocalStore;
  #transport: GroupTransport;
  #device: string;
  #persist: () => Promise<void>;
  #onEpoch: ((groupId: string, epoch: number) => void) | undefined;
  #onRemoved: ((groupId: string) => void) | undefined;
  #cursors = new Map<string, number>();

  constructor(options: GroupSyncOptions) {
    this.#crypto = options.crypto;
    this.#store = options.store;
    this.#transport = options.transport;
    this.#device = options.device;
    this.#persist = options.persist;
    this.#onEpoch = options.onEpoch;
    this.#onRemoved = options.onRemoved;
  }

  // -- key packages ---------------------------------------------------------

  /**
   * Top the shelf back up to the floor, if it has fallen below it.
   *
   * Generating and publishing are both cheap; being unreachable because you ran
   * out is not. Returns what the server now holds.
   */
  async replenish(floor = KEY_PACKAGE_FLOOR): Promise<KeyPackageSupply> {
    const supply = await this.#transport.keyPackageSupply(this.#device);
    if (supply.available >= floor && supply.lastResort) return supply;

    // A full fresh set, not a top-up. The server replaces the shelf wholesale,
    // and this device cannot read the public halves of what is already up
    // there — only how many. Generating `floor` new ones and replacing is
    // therefore both simpler and correct, and it discards nothing: the private
    // halves of the replaced packages stay in the engine, so a Welcome built
    // from one claimed a moment before the replace still opens.
    const packages: string[] = [];
    for (let i = 0; i < floor; i++) packages.push(toBase64(await this.#crypto.keyPackage()));

    // One more of exactly the same thing. What makes it last-resort is on the
    // server's side: it hands this one out repeatedly once the shelf is empty,
    // which is why running dry costs forward secrecy rather than reachability.
    const lastResort = toBase64(await this.#crypto.keyPackage());

    // Persist before publishing. The private halves are what open a Welcome, so
    // a crash in the other order leaves packages advertised that this device
    // can never honour — an invite that fails silently rather than one that
    // never came.
    await this.#persist();
    return this.#transport.publishKeyPackages(this.#device, { packages, lastResort });
  }

  // -- opening and joining --------------------------------------------------

  /**
   * Which rooms a group's keys open, as far as this device may see.
   *
   * A Welcome carries a group id and nothing else, so this is how a device that
   * has just joined finds out what conversation it can now read.
   */
  async roomsOf(groupId: string): Promise<string[]> {
    return (await this.#transport.groupInfo(groupId)).rooms;
  }

  /**
   * Open a group for a room that has none. Returns its id.
   *
   * Names the Host as an MLS external sender, which is why this asks what the
   * Host is first. `docs/03` §5 wants it in *every* group, and the extension is
   * fixed at creation — a group opened without one costs a commit to fix, so
   * the extra round trip here buys back a migration later.
   */
  async create(roomId: string): Promise<string> {
    const externalSender = await this.#externalSender();
    const info = await this.#transport.createGroup(roomId);
    await this.#crypto.createGroup(info.id, externalSender);
    await this.#persist();
    await this.#setCursor(info.id, -1);
    return info.id;
  }

  /** Cached: it is one value per Host and it does not change under us. */
  #hostExternalSender: Uint8Array | undefined | null = null;

  async #externalSender(): Promise<Uint8Array | undefined> {
    if (this.#hostExternalSender !== null) return this.#hostExternalSender;
    // A Host that publishes none is a Host whose groups refuse external
    // proposals. That is a coherent deployment, not an error.
    const info = await this.#transport.hostInfo().catch(() => null);
    this.#hostExternalSender = info?.externalSender ? fromBase64(info.externalSender) : undefined;
    return this.#hostExternalSender;
  }

  /**
   * Take every Welcome waiting for this device. Returns the groups joined.
   *
   * Errors on one Welcome do not stop the others: a group that has already
   * moved past the epoch a Welcome was minted at cannot be joined from it, and
   * that must not block joining a different group entirely.
   */
  async acceptWelcomes(): Promise<string[]> {
    const joined: string[] = [];
    for (const welcome of await this.#transport.welcomes()) {
      try {
        // The tree comes from the server beside the Welcome, never inside it
        // (`docs/03` §5). The inviter published both in one request, so if the
        // Welcome is here the tree is too.
        const tree = await this.#transport.getTree(welcome.group);
        // No tree, no join — and left unacked, so it is offered again. The
        // inviter published both in one request, so this means something is
        // genuinely wrong rather than that we were early; retrying is still the
        // right answer, because the repair is somebody re-publishing the tree.
        if (!tree) continue;
        joined.push(await this.join(fromBase64(welcome.bytes), fromBase64(tree.tree)));
      } catch {
        // Left unacked on purpose. It will be re-offered, and if it is genuinely
        // stale the inviter's next commit replaces it.
      }
    }
    return joined;
  }

  /**
   * Join from a Welcome and its ratchet tree, acknowledging once durable.
   *
   * The order is the whole point: acknowledging first and crashing second would
   * lose the only copy of an invitation, and the device would be a member of a
   * group it cannot open — worse than never having been added.
   */
  async join(welcome: Uint8Array, tree: Uint8Array): Promise<string> {
    const state = await this.#crypto.joinGroup(welcome, tree);
    await this.#persist();

    // Joining consumed a one-time key package. The shelf just got shorter.
    await this.#setCursor(state.groupId, await this.#seqAtEpoch(state.groupId, state.epoch));
    await this.#transport.ackWelcome(state.groupId).catch(() => {});
    this.#onEpoch?.(state.groupId, state.epoch);
    return state.groupId;
  }

  /**
   * Where a joiner should start reading the handshake log.
   *
   * A Welcome drops you in at an epoch, not at a sequence number, and every
   * record before that epoch is one you cannot and should not process — it is
   * addressed to a group you were not in. Finding the first record built at or
   * after the joining epoch is what turns one into the other.
   */
  async #seqAtEpoch(groupId: string, epoch: number): Promise<number> {
    const records = await this.#transport.fetchHandshake(groupId).catch(() => []);
    let cursor = -1;
    for (const record of records) {
      if (record.epoch >= epoch) break;
      cursor = record.seq;
    }
    return cursor;
  }

  // -- membership -----------------------------------------------------------

  /**
   * Add people to a group: claim, stage, commit, send, apply.
   *
   * Batched, because `docs/03` §5 wants one commit for a mass membership change
   * rather than one per person — five hundred role changes should be one epoch,
   * not five hundred.
   */
  async invite(groupId: string, accounts: string[]): Promise<InviteResult> {
    return this.#commitLoop(groupId, async () => {
      const { claims, missing } = await this.#transport.claim(groupId, accounts);
      if (claims.length === 0) {
        return { skip: true as const, result: { added: [], missing, lastResort: [] } };
      }

      await this.#crypto.stageAdd(
        groupId,
        claims.map((c) => fromBase64(c.keyPackage)),
      );
      const devices = claims.map((c) => c.device);
      return {
        skip: false as const,
        devices,
        result: { added: devices, missing, lastResort: claims.filter((c) => c.lastResort) },
      };
    });
  }

  /**
   * Remove leaves — a sign-out, a kick, a ban.
   *
   * Leaves, not accounts: `docs/03` §1 gives every device its own, so removing
   * a person is removing all of theirs and removing one device is removing one.
   * `CryptoEngine.members` is where the mapping lives.
   */
  async remove(groupId: string, leaves: number[]): Promise<InviteResult> {
    return this.#commitLoop(groupId, async () => {
      await this.#crypto.stageRemove(groupId, leaves);
      return { skip: false as const, result: { added: [], missing: [], lastResort: [] } };
    });
  }

  /**
   * Commit whatever is already staged, or nothing at all.
   *
   * An empty commit is legal and useful: it flushes proposals the server
   * appended as an external sender, which is the `COMMIT_REQUESTED` path in
   * `docs/03` §5. It is also what a device does before sending into a group
   * with proposals pending, so a Remove takes effect no later than the next
   * message.
   */
  async flush(groupId: string): Promise<InviteResult> {
    return this.#commitLoop(groupId, async () => ({
      skip: false as const,
      result: { added: [], missing: [], lastResort: [] },
    }));
  }

  /**
   * Build a commit, send it, apply it — and rebuild from scratch if the server
   * says somebody else got there first.
   *
   * The retry is not a nicety. Every membership change in a busy group races
   * every other one, and without this a kick would simply fail whenever two
   * moderators acted at once.
   */
  async #commitLoop(
    groupId: string,
    stage: () => Promise<
      | { skip: true; result: Omit<InviteResult, 'epoch' | 'attempts'> }
      | { skip: false; devices?: string[]; result: Omit<InviteResult, 'epoch' | 'attempts'> }
    >,
  ): Promise<InviteResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= COMMIT_ATTEMPTS; attempt++) {
      const staged = await stage();
      if (staged.skip) {
        const { epoch } = await this.#crypto.state(groupId);
        return { ...staged.result, epoch, attempts: attempt };
      }

      const { epoch } = await this.#crypto.state(groupId);
      const output = await this.#crypto.commit(groupId);
      const devices = staged.devices ?? [];

      try {
        await this.#transport.appendHandshake(groupId, {
          kind: 'commit',
          epoch,
          bytes: toBase64(output.commit),
          // The tree goes up with the commit that produced it, never after.
          // The server publishes the Welcome the instant it accepts this, and a
          // joiner that beat a second request would fetch the previous epoch's
          // tree and fail to join for reasons nobody could reproduce.
          tree: toBase64(output.tree),
          ...(output.welcome && devices.length
            ? { welcome: { bytes: toBase64(output.welcome), devices } }
            : {}),
          ...(devices.length ? { added: devices } : {}),
        });
      } catch (error) {
        await this.#crypto.clearStaged(groupId);
        if (!isEpochConflict(error)) throw error;

        lastError = error;
        // Somebody else's commit landed first. We never applied ours, so there
        // is nothing to undo — catch up to where the group actually is and
        // build a fresh one against that.
        await this.catchUp(groupId);
        continue;
      }

      // Accepted. Now, and only now, is it ours.
      const applied = await this.#crypto.applyPending(groupId);
      await this.#persist();
      await this.#bumpCursor(groupId);
      this.#onEpoch?.(groupId, applied.epoch);

      return { ...staged.result, epoch: applied.epoch, attempts: attempt };
    }

    throw (
      lastError ?? new Error(`could not commit to ${groupId} after ${COMMIT_ATTEMPTS} attempts`)
    );
  }

  /**
   * Our own accepted commit occupies a sequence number we will never process.
   *
   * Advancing past it here keeps the cursor honest, so the next catch-up does
   * not start by fetching a record MLS would refuse.
   */
  async #bumpCursor(groupId: string): Promise<void> {
    const records = await this.#transport
      .fetchHandshake(groupId, { since: await this.#cursor(groupId) })
      .catch(() => []);
    let cursor = await this.#cursor(groupId);
    for (const record of records) if (record.sender === this.#device) cursor = record.seq;
    await this.#setCursor(groupId, cursor);
  }

  // -- receiving ------------------------------------------------------------

  /**
   * Apply one handshake record that arrived live.
   *
   * Records must be applied in order and MLS says so: a commit whose
   * predecessor has not been applied is a commit for an epoch this device is
   * not at, and it is refused. So a record that is ahead of the cursor by more
   * than one triggers a catch-up rather than being processed on its own —
   * which is exactly what the log's own sequence exists for.
   */
  async receiveHandshake(record: HandshakeRecord): Promise<void> {
    if (!(await this.#holds(record.group))) return;
    const cursor = await this.#cursor(record.group);
    if (record.seq <= cursor) return;
    if (record.seq > cursor + 1) return void (await this.catchUp(record.group));
    await this.#apply(record);
  }

  /**
   * Whether this device is actually in a group, as MLS sees it.
   *
   * The commit that adds somebody is fanned out to every member of the group it
   * just created — including the person it added, who has not opened their
   * Welcome yet and cannot process a commit for a group they are not in. Their
   * way in is the Welcome, not this. Ignoring is right; throwing would turn
   * every invitation into a stack trace on the invitee's console.
   *
   * It is also what happens to a device that has been removed and to one whose
   * state has been discarded, both of which keep receiving fan-out until the
   * server's delivery list catches up.
   */
  async #holds(groupId: string): Promise<boolean> {
    return (await this.#crypto.state(groupId).catch(() => null)) !== null;
  }

  /** Fetch and apply everything since the cursor. */
  async catchUp(groupId: string): Promise<number> {
    if (!(await this.#holds(groupId))) return 0;
    let applied = 0;
    for (;;) {
      const since = await this.#cursor(groupId);
      const records = await this.#transport.fetchHandshake(groupId, { since });
      if (records.length === 0) return applied;
      for (const record of records) {
        await this.#apply(record);
        applied += 1;
      }
      // A full page probably means there is more.
      if (records.length < 200) return applied;
    }
  }

  async #apply(record: HandshakeRecord): Promise<void> {
    const groupId = record.group;

    // Already ours. Either this device built it — MLS refuses to process a
    // commit it made, because it applied it the moment the server accepted —
    // or a crash landed between persisting and writing the cursor and this is
    // the second time round. The epoch comparison catches both, and is the
    // load-bearing one: `sender` alone would not survive a reload.
    const current = await this.#crypto.state(groupId).catch(() => null);
    // Gone between the guard and here — a concurrent `leave`, say. Nothing to
    // apply it to, and the cursor is meaningless without state to go with it.
    if (!current) return;

    const stale = record.kind === 'commit' && record.epoch < current.epoch;
    const mine = record.sender === this.#device;

    if (!stale && !mine) {
      await this.#crypto.process(groupId, fromBase64(record.bytes));
      await this.#persist();
      const after = await this.#crypto.state(groupId);

      if (record.kind === 'commit') {
        // **Being removed is silent.** A commit that removes this device
        // processes without error and simply does not advance it — mls-rs
        // cannot apply a commit that takes your own leaf away. So the epoch
        // standing still after a commit is the signal, and without checking for
        // it a removed client shows a room that has mysteriously stopped
        // working rather than a room it has been removed from.
        if (after.epoch === current.epoch) {
          await this.#setCursor(groupId, record.seq);
          return void (await this.leave(groupId));
        }
        this.#onEpoch?.(groupId, after.epoch);
      }
    }

    // Written after the state it describes, never before. The other order can
    // skip a commit permanently, and a group one epoch behind forever is a room
    // that has silently stopped working.
    await this.#setCursor(groupId, record.seq);
  }

  /**
   * Give up on a group: forget it locally and tell the server so.
   *
   * Two situations, one answer. Either a commit removed this device, or its
   * state has diverged past catching up — `docs/03`'s diverged-session reset.
   * Either way the local state is worthless and the server's delivery list is
   * wrong, and until that list is cleared this device cannot be added back:
   * claiming a key package skips devices the server already lists.
   */
  async leave(groupId: string): Promise<void> {
    await this.#crypto.discard(groupId).catch(() => {});
    await this.#store.deleteSealed('group', groupId).catch(() => {});
    await this.#store.delete(cursorKey(groupId)).catch(() => {});
    this.#cursors.delete(groupId);
    await this.#transport.leaveGroup(groupId).catch(() => {});
    this.#onRemoved?.(groupId);
  }

  // -- cursors --------------------------------------------------------------

  async #cursor(groupId: string): Promise<number> {
    const cached = this.#cursors.get(groupId);
    if (cached !== undefined) return cached;
    const stored = await this.#store.get<number>(cursorKey(groupId));
    const cursor = typeof stored === 'number' ? stored : -1;
    this.#cursors.set(groupId, cursor);
    return cursor;
  }

  async #setCursor(groupId: string, seq: number): Promise<void> {
    this.#cursors.set(groupId, seq);
    await this.#store.put(cursorKey(groupId), seq);
  }
}

/** The one refusal that is a retry rather than a failure. */
export function isEpochConflict(error: unknown): boolean {
  return error instanceof TransportError && error.reason === 'epoch_conflict';
}
