<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { core, faces } from './fake/core.svelte.js';

  let draft = $state('');
  let switcherOpen = $state(false);
  let input = $state<HTMLTextAreaElement>();

  const face = $derived(faces[core.speakingAs]!);

  function submit() {
    core.send(draft);
    draft = '';
    // Someone replies, so the typing indicator and arrival animation have
    // something to do.
    core.simulateTyping('rae', 2600);
    if (input) input.style.height = 'auto';
  }

  function onKey(e: KeyboardEvent) {
    // Enter sends on a fine pointer only; on touch it is a newline and the
    // button sends (`docs/24`). matchMedia, not screen width.
    const fine = window.matchMedia('(pointer: fine)').matches;
    if (e.key === 'Enter' && !e.shiftKey && fine) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') switcherOpen = false;
  }

  function grow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }
</script>

<div class="composer">
  {#if switcherOpen}
    <div class="switcher" role="listbox" aria-label="Speaking as">
      {#each core.myFaces as f (f.id)}
        <button
          role="option"
          aria-selected={f.id === core.speakingAs}
          class="opt"
          class:sel={f.id === core.speakingAs}
          onclick={() => { core.speakingAs = f.id; switcherOpen = false; }}
        >
          <Avatar face={f} size={28} />
          <span style="color: var(--face-{f.colour})">{f.name}</span>
          {#if f.id === core.speakingAs}<Icon name="check" size={16} />{/if}
        </button>
      {/each}
    </div>
  {/if}

  <div class="box" style="--fc: var(--face-{face.colour})">
    {#if core.plural}
      <!-- The chip exists only because this account has several faces.
           A singlet never sees it (`docs/11`). -->
      <button class="chip" onclick={() => (switcherOpen = !switcherOpen)} title="Speaking as">
        <Avatar {face} size={24} />
        <span class="nm">{face.name}</span>
        <Icon name="chevron" size={14} />
      </button>
    {/if}

    <textarea
      bind:this={input}
      bind:value={draft}
      onkeydown={onKey}
      oninput={(e) => grow(e.currentTarget)}
      rows="1"
      placeholder="Message #{core.room.name}"
      aria-label="Message"
    ></textarea>

    <button class="icon" title="Attach"><Icon name="attach" size={19} /></button>
    <button class="send" onclick={submit} disabled={!draft.trim()} title="Send">
      <Icon name="send" size={18} />
    </button>
  </div>
</div>

<style>
  .composer { padding: 10px 16px 16px; flex: none; position: relative; }

  .switcher {
    position: absolute; bottom: calc(100% - 4px); left: 16px; z-index: 5;
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-md); padding: 6px; min-width: 200px;
    box-shadow: var(--shadow-panel);
    animation: rise var(--t-base) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .opt {
    display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    padding: 7px 8px; border: 0; background: transparent; cursor: pointer;
    border-radius: var(--r-sm); font-weight: 600;
    transition: background var(--t-fast) var(--ease);
  }
  .opt:hover, .opt.sel { background: var(--ground-3); }

  .box {
    display: flex; align-items: flex-end; gap: 8px;
    background: var(--ground-3); border: 2px solid var(--line);
    border-radius: var(--r-lg); padding: 6px 6px 6px 12px;
    transition: border-color var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease);
  }
  .box:focus-within { border-color: var(--brand); box-shadow: var(--focus-ring); }

  .chip {
    display: inline-flex; align-items: center; gap: 6px; flex: none; cursor: pointer;
    background: color-mix(in oklab, var(--fc) 20%, transparent);
    border: 1px solid color-mix(in oklab, var(--fc) 42%, transparent);
    color: var(--fc); border-radius: var(--r-pill); padding: 3px 8px 3px 3px;
    font-size: var(--text-sm); font-weight: 700; margin-bottom: 3px;
    /* The colour change IS the feedback that you're about to speak as
       someone else (docs/32). */
    transition: background var(--t-base) var(--ease), border-color var(--t-base) var(--ease),
      color var(--t-base) var(--ease);
  }

  textarea {
    flex: 1; background: transparent; border: 0; color: var(--text);
    font: inherit; padding: 8px 0; resize: none; overflow-y: auto; max-height: 180px;
  }
  textarea:focus { outline: none; }
  textarea::placeholder { color: var(--text-mute); }

  .icon {
    border: 0; background: transparent; color: var(--text-dim); cursor: pointer;
    width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .icon:hover { background: var(--ground-4); color: var(--text); }

  .send {
    flex: none; width: 36px; height: 36px; border-radius: 50%; border: 0; cursor: pointer;
    background: linear-gradient(180deg, #8a51ed, #7b48d8); color: #fff;
    display: grid; place-items: center;
    box-shadow: 0 var(--lift) 0 #55229e, var(--highlight-inset);
    transition: transform var(--t-fast) var(--ease-toy), box-shadow var(--t-fast) var(--ease),
      opacity var(--t-fast) var(--ease);
  }
  .send:disabled { opacity: .4; cursor: default; box-shadow: none; }
  /* The one overshoot in the product: it presses down like an object. */
  .send:not(:disabled):active { transform: translateY(var(--lift)); box-shadow: 0 0 0 #55229e; }
</style>
