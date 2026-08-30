/**
 * Key package supply and claiming.
 *
 * A one-time key package used twice is the forward secrecy it exists to
 * provide, gone — so most of this file is about the ways two callers could end
 * up with the same one, and the one way a stranger could spend somebody's
 * whole shelf.
 */
import { describe, expect, it } from 'vitest';
import { b64, harness, unb64 } from './helpers.js';

describe('publishing a shelf', () => {
  it('reports what it now holds', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const res = await h.publish('dev-a', ['kp1', 'kp2', 'kp3'], 'last');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: 3, lastResort: true });
  });

  it('replaces the shelf rather than adding to it', async () => {
    // A device that has just been restored from backup holds different private
    // halves than whatever is already up there. Appending would leave packages
    // nobody can open, and the Welcomes built from them would be undecryptable
    // — which looks like a broken invite rather than a stale shelf.
    const h = harness();
    h.join('alice', 'dev-a');
    await h.publish('dev-a', ['old1', 'old2']);
    await h.publish('dev-a', ['new1']);

    const supply = await (await h.supply('dev-a')).json();
    expect(supply).toEqual({ available: 1, lastResort: false });
  });

  it('keeps the last-resort package when a top-up omits it', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    await h.publish('dev-a', ['kp1'], 'last');
    await h.publish('dev-a', ['kp2', 'kp3']);
    expect(await (await h.supply('dev-a')).json()).toEqual({ available: 2, lastResort: true });
  });

  it('refuses to publish for another device', async () => {
    // The private half lives on the device. Anyone else publishing for it is
    // filling the shelf with packages the real device can never open, which is
    // a denial of service against being invited to anything.
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    const res = await h.app.request('/idp/devices/dev-a/key-packages', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-revel-device': 'dev-b' },
      body: JSON.stringify({ packages: [b64('forged')] }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses to read another device‘s supply', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    expect((await h.supply('dev-b', 'dev-a')).status).toBe(403);
  });

  it('refuses an unauthenticated request', async () => {
    const h = harness();
    const res = await h.app.request('/idp/devices/dev-a/key-packages');
    expect(res.status).toBe(401);
  });

  it('rejects a package that is not base64', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    const res = await h.app.request('/idp/devices/dev-a/key-packages', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-revel-device': 'dev-a' },
      body: JSON.stringify({ packages: ['not base64 at all!'] }),
    });
    expect(res.status).toBe(400);
  });

  it('reports an empty shelf rather than 404ing a device that never published', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    expect(await (await h.supply('dev-a')).json()).toEqual({ available: 0, lastResort: false });
  });
});

describe('claiming', () => {
  /** Alice's group; Bob in the room with `devices` enrolled and a full shelf. */
  async function twoPeople(devices = ['dev-b']) {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', devices[0] as string);
    for (const d of devices.slice(1))
      h.store.devices.set(d, {
        pub: d,
        accountId: 'bob',
        label: 'test-device',
        registeredAt: 0,
        revokedAt: null,
      });
    for (const d of devices) await h.publish(d, [`${d}-kp1`, `${d}-kp2`, `${d}-kp3`]);
    return { h, group: await h.openGroup('dev-a') };
  }

  it('hands out one package per device of the account', async () => {
    const { h, group } = await twoPeople(['dev-b', 'dev-b2']);
    const res = await h.claim('dev-a', group, ['bob']);
    expect(res.status).toBe(200);

    const { claims, missing } = (await res.json()) as any;
    expect(missing).toEqual([]);
    expect(claims.map((c: any) => c.device).sort()).toEqual(['dev-b', 'dev-b2']);
    // Per-device leaves (`docs/03` §1): each of Bob's devices gets its own.
    expect(new Set(claims.map((c: any) => c.keyPackage)).size).toBe(2);
  });

  it('spends the package — the shelf goes down', async () => {
    const { h, group } = await twoPeople();
    await h.claim('dev-a', group, ['bob']);
    expect(await (await h.supply('dev-b')).json()).toMatchObject({ available: 2 });
  });

  it('spends the oldest package first', async () => {
    // Keeps the shelf's age bounded: a package published months ago is used
    // before one published this morning, rather than sitting there forever.
    const { h, group } = await twoPeople();
    const res = await h.claim('dev-a', group, ['bob']);
    const { claims } = (await res.json()) as any;
    expect(unb64(claims[0].keyPackage)).toBe('dev-b-kp1');
  });

  it('never hands the same package to two groups', async () => {
    // The heart of it. This exercises the store directly because that is where
    // the atomicity has to live: selecting a package and then deleting it in
    // two round trips is a race, and in Postgres it is a real one. One call,
    // one `DELETE … RETURNING`.
    const h = harness();
    h.join('bob', 'dev-b');
    await h.publish(
      'dev-b',
      Array.from({ length: 20 }, (_, i) => `kp${i}`),
    );

    const claimed = await Promise.all(
      Array.from({ length: 20 }, (_, i) => h.store.claimKeyPackage('dev-b', `group-${i}`)),
    );
    const packages = claimed.map((c) => c?.keyPackage);
    expect(packages.every(Boolean)).toBe(true);
    expect(new Set(packages).size).toBe(20);
    expect(claimed.every((c) => c?.lastResort === false)).toBe(true);
  });

  it('falls back to the last-resort package and says so', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    await h.publish('dev-b', [], 'lastresort');
    const group = await h.openGroup('dev-a');

    const { claims } = (await (await h.claim('dev-a', group, ['bob'])).json()) as any;
    expect(claims).toHaveLength(1);
    expect(unb64(claims[0].keyPackage)).toBe('lastresort');
    // Surfaced rather than swallowed: it is a real, if small, downgrade, and
    // the device that sees this about itself should replenish immediately.
    expect(claims[0].lastResort).toBe(true);
  });

  it('reuses the last-resort package across groups, which is what makes it last-resort', async () => {
    const h = harness();
    h.join('bob', 'dev-b');
    await h.publish('dev-b', [], 'lastresort');

    const one = await h.store.claimKeyPackage('dev-b', 'group-1');
    const two = await h.store.claimKeyPackage('dev-b', 'group-2');
    expect(one?.keyPackage).toBe(two?.keyPackage);
    expect(two?.lastResort).toBe(true);
  });

  it('reuses an outstanding claim instead of burning a second package', async () => {
    // A commit refused for an epoch conflict gets retried, and the retry
    // re-claims. If every attempt ate a package, a client stuck in a retry
    // loop would drain somebody's shelf without anyone doing anything wrong —
    // which is the same outcome as the attack the authorised-claim check
    // exists to stop (`docs/03` §5).
    const { h, group } = await twoPeople();
    const first = (await (await h.claim('dev-a', group, ['bob'])).json()) as any;
    const again = (await (await h.claim('dev-a', group, ['bob'])).json()) as any;

    expect(again.claims[0].keyPackage).toBe(first.claims[0].keyPackage);
    expect(await (await h.supply('dev-b')).json()).toMatchObject({ available: 2 });
  });

  it('refuses to claim for someone not entitled to the group', async () => {
    // The authorised-claim fix from Kith's audit. Without it, membership of any
    // one group is a licence to spend the one-time packages of a person you
    // have never met.
    const h = harness();
    h.join('alice', 'dev-a');
    h.stranger('mallory', 'dev-m');
    await h.publish('dev-m', ['kp1', 'kp2']);
    const group = await h.openGroup('dev-a');

    const { claims, missing } = (await (await h.claim('dev-a', group, ['mallory'])).json()) as any;
    expect(claims).toEqual([]);
    expect(missing).toEqual(['mallory']);
    // And crucially: nothing was spent.
    expect(await (await h.supply('dev-m')).json()).toMatchObject({ available: 2 });
  });

  it('skips a device that is already in the group', async () => {
    const { h, group } = await twoPeople();
    // Alice is entitled and her only device opened the group.
    const { claims, missing } = (await (await h.claim('dev-a', group, ['alice'])).json()) as any;
    expect(claims).toEqual([]);
    expect(missing).toEqual(['alice']);
  });

  it('reports an account with nothing to give as missing, and still serves the rest', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    h.join('carol', 'dev-c');
    await h.publish('dev-b', ['kp1']);
    // Carol is in the room but has never published anything.
    const group = await h.openGroup('dev-a');

    const { claims, missing } = (await (
      await h.claim('dev-a', group, ['bob', 'carol'])
    ).json()) as any;
    expect(claims.map((c: any) => c.account)).toEqual(['bob']);
    expect(missing).toEqual(['carol']);
  });

  it('ignores a revoked device when claiming for its account', async () => {
    // "Sign out this device" has to mean it stops being added to things, or a
    // revoked laptop quietly acquires a leaf in every new group.
    const h = harness();
    h.join('alice', 'dev-a');
    h.join('bob', 'dev-b');
    h.store.devices.set('dev-b2', {
      pub: 'dev-b2',
      accountId: 'bob',
      label: 'test-device',
      registeredAt: 0,
      revokedAt: Date.now(),
    });
    await h.publish('dev-b', ['kp1']);
    await h.publish('dev-b2', ['kp1']);
    const group = await h.openGroup('dev-a');

    const { claims } = (await (await h.claim('dev-a', group, ['bob'])).json()) as any;
    expect(claims.map((c: any) => c.device)).toEqual(['dev-b']);
  });

  it('refuses a claimer who is not in the group', async () => {
    const { h, group } = await twoPeople();
    h.join('carol', 'dev-c');
    expect((await h.claim('dev-c', group, ['bob'])).status).toBe(403);
  });

  it('404s an unknown group', async () => {
    const h = harness();
    h.join('alice', 'dev-a');
    expect((await h.claim('dev-a', '999', ['bob'])).status).toBe(404);
  });

  it('rejects a malformed request', async () => {
    const { h, group } = await twoPeople();
    expect((await h.claim('dev-a', group, [])).status).toBe(400);
  });
});
