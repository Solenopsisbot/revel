/**
 * A server whose clients sign in for real.
 *
 * The certificates here are issued in TypeScript rather than by the Rust core,
 * because a test needs to forge one and production must never be able to.
 * `packages/core/test/auth.test.ts` is the other half — it proves the two
 * implementations of the format agree, so the ones minted here are the real
 * format rather than a plausible-looking imitation.
 */
import {
  authPayload,
  DEVICE_CERT_VERSION,
  decodeDeviceCert,
  SnowflakeFactory,
  toAccountId,
  toBase64,
  verifyDeviceCert,
} from '@revel/protocol';
import {
  createApp,
  createHostIdentity,
  Hub,
  MemoryStore,
  sessionAuthenticator,
} from '@revel/server';

const HOST = 'revel.test';
const ENC = new TextEncoder();

// ---------------------------------------------------------------------------
// Issuing certificates, which only a test may do
// ---------------------------------------------------------------------------

async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { ...kp, pub };
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** The same bytes `crates/revel-crypto/src/device.rs` signs. */
async function issue(
  account: Awaited<ReturnType<typeof keypair>>,
  devicePub: Uint8Array,
  label: string,
) {
  const payload = join(
    ENC.encode('revel/device-cert/v1'),
    account.pub,
    u32(devicePub.length),
    devicePub,
    u32(ENC.encode(label).length),
    ENC.encode(label),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, account.privateKey, payload),
  );
  return join(
    new Uint8Array([DEVICE_CERT_VERSION]),
    account.pub,
    signature,
    u32(devicePub.length),
    devicePub,
    ENC.encode(label),
  );
}

// ---------------------------------------------------------------------------

export async function authHarness(over: { externalSender?: string | null } = {}) {
  const store = new MemoryStore();
  // A real external-sender identity, so anything that opens a group in these
  // tests opens the same shape of group production does.
  const identity = await createHostIdentity(HOST);
  const externalSender =
    over.externalSender === undefined ? identity.certificate : over.externalSender;

  const app = createApp({
    store,
    hub: new Hub(),
    ids: new SnowflakeFactory(1),
    host: HOST,
    externalSender,
    authenticate: sessionAuthenticator({ store, host: HOST }),
  });

  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  const get = (path: string, token?: string) =>
    app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  const del = (path: string, token?: string) =>
    app.request(path, {
      method: 'DELETE',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const patch = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /** A whole person: account key, device key, certificate, registered. */
  async function person(label = 'laptop', account?: Awaited<ReturnType<typeof keypair>>) {
    const acct = account ?? (await keypair());
    const dev = await keypair();
    const certificate = await issue(acct, dev.pub, label);
    const res = await post('/idp/devices', { certificate: toBase64(certificate) });

    return {
      account: acct,
      device: dev,
      devicePub: toAccountId(dev.pub),
      accountId: toAccountId(acct.pub),
      certificate,
      registration: res,
      /** Sign in properly: challenge, sign, token. */
      async signIn(over: { host?: string; nonce?: string } = {}) {
        const challenge = (await (
          await post('/auth/challenge', { device: toAccountId(dev.pub) })
        ).json()) as any;
        const nonce = over.nonce ?? challenge.nonce;
        const payload = authPayload(
          over.host ?? challenge.host,
          Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0)),
          dev.pub,
        );
        const signature = new Uint8Array(
          await crypto.subtle.sign(
            { name: 'Ed25519' },
            dev.privateKey,
            join(ENC.encode('revel/device-auth/v1'), payload),
          ),
        );
        return post('/auth/session', {
          device: toAccountId(dev.pub),
          nonce: challenge.nonce,
          signature: toBase64(signature),
        });
      },
      async token() {
        const res = await this.signIn();
        if (res.status !== 201) throw new Error(`sign-in failed: ${res.status}`);
        return ((await res.json()) as any).token as string;
      },
    };
  }

  return { store, app, post, get, del, patch, person, keypair, issue, externalSender };
}

export const HOST_NAME = HOST;
