<script lang="ts">
/**
 * What this deployment actually is.
 *
 * Not a growth banner and not a cookie notice. There is one honest thing to
 * say to somebody putting real conversations into a pre-alpha end-to-end
 * encrypted app, and it is that the data might not survive: the encrypted
 * event schema is still moving, and if it has to change in a way old messages
 * cannot be read through, the answer is a reset rather than a migration
 * (`docs/29` §1 — encrypted history cannot be re-encrypted).
 *
 * Dismissible, and it stays dismissed. Somebody who has read it once does not
 * need it on every load, and a warning that cannot be put away is a warning
 * people learn to look past.
 */
import Icon from './Icon.svelte';

const KEY = 'revel:beta-notice-seen';

let dismissed = $state(true);

$effect(() => {
  try {
    dismissed = globalThis.localStorage?.getItem(KEY) === '1';
  } catch {
    dismissed = false;
  }
});

function dismiss() {
  dismissed = true;
  try {
    globalThis.localStorage?.setItem(KEY, '1');
  } catch {
    // A browser that will not remember shows it again. Harmless.
  }
}
</script>

{#if !dismissed}
  <div class="beta" role="status">
    <Icon name="warn" size={15} />
    <p>
      <b>This is an experimental build.</b>
      Your messages are end-to-end encrypted and that part is real — but the
      format they're stored in is still changing, and a change that old messages
      can't be read through means starting over. <b>Don't put anything here you'd
      be upset to lose.</b>
    </p>
    <button onclick={dismiss} aria-label="Dismiss">
      <Icon name="plus" size={15} />
    </button>
  </div>
{/if}

<style>
  .beta {
    display: flex; align-items: flex-start; gap: 11px;
    padding: 10px 14px;
    background: color-mix(in oklab, var(--warn, #f5c451) 14%, var(--ground-1));
    border-bottom: 1px solid color-mix(in oklab, var(--warn, #f5c451) 30%, transparent);
    color: var(--text);
  }
  .beta p { margin: 0; font-size: var(--text-sm); line-height: 1.5; }
  .beta button {
    margin-left: auto; flex: none; display: grid; place-items: center;
    background: none; border: 0; cursor: pointer; color: var(--text-2);
    padding: 5px; border-radius: var(--r-sm);
  }
  /* The glyph turns; the button does not. Rotating the button rotates its
     background with it, which is why the hover shade sat as a diamond behind
     a square icon. */
  .beta button :global(svg) { rotate: 45deg; }
  .beta button:hover { background: var(--ground-3); color: var(--text); }
</style>
