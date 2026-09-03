<script lang="ts">
/**
 * Everything hanging off a message that isn't text.
 *
 * The one rule that shapes all of it: the frame is the right size BEFORE the
 * bytes arrive. Sizes come from the encrypted manifest, so a picture that is
 * still decrypting occupies exactly the space it will occupy when it lands,
 * and the conversation never jumps under someone's cursor (`docs/32`).
 *
 * Visual media (image, gif, video) shares a grid; audio and files stack
 * under it, because a waveform next to a photo reads as two unrelated things
 * fighting for the same row.
 */

import type { Attachment } from '$lib/fake/data.js';
import { bytes, duration } from '$lib/format.js';
import Icon from '$lib/Icon.svelte';
import { layout } from '$lib/layout.svelte.js';
import AudioPlayer from './AudioPlayer.svelte';
import { lightbox } from './lightbox.svelte.js';

let { list }: { list: Attachment[] } = $props();

const visual = $derived(
  list.filter((a) => a.kind === 'image' || a.kind === 'gif' || a.kind === 'video'),
);
const rest = $derived(list.filter((a) => a.kind === 'audio' || a.kind === 'file'));

/** Spoilers are per-attachment and reset when the message changes. */
let revealed = $state<Record<string, boolean>>({});
let altFor = $state<string | null>(null);

/**
 * The one open description, or null. At most one is open at a time, which
 * is why it can be rendered once below the whole group rather than once per
 * frame — and it *has* to be, because a frame is sized from the manifest
 * and holds that size exactly. Anything added inside it has no room and
 * spills onto the message underneath.
 */
const altShown = $derived(visual.find((a) => a.id === altFor) ?? null);

const MAX_W = 400;
const MAX_H = 320;

/** Exact display pixels, so the reserved box matches the final one. */
function fit(a: Attachment) {
  const w = a.w ?? 400;
  const h = a.h ?? 300;
  const scale = Math.min(MAX_W / w, MAX_H / h, 1);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}
</script>

{#if visual.length}
  <div class="visual" class:multi={visual.length > 1} style="--cols: {visual.length === 1 ? 1 : 2}">
    {#each visual as a (a.id)}
      {@const box = fit(a)}
      {@const hidden = a.spoiler && !revealed[a.id]}
      <div
        class="frame"
        class:single={visual.length === 1}
        style={visual.length === 1 ? `width:${box.w}px;aspect-ratio:${box.w}/${box.h}` : ''}
      >
        <button
          class="open"
          onclick={() => lightbox.show(visual, visual.indexOf(a))}
          aria-label="Open {a.name}"
        >
          {#if a.kind === 'video'}
            <img src={a.poster} alt={a.alt || a.name} loading="lazy" decoding="async" />
            <span class="play"><Icon name="play" size={20} /></span>
          {:else}
            <img src={a.url} alt={a.alt || a.name} loading="lazy" decoding="async" />
          {/if}
        </button>

        {#if a.spoiler}
          <button
            class="spoiler-lens"
            class:hidden
            onclick={() => (revealed[a.id] = !revealed[a.id])}
            aria-label={hidden ? 'Show sensitive content' : 'Hide sensitive content'}
          >
            {#if hidden}
              <div class="spoiler-content">
                <Icon name="eye" size={20} />
                <span>Marked sensitive</span>
                <small>{layout.coarse ? 'Tap' : 'Click'} to show</small>
              </div>
            {/if}
          </button>
        {/if}

        {#if !hidden}
          {#if a.kind === 'gif'}<span class="tag">GIF</span>{/if}
          {#if a.kind === 'video' && a.duration}<span class="tag right">{duration(a.duration)}</span>{/if}
          {#if a.alt}
            <button
              class="tag alt"
              class:right={a.kind === 'gif'}
              class:on={altFor === a.id}
              aria-expanded={altFor === a.id}
              onclick={() => (altFor = altFor === a.id ? null : a.id)}
              title="Description"
            >ALT</button>
          {/if}
          {#if a.spoiler && revealed[a.id]}
            <button class="tag hidebtn" onclick={() => (revealed[a.id] = false)} title="Hide again">
              <Icon name="eye-off" size={12} />
            </button>
          {/if}
        {/if}
      </div>
    {/each}
  </div>

  {#if altShown?.alt}
    <!-- Below the group, not inside the frame: see `altShown`. With more than
         one picture the lit ALT tag says which frame it belongs to, and the
         name says it again for anyone not going by colour. -->
    <p class="altbox">
      {#if visual.length > 1}<b>{altShown.name}</b>{' '}{/if}{altShown.alt}
    </p>
  {/if}
{/if}

{#each rest as a (a.id)}
  {#if a.kind === 'audio'}
    <div class="stacked"><AudioPlayer {a} /></div>
  {:else}
    <div class="stacked">
      <a class="file" href={a.url} download={a.name}>
        <span class="fi"><Icon name="file" size={19} /></span>
        <span class="fmeta">
          <span class="fname">{a.name}</span>
          <span class="fsize">{bytes(a.size)}</span>
        </span>
        <span class="dl"><Icon name="download" size={17} /></span>
      </a>
    </div>
  {/if}
{/each}

<style>
  .visual {
    display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 4px;
    margin-top: 6px; max-width: 400px;
  }
  .visual:not(.multi) { display: block; max-width: none; }

  .frame {
    position: relative; border-radius: var(--r-md); overflow: visible;
    background: var(--ground-2);
  }
  .multi .frame { aspect-ratio: 1; }
  /* The reserved box is exact in pixels, but a phone is narrower than a
     picture: 400px of image inside a 294px message hangs over the edge of the
     conversation. Clamping the width alone would leave a fixed height and
     crop the shape, so the height comes from the ratio instead — the box is
     still the right shape before the bytes arrive, at whatever width there
     actually is, and still never moves once they land. */
  .frame.single { max-width: 100%; }

  .open {
    display: block; width: 100%; height: 100%; padding: 0; border: 0; cursor: pointer;
    background: var(--ground-2); border-radius: var(--r-md); overflow: hidden;
    position: relative;
    transition: filter var(--t-base) var(--ease), transform var(--t-fast) var(--ease);
  }
  .open img {
    display: block; width: 100%; height: 100%; object-fit: cover;
    /* The picture fades in over its own reserved box, so nothing shifts. */
    animation: settle var(--t-slow) var(--ease);
  }
  @keyframes settle { from { opacity: 0; } to { opacity: 1; } }
  .open:hover { filter: brightness(1.06); }
  .open:active { transform: scale(.993); }

  .play {
    position: absolute; inset: 0; margin: auto; width: 54px; height: 54px;
    border-radius: 50%; display: grid; place-items: center; color: #fff;
    background: rgba(20, 10, 40, .55); backdrop-filter: blur(4px);
    padding-left: 3px; /* optically centre the triangle */
    transition: transform var(--t-base) var(--ease-toy), background var(--t-fast) var(--ease);
  }
  .open:hover .play { transform: scale(1.08); background: rgba(20, 10, 40, .7); }

  .spoiler-lens {
    position: absolute; inset: 0; border: 0; cursor: pointer;
    background: transparent; backdrop-filter: blur(0px);
    opacity: 0; pointer-events: none;
    transition: backdrop-filter var(--t-base) var(--ease),
      background var(--t-base) var(--ease),
      opacity var(--t-base) var(--ease);
    border-radius: var(--r-md);
  }
  .spoiler-lens.hidden {
    opacity: 1; pointer-events: auto;
    backdrop-filter: blur(28px);
    background: repeating-linear-gradient(
      135deg,
      rgba(27, 18, 54, 0.78),
      rgba(27, 18, 54, 0.78) 12px,
      rgba(48, 34, 92, 0.78) 12px,
      rgba(48, 34, 92, 0.78) 24px
    );
    display: grid; place-items: center;
  }
  .spoiler-content {
    display: grid; place-items: center; align-content: center; gap: 3px;
    color: var(--text-dim); text-align: center; padding: 12px;
  }
  .spoiler-content span { font-size: var(--text-sm); font-weight: 700; color: var(--text); }
  .spoiler-content small { font-size: var(--text-xs); color: var(--text-mute); }
  .spoiler-lens:hover .spoiler-content { filter: brightness(1.15); }

  .tag {
    position: absolute; left: 7px; bottom: 7px; border: 0; cursor: default;
    font-size: 10px; font-weight: 800; letter-spacing: .05em;
    padding: 2px 6px; border-radius: var(--r-xs); line-height: 1.5;
    background: rgba(12, 6, 26, .72); color: #fff; backdrop-filter: blur(3px);
  }
  .tag.right { left: auto; right: 7px; }
  .tag.alt, .tag.hidebtn { cursor: pointer; transition: background var(--t-fast) var(--ease); }
  .tag.alt { left: auto; right: 7px; }
  .tag.alt.right { right: 46px; }
  .tag.alt:hover, .tag.hidebtn:hover { background: rgba(12, 6, 26, .92); }
  .tag.alt.on { background: var(--face-aqua); color: var(--ground-0); }
  .tag.hidebtn { left: 7px; bottom: 7px; display: grid; place-items: center; padding: 3px; }
  /* The badges are deliberately small — they sit on somebody's picture and are
     not the point of it — so on a finger the reachable area grows outward
     rather than the label. The pseudo-element is centred and unpainted, which
     keeps the corner inset looking the same as it does on a mouse. */
  @media (pointer: coarse) {
    .tag.alt, .tag.hidebtn { position: absolute; }
    .tag.alt::after, .tag.hidebtn::after {
      content: ''; position: absolute; left: 50%; top: 50%;
      min-width: var(--tap); min-height: var(--tap);
      width: 100%; height: 100%; translate: -50% -50%;
    }
  }

  .altbox {
    margin: 5px 0 0; max-width: min(400px, 100%); font-size: var(--text-xs); color: var(--text-dim);
    background: var(--ground-2); border-left: 2px solid var(--face-aqua);
    padding: 6px 9px; border-radius: 0 var(--r-sm) var(--r-sm) 0;
    animation: drop var(--t-fast) var(--ease);
  }
  @keyframes drop { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
  .altbox b { color: var(--face-aqua); font-weight: 700; margin-right: 3px; }

  .stacked { margin-top: 6px; }

  .file {
    display: flex; align-items: center; gap: 11px; max-width: 400px;
    text-decoration: none; color: inherit;
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-md); padding: 10px 12px;
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }
  .file:hover { border-color: var(--brand); background: var(--ground-3); transform: translateY(-1px); }
  .fi {
    flex: none; width: 34px; height: 34px; border-radius: var(--r-sm);
    display: grid; place-items: center; color: var(--brand);
    background: color-mix(in oklab, var(--brand) 16%, transparent);
  }
  .fmeta { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .fname { font-size: var(--text-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fsize { font-size: var(--text-xs); color: var(--text-mute); }
  .dl { flex: none; color: var(--text-mute); }
  .file:hover .dl { color: var(--text); }
</style>
