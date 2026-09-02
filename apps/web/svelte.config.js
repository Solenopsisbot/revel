import adapter from '@sveltejs/adapter-static';
export default {
  kit: {
    adapter: adapter({ fallback: 'index.html' }),
    // Client-rendered: every page talks to the local core, and there is no
    // server-side render because the server cannot read anything anyway.
    prerender: { entries: [] },

    /**
     * The content policy, emitted by the thing that knows the hashes.
     *
     * SvelteKit writes one inline `<script>` into every page — the bootstrap
     * that sets `__sveltekit_<id>` and starts the app — and the id is random
     * per build, so its hash is too. A `script-src` served from nginx therefore
     * cannot name it, and a policy that does not name it blocks it: the app
     * loads its markup and then never hydrates. Not a subtle degradation, a
     * blank shell.
     *
     * So the policy lives here, in `hash` mode, where the build can put the
     * right hash in a `<meta>` alongside the script it is for.
     * `revel-security-headers.conf` keeps only `frame-ancestors`, which is the
     * one directive a `<meta>` policy is not allowed to carry — and the two
     * compose, because a browser enforces every policy it is given.
     *
     * Directives are the ones that snippet used to hold, and its reasoning
     * still applies:
     *
     *   wasm-unsafe-eval  the crypto core is WebAssembly, main thread and
     *                     worker; without it nothing instantiates.
     *   style-src unsafe-inline
     *                     Svelte injects component styles as inline <style>.
     *   connect-src 'self'
     *                     the Host is same-origin, REST and WebSocket both.
     *   blob:             attachments are decrypted in the tab and rendered
     *                     from a blob URL, never fetched from anywhere.
     */
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'base-uri': ['self'],
        'object-src': ['none'],
        'form-action': ['self'],
        'script-src': ['self', 'wasm-unsafe-eval'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:', 'blob:'],
        'media-src': ['self', 'blob:'],
        'font-src': ['self'],
        'worker-src': ['self', 'blob:'],
        'connect-src': ['self'],
        'manifest-src': ['self'],
      },
    },
  },
};
