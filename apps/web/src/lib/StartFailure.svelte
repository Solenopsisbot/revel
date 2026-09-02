<script lang="ts">
/**
 * The core did not start, said out loud.
 *
 * There are three states a signed-in client can be in and only two of them
 * used to be visible: running, and starting. The third — *failed* — set
 * `live.error` and rendered nothing at all, so an account whose device
 * registration came back 429 got an app with no spaces, no DMs, no messages
 * and no explanation. Empty is the honest thing to *show*; it is not an honest
 * thing to show silently.
 *
 * Deliberately not a toast and not a modal. `docs/24` is clear that a phone's
 * connection comes and goes and an app that narrates each blip is exhausting
 * to carry around — but that is about reconnects, which the header dot already
 * handles. A core that never started is not a blip: nothing works until it is
 * fixed, so it gets a line that stays until it is.
 */
import Icon from './Icon.svelte';
import { live } from './live.svelte.js';
import { whyNot } from './startErrors.js';

const why = $derived(whyNot(live.reason || 'unreachable'));
</script>

{#if live.error}
  <div class="failed" role="status">
    <Icon name="warn" size={15} />
    <span class="what">
      {#if live.localOnly}
        <!-- The stack is up and the local database is open, so this is a real
             app with real history in it — just no way to reach the Host. Which
             is a very different sentence from "nothing loaded", and saying the
             wrong one is how somebody concludes their messages are gone. -->
        <b>Showing what's on this device.</b>
        {why} New messages won't arrive and anything you send will wait.
      {:else}
        <b>Not connected to your provider.</b>
        {why} Nothing here is missing — it just hasn't loaded.
      {/if}
    </span>
    <button onclick={() => live.retry()} disabled={live.starting}>
      {live.starting ? 'Trying…' : 'Try again'}
    </button>
  </div>
{/if}

<style>
  .failed {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 14px; margin: 0;
    background: color-mix(in oklab, var(--warn, #f5c451) 12%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--warn, #f5c451) 32%, transparent);
    color: var(--text); font-size: var(--text-sm); line-height: 1.45;
  }
  .what { flex: 1; min-width: 0; }
  .what b { font-weight: 700; }
  button {
    flex: none; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 6px 12px; border-radius: var(--r-pill);
    border: 1px solid var(--line); background: var(--ground-2); color: var(--text);
    min-height: var(--tap);
    transition: background var(--t-fast) var(--ease);
  }
  button:hover:not(:disabled) { background: var(--ground-3); }
  button:disabled { opacity: .55; cursor: default; }
</style>
