<script lang="ts">
import { faceColour } from '$lib/colour.js';
/**
 * One participant.
 *
 * The face's colour is the speaking ring, so the identity colour that names
 * someone in chat is the one that identifies their voice. Plural systems get
 * that for free — the tile shows the *face* that joined, not the account.
 *
 * Tiles never reorder. A grid that reshuffles on every utterance is unusable
 * in a four-way conversation, so speaking is a ring and nothing else moves.
 */
import Avatar from '../Avatar.svelte';
import { core } from '../fake/core.svelte.js';
import Icon from '../Icon.svelte';
import { type Participant, voice } from './voice.svelte.js';

let { p, me }: { p: Participant; me: boolean } = $props();

const face = $derived(core.faces[p.faceId]!);
</script>

<div
  class="tile"
  class:speaking={p.speaking && !p.diverged}
  class:diverged={p.diverged}
  class:ringing={p.ringing}
  style="--ring: var(--face-{faceColour(face)})"
>
  <div class="av-wrap">
    {#if p.speaking && !p.diverged}
      <span class="wave w1"></span>
      <span class="wave w2"></span>
      <span class="wave w3"></span>
    {/if}
    <Avatar {face} size={56} />
  </div>
  <div class="name">
    {face.name}{#if me}<span class="you">you</span>{/if}
    {#if face.agent}<span class="badge">{face.agent.label}</span>{/if}
  </div>

  {#if face.agent}
    <!-- An agent that listened invisibly would be exactly the thing we promise
         doesn't exist, so it gets a tile and the roster's own sentence. -->
    <div class="sub">can hear this call</div>
  {/if}

  <div class="state">
    {#if p.ringing}
      <span class="chip">Ringing</span>
    {/if}
    {#if p.muted && !p.ringing}
      <span class="chip muted"><Icon name="mic-off" size={12} /> Muted</span>
    {/if}
    {#if p.sharing}
      <span class="chip"><Icon name="screen" size={12} /> Sharing</span>
    {/if}
    <span class="dot q-{p.quality}" title="Connection {p.quality}"></span>
  </div>

  {#if p.diverged}
    <!-- Per-tile, not a global banner: it is one person's audio that is gone,
         and saying it globally would implicate people who are fine. -->
    <div class="broken">
      <b>You can't hear {face.name}.</b>
      <span>Your apps disagree about this call's keys — usually a device that joined mid-call and didn't catch up.</span>
      <button onclick={() => voice.reconnectAudio(p.faceId)}>Reconnect audio</button>
    </div>
  {/if}
</div>

<style>
  .tile {
    position: relative; display: flex; flex-direction: column; align-items: center;
    gap: 9px; padding: 22px 16px 16px; border-radius: var(--r-md);
    background: var(--ground-2); border: 1.5px solid var(--line);
    box-shadow: var(--shadow-subtle), var(--highlight-inset);
    transition: box-shadow var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease),
      background var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
  }
  .tile:hover {
    background: var(--ground-3);
    transform: translateY(-2px);
    box-shadow: var(--shadow-ambient), var(--highlight-inset);
  }
  .tile.speaking {
    border-color: var(--ring);
    box-shadow: 0 0 18px color-mix(in oklab, var(--ring) 35%, transparent), var(--highlight-inset);
  }
  .tile.diverged { border-color: color-mix(in oklab, var(--face-coral) 55%, var(--line)); }
  .tile.ringing { opacity: .55; }

  .av-wrap {
    position: relative;
    display: grid;
    place-items: center;
    width: 68px;
    height: 68px;
  }
  .wave {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid var(--ring);
    opacity: 0;
    animation: ripple 2s cubic-bezier(0.2, 0.8, 0.4, 1) infinite;
    pointer-events: none;
  }
  .wave.w2 { animation-delay: 0.65s; }
  .wave.w3 { animation-delay: 1.3s; }
  @keyframes ripple {
    0% { transform: scale(0.85); opacity: 0.85; }
    100% { transform: scale(1.4); opacity: 0; }
  }

  .name { display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); font-weight: 600; }
  .you { font-weight: 400; font-size: 11px; color: var(--text-mute); }
  .badge {
    font-size: 9px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    border: 1px solid var(--text-mute); color: var(--text-dim);
    padding: 0 5px; border-radius: var(--r-xs);
  }
  .sub { font-size: 11px; color: var(--text-mute); margin-top: -3px; }

  .state { display: flex; align-items: center; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 600; color: var(--text-mute);
    background: var(--ground-3); padding: 2px 7px; border-radius: var(--r-pill);
  }
  .chip.muted { color: var(--text-dim); }

  /* One dot, three states. The call always knows whose connection is bad, and
     the default assumption is always that it's the other person's. */
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--face-mint); }
  .q-degraded { background: var(--face-gold); }
  .q-reconnecting { background: var(--face-coral); animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: .35; } }

  .broken {
    display: flex; flex-direction: column; gap: 6px; margin-top: 6px;
    background: color-mix(in oklab, var(--face-coral) 14%, transparent);
    border-radius: var(--r-sm); padding: 9px 10px; text-align: center;
  }
  .broken b { font-size: 12px; }
  .broken span { font-size: 11px; color: var(--text-dim); line-height: 1.45; }
  .broken button {
    border: 0; cursor: pointer; font: inherit; font-size: 11px; font-weight: 700;
    background: var(--face-coral); color: var(--ground-0);
    padding: 5px 11px; border-radius: var(--r-pill); align-self: center;
  }
</style>
