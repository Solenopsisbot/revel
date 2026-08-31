/**
 * Device registration and the challenge-response that replaces passwords.
 *
 * `docs/03` §2, in full:
 *
 * > Authentication to a Host is a device-key challenge-response: the Host sends
 * > a nonce, the device signs `{nonce, host, device_pub}`, the Host checks the
 * > device cert against the account's published device list. **No passwords at
 * > Hosts, ever.** Session = a short-lived token bound to that device.
 *
 * Until this existed, `authenticate` read a device id out of a header and
 * believed it. Every policy check in the codebase was correct and none of them
 * meant anything, because anybody could claim to be anybody.
 *
 * ## Registration needs no credential, and that is the point
 *
 * A device certificate is **self-certifying**: the account public key is inside
 * it and signs the rest. A Host that has never heard of an account can still
 * check that a device belongs to it. That is what makes `docs/17`'s promise —
 * your account works at a Host you have never met — true rather than
 * aspirational, and it is why there is no registration secret here to leak.
 *
 * What a certificate does *not* prove is that an account is who you think it
 * is. Nothing here does; that is the transparency log (`docs/03` §2), unbuilt.
 *
 * ## One identifier, not two
 *
 * `devices.pub` is the device's MLS signature key, taken out of the
 * certificate. `docs/31` §8 recorded the gap this closes: the Host used to know
 * a device by one name and the group by another, with nothing relating them, so
 * a removal could never tell the server which row it had just invalidated.
 */
import {
  authPayload,
  ChallengeRequest,
  type ChallengeResponse,
  type DeviceInfo,
  decodeDeviceCert,
  fromBase64,
  issueDeviceCert,
  RegisterDevice,
  SessionRequest,
  type SessionResponse,
  toAccountId,
  toBase64,
  verifyAuth,
  verifyDeviceCert,
} from '@revel/protocol';
import type { Hono } from 'hono';
import { generateHostIdentity, type HostIdentity } from './hostkey.js';
import type { Actor } from './policy.js';
import type { Device, Store } from './store/types.js';

export interface AuthDeps {
  store: Store;
  /**
   * This Host's name, as it appears in the challenge the device signs.
   *
   * Covered by the signature so a signature collected by one Host cannot be
   * presented at another — which matters exactly because an account is
   * *expected* to be used at Hosts it has never met.
   */
  host: string;
  /** Overridable so a test is not a function of the wall clock. */
  now?: () => number;
}

/** Short. A challenge that outlives its connection is a window, not a nonce. */
const CHALLENGE_TTL_MS = 60_000;

/**
 * Short-lived, per `docs/03` §2. A day rather than an hour because a device
 * that has to re-sign every hour is a device that wakes the user up; a day is
 * still short next to "until you sign out", which is what a password would buy.
 */
const SESSION_TTL_MS = 24 * 60 * 60_000;

export function mountAuth(app: Hono, deps: AuthDeps): void {
  const now = deps.now ?? (() => Date.now());

  /**
   * Register a device by presenting its certificate.
   *
   * Idempotent, because a retry after a dropped response must not tell a client
   * its own device belongs to somebody else.
   */
  app.post('/idp/devices', async (c) => {
    const parsed = RegisterDevice.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_certificate' }, 400);

    const cert = decodeDeviceCert(fromBase64(parsed.data.certificate));
    // Decoding is not verifying, and these are bytes a stranger chose.
    if (!cert) return c.json({ error: 'invalid_certificate' }, 400);
    if (!(await verifyDeviceCert(cert))) return c.json({ error: 'bad_signature' }, 403);

    const device: Device = {
      pub: toAccountId(cert.devicePub),
      accountId: toAccountId(cert.accountPub),
      label: cert.label,
      registeredAt: now(),
      revokedAt: null,
    };
    const { device: stored, created } = await deps.store.registerDevice(device);
    // A revoked device that re-registers gets its own record back, still
    // revoked, and finds out here rather than at the first request that fails.
    if (stored.revokedAt) return c.json({ error: 'device_revoked' }, 403);
    // `created` comes from the store rather than from comparing timestamps:
    // two registrations in the same millisecond are not the same registration.
    return c.json(info(stored), created ? 201 : 200);
  });

  /** This account's devices — the devices screen (`docs/17`). */
  app.get('/idp/devices', async (c) => {
    const actor = await authenticated(deps, c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);
    // Including revoked ones. Showing what you have signed out — and when — is
    // most of what the screen is for (`docs/17`).
    const devices = await deps.store.listAccountDevices(actor.accountId, { includeRevoked: true });
    return c.json({ devices: devices.map(info) });
  });

  /**
   * Sign a device out.
   *
   * Any device of the same account may, which is how "sign out my lost phone
   * from my laptop" works. Its sessions die in the same call — `docs/03` §3
   * says revocation "invalidates its Host sessions immediately", and a
   * revocation that took effect at the next token expiry would be a lie in the
   * one place it matters most.
   *
   * It does not remove the device's MLS leaf. Only a member's commit can, and
   * until one lands the revoked device can still decrypt what it already has.
   */
  app.delete('/idp/devices/:pub', async (c) => {
    const actor = await authenticated(deps, c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const target = await deps.store.getDevice(c.req.param('pub'));
    if (!target) return c.json({ error: 'no_such_device' }, 404);
    // Not "which account is this" — whether it is *yours*. Telling a stranger
    // that a device exists but belongs to somebody else is a lookup service.
    if (target.accountId !== actor.accountId) return c.json({ error: 'no_such_device' }, 404);

    await deps.store.revokeDevice(target.pub, now());
    return c.body(null, 204);
  });

  /** Ask for something to sign. */
  app.post('/auth/challenge', async (c) => {
    const parsed = ChallengeRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    // Issued without checking the device exists, and deliberately: answering
    // differently for a registered device turns this endpoint into a way to
    // ask whether somebody has an account here. The signature check later is
    // where an unknown device fails.
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    await deps.store.putChallenge(await hash(nonce), {
      devicePub: parsed.data.device,
      expiresAt: now() + CHALLENGE_TTL_MS,
    });

    const body: ChallengeResponse = {
      nonce: toBase64(nonce),
      expiresAt: now() + CHALLENGE_TTL_MS,
      host: deps.host,
    };
    return c.json(body);
  });

  /** Spend it, and get a session. */
  app.post('/auth/session', async (c) => {
    const parsed = SessionRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    const { device: devicePub, nonce, signature } = parsed.data;

    // Single-use: taking deletes. A nonce that can be spent twice is a
    // signature that can be replayed.
    const challenge = await deps.store.takeChallenge(await hash(fromBase64(nonce)));
    if (!challenge || challenge.expiresAt < now()) {
      return c.json({ error: 'challenge_expired' }, 401);
    }
    // The challenge was issued *to* a device. Letting another one spend it
    // would let anybody who saw a nonce sign in as themselves against somebody
    // else's challenge — harmless, but it would also make the nonce a shared
    // resource that could be exhausted.
    if (challenge.devicePub !== devicePub) return c.json({ error: 'wrong_device' }, 401);

    const device = await deps.store.getDevice(devicePub);
    if (!device) return c.json({ error: 'unknown_device' }, 401);
    if (device.revokedAt) return c.json({ error: 'device_revoked' }, 401);

    const ok = await verifyAuth(
      keyBytes(devicePub),
      authPayload(deps.host, fromBase64(nonce), keyBytes(devicePub)),
      fromBase64(signature),
    );
    if (!ok) return c.json({ error: 'bad_signature' }, 401);

    const token = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = now() + SESSION_TTL_MS;
    // The hash is stored, never the token. A database that leaks should not be
    // a bag of usable sessions.
    await deps.store.putSession(await hash(new TextEncoder().encode(token)), {
      devicePub,
      accountId: device.accountId,
      expiresAt,
    });

    const body: SessionResponse = {
      token,
      account: device.accountId,
      device: devicePub,
      expiresAt,
    };
    return c.json(body, 201);
  });

  /** Sign this session out. Others of the same device survive. */
  app.delete('/auth/session', async (c) => {
    const token = bearer(c.req.raw);
    if (!token) return c.json({ error: 'unauthenticated' }, 401);
    await deps.store.deleteSession(await hash(new TextEncoder().encode(token)));
    return c.body(null, 204);
  });
}

/**
 * Generate this Host's own identity as an MLS external sender (`docs/03` §5).
 *
 * The Host holds an account key and signs itself a device certificate, exactly
 * like a person's device. That is not a workaround: `validate_external_sender`
 * in the crypto core already expects a device certificate, so members check the
 * Host's right to propose with the same machinery they check each other's right
 * to hold a leaf, and can see who vouched for it.
 *
 * **The key must outlive the process.** It is baked into the group context of
 * every group opened while it was published, and a group's `external_senders`
 * extension cannot be changed without a commit. A Host that regenerates this on
 * restart silently loses the ability to propose into every group it has ever
 * served.
 *
 * Which is what `hostkey.ts` is for, and why this is now a one-line alias for
 * [`generateHostIdentity`] rather than a second implementation of it. **This
 * one is for tests**, which want a throwaway identity and have no file to read;
 * `index.ts` reads a key file and refuses to start without one whenever the
 * store is durable.
 */
export async function createHostIdentity(label = 'host'): Promise<HostIdentity> {
  return generateHostIdentity(label);
}

/**
 * The `authenticate` a production `createApp` is wired with.
 *
 * The tests wire a header-reading one instead, which is what the seam has
 * always been for — a hundred policy tests are about policy, and making each
 * one perform a challenge-response would test this file a hundred times and
 * those files not at all. Nothing in `src/` outside a test ever reaches for the
 * header version, which is the property that matters.
 */
export function sessionAuthenticator(deps: AuthDeps) {
  return (req: Request) => authenticated(deps, req);
}

async function authenticated(deps: AuthDeps, req: Request): Promise<Actor | null> {
  const token = bearer(req);
  if (!token) return null;

  const session = await deps.store.getSession(await hash(new TextEncoder().encode(token)));
  if (!session) return null;
  if (session.expiresAt < (deps.now ?? Date.now)()) return null;

  // Checked on every request, not just at sign-in. Revocation deletes the
  // sessions too, so this is belt and braces — and the braces are the ones that
  // hold when a session is created by one path and revoked by another.
  const device = await deps.store.getDevice(session.devicePub);
  if (!device || device.revokedAt) return null;

  return { accountId: session.accountId, devicePub: session.devicePub };
}

function bearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim() || null;
}

function info(device: Device): DeviceInfo {
  return {
    pub: device.pub,
    account: device.accountId,
    label: device.label,
    registeredAt: device.registeredAt,
    revokedAt: device.revokedAt,
  };
}

/** SHA-256, hex. Used for anything stored that must not be usable if read. */
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** A device pub is stored base64url; the crypto wants the bytes back. */
function keyBytes(devicePub: string): Uint8Array {
  const padded = devicePub.replaceAll('-', '+').replaceAll('_', '/');
  return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}
