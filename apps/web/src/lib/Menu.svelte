<script lang="ts">
  /**
   * The overflow menu. One column of labelled actions with drawn icons and,
   * where a shortcut exists, the shortcut — a menu that hides its own
   * keyboard equivalents trains people to keep using the menu.
   *
   * Rows keep their declared order so a caller can group them with `header`;
   * the one exception is `danger`, which is always sorted to the bottom under
   * a rule. A destructive action sitting between two harmless ones is how
   * people delete things they meant to pin.
   */
  import Icon from './Icon.svelte';
  import type { Item } from './menu.js';

  let {
    items,
    onpick,
  }: { items: Item[]; onpick: (id: string) => void } = $props();

  const safe = $derived(items.filter((i) => !i.danger));
  const danger = $derived(items.filter((i) => i.danger));

  /** True when any row in the menu is checkable, so the whole menu indents to
      one tick column rather than each row jumping left and right. */
  const checkable = $derived(items.some((i) => i.checked !== undefined));
</script>

<div class="menu" role="menu" class:checkable>
  {#each safe as i (i.id)}
    {#if i.header}<div class="header" role="presentation">{i.header}</div>{/if}
    <button
      role={i.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={i.checked === undefined ? undefined : i.checked}
      disabled={i.disabled}
      onclick={() => onpick(i.id)}
    >
      {#if checkable}
        <span class="tick">{#if i.checked}<Icon name="check" size={14} />{/if}</span>
      {/if}
      {#if i.icon}<Icon name={i.icon} size={15} />{/if}
      <span class="l">{i.label}</span>
      {#if i.key}<kbd>{i.key}</kbd>{/if}
    </button>
  {/each}
  {#if danger.length && safe.length}<hr />{/if}
  {#each danger as i (i.id)}
    <button class="danger" role="menuitem" disabled={i.disabled} onclick={() => onpick(i.id)}>
      {#if checkable}<span class="tick"></span>{/if}
      {#if i.icon}<Icon name={i.icon} size={15} />{/if}
      <span class="l">{i.label}</span>
      {#if i.key}<kbd>{i.key}</kbd>{/if}
    </button>
  {/each}
</div>

<style>
  .menu {
    min-width: 208px; padding: 5px; border-radius: var(--r-md);
    background: var(--ground-2); border: 1px solid var(--line);
    box-shadow: var(--shadow-panel);
  }
  button {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    border: 0; background: transparent; cursor: pointer; color: var(--text-dim);
    padding: 7px 9px; border-radius: var(--r-sm); font-size: var(--text-sm);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  button:hover:not(:disabled) { background: var(--ground-3); color: var(--text); }
  button:disabled { opacity: .4; cursor: default; }
  .l { flex: 1; }
  .tick { width: 14px; flex: none; display: flex; color: var(--brand); }
  .danger { color: var(--face-rose); }
  .danger:hover:not(:disabled) { background: color-mix(in oklab, var(--face-rose) 18%, transparent); color: var(--face-rose); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 4px 6px; }
  kbd {
    font-family: var(--font-mono); font-size: 10px; color: var(--text-mute);
    border: 1px solid var(--line); border-radius: var(--r-xs); padding: 1px 5px;
  }
  .header {
    font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-mute); padding: 8px 9px 3px;
  }
  .header:first-child { padding-top: 3px; }
</style>
