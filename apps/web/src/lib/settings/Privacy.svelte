<script lang="ts">
/**
 * Settings → Privacy & safety (`docs/19`).
 *
 * Read receipts and typing indicators live here rather than under Appearance
 * on purpose: they are **disclosures about you**, not preferences about the
 * app. Filing them next to theme and density would frame telling other
 * people when you read their message as a matter of taste.
 *
 * The screen also has to be honest about the limit of every control on it.
 * Turning off receipts stops your client sending them; it cannot stop anyone
 * from noticing you replied. Blocking stops delivery to you; it does not
 * reach into rooms you share and unsay anything. Both are said plainly
 * rather than left for someone to discover.
 */

import { core } from '$lib/fake/core.svelte.js';
import Icon from '$lib/Icon.svelte';

const REACH = [
  { id: 'anyone', label: 'Anyone' },
  { id: 'shared-spaces', label: 'People in my spaces' },
  { id: 'nobody', label: 'Nobody' },
] as const;

const p = $derived(core.privacy);

function unblock(handle: string) {
  p.blocked = p.blocked.filter((b) => b.handle !== handle);
}
</script>

<h2>Privacy &amp; safety</h2>
<p class="lede">
  Who can reach you, and what your client tells other people about you. The
  server can't read any of your messages either way — these are about the
  people in the room, not about us.
</p>

{#if !core.demo}
  <!--
    The four controls below are real settings with no enforcement behind them
    yet: who may DM you and who may add you to a space are Host policy, and
    read receipts, typing and presence are events this client sends. Both
    halves are specified (`docs/19`) and neither is wired, so the switches are
    shown as the design they are rather than as choices that took effect.
  -->
  <p class="soon">
    <Icon name="lock" size={15} />
    <span>
      None of the switches below do anything yet. They are shown because they
      are what this screen will hold, and hiding them would make the gap harder
      to notice rather than smaller.
    </span>
  </p>
{/if}

<section class:soon-off={!core.demo}>
  <h3>Who can start a conversation with you</h3>
  <div class="seg">
    {#each REACH as r (r.id)}
      <button class:sel={p.dms === r.id} onclick={() => (p.dms = r.id)} aria-pressed={p.dms === r.id}>
        {r.label}
      </button>
    {/each}
  </div>
</section>

<section class:soon-off={!core.demo}>
  <h3>Who can add you to a space</h3>
  <p class="sub">
    Anyone excluded here can still send you an invite you have to accept. This
    only controls being added without being asked.
  </p>
  <div class="seg">
    {#each REACH as r (r.id)}
      <button
        class:sel={p.spaceInvites === r.id}
        onclick={() => (p.spaceInvites = r.id)}
        aria-pressed={p.spaceInvites === r.id}
      >{r.label}</button>
    {/each}
  </div>
</section>

<section class:soon-off={!core.demo}>
  <h3>What you tell other people</h3>
  <p class="sub">
    These are on by default because a conversation where nobody knows if
    anything landed is worse for everyone. Turning them off is a normal thing
    to want, and nobody is told that you did.
  </p>

  <label class="check">
    <input type="checkbox" bind:checked={p.readReceipts} />
    <span>
      <b>Read receipts</b>
      <span class="sub">
        Your client stops sending them, and stops showing you other people's.
        It can't stop someone inferring you read something from the fact that
        you replied.
      </span>
    </span>
  </label>

  <label class="check">
    <input type="checkbox" bind:checked={p.typingIndicators} />
    <span>
      <b>Typing indicators</b>
      <span class="sub">Same trade, smaller stakes.</span>
    </span>
  </label>

  <label class="check">
    <input type="checkbox" bind:checked={p.presence} />
    <span>
      <b>Show when you're online</b>
      <span class="sub">
        Off means you appear the same whether you're here or not.
      </span>
    </span>
  </label>
</section>

<section>
  <h3>Blocked</h3>
  {#if !core.demo}
    <!-- Blocking is a `blocks` table the Host does not have, and it has to be
         the Host's: the point is that their messages stop reaching you, which
         means delivery has to know. A local-only list would be a filter that
         still downloaded everything and still let them see you. -->
    <p class="empty">Blocking isn't built yet.</p>
    <p class="note">
      When it is, it will stop their messages reaching you and yours reaching
      them. In a room you both belong to they will still see what you post
      there — leaving is the only thing that changes that, and we'd rather say
      so than let you find out later.
    </p>
  {:else}
  {#each p.blocked as b (b.handle)}
    <div class="row">
      <div class="meta">
        <div class="nm">{b.handle}</div>
        <div class="bl">Blocked {b.when}</div>
      </div>
      <button class="un" onclick={() => unblock(b.handle)}>Unblock</button>
    </div>
  {:else}
    <p class="empty">Nobody.</p>
  {/each}
  <p class="note">
    Blocking stops their messages reaching you and stops yours reaching them.
    In a room you both belong to, they can still see what you post there —
    leaving the room is the only thing that changes that, and we'd rather say
    so than let you find out later.
  </p>
  {/if}
</section>

<section class="danger-zone">
  <h3>Reporting</h3>
  <p class="sub">
    Nothing scans your messages, because nothing can. A report carries
    cryptographic proof of the messages you choose to include, and it goes to
    that space's moderators — who are members like anyone else, not us.
  </p>
  <div class="how">
    <Icon name="shield" size={16} />
    <span>Report from the message menu, or from someone's profile card.</span>
  </div>
</section>

<style>
  h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--text-xl); margin: 0 0 4px; }
  .lede { color: var(--text-mute); margin: 0 0 28px; font-size: var(--text-sm); max-width: 62ch; line-height: 1.55; }
  section { margin-bottom: 34px; }
  /* Visibly inert rather than hidden — see the note above. */
  .soon-off { opacity: .55; }
  .soon-off :global(input) { pointer-events: none; }
  .soon {
    display: flex; gap: 10px; align-items: flex-start; max-width: 62ch;
    margin: 0 0 28px; padding: 12px 14px; border-radius: var(--r-md);
    border: 1px solid var(--line); background: var(--ground-2);
    font-size: var(--text-sm); color: var(--text-dim); line-height: 1.55;
  }
  h3 { font-size: var(--text-base); font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--text-mute); font-size: var(--text-sm); margin: 0 0 12px; display: block; line-height: 1.5; max-width: 60ch; }

  .seg { display: inline-flex; gap: 3px; background: var(--ground-2); padding: 3px; border-radius: var(--r-pill); flex-wrap: wrap; }
  .seg button {
    border: 0; cursor: pointer; font: inherit; font-size: var(--text-sm); font-weight: 600;
    padding: 7px 16px; border-radius: var(--r-pill); background: transparent; color: var(--text-dim);
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .seg button:hover { color: var(--text); }
  .seg button.sel { background: var(--brand); color: #fff; }

  .check { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; margin-bottom: 16px; }
  .check input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--face-mint); cursor: pointer; flex: none; }
  .check b { display: block; font-weight: 600; margin-bottom: 2px; font-size: var(--text-sm); }
  .check .sub { margin: 0; }

  .row {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 0; border-bottom: 1px solid var(--line);
  }
  .meta { flex: 1; min-width: 0; }
  .nm { font-size: var(--text-sm); font-weight: 600; font-family: var(--font-mono); }
  .bl { font-size: 12px; color: var(--text-mute); margin-top: 1px; }
  .un {
    border: 1px solid var(--line); background: transparent; cursor: pointer;
    font: inherit; font-size: 12px; font-weight: 600; color: var(--text-mute);
    padding: 6px 12px; border-radius: var(--r-pill); flex: none;
    transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
  }
  .un:hover { color: var(--text); background: var(--ground-2); }

  .empty { font-size: var(--text-sm); color: var(--text-mute); margin: 0; }

  .note {
    margin: 16px 0 0; font-size: var(--text-sm); color: var(--text-mute); line-height: 1.55;
    max-width: 60ch; border-left: 2px solid var(--line); padding-left: 14px;
  }

  .how {
    display: flex; align-items: center; gap: 10px; font-size: var(--text-sm);
    color: var(--text-dim); background: var(--ground-2);
    padding: 12px 14px; border-radius: var(--r-md);
  }
</style>
