# @revel/core

The headless client. `docs/02`: the sync engine, the room reducer, the local
store, search and the notification rules. No DOM, no framework — it runs in a
browser, in Tauri, in Bun, and in a test.

```ts
const sync = new RoomSync({ crypto, store, transport, stream, account });

await sync.restoreCrypto();          // sealed MLS state, back into the engine
await sync.bind(roomId, groupId);    // which group encrypts this room
await sync.loadGroup(roomId);

const room = await sync.open(roomId); // local only — no network, no waiting
sync.listen(roomId);                  // live events
await sync.catchUp(roomId);           // everything missed while away

await sync.send(roomId, { type: 'm.message', body: 'hello' });
```

## The reducer

`src/rooms/reduce.ts`, which `docs/04` §3 specifies down to the case list. A
pure `(state, event) → state`, applied in event-id order, turning a log of
decrypted events into the room the UI reads. It knows nothing about sockets,
storage, crypto or the clock.

- **Idempotent.** An event applied twice changes nothing.
- **Order-independent** within a batch, and across the two orders delivery
  actually produces: forward (live) and backward (backfill). An event whose
  target has not arrived is deferred, not dropped — without that, scrolling up
  loses every reaction to a message you had not loaded yet.
- **Fails closed.** With no `mayModerate`, a redaction from anyone but the
  author is ignored.
- **Derived, not accumulated.** The pinned list is ordered by the pin event's
  id, and the room name is the newest by id — not the newest to arrive. Two
  devices that synced differently must show the same room.

## The store

`docs/02` puts IndexedDB in a browser and SQLite elsewhere "behind one `Store`
interface". `LocalStore` is that interface, with `MemoryStore` and
`IndexedDbStore` behind it and **one conformance suite run against both** —
two suites would mean two contracts.

It holds decrypted events (the log, which is authoritative), materialised room
snapshots (a cache, so a cold open fits `docs/29` §5's 300 ms), sealed crypto
state (opaque; it cannot read a byte), and account-level values.

## The sync engine

`src/sync/`. The only thing here that decides what happens in what order, which
matters because one of those orderings is a security property:

> **A new crypto state must be durable before a ciphertext from it is sent.**

`docs/31` §7. Encrypting advances this device's position in the MLS secret tree,
and the key *and nonce* come from that position; a crash between sending and
persisting brings the device back at the old position, and the next message
reuses both. `send` persists between encrypting and sending, and if the persist
fails it does not send. There is a test that asserts the order.

## The socket

`WebSocketStream` is an `EventStream` with reconnection, talking to
`SocketSession` on the server. Both sides use the frames in `@revel/protocol`,
and there is a test that wires one directly to the other — a socket protocol
tested from one side is a description of what that side believes.

The one thing it must never do is go quiet. A socket cannot replay what it
missed, so a reconnect that silently resubscribes leaves a permanent hole in
the room and everything *looks* fine:

```ts
const stream = new WebSocketStream({
  connect: () => new WebSocket(url),
  onReconnect: (rooms) => void sync.catchUpAll(rooms),
});
```

## What is not here yet

- **Search**, and the notification rules.
- **Spaces, rooms and membership** as anything other than ids. The engine syncs
  a room it has been told about; nothing yet tells it.
