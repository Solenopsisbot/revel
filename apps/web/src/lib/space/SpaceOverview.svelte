<script lang="ts">
/**
 * Space → Overview (`docs/18`): name, icon, description, who-it's-for.
 *
 * The host line is the interesting part. `docs/18` says hosting gets
 * mentioned exactly once, here, and that the one-way-door consequence is
 * written into the flow rather than buried in a FAQ — because a space lives
 * on one Host and cannot be moved, and someone choosing a self-hosted box
 * for their community deserves to know that before they pick.
 */

import { core } from '$lib/fake/core.svelte.js';
import Icon from '$lib/Icon.svelte';

const space = $derived(core.space);

const VISIBILITY = [
  { id: 'invite', label: 'Just the people I invite', hint: 'Nobody can find it. Invites only.' },
  {
    id: 'link',
    label: 'Anyone with the link',
    hint: 'Still unlisted, but the link works for anyone.',
  },
  {
    id: 'public',
    label: 'Listed publicly on revel.chat',
    hint: 'Appears in the directory — a plain searchable list, no ranking.',
  },
] as const;

let showHost = $state(false);
</script>

<h2>Overview</h2>
<p class="lede">Everything here is visible to people you invite, and to nobody else.</p>

<section>
  <label class="field">
    <span class="lbl">Name</span>
    <input
      type="text"
      value={space.name}
      oninput={(e) => core.updateSpace(space.id, { name: e.currentTarget.value })}
    />
  </label>

  <label class="field">
    <span class="lbl">Description</span>
    <textarea
      rows="2"
      placeholder="What is this space for?"
      value={space.description ?? ''}
      oninput={(e) => core.updateSpace(space.id, { description: e.currentTarget.value })}
    ></textarea>
  </label>

  <div class="field">
    <span class="lbl">Icon</span>
    <div class="icon-row">
      <span class="preview" style="--from: var(--face-{space.from}); --to: var(--face-{space.to})">
        {space.initial}
      </span>
      <span class="hint">
        A letter and a gradient until you drop an image in. Images are
        encrypted to the space like everything else.
      </span>
    </div>
  </div>
</section>

<section>
  <h3>Who's it for</h3>
  {#each VISIBILITY as v (v.id)}
    <label class="radio" class:sel={space.visibility === v.id}>
      <input
        type="radio"
        name="visibility"
        checked={space.visibility === v.id}
        onchange={() => core.updateSpace(space.id, { visibility: v.id })}
      />
      <span>
        <b>{v.label}</b>
        <span class="hint">{v.hint}</span>
      </span>
    </label>
  {/each}
</section>

<section>
  <p class="host">
    This space lives on <b>revel.chat</b>.
    <button class="link" onclick={() => (showHost = !showHost)}>Change</button>
  </p>
  {#if showHost}
    <div class="warn">
      <Icon name="warn" size={16} />
      <div>
        <b>A space can't be moved.</b>
        <p>
          There's no federation, so there's no migration path. Moving this
          community to another Host means making a new space there and inviting
          everyone across — the history stays behind, because it's encrypted to
          a key group whose log lives here.
        </p>
        <p class="q">It's a one-way door. Worth knowing before you walk through it.</p>
      </div>
    </div>
  {/if}
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); }
  section { margin-bottom: 32px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 10px; }

  .field { display: block; margin-bottom: 16px; }
  .lbl { display: block; font-size: var(--text-sm); font-weight: 600; margin-bottom: 6px; }
  input[type='text'], textarea {
    width: 100%; font: inherit; font-size: var(--text-sm); color: var(--text);
    background: var(--ground-2); border: 1px solid var(--line); border-radius: var(--r-sm);
    padding: 10px 12px; resize: vertical;
  }
  input[type='text']:focus, textarea:focus { outline: 2px solid var(--brand); outline-offset: -1px; }

  .icon-row { display: flex; align-items: center; gap: 12px; }
  .preview {
    width: 48px; height: 48px; flex: none; border-radius: var(--r-md);
    display: grid; place-items: center; font-weight: 800; color: #fff;
    background: linear-gradient(140deg, var(--from), var(--to));
  }
  .hint { font-size: 12px; color: var(--text-mute); line-height: 1.5; display: block; }

  .radio {
    display: flex; gap: 11px; align-items: flex-start; cursor: pointer;
    padding: 11px 13px; border-radius: var(--r-md); margin-bottom: 7px;
    border: 2px solid var(--line); background: var(--ground-2);
    transition: border-color var(--t-fast) var(--ease);
  }
  .radio:hover { border-color: var(--ground-4); }
  .radio.sel { border-color: var(--brand); background: var(--ground-3); }
  .radio input { margin-top: 2px; accent-color: var(--brand); cursor: pointer; flex: none; }
  .radio b { display: block; font-size: var(--text-sm); font-weight: 600; margin-bottom: 1px; }

  .host { font-size: var(--text-sm); color: var(--text-mute); margin: 0; }
  .link {
    border: 0; background: none; cursor: pointer; font: inherit; font-size: var(--text-sm);
    color: var(--brand); text-decoration: underline; text-underline-offset: 3px; padding: 0;
  }

  .warn {
    display: flex; gap: 11px; margin-top: 12px; padding: 13px 15px;
    background: color-mix(in oklab, var(--face-gold) 12%, transparent);
    border-radius: var(--r-md); color: var(--face-gold);
  }
  .warn div { color: var(--text-dim); }
  .warn b { color: var(--text); font-size: var(--text-sm); display: block; margin-bottom: 5px; }
  .warn p { margin: 0 0 7px; font-size: var(--text-sm); line-height: 1.55; }
  .warn .q { margin: 0; color: var(--text-mute); }
</style>
