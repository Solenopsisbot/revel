<script lang="ts">
/**
 * Settings → Storage & data (`docs/19` §"a real screen, not a stub").
 *
 * Local-first means the client holds a real database, so a person can and
 * will ask where their disk went. Nobody does this screen well and it is
 * cheap to do properly, so it is done properly: a real breakdown, a real
 * per-space split, and two clearing actions that are honest about the
 * difference between them.
 *
 * - **Clear cached media** is safe and reversible. It re-downloads on
 *   demand. Said so, right on the button's row.
 * - **Clear local data** is not. It drops decrypted history this device
 *   holds, and history the room won't re-serve is gone from here. That gets
 *   a rung-4 confirmation in Wren's voice, naming the consequence.
 */

import { core } from '$lib/fake/core.svelte.js';
import Icon from '$lib/Icon.svelte';
import { layout } from '$lib/layout.svelte.js';
import { wren } from '$lib/wren/wren.svelte.js';

const s = $derived(core.storage);
const mb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} GB` : `${n} MB`);

/**
 * `docs/24`: the media cache is "capped by default on metered/small devices,
 * with the cap visible and adjustable". Visible was already true; adjustable
 * was not, which made it a fact about the app rather than a decision the
 * person carrying it gets to make.
 */
const CAPS = [
  { mb: 1000, label: '1 GB' },
  { mb: 4000, label: '4 GB' },
  { mb: 12000, label: '12 GB' },
];

const total = $derived(s.messages + s.media + s.index + s.models);
const pct = $derived(Math.round((total / s.limit) * 100));

const rows = $derived([
  { name: 'Messages and history', mb: s.messages, colour: 'aqua' },
  { name: 'Media and files', mb: s.media, colour: 'violet' },
  { name: 'Search index', mb: s.index, colour: 'sky' },
  { name: 'Translation models', mb: s.models, colour: 'mint' },
]);

const leftTotal = $derived(s.leftRooms.reduce((n, r) => n + r.mb, 0));

let exported = $state(false);

function clearEverything() {
  wren.confirm({
    title: 'This deletes the copy on this device',
    body: 'Your account and your rooms are fine — this is only what this device has downloaded. But anything a room no longer serves is gone from here, and I can’t get it back.',
    confirm: 'Clear local data',
    onConfirm: () => {
      core.clearCachedMedia();
      core.clearLeftRoomHistory();
      core.storage.messages = 0;
      core.storage.index = 0;
    },
  });
}

function clearLeft() {
  wren.confirm({
    title: 'This is permanent',
    body: `You left these ${s.leftRooms.length} rooms, so nobody will send the history back. Clearing it frees ${mb(leftTotal)} and ends your copy of those conversations.`,
    confirm: 'Clear history',
    onConfirm: () => core.clearLeftRoomHistory(),
  });
}
</script>

<h2>Storage &amp; data</h2>
<p class="lede">
  Everything below is on this device. The server holds ciphertext it can't read,
  so this is the only copy that is legible anywhere.
</p>

<section>
  <div class="total">
    <span class="label">On this device</span>
    <span class="value">{mb(total)}</span>
  </div>
  <div class="bar" role="img" aria-label="{pct}% of the {mb(s.limit)} limit">
    {#each rows as r (r.name)}
      <span
        class="seg"
        style="width: {(r.mb / s.limit) * 100}%; background: var(--face-{r.colour})"
      ></span>
    {/each}
  </div>
  <p class="cap">{pct}% of the {mb(s.limit)} this device is set to allow.</p>

  <div class="limit">
    <span class="lbl">Cap</span>
    <div class="seg">
      {#each CAPS as c (c.mb)}
        <button
          class:sel={s.limit === c.mb}
          onclick={() => (s.limit = c.mb)}
          aria-pressed={s.limit === c.mb}
        >{c.label}</button>
      {/each}
    </div>
  </div>
  <p class="note">
    {#if layout.coarse}
      Lower by default on a phone, because a phone is where running out of
      space actually happens.
    {/if}
    When it fills, <b>old media goes before old messages</b> — text is small and
    precious, images are large and can be fetched again. Nothing you have
    written is ever what gets evicted.
  </p>

  {#each rows as r (r.name)}
    <div class="row">
      <span class="swatch" style="background: var(--face-{r.colour})"></span>
      <span class="nm">{r.name}</span>
      <span class="mb">{mb(r.mb)}</span>
      {#if r.name === 'Media and files' && r.mb > 0}
        <button class="act" onclick={() => core.clearCachedMedia()}>Clear cached media</button>
      {/if}
    </div>
  {/each}
  <p class="note">
    Clearing cached media is safe — anything you scroll back to downloads again.
  </p>
</section>

<section>
  <h3>By space</h3>
  {#each s.bySpace as sp (sp.id)}
    <div class="row plain">
      <span class="nm">{sp.name}</span>
      <span class="mb">{mb(sp.mb)}</span>
    </div>
  {/each}
</section>

{#if s.leftRooms.length}
  <section>
    <h3>Rooms you left</h3>
    <p class="sub">
      Their history is still here. It won't come back if you clear it — you're
      not a member, so there is nobody to ask for it again.
    </p>
    {#each s.leftRooms as r (r.name)}
      <div class="row plain">
        <span class="nm">#{r.name}</span>
        <span class="mb">{mb(r.mb)}</span>
      </div>
    {/each}
    <button class="act danger" onclick={clearLeft}>Clear {mb(leftTotal)} of left-room history</button>
  </section>
{/if}

<section>
  <h3>Export</h3>
  <p class="sub">
    Plain JSON plus the media files, not a proprietary blob. If your messages
    are genuinely yours, an export has to be readable somewhere that isn't us —
    which is also the honest answer to "what if you shut down".
  </p>
  <button class="act" onclick={() => (exported = true)}>
    <Icon name="download" size={15} /> Export everything
  </button>
  {#if exported}
    <p class="ok" role="status">
      Building the archive on this device. Nothing is uploaded to produce it.
    </p>
  {/if}
</section>

<section>
  <h3>Clear local data</h3>
  <p class="sub">
    Signs nothing out and deletes nothing on the server. It empties this
    device's copy — messages, media, and the search index — and the client
    re-downloads whatever your rooms are still willing to serve.
  </p>
  <button class="act danger" onclick={clearEverything}>Clear local data</button>
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); max-width: 62ch; line-height: 1.55; }
  section { margin-bottom: 34px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 12px; display: block; line-height: 1.5; max-width: 60ch; }

  .total { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
  .label { font-size: var(--text-base); font-weight: 700; }
  .value { font-family: var(--font-mono); font-size: var(--text-lg, 20px); font-weight: 600; }

  .bar {
    display: flex; height: 10px; border-radius: var(--r-pill); overflow: hidden;
    background: var(--ground-3); margin-bottom: 7px;
  }
  .bar .seg { display: block; height: 100%; }
  .cap { font-size: 12px; color: var(--text-mute); margin: 0 0 12px; }

  .limit { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 8px; }
  .limit .lbl { font-size: var(--text-sm); font-weight: 600; }
  .seg { display: inline-flex; gap: 3px; background: var(--ground-2); padding: 3px; border-radius: var(--r-pill); }
  .seg button {
    border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
    padding: 6px 14px; border-radius: var(--r-pill); background: transparent; color: var(--text-dim);
    min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .seg button:hover { color: var(--text); }
  .seg button.sel { background: var(--brand); color: #fff; }

  .row {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 0; border-bottom: 1px solid var(--line); font-size: var(--text-sm);
  }
  .row.plain { padding: 8px 0; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; flex: none; }
  .nm { flex: 1; min-width: 0; }
  .mb { font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }

  .act {
    display: inline-flex; align-items: center; gap: 7px; flex: none;
    border: 1px solid var(--line); background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--text-mute);
    padding: 6px 12px; border-radius: var(--r-pill); margin-left: 10px;
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .act:hover { color: var(--text); background: var(--ground-2); }
  .act.danger { color: var(--face-rose); border-color: color-mix(in oklab, var(--face-rose) 45%, transparent); margin: 14px 0 0; }
  .act.danger:hover { background: color-mix(in oklab, var(--face-rose) 16%, transparent); color: var(--face-rose); }

  .note, .ok {
    margin: 12px 0 0; font-size: 12px; color: var(--text-mute); line-height: 1.55; max-width: 58ch;
  }
  .ok { color: var(--face-mint); }
</style>
