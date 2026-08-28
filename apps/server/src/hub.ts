/**
 * Fan-out, independent of transport.
 *
 * Keeping this separate from the WebSocket layer means the delivery rules —
 * who receives an event, and which events never persist — are unit-testable
 * without opening a socket, which is most of what makes `docs/29` §4's
 * multi-client harness feasible.
 */
import type { Event } from '@revel/protocol';

export interface Connection {
  /** The device this socket authenticated as. */
  devicePub: string;
  accountId: string;
  send(frame: unknown): void;
}

export class Hub {
  /** roomId -> connections currently subscribed. */
  #rooms = new Map<string, Set<Connection>>();

  subscribe(roomId: string, conn: Connection): void {
    let set = this.#rooms.get(roomId);
    if (!set) {
      set = new Set();
      this.#rooms.set(roomId, set);
    }
    set.add(conn);
  }

  unsubscribe(roomId: string, conn: Connection): void {
    const set = this.#rooms.get(roomId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.#rooms.delete(roomId);
  }

  /** Drop a connection from every room — call on socket close. */
  disconnect(conn: Connection): void {
    for (const [roomId, set] of this.#rooms) {
      set.delete(conn);
      if (set.size === 0) this.#rooms.delete(roomId);
    }
  }

  subscriberCount(roomId: string): number {
    return this.#rooms.get(roomId)?.size ?? 0;
  }

  /**
   * Deliver to everyone subscribed to the room, optionally excluding the
   * sender's own connection.
   *
   * The server cannot filter by content because it cannot read it. Delivery is
   * membership-scoped and nothing more; confidentiality comes from key
   * possession, not from this function (`docs/03` §4).
   */
  broadcast(roomId: string, event: Event, opts: { exclude?: Connection } = {}): number {
    const set = this.#rooms.get(roomId);
    if (!set) return 0;
    let sent = 0;
    for (const conn of set) {
      if (opts.exclude && conn === opts.exclude) continue;
      conn.send({ op: 'EVENT', d: event });
      sent += 1;
    }
    return sent;
  }
}
