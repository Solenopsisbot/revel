<script lang="ts">
  /**
   * One notice, rendered identically wherever it lands.
   *
   * The panel, an inline card and the popup all use this, which is deliberate:
   * a notice that gets more dramatic as it escalates would be telling you
   * something the rung already told you, and it would mean three places to
   * keep the copy honest instead of one.
   *
   * The only thing rung changes here is `emphasis`, which affects the frame,
   * not the words.
   */
  import Icon from '../Icon.svelte';
  import type { Notice } from './wren.svelte.js';

  let {
    notice,
    emphasis = false,
    onact,
    onsilence,
  }: {
    notice: Notice;
    /** Popups and cards get a heavier frame. The copy is unchanged. */
    emphasis?: boolean;
    onact: (actionId: string, dismissive: boolean) => void;
    /** Absent in the popup: silencing a category mid-interruption is a
        decision made under pressure, and this one is worth a calmer moment. */
    onsilence?: () => void;
  } = $props();
</script>

<article class="notice sev-{notice.severity}" class:emphasis>
  <div class="head">
    <span class="pip" aria-hidden="true"></span>
    <h3>{notice.title}</h3>
    {#if onsilence}
      <button class="mute" onclick={onsilence} title="Silence this kind of notice">
        <Icon name="bell-off" size={14} />
      </button>
    {/if}
  </div>

  <p>{notice.body}</p>

  <div class="actions">
    {#each notice.actions as a (a.id)}
      <button
        class="act"
        class:quiet={a.dismissive}
        class:danger={a.destructive}
        onclick={() => onact(a.id, !!a.dismissive)}
      >{a.label}</button>
    {/each}
  </div>
</article>

<style>
  .notice {
    padding: 13px 14px 12px;
    border-radius: var(--r-md);
    background: var(--ground-2);
    border: 1px solid var(--line);
  }
  .notice.emphasis { background: var(--ground-1); border-color: var(--ground-4); }

  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  h3 { font-size: var(--text-sm); font-weight: 700; margin: 0; flex: 1; line-height: 1.35; }

  /* Severity is a dot, not a background wash — a coral panel would read as an
     error state, and most of these are not errors. */
  .pip { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--text-mute); }
  .sev-gold .pip { background: var(--face-gold); }
  .sev-coral .pip { background: var(--face-coral); }

  .mute {
    border: 0; background: transparent; cursor: pointer; color: var(--text-mute);
    padding: 3px; border-radius: var(--r-xs); display: flex; flex: none;
    opacity: 0; transition: opacity var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .notice:hover .mute, .mute:focus-visible { opacity: 1; }
  .mute:hover { color: var(--text); background: var(--ground-3); }

  p {
    margin: 0 0 11px; font-size: var(--text-sm); line-height: 1.5;
    color: var(--text-dim); padding-left: 15px;
  }

  .actions { display: flex; flex-wrap: wrap; gap: 7px; padding-left: 15px; }
  .act {
    font: inherit; font-size: var(--text-sm); font-weight: 600; cursor: pointer;
    padding: 6px 13px; border-radius: var(--r-pill);
    background: var(--brand); color: #fff; border: 0;
    transition: filter var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .act:hover { filter: brightness(1.08); }
  .act.quiet {
    background: transparent; color: var(--text-mute);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .act.quiet:hover { color: var(--text); background: var(--ground-3); }
  .act.danger { background: var(--face-rose); }
</style>
