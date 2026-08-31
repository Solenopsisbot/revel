<script lang="ts">
import type { Face } from './fake/data.js';

/**
 * `face` is optional, and that is a real state rather than defensiveness.
 *
 * A message from a real room carries a `FaceRef` snapshot *if the sender was
 * speaking as a face* — an account that has never made one sends without, which
 * is correct and must render as somebody rather than as a crash. It happened:
 * a faceless row took the whole message list down with
 * "Cannot read properties of undefined", and a list that renders nothing is a
 * much worse answer than a list with an anonymous avatar in it.
 *
 * `status` and `colour` are fixture fields a `FaceRef` does not carry either,
 * so both fall back rather than being assumed.
 */
let {
  face,
  size = 40,
  dot = false,
}: { face?: Partial<Face> | null; size?: number; dot?: boolean } = $props();

const name = $derived(face?.name ?? '');
// A dash rather than a letter: an empty circle reads as a loading state, and
// this is not loading — there is genuinely nobody named here.
const initial = $derived(name ? name.charAt(0).toUpperCase() : '·');

/**
 * The presence dot takes its colour from the actual status. It used to be
 * mint unconditionally, which meant someone shown as `busy` in the roster
 * still got a green dot — the list said one thing and the dot said another.
 */
const statusColour = $derived(
  face?.status === 'busy'
    ? 'var(--face-rose)'
    : face?.status === 'away'
      ? 'var(--face-gold)'
      : face?.status === 'invisible'
        ? 'var(--text-mute)'
        : 'var(--face-mint)',
);
</script>

<span
  class="av"
  style="--fc: var(--face-{face?.colour ?? 'lilac'}); --sc: {statusColour}; width:{size}px; height:{size}px; font-size:{Math.round(size * 0.38)}px"
  title={name || 'Someone'}
>
  {initial}
  {#if dot}<span class="dot" class:hollow={face?.status === 'invisible'}></span>{/if}
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
    border-radius: 50%; background: var(--sc);
    border: 2px solid var(--ground-1);
  }
  /* Invisible reads as an outline rather than a filled dot — you are shown as
     offline to everyone else, and your own UI should not pretend otherwise. */
  .dot.hollow { background: var(--ground-1); box-shadow: inset 0 0 0 2px var(--text-mute); }
</style>
