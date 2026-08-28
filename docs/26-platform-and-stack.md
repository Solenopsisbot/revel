# Platform and stack — revised for native mobile

`02-architecture.md` said **TypeScript everywhere**, with mobile as a Phase 7
"evaluate Tauri vs native". Putting real native apps in scope changes that
calculus, and it's much cheaper to change now than after twenty thousand lines
of core exist. This doc supersedes `02`'s stack table.

## What native actually buys

Not a nicer wrapper — four things the web genuinely cannot have:

| | Web/PWA | Native |
| --- | --- | --- |
| Push | broken on iOS (home-screen only, **dead in the EU**), unreliable after restarts | APNs/FCM, works |
| Background sync | none on iOS | yes |
| Key storage | non-extractable `CryptoKey` in IndexedDB — decent, but evictable | Secure Enclave / Keystore, biometric-gated |
| Trust story | we ship JS on every load; backdoorable | signed, reviewed, reproducible binary |

The last row matters most for *this* product. `03` §10 says our honest public
claim is currently "E2EE against the server's data, not its code", because a
web client can be silently backdoored on any load. **A signed native binary is
what upgrades that claim.** It's not a nice-to-have; it's the thing that lets us
describe the product accurately.

The push row matters most for *users*. A messenger that misses notifications is
not a messenger, and that's the current iOS PWA reality.

## The real fork

Not "which framework" — **where does the core live?** The core is MLS sessions,
era encryption, device keys, the sync engine, the room reducer, the local store
and search. It is the expensive, correctness-critical, security-critical part.
Writing it three times is not an option, so the only question is what language
it's in and how each platform reaches it.

### Option A — TypeScript core everywhere

Web natively; desktop and mobile via Tauri's WebView, or React Native running
the core on Hermes.

- **For:** one language, fastest to build, matches your ecosystem. `ts-mls` is
  pure TS riding `@noble`, so no WASM needed for MLS.
- **Against:** **OPAQUE is WASM** (`@serenity-kit/opaque`) and **Hermes has no
  WASM**, so React Native needs a native module for auth regardless. Crypto in
  JS on a mid-range phone is slow — MLS commits in a large group are the sharp
  edge. And every MLS library in TypeScript is unaudited.

### Option B — Rust core everywhere

`mls-rs` (AWS, RFC 9420, the most production-exercised implementation),
`opaque-ke` for OPAQUE, sync + store + reducer in Rust. `wasm-bindgen` for web,
**UniFFI** for Swift and Kotlin.

- **For:** one implementation at native speed on every platform. This is what
  `matrix-rust-sdk` and Signal do, and they did it after learning the hard way.
- **Against:** Rust is slower to write, it isn't your ecosystem, and porting the
  reducer/sync/search logic to Rust buys much less than porting the crypto does.

### Option C — Rust crypto, TypeScript everything else ← **recommended**

Split at the line where the arguments actually differ:

```
  Rust  ──▶ MLS, OPAQUE, era encryption, device keys, envelope/backup
            │
            ├── wasm-bindgen ──▶ web + desktop
            └── UniFFI ────────▶ Swift / Kotlin

  TS    ──▶ sync engine, room reducer, local store, search, notification
            rules, and all UI
```

**Why this is the right seam:**

1. **The audit surface becomes one Rust crate**, shared by every platform. `03`
   §12 already names a professional crypto audit as a GA blocker; auditing one
   crate that all clients use is dramatically cheaper and more meaningful than
   auditing a TS implementation and then shipping a different one on mobile.
2. **It's already the planned shape.** `packages/crypto/src/engine.ts` is
   defined as an interface precisely so the MLS implementation can be swapped —
   `03` §12 names `mls-rs`-to-WASM as the swap candidate. This makes that the
   plan of record instead of a maybe.
3. **`opaque-ke` is the Rust crate `@serenity-kit/opaque` wraps.** Going native
   means using the real thing rather than its WASM wrapper — and it removes the
   Cloudflare-Container-shaped problem entirely.
4. **The expensive-to-port part stays in TS.** The reducer and sync engine are
   large, change often, and gain little from Rust.

**Cost, honestly:** two languages and an FFI boundary to keep in sync. That's a
real tax. It's smaller than the tax of a JS crypto core you can't afford to
audit and can't run fast on a phone.

## Mobile UI — staged, not decided forever

With the core shared, the UI is a genuinely separate decision:

**Stage 1 — Tauri 2 mobile.** Reuse the SvelteKit UI, get real push, keychain
and background sync via plugins, ship to both stores from the codebase that
already exists. The known risk is WebView scroll performance in a long message
list on mid-range Android — mitigated by the virtualised list we're building
anyway (`05` §4).

**Stage 2 — native UI where it earns it.** SwiftUI and Compose over the same
UniFFI core, starting with whichever platform hurts most. Because the core is
shared, this is a UI rewrite, not an app rewrite — which is the whole point of
drawing the seam here.

Do **not** add React Native: it's a third UI codebase (RN components aren't
Svelte components) *and* it still needs native modules for WASM-free auth. It
gets the costs of both options.

## The consolidated stack

| Layer | Choice |
| --- | --- |
| **Crypto core** | **Rust** — `mls-rs`, `opaque-ke`, `RustCrypto`/`dalek`. Built as `wasm-bindgen` for web and **UniFFI** for Swift/Kotlin. |
| **App core** | **TypeScript** — sync, reducer, store interface, search, notification rules. Runs in browser, Tauri and native via the JS runtime. |
| **Web UI** | SvelteKit 5 + Tailwind v4, own design system (`packages/ui`) |
| **Desktop** | Tauri 2 |
| **Mobile** | Tauri 2 → native SwiftUI / Compose over UniFFI as it earns it |
| **Server** | Bun + Hono, single-binary self-host artifact |
| **Database** | Postgres |
| **Blobs** | S3-compatible (R2 hosted, MinIO/disk self-hosted) |
| **Voice** | LiveKit + insertable streams |
| **Local store** | SQLite (native/Tauri) · IndexedDB via Dexie (web), behind one interface |
| **Monorepo** | pnpm + Cargo workspace side by side |

## What to do now to keep this cheap

Phase 0 (`06`) changes in two ways:

1. **The engine spike becomes a Rust spike.** Build the crypto core in Rust from
   the start and expose it through WASM — the interface is the same, the
   implementation isn't throwaway, and the "swap ts-mls later" step disappears.
   Benchmark `mls-rs` in WASM against `ts-mls` as planned; the difference now
   also tells you the native-vs-web performance gap.
2. **Add a UniFFI smoke test** — one Swift call and one Kotlin call into the
   core, proving the binding works, before any mobile UI exists. Cheap now,
   miserable to discover later.

Everything else in the roadmap stands.
