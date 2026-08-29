# @revel/crypto

The seam between the app and the crypto, and the Worker that keeps the crypto
off the thread that paints.

`docs/26` §Option C splits the system at one line: Rust owns MLS, device keys
and envelope encryption; TypeScript owns the sync engine, the room reducer, the
local store, search and all UI. This package is that line.

```ts
import wasm from '@revel/crypto-wasm/revel_crypto_bg.wasm?url';
import { spawnCryptoEngine } from '@revel/crypto';

const crypto = spawnCryptoEngine({ wasm });
await crypto.open({ deviceLabel: 'laptop' });

await crypto.createGroup(groupId);
await crypto.stageAdd(groupId, keyPackages);
const out = await crypto.commit(groupId);
await send(out);                       // the server may still refuse
await crypto.applyPending(groupId);    // only now is it our state
```

Read `src/engine.ts` first — it is the interface, and the comments on it are
the design. Two things to know before using it:

- **`commit` does not apply.** Applying before the server accepts forks the
  group into an epoch nobody else reaches.
- **It is keyed by group, not room.** A space-wide audience is one MLS group
  shared by many rooms (`docs/03` §4). This layer does not know what a room is.

## Layout

| file | what |
| --- | --- |
| `engine.ts` | the interface, and why it is shaped that way |
| `session.ts` | the behaviour — synchronous, testable, thread-agnostic |
| `handlers.ts` | request → answer, as a table typed against the interface |
| `worker.ts` | `postMessage` and nothing else |
| `client.ts` | the main-thread `CryptoEngine` that talks to it |

Tests run in Node against the real wasm and cover `session.ts` and
`handlers.ts`; they need `pnpm build:wasm` first and skip loudly without it.
The Worker plumbing is verified in a browser by `bench/worker` — `pnpm
bench:worker` — which measures the thing the Worker exists for.

## Persistence

Group state survives a reload. mls-rs persists synchronously and IndexedDB does
not, so getting bytes out is an explicit second step rather than a callback:

```ts
for (const groupId of await crypto.dirtyGroups()) {
  await store.put(groupId, await crypto.exportGroup(groupId));  // sealed
}
```

and on the way back:

```ts
const crypto = spawnCryptoEngine({ wasm });
await crypto.open({ accountSecret, deviceSecret, deviceLabel: 'laptop' });
await crypto.importGroup(sealed);
await crypto.loadGroup(groupId);
```

**`deviceSecret` is not optional for a reload.** Without it this is a new
device — a new leaf in every group, with the old one still sitting in all of
them.

**One rule, and it is sharp: a new state must be durable before a ciphertext
from it is sent.** Sending advances this device's position in the secret tree,
and the key and nonce come from that position; restore behind it and the next
send reuses both. `docs/31` §7 has the detail and the test.

Key packages persist the same way, and need to: publish one, close the tab, get
added while away, and without its private half the Welcome cannot be opened.

```ts
if (await crypto.keyPackagesDirty()) {
  await store.putKeyPackages(await crypto.exportKeyPackages());
}
```

## Not built yet

**Nothing writes the sealed blobs anywhere.** That is `packages/core`.
