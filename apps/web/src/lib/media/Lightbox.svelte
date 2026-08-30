<script lang="ts">
/**
 * Full-screen media viewer.
 *
 * Deliberately spare: the picture is the content, so the chrome is one row
 * of controls that fades unless you ask for it. Arrow keys step through the
 * other attachments on the same message, which is the only navigation that
 * makes sense here — a global "next image in the room" would need an index
 * the client doesn't keep.
 */

import { bytes } from '$lib/format.js';
import Icon from '$lib/Icon.svelte';
import { lightbox } from './lightbox.svelte.js';

function onKey(e: KeyboardEvent) {
  if (!lightbox.open) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    lightbox.close();
  }
  if (e.key === 'ArrowRight') lightbox.step(1);
  if (e.key === 'ArrowLeft') lightbox.step(-1);
}
</script>

<svelte:window onkeydown={onKey} />

{#if lightbox.open && lightbox.current}
  {@const a = lightbox.current}
  <div class="wrap" role="dialog" aria-modal="true" aria-label={a.alt || a.name}>
    <button class="backdrop" aria-label="Close" onclick={() => lightbox.close()}></button>

    <div class="stage">
      {#key a.id}
        {#if a.kind === 'video'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={a.url} poster={a.poster} controls autoplay playsinline></video>
        {:else}
          <img src={a.url} alt={a.alt || a.name} />
        {/if}
      {/key}
    </div>

    {#if lightbox.items.length > 1}
      <button class="step left" onclick={() => lightbox.step(-1)} aria-label="Previous">
        <Icon name="chevron-left" size={22} />
      </button>
      <button class="step right" onclick={() => lightbox.step(1)} aria-label="Next">
        <Icon name="chevron-right" size={22} />
      </button>
    {/if}

    <div class="bar">
      <span class="nm">{a.name}</span>
      <span class="meta">
        {bytes(a.size)}{#if a.w && a.h} · {a.w}×{a.h}{/if}
        {#if lightbox.items.length > 1} · {lightbox.index + 1} of {lightbox.items.length}{/if}
      </span>
      <div class="grow"></div>
      <a class="btn" href={a.url} download={a.name} title="Save"><Icon name="download" size={17} /></a>
      <button class="btn" onclick={() => lightbox.close()} title="Close (Esc)"><Icon name="x" size={17} /></button>
    </div>

    {#if a.alt}
      <p class="alt">{a.alt}</p>
    {/if}
  </div>
{/if}

<style>
  .wrap { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; }
  .backdrop {
    position: absolute; inset: 0; border: 0; padding: 0; cursor: zoom-out;
    background: rgba(6, 3, 16, .88); backdrop-filter: blur(6px);
    animation: fade var(--t-base) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .stage {
    position: relative; max-width: 92vw; max-height: 78vh;
    display: grid; place-items: center; pointer-events: none;
  }
  .stage img, .stage video {
    max-width: 92vw; max-height: 78vh; border-radius: var(--r-md);
    box-shadow: var(--shadow-panel); pointer-events: auto;
    animation: zoom var(--t-base) var(--ease);
  }
  @keyframes zoom {
    from { opacity: 0; transform: scale(.97); }
    to { opacity: 1; transform: none; }
  }

  .step {
    position: absolute; top: 50%; translate: 0 -50%;
    width: 44px; height: 44px; border-radius: 50%; border: 0; cursor: pointer;
    background: rgba(255,255,255,.10); color: #fff; display: grid; place-items: center;
    backdrop-filter: blur(6px);
    transition: background var(--t-fast) var(--ease), transform var(--t-fast) var(--ease-toy);
  }
  .step:hover { background: rgba(255,255,255,.20); }
  .step:active { transform: translateY(-50%) scale(.92); }
  .left { left: 20px; }
  .right { right: 20px; }

  .bar {
    position: absolute; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 10px;
    padding: 14px 18px; color: #fff;
    background: linear-gradient(180deg, rgba(0,0,0,.55), transparent);
  }
  .grow { flex: 1; }
  .nm { font-weight: 700; font-size: var(--text-sm); }
  .meta { font-size: var(--text-xs); opacity: .7; }
  .btn {
    width: 34px; height: 34px; border-radius: 50%; border: 0; cursor: pointer;
    background: rgba(255,255,255,.10); color: #fff; display: grid; place-items: center;
    transition: background var(--t-fast) var(--ease);
  }
  .btn:hover { background: rgba(255,255,255,.22); }

  .alt {
    position: absolute; left: 50%; translate: -50% 0; bottom: 22px; margin: 0;
    max-width: min(70ch, 88vw); text-align: center; color: #fff; opacity: .8;
    font-size: var(--text-sm); background: rgba(0,0,0,.45); padding: 8px 14px;
    border-radius: var(--r-sm); backdrop-filter: blur(4px);
  }

  @media (max-width: 700px) {
    .left { left: 6px; } .right { right: 6px; }
    .stage img, .stage video { max-width: 100vw; max-height: 70vh; border-radius: 0; }
  }
</style>
