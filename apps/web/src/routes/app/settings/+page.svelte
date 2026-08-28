<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from '$lib/Icon.svelte';
  import { SECTIONS } from '$lib/settings/sections.js';
  import Account from '$lib/settings/Account.svelte';
  import Faces from '$lib/settings/Faces.svelte';
  import Devices from '$lib/settings/Devices.svelte';
  import Appearance from '$lib/settings/Appearance.svelte';
  import About from '$lib/settings/About.svelte';

  const current = $derived(page.url.searchParams.get('s') ?? 'account');
  const section = $derived(SECTIONS.find((s) => s.id === current) ?? SECTIONS[0]!);

  function open(id: string) {
    goto(`/app/settings?s=${id}`, { replaceState: false, noScroll: true, keepFocus: true });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') goto('/app');
  }
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Settings — Revel</title></svelte:head>

<div class="settings">
  <nav aria-label="Settings">
    <button class="back" onclick={() => goto('/app')}>
      <Icon name="reply" size={16} /> Back
    </button>
    {#each SECTIONS as s (s.id)}
      <button
        class="item"
        class:sel={s.id === current}
        class:soon={!s.built}
        onclick={() => open(s.id)}
        aria-current={s.id === current ? 'page' : undefined}
      >
        <span class="nm">{s.name}</span>
        <span class="bl">{s.blurb}</span>
        {#if !s.built}<span class="soon-tag">not built</span>{/if}
      </button>
    {/each}
  </nav>

  <main>
    {#key current}
      <div class="pane">
        {#if current === 'account'}
          <Account />
        {:else if current === 'faces'}
          <Faces />
        {:else if current === 'devices'}
          <Devices />
        {:else if current === 'appearance'}
          <Appearance />
        {:else if current === 'about'}
          <About />
        {:else}
          <h2>{section.name}</h2>
          <p class="lede">{section.blurb}</p>
          <!-- Listed rather than hidden. A settings screen that omits half its
               own map is harder to reason about than one that says so. -->
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

<style>
  .settings { display: grid; grid-template-columns: 280px 1fr; height: 100dvh; background: var(--ground-0); }

  nav {
    background: var(--ground-1); border-right: 1px solid var(--line);
    padding: 12px 10px; overflow-y: auto;
  }
  .back {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    background: transparent; border: 0; cursor: pointer; color: var(--text-mute);
    font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 8px 10px; border-radius: var(--r-sm); margin-bottom: 8px;
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .back:hover { background: var(--ground-2); color: var(--text); }

  .item {
    display: block; width: 100%; text-align: left; cursor: pointer;
    background: transparent; border: 0; color: var(--text); font: inherit;
    padding: 9px 10px; border-radius: var(--r-sm); margin-bottom: 2px; position: relative;
    transition: background var(--t-fast) var(--ease);
  }
  .item:hover { background: var(--ground-2); }
  .item.sel { background: var(--ground-3); }
  .item.soon .nm { color: var(--text-mute); }
  .nm { display: block; font-weight: 600; font-size: var(--text-sm); }
  .bl { display: block; font-size: 11px; color: var(--text-mute); margin-top: 1px; }
  .soon-tag {
    position: absolute; right: 10px; top: 10px;
    font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-mute); border: 1px solid var(--line); padding: 1px 5px; border-radius: var(--r-xs);
  }

  main { overflow-y: auto; padding: 40px clamp(24px, 5vw, 64px) 80px; }
  .pane { max-width: 720px; animation: fade var(--t-fast) var(--ease); }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); }
  .stub { background: var(--ground-2); border-radius: var(--r-md); padding: 20px; }
  .stub p { margin: 0 0 6px; font-size: var(--text-sm); }
  .muted { color: var(--text-mute); margin-bottom: 0 !important; }
  code { font-family: var(--font-mono); font-size: .9em; }

  @media (max-width: 800px) { .settings { grid-template-columns: 1fr; } nav { display: none; } }
</style>
