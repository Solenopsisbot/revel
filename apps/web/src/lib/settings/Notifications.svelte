<script lang="ts">
/**
 * Settings → Notifications (`docs/19`): global rules, per-space and per-room
 * overrides, quiet hours, sounds, lock-screen previews.
 *
 * The design choice worth defending is that every room row shows the level
 * it is *actually getting* and where that came from. Every notification
 * screen ever built answers "what is this set to"; almost none answer "why
 * is this room quiet", which is the only question anyone brings to the
 * screen. `core.notifyFor` returns both, so the row can say "Mentions ·
 * from Solexsis" rather than leaving you to work it out.
 */

import { core } from '$lib/fake/core.svelte.js';
import type { NotifyLevel } from '$lib/fake/data.js';
import Icon from '$lib/Icon.svelte';
import { layout } from '$lib/layout.svelte.js';

const LEVELS: { id: NotifyLevel; label: string }[] = [
  { id: 'everything', label: 'Everything' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'nothing', label: 'Nothing' },
];

const n = $derived(core.notifications);

/** Rooms that carry an explicit override, so the list leads with the
      decisions someone actually made rather than a wall of inherited rows. */
const overridden = $derived(
  core.spaces.flatMap((s) => s.rooms.filter((r) => r.notify).map((r) => ({ space: s, room: r }))),
);

/**
 * Conversations with a rule of their own.
 *
 * Separate from `overridden` because a DM has no space: it cannot inherit, so
 * there is nothing to say it is following and nothing to clear it back to
 * except the floor.
 */
const mutedDms = $derived(core.dms.filter((d) => d.notify));

let addingFor = $state<string | null>(null);

/**
 * What push actually does on the device you are holding.
 *
 * `docs/24`: "This is where mobile hurts, and pretending otherwise helps
 * nobody… the notification settings screen on iOS states the limitation
 * plainly instead of showing a toggle that silently does nothing."
 *
 * So this is not a support-matrix table for everyone to read. It is a
 * statement about *this* device, and it exists to stop the app implying a
 * capability it doesn't have. `?platform=ios` forces it for review.
 */
const delivery = $derived.by(() => {
  if (!layout.ios) {
    return {
      warn: false,
      line: 'Push works on this device. Notifications arrive whether or not Revel is open.',
    };
  }
  if (!layout.standalone) {
    return {
      warn: true,
      line: 'Safari on iOS only delivers push to an app added to the Home Screen. Until Revel is added, nothing on this screen can reach you while it is closed.',
    };
  }
  return {
    warn: true,
    line: 'Push works here, and less well than we would like. What follows is Apple\u2019s doing, not a setting you have got wrong.',
  };
});

/** With no push at all, a lock-screen preview toggle is a control that does
      nothing. Disabling it and saying why beats letting it lie. */
const noPush = $derived(layout.ios && !layout.standalone);
</script>

<h2>Notifications</h2>
<p class="lede">
  A room falls back to its space, and a space falls back to the default. Rooms
  set to Nothing still show as unread — they just don't reach you.
</p>

<section>
  <h3>Default</h3>
  <p class="sub">Everything without a more specific rule uses this.</p>
  <div class="seg">
    {#each LEVELS as l (l.id)}
      <button
        class:sel={n.global === l.id}
        onclick={() => {
          n.global = l.id;
          core.saveNotifications();
        }}
        aria-pressed={n.global === l.id}
      >{l.label}</button>
    {/each}
  </div>
</section>

<section>
  <h3>Spaces</h3>
  {#each core.spaces as s (s.id)}
    {@const level = n.spaces[s.id]}
    <div class="row">
      <div class="meta">
        <div class="nm">{s.name}</div>
        <div class="bl">
          {#if level}Overriding the default{:else}Following the default ({LEVELS.find((l) => l.id === n.global)?.label.toLowerCase()}){/if}
        </div>
      </div>
      <div class="seg small">
        {#each LEVELS as l (l.id)}
          <button
            class:sel={level === l.id}
            onclick={() => core.setSpaceNotify(s.id, level === l.id ? undefined : l.id)}
            aria-pressed={level === l.id}
          >{l.label}</button>
        {/each}
      </div>
    </div>
  {/each}
</section>

<section>
  <h3>Rooms</h3>
  <p class="sub">
    Only rooms you have set explicitly. Everything else follows its space.
  </p>

  {#each overridden as { space, room } (room.id)}
    {@const r = core.notifyFor(space.id, room.id)}
    <div class="row">
      <div class="meta">
        <div class="nm">#{room.name}<span class="in">in {space.name}</span></div>
        <div class="bl">
          {LEVELS.find((l) => l.id === r.level)?.label} ·
          {#if r.from === 'room'}set on this room{:else if r.from === 'space'}from {space.name}{:else}from the default{/if}
        </div>
      </div>
      <div class="seg small">
        {#each LEVELS as l (l.id)}
          <button
            class:sel={room.notify === l.id}
            onclick={() => core.setRoomNotify(space.id, room.id, l.id)}
            aria-pressed={room.notify === l.id}
          >{l.label}</button>
        {/each}
      </div>
      <button
        class="clear"
        title="Follow the space again"
        onclick={() => core.setRoomNotify(space.id, room.id, undefined)}
      ><Icon name="x" size={14} /></button>
    </div>
  {:else}
    <p class="empty">No room overrides. Every room follows its space.</p>
  {/each}

  <!--
    Conversations, which have no space to follow. `docs/35`: a DM's floor is
    `everything`, so muting one is always an explicit act — which makes this
    the only place it can be undone. A mute you cannot find is a mute you
    cannot lift.
  -->
  {#each mutedDms as dm (dm.id)}
    <div class="row">
      <div class="meta">
        <div class="nm">{dm.name ?? core.dmTitle(dm)}<span class="in">a conversation</span></div>
        <div class="bl">
          {LEVELS.find((l) => l.id === dm.notify)?.label} · set on this conversation
        </div>
      </div>
      <div class="seg small">
        {#each LEVELS as l (l.id)}
          <button
            class:sel={dm.notify === l.id}
            onclick={() => core.setNotifyFor(dm.id, l.id)}
            aria-pressed={dm.notify === l.id}
          >{l.label}</button>
        {/each}
      </div>
      <button
        class="clear"
        title="Notify for everything again"
        onclick={() => core.setNotifyFor(dm.id, undefined)}
      ><Icon name="x" size={14} /></button>
    </div>
  {/each}

  {#if addingFor}
    {@const space = core.spaces.find((s) => s.id === addingFor)!}
    <div class="picker">
      {#each space.rooms.filter((r) => !r.notify) as room (room.id)}
        <button onclick={() => { core.setRoomNotify(space.id, room.id, 'mentions'); addingFor = null; }}>
          #{room.name}
        </button>
      {:else}
        <span class="none">Every room in {space.name} already has a rule.</span>
      {/each}
      <button class="cancel" onclick={() => (addingFor = null)}>Cancel</button>
    </div>
  {:else}
    <div class="adds">
      {#each core.spaces as s (s.id)}
        <button class="add" onclick={() => (addingFor = s.id)}>
          <Icon name="plus" size={14} /> Room in {s.name}
        </button>
      {/each}
    </div>
  {/if}
</section>

<section>
  <h3>Quiet hours</h3>
  <label class="check">
    <input
      type="checkbox"
      bind:checked={n.quietHours.on}
      onchange={() => core.saveNotifications()}
    />
    <span>
      <b>Hold notifications overnight</b>
      <span class="sub">
        They still arrive and still count — they just don't make a sound or
        light up your screen until the window ends.
      </span>
    </span>
  </label>
  {#if n.quietHours.on}
    <div class="times">
      <label>
        From
        <input type="time" bind:value={n.quietHours.from} onchange={() => core.saveNotifications()} />
      </label>
      <label>
        Until
        <input type="time" bind:value={n.quietHours.to} onchange={() => core.saveNotifications()} />
      </label>
    </div>
  {/if}
</section>

<section>
  <h3>On this device</h3>

  <p class="status" class:warn={delivery.warn}>
    <Icon name={delivery.warn ? 'warn' : 'check'} size={15} />
    <span>{delivery.line}</span>
  </p>

  {#if layout.ios}
    <ul class="honest">
      <li>
        iOS drops push subscriptions silently — often after a restart. Revel
        re-subscribes when you next open it, which is why notifications can go
        quiet for a while and then come back on their own.
      </li>
      <li>
        There is no background sync. Nothing arrives until you open the app.
      </li>
      <li>
        In the EU, Apple does not permit web push at all. Nothing on this
        screen can change that, and it is not something you have misconfigured.
      </li>
    </ul>
  {/if}

  <p class="sub">
    None of which loses a message. Every time you open Revel it syncs from
    where it left off, so a missed push is a late message rather than a
    lost one — and because the push carries no content and your device
    decrypts it, one that arrives late still says the right thing.
  </p>

  <label class="check">
    <input type="checkbox" bind:checked={n.sound} onchange={() => core.saveNotifications()} />
    <span><b>Sound</b></span>
  </label>
  <label class="check" class:off={noPush}>
    <input
      type="checkbox"
      bind:checked={n.previews}
      disabled={noPush}
      onchange={() => core.saveNotifications()}
    />
    <span>
      <b>Show message text on the lock screen</b>
      <span class="sub">
        {#if noPush}
          Nothing to show yet — there are no push notifications on this device
          until Revel is on the Home Screen.
        {:else}
          The push itself carries no content — your device already has the keys
          and decrypts it locally. So this is genuinely your choice: nothing you
          turn on here sends a word of your messages to anyone's server.
        {/if}
      </span>
    </span>
  </label>
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); max-width: 62ch; line-height: 1.55; }
  section { margin-bottom: 34px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 12px; display: block; line-height: 1.5; }

  .seg { display: inline-flex; gap: 3px; background: var(--ground-2); padding: 3px; border-radius: var(--r-pill); }
  .seg button {
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 7px 18px; border-radius: var(--r-pill); background: transparent; color: var(--text-dim);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .seg button:hover { color: var(--text); }
  .seg button.sel { background: var(--brand); color: #fff; }
  .seg.small button { padding: 5px 12px; font-size: 12px; }

  .row {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 0; border-bottom: 1px solid var(--line);
  }
  .meta { flex: 1; min-width: 0; }

  /*
   * Narrow, the label and its control stack.
   *
   * Side by side they were both losing: three pill buttons will not go under
   * 260px, so the label got whatever was left — about 110px, enough to break
   * `#ci-noise` across two lines and "Nothing · set on this room" across four,
   * while the control still overflowed the row. Stacked, each gets the full
   * width and the pills stay one line.
   */
  @media (max-width: 560px) {
    .row { flex-direction: column; align-items: stretch; gap: 8px; }
    .row .seg { align-self: flex-start; }
    /* The clear button was the third column; on its own row it reads as an
       action for the group above it, which is what it is. */
    .row .clear { align-self: flex-end; margin-top: -40px; }
  }
  .nm { font-size: var(--text-sm); font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
  .in { font-weight: 400; font-size: 11px; color: var(--text-mute); }
  .bl { font-size: 12px; color: var(--text-mute); margin-top: 1px; }
  .clear {
    border: 0; background: transparent; cursor: pointer; color: var(--text-mute);
    padding: 6px; border-radius: var(--r-sm); display: flex; flex: none;
    /* The sheet-wide rule gives it the height; an icon-only button needs the
       width said separately or it stays a 26px sliver. */
    min-width: var(--tap); justify-content: center;
  }
  .clear:hover { color: var(--text); background: var(--ground-2); }

  .empty { font-size: var(--text-sm); color: var(--text-mute); margin: 0 0 12px; }

  .adds, .picker { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; align-items: center; }
  .add, .picker button {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--line); background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--text-dim);
    padding: 6px 12px; border-radius: var(--r-pill);
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .add:hover, .picker button:hover { color: var(--text); background: var(--ground-2); }
  .picker .cancel { border-color: transparent; color: var(--text-mute); }
  .picker .none { font-size: 12px; color: var(--text-mute); }

  .check { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; margin-bottom: 14px; }
  .check input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--face-mint); cursor: pointer; flex: none; }
  .check b { display: block; font-weight: 600; margin-bottom: 2px; font-size: var(--text-sm); }
  .check .sub { margin: 0; max-width: 58ch; }

  .status {
    display: flex; align-items: flex-start; gap: 9px;
    font-size: var(--text-sm); line-height: 1.5; color: var(--text-dim);
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-sm); padding: 11px 13px; margin: 0 0 14px; max-width: 62ch;
  }
  .status :global(svg) { flex: none; margin-top: 2px; color: var(--face-mint); }
  /* Amber rather than red: a real limitation to know about, not a failure. */
  .status.warn { border-color: color-mix(in oklab, var(--face-gold) 45%, var(--line)); }
  .status.warn :global(svg) { color: var(--face-gold); }

  .honest {
    margin: 0 0 14px; padding-left: 18px; max-width: 62ch;
    font-size: var(--text-sm); color: var(--text-mute); line-height: 1.55;
  }
  .honest li { margin-bottom: 7px; }

  .check.off b { color: var(--text-mute); }

  /* Two time fields plus their labels are wider than a phone pane, so they
     wrap rather than running off the edge of the card. */
  .times { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 4px 0 0 30px; }
  .times label { font-size: var(--text-sm); color: var(--text-mute); display: flex; align-items: center; gap: 8px; }
  .times input {
    font: inherit; font-size: var(--text-sm); font-family: var(--font-mono);
    background: var(--ground-2); border: 1px solid var(--line); color: var(--text);
    padding: 6px 10px; border-radius: var(--r-sm);
  }
</style>
