<script lang="ts">
/**
 * The search surface (`docs/19` §Search).
 *
 * A panel rather than a modal, and that is the whole design. `docs/19` says
 * "enter jumps to the message in place" — in place meaning the room behind
 * it, with the result list still there. A modal would make you choose
 * between reading the conversation and keeping your results, which is the
 * choice nobody wants: half of searching is walking a list of near-misses.
 *
 * One layout at every width. It is `min(420px, 100vw)`, so on a phone it is
 * the screen and on a desktop it is a column — no second arrangement to
 * keep in step with the first.
 */
import Avatar from '../Avatar.svelte';
import { core } from '../fake/core.svelte.js';
import { clock, dayLabel } from '../format.js';
import Icon from '../Icon.svelte';
import { type Scope, search, type Window } from './search.svelte.js';

let input = $state<HTMLInputElement>();
let listEl = $state<HTMLElement>();
let cursor = $state(0);
let fromOpen = $state(false);

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'room', label: 'This room' },
  { id: 'space', label: core.scope === 'home' ? 'All DMs' : 'This space' },
  { id: 'everywhere', label: 'Everywhere' },
];

const WINDOWS: { id: Window; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

const results = $derived(search.results);
const fromFace = $derived(search.token('from'));
const hasFile = $derived(search.token('has') === 'file');
const inThread = $derived(search.token('in') === 'thread');

/** Focus on open, and select what's there so a second ⌘F retypes rather
      than appends — the common case is a new search, not an edit. */
$effect(() => {
  if (search.open) queueMicrotask(() => input?.select());
});

// A new result set means the old cursor position is meaningless.
$effect(() => {
  results.length;
  cursor = 0;
});

function move(d: number) {
  if (!results.length) return;
  cursor = Math.min(results.length - 1, Math.max(0, cursor + d));
  listEl?.querySelectorAll<HTMLElement>('.hit')[cursor]?.scrollIntoView({ block: 'nearest' });
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    move(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    move(-1);
  } else if (e.key === 'Enter' && results[cursor]) {
    e.preventDefault();
    search.go(results[cursor]!);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    search.close();
  }
}

/** Split an excerpt into plain and marked runs, for rendering. */
function runs(text: string, marks: [number, number][]) {
  const out: { t: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a > at) out.push({ t: text.slice(at, a), hit: false });
    out.push({ t: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) out.push({ t: text.slice(at), hit: false });
  return out;
}
</script>

<!-- `data-no-swipe`: on a phone this panel *is* the screen, so an edge drag
     on it should not also be opening a drawer underneath it. -->
<aside class="panel" aria-label="Search" data-no-swipe>
  <header>
    <div class="field">
      <Icon name="search" size={17} />
      <input
        bind:this={input}
        bind:value={search.query}
        onkeydown={onKey}
        type="search"
        placeholder="Search messages"
        aria-label="Search messages"
        autocomplete="off"
        spellcheck="false"
      />
      {#if search.query}
        <button class="clear" onclick={() => (search.query = '')} aria-label="Clear">
          <Icon name="x" size={14} />
        </button>
      {/if}
    </div>
    <button class="close" onclick={() => search.close()} aria-label="Close search">
      <Icon name="x" size={17} />
    </button>
  </header>

  <!-- Scope is not a filter, it is where you are looking, so it gets its own
       row and its own weight. The counts are on the buttons because "widen to
       the space" means nothing without knowing that the space is nine rooms. -->
  <div class="scopes" role="group" aria-label="Where to search">
    {#each SCOPES as s (s.id)}
      <button class:sel={search.scope === s.id} onclick={() => (search.scope = s.id)} aria-pressed={search.scope === s.id}>
        {s.label}
        <span class="n">{search.countFor(s.id)}</span>
      </button>
    {/each}
  </div>

  <div class="filters">
    <button class="chip" class:on={!!fromFace} onclick={() => (fromOpen = !fromOpen)} aria-expanded={fromOpen}>
      <Icon name="user" size={13} />
      {fromFace ? (core.faces[fromFace]?.name ?? fromFace) : 'From'}
    </button>
    <button class="chip" class:on={hasFile} onclick={() => search.setToken('has', hasFile ? null : 'file')} aria-pressed={hasFile}>
      <Icon name="attach" size={13} /> Has a file
    </button>
    <button class="chip" class:on={inThread} onclick={() => search.setToken('in', inThread ? null : 'thread')} aria-pressed={inThread}>
      <Icon name="forward" size={13} /> In a thread
    </button>

    <div class="seg">
      {#each WINDOWS as w (w.id)}
        <button class:sel={search.window === w.id} onclick={() => (search.window = w.id)} aria-pressed={search.window === w.id}>{w.label}</button>
      {/each}
    </div>
  </div>

  {#if fromOpen}
    <div class="faces">
      <button class:sel={!fromFace} onclick={() => { search.setToken('from', null); fromOpen = false; }}>Anyone</button>
      {#each Object.values(core.faces) as f (f.id)}
        <button
          class:sel={fromFace === f.id}
          onclick={() => { search.setToken('from', f.name.toLowerCase()); fromOpen = false; }}
        >
          <Avatar face={f} size={18} />{f.name}
        </button>
      {/each}
    </div>
  {/if}

  {#if search.indexing}
    <!-- `docs/19`: a search that can't see everything must say so, or people
         conclude the message doesn't exist. Real counts — see search.svelte.ts. -->
    <p class="indexing" role="status">
      <Icon name="clock" size={14} />
      Searching {search.indexed} of {search.roomsToIndex} rooms — older messages are still being indexed.
    </p>
  {/if}

  <div class="results" bind:this={listEl}>
    {#if !search.query.trim()}
      <div class="blank">
        <p class="head">Search your messages</p>
        <p>
          Everything is searched on this device. There is no server-side index,
          because the server holds ciphertext it can't read — so there would be
          nothing there to query even if we wanted one.
        </p>
        <p class="tips">
          <b>from:rae</b> narrows to a person · <b>has:file</b> to messages
          carrying something · <b>in:thread</b> to branches, which is where
          things go to be hard to find · <kbd>↑</kbd><kbd>↓</kbd> to walk the
          results and <kbd>enter</kbd> to jump.
        </p>
      </div>
    {:else if search.empty}
      <div class="blank">
        <p class="head">Nothing matched.</p>
        <p>
          {#if search.scope !== 'everywhere'}
            This searched {search.countFor(search.scope)}
            {search.countFor(search.scope) === 1 ? 'room' : 'rooms'}.
            <button class="widen" onclick={() => (search.scope = 'everywhere')}>
              Search all {search.countFor('everywhere')}
            </button>
          {:else if search.window !== 'any'}
            Nothing in this window.
            <button class="widen" onclick={() => (search.window = 'any')}>Search any time</button>
          {:else}
            Nothing anywhere, at any time, with these filters.
          {/if}
        </p>
      </div>
    {:else}
      <p class="count" role="status">
        {results.length}{results.length === 120 ? '+' : ''}
        {results.length === 1 ? 'result' : 'results'}
      </p>
      {#each results as hit, i (hit.roomId + hit.message.id)}
        <!-- The current face where there is one — an avatar is a fact about the
             person now — falling back to the snapshot the message carries. -->
        {@const face = (hit.message.face && core.faces[hit.message.face.id]) || undefined}
        {@const snap = hit.message.face}
        <button
          class="hit"
          class:cursor={i === cursor}
          onclick={() => { cursor = i; search.go(hit); }}
        >
          <div class="meta">
            <span class="where">{hit.where}</span>
            {#if hit.spaceName}<span class="in">{hit.spaceName}</span>{/if}
            <span class="when">{dayLabel(hit.message.at)} · {clock(hit.message.at)}</span>
          </div>
          <div class="line">
            {#if face}<Avatar {face} size={20} />{/if}
            <div class="body">
              <span class="who" style="color: var(--face-{snap?.colour ?? 'violet'})">{snap?.name ?? 'Someone'}</span>
              <span class="excerpt">
                {#each runs(hit.excerpt, hit.marks) as r, j (j)}{#if r.hit}<mark>{r.t}</mark>{:else}{r.t}{/if}{/each}
              </span>
              {#if hit.message.attachments?.length}
                <span class="tag"><Icon name="attach" size={11} /> {hit.message.attachments.length}</span>
              {/if}
            </div>
          </div>
        </button>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .panel {
    position: fixed; right: 0; top: 0; bottom: 0; z-index: 50;
    width: min(420px, 100vw);
    display: flex; flex-direction: column;
    background: var(--ground-1); border-left: 1px solid var(--line);
    box-shadow: var(--shadow-panel);
    animation: slide var(--t-base) var(--ease);
  }
  @keyframes slide { from { translate: 100% 0; } to { translate: 0 0; } }

  header { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px; flex: none; }
  .field {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px;
    background: var(--ground-3); border: 2px solid var(--line);
    border-radius: var(--r-md); padding: 0 10px;
    transition: border-color var(--t-base) var(--ease), box-shadow var(--t-base) var(--ease);
  }
  .field:focus-within { border-color: var(--brand); box-shadow: var(--focus-ring); }
  .field :global(svg) { color: var(--text-mute); flex: none; }
  .field input {
    flex: 1; min-width: 0; background: transparent; border: 0; color: var(--text);
    font: inherit; padding: 10px 0; min-height: var(--tap);
  }
  .field input:focus { outline: none; }
  /* The browser's own clear affordance is OS chrome in a themed field, and it
     appears at a different moment than ours would. */
  .field input::-webkit-search-cancel-button { display: none; }
  .clear, .close {
    flex: none; border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
    display: grid; place-items: center; border-radius: 50%;
    width: 28px; height: 28px; min-width: var(--tap); min-height: var(--tap);
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .clear:hover, .close:hover { color: var(--text); background: var(--ground-2); }

  .scopes { display: flex; gap: 4px; padding: 0 12px 8px; flex: none; }
  .scopes button {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    border: 1px solid var(--line); background: transparent; color: var(--text-mute);
    cursor: pointer; font: inherit; font-size: 12px; font-weight: 700;
    padding: 7px 6px; border-radius: var(--r-sm); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease),
      border-color var(--t-fast) var(--ease);
  }
  .scopes button:hover { color: var(--text-dim); background: var(--ground-2); }
  .scopes button.sel { background: var(--brand); border-color: var(--brand); color: #fff; }
  .scopes .n {
    font-size: 10px; font-weight: 800; opacity: .75;
    background: color-mix(in oklab, var(--text) 12%, transparent);
    border-radius: var(--r-pill); padding: 0 5px;
  }
  .scopes button.sel .n { background: color-mix(in oklab, #fff 24%, transparent); }

  .filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 10px; flex: none; align-items: center; }
  .chip, .faces button {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--line); background: transparent; color: var(--text-mute);
    cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
    padding: 5px 11px; border-radius: var(--r-pill); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease),
      border-color var(--t-fast) var(--ease);
  }
  .chip:hover, .faces button:hover { color: var(--text); background: var(--ground-2); }
  .chip.on, .faces button.sel {
    color: var(--face-mint); border-color: color-mix(in oklab, var(--face-mint) 45%, transparent);
    background: color-mix(in oklab, var(--face-mint) 14%, transparent);
  }

  .seg { display: inline-flex; gap: 2px; background: var(--ground-2); padding: 2px; border-radius: var(--r-pill); }
  .seg button {
    border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
    font: inherit; font-size: 11px; font-weight: 700; padding: 5px 10px;
    border-radius: var(--r-pill); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .seg button:hover { color: var(--text); }
  .seg button.sel { background: var(--ground-4); color: var(--text); }

  .faces { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 10px; flex: none; }

  .indexing {
    display: flex; align-items: flex-start; gap: 8px; margin: 0 12px 10px;
    font-size: 12px; line-height: 1.5; color: var(--text-dim);
    background: color-mix(in oklab, var(--face-gold) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--face-gold) 35%, var(--line));
    border-radius: var(--r-sm); padding: 9px 11px;
  }
  .indexing :global(svg) { flex: none; margin-top: 1px; color: var(--face-gold); }

  .results { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 14px; }

  .count {
    font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase;
    color: var(--text-mute); margin: 0 0 6px; padding: 0 6px;
  }

  .hit {
    display: block; width: 100%; text-align: left; border: 0; background: transparent;
    color: inherit; font: inherit; cursor: pointer;
    padding: 9px 8px; border-radius: var(--r-sm); margin-bottom: 2px;
    transition: background var(--t-fast) var(--ease);
  }
  .hit:hover { background: var(--ground-2); }
  /* Keyboard position is a different thing from hover and has to be visible
     while the pointer is somewhere else entirely. */
  .hit.cursor { background: var(--ground-3); box-shadow: inset 2px 0 0 var(--brand); }

  .meta { display: flex; align-items: baseline; gap: 7px; margin-bottom: 4px; font-size: 11px; }
  .where { font-weight: 700; color: var(--text-dim); }
  .in { color: var(--text-mute); }
  .when { margin-left: auto; color: var(--text-mute); flex: none; }

  .line { display: flex; gap: 9px; align-items: flex-start; }
  .line .body { min-width: 0; font-size: var(--text-sm); line-height: 1.5; }
  .who { font-weight: 700; margin-right: 6px; }
  .excerpt { color: var(--text-dim); overflow-wrap: anywhere; }
  mark {
    background: color-mix(in oklab, var(--face-gold) 34%, transparent);
    color: var(--text); border-radius: 3px; padding: 0 1px;
  }
  .tag {
    display: inline-flex; align-items: center; gap: 3px; margin-left: 7px;
    font-size: 10px; font-weight: 700; color: var(--text-mute);
    border: 1px solid var(--line); border-radius: var(--r-xs); padding: 0 5px;
  }

  .blank { padding: 22px 14px; }
  .blank .head { font-weight: 700; margin: 0 0 8px; font-size: var(--text-base); }
  .blank p { color: var(--text-mute); font-size: var(--text-sm); line-height: 1.6; margin: 0 0 12px; }
  .blank .tips { font-size: 12px; }
  .blank b { color: var(--text-dim); font-family: var(--font-mono); font-weight: 600; }
  kbd {
    font-family: var(--font-mono); font-size: 10px; color: var(--text-dim);
    border: 1px solid var(--line); border-radius: var(--r-xs); padding: 1px 4px; margin: 0 1px;
  }
  .widen {
    border: 0; background: transparent; color: var(--brand); cursor: pointer;
    font: inherit; font-size: var(--text-sm); font-weight: 700; padding: 0;
    text-decoration: underline; text-underline-offset: 3px;
  }
</style>
