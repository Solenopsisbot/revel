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
  import Icon from '$lib/Icon.svelte';
  import { core } from '$lib/fake/core.svelte.js';
  import { ago } from '$lib/format.js';
  import { resolve } from './perms.js';

  const space = $derived(core.space);
  const mine = $derived(core.myMembership);
  const mayInvite = $derived(!!mine?.owner || resolve(space, mine?.roles ?? []).has('INVITE'));

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
    if (i.expiresAt !== undefined && i.expiresAt < Date.now()) return { dead: true, why: `Expired ${ago(i.expiresAt)}` };
    return { dead: false, why: '' };
  }
</script>

<h2>Invites</h2>
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

<style>
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
