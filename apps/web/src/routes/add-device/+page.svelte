<script lang="ts">
/**
 * The *other* half of adding a device — the side that is already signed in.
 *
 * `docs/03` §3: an existing device scans the new one's QR, shows its
 * fingerprint for a confirmation tap, unseals its copy of the account key,
 * and sends it sealed to the new device's transfer key.
 *
 * ## Paste, not camera
 *
 * A camera needs permission, a live video element, and a QR decoder, and it
 * cannot be tested anywhere without one. Pasting the link does the same job,
 * works on a desktop with no camera at all, and is the fallback a camera flow
 * would need regardless. The camera is an addition to this, not a replacement.
 *
 * ## The confirmation is the security
 *
 * A QR is a thing an attacker can also put on a screen. The fingerprint shown
 * here is computed from the key in the link, and the new device shows the same
 * digits — so a swapped code is a mismatch a person can see. Sending without
 * that comparison would make this "hand your account key to whatever scanned
 * first".
 */
import { goto } from '$app/navigation';
import { transport } from '$lib/identity.js';
import Button from '$lib/moment/Button.svelte';
import Field from '$lib/moment/Field.svelte';
import Moment from '$lib/moment/Moment.svelte';
import { session } from '$lib/session.svelte.js';

let link = $state('');
let busy = $state(false);
let error = $state('');
let sent = $state(false);
/** Parsed from the link, and shown for comparison before anything is sent. */
let pending = $state<{ channel: string; pub: Uint8Array; fingerprint: string } | null>(null);

void session.restore();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** `revel://add?c=<channel>&k=<transfer pub, base64url>`. */
async function read() {
  error = '';
  pending = null;
  try {
    const url = new URL(link.trim());
    const channel = url.searchParams.get('c');
    const key = url.searchParams.get('k');
    if (!channel || !key) throw new Error('missing parts');

    const padded = key.replaceAll('-', '+').replaceAll('_', '/');
    const pub = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    if (pub.length !== 32) throw new Error('not a transfer key');

    const wasm = await import('@revel/crypto-wasm');
    await wasm.default();
    pending = { channel, pub, fingerprint: wasm.Transfer.fingerprint(pub) };
  } catch {
    error = "That doesn't look like a pairing link. Copy the whole thing.";
  }
}

/** Seal the account key to the new device and hand it to the IdP to relay. */
async function send() {
  const target = pending;
  const me = session.current;
  if (!target || !me) return;
  busy = true;
  error = '';
  try {
    const wasm = await import('@revel/crypto-wasm');
    await wasm.default();
    // Sealed here, opened there. The IdP relays bytes under a key it never had.
    const sealed = wasm.Transfer.seal(target.pub, me.accountKey);
    const res = await transport.post(`/idp/enrol/channel/${encodeURIComponent(target.channel)}`, {
      sealed: b64(sealed),
      // The new device signs its own certificate once it has the account key;
      // this carries the existing one so the relay has something to name.
      deviceCert: me.device ? b64(me.device.certificate) : 'AA==',
      accountPub: me.accountPub,
      handle: me.handle,
    });
    if (res.status !== 204) {
      error =
        res.status === 404
          ? 'That code has expired. Ask the other device for a new one.'
          : 'Could not send it. Try again.';
      return;
    }
    sent = true;
  } catch (err) {
    console.error('handing over the account key failed', err);
    error = 'Could not send it. Try again.';
  } finally {
    busy = false;
  }
}
</script>

<Moment pose={pending ? 'alert' : 'leaning'}>
  <div class="pane">
    <p class="eyebrow">Add a device</p>

    {#if !session.ready}
      <h1>One moment.</h1>
    {:else if !session.current}
      <h1>Sign in first.</h1>
      <p class="lede">
        Adding a device means handing it your account key, so it has to come from
        a device that already has one.
      </p>
      <Button onclick={() => goto('/signin')}>Sign in</Button>
    {:else if sent}
      <h1>Sent.</h1>
      <p class="lede">
        The other device should be signed in now. If it isn't, it may have given
        up waiting — codes last five minutes.
      </p>
      <Button onclick={() => goto('/app')}>Done</Button>
    {:else if pending}
      <h1>Do these match?</h1>
      <p class="lede">
        The other device is showing the same six groups. If they don't match,
        something is wrong — stop, and don't send.
      </p>
      <p class="print">{pending.fingerprint}</p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <Button disabled={busy} onclick={send}>
          {busy ? 'Sending…' : 'They match — send my account key'}
        </Button>
        <Button variant="ghost" onclick={() => { pending = null; link = ''; }}>Cancel</Button>
      </div>
    {:else}
      <h1>Paste the code.</h1>
      <p class="lede">
        On the new device, choose <em>Scan instead</em>. Copy the link under its
        code and paste it here.
      </p>
      <Field label="Pairing link" bind:value={link} placeholder="revel://add?c=…" invalid={!!error} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <Button disabled={!link.trim()} onclick={read}>Continue</Button>
        <Button variant="ghost" onclick={() => goto('/app')}>Cancel</Button>
      </div>
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
  .lede { color: color-mix(in oklab, var(--text) 84%, transparent); margin: 0 0 24px; }

  /* Monospace and spaced: compared digit by digit against another screen. */
  .print {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-lg); letter-spacing: .06em; text-align: center;
    margin: 0 0 20px; color: color-mix(in oklab, var(--text) 88%, transparent);
  }
  .error { color: var(--face-coral); font-size: var(--text-sm); margin: 0 0 14px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
