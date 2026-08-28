<script lang="ts">
  /**
   * A panel anchored to a trigger element.
   *
   * Fixed-positioned and measured from the trigger's rect rather than nested
   * inside it, because the message list, the composer and the settings sheet
   * all clip their overflow — an absolutely positioned child would be cut off
   * by whichever one it happened to open inside.
   *
   * It flips above/below and clamps to the viewport, so a picker opened from
   * the last row doesn't hang off the bottom of the window.
   */
  import type { Snippet } from 'svelte';

  let {
    anchor,
    align = 'end',
    prefer = 'top',
    gap = 8,
    onclose,
    children,
  }: {
    anchor: HTMLElement | undefined;
    /** Which edge of the panel lines up with the trigger. */
    align?: 'start' | 'end' | 'center';
    prefer?: 'top' | 'bottom';
    gap?: number;
    onclose?: () => void;
    children: Snippet;
  } = $props();

  let panel = $state<HTMLElement>();
  let pos = $state({ x: -9999, y: -9999 });

  function place() {
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let y = prefer === 'top' ? a.top - p.height - gap : a.bottom + gap;
    // Flip only if the preferred side genuinely doesn't fit.
    if (prefer === 'top' && y < 8) y = Math.min(a.bottom + gap, vh - p.height - 8);
    if (prefer === 'bottom' && y + p.height > vh - 8) y = Math.max(8, a.top - p.height - gap);
    y = Math.max(8, Math.min(y, vh - p.height - 8));

    let x =
      align === 'start' ? a.left : align === 'center' ? a.left + a.width / 2 - p.width / 2 : a.right - p.width;
    x = Math.max(8, Math.min(x, vw - p.width - 8));

    pos = { x, y };
  }

  $effect(() => {
    // Re-place whenever the anchor changes identity or the window moves under
    // it. `true` on the scroll listener catches scrolling containers too.
    void anchor;
    place();
    const on = () => place();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  });

  function outside(e: MouseEvent) {
    const t = e.target as Node;
    if (panel?.contains(t) || anchor?.contains(t)) return;
    onclose?.();
  }
</script>

<svelte:window onpointerdown={outside} />

<div
  class="pop"
  bind:this={panel}
  style="left: {pos.x}px; top: {pos.y}px"
  style:visibility={pos.x === -9999 ? 'hidden' : 'visible'}
>
  {@render children()}
</div>

<style>
  .pop {
    position: fixed; z-index: 70;
    animation: rise var(--t-base) var(--ease);
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(6px) scale(.985); }
    to { opacity: 1; transform: none; }
  }
</style>
