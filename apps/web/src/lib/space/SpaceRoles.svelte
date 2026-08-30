<script lang="ts">
/**
 * Space settings → Roles (`docs/18` §"Roles and permissions").
 *
 * "The editor is a list of permissions with toggles, grouped, with a plain
 * sentence under each rather than a bare flag name. Hierarchy is enforced
 * and *explained* at the point of failure."
 *
 * Both halves of that sentence are the design. The sentences live in
 * `perms.ts` and are the reason the screen is worth having — `MANAGE_AGENTS`
 * tells an admin nothing, and an admin guessing about who holds keys is the
 * failure this product cannot afford. The explanations live on the refusal
 * itself: every disabled control here can say why, because "greying out
 * mysteriously" is what the doc names as the thing not to do.
 *
 * `VIEW` is absent on purpose. See `perms.ts`.
 */

import { core } from '$lib/fake/core.svelte.js';
import Icon from '$lib/Icon.svelte';
import { canEditRole, canGrant, PERM_GROUPS, rankOf, resolve } from './perms.js';

const space = $derived(core.space);
const mine = $derived(core.myMembership);

const me = $derived({
  owner: !!mine?.owner,
  perms: resolve(space, mine?.roles ?? []),
  rank: mine?.owner ? Infinity : rankOf(space, mine?.roles ?? []),
});

let selected = $state<string | null>(null);
const role = $derived(space.roles.find((r) => r.id === selected) ?? space.roles[0]);
const gate = $derived(
  role ? canEditRole(space, role, me) : { ok: false as const, why: 'No roles yet.' },
);

/** Everyone carrying this role, for the "who does this affect" line. */
const holders = $derived(role ? space.members.filter((m) => m.roles.includes(role.name)) : []);

const isAdmin = $derived(!!role?.perms.includes('ADMINISTRATOR'));
</script>

<h2>Roles</h2>
<p class="lede">
  A role is a bundle of permissions you hand to people. What it can<em>n't</em>
  do is decide who can read a room — that is the audience, and it is a
  different kind of thing.
</p>

<div class="tabs" role="tablist" aria-label="Roles">
  {#each space.roles as r (r.id)}
    <button
      role="tab"
      aria-selected={role?.id === r.id}
      class:sel={role?.id === r.id}
      onclick={() => (selected = r.id)}
    >
      <span class="dot" style="background: var(--face-{r.colour})"></span>
      {r.name}
    </button>
  {/each}
</div>

{#if role}
  <p class="who">
    {holders.length}
    {holders.length === 1 ? 'person has' : 'people have'} this role{#if holders.length}:
      {holders.map((m) => core.faces[m.faceId]?.name ?? m.accountId).join(', ')}{/if}.
  </p>

  {#if !gate.ok}
    <p class="locked" role="status">
      <Icon name="lock" size={15} />
      <span>{gate.why}</span>
    </p>
  {:else if me.owner}
    <p class="note">
      You own {space.name}, so nothing here is locked to you. For everyone else,
      a role can only be edited from above it, and a permission can only be
      granted by someone who already has it.
    </p>
  {/if}

  {#if isAdmin}
    <p class="note admin">
      <Icon name="warn" size={15} />
      <span>
        Administrator is on, so every switch below is on and will stay on. That
        is what the switch means — including permissions that do not exist yet.
      </span>
    </p>
  {/if}

  {#each PERM_GROUPS as group (group.name)}
    <section>
      <h3>{group.name}</h3>
      {#if group.note}<p class="sub">{group.note}</p>{/if}
      {#each group.perms as perm (perm.id)}
        {@const held = role.perms.includes(perm.id)}
        {@const implied = isAdmin && perm.id !== 'ADMINISTRATOR'}
        {@const grant = canGrant(perm, me)}
        {@const blocked = !gate.ok || implied || (!held && !grant.ok)}
        <label class="perm" class:heavy={perm.heavy} class:off={blocked}>
          <input
            type="checkbox"
            checked={held || implied}
            disabled={blocked}
            onchange={() => core.toggleRolePerm(role.id, perm.id)}
          />
          <span class="body">
            <b>{perm.name}</b>
            <span class="blurb">{perm.blurb}</span>
            {#if implied}
              <span class="reason">Included in Administrator.</span>
            {:else if !held && !grant.ok && gate.ok}
              <span class="reason">{grant.why}</span>
            {/if}
          </span>
        </label>
      {/each}
    </section>
  {/each}

  <section>
    <h3>Seeing rooms</h3>
    <!-- The most important row on this screen is the one that is not a
         toggle. `docs/04`: the actual gate is key possession. A "can view"
         switch would look like the thing keeping people out while the thing
         keeping people out is the audience — the single most misleading
         control we could ship. -->
    <div class="view">
      <Icon name="key" size={16} />
      <div>
        <b>Not a permission.</b>
        <span>
          Whether someone can read a room is decided by that room's audience,
          because reading it means holding its keys. No role can grant that and
          no role can take it away — it is set when the room is made, over in
          <b>Who can see what</b>.
        </span>
      </div>
    </div>
  </section>
{/if}

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 18px; font-size: var(--text-sm); max-width: 60ch; line-height: 1.55; }
  section { margin-bottom: 26px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 10px; line-height: 1.5; }

  .tabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 14px; }
  .tabs button {
    display: inline-flex; align-items: center; gap: 8px;
    border: 1px solid var(--line); background: transparent; color: var(--text-mute);
    cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 700;
    padding: 7px 14px; border-radius: var(--r-pill); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
  }
  .tabs button:hover { color: var(--text); background: var(--ground-2); }
  .tabs button.sel { color: var(--text); border-color: var(--brand); background: color-mix(in oklab, var(--brand) 18%, transparent); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }

  .who { font-size: var(--text-sm); color: var(--text-dim); margin: 0 0 14px; line-height: 1.5; }

  .locked, .note {
    display: flex; align-items: flex-start; gap: 9px; margin: 0 0 18px;
    padding: 11px 13px; border-radius: var(--r-md);
    font-size: var(--text-sm); line-height: 1.55; color: var(--text-dim);
    background: var(--ground-2); border: 1px solid var(--line);
  }
  .locked { border-color: color-mix(in oklab, var(--face-gold) 40%, var(--line)); }
  .locked :global(svg) { flex: none; margin-top: 2px; color: var(--face-gold); }
  .note.admin { border-color: color-mix(in oklab, var(--face-rose) 40%, var(--line)); }
  .note.admin :global(svg) { flex: none; margin-top: 2px; color: var(--face-rose); }

  .perm { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; padding: 9px 0; }
  .perm input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--face-mint); cursor: pointer; flex: none; }
  .perm.off { cursor: default; }
  .perm.off .body { opacity: .55; }
  .perm .body { min-width: 0; }
  .perm b { display: block; font-weight: 600; font-size: var(--text-sm); margin-bottom: 2px; }
  /* Warmer, never blocked: these are the ones worth a second look before you
     hand them out, and a warning that stops you is a warning people learn to
     click through. */
  .perm.heavy b { color: var(--face-gold); }
  .blurb { display: block; color: var(--text-mute); font-size: var(--text-sm); line-height: 1.5; max-width: 56ch; }
  .reason { display: block; margin-top: 4px; font-size: 12px; color: var(--face-gold); }

  .view {
    display: flex; align-items: flex-start; gap: 11px;
    padding: 13px 15px; border-radius: var(--r-md);
    background: color-mix(in oklab, var(--face-mint) 9%, transparent);
    border-left: 3px solid var(--face-mint);
  }
  .view :global(svg) { flex: none; margin-top: 2px; color: var(--face-mint); }
  .view b { font-weight: 700; font-size: var(--text-sm); display: block; margin-bottom: 3px; }
  .view span { color: var(--text-dim); font-size: var(--text-sm); line-height: 1.6; }
  .view span b { display: inline; }
</style>
