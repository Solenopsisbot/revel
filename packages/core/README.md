# @revel/core

The headless client. `docs/02`: the sync engine, the room reducer, the local
store, search and the notification rules. No DOM, no framework — it runs in a
browser, in Tauri, in Bun, and in a test.

## What is here

**The room reducer** (`src/rooms/reduce.ts`), which `docs/04` §3 specifies down
to the case list. A pure function `(state, event) → state`, applied in event-id
order, that turns a log of decrypted events into the room the UI reads:

```ts
import { emptyRoom, reduceAll } from '@revel/core';

const room = reduceAll(emptyRoom(roomId), events, {
  mayModerate: (account) => permissions.has(account, 'MANAGE_EVENTS'),
});
```

It knows nothing about sockets, storage, crypto or the clock. That is what makes
a room's contents a function of its event log — the same log produces the same
room, on any device, in any order of arrival.

Three properties worth knowing before using it:

- **Idempotent.** Applying an event twice changes nothing, because a sync engine
  re-fetches and a socket replays. `reduce(s, e) === s` when `e` is already in.
- **Order-insensitive.** Events are sorted by id on the way in, so a history
  page and a live burst can be handed over in whatever order they arrived.
- **Fails closed.** With no `mayModerate`, a redaction from anyone but the
  author is ignored. The cost of wrongly ignoring a moderator is a stale row;
  the cost of the opposite is anyone deleting anything.

Optimistic sends live here too — `addPending`, `markFailed`, `dropPending` —
and the server's echo replaces the local copy by `clientNonce`, since the local
copy has no server id yet.

## What is not here yet

- **The local store.** `docs/02` names Dexie over IndexedDB in a browser and
  SQLite elsewhere, behind one interface. Nothing writes anything down, which
  includes the sealed MLS state `@revel/crypto` hands out.
- **The sync engine.** Fetching history, the socket, and the ordering rule that
  `docs/31` §7 pinned down: a new crypto state must be durable before a
  ciphertext from it is sent.
- **Search, notification rules.**
