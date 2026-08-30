<script lang="ts">
/**
 * Space settings → People (`docs/18`: "members, their roles, search,
 * kick/ban, pending invites").
 *
 * The row is an **account**, not a face. `docs/01` is the reason and it is
 * load-bearing: permissions live on the account, authorship on the face. A
 * plural member has one membership and one set of roles however many faces
 * they speak as, so a member list keyed by face would show one person three
 * times and let you ban a third of them.
 *
 * Kick and ban are hierarchy-checked and say why when they refuse, rather
 * than greying out — same rule as the roles editor, for the same reason.
 */
import Avatar from '$lib/Avatar.svelte';
import { core } from '$lib/fake/core.svelte.js';
import type { Member } from '$lib/fake/data.js';
import { ago } from '$lib/format.js';
import Icon from '$lib/Icon.svelte';
import { wren } from '$lib/wren/wren.svelte.js';
import { rankOf, resolve } from './perms.js';

let query = $state('');
let editing = $state<string | null>(null);

const space = $derived(core.space);
const mine = $derived(core.myMembership);

const me = $derived({
  owner: !!mine?.owner,
  perms: resolve(space, mine?.roles ?? []),
  rank: mine?.owner ? Infinity : rankOf(space, mine?.roles ?? []),
});

const shown = $derived(
  space.members.filter((m) => {
    const f = core.faces[m.faceId];
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (f?.name.toLowerCase().includes(q) ?? false) ||
      m.roles.some((r) => r.toLowerCase().includes(q))
    );
  }),
);

/** Why an action on this member is unavailable, or null if it is fine. */
function refuse(m: Member, need: 'KICK' | 'BAN'): string | null {
  if (m.owner) return 'The owner can’t be removed. Transfer the space first.';
  if (m.accountId === mine?.accountId) return 'That’s you.';
  if (!me.owner && !me.perms.has(need)) {
    return `You can’t ${need === 'KICK' ? 'remove people' : 'ban people'} here.`;
  }
  if (!me.owner && rankOf(space, m.roles) >= me.rank) {
    return `${core.faces[m.faceId]?.name} is at or above your own rank.`;
  }
  return null;
}

function kick(m: Member) {
  const name = core.faces[m.faceId]?.name ?? 'They';
  wren.confirm({
    title: `Remove ${name} from ${space.name}?`,
    body: `They lose access to everything sent from here on. What they already read, they already have — no app can take that back. A new invite lets them return.`,
    confirm: 'Remove them',
    onConfirm: () => core.kick(m.accountId),
  });
}

function ban(m: Member) {
  const name = core.faces[m.faceId]?.name ?? 'They';
  wren.confirm({
    title: `Ban ${name} from ${space.name}?`,
    body: `Same as removing them, and the ban survives a new invite. You can lift it later from Moderation.`,
    confirm: 'Ban them',
    onConfirm: () => core.ban(m.accountId),
  });
}
</script>

<h2>People</h2>
<p class="lede">
  {space.members.length}
  {space.members.length === 1 ? 'member' : 'members'}. One row per person, not
  per face — someone who writes as three of them is still one member with one
  set of roles.
</p>

<div class="search">
  <Icon name="search" size={15} />
  <input type="search" bind:value={query} placeholder="Name or role" aria-label="Search members" />
</div>

{#each shown as m (m.accountId)}
  {@const face = core.faces[m.faceId]}
  {@const roles = core.rolesOf(m.accountId)}
  {@const kickWhy = refuse(m, 'KICK')}
  {@const banWhy = refuse(m, 'BAN')}
  <div class="member" class:open={editing === m.accountId}>
    <div class="who">
      {#if face}<Avatar {face} size={34} />{/if}
      <div class="meta">
        <div class="nm">
          <span style="color: var(--face-{face?.colour ?? 'violet'})">{face?.name ?? m.accountId}</span>
          {#if m.owner}<span class="tag owner">owner</span>{/if}
          {#if face?.agent}
            <!-- The same sentence the roster uses. An agent's badge is a
                 security statement, and it does not get a friendlier version
                 just because this screen is for admins. -->
            <span class="tag agent">{face.agent.label}</span>
          {/if}
          {#if m.accountId === mine?.accountId}<span class="tag you">you</span>{/if}
        </div>
        <div class="sub">
          {#if roles.length}
            {#each roles as r (r.id)}
              <span class="chip" style="--rc: var(--face-{r.colour})">{r.name}</span>
            {/each}
          {:else}
            <span class="none">No roles</span>
          {/if}
          <span class="joined">joined {ago(m.joinedAt)}</span>
        </div>
      </div>
      <button class="more" onclick={() => (editing = editing === m.accountId ? null : m.accountId)} aria-expanded={editing === m.accountId}>
        <Icon name="chevron" size={16} />
      </button>
    </div>

    {#if editing === m.accountId}
      <div class="edit">
        <p class="lbl">Roles</p>
        <div class="picker">
          {#each space.roles as r (r.id)}
            {@const held = m.roles.includes(r.name)}
            {@const blocked = !me.owner && (r.rank >= me.rank || !me.perms.has('MANAGE_ROLES'))}
            <button
              class="role"
              class:on={held}
              disabled={blocked}
              title={blocked ? `${r.name} is at or above your own rank.` : undefined}
              onclick={() => core.toggleMemberRole(m.accountId, r.name)}
            >
              <span class="dot" style="background: var(--face-{r.colour})"></span>
              {r.name}
              {#if held}<Icon name="check" size={13} />{/if}
            </button>
          {/each}
        </div>

        <div class="acts">
          <button class="act" disabled={!!kickWhy} onclick={() => kick(m)}>Remove</button>
          <button class="act bad" disabled={!!banWhy} onclick={() => ban(m)}>Ban</button>
          {#if kickWhy || banWhy}
            <!-- The refusal carries its own reason to where it happens
                 (`docs/18`), rather than a disabled button and a shrug. -->
            <span class="why">{kickWhy ?? banWhy}</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{:else}
  <p class="empty">Nobody matches “{query}”.</p>
{/each}

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 20px; font-size: var(--text-sm); max-width: 60ch; line-height: 1.55; }

  .search {
    display: flex; align-items: center; gap: 9px; margin-bottom: 14px;
    background: var(--ground-2); border: 1px solid var(--line);
    border-radius: var(--r-md); padding: 0 12px;
  }
  .search :global(svg) { color: var(--text-mute); flex: none; }
  .search input {
    flex: 1; background: transparent; border: 0; color: var(--text); font: inherit;
    padding: 10px 0; min-height: var(--tap);
  }
  .search input:focus { outline: none; }
  .search input::-webkit-search-cancel-button { display: none; }

  .member { border-bottom: 1px solid var(--line); }
  .who { display: flex; align-items: center; gap: 11px; padding: 10px 0; }
  .meta { flex: 1; min-width: 0; }
  .nm { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: var(--text-sm); }
  .sub { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 3px; font-size: 11px; }
  .joined { color: var(--text-mute); }
  .none { color: var(--text-mute); font-style: italic; }

  .tag {
    font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
    padding: 1px 6px; border-radius: var(--r-xs); line-height: 1.5;
    border: 1px solid var(--text-mute); color: var(--text-dim);
  }
  .tag.owner { border-color: var(--face-gold); color: var(--face-gold); }
  .tag.you { border-color: var(--brand); color: var(--brand); }

  .chip {
    font-size: 11px; font-weight: 700; color: var(--rc);
    border: 1px solid color-mix(in oklab, var(--rc) 45%, transparent);
    background: color-mix(in oklab, var(--rc) 13%, transparent);
    border-radius: var(--r-pill); padding: 1px 8px;
  }

  .more {
    flex: none; border: 0; background: transparent; color: var(--text-mute); cursor: pointer;
    width: 30px; height: 30px; border-radius: var(--r-sm); display: grid; place-items: center;
    min-width: var(--tap); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease), rotate var(--t-base) var(--ease);
  }
  .more:hover { background: var(--ground-2); color: var(--text); }
  .member.open .more { rotate: 180deg; }

  .edit { padding: 2px 0 14px 45px; }
  .lbl { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--text-mute); margin: 0 0 7px; }
  .picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .role {
    display: inline-flex; align-items: center; gap: 7px;
    border: 1px solid var(--line); background: transparent; color: var(--text-mute);
    cursor: pointer; font: inherit; font-size: 12px; font-weight: 700;
    padding: 6px 11px; border-radius: var(--r-pill); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
  }
  .role:hover:not(:disabled) { color: var(--text); background: var(--ground-2); }
  .role.on { color: var(--text); border-color: var(--brand); background: color-mix(in oklab, var(--brand) 18%, transparent); }
  .role:disabled { opacity: .4; cursor: default; }
  .role .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }

  .acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .act {
    border: 1px solid var(--line); background: transparent; color: var(--text-dim);
    cursor: pointer; font: inherit; font-size: 12px; font-weight: 700;
    padding: 7px 14px; border-radius: var(--r-pill); min-height: var(--tap);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
  }
  .act:hover:not(:disabled) { background: var(--ground-2); color: var(--text); }
  .act.bad:hover:not(:disabled) { color: var(--face-rose); border-color: var(--face-rose); }
  .act:disabled { opacity: .38; cursor: default; }
  .why { font-size: 12px; color: var(--text-mute); }

  .empty { font-size: var(--text-sm); color: var(--text-mute); padding: 18px 0; }
</style>
