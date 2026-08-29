import { defineConfig } from 'vite';

/**
 * A harness, not an app. It exists to answer one question — does moving the
 * crypto into a Worker actually keep the main thread free — and it answers it
 * by running the same workload both ways on one page.
 */
export default defineConfig({
  server: { port: 8788 },
  // The worker is an ES module because `@revel/crypto-wasm` is one.
  worker: { format: 'es' },
});
