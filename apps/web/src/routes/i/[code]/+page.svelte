<script lang="ts">
/**
 * Following an invite link. `docs/18` §Joining, `docs/03` §4.
 *
 * The URL is `revel.chat/i/<code>#<key>`, and the fragment is the whole trick:
 * browsers never put it in a request, so the private half of the invite key
 * reaches this page and reaches nothing else. Everything here is arranged so
 * that stays true.
 *
 * Two things this page deliberately cannot tell you:
 *
 *   * **What the space is called.** That is an encrypted event and the Host has
 *     never been told it (`docs/04` §1). A preview that named the space would
 *     mean the Host knew the name, so the honest version is a member count and
 *     the promise that you will see the rest once you are in.
 *   * **What was said before you arrived.** MLS keys move forward, so the join
 *     starts at the current epoch. `docs/18` asks for that sentence at the one
 *     moment anyone cares, which is here.
 */

import { goto } from '$app/navigation';
import { page } from '$app/state';
import Button from '$lib/moment/Button.svelte';
import Moment from '$lib/moment/Moment.svelte';
import { session } from '$lib/session.svelte.js';
import { previewInvite, readStash, stashInvite } from '$lib/invite.js';
import type { InvitePreview } from '@revel/protocol';

const code = $derived(page.params.code ?? '');

let secret = $state('');
let preview = $state<InvitePreview | null>(null);
let looking = $state(true);

/**
 * Whether anybody is signed in here.
 *
 * `session.restore()` is what answers, and only `/app` used to call it — so
 * this page showed "you'll need an account first" to somebody who already had
 * one, and the Join button never appeared. Restoring is cheap: it reads a
 * device key off disk and starts no crypto.
 */
let known = $state(false);
$effect(() => {
  void session.restore().then(() => (known = true));
});

/**
 * Take the key out of the URL, once, before anything else.
 *
 * Stashed in `sessionStorage` so it survives the round trip through sign-up,
 * and **stripped from the address bar** in the same breath: a fragment sits in
 * history, in a screenshot and in whatever the browser syncs between devices,
 * and this one is a credential. `replaceState` rather than `goto` — SvelteKit
 * owns history, and a navigation here would remount the page and lose the
 * value we just read.
 */
$effect(() => {
  if (!code) return;
  const fragment = location.hash.replace(/^#/, '');
  if (fragment) {
    stashInvite(code, fragment);
    history.replaceState(history.state, '', location.pathname + location.search);
  }
  secret = fragment || readStash(code) || '';
});

$effect(() => {
  if (!code) return;
  looking = true;
  void previewInvite(code)
    .then((found) => {
      preview = found;
      looking = false;
    })
    .catch(() => {
      preview = null;
      looking = false;
    });
});

/** Whether the link is one that can still be used. */
const usable = $derived(preview?.status === 'ok' && !!secret);

/**
 * Hand the join to `/app`.
 *
 * Redeeming needs a running core, and starting one means the crypto worker,
 * the device store and a socket — the whole bootstrap `/app` already does and
 * this page has no other use for. So the page that has the *words* shows the
 * words, and the page that has the *stack* does the work: `?join=<code>` picks
 * the key back out of the stash on the other side.
 */
function join() {
  void goto(`/app?join=${encodeURIComponent(code)}`);
}
</script>

<svelte:head><title>Join a space — Revel</title></svelte:head>

<Moment pose={preview?.status === 'ok' ? 'warm' : 'serious'}>
  <div class="pane">
    <p class="eyebrow">Invitation</p>

    {#if looking}
      <h1>Checking the link…</h1>
    {:else if !preview}
      <h1>This link doesn't work.</h1>
      <p class="lede">
        It may have been revoked, or it may never have been real. Ask whoever
        sent it to you for a new one.
      </p>
    {:else if !secret}
      <h1>Half the link is missing.</h1>
      <p class="lede">
        The part after the <code>#</code> is the part that actually lets you in,
        and it isn't here. Some apps cut a link short when they preview it —
        try copying it from the message rather than tapping it.
      </p>
    {:else if preview.status === 'expired'}
      <h1>This link has expired.</h1>
      <p class="lede">Ask whoever sent it to you for a new one.</p>
    {:else if preview.status === 'used_up'}
      <h1>This link has been used up.</h1>
      <p class="lede">
        It was set to work a fixed number of times, and it has. Ask for another.
      </p>
    {:else}
      <h1>
        {#if preview.invitedBy}
          {preview.invitedBy} invited you.
        {:else}
          You've been invited.
        {/if}
      </h1>
      <p class="lede">
        {preview.members}
        {preview.members === 1 ? 'person is' : 'people are'} in this space.
        We can't tell you its name — it's encrypted, and the server has never
        been told what it is. You'll see it the moment you're in.
      </p>

      <!-- `docs/18`: the history-mode sentence, said once, at the only moment
           anyone cares about it. -->
      <p class="what">
        You'll be able to read messages sent from now on. Everything said before
        today stays unreadable to you — it was encrypted to a group you weren't
        in yet, and no one can undo that after the fact.
      </p>
    {/if}

    {#if usable && known}
      {#if session.signedIn}
        <Button onclick={join}>Join</Button>
      {:else}
        <p class="lede">You'll need an account first. The invite will be waiting.</p>
        <div class="ways">
          <Button onclick={() => goto(`/signup?next=${encodeURIComponent(`/i/${code}`)}`)}>
            Make an account
          </Button>
          <Button
            variant="secondary"
            onclick={() => goto(`/signin?next=${encodeURIComponent(`/i/${code}`)}`)}
          >
            I already have one
          </Button>
        </div>
      {/if}
    {:else if !looking && !usable}
      <Button variant="secondary" onclick={() => goto('/')}>Back to Revel</Button>
    {/if}
  </div>
</Moment>

<style>
  .pane { animation: enter var(--t-slow) var(--ease); max-width: 34rem; }
  @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .eyebrow {
    font-size: var(--text-sm); font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: color-mix(in oklab, var(--text) 62%, transparent); margin: 0;
  }
  h1 {
    font-family: var(--font-display); font-size: var(--display-3); line-height: .98;
    letter-spacing: -.035em; font-weight: 600; margin: 10px 0 18px;
  }
  .lede { color: color-mix(in oklab, var(--text) 84%, transparent); margin: 0 0 22px; line-height: 1.6; }
  .what {
    background: rgba(0, 0, 0, .2); border-radius: var(--r-md); padding: 14px 16px;
    border: 1px solid color-mix(in oklab, var(--text) 12%, transparent);
    font-size: var(--text-sm); line-height: 1.6; margin: 0 0 24px;
    color: color-mix(in oklab, var(--text) 82%, transparent);
  }
  code {
    font-family: var(--font-mono); font-size: .92em;
    background: rgba(0, 0, 0, .25); padding: 1px 5px; border-radius: var(--r-xs);
  }
  .ways { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
