<script lang="ts">
  let {
    children,
    variant = 'primary',
    disabled = false,
    onclick,
    type = 'button',
  }: {
    children: import('svelte').Snippet;
    variant?: 'primary' | 'secondary' | 'ghost';
    disabled?: boolean;
    onclick?: () => void;
    type?: 'button' | 'submit';
  } = $props();
</script>

<button class="btn {variant}" {disabled} {onclick} {type}>{@render children()}</button>

<style>
  .btn {
    font: inherit; font-weight: 700; border: 0; cursor: pointer;
    padding: 12px 24px; border-radius: var(--r-pill);
    display: inline-flex; align-items: center; gap: 8px;
    transition: transform var(--t-fast) var(--ease-toy), box-shadow var(--t-fast) var(--ease),
      filter var(--t-fast) var(--ease), opacity var(--t-base) var(--ease),
      background var(--t-base) var(--ease);
  }
  .primary {
    background: linear-gradient(180deg, #e01868, #c82e6e); color: #fff;
    box-shadow: 0 var(--lift) 0 #9c1049, var(--shadow-ambient), var(--highlight-inset);
  }
  .secondary {
    background: var(--ground-2); color: var(--text);
    box-shadow: inset 0 0 0 1px var(--ground-4);
  }
  .ghost {
    background: transparent; color: var(--text);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 24%, transparent);
  }
  .btn:not(:disabled):hover { filter: brightness(1.08); }
  .ghost:not(:disabled):hover { background: var(--ground-2); box-shadow: inset 0 0 0 1px var(--ground-4); }
  .primary:not(:disabled):active { transform: translateY(var(--lift)); box-shadow: 0 0 0 #9c1049, var(--highlight-inset); }
  .secondary:not(:disabled):active, .ghost:not(:disabled):active { transform: scale(.97); }
  /* Inert, not explained. The label is the explanation (`docs/08`). */
  /* Inert but still legible — a disabled control the user cannot read is a
     dead end rather than a signal. */
  .btn:disabled {
    cursor: not-allowed; box-shadow: none;
    background: var(--ground-2); color: var(--text-mute);
    filter: none;
  }
</style>
