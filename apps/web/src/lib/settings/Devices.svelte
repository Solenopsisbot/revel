<script lang="ts">
  /**
   * The device list reads `core`, not a local array, because Wren reads the
   * same list to decide whether to mention a device nobody has touched in
   * three months. Revoking one from her panel has to make it disappear from
   * here, and vice versa — two copies would drift within a week.
   */
  import { core } from '$lib/fake/core.svelte.js';

  let fingerprints = $state(false);
</script>

<h2>Devices</h2>
<p class="lede">
  Each of these holds its own key. Signing one out stops it reading anything
  sent from then on.
</p>

{#each core.devices as d (d.id)}
  <div class="device" class:stale={d.seenDays >= 90}>
    <div class="meta">
      <div class="nm">
        {d.name}
        {#if d.agent}<span class="tag">runs {d.agent}</span>{/if}
      </div>
      <div class="sub">{d.platform} · last seen {d.seen}</div>
      {#if fingerprints}
        <div class="fp">{d.fingerprint}</div>
      {/if}
    </div>
    <!-- The current device cannot revoke itself. That is "sign out", which
         lives under Account and means something different. -->
    {#if !d.current}
      <button class="out" onclick={() => core.revokeDevice(d.id)}>Sign out</button>
    {/if}
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
