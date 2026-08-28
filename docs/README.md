# Untitled Chat App — the plan

A privacy-first chat app: Discord-shaped, end-to-end encrypted with no
cleartext path, self-hostable, with plural systems and AI friends as
first-class members. The successor to Kith (`~/coding/websites/kith/`).

Planning started 2026-08-27 from a group brainstorm about what a decentralised
Discord replacement would actually have to solve. Nothing
is built yet. These docs are the plan; when code exists they become the
internal docs and get updated in the same change as the code (Kith's rule).

## Read in this order

| Doc | What it is |
| --- | --- |
| [`naming-and-vision.md`](naming-and-vision.md) | Name candidates and the one-page "what this is". Product voice. |
| [`01-lessons-from-kith.md`](01-lessons-from-kith.md) | The autopsy: what Kith got right (kept) and what hurt (changed), with file references. |
| [`02-architecture.md`](02-architecture.md) | Principles, the pieces (IdP / Host / core / agent host), the stack, one request trace, the scaling shape. |
| [`03-identity-and-crypto.md`](03-identity-and-crypto.md) | Key hierarchy, devices, enrolment/recovery, rooms→groups, who commits, era encryption + history, what the server sees, the honest threat model. |
| [`04-data-model-and-protocol.md`](04-data-model-and-protocol.md) | Tables, the event envelope, the room reducer, permissions, the wire protocol. |
| [`05-client-and-ux.md`](05-client-and-ux.md) | What "good UX" means here, IA, the three cliff flows as screens, client architecture, platforms/notifications honestly, the QoL list mapped. |
| [`06-roadmap.md`](06-roadmap.md) | Phases with exit tests, machines, what needs other people, what's left out. |
| [`07-design-language.md`](07-design-language.md) | The visual system: moments-vs-workspace, colour, type, shape, motion, and the no-emoji rule. |
| [`08-voice-and-copy.md`](08-voice-and-copy.md) | Voice rules and final copy for every screen that needs it — the three cliffs, empty states, error banners, honest toggle descriptions. |
| [`09-mascot.md`](09-mascot.md) | Wren, the guide: who she is, and why she's the client personified rather than a bot in your rooms. Includes an artist brief. |
| [`10-translation.md`](10-translation.md) | Built-in translation: the on-device capability ladder, local vs shared, the controls, and why cloud translation is never an option. |
| [`11-people-and-agents.md`](11-people-and-agents.md) | How the product shows who you're talking to: plurality invisible until used, the profile card, and the agent badge system. |
| [`12-wren-as-guide.md`](12-wren-as-guide.md) | Wren as an active guide: the escalation ladder, the interruption budget, what she may reason about, the heuristics table, and her command surface. |
| [`13-wren-notices.md`](13-wren-notices.md) | Her actual notice copy, including the three interrupting popups and a list of things she must never say. |
| [`14-name-and-domains.md`](14-name-and-domains.md) | The three-round name audit and domain availability that landed on Revel. |
| [`15-mark.md`](15-mark.md) | Seven mark concepts with failure modes; the adopted Tilted Triad and its geometry. |
| [`16-terminology.md`](16-terminology.md) | **The nouns, settled** — Host / space / room / face / agent, and why a community is not a "server". |
| [`17-identity-ux.md`](17-identity-ux.md) | Identity providers, addresses, moving provider, provider outages, the devices screen, and multiple accounts vs faces. |
| [`18-spaces-ux.md`](18-spaces-ux.md) | One host many spaces; creating, joining, discovery, space settings, audiences without saying MLS, moderation, and the host admin surface. |
| [`19-app-shell-ux.md`](19-app-shell-ux.md) | Settings IA, storage & export, search, the web app (install, deep links, offline, tabs), keyboard, onboarding, accessibility. |
| [`21-voice-ux.md`](21-voice-ux.md) | Voice rooms vs calls, the in-call stage, the diverged-audio failure, recording honesty, captions, connection quality. |
| [`22-crypto-ux.md`](22-crypto-ux.md) | The four conversation states, why there's no lock icon, verification, key changes, resetting a diverged chat, attachments, the backup screen. |
| [`23-agents-ux.md`](23-agents-ux.md) | The agent lifecycle: creating one, the agent host and pairing, the localhost API, adding to a room, offline behaviour, and why there's no hosted runtime. |
| [`20-wren-art.md`](20-wren-art.md) | The reproducible generation recipe for Wren's art, what worked, and the transparent-background gap. |
| [`25-live-voice-translation.md`](25-live-voice-translation.md) | Whether live voice translation is doable, the latency budget, ASR-at-source, and why captions beat dubbing. |
| [`26-platform-and-stack.md`](26-platform-and-stack.md) | **Supersedes `02`'s stack table.** Native mobile in scope; Rust crypto core + TypeScript app core, and why that seam. |
| [`32-motion.md`](32-motion.md) | The motion vocabulary: what moves, how fast, what must never move, and why an optimistic message must not animate as if it succeeded. |
| [`31-phase0-results.md`](31-phase0-results.md) | **Measured results from running code**: per-device leaves proven, the group-size ceiling is bandwidth not CPU, and post-quantum is free where it matters. |
| [`30-design-review.md`](30-design-review.md) | An outside critique of the built reference page, plus what was changed in response — including the measurements that showed the grounds were too dark. |
| [`29-engineering-plan.md`](29-engineering-plan.md) | Protocol versioning under un-re-encryptable history, the licence split, telemetry that doesn't surveil, the multi-client test harness, performance budgets, self-host first run. |
| [`28-integrations.md`](28-integrations.md) | Delegated capability, device-to-device compute, custom event types, the integration catalogue, and why bridges have to be loud. |
| [`27-open-questions.md`](27-open-questions.md) | What could kill this: abuse/regulatory policy, who pays, the audit — plus Discord migration, spam, i18n, retention. |
| [`24-mobile-ux.md`](24-mobile-ux.md) | One column and two drawers, the back-button state machine, touch specifics, the honest push table, calls, flaky connections, storage. |

## The running artifacts

| Path | What |
| --- | --- |
| [`../design/index.html`](../design/index.html) | **The design reference — open this in a browser.** Live tokens, type scale, components, both message styles, the full workspace shell, the four failure banners, and a moment screen. Three themes, density, personality and motion switch live; deep-linkable (`?theme=daylight`). No build step. |
| [`../design/tokens.css`](../design/tokens.css) | The tokens themselves. Ports verbatim into `packages/ui`. |

## The five decisions this plan is built on

These are recommendations with reasoning, not settled facts. If you disagree
with one, the docs that depend on it are listed so you know what changes.

1. **Leave Cloudflare. Portable server: Bun + Postgres + S3-compatible blobs,
   one binary.** Because self-hosting is the sovereignty story, workerd fought
   the crypto (the OPAQUE Container), and an E2EE server is a blind relay that
   gains little from the edge. Cost: DO-hibernation cheapness. → `01` §1, `02`.
2. **No cleartext content path, ever.** Every room is an MLS group; the
   server's event log is opaque; features are client-side event types. Kith
   showed what "E2EE as a branch" costs. Cost: no server-side search, previews,
   automod, or stateless bots — each has a member-does-it answer. → `02`
   principles 1–3, `04` §2.
3. **Account key + per-device keys** (device certs signed by the account key),
   not Kith's one-shared-key. Fixes reload-needs-password, own-commit races,
   and per-device revocation, without cross-signing UI. Cost: more leaves per
   account. → `01` §3, `03` §1.
4. **Identity providers, not federation.** Your key is you; the handle and
   backup live at an IdP you can leave; Hosts choose which IdPs to accept;
   rooms live on exactly one Host. → `02`
   principle 4, `03` §2.
5. **Headless core, thin UI, design system first.** `packages/core` runs in
   browser, Tauri, and the agent host; the UI is built against fake data in
   Phase 0 before there's a backend. This is the "UX from the start" bet. →
   `05` §4, `06` Phase 0.

## Decided 2026-08-27

Viola ratified the five decisions above, plus:

- **Bun** for the server (single-binary self-host; reversible).
- **Post-quantum: worth it, but blocked on the web.** Benchmarked: messaging is
  free (15 µs either way), a join costs ~1 KiB extra. But the only PQ provider is
  AWS-LC, a C library that **cannot build for wasm32**, and a ciphersuite is
  per-group — so mixing would make a room's strength depend invisibly on which
  clients its members use. **Ship classical; revisit when a pure-Rust hybrid
  exists.** → [`31-phase0-results.md`](31-phase0-results.md) §3a.
- **Addresses are email-shaped:** `viola@idp.example`.
- **Threads are server-visible streams by default**, with a per-room switch,
  documented as a metadata leak. (Sadie's call; Viola abstained.)
- **A new device signs in with password + IdP second factor, nothing else.**
  The QR-from-another-device flow is the convenience path, not the requirement.
  The recovery code remains the *forgot-password* fallback because the IdP
  cannot reset an OPAQUE password. → `03` §3, `05` §3.
- **Mobile is going to be hell.** Acknowledged; see `05` §5.
  **Superseded 2026-08-27:** native iOS/Android moved into scope, which changes
  the stack — **Rust crypto core** (WASM for web, UniFFI for native) with the app
  core and UI staying TypeScript. Mobile UI goes Tauri 2 first, native later
  where it earns it. → [`26-platform-and-stack.md`](26-platform-and-stack.md).
- **Monetisation: the TeamSpeak model, adapted** (Noelle's suggestion). You buy **capacity** —
  member ceiling, storage, custom domain — never a space (spaces stay instant and
  free) and never a security feature. Every paid axis maps to a real resource
  cost. **Build for it, don't operate it yet:** hosted instance stays invite-only
  with no billing, but quotas and ceilings ship as real, enforced, configurable
  numbers so turning pricing on later is a config change, not a re-architecture.
  → [`27-open-questions.md`](27-open-questions.md).

**The name is Revel** (`revel.chat`), decided 2026-08-27 — see
[`14-name-and-domains.md`](14-name-and-domains.md) for the audit and the
runners-up. The domain is not yet registered.

**Character art exists.** Wren was generated locally and is wired into the
reference page — see [`20-wren-art.md`](20-wren-art.md). Remaining gap there is a
transparent-background cutout, which Viola is doing in nano banana.

## Not in this plan

- Discord API compatibility. Can't exist under E2EE; migrating people matters
  more than migrating bots.
- Message federation. Never.
- A hosted key-holding bot runtime. It'd be the server holding keys.
- Rooms above ~2,000 leaves. Later, different design, "public means public".
