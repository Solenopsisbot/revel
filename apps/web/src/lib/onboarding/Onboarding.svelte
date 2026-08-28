<script lang="ts">
  /**
   * First run: one overlay, once.
   *
   * `docs/19` originally had this as a DM with Wren, which was the wrong shape
   * for her — `docs/09` is explicit that she cannot be in a room, because a
   * mascot who could read your conversations is exactly the ghost reader the
   * product swears doesn't exist. An overlay is the honest surface: it is the
   * client talking to you, on your device, in the one place that isn't a room.
   *
   * It is also the reason her introduction can say something a welcome *bot*
   * never could. `docs/08`'s bot leads with "you can see me in the member list
   * right now" — Wren leads with the opposite, and hers is the stronger claim.
   *
   * Deliberately **one screen, not a carousel.** `docs/19`: no tour, no coach
   * marks, no progress ring. The three cliff screens already spent the user's
   * patience on the things that genuinely can't be recovered from, and that
   * budget is finite.
   */
  import Moment from '$lib/moment/Moment.svelte';
  import Button from '$lib/moment/Button.svelte';
  import { wren } from '$lib/wren/wren.svelte.js';

  let { onclose }: { onclose: () => void } = $props();

  /**
   * She says you can ignore her, and then hands you the switch. Advising you
   * that a setting exists would be the Clippy move; doing the thing is her own
   * rule from `docs/12`, and it applies to her introduction too.
   */
  function quiet() {
    wren.setVolume('quiet');
    onclose();
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Welcome">
  <Moment pose="standing">
    <p class="eyebrow">First things first</p>
    <h1>I'm Wren.</h1>

    <p class="lede">
      Not a tutorial, and not a bot. I'm this app — the part that turns
      ciphertext into the conversation on your screen. I live on this device,
      inside the encryption, which is a fussy way of saying I see exactly what
      you see and nothing more.
    </p>

    <p>
      So I'm not in your rooms. I can't be. Anything that can read a room is in
      the member list, every time, no exceptions — and that promise is worth a
      great deal more than me being able to look over your shoulder.
    </p>

    <p>
      What I do instead is notice things. A device you haven't touched in
      months. A recovery code you never saved. Someone's key changing when you
      weren't expecting it. They go in a panel you open when you want it, not a
      popup you have to bat away.
    </p>

    <p class="fine">
      I'll interrupt you for three things and nothing else: something
      irreversible, a key changing mid-conversation, or you being one dropped
      phone away from losing the account. If I ever get louder than that,
      something is broken and you should tell someone.
    </p>

    <div class="cta">
      <Button onclick={onclose}>Sounds good</Button>
      <Button variant="secondary" onclick={quiet}>Keep her quiet</Button>
    </div>

    <p class="under">
      Quiet means the panel only — I'll never interrupt and never put a card in
      front of you. You can change it any time in settings.
    </p>
  </Moment>
</div>

<style>
  /* Fixed rather than a route, because it sits over the app you already have.
     Above everything except a rung-4 popup, which outranks an introduction. */
  .overlay {
    position: fixed; inset: 0; z-index: 85; overflow-y: auto;
    animation: fade var(--t-slow, 320ms) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .eyebrow {
    font-size: var(--text-xs, 12px); font-weight: 800; letter-spacing: .09em;
    text-transform: uppercase; color: var(--text-mute); margin: 0 0 10px;
  }
  h1 {
    font-family: var(--font-display); font-weight: 600; font-size: var(--display-1);
    letter-spacing: -.02em; margin: 0 0 16px;
  }
  .lede { font-size: var(--text-lg, 18px); line-height: 1.55; margin: 0 0 16px; }
  p { color: var(--text-dim); line-height: 1.6; margin: 0 0 14px; max-width: 46ch; }

  .fine {
    font-size: var(--text-sm); color: var(--text-mute);
    border-left: 2px solid var(--line); padding-left: 14px; margin-top: 20px;
  }

  .cta { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 12px; }
  .under { font-size: 12px; color: var(--text-mute); max-width: 44ch; margin: 0; }
</style>
