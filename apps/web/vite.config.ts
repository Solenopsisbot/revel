import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    // The IdP in dev, same-origin so the browser does not need CORS and the
    // app does not need to know where it lives. A real deployment points
    // `VITE_IDP_URL` at it instead; this is the local convenience.
    // Both prefixes: `/idp` is the identity provider, `/auth` is the Host's
    // device challenge-response. They are separate roles (`docs/02`) that
    // happen to be one process in development, and forwarding only the first
    // meant devices could register and never authenticate.
    proxy: {
      '/idp': { target: 'http://localhost:8080', changeOrigin: true },
      '/auth': { target: 'http://localhost:8080', changeOrigin: true },
    },
    // The crypto wasm lives in `packages/crypto-wasm`, outside this app's root,
    // and Vite refuses to serve files above it by default — a 403 that arrives
    // as "failed to fetch Wasm" and looks nothing like a config problem.
    fs: { allow: ['../..'] },
  },
});
