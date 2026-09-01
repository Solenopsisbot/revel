<script lang="ts">
/**
 * Space settings → Moderation (`docs/18` §Moderation).
 *
 * The doc's first line is the one the screen has to earn: "everything mods
 * can do, they can do because they're members who can read the room. There
 * is no god view, and the moderation tab says so once." So it says so once,
 * at the top, and then never mentions it again.
 *
 * A queue that can show a reported message under E2EE looks impossible until
 * you know about **franking** (`docs/03` §9): the reporter's client opens
 * that one event with a commitment proving it is genuine. So a mod sees the
 * message and can trust it was not fabricated, *without* gaining access to
 * anything else — and without the server ever having been able to read it.
 * That is a strange enough mechanism that the screen explains it rather than
 * letting it look like a back door.
 *
 * `docs/18` also asks for one line about there being no automod. It is here
 * for the honest reason: there is nothing to scan.
 */
import Avatar from '$lib/Avatar.svelte';
import { core } from '$lib/fake/core.svelte.js';
import type { Report } from '$lib/fake/data.js';
import { ago } from '$lib/format.js';
import Icon from '$lib/Icon.svelte';
import { wren } from '$lib/wren/wren.svelte.js';
import { resolve } from './perms.js';

const space = $derived(core.space);
const mine = $derived(core.myMembership);
const perms = $derived(resolve(space, mine?.roles ?? []));
const owner = $derived(!!mine?.owner);

const mayRemove = $derived(owner || perms.has('MANAGE_EVENTS'));

$effect(() => {
  if (!core.demo) void core.refreshBans();
});
const mayBan = $derived(owner || perms.has('BAN'));

function roomName(id: string) {
  return space.rooms.find((r) => r.id === id)?.name ?? id;
}

function remove(r: Report) {
  wren.confirm({
    title: 'Remove this message?',
    body: `It disappears from everyone's app and the server is asked to forget the bytes. People who already read it may have kept it — that part no app can fix.`,
    confirm: 'Remove it',
    onConfirm: () => core.removeReported(r),
  });
}
</script>

<h2>Moderation</h2>
<p class="lede">
  Everything here you can do because you are a member who can read these rooms.
  There is no view of this space that sees more than you do, including ours.
</p>

{#if !core.demo}
  <section>
    <h3>Banned</h3>
    {#each core.bansSeen as b (b.account)}
      <div class="banned">
        <div class="meta">
          <div class="nm">{core.memberName(b.account)}</div>
          <div class="bl">
            by {core.memberName(b.by)} · {ago(b.at)}{#if b.reason} · {b.reason}{/if}
          </div>
        </div>
        <button class="act" onclick={() => core.unban(b.account)}>Lift</button>
      </div>
    {:else}
      <p class="none">Nobody.</p>
    {/each}
    <p class="sub">
      A ban is a removal that sticks: every way back in checks it, including an
      invite link. Lifting one lets them return — it doesn’t bring them back,
      because somebody still has to invite them.
    </p>
  </section>

  <section>
    <h3>Reports</h3>
    <!-- Franking is the piece this waits on (`docs/03` §9): a report has to
         carry proof that the quoted message is genuine, or a queue is a place
         to paste anything you like about somebody. -->
    <p class="soon">
      <Icon name="lock" size={15} />
      <span>
        Reporting isn’t built yet. When it is, a report will carry cryptographic
        proof of the message it quotes — so you can trust what you are reading
        without gaining access to anything else in the room.
      </span>
    </p>
  </section>
{:else}

<section>
  <h3>Reports</h3>
  {#each space.reports as r (r.id)}
    {@const author = core.faces[r.authorFaceId]}
    {@const by = core.faces[r.byFaceId]}
    <div class="report">
      <div class="quoted">
        {#if author}<Avatar face={author} size={26} />{/if}
        <div class="q">
          <span class="who" style="color: var(--face-{author?.colour ?? 'violet'})">{author?.name ?? 'Someone'}</span>
          <span class="body">{r.body}</span>
        </div>
      </div>
      <div class="meta">
        <span>in <b>#{roomName(r.roomId)}</b></span>
        <span class="sep">·</span>
        <span>reported by {by?.name ?? 'someone'} {ago(r.at)}</span>
        <span class="sep">·</span>
        <span>{r.reason}</span>
      </div>
      <div class="acts">
        <button class="act" onclick={() => core.dismissReport(r.id)}>Dismiss</button>
        <button class="act bad" disabled={!mayRemove} onclick={() => remove(r)}>Remove message</button>
        {#if !mayRemove}
          <span class="why">You don’t have Delete and purge messages.</span>
        {/if}
      </div>
    </div>
  {:else}
    <p class="empty">Nothing reported.</p>
  {/each}

  <p class="how">
    <Icon name="shield" size={15} />
    <span>
      You can read the message above because the person reporting it handed you
      that one message with proof it is real — not because anyone has a copy of
      this space lying around. The server never could read it and still can't.
    </span>
  </p>
</section>

<section>
  <h3>Bans</h3>
  {#each space.bans as b (b.accountId)}
    {@const face = core.faces[b.faceId]}
    <div class="ban">
      <div class="who-row">
        {#if face}<Avatar {face} size={26} />{/if}
        <div class="meta-col">
          <b>{face?.name ?? b.accountId}</b>
          <span class="meta">
            banned by {core.faces[b.byFaceId]?.name ?? 'someone'} {ago(b.at)}
            {#if b.reason}· {b.reason}{/if}
          </span>
        </div>
        <button class="act" disabled={!mayBan} onclick={() => core.unban(b.accountId)}>Lift</button>
      </div>
    </div>
  {:else}
    <p class="empty">Nobody is banned.</p>
  {/each}
  <p class="sub">A ban survives a new invite. Lifting one does not bring them back — they need a link again.</p>
</section>

<section>
  <h3>Purges</h3>
  {#each space.purges as p (p.id)}
    <div class="purge">
      <div class="meta-col">
        <b>{p.count} {p.count === 1 ? 'message' : 'messages'} in #{roomName(p.roomId)}</b>
        <span class="meta">{core.faces[p.byFaceId]?.name ?? 'Someone'} · {ago(p.at)} · {p.reason}</span>
      </div>
    </div>
  {:else}
    <p class="empty">Nothing has been purged.</p>
  {/each}
  <p class="sub">
    A purge deletes the bytes on the server and tells every app to drop its copy.
    <b>People who already read something may have kept it</b>, and no amount of
    deleting changes that.
  </p>
</section>

<section>
  <h3>Automatic moderation</h3>
  <p class="sub wide">
    There isn't any, and there can't be: the server holds ciphertext, so there
    is nothing on it to scan. Anything that reads this space in order to judge
    it has to be an agent that holds the keys — which means it appears in the
    member list like every other key-holder, every time, with no exceptions.
  </p>
</section>

{/if}

<style>
  .banned {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 0; border-top: 1px solid var(--line);
  }
  .banned .meta { flex: 1; min-width: 0; }
  .banned .nm { font-weight: 600; font-size: var(--text-sm); }
  .banned .bl { font-size: var(--text-xs); color: var(--text-mute); }
  .none { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 10px; }
  .soon {
    display: flex; gap: 10px; align-items: flex-start; max-width: 62ch;
    margin: 0; padding: 12px 14px; border-radius: var(--r-md);
    border: 1px solid var(--line); background: var(--ground-2);
    font-size: var(--text-sm); color: var(--text-mute); line-height: 1.55;
  }
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 24px; font-size: var(--text-sm); max-width: 62ch; line-height: 1.6; }
  section { margin-bottom: 30px; }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 10px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); line-height: 1.55; margin: 10px 0 0; }
  .sub.wide { max-width: 62ch; }
  .empty { font-size: var(--text-sm); color: var(--text-mute); margin: 0; }

  .report { border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px 14px; margin-bottom: 10px; }
  .quoted { display: flex; gap: 10px; align-items: flex-start; }
  .q { min-width: 0; font-size: var(--text-sm); line-height: 1.5; }
  .who { font-weight: 700; margin-right: 7px; }
  .body { color: var(--text-dim); }
  .meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; font-size: 11px; color: var(--text-mute); }
  .sep { opacity: .5; }

  .acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 11px; }
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

  .how {
    display: flex; align-items: flex-start; gap: 10px; margin: 14px 0 0;
    padding: 12px 14px; border-radius: var(--r-md);
    background: color-mix(in oklab, var(--face-mint) 9%, transparent);
    border-left: 3px solid var(--face-mint);
    font-size: var(--text-sm); line-height: 1.6; color: var(--text-dim); max-width: 62ch;
  }
  .how :global(svg) { flex: none; margin-top: 2px; color: var(--face-mint); }

  .ban, .purge { padding: 10px 0; border-bottom: 1px solid var(--line); }
  .who-row { display: flex; align-items: center; gap: 10px; }
  .meta-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .meta-col b { font-size: var(--text-sm); font-weight: 600; }
</style>
