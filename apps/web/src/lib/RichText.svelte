<script lang="ts">
  /**
   * Renders the tokens from `richtext.ts` as elements.
   *
   * No `{@html}` anywhere: a message body becomes text nodes and known
   * elements, never markup. That is not a nicety — it is the difference
   * between "the server can't read your messages" and "the server can't read
   * your messages but anyone in the room can run script in your client".
   */
  import { parse, jumbo } from './richtext.js';

  let { body, onmention }: { body: string; onmention?: (name: string) => void } = $props();

  const blocks = $derived(parse(body));
  const big = $derived(jumbo(body));
</script>

<div class="rt" class:big>
  {#each blocks as b, i (i)}
    {#if b.kind === 'code'}
      <pre><code>{b.raw}</code>{#if b.lang}<span class="lang">{b.lang}</span>{/if}</pre>
    {:else}
      {#each b.tokens ?? [] as tk, j (j)}
        {#if tk.t === 'text'}{tk.v}
        {:else if tk.t === 'link'}<a href={tk.href} target="_blank" rel="noreferrer noopener">{tk.v}</a>
        {:else if tk.t === 'mention'}<button class="mention" onclick={() => onmention?.(tk.v)}>@{tk.v}</button>
        {:else if tk.t === 'room'}<button class="room" onclick={() => onmention?.(tk.v)}>#{tk.v}</button>
        {:else if tk.t === 'code'}<code>{tk.v}</code>
        {:else if tk.t === 'bold'}<b>{tk.v}</b>
        {:else if tk.t === 'italic'}<i>{tk.v}</i>
        {:else if tk.t === 'strike'}<s>{tk.v}</s>
        {/if}
      {/each}
    {/if}
  {/each}
</div>

<style>
  .rt { white-space: pre-wrap; word-break: break-word; }
  /* An emoji-only message is a gesture, not a sentence. */
  .rt.big { font-size: 2.4rem; line-height: 1.18; }

  a { color: var(--face-sky); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .mention, .room {
    border: 0; background: color-mix(in oklab, var(--brand) 22%, transparent);
    color: var(--face-violet); font: inherit; font-weight: 600; cursor: pointer;
    padding: 0 4px; border-radius: var(--r-xs);
    transition: background var(--t-fast) var(--ease);
  }
  .mention:hover, .room:hover { background: color-mix(in oklab, var(--brand) 40%, transparent); }

  code {
    font-family: var(--font-mono); font-size: .88em;
    background: var(--ground-3); border: 1px solid var(--line);
    padding: 1px 5px; border-radius: var(--r-xs);
  }
  pre {
    position: relative; margin: 6px 0; padding: 11px 13px; overflow-x: auto;
    background: var(--ground-2); border: 1px solid var(--line); border-radius: var(--r-sm);
  }
  pre code { background: none; border: 0; padding: 0; font-size: var(--text-sm); }
  .lang {
    position: absolute; top: 6px; right: 9px; font-size: 10px; font-weight: 800;
    letter-spacing: .05em; text-transform: uppercase; color: var(--text-mute);
  }
</style>
