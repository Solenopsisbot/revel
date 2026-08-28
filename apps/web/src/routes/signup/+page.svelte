<script lang="ts">
  import Moment from '$lib/moment/Moment.svelte';
  import Field from '$lib/moment/Field.svelte';
  import Button from '$lib/moment/Button.svelte';
  import Icon from '$lib/Icon.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

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

  // Mock. The real one comes from the crypto core and is shown exactly once.
  const code = 'SPQR-4K7M-XN2A-9WTD-B3JC-7QME-Z2XV-K8RT';
  const ready = $derived(handle.trim().length >= 2 && password.length >= 8);

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

<Moment>
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

      <div class="row">
        <Button disabled={!ready} onclick={() => (step = 'code')}>Continue</Button>
        <Button variant="ghost" onclick={() => goto('/signin')}>I already have an account</Button>
      </div>
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
      <h1>Skip the password?</h1>
      <p class="lede">
        Add a passkey and you can unlock with your face or fingerprint instead of
        typing your password every time. Your recovery code still works as a backup
        either way.
      </p>
      <div class="row">
        <Button onclick={() => goto('/')}>Add a passkey</Button>
        <Button variant="ghost" onclick={() => goto('/')}>Skip for now</Button>
      </div>
    </div>
  {/if}
</Moment>

<style>
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
