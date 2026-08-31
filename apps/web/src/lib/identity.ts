/**
 * The identity flows, wired to the real crypto and a real IdP.
 *
 * `packages/core` holds the orchestration (`signUp`, `signIn`, `recover`); this
 * is the browser's half of its two dependencies — the wasm envelope, and an
 * HTTP transport. Nothing here makes a decision; if it seems to be, the decision
 * belongs in core where it can be tested without a browser.
 *
 * ## Why the wasm is loaded lazily
 *
 * It is ~1.3 MB, and the overwhelming majority of app opens are somebody
 * already signed in on a device that has an account key sealed locally. Paying
 * for the envelope on every load to support a screen seen twice in an account's
 * life is the wrong trade — so it is imported at the moment a flow starts,
 * which is also the moment a spinner is already justified.
 */
import type { EnrolDeps, EnvelopeApi, IdpTransport } from '@revel/core';

/** Where the IdP lives. Same origin in dev; configurable for a real deployment. */
const IDP = import.meta.env.VITE_IDP_URL ?? '';

export const transport: IdpTransport = {
  async post(path, body) {
    const res = await fetch(`${IDP}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
};

let envelopePromise: Promise<EnvelopeApi> | null = null;

/** The wasm envelope, initialised once and shared. */
export function loadEnvelope(): Promise<EnvelopeApi> {
  envelopePromise ??= (async () => {
    const wasm = await import('@revel/crypto-wasm');
    await wasm.default();
    const { Envelope } = wasm;
    return {
      generateAccountKey: () => Envelope.generateAccountKey(),
      accountPublic: (seed) => Envelope.accountPublic(seed),
      kekFromExportKey: (k) => Envelope.kekFromExportKey(k),
      recoveryKey: (code, salt) => Envelope.recoveryKey(code, salt),
      recoveryVerifier: (rk) => Envelope.recoveryVerifier(rk),
      wrap: (seed, key) => Envelope.wrap(seed, key),
      unwrap: (w, key) => Envelope.unwrap(w, key),
      generateRecoveryCode: () => Envelope.generateRecoveryCode(),
      generateSalt: () => Envelope.generateSalt(),
    } satisfies EnvelopeApi;
  })();
  return envelopePromise;
}

/**
 * Everything `packages/core`'s flows need.
 *
 * `signDeviceCert` is a stub for now and says so: signing a device certificate
 * is `device.rs`'s job and needs the device keypair, which does not exist until
 * there is somewhere durable to keep it. Returning empty bytes means an account
 * can be created and recovered and its devices are not yet real — which is a
 * true statement about where this is, and better than a certificate that looks
 * signed and is not.
 */
export async function enrolDeps(): Promise<EnrolDeps> {
  return {
    transport,
    envelope: await loadEnvelope(),
    signDeviceCert: async () => new Uint8Array(0),
  };
}

/**
 * Turn a failure from core into something to put on a screen.
 *
 * The server's codes are the vocabulary and they are deliberately few, so this
 * is a lookup rather than a parser. Anything unrecognised says so plainly rather
 * than guessing — `docs/08`: an error nobody wrote is worse than one that admits
 * it does not know.
 */
export function explain(code: string): string {
  switch (code) {
    case 'bad_credentials':
      return "That handle and password don't match an account.";
    case 'totp_required':
      return 'Enter the code from your authenticator app.';
    case 'totp_invalid':
      return "That code didn't work. Codes change every 30 seconds.";
    case 'handle_taken':
      return 'Somebody already has that handle.';
    case 'wraps_incomplete':
    case 'recovery_salt_missing':
      return 'Sign-up did not complete. Nothing was created — try again.';
    case 'no_recovery_wrap':
      return 'This account has no recovery code on file.';
    default:
      return `Something went wrong (${code}).`;
  }
}
