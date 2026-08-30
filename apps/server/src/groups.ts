/**
 * The handshake routes — `docs/04` §5's `/groups/:id/{handshake,welcome,tree,
 * key-packages/claim}`, plus the IdP's key package shelf.
 *
 * Everything else the server does is about events. This is the part that gets
 * two people into the same MLS group in the first place, and until it existed
 * the client's `bind(roomId, groupId)` was called by nothing and
 * `joinGroup(welcome)` took a Welcome from nowhere.
 *
 * Three things here are load-bearing and each has a comment where it happens:
 *
 * 1. **Claiming a one-time key package is a race**, and the store resolves it
 *    in one call because two round trips is how the same package gets handed
 *    out twice.
 * 2. **The handshake log has its own sequence**, separate from the event log.
 *    Commits order by epoch and events order by snowflake; conflating them is
 *    how a client applies a commit whose predecessor it never saw.
 * 3. **Two devices can commit at the same epoch.** One wins, and the other has
 *    to be told something it can act on — which is why `CryptoEngine.commit`
 *    does not apply what it builds.
 */
import {
  type Claim,
  ClaimRequest,
  type GroupInfo,
  HandshakeInput,
  KeyPackageUpload,
  RatchetTree,
} from '@revel/protocol';
import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Hub } from './hub.js';
import { type Actor, canHandshake, canRead, entitledToGroup } from './policy.js';
import type { GroupMemberInput, Store } from './store/types.js';

export interface GroupDeps {
  store: Store;
  hub: Hub;
  /** Group ids come from the same factory as event ids (`docs/04` §6). */
  newId(): string;
  authenticate(req: Request): Promise<Actor | null>;
}

const groupDenialStatus: Record<string, ContentfulStatusCode> = {
  no_such_group: 404,
  not_in_group: 403,
  not_entitled: 403,
};

/**
 * How long the designated committer has before the nudge moves on.
 *
 * `docs/03` §5. Advisory: nothing enforces it server-side, because the
 * guarantee that actually matters is the client-side one — a device that wants
 * to send while proposals are pending commits them first, so a Remove takes
 * effect no later than the next message whether or not anyone answered a nudge.
 */
const COMMIT_DEADLINE_MS = 10_000;

export function mountGroups(app: Hono, deps: GroupDeps): void {
  const auth = async (req: Request) => deps.authenticate(req);

  // -------------------------------------------------------------------------
  // Key package supply (IdP role)
  // -------------------------------------------------------------------------

  /**
   * Publish this device's shelf. Self only — always.
   *
   * A key package is a public commitment to a private half only this device
   * holds. Letting anyone else publish for it would let them fill the shelf
   * with packages whose Welcomes the real device can never open, which is a
   * denial of service against being invited to anything.
   */
  app.put('/idp/devices/:pub/key-packages', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);
    if (c.req.param('pub') !== actor.devicePub) return c.json({ error: 'not_your_device' }, 403);

    const parsed = KeyPackageUpload.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_key_packages' }, 400);

    return c.json(await deps.store.publishKeyPackages(actor.devicePub, parsed.data));
  });

  /** How many are left, so a device knows when to top up (`docs/03` §5: ≥ 20). */
  app.get('/idp/devices/:pub/key-packages', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);
    if (c.req.param('pub') !== actor.devicePub) return c.json({ error: 'not_your_device' }, 403);
    return c.json(await deps.store.keyPackageSupply(actor.devicePub));
  });

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------

  /**
   * Create a group for a room that has none, with the caller as its only leaf.
   *
   * The room must exist and the caller must be able to read it. There is no
   * room-creation endpoint yet — that belongs with membership and invites —
   * so for now a group is opened against a room somebody already put you in.
   */
  app.post('/groups', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const body = (await c.req.json().catch(() => null)) as { roomId?: unknown } | null;
    const roomId = typeof body?.roomId === 'string' ? body.roomId : null;
    if (!roomId) return c.json({ error: 'invalid_request' }, 400);

    const denial = await canRead(deps.store, roomId, actor);
    if (denial) return c.json({ error: denial }, denial === 'no_such_room' ? 404 : 403);

    const room = await deps.store.getRoom(roomId);
    // One group per room, and it never changes: `docs/29` §1 notes that
    // changing ciphersuite means a *new* group, not an upgraded one, and the
    // same is true of rebinding a room. History sealed under the old group
    // stays sealed under it.
    if (room?.groupId) return c.json({ error: 'already_bound', group: room.groupId }, 409);

    const group = await deps.store.createGroup(deps.newId(), roomId, {
      devicePub: actor.devicePub,
      accountId: actor.accountId,
    });
    return c.json(await describe(deps, group.id), 201);
  });

  app.get('/groups/:id', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const groupId = c.req.param('id');
    const denial = await canHandshake(deps.store, groupId, actor);
    if (denial) return c.json({ error: denial }, groupDenialStatus[denial] ?? 403);

    return c.json(await describe(deps, groupId));
  });

  // -------------------------------------------------------------------------
  // The ratchet tree, out of band
  // -------------------------------------------------------------------------

  /**
   * `docs/03` §5 rejects the inlined `ratchet_tree` extension and `docs/31` §2
   * has the numbers: inlining it makes one join at 2,000 members cost 627 KiB
   * instead of 0.4 KiB. Out of band it is one cacheable fetch per epoch that
   * every joiner shares.
   */
  app.get('/groups/:id/tree', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const groupId = c.req.param('id');
    const denial = await canHandshake(deps.store, groupId, actor);
    if (denial) return c.json({ error: denial }, groupDenialStatus[denial] ?? 403);

    const tree = await deps.store.getTree(groupId);
    return tree ? c.json(tree) : c.json({ error: 'no_tree' }, 404);
  });

  app.put('/groups/:id/tree', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const groupId = c.req.param('id');
    const denial = await canHandshake(deps.store, groupId, actor);
    if (denial) return c.json({ error: denial }, groupDenialStatus[denial] ?? 403);

    const parsed = RatchetTree.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_tree' }, 400);

    // The tree is public and every member can verify it against their own
    // copy, so accepting it from any member is safe in a way that accepting a
    // roster would not be. A wrong one makes joins fail, not succeed quietly.
    await deps.store.putTree(groupId, parsed.data.epoch, parsed.data.tree);
    return c.body(null, 204);
  });

  // -------------------------------------------------------------------------
  // Claiming key packages
  // -------------------------------------------------------------------------

  /**
   * Claim one key package per device of each named account.
   *
   * By account, because you add a person and `docs/03` §1's per-device leaves
   * mean every device of theirs needs its own package. An account with no
   * devices, or no packages left and no last-resort, lands in `missing` rather
   * than failing the whole call — adding four of five people is better than
   * adding none, and the fifth is retried when they next replenish.
   */
  app.post('/groups/:id/key-packages/claim', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const groupId = c.req.param('id');
    const denial = await canHandshake(deps.store, groupId, actor);
    if (denial) return c.json({ error: denial }, groupDenialStatus[denial] ?? 403);

    const parsed = ClaimRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const claims: Claim[] = [];
    const missing: string[] = [];

    for (const account of parsed.data.accounts) {
      // The authorised-claim check (`docs/03` §5, from Kith's audit). Without
      // it, anyone in any group could spend anyone else's one-time packages
      // and drain the shelf of a person they have never met.
      if (!(await entitledToGroup(deps.store, groupId, account))) {
        missing.push(account);
        continue;
      }

      const devices = await deps.store.listAccountDevices(account);
      let got = 0;
      for (const device of devices) {
        // Already in the group — a second leaf for the same device would be a
        // duplicate nobody removes.
        if (await deps.store.getGroupMember(groupId, device.pub)) continue;
        const claimed = await deps.store.claimKeyPackage(device.pub, groupId);
        if (!claimed) continue;
        claims.push({ account, device: device.pub, ...claimed });
        got += 1;
      }
      if (got === 0) missing.push(account);
    }

    return c.json({ claims, missing });
  });

  // -------------------------------------------------------------------------
  // The handshake log
  // -------------------------------------------------------------------------

  app.post('/groups/:id/handshake', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const groupId = c.req.param('id');
    const denial = await canHandshake(deps.store, groupId, actor);
    if (denial) return c.json({ error: denial }, groupDenialStatus[denial] ?? 403);

    const parsed = HandshakeInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_handshake' }, 400);
    const input = parsed.data;

    // Resolve the added devices to accounts before the transaction: the store
    // records who a leaf speaks for so a later claim can skip devices that are
    // already in, and it must not have to look accounts up mid-transaction.
    const added: GroupMemberInput[] = [];
    for (const devicePub of input.added ?? []) {
      const device = await deps.store.getDevice(devicePub);
      if (!device || device.revokedAt) return c.json({ error: 'unknown_device' }, 400);
      added.push({ devicePub, accountId: device.accountId });
    }

    const result = await deps.store.appendHandshake({
      groupId,
      sender: actor.devicePub,
      kind: input.kind,
      epoch: input.epoch,
      bytes: input.bytes,
      welcome: input.welcome,
      added,
      removed: input.removed,
      at: Date.now(),
    });

    if (!result.accepted) {
      // 409 with the epoch the group actually reached, which is everything the
      // loser of a commit race needs: clear what it staged, catch up on the
      // handshake log, rebuild. It never applied its own commit, so it has
      // lost nothing but a round trip — that is exactly why
      // `CryptoEngine.commit` does not apply.
      if (result.reason === 'epoch_conflict') {
        return c.json({ error: 'epoch_conflict', epoch: result.epoch }, 409);
      }
      return c.json({ error: 'unclaimed_welcome', devices: result.devices }, 403);
    }

    await deps.store.touchGroupMember(groupId, actor.devicePub, Date.now());

    // Fan out to every other member's device. Not to the sender's own: it
    // already has these bytes, and MLS refuses to process a commit it built.
    // A second tab on the same device therefore misses this one and picks it
    // up from `?since=` on its next catch-up — the log is sequenced precisely
    // so a missed frame costs a fetch rather than a resync.
    for (const member of await deps.store.listGroupMembers(groupId)) {
      if (member.devicePub === actor.devicePub) continue;
      deps.hub.toDevice(member.devicePub, { op: 'HANDSHAKE', d: result.record });
    }

    if (input.welcome) await deliverWelcomes(deps, groupId, input.welcome.devices);
    if (input.kind === 'proposal') await nudgeCommitter(deps, groupId);

    return c.json({ seq: result.record.seq, epoch: result.epoch }, 201);
  });

  /** Catch up. `since` is the last seq already applied, exclusive. */
  app.get('/groups/:id/handshake', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const groupId = c.req.param('id');
    const denial = await canHandshake(deps.store, groupId, actor);
    if (denial) return c.json({ error: denial }, groupDenialStatus[denial] ?? 403);

    const sinceRaw = c.req.query('since');
    const since = sinceRaw === undefined ? undefined : Number(sinceRaw);
    if (since !== undefined && !Number.isInteger(since)) {
      return c.json({ error: 'invalid_since' }, 400);
    }
    const limit = Math.min(Number(c.req.query('limit') ?? 200) || 200, 500);

    return c.json({ records: await deps.store.listHandshake(groupId, { since, limit }) });
  });

  // -------------------------------------------------------------------------
  // Welcomes
  // -------------------------------------------------------------------------

  /**
   * Whatever is waiting for this device, as an HTTP fallback for the socket's
   * `WELCOME` frame. A client that opened cold and has no socket yet still has
   * to be able to find out it was invited.
   */
  app.get('/welcomes', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);
    return c.json({ welcomes: await deps.store.listWelcomes(actor.devicePub) });
  });

  /**
   * "I have joined; stop sending me this."
   *
   * Delivery is at-least-once and acknowledged rather than take-and-clear —
   * see the note on `Store.listWelcomes`. Acking one that was never used is
   * fine; the cost is an invite you have to be re-sent. Not acking one that
   * was used costs a duplicate frame the client ignores.
   */
  app.delete('/groups/:id/welcome', async (c) => {
    const actor = await auth(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);
    await deps.store.ackWelcome(actor.devicePub, c.req.param('id'));
    return c.body(null, 204);
  });
}

// ---------------------------------------------------------------------------
// Shared with the socket and the event path
// ---------------------------------------------------------------------------

/**
 * `docs/03` §5's designated committer: the online device of the group that
 * most recently did something, then the next most recent, and so on.
 *
 * Derived here rather than stored. A `designated_committer_device` column
 * (which `docs/04` §1 sketches) goes stale the moment that device closes its
 * laptop, and a nudge sent into the void is a group that quietly stops
 * committing — proposals pile up and nobody is ever added or removed again.
 */
export async function designatedCommitter(
  deps: Pick<GroupDeps, 'store' | 'hub'>,
  groupId: string,
): Promise<string | null> {
  const members = await deps.store.listGroupMembers(groupId);
  const online = members
    .filter((m) => deps.hub.isOnline(m.devicePub))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return online[0]?.devicePub ?? null;
}

/** Nudge whoever should commit, if there is anything to commit and anyone to ask. */
export async function nudgeCommitter(
  deps: Pick<GroupDeps, 'store' | 'hub'>,
  groupId: string,
): Promise<string | null> {
  const group = await deps.store.getGroup(groupId);
  if (!group || group.pendingProposals === 0) return null;

  const committer = await designatedCommitter(deps, groupId);
  if (!committer) return null;

  deps.hub.toDevice(committer, {
    op: 'COMMIT_REQUESTED',
    d: { group: groupId, deadline: Date.now() + COMMIT_DEADLINE_MS },
  });
  return committer;
}

/**
 * Push queued Welcomes to whichever of these devices is online.
 *
 * The rows stay until acked, so this is a latency optimisation and not the
 * delivery mechanism: a device that is offline, or whose socket dies between
 * here and the next line, gets it on its next connect instead.
 */
export async function deliverWelcomes(
  deps: Pick<GroupDeps, 'store' | 'hub'>,
  groupId: string,
  devices: string[],
): Promise<number> {
  let sent = 0;
  for (const devicePub of devices) {
    if (!deps.hub.isOnline(devicePub)) continue;
    const [welcome] = await deps.store.listWelcomes(devicePub, groupId);
    if (!welcome) continue;
    sent += deps.hub.toDevice(devicePub, {
      op: 'WELCOME',
      d: { group: groupId, bytes: welcome.bytes },
    })
      ? 1
      : 0;
  }
  return sent;
}

async function describe(
  deps: Pick<GroupDeps, 'store' | 'hub'>,
  groupId: string,
): Promise<GroupInfo> {
  const group = await deps.store.getGroup(groupId);
  const members = await deps.store.listGroupMembers(groupId);
  return {
    id: groupId,
    epoch: group?.epoch ?? 0,
    committer: await designatedCommitter(deps, groupId),
    pendingProposals: group?.pendingProposals ?? 0,
    size: members.length,
  };
}
