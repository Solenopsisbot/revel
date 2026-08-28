<script lang="ts">
  import Avatar from '$lib/Avatar.svelte';
  import { core } from '$lib/fake/core.svelte.js';

  let linked = $state(false);
</script>

<h2>Faces</h2>
<p class="lede">
  The ways you appear. Everything else in the app only shows a face switcher
  because you have more than one.
</p>

<section>
  {#each core.myFaces as f (f.id)}
    <div class="face">
      <Avatar face={f} size={40} />
      <div class="meta">
        <div class="nm" style="color: var(--face-{f.colour})">{f.name}</div>
        <div class="sub">{f.pronouns ?? 'no pronouns set'}</div>
      </div>
      {#if f.id === core.speakingAs}<span class="badge">speaking as</span>{/if}
      <button class="edit">Edit</button>
    </div>
  {/each}
  <button class="add">Add another face</button>
</section>

<section>
  <label class="row">
    <input type="checkbox" bind:checked={linked} />
    <span>
      <b>Link my faces publicly</b>
      <span class="sub">
        With this off, your faces appear as unrelated people and nothing in the
        app connects them. Because faces live inside the encryption, the server
        never learns the connection either. Some systems are out; some very
        much aren't.
      </span>
    </span>
  </label>
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); max-width: 56ch; }
  section { margin-bottom: 30px; }

  .face {
    display: flex; align-items: center; gap: 12px; padding: 10px 12px;
    border: 1px solid var(--line); border-radius: var(--r-md); margin-bottom: 8px;
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .face:hover { border-color: var(--ground-4); background: var(--ground-2); }
  .meta { flex: 1; min-width: 0; }
  .nm { font-weight: 700; }
  .sub { display: block; color: var(--text-mute); font-size: var(--text-sm); }
  .badge {
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    color: var(--face-mint); border: 1px solid color-mix(in oklab, var(--face-mint) 45%, transparent);
    background: color-mix(in oklab, var(--face-mint) 15%, transparent);
    padding: 2px 7px; border-radius: var(--r-pill);
  }
  .edit, .add {
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 7px 14px; border-radius: var(--r-pill);
    background: var(--ground-3); color: var(--text);
    transition: background var(--t-fast) var(--ease);
  }
  .edit:hover, .add:hover { background: var(--ground-4); }
  .add { margin-top: 4px; }

  .row { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; max-width: 60ch; }
  .row input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--face-mint); cursor: pointer; flex: none; }
  .row b { display: block; font-weight: 600; margin-bottom: 3px; }
</style>
