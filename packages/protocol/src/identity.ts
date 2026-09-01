/**
 * Device certificates and Host authentication.
 *
 * `docs/03` §2: "Authentication to a Host is a device-key challenge-response:
 * the Host sends a nonce, the device signs `{nonce, host, device_pub}`, the Host
 * checks the device cert against the account's published device list. **No
 * passwords at Hosts, ever.**"
 *
 * ## Why a decoder lives here rather than only in Rust
 *
 * The certificate is issued by `crates/revel-crypto` and carried as the MLS
 * credential. The *server* has to read one too — it is how a device registers,
 * and it is the only thing that proves a device pub belongs to an account — and
 * the server is TypeScript. So the format is a protocol format, and this is
 * where protocol formats live.
 *
 * Two implementations of one format can drift, which is why
 * `packages/core/test/auth.test.ts` signs with the real Rust binding and
 * verifies here. That test is the contract; this comment is not.
 *
 * ## What the certificate is worth
 *
 * It is **self-certifying**: the account public key is inside it and signs the
 * rest, so anyone can check that a device belongs to an account without asking
 * anybody. That is what lets a Host accept a registration from a stranger — it
 * is not being asked to trust, it is being handed a proof.
 *
 * What it does *not* prove is that the account is who you think it is. That is
 * the transparency log's job (`docs/03` §2), and it does not exist yet.
 */
import { z } from 'zod';
import { fromBase64, toBase64 } from './base64.js';
import { AccountId, DevicePub } from './ids.js';

const ENC = new TextEncoder();

/** `docs/29` §1 rule 4: every sealed format carries an explicit version byte. */
export const DEVICE_CERT_VERSION = 1;

/** Domain separation for the account key's signature over a certificate. */
const CERT_CONTEXT = ENC.encode('revel/device-cert/v1');

/**
 * Domain separation for the device key's one non-MLS use.
 *
 * The device key signs MLS handshakes and Host challenges, and nothing else.
 * Without a distinct context here, a Host could hand a device a "nonce" that
 * was really a handshake message and collect a signature over it.
 */
const AUTH_CONTEXT = ENC.encode('revel/device-auth/v1');

export interface DeviceCert {
  /** The account this device speaks for — 32 bytes, the stable public identity. */
  accountPub: Uint8Array;
  /** The device's MLS signature public key. This is the leaf's key. */
  devicePub: Uint8Array;
  /** Human label for the devices screen. Covered by the signature. */
  label: string;
  /** The account key over everything above. */
  signature: Uint8Array;
}

/**
 * Decode a certificate. Returns null for anything malformed.
 *
 * Null rather than throwing because every caller here is parsing bytes an
 * attacker chose, and a decoder that throws is one somebody forgets to wrap.
 *
 * **Decoding is not verifying.** Nothing in the returned value means anything
 * until [`verifyDeviceCert`] says so.
 */
export function decodeDeviceCert(bytes: Uint8Array): DeviceCert | null {
  // A version this build does not know is refused rather than guessed at: it
  // cannot check a signature over a payload whose shape it does not know.
  if (bytes[0] !== DEVICE_CERT_VERSION) return null;
  const body = bytes.subarray(1);
  if (body.length < 32 + 64 + 4) return null;

  const accountPub = body.subarray(0, 32);
  const signature = body.subarray(32, 96);
  const view = new DataView(body.buffer, body.byteOffset + 96, 4);
  const deviceLen = view.getUint32(0, false);
  if (body.length < 100 + deviceLen) return null;

  const devicePub = body.subarray(100, 100 + deviceLen);
  let label: string;
  try {
    label = new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(100 + deviceLen));
  } catch {
    return null;
  }
  return { accountPub, devicePub, label, signature };
}

/**
 * Exactly the bytes the account key signs.
 *
 * Length-prefixed, so no two distinct certificates can produce the same signed
 * payload — without it, a device pub and label could be split differently and
 * one signature would cover two certificates.
 */
function certPayload(cert: DeviceCert): Uint8Array {
  const label = ENC.encode(cert.label);
  const out = new Uint8Array(
    CERT_CONTEXT.length + 32 + 4 + cert.devicePub.length + 4 + label.length,
  );
  let at = 0;
  out.set(CERT_CONTEXT, at);
  at += CERT_CONTEXT.length;
  out.set(cert.accountPub, at);
  at += 32;
  new DataView(out.buffer).setUint32(at, cert.devicePub.length, false);
  at += 4;
  out.set(cert.devicePub, at);
  at += cert.devicePub.length;
  new DataView(out.buffer).setUint32(at, label.length, false);
  at += 4;
  out.set(label, at);
  return out;
}

/**
 * Issue a certificate: an account key signing a device key into an account.
 *
 * **Only for a party that legitimately holds an account key.** On a client that
 * is the crypto core's job and this function has no business being called —
 * `crates/revel-crypto` issues the real ones and the account key never reaches
 * TypeScript. It is here for the one party that is not a client: a **Host**,
 * which holds its own account key and signs itself a certificate so it can be
 * named as an MLS external sender (`docs/03` §5). It presents that certificate
 * like anybody else, which is exactly what the identity provider already
 * expects.
 */
export async function issueDeviceCert(
  accountKey: CryptoKey,
  accountPub: Uint8Array,
  devicePub: Uint8Array,
  label: string,
): Promise<Uint8Array> {
  const cert: DeviceCert = { accountPub, devicePub, label, signature: new Uint8Array(64) };
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, accountKey, new Uint8Array(certPayload(cert))),
  );
  return encodeDeviceCert({ ...cert, signature });
}

/** The wire form, as `crates/revel-crypto/src/device.rs` writes it. */
export function encodeDeviceCert(cert: DeviceCert): Uint8Array {
  const label = ENC.encode(cert.label);
  const out = new Uint8Array(1 + 32 + 64 + 4 + cert.devicePub.length + label.length);
  let at = 0;
  out[at++] = DEVICE_CERT_VERSION;
  out.set(cert.accountPub, at);
  at += 32;
  out.set(cert.signature, at);
  at += 64;
  new DataView(out.buffer).setUint32(at, cert.devicePub.length, false);
  at += 4;
  out.set(cert.devicePub, at);
  at += cert.devicePub.length;
  out.set(label, at);
  return out;
}

/** Whether this device really was signed into this account. */
export async function verifyDeviceCert(cert: DeviceCert): Promise<boolean> {
  return verifyEd25519(cert.accountPub, cert.signature, certPayload(cert));
}

/**
 * What the device signs to prove it is awake and holds its own key.
 *
 * `host` is in there so a signature collected by one Host cannot be replayed at
 * another — which matters precisely because `docs/17` promises an account works
 * across Hosts it has never met. `devicePub` is in there so a signature cannot
 * be presented as some other device's.
 */
export function authPayload(host: string, nonce: Uint8Array, devicePub: Uint8Array): Uint8Array {
  const hostBytes = ENC.encode(host);
  const out = new Uint8Array(4 + hostBytes.length + 4 + nonce.length + 4 + devicePub.length);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const part of [hostBytes, nonce, devicePub]) {
    view.setUint32(at, part.length, false);
    at += 4;
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Check a challenge signature. The context is applied here, never by a caller. */
export async function verifyAuth(
  devicePub: Uint8Array,
  payload: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const signed = new Uint8Array(AUTH_CONTEXT.length + payload.length);
  signed.set(AUTH_CONTEXT, 0);
  signed.set(payload, AUTH_CONTEXT.length);
  return verifyEd25519(devicePub, signature, signed);
}

/**
 * Ed25519, through WebCrypto.
 *
 * Present in Node 20+, Bun, and every current browser, which is the whole
 * reason this package can verify a signature without a dependency. Returns
 * false rather than throwing on a key that will not import: an attacker
 * supplies these bytes.
 */
// ---------------------------------------------------------------------------
// Invite links (`docs/03` §4 — the Wormhole trick)
// ---------------------------------------------------------------------------

const INVITE_CONTEXT = ENC.encode('revel/invite-redeem/v1');

/**
 * What a redeemer signs, and what the Host verifies.
 *
 * The **account is in the challenge**, so a signature captured off one
 * person's redemption cannot be replayed to join a different account. The
 * code is in it too, so a signature from one link is not a signature for
 * another made with the same key.
 *
 * Context-prefixed like `verifyAuth`, and for the same reason: a key that
 * signs one kind of thing should not be able to be tricked into having signed
 * another. This one only ever signs redemptions, which makes the prefix cheap
 * insurance rather than load-bearing — but the cost of getting it wrong later
 * is a key with two meanings.
 */
function inviteChallenge(code: string, account: string): Uint8Array {
  const payload = ENC.encode(`${code}:${account}`);
  const signed = new Uint8Array(INVITE_CONTEXT.length + payload.length);
  signed.set(INVITE_CONTEXT, 0);
  signed.set(payload, INVITE_CONTEXT.length);
  return signed;
}

/**
 * Mint an invite keypair.
 *
 * The public half goes to the Host; the private half goes in the URL fragment
 * and must never be sent anywhere. Returned raw rather than as a `CryptoKey`
 * because the private half's destination is a string in a link.
 */
export async function mintInviteKey(): Promise<{ pub: Uint8Array; secret: Uint8Array }> {
  // `generateKey`'s type is the union of "one key" and "a pair", and only the
  // caller's algorithm decides which. Ed25519 is always a pair.
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as unknown as { publicKey: CryptoKey; privateKey: CryptoKey };
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  // PKCS#8, because WebCrypto will not export an Ed25519 private key as raw —
  // and it is what `importKey` wants back, so the fragment carries exactly the
  // bytes that go straight back in.
  const secret = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { pub, secret };
}

/** Sign a redemption with the key from the fragment. */
export async function signInviteRedemption(
  secret: Uint8Array,
  code: string,
  account: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    new Uint8Array(secret),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  // `slice()` so the argument is backed by a plain `ArrayBuffer`, which is
  // what `BufferSource` means and what a `Uint8Array` over a `SharedArrayBuffer`
  // is not. Same copy the verify path makes, for the same reason.
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    key,
    inviteChallenge(code, account).slice(),
  );
  return new Uint8Array(signature);
}

/**
 * Does this signature prove the redeemer holds the fragment?
 *
 * False rather than throwing on anything malformed: a stranger supplies every
 * one of these bytes.
 */
export async function verifyInviteRedemption(
  pub: Uint8Array,
  code: string,
  account: string,
  signature: Uint8Array,
): Promise<boolean> {
  return verifyEd25519(pub, signature, inviteChallenge(code, account));
}

async function verifyEd25519(
  publicKey: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    // Copied, not passed through. `decodeDeviceCert` hands back views into the
    // caller's buffer, and a view is both a type WebCrypto will not take and a
    // thing that can change under it between here and the verify.
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      new Uint8Array(signature),
      new Uint8Array(data),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

/**
 * Register a device by presenting its certificate.
 *
 * No credential besides the certificate, because none is needed: it is
 * self-certifying, and a Host that has never heard of this account can still
 * check it. That is what makes `docs/17`'s "your account works at a Host you
 * have never met" true rather than aspirational.
 */
export const RegisterDevice = z.object({ certificate: z.string().base64().max(4096) });
export type RegisterDevice = z.infer<typeof RegisterDevice>;

export const DeviceInfo = z.object({
  pub: DevicePub,
  account: AccountId,
  label: z.string().max(200),
  registeredAt: z.number().int(),
  /** Set the moment it is signed out. Sessions die with it (`docs/03` §3). */
  revokedAt: z.number().int().nullable(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const ChallengeRequest = z.object({ device: DevicePub });
export type ChallengeRequest = z.infer<typeof ChallengeRequest>;

export const ChallengeResponse = z.object({
  nonce: z.string().base64(),
  /** Short. A challenge that outlives the connection it was fetched on is a
   *  window for a signature collected somewhere else. */
  expiresAt: z.number().int(),
  /** The Host's own name, covered by the signature so it cannot be replayed. */
  host: z.string().max(255),
});
export type ChallengeResponse = z.infer<typeof ChallengeResponse>;

export const SessionRequest = z.object({
  device: DevicePub,
  nonce: z.string().base64(),
  signature: z.string().base64(),
});
export type SessionRequest = z.infer<typeof SessionRequest>;

export const SessionResponse = z.object({
  /** Bearer token. Short-lived and bound to the device (`docs/03` §2). */
  token: z.string(),
  account: AccountId,
  device: DevicePub,
  expiresAt: z.number().int(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** Base64url of a public key, unpadded — how an account id is spelled. */
export function toAccountId(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The inverse, for the one place that needs the key back: verifying a cert. */
export function fromAccountId(id: string): Uint8Array {
  const padded = id.replaceAll('-', '+').replaceAll('_', '/');
  return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}
