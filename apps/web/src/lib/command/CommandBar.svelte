<script lang="ts">
  /**
   * The command surface (`docs/12` §"Wren is the command surface").
   *
   * One input, opened with ⌘K, taking both fuzzy commands and plain phrasing.
   * It is the same surface as asking Wren, which is why her face is on it and
   * why "explain" results render *here* rather than navigating somewhere — an
   * answer is a result, not a destination.
   */
  import Icon from '../Icon.svelte';
  import { core } from '../fake/core.svelte.js';
  import { buildCommands, score, type Command, type Ctx } from './commands.js';

  let {
    open = $bindable(false),
    ctx,
  }: { open?: boolean; ctx: Ctx } = $props();

  let q = $state('');
  let sel = $state(0);
  let field = $state<HTMLInputElement>();
  /** An Explain answer, held open until you type again or close. */
  let answer = $state<{ title: string; body: string } | null>(null);

  const all = $derived(open ? buildCommands(ctx) : []);

  const results = $derived.by(() => {
    if (!q.trim()) {
      // No query: a short useful default rather than 60 rows of everything.
      const order = ['Explain', 'Go to', 'Configure', 'Create', 'Security'];
      return [...all]
        .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
        .slice(0, 9);
    }
    return all
      .map((c) => ({ c, s: score(c, q.trim()) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.c);
  });

  /** Group headers, computed from the result order so they never lie. */
  const grouped = $derived.by(() => {
    const out: { group: string; items: Command[] }[] = [];
    for (const c of results) {
      const last = out[out.length - 1];
      if (last && last.group === c.group) last.items.push(c);
      else out.push({ group: c.group, items: [c] });
    }
    return out;
  });

  const flat = $derived(grouped.flatMap((g) => g.items));

  $effect(() => {
    if (!open) return;
    // Opening it counts as having found it, which is what Wren's "there's a
    // command bar" notice is watching for.
    core.commandSurfaceUsed = true;
    field?.focus();
  });

  $effect(() => {
    void q;
    sel = 0;
    answer = null;
  });

  function run(c: Command) {
    const result = c.run();
    if (typeof result === 'string') {
      // An explanation. Stay open and show it.
      answer = { title: c.label, body: result };
      return;
    }
    close();
  }

  function close() {
    open = false;
    q = '';
    answer = null;
    sel = 0;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (answer) answer = null;
      else close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(flat.length - 1, sel + 1);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = flat[sel];
      if (c) run(c);
    }
  }
</script>

{#if open}
  <div
    class="scrim"
    role="button"
    tabindex="-1"
    aria-label="Close the command bar"
    onclick={close}
    onkeydown={(e) => e.key === 'Enter' && close()}
  ></div>

  <div class="palette" role="dialog" aria-modal="true" aria-label="Command bar">
    <div class="input">
      <img src="/wren/face-warm.webp" alt="" width="24" height="24" />
      <input
        bind:this={field}
        bind:value={q}
        onkeydown={onKey}
        type="text"
        placeholder="Go somewhere, change something, or ask what the server can see"
        aria-label="Command"
        autocomplete="off"
        spellcheck="false"
      />
      <kbd>esc</kbd>
    </div>

    {#if answer}
      <div class="answer">
        <h3>{answer.title}</h3>
        {#each answer.body.split('\n\n') as para (para)}
          <p>{para}</p>
        {/each}
        <p class="from">
          Worked out from this room's settings on this device. Nothing was sent
          anywhere to answer it.
        </p>
      </div>
    {:else}
      <div class="results" role="listbox" aria-label="Results">
        {#each grouped as g (g.group)}
          <div class="group">{g.group}</div>
          {#each g.items as c (c.id)}
            {@const i = flat.indexOf(c)}
            <button
              class="row"
              class:sel={i === sel}
              role="option"
              aria-selected={i === sel}
              onclick={() => run(c)}
              onmouseenter={() => (sel = i)}
            >
              {#if c.icon}<Icon name={c.icon} size={15} />{/if}
              <span class="l">{c.label}</span>
              {#if c.hint}<span class="h">{c.hint}</span>{/if}
            </button>
          {/each}
        {:else}
          <p class="empty">
            Nothing matches “{q}”. She only knows about this device — rooms,
            people you share one with, and your own settings.
          </p>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 74; border: 0; padding: 0;
    background: var(--scrim); backdrop-filter: blur(3px);
    animation: fade var(--t-fast) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .palette {
    position: fixed; z-index: 75; left: 50%; top: 14vh; translate: -50% 0;
    width: min(640px, calc(100vw - 32px));
    max-height: 68vh; display: flex; flex-direction: column; overflow: hidden;
    background: var(--ground-0); border: 1px solid var(--ground-4);
    border-radius: var(--r-lg); box-shadow: var(--shadow-panel);
    animation: drop var(--t-base) var(--ease);
  }
  @keyframes drop {
    from { opacity: 0; transform: translateY(-8px) scale(.99); }
    to { opacity: 1; transform: none; }
  }

  .input {
    display: flex; align-items: center; gap: 10px; padding: 12px 14px;
    border-bottom: 1px solid var(--line); background: var(--ground-1);
  }
  .input img { border-radius: 50%; background: var(--ground-3); flex: none; }
  .input input {
    flex: 1; min-width: 0; border: 0; background: transparent; color: var(--text);
    font: inherit; font-size: var(--text-base); outline: none;
  }
  .input input::placeholder { color: var(--text-mute); }
  kbd {
    font-family: var(--font-mono); font-size: 10px; color: var(--text-mute);
    border: 1px solid var(--line); border-radius: var(--r-xs); padding: 2px 6px; flex: none;
  }

  .results { overflow-y: auto; padding: 6px; }
  .group {
    font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-mute); padding: 9px 9px 4px;
  }
  .row {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    border: 0; background: transparent; cursor: pointer; color: var(--text-dim);
    padding: 8px 9px; border-radius: var(--r-sm); font: inherit; font-size: var(--text-sm);
  }
  .row.sel { background: var(--ground-3); color: var(--text); }
  .l { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .h { font-size: 11px; color: var(--text-mute); flex: none; }

  .empty { padding: 22px 14px; margin: 0; font-size: var(--text-sm); color: var(--text-mute); line-height: 1.55; }

  .answer { overflow-y: auto; padding: 18px 18px 20px; }
  .answer h3 { margin: 0 0 10px; font-size: var(--text-sm); font-weight: 700; }
  .answer p { margin: 0 0 10px; font-size: var(--text-sm); color: var(--text-dim); line-height: 1.6; }
  .answer .from {
    margin: 14px 0 0; font-size: 11px; color: var(--text-mute);
    border-left: 2px solid var(--line); padding-left: 11px;
  }
</style>
