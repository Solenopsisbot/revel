<script lang="ts">
  let {
    label,
    value = $bindable(''),
    type = 'text',
    placeholder = '',
    hint = '',
    suffix = '',
    autocomplete,
    invalid = false,
  }: {
    label: string;
    value?: string;
    type?: 'text' | 'password';
    placeholder?: string;
    hint?: string;
    suffix?: string;
    autocomplete?: string;
    invalid?: boolean;
  } = $props();
</script>

<label class="field">
  <span class="lbl">{label}</span>
  <div class="wrap" class:invalid>
    {#if type === 'password'}
      <input bind:value type="password" {placeholder} {autocomplete} />
    {:else}
      <input bind:value type="text" {placeholder} {autocomplete} />
    {/if}
    {#if suffix}<span class="suffix">{suffix}</span>{/if}
  </div>
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
  .field { display: block; margin-bottom: 16px; }
  .lbl { display: block; font-size: var(--text-sm); font-weight: 600; color: color-mix(in oklab, var(--text) 78%, transparent); margin-bottom: 6px; }
  .wrap {
    display: flex; align-items: center; gap: 8px;
    background: rgba(0, 0, 0, .22); border: 2px solid color-mix(in oklab, var(--text) 20%, transparent);
    border-radius: var(--r-sm); padding: 0 12px;
    transition: border-color var(--t-base) var(--ease), background var(--t-base) var(--ease),
      box-shadow var(--t-base) var(--ease);
  }
  .wrap:hover { border-color: color-mix(in oklab, var(--text) 34%, transparent); }
  .wrap:focus-within {
    border-color: var(--face-aqua);
    background: rgba(0, 0, 0, .3);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--face-aqua) 35%, transparent);
  }
  .wrap.invalid { border-color: var(--face-coral); }
  input { flex: 1; background: none; border: 0; color: var(--text); font: inherit; padding: 11px 0; min-width: 0; }
  input:focus { outline: none; }
  input::placeholder { color: color-mix(in oklab, var(--text) 45%, transparent); }
  .suffix { color: color-mix(in oklab, var(--text) 60%, transparent); font-size: var(--text-sm); white-space: nowrap; }
  .hint { display: block; font-size: var(--text-xs); color: color-mix(in oklab, var(--text) 58%, transparent); margin-top: 6px; }
</style>
