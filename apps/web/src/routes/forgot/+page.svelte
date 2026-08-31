<script lang="ts">
import { goto } from '$app/navigation';
import Button from '$lib/moment/Button.svelte';
import Field from '$lib/moment/Field.svelte';
import Moment from '$lib/moment/Moment.svelte';

/**
 * The hardest screen in the product (`docs/08`): the one place the
 * architecture's honesty collides with what the user wants to hear. The line
 * between "we can't help you" reading as a design principle rather than as
 * cruelty is about three words wide, so the copy here is the deck's, verbatim.
 */
let handle = $state('');
let code = $state('');
let password = $state('');
let busy = $state(false);
let error = $state('');
/** Two steps: prove the code, then choose a password. */
let step = $state<'code' | 'password'>('code');

/**
 * Check the code by actually recovering with it.
 *
 * There is no "is this code right" endpoint and there should not be — the only
 * honest check is whether it opens the wrap, and that happens on this device.
 * The length check first is a courtesy, not security: Argon2id takes a moment,
 * and making somebody wait for it to tell them they typed 12 characters would
 * be rude.
 */
async function check() {
  if (code.replace(/[\s-]/g, '').length !== 32) {
    error = "That doesn't look like a recovery code. They're 32 characters, in eight groups.";
    return;
  }
  busy = true;
  error = '';
  try {
    const { recover } = await import('@revel/core');
    const { enrolDeps } = await import('$lib/identity.js');
    await recover(await enrolDeps(), { handle: handle.trim(), code });
    step = 'password';
  } catch (err) {
    console.error('recovery failed', err);
    const failure = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    // One message whichever it was. A handle that does not exist and a code
    // that is wrong must be indistinguishable, or this becomes a way to find
    // out who has an account here.
    error = failure
      ? "That handle and recovery code don't match an account."
      : 'Could not reach the server.';
  } finally {
    busy = false;
  }
}

/** Choose a new password: one new OPAQUE record, one re-wrap. */
async function reset() {
  if (password.length < 8) {
    error = 'Pick a password of at least 8 characters.';
    return;
  }
  busy = true;
  error = '';
  try {
    const { resetPassword } = await import('@revel/core');
    const { enrolDeps } = await import('$lib/identity.js');
    const result = await resetPassword(await enrolDeps(), {
      handle: handle.trim(),
      code,
      newPassword: password,
    });
    const { saveSession } = await import('@revel/core');
    await saveSession({
      accountPub: result.accountPub,
      handle: result.handle,
      accountKey: result.accountKey,
    });
    // Both secrets out of memory before leaving. The recovery code still works
    // — resetting does not spend it — but there is no reason for it to sit here.
    code = '';
    password = '';
    goto('/app');
  } catch (err) {
    console.error('reset failed', err);
    error = 'Could not set a new password. Your recovery code still works.';
  } finally {
    busy = false;
  }
}
</script>

<Moment pose="serious">
  <div class="pane">
    <p class="eyebrow">Forgotten password</p>
    <h1>There's a way back in.</h1>

    <p class="lede">
      We can't email you a reset link. Your device proves your password to the
      server without ever sending it, so there's nothing stored anywhere to
      reset.
    </p>

    <div class="ways">
      <section class="way">
        <h2>Recovery code</h2>
        {#if step === 'code'}
          <p>The one from when you signed up. Enter it and pick a new password.</p>
          <Field label="Handle" bind:value={handle} placeholder="viola" />
          <Field label="" bind:value={code} placeholder="SPQR-4K7M-XN2A-9WTD-…" invalid={!!error} />
          {#if error}<p class="error" role="alert">{error}</p>{/if}
          <Button disabled={busy || !code.trim() || !handle.trim()} onclick={check}>
            {busy ? 'Checking…' : 'Reset with recovery code'}
          </Button>
        {:else}
          <!-- The code worked, and saying so matters: this is the moment
               somebody finds out the account is not gone. -->
          <p>That worked — your account is back. Pick a new password.</p>
          <Field
            label="New password"
            type="password"
            bind:value={password}
            autocomplete="new-password"
            hint="At least 8 characters."
          />
          {#if error}<p class="error" role="alert">{error}</p>{/if}
          <Button disabled={busy || password.length < 8} onclick={reset}>
            {busy ? 'Setting…' : 'Set new password'}
          </Button>
          <p class="keep">
            Keep your recovery code. Changing your password doesn't change it,
            and it's still the way back if this happens again.
          </p>
        {/if}
      </section>

      <section class="way">
        <h2>Passkey</h2>
        <p>If you enrolled one, it can unlock your account too — no code needed.</p>
        <Button variant="secondary">Use a passkey</Button>
      </section>
    </div>

    <p class="fine">
      Without one of these, the account can't be recovered. That isn't a policy
      we could make an exception to — the server doesn't hold enough
      information to let anyone back in.
    </p>

    <p class="alt"><a href="/signin">Back to sign in</a></p>
  </div>
</Moment>

<style>
  .pane { animation: enter var(--t-slow) var(--ease); max-width: 36rem; }
  @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .eyebrow {
    font-size: var(--text-sm); font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: color-mix(in oklab, var(--text) 62%, transparent); margin: 0;
  }
  h1 {
    font-family: var(--font-display); font-size: var(--display-3); line-height: .98;
    letter-spacing: -.035em; font-weight: 600; margin: 10px 0 18px;
  }
  .lede { color: color-mix(in oklab, var(--text) 84%, transparent); margin: 0 0 28px; }

  .ways { display: grid; gap: 18px; }
  .way {
    background: rgba(0, 0, 0, .2); border-radius: var(--r-md); padding: 18px 20px;
    border: 1px solid color-mix(in oklab, var(--text) 12%, transparent);
    transition: border-color var(--t-base) var(--ease), background var(--t-base) var(--ease);
  }
  .way:hover { border-color: color-mix(in oklab, var(--text) 22%, transparent); background: rgba(0, 0, 0, .26); }
  .way h2 { margin: 0 0 4px; font-size: var(--text-lg); font-weight: 700; }
  .way p { margin: 0 0 14px; font-size: var(--text-sm); color: color-mix(in oklab, var(--text) 74%, transparent); }

  .error { color: var(--face-coral); font-size: var(--text-sm); margin: -6px 0 14px; }
  .keep {
    margin: 14px 0 0; font-size: var(--text-sm);
    color: color-mix(in oklab, var(--text) 66%, transparent);
  }

  /* Muted and unadorned. This is the sentence people will remember, and
     dressing it up would make it read as a shrug. */
  .fine {
    margin-top: 28px; font-size: var(--text-sm); line-height: 1.75;
    color: color-mix(in oklab, var(--text) 60%, transparent);
    border-left: 2px solid color-mix(in oklab, var(--text) 20%, transparent);
    padding-left: 16px;
  }
  .alt { margin-top: 24px; font-size: var(--text-sm); }
  .alt a { color: color-mix(in oklab, var(--text) 70%, transparent); }
</style>
