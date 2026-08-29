/**
 * The engine's behaviour, against the real wasm, without a Worker.
 *
 * The Worker is `postMessage` and nothing else; everything that can actually be
 * wrong — handle lifetimes, the group map, the commit/apply split, what an
 * error says — lives in `Session` and `Dispatcher` and runs here in Node.
 *
 * The Worker plumbing is verified separately, in a browser, by `bench/worker/`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import init from '@revel/crypto-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/handlers.js';
import { Session } from '../src/session.js';

const WASM = fileURLToPath(new URL('../../crypto-wasm/revel_crypto_bg.wasm', import.meta.url));

// The wasm is generated, not checked in. Skipping loudly beats failing
// mysteriously on a fresh clone.
const built = existsSync(WASM);
const describeIfBuilt = built ? describe : describe.skip;
if (!built) {
  console.warn(`\n  ${WASM} is missing — run \`pnpm build:wasm\`. Skipping crypto tests.\n`);
}

const enc = new TextEncoder();
const HELLO = enc.encode('the buttons need to feel pressable');

/**
 * Two sessions belonging to **different** accounts — the DM case, and the
 * common one. For two devices of a single account, share the secret; see the
 * members test.
 */
function pair(label = 'laptop') {
  const alice = new Session({ deviceLabel: label });
  const bob = new Session({ deviceLabel: 'phone' });
  return { alice, bob };
}

describeIfBuilt('Session', () => {
  beforeAll(async () => {
    await init({ module_or_path: readFileSync(WASM) });
  });

  it('carries a message from one device to another', () => {
    const { alice, bob } = pair();

    const created = alice.createGroup('g-general');
    expect(created).toEqual({ groupId: 'g-general', epoch: 0, size: 1, ownLeaf: 0 });

    alice.stageAdd('g-general', bob.keyPackage());
    const out = alice.commit('g-general');
    expect(out.welcome).toBeInstanceOf(Uint8Array);
    alice.applyPending('g-general');

    const joined = bob.joinGroup(out.welcome as Uint8Array);
    expect(joined.groupId).toBe('g-general');

    const got = bob.process('g-general', alice.encrypt('g-general', HELLO));
    expect(got.kind).toBe('application');
    expect(got.kind === 'application' && new TextDecoder().decode(got.data)).toBe(
      'the buttons need to feel pressable',
    );

    alice.close();
    bob.close();
  });

  it('does not move the group until the commit is applied', () => {
    // The property the three-step API exists for. Applying before the server
    // accepts forks the group into an epoch nobody else reaches.
    const { alice, bob } = pair();
    alice.createGroup('g-design');
    alice.stageAdd('g-design', bob.keyPackage());
    alice.commit('g-design');

    expect(alice.state('g-design')).toMatchObject({ epoch: 0, size: 1 });
    expect(alice.applyPending('g-design')).toMatchObject({ epoch: 1, size: 2 });

    alice.close();
    bob.close();
  });

  it('keeps staged changes when a commit is refused', () => {
    const { alice, bob } = pair();
    alice.createGroup('g-voice');
    expect(alice.stageAdd('g-voice', bob.keyPackage())).toBe(1);
    // Leaf 9 does not exist in a one-member group, so the batch cannot build.
    expect(alice.stageRemove('g-voice', 9)).toBe(2);

    expect(() => alice.commit('g-voice')).toThrow();
    expect(() => alice.clearStaged('g-voice')).not.toThrow();

    alice.close();
    bob.close();
  });

  it('stages a batch in one call', () => {
    const alice = new Session({ deviceLabel: 'laptop' });
    const others = Array.from({ length: 4 }, (_, i) => new Session({ deviceLabel: `d${i}` }));
    alice.createGroup('g-batch');

    expect(
      alice.stageAdd(
        'g-batch',
        others.map((o) => o.keyPackage()),
      ),
    ).toBe(4);
    alice.commit('g-batch');
    expect(alice.applyPending('g-batch')).toMatchObject({ size: 5 });

    // And the plural remove, which is what a mass kick is.
    expect(alice.stageRemove('g-batch', [3, 4])).toBe(2);
    alice.commit('g-batch');
    expect(alice.applyPending('g-batch')).toMatchObject({ size: 3 });

    alice.close();
    for (const o of others) o.close();
  });

  it('names the groups it does hold when asked for one it does not', () => {
    const alice = new Session({ deviceLabel: 'laptop' });
    alice.createGroup('g-one');
    alice.createGroup('g-two');

    expect(() => alice.encrypt('g-nope', HELLO)).toThrow(/g-one, g-two/);
    alice.close();
  });

  it('refuses to open the same group twice rather than leaking the first', () => {
    const alice = new Session({ deviceLabel: 'laptop' });
    alice.createGroup('g-dup');
    expect(() => alice.createGroup('g-dup')).toThrow(/forget it first/);

    alice.forget('g-dup');
    expect(alice.groups()).toEqual([]);
    expect(() => alice.createGroup('g-dup')).not.toThrow();
    alice.close();
  });

  it('gives two devices of one account two leaves and one account key', () => {
    // The property `docs/31` §1 is about, seen from the outside: identity is
    // per device, "same person" is the account key both certificates carry.
    const laptop = new Session({ deviceLabel: 'laptop' });
    const phone = new Session({
      accountSecret: laptop.exportAccountSecret(),
      deviceLabel: 'phone',
    });

    laptop.createGroup('g-lab');
    laptop.stageAdd('g-lab', phone.keyPackage());
    laptop.commit('g-lab');
    laptop.applyPending('g-lab');

    const members = laptop.members('g-lab');
    expect(members.map((m) => m.label).sort()).toEqual(['laptop', 'phone']);
    expect(members[0].account).toEqual(members[1].account);
    expect(new Set(members.map((m) => m.leaf)).size).toBe(2);

    laptop.close();
    phone.close();
  });

  it('gives two accounts in one group two different account keys', () => {
    const { alice, bob } = pair();
    alice.createGroup('g-dm');
    alice.stageAdd('g-dm', bob.keyPackage());
    alice.commit('g-dm');
    alice.applyPending('g-dm');

    const members = alice.members('g-dm');
    expect(members).toHaveLength(2);
    expect(members[0].account).not.toEqual(members[1].account);

    alice.close();
    bob.close();
  });

  it('round-trips an account through the bytes a client would store', () => {
    const first = new Session({ deviceLabel: 'laptop' });
    const secret = first.exportAccountSecret();
    const restored = new Session({ accountSecret: secret, deviceLabel: 'laptop' });

    expect(restored.identity().accountPublicKey).toEqual(first.identity().accountPublicKey);
    // A new device key each time, so the certificates differ even though the
    // account does not.
    expect(restored.identity().certificate).not.toEqual(first.identity().certificate);

    first.close();
    restored.close();
  });

  it('refuses everything once closed', () => {
    const alice = new Session({ deviceLabel: 'laptop' });
    alice.createGroup('g-gone');
    alice.close();

    expect(() => alice.keyPackage()).toThrow(/closed/);
    expect(() => alice.encrypt('g-gone', HELLO)).toThrow(/closed/);
    // Closing twice is a no-op, not a double free.
    expect(() => alice.close()).not.toThrow();
  });

  it('will not read a device certificate that does not verify', () => {
    const alice = new Session({ deviceLabel: 'unknown device' });
    const cert = alice.identity().certificate;
    expect(Session.readCertificate(cert).label).toBe('unknown device');

    const forged = Uint8Array.from(cert);
    forged[forged.length - 1] ^= 0xff;
    expect(() => Session.readCertificate(forged)).toThrow();

    alice.close();
  });
});

describeIfBuilt('Dispatcher', () => {
  beforeAll(async () => {
    await init({ module_or_path: readFileSync(WASM) });
  });

  it('routes a whole exchange through the wire shape', () => {
    const d = new Dispatcher();
    d.handle({ id: 1, op: 'open', args: [{ deviceLabel: 'laptop' }] });
    d.handle({ id: 2, op: 'createGroup', args: ['g-wire'] });

    // A second device, standing in for whoever we are inviting.
    const other = new Dispatcher();
    other.handle({ id: 1, op: 'open', args: [{ deviceLabel: 'phone' }] });
    const kp = other.handle({ id: 2, op: 'keyPackage', args: [] }) as Uint8Array;

    d.handle({ id: 3, op: 'stageAdd', args: ['g-wire', kp] });
    const out = d.handle({ id: 4, op: 'commit', args: ['g-wire'] }) as { welcome?: Uint8Array };
    d.handle({ id: 5, op: 'applyPending', args: ['g-wire'] });

    const joined = other.handle({ id: 3, op: 'joinGroup', args: [out.welcome as Uint8Array] });
    expect(joined).toMatchObject({ groupId: 'g-wire' });

    const sealed = d.handle({ id: 6, op: 'encrypt', args: ['g-wire', HELLO] }) as Uint8Array;
    const got = other.handle({ id: 4, op: 'process', args: ['g-wire', sealed] });
    expect(got).toMatchObject({ kind: 'application' });

    d.handle({ id: 7, op: 'close', args: [] });
    other.handle({ id: 5, op: 'close', args: [] });
  });

  it('says so when no session is open', () => {
    const d = new Dispatcher();
    expect(() => d.handle({ id: 1, op: 'keyPackage', args: [] })).toThrow(/no crypto session/);
  });

  it('replaces the session on a second open rather than leaving keys resident', () => {
    const d = new Dispatcher();
    const first = d.handle({ id: 1, op: 'open', args: [{ deviceLabel: 'laptop' }] }) as {
      accountPublicKey: Uint8Array;
    };
    d.handle({ id: 2, op: 'createGroup', args: ['g-old'] });

    const second = d.handle({ id: 3, op: 'open', args: [{ deviceLabel: 'laptop' }] }) as {
      accountPublicKey: Uint8Array;
    };
    expect(second.accountPublicKey).not.toEqual(first.accountPublicKey);
    expect(d.handle({ id: 4, op: 'groups', args: [] })).toEqual([]);

    d.handle({ id: 5, op: 'close', args: [] });
  });
});
