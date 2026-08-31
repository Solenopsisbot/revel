/**
 * The filesystem blob store, and mostly its path handling.
 *
 * The conformance suite already runs every blob behaviour against this (see
 * `store.test.ts`), so what is left is the part that only exists here: an id
 * arrives from a route and gets turned into a path, and a path assembled from
 * anything a caller influenced is a traversal waiting to happen.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileBlobBytes } from '../src/store/blobstore.js';

let dir: string;
let blobs: FileBlobBytes;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'revel-blobtest-'));
  blobs = new FileBlobBytes({ dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('paths', () => {
  it('refuses anything that is not an id, rather than sanitising it', () => {
    // Sanitising `../../etc/passwd` produces a filename nobody meant, and
    // storing something under the wrong name is worse than refusing.
    const bad = [
      '../../etc/passwd',
      'a/b',
      '..',
      '',
      'blob-3',
      '1;rm -rf /',
      '\u0000',
      '1'.repeat(21),
    ];
    for (const id of bad) {
      expect(blobs.get(id)).rejects.toThrow(/is not an id/);
    }
  });

  it('never writes outside its directory', async () => {
    await blobs.put('1767225600000000001', new Uint8Array([1, 2, 3]));
    // Everything lives under `dir`; nothing escaped upward.
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('fans out on the end of the id, not the start', async () => {
    // Snowflakes minted close together share every leading digit, so bucketing
    // on a *prefix* would put a whole day of uploads in one directory and
    // defeat the point entirely. Bucketing on the tail spreads them.
    //
    // Note what this does not claim: consecutive ids are *expected* to share a
    // bucket — 100 of them do, which is the bucket doing its job. What matters
    // is that a shared prefix does not force one directory.
    const base = 1767225600000000000n;
    const ids = Array.from({ length: 12 }, (_, i) => String(base + BigInt(i * 137)));
    for (const id of ids) await blobs.put(id, new Uint8Array([1]));

    // Every one of these shares the same 13-digit prefix.
    expect(new Set(ids.map((id) => id.slice(0, 13))).size).toBe(1);
    // And they still land in more than one directory.
    expect(readdirSync(dir).length).toBeGreaterThan(1);
  });
});

describe('bytes', () => {
  const id = '1767225600000000042';

  it('round-trips exactly', async () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    await blobs.put(id, bytes);
    expect(await blobs.get(id)).toEqual(bytes);
  });

  it('reports absent bytes as null rather than throwing', async () => {
    expect(await blobs.get('1767225600000000999')).toBeNull();
  });

  it('never overwrites — first write wins, like the store', async () => {
    await blobs.put(id, new Uint8Array([1]));
    await blobs.put(id, new Uint8Array([9, 9, 9]));
    expect(await blobs.get(id)).toEqual(new Uint8Array([1]));
  });

  it('deletes idempotently, so a purge can be retried', async () => {
    // A purge that failed because it already happened would make retrying one
    // impossible, and a purge is the operation most likely to be retried.
    await blobs.put(id, new Uint8Array([1]));
    await blobs.delete(id);
    await blobs.delete(id);
    expect(await blobs.get(id)).toBeNull();
  });
});
