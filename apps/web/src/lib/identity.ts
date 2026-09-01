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
import type { EnrolDeps, EnvelopeApi, IdpTransport, PrfProvider } from '@revel/core';
import { cryptoWasm } from './wasm.js';

/** Where the IdP lives. Same origin in dev; configurable for a real deployment. */
const IDP = import.meta.env.VITE_IDP_URL ?? '';

export const transport: IdpTransport = {
  async post(path, body) {
    const res = await fetch(`${IDP}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Sent when there is one. Most of these routes are unauthenticated by
        // design — signing in is what you do when you have nothing — so this is
        // additive rather than required.
        ...(deviceToken ? { authorization: `Bearer ${deviceToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  },
};

/**
 * The bearer token for this device, once it has one.
 *
 * In memory only: it is short-lived and re-derivable from the device key, so
 * persisting it would add a thing to steal and save nothing worth saving.
 */
let deviceToken: string | null = null;

/**
 * Register this device and get a session token (`docs/03` §2).
 *
 * The device-key challenge-response, from the client side: register the
 * certificate the account signed, ask for a nonce, sign it with the device key,
 * exchange it for a token. **No password anywhere** — that is the whole point
 * of devices having their own keys.
 *
 * Returns `null` when this device has no certificate yet, which is an ordinary
 * state rather than a failure: an account created before device material
 * existed simply cannot authenticate to a Host until it re-enrols.
 */
export async function authenticateDevice(session: {
  accountKey: Uint8Array;
  device?: { certificate: Uint8Array; deviceSecret: Uint8Array };
}): Promise<string | null> {
  if (!session.device) return null;
  if (deviceToken) return deviceToken;

  const [{ authPayload, decodeDeviceCert, toAccountId, toBase64, fromBase64 }, wasm] =
    await Promise.all([import('@revel/protocol'), cryptoWasm()]);

  // The protocol's decoder rather than the wasm one: `readDeviceCert` returns a
  // `MemberInfo` for rendering and does not carry the device key, which is the
  // one field this needs.
  const cert = decodeDeviceCert(session.device.certificate);
  if (!cert) return give_up('the stored device certificate does not decode');
  const devicePub: string = toAccountId(cert.devicePub);

  // `restore` re-issues the certificate rather than storing it, which is why it
  // needs the account key — and why this can only run on a device that has one.
  // That is the right constraint: authenticating *is* proving this device
  // belongs to the account.
  const account = wasm.Account.fromSecret(session.accountKey);
  const device = wasm.Device.restore(account, cert.label, session.device.deviceSecret);

  const registered = await transport.post('/idp/devices', {
    certificate: toBase64(device.certificate),
  });
  if (registered.status >= 400) {
    return give_up(`registering this device failed (${registered.status})`, registered.body);
  }

  const challenge = await transport.post('/auth/challenge', { device: devicePub });
  if (challenge.status < 200 || challenge.status >= 300) {
    return give_up(`no challenge (${challenge.status})`, challenge.body);
  }
  const { nonce, host } = challenge.body as { nonce: string; host: string };

  // Domain-separated inside wasm, so this key can never be asked to sign
  // something replayable as an MLS handshake.
  const signature = device.signAuth(authPayload(host, fromBase64(nonce), cert.devicePub));

  const granted = await transport.post('/auth/session', {
    device: devicePub,
    nonce,
    signature: toBase64(signature),
  });
  // Any 2xx. The route answers **201** — a session is created, not fetched — and
  // checking for exactly 200 threw away a perfectly good token and reported it
  // as a refused signature. Found because the failure said what it was.
  if (granted.status < 200 || granted.status >= 300) {
    return give_up(`the Host refused the signature (${granted.status})`, granted.body);
  }
  deviceToken = (granted.body as { token: string }).token;
  return deviceToken;
}

/**
 * Give up, out loud.
 *
 * Every one of these used to be a bare `return null`, which made "this device
 * cannot talk to the Host" indistinguishable from "this device has no
 * certificate yet" — and left nothing in the console either way. The same
 * mistake as a screen that says "something went wrong" and logs nothing, and it
 * cost an hour of guessing before it was fixed.
 */
function give_up(why: string, detail?: unknown): null {
  console.error(`device authentication: ${why}`, detail ?? '');
  return null;
}

/** Forget the token. Called on sign-out, alongside clearing the session. */
export function forgetDeviceToken(): void {
  deviceToken = null;
}

let envelopePromise: Promise<EnvelopeApi> | null = null;

/** The wasm envelope, initialised once and shared. */
export function loadEnvelope(): Promise<EnvelopeApi> {
  envelopePromise ??= (async () => {
    const wasm = await cryptoWasm();
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
 * `signDeviceCert` is real now: the account seed goes back into wasm just long
 * enough to sign, a fresh device key is generated there, and what comes out is
 * the certificate plus the device's own keys. `docs/03` §1 — one leaf per
 * device, and the account key signs the binding.
 *
 * The account key crosses the wasm boundary twice in a lifetime and never
 * leaves the tab; the device secret is what gets kept, sealed with the session.
 */
export async function enrolDeps(): Promise<EnrolDeps> {
  return {
    transport,
    envelope: await loadEnvelope(),
    signDeviceCert: async (accountSeed, label) => {
      const wasm = await cryptoWasm();
      const account = wasm.Account.fromSecret(accountSeed);
      const device = new wasm.Device(account, label);
      return {
        certificate: device.certificate,
        devicePub: device.publicKey,
        deviceSecret: device.secretKey,
      };
    },
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

/**
 * WebAuthn PRF, as a [`PrfProvider`].
 *
 * **This is the one part of the identity stack with no test behind it.** It
 * needs a real authenticator, a user gesture and a secure context, none of
 * which exist in a test runner — so it is deliberately the smallest thing it
 * can be, and everything on either side of it (deriving the key, sealing,
 * uploading, fetching, unsealing) is tested in `packages/core`.
 *
 * The PRF extension is what makes a passkey a *key* rather than a signature: it
 * returns 32 bytes that this authenticator will reproduce and will not reveal.
 * Not every authenticator supports it, and one that does not is a passkey we
 * cannot use — hence `null` rather than an error, because the person did
 * nothing wrong.
 */
const PRF_SALT = new TextEncoder().encode('revel/passkey-wrap/v1');

/** The rp id has to be the registrable domain, not the full origin. */
const rpId = (): string => location.hostname;

function prfOutput(credential: PublicKeyCredential | null): Uint8Array | null {
  if (!credential) return null;
  const results = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };
  const first = results.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

export const webAuthnPrf: PrfProvider = {
  async enrol(handle) {
    try {
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Revel', id: rpId() },
          user: {
            id: new TextEncoder().encode(handle),
            name: handle,
            displayName: handle,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -8 },
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
          // `eval` at creation as well as assertion: some authenticators return
          // the output straight away, and asking twice is a second prompt.
          extensions: { prf: { eval: { first: PRF_SALT } } },
        },
      })) as PublicKeyCredential | null;

      const direct = prfOutput(credential);
      if (direct) return direct;
      // Created, but the output was not returned with it. Ask once more.
      return credential ? ((await this.assert(handle))?.prf ?? null) : null;
    } catch (err) {
      // Declining is a `NotAllowedError`, and it is an answer rather than a
      // failure — a passkey is optional and refusing one is a real choice.
      console.error('passkey enrolment did not complete', err);
      return null;
    }
  },

  async assert() {
    try {
      // No `allowCredentials`: the passkey is a discoverable credential
      // (`residentKey: 'required'` at enrolment), so the authenticator offers
      // whatever it holds for this site and tells us which account was chosen.
      // That is what makes passkey sign-in one click instead of "type your
      // handle, then use your passkey".
      const credential = (await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: rpId(),
          userVerification: 'preferred',
          extensions: { prf: { eval: { first: PRF_SALT } } },
        },
      })) as PublicKeyCredential | null;

      const prf = prfOutput(credential);
      if (!prf || !credential) return null;

      // `user.id` was the handle at enrolment, so this is where it comes back.
      const userHandle = (credential.response as AuthenticatorAssertionResponse).userHandle;
      if (!userHandle) return null;
      return { prf, handle: new TextDecoder().decode(userHandle) };
    } catch (err) {
      console.error('passkey assertion did not complete', err);
      return null;
    }
  },
};

/** Whether a passkey is even worth offering here. */
export async function passkeysAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined' || !window.isSecureContext) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
