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
import { has, parse, Permission } from '@revel/protocol';
import { myFaces } from './faces.svelte.js';
import { session } from './session.svelte.js';
// A cycle on paper and not in practice: `live.svelte.ts` reaches this module
// through a dynamic `import()` inside `start`, so it is always evaluated first
// and its export exists by the time anything here reads it. Worth it — the
// notification rules need to know a space's roles, and the alternative is a
// second copy of the space list that would drift from the one the UI renders.
import { live } from './live.svelte.js';
import { notifications } from './notify.svelte.js';

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
  await session.register();
  const headers = session.headers;
  // Force one now, so the socket has something to connect with. Everything else
  // asks `headers()` per request and never needs to think about expiry.
  await session.ensure();

  const transport = new HttpTransport({ baseUrl: HOST, headers });
  const groupTransport = new HttpGroupTransport({ baseUrl: HOST, headers });
  const store = await IndexedDbStore.open({ name: `revel-${account.slice(0, 12)}` });

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

  const syncGroups = async () => {
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
    onWelcome: () => void syncGroups(),
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
      mayBroadcast: (roomId, sender) => {
        const spaceId = directory?.rooms().find((r) => r.id === roomId)?.space;
        if (!spaceId) return false;
        const space = live.spaces.find((s) => s.info.id === spaceId);
        if (!space) return false;
        const held = new Set(space.members.find((m) => m.account === sender)?.roles ?? []);
        // `@everyone` shares the space's id, and applies whether or not it is
        // listed — leaving it out was the bug that made every member resolve
        // to zero permissions at room level.
        const bits = space.roles
          .filter((r) => r.id === spaceId || held.has(r.id))
          .reduce((acc, r) => acc | parse(r.bits), 0n);
        return has(bits, Permission.MENTION_EVERYONE);
      },
      deliver: (roomId, event, decision) => notifications.deliver(roomId, event, decision),
    },
  });
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
    // Which face speaks in a room. Asked per send rather than captured here,
    // because the answer is per room and changes while the app runs — and
    // because the book belongs to the session, not to the sync engines.
    faceFor: (roomId) => {
      const face = myFaces.speaking(roomId);
      if (!face) return undefined;
      // The address only when this account has asked to be linkable
      // (`docs/11`). Off is the default and off means the field is simply
      // absent — see `FaceCard.address`.
      return cardOf(face, myFaces.linked ? addressOf() : undefined);
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
