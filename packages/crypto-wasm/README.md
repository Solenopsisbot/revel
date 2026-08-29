# @revel/crypto-wasm

**Generated. Do not edit.** Everything here except this file and
`package.json` is output from `pnpm build:wasm`, which compiles
`crates/revel-crypto` to `wasm32-unknown-unknown` and runs `wasm-bindgen`
over it.

This is the web half of the split `docs/26` §Option C settles on: Rust owns
MLS, device keys and envelope encryption; TypeScript owns the sync engine,
the room reducer, the local store, search and all UI. iOS and Android reach
the same crate through UniFFI instead (`crates/revel-crypto/src/ffi.rs`).

## Building

```
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127   # must match Cargo.toml
pnpm build:wasm
```

`pnpm build:wasm wasm-size` builds the size-tuned profile instead.

## Measuring

```
pnpm bench:wasm     # then open the URL it prints
```

Runs the same group-scaling benchmark as `cargo run --release --example bench`,
in a browser, so native and web numbers can be compared directly. Results for
both live in `docs/31` §5.

## What is not here yet

Group state and key packages both survive a reload — see
`crates/revel-crypto/src/store.rs` and `docs/31` §7. What does not exist is
anything that writes the sealed blobs to a real database; that is
`packages/core`.
