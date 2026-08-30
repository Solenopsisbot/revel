/**
 * The fake core, wearing `ConnectionCore`.
 *
 * ## The distinction this seam exists to keep
 *
 * `ConnectionCore` is explicit that it reports **whether the live socket is up,
 * not whether the network is**, and those are genuinely different questions.
 * `navigator.onLine` is true on a captive-portal wifi that will not carry a
 * single byte, and false on a laptop with a perfectly good VPN. The thing that
 * decides whether messages arrive is whether the socket is open.
 *
 * The fake reads `navigator.onLine`, because it has no socket. That is the
 * right approximation for a mock and the wrong answer for a product, so the
 * translation happens here — and when `LiveCore` takes over, the status comes
 * from `WebSocketStream.onStatus`, which knows the real answer.
 *
 * ## Three states, not two
 *
 * `connecting` is a state and not a transition. `docs/24` wants "one dot, and
 * only when there is something to say" — and "trying" and "gave up" are
 * different things to say. Collapsing them means either a dot that lies during
 * a reconnect or one that panics during a hiccup.
 */
import type { ConnectionState } from '@revel/core';
import { core } from './core.svelte.js';

/** The socket's language, from the fake's network-shaped state. */
function toSocketState(fake: 'online' | 'connecting' | 'offline'): ConnectionState {
  if (fake === 'online') return 'open';
  if (fake === 'connecting') return 'connecting';
  return 'closed';
}

export const connection = {
  status(): ConnectionState {
    return toSocketState(core.connection);
  },

  /**
   * Whether to say anything at all.
   *
   * `docs/24`: not a banner, not a modal, not a toast per reconnect — a phone's
   * connection comes and goes all day and an app that narrates each one is
   * exhausting to carry around.
   */
  get quiet(): boolean {
    return this.status() === 'open';
  },

  /** What to call it, for somebody who is not thinking about sockets. */
  label(): string {
    switch (this.status()) {
      case 'open':
        return 'Connected';
      case 'connecting':
        return 'Reconnecting…';
      default:
        return 'Offline';
    }
  },

  reconnect(): void {
    core.setConnection('connecting');
  },
};
