<script lang="ts">
  import Moment from '$lib/moment/Moment.svelte';
  import Field from '$lib/moment/Field.svelte';
  import Button from '$lib/moment/Button.svelte';
  import Icon from '$lib/Icon.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

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

  async function submit() {
    if (!ready) return;
    busy = true;
    error = '';
    await new Promise((r) => setTimeout(r, 550));
    busy = false;
    if (password === 'wrong') {
      // One message for both cases, so it isn't an enumeration oracle
      // (`docs/17`).
      error = "That handle and password don't match.";
      return;
    }
    step = 'twofactor';
  }

  async function verify() {
    busy = true;
    await new Promise((r) => setTimeout(r, 500));
    busy = false;
    if (code.trim().length !== 6) {
      error = 'That code has expired or is wrong. Codes last 30 seconds.';
      return;
    }
    goto('/');
  }
</script>

<Moment>
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
          <Button variant="ghost" onclick={() => (step = 'scan')}>Have another device handy? Scan instead</Button>
        </div>
      </form>

      <p class="alt">
        <a href="/forgot">Forgotten your password?</a>
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
      <div class="qr" role="img" aria-label="Pairing code"></div>
      <p class="waiting"><span class="pulse"></span> Waiting for the other device…</p>
      <div class="row">
        <Button variant="ghost" onclick={() => (step = 'credentials')}>
          <Icon name="reply" size={16} /> Use my password instead
        </Button>
      </div>
    </div>
  {/if}
</Moment>

<style>
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

  .alt { margin-top: 28px; font-size: var(--text-sm); color: color-mix(in oklab, var(--text) 62%, transparent); }
  .alt a { color: var(--text); }
  .fine { margin-top: 24px; font-size: var(--text-sm); line-height: 1.7; color: color-mix(in oklab, var(--text) 58%, transparent); }
</style>
