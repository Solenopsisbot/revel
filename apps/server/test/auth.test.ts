/**
 * Registration and the challenge-response that replaces passwords.
 *
 * Before this, `authenticate` read a device id out of a header and believed it:
 * every policy check in the codebase was correct and none of them meant
 * anything. These are the tests that make the rest of the suite worth having.
 */
import {
  authPayload,
  decodeDeviceCert,
  toAccountId,
  toBase64,
  verifyDeviceCert,
} from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import { authHarness, HOST_NAME as HOST } from './authHelpers.js';

const ENC = new TextEncoder();

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// ---------------------------------------------------------------------------

describe('registering a device', () => {
  it('needs no credential, because the certificate is the proof', async () => {
    // Self-certifying: the account key is inside it and signs the rest. That is
    // what makes `docs/17`'s "your account works at a Host you have never met"
    // true rather than aspirational.
    const h = await authHarness();
    const alice = await h.person();
    expect(alice.registration.status).toBe(201);

    const info = (await alice.registration.json()) as any;
    expect(info.account).toBe(alice.accountId);
    expect(info.pub).toBe(alice.devicePub);
    expect(info.label).toBe('laptop');
    expect(info.revokedAt).toBeNull();
  });

  it('makes the device pub and the MLS signature key one identifier', async () => {
    // `docs/31` §8's recorded gap, closed. The Host used to know a device by
    // one name and the group by another, with nothing relating them.
    const h = await authHarness();
    const alice = await h.person();
    const cert = decodeDeviceCert(alice.certificate)!;
    expect(alice.devicePub).toBe(toAccountId(cert.devicePub));
  });

  it('is idempotent, so a retry is not a conflict', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const again = await h.post('/idp/devices', { certificate: toBase64(alice.certificate) });
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).pub).toBe(alice.devicePub);
  });

  it('refuses a certificate whose signature does not check out', async () => {
    // The attack: pairing your device key with somebody else's account id.
    const h = await authHarness();
    const victim = await h.keypair();
    const attacker = await h.keypair();
    const forged = await h.issue(attacker, attacker.pub, 'laptop');
    // Swap in the victim's account key, leaving the attacker's signature.
    forged.set(victim.pub, 1);

    const res = await h.post('/idp/devices', { certificate: toBase64(forged) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'bad_signature' });
  });

  it('refuses bytes that are not a certificate at all', async () => {
    const h = await authHarness();
    expect(
      (await h.post('/idp/devices', { certificate: toBase64(new Uint8Array([1, 2, 3])) })).status,
    ).toBe(400);
    expect((await h.post('/idp/devices', { certificate: 'not base64!' })).status).toBe(400);
    expect((await h.post('/idp/devices', {})).status).toBe(400);
  });

  it('refuses a version this build does not know', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const future = Uint8Array.from(alice.certificate);
    future[0] = 42;
    expect((await h.post('/idp/devices', { certificate: toBase64(future) })).status).toBe(400);
  });
});

describe('signing in', () => {
  it('is a nonce, a signature and a token — no password anywhere', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const res = await alice.signIn();
    expect(res.status).toBe(201);

    const session = (await res.json()) as any;
    expect(session.account).toBe(alice.accountId);
    expect(session.device).toBe(alice.devicePub);
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(typeof session.token).toBe('string');
  });

  it('opens the rest of the server', async () => {
    const h = await authHarness();
    const alice = await h.person();
    expect((await h.get('/rooms')).status).toBe(401);
    expect((await h.get('/rooms', await alice.token())).status).toBe(200);
  });

  it('refuses a nonce that has already been spent', async () => {
    // Single-use. A nonce that can be spent twice is a signature that can be
    // replayed, which is the whole thing this protocol exists to prevent.
    const h = await authHarness();
    const alice = await h.person();

    const challenge = (await (
      await h.post('/auth/challenge', { device: alice.devicePub })
    ).json()) as any;
    const nonce = Uint8Array.from(atob(challenge.nonce), (c) => c.charCodeAt(0));
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'Ed25519' },
        alice.device.privateKey,
        join(ENC.encode('revel/device-auth/v1'), authPayload(HOST, nonce, alice.device.pub)),
      ),
    );
    const body = {
      device: alice.devicePub,
      nonce: challenge.nonce,
      signature: toBase64(signature),
    };

    expect((await h.post('/auth/session', body)).status).toBe(201);
    expect((await h.post('/auth/session', body)).status).toBe(401);
  });

  it('refuses a signature made for a different Host', async () => {
    // An account is expected to be used at Hosts it has never met, so a
    // signature collected by one must be worthless at another.
    const h = await authHarness();
    const alice = await h.person();
    const res = await alice.signIn({ host: 'evil.example' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'bad_signature' });
  });

  it('refuses a device that was never registered', async () => {
    const h = await authHarness();
    const stranger = await h.keypair();
    const res = await h.post('/auth/session', {
      device: toAccountId(stranger.pub),
      nonce: toBase64(new Uint8Array(32)),
      signature: toBase64(new Uint8Array(64)),
    });
    expect(res.status).toBe(401);
  });

  it('hands out a challenge without saying whether the device exists', async () => {
    // Answering differently would turn this into a way to ask whether somebody
    // has an account here. The signature check is where an unknown device
    // fails, and it fails the same way as a bad one.
    const h = await authHarness();
    const stranger = await h.keypair();
    const known = await h.person();

    const a = await h.post('/auth/challenge', { device: toAccountId(stranger.pub) });
    const b = await h.post('/auth/challenge', { device: known.devicePub });
    expect(a.status).toBe(b.status);
    expect(Object.keys((await a.json()) as object).sort()).toEqual(
      Object.keys((await b.json()) as object).sort(),
    );
  });

  it('refuses a challenge issued to another device', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const bob = await h.person('phone');

    const challenge = (await (
      await h.post('/auth/challenge', { device: bob.devicePub })
    ).json()) as any;
    const nonce = Uint8Array.from(atob(challenge.nonce), (c) => c.charCodeAt(0));
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'Ed25519' },
        alice.device.privateKey,
        join(ENC.encode('revel/device-auth/v1'), authPayload(HOST, nonce, alice.device.pub)),
      ),
    );
    const res = await h.post('/auth/session', {
      device: alice.devicePub,
      nonce: challenge.nonce,
      signature: toBase64(signature),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'wrong_device' });
  });

  it('rejects a malformed request', async () => {
    const h = await authHarness();
    expect((await h.post('/auth/challenge', {})).status).toBe(400);
    expect((await h.post('/auth/session', { device: 'x' })).status).toBe(400);
  });
});

describe('a token', () => {
  it('is not stored in a form anybody could spend', async () => {
    // A database that leaks should not be a bag of usable sessions.
    const h = await authHarness();
    const alice = await h.person();
    const token = await alice.token();
    expect([...h.store.sessions.keys()]).not.toContain(token);
    expect(h.store.sessions.size).toBe(1);
  });

  it('is refused once it has been signed out', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const token = await alice.token();

    expect((await h.del('/auth/session', token)).status).toBe(204);
    expect((await h.get('/rooms', token)).status).toBe(401);
  });

  it('is refused when it has expired', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const token = await alice.token();
    for (const [hash, session] of h.store.sessions) {
      h.store.sessions.set(hash, { ...session, expiresAt: Date.now() - 1 });
    }
    expect((await h.get('/rooms', token)).status).toBe(401);
  });

  it('is refused without the `Bearer` scheme', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const token = await alice.token();
    const res = await h.app.request('/rooms', { headers: { authorization: token } });
    expect(res.status).toBe(401);
  });
});

describe('signing a device out', () => {
  it('kills its sessions immediately, not at the next expiry', async () => {
    // `docs/03` §3: revocation "invalidates its Host sessions immediately". A
    // revocation that waited for a token to expire would be a lie in the one
    // place it matters most — the lost phone.
    const h = await authHarness();
    const laptop = await h.person('laptop');
    const phone = await h.person('phone', laptop.account);

    const laptopToken = await laptop.token();
    const phoneToken = await phone.token();
    expect((await h.get('/rooms', phoneToken)).status).toBe(200);

    expect((await h.del(`/idp/devices/${phone.devicePub}`, laptopToken)).status).toBe(204);
    expect((await h.get('/rooms', phoneToken)).status).toBe(401);
    expect((await h.get('/rooms', laptopToken)).status).toBe(200);
  });

  it('stops the device signing back in', async () => {
    const h = await authHarness();
    const laptop = await h.person('laptop');
    const phone = await h.person('phone', laptop.account);
    await h.del(`/idp/devices/${phone.devicePub}`, await laptop.token());

    const res = await phone.signIn();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'device_revoked' });
  });

  it('stops it re-registering its way back in', async () => {
    // Otherwise "sign out this device" lasts exactly as long as it takes to
    // press the button again on the device you were signing out.
    const h = await authHarness();
    const laptop = await h.person('laptop');
    const phone = await h.person('phone', laptop.account);
    await h.del(`/idp/devices/${phone.devicePub}`, await laptop.token());

    const res = await h.post('/idp/devices', { certificate: toBase64(phone.certificate) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'device_revoked' });
  });

  it('cannot be done to somebody else‘s device', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const mallory = await h.person('mallory');

    const res = await h.del(`/idp/devices/${alice.devicePub}`, await mallory.token());
    // 404, not 403: telling a stranger that a device exists but is not theirs
    // is a lookup service.
    expect(res.status).toBe(404);
    expect((await h.get('/rooms', await alice.token())).status).toBe(200);
  });

  it('leaves the account‘s other devices alone', async () => {
    const h = await authHarness();
    const laptop = await h.person('laptop');
    const phone = await h.person('phone', laptop.account);
    await h.del(`/idp/devices/${phone.devicePub}`, await laptop.token());

    const { devices } = (await (await h.get('/idp/devices', await laptop.token())).json()) as any;
    expect(devices).toHaveLength(2);
    expect(devices.find((d: any) => d.label === 'phone').revokedAt).toBeGreaterThan(0);
    expect(devices.find((d: any) => d.label === 'laptop').revokedAt).toBeNull();
  });
});

describe('the devices screen', () => {
  it('lists this account‘s devices and nobody else‘s', async () => {
    const h = await authHarness();
    const laptop = await h.person('laptop');
    await h.person('phone', laptop.account);
    const stranger = await h.person('stranger');

    const mine = (await (await h.get('/idp/devices', await laptop.token())).json()) as any;
    expect(mine.devices.map((d: any) => d.label).sort()).toEqual(['laptop', 'phone']);

    const theirs = (await (await h.get('/idp/devices', await stranger.token())).json()) as any;
    expect(theirs.devices.map((d: any) => d.label)).toEqual(['stranger']);
  });

  it('needs a session', async () => {
    const h = await authHarness();
    expect((await h.get('/idp/devices')).status).toBe(401);
  });
});

describe('the certificates these tests forge', () => {
  it('are the real format, or none of the above proves anything', async () => {
    const h = await authHarness();
    const alice = await h.person();
    expect(await verifyDeviceCert(decodeDeviceCert(alice.certificate)!)).toBe(true);
  });
});
