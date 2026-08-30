<script lang="ts">
/**
 * A DM call, ringing.
 *
 * The second shape of call from `docs/21`: a voice room is a place you walk
 * into and a DM call is a phone call. Three buttons rather than two, because
 * **"answer muted" is the option people actually want** when they aren't
 * sure what they're walking into — and burying it behind "answer, then
 * scramble for the mic button" is how every other app gets this wrong.
 *
 * Not a modal over the whole app: it is a card, so a ring while you are
 * mid-sentence somewhere else doesn't seize the window.
 */
import Avatar from '../Avatar.svelte';
import { core } from '../fake/core.svelte.js';
import { directory } from '../fake/directory.svelte.js';
import Icon from '../Icon.svelte';
import { voice } from './voice.svelte.js';

const from = $derived(core.faces[voice.incoming!.fromFaceId]!);
const dm = $derived(core.dms.find((d) => d.id === voice.incoming!.dmId));
const dmTitle = $derived.by(() => {
  const info = directory.dms().find((r) => r.id === voice.incoming?.dmId);
  return info ? directory.title(info) : '';
});
</script>

<div class="ring" role="alertdialog" aria-label="Incoming call from {from.name}">
  <Avatar face={from} size={44} />
  <div class="who">
    <b>{from.name}</b>
    <span>
      calling
      {#if dm && dm.kind === 'group'}· {dm.name ?? dmTitle}{/if}
    </span>
  </div>

  <div class="buttons">
    <button class="decline" onclick={() => voice.decline()} aria-label="Decline">
      <Icon name="hangup" size={17} />
    </button>
    <button class="muted" onclick={() => voice.answer(true)}>
      <Icon name="mic-off" size={15} /> Answer muted
    </button>
    <button class="answer" onclick={() => voice.answer(false)} aria-label="Answer">
      <Icon name="voice" size={17} />
    </button>
  </div>
</div>

<style>
  .ring {
    position: fixed; z-index: 88; right: 18px; bottom: 18px;
    width: min(340px, calc(100vw - 32px));
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 14px; border-radius: var(--r-lg);
    background: var(--ground-0); border: 1px solid var(--ground-4);
    box-shadow: var(--shadow-panel);
    animation: arrive var(--t-base) var(--ease);
  }
  @keyframes arrive {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: none; }
  }

  /* A slow pulse rather than a bounce — it needs to be noticed from the corner
     of your eye without being the most urgent thing you have ever seen. */
  .ring :global(.av) { animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--face-mint) 22%, transparent); } }

  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .who b { font-size: var(--text-base); font-weight: 700; }
  .who span { font-size: 12px; color: var(--text-mute); }

  .buttons { display: flex; align-items: center; gap: 7px; width: 100%; }
  .buttons button {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700;
    border-radius: var(--r-pill); padding: 9px 12px;
    transition: filter var(--t-fast) var(--ease);
  }
  .buttons button:hover { filter: brightness(1.08); }
  .decline { background: var(--face-rose); color: #fff; flex: none; width: 42px; }
  .answer { background: var(--face-mint); color: var(--ground-0); flex: none; width: 42px; }
  .muted { background: var(--ground-3); color: var(--text); flex: 1; }
</style>
