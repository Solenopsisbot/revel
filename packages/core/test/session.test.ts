/**
 * Keeping the account key on this device.
 *
 * `docs/03` §1: "Reloading the app does not require a password. That was Kith's
 * biggest UX cliff and it's gone by construction." This is the construction, so
 * the tests are about the two ways it could quietly fail — restoring the wrong
 * thing, and restoring after somebody signed out.
 */
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession } from '../src/index.js';

let factory: IDBFactory;
let where: { factory: IDBFactory; name: string };
let n = 0;

beforeEach(() => {
  factory = new IDBFactory();
  where = { factory, name: `session-${++n}` };
});

const session = (over: Partial<Parameters<typeof saveSession>[0]> = {}) => ({
  accountPub: 'YWNjb3VudC1wdWJsaWM',
  handle: 'viola',
  accountKey: new Uint8Array(32).fill(7),
  ...over,
});

describe('across a reload', () => {
  it('gives the account key back without a password', () => {
    // The whole point. Everything else in this file is about the ways this
    // could be true and still wrong.
    return saveSession(session(), where).then(async () => {
      const restored = await loadSession(where);
      expect(restored?.accountKey).toEqual(new Uint8Array(32).fill(7));
      expect(restored?.handle).toBe('viola');
      expect(restored?.accountPub).toBe('YWNjb3VudC1wdWJsaWM');
    });
  });

  it('is nothing at all before anybody signs in', async () => {
    // Every first visit looks like this, so it is `null` rather than a throw.
    expect(await loadSession(where)).toBeNull();
  });

  it('does not keep the account key in the clear', async () => {
    // If it did, the non-extractable wrapping key would be decoration.
    await saveSession(session(), where);

    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = factory.open(where.name, 1);
      r.onsuccess = () => resolve(r.result);
    });
    const row = await new Promise<Record<string, unknown>>((resolve) => {
      const r = db.transaction('session').objectStore('session').get('current');
      r.onsuccess = () => resolve(r.result);
    });
    db.close();

    const sealed = new Uint8Array(row.sealed as ArrayBuffer);
    // The plaintext is 32 bytes of 0x07. The stored blob must not contain it.
    expect(sealed.length).toBeGreaterThan(32);
    const plain = new Uint8Array(32).fill(7);
    const contains = [...sealed].some((_, i) => plain.every((b, j) => sealed[i + j] === b));
    expect(contains).toBe(false);
  });

  it('keeps a wrapping key the browser will not export', async () => {
    // The property that makes reading IndexedDB useless: the key is a handle,
    // not bytes. An attacker who can read storage gets a sealed blob and
    // something they cannot turn into a key.
    await saveSession(session(), where);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = factory.open(where.name, 1);
      r.onsuccess = () => resolve(r.result);
    });
    const row = await new Promise<{ wrappingKey: CryptoKey }>((resolve) => {
      const r = db.transaction('session').objectStore('session').get('current');
      r.onsuccess = () => resolve(r.result);
    });
    db.close();

    expect(row.wrappingKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', row.wrappingKey)).rejects.toThrow();
  });
});

describe('signing out and switching', () => {
  it('leaves nothing to restore', async () => {
    await saveSession(session(), where);
    await clearSession(where);
    expect(await loadSession(where)).toBeNull();
  });

  it('replaces the previous account rather than keeping both', async () => {
    // Signing in as somebody else on a device that was signed in as you is a
    // normal thing to do. Leaving the old row would mean a reload could restore
    // an account the person had just left.
    await saveSession(session(), where);
    await saveSession(
      session({ handle: 'june', accountPub: 'YW5vdGhlcg', accountKey: new Uint8Array(32).fill(9) }),
      where,
    );

    const restored = await loadSession(where);
    expect(restored?.handle).toBe('june');
    expect(restored?.accountKey).toEqual(new Uint8Array(32).fill(9));
  });

  it('clearing when there is nothing is not an error', async () => {
    // Sign-out has to be idempotent, or a failed one cannot be retried — and a
    // sign-out that cannot be retried is one that leaves somebody signed in.
    await expect(clearSession(where)).resolves.toBeUndefined();
  });
});

describe('when the seal will not open', () => {
  it('reports no session rather than throwing, and forgets the row', async () => {
    // A blob that does not decrypt is not going to start working later. The
    // alternative is an app that cannot start — a reload loop nobody can escape
    // without clearing site data.
    await saveSession(session(), where);

    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = factory.open(where.name, 1);
      r.onsuccess = () => resolve(r.result);
    });
    const row = await new Promise<{ sealed: ArrayBuffer; wrappingKey: CryptoKey }>((resolve) => {
      const r = db.transaction('session').objectStore('session').get('current');
      r.onsuccess = () => resolve(r.result);
    });
    const broken = new Uint8Array(row.sealed);
    broken[broken.length - 1] ^= 0xff;
    await new Promise<void>((resolve) => {
      const r = db
        .transaction('session', 'readwrite')
        .objectStore('session')
        .put({ ...row, sealed: broken.buffer }, 'current');
      r.onsuccess = () => resolve();
    });
    db.close();

    expect(await loadSession(where)).toBeNull();
    // And it is gone, so the next load does not repeat the work.
    expect(await loadSession(where)).toBeNull();
  });
});
