/**
 * One wasm instance, however many callers ask for it.
 *
 * `revel_crypto.js` guards initialisation with
 *
 *     if (wasm !== undefined) return wasm;
 *
 * and that check happens *before* the `await` that fetches and instantiates.
 * Two callers that overlap therefore both see `undefined`, both instantiate,
 * and the second one to finish overwrites the module-level `wasm` with a
 * different `WebAssembly.Instance` — and, crucially, a different linear
 * memory.
 *
 * Every `Account`, `Device` and `Group` made before that swap keeps a pointer
 * that is now read against the wrong memory. The pointers still look valid,
 * because they are: they just address someone else's heap. What comes out is
 * `memory access out of bounds` from trivial accessors, borrow flags that look
 * permanently held, and a key-package store that reports zero entries while
 * insisting nothing has changed. See `docs/31` §32 and §33 for the whole hunt.
 *
 * It is intermittent for the obvious reason — it needs two `default()` calls to
 * actually overlap — and `session.restore()` starts three floating promises
 * that each want the wasm, so in practice they do.
 *
 * So: **nothing in the app calls `wasm.default()` directly.** It calls this,
 * which memoises the *promise* rather than a ready flag, so overlapping
 * callers all await the same instantiation.
 */

type CryptoWasm = typeof import('@revel/crypto-wasm');

let booting: Promise<CryptoWasm> | null = null;

/** The crypto wasm, instantiated at most once per page. */
export function cryptoWasm(): Promise<CryptoWasm> {
  booting ??= (async () => {
    const wasm = await import('@revel/crypto-wasm');
    await wasm.default();
    return wasm;
  })();
  return booting;
}
