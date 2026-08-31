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
import type { LiveStack } from './live.js';

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

    if (!this.#watching.has(roomId)) {
      this.#watching.add(roomId);
      // `open` fills the state from the local store; `watch` keeps it fresh.
      void stack.core.conversation.open(roomId).catch(() => {});
      this.#unwatch.push(
        stack.core.conversation.watch(roomId, (state) => {
          this.#rooms.set(roomId, state);
          this.version++;
        }),
      );
    }
    return this.#rooms.get(roomId) ?? stack.core.conversation.room(roomId);
  }

  /** Rooms the Host says this account is in. Refreshed, never guessed. */
  rooms = $state<{ id: string; kind: string; space: string | null; members: string[] }[]>([]);
  /** account key → handle, once asked. See `nameOf`. */
  #names = new Map<string, string>();
  #asking = new Set<string>();

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
  typingIn(roomId: string, thread?: string): { account: string; face?: { id: string; name: string } }[] {
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
