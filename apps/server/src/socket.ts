/**
 * One live connection, independent of what is carrying it.
 *
 * `hub.ts` already separates fan-out from transport so the delivery rules are
 * testable without opening a socket. This does the same for the conversation on
 * one connection: what a client may ask for, what it is told, and what happens
 * when it disappears. The Bun WebSocket wiring in `index.ts` is then thin
 * enough to read in one go, which is what you want from the part that cannot
 * be unit-tested.
 *
 * The socket carries delivery and nothing else. It cannot be used to read
 * history, it cannot be used to send, and it grants no access — a subscription
 * is checked against the same policy an HTTP read is, every time, because a
 * connection that outlives a membership must not outlive the access.
 */
import { parseClientFrame, type ServerFrame } from '@revel/protocol';
import type { Connection, Hub } from './hub.js';
import { canRead } from './policy.js';
import type { Store } from './store/types.js';

export interface SocketDeps {
  store: Store;
  hub: Hub;
}

/** Who the socket authenticated as, established before the session starts. */
export interface Actor {
  accountId: string;
  devicePub: string;
}

/**
 * A connection's lifetime.
 *
 * Construct on open, feed it text with [`receive`], call [`close`] when the
 * socket goes away. It owns its Hub subscriptions and drops all of them on
 * close, so a lost connection cannot leak a room.
 */
export class SocketSession {
  #deps: SocketDeps;
  #actor: Actor;
  #connection: Connection;
  #rooms = new Set<string>();
  #closed = false;

  constructor(deps: SocketDeps, actor: Actor, send: (frame: ServerFrame) => void) {
    this.#deps = deps;
    this.#actor = actor;
    this.#connection = {
      devicePub: actor.devicePub,
      accountId: actor.accountId,
      send: send as (frame: unknown) => void,
    };
    send({ op: 'READY', d: { device: actor.devicePub } });
  }

  /** Rooms this connection is currently receiving. */
  get rooms(): string[] {
    return [...this.#rooms];
  }

  async receive(raw: string): Promise<void> {
    if (this.#closed) return;

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return this.#send({ op: 'ERROR', d: { reason: 'malformed_frame' } });
    }

    const frame = parseClientFrame(json);
    if (!frame) return this.#send({ op: 'ERROR', d: { reason: 'unknown_frame' } });

    switch (frame.op) {
      case 'PING':
        return this.#send({ op: 'PONG' });

      case 'SUBSCRIBE': {
        // Checked one room at a time, and silently skipped when refused. A
        // client learns what it got, not what it was denied: telling somebody
        // which of the rooms they guessed at exist is a directory.
        for (const roomId of frame.d.rooms) {
          if (this.#rooms.has(roomId)) continue;
          if (await canRead(this.#deps.store, roomId, this.#actor)) continue;
          this.#deps.hub.subscribe(roomId, this.#connection);
          this.#rooms.add(roomId);
        }
        return this.#send({ op: 'SUBSCRIBED', d: { rooms: [...this.#rooms] } });
      }

      case 'UNSUBSCRIBE': {
        for (const roomId of frame.d.rooms) {
          this.#deps.hub.unsubscribe(roomId, this.#connection);
          this.#rooms.delete(roomId);
        }
        return this.#send({ op: 'SUBSCRIBED', d: { rooms: [...this.#rooms] } });
      }
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    // Every room, not just the ones we think we are in: `disconnect` is the
    // one that cannot leave a stale connection behind if the two ever disagree.
    this.#deps.hub.disconnect(this.#connection);
    this.#rooms.clear();
  }

  #send(frame: ServerFrame): void {
    if (!this.#closed) this.#connection.send(frame);
  }
}
