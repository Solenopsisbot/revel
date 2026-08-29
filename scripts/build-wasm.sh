#!/usr/bin/env bash
#
# Build the crypto core for the web.
#
# `docs/26` §Option C: one Rust crate holds everything security-critical, and
# every platform reaches it through a binding. This is the web one. Output is a
# real workspace package, `@revel/crypto-wasm`, so `packages/core` can import it
# like anything else rather than reaching into `target/`.
#
#   pnpm build:wasm
#
# Requires the wasm32 target and the wasm-bindgen CLI:
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version 0.2.127
#
# The CLI version must match the `wasm-bindgen` dependency in
# crates/revel-crypto/Cargo.toml. It fails loudly if they drift, which is the
# good outcome — the alternative is glue that calls an ABI the module doesn't
# have.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/packages/crypto-wasm"
profile="${1:-wasm}"
artifact="$root/target/wasm32-unknown-unknown/$profile/revel_crypto.wasm"

echo "==> cargo build (profile: $profile, wasm32)"
cargo build --profile "$profile" --target wasm32-unknown-unknown -p revel-crypto --manifest-path "$root/Cargo.toml"

echo "==> wasm-bindgen"
wasm-bindgen "$artifact" --target web --out-dir "$out" --out-name revel_crypto

# wasm-opt would shrink this further, but binaryen is not installed and this
# script does not install things behind your back. If you want it:
#   brew install binaryen && wasm-opt -Oz -o <out>.wasm <out>.wasm
if command -v wasm-opt >/dev/null 2>&1; then
  echo "==> wasm-opt -Oz"
  wasm-opt -Oz -o "$out/revel_crypto_bg.wasm" "$out/revel_crypto_bg.wasm"
else
  echo "==> wasm-opt not installed, skipping (see comment in $0)"
fi

echo
echo "==> size"
for f in "$out"/revel_crypto_bg.wasm "$out"/revel_crypto.js; do
  raw=$(wc -c <"$f" | tr -d ' ')
  gz=$(gzip -9 -c "$f" | wc -c | tr -d ' ')
  br="n/a"
  if command -v brotli >/dev/null 2>&1; then
    br=$(brotli -q 11 -c "$f" | wc -c | tr -d ' ')
  fi
  printf '  %-24s %8s raw  %8s gzip  %8s brotli\n' "$(basename "$f")" "$raw" "$gz" "$br"
done
echo
echo "Wrote $out"
