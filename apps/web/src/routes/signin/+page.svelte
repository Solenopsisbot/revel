<script lang="ts">
import { renderSVG } from 'uqr';
import { goto } from '$app/navigation';
import { safeNext } from '$lib/next.js';
import { page } from '$app/state';

/**
 * Where to land afterwards.
 *
 * `/app` unless something sent you here on its way somewhere — an invite link
 * is the case this exists for (`docs/18`: the invite survives sign-up).
 * Validated by `safeNext`, because a `?next=` that took a full URL would be an
 * open redirect on the one page where somebody is typing a password.
 */
const next = $derived(safeNext(page.url.searchParams.get('next')));
import Icon from '$lib/Icon.svelte';
import Button from '$lib/moment/Button.svelte';
import Field from '$lib/moment/Field.svelte';
import Moment from '$lib/moment/Moment.svelte';
import { pairing } from '$lib/pairing.svelte.js';

/**
 * The normal path: handle + password + second factor. Deliberately boring —
 * `docs/17` says nobody should have to understand identity providers to sign
 * in, and the QR flow is the convenience path, not the requirement.
 */
type Step = 'credentials' | 'twofactor' | 'scan';
const initial = new URLSearchParams(page.url.search).get('step') as Step | null;
let step = $state<Step>(initial ?? 'credentials');

let handle = $state('');
let password = $state('');
let code = $state('');
let busy = $state(false);
let error = $state('');

const ready = $derived(handle.trim().length > 0 && password.length > 0);

/**
 * The account key, once it is out.
 *
 * Held here only until there is somewhere durable to seal it — `docs/03` §1
 * wants it sealed under a device-local key so a reload does not need the
 * password again. Until that exists, signing in works and does not persist,
 * which is a true statement about where this is.
 */
let accountKey: Uint8Array | null = null;

async function attempt(totp?: string) {
  busy = true;
  error = '';
  try {
    const { signIn } = await import('@revel/core');
    const { enrolDeps } = await import('$lib/identity.js');
    const result = await signIn(await enrolDeps(), {
      handle: handle.trim(),
      password,
      ...(totp ? { totp } : {}),
    });
    accountKey = result.accountKey;
    // Sealed under a non-extractable device key, so the next reload does not
    // ask for a password — `docs/03` §1 calls that Kith's biggest UX cliff, and
    // this is the construction that removes it.
    const { saveSession } = await import('@revel/core');
    await saveSession({
      accountPub: result.accountPub,
      handle: result.handle,
      accountKey: result.accountKey,
      device: result.device,
    });
    // The password is gone from memory the moment it is no longer needed. Not
    // a serious defence — a page can be inspected — but the cheapest one there
    // is, and leaving it lying around has no upside at all.
    password = '';
    goto(next);
  } catch (err) {
    console.error('sign-in failed', err);
    const failure = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    if (failure === 'totp_required') {
      // The server only asks once the password has checked out, so arriving
      // here means the password was right — which is why this is a step rather
      // than an error.
      error = '';
      step = 'twofactor';
      return;
    }
    const { explain } = await import('$lib/identity.js');
    error = failure ? explain(failure) : 'Could not reach the server.';
  } finally {
    busy = false;
  }
}

async function submit() {
  if (!ready) return;
  await attempt();
}

/**
 * The QR, rendered from whatever the pairing channel produced.
 *
 * `$derived` rather than generated in `startPairing`, so it cannot get out of
 * step with the link it is meant to encode — a QR showing a stale channel is
 * worse than no QR, because it scans.
 */
const qrSvg = $derived(pairing.link ? renderSVG(pairing.link, { border: 1 }) : '');

async function startPairing() {
  await pairing.begin(async (paired) => {
    const { saveSession } = await import('@revel/core');
    const { enrolDeps } = await import('$lib/identity.js');
    // The key arrived; the device key is this device's own and is minted here,
    // exactly as it would be after a password sign-in. `docs/03` §3 has the
    // *existing* device sign the new certificate; doing it here instead means
    // the private half never crosses the channel, which is strictly better and
    // costs one signature the account key can make locally.
    const { signDeviceCert } = await enrolDeps();
    const device = await signDeviceCert(paired.accountKey, 'this device');
    await saveSession({ ...paired, device });
    goto(next);
  });
}

// Start when the step opens, stop when it closes. A hidden page quietly polling
// every two seconds is the kind of thing that is invisible until a bill arrives.
$effect(() => {
  if (step === 'scan') void startPairing();
  else pairing.stop();
  return () => pairing.stop();
});

/** `null` until asked; `false` means this device cannot offer one. */
let passkeys = $state<boolean | null>(null);
$effect(() => {
  if (passkeys !== null) return;
  void import('$lib/identity.js').then(async (m) => {
    passkeys = await m.passkeysAvailable();
  });
});

/**
 * Sign in with a passkey. Nothing typed, not even the handle.
 *
 * The credential is discoverable, so the authenticator offers whatever it holds
 * for this site and tells us which account was chosen. Asking for a handle
 * first and *then* for the passkey would be theatre — the device already knows.
 */
async function withPasskey() {
  busy = true;
  error = '';
  try {
    const { unlockWithPasskey, saveSession } = await import('@revel/core');
    const { enrolDeps, webAuthnPrf } = await import('$lib/identity.js');
    const result = await unlockWithPasskey({
      ...(await enrolDeps()),
      prf: webAuthnPrf,
      authorization: '',
    });
    await saveSession({
      accountPub: result.accountPub,
      handle: result.handle,
      accountKey: result.accountKey,
      device: result.device,
    });
    goto(next);
  } catch (err) {
    console.error('passkey sign-in failed', err);
    const failure = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
    // Declining the prompt is a choice, not a failure, and saying "that didn't
    // work" to somebody who pressed cancel is a lie about what they did.
    error = failure === 'passkey_declined' ? '' : "That passkey doesn't open an account here.";
  } finally {
    busy = false;
  }
}

async function verify() {
  if (code.trim().length !== 6) {
    error = 'That code has expired or is wrong. Codes last 30 seconds.';
    return;
  }
  await attempt(code.trim());
}
</script>

<Moment pose={step === 'scan' ? 'alert' : 'leaning'}>
  {#if step === 'credentials'}
    <div class="pane">
      <p class="eyebrow">Welcome back</p>
      <h1>Sign in.</h1>

      <form
        onsubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Handle" bind:value={handle} placeholder="viola@revel.chat" autocomplete="username" invalid={!!error} />
        <Field label="Password" type="password" bind:value={password} autocomplete="current-password" invalid={!!error} />

        {#if error}<p class="error" role="alert">{error}</p>{/if}

        <div class="row">
          <Button type="submit" disabled={!ready || busy}>{busy ? 'Checking…' : 'Sign in'}</Button>
          {#if passkeys}
            <!-- Offered only where it can work. A button that opens a dialog
                 the device cannot fulfil is worse than no button. -->
            <Button variant="secondary" disabled={busy} onclick={withPasskey}>
              Use a passkey
            </Button>
          {/if}
          <Button variant="ghost" onclick={() => (step = 'scan')}>Have another device handy? Scan instead</Button>
        </div>
      </form>

      <!-- Both ways out of this screen, in one place. Somebody who lands here
           without an account should not have to work out that "sign up" is
           somewhere else — and somebody who has one and forgot the password is
           the other half of the same question. -->
      <p class="alt">
        <a href="/forgot">Forgotten your password?</a>
        <span aria-hidden="true">·</span>
        <a href="/signup">Make an account</a>
      </p>
    </div>
  {:else if step === 'twofactor'}
    <div class="pane">
      <p class="eyebrow">One more step</p>
      <h1>Prove it's you.</h1>
      <p class="lede">Enter the code from your authenticator app.</p>

      <div class="otp">
        <input
          bind:value={code}
          inputmode="numeric"
          maxlength="6"
          placeholder="000000"
          aria-label="Six-digit code"
        />
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}

      <div class="row">
        <Button disabled={busy} onclick={verify}>{busy ? 'Verifying…' : 'Verify'}</Button>
        <Button variant="ghost">Use a passkey instead</Button>
      </div>
      <p class="fine">
        This step happens at your provider, which is separate from the server
        holding your messages.
      </p>
    </div>
  {:else}
    <div class="pane">
      <p class="eyebrow">Add this device</p>
      <h1>Scan this.</h1>
      <p class="lede">
        Open Revel on a device you already use, and point it at this code. Nothing
        gets typed, and your password never leaves the other device.
      </p>
      {#if pairing.link}
        <!-- `svg` rather than a canvas: it scales to whatever the screen is,
             and a QR that is fuzzy is a QR that does not scan. -->
        <div class="qr" role="img" aria-label="Pairing code">{@html qrSvg}</div>
        <!-- The same digits appear on the other device before it sends
             anything. A QR is a thing an attacker can also put on a screen, so
             the confirmation is a comparison a person can actually make. -->
        <p class="print">{pairing.fingerprint}</p>
        <!-- The link in text as well as in the QR. A desktop with no camera has
             to be able to complete this, and copy-paste is the fallback any
             camera flow needs anyway. -->
        <p class="link" title="Paste this on your other device">{pairing.link}</p>
      {:else}
        <div class="qr" role="img" aria-label="Pairing code"></div>
      {/if}

      {#if pairing.status === 'waiting'}
        <p class="waiting"><span class="pulse"></span> Waiting for the other device…</p>
      {:else if pairing.status === 'expired'}
        <p class="error" role="alert">
          That code has expired. They only last five minutes — start again if you
          still have the other device to hand.
        </p>
      {:else if pairing.status === 'failed'}
        <p class="error" role="alert">Could not reach the server.</p>
      {/if}

      <div class="row">
        {#if pairing.status === 'expired' || pairing.status === 'failed'}
          <Button onclick={startPairing}>Show a new code</Button>
        {/if}
        <Button variant="ghost" onclick={() => { pairing.stop(); step = 'credentials'; }}>
          <Icon name="reply" size={16} /> Use my password instead
        </Button>
      </div>
    </div>
  {/if}
</Moment>

<style>
  /* Monospace and spaced out: this is compared digit by digit against another
     screen, and a proportional font makes that harder than it needs to be. */
  .print {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-lg); letter-spacing: .06em; text-align: center;
    margin: 14px 0 0; color: color-mix(in oklab, var(--text) 82%, transparent);
  }
  .qr :global(svg) { width: 100%; height: auto; display: block; }
  .link {
    font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-xs);
    text-align: center; word-break: break-all; margin: 8px 0 0;
    color: color-mix(in oklab, var(--text) 56%, transparent); user-select: all;
  }

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
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }

  .error {
    color: var(--face-coral); font-size: var(--text-sm); margin: -6px 0 16px;
    animation: shake var(--t-base) var(--ease);
  }
  /* A short shake, once. Enough to notice a rejection without theatre. */
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }

  .otp input {
    font-family: var(--font-mono); font-size: 30px; letter-spacing: .38em;
    width: 100%; max-width: 320px; text-align: center;
    background: rgba(0, 0, 0, .28); color: var(--text);
    border: 2px solid color-mix(in oklab, var(--text) 20%, transparent);
    border-radius: var(--r-md); padding: 14px 12px; margin-bottom: 18px;
    transition: border-color var(--t-base) var(--ease), box-shadow var(--t-base) var(--ease);
  }
  .otp input:focus {
    outline: none; border-color: var(--face-aqua);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--face-aqua) 35%, transparent);
  }

  .qr {
    width: 190px; height: 190px; border-radius: var(--r-md); margin-bottom: 16px;
    background:
      repeating-linear-gradient(90deg, var(--text) 0 10px, transparent 10px 20px),
      repeating-linear-gradient(0deg, var(--text) 0 10px, transparent 10px 20px);
    background-color: rgba(0, 0, 0, .3);
  }
  .waiting { display: flex; align-items: center; gap: 9px; font-size: var(--text-sm); color: color-mix(in oklab, var(--text) 62%, transparent); }
  .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--face-gold); animation: pl 1.4s infinite ease-in-out; }
  @keyframes pl { 0%, 100% { opacity: .3; } 50% { opacity: 1; } }

  .alt {
    margin-top: 28px; font-size: var(--text-sm);
    color: color-mix(in oklab, var(--text) 62%, transparent);
    display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline;
  }
  .alt a { color: var(--text); }
  /* Standalone ways out of this screen, not words inside a sentence. On a
     finger they get the target floor; `inline-flex` so `min-height` applies at
     all, which it does not to a plain inline box. */
  @media (pointer: coarse) {
    .alt a { display: inline-flex; align-items: center; min-height: var(--tap); }
  }
  .fine { margin-top: 24px; font-size: var(--text-sm); line-height: 1.7; color: color-mix(in oklab, var(--text) 58%, transparent); }
</style>
