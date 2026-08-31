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

import { SnowflakeFactory } from '@revel/protocol';
import * as opaque from '@serenity-kit/opaque';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory.js';
import { totpAt } from '../src/totp.js';

let serverSetup: string;
beforeAll(async () => {
  await opaque.ready;
  serverSetup = opaque.server.createSetup();
});

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
  });
});

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const ACCOUNT = 'YWNjb3VudC1wdWJsaWMta2V5LWJhc2U2NHVybA';
const CERT = btoa('a device certificate');
const b64 = (s: string) => btoa(s);

/** Register `handle` with `password`. Returns the client's exportKey. */
async function register(handle: string, password: string, accountPub = ACCOUNT) {
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
    accountPub,
    wraps: [
      { kind: 'password', blob: b64('wrapped under KEK') },
      { kind: 'recovery', blob: b64('wrapped under RK'), salt: b64('salt') },
    ],
    deviceCert: CERT,
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
    for (const wrap of await store.wrapsFor(ACCOUNT)) {
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
      accountPub: ACCOUNT,
      wraps: [
        { kind: 'password', blob: b64('a') },
        { kind: 'passkey', blob: b64('b') },
      ],
      deviceCert: CERT,
    });
    expect(finish.status).toBe(400);
    expect((await finish.json()).error).toBe('wraps_incomplete');
    expect(await store.getEnrolment('nowayback')).toBeNull();
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
      accountPub: ACCOUNT,
      wraps: [
        { kind: 'password', blob: b64('a') },
        { kind: 'recovery', blob: b64('b') },
      ],
      deviceCert: CERT,
    });
    expect(finish.status).toBe(400);
  });

  it('will not let a second account take a handle', async () => {
    // Overwriting would be an account takeover with no password in it.
    await register('viola', 'first');
    const { finish } = await register('viola', 'second', 'ZGlmZmVyZW50LWFjY291bnQ');
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
    expect(body.accountPub).toBe(ACCOUNT);
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

describe('the second factor', () => {
  beforeEach(async () => {
    await register('viola', 'pw');
    actor = { accountId: ACCOUNT, devicePub: 'dev-a' };
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

    const removed = await app.request('/idp/2fa/totp', { method: 'DELETE' });
    expect(removed.status).toBe(204);

    const after = await login('viola', 'pw');
    expect(after.finish.status).toBe(200);
  });

  it('refuses to enrol for somebody who is not signed in', async () => {
    actor = null;
    expect((await post('/idp/2fa/totp', {})).status).toBe(401);
  });
});
