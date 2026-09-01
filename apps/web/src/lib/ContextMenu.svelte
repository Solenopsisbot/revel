<script lang="ts">
/**
 * Renders whatever `contextMenu` currently holds, at the pointer.
 *
 * Mounted once at the app root. Flips and clamps rather than hanging off the
 * viewport: a menu opened near the bottom-right of the window is the common
 * case, not the edge case, because that is where people's pointers live.
 */

import { contextMenu } from './contextmenu.svelte.js';
import { layout } from './layout.svelte.js';
import Menu from './Menu.svelte';

let panel = $state<HTMLElement>();
let pos = $state({ x: -9999, y: -9999 });

/** Measure after the menu exists, then place. Reading `current` here is what
      re-runs this when a second menu opens at a different point. */
$effect(() => {
  const c = contextMenu.current;
  // A sheet is positioned by CSS, and running the cursor placement over it
  // would fight the animation for the same two properties.
  if (layout.coarse) return;
  if (!c || !panel) {
    pos = { x: -9999, y: -9999 };
    return;
  }
  const r = panel.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Prefer down-and-right of the cursor; flip to the other side only when
  // that genuinely doesn't fit, so the menu stays where the hand expects.
  const x = c.x + r.width > vw - 8 ? Math.max(8, c.x - r.width) : c.x;
  const y = c.y + r.height > vh - 8 ? Math.max(8, c.y - r.height) : c.y;
  pos = { x, y };
});

function pick(id: string) {
  const c = contextMenu.current;
  contextMenu.close();
  c?.onpick(id);
}

function onKey(e: KeyboardEvent) {
  if (contextMenu.current && e.key === 'Escape') {
    e.stopPropagation();
    contextMenu.close();
  }
}

function outside(e: MouseEvent) {
  if (!contextMenu.current) return;
  if (panel?.contains(e.target as Node)) return;
  contextMenu.close();
}
</script>

<svelte:window onkeydown={onKey} onpointerdown={outside} onresize={() => contextMenu.close()} />

{#if contextMenu.current}
  <!--
    A card at the pointer on a mouse, a bottom sheet on a finger (`docs/24`),
    which is the same split the face switcher already makes.

    Not a style preference. A long-press menu near the top of the screen used
    to open *upward over the chrome it was launched from* — its title, which
    has no background of its own, landed on top of the space rail and was
    unreadable — and every row of it sat under the hand that opened it. A
    sheet is anchored to the bottom edge, so neither can happen, and it is
    within reach of a thumb on a phone that the top of the screen is not.
  -->
  {#if layout.coarse}
    <div class="sheet-scrim" onclick={() => contextMenu.close()} role="presentation"></div>
  {/if}
  <div
    class="ctx"
    class:sheet={layout.coarse}
    bind:this={panel}
    style:left={layout.coarse ? undefined : `${pos.x}px`}
    style:top={layout.coarse ? undefined : `${pos.y}px`}
    style:visibility={layout.coarse || pos.x !== -9999 ? 'visible' : 'hidden'}
  >
    {#if contextMenu.current.title}
      <div class="title">{contextMenu.current.title}</div>
    {/if}
    <Menu items={contextMenu.current.items} onpick={pick} />
  </div>
{/if}

<style>
  .ctx {
    position: fixed; z-index: 80;
    /* Once long-press exists this is the main way things get done on a phone,
       and its rows are 44px there — so a menu can be taller than the screen.
       Clamping here rather than in the placement code means the measurement
       the flip-and-clamp reads is already the clamped one. */
    max-height: calc(100dvh - 16px); overflow-y: auto;
    animation: rise var(--t-fast) var(--ease);
  }
  @keyframes rise {
    from { opacity: 0; transform: scale(.97); }
    to { opacity: 1; transform: none; }
  }
  /* The subject sits above the menu card rather than inside it, so it reads as
     a label on the group instead of an unclickable first row. */
  .title {
    font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-mute); padding: 0 4px 5px;
  }

  /* ── bottom sheet (coarse pointers only) ─────────────────────────────── */
  .sheet-scrim { position: fixed; inset: 0; z-index: 79; background: var(--scrim); }
  .ctx.sheet {
    left: 0; right: 0; bottom: 0; top: auto;
    padding: 6px 10px calc(10px + env(safe-area-inset-bottom, 0px));
    background: var(--ground-2); border-top: 1px solid var(--line);
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    box-shadow: var(--shadow-panel);
    animation: sheet-up var(--t-base) var(--ease);
  }
  @keyframes sheet-up { from { translate: 0 100%; } to { translate: 0 0; } }
  /* The card inside stops being a card: it is the sheet now, and two stacked
     borders with two radii read as a panel inside a panel. */
  .ctx.sheet :global(.menu) {
    background: transparent; border: 0; box-shadow: none; padding: 0; min-width: 0;
  }
  .ctx.sheet .title { padding: 6px 10px 8px; }

  /* A sheet arrives from the bottom edge every time, so there is nothing for
     the reduced-motion reading of "rise" to preserve. */
  @media (prefers-reduced-motion: reduce) {
    .ctx, .ctx.sheet { animation: none; }
  }
</style>
