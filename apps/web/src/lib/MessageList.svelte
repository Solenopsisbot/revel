<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { core, faces } from './fake/core.svelte.js';

  let viewport = $state<HTMLElement>();

  /** Group consecutive messages from the same face, like every good client. */
  const rows = $derived(
    core.thread.map((m, i) => {
      const prev = core.thread[i - 1];
      const grouped =
        !!prev && prev.faceId === m.faceId && m.at - prev.at < 5 * 60_000 && !m.replyTo;
      return { m, grouped };
    }),
  );

  // Pin to the bottom only when already there — never yank someone away from
  // what they were reading (`docs/05` §1).
  $effect(() => {
    void core.thread.length;
    const el = viewport;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight }));
  });

  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<div class="msgs" bind:this={viewport} role="log" aria-live="polite" aria-label="Messages">
  <!-- Pushes content to the bottom so a short room sits above the composer
       and a new message doesn't reflow everything above it (docs/32). -->
  <div class="grow"></div>

  {#if core.thread.length === 0}
    <div class="empty">
      <h2>Nothing here yet</h2>
      <p>This is yours. Say something — nobody can read it but the people you put in this room.</p>
    </div>
  {/if}

  {#each rows as { m, grouped } (m.id)}
    {@const face = faces[m.faceId]!}
    <article class="row" class:grouped class:pending={m.pending} style="--fc: var(--face-{face.colour})">
      <div class="gutter">
        {#if !grouped}<Avatar {face} size={40} />{/if}
      </div>
      <div class="body">
        {#if m.replyTo}
          {@const target = core.thread.find((x) => x.id === m.replyTo)}
          {#if target}
            <button class="replyto" style="--rc: var(--face-{faces[target.faceId]!.colour})">
              <Icon name="reply" size={13} />
              <span class="who">{faces[target.faceId]!.name}</span>
              <span class="snip">{target.body}</span>
            </button>
          {/if}
        {/if}

        {#if !grouped}
          <div class="author-line">
            <span class="author">{face.name}</span>
            {#if face.agent}<span class="badge">{face.agent.label}</span>{/if}
            {#if face.accountId === faces.viola.accountId && face.id !== 'viola'}
              <span class="badge same">same system</span>
            {/if}
            <time>{time(m.at)}</time>
          </div>
        {/if}

        <p class="text">{m.body}</p>

        {#if m.annotation}
          <div class="annot">
            <div class="who"><Icon name="globe" size={13} /> Translated by {m.annotation.by} · {m.annotation.kind}</div>
            <div class="body-t">{m.annotation.body}</div>
          </div>
        {/if}

        {#if m.reactions?.length}
          <div class="reactions">
            {#each m.reactions as r (r.key)}
              <button class="rx" class:mine={r.mine} onclick={() => core.react(m.id, r.key)}>
                <span class="emote"></span><span class="n">{r.count}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="actions">
        <button title="React" onclick={() => core.react(m.id, 'yes')}><Icon name="plus" size={15} /></button>
        <button title="Reply"><Icon name="reply" size={15} /></button>
      </div>
    </article>
  {/each}

  {#if core.typing.length}
    <div class="typing">
      <span class="dots"><i></i><i></i><i></i></span>
      {core.typing.map((f) => faces[f]!.name).join(' and ')}
      {core.typing.length === 1 ? 'is' : 'are'} typing
    </div>
  {/if}
</div>

<style>
  .msgs {
    height: 100%; overflow-y: auto; padding: 12px 0 4px;
    display: flex; flex-direction: column;
  }
  .grow { flex: 1 0 auto; }
  .row, .typing, .empty { flex: none; }

  .row { display: flex; gap: 12px; padding: 6px 16px; position: relative; }
  .row:hover { background: var(--ground-2); }
  .row.grouped { padding-top: 2px; }
  .gutter { width: 40px; flex: none; }
  .body { min-width: 0; flex: 1; }

  /* New messages fade and rise 4px — enough to notice, not enough to watch.
     Bottom-anchored, so nothing above reflows (docs/32). */
  .row { animation: arrive var(--t-base) var(--ease); }
  @keyframes arrive { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

  /* An optimistic message is provisional and says so. It does NOT animate
     into place, because that would claim it succeeded (docs/32). */
  .row.pending .body { opacity: .6; }
  .row.pending .text { transition: none; }
  .row:not(.pending) .body { opacity: 1; transition: opacity var(--t-fast) var(--ease); }

  .author-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .author { font-weight: 700; color: var(--fc); }
  time { font-size: var(--text-xs); color: var(--text-mute); }
  .text { margin: 0; white-space: pre-wrap; word-break: break-word; }

  .badge {
    align-self: center; font-size: 10px; font-weight: 800; letter-spacing: .04em;
    text-transform: uppercase; padding: 1px 6px; border-radius: var(--r-xs);
    border: 1px solid var(--text-mute); color: var(--text-dim); line-height: 1.5;
  }
  .badge.same {
    border-color: color-mix(in oklab, var(--fc) 45%, transparent);
    color: var(--fc); background: color-mix(in oklab, var(--fc) 16%, transparent);
  }

  .replyto {
    display: flex; align-items: center; gap: 6px; margin-bottom: 3px;
    background: none; border: 0; padding: 0; cursor: pointer;
    font-size: var(--text-xs); color: var(--text-mute); max-width: 100%;
  }
  .replyto .who { font-weight: 700; color: var(--rc); }
  .replyto .snip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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

  .reactions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .rx {
    display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
    background: var(--ground-3); border: 1px solid var(--line);
    border-radius: var(--r-pill); padding: 2px 9px; font-size: var(--text-sm);
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .rx.mine { background: color-mix(in oklab, var(--brand) 24%, transparent); border-color: var(--brand); }
  /* A count change pops just enough to catch peripheral vision. */
  .rx .n { font-weight: 700; font-size: var(--text-xs); animation: pop var(--t-fast) var(--ease); }
  @keyframes pop { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }
  .emote { width: 15px; height: 15px; border-radius: 4px; background: linear-gradient(140deg, var(--face-mint), var(--face-aqua)); }

  .actions {
    position: absolute; right: 14px; top: -10px; display: flex; gap: 2px; padding: 3px;
    background: var(--ground-3); border: 1px solid var(--line); border-radius: var(--r-sm);
    opacity: 0; pointer-events: none;
    transition: opacity var(--t-fast) var(--ease);
  }
  .row:hover .actions { opacity: 1; pointer-events: auto; }
  .actions button {
    border: 0; background: transparent; color: var(--text-dim); cursor: pointer;
    padding: 4px; border-radius: var(--r-xs); display: grid; place-items: center;
  }
  .actions button:hover { background: var(--ground-4); color: var(--text); }

  .typing { display: flex; align-items: center; gap: 8px; padding: 4px 16px 8px; font-size: var(--text-xs); color: var(--text-mute); }
  .dots { display: inline-flex; gap: 3px; align-items: flex-end; height: 10px; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--text-mute); animation: tp 1.3s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: .18s; }
  .dots i:nth-child(3) { animation-delay: .36s; }
  @keyframes tp { 0%, 65%, 100% { opacity: .35; transform: translateY(0); } 32% { opacity: 1; transform: translateY(-3px); } }

  .empty { text-align: center; padding: 60px 24px; }
  .empty h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--display-1); margin: 0 0 6px; letter-spacing: -.02em; }
  .empty p { color: var(--text-mute); font-size: var(--text-sm); max-width: 42ch; margin: 0 auto; }
</style>
