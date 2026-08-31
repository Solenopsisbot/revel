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

### Pending invites, too

Group state was not the only thing dying with the page. A **key package** is
what someone else needs in order to add this device to a group, and its private
half never leaves the device that made it. Publish one, close the tab, get added
while away, and the Welcome that comes back cannot be opened — a member of a
group they cannot read, which is a worse state than not having been added.

`LocalKeyPackageStore` is the same mechanism as group state, with two
differences worth naming:

- **Exported whole**, not per entry. There is one per pending invite, they are a
  few hundred bytes, and their ids are mls-rs internals that nothing outside the
  crate can interpret — a poor thing to key a public API on.
- **Importing replaces rather than merges.** mls-rs deletes an entry the moment
  a join consumes it, and that deletion matters as much as the insert: merging
  would resurrect a consumed key package, and a key package used twice costs the
  joiner forward secrecy for the epoch they joined at.

Both directions are tested — `a_pending_invite_survives_a_reload`, and its
negative `a_reload_without_key_packages_cannot_open_the_welcome`, which asserts
the bug rather than assuming it stays fixed.

Running total for persistence: **293 → 317 kB brotli**, +8%.

### What is still missing

- **The store itself.** `packages/crypto` hands out sealed blobs; nothing writes
  them to IndexedDB yet. That is `packages/core`.
- **Sealing under the device key**, as above.

---

## 8. The handshake surface, and three things it taught us

`docs/04` §5 specifies `/groups/:id/{handshake,welcome,tree,key-packages/claim}`
and `docs/29` §4 asks for a multi-client harness. Building the first made the
second possible, and the second immediately found things the first got wrong.
Recorded here because two of them are constraints rather than bugs — they will
be true of any implementation, so they are worth knowing before rediscovering.

### Being removed from a group is silent

A commit that removes this device **processes without error**. mls-rs cannot
apply a commit that takes your own leaf away, so it does not: `process` returns
normally and the epoch simply stays where it was. Nothing throws, nothing is
flagged, and every subsequent message is undecryptable.

From a user's seat that is a room that has mysteriously stopped working, which
is exactly the silence `docs/22` exists to prevent. The detection is cheap once
you know to look for it:

> **After processing a commit, if the epoch did not advance, this device is no
> longer in the group.**

A commit we can apply always advances us by exactly one. `GroupSync` checks it
and calls `onRemoved`, which is where "you were removed from this room" comes
from.

### A diverged session cannot quietly rejoin

Re-adding a device whose state has been lost fails with *"duplicate signature
key, hpke key or identity found at index 1"*. MLS will not admit a leaf whose
signature key is already in the tree, and the stale leaf is still there.

So the reset is two steps and neither is optional: the group must **remove the
old leaf** first, and only then can the device be added again. A UI offering
"reset this room" has to be able to ask someone else to do half of it, which is
a real constraint on how that flow can be designed.

### The server's membership list has to be clearable by its own device

The Host skips devices it already lists when claiming key packages — that is
part of the authorised-claim fix (`docs/03` §5). It also means a stale row is a
person who **can never be added back**, which is precisely the state both cases
above leave behind.

`DELETE /groups/:id/membership` is the escape hatch: self-only, and not a
removal — the leaf stays in the tree until a member commits it away, which is
not the server's to do. It clears the delivery list, nothing more.

Note what makes this workable: **the removed device clears its own row.** The
alternative would be for the remover to do it, and the remover cannot — it knows
which *leaf* it removed, and the server knows which *device pub*, and nothing
connects the two.

### The leaf ↔ device-pub gap, still open

A device has two identifiers that ought to be one:

| Where | What | Who knows it |
| --- | --- | --- |
| MLS | the device signature key, inside the certificate | every group member |
| Host | `devices.pub`, on `Event.sender` | the server |

Nothing relates them. It has not mattered yet, because attribution comes from
the MLS leaf inside the ciphertext and never from `Event.sender` (`docs/04` §2),
and because the removed device clears its own row. But it does mean a moderator
cannot say "remove this account's leaves *and* tell the server", and a device
that is removed while offline leaves a stale row until it next connects.

**The fix belongs in phase 1's device registration** (`docs/06`): a device
should register its MLS signature key as its `devices.pub`, so the two are one
identifier. Doing that later means a migration; doing it when device
registration is first written costs nothing.

### And one latent bug, found by writing the schema down

`EventInput.notify` was typed as an array of snowflakes. Account ids are public
keys (`docs/04` §1) — 43 characters of base64url — so it would have rejected
every real one the first time anything populated it, and nothing had.
`AccountId` and `DevicePub` now live in `ids.ts` beside the snowflake, which is
where the next person will look before typing `z.string()`.

---

## 9. The ratchet tree, finally out of band

`docs/03` §5 rejects the `ratchet_tree` extension and §2 above measured what
leaving it on costs. The binding had it on anyway — mls-rs's default — and the
tree endpoints added with the handshake surface had nothing writing to them.
Both halves are now real: `mls_rules()` turns the extension off, and a commit
carries the tree it produced.

Measured through the web binding, one join at a time:

| Group size | Welcome | Commit | Tree |
| --- | --- | --- | --- |
| 2 | **329 B** | 569 B | 0.9 KiB |
| 50 | **329 B** | 569 B | 15.4 KiB |
| 200 | **329 B** | 569 B | 62.2 KiB |
| 500 | **329 B** | 569 B | 155.2 KiB |

**The Welcome and the commit are constant.** Every byte that used to grow with
the group is now in the tree, which is fetched once per epoch and shared by
every joiner rather than copied into each one's Welcome. At 500 members a single
join went from ~155 KiB to 329 bytes.

A batched add still grows, because a Welcome genuinely contains one member's
secrets per person added — 5,993 bytes for 49 at once, 59,095 for 499, about
120 bytes each. That is irreducible and it is not the tree.

Binary size: **317 kB brotli, unchanged.** Turning the extension off costs
nothing to ship.

### The ordering that makes it safe

Out of band means a Welcome is no longer self-contained, and the obvious
implementation has a race in it:

```
commit → POST handshake → server stores the Welcome and pushes it
                        → joiner fetches the tree ← still the OLD epoch's
       → applyPending → export tree → PUT tree
```

The tree for the new epoch does not exist until the commit is applied, and the
commit is not applied until the server accepts it — by which point the Welcome
is already readable. A joiner who moved quickly would fetch the previous epoch's
tree and fail to join, intermittently, for reasons nobody could reproduce.

The fix is that **mls-rs hands you the tree as part of the commit output**
(`CommitOutput.ratchet_tree`), before it is applied. So the tree goes up in the
same request as the commit, the server writes both in one transaction, and there
is no window. `HandshakeInput.tree` exists for that and nothing else — the
standalone `PUT /groups/:id/tree` is now only a repair path.

### And a wire-shape bug the change surfaced

`GET /welcomes` returned the store's row verbatim, whose field is `groupId`,
while `PendingWelcome` — and every other frame in the protocol — calls it
`group`. Nothing caught it: the type checker cannot see through a JSON boundary,
and the test asserted the field name it had watched the route produce.

It only became visible when a client first had to *use* the value, to fetch the
tree for that group. The route now maps to the protocol shape explicitly and the
test validates against the schema instead of a remembered name.

---

## 10. Rooms, and the line the server cannot cross

Until this, `apps/server` could carry a conversation perfectly well and there
was no way to *start* one: every room in every test was poked straight into the
store, and a client that reloaded had no way to discover what it was a member of
except its own local copy — which is exactly the thing a reload is allowed to
lose. `docs/04` §5's `/rooms` is now real for the phase 2 set: DMs and group DMs,
`docs/03` §4's "rooms with no space and an explicit-list audience".

Spaces are deliberately not here. `docs/06` puts them in phase 3 with roles,
overrides, invites and bans, and half a space is worse than none — a room with a
`space_id` pointing at nothing resolves its permissions against roles that do
not exist.

### The derived DM id, and why it needs a collision check

`docs/03` §4 wants the 1:1 DM id derived from the sorted account pair, so that
opening is idempotent and a client can name the room before it exists. Sixty-
three bits of SHA-256, formatted as a snowflake — no timestamp, and none needed:
`docs/04` §6 requires time-sortable ids for *events*, because a room's total
order depends on it. A room id only has to be unique.

Two details that are easy to get wrong and expensive to fix later:

- **Length-prefixed, not delimited.** With a plain separator, `("ab", "c")` and
  `("a", "bc")` hash the same bytes, and two unrelated pairs share a room.
- **The server checks the members before handing the room over.** An accidental
  collision at 63 bits is not a real concern; a *deliberate* one would be a way
  to squat somebody's DM. Refusing turns the worst case from two pairs sharing a
  room into an error somebody can report.

### Membership is delivery, not access

The clearest statement of the architecture the whole design rests on, and it now
has a test on both sides:

> `POST /rooms/:id/members` puts somebody in a room. They can see it exists.
> They cannot read a word in it until a **member's client** commits them into
> the MLS group.

The server can hand out membership and cannot hand out keys. The same asymmetry
runs the other way: leaving a room stops delivery and does not take back what a
device already holds, which is why a kick that has to bite is a Remove commit
first and a membership row second.

### Left undone on purpose

**Removing somebody else from a group DM.** It needs a notion of who owns one,
and `docs/04` §1's `rooms` table has no owner column — the only owner in the
schema belongs to a space. Inventing one here would be inventing the spec, so a
group DM that has gone wrong is currently left rather than cleaned up. Worth
deciding before group DMs are something people use.

**Account discovery.** You can open a DM with an account id and there is no way
to find one from a handle, because there is no `accounts` table yet —
registration is phase 1. "Does this account exist" currently means "has a device
ever been enrolled for it", which is enough to refuse a typo and not enough to
be a directory.

---

## 11. Real authentication, and the identifier that stopped being two

Until this, `authenticate` read a device id out of an HTTP header and believed
it. Every policy check in the codebase was correct and **none of them meant
anything**, because anybody could claim to be anybody. `docs/03` §2's
challenge-response now exists: register a certificate, ask for a nonce, sign
`{nonce, host, device_pub}`, carry a short-lived bearer token. No passwords at
Hosts, ever.

### Registration needs no credential

A device certificate is **self-certifying** — the account public key is inside
it and signs the rest — so a Host that has never heard of an account can check
that a device belongs to it. That is what makes `docs/17`'s "your account works
at a Host you have never met" true rather than aspirational, and it is why there
is no registration secret anywhere to leak.

What a certificate does *not* prove is that an account is who you think it is.
Nothing here does; that is the transparency log, still unbuilt.

### `devices.pub` is now the MLS signature key

The gap recorded in §8 above, closed. The Host used to know a device by one name
and the group by another with nothing relating them, so a removal could never
tell the server which delivery row it had just invalidated. The certificate
binds account key → device key, the Host registers the device key as
`devices.pub`, and there is one identifier.

### Two implementations of one format, and the test that keeps them honest

The certificate is issued in Rust and read in TypeScript, because the server has
to read one and the server is TypeScript. Two implementations drift, and a
comment saying "keep these in sync" has never once kept anything in sync.
`packages/core/test/auth.test.ts` signs with the real Rust binding and verifies
with the TypeScript decoder — thirteen tests, including tampering with the label
and swapping the device key.

That test immediately earned itself: **mls-rs hands back the expanded Ed25519
secret**, 64 bytes of seed-then-public-key, not the 32-byte seed
`SigningKey::from_bytes` wants. Signing with the wrong half produces a signature
that verifies nowhere, and the failure would have looked like "sign-in is
broken" rather than "the key layout is not what we assumed". `sign_auth` now
derives the public key from the seed and checks it against the certificate, so
if the layout ever changes it fails at the first signature with a sentence
saying so.

Also added, per `docs/29` §1 rule 4: **the certificate carries a version byte.**
The context string was inside the signed payload, which protects the signature
and does nothing for a decoder handed bytes from a future version — it would
read them as v1 and produce nonsense.

### What the multi-client harness found by using it

Switching the 34 scenarios from the header shortcut to real sign-in changed the
timing enough to surface a genuine bug: **the commit that adds somebody is fanned
out to every member of the group it just created, including the person it
added** — who has not opened their Welcome yet and cannot process a commit for a
group they are not in. It threw. Their way in is the Welcome, so ignoring is
correct, and `GroupSync` now checks it holds a group before applying anything
addressed to it. Throwing would have made every invitation a stack trace on the
invitee's console.

The harness runs on real auth now, which is the point: a harness that shortcut
sign-in would be testing a server nobody deploys.

---

## 12. Handles, and one decision that is not mine to make

`docs/03` §2: an account *is* a public key; a handle is a human name for it,
registered at an IdP, and the full address is email-shaped. Until this you could
open a DM with forty-three characters of base64url and not with a name.

The rule most of the implementation is defending is `docs/17`'s:

> **Handles are not unique across IdPs.** Two different people can both be
> `viola`. So the *full address* is the identifier everywhere it matters. The
> bare handle is a display convenience, never a key.

Three things follow, and each has a test:

- **Case is folded once, at the edge.** `Viola` and `viola` being two accounts
  is an impersonation vector. Input is lenient (a person typing `Viola` into a
  sign-up box should not get a validation error) and storage is canonical, with
  exactly one function between them.
- **A foreign address is refused, not resolved locally.** Treating
  `viola@elsewhere` as the local `viola` delivers a message to the wrong person
  with the right name. `docs/03` §2 resolves foreign handles by fetching
  `/.well-known/uca/handles/<handle>` and verifying transparency-log inclusion;
  neither exists, so this answers 501 and says which IdP it could not reach.
- **Rooms store the key, never the name.** A handle can be given up and taken by
  somebody else; a key cannot.

### The account id encoding — doc and code disagree

`docs/03` §2 says:

> `account_id` = the account public key (encoded as a **52-char base32 string,
> prefixed for legibility**).

The code has always used **base64url, 43 characters, unprefixed** (`toAccountId`).
Nobody decided that; it was the first thing written and it stuck.

**This is Viola's call, not mine.** The arguments:

| | base32, prefixed (`docs/03`) | base64url (the code) |
| --- | --- | --- |
| Length | 52 + prefix | 43 |
| Case | insensitive — survives being lowercased by a URL, an email client, or a person saying it aloud | sensitive |
| Reading it aloud | plausible | no |
| Telling it apart from a device id or a snowflake | the prefix does it | nothing does |

The reason it is worth deciding *now* rather than later is that account ids are
about to become user-visible — invite links, deep links, the "verify this
person" screen — and not because it is expensive to change. It is not:
**account ids do not appear inside encrypted history.** Attribution comes from
the MLS leaf, not from a stored id, so there is no sealed format to migrate.
The cost is a couple of hours of fixtures either way.

**Decided (2026-08-31): base64url, and `docs/03` now says so.**

The argument that settled it is the one the table above does not have a row
for: **an account id is not something a person handles.** Humans use handles
(`viola@idp.example`); the raw key shows up in an invite link you copy whole
and in a verification screen you compare rather than transcribe. base32's
case-insensitivity is a real property, but it pays off only in the cases —
saying it aloud, retyping it, surviving a mail client that lowercases — that
the design already routes around. The prefix and the nine extra characters are
paid on every id, everywhere, forever.

Recorded here so the divergence was a decision rather than an accident, and so
the reasoning survives the next person who notices `docs/03` used to disagree.

### Still missing from phase 1

OPAQUE registration, the key backup and its three wraps, second factors, and the
transparency log. Claiming a handle currently proves you hold a device whose
certificate is signed by the account key — which is what a session already
proves. That is enough to bind a name to a key and is *not* what OPAQUE is for:
OPAQUE protects the key **backup**, so that a new device can sign in with a
password. Different thing, same phase.

---

## 13. Attachments, and one deliberate departure from `docs/26`

`docs/22`: "Files are sealed client-side with a per-file key that travels inside
the encrypted event, so the blob store holds ciphertext with no filename or
type." That is now true rather than planned. Sealing, upload, download, purge,
and thumbnails as their own sealed blobs.

The server-side file is almost empty, and the almost-emptiness is the feature:
hold these bytes, hand them back to people who may read the room. The row has a
length, a room, an uploader and a hash of the *ciphertext*, and there is no name
column, no MIME column and no dimensions, because there is nothing to put in
them.

Three consequences fall out and each has a test:

- **No hotlinking.** A URL pasted elsewhere is meaningless bytes: the key was
  never in the URL, a header, or anything the server touched.
- **No thumbnails from the server.** It cannot see the image. A thumbnail is its
  own sealed blob under its own key, made on the sender's device.
- **No link previews from the server.** Same reason plus a better one — fetching
  a URL on a reader's behalf would tell the linked site that the link was read.

### Sealing is in TypeScript, not Rust, and that is a departure

`docs/26` Option C puts "MLS, device keys and **envelope encryption**" in the
Rust core. A strict reading puts blob sealing there too. It is in
`packages/core/src/blobs/seal.ts` instead. The reasons, recorded so this is a
decision rather than drift:

- **Size.** wasm has its own linear memory. Sealing a 100 MB file in Rust means
  copying it in and copying the result out — 200 MB of heap for one photo, in a
  tab that also has to render a room.
- **Hardware.** WebCrypto's AES-GCM is hardware-accelerated everywhere; the wasm
  build is not and cannot be.
- **The argument is small enough to check by reading it.** A fresh 256-bit key
  per blob, used exactly once, with a fresh random nonce.

That last one is the real reason. What makes MLS state need the discipline of
the Rust core is that getting the *sequencing* wrong silently reuses a nonce —
the bug in §7 above. Here there is no sequence: the key is new every time, so
there is nothing to restore behind and nothing to reuse. A property test asserts
twenty seals produce twenty distinct keys and twenty distinct nonces.

### Two hashes that are not the same hash

`BlobRef.hash` is over the **plaintext** and is checked after decrypt.
`BlobInfo.hash` is over the **ciphertext** and is all the server can compute.
Neither is a security control — GCM's tag already makes tampering impossible
without the key — and the plaintext one earns its place by catching a *sender*
whose client built the ref wrong, which would otherwise surface as a corrupt
image with no explanation.

### The size cap is a placeholder

100 MB, and no doc gives a number. It is a hosting decision that depends on what
storage costs and what a self-hoster is willing to pay; `docs/27` §2 is the
discussion and it is unresolved. Configurable per Host, so the placeholder is
not load-bearing.

---

## 14. The Host as an external sender — the half that had to be done now

`docs/03` §5: "The Host is configured in **every** group as an MLS external
sender... It can propose; it cannot Commit or forge a roster."

This is done in two halves, and only one of them is here. The reason is in
`docs/29` §1's framing — nearly free now, expensive to retrofit — and it applies
to exactly one part.

### Done: the extension, because it cannot be added for free later

`external_senders` is a **group context extension, fixed at creation**. A group
opened without one can only gain it through a `GroupContextExtensions` commit —
one commit per group, forever, for every group ever opened. So:

- Every group the client opens now names the Host as an external sender.
- The Host holds its own account key and signs itself a device certificate,
  which is not a workaround: `DeviceCertIdentityProvider::validate_external_sender`
  already expected one. Members check the Host's right to propose with the same
  machinery they check each other's right to hold a leaf, and can see who
  vouched for it.
- `GET /.well-known/revel/host` publishes it, unauthenticated, because two of
  the three things it carries are needed *before* you can authenticate: the
  Host's name goes into the challenge you sign, and this goes into a group at
  creation.
- `CryptoEngine.externalSenders(groupId)` reads back what the **group** believes,
  which is the only thing that matters — a Host that later rotates or loses its
  key cannot change a group context.

Four native tests in `crates/revel-crypto/tests/external_sender.rs` prove the
mechanism end to end: a Host proposal is accepted and committed by a member; a
Host that was never named is refused; a group with no extension refuses every
external sender; and a Remove works the same way as an Add.

### Not done: the Host actually proposing, and why

Making the Host *issue* proposals means it holds an `ExternalGroup` — mls-rs
needs the full group context (epoch, tree hash, **confirmed transcript hash**)
to sign one, and the transcript hash only exists if you have processed every
commit. So the Host would have to parse the handshake stream and keep MLS state
per group.

That collides with `docs/29` §1 rule 5: *"The server never parses payloads, so
server-side compatibility is free. This is a real structural advantage of the
opaque-log design and it should be protected."* Holding an `ExternalGroup` means
an MLS version change becomes a server change.

It is also premature. `docs/03` §5 has the Host proposing "on any audience
change... computed from the space's roles and the room's overrides" — and
spaces, roles and overrides are phase 3. Building the machine before the thing
it reads exists means guessing at the interface between them.

**What is lost by waiting: nothing that is not already covered.** The Host
cannot commit either way, so it always needs a member's client; external
proposals only mean the proposals are queued before a client arrives. That is a
latency optimisation over `COMMIT_REQUESTED`, which exists and works. The
capability that *cannot* be added later — the extension — is the one that is
here.

### One thing a deployment must get right

The Host's external-sender key is baked into the group context of every group
opened while it was published, and cannot be changed there without a commit. A
Host that regenerates it on restart silently loses the ability to propose into
every group it has ever served.

`apps/server/src/index.ts` generated it **per process**, which was wrong for
anything real. **Fixed in §29:** `hostkey.ts` holds it in a `0600` file (or
`REVEL_HOST_KEY`), `pnpm host-key` writes one, and the server refuses to start
without one whenever `DATABASE_URL` is set.

---

## 15. Rate limiting, and keeping it from becoming a log

`docs/29` §3 draws a line worth quoting exactly, because it is the whole
constraint on this component: "no per-user request logs **beyond what rate
limiting needs**". A limiter is the one part of a privacy-first server that is
allowed to remember who did something recently, which makes "what does it
remember, and for how long" a design question rather than an implementation
detail.

Three properties, all tested:

- **A bucket holds a count and a timestamp.** No path, no method, no body, no
  history. There is nothing in it to subpoena.
- **A full bucket is deleted.** Once refilled it says exactly what an absent
  bucket says, so keeping it would be storing information for no reason.
  Forgetting is free, which is why it is not optional.
- **A refusal is not recorded.** Being rate-limited leaves the same trace as
  being allowed — one bucket — because storing rejections is precisely how a
  limiter becomes an attack log.

### Token buckets, not fixed windows

A fixed window lets somebody spend a full window's quota in the last second of
one and the first second of the next: twice the intended rate, at the worst
possible moment. A token bucket has a burst size and a sustained rate, which is
also what real use looks like — you paste four messages at once and then say
nothing for a minute.

### The numbers are chosen, not specified

No doc gives any, and the real ones depend on what a Host runs on and who uses
it (`docs/27` §2, unresolved). They are grouped by *what a request costs the
server*, which is the only thing a limit can defend: `auth` is unauthenticated
and does public-key work, which is the cheapest thing to send and among the most
expensive to serve; `lookup` is unauthenticated and is also the enumeration
surface; `upload` is bytes; `write` allows a real burst because pasting four
messages is what people do.

### Two deployment notes

**`x-forwarded-for` is not trusted by default.** Trusting it without a proxy in
front means every caller sets their own rate-limit key and the limiter stops
existing. `REVEL_TRUST_PROXY=1` is a statement that something upstream
overwrites the header.

**Without it, the limits are global rather than per-caller.** There is no
portable way to see a socket address from inside the handler, so the default
subject is one shared bucket. That still bounds what one process will do, and it
is honest about what it is rather than pretending to be per-caller.

## 16. `security.txt`, and what a disclosure policy costs

`/.well-known/security.txt` (RFC 9116) is built, and **an unconfigured Host
serves nothing rather than a placeholder**. A `security.txt` pointing at an
address nobody reads is worse than none: it is the difference between a
researcher looking for another way to reach you and a researcher believing they
already found one. `Expires` is computed from now for the same reason — a stale
one is a document stating in machine-readable form that it is unmaintained.

The written policy is drafted in [`34-security-disclosure.md`](34-security-disclosure.md)
with **five decisions left explicitly open**: the contact address, the response
times, the disclosure window, where credit is published, and whether to publish
a PGP key. Those are commitments, and writing commitments on somebody's behalf
is how a policy ends up being one nobody intends to keep.

Two items from `docs/29` §6 remain unbuilt and are named there: the signed
**authorisation letters** (Kith's `authz.md` ports directly, and the point of it
is that the researcher holds something that does not depend on us still
existing), and publishing the **threat model** — already written as `docs/03`
§10, and needing a page rather than code.

---

## 17. Typing, receipts, and one bug the wiring found

The reducer has handled `m.typing` and `m.receipt` since `docs/04` §3 was
implemented, and nothing sent either. Wiring the send side found two things.

**`send` was building an optimistic message for a typing notice.** Every send
went through one path — optimistic row, encrypt, persist, transport, apply the
echo — and an ephemeral event has none of those needs. A typing notice
therefore put a blank pending message in the timeline. Ephemeral now branches
early: encrypt, persist, send, stop. No optimistic row, no outbox entry, no echo
applied, because there is nothing that will ever be stored to reconcile against.

**`receive` was about to persist ephemeral events.** They reached `putEvents`
like anything else. `docs/03` §7 says not stored, dropped if nobody is
listening, meaningless a second later — persisting one means writing a row to
disk to say somebody might be about to type, and replaying it later as though
they still were. They are now partitioned out before the store and before the
reducer, which already refused them for the same reason.

Typing state lives only in memory and expires when somebody asks rather than on
a timer: a timer per room is a resource, and nobody asks about typing except a
room somebody is looking at. The send side is throttled *inside* `RoomSync`, so
the obvious call site — one per keystroke — is correct.

`unread` never counts your own messages. Sending something is the strongest
possible signal you have seen it, and a room showing one unread because you
spoke in it is a badge nobody trusts.

## 18. The local store is sealed to the device now, not the account

`docs/03` §1 asked for this and `store.rs` carried a note saying only the
derivation had to change. It has.

The difference is not subtle. **The account secret is the thing that gets backed
up and wrapped for recovery** (`docs/03` §3), so sealing local state under it
means anybody who recovers an account can open a stolen disk image from any
device that account ever used — including devices signed out years earlier.
Sealed under the device key, a local store is worth exactly as much as the
device it came from, and losing that costs a resync rather than a history.

The sealing magic moved with the derivation (`REVELGS\x01` → `\x02`), so a blob
from the previous format is refused by name rather than failing to authenticate
— the difference between "this is from an older build" and "your crypto is
broken", at exactly the moment somebody is trying to work out which.

`Device::exportGroup` no longer takes an `Account` at all. The thing that seals
is the thing that holds the key, which is a smaller API and a harder one to
misuse.

### The half of `docs/03` §1 that is still not there

It also wants a **non-extractable `CryptoKey`**, so a compromised page could use
the sealing key without being able to copy it. That is structurally unreachable
from here: a non-extractable WebCrypto key cannot be handed to wasm, so having
one would mean moving the sealing into TypeScript — which would put decrypted
MLS state on the JavaScript heap on every export. That is a straight trade of
one exposure for another, and **both sides of it are outside the threat model**
(`docs/03` §10 does not defend against an attacker who already controls the
device). Recorded rather than resolved.

## 19. Content-free push

`docs/04` §5's rule, and the sentence that makes it safe to keep thin:
"**Reconcile-on-open means a missed push never means a missed message.**" A push
is a nudge, not a delivery — it carries nothing, it is allowed to be lost, and
everything it would have said is already fetchable. So the design question is
never what to put in it, but **who gets woken and what waking them reveals**.

Four rules, all tested, and the tests are almost entirely about who does *not*
get woken:

1. **Only `normal` events.** A `silent` event never notifies by definition — a
   read receipt that woke a phone would be the most annoying feature ever
   shipped, and a reaction that did would be the second.
2. **Only devices with no live socket.** A connected device already has it.
3. **Never the sender's own account.** This is an account-level rule and writing
   it at the device level is how a laptop ends up buzzing about a message you
   just sent from your phone — which is exactly what the first implementation
   did, and what the test caught.
4. **A revoked device gets nothing**, and its subscription is dropped at
   revocation. The one action whose entire purpose is "stop talking to that
   device" must not leave the loudest channel open.

Also: a deduplicated retry does not push twice. A dropped response is not a
second message and must not be a second buzz.

**Default payload: nothing at all.** That is the strongest reading of
content-free — a push with no body needs no RFC 8291 payload encryption and
tells the push service nothing beyond "this endpoint had something happen". The
`{room}` hint is opt-in per deployment and costs a room id handed to a service
that had none.

### What is a seam

Putting a push on the wire is a `PushSender` dependency and the default does
nothing. VAPID (RFC 8292) is a signing scheme against a service this codebase
cannot reach from a test, and a subtly wrong implementation of it fails
silently, per device, in production — which is worse than an absent one. The
part that is Revel's (who, when, what may be said) is here and tested; the part
that is a protocol against somebody else's server is a deployment's to supply.

---

## 20. C1: the interface was wrong, and here is the measurement

`docs/33` set the test: "When the real core lands, the work is swapping the fake
core for the real one **behind the same interface**. If that turns out to be a
large change, the interface was wrong — and finding that out costs one refactor
rather than a rewrite."

It is a large change. The reason is not that the real core is missing things —
though it is missing some — but that **there was never an interface**. The thing
`apps/web` was built against is one object with **94 members**, and they belong
to at least six unrelated concerns:

| Members | What they are | Can `RevelCore` back them? |
| ---: | --- | --- |
| **27** | Conversation, directory, identity | **Yes, today.** |
| 7 | Thread helpers (`repliesTo`, `threadSummary`, …) | The data is there; these are view-level derivations over it. |
| 20 | Spaces, roles, invites, moderation | No — phase 3, and the server has none of it. |
| 13 | Settings (notification rules, privacy, storage, emoji) | No. Notification rules are skipped by decision; the rest is unbuilt. |
| 14 | View state (`replyTo`, `editing`, `membersOpen`, …) | **No, and never.** |
| 7 | Faces and plurality | No — specified in `docs/11`, unbuilt. |
| 6 | Identity flows (key changes, recovery, passkeys) | No — phase 1's remaining half. |

That last row of "no" is the interesting one: **14 of the 94 must not move into
the core at all.** `replyTo`, `editing`, `membersOpen`, `profileFor` are per
window, they die with the tab, and a headless agent host (`docs/06` phase 4) has
no opinion about whether a member list is open. A core that held them would be a
core one platform could use.

### What C1 built

`packages/core/src/app/` — four interfaces rather than one object:

- **`ConversationCore`** — messages, sending, editing, redacting, reacting,
  pinning, attachments, typing, read state, local search.
- **`DirectoryCore`** — which rooms exist, opening a DM by name or key, group
  rooms, membership, and the MLS roster (which is *not* the membership list).
- **`IdentityCore`** — this account, its handle, its profile, its devices.
- **`ConnectionCore`** — whether the socket is up.

Plus `LiveCore`, the real implementation over `RoomSync`/`GroupSync`/
`Attachments`/`HttpTransport`, and **19 tests that drive nothing but the
interface**. If a scenario needs to reach past `core` into `RoomSync`, the
interface has a hole; none of them do.

Two places `LiveCore` deliberately does more than the transport underneath:

- **`directory.addMembers` also commits.** Adding somebody to a room is
  delivery; the commit is access. A caller that had to remember both would
  eventually forget, and the failure mode is a room full of people who cannot
  read it.
- **`conversation.send` stops typing.** Sending is the end of typing, and saying
  so beats waiting for the notice to time out on the other side.

### What C2 has to do first

The shapes differ where it matters. The fake's `Message` has `faceId: string`
and looks the face up in a global map; the real one carries `face?: FaceRef`, a
snapshot taken when the message was sent — which is `docs/04` §2's rule, and the
reason renaming a face does not rewrite history. Every component that renders a
message has to stop doing the lookup.

That is the refactor `docs/33` said this exercise would either avoid or expose.
It exposed it, which is the cheap outcome.

---

## 21. C2: the message list, on the real shape

The timeline, thread panel, composer reply banner and search results now render
**`packages/core`'s `Message`**, not the fixture's. The fixtures are unchanged;
a seam translates them.

### The seam, not the fixtures

`asCoreMessage` maps one shape to the other, and doing it there rather than
rewriting `data.ts` is the whole reason this was a day and not a week: the
fixtures stay readable as fixtures, and there is exactly one function to delete
when the source becomes `LiveCore`.

Four differences it has to reconcile, each of which is a real protocol decision
rather than a naming preference:

- **`faceId` → `face`.** The fixtures store an id and look it up in a global
  map; a real message carries a **snapshot** taken when it was sent (`docs/04`
  §2). That is why renaming a face does not rewrite everything it ever said.
  `MessageRow` now keeps the two apart on purpose: name and colour come from the
  snapshot, the agent badge comes from the current roster (`docs/11`: always
  rendered), and an avatar prefers the current face because an avatar is a fact
  about the person now.
- **`deleted` → `redacted`.** A redaction is an in-band act by a person; a
  *purge* is the server dropping the bytes and nobody choosing it. Two facts,
  two words, and the UI says different things for each.
- **Reactions are keyed by account, not face.** A reaction is a person's; a face
  is a presentation of one. The mapping carries both, because the protocol needs
  the account and the hover tooltip names faces.
- **One annotation becomes a list.** `docs/04` §2 allows one per (target,
  author, kind), so a translation and a transcript can coexist.

### The mapping had to stop reaching for a global

It first read the `core` singleton, which made it untestable — and this is
precisely the code where being untestable matters, because **a mapping that
silently drops a field produces a perfectly well-typed message that renders as
an anonymous grey blob, and no type checker will ever mention it.** Taking the
face map as an argument turned that into twelve tests, one of which asserts
every fixture message in every room comes out with a face.

### What was verified, and what was not

Verified: `svelte-check` at 468 files, 0 errors, 0 warnings; the production
build; the dev server serving the app with no runtime errors; and the mapping,
field by field, against real fixtures.

**Not verified: how any of it looks.** The preview automation in this
environment could not screenshot or evaluate against the page, and there is no
DOM test environment installed. Type-correct is not the same as
right-looking — a grouping rule or a reply banner can be wrong in a way only
eyes catch. `docs/33`'s "the reference page is the visual check" is the step
still owed here.

---

## 22. C3: the directory, and a modelling error the real shape exposed

The DM list, the command surface and search now name a conversation through a
directory seam that produces `RoomInfo`. Translating to the real shape found the
same class of thing `messageShape.ts` did, and this one is worse.

### The fixtures key a DM by *face*

`Dm.withIds` is a list of face ids. `docs/11` is explicit that a face is a
presentation of an account and the account is the identity — so a DM list keyed
by face gives you **two conversations with the same person under two of their
names**, which is precisely the failure that document warns about rather than a
tidiness complaint.

`RoomInfo.members` is accounts, so the mapping resolves through the face table
and de-duplicates. A test asserts that two faces of one person in one
conversation produce one member, and titling goes by account too: somebody who
speaks as two faces is one person in the room, and a title listing both would be
describing the presentation rather than who is there.

This was invisible while the fixtures and the UI agreed with each other. It
became obvious the moment either had to produce the shape the server uses, which
is the argument for doing the translation at all.

### Spaces are partly here, and say so

`DirectoryCore` describes rooms a Host serves. `docs/06` puts spaces, roles and
overrides in phase 3 and the server has none of them, so a space room maps to a
`RoomInfo` with a `space` id and an **empty member list** rather than inventing
one. What is real today is DMs and group DMs.

### Still not verified: how it looks

Unchanged from §21. `svelte-check` at 470 files / 0 / 0, the production build,
and 21 tests across the two seams — but the preview automation in this
environment cannot screenshot or evaluate the page, and no DOM test environment
is installed. Type-correct is not right-looking, and that check is still owed.

---

## 23. What the face-linking control can and cannot promise

`docs/11`'s "Linking faces" is off by default and says: *"each face appears as
an independent person. Nothing in the UI connects them."* It then explains why
this is a real control rather than a display preference — *"with linking off,
the server never learns the connection either, since it never sees faces at
all."*

That is true, and it is **not the whole threat.** Building the directory seam
made the gap concrete, so it belongs written down next to the promise.

### The server cannot tell. Another member can just read it.

Faces live inside the ciphertext, so a Host sees accounts and never faces.

**Corrected on 2026-08-31, and the correction is worse than the original
finding.** This section first said the leak was a *counting* attack: a member
sees how many accounts are in the roster and how many faces have spoken, so four
faces across three accounts means somebody is plural. True, and not the sharp
edge.

The sharp edge is `SyncEngine.#accountFor`. Attribution is per *account* and it
is cryptographic — a message's sender is an MLS leaf, the leaf resolves through
the roster to the account that owns it, and the face is a field inside the
message payload. So **two faces of one account posting in one room hand every
member a direct link**: two messages, same account, different faces. No
counting, no timing analysis, nothing to infer. The client renders the face and
not the account, and that is a courtesy rather than a boundary — the account id
is already in what every member received.

Counting is the residual case: faces in *different* rooms, or a face that has
not spoken. No UI change fixes either, because per-account attribution is what
makes a message attributable at all.

### Which means the honest statement is narrower than it reads

Linking off protects against **the server**, and against a client that
carelessly renders two faces as one person — which is a real failure and one
this codebase committed and then fixed. Against a member of a room you have used
two faces in, it protects against nothing at all.

For somebody who needs that stronger property, the answer is already in the
design and is a different feature: `docs/17`'s **multiple accounts**, which are
*cryptographically* unlinkable — separate device keys, separate sessions,
separate push subscriptions, and nothing in the protocol connecting them. That
is the tool for "nobody may know these are the same person"; faces are the tool
for "I present differently in different places".

**`docs/11` should say so** — as written, somebody reading only the linking
section could reasonably conclude that faces are unlinkable to everyone, and
that is the kind of misunderstanding that gets somebody outed.

**Decided (2026-08-31): it now does.** `docs/11`'s linking section carries the
limit inline, under *"what linking-off does not protect against"*, and points at
`docs/17`'s multiple accounts as the tool for the stronger property. It also
asks for the warning to appear in the **face switcher** — at the moment somebody
picks a second face, which is the moment they are deciding what they are relying
on. A limit that lives only in a document is one the person it protects will
never read. It was
raised here rather than edited straight in because narrowing a privacy promise
is Viola's call and not a footnote — but the narrowing does not weaken anything
real. It describes the system that was always being built; only the sentence
describing it was too generous.

---

## 24. C4 and C5: connection, and one matcher instead of two

**C4 — connection.** The fake reported `online | connecting | offline` from
`navigator.onLine`; `ConnectionCore` reports `connecting | open | closed` and is
explicit that it means **the socket, not the network**. Those are genuinely
different questions: `navigator.onLine` is true on a captive-portal wifi that
will not carry a byte, and the thing that decides whether messages arrive is
whether the socket is open. The seam translates, and when `LiveCore` takes over
the status comes from `WebSocketStream.onStatus`, which knows the real answer.

Two things fixed on the way past: `setConnection` called `flushPending` twice,
and `flushPending` is now honest in its comment about being a fixture standing
in for an outbox — the real core re-sends nothing on reconnect, because flipping
`pending` to delivered claims a success the server never gave (`docs/32`).

**C5 — search.** The app had its own matcher: its own query parser, its own
scoring, its own excerpt window, its own mark merging. `packages/core` had
another. **Two implementations of the same thing, and one of them was going to
drift.** The app now keeps what is genuinely its own — scope, the time window,
the index-progress state — and hands the matching to the core, which is exactly
the split `docs/03` implies by making *what is searchable* a policy question and
having `search` take its rooms as an argument.

`search.svelte.ts` lost 110 lines.

### A divergence the swap exposed

`packages/core`'s `has:image` filter reads an attachment's **MIME type**,
because that is what a real `BlobRef` carries. The fixtures describe an
attachment by `kind`, because that is what a renderer needs. Left alone, the
app's search and the core's would have disagreed about what an image is — the
kind of difference that shows up as "search says there are no images in this
room" and takes an afternoon. The seam derives one from the other, with a test.

---

## 25. D1 and D2: fuzzing, and a Host that is not playing fair

`docs/29` §4 asks for both by name. Each found a real bug on the first run.

### The fuzzer found a decoder that lied about its own type

`parseEncrypted`'s unknown branch declared `raw: Record<string, unknown>` and
produced it by casting. A payload is decrypted JSON and **JSON is not always an
object** — a member with a buggy client can send `"hello"` or `[1,2,3]` as an
entire body, and the cast made the declared type false for exactly those.

That matters more than a type-checker complaint, because `docs/29` §1 rule 2
says unknown content is "preserved and re-emitted": a v1 client editing a v2
event must round-trip what it does not understand. You cannot preserve a string
into a type that cannot hold one, and everything downstream — the reducer's
`unknown` field, the fallback renderer — inherited the same lie. `raw` is now
`unknown`, which is what it always was.

The property the fuzzer tests is deliberately modest: **never throw, never hang,
never claim something is valid that is not.** A decoder that throws is one
somebody forgets to wrap; one that hangs is a denial of service; one that is
optimistic is a hole. Seeded, so a failure is reproducible — a fuzzer you cannot
re-run finds a bug once and never again.

### The malicious Host found two

Twelve scenarios where the server does what a hostile operator plausibly would.
The shape of every assertion is the same: the client **fails safe**. "Nobody can
read this any more" is an acceptable outcome of an attack; "everybody reads
something the attacker chose" is not.

Two things it caught:

**A forged handshake record threw out of the client.** `GroupSync.#apply` called
`crypto.process` unguarded, so bytes a Host made up became an exception in
whatever happened to be on the stack — a socket callback, usually. It now
refuses and reports through `onRefused`.

And the interesting part is what it does *not* do: **the cursor does not
advance.** Skipping past a record that failed would mean a legitimate commit
lost to a transient failure is lost permanently, leaving the device an epoch
behind forever with no signal — the unreadable-room failure nobody can diagnose.
Not advancing means a Host that keeps serving garbage at one sequence number
stalls the group, which is a denial of service it could perform just as easily
by serving nothing at all. **A capability the attacker already has is not worth
trading a silent corruption for.**

**A purge was invisible to catch-up.** A tombstone carries the *id of the event
it erased*, so it is never "newer than the cursor" and an id-filtered catch-up
walked straight past it. A device offline when a message was purged would keep
its decrypted copy forever while everybody else dropped theirs — a client
silently diverging from the room, which is the one outcome a tombstone exists to
prevent. Tombstones now come through the filter; re-applying one is idempotent.

### What the suite establishes

The server cannot forge a commit, cannot add itself to a group by claiming
somebody did, cannot make a member skip or replay one, cannot change a word of a
message, cannot re-attribute one by rewriting `Event.sender` (attribution comes
from the MLS leaf, never the envelope), cannot hand a stranger an unclaimed
Welcome, and cannot make a withheld message unrecoverable.

What it *can* do, and the tests say so plainly: put anybody in a room — and
still not let them read it.

---

## 26. D3: the budgets, measured — and the bug that measuring them found

`docs/29` §5: *"Claims need numbers, and numbers need to be measured or they
rot."* Here are the numbers, on this machine, through the wasm a browser runs:

| `docs/29` §5 | Budget | Measured |
| --- | --- | --- |
| Cold open → room painted from local store (5,000 events) | < 300 ms | **31 ms** |
| Room switch, cached snapshot of 5,000 | < 100 ms | **9 ms** |
| Keypress → local echo, into a 5,000-message room | < 16 ms | **0.3 ms** |
| MLS commit + apply, 200 leaves | < 500 ms | **35 ms** |
| Reduce 32,000 events | — | **29 ms**, and 8× the events costs 9.6× |
| Message list scroll, 100k events, 60 fps | — | **not measured** |
| Decrypt + render an incoming message | < 50 ms | **half measured** |

### The cold-open path was 430× slower than it needed to be

`IndexedDbStore.listEvents` walked a cursor and called `continue()` for every
row — **one event-loop round trip per event**, on the one path that runs before
the first paint. Writing 5,000 events took 78 ms and reading them back took
**5,639 ms**. The asymmetry is what gave it away: a slow storage layer is slow at
both, and this was 72× worse in one direction.

`getAll` fetches the page in a single request: **5,639 ms → 13 ms.** The cursor
survives on the backwards path, because `getAll` cannot walk in reverse — but
that path is `backfill`, bounded by a page of 50, where nobody is waiting on a
first paint.

This is the whole argument for §5 existing. Nothing was *wrong*: every test
passed, the store's conformance suite passed against both implementations, and
the room rendered correctly. It was just slow in a way that only shows up when
somebody puts a number next to it.

### How the assertions are set, given this is not a fixed machine

`docs/29` wants these "measured in CI on a fixed machine where possible", and
this is whatever the suite happens to run on. A timing test that flakes gets
disabled, and a disabled budget is not a budget — so the file separates two
jobs: **every measurement prints**, because a number nobody sees cannot be
noticed moving; and the assertion is set where a real regression trips it and
machine noise does not. With an order of magnitude of headroom on every row, the
budget itself is that threshold.

The scaling check is a **ratio**, not a time: 8× the events should cost roughly
8× as much, and the alarm is at 24×. That says something about the algorithm
rather than about the machine, and it is what catches an accidental O(n²) — the
failure that passes at 5,000 events and ruins the app for anybody who has used
it for a year.

### Two rows are not measured, and say so in a test

**60 fps over 100k events** and the *render* half of **decrypt + render** both
need a renderer, and there is no DOM in this environment. That omission is
written as a test rather than left as a gap, so it sits in the same list as the
budgets and cannot quietly become "we measure §5". `docs/33`'s reference page is
where they belong.

---

## 27. A5: Postgres, and a concurrency test that was lying

The deferred track-A item, unblocked by Docker being available. `PostgresStore`
implements all 52 methods of `Store`; `compose.yml` brings up Postgres 17;
`schema.sql` is `docs/04` §1 as tables and is applied idempotently by
`migrate()`. The server picks its store from `DATABASE_URL` and **prints which
one it chose at boot** — a Host that came up on memory because a connection
string was misspelled would work perfectly and lose everything on restart, which
is the worst way for that mistake to behave.

### One suite, two stores

`MemoryStore` is what every other test in this repo runs against, which makes it
load-bearing in a way a test double usually is not: **if it has drifted from
Postgres, the whole suite goes green while production is wrong.** So the
contract is written once, in `store.conformance.ts`, and run against both — 40
tests each. `docs/29` §4's "the in-memory implementation lets the whole test
suite run with no database" is only true if the two are the same implementation
of the same contract, and the only way to know that is to check.

The Postgres half skips when `DATABASE_URL` is unset, so `pnpm test` stays
hermetic on a machine without Docker. That is a real trade and worth naming: a
contributor can break Postgres without their local run noticing. It is one
environment variable and a `docker compose up -d --wait` away.

### The ordering bug that has not happened yet

Snowflakes are text — they exceed 2^53 and JSON has no bigint (`docs/04` §6) —
and clients order them with `compareIds`, which compares as `BigInt`. A plain
`ORDER BY id` in Postgres is **lexical**, and lexical disagrees with numeric the
moment two ids differ in length: `'9999999999999999999'` sorts *after*
`'10000000000000000000'` because `'9' > '1'`.

Every ordered read sorts by `(length(id), id)` instead, which is exactly numeric
order for decimal strings with no leading zeros — which is what a snowflake is —
and the indexes are built on the same expression so the sort is free. There is a
conformance test that inserts one id either side of a digit boundary, because
this is invisible until a room crosses one, at which point history quietly
reorders itself and no amount of testing at 19 digits would have caught it.

### And a test that passed for the wrong reason

Four things Postgres has to do that a `Map` cannot: one commit wins a race, a
one-time key package is never handed out twice, a challenge is spent once, a
duplicated retry deduplicates. `MemoryStore` gets all four for free because
JavaScript does not interleave, so these live outside the shared suite.

The one that matters is the **commit race**: two devices read epoch 4, both are
told to go ahead, and the group forks in a way nothing can repair — everyone
after the fork fails to decrypt, sender included. `SELECT … FOR UPDATE` on the
group row is the line that prevents it.

**The test passed with that line deleted. Twelve times out of twelve.**

The reason is that `postgres` opens pooled connections lazily, so the first
transaction finished in well under the millisecond the second needed to
TCP-connect and authenticate. The two never overlapped, nothing contended, and
the suite cheerfully reported that a lock it had never exercised was working.
Warming the pool before racing anything fixed it: **six failures out of six with
the lock removed, zero out of six with it restored.**

Worth writing down as a general shape rather than one bug. A concurrency test
that passes tells you nothing on its own — the only thing that makes it evidence
is watching it fail when the protection is removed. Every one of the four here
was checked that way, and the check is cheap: delete the line, run it, put it
back.

### What is still missing

~~Real migrations~~ — done in §30.
~~Blob bytes are in a `bytea` column~~ — there is a seam now (§30), with a
filesystem implementation and the conformance suite running against both. And
the Host's
external-sender key was still generated per process (§8) — Postgres does not fix
that, because it is a secret and a database is not where secrets go; §29 does.

---

## 28. What the review found in §27, one day later

`/code-review` over the three preceding commits, at `high`. It ran the
conformance suite against real Postgres and then wrote throwaway probes for the
divergences the suite does *not* cover — five findings experimentally confirmed
rather than inferred. Worth recording because the pattern is repeatable: **the
suite proves the two stores agree about what it asks; the interesting bugs are
in what it does not ask.**

### Three races the conformance suite structurally could not see

**`claimKeyPackage` racing itself.** The outstanding-claim check was an unlocked
read, so two overlapping claims for the *same* (group, device) both saw "no
claim", both took a package, and only one was recorded. The shelf went down two
for one add — exactly the retry-loop drain the authorised claim exists to
prevent (`docs/03` §5), reintroduced in the gap between the read and the write.
§27's own concurrency test raced two *different* groups and could never reach
this path.

**`claimHandle` racing.** Both transactions read the handle as free, both
inserted, and the loser got a `duplicate key` exception rather than
`claimed: false`. `accounts.ts` does not catch, so a routine collision became a
500 where the route is written to return 409 `handle_taken` — and `types.ts`
promises "the existing binding when the handle is taken".

Both are fixed with a transaction-scoped advisory lock, because in each case the
row whose *absence* is the problem cannot be locked. Both new tests were checked
the way §27 argues for: **four failures out of four with the lock removed.**

**And the shard.** `SnowflakeFactory(0)` was hardcoded, which was harmless while
"one process" was the only mode and became a corruption bug the moment §27 made
"two processes, one database" the point. Two Hosts on shard 0 mint colliding ids
within any millisecond both are busy; `appendEvent`'s `ON CONFLICT` arbitrates
on `(sender, client_nonce)`, so a primary-key collision escapes as an unhandled
500, and a blob collision was silent. Now `REVEL_SHARD`, printed at boot.

### Two divergences the suite missed by never asking

**`putBlob` on a colliding id.** Postgres refused the write and returned the
caller's blob anyway — a 201 for ciphertext that was discarded — and worse,
re-uploading over a *purged* id reported `purgedAt: null` for a row that was
still purged with its bytes gone. Memory overwrote instead, silently replacing
somebody else's ciphertext. Both wrong, in opposite directions. Now: first write
wins, and **the stored row comes back**, in both stores and in the route.

**`createGroup` on an existing id.** Memory reset the group to epoch 0; Postgres
did not. A group rewound to epoch 0 accepts a stale commit built at epoch 0 —
which is the fork that `appendHandshake`'s locked transaction exists to close,
re-opened from the other end.

Both are now conformance tests. The lesson is narrow and useful: the suite tested
every method, and missed these because it tested each method *once*. The
divergences live in the second call.

### And the ordinary stuff

`purgeEvent` had no `purged_at IS NULL` guard, so a double-clicked moderation
action rewrote when the purge happened. `challenges` and `sessions` only clean
themselves on the read path, and the read that would clean them is the one that
never comes — an abandoned sign-in never spends its challenge, a client with an
expired token does not present it again — so there is now `sweepExpired`, two
indexes, and an hourly timer, because a method nothing calls is a leak with
documentation. `appendHandshake` took a round trip per device *while holding the
group lock*, which is the one place in the store where a round trip is charged to
every other writer; it batches now, and there is a test that adds three devices
at once, because every other test added exactly one and the batched SQL was
otherwise never executed. `compose.yml` said `up -d`, which returns before
Postgres accepts connections on a cold volume — the exact case its own
healthcheck comment described, and nothing consumed that healthcheck without
`--wait`.

### The one that was not in the store at all

`EncryptedEvent.mentions` was typed `Id` — the generic snowflake, the same shape
as `FaceRef.id`. `docs/35` rule 6 promises an `@` at any of your faces reaches
you, and the engine implements that by matching the reading **account**. So a
client that put the face id it had just rendered into that list would produce
**silence, with no error anywhere**. It is `AccountId` now, matching
`EventInput.notify`, which it mirrors.

Being honest about what that buys: the shape cannot enforce it, because a
snowflake is a valid base64url string. What it buys is the call site and the
name. The same class of bug as `notify` being typed as a snowflake (§11) — twice
now, in the same pair of fields, which suggests the lesson is about the field
pair rather than about either field.

### And a duplicated rule

`apps/web` already had `NotifyLevel = 'all' | 'mentions' | 'none'` — the same
three states as `Loudness = 'everything' | 'mentions' | 'nothing'`, spelled
differently — and its own room → space → global precedence walk. Two spellings
and two implementations of the rule `docs/35` calls the specification, created
the same day the specification was written.

The web's names now come from core (`docs/05` §8 says "everything / mentions /
nothing", so the doc's words win), and `notifyFor` delegates to a new
`resolveSetting`, which returns **where the setting came from** as well as what
it is. That was already what the room menu needed to tick "Use the space
default", and computing it in the UI was the reason the second implementation
existed at all.

878 tests with Postgres, 828 without, `svelte-check` clean.

---

## 29. The Host's key, and the rules engine that had no callers

Two follow-ups, both of the same kind: something specified, implemented and
tested, that was not actually *load-bearing* yet.

### The key that could not survive a restart

`docs/03` §5 lets a Host act as an MLS **external sender** — it may propose into
a group it cannot read, which is how a moderator's "remove this device" becomes
an actual Remove. Its signature key goes in the group's `ExternalSendersExt`,
and an extension is **part of the group context**, which every member has
already committed to.

So the key is permanent in a way server secrets usually are not, and
`index.ts` generated a fresh one at every boot. The failure mode is the bad
kind: the groups are fine, the members are fine, and the Host's proposals are
simply refused forever, with nothing reporting it.

§27 made this *worse* rather than exposing it — Postgres meant the groups now
survive a restart, so a Host would come back holding every group it had ever
opened and unable to act on any of them.

- `hostkey.ts` reads and writes a `0600` JSON file, or takes `REVEL_HOST_KEY`
  for deployments that inject secrets as environment rather than volumes.
- `pnpm host-key` writes one. Named that rather than `init` because `pnpm init`
  is a pnpm builtin that writes a `package.json`, and a command that does
  something entirely different depending on whether you typed `run` is a trap.
- Nothing creates one implicitly, and `writeHostKey` refuses to overwrite. A key
  that appears by itself is a key nobody backed up, and this one cannot be
  regenerated from anything.
- The certificate is **verified on load**, not trusted. A hand-edited file that
  still parses would otherwise publish a signature key nothing can check, and
  the failure would surface months later as "the Host's proposals are refused".

**The rule the whole thing turns on: the identity's durability must match the
store's.** An ephemeral key is fine when the groups are in memory too, so
`revel dev` is unchanged. The moment `DATABASE_URL` is set, a missing key file
is a refusal to start with instructions — because this is a misconfiguration
that works perfectly right up until somebody needs the Host to moderate
something.

Verified end to end rather than only in unit tests: two boots against the same
file publish byte-identical `externalSender` at `/.well-known/revel/host`.

And `createHostIdentity` in `auth.ts` is now a one-line alias for
`generateHostIdentity` rather than a second implementation — the same
duplication §28 caught in the notification settings, avoided this time by
noticing it while writing the replacement.

### A pure function that nothing called

`docs/35`'s rules engine was specified, implemented, documented and tested for a
day with **no callers at all**. Every test passed. A pure function nothing calls
passes every test it has, which is precisely why "we wrote the tests" is not the
same claim as "it works".

It is wired into `RoomSync.receive` now, after the store write and before the
reducer commit — so the event is durable by the time anything is told about it,
and a notification can never point at something a reload would lose.

The engine deliberately does not own settings or room metadata; it knows a room
id and a ciphertext. So `NotifyDeps` injects the settings, the room's place, and
the clock, and `deliver` is called for **every** decrypted event rather than
only the notifying ones — because the other half of `docs/05` §8 lives in the
decision too, and the room list needs `mark` to know whether to draw a badge or
a quiet dot.

Three things worth recording from doing it:

- **`replyTo` in the payload is a message id; the rule is "a reply to *you*".**
  The engine resolves the author from `RoomState.byId`, which is where the
  answer already is. A reply to a message that has been backfilled away simply
  does not match, which is the right failure.
- **A room the directory has not loaded produces no decision at all.** A guessed
  `kind` would turn a DM into a space room and silently downgrade it to the
  global default — the sort of bug nobody would ever trace back to here.
- **`broadcast` is not derived, and that is a gap rather than a decision.**
  `docs/04` detects `MENTION_EVERYONE` client-side "on rendering the ping",
  which means parsing the rich text body; there is no flag on the payload. Until
  there is, an `@everyone` reaches people through the ordinary room setting
  rather than through rule 8. Written in the code where the field would go.

`notifywiring.test.ts` drives all of it through the multi-client harness — MLS,
a server, a socket, a reducer — because that is the difference between the
function being correct and the function being reached.

897 tests.

---

## 30. Phase 1 identity: OPAQUE, the wraps, and a second factor

`docs/06`'s phase 1 line — "OPAQUE register/login; account key; three wraps
(password, recovery code, passkey)" — built as far as the server and the crypto
go. What is here: the envelope, the IdP, and TOTP. What is not: the QR
device-add flow, WebAuthn/passkey enrolment, and the client UI for any of it.

### The envelope (§, and its own commit)

Covered above. The one thing worth repeating is the rule the API enforces:
**a sign-up must carry both the password wrap and the recovery wrap**, checked
at the server rather than trusted to the client. An account with only the first
is one where forgetting the password is fatal, and it looks completely fine
until the day it isn't.

### OPAQUE

`@serenity-kit/opaque`, which wraps the `opaque-ke` crate — the option
`docs/03` §14 already named. Not written here, and that is the decision: an
augmented PAKE is exactly the kind of thing where a subtly wrong implementation
passes every test you think to write.

What the IdP stores is a registration record it cannot invert and three wraps it
cannot open. **A dump of this database is not a way into anybody's messages**,
and there is no `password_hash` column anywhere to be tempted by. There is a
test that asserts the password does not appear anywhere in what was stored,
which is a low bar and worth having on the floor.

Three decisions in the routes:

- **One refusal for three failures.** Wrong password, unknown handle and spent
  session all return `bad_credentials`. Telling them apart is an oracle for
  which handles exist, and "does this person have an account here" is not a
  stranger's question to have answered.
- **`register/start` does not check whether the handle is taken.** It hands back
  a response derived from the request and nothing about the account, so
  answering identically either way keeps it from being a handle oracle for
  anybody who has not yet committed to a registration. The real check is the
  insert at `finish`.
- **The second factor is asked for after the password checks out, never
  before.** Asking first would tell somebody guessing passwords when they had
  got one right — precisely the signal 2FA exists to deny them.

### TOTP, and the parts that are not the maths

RFC 6238 in fifty lines rather than a dependency, checked against the RFC's own
published vectors — the only honest way to test an algorithm somebody else
specified. The maths is the easy half. The parts that bite:

- **Constant-time comparison.** A `===` leaks through timing how many leading
  digits were right, which turns one million-guess space into six thousand-guess
  ones. Every step in the window is checked even after a match, so the time does
  not depend on *which* step matched either.
- **A used code is not a code.** The accepted counter is persisted and refused
  next time. Without it, a code phished thirty seconds ago still works — which
  is most of what 2FA was meant to stop. The confirmation at enrolment spends a
  code like any other use, because setup is exactly when somebody is being
  walked through it by a stranger on the phone.
- **An unconfirmed secret never gates a login.** Otherwise a mistyped enrolment
  locks somebody out of their own account.

### And the setup key, which is as irreplaceable as the signature key

The OPAQUE server setup goes in the host key file (v2), for the reason §29 gave
about the signature key: **every registration record in the database was
produced against this setup**, so a new one invalidates every password on the
IdP at once. A v1 file still parses and simply does not serve an IdP — a missing
capability rather than a broken deployment, the same shape as `security.txt`
with no contact.

### What the tests found

Two things, both the sort that only appear when something real runs:

**The wire format was wrong.** `Opaque` was typed `z.string().base64()` and the
library emits **base64url**. That rejects every real message while accepting
every hand-written fixture, which is exactly how it surfaced — sixteen tests
failing at once with "invalid type: unit value". Wraps stay standard base64,
because unlike the protocol messages that encoding *is* ours.

**Memory let one account hold two handles.** Postgres has a unique index on
`account_pub`; the in-memory store checked only the handle. Two handles
resolving to one account would make the wraps reachable by a name their owner
did not choose. Caught by the conformance suite, which is the third divergence
it has found — and, as in §28, by asking a question nobody had asked before
rather than by any change to the code.

1,050 tests.

### Still missing from phase 1

The QR device-add flow (`docs/03` §3's convenient case), WebAuthn/passkey
enrolment for the third wrap, and every screen. The recovery flow exists as
crypto and as storage and has no UI, which means it cannot yet be *used* — and
`docs/03` is explicit that a recovery path people cannot find is one that does
not exist.

---

## 31. The real core in a browser, and the two budgets that needed one

Two things that had been "tested" without ever having *run*.

### `packages/core` had never executed in a page

1,104 tests and a multi-client harness, all in Node. `pnpm test:live` now signs
up two browsers, starts the real stack in each — MLS in wasm, IndexedDB, a
device-key session, a socket — opens a DM, sends, and reads it back on the other
side, with the Host holding ciphertext throughout.

Three bugs, and **two were in `packages/core` rather than in the wiring**:

- **`LiveCore` could join a conversation but not start one.** `refresh()` binds
  rooms that already have a group; nothing created one. `openDm` returned a room
  that could not be sent to. Every caller would have had to create the group,
  bind it and invite — and one of them would have forgotten. Now `openDm` and
  `openGroupRoom` do it, and `app.test.ts` got *shorter*: the steps it performed
  by hand were the missing ones.
- **A device never published key packages.** Nobody can be added to a group
  without them, and it fails silently from both ends — the inviter finds nothing
  to claim, the invitee never gets a Welcome. Every harness test called
  `replenish()` explicitly, which is exactly why nothing noticed that a real
  client has to do it for itself.
- The vite proxy forwarded three prefixes out of nine, and `/socket` needs
  `ws: true`.

The pattern is the one this project keeps finding: **a seam that both sides pass
their own tests across.**

### §5's last two rows, measured — and they are bad

`docs/29` §5 budgets "message list scroll, 100k events — 60 fps" and
"decrypt + render — 50 ms". Both needed a DOM; there is one now.

| messages | rows in DOM | open | frame p50 | frame p95 | arriving message → painted |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 1,000 | 1.2 s | 8.3 ms | 9.3 ms | **303 ms** |
| 5,000 | 5,000 | 10.1 s | 8.4 ms | 25.0 ms | **5,366 ms** |
| 20,000 | — | **tab crashes** | | | |
| 100,000 | — | never renders | | | |

**The message list is not windowed.** Every message is a row in the DOM, so
100k is not a budget missed by a margin — it is one that cannot be reached by
tuning, because the browser gives up first.

The second number is worse and less obvious. An arriving message takes **303 ms
to paint in a room of 1,000 and 5.4 seconds in a room of 5,000**, against a
50 ms budget. It scales with the size of the list rather than with the message,
which means every insert re-renders everything. That is the number a person
feels: it is the gap between pressing enter and seeing what they typed.

Scroll frame times look fine, and are the least trustworthy figure here — at
5,000 messages the list is only about six screens tall, so p50 is measuring a
list that mostly fits. The honest reading is that scrolling was never the
problem; **building the list is.**

### Two measurement mistakes worth keeping

The first version scrolled `document.scrollingElement`, because the selector for
the real scroller (`.msgs`) did not match. It reported a flawless 8 ms while
moving zero pixels. The second scrolled the right element *downward* — and a
chat log opens pinned to the bottom, so it still moved nothing.

Both would have passed. A performance test that measures nothing does not fail,
it congratulates you, so the script now asserts that the scroller actually moved
and prints a warning when it did not.

### What this means

Windowing the message list is the fix for both rows, and it is a change to how
the list is *built* rather than to how fast it runs. It is also now the largest
known gap between what `docs/29` claims and what the app does — and unlike the
other five budgets, it is not close.
