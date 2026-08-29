<script lang="ts">
  /**
   * Renders whatever `contextMenu` currently holds, at the pointer.
   *
   * Mounted once at the app root. Flips and clamps rather than hanging off the
   * viewport: a menu opened near the bottom-right of the window is the common
   * case, not the edge case, because that is where people's pointers live.
   */
  import Menu from './Menu.svelte';
  import { contextMenu } from './contextmenu.svelte.js';

  let panel = $state<HTMLElement>();
  let pos = $state({ x: -9999, y: -9999 });

  /** Measure after the menu exists, then place. Reading `current` here is what
      re-runs this when a second menu opens at a different point. */
  $effect(() => {
    const c = contextMenu.current;
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
  <div
    class="ctx"
    bind:this={panel}
    style="left: {pos.x}px; top: {pos.y}px"
    style:visibility={pos.x === -9999 ? 'hidden' : 'visible'}
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
</style>
