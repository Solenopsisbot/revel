/**
 * The real core, assembled for a browser.
 *
 * Everything under `packages/core` has been driven by the multi-client harness
 * and never by a page. This is the wiring that changes that: a signed-in
 * session in, a `LiveCore` out, over real MLS, a real socket and a real Host.
 *
 * ## The pieces, and why each is here
 *
 * - **`WorkerCryptoEngine`** holds the device's MLS state, in a Worker so a
 *   commit cannot stop the thread that paints. Opened with the
 *   account seed *and* the stored device secret — without the second, coming
 *   back is not a reload but a new device, with a fresh leaf in every group and
 *   the old one still sitting there (`docs/03` §1).
 * - **`IndexedDbStore`** is the local log, so a cold open reads from disk
 *   rather than the network. `docs/29` §5's headline budget is exactly this.
 * - **`HostSession`** does the device-key challenge-response and keeps a token
 *   fresh. Everything else takes `headers()` and asks on every request, so a
 *   token with a lifetime never has to be captured at construction.
 * - **`WebSocketStream`** is delivery, never truth. Anything it misses is
 *   fetchable, which is why `onReconnect` catches up rather than replaying.
 *
 * ## Why this is not `core.svelte.ts`
 *
 * The fake core is fixtures and stays: every screen in this app is reachable
 * without an account, and losing that would make the reference page useless.
 * This is the other one, chosen at runtime — see `session.svelte.ts`.
 */

import {
  Attachments,
  cardOf,
  GroupSync,
  HostSession,
  HttpGroupTransport,
  HttpTransport,
  IndexedDbStore,
  LiveCore,
  RoomSync,
  type Session,
  type SocketLike,
  toAccountId,
  WebSocketStream,
} from '@revel/core';
import { type CryptoEngine, spawnCryptoEngine } from '@revel/crypto';
import cryptoWasmUrl from '@revel/crypto-wasm/revel_crypto_bg.wasm?url';
import { has, Permission, type PermissionName, parse } from '@revel/protocol';
import { myFaces } from './faces.svelte.js';
// A cycle on paper and not in practice: `live.svelte.ts` reaches this module
// through a dynamic `import()` inside `start`, so it is always evaluated first
// and its export exists by the time anything here reads it. Worth it — the
// notification rules need to know a space's roles, and the alternative is a
// second copy of the space list that would drift from the one the UI renders.
import { live } from './live.svelte.js';
import { notifications } from './notify.svelte.js';
import { session } from './session.svelte.js';

/** Where the Host lives. Same origin in dev, behind the vite proxy. */
const HOST = import.meta.env.VITE_HOST_URL ?? '';

/**
 * This account's address, as a person reads it.
 *
 * Read at announce time rather than captured at start-up: a handle can be
 * claimed after the stack is running, and a face card that carried an empty
 * address forever would be the linking toggle silently doing nothing.
 */
function addressOf(): string | undefined {
  const handle = session.current?.handle;
  if (!handle) return undefined;
  return typeof location === 'undefined' ? handle : `${handle}@${location.host}`;
}

export interface LiveStack {
  core: LiveCore;
  crypto: CryptoEngine;
  rooms: RoomSync;
  groups: GroupSync;
  /** The local database. Exposed so Storage can count what is on this device. */
  store: IndexedDbStore;
  stream: WebSocketStream;
  session: HostSession;
  /**
   * Why the Host would not authenticate this device at startup, if it would
   * not. Null is the normal case.
   *
   * The stack exists either way — this is the difference between "you can read
   * what is on this device" and "you can also send". A caller that needs to
   * know which shows the banner; nothing else has to care.
   */
  hostError: unknown;
  /**
   * Take anything waiting and bind what it opens.
   *
   * Exposed because it is not only an internal reaction to a socket frame: a
   * tab that has been asleep, or one whose socket never connected, has to be
   * able to ask. `docs/04` §5's reconcile-on-open, as a method.
   */
  sync(): Promise<void>;
  /**
   * What the socket is doing. `connecting` | `open` | `closed`.
   *
   * `WebSocketStream` reports it by callback rather than exposing a field, so
   * this is the latest value it pushed. The connection screen reads it, and so
   * does anything trying to work out whether "nothing arrived" means the room
   * is quiet or the wire is down.
   */
  socketStatus(): 'connecting' | 'open' | 'closed';
  /** This device's account id, as the reducer spells accounts. */
  account: string;
  device: string;
  close(): Promise<void>;
}

/**
 * Build the stack for a signed-in device.
 *
 * Throws if the session has no device material: an account key alone cannot
 * hold an MLS leaf, and pretending otherwise would produce a client that looks
 * connected and cannot send.
 */
export async function startLive(signedIn: Session): Promise<LiveStack> {
  if (!signedIn.device) throw new Error('this device has no certificate yet');

  /**
   * MLS runs in a Worker, not on the thread that paints.
   *
   * `docs/31` §6 measured it: a 500-leaf removal is 212 ms and a 2,000-leaf one
   * is 804 ms. On the main thread that is 13 and 48 dropped frames — a commit
   * that visibly stops the app. `LocalCryptoEngine` says "do not use it in a
   * browser" in its own docstring, and the browser was using it.
   *
   * The Worker gets its own wasm instance, which is fine and in fact the point:
   * nothing shares an object across the boundary, only bytes. The main thread
   * still loads the wasm for the envelope and transfer keys (`identity.ts`),
   * and those touch nothing this engine owns.
   */
  const crypto = spawnCryptoEngine({ wasm: cryptoWasmUrl });
  const identity = await crypto.open({
    deviceLabel: 'this browser',
    accountSecret: signedIn.accountKey,
    // The stored one. See the note above about what happens without it.
    deviceSecret: signedIn.device.deviceSecret,
  });

  const account = toAccountId(identity.accountPublicKey);
  const device = toAccountId(identity.devicePublicKey);

  // The token is kept here as well as inside the session, because a WebSocket
  // handshake cannot carry a header and needs it in the query string — see the
  // note in `connect` below.
  let token = '';
  const session = new HostSession({
    crypto,
    baseUrl: HOST,
    onSession: (granted) => {
      token = granted.token;
    },
  });
  const headers = session.headers;

  const transport = new HttpTransport({ baseUrl: HOST, headers });
  const groupTransport = new HttpGroupTransport({ baseUrl: HOST, headers });
  // **Before the Host is asked anything.** This is the device's own database —
  // sealed group state, materialised rooms, every message already decrypted —
  // and it used to be opened *after* two network calls that can throw. So a
  // rate limit or an unreachable Host meant `startLive` threw before the local
  // store existed, `live.stack` stayed null, and the app rendered as though
  // this device had never been used, with all of it sitting on disk.
  //
  // Nothing below this line needs the network to exist, only to be useful.
  const store = await IndexedDbStore.open({ name: `revel-${account.slice(0, 12)}` });

  /**
   * Say hello to the Host, and carry on if it will not answer.
   *
   * Registering the certificate and taking a token are how this device becomes
   * able to *send*; they are not how it becomes able to *read*. Treating them
   * as fatal conflated the two and cost the whole app for a failure that only
   * affects half of it.
   *
   * `HostSession` retries a transient refusal on its own before this sees it,
   * so arriving here means it is properly not working rather than briefly
   * busy. `live.retry()` is what tries again, and the banner is what offers it.
   */
  let hostError: unknown = null;
  try {
    await session.register();
    // Force one now, so the socket has something to connect with. Everything
    // else asks `headers()` per request and never needs to think about expiry.
    await session.ensure();
  } catch (err) {
    hostError = err;
    console.error('revel: not authenticated to the Host — running on local data', err);
  }

  /**
   * Declared before the stream and assigned after, because the wiring is
   * genuinely circular: the socket's callbacks drive these two, and `RoomSync`
   * needs the socket to receive anything live. The callbacks only ever run
   * after `start()`, so by then both are assigned.
   */
  let rooms!: RoomSync;
  let groups!: GroupSync;

  /**
   * Accept anything waiting, and bind every room the groups cover.
   *
   * Runs on connect, on reconnect and on a Welcome, because all three mean the
   * same thing: there may be groups this device is in that it has not caught up
   * on. Idempotent by construction — `acceptWelcomes` acks what it takes and
   * `catchUp` is a cursor.
   */
  /**
   * Groups whose sealed state was read back off disk at startup.
   *
   * `restoreCrypto` imports them into the device without *opening* them, so
   * they do not appear in `crypto.groups()` — that lists what the session is
   * holding in memory, which on a fresh page is nothing. Without this set a
   * reload binds no rooms at all.
   */
  let restoredGroups = new Set<string>();

  /**
   * `syncGroups` is expensive, and three separate things ask for it.
   *
   * One pass is a handshake catch-up per group, a key-package claim per group,
   * an events fetch per room, a `/welcomes`, a `/rooms`, and a claim per group
   * again inside `reconcileGroups` — about 25 requests for a small account. It
   * is triggered on connect, on every reconnect, and on **every WELCOME frame**,
   * none of which were coordinated.
   *
   * So a socket that opened and died once a second ran the whole pass once a
   * second, and any Welcome that kept being redelivered did the same. Measured
   * on a real account: 25 requests per second, indefinitely, which is both a
   * self-inflicted denial of service and the reason the rate limiter kept
   * refusing perfectly ordinary work.
   *
   * Two guards, and they are different:
   *
   * - **Coalesce.** Callers that arrive while a pass is running get that pass,
   *   not another one. Three triggers firing together is the normal case, not
   *   the edge case.
   * - **Throttle with a trailing run.** At most one pass per `SYNC_MIN_MS`, and
   *   a request that arrives inside that window is *deferred*, never dropped —
   *   dropping one would mean a Welcome that arrived at the wrong moment is
   *   never taken, which is exactly the bug this whole function exists to avoid.
   */
  let syncing: Promise<void> | null = null;
  let pending: Promise<void> | null = null;
  let lastSyncAt = 0;
  const SYNC_MIN_MS = 4000;

  const syncGroups = async (): Promise<void> => {
    if (syncing) return syncing;
    if (pending) return pending;
    const waitFor = Math.max(0, SYNC_MIN_MS - (Date.now() - lastSyncAt));
    if (waitFor > 0) {
      pending = new Promise<void>((resolve) => setTimeout(resolve, waitFor)).then(() => {
        pending = null;
        return syncGroups();
      });
      return pending;
    }
    lastSyncAt = Date.now();
    syncing = syncGroupsNow().finally(() => {
      syncing = null;
      lastSyncAt = Date.now();
    });
    return syncing;
  };

  const syncGroupsNow = async () => {
    await groups.acceptWelcomes();
    for (const groupId of new Set([...restoredGroups, ...(await crypto.groups())])) {
      await groups.catchUp(groupId).catch(() => {});

      // Bring this account's *other* devices into the group.
      //
      // `docs/03` §1 gives every device its own leaf, and a leaf can only be
      // added by somebody already inside — so a device that pairs later is in
      // the account, sees the room list, and cannot read a word of it. Nothing
      // did this, which made "two devices each" (`docs/06` phase 2's exit
      // condition) quietly impossible: the second device signed in fine and
      // then failed every send with "no group in this session".
      //
      // Cheap when there is nothing to do. The claim endpoint already skips
      // devices that are in the group, so this is one request that comes back
      // empty and commits nothing — and when it does find one, the commit
      // carries the Welcome that device is waiting for.
      await groups.invite(groupId, [account]).catch(() => {});
      for (const roomId of await groups.roomsOf(groupId).catch(() => [])) {
        // Bind *and* listen. `open` reads state; binding is what tells the
        // reducer which group's keys open this room, and listening is what
        // makes the socket deliver into it.
        await rooms.bind(roomId, groupId).catch(() => {});
        rooms.listen(roomId);
        await rooms.catchUp(roomId).catch(() => {});
      }
    }

    // And bring in anybody the Host says is a member that the group has never
    // heard of. Somebody who followed an invite link has no inviter present to
    // commit them, so every member checks and the first one there wins.
    await directory?.reconcileGroups().catch(() => {});
  };

  let socketStatus: 'connecting' | 'open' | 'closed' = 'closed';
  const stream = new WebSocketStream({
    onStatus: (next) => {
      socketStatus = next;
    },
    connect: () => {
      const url = new URL(HOST || location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.pathname = '/socket';
      // The token goes in the query because a browser cannot set headers on a
      // WebSocket handshake — the same reasoning `apps/server/src/index.ts`
      // gives, from the other end.
      url.searchParams.set('token', token);
      return new WebSocket(url) as unknown as SocketLike;
    },
    // Reconnecting closes a gap the socket cannot replay, so catching up is
    // wired here rather than left to each caller to remember.
    onReconnect: (open) => {
      void rooms.catchUpAll(open);
      void syncGroups();
    },
    onHandshake: (record) => void groups.receiveHandshake(record),
    /**
     * A Welcome for a group this device already holds is nothing to do.
     *
     * The frame names the group, so this is answerable without a round trip —
     * and without it a Welcome that keeps being redelivered drives a full sync
     * pass every time it arrives, which is one of the two ways the request
     * storm sustained itself.
     */
    onWelcome: (group) => {
      void crypto
        .groups()
        .then((held) => {
          if (!held.includes(group)) return syncGroups();
        })
        .catch(() => syncGroups());
    },
    /**
     * Somebody joined a space this device is in — commit their leaf.
     *
     * Nothing else was doing this. `COMMIT_REQUESTED` fires on pending MLS
     * proposals and a join by invite link makes none, so an existing member's
     * client never found out until it happened to sync for some other reason.
     * The newcomer meanwhile sat in a space whose name they could not decrypt.
     *
     * `reconcileGroups` re-reads the membership from the Host and commits the
     * difference, then says the space's name, its roles and its room names
     * again — all of which were encrypted to epochs the newcomer's leaf did
     * not exist in.
     */
    onMembersChanged: () => {
      void directory
        ?.reconcileGroups()
        .then(() => live.refreshSpaces())
        .catch((err) => console.error('revel: could not reconcile after a join', err));
    },
    onCommitRequested: (groupId) => void groups.flush(groupId),
  });

  // **With the stream.** Without it `RoomSync` is a store and a reducer and
  // nothing arrives live — messages would only appear on a manual fetch, which
  // is the sort of thing that looks like "the app is slow" rather than like a
  // wiring mistake.
  /**
   * Assigned once the core below is built, and read only from inside `place`.
   *
   * `RoomSync` has to exist before the directory that describes its rooms, so
   * the notification rules cannot be handed a directory at construction. A
   * room the directory has not loaded yet returns `null`, which suppresses the
   * decision rather than guessing — a wrong `kind` here would turn a DM into a
   * space room and silently downgrade it to the global default.
   */
  let directory: LiveStack['core']['directory'] | null = null;

  rooms = new RoomSync({
    crypto,
    store,
    transport,
    account,
    stream,
    notify: {
      settings: () => notifications.settings(),
      place: (roomId) => {
        const room = directory?.rooms().find((r) => r.id === roomId);
        if (!room) return null;
        return {
          spaceId: room.space ?? null,
          kind: room.kind === 'space' ? 'space' : room.kind === 'group' ? 'group' : 'dm',
        };
      },
      minuteOfDay: () => {
        const now = new Date();
        return now.getHours() * 60 + now.getMinutes();
      },
      /**
       * Role ids I hold in this room's space, for `@role` pings.
       *
       * Read from the space list rather than fetched: this runs inside the
       * decrypt path for every arriving event, and a request per message would
       * be a request per message. Absent means "no roles", which suppresses the
       * ping — the safe direction, since the failure is a missed ping.
       */
      roles: (roomId) => {
        const spaceId = directory?.rooms().find((r) => r.id === roomId)?.space;
        if (!spaceId) return [];
        const space = live.spaces.find((s) => s.info.id === spaceId);
        return space?.members.find((m) => m.account === account)?.roles ?? [];
      },
      /**
       * Whether the sender may address the whole room.
       *
       * **A check only the reader can do.** `mentionsEveryone` is inside the
       * ciphertext, so a member without `MENTION_EVERYONE` can set it and the
       * Host will never know — `docs/04` §4 puts enforcement here, "on
       * rendering the ping", and `docs/35` rule 8 is the rule.
       *
       * Resolved from the same numbers the server would use: `@everyone` plus
       * their roles, which is `permissions.ts`'s `resolve` and not a second
       * implementation of it. A room whose space we have not loaded resolves to
       * nobody, which is quiet rather than exploitable.
       */
      mayBroadcast: (roomId, sender) => has(bitsFor(roomId, sender), Permission.MENTION_EVERYONE),
      deliver: (roomId, event, decision) => notifications.deliver(roomId, event, decision),
    },
    /**
     * The client half of `docs/04` §4.
     *
     * Redactions from non-authors, pins, room and space renames, role names:
     * all of them live inside the ciphertext, so the server cannot enforce any
     * of them and every reader has to. This was never wired at all —
     * `mayModerate` existed, was threaded through the engine, and no caller
     * ever supplied it — which meant moderator redactions were silently dropped
     * on every client while the other four acts were honoured from anybody who
     * sent them.
     */
    may: (roomId: string, account: string, permission: PermissionName) =>
      has(bitsFor(roomId, account), Permission[permission]),
    /**
     * A room's group is bound once, and the Host does not get to change it.
     *
     * Refused in `RoomSync.bind`; this is so it is visible rather than a
     * swallowed rejection on the next refresh.
     */
    onRebind: (roomId, held, offered) =>
      console.error(`refused to rebind room ${roomId} from group ${held} to ${offered}`),
  });
  /**
   * What an account may do in a room, from the same numbers the server used.
   *
   * `permissions.ts`'s `resolve` shape rather than a second implementation of
   * it: `@everyone` shares the space's id and applies whether or not it is
   * listed, which is the detail that once made every member resolve to zero.
   *
   * A room whose space has not been loaded resolves to nobody — quiet rather
   * than exploitable. Room-level overrides are not applied here because the
   * client is not sent them; the effect is that a client can be *stricter*
   * than the Host, never looser.
   */
  function bitsFor(roomId: string, account: string): bigint {
    const spaceId = directory?.rooms().find((r) => r.id === roomId)?.space;
    // **A room with no space has no roles, and its members are peers.**
    //
    // `policy.ts` says the same thing server-side: a DM has no space, so
    // membership *is* the permission. `MANAGE_EVENTS` is included because the
    // acts it gates here — pinning, and redacting — have no other answer in a
    // room with nobody in charge, and a redaction leaves a visible tombstone
    // rather than a silent hole.
    if (!spaceId) {
      return Permission.VIEW | Permission.SEND | Permission.SEND_MEDIA | Permission.MANAGE_EVENTS;
    }
    const space = live.spaces.find((s) => s.info.id === spaceId);
    if (!space) return 0n;
    const held = new Set(space.members.find((m) => m.account === account)?.roles ?? []);
    return space.roles
      .filter((r) => r.id === spaceId || held.has(r.id))
      .reduce((acc, r) => acc | parse(r.bits), 0n);
  }

  groups = new GroupSync({
    crypto,
    store,
    transport: groupTransport,
    device,
    // The crypto core's state moves whenever a handshake is processed, and
    // somebody has to write it down. `RoomSync` owns that, so this hands it
    // back rather than keeping a second copy that could disagree.
    persist: () => rooms.persistCrypto(),
  });

  /**
   * Read this device's sealed MLS state back before anything asks for it.
   *
   * The other half of every `persistCrypto` this device has ever done, and it
   * had no caller at all — so a reload left the crypto session empty while the
   * sealed blobs sat on disk. History still rendered (that is plaintext in the
   * local store) and everything else failed: sends threw "no group in this
   * session", and incoming messages failed to decrypt into a `.catch` that
   * drops them. A refresh quietly ended the conversation.
   *
   * Awaited rather than floated, because `stream.start()` below can deliver an
   * event immediately and the reducer needs the keys to be there when it does.
   * Failure is not fatal: without it this device catches up the slow way,
   * which is a bad start rather than a broken one.
   */
  restoredGroups = new Set(
    await rooms.restoreCrypto().catch((err) => {
      console.error('revel: could not restore sealed crypto state', err);
      return [];
    }),
  );

  stream.start();

  /**
   * Publish key packages for this device.
   *
   * **Nobody can add a device that has no key packages on the shelf**, and the
   * failure is silent from both ends: the inviter finds nothing to claim and
   * the invitee simply never gets a Welcome. The harness does this explicitly
   * in every test, which is exactly why it was missing here — a real client has
   * to do it for itself, on every start, because a shelf empties as people are
   * added and the device is the only thing that can refill it (`docs/03` §5).
   */
  await groups.replenish().catch((err) => console.error('could not publish key packages', err));

  // Whatever was waiting while this device was away.
  await syncGroups().catch(() => {});

  const core = new LiveCore({
    account,
    rooms,
    groups,
    crypto,
    transport,
    stream,
    attachments: new Attachments({ transport }),
    // So the room list survives a Host that will not answer — see
    // `Directory.refresh`. Without it an offline start has every message on
    // disk and no way to reach any of them.
    store,
    // Which face speaks in a room. Asked per send rather than captured here,
    // because the answer is per room and changes while the app runs — and
    // because the book belongs to the session, not to the sync engines.
    faceFor: (roomId) => {
      const face = myFaces.speaking(roomId);
      if (!face) return undefined;
      // No address on the card. Not because it is withheld — anyone in the room
      // can resolve it from the account the roster already records against this
      // face — but because carrying it is redundant, and a field that looks
      // like a disclosure decision when it is not is how the old control came
      // to imply something it could not do. `FaceCard.address` stays in the
      // schema and is still read: encrypted history cannot be rewritten
      // (`docs/29` §1) and older clients put it there.
      return cardOf(face);
    },
  });

  // Now the notification rules can tell a DM from a space room. Until this
  // line every decision was suppressed, which is the correct thing for the few
  // milliseconds it takes to get here and the wrong thing forever.
  directory = core.directory;

  return {
    core,
    crypto,
    rooms,
    groups,
    store,
    stream,
    session,
    hostError,
    sync: syncGroups,
    socketStatus: () => socketStatus,
    account,
    device,
    async close() {
      stream.stop();
      await crypto.close();
      await store.close();
    },
  };
}
