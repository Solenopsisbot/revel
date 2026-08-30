<script lang="ts">
import Icon from '$lib/Icon.svelte';
import { THEMES, theme } from '$lib/theme.svelte.js';
</script>

<h2>Appearance</h2>
<p class="lede">Changes apply everywhere immediately and follow this device.</p>

<section>
  <h3>Theme</h3>
  <div class="themes">
    {#each THEMES as t (t.id)}
      <button
        class="theme"
        class:sel={theme.current.theme === t.id}
        onclick={() => theme.set('theme', t.id)}
        aria-pressed={theme.current.theme === t.id}
      >
        <span class="preview" data-theme={t.id}>
          <span class="p-rail"></span>
          <span class="p-body">
            <span class="p-line w1"></span>
            <span class="p-line w2"></span>
            <span class="p-chip"></span>
          </span>
        </span>
        <span class="meta">
          <span class="nm">{t.name}</span>
          <span class="hint">{t.hint}</span>
        </span>
        {#if theme.current.theme === t.id}<span class="tick"><Icon name="check" size={14} /></span>{/if}
      </button>
    {/each}
  </div>
</section>

<section>
  <h3>Density</h3>
  <p class="sub">How much room the message list gives each message.</p>
  <div class="seg">
    <button class:sel={theme.current.density === 'cozy'} onclick={() => theme.set('density', 'cozy')}>Cozy</button>
    <button class:sel={theme.current.density === 'compact'} onclick={() => theme.set('density', 'compact')}>Compact</button>
  </div>
</section>

<section>
  <h3>Personality</h3>
  <p class="sub">
    Calm drops the raised-button lift and the ambient glow, and keeps colour,
    shape and type. It is the low-distraction setting, not a downgrade.
  </p>
  <div class="seg">
    <button class:sel={theme.current.personality === 'full'} onclick={() => theme.set('personality', 'full')}>Full</button>
    <button class:sel={theme.current.personality === 'calm'} onclick={() => theme.set('personality', 'calm')}>Calm</button>
  </div>
</section>

<section>
  <h3>Motion</h3>
  <label class="row">
    <input
      type="checkbox"
      checked={theme.current.reduceMotion}
      onchange={(e) => theme.set('reduceMotion', e.currentTarget.checked)}
    />
    <span>
      <b>Reduce motion</b>
      <span class="sub">
        Removes transitions and animations entirely rather than shortening them.
        Nothing in the app depends on motion to be readable.
      </span>
    </span>
  </label>
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); }
  section { margin-bottom: 34px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 12px; display: block; }

  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin-top: 12px; }
  .theme {
    display: flex; align-items: center; gap: 11px; text-align: left; cursor: pointer;
    background: var(--ground-2); border: 2px solid var(--line); border-radius: var(--r-md);
    padding: 9px; color: var(--text); font: inherit;
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .theme:hover { border-color: var(--ground-4); }
  .theme.sel { border-color: var(--brand); background: var(--ground-3); }

  /* Each preview renders in its own theme, so the list shows you the thing
     rather than describing it. */
  .preview {
    width: 54px; height: 38px; flex: none; border-radius: var(--r-xs); overflow: hidden;
    display: flex; background: var(--ground-0); box-shadow: inset 0 0 0 1px var(--line);
  }
  .p-rail { width: 11px; background: var(--ground-1); border-right: 1px solid var(--line); }
  .p-body { flex: 1; padding: 5px; display: flex; flex-direction: column; gap: 3px; }
  .p-line { height: 3px; border-radius: 2px; background: var(--text-mute); }
  .w1 { width: 78%; }
  .w2 { width: 54%; }
  .p-chip { width: 40%; height: 5px; border-radius: 3px; background: var(--face-aqua); margin-top: auto; }

  .meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .nm { font-weight: 600; font-size: var(--text-sm); }
  .hint { font-size: 11px; color: var(--text-mute); }
  .tick { color: var(--brand); }

  .seg { display: inline-flex; gap: 3px; background: var(--ground-2); padding: 3px; border-radius: var(--r-pill); }
  .seg button {
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 7px 18px; border-radius: var(--r-pill); background: transparent; color: var(--text-dim);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .seg button:hover { color: var(--text); }
  .seg button.sel { background: var(--brand); color: #fff; }

  .row { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
  .row input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--face-mint); cursor: pointer; flex: none; }
  .row b { display: block; font-weight: 600; margin-bottom: 2px; }
</style>
