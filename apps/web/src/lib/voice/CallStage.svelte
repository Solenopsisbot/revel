<script lang="ts">
  /**
   * The in-call view, shown where the message list would be when you are
   * looking at the voice room you're in.
   *
   * The main bar has four controls because a bar with nine means nobody finds
   * any of them (`docs/21`). Devices, noise suppression, push-to-talk and the
   * rest live behind `⋯`.
   */
  import Icon from '../Icon.svelte';
  import Menu from '../Menu.svelte';
  import Popover from '../Popover.svelte';
  import Tile from './Tile.svelte';
  import { core } from '../fake/core.svelte.js';
  import { voice } from './voice.svelte.js';
  import type { Item } from '../menu.js';

  let moreBtn = $state<HTMLElement>();
  let moreOpen = $state(false);

  const moreItems: Item[] = [
    { id: 'input', label: 'Microphone: MacBook Pro', icon: 'mic', header: 'Devices' },
    { id: 'output', label: 'Output: MacBook Pro', icon: 'headphones' },
    { id: 'noise', label: 'Noise suppression', icon: 'sparkle', header: 'Processing', checked: true },
    { id: 'echo', label: 'Echo cancellation', checked: true },
    { id: 'ptt', label: 'Push to talk', checked: false },
    { id: 'diverge', label: 'Simulate a key mismatch', icon: 'warn', header: 'Testing' },
  ];

  function pickMore(id: string) {
    moreOpen = false;
    if (id === 'diverge') voice.simulateDivergence();
  }
</script>

<div class="stage">
  <header>
    <Icon name="voice" size={17} />
    <h2>{voice.room?.name}</h2>
    <span class="count">{voice.participants.length} {voice.participants.length === 1 ? 'person' : 'people'}</span>
    {#if voice.rekeying}
      <!-- A half-second audio gap with no explanation reads as a glitch; with
           one, it reads as security working. -->
      <span class="rekey" role="status">keys updated</span>
    {/if}
  </header>

  <div class="tiles">
    {#each voice.participants as p (p.faceId)}
      <Tile {p} me={p.faceId === core.speakingAs} />
    {/each}
  </div>

  {#if voice.sharing}
    <p class="sharing" role="status">
      <Icon name="screen" size={14} />
      You are sharing your screen.
      <button onclick={() => voice.toggleShare()}>Stop</button>
    </p>
  {/if}

  <div class="bar">
    <button
      class="ctl"
      class:on={!voice.micMuted}
      onclick={() => voice.toggleMic()}
      aria-pressed={!voice.micMuted}
    >
      <Icon name={voice.micMuted ? 'mic-off' : 'mic'} size={19} />
      <span>{voice.micMuted ? 'Unmute' : 'Mute'}</span>
    </button>

    <button class="ctl" class:on={voice.cameraOn} onclick={() => voice.toggleCamera()} aria-pressed={voice.cameraOn}>
      <Icon name="camera" size={19} />
      <span>Camera</span>
    </button>

    <button class="ctl" class:on={voice.sharing} onclick={() => voice.toggleShare()} aria-pressed={voice.sharing}>
      <Icon name="screen" size={19} />
      <span>Share</span>
    </button>

    <button class="ctl" bind:this={moreBtn} onclick={() => (moreOpen = !moreOpen)} aria-label="More controls">
      <Icon name="more" size={19} />
    </button>

    <button class="leave" onclick={() => voice.leave()}>
      <Icon name="hangup" size={19} />
      <span>Leave</span>
    </button>
  </div>

  <p class="fine">
    Audio is encrypted with a key from this room's own group, so the server
    forwards packets it can't decode. If someone can hear it, they can keep it —
    that part no app can fix.
  </p>
</div>

{#if moreOpen}
  <Popover anchor={moreBtn} align="center" prefer="top" onclose={() => (moreOpen = false)}>
    <Menu items={moreItems} onpick={pickMore} />
  </Popover>
{/if}

<style>
  .stage {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    padding: 20px clamp(16px, 3vw, 34px); gap: 16px; overflow-y: auto;
  }
  header { display: flex; align-items: center; gap: 9px; color: var(--text-dim); }
  h2 { font-size: var(--text-base); font-weight: 700; margin: 0; color: var(--text); }
  .count { font-size: var(--text-sm); color: var(--text-mute); }
  .rekey {
    font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    color: var(--face-mint); background: color-mix(in oklab, var(--face-mint) 16%, transparent);
    padding: 2px 8px; border-radius: var(--r-pill);
    animation: fade var(--t-base) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .tiles {
    display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
    align-content: start;
  }

  .sharing {
    display: flex; align-items: center; gap: 9px; margin: 0;
    font-size: var(--text-sm); color: var(--text-dim);
    background: color-mix(in oklab, var(--face-gold) 14%, transparent);
    border-radius: var(--r-md); padding: 10px 13px;
  }
  .sharing button {
    margin-left: auto; border: 0; cursor: pointer; font: inherit;
    font-size: 12px; font-weight: 700; background: var(--ground-3); color: var(--text);
    padding: 5px 12px; border-radius: var(--r-pill);
  }

  .bar {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin-top: auto; padding-top: 8px; flex-wrap: wrap;
  }
  .ctl, .leave {
    display: inline-flex; align-items: center; gap: 8px;
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 11px 16px; border-radius: var(--r-pill);
    background: var(--ground-3); color: var(--text-dim);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .ctl:hover { background: var(--ground-4); color: var(--text); }
  .ctl.on { background: var(--brand); color: #fff; }
  .leave { background: var(--face-rose); color: #fff; margin-left: 10px; }
  .leave:hover { filter: brightness(1.08); }

  .fine {
    margin: 0; text-align: center; font-size: 11px; color: var(--text-mute);
    line-height: 1.55; max-width: 62ch; margin-inline: auto;
  }

  @media (max-width: 720px) {
    .ctl span, .leave span { display: none; }
    .ctl, .leave { padding: 11px 14px; }
  }
</style>
