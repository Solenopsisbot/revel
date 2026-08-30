/**
 * The contract between the Rust crypto core and the TypeScript protocol.
 *
 * The device certificate format and the challenge signature are implemented
 * twice: issued and signed in Rust, decoded and verified in TypeScript. Two
 * implementations of one format drift, and a comment saying "keep these in
 * sync" has never once kept anything in sync. This does.
 *
 * It lives in `packages/core` for the same reason `transport.test.ts` does:
 * this is the package that depends on both sides, and a test of an agreement
 * belongs with something that holds both halves of it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LocalCryptoEngine } from '@revel/crypto';
import init from '@revel/crypto-wasm';
import {
  authPayload,
  DEVICE_CERT_VERSION,
  decodeDeviceCert,
  toAccountId,
  verifyAuth,
  verifyDeviceCert,
} from '@revel/protocol';
import { beforeAll, describe, expect, it } from 'vitest';

const WASM = fileURLToPath(new URL('../../crypto-wasm/revel_crypto_bg.wasm', import.meta.url));
const built = existsSync(WASM);
const suite = built ? describe : describe.skip;

async function device(label = 'laptop') {
  const engine = new LocalCryptoEngine();
  const identity = await engine.open({ deviceLabel: label });
  return { engine, identity };
}

suite('a certificate issued in Rust', () => {
  beforeAll(async () => {
    await init({ module_or_path: readFileSync(WASM) });
  });

  it('decodes in TypeScript', async () => {
    const { identity } = await device('laptop');
    const cert = decodeDeviceCert(identity.certificate);

    expect(cert).not.toBeNull();
    expect(cert?.label).toBe('laptop');
    expect(cert?.accountPub).toEqual(identity.accountPublicKey);
    expect(cert?.devicePub).toEqual(identity.devicePublicKey);
  });

  it('verifies in TypeScript', async () => {
    const { identity } = await device();
    expect(await verifyDeviceCert(decodeDeviceCert(identity.certificate)!)).toBe(true);
  });

  it('carries the version byte `docs/29` §1 rule 4 asks for', async () => {
    const { identity } = await device();
    expect(identity.certificate[0]).toBe(DEVICE_CERT_VERSION);
  });

  it('is refused when the version is one this build does not know', async () => {
    // Refusing beats guessing: a decoder cannot check a signature over a
    // payload whose shape it does not know.
    const { identity } = await device();
    const future = Uint8Array.from(identity.certificate);
    future[0] = 99;
    expect(decodeDeviceCert(future)).toBeNull();
  });

  it('fails verification if the label is edited', async () => {
    // The label is what the devices screen renders. An unverified one is a
    // spoofing surface, so it has to be inside the signature.
    const { identity } = await device('laptop');
    const cert = decodeDeviceCert(identity.certificate)!;
    expect(await verifyDeviceCert({ ...cert, label: 'not-your-laptop' })).toBe(false);
  });

  it('fails verification if the device key is swapped', async () => {
    // The attack this exists to stop: claiming somebody else's account by
    // pairing your key with their account id.
    const a = await device('a');
    const b = await device('b');
    const mine = decodeDeviceCert(a.identity.certificate)!;
    const theirs = decodeDeviceCert(b.identity.certificate)!;

    expect(await verifyDeviceCert({ ...theirs, devicePub: mine.devicePub })).toBe(false);
  });

  it('names the account the same way the rest of the system does', async () => {
    // One spelling of an account id. It used to be defined in `packages/core`
    // and the server would have grown a second copy the moment it read a
    // certificate.
    const { identity } = await device();
    const cert = decodeDeviceCert(identity.certificate)!;
    expect(toAccountId(cert.accountPub)).toBe(toAccountId(identity.accountPublicKey));
  });
});

suite('a challenge signed in Rust', () => {
  beforeAll(async () => {
    await init({ module_or_path: readFileSync(WASM) });
  });

  const nonce = () => crypto.getRandomValues(new Uint8Array(32));

  it('verifies in TypeScript', async () => {
    const { engine, identity } = await device();
    const n = nonce();
    const payload = authPayload('revel.chat', n, identity.devicePublicKey);

    expect(
      await verifyAuth(identity.devicePublicKey, payload, await engine.signAuth(payload)),
    ).toBe(true);
  });

  it('does not verify at a different Host', async () => {
    // The reason the Host names itself in the challenge. An account is expected
    // to be used at Hosts it has never met, so a signature collected by one
    // must be worthless at another.
    const { engine, identity } = await device();
    const n = nonce();
    const signature = await engine.signAuth(
      authPayload('evil.example', n, identity.devicePublicKey),
    );

    expect(
      await verifyAuth(
        identity.devicePublicKey,
        authPayload('revel.chat', n, identity.devicePublicKey),
        signature,
      ),
    ).toBe(false);
  });

  it('does not verify for a different nonce', async () => {
    const { engine, identity } = await device();
    const signature = await engine.signAuth(
      authPayload('revel.chat', nonce(), identity.devicePublicKey),
    );
    expect(
      await verifyAuth(
        identity.devicePublicKey,
        authPayload('revel.chat', nonce(), identity.devicePublicKey),
        signature,
      ),
    ).toBe(false);
  });

  it('cannot be presented as another device‘s', async () => {
    const a = await device('a');
    const b = await device('b');
    const n = nonce();
    const signature = await a.engine.signAuth(
      authPayload('revel.chat', n, a.identity.devicePublicKey),
    );

    expect(
      await verifyAuth(
        b.identity.devicePublicKey,
        authPayload('revel.chat', n, b.identity.devicePublicKey),
        signature,
      ),
    ).toBe(false);
  });

  it('is domain-separated from everything else the device key signs', async () => {
    // `signAuth` prepends its own context, so a caller cannot choose the
    // domain. Verifying the raw payload — no context — must fail, which is what
    // proves the separation is actually applied rather than assumed.
    const { engine, identity } = await device();
    const payload = authPayload('revel.chat', nonce(), identity.devicePublicKey);
    const signature = await engine.signAuth(payload);

    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(identity.devicePublicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    expect(
      await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, new Uint8Array(payload)),
    ).toBe(false);
  });
});

suite('the payload builder', () => {
  it('cannot be spelled two ways by moving a boundary', async () => {
    // Length-prefixed, not concatenated. Without it, ("ab", nonce) and
    // ("a", "b"+nonce) produce the same bytes and one signature covers both.
    const key = new Uint8Array(32);
    const a = authPayload('ab', new Uint8Array([1, 2]), key);
    const b = authPayload('a', new Uint8Array([0x62, 1, 2]), key);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
