<script lang="ts">
/**
 * Space settings (`docs/18` §"Space settings — the IA").
 *
 * One modal, left-hand tabs, ordered by how often they're touched. Tabs that
 * aren't built are listed rather than hidden, same rule as the account
 * settings sheet: a settings screen that quietly omits half its own map is
 * harder to reason about than one that says what's coming.
 */

import { core } from '$lib/fake/core.svelte.js';
import Icon from '$lib/Icon.svelte';
import { wren } from '$lib/wren/wren.svelte.js';
import SpaceAudiences from './SpaceAudiences.svelte';
import SpaceInvites from './SpaceInvites.svelte';
import SpaceModeration from './SpaceModeration.svelte';
import SpaceOverview from './SpaceOverview.svelte';
import SpacePeople from './SpacePeople.svelte';
import SpaceRoles from './SpaceRoles.svelte';
import SpaceRooms from './SpaceRooms.svelte';

let {
  open = $bindable(false),
  tab = $bindable('overview'),
  room = $bindable<string | undefined>(undefined),
}: { open?: boolean; tab?: string; room?: string } = $props();

const TABS = [
  { id: 'overview', name: 'Overview', blurb: 'Name, icon, who it’s for', built: true },
  { id: 'rooms', name: 'Rooms', blurb: 'List, create, per-room settings', built: true },
  {
    id: 'audiences',
    name: 'Who can see what',
    blurb: 'The encryption boundary, per room',
    built: true,
  },
  { id: 'people', name: 'People', blurb: 'Members, roles, kick and ban', built: true },
  { id: 'roles', name: 'Roles', blurb: 'The permission editor', built: true },
  { id: 'invites', name: 'Invites', blurb: 'Active links, uses, expiry', built: true },
  { id: 'moderation', name: 'Moderation', blurb: 'Reports, bans, purge log', built: true },
  { id: 'danger', name: 'Danger', blurb: 'Transfer ownership, delete', built: true },
];

const meta = $derived(TABS.find((t) => t.id === tab) ?? TABS[0]!);
let panel = $state<HTMLElement>();

function onKey(e: KeyboardEvent) {
  if (!open) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    open = false;
  }
}

$effect(() => {
  if (open) panel?.focus();
});

function leave() {
  const name = core.space.name;
  wren.confirm({
    title: `Leave ${name}?`,
    body: `You come out of every room in it and this device drops the keys. Somebody would have to invite you back — and even then, everything said while you were gone stays unreadable, because those messages were encrypted to epochs your leaf was not in.`,
    confirm: `Leave ${name}`,
    onConfirm: () => {
      void core.leaveSpace(core.currentSpaceId);
      open = false;
    },
  });
}

function del() {
  const name = core.space.name;
  wren.confirm({
    title: `This deletes ${name} for everyone`,
    body: `Every room in it goes, and so does the history — those messages were encrypted to this space and there is nowhere else they live. The other members lose it too, and I can’t get any of it back.`,
    confirm: `Delete ${name}`,
    onConfirm: () => {
      core.deleteSpace(core.currentSpaceId);
      open = false;
    },
  });
}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div
    class="scrim"
    role="button"
    tabindex="-1"
    aria-label="Close space settings"
    onclick={() => (open = false)}
    onkeydown={(e) => e.key === 'Enter' && (open = false)}
  ></div>

  <div class="sheet" role="dialog" aria-modal="true" aria-label="{core.space.name} settings" bind:this={panel} tabindex="-1">
    <nav aria-label="Space settings sections">
      <div class="head">
        <span class="icon" style="--from: var(--face-{core.space.from}); --to: var(--face-{core.space.to})">
          {core.space.initial}
        </span>
        <span class="nm">{core.space.name}</span>
      </div>
      {#each TABS as t (t.id)}
        <button
          class="item"
          class:sel={t.id === tab}
          class:soon={!t.built}
          class:danger={t.id === 'danger'}
          onclick={() => { tab = t.id; room = undefined; }}
          aria-current={t.id === tab ? 'page' : undefined}
        >
          <span class="t-nm">{t.name}</span>
          <span class="t-bl">{t.blurb}</span>
          {#if !t.built}<span class="soon-tag">not built</span>{/if}
        </button>
      {/each}
    </nav>

    <main>
      <button class="close" onclick={() => (open = false)} aria-label="Close space settings">
        <Icon name="plus" size={18} />
      </button>
      {#key tab + (room ?? '')}
        <div class="pane">
          {#if tab === 'overview'}
            <SpaceOverview />
          {:else if tab === 'rooms'}
            <SpaceRooms initialRoom={room} />
          {:else if tab === 'audiences'}
            <SpaceAudiences />
          {:else if tab === 'people'}
            <SpacePeople />
          {:else if tab === 'roles'}
            <SpaceRoles />
          {:else if tab === 'invites'}
            <SpaceInvites />
          {:else if tab === 'moderation'}
            <SpaceModeration />
          {:else if tab === 'danger'}
            <h2>Danger</h2>
            <p class="lede">Two things here, and both of them are final.</p>
            <section>
              <h3>Transfer ownership</h3>
              <p class="sub">
                Hands this space to another member. You keep your account and
                your membership; you stop being able to undo their decisions.
              </p>
              <button class="btn" disabled={!core.demo}>Choose someone</button>
              {#if !core.demo}<p class="sub">Not built yet.</p>{/if}
            </section>
            {#if core.demo}
              <section>
                <h3>Delete this space</h3>
                <p class="sub">
                  Deletes every room and all of their history, for everyone. A
                  space is a row and a key group rather than a machine, so there
                  is no backup sitting somewhere to restore from.
                </p>
                <button class="btn danger-btn" onclick={del}>Delete {core.space.name}</button>
              </section>
            {:else}
              <!-- Leaving, not deleting. The Host has no delete route, and a
                   button labelled "delete" that removes one membership row is
                   the worst possible version of this control — everyone else
                   would still be in a space its owner believed was gone. -->
              <section>
                <h3>Leave this space</h3>
                <p class="sub">
                  You come out of every room in it and your device drops the
                  keys, so the history stops rather than disappearing — it was
                  encrypted to a group you are no longer in. Everyone else keeps
                  the space.
                </p>
                <button class="btn danger-btn" onclick={leave}>Leave {core.space.name}</button>
              </section>
            {/if}
          {:else}
            <h2>{meta.name}</h2>
            <p class="lede">{meta.blurb}</p>
            <div class="stub">
              <p>This tab isn't built yet.</p>
              <p class="muted">
                It's specified in <code>docs/18-spaces-ux.md</code>. Nothing here
                is faked in the meantime.
              </p>
            </div>
          {/if}
        </div>
      {/key}
    </main>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 62; border: 0; padding: 0;
    background: var(--scrim); backdrop-filter: blur(3px);
    animation: fade var(--t-base) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .sheet {
    position: fixed; inset: 3vh 3vw; z-index: 63;
    display: grid; grid-template-columns: 250px 1fr;
    background: var(--ground-0); border: 1px solid var(--line);
    border-radius: var(--r-lg); overflow: hidden;
    box-shadow: var(--shadow-panel);
    animation: rise var(--t-base) var(--ease);
  }
  .sheet:focus { outline: none; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(10px) scale(.995); }
    to { opacity: 1; transform: none; }
  }

  nav { background: var(--ground-1); border-right: 1px solid var(--line); padding: 12px 10px; overflow-y: auto; }
  .head { display: flex; align-items: center; gap: 9px; padding: 4px 8px 12px; }
  .icon {
    width: 28px; height: 28px; border-radius: var(--r-sm); flex: none;
    display: grid; place-items: center; font-weight: 800; font-size: 13px; color: #fff;
    background: linear-gradient(140deg, var(--from), var(--to));
  }
  .head .nm { font-weight: 700; font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .item {
    display: block; width: 100%; text-align: left; cursor: pointer; position: relative;
    background: transparent; border: 0; color: var(--text); font: inherit;
    padding: 8px 10px; border-radius: var(--r-sm); margin-bottom: 2px;
    transition: background var(--t-fast) var(--ease);
  }
  .item:hover { background: var(--ground-2); }
  .item.sel { background: var(--ground-3); }
  .item.soon .t-nm { color: var(--text-mute); }
  .item.danger .t-nm { color: var(--face-rose); }
  .t-nm { display: block; font-weight: 600; font-size: var(--text-sm); }
  .t-bl { display: block; font-size: 11px; color: var(--text-mute); margin-top: 1px; padding-right: 54px; }
  .soon-tag {
    position: absolute; right: 10px; top: 9px;
    font-size: 9px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-mute); border: 1px solid var(--line); padding: 1px 5px; border-radius: var(--r-xs);
  }

  main { overflow-y: auto; padding: 34px clamp(24px, 4vw, 56px) 70px; position: relative; }
  .close {
    position: absolute; right: 20px; top: 18px; display: flex; align-items: center;
    background: transparent; border: 0; cursor: pointer; color: var(--text-mute);
    padding: 6px; border-radius: var(--r-sm);
  }
  /* The glyph turns; the button does not. Rotating the button rotates its
     background with it, which is why the hover shade sat as a diamond behind
     a square icon. */
  .close :global(svg) { rotate: 45deg; }
  .close:hover { color: var(--text); background: var(--ground-2); }

  .pane { max-width: 720px; animation: fade var(--t-fast) var(--ease); }
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); }
  .sub { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 12px; line-height: 1.55; max-width: 58ch; }
  section { margin-bottom: 30px; }
  .btn {
    border: 1px solid var(--line); background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--text-mute);
    padding: 7px 14px; border-radius: var(--r-pill);
  }
  .btn:hover { color: var(--text); background: var(--ground-2); }
  .danger-btn { color: var(--face-rose); border-color: color-mix(in oklab, var(--face-rose) 45%, transparent); }
  .danger-btn:hover { background: color-mix(in oklab, var(--face-rose) 16%, transparent); }

  .stub { background: var(--ground-2); border-radius: var(--r-md); padding: 20px; }
  .stub p { margin: 0 0 6px; font-size: var(--text-sm); }
  .muted { color: var(--text-mute); margin-bottom: 0 !important; }
  code { font-family: var(--font-mono); font-size: .9em; }

  @media (max-width: 820px) {
    .sheet { inset: 0; border-radius: 0; grid-template-columns: 1fr; }
    /* A tab strip that scrolls sideways wants no bar under it — the row of
       half-visible tabs is already the affordance. Local rule, so it beats
       the global one in app.css. */
    nav {
      display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none;
      border-right: 0; border-bottom: 1px solid var(--line); padding: 8px;
    }
    nav::-webkit-scrollbar { display: none; }
    .head { display: none; }
    .item { width: auto; flex: none; }
    .t-bl, .soon-tag { display: none; }
  }
</style>
