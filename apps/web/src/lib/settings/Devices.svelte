<script lang="ts">
  const devices = [
    { name: 'This device', platform: 'macOS', seen: 'now', current: true },
    { name: 'Phone', platform: 'iOS', seen: '2 hours ago', current: false },
    { name: 'iPad', platform: 'iPadOS', seen: '94 days ago', current: false, stale: true },
    { name: 'Agent host', platform: 'Linux', seen: '5 minutes ago', current: false, agent: 'Kiko' },
  ];
  let fingerprints = $state(false);
</script>

<h2>Devices</h2>
<p class="lede">
  Each of these holds its own key. Signing one out stops it reading anything
  sent from then on.
</p>

{#each devices as d (d.name)}
  <div class="device" class:stale={d.stale}>
    <div class="meta">
      <div class="nm">
        {d.name}
        {#if d.agent}<span class="tag">runs {d.agent}</span>{/if}
      </div>
      <div class="sub">{d.platform} · last seen {d.seen}</div>
      {#if fingerprints}
        <div class="fp">4f2a 9c31 88de 05b7 · a1c4 77f0 2be9 6d13</div>
      {/if}
    </div>
    {#if !d.current}<button class="out">Sign out</button>{/if}
  </div>
{/each}

<div class="foot">
  <button class="add">Add a device</button>
  <button class="link" onclick={() => (fingerprints = !fingerprints)}>
    {fingerprints ? 'Hide' : 'Show'} fingerprints
  </button>
</div>

<p class="note">
  Signing out a device stops it reading anything from now on. It keeps whatever
  it already downloaded — that can't be taken back.
</p>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 24px; font-size: var(--text-sm); max-width: 56ch; }

  .device {
    display: flex; align-items: center; gap: 12px; padding: 12px 14px;
    border: 1px solid var(--line); border-radius: var(--r-md); margin-bottom: 8px;
    transition: border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .device:hover { border-color: var(--ground-4); background: var(--ground-2); }
  /* A device nobody has used in months is worth noticing without being nagged
     about (`docs/12`). */
  .device.stale { opacity: .7; }
  .meta { flex: 1; min-width: 0; }
  .nm { font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); }
  .fp { font-family: var(--font-mono); font-size: 11px; color: var(--text-mute); margin-top: 5px; }
  .tag {
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    border: 1px solid var(--text-mute); color: var(--text-dim);
    padding: 1px 6px; border-radius: var(--r-xs);
  }
  .out, .add {
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 7px 14px; border-radius: var(--r-pill); background: var(--ground-3); color: var(--text);
    transition: background var(--t-fast) var(--ease);
  }
  .out:hover { background: color-mix(in oklab, var(--face-coral) 30%, var(--ground-3)); }
  .add:hover { background: var(--ground-4); }
  .foot { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
  .link {
    background: none; border: 0; cursor: pointer; color: var(--text-mute);
    font: inherit; font-size: var(--text-sm); text-decoration: underline;
  }
  .link:hover { color: var(--text); }
  .note { margin-top: 22px; color: var(--text-mute); font-size: var(--text-sm); max-width: 58ch; }
</style>
