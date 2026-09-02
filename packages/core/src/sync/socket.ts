/**
 * The live socket, from the client's side.
 *
 * ## A socket is delivery, not truth
 *
 * Everything it delivers could have been fetched over HTTP, and everything it
 * misses can be. That is the property that makes reconnection simple: there is
 * no replay to negotiate and no acknowledgement to track, because a gap is
 * closed by catching up rather than by the socket promising it will not happen.
 *
 * So the one thing this must never do is go quiet without saying so. A socket
 * that reconnects invisibly and resubscribes leaves whatever arrived during the
 * gap missing forever, and the room looks fine — which is worse than an
 * obviously broken connection. `onReconnect` exists for exactly that, and
 * `RoomSync.catchUp` is what it is for.
 */

import type { Event, HandshakeRecord } from '@revel/protocol';
import { parseServerFrame } from '@revel/protocol';
import type { EventStream } from './transport.js';

/** The subset of `WebSocket` this uses, so a test can supply its own. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface WebSocketStreamOptions {
  /** Opens a connection. Called again on every reconnect. */
  connect: () => SocketLike;

  /**
   * Called after a reconnect, with the rooms that were resubscribed.
   *
   * **Catch up here.** Anything that arrived while the socket was down was not
   * delivered and will not be re-sent.
   */
  onReconnect?: (rooms: string[]) => void;

  /** Called when the connection state changes, for a UI that says so. */
  onStatus?: (status: 'connecting' | 'open' | 'closed') => void;

  /**
   * Somebody joined or left a space this device is in.
   *
   * **Reconcile here.** Nothing else tells an existing member that a newcomer
   * needs their leaf committed — a join by invite link creates no MLS proposal,
   * so `onCommitRequested` never fires for it.
   */
  onMembersChanged?: (spaceId: string) => void;

  /**
   * Device-addressed frames, which have no room to route through.
   *
   * A group can serve several rooms (`docs/03` §4), and a Welcome arrives for a
   * group whose rooms this client may not have heard of yet — so these are not
   * subscriptions, they are things the server says to *this device*. Missing
   * one costs a fetch: `GroupSync.catchUp` closes a handshake gap and
   * `GroupSync.acceptWelcomes` finds a missed invitation.
   */
  onHandshake?: (record: HandshakeRecord) => void;
  onCommitRequested?: (groupId: string, deadline: number) => void;
  onWelcome?: (groupId: string, bytes: string) => void;

  /**
   * Backoff between attempts, in milliseconds.
   *
   * Capped, and jittered by the caller if they care: a fleet of clients that
   * all reconnect on the same schedule is a thundering herd aimed at a server
   * that is already having a bad time.
   */
  backoff?: (attempt: number) => number;

  /** Overridable for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const DEFAULT_BACKOFF = (attempt: number) => Math.min(1000 * 2 ** attempt, 30_000);

/**
 * How long a connection has to stay up before it counts as a success.
 *
 * Below this it is a flap, and a flap must keep escalating the backoff rather
 * than resetting it. Ten seconds is longer than any handshake and far shorter
 * than any session worth keeping.
 */
const STABLE_MS = 10_000;

export class WebSocketStream implements EventStream {
  #options: WebSocketStreamOptions;
  #socket: SocketLike | null = null;
  #listeners = new Map<string, Set<(event: Event) => void>>();
  #open = false;
  #attempt = 0;
  #timer: unknown = null;
  #stopped = false;

  constructor(options: WebSocketStreamOptions) {
    this.#options = options;
  }

  get connected(): boolean {
    return this.#open;
  }

  /** Rooms this stream wants, whether or not it currently has a connection. */
  get rooms(): string[] {
    return [...this.#listeners.keys()];
  }

  subscribe(roomId: string, onEvent: (event: Event) => void): () => void {
    let set = this.#listeners.get(roomId);
    const isNew = !set;
    if (!set) {
      set = new Set();
      this.#listeners.set(roomId, set);
    }
    set.add(onEvent);

    if (isNew && this.#open) this.#send({ op: 'SUBSCRIBE', d: { rooms: [roomId] } });
    this.start();

    return () => {
      set.delete(onEvent);
      if (set.size > 0) return;
      this.#listeners.delete(roomId);
      if (this.#open) this.#send({ op: 'UNSUBSCRIBE', d: { rooms: [roomId] } });
    };
  }

  /** Open the connection, if it is not already opening. */
  start(): void {
    this.#stopped = false;
    if (this.#socket || this.#timer) return;
    this.#connect();
  }

  /** Close it and stop reconnecting. */
  stop(): void {
    this.#stopped = true;
    this.#clearTimer();
    const socket = this.#socket;
    this.#socket = null;
    this.#open = false;
    socket?.close();
    this.#options.onStatus?.('closed');
  }

  #connect(): void {
    this.#options.onStatus?.('connecting');
    const socket = this.#options.connect();
    this.#socket = socket;

    socket.onopen = () => {
      if (this.#socket !== socket) return;
      this.#open = true;
      const reconnecting = this.#attempt > 0;
      /**
       * **Not reset here.** Opening is not the same as working.
       *
       * This used to zero the attempt counter the instant a socket opened, on
       * the reasonable-sounding theory that a connection that opened is a
       * connection that succeeded. A socket that opens and dies immediately —
       * a proxy that hangs up, a token the server accepts and then rejects,
       * a network that is up but not usable — then reconnected at
       * `backoff(0)`, which is one second, forever. Exponential backoff that
       * never gets past its first step is a one-second poll with extra steps,
       * and every one of those reconnects dragged a full catch-up behind it.
       *
       * Reset once it has *stayed* open instead. `unref` where it exists so a
       * timer cannot hold a Node process open on its own.
       */
      const settle = this.#options.setTimeout ?? globalThis.setTimeout;
      const settled = settle(() => {
        if (this.#socket === socket && this.#open) this.#attempt = 0;
      }, STABLE_MS);
      (settled as { unref?: () => void })?.unref?.();
      this.#options.onStatus?.('open');

      // Absolute, not incremental: the server does not know what the last
      // connection managed to register, and neither do we.
      const rooms = this.rooms;
      if (rooms.length) this.#send({ op: 'SUBSCRIBE', d: { rooms } });

      // Only after a *re*connect. On a first connection there is no gap,
      // and a catch-up here would race the caller's own initial one.
      if (reconnecting) this.#options.onReconnect?.(rooms);
    };

    socket.onmessage = (message) => {
      if (this.#socket !== socket) return;
      let json: unknown;
      try {
        json = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const frame = parseServerFrame(json);
      // A frame this build does not understand is a newer server's, not an
      // error. Dropping the connection over it would make every deployment a
      // flag day.
      if (!frame) return;

      switch (frame.op) {
        case 'EVENT':
          for (const listener of this.#listeners.get(frame.d.room) ?? []) listener(frame.d);
          return;
        case 'HANDSHAKE':
          return this.#options.onHandshake?.(frame.d);
        case 'COMMIT_REQUESTED':
          return this.#options.onCommitRequested?.(frame.d.group, frame.d.deadline);
        case 'WELCOME':
          return this.#options.onWelcome?.(frame.d.group, frame.d.bytes);
        case 'MEMBERS_CHANGED':
          return this.#options.onMembersChanged?.(frame.d.space);
        default:
          return;
      }
    };

    const fail = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#open = false;
      this.#options.onStatus?.('closed');
      if (!this.#stopped) this.#scheduleReconnect();
    };
    socket.onclose = fail;
    socket.onerror = fail;
  }

  #scheduleReconnect(): void {
    const delay = (this.#options.backoff ?? DEFAULT_BACKOFF)(this.#attempt++);
    const set = this.#options.setTimeout ?? globalThis.setTimeout;
    this.#timer = set(() => {
      this.#timer = null;
      if (!this.#stopped) this.#connect();
    }, delay);
  }

  #clearTimer(): void {
    if (this.#timer === null) return;
    // The handle is opaque on purpose — `setTimeout` returns a number in a
    // browser and a Timeout in Node, and this has to run in both.
    const clear = this.#options.clearTimeout ?? (globalThis.clearTimeout as (h: unknown) => void);
    clear(this.#timer);
    this.#timer = null;
  }

  #send(frame: unknown): void {
    this.#socket?.send(JSON.stringify(frame));
  }
}
