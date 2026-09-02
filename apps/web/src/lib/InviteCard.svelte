<script lang="ts">
/**
 * An invite link, rendered as the thing it is.
 *
 * `docs/03` is explicit that **the server never fetches a link** — asking it to
 * unfurl a URL is asking it what you posted. An invite to a space on this Host
 * is the one exception that isn't one: the code is minted by this Host, and
 * `/invites/<code>` is unauthenticated precisely so somebody with no account
 * can read it. Nothing is being disclosed that the Host does not already hold.
 *
 * What it still cannot say is **the name of the space** — that is an encrypted
 * event and the Host has never been told it (`docs/04` §1). So the card says
 * who invited you and how many people are there, which is exactly what the
 * `/i/<code>` page says, for the same reason.
 *
 * The fragment never leaves this component. It travels in the href, which the
 * browser does not send, and it is not in the preview request.
 */
import Icon from './Icon.svelte';
import { previewInvite } from './invite.js';
import type { InvitePreview } from '@revel/protocol';

let { code, url }: { code: string; url: string } = $props();

let preview = $state<InvitePreview | null>(null);
let looking = $state(true);

$effect(() => {
  let live = true;
  looking = true;
  previewInvite(code)
    .then((found) => {
      if (live) preview = found;
    })
    .catch(() => {
      // A link that cannot be previewed still renders in the body above this,
      // so the failure costs a card rather than the message.
      if (live) preview = null;
    })
    .finally(() => {
      if (live) looking = false;
    });
  return () => {
    live = false;
  };
});

const dead = $derived(preview && preview.status !== 'ok');
</script>

{#if looking}
  <div class="invite quiet"><Icon name="key" size={15} /><span>Checking an invite…</span></div>
{:else if preview}
  <a class="invite" class:dead href={url}>
    <span class="tag"><Icon name="key" size={13} /> Invitation</span>
    <span class="who">
      {#if preview.invitedBy}{preview.invitedBy} invited you.{:else}You've been invited.{/if}
    </span>
    {#if dead}
      <span class="blurb">
        {preview.status === 'expired'
          ? 'This link has expired.'
          : preview.status === 'used_up'
            ? 'This link has been used up.'
            : 'This link has been revoked.'}
      </span>
    {:else}
      <span class="blurb">
        {preview.members}
        {preview.members === 1 ? 'person is' : 'people are'} in this space. Its name is
        encrypted, so nobody can show it to you until you're in.
      </span>
      <span class="go">Open the invitation</span>
    {/if}
  </a>
{/if}

<style>
  .invite {
    display: flex; flex-direction: column; gap: 3px;
    margin-top: 8px; padding: 10px 13px; max-width: 420px;
    border: 1px solid var(--line); border-left: 3px solid var(--brand);
    border-radius: var(--r-sm); background: var(--ground-2);
    text-decoration: none; color: inherit;
    transition: background var(--t-fast) var(--ease);
  }
  a.invite:hover { background: var(--ground-3); }
  .invite.dead { border-left-color: var(--text-mute); opacity: .75; }
  .quiet { color: var(--text-mute); flex-direction: row; align-items: center; gap: 8px; font-size: var(--text-sm); }
  .tag {
    display: flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
    color: var(--brand);
  }
  .who { font-weight: 600; font-size: var(--text-sm); }
  .blurb { font-size: var(--text-sm); color: var(--text-dim); line-height: 1.45; }
  .go { margin-top: 4px; font-size: var(--text-sm); font-weight: 600; color: var(--brand); }
</style>
