<script lang="ts">
  /**
   * The emoji picker.
   *
   * This is the one place in the product where emoji are allowed to appear
   * (`docs/07`) — here and in the reactions people choose with it. Everything
   * else uses drawn icons, including, deliberately, this component's own
   * search and close affordances. The category tabs are the exception inside
   * the exception: a drawn icon for "food" is a worse label than a picture of
   * an apple, and they are unambiguously inside the selector.
   *
   * Navigation is a roving cursor over a (row, column) grid rather than over a
   * flat list, because the flat index and the visual position diverge at every
   * group boundary — pressing Down should land directly below the thing you
   * were on, not nine items later.
   */
  import Icon from './Icon.svelte';
  import { GROUPS, search, toned, type Emoji } from './emoji.js';
  import { core } from './fake/core.svelte.js';

  let {
    onpick,
    onclose,
    /** Reactions pool by key, so the picker can show what you already chose. */
    chosen = [],
  }: {
    onpick: (c: string) => void;
    onclose?: () => void;
    chosen?: string[];
  } = $props();

  const COLS = 9;

  /** Which emoji stands in for each group on the tab strip. */
  const TAB_FOR: Record<string, string> = {
    recent: '🕐',
    people: '😀',
    body: '👋',
    nature: '🐶',
    food: '🍎',
    activity: '⚽️',
    travel: '✈️',
    objects: '💡',
    symbols: '❤️',
  };

  let q = $state('');
  let field = $state<HTMLInputElement>();
  let scroller = $state<HTMLElement>();
  let cursor = $state({ row: 0, col: 0 });
  let hovered = $state<Emoji | null>(null);

  interface Section {
    id: string;
    label: string;
    items: Emoji[];
  }

  const sections = $derived.by<Section[]>(() => {
    if (q.trim()) {
      const hits = search(q);
      return hits.length ? [{ id: 'results', label: `${hits.length} matches`, items: hits }] : [];
    }
    const recent = core.recentEmoji
      .map((c) => ({ c, k: [] as string[] }))
      .filter((e) => e.c);
    return [
      ...(recent.length ? [{ id: 'recent', label: 'Recent', items: recent }] : []),
      ...GROUPS.map((g) => ({ id: g.id, label: g.label, items: g.items })),
    ];
  });

  /** The visual rows, in order, so Up/Down land where the eye expects. */
  const rows = $derived.by(() => {
    const out: { section: string; items: Emoji[] }[] = [];
    for (const s of sections) {
      for (let i = 0; i < s.items.length; i += COLS) {
        out.push({ section: s.id, items: s.items.slice(i, i + COLS) });
      }
    }
    return out;
  });

  const active = $derived(rows[cursor.row]?.items[Math.min(cursor.col, (rows[cursor.row]?.items.length ?? 1) - 1)]);
  /** The bottom bar previews whatever you're pointing at, cursor or mouse. */
  const preview = $derived(hovered ?? active);

  // A new query means a new list; the cursor has to come home or it points at
  // something that scrolled out of existence.
  $effect(() => {
    void q;
    cursor = { row: 0, col: 0 };
  });

  function rowIndexOf(sectionId: string) {
    return rows.findIndex((r) => r.section === sectionId);
  }

  function move(dRow: number, dCol: number) {
    let { row, col } = cursor;
    if (dCol) {
      col += dCol;
      if (col < 0) {
        row -= 1;
        col = COLS - 1;
      } else if (col >= (rows[row]?.items.length ?? 0)) {
        row += 1;
        col = 0;
      }
    } else {
      row += dRow;
    }
    row = Math.max(0, Math.min(rows.length - 1, row));
    col = Math.max(0, Math.min((rows[row]?.items.length ?? 1) - 1, col));
    cursor = { row, col };
    scrollCursorIntoView();
  }

  function scrollCursorIntoView() {
    queueMicrotask(() => {
      scroller
        ?.querySelector<HTMLElement>('.e.cursor')
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onKey(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); move(0, 1); break;
      case 'ArrowLeft': e.preventDefault(); move(0, -1); break;
      case 'ArrowDown': e.preventDefault(); move(1, 0); break;
      case 'ArrowUp': e.preventDefault(); move(-1, 0); break;
      case 'Enter':
        e.preventDefault();
        if (active) pick(active.c);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onclose?.();
        break;
    }
  }

  function pick(c: string) {
    onpick(toned(c, core.emojiTone));
  }

  function jump(sectionId: string) {
    const i = rowIndexOf(sectionId);
    if (i < 0) return;
    scroller?.querySelector<HTMLElement>(`[data-sec="${sectionId}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    cursor = { row: i, col: 0 };
  }

  /** Which section the scroller is currently showing, for the tab underline. */
  let visibleSection = $state('recent');
  function onScroll() {
    if (!scroller) return;
    const top = scroller.scrollTop + 8;
    const heads = [...scroller.querySelectorAll<HTMLElement>('[data-sec]')];
    let cur = heads[0]?.dataset.sec ?? '';
    for (const h of heads) if (h.offsetTop <= top) cur = h.dataset.sec!;
    visibleSection = cur;
  }

  $effect(() => {
    field?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="picker" role="dialog" tabindex="-1" aria-label="Pick an emoji" onkeydown={onKey}>
  <div class="top">
    <div class="search">
      <Icon name="search" size={15} />
      <input
        bind:this={field}
        bind:value={q}
        type="text"
        placeholder="Search emoji"
        aria-label="Search emoji"
        spellcheck="false"
        autocomplete="off"
      />
      {#if q}
        <button class="clear" onclick={() => (q = '')} aria-label="Clear search">
          <Icon name="x" size={13} />
        </button>
      {/if}
    </div>
    <!-- Tone applies to the hands and people groups only; the swatch shows
         what you'll get, which is the only honest preview. -->
    <div class="tones" role="radiogroup" aria-label="Skin tone">
      {#each [0, 1, 2, 3, 4, 5] as tone (tone)}
        <button
          class="tone t{tone}"
          class:sel={core.emojiTone === tone}
          role="radio"
          aria-checked={core.emojiTone === tone}
          aria-label={tone === 0 ? 'Default tone' : `Tone ${tone}`}
          onclick={() => core.setTone(tone)}
        ></button>
      {/each}
    </div>
  </div>

  {#if !q}
    <div class="tabs" data-no-swipe role="tablist" aria-label="Emoji categories">
      {#each sections as s (s.id)}
        <button
          class="tab"
          class:on={visibleSection === s.id}
          role="tab"
          aria-selected={visibleSection === s.id}
          title={s.label}
          onclick={() => jump(s.id)}
        >{TAB_FOR[s.id] ?? '•'}</button>
      {/each}
    </div>
  {/if}

  <div class="scroll" bind:this={scroller} onscroll={onScroll}>
    {#if sections.length === 0}
      <p class="none">Nothing matches “{q}”.</p>
    {/if}
    {#each sections as s (s.id)}
      {@const base = rowIndexOf(s.id)}
      <section data-sec={s.id}>
        <h4>{s.label}</h4>
        <!-- content-visibility lets the browser skip laying out the groups
             you haven't scrolled to. Without it, opening the picker costs a
             full layout of every emoji in the set. -->
        <div class="grid">
          {#each s.items as e, i (s.id + e.c + i)}
            {@const row = base + Math.floor(i / COLS)}
            {@const col = i % COLS}
            <button
              class="e"
              class:cursor={row === cursor.row && col === cursor.col}
              class:on={chosen.includes(e.c)}
              onclick={() => pick(e.c)}
              onmouseenter={() => { hovered = e; cursor = { row, col }; }}
              onmouseleave={() => (hovered = null)}
              tabindex="-1"
              title={e.k[0] ?? ''}
            >{toned(e.c, core.emojiTone)}</button>
          {/each}
        </div>
      </section>
    {/each}
  </div>

  <div class="foot">
    {#if preview}
      <span class="big">{toned(preview.c, core.emojiTone)}</span>
      <span class="nm">{preview.k.join(' ') || 'recently used'}</span>
    {:else}
      <span class="nm dim">Arrow keys to move, Enter to pick</span>
    {/if}
  </div>
</div>

<style>
  .picker {
    width: 352px; height: 396px; display: flex; flex-direction: column;
    background: var(--ground-1); border: 1px solid var(--line);
    border-radius: var(--r-md); box-shadow: var(--shadow-panel); overflow: hidden;
  }

  .top { display: flex; align-items: center; gap: 8px; padding: 9px 10px 7px; }
  .search {
    flex: 1; display: flex; align-items: center; gap: 7px; min-width: 0;
    background: var(--ground-3); border: 1px solid var(--line);
    border-radius: var(--r-sm); padding: 5px 8px; color: var(--text-mute);
    transition: border-color var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease);
  }
  .search:focus-within { border-color: var(--brand); box-shadow: var(--focus-ring); }
  .search input {
    flex: 1; min-width: 0; background: transparent; border: 0; color: var(--text);
    font: inherit; font-size: var(--text-sm); padding: 1px 0;
  }
  .search input:focus { outline: none; }
  .clear {
    border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
    display: grid; place-items: center; padding: 2px; border-radius: var(--r-xs);
  }
  .clear:hover { color: var(--text); }

  .tones { display: flex; gap: 3px; flex: none; }
  .tone {
    width: 15px; height: 15px; border-radius: 50%; cursor: pointer;
    border: 1.5px solid transparent; padding: 0;
    transition: transform var(--t-fast) var(--ease-toy), border-color var(--t-fast) var(--ease);
  }
  .tone:hover { transform: scale(1.16); }
  .tone.sel { border-color: var(--text); }
  .t0 { background: linear-gradient(135deg, #ffd84d, #f7b32b); }
  .t1 { background: #f7d9c4; }
  .t2 { background: #e0bb95; }
  .t3 { background: #c68863; }
  .t4 { background: #a15c33; }
  .t5 { background: #5c3a26; }

  .tabs {
    display: flex; gap: 1px; padding: 0 8px 6px; border-bottom: 1px solid var(--line);
    overflow-x: auto; scrollbar-width: none;
    /* Scrolls sideways, so it keeps its own horizontal drags rather than
       feeding them to the drawer gesture. */
    touch-action: auto;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    flex: 1; min-width: max(30px, var(--tap)); min-height: var(--tap);
    border: 0; background: transparent; cursor: pointer;
    font-size: 16px; line-height: 1; padding: 5px 0 6px; border-radius: var(--r-xs);
    position: relative; opacity: .62; filter: grayscale(.35);
    transition: opacity var(--t-fast) var(--ease), background var(--t-fast) var(--ease),
      filter var(--t-fast) var(--ease);
  }
  .tab:hover { opacity: 1; filter: none; background: var(--ground-2); }
  .tab.on { opacity: 1; filter: none; }
  /* The underline slides in from nothing rather than blinking on. */
  .tab.on::after {
    content: ''; position: absolute; left: 20%; right: 20%; bottom: -1px; height: 2px;
    background: var(--brand); border-radius: var(--r-pill);
    animation: underline var(--t-base) var(--ease);
  }
  @keyframes underline { from { transform: scaleX(0); } to { transform: none; } }

  .scroll { flex: 1; overflow-y: auto; padding: 4px 8px 8px; overscroll-behavior: contain; }
  section { content-visibility: auto; contain-intrinsic-size: auto 240px; }
  h4 {
    position: sticky; top: 0; z-index: 1; margin: 0; padding: 8px 3px 5px;
    font-size: 10px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
    color: var(--text-mute); background: var(--ground-1);
  }
  .grid { display: grid; grid-template-columns: repeat(9, 1fr); }
  .e {
    aspect-ratio: 1; border: 0; background: transparent; cursor: pointer;
    min-width: var(--tap); min-height: var(--tap);
    font-size: 21px; line-height: 1; border-radius: var(--r-xs); padding: 0;
    display: grid; place-items: center;
    transition: background var(--t-fast) var(--ease), transform var(--t-fast) var(--ease-toy);
  }
  .e.cursor { background: var(--ground-3); transform: scale(1.14); }
  .e.on { box-shadow: inset 0 0 0 1.5px var(--brand); }
  .e:active { transform: scale(0.9); }

  .none { color: var(--text-mute); font-size: var(--text-sm); text-align: center; padding: 40px 12px; }

  .foot {
    flex: none; display: flex; align-items: center; gap: 9px; height: 38px;
    padding: 0 12px; border-top: 1px solid var(--line); background: var(--ground-2);
  }
  .big { font-size: 20px; line-height: 1; }
  .nm {
    font-size: var(--text-xs); color: var(--text-dim); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .nm.dim { color: var(--text-mute); }
</style>
