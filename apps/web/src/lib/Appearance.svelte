<script lang="ts">
  import { THEMES, theme } from './theme.svelte.js';
  import Icon from './Icon.svelte';

  let open = $state(false);
</script>

<div class="appearance">
  <button class="trigger" onclick={() => (open = !open)} aria-expanded={open} title="Appearance">
    <span class="swatch" aria-hidden="true"></span>
    <Icon name="chevron" size={14} />
  </button>

  {#if open}
    <div class="menu" role="menu">
      <div class="grp">Theme</div>
      {#each THEMES as t (t.id)}
        <button
          class="opt"
          class:sel={theme.current.theme === t.id}
          onclick={() => theme.set('theme', t.id)}
          role="menuitemradio"
          aria-checked={theme.current.theme === t.id}
        >
          <span class="dot" data-theme={t.id}></span>
          <span class="nm">{t.name}</span>
          <span class="hint">{t.hint}</span>
          {#if theme.current.theme === t.id}<Icon name="check" size={15} />{/if}
        </button>
      {/each}

      <div class="grp">Density</div>
      <div class="seg">
        {#each ['cozy', 'compact'] as d (d)}
          <button
            class:sel={theme.current.density === d}
            onclick={() => theme.set('density', d as 'cozy' | 'compact')}
          >{d}</button>
        {/each}
      </div>

      <div class="grp">Personality</div>
      <div class="seg">
        {#each ['full', 'calm'] as p (p)}
          <button
            class:sel={theme.current.personality === p}
            onclick={() => theme.set('personality', p as 'full' | 'calm')}
          >{p}</button>
        {/each}
      </div>

      <label class="check">
        <input
          type="checkbox"
          checked={theme.current.reduceMotion}
          onchange={(e) => theme.set('reduceMotion', e.currentTarget.checked)}
        />
        <span>Reduce motion</span>
      </label>
    </div>
  {/if}
</div>

<style>
  .appearance { position: relative; }
  .trigger {
    display: flex; align-items: center; gap: 6px; cursor: pointer;
    background: transparent; border: 0; color: var(--text-dim);
    padding: 5px 7px; border-radius: var(--r-sm);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .trigger:hover { background: var(--ground-2); color: var(--text); }
  .swatch {
    width: 16px; height: 16px; border-radius: 50%;
    background: linear-gradient(140deg, var(--face-violet), var(--face-aqua));
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .menu {
    position: absolute; right: 0; top: calc(100% + 6px); z-index: 40;
    width: 250px; padding: 6px;
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-md); box-shadow: var(--shadow-panel);
    animation: rise var(--t-base) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

  .grp {
    font-size: 10px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
    color: var(--text-mute); padding: 10px 8px 4px;
  }
  .opt {
    display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
    padding: 7px 8px; border: 0; background: transparent; cursor: pointer;
    border-radius: var(--r-sm); color: var(--text); font: inherit;
    transition: background var(--t-fast) var(--ease);
  }
  .opt:hover, .opt.sel { background: var(--ground-3); }
  .opt .nm { font-weight: 600; font-size: var(--text-sm); }
  .opt .hint { flex: 1; font-size: 11px; color: var(--text-mute); }
  /* Each dot renders its own theme's ground, so the list previews itself. */
  .dot {
    width: 15px; height: 15px; border-radius: 50%; flex: none;
    background: var(--ground-0); box-shadow: inset 0 0 0 2px var(--ground-4);
  }

  .seg { display: flex; gap: 3px; padding: 0 4px 4px; }
  .seg button {
    flex: 1; border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm);
    padding: 6px 8px; border-radius: var(--r-sm); text-transform: capitalize;
    background: var(--ground-3); color: var(--text-dim);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .seg button.sel { background: var(--brand); color: #fff; }

  .check {
    display: flex; align-items: center; gap: 9px; padding: 10px 8px 6px;
    font-size: var(--text-sm); cursor: pointer;
  }
  .check input { width: 16px; height: 16px; accent-color: var(--face-mint); cursor: pointer; }
</style>
