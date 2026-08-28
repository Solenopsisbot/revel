<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import { SECTIONS } from '$lib/settings/sections.js';
  import Account from '$lib/settings/Account.svelte';
  import Faces from '$lib/settings/Faces.svelte';
  import Devices from '$lib/settings/Devices.svelte';
  import Appearance from '$lib/settings/Appearance.svelte';
  import About from '$lib/settings/About.svelte';

  let { open = $bindable(false), section = $bindable('account') }: {
    open?: boolean;
    section?: string;
  } = $props();

  const meta = $derived(SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!);
  let panel = $state<HTMLElement>();

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      open = false;
    }
  }

  // Focus the panel when it opens so Escape and tabbing land somewhere sane.
  $effect(() => {
    if (open) panel?.focus();
  });
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div
    class="scrim"
    role="button"
    tabindex="-1"
    aria-label="Close settings"
    onclick={() => (open = false)}
    onkeydown={(e) => e.key === 'Enter' && (open = false)}
  ></div>

  <div class="sheet" role="dialog" aria-modal="true" aria-label="Settings" bind:this={panel} tabindex="-1">
    <nav aria-label="Settings sections">
      {#each SECTIONS as s (s.id)}
        <button
          class="item"
          class:sel={s.id === section}
          class:soon={!s.built}
          onclick={() => (section = s.id)}
          aria-current={s.id === section ? 'page' : undefined}
        >
          <span class="nm">{s.name}</span>
          <span class="bl">{s.blurb}</span>
          {#if !s.built}<span class="soon-tag">not built</span>{/if}
        </button>
      {/each}
    </nav>

    <main>
      <button class="close" onclick={() => (open = false)} aria-label="Close settings">
        <Icon name="plus" size={18} />
        <span class="esc">Esc</span>
      </button>
      {#key section}
        <div class="pane">
          {#if section === 'account'}
            <Account />
          {:else if section === 'faces'}
            <Faces />
          {:else if section === 'devices'}
            <Devices />
          {:else if section === 'appearance'}
            <Appearance />
          {:else if section === 'about'}
            <About />
          {:else}
            <h2>{meta.name}</h2>
            <p class="lede">{meta.blurb}</p>
            <div class="stub">
              <p>This section isn't built yet.</p>
              <p class="muted">
                It's in the plan — see <code>docs/19-app-shell-ux.md</code> for what
                it will hold. Nothing here is faked in the meantime.
              </p>
            </div>
          {/if}
        </div>
      {/key}
    </main>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 60; border: 0; padding: 0;
    background: var(--scrim); backdrop-filter: blur(3px);
    animation: fade var(--t-base) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .sheet {
    position: fixed; inset: 3vh 3vw; z-index: 61;
    display: grid; grid-template-columns: 270px 1fr;
    background: var(--ground-0); border: 1px solid var(--line);
    border-radius: var(--r-lg); overflow: hidden;
    box-shadow: var(--shadow-panel);
    animation: rise var(--t-base) var(--ease);
  }
  .sheet:focus { outline: none; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(10px) scale(.995); }
    to { opacity: 1; transform: none; }
  }

  nav { background: var(--ground-1); border-right: 1px solid var(--line); padding: 14px 10px; overflow-y: auto; }
  .item {
    display: block; width: 100%; text-align: left; cursor: pointer; position: relative;
    background: transparent; border: 0; color: var(--text); font: inherit;
    padding: 9px 10px; border-radius: var(--r-sm); margin-bottom: 2px;
    transition: background var(--t-fast) var(--ease);
  }
  .item:hover { background: var(--ground-2); }
  .item.sel { background: var(--ground-3); }
  .item.soon .nm { color: var(--text-mute); }
  .nm { display: block; font-weight: 600; font-size: var(--text-sm); }
  .bl { display: block; font-size: 11px; color: var(--text-mute); margin-top: 1px; padding-right: 54px; }
  .soon-tag {
    position: absolute; right: 10px; top: 10px;
    font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-mute); border: 1px solid var(--line); padding: 1px 5px; border-radius: var(--r-xs);
  }

  main { overflow-y: auto; padding: 34px clamp(24px, 4vw, 56px) 70px; position: relative; }
  .close {
    position: absolute; right: 20px; top: 18px; display: flex; align-items: center; gap: 7px;
    background: transparent; border: 0; cursor: pointer; color: var(--text-mute);
    padding: 6px 8px; border-radius: var(--r-sm); rotate: 45deg;
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .close:hover { color: var(--text); background: var(--ground-2); }
  .close .esc { display: none; }

  .pane { max-width: 720px; animation: fade var(--t-fast) var(--ease); }
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); }
  .stub { background: var(--ground-2); border-radius: var(--r-md); padding: 20px; }
  .stub p { margin: 0 0 6px; font-size: var(--text-sm); }
  .muted { color: var(--text-mute); margin-bottom: 0 !important; }
  code { font-family: var(--font-mono); font-size: .9em; }

  @media (max-width: 820px) {
    .sheet { inset: 0; border-radius: 0; grid-template-columns: 1fr; }
    nav { display: flex; gap: 4px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: 8px; }
    .item { width: auto; flex: none; }
    .bl, .soon-tag { display: none; }
  }
</style>
