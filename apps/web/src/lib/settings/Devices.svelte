<script lang="ts">
/**
 * The device list reads `core`, not a local array, because Wren reads the
 * same list to decide whether to mention a device nobody has touched in
 * three months. Revoking one from her panel has to make it disappear from
 * here, and vice versa — two copies would drift within a week.
 */
import { goto } from '$app/navigation';
import { core } from '$lib/fake/core.svelte.js';
import { fingerprint } from '$lib/fingerprint.js';
import { live } from '$lib/live.svelte.js';
import { session } from '$lib/session.svelte.js';
import { fromBase64, toBase64 } from '@revel/protocol';
import { wren } from '$lib/wren/wren.svelte.js';

let fingerprints = $state(false);

/** This device's own key, so its row can say so and refuse to sign itself out. */
const thisDevice = $derived(
  session.current?.device ? toBase64(session.current.device.devicePub) : '',
);

$effect(() => {
  if (!core.demo) void live.refreshDevices();
});

/**
 * The Host's list, in the shape this screen renders.
 *
 * Three fixture fields have no live equivalent and are **left out rather than
 * invented**: `platform` and `seen` are not things the Host records, and the
 * `stale` treatment is derived from a last-seen it therefore does not have. A
 * device list that guessed at "last seen 3 months ago" would be the one screen
 * in the product where a plausible number is actively dangerous.
 */
const rows = $derived.by(() => {
  // Live only. The demo renders `core.devices` directly, because the fixture
  // shape carries fields the Host has never heard of and squeezing both
  // through one type would mean inventing the missing half.
  void live.version;
  return live.devices
    .filter((d) => !d.revokedAt)
    .map((d) => ({
      id: d.pub,
      name: d.label || 'Unnamed device',
      current: d.pub === thisDevice,
      added: d.registeredAt,
    }));
});

/** pub → fingerprint, computed once each and only when asked for. */
let prints = $state<Record<string, string>>({});
$effect(() => {
  if (!fingerprints || core.demo) return;
  for (const d of rows) {
    if (prints[d.id]) continue;
    void fingerprint(fromBase64(d.id)).then((fp) => (prints = { ...prints, [d.id]: fp }));
  }
});

function signOut(id: string, name: string) {
  wren.confirm({
    title: `Sign out ${name}?`,
    body: `It stops being able to read anything sent from then on, and its sessions end immediately. What it already downloaded stays on it — that part can't be taken back.`,
    confirm: 'Sign it out',
    onConfirm: () => void live.revokeDevice(id),
  });
}

const when = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<h2>Devices</h2>
<p class="lede">
  Each of these holds its own key. Signing one out stops it reading anything
  sent from then on.
</p>

{#if core.demo}
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
{:else}
  {#each rows as d (d.id)}
    <div class="device">
      <div class="meta">
        <div class="nm">
          {d.name}
          {#if d.current}<span class="tag">this device</span>{/if}
        </div>
        <div class="sub">added {when(d.added)}</div>
        {#if fingerprints}
          <div class="fp">{prints[d.id] ?? '…'}</div>
        {/if}
      </div>
      <!-- The current device cannot revoke itself. That is "sign out", which
           lives under Account and means something different. -->
      {#if !d.current}
        <button class="out" onclick={() => signOut(d.id, d.name)}>Sign out</button>
      {/if}
    </div>
  {:else}
    <p class="note">No devices yet, which cannot be true — try again in a moment.</p>
  {/each}
{/if}

<div class="foot">
  <button class="add" onclick={() => goto('/add-device')}>Add a device</button>
  <button class="link" onclick={() => (fingerprints = !fingerprints)}>
    {fingerprints ? 'Hide' : 'Show'} fingerprints
  </button>
</div>

{#if fingerprints && !core.demo}
  <p class="note">
    These are the same six numbers the other screen shows when you pair a
    device. They are for you to compare — nothing here checks them, because a
    device that is signed in has already proved it holds the key.
  </p>
{/if}

{#if !core.demo}
  <p class="note">
    The Host records when a device was added and nothing else about it — no
    platform, no location, no last-seen. There is nothing here to show you
    because there is nothing there to know.
  </p>
{/if}

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
