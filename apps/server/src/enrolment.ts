/**
 * The IdP: signing up, signing in, and the wraps (`docs/03` §3).
 *
 * ## What this server can and cannot do
 *
 * It holds an OPAQUE registration record it cannot invert, and three wraps of
 * an account key it cannot open. **A dump of this database is not a way into
 * anybody's messages**, and there is no `password_hash` column anywhere to be
 * tempted by. That is the design, not a side effect.
 *
 * The corollary people feel: **the IdP cannot reset a password.** A server-side
 * reset would hand you a new password and no key. Recovery goes through a
 * different wrap, which is why sign-up refuses to proceed without one.
 *
 * ## The second factor is a policy gate, not cryptography
 *
 * `docs/03` §3 says so explicitly, and it is worth understanding before reading
 * the code: the wraps open only with the password-derived KEK, so an IdP that
 * skipped its own 2FA check would gain nothing it did not already lack. What
 * 2FA buys is defence against a *known* password — phishing, reuse — which is
 * the realistic attack. It gates the release of the wraps, not their contents.
 *
 * ## One refusal for three failures
 *
 * A wrong password, an unknown handle and a spent session all return
 * `bad_credentials`. Telling them apart is an oracle for which handles exist,
 * and "does this person have an account here" is exactly the question a
 * metadata-minimising product should not answer to strangers.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  DeliverToChannel,
  decodeDeviceCert,
  fromBase64,
  LoginFinish,
  LoginStart,
  OpenChannel,
  PutPasskeyWrap,
  RecoverFinish,
  RecoverStart,
  RegisterFinish,
  RegisterStart,
  ResetPassword,
  TotpConfirm,
  toAccountId,
  verifyDeviceCert,
  type Wrap,
} from '@revel/protocol';
import type { Hono } from 'hono';
import type { Actor } from './policy.js';
import type { Device, Store, StoredWrap } from './store/types.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

/**
 * An unguessable identifier, for the things whose id *is* the credential.
 *
 * A snowflake is time-ordered and mostly sequential, which is exactly right for
 * an event id and exactly wrong here: a login session and an enrol channel are
 * addressed by strangers, and knowing roughly when one was minted narrows the
 * space to something a fast loop covers. The enrol channel is the sharp end —
 * its id is the only thing standing between a stranger and delivering an
 * account key to somebody's new device.
 */
const randomId = (): string => randomBytes(24).toString('base64url');

/**
 * How long a real OPAQUE `loginResponse` is, in base64url characters.
 *
 * Pinned by a test against a genuine exchange, because the decoy below has to
 * be the same length and a library that changed this would otherwise turn the
 * decoy back into the oracle it exists to remove.
 */
export const OPAQUE_LOGIN_RESPONSE_CHARS = 427;

/** The OPAQUE implementation, injected so the routes stay testable. */
export interface OpaqueServer {
  createRegistrationResponse(input: { userIdentifier: string; registrationRequest: string }): {
    registrationResponse: string;
  };
  startLogin(input: {
    userIdentifier: string;
    registrationRecord: string;
    startLoginRequest: string;
  }): { serverLoginState: string; loginResponse: string };
  finishLogin(input: { serverLoginState: string; finishLoginRequest: string }): {
    sessionKey: string;
  };
}

export interface EnrolmentDeps {
  store: Store;
  opaque: OpaqueServer;
  /**
   * A server secret, for answers about accounts that do not exist.
   *
   * `/idp/recover/start` answers every handle, and the made-up salt has to be
   * *stable* — a random one would reveal on the second request that there was
   * nothing behind it. Any long-lived server secret does; the entrypoint passes
   * the OPAQUE setup, which is already exactly that.
   */
  decoyKey: string;
  /**
   * A real OPAQUE registration record for an account that does not exist.
   *
   * `/idp/login/start` runs against this when the handle is unknown, so an
   * unknown handle takes **the same code path** as a known one: same shape,
   * same response length, same behaviour on malformed bytes.
   *
   * That last part is why a synthesised response was not enough. Returning a
   * plausible-looking blob for unknown handles while the real path still threw
   * on unparseable `request` bytes left the oracle intact in a form an attacker
   * could ask for directly — send deliberate garbage, and a 401 meant the
   * handle existed while a 200 meant it did not.
   *
   * The entrypoint generates one at boot from a random password nobody keeps.
   * Absent — in tests, against an injected OPAQUE double — falls back to a
   * placeholder the double accepts.
   */
  decoyRecord?: string;
  /** This IdP's name. Goes in the TOTP issuer and the user identifier. */
  idp: string;
  authenticate?: (req: Request) => Promise<Actor | null>;
  newId(): string;
  now?: () => number;
}

/** How long a half-finished OPAQUE exchange stays open. */
const LOGIN_SESSION_MS = 2 * 60_000;

/**
 * Case-folded once, at the edge.
 *
 * `Viola` and `viola` being two accounts is an impersonation vector, so folding
 * happens here and everything below sees the folded form (`store/types.ts`
 * makes the same point about `getAccountByHandle`).
 */
const fold = (handle: string): string => handle.trim().toLowerCase();

/**
 * Constant-time compare of two base64 strings.
 *
 * A `===` on a verifier leaks, through timing, how many leading bytes were
 * right — which is the same mistake as comparing a TOTP code with `===`, and
 * has the same fix. Lengths are compared first because `timingSafeEqual`
 * throws on a mismatch, and that throw would itself be the signal.
 */
function matches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const toStored = (wrap: Wrap): StoredWrap => ({
  kind: wrap.kind,
  blob: wrap.blob,
  ...(wrap.salt ? { salt: wrap.salt } : {}),
});

export function mountEnrolment(app: Hono, deps: EnrolmentDeps): void {
  const now = deps.now ?? (() => Date.now());

  /** OPAQUE binds the exchange to an identifier; ours is `handle@idp`. */
  const userIdentifier = (handle: string) => `${handle}@${deps.idp}`;

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  app.post('/idp/register/start', async (c) => {
    const body = RegisterStart.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    const handle = fold(body.data.handle);
    // Deliberately *not* an early "handle taken" here. This route hands back a
    // response derived from the request and nothing about the account, so
    // answering identically either way keeps it from being a handle oracle for
    // anybody who has not yet committed to a registration. The real check is at
    // `finish`, where it is an insert that either succeeds or does not.
    // The OPAQUE library throws on bytes it cannot parse, and these bytes come
    // from a stranger. Unwrapped, that is a 500 where a 400 belongs — and a
    // different status is a different answer, which is the beginning of an
    // oracle. Found by curling the route with `AAAA`.
    try {
      const { registrationResponse } = deps.opaque.createRegistrationResponse({
        userIdentifier: userIdentifier(handle),
        registrationRequest: body.data.request,
      });
      return c.json({ response: registrationResponse });
    } catch {
      return c.json({ error: 'bad_request' }, 400);
    }
  });

  app.post('/idp/register/finish', async (c) => {
    const body = RegisterFinish.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);
    const { record, accountPub, wraps, deviceCert } = body.data;
    const handle = fold(body.data.handle);

    // **Prove the account key before binding a name to it.**
    //
    // This used to take `accountPub` from the body and believe it, which made
    // the route a handle-transfer primitive for anybody who could type: claim
    // an enrolment against somebody else's account key and `claimHandle` below
    // would *move* their existing handle onto the name you asked for, free the
    // old one for you to take, and leave them unable to ever enrol under their
    // own key.
    //
    // The certificate is the proof, and it is already in the request. It is
    // self-certifying — the account public key is inside it and signs the rest
    // — so verifying it says "whoever sent this holds a certificate the account
    // key signed", which is the thing that was missing.
    //
    // Residual, stated rather than papered over: a certificate is not a fresh
    // signature, so somebody holding a *valid and never-registered* certificate
    // for an account could still replay it here. Registering the device in the
    // same breath is what closes the ordinary version of that — every
    // certificate a co-member or a Host has seen belongs to a device that
    // registered to get there, and one already registered to another account is
    // refused below.
    const cert = decodeDeviceCert(fromBase64(deviceCert));
    if (!cert) return c.json({ error: 'invalid_certificate' }, 400);
    if (!(await verifyDeviceCert(cert))) return c.json({ error: 'bad_signature' }, 403);
    if (toAccountId(cert.accountPub) !== accountPub) {
      return c.json({ error: 'certificate_account_mismatch' }, 403);
    }

    // A handle already bound to this account is not renamed here. Changing what
    // you are called is `POST /idp/accounts/me/handle`, which needs a session.
    const held = await deps.store.getAccount(accountPub);
    if (held && held.handle !== handle) {
      return c.json({ error: 'account_already_named' }, 409);
    }

    // **Both wraps or no account.** A sign-up that skipped the recovery wrap
    // produces an account where forgetting the password is fatal, and it looks
    // completely fine until the day it isn't. Enforced here rather than trusted
    // to the client, because the client is the thing that might have a bug.
    const kinds = new Set(wraps.map((w) => w.kind));
    if (!kinds.has('password') || !kinds.has('recovery')) {
      return c.json({ error: 'wraps_incomplete' }, 400);
    }
    const recovery = wraps.find((w) => w.kind === 'recovery');
    if (!recovery?.salt) return c.json({ error: 'recovery_salt_missing' }, 400);

    const enrolment = await deps.store.createEnrolment({
      handle,
      accountPub,
      record,
      recoveryVerifier: body.data.recoveryVerifier,
      createdAt: now(),
    });
    // Taken, or this account already has a handle. One code for both: which one
    // it was is not a stranger's business.
    if (!enrolment) return c.json({ error: 'handle_taken' }, 409);

    // The device goes in with the enrolment, so the certificate that proved the
    // account key is spent rather than left replayable. Refused when that
    // device already belongs to somebody else; idempotent when it is already
    // this account's, so a retried sign-up still works.
    const device: Device = {
      pub: toAccountId(cert.devicePub),
      accountId: accountPub,
      label: cert.label,
      registeredAt: now(),
      revokedAt: null,
    };
    const { device: registered } = await deps.store.registerDevice(device);
    if (registered.accountId !== accountPub) {
      return c.json({ error: 'device_belongs_to_another_account' }, 403);
    }

    for (const wrap of wraps) {
      await deps.store.putWrap(accountPub, {
        ...toStored(wrap),
        // The verifier belongs to the wrap it authorises. `password` gets none:
        // that one is released by finishing an OPAQUE login.
        ...(wrap.kind === 'recovery' ? { verifier: body.data.recoveryVerifier } : {}),
      });
    }
    // Checked rather than fired and forgotten. The two tables can disagree —
    // somebody may have claimed this handle in the directory without ever
    // enrolling — and an enrolment whose handle points at another account's row
    // is an account you can log into and never be found as.
    const { claimed, account } = await deps.store.claimHandle({
      id: accountPub,
      handle,
      displayName: null,
      avatar: null,
      status: 'active',
      createdAt: now(),
      movedTo: null,
    });
    if (!claimed && account.id !== accountPub) {
      return c.json({ error: 'handle_taken' }, 409);
    }

    return c.json({ handle, accountPub, deviceCert }, 201);
  });

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  app.post('/idp/login/start', async (c) => {
    const body = LoginStart.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    const handle = fold(body.data.handle);
    const enrolment = await deps.store.getEnrolment(handle);

    // **An unknown handle runs the same exchange against a decoy record.**
    //
    // The comment here used to say this route's shape did not distinguish a
    // handle that exists, directly above a line that returned 401 when it did
    // not. It was the plainest membership oracle on the IdP, in the cheapest
    // rate-limit class, and every other answer in this file is careful
    // precisely so that this question cannot be asked.
    //
    // Running the real `startLogin` against a real-but-unowned record is what
    // makes the two indistinguishable: same response length, same timing, and
    // the same refusal for unparseable bytes. It fails at `finish`, where a
    // wrong password fails too.
    const record = enrolment?.record ?? deps.decoyRecord ?? 'decoy-registration-record';

    let serverLoginState: string;
    let loginResponse: string;
    try {
      ({ serverLoginState, loginResponse } = deps.opaque.startLogin({
        userIdentifier: userIdentifier(handle),
        registrationRecord: record,
        startLoginRequest: body.data.request,
      }));
    } catch {
      // Malformed bytes from a stranger. `bad_credentials` rather than
      // `bad_request`, so a garbage request and a wrong password are still the
      // same answer — the shape of the failure must not depend on how far the
      // caller got.
      return c.json({ error: 'bad_credentials' }, 401);
    }

    // Unguessable, because this id is spendable: it is the handle on the
    // server's half of a live exchange.
    const session = randomId();
    await deps.store.putLoginSession(session, {
      // Empty marks a decoy. `finish` refuses it after doing the same work.
      accountPub: enrolment?.accountPub ?? '',
      handle,
      state: serverLoginState,
      expiresAt: now() + LOGIN_SESSION_MS,
    });

    return c.json({ response: loginResponse, session });
  });

  app.post('/idp/login/finish', async (c) => {
    const body = LoginFinish.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    // Taken, not read: an OPAQUE server state that can be spent twice is a
    // replay, and this is the one place it could be.
    const session = await deps.store.takeLoginSession(body.data.session);
    if (!session) return c.json({ error: 'bad_credentials' }, 401);

    try {
      // Throws when the client's proof does not check out, which is what a
      // wrong password looks like from here.
      deps.opaque.finishLogin({
        serverLoginState: session.state,
        finishLoginRequest: body.data.request,
      });
    } catch {
      return c.json({ error: 'bad_credentials' }, 401);
    }

    // A decoy session from `start`: the handle never existed. Refused *after*
    // the OPAQUE work above, so the answer costs the same as a wrong password.
    if (!session.accountPub) return c.json({ error: 'bad_credentials' }, 401);

    // The password was right. **Now** the second factor, and only now — asking
    // for it before would tell somebody guessing passwords when they had got
    // one right, which is precisely the signal 2FA exists to deny them.
    const totp = await deps.store.getTotp(session.accountPub);
    if (totp?.confirmedAt) {
      if (!body.data.totp) return c.json({ error: 'totp_required' }, 401);
      const check = verifyTotp(totp.secret, body.data.totp, now(), totp.lastCounter ?? undefined);
      if (!check.ok) return c.json({ error: 'totp_invalid' }, 401);
      // Recorded before the wraps go out, so a code cannot be spent twice even
      // if the response never arrives.
      await deps.store.putTotp(session.accountPub, {
        ...totp,
        lastCounter: check.counter ?? totp.lastCounter,
      });
    }

    const wraps = await deps.store.wrapsFor(session.accountPub);

    return c.json({ accountPub: session.accountPub, handle: session.handle, wraps });
  });

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  /**
   * A salt for a handle that does not exist.
   *
   * Deterministic from the handle and a server secret, so asking twice gives
   * the same answer — a random one would tell an attacker, on the second
   * request, that there was nothing behind it. This is the whole reason
   * `/recover/start` can answer unconditionally.
   */
  const decoySalt = (handle: string): string =>
    createHmac('sha256', deps.decoyKey).update(`salt:${handle}`).digest('base64').slice(0, 24);

  /**
   * A verifier for a wrap that does not exist.
   *
   * The **same length** as a real one, which `decoySalt` was not: a verifier is
   * base64 of 32 bytes — 44 characters — and comparing it against a 24-character
   * decoy took the length-mismatch branch in `matches` and returned before
   * `timingSafeEqual` ran at all. The constant-time compare was there and the
   * length told you the answer anyway.
   */
  const decoyVerifier = (handle: string, kind: string): string =>
    createHmac('sha256', deps.decoyKey).update(`verifier:${kind}:${handle}`).digest('base64');

  app.post('/idp/recover/start', async (c) => {
    const body = RecoverStart.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    const handle = fold(body.data.handle);
    const kind = body.data.kind ?? 'recovery';
    const enrolment = await deps.store.getEnrolment(handle);
    const wraps = enrolment ? await deps.store.wrapsFor(enrolment.accountPub) : [];
    const salt = wraps.find((w) => w.kind === kind)?.salt;

    // **Always an answer, and always the same shape.** An unknown handle that
    // got a different response — or none — would make this a membership oracle,
    // which is what the rest of this file spends its effort avoiding. Somebody
    // with a made-up salt derives a key that opens nothing, and finds out at
    // `finish` like everybody else with a wrong code.
    return c.json({ salt: salt ?? decoySalt(handle) });
  });

  app.post('/idp/recover/finish', async (c) => {
    const body = RecoverFinish.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    const handle = fold(body.data.handle);
    const kind = body.data.kind ?? 'recovery';
    const enrolment = await deps.store.getEnrolment(handle);
    const wraps = enrolment ? await deps.store.wrapsFor(enrolment.accountPub) : [];

    // Compared in constant time, and against a fixed-length dummy when there is
    // no enrolment or no wrap of this kind — so an unknown handle, an account
    // with no passkey, and a wrong secret all take the same path.
    const expected = wraps.find((w) => w.kind === kind)?.verifier || decoyVerifier(handle, kind);
    if (!matches(expected, body.data.verifier) || !enrolment) {
      return c.json({ error: 'bad_credentials' }, 401);
    }

    return c.json({ accountPub: enrolment.accountPub, handle, wraps });
  });

  app.post('/idp/recover/reset', async (c) => {
    const body = ResetPassword.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    const handle = fold(body.data.handle);
    const kind = body.data.kind ?? 'recovery';
    const enrolment = await deps.store.getEnrolment(handle);
    const wraps = enrolment ? await deps.store.wrapsFor(enrolment.accountPub) : [];
    const expected = wraps.find((w) => w.kind === kind)?.verifier || decoyVerifier(handle, kind);
    if (!matches(expected, body.data.verifier) || !enrolment) {
      return c.json({ error: 'bad_credentials' }, 401);
    }

    // A password change *is* a new OPAQUE record plus a re-wrap, and nothing
    // else — `docs/03` §1's "password change = re-wrap one blob". The recovery
    // wrap is untouched, so the code the person just used still works.
    await deps.store.putRegistrationRecord(enrolment.accountPub, body.data.record);
    await deps.store.putWrap(enrolment.accountPub, { kind: 'password', blob: body.data.wrap });
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Adding a device from one you are holding (`docs/03` §3)
  // -------------------------------------------------------------------------

  /**
   * How long a QR is good for.
   *
   * Five minutes: long enough to find the other device and unlock it, short
   * enough that a QR left on a screen in a café stops being an invitation. A
   * channel that outlived the moment would be somewhere to leave something for
   * a device that never came.
   */
  const CHANNEL_MS = 5 * 60_000;

  app.post('/idp/enrol/channel', async (c) => {
    const body = OpenChannel.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    // **Unauthenticated, deliberately.** The whole point is that the new device
    // has no credentials yet — that is what it is here to get. What stops this
    // being useful to a stranger is that nothing arrives unless somebody with
    // an enrolled device scans the QR and taps confirm.
    // Unguessable, and this is the sharpest case in the file: possession of
    // this id is the *only* thing standing between a stranger and delivering an
    // account key to somebody's new device. A snowflake is time-ordered and
    // nearly sequential, so knowing roughly when a QR was shown narrowed it to
    // a space a loop covers in seconds.
    const channel = randomId();
    const expiresAt = now() + CHANNEL_MS;
    await deps.store.putChannel(channel, {
      transferPub: body.data.transferPub,
      delivery: null,
      expiresAt,
    });
    return c.json({ channel, expiresAt }, 201);
  });

  app.get('/idp/enrol/channel/:id', async (c) => {
    // Polled by the new device. `takeChannel` only consumes once there is
    // something to take, so polling before the other side has answered does not
    // destroy the channel it is waiting on.
    const channel = await deps.store.takeChannel(c.req.param('id'));
    if (!channel) return c.json({ error: 'no_such_channel' }, 404);
    return c.json({
      transferPub: channel.transferPub,
      delivery: channel.delivery ? JSON.parse(channel.delivery) : null,
    });
  });

  app.post('/idp/enrol/channel/:id', async (c) => {
    // Posted by the *existing* device, which is signed in. Possession of an
    // enrolled device is the second factor here (`docs/03` §3), which is why
    // this path never asks for a code.
    const actor = await deps.authenticate?.(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const body = DeliverToChannel.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    // The account being handed over has to be the one doing the handing. Without
    // this, any signed-in device could push its own account key into somebody
    // else's pending channel — which would enrol *their* new device into *your*
    // account, and the person holding it would have no way to notice.
    if (body.data.accountPub !== actor.accountId) {
      return c.json({ error: 'wrong_account' }, 403);
    }

    const delivered = await deps.store.deliverChannel(c.req.param('id'), JSON.stringify(body.data));
    // Once. A channel that accepted a second delivery would let anybody who saw
    // the QR overwrite what the real device sent.
    if (!delivered) return c.json({ error: 'no_such_channel' }, 404);
    return c.body(null, 204);
  });

  /**
   * Add or replace the passkey wrap, from a device that is signed in.
   *
   * `docs/03` §3 offers a passkey as "a second low-friction wrap", and this is
   * where it lands. Authenticated, because enrolling a passkey is something you
   * do *from* an account you already have open — the wrap is a way back in
   * later, not a way in now.
   *
   * The verifier arrives with it, for the same reason the recovery one does:
   * without it there is no way to release this wrap to somebody who has the
   * passkey and has forgotten the password, which is the only situation it
   * exists for.
   *
   * `POST` rather than `PUT`, and `/remove` rather than `DELETE`, because every
   * other route on this IdP is a POST and the client transport has exactly one
   * verb. One shape beats REST purity for a surface this small — and a `PUT`
   * the client could not send was how this was found.
   */
  app.post('/idp/wraps/passkey', async (c) => {
    const actor = await deps.authenticate?.(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const body = PutPasskeyWrap.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    await deps.store.putWrap(actor.accountId, {
      kind: 'passkey',
      blob: body.data.blob,
      verifier: body.data.verifier,
    });
    return c.json({ ok: true });
  });

  app.post('/idp/wraps/passkey/remove', async (c) => {
    const actor = await deps.authenticate?.(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);
    await deps.store.deleteWrap(actor.accountId, 'passkey');
    return c.body(null, 204);
  });

  // -------------------------------------------------------------------------
  // Second factors
  // -------------------------------------------------------------------------

  app.post('/idp/2fa/totp', async (c) => {
    const actor = await deps.authenticate?.(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    // **Replacing a confirmed second factor needs the current one.**
    //
    // Without this, a session token was enough to overwrite the secret and
    // confirm a new one — so anybody holding a stolen token could swap the
    // factor for their own and then use the phished password freely. A second
    // factor you can replace with the first factor alone is not a second
    // factor.
    const held = await deps.store.getTotp(actor.accountId);
    if (held?.confirmedAt) {
      const body = TotpConfirm.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'totp_required' }, 401);
      const check = verifyTotp(held.secret, body.data.code, now(), held.lastCounter ?? undefined);
      if (!check.ok) return c.json({ error: 'totp_invalid' }, 401);
      await deps.store.putTotp(actor.accountId, {
        ...held,
        lastCounter: check.counter ?? held.lastCounter,
      });
    }

    // Unconfirmed. An enrolment that gated logins before a correct code proved
    // the authenticator was actually set up would lock somebody out of their
    // own account with a typo.
    const secret = generateTotpSecret();
    await deps.store.putTotp(actor.accountId, {
      secret,
      lastCounter: null,
      confirmedAt: null,
    });

    return c.json({ secret, uri: totpUri('Revel', `${actor.accountId}@${deps.idp}`, secret) });
  });

  app.post('/idp/2fa/totp/confirm', async (c) => {
    const actor = await deps.authenticate?.(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const body = TotpConfirm.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request' }, 400);

    const totp = await deps.store.getTotp(actor.accountId);
    if (!totp) return c.json({ error: 'not_enrolled' }, 404);

    const check = verifyTotp(totp.secret, body.data.code, now(), totp.lastCounter ?? undefined);
    if (!check.ok) return c.json({ error: 'totp_invalid' }, 400);

    await deps.store.putTotp(actor.accountId, {
      ...totp,
      lastCounter: check.counter ?? null,
      confirmedAt: now(),
    });
    return c.json({ confirmed: true });
  });

  /**
   * Turn the second factor off. Needs a current code.
   *
   * `POST … /remove` rather than `DELETE`, matching the passkey wrap above and
   * for the reason given there: every route on this IdP is a POST because the
   * client transport has exactly one verb, and a `DELETE` carrying a required
   * body is a shape half the HTTP stack has an opinion about.
   *
   * The check is the point. Removing a factor is exactly as sensitive as
   * replacing one — a stolen session that could switch 2FA off has already
   * beaten it — so it costs the same proof.
   */
  app.post('/idp/2fa/totp/remove', async (c) => {
    const actor = await deps.authenticate?.(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const totp = await deps.store.getTotp(actor.accountId);
    if (!totp) return c.body(null, 204);

    // An unconfirmed secret gates nothing, so abandoning one needs no proof —
    // and demanding a code from an authenticator that was never finished
    // setting up would be a locked door with no key.
    if (totp.confirmedAt) {
      const body = TotpConfirm.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'totp_required' }, 401);
      const check = verifyTotp(totp.secret, body.data.code, now(), totp.lastCounter ?? undefined);
      if (!check.ok) return c.json({ error: 'totp_invalid' }, 401);
    }

    await deps.store.deleteTotp(actor.accountId);
    return c.body(null, 204);
  });
}
