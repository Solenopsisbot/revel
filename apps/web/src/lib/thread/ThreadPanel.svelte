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
  import Icon from '../Icon.svelte';
  import Avatar from '../Avatar.svelte';
  import MessageRow from '../MessageRow.svelte';
  import Composer from '../Composer.svelte';
  import { core } from '../fake/core.svelte.js';
  import { conversation } from '../fake/conversation.svelte.js';
  import { layout } from '../layout.svelte.js';
  import { dayLabel, newDay } from '../format.js';

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
      <b>Thread</b>
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
</style>
