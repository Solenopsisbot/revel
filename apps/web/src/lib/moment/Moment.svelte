<script lang="ts">
  /**
   * The moment-screen shell (`docs/07`): gradient ground, ambient haze,
   * asymmetric and left-aligned. Full personality, because these are the
   * screens you see rarely and remember.
   */
  let { children, wren = true }: { children: import('svelte').Snippet; wren?: boolean } = $props();
</script>

<div class="moment">
  <div class="haze a"></div>
  <div class="haze b"></div>
  <div class="haze c"></div>
  {#if wren}
    <!-- She is in the layout, overlapping and bleeding off the bottom edge,
         rather than pasted onto it (`docs/07`). -->
    <img class="art" src="/wren.png" alt="" aria-hidden="true" />
  {/if}
  <div class="inner">{@render children()}</div>
</div>

<style>
  .moment {
    position: relative; overflow: hidden; min-height: 100dvh;
    background: var(--moment-bg);
    display: flex; align-items: center; padding: 56px 6vw;
  }
  .inner { position: relative; z-index: 2; max-width: 34rem; width: 100%; }

  .haze { position: absolute; z-index: 0; border-radius: 50%; filter: blur(70px); pointer-events: none; }
  .a { width: 520px; height: 520px; background: var(--face-violet); left: -160px; top: -150px; opacity: .5; }
  .b { width: 380px; height: 380px; background: var(--face-rose); right: 24%; bottom: -190px; opacity: .3; }
  .c { width: 300px; height: 300px; background: var(--face-aqua); left: 34%; top: -160px; opacity: .26; }

  .art {
    position: absolute; right: 2%; bottom: 0; z-index: 1; height: min(84dvh, 620px);
    width: auto; pointer-events: none;
    -webkit-mask-image:
      linear-gradient(to right, transparent 0%, #000 15%, #000 85%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, #000 16%, #000 100%);
    -webkit-mask-composite: source-in;
    mask-image:
      linear-gradient(to right, transparent 0%, #000 15%, #000 85%, transparent 100%),
      linear-gradient(to bottom, transparent 0%, #000 16%, #000 100%);
    mask-composite: intersect;
  }
  @media (max-width: 1000px) { .art { display: none; } .moment { padding: 40px 24px; } }
</style>
