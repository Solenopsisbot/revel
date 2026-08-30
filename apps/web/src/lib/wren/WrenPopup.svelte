<script lang="ts">
/**
 * Rung 4 — the only surface allowed to take focus.
 *
 * Three categories reach here and nothing else: an irreversible action, a
 * live safety condition, or a genuine cliff edge (`docs/12`). This component
 * does not decide that; `wren.rungFor()` does, and it will not hand this one
 * anything that hasn't earned it.
 *
 * There is no scrim-click-to-dismiss and no Escape. Every popup that gets
 * here has a "go back" action of its own, and a modal you can dismiss by
 * missing it is a modal that didn't need to be one.
 */
import WrenNotice from './WrenNotice.svelte';
import { type Notice, wren } from './wren.svelte.js';

let {
  notice,
  onact,
}: {
  notice: Notice;
  onact: (actionId: string, dismissive: boolean) => void;
} = $props();

// Her face matches what she is saying. Safety and cliff-edge get serious;
// the irreversible-action confirmations get alert.
const face = $derived(notice.severity === 'coral' ? 'serious' : 'alert');
let panel = $state<HTMLElement>();

$effect(() => {
  void notice.id;
  panel?.focus();
});
</script>

<div class="scrim"></div>
<div
  class="modal"
  role="alertdialog"
  aria-modal="true"
  aria-label={notice.title}
  bind:this={panel}
  tabindex="-1"
>
  <img src="/wren/face-{face}.webp" alt="" width="52" height="52" />
  <WrenNotice {notice} emphasis {onact} />
  {#if wren.popupsThisWeek >= 3}
    <p class="budget">
      This is the third time I've interrupted you this week. I'll hold anything
      else until you open the panel.
    </p>
  {/if}
</div>

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 90;
    background: var(--scrim); backdrop-filter: blur(3px);
    animation: fade var(--t-base) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .modal {
    position: fixed; z-index: 91; left: 50%; top: 50%; translate: -50% -50%;
    width: min(440px, calc(100vw - 32px));
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    padding: 22px; border-radius: var(--r-lg);
    background: var(--ground-0); border: 1px solid var(--ground-4);
    box-shadow: var(--shadow-panel);
    animation: rise var(--t-base) var(--ease);
  }
  .modal:focus { outline: none; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(10px) scale(.985); }
    to { opacity: 1; transform: none; }
  }

  .modal img { border-radius: 50%; background: var(--ground-2); flex: none; }
  .modal :global(.notice) { width: 100%; }

  .budget {
    margin: 0; font-size: 11px; color: var(--text-mute); text-align: center;
    line-height: 1.5; max-width: 34ch;
  }
</style>
