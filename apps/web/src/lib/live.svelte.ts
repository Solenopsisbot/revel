/**
 * The real core, as reactive state.
 *
 * `live.ts` builds the stack — crypto, store, transport, socket. This holds it,
 * subscribes to it, and turns its callbacks into `$state` so Svelte can render
 * from it. Nothing here decides anything; if it looks like it is, the decision
 * belongs in `packages/core` where it can be tested without a browser.
 *
 * ## Watching rather than polling
 *
 * `ConversationCore.watch(roomId, cb)` fires whenever a room's state changes,
 * which is the only signal that a message arrived — the socket delivers into
 * the sync engine, not into the UI. Each room is subscribed once, on first
 * read, and the version counter is what `$derived` downstream actually depends
 * on: the `RoomState` object identity changes on every reduce, so bumping a
 * number is both cheaper to compare and impossible to get subtly wrong.
 */

import type { RoomState, Session } from '@revel/core';
import type {
  DeviceInfo,
  RoleInfo,
  RoomInfo,
  SpaceInfo,
  SpaceMemberInfo,
} from '@revel/protocol';
import type { LiveStack } from './live.js';

/**
 * A space, assembled from the two halves that describe it.
 *
 * The Host knows who is in it, what roles exist and which rooms belong to it;
 * it does not know what any of those are *called* (`docs/04` §1). The names
 * arrive as encrypted events and are read off `RoomState`, so this holds the
 * Host's half and the UI joins them.
 */
export interface LiveSpace {
  info: SpaceInfo;
  rooms: RoomInfo[];
  members: SpaceMemberInfo[];
  roles: RoleInfo[];
}

class Live {
  /** The stack, once a signed-in device has started one. */
  stack = $state<LiveStack | null>(null);
  /** Why it is not running, when it is not. Shown rather than swallowed. */
  error = $state('');
  /** Bumped on every room change, so `$derived` has something to depend on. */
  version = $state(0);
  status = $state<'connecting' | 'open' | 'closed'>('closed');

  #rooms = new Map<string, RoomState>();
  #watching = new Set<string>();
  #unwatch: (() => void)[] = [];

  get running(): boolean {
    return this.stack !== null;
  }

  /**
   * Start the real core for a signed-in device.
   *
   * Failure is reported, not thrown: a Host that is unreachable must not stop
   * the app opening, and everything local still works. `error` is what the
   * connection banner reads.
   */
  async start(session: Session): Promise<void> {
    if (this.stack) return;
    try {
      const { startLive } = await import('./live.js');
      const stack = await startLive(session);
      this.stack = stack;
      this.#poll();
      await this.refreshRooms();
      await this.refreshSpaces();
    } catch (err) {
      console.error('could not start the real core', err);
      this.error = String((err as Error)?.message ?? err);
    }
  }

  async stop(): Promise<void> {
    for (const off of this.#unwatch) off();
    this.#unwatch = [];
    this.#watching.clear();
    this.#watchingTyping.clear();
    this.#typing.clear();
    this.#rooms.clear();
    this.spaces = [];
    this.devices = [];
    await this.stack?.close().catch(() => {});
    this.stack = null;
    this.version++;
  }

  /**
   * A room's state, subscribing on first read.
   *
   * Reading `version` first is what makes this reactive: the caller is inside a
   * `$derived`, and without a tracked read it would compute once and never
   * again.
   */
  room(roomId: string): RoomState | null {
    void this.version;
    const stack = this.stack;
    if (!stack) return null;

    this.#subscribe(roomId);
    return this.#rooms.get(roomId) ?? stack.core.conversation.room(roomId);
  }

  /** Subscribe a room once. Idempotent, and the only place `watch` is called. */
  #subscribe(roomId: string): void {
    const stack = this.stack;
    if (!stack || this.#watching.has(roomId)) return;
    this.#watching.add(roomId);
    // `open` fills the state from the local store; `watch` keeps it fresh.
    // Bumping on the way out matters: `open` is the *only* thing that loads a
    // room nobody has looked at, and it does not go through `watch`, so
    // without this an unread badge for such a room would stay at whatever it
    // read before the store had been consulted — which is zero, always.
    void stack.core.conversation
      .open(roomId)
      .then((state) => {
        this.#rooms.set(roomId, state);
        this.version++;
      })
      .catch(() => {});
    this.#unwatch.push(
      stack.core.conversation.watch(roomId, (state) => {
        this.#rooms.set(roomId, state);
        this.version++;
      }),
    );
  }

  /**
   * How many unread messages a room is holding.
   *
   * Subscribes the room the same way `room` does, because a badge is a claim
   * about a room *nobody is looking at* — and an unwatched room's state never
   * changes, so an unsubscribed count would be frozen at whatever it was when
   * the sidebar first rendered.
   */
  unread(roomId: string): number {
    void this.version;
    if (!this.stack) return 0;
    this.#subscribe(roomId);
    return this.stack.core.conversation.unread(roomId);
  }

  /** Everything up to now in this room has been seen. */
  async markRead(roomId: string): Promise<void> {
    await this.stack?.core.conversation.markRead(roomId).catch(() => {});
  }

  /**
   * The devices that can read this account's messages.
   *
   * **The most safety-critical list in the product**, which is why it is
   * fetched rather than cached anywhere: every entry is a key holder, and a
   * stale answer here is somebody looking at a list that no longer says who
   * can read their conversations.
   */
  devices = $state<DeviceInfo[]>([]);

  async refreshDevices(): Promise<void> {
    const stack = this.stack;
    if (!stack) return;
    this.devices = await stack.core.identity.devices().catch((err) => {
      console.error('revel: could not list your devices', err);
      return [];
    });
    this.version++;
  }

  /** Sign one out. Its sessions and push channel die immediately (`docs/03` §3). */
  async revokeDevice(devicePub: string): Promise<void> {
    await this.stack?.core.identity.revokeDevice(devicePub);
    await this.refreshDevices();
  }

  /**
   * What this device is actually holding.
   *
   * `navigator.storage.estimate()` and a room count, which is all that can be
   * *measured* — the fixture screen breaks usage down by messages, media,
   * index and models, and IndexedDB does not report per-store sizes. So the
   * screen shows the two true numbers and says the breakdown is not something
   * the browser will tell it, rather than dividing the total into plausible
   * quarters.
   *
   * `usage` counts everything this origin has stored, which on a device that
   * has been signed in as two accounts includes both. That is the honest
   * number for "how much of your disk is this app using" and the wrong one for
   * "how much is this account" — said on the screen rather than corrected here,
   * because the browser genuinely will not separate them.
   */
  storage = $state<{ usage: number; quota: number; rooms: number } | null>(null);

  async refreshStorage(): Promise<void> {
    const stack = this.stack;
    if (!stack) return;
    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    const rooms = await stack.store.listRoomIds().catch(() => []);
    this.storage = {
      usage: estimate?.usage ?? 0,
      quota: estimate?.quota ?? 0,
      rooms: rooms.length,
    };
    this.version++;
  }

  /** Rooms the Host says this account is in. Refreshed, never guessed. */
  rooms = $state<{ id: string; kind: string; space: string | null; members: string[] }[]>([]);
  /** account key → handle, once asked. See `nameOf`. */
  #names = new Map<string, string>();
  #asking = new Set<string>();

  /**
   * Spaces this account is in, with their rooms, members and roles.
   *
   * Four requests per space, refreshed together rather than lazily per screen:
   * the rail needs the name (which needs a room), the sidebar needs the rooms,
   * and the settings screens need the rest. Fetching them separately meant
   * every screen owned a loading state for the same data.
   */
  spaces = $state<LiveSpace[]>([]);

  async refreshSpaces(): Promise<void> {
    const stack = this.stack;
    if (!stack) return;
    const dir = stack.core.directory;
    // Logged, not swallowed, and per space rather than for the whole list: one
    // space the Host is unhappy about should cost you that space, not the rail.
    const orNone = <T>(what: string, p: Promise<T[]>): Promise<T[]> =>
      p.catch((err) => {
        console.error(`revel: could not load ${what}`, err);
        return [];
      });

    const infos = await orNone('your spaces', dir.spaces());
    const loaded = await Promise.all(
      infos.map(async (info): Promise<LiveSpace> => {
        const [rooms, members, roles] = await Promise.all([
          orNone(`rooms in ${info.id}`, dir.spaceRooms(info.id)),
          orNone(`members of ${info.id}`, dir.spaceMembers(info.id)),
          orNone(`roles in ${info.id}`, dir.spaceRoles(info.id)),
        ]);
        // Subscribe every room now. The rail shows a space's *name*, which
        // lives in an event inside one of its rooms — so a rail that only
        // subscribed the open room would render every other space unnamed
        // until you clicked it.
        for (const room of rooms) this.#subscribe(room.id);
        return { info, rooms, members, roles };
      }),
    );
    this.spaces = loaded;
    this.version++;
  }

  async refreshRooms(): Promise<void> {
    const stack = this.stack;
    if (!stack) return;
    const rooms = await stack.core.directory.refresh().catch(() => []);
    this.rooms = rooms.map((r) => ({
      id: r.id,
      kind: r.kind,
      space: r.space ?? null,
      members: r.members ?? [],
    }));
    this.version++;
  }

  /**
   * What to call an account.
   *
   * A room's membership is a list of keys, so naming the people in one means
   * asking the IdP what each key is called. Asked once per key and cached —
   * and *not* awaited by the caller: a room list that waited for a directory
   * round trip per member would render nothing for as long as the slowest one
   * took. It shows the key, then the name, which is the right order.
   */
  nameOf(accountPub: string): string {
    void this.version;
    const known = this.#names.get(accountPub);
    if (known) return known;

    if (!this.#asking.has(accountPub) && this.stack) {
      this.#asking.add(accountPub);
      void this.stack.core.identity
        .lookup(accountPub)
        .then((profile) => {
          this.#names.set(accountPub, profile.handle ?? accountPub.slice(0, 8));
          this.version++;
        })
        .catch(() => {
          // An account the IdP does not know — a foreign one, or one that has
          // not claimed a handle. Its key is a worse name and it is a true one.
          this.#names.set(accountPub, accountPub.slice(0, 8));
          this.version++;
        });
    }
    return accountPub.slice(0, 8);
  }

  #typing = new Map<string, { account: string; face?: { id: string; name: string } }[]>();
  #watchingTyping = new Set<string>();

  /**
   * Who is typing in a room, or in one of its threads.
   *
   * Subscribed on first read, like `room`. Typing is `ephemeral` — never
   * stored, dropped if nobody is listening (`docs/03` §7) — so there is nothing
   * to fetch and the only way to know is to have been listening.
   */
  typingIn(
    roomId: string,
    thread?: string,
  ): { account: string; face?: { id: string; name: string } }[] {
    void this.version;
    const stack = this.stack;
    if (!stack) return [];
    const key = thread ? `${roomId}/${thread}` : roomId;

    if (!this.#watchingTyping.has(key)) {
      this.#watchingTyping.add(key);
      this.#unwatch.push(
        stack.core.conversation.watchTyping(
          roomId,
          (who) => {
            this.#typing.set(key, who);
            this.version++;
          },
          thread,
        ),
      );
    }
    return this.#typing.get(key) ?? [];
  }

  /** Say that this account is typing, as whichever face is speaking here. */
  async setTyping(roomId: string, thread?: string): Promise<void> {
    await this.stack?.core.conversation.setTyping(roomId, { thread }).catch(() => {});
  }

  /** Say the composer went quiet, so the indicator drops now rather than on TTL. */
  async stopTyping(roomId: string, thread?: string): Promise<void> {
    await this.stack?.core.conversation.stopTyping(roomId, thread).catch(() => {});
  }

  /** The socket, polled because `WebSocketStream` reports by callback. */
  #poll(): void {
    const tick = () => {
      const next = this.stack?.socketStatus() ?? 'closed';
      if (next !== this.status) this.status = next;
      if (this.stack) setTimeout(tick, 1000);
    };
    tick();
  }
}

export const live = new Live();
