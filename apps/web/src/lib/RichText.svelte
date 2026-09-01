<script lang="ts">
/**
 * Renders the tokens from `richtext.ts` as elements.
 *
 * No `{@html}` anywhere: a message body becomes text nodes and known
 * elements, never markup. That is not a nicety — it is the difference
 * between "the server can't read your messages" and "the server can't read
 * your messages but anyone in the room can run script in your client".
 */
import { jumbo, parse, type Token } from './richtext.js';

let { body, onmention }: { body: string; onmention?: (name: string) => void } = $props();

const blocks = $derived(parse(body));
const big = $derived(jumbo(body));
</script>

{#snippet run(tokens: Token[])}{#each tokens as tk, j (j)}{#if tk.t === 'text'}{tk.v}{:else if tk.t === 'link'}<a
        href={tk.href}
        target="_blank"
        rel="noreferrer noopener"
        title={tk.href}
      >{tk.v}</a>{:else if tk.t === 'mention'}<button class="mention" onclick={() => onmention?.(tk.v)}>@{tk.v}</button>{:else if tk.t === 'room'}<button class="room" onclick={() => onmention?.(tk.v)}>#{tk.v}</button>{:else if tk.t === 'code'}<code>{tk.v}</code>{:else if tk.t === 'bold'}<b>{tk.v}</b>{:else if tk.t === 'italic'}<i>{tk.v}</i>{:else if tk.t === 'strike'}<s>{tk.v}</s>{/if}{/each}{/snippet}

<div class="rt" class:big>
  {#each blocks as b, i (i)}
    {#if b.kind === 'code'}
      <pre><code>{b.raw}</code>{#if b.lang}<span class="lang">{b.lang}</span>{/if}</pre>
    {:else if b.kind === 'heading'}
      <!-- `h4`–`h6` rather than `h1`: a message is inside a page that already
           has a heading structure, and a message that could outrank the room
           title would wreck the document outline for a screen reader. The
           *level* still drives the size, so `#` still looks like the biggest. -->
      {#if b.level === 1}
        <h4 class="hd l1">{@render run(b.tokens ?? [])}</h4>
      {:else if b.level === 2}
        <h5 class="hd l2">{@render run(b.tokens ?? [])}</h5>
      {:else}
        <h6 class="hd l3">{@render run(b.tokens ?? [])}</h6>
      {/if}
    {:else if b.kind === 'quote'}
      <blockquote>{@render run(b.tokens ?? [])}</blockquote>
    {:else if b.kind === 'list'}
      {#if b.ordered}
        <ol>{#each b.items ?? [] as item, k (k)}<li>{@render run(item)}</li>{/each}</ol>
      {:else}
        <ul>{#each b.items ?? [] as item, k (k)}<li>{@render run(item)}</li>{/each}</ul>
      {/if}
    {:else}
      {@render run(b.tokens ?? [])}
    {/if}
  {/each}
</div>

<style>
  .rt { white-space: pre-wrap; word-break: break-word; }

  /*
   * Block elements inside a message.
   *
   * `:first-child` / `:last-child` zero the outer margins on purpose. A
   * message is a row in a list, not a document — a heading or a list at the
   * top of one must not push itself away from the name above it, and the
   * bottom margin of the last block is the row's padding's job.
   */
  .hd { margin: 10px 0 4px; font-family: var(--font-display); font-weight: 600; line-height: 1.25; }
  .hd.l1 { font-size: 1.35em; }
  .hd.l2 { font-size: 1.18em; }
  .hd.l3 { font-size: 1.05em; }

  blockquote {
    margin: 6px 0; padding: 2px 0 2px 12px;
    border-left: 3px solid color-mix(in oklab, var(--fc, var(--text-mute)) 60%, transparent);
    color: var(--text-dim);
  }

  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 2px 0; }
  /* The marker in the muted ink, so a list reads as content with structure
     rather than as a bulleted wall. */
  li::marker { color: var(--text-mute); }

  .rt > :first-child { margin-top: 0; }
  .rt > :last-child { margin-bottom: 0; }
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
    /* The chat column sets `touch-action: pan-y` on a phone so the drawer
       gesture gets horizontal drags. A code block scrolls sideways itself, so
       it takes them back. */
    touch-action: auto;
  }
  pre code { background: none; border: 0; padding: 0; font-size: var(--text-sm); }
  .lang {
    position: absolute; top: 6px; right: 9px; font-size: 10px; font-weight: 800;
    letter-spacing: .05em; text-transform: uppercase; color: var(--text-mute);
  }
</style>
