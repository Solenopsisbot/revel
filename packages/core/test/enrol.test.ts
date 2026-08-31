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

beforeEach(() => {
  store = new MemoryStore();
  const app = createApp({
    store,
    hub: { broadcast: () => {} } as never,
    ids: new SnowflakeFactory(0),
    authenticate: async () => null,
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
    // A device cert is `device.rs`'s job and not this file's; a stand-in keeps
    // the test about enrolment.
    signDeviceCert: async (_seed, label) => new TextEncoder().encode(`cert:${label}`),
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
