/**
 * The conformance suite, run against both stores.
 *
 * See `store.conformance.ts` for what it checks and why it is one suite rather
 * than two. This file is only the wiring: `MemoryStore` always, and — when
 * `DATABASE_URL` points at something — `PostgresStore` twice, once with
 * attachment bytes in a `bytea` column and once with them on disk.
 *
 * Three runs of one suite rather than three suites. The blob seam is only worth
 * having if both sides of it behave identically, and "identically" is a claim
 * that wants the same tests, not a new set.
 *
 *   docker compose up -d --wait
 *   DATABASE_URL=postgres://revel:revel@localhost:5432/revel pnpm test
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FileBlobBytes } from '../src/store/blobstore.js';
import { MemoryStore } from '../src/store/memory.js';
import { PostgresStore } from '../src/store/postgres.js';
import { describeStore } from './store.conformance.js';

describeStore('MemoryStore', {
  make: async () => new MemoryStore(),
  reset: async () => {},
});

const url = process.env.DATABASE_URL;

if (url) {
  const store = new PostgresStore({ url, max: 4 });
  // One connection pool and one schema for the whole file, truncated between
  // tests. Creating a database per test would be correct and slow enough that
  // somebody would eventually stop running this.
  const TABLES = [
    'accounts',
    'devices',
    'rooms',
    'memberships',
    'roles',
    'overrides',
    'space_owners',
    'events',
    'blobs',
    'challenges',
    'sessions',
    'push_subscriptions',
    'key_packages',
    'last_resort_packages',
    'key_package_claims',
    'groups',
    'group_members',
    'handshake_log',
    'group_welcomes',
    'group_trees',
    'enrolments',
    'wraps',
    'login_sessions',
    'totp_secrets',
    'enrol_channels',
  ];

  await store.migrate();

  describeStore('PostgresStore', {
    make: async () => store,
    // `RESTART IDENTITY` matters: `key_packages.seq` is a sequence and the
    // "oldest first" test reads ordering off it, so leaving it climbing across
    // tests would work here and hide a real dependency on insertion order.
    reset: async () => {
      await store.sql.unsafe(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`);
    },
  });

  /**
   * What Postgres has to do that a `Map` cannot.
   *
   * The conformance suite above checks the two stores *agree*. It cannot check
   * the reason the Postgres one exists: JavaScript does not interleave, so
   * `MemoryStore`'s epoch check is safe for free and proves nothing about two
   * processes hitting one database.
   */
  describe('PostgresStore under concurrency', () => {
    beforeEach(async () => {
      await store.sql.unsafe(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`);
      await warm();
    });

    /**
     * Open every pooled connection before racing anything.
     *
     * **Without this these tests pass for the wrong reason**, which is worse
     * than failing: `postgres` opens connections lazily, so the first
     * transaction finishes in well under the millisecond it takes the second to
     * TCP-connect and authenticate. The two never overlap, nothing contends,
     * and the suite reports that a lock it never exercised is working.
     *
     * Found by deleting the `FOR UPDATE` and watching the race test pass twelve
     * times out of twelve.
     */
    async function warm() {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          store.sql.begin(async (sql) => {
            await sql`SELECT pg_sleep(0.02)`;
          }),
        ),
      );
    }

    it('lets exactly one of two simultaneous commits win', async () => {
      // **The commit race.** Both devices read epoch 0 and both are told to go
      // ahead; the group forks, and a forked group cannot be repaired — every
      // member after the fork fails to decrypt, sender included. `FOR UPDATE`
      // on the group row is the line that prevents it, and this is the test
      // that would notice if somebody removed it.
      await store.createRoom(
        {
          id: 'race-room',
          kind: 'text',
          spaceId: 's1',
          groupId: null,
          streamPaging: false,
          notifyHints: false,
        },
        ['acct-a'],
      );
      await store.createGroup('race-group', 'race-room', {
        devicePub: 'dev-a',
        accountId: 'acct-a',
      });

      const commit = (sender: string) =>
        store.appendHandshake({
          groupId: 'race-group',
          sender,
          kind: 'commit',
          epoch: 0,
          bytes: 'Y29tbWl0',
          at: Date.now(),
        });

      // Genuinely concurrent: separate connections from the pool, both in
      // flight before either finishes.
      const results = await Promise.all([commit('dev-a'), commit('dev-b')]);

      expect(results.filter((r) => r.accepted)).toHaveLength(1);
      expect(results.filter((r) => !r.accepted)).toHaveLength(1);
      // One epoch bump, one log record. Not two of either.
      expect((await store.getGroup('race-group'))?.epoch).toBe(1);
      expect(await store.listHandshake('race-group')).toHaveLength(1);
    });

    it('never burns two packages for one group racing itself', async () => {
      // Found by review, confirmed against Postgres before the fix: the
      // outstanding-claim check was an unlocked read, so two overlapping claims
      // for the *same* slot both saw "no claim", both took a package, and only
      // one was recorded. The shelf went down two for one add, which is the
      // retry-loop drain `docs/03` §5's authorised claim exists to prevent.
      //
      // The test below races two *different* groups and cannot see this.
      await store.publishKeyPackages('dev-retry', { packages: ['kp1', 'kp2', 'kp3'] });

      const claims = await Promise.all([
        store.claimKeyPackage('dev-retry', 'group-same'),
        store.claimKeyPackage('dev-retry', 'group-same'),
      ]);

      // One package, handed to both callers, recorded once.
      expect(claims[0]?.keyPackage).toBe(claims[1]?.keyPackage);
      expect((await store.keyPackageSupply('dev-retry')).available).toBe(2);
      expect(await store.hasClaim('group-same', 'dev-retry')).toBe(true);
    });

    it('never hands the same one-time key package to two groups', async () => {
      // A one-time package used twice is the forward secrecy it exists to
      // provide, gone. `DELETE … RETURNING` with `SKIP LOCKED` is why two
      // concurrent claims take two different packages rather than one blocking
      // on the other or both taking the same.
      await store.publishKeyPackages('dev-joiner', { packages: ['kp1', 'kp2'] });

      const claims = await Promise.all([
        store.claimKeyPackage('dev-joiner', 'group-1'),
        store.claimKeyPackage('dev-joiner', 'group-2'),
      ]);

      const packages = claims.map((c) => c?.keyPackage);
      expect(packages).toHaveLength(2);
      expect(new Set(packages).size).toBe(2);
      expect((await store.keyPackageSupply('dev-joiner')).available).toBe(0);
    });

    it('gives one of two simultaneous handle claims a clean refusal', async () => {
      // Found by review, confirmed before the fix: both transactions read the
      // handle as free and both inserted, so the loser threw `duplicate key`
      // instead of getting `claimed: false`. `accounts.ts` does not catch, so
      // the route returned 500 where it is written to return 409 `handle_taken`.
      const base = {
        handle: 'contested',
        displayName: null,
        avatar: null,
        status: 'active' as const,
        createdAt: 1_700_000_000_000,
        movedTo: null,
      };

      const results = await Promise.all([
        store.claimHandle({ ...base, id: 'acct-first' }),
        store.claimHandle({ ...base, id: 'acct-second' }),
      ]);

      expect(results.filter((r) => r.claimed)).toHaveLength(1);
      const loser = results.find((r) => !r.claimed);
      // And the loser is told who holds it, rather than being handed an error.
      expect(loser?.account.id).toBe(results.find((r) => r.claimed)?.account.id);
    });

    it('spends a challenge once even when two requests arrive together', async () => {
      // A nonce spent twice is a signature that can be replayed.
      await store.putChallenge('race-nonce', {
        devicePub: 'dev-a',
        expiresAt: Date.now() + 60_000,
      });

      const taken = await Promise.all([
        store.takeChallenge('race-nonce'),
        store.takeChallenge('race-nonce'),
      ]);
      expect(taken.filter(Boolean)).toHaveLength(1);
    });

    it('deduplicates a retry that arrives twice at once', async () => {
      const e = {
        id: '1767225600000000001',
        room: 'race-room-2',
        sender: 'dev-a',
        epoch: 1,
        class: 'normal' as const,
        payload: 'Y2lwaGVydGV4dA==',
        size: 12,
        clientNonce: 'race-nonce-x',
        createdAt: 1_700_000_000_000,
        purgedAt: null,
      };

      const both = await Promise.all([
        store.appendEvent(e),
        store.appendEvent({ ...e, id: '1767225600000000002' }),
      ]);

      expect(both.filter((r) => r.deduped)).toHaveLength(1);
      expect(await store.listEvents('race-room-2')).toHaveLength(1);
    });
  });

  /**
   * The same conformance suite, with attachment bytes on disk instead of in a
   * `bytea` column.
   *
   * Which is the point of running it twice: the blob seam is only worth having
   * if both sides of it behave identically, and "identically" is a claim that
   * needs the same tests rather than a new set of them.
   */
  const fileDir = mkdtempSync(join(tmpdir(), 'revel-blobs-'));
  const fileStore = new PostgresStore({
    url,
    max: 4,
    blobs: new FileBlobBytes({ dir: fileDir }),
  });

  describeStore('PostgresStore (blobs on disk)', {
    make: async () => fileStore,
    reset: async () => {
      await fileStore.sql.unsafe(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`);
      rmSync(fileDir, { recursive: true, force: true });
    },
  });

  afterAll(async () => {
    await store.close();
    await fileStore.close();
    rmSync(fileDir, { recursive: true, force: true });
  });
} else {
  describe('PostgresStore', () => {
    // Visible rather than absent. A skipped suite that prints nothing is one
    // nobody remembers exists, and this is the half that checks the code a
    // real Host runs.
    it.skip('needs DATABASE_URL — `docker compose up -d --wait` and set it', () => {});
  });
}
