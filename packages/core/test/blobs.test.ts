/**
 * Attachments, sealed and opened, and then against the real server.
 *
 * The property under test throughout: **the server holds bytes it cannot read
 * and never learns it could not read them**. No filename, no MIME type, no
 * dimensions, no key — `docs/22`'s "ciphertext with no filename or type", made
 * checkable.
 */
import {
  DEFAULT_EVERYONE,
  Permission,
  SnowflakeFactory,
  serialize,
  toBase64,
} from '@revel/protocol';
import { createApp, Hub, MemoryStore as ServerStore } from '@revel/server';
import { describe, expect, it } from 'vitest';
import {
  Attachments,
  HttpTransport,
  openBlob,
  sealBlob,
  type TransportError,
} from '../src/index.js';

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const FILE = ENC.encode('a photograph of a very good dog, allegedly');

const meta = { mime: 'image/png', name: 'dog.png' };

// ---------------------------------------------------------------------------
// Sealing, on its own
// ---------------------------------------------------------------------------

describe('sealing a file', () => {
  it('round-trips', async () => {
    const sealed = await sealBlob(FILE, meta);
    const opened = await openBlob(sealed.ciphertext, sealed.ref);
    expect(DEC.decode(opened)).toBe(DEC.decode(FILE));
  });

  it('produces ciphertext that looks nothing like the file', async () => {
    const sealed = await sealBlob(FILE, meta);
    expect(DEC.decode(sealed.ciphertext)).not.toContain('dog');
    // GCM's tag, which is what makes tampering detectable.
    expect(sealed.ciphertext.length).toBe(FILE.length + 16);
  });

  it('uses a key that has never existed before', async () => {
    // A fresh key per blob is the entire safety argument: nonce reuse under a
    // key is GCM's failure mode, and a key used once cannot have one reused.
    const keys = new Set<string>();
    for (let i = 0; i < 20; i++) keys.add((await sealBlob(FILE, meta)).ref.key);
    expect(keys.size).toBe(20);
  });

  it('uses a fresh nonce too, belt and braces', async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 20; i++) nonces.add((await sealBlob(FILE, meta)).ref.nonce);
    expect(nonces.size).toBe(20);
  });

  it('keeps the name, type and alt text on the client side of the wall', async () => {
    const sealed = await sealBlob(FILE, { ...meta, alt: 'a dog, mid-zoomie' });
    expect(sealed.ref).toMatchObject({
      mime: 'image/png',
      name: 'dog.png',
      alt: 'a dog, mid-zoomie',
    });
    // And none of it is in the bytes that leave.
    const wire = DEC.decode(sealed.ciphertext);
    for (const secret of ['dog.png', 'image/png', 'zoomie']) expect(wire).not.toContain(secret);
  });

  it('refuses ciphertext that has been tampered with', async () => {
    const sealed = await sealBlob(FILE, meta);
    sealed.ciphertext[4] = (sealed.ciphertext[4] as number) ^ 0xff;
    await expect(openBlob(sealed.ciphertext, sealed.ref)).rejects.toThrow();
  });

  it('refuses the right ciphertext with the wrong key', async () => {
    const mine = await sealBlob(FILE, meta);
    const theirs = await sealBlob(FILE, meta);
    await expect(openBlob(mine.ciphertext, theirs.ref)).rejects.toThrow();
  });

  it('refuses a ref whose size disagrees with the file', async () => {
    // Not an attack — GCM already ruled that out — but a sender whose client
    // built the ref wrong, which would otherwise render as a corrupt image.
    const sealed = await sealBlob(FILE, meta);
    await expect(openBlob(sealed.ciphertext, { ...sealed.ref, size: 9 })).rejects.toThrow(
      /the event said 9/,
    );
  });

  it('refuses a ref whose hash disagrees', async () => {
    const sealed = await sealBlob(FILE, meta);
    const other = await sealBlob(ENC.encode('something else entirely!!!'), meta);
    await expect(
      openBlob(sealed.ciphertext, { ...sealed.ref, hash: other.ref.hash }),
    ).rejects.toThrow(/does not match the hash/);
  });

  it('handles an empty file and a large one', async () => {
    const empty = await sealBlob(new Uint8Array(0), meta);
    expect((await openBlob(empty.ciphertext, empty.ref)).length).toBe(0);

    // Filled in chunks: `getRandomValues` refuses more than 65,536 bytes at a
    // time, which is worth knowing before writing it the obvious way somewhere
    // that matters.
    const big = new Uint8Array(512 * 1024);
    for (let at = 0; at < big.length; at += 65536) {
      crypto.getRandomValues(big.subarray(at, Math.min(at + 65536, big.length)));
    }
    const sealed = await sealBlob(big, meta);
    expect(await openBlob(sealed.ciphertext, sealed.ref)).toEqual(big);
  });
});

// ---------------------------------------------------------------------------
// Against the real server
// ---------------------------------------------------------------------------

const ALICE = 'k7Yb3QzL0pW9xNvR2sTgHfMdEcJaUiOb1nKlPqRsTuV';
const BOB = 'Qa2Wd4Rf6Tg8Yh0Uj1Ik3Ol5Pz7Xc9Vb2Nm4As6Dfg';
const STRANGER = 'Zx1Cv3Bn5Mq7Wr9Ty0Ui2Op4As6Df8Gh1Jk3Ll5Zzz';

function host(opts: { maxBlobBytes?: number } = {}) {
  const store = new ServerStore();
  store.rooms.set('9001', {
    id: '9001',
    kind: 'group',
    spaceId: 'space1',
    groupId: null,
    streamPaging: false,
    notifyHints: false,
  });
  store.roles.set('role-everyone', {
    id: 'role-everyone',
    spaceId: 'space1',
    bits: serialize(DEFAULT_EVERYONE),
    position: 0,
  });

  const device = (pub: string, accountId: string) =>
    store.devices.set(pub, {
      pub,
      accountId,
      label: 'test-device',
      registeredAt: 0,
      revokedAt: null,
    });
  device('dev-a', ALICE);
  device('dev-b', BOB);
  device('dev-x', STRANGER);
  for (const account of [ALICE, BOB]) {
    store.memberships.set(`9001:${account}`, {
      roomId: '9001',
      accountId: account,
      roleIds: ['role-everyone'],
    });
  }

  const app = createApp({
    store,
    hub: new Hub(),
    ids: new SnowflakeFactory(1),
    ...(opts.maxBlobBytes === undefined ? {} : { maxBlobBytes: opts.maxBlobBytes }),
    async authenticate(req) {
      const pub = req.headers.get('x-revel-device');
      if (!pub) return null;
      const found = await store.getDevice(pub);
      return found && !found.revokedAt
        ? { accountId: found.accountId, devicePub: found.pub }
        : null;
    },
  });

  const transportAs = (devicePub: string) =>
    new HttpTransport({
      baseUrl: 'http://host',
      headers: () => ({ 'x-revel-device': devicePub }),
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        app.fetch(new Request(String(input), init))) as typeof globalThis.fetch,
    });

  return { store, app, transportAs };
}

describe('a blob at the server', () => {
  it('goes up and comes back byte for byte', async () => {
    const t = host().transportAs('dev-a');
    const sealed = await sealBlob(FILE, meta);
    const blob = await t.uploadBlob('9001', sealed.ciphertext);

    expect(blob.size).toBe(sealed.ciphertext.length);
    expect(await t.downloadBlob(blob.id)).toEqual(sealed.ciphertext);
  });

  it('tells the server nothing it could recognise', async () => {
    // The whole claim, checked against what is actually in the store.
    const h = host();
    const sealed = await sealBlob(FILE, { ...meta, alt: 'a dog, mid-zoomie' });
    const blob = await h.transportAs('dev-a').uploadBlob('9001', sealed.ciphertext);

    const stored = JSON.stringify([...h.store.blobs.values()]);
    for (const secret of ['dog.png', 'image/png', 'zoomie', sealed.ref.key]) {
      expect(stored).not.toContain(secret);
    }
    expect(Object.keys(h.store.blobs.get(blob.id) as object).sort()).toEqual(
      ['createdAt', 'hash', 'id', 'purgedAt', 'roomId', 'size', 'uploader'].sort(),
    );
  });

  it('can be opened by anybody in the room who has the event', async () => {
    const h = host();
    const sealed = await sealBlob(FILE, meta);
    const blob = await h.transportAs('dev-a').uploadBlob('9001', sealed.ciphertext);

    const theirs = await h.transportAs('dev-b').downloadBlob(blob.id);
    expect(DEC.decode(await openBlob(theirs, { ...sealed.ref, id: blob.id }))).toBe(
      DEC.decode(FILE),
    );
  });

  it('cannot be fetched by somebody outside the room', async () => {
    const h = host();
    const sealed = await sealBlob(FILE, meta);
    const blob = await h.transportAs('dev-a').uploadBlob('9001', sealed.ciphertext);
    await expect(h.transportAs('dev-x').downloadBlob(blob.id)).rejects.toThrow(/not_a_member/);
  });

  it('is meaningless to somebody who fetched it without the event', async () => {
    // "No hotlinking" (`docs/22`), stated as a test. Bob is in the room, so the
    // server hands the bytes over — and they are noise without the key, which
    // never went near the server.
    const h = host();
    const sealed = await sealBlob(FILE, meta);
    const blob = await h.transportAs('dev-a').uploadBlob('9001', sealed.ciphertext);

    const bytes = await h.transportAs('dev-b').downloadBlob(blob.id);
    const wrongKey = (await sealBlob(FILE, meta)).ref;
    await expect(openBlob(bytes, wrongKey)).rejects.toThrow();
  });

  it('needs SEND_MEDIA, not just SEND', async () => {
    // `docs/04` §4 keeps them apart so a room can be "you may talk, you may not
    // post files", which cannot be reconstructed from the other.
    const h = host();
    h.store.roles.set('role-everyone', {
      id: 'role-everyone',
      spaceId: 'space1',
      bits: serialize(Permission.VIEW | Permission.SEND),
      position: 0,
    });
    await expect(
      h.transportAs('dev-a').uploadBlob('9001', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/missing_permission/);
  });

  it('refuses an upload to a room you are not in', async () => {
    const h = host();
    await expect(h.transportAs('dev-x').uploadBlob('9001', new Uint8Array([1]))).rejects.toThrow(
      /not_a_member/,
    );
  });

  it('404s a room that does not exist, rather than saying which', async () => {
    const h = host();
    await expect(h.transportAs('dev-a').uploadBlob('9999', new Uint8Array([1]))).rejects.toThrow(
      /no_such_room/,
    );
  });

  it('refuses one that is too large', async () => {
    const h = host({ maxBlobBytes: 64 });
    const failed = (await h
      .transportAs('dev-a')
      .uploadBlob('9001', new Uint8Array(65))
      .catch((e: unknown) => e)) as TransportError;
    expect(failed.status).toBe(413);
    expect(failed.reason).toBe('too_large');
  });

  it('refuses an empty one', async () => {
    const h = host();
    await expect(h.transportAs('dev-a').uploadBlob('9001', new Uint8Array(0))).rejects.toThrow(
      /empty_blob/,
    );
  });
});

describe('purging a blob', () => {
  async function uploaded() {
    const h = host();
    const sealed = await sealBlob(FILE, meta);
    const blob = await h.transportAs('dev-a').uploadBlob('9001', sealed.ciphertext);
    return { h, blob };
  }

  it('takes the bytes and keeps the tombstone', async () => {
    // Same shape as an event purge: a client with a cached copy has to be told
    // the difference between "never existed" and "was removed".
    const { h, blob } = await uploaded();
    await h.transportAs('dev-a').purgeBlob(blob.id);

    const failed = (await h
      .transportAs('dev-b')
      .downloadBlob(blob.id)
      .catch((e: unknown) => e)) as TransportError;
    expect(failed.status).toBe(410);
    expect(failed.reason).toBe('purged');
    expect(h.store.blobs.get(blob.id)?.purgedAt).toBeGreaterThan(0);
  });

  it('is allowed to the uploader without any permission', async () => {
    // Deleting your own thing is not moderation (`docs/04` §4's "authors
    // always may").
    const { h, blob } = await uploaded();
    await expect(h.transportAs('dev-a').purgeBlob(blob.id)).resolves.toBeUndefined();
  });

  it('is refused to somebody else without MANAGE_EVENTS', async () => {
    const { h, blob } = await uploaded();
    await expect(h.transportAs('dev-b').purgeBlob(blob.id)).rejects.toThrow(/missing_permission/);
  });

  it('404s a blob that never existed', async () => {
    const { h } = await uploaded();
    await expect(h.transportAs('dev-a').downloadBlob('12345')).rejects.toThrow(/no_such_blob/);
  });
});

describe('Attachments', () => {
  it('seals, uploads and opens in one round trip each way', async () => {
    const t = host().transportAs('dev-a');
    const files = new Attachments({ transport: t });

    const ref = await files.upload('9001', FILE, { ...meta, alt: 'a dog' });
    expect(ref.id).toMatch(/^\d+$/);
    expect(DEC.decode(await files.open(ref))).toBe(DEC.decode(FILE));
  });

  it('does not download the same blob twice', async () => {
    let downloads = 0;
    const t = host().transportAs('dev-a');
    const counted = {
      ...t,
      uploadBlob: t.uploadBlob.bind(t),
      downloadBlob: (id: string) => {
        downloads += 1;
        return t.downloadBlob(id);
      },
    } as unknown as HttpTransport;

    const files = new Attachments({ transport: counted });
    const ref = await files.upload('9001', FILE, meta);
    await files.open(ref);
    await files.open(ref);
    expect(downloads).toBe(1);
  });

  it('collapses concurrent opens of the same blob', async () => {
    // Ten images scrolling into view at once is ten fetches, not thirty.
    let downloads = 0;
    const t = host().transportAs('dev-a');
    const counted = {
      ...t,
      uploadBlob: t.uploadBlob.bind(t),
      downloadBlob: (id: string) => {
        downloads += 1;
        return t.downloadBlob(id);
      },
    } as unknown as HttpTransport;

    const files = new Attachments({ transport: counted });
    const ref = await files.upload('9001', FILE, meta);
    await Promise.all([files.open(ref), files.open(ref), files.open(ref)]);
    expect(downloads).toBe(1);
  });

  it('uploads a thumbnail as its own sealed blob', async () => {
    // `docs/22`: the server cannot generate one, so it travels separately and
    // is sealed under its own key like anything else.
    const t = host().transportAs('dev-a');
    const files = new Attachments({ transport: t });
    const thumbnail = ENC.encode('a much smaller dog');

    const { ref, thumb } = await files.uploadWithThumbnail('9001', FILE, thumbnail, meta);
    expect(ref.thumb).toBe(thumb.id);
    expect(thumb.key).not.toBe(ref.key);
    expect(DEC.decode(await files.open(thumb))).toBe('a much smaller dog');
  });
});
