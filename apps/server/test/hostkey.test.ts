/**
 * The Host's durable key.
 *
 * The property under test is narrow and the consequence of getting it wrong is
 * not: the Host's signature key is published in the group context of every
 * group it is an external sender for, so **a key that changes is a Host that
 * can never propose into anything it opened before.** Nothing reports that. The
 * groups are fine, the members are fine, and the proposals are simply refused.
 *
 * So: it round-trips, it verifies what it loaded, and it will not overwrite.
 */
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeDeviceCert, fromBase64, verifyDeviceCert } from '@revel/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  generateHostIdentity,
  parseHostKey,
  readHostKey,
  serialiseHostIdentity,
  writeHostKey,
} from '../src/hostkey.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'revel-hostkey-'));
});

describe('writing one', () => {
  it('round-trips the same certificate across a "restart"', async () => {
    // The whole point. Two loads of one file must be the same identity, or the
    // external-sender extension published yesterday stops matching today.
    const path = join(dir, 'host.json');
    const written = await writeHostKey(path, 'chat.example');

    const first = await readHostKey(path);
    const second = await readHostKey(path);

    expect(first?.certificate).toBe(written.certificate);
    expect(second?.certificate).toBe(written.certificate);
    expect(first?.devicePub).toEqual(written.devicePub);
  });

  it('writes it 0600, because it is the one secret the Host has', async () => {
    const path = join(dir, 'host.json');
    await writeHostKey(path, 'chat.example');
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('refuses to overwrite a key that is already there', async () => {
    // The one thing this must never do by accident: the old key is in the group
    // context of every group the Host has been published into, and there is no
    // recovering it from anywhere else.
    const path = join(dir, 'host.json');
    const original = await writeHostKey(path, 'chat.example');

    await expect(writeHostKey(path, 'chat.example')).rejects.toThrow(/refusing to overwrite/);
    expect((await readHostKey(path))?.certificate).toBe(original.certificate);
  });

  it('issues a certificate that actually verifies', async () => {
    const { identity } = await serialiseHostIdentity('chat.example');
    const cert = decodeDeviceCert(fromBase64(identity.certificate));
    expect(cert).not.toBeNull();
    expect(cert && (await verifyDeviceCert(cert))).toBe(true);
    expect(cert?.label).toBe('chat.example');
  });

  it('generates a different key every time', async () => {
    const a = await generateHostIdentity('h');
    const b = await generateHostIdentity('h');
    expect(a.certificate).not.toBe(b.certificate);
  });
});

describe('reading one', () => {
  it('reports a missing file as absent rather than as an error', async () => {
    // "No key yet" is a normal state — it is what `revel init` is for — and the
    // caller decides whether it is fatal based on whether the store is durable.
    expect(await readHostKey(join(dir, 'nope.json'))).toBeNull();
  });

  it('rejects a corrupted certificate instead of publishing it', async () => {
    // A hand-edited or truncated file that still parses would otherwise publish
    // a signature key nothing can check, and the failure would surface months
    // later as "the Host's proposals are refused" rather than now as "the key
    // file is broken".
    const path = join(dir, 'host.json');
    await writeHostKey(path, 'chat.example');

    const file = JSON.parse(await readFile(path, 'utf8'));
    // Flip a byte inside the signature.
    const bytes = fromBase64(file.certificate);
    bytes[bytes.length - 2] = (bytes[bytes.length - 2] as number) ^ 0xff;
    file.certificate = Buffer.from(bytes).toString('base64');
    await writeFile(path, JSON.stringify(file));

    await expect(readHostKey(path)).rejects.toThrow(/does not verify|does not decode/);
  });

  it('rejects a version it does not understand', async () => {
    // v1 and v2 are both readable — v2 added the OPAQUE setup, and a v1 file
    // still works, it just does not serve an IdP. Anything beyond that is a
    // file written by a newer build, and guessing at its shape is worse than
    // refusing it.
    await expect(parseHostKey(JSON.stringify({ v: 3 }))).rejects.toThrow(/version 3/);
    await expect(parseHostKey(JSON.stringify({ v: 0 }))).rejects.toThrow(/version 0/);
  });

  it('reads a v1 file, which simply has no OPAQUE setup', async () => {
    const path = join(dir, 'host.json');
    await writeHostKey(path, 'chat.example');
    const file = JSON.parse(await readFile(path, 'utf8'));
    file.v = 1;
    delete file.opaqueSetup;
    await writeFile(path, JSON.stringify(file));

    const identity = await readHostKey(path);
    expect(identity).not.toBeNull();
    expect(identity?.opaqueSetup).toBeUndefined();
  });

  it('round-trips the OPAQUE setup when there is one', async () => {
    // It is as irreplaceable as the signature key: every registration record in
    // the database was produced against *this* setup, so a new one invalidates
    // every password on the IdP at once.
    const path = join(dir, 'host.json');
    const written = await writeHostKey(path, 'chat.example', 'the-opaque-setup');
    expect(written.opaqueSetup).toBe('the-opaque-setup');
    expect((await readHostKey(path))?.opaqueSetup).toBe('the-opaque-setup');
  });

  it('rejects a file that is missing a field', async () => {
    await expect(parseHostKey(JSON.stringify({ v: 1, label: 'x' }))).rejects.toThrow(/missing/);
  });

  it('rejects something that is not JSON at all', async () => {
    await expect(parseHostKey('not json')).rejects.toThrow(/not JSON/);
  });
});
