<script lang="ts">
  import { core } from '$lib/fake/core.svelte.js';

  /**
   * "What the server can see" is generated from the room's real configuration,
   * never canned (`docs/12`). A hardcoded reassurance that silently stops
   * matching reality is worse than none.
   */
  const agents = $derived(core.roster.filter((f) => f.agent));
  const humans = $derived(core.roster.filter((f) => !f.agent));
  const count = $derived(core.thread.length);
</script>

<h2>About</h2>
<p class="lede">Revel 0.0.0 · dev build</p>

<section class="sees">
  <h3>What the server can see about #{core.room.name}</h3>
  <p>
    That it exists, who is in it, and that {count}
    {count === 1 ? 'message has' : 'messages have'} been sent — with their sizes
    and the times they arrived. Not a word of what any of them say, including
    the room's name and topic, which are encrypted too.
  </p>
  {#if agents.length}
    <p>
      {agents.map((a) => a.name).join(' and ')}
      {agents.length === 1 ? 'can' : 'can'} read everything here, and
      {agents.length === 1 ? 'is' : 'are'} in the member list.
    </p>
  {/if}
  <p class="muted">
    Generated from this room's settings, not written in advance — it changes
    when they do.
  </p>
</section>

<section>
  <h3>Who else holds keys here</h3>
  <ul class="who">
    {#each humans as f (f.id)}
      <li><span class="dot" style="background: var(--face-{f.colour})"></span>{f.name}</li>
    {/each}
    {#each agents as f (f.id)}
      <li>
        <span class="dot" style="background: var(--face-{f.colour})"></span>{f.name}
        <span class="tag">{f.agent?.label}</span>
      </li>
    {/each}
  </ul>
</section>

<section>
  <h3>Honest limits</h3>
  <dl>
    <dt>The cryptography is not independently audited.</dt>
    <dd>Parts of it are our own design, which is where bugs live.</dd>
    <dt>Anyone who can read a message can keep it.</dt>
    <dd>Screenshots exist. Disappearing messages are a courtesy.</dd>
    <dt>A web client can be changed on any load.</dt>
    <dd>
      Encryption protects your messages from the operators and from a database
      breach. Signed native builds are what would extend that to the code.
    </dd>
  </dl>
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); }
  section { margin-bottom: 30px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 10px; }
  p { margin: 0 0 10px; color: var(--text-dim); font-size: var(--text-sm); line-height: 1.65; }

  .sees {
    border-left: 3px solid var(--face-mint);
    background: color-mix(in oklab, var(--face-mint) 8%, transparent);
    border-radius: 0 var(--r-md) var(--r-md) 0; padding: 16px 18px;
  }
  .sees h3 { color: var(--face-mint); }
  .muted { color: var(--text-mute); font-size: var(--text-xs); margin-bottom: 0; }

  .who { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
  .who li { display: flex; align-items: center; gap: 9px; font-size: var(--text-sm); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .tag {
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    border: 1px solid var(--text-mute); color: var(--text-dim);
    padding: 1px 6px; border-radius: var(--r-xs);
  }

  dl { margin: 0; }
  dt { font-weight: 600; font-size: var(--text-sm); margin-top: 12px; }
  dd { margin: 2px 0 0; color: var(--text-mute); font-size: var(--text-sm); }
</style>
