/**
 * One suite, two stores.
 *
 * `MemoryStore` is what every other test in this repo runs against, which makes
 * it load-bearing in a way a test double usually is not: if it has drifted from
 * Postgres, the whole suite goes green while production is wrong. So the rule
 * is that **anything the server depends on is asserted here, and here runs
 * against both.**
 *
 * `docs/29` §4 puts it as "the in-memory implementation lets the whole test
 * suite run with no database" — that only holds if the two are the same
 * implementation of the same contract, and the only way to know is to check.
 *
 * The Postgres half is skipped when `DATABASE_URL` is unset, so `pnpm test`
 * stays hermetic on a machine with no Docker. That is a deliberate trade and
 * worth naming: it means a contributor can break Postgres without their local
 * run noticing. The mitigation is that it is one environment variable and a
 * `docker compose up -d` away, and CI sets it.
 */

import type { Event } from '@revel/protocol';
import { compareIds } from '@revel/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '../src/store/types.js';

/** Fresh store per test. Returning a cleanup lets Postgres truncate and close. */
export interface StoreHarness {
  make(): Promise<Store>;
  /**
   * Called at the *start* of each test, before `make()`.
   *
   * Deliberately setup rather than teardown, and the docstring used to say the
   * opposite: a suite that only cleans up after itself leaves the last test's
   * rows behind for whatever runs next, and "whatever runs next" is exactly the
   * thing that will not know to distrust them.
   */
  reset(): Promise<void>;
}

/**
 * Unique *across runs*, not only within one.
 *
 * A plain counter restarts at 1 every time, so a second run against a
 * persistent Postgres reuses every id the first one wrote. Most assertions here
 * survive that because they are idempotent; anything asserting a *fresh* state
 * — "this space has no audience bound yet" — passes once and then fails
 * forever, which reads as a real regression and is not one.
 */
const run = Math.random().toString(36).slice(2, 8);
let n = 0;
const uniq = (prefix: string) => `${prefix}-${run}-${++n}`;

/**
 * A fresh snowflake-shaped id.
 *
 * Event ids cannot use `uniq`: `compareIds` parses them as `BigInt`, so an id
 * like `ev-3` throws rather than sorting. Anything the store orders has to look
 * like the real thing.
 */
const snowflake = () => String(1767225600000000000n + BigInt(++n));

/** A stored event, with the fields the store actually reads filled in. */
function event(over: Partial<Event> & Pick<Event, 'id' | 'room' | 'sender'>): Event {
  return {
    epoch: 1,
    class: 'normal',
    payload: 'Y2lwaGVydGV4dA==',
    size: 12,
    clientNonce: uniq('nonce'),
    createdAt: 1_700_000_000_000,
    purgedAt: null,
    ...over,
  };
}

export function describeStore(name: string, harness: StoreHarness): void {
  describe(name, () => {
    let store: Store;

    beforeEach(async () => {
      await harness.reset();
      store = await harness.make();
    });

    // -------------------------------------------------------------------------
    describe('rooms', () => {
      it('creates idempotently, because a DM id is derived from its members', async () => {
        // Two people opening each other at the same instant land on the same
        // derived id. The loser must get the winner's room, not an error and
        // not a second room with the same name.
        const room = {
          id: uniq('room'),
          kind: 'dm' as const,
          spaceId: null,
          groupId: null,
          streamPaging: false,
          notifyHints: false,
        };
        const first = await store.createRoom(room, ['acct-a', 'acct-b']);
        const second = await store.createRoom(room, ['acct-a', 'acct-b']);

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.room.id).toBe(room.id);
        expect((await store.listRoomMembers(room.id)).map((m) => m.accountId).sort()).toEqual([
          'acct-a',
          'acct-b',
        ]);
      });

      it('lists an account rooms, and stops when membership is removed', async () => {
        const id = uniq('room');
        await store.createRoom(
          {
            id,
            kind: 'text',
            spaceId: 's1',
            groupId: null,
            streamPaging: false,
            notifyHints: false,
          },
          ['acct-a'],
        );
        expect((await store.listAccountRooms('acct-a')).map((r) => r.id)).toContain(id);

        await store.removeMember(id, 'acct-a');
        expect((await store.listAccountRooms('acct-a')).map((r) => r.id)).not.toContain(id);
        // The room survives its last member. Membership is delivery, not
        // existence (`docs/31` §10).
        expect(await store.getRoom(id)).not.toBeNull();
      });

      it('replaces role ids on re-add rather than appending a second row', async () => {
        const id = uniq('room');
        await store.createRoom(
          {
            id,
            kind: 'text',
            spaceId: 's1',
            groupId: null,
            streamPaging: false,
            notifyHints: false,
          },
          [],
        );
        await store.addMember(id, 'acct-a', ['role-everyone']);
        await store.addMember(id, 'acct-a', ['role-everyone', 'role-mod']);

        expect(await store.listRoomMembers(id)).toHaveLength(1);
        expect((await store.getMembership(id, 'acct-a'))?.roleIds).toEqual([
          'role-everyone',
          'role-mod',
        ]);
      });
    });

    // -------------------------------------------------------------------------
    describe('spaces', () => {
      it('creates the space, its owner and its `@everyone` in one act', async () => {
        // Three facts that are really one. A space with no owner cannot be
        // administered; one with no `@everyone` gives its members no
        // permissions at all. Either half alone is unusable and undeletable.
        const id = uniq('space');
        const space = await store.createSpace({ id, owner: 'acct-a', everyoneBits: '3' });

        expect(space.id).toBe(id);
        expect(await store.isOwner(id, 'acct-a')).toBe(true);
        expect(await store.getSpaceMember(id, 'acct-a')).toMatchObject({ roleIds: [] });

        // `@everyone` shares the space's id (`docs/04` §4), so an override
        // table needs no special case for it.
        const roles = await store.listRoles(id);
        expect(roles.map((r) => r.id)).toEqual([id]);
        expect(roles[0]?.bits).toBe('3');
      });

      it('is idempotent, so a retried create is not a second space', async () => {
        const id = uniq('space');
        await store.createSpace({ id, owner: 'acct-a', everyoneBits: '3' });
        await store.createSpace({ id, owner: 'acct-a', everyoneBits: '3' });
        expect((await store.listRoles(id)).length).toBe(1);
        expect((await store.listSpaceMembers(id)).length).toBe(1);
      });

      it('lists the spaces an account is in, and only those', async () => {
        const mine = uniq('space');
        const theirs = uniq('space');
        await store.createSpace({ id: mine, owner: 'acct-a', everyoneBits: '3' });
        await store.createSpace({ id: theirs, owner: 'acct-b', everyoneBits: '3' });

        const ids = (await store.listAccountSpaces('acct-a')).map((s) => s.id);
        expect(ids).toContain(mine);
        expect(ids).not.toContain(theirs);
      });

      it('joins, re-roles and leaves', async () => {
        const id = uniq('space');
        await store.createSpace({ id, owner: 'acct-a', everyoneBits: '3' });

        await store.putSpaceMember(id, 'acct-b', ['role-mod']);
        expect(await store.getSpaceMember(id, 'acct-b')).toMatchObject({ roleIds: ['role-mod'] });

        // The same call updates, so nothing has to know whether they were
        // already in — which is the state a retried invite is in.
        await store.putSpaceMember(id, 'acct-b', []);
        expect(await store.getSpaceMember(id, 'acct-b')).toMatchObject({ roleIds: [] });

        await store.removeSpaceMember(id, 'acct-b');
        expect(await store.getSpaceMember(id, 'acct-b')).toBeNull();
      });

      it('takes a deleted role off everybody who held it', async () => {
        // Otherwise a member keeps an id that resolves to nothing, and the
        // permission check silently drops it — which looks like the role still
        // existing and doing nothing.
        const id = uniq('space');
        await store.createSpace({ id, owner: 'acct-a', everyoneBits: '3' });
        const role = { id: uniq('role'), spaceId: id, bits: '7', position: 1 };
        await store.putRole(role);
        await store.putSpaceMember(id, 'acct-b', [role.id]);

        await store.deleteRole(id, role.id);
        expect((await store.listRoles(id)).map((r) => r.id)).toEqual([id]);
        expect(await store.getSpaceMember(id, 'acct-b')).toMatchObject({ roleIds: [] });
      });

      it('refuses to delete `@everyone`', async () => {
        const id = uniq('space');
        await store.createSpace({ id, owner: 'acct-a', everyoneBits: '3' });
        await store.deleteRole(id, id);
        expect((await store.listRoles(id)).map((r) => r.id)).toEqual([id]);
      });

      it('hands the same group to the same audience, and a new one to a new audience', async () => {
        // The reason a twelve-room space is one commit rather than twelve
        // (`docs/03` §4). Keyed on the audience *rule*, never on who currently
        // matches it — two rooms keyed on the resulting set could silently
        // merge and then diverge as roles change, and encrypted history cannot
        // be un-merged.
        const id = uniq('space');
        await store.createSpace({ id, owner: 'acct-a', everyoneBits: '3' });

        // Unique ids: `group_id` is a primary key, so fixed ones collide with
        // whatever a previous run of this suite left behind.
        const first = uniq('group');
        const second = uniq('group');
        const third = uniq('group');

        expect(await store.groupForAudience(id, 'everyone')).toBeNull();
        await store.bindAudience(id, 'everyone', first);
        expect(await store.groupForAudience(id, 'everyone')).toBe(first);

        await store.bindAudience(id, 'roles:role-mod', second);
        expect(await store.groupForAudience(id, 'roles:role-mod')).toBe(second);

        // Binding again does not steal the audience from the group that holds
        // it. Re-pointing would orphan a group that already has encrypted
        // history in it, and there is no re-encrypting that.
        await store.bindAudience(id, 'everyone', third);
        expect(await store.groupForAudience(id, 'everyone')).toBe(first);
      });
    });

    describe('accounts and handles', () => {
      const account = (id: string, handle: string) => ({
        id,
        handle,
        displayName: null,
        avatar: null,
        status: 'active' as const,
        createdAt: 1_700_000_000_000,
        movedTo: null,
      });

      it('refuses a handle somebody else holds', async () => {
        const a = uniq('acct');
        const b = uniq('acct');
        const handle = uniq('handle');

        const first = await store.claimHandle(account(a, handle));
        const second = await store.claimHandle(account(b, handle));

        expect(first.claimed).toBe(true);
        expect(second.claimed).toBe(false);
        // The *existing* binding comes back, so the caller can tell "taken by
        // me" from "taken by somebody else" without a second read.
        expect(second.account.id).toBe(a);
      });

      it('moves a handle rather than leaving the old one pointing at you', async () => {
        // Two handles resolving to one account would make `getAccountByHandle`
        // and `getAccount` disagree about what somebody is called.
        const id = uniq('acct');
        const before = uniq('handle');
        const after = uniq('handle');

        await store.claimHandle(account(id, before));
        await store.claimHandle(account(id, after));

        expect(await store.getAccountByHandle(before)).toBeNull();
        expect((await store.getAccountByHandle(after))?.id).toBe(id);
        expect((await store.getAccount(id))?.handle).toBe(after);
      });

      it('compares handles as bytes, because folding happens once at the edge', async () => {
        const id = uniq('acct');
        const handle = uniq('handle');
        await store.claimHandle(account(id, handle));
        // A store that folded too would be a second place to get it wrong, and
        // `Viola` vs `viola` resolving differently in two layers is how
        // impersonation gets in.
        expect(await store.getAccountByHandle(handle.toUpperCase())).toBeNull();
      });

      it('patches only the fields given', async () => {
        const id = uniq('acct');
        await store.claimHandle(account(id, uniq('handle')));
        await store.updateAccount(id, { displayName: 'Viola' });
        await store.updateAccount(id, { avatar: 'blob-1' });

        const updated = await store.getAccount(id);
        expect(updated?.displayName).toBe('Viola');
        expect(updated?.avatar).toBe('blob-1');
      });

      it('says an account exists once a live device is enrolled, and not before', async () => {
        const id = uniq('acct');
        const pub = uniq('dev');
        expect(await store.accountExists(id)).toBe(false);

        await store.registerDevice({
          pub,
          accountId: id,
          label: 'laptop',
          registeredAt: Date.now(),
          revokedAt: null,
        });
        expect(await store.accountExists(id)).toBe(true);

        await store.revokeDevice(pub, Date.now());
        // A revoked device is not a live one, so the account stops existing for
        // the one purpose this is for: refusing to open a DM with a string
        // somebody typed wrong.
        expect(await store.accountExists(id)).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    describe('devices, challenges, sessions', () => {
      const device = (pub: string, accountId = 'acct-a') => ({
        pub,
        accountId,
        label: 'laptop',
        registeredAt: 1_700_000_000_000,
        revokedAt: null,
      });

      it('re-registering a revoked device does not un-revoke it', async () => {
        // Otherwise "sign out this device" lasts exactly as long as it takes to
        // press the button again on the device you were signing out.
        const pub = uniq('dev');
        await store.registerDevice(device(pub));
        await store.revokeDevice(pub, 1_700_000_001_000);

        const again = await store.registerDevice(device(pub));
        expect(again.created).toBe(false);
        expect(again.device.revokedAt).toBe(1_700_000_001_000);
        expect((await store.getDevice(pub))?.revokedAt).toBe(1_700_000_001_000);
      });

      it('revoking twice reports false the second time', async () => {
        const pub = uniq('dev');
        await store.registerDevice(device(pub));
        expect(await store.revokeDevice(pub, 1)).toBe(true);
        expect(await store.revokeDevice(pub, 2)).toBe(false);
      });

      it('revocation takes the sessions and the push channel with it', async () => {
        const pub = uniq('dev');
        await store.registerDevice(device(pub));
        await store.putSession('hash-1', {
          devicePub: pub,
          accountId: 'acct-a',
          expiresAt: Date.now() + 60_000,
        });
        await store.putPushSubscription({
          devicePub: pub,
          kind: 'webpush',
          endpoint: 'https://push.example/x',
          createdAt: Date.now(),
        });

        await store.revokeDevice(pub, Date.now());

        expect(await store.getSession('hash-1')).toBeNull();
        // A signed-out phone's endpoint is a live line to a device whose whole
        // point was to stop being one.
        expect(await store.getPushSubscription(pub)).toBeNull();
      });

      it('hides revoked devices unless asked, because the safe default is fewer', async () => {
        const account = uniq('acct');
        const live = uniq('dev');
        const dead = uniq('dev');
        await store.registerDevice(device(live, account));
        await store.registerDevice(device(dead, account));
        await store.revokeDevice(dead, Date.now());

        // A caller that forgets to filter would give a revoked device a leaf in
        // a group, which is the exact thing revocation exists to prevent.
        expect((await store.listAccountDevices(account)).map((d) => d.pub)).toEqual([live]);
        expect(
          (await store.listAccountDevices(account, { includeRevoked: true }))
            .map((d) => d.pub)
            .sort(),
        ).toEqual([dead, live].sort());
      });

      it('spends a challenge exactly once', async () => {
        // Two round trips is how the same nonce gets spent twice, and a nonce
        // spent twice is a signature that can be replayed.
        const hash = uniq('nonce-hash');
        await store.putChallenge(hash, { devicePub: 'dev-a', expiresAt: Date.now() + 60_000 });

        expect((await store.takeChallenge(hash))?.devicePub).toBe('dev-a');
        expect(await store.takeChallenge(hash)).toBeNull();
      });

      it('refuses an expired challenge, and still consumes it', async () => {
        const hash = uniq('nonce-hash');
        await store.putChallenge(hash, { devicePub: 'dev-a', expiresAt: Date.now() - 1 });
        expect(await store.takeChallenge(hash)).toBeNull();
        expect(await store.takeChallenge(hash)).toBeNull();
      });

      it('treats an expired session as absent', async () => {
        await store.putSession('hash-expired', {
          devicePub: 'dev-a',
          accountId: 'acct-a',
          expiresAt: Date.now() - 1,
        });
        expect(await store.getSession('hash-expired')).toBeNull();
      });

      it('sweeps expired challenges and sessions, and leaves live ones', async () => {
        // Neither table cleans itself on the path that matters: an abandoned
        // sign-in never spends its challenge, and a client holding an expired
        // token does not present it again. In memory that is a leak a restart
        // fixes; in a database it is a table that only grows.
        const now = 1_700_000_000_000;
        await store.putChallenge(uniq('dead'), { devicePub: 'dev-a', expiresAt: now - 1 });
        await store.putChallenge(uniq('live'), { devicePub: 'dev-a', expiresAt: now + 60_000 });
        await store.putSession(uniq('dead'), {
          devicePub: 'dev-a',
          accountId: 'acct-a',
          expiresAt: now - 1,
        });
        await store.putSession(uniq('live'), {
          devicePub: 'dev-a',
          accountId: 'acct-a',
          expiresAt: now + 60_000,
        });

        expect(await store.sweepExpired(now)).toEqual({ challenges: 1, sessions: 1 });
        // Idempotent, so a timer that fires twice costs nothing.
        expect(await store.sweepExpired(now)).toEqual({ challenges: 0, sessions: 0 });
      });

      it('drops every session of one device at once', async () => {
        const pub = uniq('dev');
        for (const h of ['a', 'b', 'c']) {
          await store.putSession(`${pub}:${h}`, {
            devicePub: pub,
            accountId: 'acct-a',
            expiresAt: Date.now() + 60_000,
          });
        }
        await store.deleteDeviceSessions(pub);
        expect(await store.getSession(`${pub}:a`)).toBeNull();
        expect(await store.getSession(`${pub}:c`)).toBeNull();
      });
    });

    // -------------------------------------------------------------------------
    describe('events', () => {
      it('orders across a digit boundary, which lexical sorting gets wrong', async () => {
        // **The bug this test exists for.** Snowflakes are text (`docs/04` §6),
        // and a plain `ORDER BY id` in Postgres is lexical: "9999999999999999999"
        // sorts *after* "10000000000000000000" because '9' > '1'. `compareIds`
        // is length-then-lexical, and a store that disagrees reorders history
        // the first time a room crosses a digit boundary — invisible until it
        // is catastrophic and unrepairable.
        const room = uniq('room');
        const low = '9999999999999999999'; // 19 digits
        const high = '10000000000000000000'; // 20 digits, and numerically larger

        await store.appendEvent(event({ id: high, room, sender: 'dev-a' }));
        await store.appendEvent(event({ id: low, room, sender: 'dev-a' }));

        const listed = await store.listEvents(room);
        expect(listed.map((e) => e.id)).toEqual([low, high]);
        // And the store agrees with the comparator the clients use.
        expect(compareIds(low, high)).toBeLessThan(0);
      });

      it('deduplicates a retry by nonce, per device', async () => {
        const room = uniq('room');
        const e = event({ id: snowflake(), room, sender: 'dev-a', clientNonce: 'shared-nonce' });

        const first = await store.appendEvent(e);
        const second = await store.appendEvent({ ...e, id: snowflake() });

        expect(first.deduped).toBe(false);
        expect(second.deduped).toBe(true);
        expect(second.event.id).toBe(e.id);
        expect(await store.listEvents(room)).toHaveLength(1);
      });

      it('lets two devices pick the same nonce without shadowing each other', async () => {
        const room = uniq('room');
        const a = await store.appendEvent(
          event({ id: snowflake(), room, sender: 'dev-a', clientNonce: 'same' }),
        );
        const b = await store.appendEvent(
          event({ id: snowflake(), room, sender: 'dev-b', clientNonce: 'same' }),
        );
        expect(a.deduped).toBe(false);
        expect(b.deduped).toBe(false);
        expect(await store.listEvents(room)).toHaveLength(2);
      });

      it('pages backwards from a cursor', async () => {
        const room = uniq('room');
        const base = 1767225600000000000n;
        const ids = Array.from({ length: 10 }, (_, i) => String(base + BigInt(i)));
        for (const id of ids) await store.appendEvent(event({ id, room, sender: 'dev-a' }));

        const tail = await store.listEvents(room, { limit: 3 });
        expect(tail.map((e) => e.id)).toEqual(ids.slice(-3));

        const older = await store.listEvents(room, { before: ids[7] as string, limit: 3 });
        expect(older.map((e) => e.id)).toEqual(ids.slice(4, 7));
      });

      it('purges the bytes and keeps the tombstone', async () => {
        // A client that has this cached learns to drop its copy rather than
        // silently diverging, and it can only learn that from a row that stayed.
        const room = uniq('room');
        const id = snowflake();
        await store.appendEvent(event({ id, room, sender: 'dev-a' }));

        expect(await store.purgeEvent(room, id)).toBe(true);
        const [purged] = await store.listEvents(room);
        expect(purged?.payload).toBe('');
        expect(purged?.size).toBe(0);
        expect(purged?.purgedAt).toBeGreaterThan(0);

        expect(await store.purgeEvent(room, 'no-such-event')).toBe(false);

        // Purging twice is not two purges. A retried request or a double-clicked
        // moderation action must not rewrite when the purge happened.
        const at = purged?.purgedAt;
        expect(await store.purgeEvent(room, id)).toBe(false);
        expect((await store.listEvents(room))[0]?.purgedAt).toBe(at);
      });

      it('round-trips the optional metadata fields as absent, not null', async () => {
        // `stream` and `notify` are optional on the wire; a `stream: null` would
        // fail the event's own schema on the way back out.
        const room = uniq('room');
        const plain = snowflake();
        const hinted = snowflake();
        await store.appendEvent(event({ id: plain, room, sender: 'dev-a' }));
        await store.appendEvent(
          event({ id: hinted, room, sender: 'dev-a', stream: '123', notify: ['acct-a'] }),
        );

        const listed = await store.listEvents(room);
        const first = listed.find((e) => e.id === plain);
        const second = listed.find((e) => e.id === hinted);
        expect(first?.stream).toBeUndefined();
        expect(first?.notify).toBeUndefined();
        expect(second?.stream).toBe('123');
        expect(second?.notify).toEqual(['acct-a']);
      });
    });

    // -------------------------------------------------------------------------
    describe('blobs', () => {
      // Snowflakes, like `deps.newId()` mints in the route. A fixture id of
      // `blob-3` type-checks and works against a `bytea` column, and is
      // rejected outright by a store that puts bytes on a filesystem — where a
      // path assembled from a caller-influenced string is a traversal waiting
      // to happen. A fixture that does not look like the real thing cannot
      // catch that.
      const blob = (id: string) => ({
        id,
        roomId: 'room-1',
        uploader: 'acct-a',
        size: 4,
        hash: 'abc',
        createdAt: 1_700_000_000_000,
        purgedAt: null,
      });

      it('stores ciphertext and hands it back byte for byte', async () => {
        const id = snowflake();
        const bytes = new Uint8Array([1, 2, 250, 255]);
        await store.putBlob(blob(id), bytes);

        expect(await store.readBlob(id)).toEqual(bytes);
        expect((await store.getBlob(id))?.hash).toBe('abc');
      });

      it('keeps the first write and reports what is stored, not what was offered', async () => {
        // Found by review. Postgres refused the second write and returned the
        // caller's blob anyway — a 201 for ciphertext that was discarded — and
        // memory overwrote, silently replacing somebody else's bytes. Both were
        // wrong in different directions; the honest answer is the row that is
        // there.
        const id = snowflake();
        await store.putBlob(blob(id), new Uint8Array([1]));

        const second = await store.putBlob(
          { ...blob(id), size: 2, hash: 'different' },
          new Uint8Array([9, 9]),
        );

        expect(second.hash).toBe('abc');
        expect(second.size).toBe(4);
        expect(await store.readBlob(id)).toEqual(new Uint8Array([1]));
      });

      it('does not let a re-upload quietly un-purge an id', async () => {
        // The worse half of the same bug: the caller was told `purgedAt: null`
        // for a row that was still purged with its bytes gone.
        const id = snowflake();
        await store.putBlob(blob(id), new Uint8Array([1, 2, 3, 4]));
        await store.purgeBlob(id, 1_700_000_009_000);

        const again = await store.putBlob(blob(id), new Uint8Array([5, 6, 7, 8]));
        expect(again.purgedAt).toBe(1_700_000_009_000);
        expect(again.size).toBe(0);
        expect(await store.readBlob(id)).toBeNull();
      });

      it('distinguishes a purge from a 404', async () => {
        // Same shape as an event purge and for the same reason: a client with
        // the ciphertext cached needs to be told it is gone, and a missing row
        // cannot tell it anything.
        const id = snowflake();
        await store.putBlob(blob(id), new Uint8Array([1, 2, 3, 4]));

        expect(await store.purgeBlob(id, 1_700_000_009_000)).toBe(true);
        expect(await store.readBlob(id)).toBeNull();
        expect((await store.getBlob(id))?.purgedAt).toBe(1_700_000_009_000);
        expect((await store.getBlob(id))?.size).toBe(0);

        expect(await store.purgeBlob(id, 1)).toBe(false);
        expect(await store.getBlob('no-such-blob')).toBeNull();
      });
    });

    // -------------------------------------------------------------------------
    describe('key packages', () => {
      it('replaces the shelf rather than appending to a stale one', async () => {
        // A device that has just restored from backup holds different private
        // halves than whatever is on the shelf; adding would mean handing out
        // packages nobody can open.
        const pub = uniq('dev');
        await store.publishKeyPackages(pub, { packages: ['kp1', 'kp2'] });
        const supply = await store.publishKeyPackages(pub, { packages: ['kp3'] });

        expect(supply.available).toBe(1);
        expect((await store.claimKeyPackage(pub, 'g1'))?.keyPackage).toBe('kp3');
      });

      it('spends oldest first, so shelf age stays bounded', async () => {
        const pub = uniq('dev');
        await store.publishKeyPackages(pub, { packages: ['kp1', 'kp2', 'kp3'] });

        expect((await store.claimKeyPackage(pub, 'g1'))?.keyPackage).toBe('kp1');
        expect((await store.claimKeyPackage(pub, 'g2'))?.keyPackage).toBe('kp2');
        expect((await store.keyPackageSupply(pub)).available).toBe(1);
      });

      it('reuses an outstanding claim instead of burning a second package', async () => {
        // A commit refused for an epoch conflict gets retried, and a retry loop
        // that ate a package per attempt would be a way to drain a shelf
        // (`docs/03` §5, the authorised-claim fix).
        const pub = uniq('dev');
        await store.publishKeyPackages(pub, { packages: ['kp1', 'kp2'] });

        const first = await store.claimKeyPackage(pub, 'g1');
        const retry = await store.claimKeyPackage(pub, 'g1');

        expect(retry?.keyPackage).toBe(first?.keyPackage);
        expect((await store.keyPackageSupply(pub)).available).toBe(1);
        expect(await store.hasClaim('g1', pub)).toBe(true);
        expect(await store.hasClaim('g2', pub)).toBe(false);
      });

      it('falls back to the last-resort package without consuming it', async () => {
        const pub = uniq('dev');
        await store.publishKeyPackages(pub, { packages: [], lastResort: 'lr' });

        const a = await store.claimKeyPackage(pub, 'g1');
        const b = await store.claimKeyPackage(pub, 'g2');
        expect(a).toEqual({ keyPackage: 'lr', lastResort: true });
        // Reusable is the entire point of having one.
        expect(b).toEqual({ keyPackage: 'lr', lastResort: true });
        expect((await store.keyPackageSupply(pub)).lastResort).toBe(true);
      });

      it('returns null for a device with nothing on the shelf', async () => {
        expect(await store.claimKeyPackage(uniq('dev'), 'g1')).toBeNull();
      });
    });

    // -------------------------------------------------------------------------
    describe('enrolment', () => {
      const enrolment = (handle: string, accountPub: string) => ({
        handle,
        accountPub,
        record: 'an-opaque-registration-record',
        recoveryVerifier: 'cHJvb2Y',
        createdAt: 1_700_000_000_000,
      });

      it('creates an enrolment and finds it either way round', async () => {
        const handle = uniq('handle');
        const account = uniq('acct');
        expect(await store.createEnrolment(enrolment(handle, account))).not.toBeNull();

        expect((await store.getEnrolment(handle))?.accountPub).toBe(account);
        expect((await store.getEnrolmentByAccount(account))?.handle).toBe(handle);
      });

      it('refuses a handle that is taken, rather than overwriting it', async () => {
        // Overwriting would let anybody who knows a handle replace the record
        // and the wraps — an account takeover with no password in it.
        const handle = uniq('handle');
        const first = uniq('acct');
        await store.createEnrolment(enrolment(handle, first));

        expect(await store.createEnrolment(enrolment(handle, uniq('acct')))).toBeNull();
        expect((await store.getEnrolment(handle))?.accountPub).toBe(first);
      });

      it('refuses a second handle for one account', async () => {
        const account = uniq('acct');
        await store.createEnrolment(enrolment(uniq('handle'), account));
        expect(await store.createEnrolment(enrolment(uniq('handle'), account))).toBeNull();
      });

      it('replaces one wrap and leaves the others', async () => {
        // `docs/03` §1: a password change is one write. A change that disturbed
        // the recovery wrap would turn a routine action into an account loss.
        const account = uniq('acct');
        await store.putWrap(account, { kind: 'password', blob: 'b25l' });
        await store.putWrap(account, { kind: 'recovery', blob: 'dHdv', salt: 'c2FsdA' });
        await store.putWrap(account, { kind: 'password', blob: 'dGhyZWU' });

        const wraps = await store.wrapsFor(account);
        expect(wraps).toHaveLength(2);
        expect(wraps.find((w) => w.kind === 'password')?.blob).toBe('dGhyZWU');
        expect(wraps.find((w) => w.kind === 'recovery')?.blob).toBe('dHdv');
        expect(wraps.find((w) => w.kind === 'recovery')?.salt).toBe('c2FsdA');
      });

      it('keeps one account wraps out of another', async () => {
        const a = uniq('acct');
        const b = uniq('acct');
        await store.putWrap(a, { kind: 'password', blob: 'YQ' });
        await store.putWrap(b, { kind: 'password', blob: 'Yg' });
        expect((await store.wrapsFor(a))[0]?.blob).toBe('YQ');
        expect(await store.wrapsFor(uniq('acct'))).toEqual([]);
      });

      it('keeps the recovery verifier, which is what recovery compares', async () => {
        const handle = uniq('handle');
        const account = uniq('acct');
        await store.createEnrolment(enrolment(handle, account));
        expect((await store.getEnrolment(handle))?.recoveryVerifier).toBe('cHJvb2Y');
      });

      it('replaces the registration record, which is what a password change is', async () => {
        const handle = uniq('handle');
        const account = uniq('acct');
        await store.createEnrolment(enrolment(handle, account));
        await store.putRegistrationRecord(account, 'a-new-record');
        expect((await store.getEnrolment(handle))?.record).toBe('a-new-record');
      });

      it('spends a login session exactly once', async () => {
        // An OPAQUE server state that can be spent twice is a replay.
        const id = uniq('login');
        await store.putLoginSession(id, {
          accountPub: 'acct-a',
          handle: 'viola',
          state: 'server-state',
          expiresAt: Date.now() + 60_000,
        });
        expect((await store.takeLoginSession(id))?.state).toBe('server-state');
        expect(await store.takeLoginSession(id)).toBeNull();
      });

      it('refuses an expired login session, and still consumes it', async () => {
        const id = uniq('login');
        await store.putLoginSession(id, {
          accountPub: 'acct-a',
          handle: 'viola',
          state: 'stale',
          expiresAt: Date.now() - 1,
        });
        expect(await store.takeLoginSession(id)).toBeNull();
        expect(await store.takeLoginSession(id)).toBeNull();
      });

      it('relays a handoff exactly once, then forgets it', async () => {
        // The IdP relays and cannot read — what crosses is sealed under a key it
        // never had. What it *must* get right is the counting: once in, once
        // out, and gone.
        const id = uniq('chan');
        await store.putChannel(id, {
          transferPub: 'dHJhbnNmZXI',
          delivery: null,
          expiresAt: Date.now() + 60_000,
        });

        // Polling before the other side answers must not destroy the channel
        // the new device is waiting on.
        expect((await store.takeChannel(id))?.delivery).toBeNull();
        expect((await store.takeChannel(id))?.transferPub).toBe('dHJhbnNmZXI');

        expect(await store.deliverChannel(id, '{"sealed":"x"}')).toBe(true);
        // Once. A second delivery would let anybody who saw the QR overwrite
        // what the real device sent.
        expect(await store.deliverChannel(id, '{"sealed":"y"}')).toBe(false);

        expect((await store.takeChannel(id))?.delivery).toBe('{"sealed":"x"}');
        // Consumed: the sealed key does not sit at the IdP after it arrives.
        expect(await store.takeChannel(id)).toBeNull();
      });

      it('lets a channel expire, because a QR is not a durable thing', async () => {
        const id = uniq('chan');
        await store.putChannel(id, {
          transferPub: 'dHJhbnNmZXI',
          delivery: null,
          expiresAt: Date.now() - 1,
        });
        expect(await store.getChannel(id)).toBeNull();
        // And an expired one cannot be delivered into, or a stale QR would stay
        // an invitation indefinitely.
        expect(await store.deliverChannel(id, '{}')).toBe(false);
      });

      it('stores a second factor, unconfirmed until it is confirmed', async () => {
        // An enrolment that gated logins before a correct code proved the app
        // was actually set up would lock somebody out with a typo.
        const account = uniq('acct');
        await store.putTotp(account, { secret: 'ABCD', lastCounter: null, confirmedAt: null });
        expect(await store.getTotp(account)).toEqual({
          secret: 'ABCD',
          lastCounter: null,
          confirmedAt: null,
        });

        await store.putTotp(account, {
          secret: 'ABCD',
          lastCounter: 42,
          confirmedAt: 1_700_000_000_000,
        });
        const confirmed = await store.getTotp(account);
        expect(confirmed?.confirmedAt).toBe(1_700_000_000_000);
        // The spent counter is what makes a code single-use.
        expect(confirmed?.lastCounter).toBe(42);

        await store.deleteTotp(account);
        expect(await store.getTotp(account)).toBeNull();
      });
    });

    // -------------------------------------------------------------------------
    describe('groups and the handshake log', () => {
      /** A group with its room bound and one member device. */
      async function group() {
        const roomId = uniq('room');
        const groupId = uniq('grp');
        const creator = { devicePub: uniq('dev'), accountId: 'acct-a' };
        await store.createRoom(
          {
            id: roomId,
            kind: 'text',
            spaceId: 's1',
            groupId: null,
            streamPaging: false,
            notifyHints: false,
          },
          ['acct-a'],
        );
        await store.createGroup(groupId, roomId, creator);
        return { roomId, groupId, creator };
      }

      it('binds the room to the group as it creates it', async () => {
        // A group with no room is unreachable; a room pointing at a group that
        // does not exist is a room nobody can post to.
        const { roomId, groupId } = await group();
        expect((await store.getRoom(roomId))?.groupId).toBe(groupId);
        expect((await store.getGroupRooms(groupId)).map((r) => r.id)).toEqual([roomId]);
        expect((await store.getGroup(groupId))?.epoch).toBe(0);
      });

      it('does not rewind a group that already exists', async () => {
        // Found by review. Memory overwrote unconditionally and reported epoch
        // 0 for a group that had already committed; Postgres did not. A group
        // rewound to epoch 0 accepts a stale commit built at epoch 0, which is
        // exactly the fork the locked transaction below exists to prevent.
        const { roomId, groupId, creator } = await group();
        await store.appendHandshake({
          groupId,
          sender: creator.devicePub,
          kind: 'commit',
          epoch: 0,
          bytes: 'eA==',
          at: Date.now(),
        });
        expect((await store.getGroup(groupId))?.epoch).toBe(1);

        await store.createGroup(groupId, roomId, creator);
        expect((await store.getGroup(groupId))?.epoch).toBe(1);
      });

      it('refuses a commit built from a stale epoch', async () => {
        // The commit race, which is the failure nothing can repair: both devices
        // read epoch 0, both are told to go ahead, and everyone after the fork
        // fails to decrypt — sender included.
        const { groupId, creator } = await group();
        const base = {
          groupId,
          sender: creator.devicePub,
          kind: 'commit' as const,
          bytes: 'Y29tbWl0',
          at: Date.now(),
        };

        const first = await store.appendHandshake({ ...base, epoch: 0 });
        const second = await store.appendHandshake({ ...base, epoch: 0 });

        expect(first.accepted).toBe(true);
        expect(second.accepted).toBe(false);
        if (!second.accepted) {
          expect(second.reason).toBe('epoch_conflict');
          // And it says where the group actually is, so the loser can rebuild.
          expect(second.epoch).toBe(1);
        }
      });

      it('counts proposals and lets a commit sweep them up', async () => {
        const { groupId, creator } = await group();
        const base = { groupId, sender: creator.devicePub, bytes: 'eA==', at: Date.now() };

        await store.appendHandshake({ ...base, kind: 'proposal', epoch: 0 });
        await store.appendHandshake({ ...base, kind: 'proposal', epoch: 0 });
        expect((await store.getGroup(groupId))?.pendingProposals).toBe(2);
        // A proposal does not move the epoch, which is why two can sit there.
        expect((await store.getGroup(groupId))?.epoch).toBe(0);

        await store.appendHandshake({ ...base, kind: 'commit', epoch: 0 });
        const after = await store.getGroup(groupId);
        expect(after?.epoch).toBe(1);
        expect(after?.pendingProposals).toBe(0);
      });

      it('numbers the log densely, because a gap looks like a dropped record', async () => {
        // Clients page by `seq` and treat a jump as a withheld record, which is
        // exactly the attack `docs/29` §4 has them check for.
        const { groupId, creator } = await group();
        const base = { groupId, sender: creator.devicePub, bytes: 'eA==', at: Date.now() };
        await store.appendHandshake({ ...base, kind: 'proposal', epoch: 0 });
        await store.appendHandshake({ ...base, kind: 'commit', epoch: 0 });
        await store.appendHandshake({ ...base, kind: 'commit', epoch: 1 });

        const log = await store.listHandshake(groupId);
        expect(log.map((r) => r.seq)).toEqual([0, 1, 2]);
        expect(log.map((r) => r.epoch)).toEqual([0, 0, 1]);
        expect((await store.listHandshake(groupId, { since: 0 })).map((r) => r.seq)).toEqual([
          1, 2,
        ]);
      });

      it('refuses a Welcome for a device nobody claimed a package for', async () => {
        // The check that stops a Host pushing arbitrary bytes at a device.
        const { groupId, creator } = await group();
        const stranger = uniq('dev');

        const result = await store.appendHandshake({
          groupId,
          sender: creator.devicePub,
          kind: 'commit',
          epoch: 0,
          bytes: 'eA==',
          welcome: { bytes: 'd2VsY29tZQ==', devices: [stranger] },
          at: Date.now(),
        });

        expect(result.accepted).toBe(false);
        if (!result.accepted && result.reason === 'unclaimed_welcome') {
          expect(result.devices).toEqual([stranger]);
        }
        // And it did not half-apply: the epoch has not moved.
        expect((await store.getGroup(groupId))?.epoch).toBe(0);
        expect(await store.listHandshake(groupId)).toHaveLength(0);
      });

      it('queues a Welcome, consumes the claim, and survives until acked', async () => {
        const { groupId, creator } = await group();
        const joiner = uniq('dev');
        await store.publishKeyPackages(joiner, { packages: ['kp1'] });
        await store.claimKeyPackage(joiner, groupId);

        await store.appendHandshake({
          groupId,
          sender: creator.devicePub,
          kind: 'commit',
          epoch: 0,
          bytes: 'eA==',
          welcome: { bytes: 'd2VsY29tZQ==', devices: [joiner] },
          added: [{ devicePub: joiner, accountId: 'acct-b' }],
          tree: 'dHJlZQ==',
          at: 1_700_000_000_000,
        });

        // At-least-once: reading does not consume, because a Welcome removed as
        // it is handed to a socket is lost if that socket dies a millisecond
        // later — silently and permanently.
        expect(await store.listWelcomes(joiner)).toHaveLength(1);
        expect(await store.listWelcomes(joiner)).toHaveLength(1);
        expect((await store.listWelcomes(joiner, groupId))[0]?.bytes).toBe('d2VsY29tZQ==');

        // The claim is spent by the commit that used it.
        expect(await store.hasClaim(groupId, joiner)).toBe(false);
        // The tree is written in the same transaction, at the new epoch.
        expect(await store.getTree(groupId)).toEqual({ epoch: 1, tree: 'dHJlZQ==' });
        expect((await store.getGroupMember(groupId, joiner))?.addedEpoch).toBe(1);

        await store.ackWelcome(joiner, groupId);
        expect(await store.listWelcomes(joiner)).toHaveLength(0);
      });

      it('adds, welcomes and removes several devices in one commit', async () => {
        // One person with several devices is the ordinary case — `docs/03` §1
        // gives every device its own leaf — and the Postgres store batches all
        // three of these into single statements because they run while the
        // group row is locked. Every other test here adds exactly one device,
        // so without this the batched SQL is never executed at all.
        const { groupId, creator } = await group();
        const devices = [uniq('dev'), uniq('dev'), uniq('dev')];
        for (const device of devices) {
          await store.publishKeyPackages(device, { packages: ['kp1'] });
          await store.claimKeyPackage(device, groupId);
        }

        const joined = await store.appendHandshake({
          groupId,
          sender: creator.devicePub,
          kind: 'commit',
          epoch: 0,
          bytes: 'eA==',
          welcome: { bytes: 'd2VsY29tZQ==', devices },
          added: devices.map((devicePub) => ({ devicePub, accountId: 'acct-multi' })),
          at: 1_700_000_000_000,
        });
        expect(joined.accepted).toBe(true);

        expect((await store.listGroupMembers(groupId)).map((m) => m.devicePub).sort()).toEqual(
          [creator.devicePub, ...devices].sort(),
        );
        for (const device of devices) {
          expect(await store.listWelcomes(device)).toHaveLength(1);
          expect(await store.hasClaim(groupId, device)).toBe(false);
        }

        // And all three back out again, in one commit.
        await store.appendHandshake({
          groupId,
          sender: creator.devicePub,
          kind: 'commit',
          epoch: 1,
          bytes: 'eA==',
          removed: devices,
          at: Date.now(),
        });
        for (const device of devices) {
          expect(await store.getGroupMember(groupId, device)).toBeNull();
          expect(await store.listWelcomes(device)).toHaveLength(0);
        }
      });

      it('takes a removed device queued Welcome away with it', async () => {
        // One still sitting there would let a removed device walk back in.
        const { groupId, creator } = await group();
        const joiner = uniq('dev');
        await store.publishKeyPackages(joiner, { packages: ['kp1'] });
        await store.claimKeyPackage(joiner, groupId);
        await store.appendHandshake({
          groupId,
          sender: creator.devicePub,
          kind: 'commit',
          epoch: 0,
          bytes: 'eA==',
          welcome: { bytes: 'd2VsY29tZQ==', devices: [joiner] },
          added: [{ devicePub: joiner, accountId: 'acct-b' }],
          at: Date.now(),
        });
        expect(await store.listWelcomes(joiner)).toHaveLength(1);

        await store.appendHandshake({
          groupId,
          sender: creator.devicePub,
          kind: 'commit',
          epoch: 1,
          bytes: 'eA==',
          removed: [joiner],
          at: Date.now(),
        });

        expect(await store.listWelcomes(joiner)).toHaveLength(0);
        expect(await store.getGroupMember(groupId, joiner)).toBeNull();
      });

      it('lets a device drop its own membership so it can be added back', async () => {
        // The server skips devices it already lists when claiming key packages,
        // so without this a diverged session could never rejoin (`docs/31` §8).
        const { groupId, creator } = await group();
        expect(await store.getGroupMember(groupId, creator.devicePub)).not.toBeNull();

        await store.leaveGroup(groupId, creator.devicePub);
        expect(await store.getGroupMember(groupId, creator.devicePub)).toBeNull();
        expect(await store.listGroupMembers(groupId)).toHaveLength(0);
      });

      it('records activity, which is what orders the committer fallback', async () => {
        const { groupId, creator } = await group();
        await store.touchGroupMember(groupId, creator.devicePub, 1_700_000_042_000);
        expect((await store.getGroupMember(groupId, creator.devicePub))?.lastActiveAt).toBe(
          1_700_000_042_000,
        );
      });

      it('never lets the tree go backwards', async () => {
        // Handshake records get retried, and a late write of an older tree
        // would hand joiners a tree that does not match the epoch their Welcome
        // is for.
        const { groupId } = await group();
        await store.putTree(groupId, 5, 'bmV3');
        await store.putTree(groupId, 3, 'b2xk');
        expect(await store.getTree(groupId)).toEqual({ epoch: 5, tree: 'bmV3' });
      });

      it('has no tree and no group before either exists', async () => {
        expect(await store.getTree('no-such-group')).toBeNull();
        expect(await store.getGroup('no-such-group')).toBeNull();
        expect(await store.listHandshake('no-such-group')).toEqual([]);
      });
    });
  });
}
