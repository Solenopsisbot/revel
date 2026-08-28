<script lang="ts">
  /**
   * One message.
   *
   * Alignment is the fussy part and it is deliberate: the avatar, the author
   * line and every badge on it share one 20px optical line, set by --line-h.
   * Mixing `baseline` and `center` across those elements is what made the
   * agent tags sit a pixel high before; everything here centres on the same
   * axis instead.
   */
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import RichText from './RichText.svelte';
  import Popover from './Popover.svelte';
  import Menu from './Menu.svelte';
  import type { Item } from './menu.js';
  import EmojiPicker from './EmojiPicker.svelte';
  import Attachments from './media/Attachments.svelte';
  import { core, MY_ACCOUNT } from './fake/core.svelte.js';
  import { contextMenu } from './contextmenu.svelte.js';
  import { clock, names } from './format.js';
  import type { Message } from './fake/data.js';

  let {
    m,
    grouped,
    unreadAbove = false,
    bubble = false,
  }: {
    m: Message;
    grouped: boolean;
    unreadAbove?: boolean;
    /**
     * Bubble style (`docs/07` §"Two message styles"). DMs get it by default;
     * a space room can be switched to it and a busy DM can be switched off it.
     * Everything inside the row is unchanged — the same avatar, author line,
     * rich text, reactions and menus. Only the frame differs.
     */
    bubble?: boolean;
  } = $props();

  const face = $derived(core.faces[m.faceId]!);
  const mine = $derived(core.mine(m));
  const editing = $derived(core.editing === m.id);
  const confirming = $derived(core.confirmingDelete === m.id);

  /** The element the picker hangs off. Set from whichever control opened it —
      the hover bar and the inline "+" are two triggers for one panel, and
      binding both to one variable made them overwrite each other. */
  let pickerAnchor = $state<HTMLElement>();
  let moreBtn = $state<HTMLElement>();
  let pickerOpen = $state(false);
  let menuOpen = $state(false);
  let draft = $state('');
  let editor = $state<HTMLTextAreaElement>();

  const target = $derived(m.replyTo ? core.find(m.replyTo) : undefined);

  const menuItems = $derived<Item[]>([
    { id: 'react', label: 'Add reaction', icon: 'react' },
    { id: 'reply', label: 'Reply', icon: 'reply', key: 'R' },
    { id: 'copy', label: 'Copy text', icon: 'copy' },
    { id: 'pin', label: m.pinned ? 'Unpin' : 'Pin to room', icon: 'pin' },
    ...(mine ? [{ id: 'edit', label: 'Edit', icon: 'pencil', key: 'E' } satisfies Item] : []),
    ...(mine ? [{ id: 'delete', label: 'Delete', icon: 'trash', danger: true } satisfies Item] : []),
  ]);

  function startEdit() {
    draft = m.body;
    core.editing = m.id;
    // The textarea only exists after the branch renders, hence the microtask.
    queueMicrotask(() => {
      editor?.focus();
      editor?.setSelectionRange(draft.length, draft.length);
      if (editor) grow(editor);
    });
  }

  function grow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      core.saveEdit(m.id, draft);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      core.editing = null;
    }
  }

  function pickMenu(id: string) {
    menuOpen = false;
    if (id === 'react') { pickerAnchor = moreBtn; pickerOpen = true; }
    if (id === 'reply') core.replyTo = m.id;
    if (id === 'copy') void navigator.clipboard?.writeText(m.body);
    if (id === 'pin') core.pin(m.id);
    if (id === 'edit') startEdit();
    if (id === 'delete') core.confirmingDelete = m.id;
  }

  /**
   * Right-click opens the same items the ⋯ button does. Deliberately the same
   * list rather than a second one: two menus for one object drift, and then
   * people learn that one of them is the "real" one.
   *
   * Skipped when there's a text selection, so right-clicking to copy a quoted
   * phrase still reaches the browser's own menu.
   */
  function onContext(e: MouseEvent) {
    if (!window.getSelection()?.isCollapsed) return;
    contextMenu.open(e, menuItems, pickMenu, face.name);
  }

  /** "Rae, June and 2 others reacted with 🔥" — the tooltip does the work. */
  function who(by: string[], key: string) {
    return `${names(by.map((f) => core.faces[f]?.name ?? f))} reacted with ${key}`;
  }
</script>

{#if unreadAbove}
  <!-- Frozen where it was when the room opened, so it doesn't crawl upward
       under someone who is still reading (docs/05 §1). -->
  <div class="unread-line" role="separator"><span>New</span></div>
{/if}

<article
  id="m-{m.id}"
  class="row"
  class:bubble
  class:mine
  class:grouped={grouped && !unreadAbove}
  class:pending={m.pending}
  class:editing
  class:gone={!!m.deleted}
  class:flash={core.jumpTo === m.id}
  style="--fc: var(--face-{face.colour})"
  oncontextmenu={onContext}
>
  <div class="gutter">
    {#if grouped && !unreadAbove}
      <time class="stamp">{clock(m.at)}</time>
    {:else}
      <button class="avatar-btn" onclick={() => (core.profileFor = face.id)} aria-label="{face.name}'s profile">
        <Avatar {face} size={40} />
      </button>
    {/if}
  </div>

  <div class="body">
    {#if target}
      <button
        class="replyto"
        style="--rc: var(--face-{core.faces[target.faceId]!.colour})"
        onclick={() => (core.jumpTo = target.id)}
      >
        <Icon name="reply" size={13} />
        <span class="who">{core.faces[target.faceId]!.name}</span>
        <span class="snip">{target.deleted ? 'message deleted' : target.body || 'attachment'}</span>
      </button>
    {/if}

    {#if !grouped || unreadAbove}
      <div class="author-line">
        <button class="author" onclick={() => (core.profileFor = face.id)}>{face.name}</button>
        {#if face.agent}
          <span class="badge agent" title="Software, run by {face.agent.by}">{face.agent.label}</span>
        {/if}
        {#if face.accountId === MY_ACCOUNT && face.id !== 'viola'}
          <span class="badge same">same system</span>
        {/if}
        <time class="at">{clock(m.at)}</time>
        {#if m.pinned}<span class="mark" title="Pinned"><Icon name="pin" size={12} /></span>{/if}
      </div>
    {/if}

    {#if m.deleted}
      <p class="tomb">
        <Icon name="trash" size={14} />
        {m.deleted.by === 'author' ? 'This message was deleted.' : 'A moderator removed this message.'}
      </p>
    {:else if editing}
      <div class="edit">
        <textarea
          bind:this={editor}
          bind:value={draft}
          onkeydown={onEditKey}
          oninput={(e) => grow(e.currentTarget)}
          aria-label="Edit message"
          rows="1"
        ></textarea>
        <div class="edit-hint">
          <button class="tiny" onclick={() => (core.editing = null)}>Cancel</button>
          <button class="tiny go" onclick={() => core.saveEdit(m.id, draft)}>Save</button>
          <span>escape to cancel · enter to save</span>
        </div>
      </div>
    {:else}
      {#if m.body}
        <div class="text">
          <RichText body={m.body} />
          {#if m.editedAt}
            <span class="edited" title="Edited at {clock(m.editedAt)}">(edited)</span>
          {/if}
        </div>
      {/if}

      {#if m.attachments?.length}
        <Attachments list={m.attachments} />
      {/if}

      {#if m.link}
        <!-- Rendered by the sender's client. The server never fetches a link,
             because fetching one would tell it what you posted (docs/03). -->
        <a class="card" href={m.link.url} target="_blank" rel="noreferrer noopener">
          <span class="card-site">{m.link.site}</span>
          <span class="card-title">{m.link.title}</span>
          {#if m.link.blurb}<span class="card-blurb">{m.link.blurb}</span>{/if}
        </a>
      {/if}

      {#if m.annotation}
        <div class="annot">
          <div class="who">
            <Icon name="globe" size={13} />
            <span>Translated by {m.annotation.by} · {m.annotation.kind}</span>
          </div>
          <div class="body-t">{m.annotation.body}</div>
        </div>
      {/if}
    {/if}

    {#if m.reactions?.length && !m.deleted}
      <div class="reactions">
        {#each m.reactions as r (r.key)}
          {@const mineToo = r.by.includes(core.speakingAs)}
          <button
            class="rx"
            class:mine={mineToo}
            onclick={() => core.react(m.id, r.key)}
            title={who(r.by, r.key)}
            aria-pressed={mineToo}
          >
            <span class="emote">{r.key}</span><span class="n">{r.by.length}</span>
          </button>
        {/each}
        <button
          class="rx add"
          onclick={(e) => { pickerAnchor = e.currentTarget; pickerOpen = !pickerOpen; }}
          aria-label="Add a reaction"
        ><Icon name="react" size={14} /></button>
      </div>
    {/if}

    {#if confirming}
      <div class="confirm" role="alertdialog" aria-label="Confirm delete">
        <Icon name="warn" size={15} />
        <span>Delete this message? The row stays; the text goes.</span>
        <button class="tiny" onclick={() => (core.confirmingDelete = null)}>Cancel</button>
        <button class="tiny bad" onclick={() => core.remove(m.id)}>Delete</button>
      </div>
    {/if}
  </div>

  {#if !m.deleted && !editing}
    <div class="actions">
      <button
        class:on={pickerOpen}
        onclick={(e) => { pickerAnchor = e.currentTarget; pickerOpen = !pickerOpen; }}
        title="Add reaction"
        aria-label="Add reaction"
      ><Icon name="react" size={16} /></button>
      <button onclick={() => (core.replyTo = m.id)} title="Reply" aria-label="Reply">
        <Icon name="reply" size={16} />
      </button>
      {#if mine}
        <button onclick={startEdit} title="Edit" aria-label="Edit"><Icon name="pencil" size={16} /></button>
      {/if}
      <button
        bind:this={moreBtn}
        class:on={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
        title="More"
        aria-label="More actions"
      ><Icon name="more" size={16} /></button>
    </div>
  {/if}
</article>

{#if pickerOpen}
  <Popover anchor={pickerAnchor} align="end" prefer="top" onclose={() => (pickerOpen = false)}>
    <EmojiPicker
      chosen={(m.reactions ?? []).filter((r) => r.by.includes(core.speakingAs)).map((r) => r.key)}
      onpick={(c) => { core.react(m.id, c); pickerOpen = false; }}
      onclose={() => (pickerOpen = false)}
    />
  </Popover>
{/if}

{#if menuOpen}
  <Popover anchor={moreBtn} align="end" prefer="bottom" onclose={() => (menuOpen = false)}>
    <Menu items={menuItems} onpick={pickMenu} />
  </Popover>
{/if}

<style>
  /* The one optical line everything on the author row centres on. */
  .row { --line-h: 20px; }

  .row {
    display: flex; gap: 12px; padding: var(--row-pad-y) 16px; position: relative;
    align-items: flex-start;
    animation: arrive var(--t-base) var(--ease);
  }
  /* New messages fade and rise 4px — enough to notice, not enough to watch.
     Bottom-anchored, so nothing above reflows (docs/32). */
  @keyframes arrive { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

  /* Hover is a background lift plus a hairline on the left edge — enough to
     locate the row you are acting on without the list looking striped. */
  .row::before {
    content: ''; position: absolute; inset: 0 auto 0 0; width: 2px;
    background: var(--fc); opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }
  .row:hover { background: var(--ground-2); }
  .row:hover::before { opacity: .55; }
  .row:has(.actions button:focus-visible) { background: var(--ground-2); }
  .row.grouped { padding-top: var(--row-gap); padding-bottom: var(--row-gap); }
  .row.editing { background: var(--ground-2); }
  .row.gone { opacity: .72; }

  /* A jumped-to message gets one pulse of its own colour, then nothing. Long
     enough to find, short enough not to nag. */
  .row.flash { animation: found 1.4s var(--ease); }
  @keyframes found {
    0%, 55% { background: color-mix(in oklab, var(--fc) 20%, transparent); }
    100% { background: transparent; }
  }

  .gutter {
    width: 40px; flex: none; display: flex; justify-content: flex-end;
    /* Nudges the 40px avatar so its centre matches the author line's. */
    padding-top: 2px;
  }
  .avatar-btn { border: 0; background: none; padding: 0; cursor: pointer; border-radius: 50%; }
  .stamp {
    font-size: 10px; color: var(--text-mute); line-height: var(--line-h);
    font-variant-numeric: tabular-nums; opacity: 0;
    transition: opacity var(--t-fast) var(--ease);
  }
  .row:hover .stamp { opacity: 1; }

  .body { min-width: 0; flex: 1; }

  /* An optimistic message is provisional and says so. It does NOT animate
     into place, because that would claim it succeeded (docs/32). */
  .row.pending .body { opacity: .6; }
  .row:not(.pending) .body { opacity: 1; transition: opacity var(--t-fast) var(--ease); }

  .author-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: var(--line-h); }
  .author {
    border: 0; background: none; padding: 0; cursor: pointer;
    font: inherit; font-weight: 700; color: var(--fc); line-height: var(--line-h);
  }
  .author:hover { text-decoration: underline; }
  .at { font-size: var(--text-xs); color: var(--text-mute); line-height: var(--line-h); }
  .mark { color: var(--text-mute); display: inline-flex; align-items: center; }

  .badge {
    display: inline-flex; align-items: center; height: 16px;
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    padding: 0 6px; border-radius: var(--r-xs); line-height: 1;
    border: 1px solid var(--text-mute); color: var(--text-dim);
  }
  .badge.same {
    border-color: color-mix(in oklab, var(--fc) 45%, transparent);
    color: var(--fc); background: color-mix(in oklab, var(--fc) 16%, transparent);
  }

  .text { position: relative; }
  .edited { font-size: 10px; color: var(--text-mute); margin-left: 4px; white-space: nowrap; }

  .tomb {
    margin: 0; display: flex; align-items: center; gap: 7px;
    color: var(--text-mute); font-size: var(--text-sm); font-style: italic;
  }

  .replyto {
    display: flex; align-items: center; gap: 6px; margin-bottom: 3px;
    background: none; border: 0; padding: 0; cursor: pointer;
    font-size: var(--text-xs); color: var(--text-mute); max-width: 100%;
    line-height: var(--line-h);
  }
  .replyto .who { font-weight: 700; color: var(--rc); }
  .replyto .snip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .replyto:hover .snip, .replyto:hover { color: var(--text-dim); }

  .edit textarea {
    width: 100%; resize: none; font: inherit; color: var(--text);
    background: var(--ground-3); border: 2px solid var(--brand);
    border-radius: var(--r-md); padding: 8px 11px; max-height: 320px;
  }
  .edit textarea:focus { outline: none; box-shadow: var(--focus-ring); }
  .edit-hint {
    display: flex; align-items: center; gap: 8px; margin-top: 6px;
    font-size: var(--text-xs); color: var(--text-mute);
  }

  .tiny {
    border: 1px solid var(--line); background: var(--ground-3); cursor: pointer;
    color: var(--text-dim); font-size: var(--text-xs); font-weight: 700;
    padding: 3px 10px; border-radius: var(--r-pill);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease),
      border-color var(--t-fast) var(--ease);
  }
  .tiny:hover { background: var(--ground-4); color: var(--text); }
  .tiny.go { background: var(--brand); border-color: var(--brand); color: #fff; }
  .tiny.bad { background: var(--face-rose); border-color: var(--face-rose); color: #fff; }

  .confirm {
    display: flex; align-items: center; gap: 9px; margin-top: 7px;
    font-size: var(--text-sm); color: var(--text-dim);
    background: color-mix(in oklab, var(--face-rose) 14%, var(--ground-2));
    border: 1px solid color-mix(in oklab, var(--face-rose) 45%, transparent);
    border-radius: var(--r-sm); padding: 8px 11px;
    animation: drop var(--t-fast) var(--ease);
  }
  .confirm > span { flex: 1; }
  @keyframes drop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

  .card {
    display: flex; flex-direction: column; gap: 2px; margin-top: 6px; max-width: 420px;
    text-decoration: none; color: inherit;
    border-left: 3px solid var(--face-sky); background: var(--ground-2);
    border-radius: 0 var(--r-sm) var(--r-sm) 0; padding: 9px 13px;
    transition: background var(--t-fast) var(--ease);
  }
  .card:hover { background: var(--ground-3); }
  .card-site { font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--text-mute); }
  .card-title { font-weight: 700; font-size: var(--text-sm); color: var(--face-sky); }
  .card-blurb { font-size: var(--text-sm); color: var(--text-dim); }

  .annot {
    margin-top: 6px; padding: 7px 12px; border-left: 3px solid var(--face-aqua);
    background: color-mix(in oklab, var(--face-aqua) 10%, transparent);
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }
  .annot .who {
    display: flex; align-items: center; gap: 5px;
    font-size: var(--text-xs); color: var(--face-aqua); font-weight: 700; margin-bottom: 2px;
  }
  .annot .body-t { font-size: var(--text-sm); }

  .reactions { display: flex; gap: 5px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
  .rx {
    display: inline-flex; align-items: center; gap: 5px; height: 24px; cursor: pointer;
    background: var(--ground-3); border: 1px solid var(--line);
    border-radius: var(--r-pill); padding: 0 8px;
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }
  .rx:hover { border-color: var(--brand); transform: translateY(-1px); }
  .rx:active { transform: none; }
  .rx.mine { background: color-mix(in oklab, var(--brand) 24%, transparent); border-color: var(--brand); }
  .emote { font-size: 15px; line-height: 1; }
  /* A count change pops just enough to catch peripheral vision. */
  .rx .n {
    font-weight: 700; font-size: var(--text-xs); line-height: 1;
    font-variant-numeric: tabular-nums; animation: pop var(--t-fast) var(--ease);
  }
  @keyframes pop { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }
  /* The add button only shows once there is a row to add to; before that the
     hover bar is the way in, so it isn't two controls for one job. */
  .rx.add { padding: 0 7px; color: var(--text-mute); opacity: 0; }
  .row:hover .rx.add, .rx.add:focus-visible { opacity: 1; }
  .rx.add:hover { color: var(--text); }

  .actions {
    position: absolute; right: 14px; top: -12px; display: flex; gap: 1px; padding: 3px;
    background: var(--ground-3); border: 1px solid var(--line); border-radius: var(--r-sm);
    opacity: 0; pointer-events: none; transform: translateY(3px);
    transition: opacity var(--t-fast) var(--ease), transform var(--t-fast) var(--ease);
    box-shadow: var(--shadow-ambient);
  }
  .row:hover .actions,
  .row:has(.actions button:focus-visible) .actions,
  .row:has(.actions button.on) .actions { opacity: 1; pointer-events: auto; transform: none; }
  .actions button {
    border: 0; background: transparent; color: var(--text-dim); cursor: pointer;
    width: 28px; height: 28px; border-radius: var(--r-xs); display: grid; place-items: center;
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .actions button:hover, .actions button.on { background: var(--ground-4); color: var(--text); }
  .actions button:active { transform: scale(0.9); }

  .unread-line {
    display: flex; align-items: center; gap: 10px; padding: 6px 16px 2px;
    color: var(--face-rose); font-size: 10px; font-weight: 800;
    letter-spacing: .09em; text-transform: uppercase;
  }
  .unread-line::before, .unread-line::after {
    content: ''; height: 1px; background: color-mix(in oklab, var(--face-rose) 55%, transparent);
  }
  .unread-line::before { flex: 1; }
  .unread-line::after { flex: 0 0 24px; }
  .unread-line span { flex: none; }

  /* ---- bubbles -----------------------------------------------------------
     A DM is a conversation between two or three people, so the useful visual
     job is "who said this" rather than "scan a wall fast" — which is the job
     rows are for. The bubble carries the sender's face colour, the same one
     that names them everywhere else.

     Own messages sit on the right. `docs/07` doesn't specify that, but a
     two-person conversation where both sides are left-aligned makes you read
     the name on every line to know who is talking, and the convention exists
     because it works. */
  .row.bubble {
    padding: 3px 16px;
    align-items: flex-end;
  }
  .row.bubble.grouped { padding-top: 1px; }
  .row.bubble::before { display: none; }
  .row.bubble:hover { background: transparent; }

  .row.bubble .gutter { align-self: flex-end; }
  .row.bubble .stamp { display: none; }

  .row.bubble .body {
    background: var(--ground-2);
    border-radius: 16px 16px 16px 5px;
    padding: 8px 13px;
    max-width: min(74%, 46rem);
    width: fit-content;
  }
  .row.bubble.grouped .body { border-top-left-radius: 16px; }

  /* Tinted in the sender's colour, lightly — enough to be theirs, not enough
     to fight the text on top of it. */
  .row.bubble:not(.mine) .body {
    background: color-mix(in oklab, var(--fc) 14%, var(--ground-2));
  }

  .row.bubble.mine {
    flex-direction: row-reverse;
  }
  .row.bubble.mine .body {
    background: color-mix(in oklab, var(--brand) 26%, var(--ground-2));
    border-radius: 16px 16px 5px 16px;
    margin-left: auto;
  }
  .row.bubble.mine.grouped .body { border-top-right-radius: 16px; }
  .row.bubble.mine .author-line { flex-direction: row-reverse; }
  .row.bubble.mine .actions { left: 16px; right: auto; }

  /* The avatar only appears on the first message of a run; the rest indent to
     match so the column stays straight. */
  .row.bubble.grouped .gutter { visibility: hidden; }
</style>