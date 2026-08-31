/**
 * Signing up, signing in and recovering — both halves, together.
 *
 * The real OPAQUE implementation, the real wasm envelope, and the real routes
 * in-process. Neither half is worth much alone: the client derives a KEK the
 * server never sees, and the server holds a wrap the client has to open. **The
 * only thing that proves they agree is running them against each other**, and
 * the property they have to agree on is brutal — get it wrong and the account
 * is unrecoverable rather than broken.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import init, { Envelope } from '@revel/crypto-wasm';
import { SnowflakeFactory } from '@revel/protocol';
import { createApp, MemoryStore } from '@revel/server';
import * as opaque from '@serenity-kit/opaque';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type EnrolDeps,
  EnrolError,
  recover,
  resetPassword,
  signIn,
  signUp,
} from '../src/index.js';

const WASM = fileURLToPath(new URL('../../crypto-wasm/revel_crypto_bg.wasm', import.meta.url));

let serverSetup: string;
beforeAll(async () => {
  await init({ module_or_path: readFileSync(WASM) });
  await opaque.ready;
  serverSetup = opaque.server.createSetup();
});

/** The wasm envelope, as the client interface sees it. */
const envelope = {
  generateAccountKey: () => Envelope.generateAccountKey(),
  accountPublic: (seed: Uint8Array) => Envelope.accountPublic(seed),
  kekFromExportKey: (k: Uint8Array) => Envelope.kekFromExportKey(k),
  recoveryKey: (code: string, salt: Uint8Array) => Envelope.recoveryKey(code, salt),
  recoveryVerifier: (rk: Uint8Array) => Envelope.recoveryVerifier(rk),
  wrap: (seed: Uint8Array, key: Uint8Array) => Envelope.wrap(seed, key),
  unwrap: (w: Uint8Array, key: Uint8Array) => Envelope.unwrap(w, key),
  generateRecoveryCode: () => Envelope.generateRecoveryCode(),
  generateSalt: () => Envelope.generateSalt(),
};

let store: MemoryStore;
let deps: EnrolDeps;
/** Who the server thinks is calling. Enrolling a passkey is authenticated. */
let signedInAs: { accountId: string; devicePub: string } | null = null;

beforeEach(() => {
  store = new MemoryStore();
  signedInAs = null;
  const app = createApp({
    store,
    hub: { broadcast: () => {} } as never,
    ids: new SnowflakeFactory(0),
    // Signed in as the account under test, so the passkey route is reachable.
    authenticate: async () => signedInAs,
    host: 'idp.example',
    idp: 'idp.example',
    decoyKey: 'a-long-lived-server-secret',
    opaque: {
      createRegistrationResponse: (i) =>
        opaque.server.createRegistrationResponse({ serverSetup, ...i }),
      startLogin: (i) => opaque.server.startLogin({ serverSetup, ...i }),
      finishLogin: (i) => opaque.server.finishLogin(i),
    },
  });

  deps = {
    envelope,
    transport: {
      async post(path, body) {
        const res = await app.request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
    },
    // A stand-in device. The real one runs the wasm `Device`, which has its own
    // tests in `crates/revel-crypto`; what this file is about is enrolment.
    signDeviceCert: async (_seed, label) => ({
      certificate: new TextEncoder().encode(`cert:${label}`),
      devicePub: new Uint8Array(32).fill(1),
      deviceSecret: new Uint8Array(32).fill(2),
    }),
    deviceLabel: 'a test device',
  };
});

const PASSWORD = 'correct horse battery staple';

describe('signing up', () => {
  it('returns an account key, and a recovery code shown once', async () => {
    const result = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });

    expect(result.accountKey).toHaveLength(32);
    // 32 characters in eight even groups, for somebody copying it onto paper.
    expect(result.recoveryCode.replace(/-/g, '')).toHaveLength(32);
    expect(result.recoveryCode.split('-')).toHaveLength(8);
    expect(result.handle).toBe('viola');
  });

  it('refuses a handle somebody already has', async () => {
    await signUp(deps, { handle: 'viola', password: PASSWORD, deviceLabel: 'laptop' });
    await expect(
      signUp(deps, { handle: 'viola', password: 'other', deviceLabel: 'phone' }),
    ).rejects.toThrow(new EnrolError('handle_taken'));
  });
});

describe('signing in', () => {
  it('gets the same account key back on another device', async () => {
    // **The property the whole design rests on.** Sign-up generates a key on one
    // device; sign-in on a different one has to produce the same bytes, or the
    // account silently becomes two accounts and only one owns the history.
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });
    const arrived = await signIn(deps, { handle: 'viola', password: PASSWORD });

    expect(arrived.accountKey).toEqual(created.accountKey);
    expect(arrived.accountPub).toBe(created.accountPub);
  });

  it('refuses a wrong password without sending anything', async () => {
    await signUp(deps, { handle: 'viola', password: PASSWORD, deviceLabel: 'laptop' });
    await expect(signIn(deps, { handle: 'viola', password: 'wrong' })).rejects.toThrow(
      new EnrolError('bad_credentials'),
    );
  });

  it('refuses an unknown handle the same way', async () => {
    await expect(signIn(deps, { handle: 'nobody', password: PASSWORD })).rejects.toThrow(
      new EnrolError('bad_credentials'),
    );
  });
});

describe('recovering', () => {
  it('opens the account with the code, having forgotten the password', async () => {
    // The flow that decides whether an account is recoverable at all.
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });

    const recovered = await recover(deps, { handle: 'viola', code: created.recoveryCode });
    expect(recovered.accountKey).toEqual(created.accountKey);
  });

  it('accepts a code copied off paper by a human', async () => {
    // Lowercase, no dashes, and the letters everybody mistypes. This flow only
    // ever runs when everything else has already gone wrong.
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });
    const mangled = created.recoveryCode.toLowerCase().replace(/-/g, '');

    const recovered = await recover(deps, { handle: 'viola', code: mangled });
    expect(recovered.accountKey).toEqual(created.accountKey);
  });

  it('refuses a wrong code', async () => {
    await signUp(deps, { handle: 'viola', password: PASSWORD, deviceLabel: 'laptop' });
    await expect(
      recover(deps, { handle: 'viola', code: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789' }),
    ).rejects.toThrow(new EnrolError('bad_credentials'));
  });

  it('refuses an unknown handle at the same point a wrong code fails', async () => {
    // The salt comes back for any handle, so this gets all the way to the
    // second round trip before failing — which is the point: it cannot be used
    // to find out who has an account here.
    await expect(
      recover(deps, { handle: 'nobody', code: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789' }),
    ).rejects.toThrow(new EnrolError('bad_credentials'));
  });
});

describe('resetting the password', () => {
  it('sets a new one, and leaves the recovery code working', async () => {
    // `docs/03` §1: one re-wrap. A reset that spent the code would make
    // recovering a one-shot, which is a trap rather than a feature.
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });

    const after = await resetPassword(deps, {
      handle: 'viola',
      code: created.recoveryCode,
      newPassword: 'a brand new password',
    });
    expect(after.accountKey).toEqual(created.accountKey);

    // The new password opens the account...
    const fresh = await signIn(deps, { handle: 'viola', password: 'a brand new password' });
    expect(fresh.accountKey).toEqual(created.accountKey);

    // ...the old one does not...
    await expect(signIn(deps, { handle: 'viola', password: PASSWORD })).rejects.toThrow(
      new EnrolError('bad_credentials'),
    );

    // ...and the code still does.
    const again = await recover(deps, { handle: 'viola', code: created.recoveryCode });
    expect(again.accountKey).toEqual(created.accountKey);
  });

  it('will not reset without the code', async () => {
    await signUp(deps, { handle: 'viola', password: PASSWORD, deviceLabel: 'laptop' });
    await expect(
      resetPassword(deps, {
        handle: 'viola',
        code: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789',
        newPassword: 'mine now',
      }),
    ).rejects.toThrow(new EnrolError('bad_credentials'));
  });
});

describe('the passkey wrap', () => {
  /**
   * A stand-in authenticator.
   *
   * `navigator.credentials` needs a real device, a user gesture and a secure
   * context, so it cannot run here — which is exactly why `PrfProvider` is one
   * injected function. Everything on either side of it is real: the wrapping,
   * the upload, the fetch and the unseal all run the same code the browser does.
   */
  const authenticator = (bytes: number, declines = false, handle = 'viola') => ({
    enrol: async () => (declines ? null : new Uint8Array(32).fill(bytes)),
    // Returns the handle as well as the bytes: a passkey is a discoverable
    // credential, so the authenticator knows which account it is for.
    assert: async () => (declines ? null : { prf: new Uint8Array(32).fill(bytes), handle }),
  });

  it('adds a third door to the same key', async () => {
    const { addPasskeyWrap, unlockWithPasskey } = await import('../src/index.js');
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });
    // Enrolling a passkey is something you do *from* an account you have open.
    signedInAs = { accountId: created.accountPub, devicePub: 'this-device' };

    const withPasskey = { ...deps, prf: authenticator(3), authorization: 'device-token' };
    expect(
      await addPasskeyWrap(withPasskey, { handle: 'viola', accountKey: created.accountKey }),
    ).toBe(true);

    // The same account key, through a door the password never touched — and
    // without a handle, because the authenticator supplies it.
    const opened = await unlockWithPasskey(withPasskey);
    expect(opened.accountKey).toEqual(created.accountKey);
    expect(opened.handle).toBe('viola');
  });

  it('leaves the password and the recovery code working', async () => {
    // Three doors, one key. Adding one must not disturb the others — a passkey
    // that quietly invalidated the recovery code would be a downgrade dressed
    // as a feature.
    const { addPasskeyWrap } = await import('../src/index.js');
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });
    // Enrolling a passkey is something you do *from* an account you have open.
    signedInAs = { accountId: created.accountPub, devicePub: 'this-device' };
    await addPasskeyWrap(
      { ...deps, prf: authenticator(3), authorization: 't' },
      { handle: 'viola', accountKey: created.accountKey },
    );

    expect((await signIn(deps, { handle: 'viola', password: PASSWORD })).accountKey).toEqual(
      created.accountKey,
    );
    expect(
      (await recover(deps, { handle: 'viola', code: created.recoveryCode })).accountKey,
    ).toEqual(created.accountKey);
  });

  it('treats declining as an answer, not a failure', async () => {
    // A passkey is optional. Somebody dismissing the prompt has not hit an
    // error, and telling them they have would be a lie about their own choice.
    const { addPasskeyWrap } = await import('../src/index.js');
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });
    // Enrolling a passkey is something you do *from* an account you have open.
    signedInAs = { accountId: created.accountPub, devicePub: 'this-device' };
    expect(
      await addPasskeyWrap(
        { ...deps, prf: authenticator(3, true), authorization: 't' },
        { handle: 'viola', accountKey: created.accountKey },
      ),
    ).toBe(false);
  });

  it('will not open with a different authenticator', async () => {
    const { addPasskeyWrap, unlockWithPasskey } = await import('../src/index.js');
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });
    // Enrolling a passkey is something you do *from* an account you have open.
    signedInAs = { accountId: created.accountPub, devicePub: 'this-device' };
    await addPasskeyWrap(
      { ...deps, prf: authenticator(3), authorization: 't' },
      { handle: 'viola', accountKey: created.accountKey },
    );

    await expect(
      unlockWithPasskey(
        { ...deps, prf: authenticator(9), authorization: 't' },
        { handle: 'viola' },
      ),
    ).rejects.toThrow(new EnrolError('bad_credentials'));
  });

  it('will not open an account that has no passkey', async () => {
    const { unlockWithPasskey } = await import('../src/index.js');
    const made = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });
    signedInAs = { accountId: made.accountPub, devicePub: 'this-device' };
    await expect(
      unlockWithPasskey(
        { ...deps, prf: authenticator(3), authorization: 't' },
        { handle: 'viola' },
      ),
    ).rejects.toThrow(new EnrolError('bad_credentials'));
  });
});

describe('what the server ends up holding', () => {
  it('is nothing that opens anything', async () => {
    // The claim the whole design exists to make, asserted against real state
    // produced by a real sign-up rather than against fixtures.
    const created = await signUp(deps, {
      handle: 'viola',
      password: PASSWORD,
      deviceLabel: 'laptop',
    });

    const dump = JSON.stringify([
      await store.getEnrolment('viola'),
      await store.wrapsFor(created.accountPub),
    ]);

    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(created.recoveryCode);
    expect(dump).not.toContain(created.recoveryCode.replace(/-/g, ''));
    // And the account key itself is nowhere in it either.
    expect(dump).not.toContain(btoa(String.fromCharCode(...created.accountKey)));
  });
});
