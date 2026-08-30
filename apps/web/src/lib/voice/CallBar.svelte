<script lang="ts">
/**
 * The persistent bar that keeps a call alive while you read another room.
 *
 * This is the whole reason the controller lives outside the components
 * (`docs/21`): you can walk off to check something and the conversation
 * carries on. Clicking the bar walks you back.
 *
 * Only rendered when you are in a call and *not* looking at it — when you
 * are, the stage already has these controls and two sets would be one too
 * many.
 */

import Avatar from '../Avatar.svelte';
import { core } from '../fake/core.svelte.js';
import Icon from '../Icon.svelte';
import { voice } from './voice.svelte.js';

const others = $derived(voice.participants.filter((p) => p.faceId !== core.speakingAs));
const broken = $derived(voice.participants.some((p) => p.diverged));
</script>

<div class="bar" class:broken>
  <button class="back" onclick={() => voice.spaceId && voice.roomId && core.openRoom(voice.spaceId, voice.roomId)}>
    <span class="pip" aria-hidden="true"></span>
    <span class="meta">
      <span class="nm"><Icon name="voice" size={13} /> {voice.title}</span>
      <span class="sub">
        {#if broken}
          Someone's audio is broken
        {:else}
          {voice.participants.length} in the call
        {/if}
      </span>
    </span>
    <span class="who">
      {#each others.slice(0, 3) as p (p.faceId)}
        <Avatar face={core.faces[p.faceId]!} size={20} />
      {/each}
    </span>
  </button>

  <button
    class="mic"
    class:on={!voice.micMuted}
    onclick={() => voice.toggleMic()}
    aria-label={voice.micMuted ? 'Unmute' : 'Mute'}
    title={voice.micMuted ? 'Unmute' : 'Mute'}
  ><Icon name={voice.micMuted ? 'mic-off' : 'mic'} size={16} /></button>

  <button class="hang" onclick={() => voice.leave()} aria-label="Leave call" title="Leave call">
    <Icon name="hangup" size={16} />
  </button>
</div>

<style>
  .bar {
    display: flex; align-items: center; gap: 6px;
    padding: 7px 8px; margin: 0 8px 8px;
    background: color-mix(in oklab, var(--face-mint) 16%, var(--ground-2));
    border: 1px solid color-mix(in oklab, var(--face-mint) 35%, var(--line));
    border-radius: var(--r-md);
  }
  .bar.broken {
    background: color-mix(in oklab, var(--face-coral) 16%, var(--ground-2));
    border-color: color-mix(in oklab, var(--face-coral) 40%, var(--line));
  }

  .back {
    display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0;
    border: 0; background: transparent; cursor: pointer; font: inherit;
    color: var(--text); padding: 3px 4px; border-radius: var(--r-sm); text-align: left;
  }
  .back:hover { background: color-mix(in oklab, var(--ground-0) 25%, transparent); }

  .pip {
    width: 8px; height: 8px; border-radius: 50%; flex: none;
    background: var(--face-mint); animation: pulse 2s infinite;
  }
  .broken .pip { background: var(--face-coral); }
  @keyframes pulse { 50% { opacity: .4; } }

  .meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .nm { display: flex; align-items: center; gap: 5px; font-size: var(--text-sm); font-weight: 600;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 11px; color: var(--text-mute); }

  .who { display: flex; gap: -4px; }
  .who > :global(*) { margin-left: -6px; box-shadow: 0 0 0 2px var(--ground-1); border-radius: 50%; }
  .who > :global(*:first-child) { margin-left: 0; }

  .mic, .hang {
    width: 30px; height: 30px; flex: none; display: grid; place-items: center;
    border: 0; cursor: pointer; border-radius: var(--r-sm);
    background: var(--ground-3); color: var(--text-dim);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .mic:hover, .hang:hover { color: var(--text); }
  .mic.on { background: var(--brand); color: #fff; }
  .hang:hover { background: var(--face-rose); color: #fff; }
</style>
