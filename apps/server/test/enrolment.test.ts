/**
 * Signing up and signing in (`docs/03` §3).
 *
 * Driven through the real routes with the real OPAQUE implementation, because
 * the interesting claims are not about any one function:
 *
 * - The IdP **cannot** derive the account key from anything it stores.
 * - A wrong password is refused, and looks identical to an unknown handle.
 * - The wraps are released only after a finished login, and only after 2FA when
 *   one is enrolled.
 * - Sign-up refuses to create an account that has no way back from a forgotten
 *   password.
 */

import { issueDeviceCert, SnowflakeFactory, toAccountId, toBase64 } from '@revel/protocol';
import * as opaque from '@serenity-kit/opaque';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory.js';
import { totpAt } from '../src/totp.js';

let serverSetup: string;

/**
 * A real account key and a real certificate for one of its devices.
 *
 * `register/finish` verifies the certificate and checks it names the account
 * being enrolled — without that, the route was a handle-transfer primitive for
 * anybody who could type — so these have to be genuine rather than the two
 * base64 strings that used to stand in for them.
 */
async function identity(label: string) {
  const account = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const device = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const accountPub = new Uint8Array(await crypto.subtle.exportKey('raw', account.publicKey));
  const devicePub = new Uint8Array(await crypto.subtle.exportKey('raw', device.publicKey));
  return {
    accountPub: toAccountId(accountPub),
    devicePub: toAccountId(devicePub),
    cert: toBase64(await issueDeviceCert(account.privateKey, accountPub, devicePub, label)),
  };
}

type Identity = Awaited<ReturnType<typeof identity>>;
let primary: Identity;
let secondary: Identity;

beforeAll(async () => {
  await opaque.ready;
  serverSetup = opaque.server.createSetup();
  primary = await identity('viola laptop');
  secondary = await identity('somebody else');

  // A real record for an account nobody owns, so `/idp/login/start` can run the
  // same exchange for an unknown handle as for a known one. Production builds
  // this at boot; a test that skipped it would be testing a misconfiguration.
  const password = 'a password nobody keeps';
  const registration = opaque.client.startRegistration({ password });
  const { registrationResponse } = opaque.server.createRegistrationResponse({
    serverSetup,
    userIdentifier: 'decoy@idp.example',
    registrationRequest: registration.registrationRequest,
  });
  decoyRecord = opaque.client.finishRegistration({
    password,
    registrationResponse,
    clientRegistrationState: registration.clientRegistrationState,
  }).registrationRecord;
});

let decoyRecord: string;

/** The `OpaqueServer` the routes take, bound to one setup. */
const opaqueServer = () => ({
  createRegistrationResponse: (input: { userIdentifier: string; registrationRequest: string }) =>
    opaque.server.createRegistrationResponse({ serverSetup, ...input }),
  startLogin: (input: {
    userIdentifier: string;
    registrationRecord: string;
    startLoginRequest: string;
  }) => opaque.server.startLogin({ serverSetup, ...input }),
  finishLogin: (input: { serverLoginState: string; finishLoginRequest: string }) =>
    opaque.server.finishLogin(input),
});

let store: MemoryStore;
let app: ReturnType<typeof createApp>;
/** Who `authenticate` says the caller is. Set per test. */
let actor: { accountId: string; devicePub: string } | null;
/**
 * The IdP's clock, movable.
 *
 * TOTP is time-based, so a test that cannot move the clock cannot check a code
 * expiring, a replay one step later, or the window boundary — which is most of
 * what there is to get wrong.
 */
let clock: number;
const STEP = 30_000;

beforeEach(() => {
  store = new MemoryStore();
  actor = null;
  // Starts at the real clock rather than a fixed date, because the *store's*
  // login-session expiry uses `Date.now()` and is not what these tests are
  // about — a clock pinned to 2023 makes every session look long expired. It
  // still only ever moves forward, and only within a session's two minutes.
  clock = Date.now();
  app = createApp({
    now: () => clock,
    store,
    hub: { broadcast: () => {} } as never,
    ids: new SnowflakeFactory(0),
    authenticate: async () => actor,
    host: 'idp.example',
    idp: 'idp.example',
    opaque: opaqueServer(),
    decoyKey: 'a-long-lived-server-secret',
    decoyRecord,
  });
});

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// The real ones, filled in by `beforeAll`. Getters so the module-level names
// still read the same at every call site.
const account = () => primary.accountPub;
const cert = () => primary.cert;
/** Stands in for `HKDF(RK, …)`. The routes only ever compare it. */
const VERIFIER = btoa('proof-of-recovery-code');
const b64 = (s: string) => btoa(s);

/** Register `handle` with `password`. Returns the client's exportKey. */
async function register(handle: string, password: string, who: Identity = primary) {
  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
    password,
  });
  const start = await post('/idp/register/start', { handle, request: registrationRequest });
  const { response } = await start.json();

  const { registrationRecord, exportKey } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse: response,
    password,
  });

  const finish = await post('/idp/register/finish', {
    handle,
    record: registrationRecord,
    accountPub: who.accountPub,
    wraps: [
      { kind: 'password', blob: b64('wrapped under KEK') },
      { kind: 'recovery', blob: b64('wrapped under RK'), salt: b64('salt') },
    ],
    deviceCert: who.cert,
    recoveryVerifier: VERIFIER,
  });
  return { finish, exportKey };
}

/** Attempt a login. Returns the finish response. */
async function login(handle: string, password: string, totp?: string) {
  const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password });
  const start = await post('/idp/login/start', { handle, request: startLoginRequest });
  if (start.status !== 200) return { start, finish: start, exportKey: null };

  const { response, session } = await start.json();
  const result = opaque.client.finishLogin({
    clientLoginState,
    loginResponse: response,
    password,
  });
  // A wrong password produces no client output at all — the client detects it
  // first, which is a property of the protocol rather than of this server.
  if (!result) {
    const finish = await post('/idp/login/finish', {
      session,
      request: startLoginRequest,
      ...(totp ? { totp } : {}),
    });
    return { start, finish, exportKey: null };
  }

  const finish = await post('/idp/login/finish', {
    session,
    request: result.finishLoginRequest,
    ...(totp ? { totp } : {}),
  });
  return { start, finish, exportKey: result.exportKey };
}

describe('signing up', () => {
  it('registers, and the export key is the same one login produces', async () => {
    // The property the whole envelope rests on: the KEK derived at sign-up and
    // the KEK derived at sign-in are the same, or the password wrap never opens
    // again.
    const { finish, exportKey } = await register('viola', 'correct horse battery staple');
    expect(finish.status).toBe(201);

    const { exportKey: again } = await login('viola', 'correct horse battery staple');
    expect(again).toBe(exportKey);
  });

  it('stores nothing that opens anything', async () => {
    // The claim that makes this design worth the complexity. What the IdP holds
    // is a record it cannot invert and blobs it cannot open — there is no
    // password hash to crack and no key to steal.
    await register('viola', 'hunter2');
    const enrolment = await store.getEnrolment('viola');
    expect(enrolment).not.toBeNull();
    expect(JSON.stringify(enrolment)).not.toContain('hunter2');
    for (const wrap of await store.wrapsFor(account())) {
      expect(atob(wrap.blob)).not.toContain('hunter2');
    }
  });

  it('refuses an account with no way back from a forgotten password', async () => {
    // **Both wraps or no account.** A sign-up that skipped the recovery wrap
    // produces an account where forgetting the password is fatal, and it looks
    // completely fine until the day it is not. Enforced here rather than
    // trusted to the client, because the client is the thing that might be buggy.
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
      password: 'x',
    });
    const start = await post('/idp/register/start', {
      handle: 'nowayback',
      request: registrationRequest,
    });
    const { registrationRecord } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse: (await start.json()).response,
      password: 'x',
    });

    const finish = await post('/idp/register/finish', {
      handle: 'nowayback',
      record: registrationRecord,
      accountPub: account(),
      wraps: [
        { kind: 'password', blob: b64('a') },
        { kind: 'passkey', blob: b64('b') },
      ],
      deviceCert: cert(),
      recoveryVerifier: VERIFIER,
    });
    expect(finish.status).toBe(400);
    expect((await finish.json()).error).toBe('wraps_incomplete');
    expect(await store.getEnrolment('nowayback')).toBeNull();
  });

  it('refuses to bind a handle to an account key the caller cannot prove', async () => {
    // The hijack this closes. `accountPub` used to be taken from the body and
    // believed, so anybody could enrol against somebody else's account key —
    // and `claimHandle` would then *move* that account's existing handle onto
    // whatever name the attacker asked for, freeing the old one for them to
    // take and leaving the owner unable to ever enrol under their own key.
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
      password: 'attacker',
    });
    const start = await post('/idp/register/start', {
      handle: 'stolen',
      request: registrationRequest,
    });
    const { response } = await start.json();
    const { registrationRecord } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse: response,
      password: 'attacker',
    });

    const finish = await post('/idp/register/finish', {
      handle: 'stolen',
      record: registrationRecord,
      // Somebody else's account…
      accountPub: primary.accountPub,
      wraps: [
        { kind: 'password', blob: b64('mine') },
        { kind: 'recovery', blob: b64('mine'), salt: b64('salt') },
      ],
      // …with a certificate only the attacker's own key ever signed.
      deviceCert: secondary.cert,
      recoveryVerifier: VERIFIER,
    });
    expect(finish.status).toBe(403);
    expect(await finish.json()).toMatchObject({ error: 'certificate_account_mismatch' });
  });

  it('refuses a certificate that is not a certificate', async () => {
    const { finish } = await register('viola', 'pw', {
      ...primary,
      cert: b64('not a certificate'),
    });
    expect(finish.status).toBe(400);
    expect(await finish.json()).toMatchObject({ error: 'invalid_certificate' });
  });

  it('will not rename an account that already has a handle', async () => {
    // Renaming is `POST /idp/accounts/me/handle`, which needs a session. This
    // route may only ever bind a name to an account that has none.
    await register('viola', 'pw');
    const { finish } = await register('viola-again', 'pw');
    expect(finish.status).toBe(409);
    expect(await finish.json()).toMatchObject({ error: 'account_already_named' });
    expect((await store.getAccount(account()))?.handle).toBe('viola');
  });

  it('refuses a recovery wrap with no salt', async () => {
    // Without the salt the recovery key cannot be re-derived, so the wrap is a
    // blob nobody can ever open — the same failure as not having one, dressed
    // up as success.
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
      password: 'x',
    });
    const start = await post('/idp/register/start', {
      handle: 'nosalt',
      request: registrationRequest,
    });
    const { registrationRecord } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse: (await start.json()).response,
      password: 'x',
    });
    const finish = await post('/idp/register/finish', {
      handle: 'nosalt',
      record: registrationRecord,
      accountPub: account(),
      wraps: [
        { kind: 'password', blob: b64('a') },
        { kind: 'recovery', blob: b64('b') },
      ],
      deviceCert: cert(),
      recoveryVerifier: VERIFIER,
    });
    expect(finish.status).toBe(400);
  });

  it('will not let a second account take a handle', async () => {
    // Overwriting would be an account takeover with no password in it.
    await register('viola', 'first');
    const { finish } = await register('viola', 'second', secondary);
    expect(finish.status).toBe(409);

    // And the original still works.
    const { exportKey } = await login('viola', 'first');
    expect(exportKey).toBeTruthy();
  });

  it('folds the handle once, at the edge', async () => {
    // `Viola` and `viola` being two accounts is an impersonation vector.
    await register('Viola', 'pw');
    expect(await store.getEnrolment('viola')).not.toBeNull();
    const { exportKey } = await login('VIOLA', 'pw');
    expect(exportKey).toBeTruthy();
  });
});

describe('signing in', () => {
  beforeEach(async () => {
    await register('viola', 'correct horse battery staple');
  });

  it('releases the wraps after a finished login', async () => {
    const { finish } = await login('viola', 'correct horse battery staple');
    expect(finish.status).toBe(200);
    const body = await finish.json();
    expect(body.accountPub).toBe(account());
    expect(body.wraps.map((w: { kind: string }) => w.kind).sort()).toEqual([
      'password',
      'recovery',
    ]);
  });

  it('refuses a wrong password and releases nothing', async () => {
    const { finish } = await login('viola', 'not the password');
    expect(finish.status).toBe(401);
    expect((await finish.json()).error).toBe('bad_credentials');
  });

  it('answers an unknown handle exactly as it answers a wrong password', async () => {
    // Telling them apart is an oracle for which handles exist, and "does this
    // person have an account here" is not a stranger's business.
    const unknown = await post('/idp/login/start', { handle: 'nobody', request: 'AAAA' });
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toBe('bad_credentials');

    const wrong = await login('viola', 'wrong');
    expect((await wrong.finish.json()).error).toBe('bad_credentials');
  });

  it('starts a login for an unknown handle exactly as it does for a real one', async () => {
    // The oracle this closes: `/idp/login/start` used to answer 401 the moment
    // the handle was unknown, in the cheapest rate-limit class on the box,
    // directly beneath a comment claiming it did not distinguish them.
    await register('viola', 'pw');

    const attempt = async (handle: string) => {
      const { startLoginRequest } = opaque.client.startLogin({ password: 'pw' });
      const res = await post('/idp/login/start', { handle, request: startLoginRequest });
      return { status: res.status, body: (await res.json()) as { response: string } };
    };

    const known = await attempt('viola');
    const unknown = await attempt('nobody-here');

    expect(unknown.status).toBe(known.status);
    expect(unknown.body.response).toHaveLength(known.body.response.length);
    expect(unknown.body).toHaveProperty('session');
  });

  it('refuses malformed login bytes identically whether or not the handle exists', async () => {
    // The subtler half of the same oracle, and the reason a synthesised decoy
    // response was not enough: an attacker who sends deliberate garbage learns
    // the answer from *which* failure comes back, unless the unknown-handle
    // path runs the same parser.
    await register('viola', 'pw');
    const garbage = 'AAAA';

    const known = await post('/idp/login/start', { handle: 'viola', request: garbage });
    const unknown = await post('/idp/login/start', { handle: 'nobody-here', request: garbage });

    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it('spends a login session exactly once', async () => {
    // An OPAQUE server state that can be spent twice is a replay.
    const { clientLoginState, startLoginRequest } = opaque.client.startLogin({
      password: 'correct horse battery staple',
    });
    const start = await post('/idp/login/start', { handle: 'viola', request: startLoginRequest });
    const { response, session } = await start.json();
    const result = opaque.client.finishLogin({
      clientLoginState,
      loginResponse: response,
      password: 'correct horse battery staple',
    });

    const first = await post('/idp/login/finish', {
      session,
      request: result.finishLoginRequest,
    });
    expect(first.status).toBe(200);

    const replay = await post('/idp/login/finish', {
      session,
      request: result.finishLoginRequest,
    });
    expect(replay.status).toBe(401);
  });
});

describe('recovering', () => {
  beforeEach(async () => {
    await register('viola', 'the forgotten one');
  });

  it('releases the wraps to somebody who proves the code', async () => {
    // `docs/03` §4: the IdP cannot reset a password, so recovery opens a
    // different wrap. This is the route that makes that possible at all.
    const start = await post('/idp/recover/start', { handle: 'viola' });
    expect(start.status).toBe(200);
    expect((await start.json()).salt).toBe(b64('salt'));

    const finish = await post('/idp/recover/finish', { handle: 'viola', verifier: VERIFIER });
    expect(finish.status).toBe(200);
    const body = await finish.json();
    expect(body.accountPub).toBe(account());
    expect(body.wraps.map((w: { kind: string }) => w.kind)).toContain('recovery');
  });

  it('refuses a wrong verifier', async () => {
    const finish = await post('/idp/recover/finish', {
      handle: 'viola',
      verifier: btoa('not the code'),
    });
    expect(finish.status).toBe(401);
    expect((await finish.json()).error).toBe('bad_credentials');
  });

  it('answers an unknown handle with a salt, like every other handle', async () => {
    // **The oracle this endpoint would otherwise be.** An unknown handle that
    // got no answer, or a different shape of one, would tell a stranger who has
    // an account here — which is what the rest of this file spends its effort
    // avoiding.
    const known = await post('/idp/recover/start', { handle: 'viola' });
    const unknown = await post('/idp/recover/start', { handle: 'nobody-at-all' });

    expect(unknown.status).toBe(known.status);
    expect(Object.keys(await unknown.json())).toEqual(Object.keys(await known.json()));
  });

  it('gives the same made-up salt every time, so asking twice gives nothing away', async () => {
    // A random one would reveal on the second request that there was nothing
    // behind it.
    const first = await (await post('/idp/recover/start', { handle: 'ghost' })).json();
    const second = await (await post('/idp/recover/start', { handle: 'ghost' })).json();
    expect(first.salt).toBe(second.salt);
    // And a different handle gets a different one, or it is not a salt.
    const other = await (await post('/idp/recover/start', { handle: 'other-ghost' })).json();
    expect(other.salt).not.toBe(first.salt);
  });

  it('refuses an unknown handle at finish exactly as it refuses a wrong code', async () => {
    const unknown = await post('/idp/recover/finish', {
      handle: 'nobody-at-all',
      verifier: VERIFIER,
    });
    const wrong = await post('/idp/recover/finish', {
      handle: 'viola',
      verifier: btoa('wrong'),
    });
    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it('resets the password and leaves the recovery code working', async () => {
    // `docs/03` §1: a password change is a new record and one re-wrap. The
    // recovery wrap is untouched, so the code somebody just used still works —
    // otherwise recovering would spend the only thing that made it possible.
    const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({
      password: 'a brand new password',
    });
    const start = await post('/idp/register/start', {
      handle: 'viola',
      request: registrationRequest,
    });
    const { registrationRecord } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse: (await start.json()).response,
      password: 'a brand new password',
    });

    const reset = await post('/idp/recover/reset', {
      handle: 'viola',
      verifier: VERIFIER,
      record: registrationRecord,
      wrap: b64('rewrapped under the new KEK'),
    });
    expect(reset.status).toBe(200);

    // The new password works...
    const fresh = await login('viola', 'a brand new password');
    expect(fresh.finish.status).toBe(200);
    // ...the old one does not...
    const stale = await login('viola', 'the forgotten one');
    expect(stale.finish.status).toBe(401);
    // ...and the recovery code still does.
    const again = await post('/idp/recover/finish', { handle: 'viola', verifier: VERIFIER });
    expect(again.status).toBe(200);
  });

  it('will not reset a password without the code', async () => {
    const reset = await post('/idp/recover/reset', {
      handle: 'viola',
      verifier: btoa('nope'),
      record: 'AAAA',
      wrap: b64('mine now'),
    });
    expect(reset.status).toBe(401);
    // And the original password still works, which is the point.
    expect((await login('viola', 'the forgotten one')).finish.status).toBe(200);
  });
});

describe('adding a device from one you are holding', () => {
  const TRANSFER_PUB = btoa('a-single-use-transfer-public-key');

  beforeEach(async () => {
    await register('viola', 'pw');
  });

  it('relays a sealed key from the old device to the new one', async () => {
    // `docs/03` §3's convenient case. Possession of an enrolled device is the
    // second factor, which is why nothing here asks for a code.
    const opened = await post('/idp/enrol/channel', { transferPub: TRANSFER_PUB });
    expect(opened.status).toBe(201);
    const { channel } = await opened.json();

    // Nothing there yet, and polling must not destroy the channel.
    const waiting = await app.request(`/idp/enrol/channel/${channel}`);
    expect((await waiting.json()).delivery).toBeNull();

    actor = { accountId: account(), devicePub: 'old-device' };
    const delivery = {
      sealed: btoa('the account key, sealed to the transfer key'),
      deviceCert: cert(),
      accountPub: account(),
      handle: 'viola',
    };
    const sent = await post(`/idp/enrol/channel/${channel}`, delivery);
    expect(sent.status).toBe(204);

    const arrived = await app.request(`/idp/enrol/channel/${channel}`);
    expect((await arrived.json()).delivery).toEqual(delivery);
  });

  it('opens a channel without credentials, because the new device has none', () => {
    // The whole point: the new device has nothing yet — that is what it is here
    // to get. What stops this being useful to a stranger is that nothing
    // arrives unless somebody with an enrolled device confirms.
    actor = null;
    return post('/idp/enrol/channel', { transferPub: TRANSFER_PUB }).then((res) =>
      expect(res.status).toBe(201),
    );
  });

  it('refuses a delivery from somebody not signed in', async () => {
    const { channel } = await (
      await post('/idp/enrol/channel', { transferPub: TRANSFER_PUB })
    ).json();
    actor = null;
    const sent = await post(`/idp/enrol/channel/${channel}`, {
      sealed: btoa('x'),
      deviceCert: cert(),
      accountPub: account(),
      handle: 'viola',
    });
    expect(sent.status).toBe(401);
  });

  it('refuses a delivery for an account that is not the sender own', async () => {
    // **The one that matters.** Without this check any signed-in device could
    // push its own account key into somebody else's pending channel — enrolling
    // *their* new device into *your* account, with no way for them to notice.
    const { channel } = await (
      await post('/idp/enrol/channel', { transferPub: TRANSFER_PUB })
    ).json();
    actor = { accountId: 'c29tZWJvZHktZWxzZQ', devicePub: 'their-device' };

    const sent = await post(`/idp/enrol/channel/${channel}`, {
      sealed: btoa('my key, in your channel'),
      deviceCert: cert(),
      accountPub: account(),
      handle: 'viola',
    });
    expect(sent.status).toBe(403);

    const still = await app.request(`/idp/enrol/channel/${channel}`);
    expect((await still.json()).delivery).toBeNull();
  });

  it('accepts exactly one delivery', async () => {
    // A channel that took a second would let anybody who saw the QR overwrite
    // what the real device sent.
    const { channel } = await (
      await post('/idp/enrol/channel', { transferPub: TRANSFER_PUB })
    ).json();
    actor = { accountId: account(), devicePub: 'old-device' };
    const body = {
      sealed: btoa('first'),
      deviceCert: cert(),
      accountPub: account(),
      handle: 'viola',
    };

    expect((await post(`/idp/enrol/channel/${channel}`, body)).status).toBe(204);
    const second = await post(`/idp/enrol/channel/${channel}`, {
      ...body,
      sealed: btoa('second'),
    });
    expect(second.status).toBe(404);
  });

  it('is gone once the new device has taken it', async () => {
    const { channel } = await (
      await post('/idp/enrol/channel', { transferPub: TRANSFER_PUB })
    ).json();
    actor = { accountId: account(), devicePub: 'old-device' };
    await post(`/idp/enrol/channel/${channel}`, {
      sealed: btoa('x'),
      deviceCert: cert(),
      accountPub: account(),
      handle: 'viola',
    });

    expect((await app.request(`/idp/enrol/channel/${channel}`)).status).toBe(200);
    // Consumed. The sealed key does not sit at the IdP after it has arrived.
    expect((await app.request(`/idp/enrol/channel/${channel}`)).status).toBe(404);
  });

  it('tells the new device when the QR stops being good', async () => {
    // Five minutes: long enough to find the other device and unlock it, short
    // enough that a QR left on a screen in a café stops being an invitation.
    // The *expiry itself* is a store behaviour and is tested there, where the
    // clock can actually be driven.
    const { expiresAt } = await (
      await post('/idp/enrol/channel', { transferPub: TRANSFER_PUB })
    ).json();
    expect(expiresAt - clock).toBe(5 * 60_000);
  });
});

describe('the passkey wrap', () => {
  const PASSKEY_VERIFIER = btoa('proof-of-passkey-prf');

  beforeEach(async () => {
    await register('viola', 'pw');
    actor = { accountId: account(), devicePub: 'dev-a' };
  });

  it('is added from a signed-in device, and then opens the account', async () => {
    // `docs/03` §3's "second low-friction wrap": enrolled *from* an account you
    // already have open, and used later when the password is gone.
    const put = await post('/idp/wraps/passkey', {
      blob: b64('wrapped under PK'),
      verifier: PASSKEY_VERIFIER,
    });
    expect(put.status).toBe(200);

    const finish = await post('/idp/recover/finish', {
      handle: 'viola',
      kind: 'passkey',
      verifier: PASSKEY_VERIFIER,
    });
    expect(finish.status).toBe(200);
    expect((await finish.json()).wraps.map((w: { kind: string }) => w.kind)).toContain('passkey');
  });

  it('cannot be enrolled by somebody who is not signed in', async () => {
    actor = null;
    const put = await post('/idp/wraps/passkey', {
      blob: b64('mine now'),
      verifier: PASSKEY_VERIFIER,
    });
    expect(put.status).toBe(401);
  });

  it('does not let a passkey verifier open the recovery wrap, or the reverse', async () => {
    // Each verifier authorises its own wrap. Sharing one would mean a passkey
    // taken off a stolen laptop released the recovery wrap too.
    await post('/idp/wraps/passkey', { blob: b64('pk'), verifier: PASSKEY_VERIFIER });

    const crossed = await post('/idp/recover/finish', {
      handle: 'viola',
      kind: 'recovery',
      verifier: PASSKEY_VERIFIER,
    });
    expect(crossed.status).toBe(401);

    const other = await post('/idp/recover/finish', {
      handle: 'viola',
      kind: 'passkey',
      verifier: VERIFIER,
    });
    expect(other.status).toBe(401);
  });

  it('refuses an account with no passkey exactly as it refuses a wrong one', async () => {
    // "Does this account have a passkey" is not a stranger's question either.
    const none = await post('/idp/recover/finish', {
      handle: 'viola',
      kind: 'passkey',
      verifier: PASSKEY_VERIFIER,
    });
    const wrong = await post('/idp/recover/finish', {
      handle: 'viola',
      kind: 'recovery',
      verifier: btoa('wrong'),
    });
    expect(none.status).toBe(wrong.status);
    expect(await none.json()).toEqual(await wrong.json());
  });

  it('can be removed again', async () => {
    await post('/idp/wraps/passkey', { blob: b64('pk'), verifier: PASSKEY_VERIFIER });
    expect((await post('/idp/wraps/passkey/remove', {})).status).toBe(204);

    const after = await post('/idp/recover/finish', {
      handle: 'viola',
      kind: 'passkey',
      verifier: PASSKEY_VERIFIER,
    });
    expect(after.status).toBe(401);
  });

  it('leaves the recovery code working, because two ways back is the point', async () => {
    await post('/idp/wraps/passkey', { blob: b64('pk'), verifier: PASSKEY_VERIFIER });
    const still = await post('/idp/recover/finish', { handle: 'viola', verifier: VERIFIER });
    expect(still.status).toBe(200);
  });
});

describe('the second factor', () => {
  beforeEach(async () => {
    await register('viola', 'pw');
    actor = { accountId: account(), devicePub: 'dev-a' };
  });

  it('does not gate a login until it has been confirmed', async () => {
    // An enrolment that gated logins before a correct code proved the
    // authenticator was set up would lock somebody out with a typo.
    const enrol = await post('/idp/2fa/totp', {});
    expect(enrol.status).toBe(200);

    const { finish } = await login('viola', 'pw');
    expect(finish.status).toBe(200);
  });

  it('gates the wraps once confirmed', async () => {
    const { secret } = await (await post('/idp/2fa/totp', {})).json();
    const confirm = await post('/idp/2fa/totp/confirm', { code: totpAt(secret, clock) });
    expect(confirm.status).toBe(200);

    const without = await login('viola', 'pw');
    expect(without.finish.status).toBe(401);
    expect((await without.finish.json()).error).toBe('totp_required');

    const wrong = await login('viola', 'pw', '000000');
    expect((await wrong.finish.json()).error).toBe('totp_invalid');

    // A step later, with that step's code. The confirmation spent the previous
    // one — see the replay test below, which is why this cannot reuse it.
    clock += STEP;
    const right = await login('viola', 'pw', totpAt(secret, clock));
    expect(right.finish.status).toBe(200);
  });

  it('asks for the code only after the password checked out', async () => {
    // Asking first would tell somebody guessing passwords when they had got one
    // right, which is exactly the signal 2FA exists to deny them.
    const { secret } = await (await post('/idp/2fa/totp', {})).json();
    await post('/idp/2fa/totp/confirm', { code: totpAt(secret, clock) });

    const wrongPassword = await login('viola', 'nope', '000000');
    expect((await wrongPassword.finish.json()).error).toBe('bad_credentials');
  });

  it('will not accept the same code twice, even across enrolment and login', async () => {
    // The confirmation spends a code like any other use does. Without that, a
    // code phished during setup would still work — and setup is exactly when
    // somebody is being walked through it by a stranger on the phone.
    const { secret } = await (await post('/idp/2fa/totp', {})).json();
    const code = totpAt(secret, clock);
    await post('/idp/2fa/totp/confirm', { code });

    const replay = await login('viola', 'pw', code);
    expect((await replay.finish.json()).error).toBe('totp_invalid');
  });

  it('accepts the next step after one is spent', async () => {
    const { secret } = await (await post('/idp/2fa/totp', {})).json();
    await post('/idp/2fa/totp/confirm', { code: totpAt(secret, clock) });
    clock += STEP;
    const next = await login('viola', 'pw', totpAt(secret, clock));
    expect(next.finish.status).toBe(200);
  });

  it('can be turned off again', async () => {
    const { secret } = await (await post('/idp/2fa/totp', {})).json();
    await post('/idp/2fa/totp/confirm', { code: totpAt(secret, clock) });

    const removed = await post('/idp/2fa/totp/remove', { code: totpAt(secret, clock + STEP) });
    expect(removed.status).toBe(204);

    const after = await login('viola', 'pw');
    expect(after.finish.status).toBe(200);
  });

  it('refuses to enrol for somebody who is not signed in', async () => {
    actor = null;
    expect((await post('/idp/2fa/totp', {})).status).toBe(401);
  });
});
