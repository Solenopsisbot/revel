# What we're taking from Kith, and what we're not

Kith (`~/coding/websites/kith/`) is the previous attempt: a feature-complete
Discord-style v1 on Cloudflare (~45k LOC), plus three branches that never
merged — `feat/e2ee` (MLS end-to-end encryption, reached staging), `modular`
(customisable layout engine + plugin design), and `audit` (security hardening,
merged back into main). This doc is the autopsy. Read it before reading the
plan, because most of the plan's decisions are reactions to something here.

## Keep — the things Kith got right

These are carried forward more or less intact. Don't re-derive them.

| Thing | Where in Kith | Why it's good |
| --- | --- | --- |
| **Account / Identity split** | `packages/shared/src/schemas.ts`, `docs/architecture.md` | One account, many *faces* (headmates). Permissions on the account, authorship on the face. Plurality falls out of the data model instead of being a feature. |
| **Proxy tags** | `packages/shared/src/plurality.ts` | `J: hello` auto-attributes to the matching face, longest tag wins. Pure, dependency-free, tested. Copy it. |
| **Per-message "expressions"** | commit `1cebcdc` | Multiple avatars per face, chosen per message. The discussion asked for "multiple pfps per identity" — Kith already had it. |
| **Agents are accounts** | `docs/architecture.md` | Bots pass the *same* permission checks as humans. No "bot permission" concept. Under E2EE this becomes "bots are key-holding members" (`e2ee-design.md` §14), which is the right consequence. |
| **Permission bitfields + channel overrides + thread inheritance** | `packages/shared/src/permissions.ts` | BigInt flags, `@everyone` base, per-role allow/deny masks per channel, owner short-circuit, escalation guards (can't grant what you lack, can't touch roles above yours). Proven model. |
| **The security posture** | `audit` branch, `docs/architecture.md` "security model" | Strict CSP, same-origin-only media (no SSRF via avatars, no tracking pixels), magic-byte sniffing on uploads, SSRF-guarded webhooks, atomic single-use tokens, `tokenVersion` session revocation, automated-flagged PATs. All of it transfers. |
| **OPAQUE for password auth** | `e2ee-design.md` §5 | The server never sees anything password-derived; `exportKey` doubles as the key-wrapping key. Correct choice; we keep the library (`@serenity-kit/opaque`, RFC 9807, audited). |
| **Envelope key backup + recovery code + passkey PRF** | `e2ee-design.md` §4/§7, `e2ee-implementation.md` | Password change = O(1) re-wrap. Three independent wraps of the same secret (password, recovery code, passkey). Keep the whole scheme. |
| **MLS as the one group-key engine** | `e2ee-design.md` §6 | One engine for DMs, groups, channels, voice. Keep. |
| **Era encryption + anchor-split history** | `packages/crypto/src/history.ts` | Content is sealed under a per-epoch *era root* from the MLS exporter, not as MLS application messages. Gives history-on-join and multi-device for free, at the cost of per-epoch (not per-message) forward secrecy. It's the pragmatic call and it's proven. Keep, and keep the honesty about the trade. |
| **Invite key in the URL fragment** | `e2ee-design.md` §15a ("the Wormhole trick") | Room keys wrapped to an invite keypair whose private half lives after `#` — the server stores what it can't open. Keep. |
| **Voice E2EE via LiveKit insertable streams keyed from the MLS exporter** | `e2ee-implementation.md` Phase 4 | Validated Chrome↔Safari on staging, with mid-call rekey. Keep exactly. |
| **Key transparency log + safety numbers** | `e2ee-implementation.md` Phase 6 | The hash-chained binding log and TOFU verifier are the right first step. Keep; finish the Merkle/STH upgrade this time. |
| **Gateway ergonomics** | `apps/web/src/lib/gateway.ts` | Heartbeats that survive tab throttling, backoff reconnect kicked by `focus`/`online`/`visibilitychange`, per-socket sequence numbers. Keep the behaviour. |
| **The CSS-variable customisation seam** | `modular` branch, `docs/customization.md` | Theme/accent/radius/density/font/columns as validated `:root` vars, synced to the account. Right seam. This time it's there from day one instead of retrofitted. |
| **The sandboxed-plugin design** | `docs/plugins-design.md` | Opaque-origin iframes, host-mediated RPC, manifest permissions, no ambient authority. Not built in Kith; the design is sound and we adopt it as-is for later. |
| **"Document what you build"** | `AGENTS.md` | Internal docs updated in the same change as the code, public docs separate. This is why Kith was legible enough to mine. Non-negotiable here too. |
| **Emoji ban in product surfaces** | commit `f763b06` | Yes. |

## Change — the things that hurt

### 1. Cloudflare was the wrong substrate for *this* product

Kith's whole pitch was "cheap because edge" — Durable Objects with hibernated
WebSockets, R2's zero egress, D1's free tier. Real savings. But:

- **workerd can't run arbitrary WASM** (`WebAssembly.compile` is blocked), so the
  audited OPAQUE library couldn't run on the server. The fix was an entire
  **Cloudflare Container** just to host three OPAQUE endpoints
  (`e2ee-design.md` §16 Phase 0, §17 #9). The runtime fought the crypto.
- **No transactions across D1 and a Durable Object.** Every cross-tier write
  needed the `withMirror` compensating-rollback pattern
  (`docs/data-model.md` "Consistency"). That's a whole class of bugs Postgres
  simply doesn't have.
- **Not self-hostable** in any meaningful sense. "Deploy it to your own
  Cloudflare account" is not sovereignty, and it's a non-starter for exactly
  the people the discussion thread is about.
- Under E2EE the server is a blind relay that stores ciphertext. There's very
  little compute to put at the edge. The cheapness argument mostly evaporates.

**Change:** portable server (one process, Postgres, S3-compatible blobs), runs on
any ordinary VPS. R2 is still fine as the *hosted* blob store — it
speaks S3 — but nothing depends on it. See `02-architecture.md`.

### 2. E2EE was bolted on, so everything had two paths

The `feat/e2ee` branch had to keep cleartext working: `MessageBody` became a
`cleartext | system | encrypted` union, media got a per-user "encrypt
attachments" toggle that "only applies where a live MLS session exists", legacy
accounts needed an in-place migration, the composer branched on "does a session
exist", and history "before the migration stays cleartext (unavoidable)". Every
feature after that point had to be built twice or half-built.

**Change:** there is **no cleartext content path**. The server's event log is
opaque from the first commit. See `02-architecture.md` "no cleartext path".

### 3. One shared key per account made multi-device *weird*

Kith keyed by account, not device, explicitly to escape Matrix's cross-signing
hell (`e2ee-design.md` §4). Reasonable goal, but the consequences leaked:

- A device **can't process its own leaf's Commit**, so when *another* device on
  the same account committed, this one had to "reconcile by re-loading the
  state the committing device persisted (live, with brief retry for persist
  lag)" (`e2ee-implementation.md` "Multi-device"). That's a race with a retry
  loop in the crypto core.
- The account key (DEK) **never persisted to disk** — every reload re-locked
  and demanded the password (`e2ee-implementation.md`: "unlock-on-reload";
  "durable local DEK storage" was never finished). That's the single biggest UX
  cliff in the whole branch.
- No per-device revocation. Losing a phone = rotate the account key everywhere.

**Change:** **per-device keys, with a device certificate signed by the account
key.** The account key is the root of trust and lives in the backup + sealed on
enrolled devices; day-to-day messaging uses the device key, which *can* persist
locally because that's what a device is for. New device = QR from an old one.
Revocation = the account key signs a revocation. No cross-signing UI because
there is exactly one root. See `03-identity-and-crypto.md`.

### 4. Every feature was five layers of plumbing

Adding anything to Kith meant: a Zod schema in `shared`, a DO SQLite migration
(forward-only numbered steps, "never edit an existing block"), a DO method, a
Hono route, a gateway event in `DispatchMap`, a REST client method, a store
reducer branch in `applyDispatch`, and UI. The docs literally have a
seven-step "adding to the contract" checklist.

The consequence is visible in the file sizes: `app/+page.svelte` at 1,611 lines
and `store.svelte.ts` at 1,783 lines, which the `modular` branch then spent
four phases trying to un-nest.

**Change:** the server stores *opaque events* and enforces *policy*
(who may send, who may purge, membership). Message semantics — edits,
reactions, threads, pins, annotations, polls — are **event types interpreted
by the client's room reducer**. A new feature is a new event type plus UI. The
server doesn't change. See `04-data-model-and-protocol.md`.

### 5. Metadata that didn't need to be plaintext was plaintext

`identityId` — *which headmate spoke* — was server-visible
(`e2ee-design.md` §17 #7, "confirm acceptable"). Room names, topics, reactions
(which emoji), read receipts, typing were all plaintext. For a privacy-first
product a plural system's headmate roster is exactly the kind of thing that
should not sit in a database.

**Change:** faces, room names/topics, reactions, receipts, typing, pins — all
inside the ciphertext. The server sees "an event of N bytes from device D in
room R at time T" plus a coarse delivery class. What must stay plaintext is
listed explicitly in `03-identity-and-crypto.md` "what the server sees".

### 6. Webhooks were dead on arrival

Stateless webhook bots can't exist when the server has no plaintext to POST
(`e2ee-design.md` §14). Kith knew this and left "we need an agent SDK" as an
open question.

**Change:** the **agent host** is a first-class deliverable, not a follow-up —
a small key-holding process that speaks the real protocol and exposes plaintext
on `localhost` to bot logic in any language. That's how Ayusami (Python)
plugs in. See `02-architecture.md` "agents".

### 7. Committer availability was never solved

MLS needs a *member* to Commit. Kith left "true external-sender proposals + a
committer/batching policy" as remaining work in every status update.

**Change:** designed up front — server as MLS external sender, a designated
committer with fallback, proposal batching with a time/size window, and a
documented group-size ceiling. See `03-identity-and-crypto.md` "who commits".

### 8. Four branches, never merged

`main`, `feat/e2ee`, `modular`, `audit` each moved ~10k LOC away from each
other. E2EE never met the layout engine. That's not a code problem, it's a
"the v1 architecture couldn't absorb its own roadmap" problem.

**Change:** one trunk. The things that were branches in Kith (encryption,
customisation) are day-one properties of the architecture here, not features.

## What Kith's E2EE work *proved* (so we don't re-spike it)

- `ts-mls` runs a full MLS group in a browser and in Node. Still unaudited in 2026.
- `@serenity-kit/opaque` is the right OPAQUE library. Runs anywhere WASM runs
  — i.e. everywhere except workerd, which we're leaving.
- Era-root encryption with a backward-link anchor chain gives history-on-join
  and multi-device reads; a fresh client with the account key can restore a
  session and read all history including old epochs (`mls-group.test.ts`).
- LiveKit insertable streams + `ExternalE2EEKeyProvider` + exporter-derived keys
  work across Chrome and Safari, with mid-call rekey.
- WebAuthn PRF can wrap the account key (passkey unlock).
- The invite-fragment trick works.

None of that needs re-proving. What *does* need a spike is listed in
`06-roadmap.md` Phase 0.
