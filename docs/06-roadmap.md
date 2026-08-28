# Roadmap

Phases ship independently and each has an exit test you can actually run.
Sizes are honest guesses for one person plus AI pairing on a laptop. Where a
phase needs *other people* it says so — the discussion thread's "you need a
full team" point is right for launch and wrong for getting to a thing friends
use daily, and this roadmap is aimed at the second.

## Phase 0 — Spikes and the design system (2–3 weeks)

Two tracks in parallel: prove the unproven crypto decisions, and build the UI
against fake data before any backend exists.

**Crypto spikes** (throwaway code, findings recorded in `03-…`):
1. **Per-device leaves + account-signed device certs** on `ts-mls`: two
   devices of one account in one group, a third device enrolled by unwrapping
   the account key from a mocked backup (the password path) and a fourth via
   a mocked QR flow, one device revoked → Remove → the revoked device can't
   open the next era. This is the one thing Kith never did; it gates Phase 1.
2. **Engine benchmark:** `ts-mls` vs `mls-rs`-compiled-to-WASM, in Chrome,
   Safari, and Bun — Add/Commit/Welcome latency and Welcome size at 2, 50,
   500, 2,000 leaves; with and without inlined ratchet tree; X25519 vs X-Wing.
   Output: the shipping engine, the PQ decision, the real size ceiling.
3. **External-sender proposals + the committer policy** end-to-end with three
   simulated clients and a Bun "host": batching, fallback, commit-before-send.
4. **Local store perf:** Dexie vs SQLite-WASM in the browser for a 200k-event
   room; cold open to first paint.

**Design system track:** `packages/ui` + the app shell in SvelteKit with fixture
data: rail/sidebar/room/members layout with the column-order seam, the
virtualised message list, the composer with face switcher + expressions, the
three-cliff screens, light/dark, cozy/compact, reduce-motion, mobile drawers,
⌘K. Run it on a phone via Vite over LAN. **Exit:** you'd be embarrassed to
show none of it.

**Also:** pick the name (`naming-and-vision.md`), register the domain, create
the repo, port Kith's `packages/shared` (snowflake, plurality, permissions,
markdown node-tree) into `packages/protocol`.

## Phase 1 — Identity, devices, recovery (3–4 weeks)

The IdP role of the server + the client core's `session/` and `crypto/`
identity parts.

- OPAQUE register/login; account key; three wraps (password, recovery code,
  passkey PRF); second factors (TOTP + WebAuthn) gating login + backup release;
  device certs; device list; "new device signed in" notifications; transparency
  log (hash chain + signed heads — the Merkle proofs can wait, the *append-only
  + signed* part can't).
- Device auth challenge-response; short-lived host sessions.
- The three cliff flows as real screens (they exist as mocks from Phase 0).
- **Exit:** sign up on the laptop; sign a phone in with password + TOTP alone;
  enrol a tablet by QR without typing anything; wipe the laptop; "forget" the
  password and recover with the recovery code; revoke the phone from the
  laptop; confirm the phone is signed out and its device cert is in the log as
  revoked.

## Phase 2 — DMs and the real client (5–6 weeks)

The Host role for rooms without spaces, plus the whole messaging core. This is
the phase after which the app is *used*.

- Rooms (DM + group DM), MLS groups with per-device leaves, external-sender
  proposals, committer policy, Welcomes, KeyPackage supply, era encryption,
  anchors + history mode, diverged-session reset.
- Opaque event log, the single multiplexed socket with resume cursors, the
  room reducer with the v1 event set (`m.message`, `m.edit`, `m.redact`,
  `m.reaction`, `m.receipt`, `m.typing`, `m.pin`, `room.name`, `room.faces`,
  `room.history`).
- Local-first store, optimistic sends, scrollback, local search.
- Encrypted blobs with client-side thumbnails; expressions; proxy tags.
- Web Push, content-free, with reconcile-on-open; the notification rules screen.
- **Exit:** you and one other person, plus at least one headmate switch,
  use it as your daily DM app for a week and don't go back. Two devices each.
  Unplug the network mid-conversation; nothing is lost or duplicated.

## Phase 3 — Spaces (4–5 weeks)

- Spaces, rooms with categories, roles/overrides (Kith's model ported),
  audiences → groups auto-managed, invites with fragment keys + use counts +
  expiry, bans, kicks, purge, threads (streams), annotations, custom emotes,
  optional public listing.
- Moderation: franking + a report flow; the "no server-side scanning" public doc.
- Group-size ceiling enforced with a clear message.
- **Exit:** migrate one real friend-group Discord server's people (not its
  history) onto a space; a mod kicks someone and that person can prove to
  themselves they can't read the next message.

## Phase 4 — Agents (2–3 weeks)

- `apps/agent-host`: the core as a daemon, device enrolment for a bot account
  (same QR flow, initiated from the owner's client), a `localhost` API
  (WS stream of decrypted events + REST send/annotate/react), a TS client and
  a thin Python client (`packages/sdk-py`).
- Roster badge + "can read this room" line; `MANAGE_AGENTS`.
- **Exit:** an Ayusami persona (Kiko, say) lives in a space as a member, via
  `responder.generate_reply` and nothing else, and a translator agent posts
  German annotations that toggle per room.

## Phase 5 — Voice (3–4 weeks)

- LiveKit on the hosted box; token minting; voice rooms + DM calls; insertable
  streams keyed from the exporter with rekey on epoch change (Kith's code, ported);
  the incoming-call flow; voice states as plaintext presence.
- On-device captions on desktop via `transformers.js`/WebGPU as an experiment;
  captioner-agent path as the fallback.
- **Exit:** a three-person call between Chrome, Safari, and the desktop app,
  with one member kicked mid-call and unable to hear the rest.

## Phase 6 — Self-hosting and identity portability (3 weeks)

- `bun build --compile` single binary + a Docker image + a Compose file with
  Postgres and (optional) LiveKit and MinIO; config for IdP/Host roles and
  `accept_idps`; migrations on boot; backups doc.
- Foreign-IdP account resolution and caching on a Host; IdP move flow.
- A `docs/self-hosting.md` a stranger can follow.
- **Exit:** a second person runs a Host on their own box that accepts accounts
  from the hosted IdP; you join it with your existing identity; then they
  switch it to their own IdP and you make a second account there and DM across.

## Phase 7 — Trustworthy client, desktop, and the audit (ongoing)

- Tauri 2 desktop: OS keychain keys, native notifications, code signing,
  reproducible builds, SRI on the web build. This is what lets the public copy
  say "trust no one" about the desktop app.
- **Crypto audit** of `packages/crypto` + the shipping MLS engine. *Needs
  money and other people.* GA blocker, same as Kith. Budget it from the moment
  Phase 2 ships.
- Merkle/STH key transparency with client monitors.
- Mobile: evaluate Tauri 2 iOS/Android against a native rewrite of the shell
  over the same core. *Needs other people* for a good result.

## Continuous

- **Document what you build** — same rule as Kith's `AGENTS.md`, from the
  first commit. `docs/` is internal; public docs (self-hosting, agent API,
  threat model in plain language) are a route in the web app.
- Threat model doc is updated whenever a plaintext field is added. Adding a
  plaintext field is a reviewed decision, not a convenience.
- Bench the group-size ceiling every time the engine changes.

## What it needs to run

Requirements, not an inventory — these are the numbers a self-hoster needs and
the ones the hosted instance is sized against.

| | Needs |
| --- | --- |
| **Host + IdP + Postgres** | 2 vCPU / 4 GB is comfortable for a few hundred concurrent devices. The server is a blind relay: it does no crypto per message and no content processing, so it is I/O-bound long before it is CPU-bound. |
| **LiveKit SFU** | Roughly 1 vCPU per ~25 concurrent audio participants; more for video. Bandwidth is the real constraint. Runs on the same box at small scale, separate once calls are routine. |
| **Blob storage** | Any S3-compatible store. Egress dominates the bill, which is why zero-egress providers matter. |
| **Client-side ML** (captions, transcription, translation) | Only where the user opts in, and only on hardware that can sustain it — see the capability ladder in [`25-live-voice-translation.md`](25-live-voice-translation.md). Never on the server. |
| **GPUs** | None, anywhere. Nothing in this system trains or serves a model server-side. |

Development needs nothing special: a laptop that can run Postgres and compile
Rust. The one exception is testing on-device ML, which needs whatever hardware
you want to claim support for.

## What this roadmap deliberately leaves out

- Discord API compatibility (Kith had a compat layer; under E2EE it can't
  exist, and migrating *people* matters more than migrating bots).
- Message federation between Hosts. Never.
- Large public rooms above the ceiling (a later, different design).
- A marketing plan. The discussion is right that launch needs one; getting to
  "friends use it daily" doesn't.
