<script lang="ts">
import Icon from '$lib/Icon.svelte';
import About from '$lib/settings/About.svelte';
import Account from '$lib/settings/Account.svelte';
import Appearance from '$lib/settings/Appearance.svelte';
import Devices from '$lib/settings/Devices.svelte';
import Faces from '$lib/settings/Faces.svelte';
import Language from '$lib/settings/Language.svelte';
import Notifications from '$lib/settings/Notifications.svelte';
import Privacy from '$lib/settings/Privacy.svelte';
import Storage from '$lib/settings/Storage.svelte';
import { SECTIONS } from '$lib/settings/sections.js';
import Wren from '$lib/settings/Wren.svelte';

let {
  open = $bindable(false),
  section = $bindable('account'),
  /** Which face the Faces pane opens on. Lets the profile card's "Edit this
        face" land on the right one rather than on the list. */
  face = $bindable<string | null>(null),
}: {
  open?: boolean;
  section?: string;
  face?: string | null;
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
          {#if !s.built}<span class="soon-tag">not built</span>
          {:else if !s.wired}<span class="soon-tag preview">preview</span>{/if}
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
          {#if !meta.wired}
            <!--
              A designed screen that does nothing is worth keeping and worth
              saying so. What it must not do is state facts about an account
              that are not facts — which is what "recovery code saved 27 Aug"
              was doing to somebody who had never seen that date.
            -->
            <p class="preview-note">
              <Icon name="warn" size={15} />
              <span>
                <b>This screen is a preview.</b> It shows the design, not your account —
                nothing on it is connected yet, and the numbers are examples.
              </span>
            </p>
          {/if}

          {#if section === 'account'}
            <Account />
          {:else if section === 'faces'}
            <Faces bind:editing={face} />
          {:else if section === 'devices'}
            <Devices />
          {:else if section === 'appearance'}
            <Appearance />
          {:else if section === 'about'}
            <About />
          {:else if section === 'wren'}
            <Wren />
          {:else if section === 'notifications'}
            <Notifications />
          {:else if section === 'language'}
            <Language />
          {:else if section === 'privacy'}
            <Privacy />
          {:else if section === 'storage'}
            <Storage />
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
  .preview-note {
    display: flex; gap: 10px; align-items: flex-start;
    margin: 0 0 20px; padding: 12px 14px;
    background: color-mix(in oklab, var(--warn, #f5c451) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--warn, #f5c451) 35%, transparent);
    border-radius: var(--r-md); font-size: var(--text-sm); line-height: 1.5;
  }
  .soon-tag.preview { background: var(--ground-4); }
  .soon-tag {
    position: absolute; right: 10px; top: 10px;
    font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-mute); border: 1px solid var(--line); padding: 1px 5px; border-radius: var(--r-xs);
  }

  main { overflow-y: auto; padding: 34px clamp(24px, 4vw, 56px) 70px; position: relative; }
  .close {
    position: absolute; right: 20px; top: 18px; display: flex; align-items: center; gap: 7px;
    background: transparent; border: 0; cursor: pointer; color: var(--text-mute);
    padding: 7px; border-radius: var(--r-sm);
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  /* The glyph turns; the button does not. Rotating the button rotates its
     background with it, which is why the hover shade sat as a diamond behind
     a square icon. */
  .close :global(svg) { rotate: 45deg; }
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
    /* A tab strip that scrolls sideways wants no bar under it — the row of
       half-visible tabs is already the affordance. Local rule, so it beats
       the global one in app.css. */
    nav {
      display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none;
      border-right: 0; border-bottom: 1px solid var(--line); padding: 8px;
    }
    nav::-webkit-scrollbar { display: none; }
    .item { width: auto; flex: none; }
    .bl, .soon-tag { display: none; }
  }
</style>
