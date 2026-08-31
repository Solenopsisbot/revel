import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    /**
     * Everything the Host and the IdP serve.
     *
     * Enumerated from the routes rather than guessed, because guessing has now
     * cost two rounds of "404, and it looks nothing like a proxy problem":
     * first `/auth` (devices could register and never authenticate), then
     * `/rooms` (the real core could sign in and never open a room).
     *
     *   grep -rhoE "app\.(get|post|put|delete)\('/[a-z.-]+" apps/server/src
     *
     * `/socket` needs `ws: true` — a WebSocket upgrade is not an HTTP proxy
     * hop, and without it the socket connects to vite and hangs.
     *
     * `docs/02` splits Host and IdP into separate roles; they are one process
     * in development, which is why one target serves both here.
     */
    proxy: {
      ...Object.fromEntries(
        ['/idp', '/auth', '/rooms', '/groups', '/welcomes', '/blobs', '/push', '/.well-known'].map(
          (prefix) => [prefix, { target: 'http://localhost:8080', changeOrigin: true }],
        ),
      ),
      // `ws: true`, because a WebSocket upgrade is not an HTTP proxy hop.
      // Without it the socket connects to vite and hangs there.
      '/socket': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
    },
    // The crypto wasm lives in `packages/crypto-wasm`, outside this app's root,
    // and Vite refuses to serve files above it by default — a 403 that arrives
    // as "failed to fetch Wasm" and looks nothing like a config problem.
    fs: { allow: ['../..'] },
  },
});
