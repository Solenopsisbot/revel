# Identity, devices, and encryption

The part that has to be right. Most of it is inherited from Kith's E2EE branch
(`~/coding/websites/kith/kith-e2ee/docs/e2ee-design.md`) with the two changes
from `01-lessons-from-kith.md` §3 (per-device keys) and §5 (less plaintext
metadata) applied. Where this doc and Kith's disagree, this doc wins.

## 1. The key hierarchy

```
                     password ──OPAQUE──▶ exportKey ──HKDF──▶ KEK ─┐
                recovery code ──Argon2id──────────────────▶ RK  ─┤ each wraps
              passkey (WebAuthn PRF) ──────────────────────▶ PK  ─┘    │
                                                                        ▼
                                              ACCOUNT KEY  (Ed25519, long-lived)
                                              = the account's global id
                                                        │ signs
                          ┌─────────────────────────────┼──────────────────────┐
                          ▼                             ▼                      ▼
                   DEVICE CERT (laptop)         DEVICE CERT (phone)     DEVICE CERT (agent host)
                   device sig key + HPKE key    …                       …
                          │                             │
                          ▼                             ▼
                   MLS leaf in every group      MLS leaf in every group
```

- **Account key.** Random Ed25519 keypair. Its public key *is* the account's
  identity — the thing in the transparency log, the thing a safety number is
  computed from, the thing that survives changing handle or IdP. Never derived
  from a password.
- **Device key.** Each device generates its own signing + HPKE keypair. The
  account key signs a **device certificate** `{device_pub, label, created,
  expires?}`. Devices are what actually sit in MLS groups (one leaf per device,
  as RFC 9420 intends). A device key is stored durably on that device (non-
  extractable `CryptoKey` in IndexedDB; OS keychain under Tauri; a file with
  restrictive perms for the agent host). **Reloading the app does not require
  a password.** That was Kith's biggest UX cliff and it's gone by construction.
- **Backup.** The account private key is wrapped three ways (KEK from OPAQUE,
  RK from the recovery code, PK from a passkey) and the wraps are stored at the
  IdP. Password change = re-wrap one blob. This is Kith's envelope scheme,
  unchanged (`e2ee-design.md` §7).
- **Where the account key lives day-to-day.** Sealed on each enrolled device
  under a device-local key, so that an existing device can enrol a new one
  without the password (QR flow, below). It's needed only for: enrolling a
  device, revoking a device, rotating itself, and signing IdP moves. Messaging
  never touches it.

### What this buys over Kith's shared-key model

| | Kith (one key per account) | Here (account key + device keys) |
| --- | --- | --- |
| Reload | re-enter password (DEK never persisted) | device key persists; instant |
| Two devices, one account | both share one MLS leaf; a device can't process its *own* leaf's Commit → reload-state-with-retry race | two leaves; ordinary MLS |
| Lost phone | rotate the account key in every group | account key signs one revocation; server proposes Remove of that leaf everywhere |
| Cross-signing UI | none needed | still none — one root, the account key, verified once |

The cost: Adds are per-device (an account with three devices is three leaves),
KeyPackage supply is per-device, and Welcome fan-out is larger. Acceptable.

## 2. Accounts, handles, identity providers

- `account_id` = the account public key, encoded **base64url, unpadded** — 43
  characters for an Ed25519 key. Globally unique with no registry.

  This doc originally said base32 with a type prefix, and the code has always
  emitted base64url; the divergence was settled in favour of the code
  (`31` §12). base32's real advantage is case-insensitivity — it survives being
  lowercased by a URL, an email client, or a person reading it aloud — and the
  reason that loses is that **an account id is not something people handle.**
  Humans use handles (below); the raw key appears in an invite link you copy
  whole and in a verification screen you compare rather than transcribe. The
  cost of a prefix and nine extra characters is paid on every id, and the
  benefit only appears in cases the design already routes around.
- A **handle** (`viola`) is a human name for that key, registered at an **IdP**.
  Full address is email-shaped: `viola@idp.example`. The hosted IdP is the
  default; the UI shows bare `viola` for accounts on the same IdP as the viewer
  and `viola@other.example` otherwise.
- The IdP publishes signed bindings at
  `/.well-known/uca/handles/<handle>` → `{account_pub, devices:[certs],
  issued, sig}` and appends every change to its **transparency log**. A Host
  resolving a foreign account fetches and caches that, and verifies inclusion.
- **Moving IdP:** the account key signs `{moved_to: new_idp, at}`; the old IdP
  serves it (and its log records it) for as long as it exists. Your key doesn't
  change, so your rooms don't notice. Backup and device list migrate with you.
- **Hosts choose which IdPs to accept.** Config: `accept_idps = ["*"]` or an
  allow-list. The hosted Host accepts `*`. A self-hosted community can be
  "official-IdP accounts only", "our own IdP only", or both — the "login
  authority" model, made concrete.
- **Authentication to a Host** is a device-key challenge-response: the Host
  sends a nonce, the device signs `{nonce, host, device_pub}`, the Host checks
  the device cert against the account's published device list. No passwords at
  Hosts, ever. Session = a short-lived token bound to that device.

## 3. Signing in, enrolment, and recovery — the three cliffs

These three flows are where E2EE products die. They are designed as UX first
(`05-client-and-ux.md` §3) and crypto second. The headline: **a new device
signs in with your password (plus a second factor at the IdP) and nothing
else.** No other device, no recovery code. The crypto:

**Sign up (first device).** Client generates account key + device key, signs
the device cert, runs OPAQUE registration with the IdP, derives KEK, wraps the
account key under KEK and under a freshly generated recovery code, uploads both
wraps + the public key + the device cert. Shows the recovery code once with a
mandatory acknowledgement. Optionally enrols a passkey right there.

**Sign in on a new device (the normal case): handle + password + IdP second
factor.** New device → OPAQUE login with the IdP → if a second factor is
enrolled, the IdP demands it (TOTP code or a WebAuthn tap) before it will
finish the login or release the backup → `exportKey` → KEK → unwrap the
account key locally → generate a device key, sign its device cert with the
account key, upload the cert. The IdP appends the device to the account's
device list + transparency log; every Host the account is in sees the new cert
and emits Add proposals; the next Commit in each group Welcomes the new device.
Every *other* enrolled device gets a "new device signed in — was this you?"
notification with a one-tap revoke.

The second factor is a **policy gate at the IdP, not cryptography**: the wraps
still open only with the password-derived KEK, so a compromised IdP that skips
its own 2FA check gains nothing it didn't already lack. What 2FA buys is
defence against a *known* password — phishing, reuse — which is the realistic
attack. TOTP and WebAuthn both supported; a passkey enrolled for PRF unlock
doubles as a WebAuthn second factor with no extra setup.

**Add a device from one you're holding (the convenient case).** Same result,
nothing typed. New device generates its device key and shows a QR (or a short
link) containing its device pub + a one-time channel id. An *existing* device
scans it, shows the new device's fingerprint for a confirmation tap, unseals
its copy of the account key, signs the new device cert, and sends `{cert,
account_key sealed to the new device's HPKE key}` through the IdP over the
one-time channel. Possession of an enrolled device *is* a second factor, so
this path satisfies the IdP's 2FA policy by construction.

**Forgot password.** The IdP cannot reset it — that is what OPAQUE means; a
server-side reset would hand you a new password and no key. So: recovery code
→ RK → unwrap the account key → choose a new password → re-wrap (O(1)). Or the
passkey path. If every wrap is lost, the account is gone, by design. This is
why sign-up makes the recovery code impossible to skip and offers a passkey as
a second low-friction wrap: "I forgot my password" must not be the end, and
the only way to guarantee that is a second secret the IdP doesn't hold.

**History on a new device** — see §6.

**Revoking a device.** From any device: the account key signs
`{revoke: device_pub, at}` → IdP updates the device list + log → every Host
that sees the new list emits Remove proposals for that leaf in every group →
next Commit locks it out (PCS). Also invalidates its Host sessions immediately.

## 4. Rooms, groups, and audiences

- Every **room** is encrypted under exactly one **MLS group**. A group's
  membership is an **audience**: the set of (account, device) leaves that may
  read.
- A **space** has an implicit "everyone" audience → one MLS group shared by
  every room whose visibility is "everyone in the space". A room whose
  visibility is narrower (role-gated, or an explicit list) gets its **own**
  group, created and maintained automatically. Two rooms with identical
  audiences may share a group later as an optimisation; v1 is one group per
  restricted room.
- **DMs and group DMs** are rooms with no space and an explicit-list audience.
  "A DM is just a group" (discussion). The 1:1 DM id is deterministic from the
  sorted account pair so opening is idempotent (Kith's trick).
- **Threads** are event streams *within* a room, same audience, same group. Not
  their own group.
- The server computes each group's intended audience from the space's roles and
  the room's overrides — it is the policy authority anyway — and drives MLS
  membership to match (next section). Admins never see the word "group"; they
  set "who can see this room".

**Fine-grained permissions are policy, not confidentiality.** If a room is
visible to `@everyone` but only `mods` may send, that's enforced by the server
refusing non-mod sends. Only "who holds the key" is cryptographically
enforced. Kith stated this clearly (`e2ee-design.md` §15); it stays true.

## 5. Membership and who commits

MLS requires a *member* to Commit; the server can't. Kith left this half-done.
Here is the whole policy:

- The Host is configured in every group as an **MLS external sender**. On any
  audience change (join, leave, kick, ban, role change, device enrol/revoke,
  override change) it appends **external Add/Remove proposals** to the group's
  handshake log. It can propose; it cannot Commit or forge a roster — every
  client validates that the tree only ever changes through proposals it saw and
  Commits signed by a member.
- **Designated committer:** the online device of the group that most recently
  sent an event. The Host tracks this trivially. When proposals are pending it
  sends that device a `COMMIT_REQUESTED` nudge over its socket.
- **Batching window:** the committer waits `min(2 s, 100 proposals)` and
  commits them all at once. Mass role changes become one epoch, not five
  hundred.
- **Fallbacks, in order:** if the designated committer doesn't commit within
  10 s, the nudge goes to the next most recently active online device; any
  device that wants to *send* while proposals are pending must commit first
  (so a Remove is effective no later than the next message, which is the
  strongest guarantee that means anything); a device coming online after a
  quiet period commits pending proposals before doing anything else.
- **Welcome delivery:** the Host stores the Welcome for each added leaf and
  serves it on that device's next connect. The ratchet tree is public; the
  Host serves it separately so Welcomes stay small (the `ratchet_tree`
  extension is *not* inlined — see "size ceiling").
- **KeyPackage supply:** every device keeps ≥ 20 one-time KeyPackages at the
  IdP, replenishing on connect; a **last-resort** package is reused when the
  supply is exhausted (weaker forward secrecy for that one Add, logged). The
  Host claims packages only for legitimate adds — the "authorised claim" fix
  from Kith's audit — so nobody can drain your supply.
- **Epoch hygiene:** the committer also issues a plain Update (fresh epoch, no
  membership change) if the epoch is older than 24 h, bounding the era-root
  forward-secrecy window (§6).

## 6. Era encryption and history

This is Kith's `history.ts` scheme, kept because it solves three problems at
once (multi-device, history-on-join, bounded FS), and because it's proven.

- Content is **not** sent as MLS application messages. Each epoch derives an
  **era root** `R_e = MLS-Exporter("uca/era-root", epoch)`. Message keys derive
  from `R_e` by HKDF; every event is sealed with XChaCha20-Poly1305 under that
  key with a random nonce. Any current member of the epoch can open any event
  from that epoch. No sender ratchet, so any number of devices can send and
  read concurrently.
- **History anchor.** Each group also has a long-lived **anchor** secret. On
  every epoch change the committer publishes a backward link
  `link_e = AEAD(KDF(anchor, e), R_{e-1})`. Holding the anchor and any era root
  lets you unwind to every earlier root — *never* forward. Handing a joiner the
  anchor in their Welcome grants history; withholding it grants forward-only.
  Room setting: **"New members can read past messages: yes / no"**. Retroactive
  revocation is impossible and we say so.
- **New device of an existing account.** Its own leaf arrives via Welcome, so
  it has the current era root. Each group's **anchor** is additionally stored
  at the Host per `(account, group)`, sealed under the account key — opaque to
  the Host — and the new device (which holds the account key from sign-in,
  whichever path it used) fetches and unseals it. Anchor + current root = the
  full backlog, with no server help beyond serving ciphertext. No "your old
  messages are on your old phone".
- **Re-requestable history:** a device can fetch ciphertext for a room it left
  or predates; it opens exactly what its keys allow — up to its removal epoch,
  nothing after. Past readable, future cut.
- **Forward secrecy is per-epoch, not per-message.** Within one epoch all events
  share a root. Epochs rotate on every membership change and at least daily
  (§5), so the window is bounded. The anchor is the group's crown jewel — a
  compromised account key exposes that account's rooms' backlogs. Written in
  the threat model, shown in the product copy, not buried.

## 7. What the server sees

Plaintext, by necessity, with the reason:

| Field | Why it's plaintext |
| --- | --- |
| room id, space id, membership (accounts + devices) | it's the delivery service; it must know whom to deliver to and whom to key |
| event id, sender device, timestamp, byte size, epoch | ordering, dedup, keying |
| `class` ∈ {ephemeral, silent, normal} | so typing doesn't wake phones and reactions don't push |
| optional `stream` (thread id) | so a thread can be paged without fetching the whole room — **opt-in leak**, rooms can disable threading-by-stream and page client-side instead |
| optional `notify` list of accounts | **only if the room enables "wake me only on mentions"** — trades "who was mentioned" for battery on busy rooms; default off |
| blob ids + sizes | it stores them |
| space listing (name/description/icon) | **only if the space publishes one**; unlisted spaces have encrypted names |
| roles, permission bitfields, overrides | policy the server enforces |
| public profile at the IdP (handle, display name, avatar) | it's a directory |

Encrypted, that Kith had in plaintext: room names/topics, **faces** (the
headmate roster is a per-room encrypted state event, so the server never learns
a system's members), reactions (which emoji), read receipts, typing, pins,
edits/deletes (the *purge* is a plaintext privileged request by event id; the
*redaction* semantics are in-band), attachments' names and types.

## 8. Agents

Unchanged from Kith §14 in principle, concrete in practice: an agent is an
account with device certs like anyone else; its "device" is an **agent host**
process. It is a leaf in every group it's in and it shows up in the roster with
a badge. Anything that reads a room to add value — translation, transcription,
captioning, summaries, an Ayusami persona — is one of these. There is no other
kind of bot. A hosted "we hold the bot's keys for you" runtime is **not**
offered; it would be the server holding keys, and we'd rather the story stay
true than convenient.

## 9. Moderation under E2EE

- Mods are members; they read what members read.
- **Purge:** `MANAGE_EVENTS` lets a member ask the Host to delete the bytes of
  event ids; the mod's client also sends an in-band redaction so other clients
  drop their local copies.
- **Kick / ban:** policy → Remove proposal → next Commit. Bans persist across
  rejoin (Kith's `bans` table).
- **Reporting:** **message franking** — each event carries a commitment; a
  reporter can open one specific event to the Host (or to a designated abuse
  key) with proof it's genuine, without exposing anything else. Designed in from
  the envelope; UI in Phase 3.
- **Automod:** a mod-owned agent, visible in the roster. **No server-side
  scanning of any kind** — there's nothing to scan. This is stated in the
  public docs in those words.
- **Invite abuse:** invite links are bearer fragments with expiry and use
  counts (Kith's "Wormhole trick"), so a leaked link has a bounded blast radius.

## 10. Threat model — the honest version

**Protected against:** the operator reading content; a database/blob-store
breach; a subpoena for content (there is none to hand over); a malicious IdP
forging a key for your handle without detection (transparency log + safety
numbers); a removed member reading anything after removal; a lost device once
revoked.

**Not protected against, and we say so in the product:**
- **Anyone who can read a message can keep it.** Screenshots, copy-paste, a
  bot member with a database. Disappearing messages are a courtesy, not a
  guarantee.
- **Metadata** (§7): who talks to whom, when, how much, in which room.
- **A compromised device** reads everything that device can read until
  revoked, including backlog (the anchor).
- **The web client.** JS served by us could be backdoored on any load. The
  desktop build (signed, reproducible) is the mitigation; SRI and code
  transparency are the roadmap. Until then the public claim is "the server's
  *data* can't read your messages", not "trust no one".
- **Unaudited MLS library** until the audit happens. GA blocker, same as Kith.
- **Forward secrecy is per-epoch** (§6).
- **Losing every wrap of your account key loses your account.** No exceptions,
  no support ticket that fixes it.

## 11. Size ceiling

TreeKEM makes Adds/Removes O(log n) for the committer, but each Welcome needs
the tree, and a 10k-leaf tree is tens of megabytes. Serving the tree separately
and caching it helps; it doesn't make 100k-member public rooms sensible. **v1
documents ~2,000 leaves per group** (roughly 800 accounts at 2.5 devices each)
and refuses adds beyond it with a clear message. Larger "public" rooms are a
later design — probably sender-keys-style with a room key rotated on kick —
and the honest product framing for those is "public means public".

## 12. Library decisions — **settled, and measured**

Superseded the original plan in two ways: the core is **Rust**, not TypeScript
(`26-platform-and-stack.md`), and the post-quantum question has been benchmarked
rather than guessed (`31-phase0-results.md`).

| | Shipping | Was planned |
| --- | --- | --- |
| **MLS** | **`mls-rs` 0.56** (AWS), in Rust | `ts-mls`, with mls-rs as a "swap candidate" |
| **Crypto provider** | `mls-rs-crypto-rustcrypto` — pure Rust, and the only one that targets wasm32 | — |
| **OPAQUE** | `opaque-ke` directly in Rust | `@serenity-kit/opaque`, which wraps that same crate |
| **Primitives** | `ed25519-dalek`, RustCrypto | `@noble/*` |
| **Ciphersuite** | `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` | same |

`mls-rs 0.56` and `mls-rs-crypto-rustcrypto 0.22.1` must both resolve to
`mls-rs-core 0.27` — older pairings pull two different core versions and the
provider then fails to satisfy mls-rs's own `CryptoProvider` bound.

### Post-quantum: worth it, and currently blocked on the web

Benchmarked against **ML-KEM-768 + X25519** (the X-Wing-style hybrid, chosen
because it holds if *either* primitive holds, so it isn't a bet on lattices):

| | classical | PQ hybrid |
| --- | ---: | ---: |
| encrypt a message | 15 µs | 15 µs — **free** |
| one add @ 500 members | 2.5 ms | 4.3 ms |
| Welcome, single join | 0.4 KiB | 1.4 KiB |
| ratchet tree @ 2000 (cacheable) | 626 KiB | 2.9 MB |

The cost is affordable — messaging is identical, and a join costs about 1 KiB
more plus a larger tree that is public and cacheable. **The blocker is not
performance, it is availability:** the only mls-rs PQ provider wraps AWS-LC, a C
library that cannot build for `wasm32`, and the web client is the v1 product.

Mixing is worse than not shipping it: a ciphersuite is fixed per group, so "PQ
on native, classical on web" would make a room's cryptographic strength depend,
invisibly, on which apps its members happen to use.

**Decision: ship classical now.** The migration path already exists — a
ciphersuite change means new groups rather than an upgrade (`29` §1), the same
mechanism any crypto change would use.

**The route back:** pure-Rust `x-wing` and `ml-kem` crates exist and **do build
for wasm32** (verified). What is missing is an adapter implementing mls-rs's
`KemType` over one of them; `mls-rs-crypto-hpke`'s `CombinedKem` is generic over
its KEMs, so this is a trait impl and a provider, not new cryptography. It still
lands in audit scope, because a wrong adapter is as bad as wrong primitives.
Tracked as a near-term spike — getting PQ before launch is much cheaper than
migrating groups afterwards.
