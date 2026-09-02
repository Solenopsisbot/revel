/*
 * Appearance, stamped before first paint.
 *
 * A file rather than an inline `<script>`, so the Content-Security-Policy can
 * say `script-src 'self'` without a nonce or a hash. An inline script would
 * force either `'unsafe-inline'` — which is most of the policy gone — or a hash
 * that has to be regenerated in the nginx config every time this changes, which
 * is a footgun with a long fuse.
 *
 * Still blocking and still in `<head>`: doing this in a component would show a
 * frame of the default theme first.
 */
(() => {
  const el = document.documentElement;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('revel.appearance') || '{}');
  } catch {
    /* storage unavailable, or not JSON; the defaults in the markup stand */
  }
  const q = new URLSearchParams(location.search);
  el.dataset.theme = q.get('theme') || stored.theme || 'dusk';
  el.dataset.density = q.get('density') || stored.density || 'cozy';
  el.dataset.personality = q.get('personality') || stored.personality || 'full';
})();
