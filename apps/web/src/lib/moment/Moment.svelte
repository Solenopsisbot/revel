<script lang="ts">
/**
 * The moment-screen shell (`docs/07`): gradient ground, ambient haze,
 * asymmetric and left-aligned. Full personality, because these are the
 * screens you see rarely and remember.
 */

/**
 * Which Wren the screen calls for.
 *
 * Two families, and they hang differently. The full-body poses read as her
 * standing in the room with you; the expression portraits (`docs/09`) crop
 * at the shoulders and come in close, which is what a screen wants when the
 * thing being said is hard. Recovery codes get `serious`, not a friendly
 * figure with her hands in her pockets — the face has to match the sentence.
 */
type Pose = 'standing' | 'leaning' | 'seated' | 'warm' | 'serious' | 'alert';

const PORTRAITS: Pose[] = ['warm', 'serious', 'alert'];

let {
  children,
  wren = true,
  pose = 'standing',
}: { children: import('svelte').Snippet; wren?: boolean; pose?: Pose } = $props();

const portrait = $derived(PORTRAITS.includes(pose));
</script>

<div class="moment">
  <div class="haze a"></div>
  <div class="haze b"></div>
  <div class="haze c"></div>
  {#if wren}
    <!-- She is in the layout, overlapping and bleeding off the bottom edge,
         rather than pasted onto it (`docs/07`). These renders are true alpha
         cutouts, so the edge mask that used to hide a rectangular dark
         background is gone; what is left is a soft drop shadow, which keeps
         her from reading as a sticker on the gradient. -->
    <img class="art" class:portrait src="/wren/{pose}.webp" alt="" aria-hidden="true" />
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
    /* Her hoodie is near-black and so is the ground behind her. The shadow is
       what separates the two — without it the silhouette merges into the
       gradient and only the mint accents survive. */
    filter: drop-shadow(0 12px 34px rgb(0 0 0 / .55));
  }
  /* Portraits are square and already framed tight, so they sit lower and
     larger: the shoulders run off the bottom edge and the face lands at
     roughly the same height as the headline. */
  .art.portrait { height: min(64dvh, 500px); right: 3%; bottom: -2%; }

  @media (max-width: 1000px) { .art { display: none; } .moment { padding: 40px 24px; } }
  /* On a phone the copy is usually taller than the screen, so every pixel of
     padding is a pixel of the button pushed below the fold. `flex-start` as
     well: a centred flex child that overflows its container puts its own top
     out of reach above the scroll origin, which is the classic way a long
     form becomes unscrollable at the top. */
  @media (max-width: 560px) {
    .moment { padding: 26px 18px; align-items: flex-start; }
  }
</style>
