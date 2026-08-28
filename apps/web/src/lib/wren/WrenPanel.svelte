<script lang="ts">
  /**
   * Wren's inbox.
   *
   * This is rung 1, and rung 1 is where essentially everything lives
   * (`docs/12`). It is opened, used, and closed — there is no "Wren's tips"
   * surface that sits on screen, and she is not a sidebar pet.
   *
   * The volume control is in here as well as in settings, because the moment
   * you want to turn someone down is the moment they have just spoken.
   */
  import Popover from '../Popover.svelte';
  import Icon from '../Icon.svelte';
  import WrenNotice from './WrenNotice.svelte';
  import { wren, type Notice, type Volume } from './wren.svelte.js';

  let {
    anchor,
    onclose,
    onroute,
  }: {
    anchor: HTMLElement | undefined;
    onclose: () => void;
    /** Where an action wants to take you, when the honest answer is a screen. */
    onroute: (to: { settings?: string; members?: boolean }) => void;
  } = $props();

  const VOLUMES: { id: Volume; label: string; hint: string }[] = [
    { id: 'quiet', label: 'Quiet', hint: 'Panel only. Never interrupts.' },
    { id: 'normal', label: 'Normal', hint: 'Interrupts only for the three things that earn it.' },
    { id: 'chatty', label: 'Chatty', hint: 'Adds the housekeeping ones.' },
  ];

  let showVolume = $state(false);

  function act(n: Notice, actionId: string, dismissive: boolean) {
    const to = wren.act(n, actionId);
    // A dismissive action resolves the notice by hand; every other action
    // resolves it by changing the state it was describing.
    if (dismissive) wren.dismiss(n.id);
    if (to) {
      onroute(to);
      onclose();
    }
  }
</script>

<Popover {anchor} align="end" prefer="bottom" {onclose}>
  <div class="panel" role="dialog" aria-label="Wren">
    <header>
      <img src="/wren/face-warm.webp" alt="" width="30" height="30" />
      <div class="who">
        <b>Wren</b>
        <span>Runs on this device. Nothing here leaves it.</span>
      </div>
      <button class="x" onclick={onclose} aria-label="Close"><Icon name="x" size={15} /></button>
    </header>

    <div class="list">
      {#each wren.notices as n (n.id)}
        <WrenNotice
          notice={n}
          onact={(id, dismissive) => act(n, id, dismissive)}
          onsilence={() => wren.silence(n.category)}
        />
      {:else}
        <div class="empty">
          <p><b>Nothing needs you.</b></p>
          <p class="sub">
            {#if wren.volume === 'quiet'}
              I'm on Quiet, so I'll only ever show up here.
            {:else if wren.silenced.length}
              Some categories are silenced — you can bring them back in settings.
            {:else}
              Your keys, your devices and this device's storage all look fine.
            {/if}
          </p>
        </div>
      {/each}
    </div>

    <footer>
      <button class="vol" onclick={() => (showVolume = !showVolume)} aria-expanded={showVolume}>
        <Icon name={wren.volume === 'quiet' ? 'bell-off' : 'bell'} size={14} />
        <span>{VOLUMES.find((v) => v.id === wren.volume)?.label}</span>
        <Icon name="chevron" size={13} />
      </button>
      <button class="settings-link" onclick={() => { onroute({ settings: 'wren' }); onclose(); }}>
        Settings
      </button>
    </footer>

    {#if showVolume}
      <div class="volumes">
        {#each VOLUMES as v (v.id)}
          <button class:sel={wren.volume === v.id} onclick={() => wren.setVolume(v.id)}>
            <span class="nm">{v.label}{#if wren.volume === v.id}<Icon name="check" size={13} />{/if}</span>
            <span class="hint">{v.hint}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</Popover>

<style>
  .panel {
    width: 380px; max-height: min(70dvh, 620px); display: flex; flex-direction: column;
    background: var(--ground-0); border: 1px solid var(--line);
    border-radius: var(--r-lg); box-shadow: var(--shadow-panel); overflow: hidden;
  }

  header {
    display: flex; align-items: center; gap: 10px; padding: 12px 12px 11px;
    border-bottom: 1px solid var(--line); background: var(--ground-1);
  }
  header img { border-radius: 50%; background: var(--ground-3); flex: none; }
  .who { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .who b { font-size: var(--text-sm); font-weight: 700; }
  .who span { font-size: 11px; color: var(--text-mute); }
  .x {
    border: 0; background: transparent; cursor: pointer; color: var(--text-mute);
    padding: 5px; border-radius: var(--r-sm); display: flex;
  }
  .x:hover { color: var(--text); background: var(--ground-3); }

  .list { overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }

  .empty { padding: 26px 14px 30px; text-align: center; }
  .empty p { margin: 0; font-size: var(--text-sm); }
  .empty .sub { color: var(--text-mute); margin-top: 4px; line-height: 1.5; }

  footer {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    border-top: 1px solid var(--line); background: var(--ground-1);
  }
  .vol, .settings-link {
    display: flex; align-items: center; gap: 6px; font: inherit; font-size: 12px;
    font-weight: 600; cursor: pointer; border: 0; background: transparent;
    color: var(--text-mute); padding: 5px 8px; border-radius: var(--r-sm);
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .vol:hover, .settings-link:hover { color: var(--text); background: var(--ground-3); }
  .settings-link { margin-left: auto; }

  .volumes {
    border-top: 1px solid var(--line); padding: 6px; background: var(--ground-1);
    display: flex; flex-direction: column; gap: 2px;
  }
  .volumes button {
    display: flex; flex-direction: column; gap: 1px; text-align: left; width: 100%;
    border: 0; background: transparent; cursor: pointer; font: inherit; color: var(--text);
    padding: 7px 9px; border-radius: var(--r-sm);
  }
  .volumes button:hover { background: var(--ground-3); }
  .volumes button.sel { background: var(--ground-3); }
  .volumes .nm { display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); font-weight: 600; }
  .volumes .hint { font-size: 11px; color: var(--text-mute); }
</style>
