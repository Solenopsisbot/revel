<script lang="ts">
/**
 * Settings → Wren (`docs/19`): the three volumes, plus the silenced
 * categories and a way back from them.
 *
 * The un-silence list is the part that matters. `docs/12` makes silencing a
 * category permanent on purpose, and a permanent choice with no visible way
 * to undo it is a trap rather than a promise — so every silenced category is
 * listed here by name, whether or not it currently has anything to say.
 */
import Icon from '$lib/Icon.svelte';
import { CATEGORIES, NOT_BUILT } from '$lib/wren/notices.js';
import { type Volume, wren } from '$lib/wren/wren.svelte.js';

const VOLUMES: { id: Volume; name: string; blurb: string }[] = [
  {
    id: 'quiet',
    name: 'Quiet',
    blurb:
      'Panel only. She never interrupts and never renders a card in the app. The dot still appears, because an inbox with no indicator is just a hidden inbox.',
  },
  {
    id: 'normal',
    name: 'Normal',
    blurb:
      'The default. She can put a card in a natural gap, and can interrupt for the three things below — nothing else, ever.',
  },
  {
    id: 'chatty',
    name: 'Chatty',
    blurb:
      'Adds the housekeeping heuristics: unused translation models, leftover history from rooms you left, storage that is merely large rather than nearly full.',
  },
];

const counts = $derived(
  Object.fromEntries(
    CATEGORIES.map((c) => [c.id, wren.all.filter((n) => n.category === c.id).length]),
  ),
);
</script>

<h2>Wren</h2>
<p class="lede">
  She runs on this device, reads only your own settings and key state, and sends
  nothing anywhere to decide what to tell you.
</p>

<section>
  <h3>How much she speaks up</h3>
  <div class="vols">
    {#each VOLUMES as v (v.id)}
      <button
        class="vol"
        class:sel={wren.volume === v.id}
        onclick={() => wren.setVolume(v.id)}
        aria-pressed={wren.volume === v.id}
      >
        <span class="top">
          <b>{v.name}</b>
          {#if wren.volume === v.id}<Icon name="check" size={15} />{/if}
        </span>
        <span class="blurb">{v.blurb}</span>
      </button>
    {/each}
  </div>
</section>

<section>
  <h3>When she is allowed to interrupt</h3>
  <p class="sub">
    Three cases, enforced in one place in the code rather than decided per
    notice. Nothing else can take your focus, whatever it thinks of itself.
  </p>
  <ol class="rules">
    <li><b>You are about to do something irreversible.</b> Deleting a space, revoking your last device, clearing local history.</li>
    <li><b>A live safety condition.</b> Someone's key changed in a conversation you are currently in.</li>
    <li><b>A genuine cliff edge.</b> One device, and no recovery code confirmed saved.</li>
  </ol>
  <p class="budget">
    At most one interruption per session and three per week. Over budget she
    demotes to a card or the panel rather than dropping it. The safety case is
    the one exception — suppressing that would be the single dangerous silence.
    <span class="used">Used this week: {wren.popupsThisWeek} of 3.</span>
  </p>
</section>

<section>
  <h3>Categories</h3>
  <p class="sub">
    Silencing one is permanent, not for the session. This list is how you take
    it back.
  </p>
  {#each CATEGORIES as c (c.id)}
    {@const off = wren.silenced.includes(c.id)}
    <div class="cat" class:off>
      <div class="meta">
        <div class="nm">{c.name}</div>
        <div class="bl">
          {c.blurb}
          {#if !off && counts[c.id]}<span class="n">· {counts[c.id]} now</span>{/if}
        </div>
      </div>
      {#if off}
        <button class="restore" onclick={() => wren.unsilence(c.id)}>Un-silence</button>
      {:else}
        <button class="silence" onclick={() => wren.silence(c.id)}>
          <Icon name="bell-off" size={14} /> Silence
        </button>
      {/if}
    </div>
  {/each}

  {#if wren.dismissed.length}
    <button class="link" onclick={() => wren.restoreDismissed()}>
      Bring back {wren.dismissed.length} dismissed
      {wren.dismissed.length === 1 ? 'notice' : 'notices'}
    </button>
  {/if}
</section>

<section>
  <h3>What she will never do</h3>
  <ul class="never">
    <li>Send anything off this device to decide what to tell you. No telemetry, no "was this useful" ping.</li>
    <li>Comment on your messages, or on you. She talks about the system's state, not your behaviour.</li>
    <li>Keep a profile of you. Each fact a notice needs expires when the notice resolves.</li>
    <li>Tell you that you should care about privacy. She explains what a setting does and stops.</li>
  </ul>
  {#each NOT_BUILT as n (n.name)}
    <p class="cut"><b>Considered and cut:</b> {n.name}. {n.why}</p>
  {/each}
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); }
  section { margin-bottom: 34px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 12px; line-height: 1.5; }

  .vols { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .vol {
    display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer;
    background: var(--ground-2); border: 2px solid var(--line); border-radius: var(--r-md);
    padding: 12px 14px; color: var(--text); font: inherit;
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .vol:hover { border-color: var(--ground-4); }
  .vol.sel { border-color: var(--brand); background: var(--ground-3); }
  .top { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); }
  .top b { font-weight: 700; flex: 1; }
  .vol :global(svg) { color: var(--brand); }
  .blurb { font-size: var(--text-sm); color: var(--text-mute); line-height: 1.5; }

  .rules { margin: 0 0 12px; padding-left: 20px; }
  .rules li { font-size: var(--text-sm); color: var(--text-dim); margin-bottom: 6px; line-height: 1.5; }
  .rules b { color: var(--text); font-weight: 600; }

  .budget {
    margin: 0; font-size: var(--text-sm); color: var(--text-mute); line-height: 1.55;
    background: var(--ground-2); border-radius: var(--r-md); padding: 12px 14px;
  }
  .used { display: block; margin-top: 6px; font-family: var(--font-mono); font-size: 11px; }

  .cat {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 0; border-bottom: 1px solid var(--line);
  }
  .cat.off .meta { opacity: .55; }
  .meta { flex: 1; min-width: 0; }
  .nm { font-size: var(--text-sm); font-weight: 600; }
  .bl { font-size: 12px; color: var(--text-mute); margin-top: 1px; }
  .n { color: var(--text-dim); }

  .silence, .restore {
    display: flex; align-items: center; gap: 6px; flex: none;
    font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    padding: 6px 12px; border-radius: var(--r-pill);
    background: transparent; color: var(--text-mute); border: 1px solid var(--line);
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .silence:hover { color: var(--text); background: var(--ground-2); }
  .restore { color: var(--brand); border-color: var(--brand); }
  .restore:hover { background: color-mix(in oklab, var(--brand) 16%, transparent); }

  .link {
    margin-top: 14px; border: 0; background: transparent; cursor: pointer;
    font: inherit; font-size: var(--text-sm); color: var(--brand); padding: 0;
    text-decoration: underline; text-underline-offset: 3px;
  }

  .never { margin: 8px 0 0; padding-left: 20px; }
  .never li { font-size: var(--text-sm); color: var(--text-dim); margin-bottom: 6px; line-height: 1.5; }

  .cut {
    margin: 16px 0 0; font-size: 12px; color: var(--text-mute); line-height: 1.55;
    border-left: 2px solid var(--line); padding-left: 12px;
  }
</style>
