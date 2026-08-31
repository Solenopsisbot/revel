/**
 * The client half of signing up, signing in and recovering (`docs/03` §3).
 *
 * This is where the pieces meet: OPAQUE produces an `exportKey`, the envelope
 * turns it into a KEK, and the KEK opens a wrap holding the account key. The
 * server side is `apps/server/src/enrolment.ts`; neither half is much use
 * without the other, and the tests drive both.
 *
 * ## What never leaves this file
 *
 * The password and the recovery code. Both are arguments to a function here and
 * are never stored, never logged, and never sent — OPAQUE's whole point is that
 * the password does not go on the wire, and the recovery code is turned into a
 * key and a proof before anything is transmitted.
 *
 * ## The account key comes back exactly twice
 *
 * Once at sign-up, when it is generated, and once at sign-in or recovery, when
 * it is unwrapped. Everything else a person does — sending, reading, joining —
 * happens under device keys. `docs/03` §1: it is needed only for enrolling a
 * device, revoking one, rotating itself, and signing IdP moves.
 */
import * as opaque from '@serenity-kit/opaque';

/** The subset of the wasm `Envelope` this needs. Injected so tests can be honest. */
export interface EnvelopeApi {
  generateAccountKey(): Uint8Array;
  accountPublic(seed: Uint8Array): Uint8Array;
  kekFromExportKey(exportKey: Uint8Array): Uint8Array;
  recoveryKey(code: string, salt: Uint8Array): Uint8Array;
  recoveryVerifier(rk: Uint8Array): Uint8Array;
  wrap(seed: Uint8Array, key: Uint8Array): Uint8Array;
  unwrap(wrap: Uint8Array, key: Uint8Array): Uint8Array;
  generateRecoveryCode(): string;
  generateSalt(): Uint8Array;
}

/** `fetch`, narrowed to what this uses. The IdP's base URL is baked in. */
export interface IdpTransport {
  post(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
}

/**
 * A device's own keys, and the certificate the account signed for them.
 *
 * `docs/03` §1: each device generates its own signing key, and the account key
 * signs a certificate binding it. The device key is what actually sits in MLS
 * groups — one leaf per device, as RFC 9420 intends — so it has to outlive the
 * moment the account key was available, which is why it comes back here rather
 * than staying inside the signer.
 */
export interface DeviceMaterial {
  certificate: Uint8Array;
  devicePub: Uint8Array;
  /** Stored on this device and nowhere else. Never uploaded. */
  deviceSecret: Uint8Array;
}

export interface EnrolDeps {
  transport: IdpTransport;
  envelope: EnvelopeApi;
  /** Generates a device key and signs its certificate. Platform-specific. */
  signDeviceCert(accountSeed: Uint8Array, label: string): Promise<DeviceMaterial>;
  /** What to call this device in its certificate. Shown on the devices screen. */
  deviceLabel?: string;
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** What every one of these flows ends with: the account key, in hand. */
export interface Enrolled {
  accountPub: string;
  handle: string;
  /** The account private seed. Seal it to the device and forget this copy. */
  accountKey: Uint8Array;
  /**
   * This device's own key and certificate.
   *
   * Minted by every flow that produces an account key, because every one of
   * them is happening *on a device that does not have one yet* — `docs/03` §3:
   * "generate a device key, sign its device cert with the account key, upload
   * the cert". A device without this can hold an account and cannot act as one
   * at a Host.
   */
  device: DeviceMaterial;
}

export interface SignUpResult extends Enrolled {
  /**
   * Shown once, and never again (`docs/03` §3).
   *
   * The caller **must** put this in front of the person with an acknowledgement
   * they cannot skip. It is the only thing standing between "I forgot my
   * password" and "the account is gone".
   */
  recoveryCode: string;
}

export interface SignUpInput {
  handle: string;
  password: string;
  deviceLabel: string;
}

/**
 * Create an account.
 *
 * Order matters and is not arbitrary: the account key exists before OPAQUE runs,
 * because the key is *not* derived from the password — deriving it would make a
 * password change an identity change (`docs/03` §1).
 */
export async function signUp(deps: EnrolDeps, input: SignUpInput): Promise<SignUpResult> {
  await opaque.ready;
  const { envelope, transport } = deps;

  const accountKey = envelope.generateAccountKey();
  const accountPub = b64url(envelope.accountPublic(accountKey));
  const recoveryCode = envelope.generateRecoveryCode();

  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
    password: input.password,
  });
  const started = await transport.post('/idp/register/start', {
    handle: input.handle,
    request: registrationRequest,
  });
  const { response } = expect<{ response: string }>(started, 'register_start_failed');

  const { registrationRecord, exportKey } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse: response,
    password: input.password,
  });

  // Both wraps, always. The server refuses an account without them, and this is
  // the side that has to build them — an account with only the password wrap is
  // one where forgetting the password is fatal.
  const kek = envelope.kekFromExportKey(unb64url(exportKey));
  const salt = envelope.generateSalt();
  const rk = envelope.recoveryKey(recoveryCode, salt);

  const device = await deps.signDeviceCert(accountKey, input.deviceLabel);

  const finished = await transport.post('/idp/register/finish', {
    handle: input.handle,
    record: registrationRecord,
    accountPub,
    wraps: [
      { kind: 'password', blob: b64(envelope.wrap(accountKey, kek)) },
      { kind: 'recovery', blob: b64(envelope.wrap(accountKey, rk)), salt: b64(salt) },
    ],
    deviceCert: b64(device.certificate),
    recoveryVerifier: b64(envelope.recoveryVerifier(rk)),
  });
  const account = expect<{ handle: string; accountPub: string }>(finished, 'handle_taken');

  return {
    accountPub: account.accountPub,
    handle: account.handle,
    accountKey,
    recoveryCode,
    device,
  };
}

export interface SignInInput {
  handle: string;
  password: string;
  /** Supplied on the second attempt, after `totp_required`. */
  totp?: string;
}

/**
 * Sign in on a new device: handle, password, second factor. Nothing else.
 *
 * `docs/03` §3 calls this "the normal case" and means it — no other device and
 * no recovery code, because a sign-in that needs one of those is a sign-in
 * people cannot do from a hotel at midnight.
 */
export async function signIn(deps: EnrolDeps, input: SignInInput): Promise<Enrolled> {
  await opaque.ready;
  const { envelope, transport } = deps;

  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({
    password: input.password,
  });
  const started = await transport.post('/idp/login/start', {
    handle: input.handle,
    request: startLoginRequest,
  });
  const { response, session } = expect<{ response: string; session: string }>(
    started,
    'bad_credentials',
  );

  const result = opaque.client.finishLogin({
    clientLoginState,
    loginResponse: response,
    password: input.password,
  });
  // The *client* detects a wrong password first — a property of the protocol,
  // not of our server. Nothing is sent, so nothing is learned.
  if (!result) throw new EnrolError('bad_credentials');

  const finished = await transport.post('/idp/login/finish', {
    session,
    request: result.finishLoginRequest,
    ...(input.totp ? { totp: input.totp } : {}),
  });
  const body = expect<{ accountPub: string; handle: string; wraps: StoredWrapWire[] }>(
    finished,
    'bad_credentials',
  );

  const wrap = body.wraps.find((w) => w.kind === 'password');
  if (!wrap) throw new EnrolError('no_password_wrap');

  const kek = envelope.kekFromExportKey(unb64url(result.exportKey));
  // A wrap that does not open here means the server handed back somebody else's
  // blob, or the wrong one — either way it throws rather than returning a key
  // that is not the account's.
  const accountKey = envelope.unwrap(unb64(wrap.blob), kek);

  return {
    accountPub: body.accountPub,
    handle: body.handle,
    accountKey,
    device: await enrolThisDevice(deps, accountKey),
  };
}

export interface RecoverInput {
  handle: string;
  /** As typed. Normalised inside the envelope — see `normaliseRecoveryCode`. */
  code: string;
}

/**
 * "I forgot my password."
 *
 * Two round trips: fetch the salt, then prove the code. The salt comes back for
 * *any* handle, so a wrong one fails at the second step exactly like a wrong
 * code — which is deliberate, and the reason this cannot be used to find out
 * who has an account here.
 */
export async function recover(deps: EnrolDeps, input: RecoverInput): Promise<Enrolled> {
  const { envelope, transport } = deps;

  const started = await transport.post('/idp/recover/start', { handle: input.handle });
  const { salt } = expect<{ salt: string }>(started, 'bad_credentials');

  // Argon2id. The slow step, and the one worth a spinner.
  const rk = envelope.recoveryKey(input.code, unb64(salt));

  const finished = await transport.post('/idp/recover/finish', {
    handle: input.handle,
    verifier: b64(envelope.recoveryVerifier(rk)),
  });
  const body = expect<{ accountPub: string; handle: string; wraps: StoredWrapWire[] }>(
    finished,
    'bad_credentials',
  );

  const wrap = body.wraps.find((w) => w.kind === 'recovery');
  if (!wrap) throw new EnrolError('no_recovery_wrap');

  const accountKey = envelope.unwrap(unb64(wrap.blob), rk);
  return {
    accountPub: body.accountPub,
    handle: body.handle,
    accountKey,
    device: await enrolThisDevice(deps, accountKey),
  };
}

export interface ResetInput extends RecoverInput {
  newPassword: string;
}

/**
 * Choose a new password, having just recovered.
 *
 * `docs/03` §1's "password change = re-wrap one blob", from the client side: a
 * fresh OPAQUE registration and one new wrap. **The recovery wrap is left
 * alone**, so the code that got you here still works — a recovery that spent the
 * only thing making it possible would be a trap rather than a feature.
 */
export async function resetPassword(deps: EnrolDeps, input: ResetInput): Promise<Enrolled> {
  await opaque.ready;
  const { envelope, transport } = deps;

  const recovered = await recover(deps, input);

  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
    password: input.newPassword,
  });
  const started = await transport.post('/idp/register/start', {
    handle: input.handle,
    request: registrationRequest,
  });
  const { response } = expect<{ response: string }>(started, 'register_start_failed');

  const { registrationRecord, exportKey } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse: response,
    password: input.newPassword,
  });

  const started2 = await transport.post('/idp/recover/start', { handle: input.handle });
  const { salt } = expect<{ salt: string }>(started2, 'bad_credentials');
  const rk = envelope.recoveryKey(input.code, unb64(salt));

  const kek = envelope.kekFromExportKey(unb64url(exportKey));
  const reset = await transport.post('/idp/recover/reset', {
    handle: input.handle,
    verifier: b64(envelope.recoveryVerifier(rk)),
    record: registrationRecord,
    wrap: b64(envelope.wrap(recovered.accountKey, kek)),
  });
  expect(reset, 'bad_credentials');

  return recovered;
}

// ---------------------------------------------------------------------------

/**
 * Mint this device's key and register its certificate.
 *
 * Every flow that produces an account key is running on a device that does not
 * have one yet, so this is the same three lines each time: generate, sign,
 * upload. Uploading is best-effort — a Host that is unreachable must not turn a
 * successful sign-in into a failure, and the certificate is re-registrable at
 * any time because registration is idempotent.
 */
async function enrolThisDevice(deps: EnrolDeps, accountKey: Uint8Array): Promise<DeviceMaterial> {
  const device = await deps.signDeviceCert(accountKey, deps.deviceLabel ?? 'this device');
  await deps.transport
    .post('/idp/devices', { certificate: b64(device.certificate) })
    .catch(() => undefined);
  return device;
}

interface StoredWrapWire {
  kind: string;
  blob: string;
  salt?: string;
}

/** Every failure a caller can meaningfully act on. Deliberately few. */
export class EnrolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'EnrolError';
  }
}

/**
 * Unwrap a response, or throw the server's own error code.
 *
 * The server's codes are the vocabulary — `bad_credentials`, `totp_required`,
 * `handle_taken` — and passing them straight through means the UI branches on
 * what actually happened rather than on a status number.
 */
function expect<T>(res: { status: number; body: unknown }, fallback: string): T {
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const code =
    typeof res.body === 'object' && res.body !== null && 'error' in res.body
      ? String((res.body as { error: unknown }).error)
      : fallback;
  throw new EnrolError(code);
}

/** OPAQUE speaks base64url; the envelope speaks bytes. */
const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const unb64url = (text: string): Uint8Array =>
  unb64(text.replaceAll('-', '+').replaceAll('_', '/'));
