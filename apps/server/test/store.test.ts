/**
 * The conformance suite, run against both stores.
 *
 * See `store.conformance.ts` for what it checks and why it is one suite rather
 * than two. This file is only the wiring: `MemoryStore` always, `PostgresStore`
 * when `DATABASE_URL` points at something.
 *
 *   docker compose up -d
 *   DATABASE_URL=postgres://revel:revel@localhost:5432/revel pnpm test
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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

  afterAll(async () => {
    await store.close();
  });
} else {
  describe('PostgresStore', () => {
    // Visible rather than absent. A skipped suite that prints nothing is one
    // nobody remembers exists, and this is the half that checks the code a
    // real Host runs.
    it.skip('needs DATABASE_URL — `docker compose up -d` and set it', () => {});
  });
}
