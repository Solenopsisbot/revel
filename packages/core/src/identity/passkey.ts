/**
 * The passkey wrap — `docs/03` §3's "second low-friction wrap".
 *
 * A passkey's PRF output is 32 bytes of high-entropy secret that the
 * authenticator will reproduce on demand and will not reveal. That makes it a
 * wrapping key exactly like the other two, and the envelope treats it as one:
 * `PK` goes in the same door as `KEK` and `RK`.
 *
 * ## What it is for, and what it is not
 *
 * It is **not** how you sign in — the session on this device already does that
 * without a password (`session.ts`), and a passkey adds nothing there. It is
 * the *other* way back when the password is gone: `docs/03` §4's "Or the
 * passkey path", alongside the recovery code.
 *
 * Which is why sign-up still forces a recovery code and this is optional. A
 * passkey lives on one device or in one vendor's cloud; a code written on paper
 * does not care whose account you are locked out of.
 *
 * ## Why the PRF is injected
 *
 * `navigator.credentials` needs a real authenticator, a user gesture, and a
 * secure context, so it cannot run in a test. Everything *around* it can —
 * deriving the wrapping key, sealing, uploading, fetching, unsealing — so the
 * browser call is a single injected function and the rest is ordinary code with
 * ordinary tests. The untestable part is small enough to read.
 */
import type { EnrolDeps, Enrolled } from './enrol.js';
import { EnrolError } from './enrol.js';

/**
 * A source of PRF bytes from an authenticator.
 *
 * Implemented over WebAuthn in the browser; a fake in tests. Both return the
 * same thing: 32 bytes that this authenticator will produce again and nobody
 * else can.
 */
export interface PrfProvider {
  /**
   * Create a passkey and get its PRF output.
   *
   * Returns `null` when the person declines or the authenticator cannot do PRF
   * — both are ordinary answers rather than errors, because a passkey is
   * optional and refusing one must not look like a failure.
   */
  enrol(handle: string): Promise<Uint8Array | null>;
  /** Get the PRF output again, later, for the same account. */
  assert(handle: string): Promise<Uint8Array | null>;
}

export interface PasskeyDeps extends EnrolDeps {
  prf: PrfProvider;
  /** Bearer token for the signed-in device. Enrolling is an authenticated act. */
  authorization: string;
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * Add a passkey wrap to an account that is already open.
 *
 * `false` when the person declined, which is not a failure — see [`PrfProvider`].
 */
export async function addPasskeyWrap(
  deps: PasskeyDeps,
  input: { handle: string; accountKey: Uint8Array },
): Promise<boolean> {
  const prf = await deps.prf.enrol(input.handle);
  if (!prf) return false;

  const { envelope } = deps;
  // PK is used exactly like KEK and RK. The envelope does not know or care
  // where a wrapping key came from, which is why there is no third code path.
  const key = prf.slice(0, 32);
  const res = await deps.transport.post('/idp/wraps/passkey', {
    blob: b64(envelope.wrap(input.accountKey, key)),
    verifier: b64(envelope.recoveryVerifier(key)),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new EnrolError(errorOf(res.body, 'passkey_enrol_failed'));
  }
  return true;
}

/**
 * Open the account with a passkey, having forgotten the password.
 *
 * The same shape as `recover`, deliberately: prove you hold the secret, get the
 * wrap, open it here. The IdP never sees the PRF output.
 */
export async function unlockWithPasskey(
  deps: PasskeyDeps,
  input: { handle: string },
): Promise<Enrolled> {
  const prf = await deps.prf.assert(input.handle);
  if (!prf) throw new EnrolError('passkey_declined');

  const { envelope } = deps;
  const key = prf.slice(0, 32);

  const res = await deps.transport.post('/idp/recover/finish', {
    handle: input.handle,
    kind: 'passkey',
    verifier: b64(envelope.recoveryVerifier(key)),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new EnrolError(errorOf(res.body, 'bad_credentials'));
  }

  const body = res.body as {
    accountPub: string;
    handle: string;
    wraps: { kind: string; blob: string }[];
  };
  const wrap = body.wraps.find((w) => w.kind === 'passkey');
  if (!wrap) throw new EnrolError('no_passkey_wrap');

  return {
    accountPub: body.accountPub,
    handle: body.handle,
    accountKey: envelope.unwrap(unb64(wrap.blob), key),
  };
}

function errorOf(body: unknown, fallback: string): string {
  return typeof body === 'object' && body !== null && 'error' in body
    ? String((body as { error: unknown }).error)
    : fallback;
}
