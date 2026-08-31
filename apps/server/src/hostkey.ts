/**
 * The Host's own key, kept somewhere it survives a restart.
 *
 * `docs/03` §5 lets a Host act as an MLS **external sender**: it may propose
 * into a group it cannot read, which is how a moderator's "remove this device"
 * becomes an actual Remove rather than a request. To do that its signature key
 * has to be published in the group's `ExternalSendersExt` — and an extension is
 * **part of the group context**, which every member has already committed to.
 *
 * Which makes the key permanent in a way a server secret usually is not. A Host
 * that generates a fresh one at boot can never propose into any group it opened
 * before that boot, and nothing reports the failure: the groups are fine, the
 * members are fine, and the server's proposals are simply refused forever.
 *
 * ## Why a file and not the database
 *
 * The store holds ciphertext the Host cannot read and metadata it can. This is
 * neither: it is the one secret the Host actually has. Putting it in the same
 * place as the data means a single dump is both, and the whole architecture
 * rests on those being different things to steal.
 *
 * So: a file, `0600`, path configurable — or `REVEL_HOST_KEY` for deployments
 * that inject secrets as environment rather than volumes. `revel init` writes
 * one; nothing writes one implicitly, because a key that appears by itself is a
 * key nobody backed up.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  decodeDeviceCert,
  fromBase64,
  issueDeviceCert,
  toBase64,
  verifyDeviceCert,
} from '@revel/protocol';

/** Where the key lives unless told otherwise. */
export function hostKeyPath(): string {
  return process.env.REVEL_HOST_KEY_FILE ?? './revel-host.json';
}

export interface HostIdentity {
  /** The device certificate, base64. What goes in `ExternalSendersExt`. */
  certificate: string;
  accountKey: CryptoKey;
  devicePub: Uint8Array;
  /** The OPAQUE server setup, when this file has one. See [`StoredHostKey`]. */
  opaqueSetup?: string;
}

/** The on-disk shape. */
interface StoredHostKey {
  v: 1 | 2;
  label: string;
  /** PKCS#8, base64. */
  accountKey: string;
  deviceKey: string;
  /** The certificate these two produce. Stored so the file is self-describing. */
  certificate: string;
  /**
   * The OPAQUE server setup (`docs/03` §3). Added in v2.
   *
   * Long-lived and irreplaceable in exactly the way the signature key is: every
   * registration record in the database was produced against *this* setup, so
   * a new one invalidates every password on the IdP at once. It lives here
   * rather than in the database for the reason given above — a dump of the data
   * should not also be a dump of the secrets.
   *
   * Optional in the type so a v1 file still parses. A Host with a v1 file
   * simply does not serve the IdP, which is the same shape as `security.txt`
   * with no contact: a missing capability rather than a broken one.
   */
  opaqueSetup?: string;
}

/** Copied rather than passed through, for the reason `identity.ts` gives: a
 *  view is both a type WebCrypto will not take and a thing that can change
 *  under it between here and the import. */
const importPrivate = (pkcs8: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('pkcs8', new Uint8Array(fromBase64(pkcs8)), { name: 'Ed25519' }, true, [
    'sign',
  ]);

/**
 * Generate a Host identity. **Does not persist it.**
 *
 * Separate from saving on purpose: `revel init` writes the file, everything
 * else loads one, and an ephemeral identity stays a thing you have to ask for.
 */
export async function generateHostIdentity(label: string): Promise<HostIdentity> {
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
  const certificate = await issueDeviceCert(account.privateKey, accountPub, devicePub, label);

  return { certificate: toBase64(certificate), accountKey: account.privateKey, devicePub };
}

/** Serialise a freshly generated identity, for `revel init` to write. */
export async function serialiseHostIdentity(
  label: string,
  opaqueSetup?: string,
): Promise<{ file: StoredHostKey; identity: HostIdentity }> {
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
  const certificate = toBase64(
    await issueDeviceCert(account.privateKey, accountPub, devicePub, label),
  );

  return {
    file: {
      v: 2,
      label,
      accountKey: toBase64(
        new Uint8Array(await crypto.subtle.exportKey('pkcs8', account.privateKey)),
      ),
      deviceKey: toBase64(
        new Uint8Array(await crypto.subtle.exportKey('pkcs8', device.privateKey)),
      ),
      certificate,
      ...(opaqueSetup ? { opaqueSetup } : {}),
    },
    identity: {
      certificate,
      accountKey: account.privateKey,
      devicePub,
      ...(opaqueSetup ? { opaqueSetup } : {}),
    },
  };
}

/**
 * Parse and validate a stored key. Throws with a legible reason.
 *
 * The certificate is **verified**, not trusted: a corrupted or hand-edited file
 * that still parses would otherwise publish a signature key nothing can check,
 * and the failure would show up as "the Host's proposals are refused" months
 * later rather than as "the key file is broken" now.
 */
export async function parseHostKey(json: string): Promise<HostIdentity> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('host key is not JSON');
  }
  const file = parsed as Partial<StoredHostKey>;
  if (file.v !== 1 && file.v !== 2) {
    throw new Error(`host key version ${String(file.v)} is not supported`);
  }
  if (!file.accountKey || !file.deviceKey || !file.certificate) {
    throw new Error('host key is missing a field');
  }

  const cert = decodeDeviceCert(fromBase64(file.certificate));
  if (!cert) throw new Error('host key certificate does not decode');
  if (!(await verifyDeviceCert(cert))) throw new Error('host key certificate does not verify');

  const accountKey = await importPrivate(file.accountKey);
  return {
    certificate: file.certificate,
    accountKey,
    devicePub: cert.devicePub,
    ...(file.opaqueSetup ? { opaqueSetup: file.opaqueSetup } : {}),
  };
}

/** Read a host key file. `null` when there is no file — not an error. */
export async function readHostKey(path: string): Promise<HostIdentity | null> {
  let json: string;
  try {
    json = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return parseHostKey(json);
}

/**
 * Write a new host key, refusing to clobber one that is already there.
 *
 * Overwriting is the one thing this must never do by accident: the old key is
 * in the group context of every group the Host has ever been published into,
 * and there is no recovering it from anywhere else.
 */
export async function writeHostKey(
  path: string,
  label: string,
  opaqueSetup?: string,
): Promise<HostIdentity> {
  const existing = await readHostKey(path).catch(() => null);
  if (existing) throw new Error(`${path} already exists — refusing to overwrite a host key`);

  const { file, identity } = await serialiseHostIdentity(label, opaqueSetup);
  await mkdir(dirname(path), { recursive: true });
  // `0600` before anything is in it, so the secret is never briefly readable.
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(path, 0o600);
  return identity;
}
