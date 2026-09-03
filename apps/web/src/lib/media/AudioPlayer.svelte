<script lang="ts">
/**
 * Voice notes and audio files.
 *
 * The waveform is drawn from peaks the SENDER computed and put in the
 * encrypted manifest. The receiver can't derive one without decoding the
 * whole file first, and the server can't derive one at all — it never sees
 * the audio. So the bars are data, not decoration, and a file that arrives
 * without them falls back to a flat bar rather than a fake shape.
 */

import type { Attachment } from '$lib/fake/data.js';
import { duration as fmt } from '$lib/format.js';
import Icon from '$lib/Icon.svelte';

let { a }: { a: Attachment } = $props();

let el = $state<HTMLAudioElement>();
let playing = $state(false);
let at = $state(0);
/** The duration the browser measured, once it has the file. Zero until
      then, which is why it is not read directly. */
let loaded = $state(0);
let rate = $state(1);
let scrubbing = $state(false);

/** The measured length if we have it, otherwise the length the sender
      claimed — the scrub maths needs one number and does not care which. */
const total = $derived(loaded || a.duration || 0);
const pct = $derived(total ? Math.min(1, at / total) : 0);
const bars = $derived(a.waveform ?? Array.from({ length: 48 }, () => 0.45));

function toggle() {
  if (!el) return;
  if (playing) el.pause();
  else void el.play();
}

function cycleRate() {
  const next: Record<number, number> = { 1: 1.5, 1.5: 2, 2: 1 };
  rate = next[rate] ?? 1;
  if (el) el.playbackRate = rate;
}

/** Seeking from a pointer anywhere on the waveform, including mid-drag. */
function seekFrom(e: PointerEvent, track: HTMLElement) {
  const r = track.getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  at = p * total;
  if (el) el.currentTime = at;
}

function onDown(e: PointerEvent) {
  const track = e.currentTarget as HTMLElement;
  track.setPointerCapture(e.pointerId);
  scrubbing = true;
  seekFrom(e, track);
}
function onMove(e: PointerEvent) {
  if (scrubbing) seekFrom(e, e.currentTarget as HTMLElement);
}
function onUp(e: PointerEvent) {
  scrubbing = false;
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    at = Math.min(total, at + 5);
    if (el) el.currentTime = at;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    at = Math.max(0, at - 5);
    if (el) el.currentTime = at;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    toggle();
  }
}
</script>

<div class="audio" class:playing>
  <audio
    bind:this={el}
    src={a.url}
    preload="metadata"
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => { playing = false; at = 0; }}
    ontimeupdate={() => { if (!scrubbing && el) at = el.currentTime; }}
    onloadedmetadata={() => { if (el && Number.isFinite(el.duration)) loaded = el.duration; }}
  ></audio>

  <button class="pp" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
    <Icon name={playing ? 'pause' : 'play'} size={16} />
  </button>

  <div
    class="track"
    role="slider"
    tabindex="0"
    aria-label="Seek"
    aria-valuemin={0}
    aria-valuemax={Math.round(total)}
    aria-valuenow={Math.round(at)}
    aria-valuetext="{fmt(at)} of {fmt(total)}"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onkeydown={onKey}
  >
    {#each bars as h, i (i)}
      <i class="bar" class:done={i / bars.length < pct} style="height: {Math.max(12, h * 100)}%"></i>
    {/each}
    <span class="scrub-pin" style="left: {pct * 100}%"></span>
  </div>

  <span class="t">{fmt(playing || at ? at : total)}</span>
  <button class="rate" class:on={rate !== 1} onclick={cycleRate} title="Playback speed">{rate}×</button>
</div>

<style>
  .audio {
    display: flex; align-items: center; gap: 10px; max-width: 420px;
    background: var(--ground-2); border: 1.5px solid var(--line);
    border-radius: var(--r-md); padding: 8px 12px;
    box-shadow: var(--shadow-subtle), var(--highlight-inset);
    transition: border-color var(--t-base) var(--ease), box-shadow var(--t-base) var(--ease);
  }
  .audio.playing {
    border-color: color-mix(in oklab, var(--brand) 55%, var(--line));
    box-shadow: var(--shadow-ambient), var(--highlight-inset);
  }

  .pp {
    flex: none; width: 34px; height: 34px; border-radius: 50%; border: 0; cursor: pointer;
    background: var(--brand); color: #fff; display: grid; place-items: center;
    box-shadow: 0 var(--lift) 0 var(--violet-deep), var(--highlight-inset);
    transition: transform var(--t-fast) var(--ease-toy), filter var(--t-fast) var(--ease),
      box-shadow var(--t-fast) var(--ease);
    position: relative;
  }
  @media (pointer: coarse) {
    .pp::after {
      content: ''; position: absolute; left: 50%; top: 50%;
      width: var(--tap); height: var(--tap);
      translate: -50% -50%;
    }
  }
  .pp:hover { filter: brightness(1.1); transform: translateY(-1px); }
  .pp:active { transform: translateY(var(--lift)); box-shadow: none; }

  .track {
    position: relative;
    flex: 1; min-width: 90px; height: 32px; display: flex; align-items: center; gap: 2px;
    cursor: pointer; touch-action: none;
  }
  .track:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-xs); }
  .bar {
    flex: 1; min-width: 2px; border-radius: var(--r-pill); background: var(--ground-4);
    transition: background var(--t-fast) linear;
  }
  .bar.done { background: var(--brand); }

  .scrub-pin {
    position: absolute; top: 50%; translate: -50% -50%;
    width: 6px; height: 26px; border-radius: var(--r-pill);
    background: #ffffff;
    box-shadow: 0 0 8px var(--brand);
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }
  .track:hover .scrub-pin, .audio.playing .scrub-pin {
    opacity: 1;
  }

  .t {
    flex: none; font-family: var(--font-mono); font-size: var(--text-xs);
    color: var(--text-mute); font-variant-numeric: tabular-nums;
  }
  .rate {
    flex: none; border: 1px solid var(--line); background: transparent; cursor: pointer;
    color: var(--text-mute); font-size: 11px; font-weight: 700; padding: 2px 6px;
    border-radius: var(--r-xs);
    min-height: var(--tap); min-width: 34px;
    transition: color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
  }
  .rate:hover { color: var(--text); }
  .rate.on { color: var(--brand); border-color: var(--brand); }
</style>
