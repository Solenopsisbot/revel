<script lang="ts">
  /**
   * The conversation.
   *
   * Two scroll rules, and they matter more than anything else in the file:
   *
   *  1. Pin to the bottom ONLY when already at the bottom. Yanking someone
   *     away from what they are reading because a message arrived is the
   *     single most hostile thing a chat client does.
   *  2. Nothing that arrives may reflow what is above it. The list is
   *     bottom-anchored and every media frame reserves its size in advance,
   *     so growth happens downward into the space the composer sits above.
   */
  import MessageRow from './MessageRow.svelte';
  import Icon from './Icon.svelte';
  import { core } from './fake/core.svelte.js';
  import { dayLabel, newDay } from './format.js';

  let viewport = $state<HTMLElement>();
  let atBottom = $state(true);
  /** Only counts messages that arrived while you were scrolled away. */
  let missed = $state(0);

  const rows = $derived(
    core.thread.map((m, i) => {
      const prev = core.thread[i - 1];
      const dayBreak = !prev || newDay(prev.at, m.at);
      const grouped =
        !!prev &&
        !dayBreak &&
        prev.faceId === m.faceId &&
        m.at - prev.at < 5 * 60_000 &&
        !m.replyTo &&
        !prev.deleted &&
        !m.deleted;
      const unreadAbove = core.lastRead[core.currentRoomId] === prev?.id && !!prev;
      return { m, grouped, dayBreak, unreadAbove };
    }),
  );

  function checkBottom() {
    const el = viewport;
    if (!el) return;
    atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom) missed = 0;
  }

  function toBottom(smooth = true) {
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    missed = 0;
  }

  // Arrival: follow only if the reader is already at the bottom. Otherwise
  // count it and let the pill say so.
  let seen = $state(0);
  $effect(() => {
    const n = core.thread.length;
    const el = viewport;
    if (!el) return;
    if (n > seen && seen > 0) {
      if (atBottom) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight }));
      else missed += n - seen;
    }
    seen = n;
  });

  // Switching rooms starts you at the bottom, without animating the whole way.
  $effect(() => {
    void core.currentRoomId;
    seen = 0;
    missed = 0;
    queueMicrotask(() => {
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      atBottom = true;
    });
  });

  // A jump target scrolls into view and flashes once, then releases — leaving
  // it highlighted would make the room look permanently modified.
  $effect(() => {
    const id = core.jumpTo;
    if (!id) return;
    const el = viewport?.querySelector<HTMLElement>(`#m-${CSS.escape(id)}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = setTimeout(() => (core.jumpTo = null), 1500);
    return () => clearTimeout(timer);
  });

  const typingNames = $derived(core.typing.map((f) => core.faces[f]?.name ?? f));

  /** Bubbles or rows (`docs/07`): the room's explicit choice if it has one,
      otherwise its kind decides. */
  const bubble = $derived(core.room.style === 'bubbles');
</script>

<div class="pane">
  <div class="msgs" bind:this={viewport} onscroll={checkBottom} role="log" aria-live="polite" aria-label="Messages">
    <!-- Pushes content to the bottom so a short room sits above the composer
         and a new message doesn't reflow everything above it (docs/32). -->
    <div class="grow"></div>

    {#if core.awaitingKeys}
      <!-- `docs/19`: a message link you can't read yet is not an error. The
           message exists and the keys are on their way; saying "not found"
           would teach people that shared links are unreliable when they are
           not. It sits in the room rather than over it, because you can carry
           on reading while it resolves. -->
      <div class="catching" role="status">
        <Icon name="key" size={16} />
        <div>
          <b>Catching up on keys.</b>
          <span>
            Someone linked you to a message this device hasn't been able to
            decrypt yet. It'll appear here on its own once the keys arrive.
          </span>
        </div>
        <button onclick={() => (core.awaitingKeys = null)} aria-label="Dismiss">
          <Icon name="x" size={14} />
        </button>
      </div>
    {/if}

    {#if core.thread.length === 0}
      <div class="empty">
        <h2>Nothing here yet</h2>
        <p>This is yours. Say something — nobody can read it but the people you put in this room.</p>
      </div>
    {/if}

    {#each rows as { m, grouped, dayBreak, unreadAbove } (m.id)}
      {#if dayBreak}
        <div class="day" role="separator"><span>{dayLabel(m.at)}</span></div>
      {/if}
      <MessageRow {m} grouped={grouped && !unreadAbove} {unreadAbove} {bubble} />
    {/each}
  </div>

  <!-- Fixed height whether or not anyone is typing, so the indicator appearing
       never nudges the conversation (docs/32). -->
  <div class="typing" aria-live="polite">
    {#if typingNames.length}
      <span class="dots"><i></i><i></i><i></i></span>
      <span class="who">
        {typingNames.join(' and ')}
        {typingNames.length === 1 ? 'is' : 'are'} typing
      </span>
    {/if}
  </div>

  {#if !atBottom}
    <button class="jump" class:has={missed > 0} onclick={() => toBottom()}>
      <Icon name="arrow-down" size={15} />
      <span>{missed > 0 ? `${missed} new message${missed === 1 ? '' : 's'}` : 'Jump to present'}</span>
    </button>
  {/if}
</div>

<style>
  .catching {
    display: flex; align-items: flex-start; gap: 11px;
    margin: 10px 16px 4px; padding: 12px 14px;
    border-radius: var(--r-md);
    background: color-mix(in oklab, var(--face-sky) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--face-sky) 38%, var(--line));
    animation: settle var(--t-base) var(--ease);
  }
  @keyframes settle { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  .catching > :global(svg) { flex: none; margin-top: 2px; color: var(--face-sky); }
  .catching div { flex: 1; min-width: 0; font-size: var(--text-sm); line-height: 1.55; }
  .catching b { display: block; font-weight: 700; margin-bottom: 2px; }
  .catching span { color: var(--text-dim); }
  .catching button {
    flex: none; border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
    display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--r-sm);
    min-width: var(--tap); min-height: var(--tap);
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .catching button:hover { color: var(--text); background: var(--ground-3); }

  .pane { position: relative; height: 100%; display: flex; flex-direction: column; min-height: 0; }

  .msgs {
    flex: 1; min-height: 0; overflow-y: auto; padding: 12px 0 4px;
    display: flex; flex-direction: column; overflow-anchor: none;
  }
  .grow { flex: 1 0 auto; }

  .day {
    display: flex; align-items: center; gap: 12px; padding: 14px 16px 6px; flex: none;
    font-size: 10px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase;
    color: var(--text-mute);
  }
  .day::before, .day::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .day span { flex: none; }

  .typing {
    flex: none; height: 22px; display: flex; align-items: center; gap: 8px;
    padding: 0 16px; font-size: var(--text-xs); color: var(--text-mute);
  }
  .who { animation: fade var(--t-fast) var(--ease); }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  .dots { display: inline-flex; gap: 3px; align-items: flex-end; height: 10px; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--text-mute); animation: tp 1.3s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: .18s; }
  .dots i:nth-child(3) { animation-delay: .36s; }
  @keyframes tp { 0%, 65%, 100% { opacity: .35; transform: translateY(0); } 32% { opacity: 1; transform: translateY(-3px); } }

  /* The pill only exists while you are away from the bottom, and says which
     of the two things it is: a shortcut, or news. */
  .jump {
    position: absolute; left: 50%; translate: -50% 0; bottom: 30px; z-index: 4;
    display: flex; align-items: center; gap: 7px; cursor: pointer;
    background: var(--ground-3); border: 1px solid var(--line); color: var(--text-dim);
    border-radius: var(--r-pill); padding: 6px 14px; font-size: var(--text-sm); font-weight: 600;
    box-shadow: var(--shadow-ambient);
    animation: pill var(--t-base) var(--ease);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease);
  }
  /* `translate` and `transform` are separate properties that COMPOSE — the
     browser applies translate first, then transform. Re-stating the -50%
     centring inside a transform here made the pill sit at -100% for the length
     of the animation and snap to -50% the moment it ended. Centring lives in
     `translate` above; anything animated moves on `transform` only and never
     mentions the -50% again. */
  @keyframes pill { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .jump:hover { background: var(--ground-4); color: var(--text); }
  .jump:active { transform: translateY(1px); }
  .jump.has { background: var(--brand); border-color: var(--brand); color: #fff; }

  .empty { flex: none; text-align: center; padding: 60px 24px; }
  .empty h2 {
    font-family: var(--font-display); font-weight: 600; font-size: var(--display-1);
    margin: 0 0 6px; letter-spacing: -.02em;
  }
  .empty p { color: var(--text-mute); font-size: var(--text-sm); max-width: 42ch; margin: 0 auto; }
</style>
