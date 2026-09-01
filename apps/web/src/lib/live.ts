/**
 * The real core, assembled for a browser.
 *
 * Everything under `packages/core` has been driven by the multi-client harness
 * and never by a page. This is the wiring that changes that: a signed-in
 * session in, a `LiveCore` out, over real MLS, a real socket and a real Host.
 *
 * ## The pieces, and why each is here
 *
 * - **`LocalCryptoEngine`** holds the device's MLS state. Opened with the
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
  GroupSync,
  HostSession,
  HttpGroupTransport,
  HttpTransport,
  IndexedDbStore,
  LiveCore,
  RoomSync,
  refOf,
  type Session,
  type SocketLike,
  toAccountId,
  WebSocketStream,
} from '@revel/core';
import { LocalCryptoEngine } from '@revel/crypto';
import { myFaces } from './faces.svelte.js';
import { notifications } from './notify.svelte.js';
import { cryptoWasm } from './wasm.js';

/** Where the Host lives. Same origin in dev, behind the vite proxy. */
const HOST = import.meta.env.VITE_HOST_URL ?? '';

export interface LiveStack {
  core: LiveCore;
  crypto: LocalCryptoEngine;
  rooms: RoomSync;
  groups: GroupSync;
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

  // The wasm has to be up before the engine touches it. Shared, because two
  // overlapping initialisations produce two instances and one of them wins.
  await cryptoWasm();

  const crypto = new LocalCryptoEngine();
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
  const syncGroups = async () => {
    await groups.acceptWelcomes();
    for (const groupId of await crypto.groups()) {
      await groups.catchUp(groupId).catch(() => {});
      for (const roomId of await groups.roomsOf(groupId).catch(() => [])) {
        // Bind *and* listen. `open` reads state; binding is what tells the
        // reducer which group's keys open this room, and listening is what
        // makes the socket deliver into it.
        await rooms.bind(roomId, groupId).catch(() => {});
        rooms.listen(roomId);
        await rooms.catchUp(roomId).catch(() => {});
      }
    }
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
      // `roles` and `mayBroadcast` are deliberately absent until spaces exist
      // (`docs/06` phase 3). Absent means "no roles" and "nobody may", which
      // makes `@everyone` inert rather than exploitable — the safe direction,
      // since the failure is a missed ping rather than one nobody was entitled
      // to send.
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
      return face ? refOf(face) : undefined;
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
