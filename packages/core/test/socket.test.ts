/**
 * The live socket: the client, the server, and the two of them wired together.
 *
 * The third part is the one that matters. A socket protocol is an agreement,
 * and an agreement tested from one side is a description of what that side
 * believes. Here the client's `WebSocketStream` is connected directly to the
 * server's `SocketSession` — no network, both halves real — so a frame either
 * side gets wrong is a failing test rather than a support ticket.
 */
import {
  DEFAULT_EVERYONE,
  type Event,
  encodePayload,
  SnowflakeFactory,
  serialize,
} from '@revel/protocol';
import { Hub, MemoryStore as ServerStore, SocketSession } from '@revel/server';
import { describe, expect, it, vi } from 'vitest';
import { type SocketLike, WebSocketStream } from '../src/index.js';

// ---------------------------------------------------------------------------
// A socket that goes nowhere
// ---------------------------------------------------------------------------

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }

  /** What the client asked for, parsed. */
  get frames(): { op: string; d?: { rooms?: string[] } }[] {
    return this.sent.map((s) => JSON.parse(s));
  }

  open() {
    this.onopen?.({});
  }
  deliver(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop() {
    this.onclose?.({});
  }
}

/** Room ids are snowflakes; the envelope schema enforces it. */
const ROOM1 = '9001';
const ROOM2 = '9002';
const PRIVATE = '9003';

const event = (room: string, id = '1767225600000000001'): Event => ({
  id,
  room,
  sender: 'device',
  class: 'normal',
  epoch: 1,
  payload: encodePayload(new TextEncoder().encode('x')),
  size: 1,
  createdAt: 1,
  purgedAt: null,
  clientNonce: `nonce-${id}`,
});

/** A stream whose reconnect timer fires when the test says so. */
function stream(options: Partial<Parameters<typeof makeStream>[0]> = {}) {
  return makeStream({ ...options });
}

function makeStream(options: {
  onReconnect?: (rooms: string[]) => void;
  onStatus?: (status: string) => void;
}) {
  const sockets: FakeSocket[] = [];
  let pending: (() => void) | null = null;

  const ws = new WebSocketStream({
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onReconnect: options.onReconnect,
    onStatus: options.onStatus as never,
    backoff: () => 1,
    setTimeout: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimeout: () => {
      pending = null;
    },
  });

  return {
    ws,
    sockets,
    latest: () => sockets[sockets.length - 1] as FakeSocket,
    /** Fire the pending reconnect timer. */
    tick: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    hasPending: () => pending !== null,
  };
}

describe('WebSocketStream', () => {
  it('subscribes once the connection is open', () => {
    const s = stream();
    s.ws.subscribe(ROOM1, () => {});
    // Nothing sent yet: there is no connection to send it on.
    expect(s.latest().frames).toEqual([]);

    s.latest().open();
    expect(s.latest().frames).toEqual([{ op: 'SUBSCRIBE', d: { rooms: [ROOM1] } }]);
  });

  it('subscribes immediately when it is already open', () => {
    const s = stream();
    s.ws.subscribe(ROOM1, () => {});
    s.latest().open();
    s.ws.subscribe(ROOM2, () => {});

    expect(s.latest().frames.at(-1)).toEqual({ op: 'SUBSCRIBE', d: { rooms: [ROOM2] } });
  });

  it('delivers an event to the room that asked for it, and only that room', () => {
    const s = stream();
    const one: Event[] = [];
    const two: Event[] = [];
    s.ws.subscribe(ROOM1, (e) => one.push(e));
    s.ws.subscribe(ROOM2, (e) => two.push(e));
    s.latest().open();

    s.latest().deliver({ op: 'EVENT', d: event(ROOM1) });
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(0);
  });

  it('gives every listener on a room the same event', () => {
    const s = stream();
    let a = 0;
    let b = 0;
    s.ws.subscribe(ROOM1, () => a++);
    s.ws.subscribe(ROOM1, () => b++);
    s.latest().open();

    s.latest().deliver({ op: 'EVENT', d: event(ROOM1) });
    expect([a, b]).toEqual([1, 1]);
    // And one room, subscribed twice, is still one subscription on the wire.
    expect(s.latest().frames).toEqual([{ op: 'SUBSCRIBE', d: { rooms: [ROOM1] } }]);
  });

  it('unsubscribes only when the last listener goes', () => {
    const s = stream();
    const stopA = s.ws.subscribe(ROOM1, () => {});
    const stopB = s.ws.subscribe(ROOM1, () => {});
    s.latest().open();

    stopA();
    expect(s.latest().frames.at(-1)?.op).toBe('SUBSCRIBE');
    stopB();
    expect(s.latest().frames.at(-1)).toEqual({ op: 'UNSUBSCRIBE', d: { rooms: [ROOM1] } });
  });

  it('ignores a frame it does not understand rather than dropping the socket', () => {
    // A newer server's frame must not make every deployment a flag day.
    const s = stream();
    const seen: Event[] = [];
    s.ws.subscribe(ROOM1, (e) => seen.push(e));
    s.latest().open();

    s.latest().deliver({ op: 'SOMETHING_NEW', d: { whatever: true } });
    s.latest().deliver('not even json');
    s.latest().onmessage?.({ data: '{{{' });
    s.latest().deliver({ op: 'EVENT', d: event(ROOM1) });

    expect(seen).toHaveLength(1);
    expect(s.latest().closed).toBe(false);
  });

  describe('reconnecting', () => {
    it('resubscribes to everything, absolutely', () => {
      // The server does not know what the last connection registered, and
      // neither do we — so the whole set goes up again.
      const s = stream();
      s.ws.subscribe(ROOM1, () => {});
      s.ws.subscribe(ROOM2, () => {});
      s.latest().open();

      s.latest().drop();
      s.tick();
      s.latest().open();

      expect(s.sockets).toHaveLength(2);
      expect(s.latest().frames[0]).toEqual({
        op: 'SUBSCRIBE',
        d: { rooms: [ROOM1, ROOM2] },
      });
    });

    it('says a gap happened, because the socket cannot replay it', () => {
      // The thing that must never be silent. Anything that arrived while the
      // socket was down is not coming back on its own.
      const onReconnect = vi.fn();
      const s = stream({ onReconnect });
      s.ws.subscribe(ROOM1, () => {});
      s.latest().open();
      expect(onReconnect).not.toHaveBeenCalled();

      s.latest().drop();
      s.tick();
      s.latest().open();
      expect(onReconnect).toHaveBeenCalledWith([ROOM1]);
    });

    it('does not announce a gap on the first connection', () => {
      // There is nothing to catch up on, and a catch-up here would race the
      // caller's own initial one.
      const onReconnect = vi.fn();
      const s = stream({ onReconnect });
      s.ws.subscribe(ROOM1, () => {});
      s.latest().open();
      expect(onReconnect).not.toHaveBeenCalled();
    });

    it('reports the states a UI needs to say something honest', () => {
      const seen: string[] = [];
      const s = stream({ onStatus: (status) => seen.push(status) });
      s.ws.subscribe(ROOM1, () => {});
      s.latest().open();
      s.latest().drop();
      s.tick();
      s.latest().open();

      expect(seen).toEqual(['connecting', 'open', 'closed', 'connecting', 'open']);
    });

    it('treats an error the same as a close', () => {
      const s = stream();
      s.ws.subscribe(ROOM1, () => {});
      s.latest().open();
      s.latest().onerror?.({});
      expect(s.hasPending()).toBe(true);
    });

    it('stops trying when told to', () => {
      const s = stream();
      s.ws.subscribe(ROOM1, () => {});
      s.latest().open();
      s.ws.stop();

      expect(s.latest().closed).toBe(true);
      s.tick();
      expect(s.sockets).toHaveLength(1);
    });

    it('ignores a dead socket that fires late', () => {
      // A socket replaced by a reconnect can still deliver; it must not be
      // able to reach through and touch the live one's state.
      const s = stream();
      const seen: Event[] = [];
      s.ws.subscribe(ROOM1, (e) => seen.push(e));
      const first = s.latest();
      first.open();
      first.drop();
      s.tick();
      s.latest().open();

      first.deliver({ op: 'EVENT', d: event(ROOM1) });
      expect(seen).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// The two halves, wired to each other
// ---------------------------------------------------------------------------

const DEVICE = 'device-alice';

function pairedToServer() {
  const store = new ServerStore();
  const hub = new Hub();
  const ids = new SnowflakeFactory(1);

  for (const id of [ROOM1, ROOM2, PRIVATE]) {
    store.rooms.set(id, {
      id,
      spaceId: 'space1',
      groupId: null,
      streamPaging: false,
      notifyHints: false,
    });
  }
  store.roles.set('role-everyone', {
    id: 'role-everyone',
    spaceId: 'space1',
    bits: serialize(DEFAULT_EVERYONE),
    position: 0,
  });
  store.devices.set(DEVICE, { pub: DEVICE, accountId: 'alice', revokedAt: null });
  for (const id of [ROOM1, ROOM2]) {
    store.memberships.set(`${id}:alice`, {
      roomId: id,
      accountId: 'alice',
      roleIds: ['role-everyone'],
    });
  }
  // `private` deliberately has no membership for alice.

  let session: SocketSession | null = null;

  const socket = new FakeSocket();
  const ws = new WebSocketStream({
    connect: () => socket,
    backoff: () => 1,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });

  // The client's outgoing frames go into the server session; the server's go
  // back into the client. This is the whole network.
  socket.send = (data: string) => {
    socket.sent.push(data);
    void session?.receive(data);
  };

  session = new SocketSession({ store, hub }, { accountId: 'alice', devicePub: DEVICE }, (frame) =>
    socket.deliver(frame),
  );

  return { store, hub, ids, ws, socket, session };
}

/** Let the server session finish its policy checks, which are async. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the client and the server socket, wired together', () => {
  it('carries a broadcast event from the hub to a listener', async () => {
    const { hub, ws, socket } = pairedToServer();
    const seen: Event[] = [];
    ws.subscribe(ROOM1, (e) => seen.push(e));
    socket.open();
    await flush();

    hub.broadcast(ROOM1, event(ROOM1));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.room).toBe(ROOM1);
  });

  it('does not deliver a room the client never asked for', async () => {
    const { hub, ws, socket } = pairedToServer();
    const seen: Event[] = [];
    ws.subscribe(ROOM1, (e) => seen.push(e));
    socket.open();
    await flush();

    hub.broadcast(ROOM2, event(ROOM2));
    expect(seen).toHaveLength(0);
  });

  it('silently refuses a room the client cannot read', async () => {
    // Refused, and not told which — telling somebody which of the rooms they
    // guessed at exist is a directory.
    const { hub, ws, socket, session } = pairedToServer();
    const seen: Event[] = [];
    ws.subscribe(PRIVATE, (e) => seen.push(e));
    socket.open();
    await flush();

    expect(session.rooms).toEqual([]);
    hub.broadcast(PRIVATE, event(PRIVATE));
    expect(seen).toHaveLength(0);
  });

  it('subscribes to what it can and skips what it cannot, in one frame', async () => {
    const { ws, socket, session } = pairedToServer();
    ws.subscribe(ROOM1, () => {});
    ws.subscribe(PRIVATE, () => {});
    ws.subscribe(ROOM2, () => {});
    socket.open();
    await flush();

    expect(session.rooms.sort()).toEqual([ROOM1, ROOM2]);
  });

  it('stops delivering after an unsubscribe', async () => {
    const { hub, ws, socket, session } = pairedToServer();
    const seen: Event[] = [];
    const stop = ws.subscribe(ROOM1, (e) => seen.push(e));
    socket.open();
    await flush();

    stop();
    await flush();
    expect(session.rooms).toEqual([]);

    hub.broadcast(ROOM1, event(ROOM1));
    expect(seen).toHaveLength(0);
  });

  it('drops every subscription when the connection closes', async () => {
    const { hub, ws, socket, session } = pairedToServer();
    ws.subscribe(ROOM1, () => {});
    ws.subscribe(ROOM2, () => {});
    socket.open();
    await flush();
    expect(hub.subscriberCount(ROOM1)).toBe(1);

    session.close();
    // A lost connection must not leak a room.
    expect(hub.subscriberCount(ROOM1)).toBe(0);
    expect(hub.subscriberCount(ROOM2)).toBe(0);
  });

  it('answers a ping, so a middlebox does not cut the connection', async () => {
    const { socket, session } = pairedToServer();
    const answers: unknown[] = [];
    socket.onmessage = (m) => answers.push(JSON.parse(String(m.data)));

    await session.receive(JSON.stringify({ op: 'PING' }));
    expect(answers).toContainEqual({ op: 'PONG' });
  });

  it('says so, and stays up, when handed nonsense', async () => {
    const { socket, session } = pairedToServer();
    const answers: { op: string; d?: { reason?: string } }[] = [];
    socket.onmessage = (m) => answers.push(JSON.parse(String(m.data)));

    await session.receive('{{{ not json');
    await session.receive(JSON.stringify({ op: 'DELETE_EVERYTHING' }));

    expect(answers.map((a) => a.d?.reason)).toEqual(['malformed_frame', 'unknown_frame']);
    // And it is still usable afterwards.
    await session.receive(JSON.stringify({ op: 'PING' }));
    expect(answers.at(-1)).toEqual({ op: 'PONG' });
  });

  it('says hello as soon as the session exists', () => {
    const frames: { op: string; d?: { device?: string } }[] = [];
    // Captured from construction, which is when READY is sent.
    const store = new ServerStore();
    const session = new SocketSession(
      { store, hub: new Hub() },
      { accountId: 'alice', devicePub: DEVICE },
      (frame) => frames.push(frame as never),
    );
    expect(frames).toEqual([{ op: 'READY', d: { device: DEVICE } }]);
    session.close();
  });

  it('a closed session ignores everything after', async () => {
    const { socket, session } = pairedToServer();
    session.close();
    const answers: unknown[] = [];
    socket.onmessage = (m) => answers.push(JSON.parse(String(m.data)));

    await session.receive(JSON.stringify({ op: 'PING' }));
    expect(answers).toEqual([]);
  });
});
