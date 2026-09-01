<script lang="ts">
/**
 * Space settings → Invites (`docs/18` §Joining, `docs/03` §4).
 *
 * The link is `revel.chat/i/<code>#<key>` and the shape is the point: the
 * fragment carries the key material and **never reaches the server**, which
 * is the Wormhole trick Kith already proved. So the Host is holding a row it
 * cannot open, and anyone with the link can — which is exactly why expiry
 * and use counts exist. They are not tidiness, they are the blast radius.
 *
 * The screen shows the key half rather than hiding it, because a link you
 * cannot see the shape of is a link you cannot reason about, and "the part
 * after the # never leaves your browser" is a claim best made next to the
 * part it is about.
 *
 * The history switch is `docs/18`'s "said once on the invite page" line,
 * made at the moment it is decided rather than explained afterwards.
 */
import Avatar from '$lib/Avatar.svelte';
import { core } from '$lib/fake/core.svelte.js';
import { ago } from '$lib/format.js';
import Icon from '$lib/Icon.svelte';
import { whyNot } from '$lib/startErrors.js';
import type { InviteInfo } from '@revel/protocol';
import { resolve } from './perms.js';

const space = $derived(core.space);
const mine = $derived(core.myMembership);
const mayInvite = $derived(!!mine?.owner || resolve(space, mine?.roles ?? []).has('INVITE'));

let who = $state('');
let busy = $state(false);
let failed = $state('');
let invited = $state('');

async function invite() {
  const handle = who.trim();
  if (!handle) return;
  busy = true;
  failed = '';
  invited = '';
  const result = await core.inviteToSpace(space.id, handle);
  busy = false;
  if (result.error) {
    failed = whyNot(result.error);
    return;
  }
  invited = handle.replace(/^@/, '');
  who = '';
}

/** Live invites, refreshed after anything that changes them. */
let links = $state<InviteInfo[]>([]);
/** The URL just made. Shown once, because nothing keeps the key half. */
let fresh = $state<string | null>(null);
let making = $state(false);

$effect(() => {
  if (core.demo) return;
  const spaceId = space.id;
  void core.invitesFor(spaceId).then((found) => (links = found));
});

async function refreshLinks() {
  links = await core.invitesFor(space.id);
}

async function makeLink() {
  making = true;
  failed = '';
  fresh = null;
  const result = await core.newInvite(space.id, {
    ...(uses === '∞' ? {} : { maxUses: Number(uses) }),
    ...(days === 'never' ? {} : { ttl: Number(days) * 24 * 60 * 60 * 1000 }),
  });
  making = false;
  if (result.error) {
    failed = whyNot(result.error);
    return;
  }
  fresh = result.url ?? null;
  await refreshLinks();
}

async function copyLink(url: string) {
  await navigator.clipboard?.writeText(url).catch(() => {});
  copied = url;
  setTimeout(() => (copied = null), 1600);
}

async function revoke(code: string) {
  await core.killInvite(space.id, code);
  await refreshLinks();
}

/** The fixture `status` helper wants nulls as absences. */
const liveShape = (i: InviteInfo) => ({
  uses: i.uses,
  ...(i.maxUses !== undefined ? { maxUses: i.maxUses } : {}),
  ...(i.expiresAt !== undefined ? { expiresAt: i.expiresAt } : {}),
});

let uses = $state<'1' | '10' | '∞'>('10');
let days = $state<'1' | '7' | '30' | 'never'>('7');
let history = $state(true);
let copied = $state<string | null>(null);

function link(code: string, key: string) {
  return `revel.chat/i/${code}#${key}`;
}

function copy(code: string, key: string) {
  void navigator.clipboard?.writeText(`https://${link(code, key)}`);
  copied = code;
  setTimeout(() => (copied = null), 1600);
}

function make() {
  core.createInvite({
    maxUses: uses === '∞' ? undefined : Number(uses),
    days: days === 'never' ? undefined : Number(days),
    history,
  });
}

/** Spent, expired, or live — and which, because they read differently. */
function status(i: { uses: number; maxUses?: number; expiresAt?: number }) {
  if (i.maxUses !== undefined && i.uses >= i.maxUses) return { dead: true, why: 'All used up' };
  if (i.expiresAt !== undefined && i.expiresAt < Date.now())
    return { dead: true, why: `Expired ${ago(i.expiresAt)}` };
  return { dead: false, why: '' };
}
</script>

<h2>Invites</h2>

{#if !core.demo}
  <!-- Invite *links* are `docs/03` §4's Wormhole trick and the Host has no
       route for them yet, so the screen below is a reference rather than a
       control. What does work is adding somebody by name — and it does the
       whole job: the row, and the MLS commit that actually hands over keys. -->
  <p class="lede">
    Add somebody to {space.name} by name. They get the rooms they have an
    audience for, and the keys to read them — the second half is the one that
    matters, and it happens here rather than the next time anyone opens a room.
  </p>

  <form class="by-name" onsubmit={(e) => { e.preventDefault(); invite(); }}>
    <input
      bind:value={who}
      placeholder="handle"
      aria-label="Who do you want to invite?"
      autocomplete="off"
      disabled={!mayInvite}
    />
    <button type="submit" disabled={!mayInvite || busy || !who.trim()}>
      {busy ? 'Inviting…' : 'Invite'}
    </button>
    {#if !mayInvite}
      <p class="note" role="status">
        You can’t invite people here because you don’t have Create invites.
      </p>
    {:else if failed}
      <p class="note">{failed}</p>
    {:else if invited}
      <p class="note">{invited} is in.</p>
    {/if}
  </form>

  <section>
    <h3>Links</h3>
    <p class="sub">
      The half after the <code>#</code> is key material. It is made on this
      device, it goes in the link, and it never reaches the server — which is
      why the Host is holding a row it cannot use, and why a link that leaks
      only leaks as far as its use count and expiry allow.
    </p>

    {#if mayInvite}
      <div class="opts">
        <div class="opt">
          <span class="lbl">Uses</span>
          <div class="seg">
            {#each ['1', '10', '∞'] as u (u)}
              <button class:sel={uses === u} onclick={() => (uses = u as typeof uses)}>{u}</button>
            {/each}
          </div>
        </div>
        <div class="opt">
          <span class="lbl">Expires</span>
          <div class="seg">
            {#each [['1', '1 day'], ['7', '7 days'], ['30', '30 days'], ['never', 'Never']] as [v, l] (v)}
              <button class:sel={days === v} onclick={() => (days = v as typeof days)}>{l}</button>
            {/each}
          </div>
        </div>
      </div>
      <button class="make" onclick={makeLink} disabled={making}>
        {making ? 'Making it…' : 'Make a link'}
      </button>
    {/if}

    {#if fresh}
      <!-- Shown once, and said so. Nothing stores this string: the key half is
           not on the server and this client does not keep it either, so
           closing the panel is losing it. A new one costs nothing, which is
           the reason that is an acceptable trade rather than a papercut. -->
      <div class="fresh">
        <p class="lbl">Copy this now — it is not shown again.</p>
        <div class="link-row">
          <code class="url">{fresh}</code>
          <button onclick={() => copyLink(fresh!)}>{copied === fresh ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
    {/if}

    {#each links as i (i.code)}
      {@const dead = status(liveShape(i))}
      <div class="live-link" class:dead={dead.dead}>
        <div>
          <code>{i.code}</code>
          <span class="meta">
            {i.uses}{i.maxUses ? ` of ${i.maxUses}` : ''} used
            {#if dead.dead}· {dead.why}{:else if i.expiresAt}· expires {ago(i.expiresAt)}{/if}
          </span>
        </div>
        <button class="revoke" onclick={() => revoke(i.code)}>Revoke</button>
      </div>
    {:else}
      <p class="sub">No links yet.</p>
    {/each}
  </section>
{:else}
<p class="lede">
  A link is the only way in — {space.name} is
  {space.visibility === 'public' ? 'listed in the directory as well' : 'not listed anywhere'}.
  The half after the <code>#</code> is key material: your browser keeps it, the
  server never sees it, and it is what lets whoever follows the link decrypt
  their way in.
</p>

<section>
  <h3>New link</h3>
  {#if !mayInvite}
    <p class="locked" role="status">
      <Icon name="lock" size={15} />
      <span>You can’t make invites here because you don’t have Create invites.</span>
    </p>
  {:else}
    <div class="opts">
      <div class="opt">
        <span class="lbl">Uses</span>
        <div class="seg">
          {#each ['1', '10', '∞'] as u (u)}
            <button class:sel={uses === u} onclick={() => (uses = u as typeof uses)}>{u}</button>
          {/each}
        </div>
      </div>
      <div class="opt">
        <span class="lbl">Expires</span>
        <div class="seg">
          {#each [['1', '1 day'], ['7', '7 days'], ['30', '30 days'], ['never', 'Never']] as [v, l] (v)}
            <button class:sel={days === v} onclick={() => (days = v as typeof days)}>{l}</button>
          {/each}
        </div>
      </div>
    </div>

    <label class="hist">
      <input type="checkbox" bind:checked={history} />
      <span>
        <b>Let them read what was said before they arrived</b>
        <span class="sub">
          {#if history}
            The link carries the keys to the history too. Whoever uses it can
            read everything in the rooms they can see, back to the beginning.
          {:else}
            They will be able to read messages sent from the moment they join,
            and nothing before it.
          {/if}
        </span>
      </span>
    </label>

    <button class="make" onclick={make}><Icon name="plus" size={15} /> Create link</button>
  {/if}
</section>

<section>
  <h3>Active links</h3>
  {#each space.invites as i (i.code)}
    {@const st = status(i)}
    {@const by = core.faces[i.byFaceId]}
    <div class="invite" class:dead={st.dead}>
      <div class="row1">
        <code class="link">
          revel.chat/i/{i.code}<span class="frag">#{i.key}</span>
        </code>
        <button class="icon" onclick={() => copy(i.code, i.key)} aria-label="Copy link">
          <Icon name={copied === i.code ? 'check' : 'copy'} size={15} />
        </button>
        <button class="icon bad" onclick={() => core.revokeInvite(i.code)} aria-label="Revoke link">
          <Icon name="trash" size={15} />
        </button>
      </div>
      <div class="row2">
        {#if by}<Avatar face={by} size={18} />{/if}
        <span>{by?.name ?? 'Someone'} · {ago(i.createdAt)}</span>
        <span class="sep">·</span>
        <span>
          {i.uses}
          {#if i.maxUses !== undefined}of {i.maxUses}{/if}
          {i.uses === 1 ? 'use' : 'uses'}
        </span>
        <span class="sep">·</span>
        <span>{i.history ? 'with history' : 'from now on'}</span>
        {#if st.dead}<span class="dead-tag">{st.why}</span>{/if}
      </div>
    </div>
  {:else}
    <p class="empty">No links. Nobody can get in until there is one.</p>
  {/each}
</section>

<section>
  <h3>What a leaked link costs</h3>
  <p class="sub wide">
    Anyone holding the whole link can join, because the key is in it — that is
    the trade for the server not being able to open it. Revoking one here stops
    it working immediately; people who already joined stay, because they are
    members now rather than guests of a link.
  </p>
</section>

{/if}

<style>
  .by-name { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 24px; }
  .by-name input {
    flex: 1; min-width: 160px; font: inherit; font-size: var(--text-sm);
    padding: 8px 11px; min-height: var(--tap); border-radius: var(--r-sm);
    border: 1px solid var(--line); background: var(--ground-0); color: var(--text);
  }
  .by-name button {
    font: inherit; font-size: var(--text-sm); font-weight: 600; cursor: pointer;
    padding: 0 14px; min-height: var(--tap); border: 0; border-radius: var(--r-sm);
    background: var(--accent); color: var(--on-accent);
  }
  .by-name button:disabled { opacity: .5; cursor: default; }
  .by-name .note {
    flex-basis: 100%; margin: 0; font-size: var(--text-xs); color: var(--text-mute);
  }
  .make {
    font: inherit; font-size: var(--text-sm); font-weight: 600; cursor: pointer;
    padding: 0 14px; min-height: var(--tap); border: 0; border-radius: var(--r-sm);
    background: var(--accent); color: var(--on-accent); margin: 4px 0 18px;
  }
  .make:disabled { opacity: .5; cursor: default; }
  .fresh {
    margin: 0 0 20px; padding: 14px 16px; border-radius: var(--r-md);
    border: 1px solid var(--line); background: var(--ground-2);
  }
  .fresh .lbl { margin: 0 0 8px; font-size: var(--text-xs); color: var(--text-dim); }
  .link-row { display: flex; gap: 8px; align-items: center; }
  .url {
    flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap;
    font-family: var(--font-mono); font-size: var(--text-xs);
    background: var(--ground-0); padding: 8px 10px; border-radius: var(--r-sm);
  }
  .link-row button {
    font: inherit; font-size: var(--text-sm); font-weight: 600; cursor: pointer;
    padding: 0 12px; min-height: 34px; border: 0; border-radius: var(--r-sm);
    background: var(--accent); color: var(--on-accent);
  }
  .live-link {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 11px 0; border-top: 1px solid var(--line);
  }
  .live-link.dead { opacity: .55; }
  .live-link code { font-family: var(--font-mono); font-size: var(--text-sm); }
  .live-link .meta { margin-left: 10px; font-size: var(--text-xs); color: var(--text-mute); }
  .revoke {
    font: inherit; font-size: var(--text-sm); cursor: pointer;
    padding: 0 11px; min-height: 32px; border-radius: var(--r-sm);
    border: 1px solid var(--line); background: transparent; color: var(--text-dim);
  }
  .revoke:hover { color: var(--danger); border-color: var(--danger); }
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 24px; font-size: var(--text-sm); max-width: 62ch; line-height: 1.6; }
  .lede code { font-family: var(--font-mono); color: var(--text-dim); }
  section { margin-bottom: 30px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 10px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); line-height: 1.55; display: block; }
  .sub.wide { max-width: 62ch; }

  .locked {
    display: flex; align-items: flex-start; gap: 9px; padding: 11px 13px;
    border-radius: var(--r-md); font-size: var(--text-sm); line-height: 1.5;
    color: var(--text-dim); background: var(--ground-2);
    border: 1px solid color-mix(in oklab, var(--face-gold) 40%, var(--line));
  }
  .locked :global(svg) { flex: none; margin-top: 2px; color: var(--face-gold); }

  .opts { display: flex; flex-wrap: wrap; gap: 18px; margin-bottom: 14px; }
  .opt { display: flex; align-items: center; gap: 10px; }
  .lbl { font-size: var(--text-sm); font-weight: 600; }
  .seg { display: inline-flex; gap: 2px; background: var(--ground-2); padding: 3px; border-radius: var(--r-pill); }
  .seg button {
    border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 700; padding: 6px 13px;
    border-radius: var(--r-pill); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .seg button:hover { color: var(--text); }
  .seg button.sel { background: var(--brand); color: #fff; }

  .hist { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; margin-bottom: 16px; }
  .hist input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--face-mint); cursor: pointer; flex: none; }
  .hist b { display: block; font-weight: 600; font-size: var(--text-sm); margin-bottom: 3px; }
  .hist .sub { max-width: 56ch; }

  .make {
    display: inline-flex; align-items: center; gap: 7px;
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 700;
    background: var(--brand); color: #fff; padding: 9px 16px;
    border-radius: var(--r-pill); min-height: var(--tap);
  }
  .make:hover { filter: brightness(1.07); }

  .invite { padding: 11px 0; border-bottom: 1px solid var(--line); }
  .invite.dead { opacity: .55; }
  .row1 { display: flex; align-items: center; gap: 6px; }
  .link {
    flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12px;
    color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-sm); padding: 7px 10px;
  }
  /* The fragment gets its own colour because it is a different kind of thing:
     everything before the # is public, everything after it is a secret that
     never leaves the browser. */
  .frag { color: var(--face-mint); }
  .icon {
    flex: none; border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
    width: 30px; height: 30px; border-radius: var(--r-sm); display: grid; place-items: center;
    min-width: var(--tap); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .icon:hover { background: var(--ground-2); color: var(--text); }
  .icon.bad:hover { color: var(--face-rose); }

  .row2 { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; font-size: 11px; color: var(--text-mute); }
  .sep { opacity: .5; }
  .dead-tag {
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    border: 1px solid var(--face-rose); color: var(--face-rose);
    border-radius: var(--r-xs); padding: 1px 6px;
  }

  .empty { font-size: var(--text-sm); color: var(--text-mute); margin: 0; }
</style>
