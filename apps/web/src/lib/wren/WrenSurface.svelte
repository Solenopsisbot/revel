<script lang="ts">
/**
 * Everything Wren puts on screen in the app shell: her button, the ambient
 * dot, the panel, and the rare popup. One component so the shell mounts one
 * thing and so the surfaces can see each other — she never opens two at
 * once, which is one of the timing rules in `docs/12`.
 */
import WrenPanel from './WrenPanel.svelte';
import WrenPopup from './WrenPopup.svelte';
import { type Notice, wren } from './wren.svelte.js';

let {
  onroute,
}: {
  onroute: (to: { settings?: string; members?: boolean }) => void;
} = $props();

let button = $state<HTMLElement>();

/**
 * Raise a popup when one has earned it. `rungFor` returns 4 only after the
 * settle window, only when no other Wren surface is open, and only within
 * the interruption budget — so this effect can be this blunt.
 *
 * It settles rather than loops: `interrupt` sets `wren.popup`, which makes
 * every rung collapse to 1, which empties `pendingPopup`.
 */
$effect(() => {
  const next = wren.pendingPopup;
  if (next && !wren.popup) wren.interrupt(next);
});

function act(n: Notice, actionId: string, dismissive: boolean) {
  const to = wren.act(n, actionId);
  if (dismissive) wren.dismiss(n.id);
  if (to) onroute(to);
}
</script>

<button
  class="wren"
  bind:this={button}
  onclick={() => (wren.panelOpen = !wren.panelOpen)}
  aria-expanded={wren.panelOpen}
  aria-label={wren.dot ? `Wren — ${wren.notices.length} notices` : 'Wren'}
  title="Wren"
>
  <img src="/wren/face-warm.webp" alt="" width="26" height="26" />
  {#if wren.dot}
    <span class="dot sev-{wren.dot}" aria-hidden="true"></span>
  {/if}
</button>

{#if wren.panelOpen}
  <WrenPanel
    anchor={button}
    onclose={() => (wren.panelOpen = false)}
    {onroute}
  />
{/if}

{#if wren.popup}
  <WrenPopup
    notice={wren.popup}
    onact={(id, dismissive) => act(wren.popup!, id, dismissive)}
  />
{/if}

<style>
  .wren {
    position: relative; display: grid; place-items: center; flex: none;
    width: 34px; height: 34px; border-radius: var(--r-sm);
    border: 0; background: transparent; cursor: pointer; padding: 0;
    transition: background var(--t-fast) var(--ease);
  }
  .wren:hover, .wren[aria-expanded='true'] { background: var(--ground-2); }
  .wren img { border-radius: 50%; display: block; }

  /* The dot is the whole of rung 2: it says the panel has something, and its
     colour says how bad. It never says what, because that would be a
     megaphone with extra steps. */
  .dot {
    position: absolute; right: 2px; top: 2px;
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--text-mute);
    box-shadow: 0 0 0 2px var(--ground-0);
  }
  .dot.sev-gold { background: var(--face-gold); }
  .dot.sev-coral { background: var(--face-coral); }
</style>
