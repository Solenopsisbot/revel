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
    } catch (err) {
      console.error('could not start the real core', err);
      this.error = String((err as Error)?.message ?? err);
    }
  }

  async stop(): Promise<void> {
    for (const off of this.#unwatch) off();
    this.#unwatch = [];
    this.#watching.clear();
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
