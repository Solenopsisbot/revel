<script lang="ts">
/**
 * One thread.
 *
 * `docs/05`: "streams within a room: open in a side panel on desktop, as a
 * pushed view on mobile." Both, from one component — at `min(440px, 100vw)`
 * a phone gets the whole screen, which *is* the pushed view, and the only
 * thing the two need to differ on is the back arrow. `docs/24` asks for that
 * arrow specifically, because a full-screen view with no visible way out is
 * the thing that makes people close the app.
 *
 * The parent message sits at the top, permanently, rather than scrolling
 * away with everything else. A thread whose first message you can lose track
 * of is a thread you have to scroll up to understand, and the whole reason
 * to branch is that the subject is worth keeping in view.
 *
 * What this deliberately is *not*: a room. `docs/16` — "a branch inside a
 * room. Not a room." Same audience, same key, same members (`docs/03`), so
 * there is no member list here, no audience of its own, and no notification
 * settings. Every question about who can read this has already been answered
 * by the room around it.
 */

import Avatar from '../Avatar.svelte';
import Composer from '../Composer.svelte';
import { conversation } from '../fake/conversation.svelte.js';
import { core } from '../fake/core.svelte.js';
import { dayLabel, newDay } from '../format.js';
import Icon from '../Icon.svelte';
import { layout } from '../layout.svelte.js';
import MessageRow from '../MessageRow.svelte';

const parentId = $derived(core.openThreadId!);
// Through the seam, like the room timeline, so a thread and a room render
// the same shape and swapping the source touches one file.
const parent = $derived(conversation.find(parentId));
const replies = $derived(conversation.replies(parentId));

/** Day dividers, the same rule the room list uses. */
const rows = $derived(
  replies.map((m, i) => {
    const prev = replies[i - 1];
    return {
      m,
      dayBreak: !prev || newDay(prev.at, m.at),
      // Grouped under the same author within a few minutes, as in the room.
      grouped: !!prev && prev.face?.id === m.face?.id && m.at - prev.at < 5 * 60_000,
    };
  }),
);

/**
 * What this thread is called.
 *
 * Its name if somebody gave it one, otherwise the parent's first line — never
 * a bare "Thread", because a sidebar of six identical labels is a list you have
 * to click through one at a time, which is the failure a name exists to fix.
 */
const summary = $derived(conversation.threads().find((t) => t.parent === parentId));
const label = $derived(summary ? conversation.label(summary) : 'Thread');

/** This branch's own typing, never the room's. */
const typingHere = $derived(core.typing(core.currentRoomId, parentId));

let renaming = $state(false);
let draftName = $state('');
let renameEl = $state<HTMLInputElement>();

function startRename() {
  draftName = summary?.name ?? '';
  renaming = true;
  queueMicrotask(() => renameEl?.select());
}

function commitName() {
  if (!renaming) return;
  renaming = false;
  core.nameThread(parentId, draftName);
}

function onNameKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitName();
  }
  // Escape abandons rather than saves — the same rule the message editor uses,
  // so the two never disagree about what Escape means.
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    renaming = false;
  }
}

let viewport = $state<HTMLElement>();

// New replies land at the bottom, and this is short enough that following
// it unconditionally is right — there is no "am I reading history" case in
// a fifteen-message branch.
$effect(() => {
  replies.length;
  queueMicrotask(() => {
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  });
});
</script>

<!-- `data-no-swipe`: on a phone this is the screen, so an edge drag on it must
     not also be opening a drawer behind it. -->
<aside class="thread" aria-label="Thread" data-no-swipe>
  <header>
    {#if layout.narrow}
      <button class="back" onclick={() => core.closeThread()} aria-label="Back to #{core.room.name}">
        <Icon name="chevron-left" size={19} />
      </button>
    {/if}
    <div class="title">
      <!-- A thread's name is editable in place, by anyone in the room. There is
           no permission for "may name a branch" (`docs/04` §4) and inventing
           one would be inventing policy; last writer wins, like a room name. -->
      {#if renaming}
        <input
          class="rename"
          bind:this={renameEl}
          bind:value={draftName}
          onblur={commitName}
          onkeydown={onNameKey}
          aria-label="Thread name"
          placeholder={label}
          maxlength="120"
        />
      {:else}
        <button class="name-btn" onclick={startRename} title="Rename this thread">
          <b>{label}</b>
        </button>
      {/if}
      <span>in #{core.room.name}</span>
    </div>
    {#if !layout.narrow}
      <button class="close" onclick={() => core.closeThread()} aria-label="Close thread">
        <Icon name="x" size={17} />
      </button>
    {/if}
  </header>

  {#if parent}
    <div class="parent">
      <MessageRow m={parent} grouped={false} />
    </div>
    <div class="rule">
      <span>
        {replies.length}
        {replies.length === 1 ? 'reply' : 'replies'}
      </span>
    </div>
  {:else}
    <!-- The parent is gone but the branch isn't: deleting the message that
         started a thread must not silently swallow everything said after it. -->
    <p class="orphan">
      <Icon name="warn" size={15} />
      The message this branched from was deleted. The replies are still here.
    </p>
  {/if}

  <div class="replies" bind:this={viewport} role="log" aria-label="Thread replies">
    {#if !replies.length}
      <div class="empty">
        <p>Nobody has replied yet.</p>
        <p class="fine">
          A thread keeps a tangent out of the room without moving it somewhere
          else — same people, same keys, same room. It is a branch, not a
          second place.
        </p>
      </div>
    {/if}
    {#each rows as { m, grouped, dayBreak } (m.id)}
      {#if dayBreak}
        <div class="day" role="separator"><span>{dayLabel(m.at)}</span></div>
      {/if}
      <MessageRow {m} {grouped} />
    {/each}
  </div>

  <!-- Typing in a branch is not typing in the room (`docs/16`), so the notice
       belongs here and only here. -->
  {#if typingHere.length}
    <div class="typing">
      {typingHere.map((id) => core.faces[id]?.name ?? 'Someone').join(', ')} typing…
    </div>
  {/if}
  <Composer thread={parentId} />
</aside>

<style>
  .thread {
    position: fixed; right: 0; top: 0; bottom: 0; z-index: 52;
    width: min(440px, 100vw);
    display: flex; flex-direction: column; min-height: 0;
    background: var(--ground-0); border-left: 1px solid var(--line);
    box-shadow: var(--shadow-panel);
    animation: slide var(--t-base) var(--ease);
  }
  @keyframes slide { from { translate: 100% 0; } to { translate: 0 0; } }

  header {
    display: flex; align-items: center; gap: 8px; flex: none;
    padding: 12px 12px 11px; border-bottom: 1px solid var(--line);
  }
  .title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
  .title b { font-size: var(--text-lg); font-weight: 700; font-family: var(--font-display); }
  .title span { font-size: var(--text-sm); color: var(--text-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .back, .close {
    flex: none; border: 0; background: transparent; color: var(--text-dim); cursor: pointer;
    display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
    min-width: var(--tap); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .back:hover, .close:hover { background: var(--ground-2); color: var(--text); }

  /* Pinned above the scroll: the subject of a branch has to stay in view or
     the branch stops making sense two screens down. */
  .parent { flex: none; background: var(--ground-1); border-bottom: 1px solid var(--line); }

  .rule {
    flex: none; display: flex; align-items: center; gap: 10px;
    padding: 10px 16px 2px; color: var(--text-mute);
    font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  }
  .rule::after { content: ''; flex: 1; height: 1px; background: var(--line); }

  .orphan {
    flex: none; display: flex; align-items: flex-start; gap: 9px; margin: 12px 14px;
    padding: 11px 13px; border-radius: var(--r-md);
    font-size: var(--text-sm); line-height: 1.5; color: var(--text-dim);
    background: color-mix(in oklab, var(--face-gold) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--face-gold) 34%, var(--line));
  }
  .orphan :global(svg) { flex: none; margin-top: 1px; color: var(--face-gold); }

  .replies { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 6px; }

  .day { display: flex; align-items: center; gap: 12px; padding: 12px 16px 6px; }
  .day::before, .day::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .day span { font-size: 11px; font-weight: 700; color: var(--text-mute); flex: none; }

  .empty { padding: 26px 18px; }
  .empty p { margin: 0 0 10px; font-size: var(--text-sm); color: var(--text-dim); }
  .empty .fine { color: var(--text-mute); font-size: 12px; line-height: 1.6; max-width: 40ch; margin: 0; }

  .name-btn {
    border: 0; background: none; padding: 0; font: inherit; color: inherit;
    cursor: pointer; text-align: left; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .name-btn:hover b { text-decoration: underline; text-decoration-style: dotted; }
  .rename {
    font: inherit; font-weight: 700; color: var(--text);
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-xs); padding: 1px 6px; width: 100%;
  }
  .typing {
    padding: 4px 14px; font-size: var(--text-xs); color: var(--text-mute);
  }
</style>
