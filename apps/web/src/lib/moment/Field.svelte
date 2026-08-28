<script lang="ts">
  // FullAutoFill is the same union the DOM typings use for the attribute, so a
  // caller cannot pass a token the browser will ignore.
  import type { FullAutoFill } from 'svelte/elements';

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
    autocomplete?: FullAutoFill;
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
  .lbl { display: block; font-size: var(--text-sm); font-weight: 600; color: var(--text); margin-bottom: 6px; }
  .wrap {
    display: flex; align-items: center; gap: 8px;
    background: var(--ground-0);
    border: 2px solid var(--ground-4);
    border-radius: var(--r-sm); padding: 0 12px;
    transition: border-color var(--t-base) var(--ease), background var(--t-base) var(--ease),
      box-shadow var(--t-base) var(--ease);
  }
  .wrap:hover { border-color: color-mix(in oklab, var(--face-aqua) 40%, var(--ground-4)); }
  .wrap:focus-within {
    border-color: var(--face-aqua);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--face-aqua) 30%, transparent);
  }
  .wrap.invalid { border-color: var(--face-coral); }
  input { flex: 1; background: none; border: 0; color: var(--text); font: inherit; padding: 11px 0; min-width: 0; }
  input:focus { outline: none; }
  input::placeholder { color: var(--text-mute); }
  .suffix { color: var(--text-mute); font-size: var(--text-sm); white-space: nowrap; }
  .hint { display: block; font-size: var(--text-xs); color: color-mix(in oklab, var(--text) 62%, transparent); margin-top: 6px; }
</style>
