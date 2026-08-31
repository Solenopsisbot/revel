<script lang="ts">
import { goto } from '$app/navigation';
import { page } from '$app/state';
import Icon from '$lib/Icon.svelte';
import Button from '$lib/moment/Button.svelte';
import Field from '$lib/moment/Field.svelte';
import Moment from '$lib/moment/Moment.svelte';

type Step = 'account' | 'code' | 'passkey';
// ?step= jumps straight to a stage. These screens are seen once in a real
// account's life, so being able to open one directly is the difference
// between reviewing it and rebuilding it every time.
const initial = new URLSearchParams(page.url.search).get('step') as Step | null;
let step = $state<Step>(initial ?? 'account');

let handle = $state('');
let password = $state('');
let provider = $state('revel.chat');
let providerOpen = $state(false);
let saved = $state(false);
let copied = $state(false);
let showQr = $state(false);
let busy = $state(false);
let error = $state('');

/**
 * The real recovery code, from the crypto core, shown exactly once.
 *
 * `?step=code` still shows a placeholder so the screen can be reviewed without
 * creating an account — the alternative is rebuilding it from scratch every
 * time somebody wants to look at the copy.
 */
let code = $state('SPQR-4K7M-XN2A-9WTD-B3JC-7QME-Z2XV-K8RT');
const ready = $derived(handle.trim().length >= 2 && password.length >= 8 && !busy);

/**
 * Create the account.
 *
 * Everything that matters happens in `@revel/core`: the account key is
 * generated here in the browser, wrapped under a key derived from the password
 * via OPAQUE and under one derived from the recovery code, and only the wraps
 * are uploaded. The password never leaves this tab.
 */
async function create() {
  if (!ready) return;
  busy = true;
  error = '';
  try {
    const { signUp } = await import('@revel/core');
    const { enrolDeps, explain } = await import('$lib/identity.js');
    const result = await signUp(await enrolDeps(), {
      handle: handle.trim(),
      password,
      deviceLabel: 'this browser',
    });
    code = result.recoveryCode;
    enrolled = { handle: result.handle, accountKey: result.accountKey, device: result.device };
    // Sealed to this device before the code is shown, so a reload during the
    // "write it down" step does not lose the account that was just created
    // (`docs/03` §1). The key is non-extractable and the password is not
    // involved — that is the point of it.
    const { saveSession } = await import('@revel/core');
    await saveSession({
      accountPub: result.accountPub,
      handle: result.handle,
      accountKey: result.accountKey,
      device: result.device,
    });
    // Only now — the code has to be on screen before the password is gone from
    // it, or a failure between the two would leave an account nobody can reach.
    password = '';
    step = 'code';
  } catch (err) {
    error = explainError(err);
  } finally {
    busy = false;
  }
}

/** `null` until asked; `false` means this device simply cannot do it. */
let passkeys = $state<boolean | null>(null);
/** The account key, kept only across the passkey step. */
let enrolled: {
  handle: string;
  accountKey: Uint8Array;
  device?: { certificate: Uint8Array; deviceSecret: Uint8Array };
} | null = null;

$effect(() => {
  if (step !== 'passkey' || passkeys !== null) return;
  void import('$lib/identity.js').then(async (m) => {
    passkeys = await m.passkeysAvailable();
  });
});

/**
 * Add the passkey wrap.
 *
 * Declining is an answer rather than a failure — a passkey is optional, and
 * telling somebody their own choice was an error would be a lie. So a refusal
 * moves on exactly like "skip".
 */
async function addPasskey() {
  if (!enrolled) return goto('/app');
  busy = true;
  error = '';
  try {
    const { addPasskeyWrap } = await import('@revel/core');
    const { enrolDeps, webAuthnPrf, authenticateDevice } = await import('$lib/identity.js');
    // Enrolling a wrap is an authenticated act, and this is the first moment
    // the device needs to be one — sign-up has produced a certificate but
    // nothing has exchanged it for a token yet.
    const token = await authenticateDevice({
      accountKey: enrolled.accountKey,
      ...(enrolled.device ? { device: enrolled.device } : {}),
    });
    if (!token) {
      error = 'Could not reach your provider. Your recovery code still works.';
      return;
    }
    await addPasskeyWrap(
      { ...(await enrolDeps()), prf: webAuthnPrf, authorization: '' },
      { handle: enrolled.handle, accountKey: enrolled.accountKey },
    );
    goto('/app');
  } catch (err) {
    console.error('passkey enrolment failed', err);
    error = 'Could not add a passkey. Your recovery code still works.';
  } finally {
    busy = false;
  }
}

function explainError(err: unknown): string {
  // Logged as well as shown, always. A screen that says "something went wrong"
  // and puts nothing in the console is one nobody can debug — including the
  // person who wrote it, three weeks later, from a bug report.
  console.error('sign-up failed', err);
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
  if (code === 'handle_taken') return 'Somebody already has that handle.';
  if (code === 'wraps_incomplete') return 'Sign-up did not complete. Nothing was created.';
  return code ? `Something went wrong (${code}).` : 'Could not reach the server.';
}

async function copy() {
  try {
    await navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  } catch {
    /* clipboard refused; the code is on screen regardless */
  }
}
</script>

<!-- The recovery-code step is the sentence people have to believe, so Wren
     says it with her serious face rather than her friendly one. -->
<Moment pose={step === 'code' ? 'serious' : 'standing'}>
  {#if step === 'account'}
    <div class="pane">
      <p class="eyebrow">Make an account</p>
      <h1>Pick a handle.</h1>

      <Field
        label="Handle"
        bind:value={handle}
        placeholder="viola"
        suffix="@{provider}"
        autocomplete="username"
        hint="Your address will be {handle || 'you'}@{provider}"
      />

      <button class="provider" onclick={() => (providerOpen = !providerOpen)}>
        Using <b>{provider}</b> as your provider
        <Icon name="chevron" size={14} />
      </button>
      {#if providerOpen}
        <div class="provider-note">
          Your handle and your encrypted account backup live with a provider.
          Your messages never do. You can move later without losing anything.
          <div class="opts">
            <button class:sel={provider === 'revel.chat'} onclick={() => { provider = 'revel.chat'; providerOpen = false; }}>revel.chat <span>recommended</span></button>
            <button onclick={() => (providerOpen = false)}>Use another provider…</button>
          </div>
        </div>
      {/if}

      <Field label="Password" type="password" bind:value={password} autocomplete="new-password" hint="At least 8 characters." />

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <div class="row">
        <Button disabled={!ready} onclick={create}>{busy ? 'Creating…' : 'Continue'}</Button>
      </div>

      <!-- Out of the button row and into a footer, matching `/signin`. Sitting
           next to Continue it read as a second thing to do here; it is a way
           out of this screen, which is what the footer is for. -->
      <p class="alt"><a href="/signin">I already have an account</a></p>
    </div>
  {:else if step === 'code'}
    <div class="pane">
      <p class="eyebrow">Your recovery code</p>
      <h1>This is your way back in.</h1>
      <p class="lede">
        Your password never leaves your device — not even we have it. That means if
        you forget it, nobody can reset it. This recovery code is the only backup
        that exists.
      </p>

      {#if showQr}
        <div class="qr" role="img" aria-label="Recovery code as a QR code"></div>
      {:else}
        <p class="code">{code}</p>
      {/if}

      <div class="row tools">
        <Button variant="secondary" onclick={copy}>{copied ? 'Copied' : 'Copy to clipboard'}</Button>
        <Button variant="secondary">Download as file</Button>
        <Button variant="ghost" onclick={() => (showQr = !showQr)}>{showQr ? 'Show as text' : 'Show as QR'}</Button>
      </div>

      <label class="ack">
        <input type="checkbox" bind:checked={saved} />
        <span>I saved my recovery code somewhere I won't lose it.</span>
      </label>

      <div class="row">
        <Button disabled={!saved} onclick={() => (step = 'passkey')}>Continue</Button>
      </div>

      <p class="fine">
        Write it down, save the file, or both.<br />
        If you lose this and forget your password, the account can't be
        recovered — not by support, not by us.
      </p>
    </div>
  {:else}
    <div class="pane">
      <p class="eyebrow">One more thing — optional</p>
      <h1>A second way back.</h1>
      <!-- This used to say "skip typing your password every time", which stopped
           being true the moment the account key started being sealed to the
           device: a reload does not ask for a password anyway (`docs/03` §1).
           What a passkey actually buys is the *other* door — `docs/03` §4's "or
           the passkey path", for the day the password is gone and the paper
           is too. Saying the old thing would have oversold it and undersold
           the recovery code. -->
      <p class="lede">
        If you ever forget your password, a passkey opens your account with your
        face or fingerprint — no code to find. Your recovery code keeps working
        either way; this is a second door, not a replacement.
      </p>
      {#if passkeys === false}
        <p class="lede dim">
          This device doesn't have a passkey authenticator, so there's nothing to
          add here. Your recovery code is still your way back in.
        </p>
        <div class="row">
          <Button onclick={() => goto('/app')}>Finish</Button>
        </div>
      {:else}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="row">
          <Button disabled={busy} onclick={addPasskey}>
            {busy ? 'Waiting for your device…' : 'Add a passkey'}
          </Button>
          <Button variant="ghost" onclick={() => goto('/app')}>Skip for now</Button>
        </div>
      {/if}
    </div>
  {/if}
</Moment>

<style>
  /* One shared error line for the flow. The muted warning tone rather than red
     (`docs/08`): a handle somebody already has is not an alarm. */
  .error { margin: 0; font-size: var(--text-sm); color: var(--warn, var(--text-dim)); }

  /* Each step fades and rises; the steps are a sequence, not a slideshow. */
  .pane { animation: enter var(--t-slow) var(--ease); }
  @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .eyebrow {
    font-size: var(--text-sm); font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: color-mix(in oklab, var(--text) 62%, transparent); margin: 0;
  }
  h1 {
    font-family: var(--font-display); font-size: var(--display-3); line-height: .98;
    letter-spacing: -.035em; font-weight: 600; margin: 10px 0 18px;
  }
  .lede { color: color-mix(in oklab, var(--text) 84%, transparent); margin: 0 0 24px; }
  .alt {
    margin-top: 28px; font-size: var(--text-sm);
    color: color-mix(in oklab, var(--text) 62%, transparent);
  }
  .alt a { color: var(--text); }
  .lede.dim { color: color-mix(in oklab, var(--text) 62%, transparent); font-size: var(--text-sm); }

  .code {
    font-family: var(--font-mono); font-size: clamp(15px, 2.1vw, 20px); font-weight: 600;
    letter-spacing: .1em; line-height: 1.7;
    background: rgba(0, 0, 0, .28); border: 1px solid color-mix(in oklab, var(--text) 26%, transparent);
    border-radius: var(--r-md); padding: 18px 20px; margin: 0 0 16px; word-break: break-all;
  }
  .qr {
    width: 180px; height: 180px; margin-bottom: 16px; border-radius: var(--r-md);
    background:
      repeating-linear-gradient(90deg, var(--text) 0 10px, transparent 10px 20px),
      repeating-linear-gradient(0deg, var(--text) 0 10px, transparent 10px 20px);
    background-color: rgba(0, 0, 0, .3);
  }

  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .tools { margin-bottom: 20px; }

  .ack {
    display: flex; gap: 10px; align-items: flex-start; margin: 0 0 22px;
    cursor: pointer; font-size: var(--text-sm);
  }
  .ack input { width: 20px; height: 20px; accent-color: var(--face-mint); margin-top: 1px; flex: none; cursor: pointer; }

  .fine {
    margin-top: 26px; font-size: var(--text-sm); line-height: 1.75;
    color: color-mix(in oklab, var(--text) 60%, transparent);
  }

  .provider {
    display: inline-flex; align-items: center; gap: 6px; margin: -6px 0 16px;
    background: none; border: 0; cursor: pointer; padding: 4px 0;
    font-size: var(--text-sm); color: color-mix(in oklab, var(--text) 62%, transparent);
    transition: color var(--t-fast) var(--ease);
  }
  .provider:hover { color: var(--text); }
  .provider b { font-weight: 700; }
  .provider-note {
    font-size: var(--text-sm); color: color-mix(in oklab, var(--text) 76%, transparent);
    background: rgba(0, 0, 0, .22); border-radius: var(--r-md); padding: 14px 16px; margin: 0 0 18px;
    animation: enter var(--t-base) var(--ease);
  }
  .opts { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  .opts button {
    text-align: left; background: rgba(255, 255, 255, .06); border: 0; cursor: pointer;
    padding: 9px 12px; border-radius: var(--r-sm); font: inherit; font-size: var(--text-sm);
    transition: background var(--t-fast) var(--ease);
  }
  .opts button:hover, .opts button.sel { background: rgba(255, 255, 255, .14); }
  .opts span { color: color-mix(in oklab, var(--text) 55%, transparent); font-weight: 600; }
</style>
