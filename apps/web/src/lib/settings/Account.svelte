<script lang="ts">
/**
 * Account.
 *
 * **A preview, and it says so** — `sections.ts` marks it `wired: false` and
 * the overlay puts a notice above it. What it used to do was worse than not
 * working: it stated facts. "viola@revel.chat" was hardcoded, the provider was
 * hardcoded, and the ways back in reported a recovery code "saved 27 Aug" and
 * "1 registered" passkey to accounts that had neither. A settings screen that
 * invents your security posture is not a mockup, it is a lie with a stylesheet.
 *
 * So: the address is real, and everything not yet connected reads as unknown
 * rather than as a number somebody might act on.
 */
import { session } from '$lib/session.svelte.js';

let moving = $state(false);
</script>

<h2>Account</h2>
<p class="lede">{session.address || 'Not signed in'}</p>

<section class="provider">
  <div class="grid">
    <span class="k">Your provider</span><span class="v">{session.provider || '—'}</span>
    <span class="k">What lives there</span>
    <span class="v">your handle, your encrypted account backup, your device list</span>
    <span class="k">What doesn't</span>
    <span class="v">your messages, your rooms, your keys</span>
  </div>
  <button class="move" onclick={() => (moving = !moving)}>Move to another provider…</button>
  {#if moving}
    <p class="note">
      Your account key doesn't change, so your rooms, history and contacts are
      unaffected — nobody has to re-add you. Your address changes, and mentions
      of the old one keep working for as long as the old provider serves the
      forwarding record.
    </p>
    <p class="note unbuilt">
      Not built yet. It needs the forwarding record and an IdP willing to accept
      a migration, which is <code>docs/06</code>'s phase 6.
    </p>
  {/if}
</section>

<section>
  <h3>Your ways back in</h3>
  <div class="ways">
    <div class="way">
      <span class="n">Password</span><span class="s">set at sign-up</span>
      <button disabled title="Not connected yet">Change</button>
    </div>
    <!--
      There is no "Show" here, and there never can be.

      The recovery code is shown exactly once, at sign-up, because nothing
      keeps it: it is stretched with Argon2id into a key that wraps the account
      key, and the code itself is never stored on the device or at the provider
      (`docs/03` §3). A button offering to show it again could only work by
      keeping a copy, which would make it a second password sitting on disk
      and defeat the reason it exists. Replacing it is a real thing and stays.
    -->
    <div class="way">
      <span class="n">Recovery code</span><span class="s">shown once at sign-up</span>
      <button disabled title="Not connected yet">Replace</button>
    </div>
    <div class="way">
      <span class="n">Passkeys</span><span class="s">—</span>
      <button disabled title="Not connected yet">Manage</button>
    </div>
  </div>
  <p class="note">
    Any one of these gets you back in. Lose all three and the account can't be
    recovered — there is no copy of your key anywhere else, which is the point
    and also the risk.
  </p>
</section>

<style>
  .lede { color: var(--text-2); margin: 0 0 22px; }
  .provider { background: var(--ground-2); border-radius: var(--r-md); padding: 18px 20px; }
  .grid { display: grid; grid-template-columns: max-content 1fr; gap: 8px 18px; }
  .k { color: var(--text-3); font-size: var(--text-sm); }
  .v { font-size: var(--text-sm); }
  .move {
    margin-top: 16px; font: inherit; font-size: var(--text-sm); cursor: pointer;
    background: none; border: 0; padding: 0; color: var(--brand);
    text-decoration: underline; text-underline-offset: 2px;
  }
  .note { margin: 14px 0 0; font-size: var(--text-sm); color: var(--text-2); line-height: 1.55; }
  .note.unbuilt { color: var(--text-3); }
  h3 { margin: 30px 0 12px; font-size: var(--text-md); }
  .ways { display: grid; gap: 8px; }
  .way {
    display: grid; grid-template-columns: 1fr max-content max-content;
    gap: 10px; align-items: center;
    background: var(--ground-2); border-radius: var(--r-sm); padding: 11px 14px;
  }
  .n { font-size: var(--text-sm); font-weight: 600; }
  .s { font-size: var(--text-sm); color: var(--text-3); }
  .way button {
    font: inherit; font-size: var(--text-sm); cursor: pointer;
    background: var(--ground-3); border: 0; border-radius: var(--r-sm); padding: 5px 12px;
    color: var(--text);
  }
  .way button:hover:not(:disabled) { background: var(--ground-4); }
  .way button:disabled { opacity: .4; cursor: not-allowed; }
</style>
