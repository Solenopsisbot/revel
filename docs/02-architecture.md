# Architecture

The mental model. Read `01-lessons-from-kith.md` first for *why* each of these
is the way it is. Working name for the project is **UCA** ("untitled chat app")
until `naming-and-vision.md` settles it.

## Design principles (technical — the product ones are in the vision doc)

1. **No cleartext path.** The server never stores or relays message content it
   can read. Not as an option, not for "public" rooms, not for bots. There is
   one event pipeline and it carries ciphertext.
2. **No ghost readers.** Anyone who can read a room holds a key, and every key
   holder is a visible entry in the room's roster — humans, their devices, and
   bots alike. If a translation bot can read your room, it's *in* your room.
3. **The server enforces policy, not semantics.** It knows who may send, who
   may purge, who is a member, and what the roles are. It does not know what an
   event *means*. Features are event types; the server doesn't change when you
   add one.
4. **Centralised until you don't want it to be.** One hosted service for people
   who just want a chat app. The same binary self-hosts. Communities can accept
   identities from other identity providers. **No message federation** — a room
   lives on exactly one host, which gives total order for free. Matrix's
   ordering problem is not a problem we're choosing to have.
5. **Your identity is a keypair.** The handle and the backup live with an
   identity provider you can change. Hosts authenticate you by signature, never
   by password.
6. **Local-first client.** The client owns a full local copy of everything it
   can decrypt. The server is a relay and a backup, not the source of truth for
   rendering. The app opens instantly and works on a bad connection.
7. **Honest about limits.** Written down in `03-identity-and-crypto.md`
   "threat model", and repeated in the product copy. "If someone saw it they
   can save it."

## The pieces

```
                 ┌──────────────────────────────────────────────────────┐
                 │  Identity Provider (IdP)                             │
                 │  handle → account pubkey · key backup · OPAQUE       │
                 │  · device certs · transparency log                   │
                 └───────────────▲──────────────────────────────────────┘
                                 │ resolve handle / verify device cert
   device key                    │
 ┌──────────┐   one WS + REST  ┌─┴────────────────────────────────────────┐
 │  Client  │◀────────────────▶│  Host                                    │
 │ (web /   │                  │  spaces · rooms · membership · roles     │
 │  desktop │                  │  opaque event log · MLS delivery service │
 │  / agent │                  │  blob store · push relay · LiveKit tokens│
 │   host)  │                  └──────────────┬───────────────────────────┘
 └──────────┘                                 │
                                   Postgres · S3-compatible blobs · LiveKit SFU
```

- **Identity Provider (IdP).** Where an account *lives*: the handle directory,
  the encrypted key backup, the OPAQUE registration record, second-factor
  enrolments (TOTP / WebAuthn), the list of enrolled devices (certificates
  signed by the account key), and an append-only transparency log of
  handle↔key bindings. Holds no message data. Small.
- **Host.** Where rooms live. Stores the opaque event log per room, runs the
  MLS delivery service (KeyPackages, handshake log, external proposals),
  enforces membership/roles/rate limits, stores ciphertext blobs, relays
  content-free push notifications, mints LiveKit tokens. Authenticates devices
  by signature against a device certificate, and validates the certificate
  chain up to an account key the IdP vouches for.
- **Client core** (`packages/core`). Headless. Sync engine, MLS sessions, era
  encryption, the room reducer that turns decrypted events into state, the
  local store (IndexedDB in browsers, SQLite in Tauri/Node), the local search
  index, notification rules. **No UI.** The web app, the desktop app, and the
  agent host are all thin shells over this one package.
- **Agent host** (`apps/agent-host`). The core, running as a process, holding a
  bot account's device key, exposing decrypted events and a send API on
  `localhost`. Bot logic — in Python, in anything — talks plaintext to
  localhost; keys never leave the host process. This is how Ayusami connects.
- **LiveKit.** Voice/video SFU, self-hosted alongside the Host for the hosted
  service; self-hosters run their own or point at ours. Media frames are
  encrypted end-to-end with insertable streams keyed from the room's MLS
  exporter, so the SFU forwards ciphertext (proven in Kith).

The hosted service runs **IdP + Host in one deployment**. A self-hoster can run
both (a fully independent island), or just a Host that accepts accounts from
the official IdP (a community that wants to own its data but not its users'
logins), or just an IdP (a collective that wants to own its members' identities
and use any host). The binary is the same; it's config.

## Stack

> **Superseded.** Native iOS/Android moved into scope on 2026-08-27, which
> changes where the core should live. See
> [`26-platform-and-stack.md`](26-platform-and-stack.md) — the short version is
> a **Rust crypto core** (WASM for web, UniFFI for native) with the app core and
> UI staying TypeScript. The table below is kept for the reasoning behind the
> server and web choices, which still stand.


| Layer | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript everywhere** | Kith's shared/crypto/permission code transfers. The core has to run in browsers anyway; one language means the agent host and the client are literally the same package. |
| Server runtime | **Bun** (server entry only; everything else stays Node-compatible) | Built-in WebSocket server, Postgres driver, and `bun build --compile` for a **single-binary self-host artifact**. Reversible — the server is one small app; if Bun bites, swap to Node + `ws` in a day. |
| Database | **Postgres** | Transactions. One DB. No mirror/rollback. `pgvector` later if bots want it. SQLite mode for "single-user self-host" is tempting; don't — one storage engine. |
| Blobs | **S3-compatible** (R2 for hosted, MinIO or local-disk driver for self-host) | R2's zero egress is still the cheapest thing on the internet for the hosted instance; the API is S3 so nobody's locked in. |
| Voice | **LiveKit** | Proven in Kith incl. E2EE. |
| Web client | **SvelteKit 5** (runes) + Tailwind v4, **no** DaisyUI | Same as Kith minus the component library — we're building a design system, not skinning one (see `05-client-and-ux.md`). |
| Desktop | **Tauri 2** wrapping the web build | Native notifications, OS keychain for keys, code-signed binaries — the "trustworthy client" story. Tauri 2 also does iOS/Android; whether that's good enough for mobile is a Phase 7 question. |
| Crypto | `@serenity-kit/opaque` (OPAQUE), `@noble/*` (primitives), **an MLS engine behind an interface** (`ts-mls` first; `mls-rs`→WASM as the audited-swap candidate) | Every MLS library is unaudited in 2026. Isolate it so switching is a package swap, and budget for an audit of whichever we ship. |
| Local store | Dexie (IndexedDB) in browser; SQLite via Tauri/Bun elsewhere, behind one `Store` interface | Local-first needs a real database on the client. |
| Monorepo | pnpm workspaces, Biome, Vitest, TS strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`) | Kith conventions. Keep. |

```
apps/
  server/       Bun. IdP + Host (both roles, config-selected). Hono for REST.
  web/          SvelteKit UI over @uca/core
  desktop/      Tauri 2 shell around apps/web
  agent-host/   @uca/core as a daemon + localhost plaintext API
packages/
  protocol/     Zod schemas: entities, event envelope, encrypted event types, permissions, wire frames
  crypto/       MLS engine interface + ts-mls impl, era history, envelope backup, device certs, media sealing
  core/         headless client: sync, sessions, room reducer, store interface, search, notification rules
  ui/           the design system (tokens, primitives) — consumed by web; UI-only
  sdk-py/       (later) Python client for the agent host's localhost API
docs/           these
```

## The request path — one trace

**Sending a message** in a room:

1. Client core builds the encrypted event: `{type:'m.message', face, body,
   …}` → serialised → sealed under the room group's current **era root**
   (derived from the MLS exporter for this epoch; see `03-…` "era encryption").
2. Client `POST /rooms/:id/events` with the server-visible envelope:
   `{class:'normal', epoch, stream?, payload:<bytes>, client_nonce}`. Signed by
   the device key (the WS/REST session is device-authenticated).
3. Server: device session valid → account is a member of the room → account
   has `SEND` in this room (roles + overrides) → rate limit → size cap →
   **one INSERT** into `events` with a server-assigned monotonic id →
   `client_nonce` dedup.
4. Fan-out: every connected device of every member of the room gets the event
   over its single WebSocket. Members with no connected device and a push
   subscription get a **content-free** push ("activity in room R") if
   `class === 'normal'`.
5. Every receiving core: look up era root for `epoch` → open → run the room
   reducer → persist to local store → UI reacts. The sender reconciles its
   optimistic copy by `client_nonce`.

The server touched: a session table, a membership check, a permission
resolution, one insert, a fan-out. It did not parse the message.

**Adding a member** to a room is where the server does real work — see
`03-identity-and-crypto.md` "membership and who commits".

## What the server can and can't do — the honest list

Can (policy): membership, invites, bans, roles, rate limits, size caps,
purge-by-event-id on a privileged request, KeyPackage storage/claim, MLS
external proposals (propose add/remove, never commit), push relay, blob
storage, LiveKit tokens, public listings a space *chooses* to publish.

Can't (semantics): read messages, room names/topics, faces, reactions,
receipts, typing; search; render link previews; run automod; scan uploads;
show a notification preview; give a non-member (including itself) history.

Everything in the "can't" list has a client-side or bot-member answer in
`05-client-and-ux.md` — that's the point of the "no ghost readers" principle:
the answer to "but how do we do X" is always "a member does it, visibly."

## Scaling shape

Friends-scale to community-scale, not Discord-scale, and we say so. Concretely:

- One Host process handles thousands of concurrent devices; Postgres handles the
  log. Scale-out (multiple Host processes) is a pub/sub layer (NATS) between
  them — designed for, not built, in v1.
- The MLS group-size ceiling is the real limit: v1 documents **~2,000 members
  per group** (see `03-…` "size ceiling"). A public community with 50 rooms is
  fine; a 100k-member public server is not a v1 target.
- 2 vCPU / 4 GB comfortably runs the IdP, Host and Postgres for a few hundred
  concurrent devices — the server relays opaque bytes and enforces policy, so it
  is I/O-bound well before it is CPU-bound. Voice is the part that actually
  scales with use. Sizing in [`06-roadmap.md`](06-roadmap.md#what-it-needs-to-run).
