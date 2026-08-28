<script lang="ts">
  import type { Face } from './fake/data.js';
  let { face, size = 40, dot = false }: { face: Face; size?: number; dot?: boolean } = $props();
  const initial = $derived(face.name.charAt(0).toUpperCase());
</script>

<span
  class="av"
  style="--fc: var(--face-{face.colour}); width:{size}px; height:{size}px; font-size:{Math.round(size * 0.38)}px"
  title={face.name}
>
  {initial}
  {#if dot}<span class="dot"></span>{/if}
</span>

<style>
  .av {
    position: relative; flex: none; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--fc); color: #fff; font-weight: 800;
    /* Face colour is identity, so it transitions when you switch faces
       rather than snapping (docs/32). */
    transition: background var(--t-base) var(--ease);
  }
  .dot {
    position: absolute; right: -1px; bottom: -1px;
    width: 30%; height: 30%; min-width: 9px; min-height: 9px;
    border-radius: 50%; background: var(--face-mint);
    border: 2px solid var(--ground-1);
  }
</style>
