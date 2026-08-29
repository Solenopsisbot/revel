# Phase 0 results — measured, not assumed

Everything here came out of running code in `crates/revel-crypto`. Measured on a
2025-class laptop CPU with `mls-rs 0.56.0`, release build — the hardware is worth
stating only so the absolute numbers can be interpreted; the ratios are what
matter. Reproduce with:

```
cargo test -p revel-crypto
cargo run --release -p revel-crypto --example bench
cargo run --release -p revel-crypto --features pq --example bench_pq
```

---

## 1. The gating question: per-device leaves — **answered, yes**

`06-roadmap.md` called this "the one thing Kith never did; it gates Phase 1".
Nine tests now hold it down:

- **Several devices of one account are independent leaves.** Two of Viola's
  devices plus Ash sit as three leaves in one group and all exchange messages.
  Kith's shared-key model is what forced its reload-with-retry hack; that whole
  class of bug is gone by construction.
- **Device certificates bind a leaf to an account.** The account key signs the
  device's MLS signature key, domain-separated. Tested against: another account
  claiming your device, device-key substitution, **label tampering** (the label
  shows in the devices screen, so a device that could rename itself "laptop"
  after the fact would be a live spoofing surface), and malformed input.
- **Revocation is real.** Remove the leaf, commit, and the revoked device cannot
  read the next epoch while remaining members can. Had this failed, "sign out
  this device" would have been a lie.
- **Forged certificates are refused by the protocol**, not by the caller
  (`identity.rs`). One forgetful call site can no longer admit an
  unauthenticated device.

### The bug worth remembering

`IdentityProvider::identity()` first returned the **account** key, on the
reasoning that an account's devices "are" one member. MLS uses that value to
detect duplicates, so both of Viola's devices looked like the same member and
the second Add failed with `DuplicateLeafData`.

**Identity is per device; the same-person relation lives in `valid_successor`.**
So a device can rotate its signature key and stay itself, and cannot silently
become somebody else. Exactly backwards from the first attempt, and the kind of
thing only a running test catches.

---

## 2. Group scaling — and a measurement mistake worth recording

First pass, with mls-rs defaults:

| leaves | build (batched) | 1 add | welcome | 1 remove | encrypt |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 1 ms | 9.7 ms | 1.0 KiB | 0.7 ms | 66 µs |
| 50 | 9 ms | 0.9 ms | 21.0 KiB | 1.7 ms | 48 µs |
| 500 | 81 ms | 4.8 ms | 209.0 KiB | 13.7 ms | 49 µs |
| 2000 | 774 ms | 18.5 ms | 836.9 KiB | 39.8 ms | 51 µs |

**Sending is flat** — ~50 µs regardless of group size. A message costs the same
in a DM as in a 2,000-person room. **Commits are cheap** — 18.5 ms to add at
2,000 leaves against the 500 ms budget in `29` §5.

### The mistake

`mls-rs` defaults `ratchet_tree_extension` to **true**, inlining the whole
ratchet tree into every Welcome. `03` §5 explicitly says we *don't* do that —
the tree is public, so the Host serves it separately. So the table above
measures a configuration our own design rejects, and the Welcome column is
roughly 4× worse than reality:

| leaves | welcome (tree inlined) | welcome (tree out of band) | tree, served separately |
| ---: | ---: | ---: | ---: |
| 50 | 21.0 KiB | **5.9 KiB** | 15.1 KiB |
| 500 | 209.0 KiB | **57.7 KiB** | 151.3 KiB |
| 2000 | 836.9 KiB | **230.6 KiB** | 606.3 KiB |

### What a single joiner actually downloads

Batch-adding 500 people at once puts 500 members' secrets in one Welcome —
realistic for a migration, not for someone joining a room. The normal case:

| | leaves | welcome | tree (cacheable) | total, first join |
| --- | ---: | ---: | ---: | ---: |
| classical | 50 | 0.4 KiB | 15.9 KiB | **16 KiB** |
| PQ hybrid | 50 | 1.4 KiB | 74.9 KiB | **76 KiB** |
| classical | 500 | 0.4 KiB | 156.5 KiB | **157 KiB** |
| PQ hybrid | 500 | 1.4 KiB | 736.2 KiB | **738 KiB** |
| classical | 2000 | 0.4 KiB | 626.2 KiB | **627 KiB** |
| PQ hybrid | 2000 | 1.4 KiB | 2941.8 KiB | **2.9 MB** |

**The Welcome is constant** — 0.4 KiB classical, 1.4 KiB PQ, at any group size.
Every byte that scales with the room is the ratchet tree, which is **public,
identical for every joiner at that epoch, and therefore cacheable**. That is the
whole justification for the out-of-band decision, now with numbers.

So the ~2,000-leaf ceiling in `03` §11 is **not** a bandwidth limit. A first
join at 2,000 members is 627 KiB classical or 2.9 MB post-quantum — one photo,
once per device per room. The ceiling should be justified by commit-storm and
committer-availability concerns, or dropped; it should not cite Welcome size.

---

## 3. Post-quantum — **yes, everywhere. Not per group.**

Against **ML-KEM-768 + X25519**, the X-Wing-style hybrid — the only sensible PQ
choice, since it holds if *either* primitive holds and so isn't a bet on
lattices.

| | classical | PQ hybrid | cost |
| --- | ---: | ---: | ---: |
| encrypt a message | 15 µs | 15 µs | **free** |
| 1 add @ 500 | 2.5 ms | 4.3 ms | 1.7× |
| build @ 500 | 39 ms | 45 ms | 1.2× |
| KeyPackage | 423 B | 2,793 B | 6.6× |
| welcome, single join | 0.4 KiB | 1.4 KiB | 1 KiB |
| tree @ 2000 (cacheable) | 626 KiB | 2.9 MB | 4.7× |

**Ship the PQ hybrid uniformly** — *if it can run everywhere. It currently
cannot; §3a below supersedes this.*

An earlier draft of this doc recommended choosing the ciphersuite *per group* —
PQ for small rooms, classical for large ones — on the basis that a PQ Welcome
was 1.3 MB. That number came from the flawed measurement above (batched adds,
tree inlined). Corrected, the entire PQ overhead on a join is **1 KiB of
Welcome plus a larger cacheable tree**, and messaging is free.

A per-group split would have bought very little and cost a lot: rooms with
different cryptographic strength, no way for a user to tell which is which, and
a policy axis to explain in a product whose whole pitch is that you don't have
to think about this. Uniform is simpler, and simplicity in crypto configuration
is itself a security property.

This settles the open question in `03` §12 and the conditional in `README.md`.

---

## 3a. …but post-quantum does not currently work on the web

Found immediately after, and it qualifies everything above.

| target | classical core | PQ (AWS-LC) |
| --- | --- | --- |
| native (macOS/Linux/iOS/Android) | builds | builds |
| **`wasm32-unknown-unknown`** | **builds** | **fails** |

`mls-rs-crypto-awslc` wraps **AWS-LC, a C library**, and `aws-lc-sys` cannot
build for `wasm32`. The pure-Rust stack (`mls-rs` + `mls-rs-crypto-rustcrypto`)
compiles to wasm32 fine — but has no PQ ciphersuites at all.

Since the web client is the v1 product (`05` §5), PQ can't ship uniformly today.
And the obvious fallback is worse than it looks: a ciphersuite is fixed **per
group**, so "PQ on native, classical on web" would mean any group containing one
web member must be classical — a room's cryptographic strength would depend,
invisibly, on which clients its members happen to use. Strictly worse than the
per-room split already rejected.

### Options

**A. Ship classical now; add PQ when a wasm-capable hybrid exists.** ← recommended.
Harvest-now-decrypt-later is real but not urgent at friends-and-communities
scale. The migration path is already written (`29` §1 — a ciphersuite change
means new groups, not an upgrade), and it's the same mechanism any crypto change
would use.

**B. Wire an existing pure-Rust hybrid into mls-rs.** Smaller than first stated.
An earlier draft of this section implied there were no pure-Rust PQ libraries;
that was wrong. There are several, and the relevant ones **build for wasm32**
(verified, not assumed):

| crate | what it is |
| --- | --- |
| **`x-wing` 0.1** | pure-Rust X-Wing KEM — exactly the hybrid construction we want. **Builds for wasm32.** |
| `rxwing` | X-Wing, tracking draft 10 |
| `ml-kem` 0.3 | RustCrypto's pure-Rust ML-KEM. **Builds for wasm32.** |
| `libcrux-ml-kem` | formally verified ML-KEM |
| `kyberlib` | FIPS 203 ML-KEM |

So the missing piece is **not** the cryptography — it is the *adapter*: nothing
implements mls-rs's `KemType` over any of them. `mls-rs-crypto-hpke`'s
`CombinedKem<KEM1, KEM2, H, VH, F>` is generic over its KEMs, so the work is a
trait impl plus a provider that swaps the KEM into the existing RustCrypto
provider — real, testable, and far short of writing a KEM.

It still lands in audit scope (`27` §3), because a wrong adapter is as bad as
wrong primitives. But "wire two audited crates together behind a trait" is a
different proposition from "write our own KEM", and the earlier wording
overstated it.

**Also worth noting:** `mls-rs-crypto-webcrypto` exists — a SubtleCrypto-backed
provider for browsers. It won't help with PQ (SubtleCrypto has no PQ suites), but
it's a relevant option for the web target generally and wasn't on the radar.

**C. Wait for upstream.** `mls-rs-crypto-rustcrypto` gaining PQ suites makes it
free. No signal on timing.

**Recommendation: A now, B as a near-term spike** — it is smaller than it first
looked, and getting PQ before launch is much cheaper than migrating groups after.
Keep the PQ benchmarks in the repo so this can be revisited with numbers, and
don't let web and native diverge cryptographically in the meantime.

## 3b. The one-core bet — half proven

`26` claims one Rust core serves every platform: `wasm-bindgen` for web, UniFFI
for native. Tested rather than assumed:

| target | result |
| --- | --- |
| native | **30 tests pass** |
| **`wasm32-unknown-unknown`, in Node** | **10 tests pass** — a full two-device MLS exchange, revocation, and (per §5) the web binding itself |
| **Swift via UniFFI** | **7 checks pass**, including typed errors across the boundary |
| `wasm32` with PQ / AWS-LC | fails — see §3a |

The Swift test is not a smoke test that merely links: it generates an account
key, issues and verifies a device certificate, confirms a tampered certificate
is refused, checks that a wrong-length key surfaces as a **typed Swift error**
rather than a crash, and confirms two devices of one account share an account id.
Same Rust code the web calls — as of §5, actually calls.

Compiling is not the same as working, so the wasm suite runs the actual flows —
entropy, certificates, a two-device exchange, and revocation — in Node against
the built `.wasm`. **The bet holds: one core, three platforms.**

Two things wasm needed that native didn't, both recorded in `.cargo/config.toml`
and the manifest:

- **Entropy.** `getrandom` 0.3 refuses to pick a wasm32 backend implicitly (so a
  target with no entropy source fails loudly instead of returning predictable
  bytes). It needs the `wasm_js` feature *and* `--cfg getrandom_backend="wasm_js"`.
  Both 0.2 and 0.3 are in the tree, configured differently.
- **Target-scoped dependencies.** UniFFI and proptest are native-only, so they
  are declared under `cfg(not(target_arch = "wasm32"))`. Without that, a
  transitive dependency of proptest breaks the wasm build entirely.

---

## 4. Toolchain notes

- **`mls-rs 0.56.0` + `mls-rs-crypto-rustcrypto 0.22.1`**, both on
  `mls-rs-core 0.27.0`. Older combinations resolve to *two different*
  `mls-rs-core` versions and the provider then fails to satisfy mls-rs's own
  `CryptoProvider` bound. Check `cargo tree` if that error appears.
- **AWS-LC built with no Go or perl** — `cmake` and Apple clang were enough on
  macOS/aarch64. PQ is behind the `pq` feature so the default build stays pure
  Rust.
- `mls-rs 0.44` → `0.56` changed several method arities (`create_group`,
  `join_group`, `generate_key_package_message` all take a trailing
  `Option<MlsTime>`).

---

## 5. The web binding — measured in a browser

`3b` proved the crate *compiles and runs* under wasm. It did not prove anything
about the web, because nothing was exported: `src/ffi.rs` is UniFFI only, so
`wasm32` produced an artifact no JavaScript could call. Every number in `2` is
native.

`src/wasm.rs` is now the web half of the `26` §Option C split. Build it with
`pnpm build:wasm`; measure it with `pnpm bench:wasm`, which runs the same
benchmark as `examples/bench.rs` in a real browser so the two tables can be read
against each other. Measured on ladybug (M5, 24 GB), Chrome, `[profile.wasm]`.

### What it costs to download

| | raw | gzip | brotli |
| --- | ---: | ---: | ---: |
| `revel_crypto_bg.wasm` | 1,163,762 | 390,435 | **292,855** |
| `revel_crypto.js` (glue) | 39,014 | 7,470 | 6,467 |

**293 kB over the wire**, once per version. Compile and instantiate is
**2–5 ms** — not a number worth optimising.

`[profile.wasm-size]` (`opt-level = "z"`) gets that to 251 kB brotli. It is
kept, and it should not be used: it costs **74%** on the operation that already
dominates — a 500-leaf build goes 1,469 ms → 2,560 ms — to save 42 kB. Bytes
are cheap here and commits are not.

### Group scaling, in a browser

| leaves | build (batched) | 1 add | welcome | 1 remove | first join | encrypt | decrypt |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 4 ms | 1.2 ms | 0.9 KiB | 3.1 ms | 1 ms | 262 µs | 258 µs |
| 50 | 73 ms | 4.6 ms | 21.0 KiB | 31.8 ms | 56 ms | 262 µs | 332 µs |
| 500 | 1,469 ms | 14.3 ms | 209.0 KiB | 212 ms | 363 ms | 340 µs | 316 µs |
| 2000 | 17,286 ms | 61.9 ms | 836.9 KiB | 804 ms | 1,749 ms | 280 µs | 262 µs |

Welcome sizes are **byte-identical** to the native run, which is the cross-check
that matters: this is the same protocol output, not a lookalike.

### The finding: asymmetric crypto is what wasm costs you

Against `2`'s native table, the slowdown is not uniform — it splits cleanly by
what kind of cryptography an operation does.

| | native | browser | ratio |
| --- | ---: | ---: | ---: |
| encrypt (symmetric, AES-GCM) | ~50 µs | ~280 µs | **~5×** |
| 1 add (one path update) | 18.5 ms | 61.9 ms | **~3×** |
| 1 remove (2,000 leaves) | 39.8 ms | 804 ms | **~20×** |
| build 2,000 (batched) | 774 ms | 17,286 ms | **~22×** |

Sending a message is ~5× slower and **flat with group size**, exactly as it is
natively — a message costs the same in a DM as in a 2,000-person room. But
anything that touches the ratchet tree pays 20×, because it is thousands of
X25519 operations and RustCrypto's field arithmetic has no SIMD to fall back on
under `wasm32-unknown-unknown`.

**This is a new argument for a ceiling, and a better one than `2` retired.** §2
established that Welcome size does *not* justify the ~2,000-leaf limit in `03`
§11. This does: on the machine a person actually has, building a 2,000-leaf
group is **17 seconds** and removing one member from it is **0.8 seconds** — and
today that is 17 seconds of a frozen main thread, because there is no worker.
Two consequences, neither of them optional:

1. **The core must not run crypto on the main thread.** A 500-leaf remove at
   212 ms is already past the frame budget by an order of magnitude.
2. **Mass membership changes need to be a background job with progress**, not
   something a button waits on.

### Three measurement mistakes, all in the harness

In the spirit of `2` — the harness was wrong three times before the numbers
meant anything, and each failure impersonated a result.

- **`requestAnimationFrame` never fires in a tab that isn't painting.** The
  bench yielded between rows to stay watchable, and stalled forever on the first
  row when driven headlessly. It looked exactly like the crypto hanging. Now
  raced against a timer, which is also correct for a backgrounded tab.
- **wasm tiers up on a wall clock, not a call count.** V8 runs Liftoff code
  immediately and swaps in TurboFan later, so early rows measure the baseline
  compiler. First it read `encrypt` at 418 µs for 2 leaves and 160 µs for 500 —
  encryption apparently getting cheaper as the group grows. A fixed-*iteration*
  warmup only moved the cliff: 2,000 leaves then read 40 µs under a 500-leaf row
  reading 372 µs. The warmup is three **seconds** now, exercising the symmetric
  and asymmetric paths separately, because they tier independently.
- **50 samples is far too few for a 50 µs operation** against a clock browsers
  deliberately blunt. Single-call decrypt timings came back as 200/500/500/600
  µs — the clock's resolution wearing a result's clothing. At 2,000 samples the
  figure is flat across group sizes, which is the shape it should have had all
  along.

### What is deliberately not built yet

- **Group state is not persisted.** A group lives in wasm memory and dies with
  the page. mls-rs has a `GroupStateStorage` seam for handing that to the
  TypeScript store; that is the next piece.
- **No worker.** See above — this is the one with a deadline attached.
  Built in §6.
- **The binding inlines the ratchet tree**, because it uses mls-rs's default
  commit options. That is the configuration `03` §5 rejects and `2` measured as
  4× worse; the browser Welcome column above inherits it. Out-of-band tree
  serving has to be exposed across this boundary before any of it ships.

---

## 6. Off the main thread — measured

§5 ended with "no worker" as the gap with a deadline attached. `packages/crypto`
closes it: `engine.ts` is the interface `26` §Option C names, `worker.ts` runs
every one of those calls in a Worker, and `client.ts` is a `CryptoEngine` that
is really a `postMessage` channel. Nothing above the seam sees wasm.

`pnpm bench:worker` runs one workload — admit 500 members in a single batched
commit — twice on one page, on the main thread and through the Worker, while a
`MessageChannel` loop records the longest the main thread ever went without
getting a turn. That gap is what a person experiences as a freeze.

| engine | work took | longest main-thread stall | dropped frames at 60fps |
| --- | ---: | ---: | ---: |
| main thread | 282 ms | **282 ms** | 17 |
| Worker | 299 ms | **6–33 ms** | 0–2 |

The main-thread stall equalling the work exactly, run after run, is the
signature of a fully-blocking call and the check that the instrument is
measuring the right thing. **The freeze is gone.** Reproduced across five runs.

### An unresolved 5×

One thing did not resolve, and it is recorded rather than explained: on a
**freshly loaded page**, the Worker takes ~1.5 s for the 500-leaf commit the
main thread does in 282 ms. Run the whole flow a second time in the same page
and the Worker matches the main thread (299 ms). Five fresh-page measurements:
1617, 1508, 1552, 1533, 1628 ms.

What it is not:

- **Not CPU scheduling.** An identical pure-JS busy loop is *twice as fast* in a
  Worker on this machine, so the Worker is not being parked on a slow core.
- **Not warmup.** Raising the Worker's warmup from 2 s to 8 s changes nothing.
- **Not "the first Worker the page spawns".** Two Workers in sequence on a fresh
  page are both slow.

The one thing that reliably makes it fast is having already run the whole flow
once in that page — which is a difference on the *main thread*, and should not
be able to affect a separate wasm instance in a separate thread. Something is
being cached at a level none of these tests isolate.

**It does not change the decision** — the stall is what the Worker exists to
remove, and it removes it — but it does have a consequence worth acting on now:
**spawn the Worker at startup and give it something to chew on**, rather than
lazily on first use. Whatever the cause, the first heavy operation after a page
load costs about five times what the same operation costs later, and the first
heavy operation is exactly the one a person is waiting on.

### One design change fell out of building it

Staging members one at a time would have been one `postMessage` per member — 500
round trips to batch-add 500 people, eating a real slice of what `03` §5's
batching was supposed to save. `stageAdd` and `stageRemove` take one item or an
array. The interface only looked right until something used it.

### What is still missing

Persistence, unchanged from §5 and now the next thing: an MLS group still lives
in Worker memory and dies with the page. Everything that comes after — a real
`packages/core`, surviving a reload, opening the app twice — waits on it. Built
in §7.

---

## 7. Surviving a reload — and the bug that found

An MLS group is a running cryptographic state machine, not a document. Lose it
and the ciphertext already on disk stays unreadable forever, because the keys
that opened it were in that state. `src/store.rs` is where it now lives.

### The shape

mls-rs persists through a `GroupStateStorage` whose trait is **synchronous**.
The store that has to end up holding the bytes is IndexedDB, which is not.
Those cannot be reconciled by having the storage call out to JavaScript — a
synchronous callback cannot await a transaction. So the storage is in memory
and export is an explicit second step:

1. mls-rs writes group state into `LocalGroupStore` whenever a group changes.
2. The store remembers **which** groups changed.
3. The caller drains those ids whenever it likes, asks for each group's sealed
   bytes, and writes them at its own pace.

Nothing is lost by the delay. A group that never reached disk is re-fetched
from the server, which is a slow start rather than a lost room.

What crosses the boundary is **sealed** — HKDF-SHA256 from the account secret,
domain-separated, then AES-256-GCM. `docs/04` §Client-side asks for exactly
this: the local store holds MLS session state encrypted, never in the clear.
Cost: **293 → 312 kB brotli**, +6.5%.

One honest deviation: `docs/03` §1 wants the sealing key to be the **device**
key — a non-extractable `CryptoKey` in IndexedDB — so a compromised account
backup does not also open local state. That needs a WebCrypto path that does
not exist yet, and only the derivation in `state_key` has to change when it
does.

### The device key has to come back too

`Device::new` generates a fresh signature key. A client that reloads by calling
it again is not reloading, it is **enrolling a second device**: a new leaf in
every group, with the old leaf still sitting in all of them. So there is now
`Device::restore(account, label, secret)`, and the certificate is re-issued
rather than stored — signing the same device key and label with the same
account key reproduces it byte for byte.

`docs/03` §1 asks that "reloading the app does not require a password", and
calls it Kith's biggest UX cliff. That is now true and tested.

### The bug: a rewound sender reuses a key and nonce

The first version persisted only on **epoch changes**, on the reasoning that a
stored epoch secret is enough to re-derive anything. That is true for reading
and false for writing, and `a_group_survives_a_reload` failed on it immediately.

Sending advances this device's position in the secret tree, and the key *and
nonce* for a message are derived from that position. A group restored from a
state saved before the send comes back with its counter rewound, and the next
message re-derives a key and nonce that have already been used. Two plaintexts
under one AES-GCM key and nonce is a **total loss of confidentiality and
authenticity for both** — the keystream cancels and the authentication key
falls out.

Two things changed:

- `encrypt` now persists before returning. It is the only application-message
  path that does; receiving is deliberately not persisted, because what that
  advances is a replay window the layer above already enforces with
  server-assigned event ids, and re-serialising a whole group per incoming
  message is not worth it.
- The residual hazard has its own test,
  `restoring_behind_the_last_send_is_refused_by_the_far_side`, which asserts
  the failure rather than the fix. **The rule it pins down: a new state must be
  durable before a ciphertext from it is handed to anyone.** The far side
  refusing the message is mls-rs's replay protection working, and is how you
  would notice — but refusing does not undo the reuse.

That rule now belongs to `packages/core`, and it is the constraint that decides
how sending is ordered against the store. It is written on the interface in
`packages/crypto/src/engine.ts` where a caller will actually read it.

### What is still missing

- **The store itself.** `packages/crypto` hands out sealed blobs; nothing writes
  them to IndexedDB yet. That is `packages/core`.
- **Key package storage.** Generate a key package, reload, then get added to a
  group: the private half is gone and the Welcome cannot be opened. It is the
  same mechanism as group state — a custom `KeyPackageStorage` — and it is the
  next small piece. Until then, a pending invite does not survive a reload.
- **Sealing under the device key**, as above.
