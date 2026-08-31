/**
 * The migration runner.
 *
 * What it has to get right is not "does the SQL run" — that is the easy half —
 * but the three things that only go wrong later: an edited migration that has
 * already been applied, two processes booting at once, and a migration that
 * fails halfway.
 *
 * Skipped without `DATABASE_URL`, like the store conformance suite.
 */
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, migrate } from '../src/store/migrate.js';

const url = process.env.DATABASE_URL;
const scenarios = url ? describe : describe.skip;

/**
 * A throwaway schema per test, so nothing here touches the real tables.
 *
 * **`max: 1` is load-bearing.** `search_path` is per connection, so with a pool
 * the `SET` and the migration it is meant to scope can land on different
 * backends — and the tests would then be quietly running against `public`,
 * passing or failing on which connection they happened to get. One connection
 * makes the scoping real rather than likely.
 *
 * The concurrency test below needs genuine parallelism, so it opens its own.
 */
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;

scenarios('applying migrations', () => {
  beforeEach(async () => {
    if (!sql) return;
    await sql.unsafe(
      'DROP SCHEMA IF EXISTS mtest CASCADE; CREATE SCHEMA mtest; SET search_path TO mtest',
    );
  });

  /** Runs against the `mtest` schema rather than `public`. */
  async function run(list: Parameters<typeof migrate>[1]) {
    if (!sql) throw new Error('no database');
    return migrate(sql, list);
  }

  const one = { version: 1, name: 'one', sql: 'CREATE TABLE a (id int)' };
  const two = { version: 2, name: 'two', sql: 'CREATE TABLE b (id int)' };

  it('applies pending migrations in order, once', async () => {
    const first = await run([one, two]);
    expect(first.applied.map((m) => m.version)).toEqual([1, 2]);

    // Running again is a no-op. This is what makes it safe at every boot.
    const second = await run([one, two]);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toBe(2);
  });

  it('applies only what is new when a migration is added', async () => {
    await run([one]);
    const next = await run([one, two]);
    expect(next.applied.map((m) => m.version)).toEqual([2]);
  });

  it('refuses to run when an applied migration has been edited', async () => {
    // **The footgun this exists for.** Editing a migration that has already run
    // works perfectly on the machine where it has never been applied in its old
    // form, and diverges silently on every machine where it has.
    await run([one]);
    const edited = { ...one, sql: 'CREATE TABLE a (id int, extra text)' };
    await expect(run([edited, two])).rejects.toThrow(/has changed since it was applied/);
  });

  it('checks every applied migration before running any new one', async () => {
    // Order matters: an edited migration must be caught *before* something is
    // built on top of it, not after.
    await run([one]);
    const edited = { ...one, sql: 'CREATE TABLE a (id int, extra text)' };
    await expect(run([edited, two])).rejects.toThrow();

    if (!sql) return;
    const [row] = await sql`SELECT count(*)::int AS n FROM schema_migrations`;
    expect(row?.n).toBe(1);
  });

  it('leaves nothing behind when a migration fails', async () => {
    // A half-applied migration is worse than a failed one: it leaves a schema
    // matching no version number, which every later run reasons about wrongly.
    const broken = { version: 2, name: 'broken', sql: 'CREATE TABLE b (id int); NOT SQL AT ALL' };
    await expect(run([one, broken])).rejects.toThrow();

    if (!sql) return;
    const applied = await sql`SELECT version FROM schema_migrations ORDER BY version`;
    expect(applied.map((r) => r.version)).toEqual([1]);
    // And the table the broken migration created first is gone with it.
    const [b] = await sql`SELECT to_regclass('mtest.b') AS t`;
    expect(b?.t).toBeNull();
  });

  it('lets two concurrent migrations settle instead of colliding', async () => {
    // Two Hosts booting at once is a real scenario now — `REVEL_SHARD` exists
    // because more than one process shares a database. Without the advisory
    // lock both apply migration 2 and one fails on a duplicate object, at boot,
    // during a deploy.
    //
    // Two *separate pools*, because that is what two Hosts are. Sharing the
    // single connection above would serialise them at the driver and prove
    // nothing about the lock — the same way the store's first commit-race test
    // passed against no lock at all (`docs/31` §28).
    if (!url) return;
    const a = postgres(url, { max: 1, onnotice: () => {} });
    const b = postgres(url, { max: 1, onnotice: () => {} });
    try {
      // Open both connections before racing, so neither is still doing a TCP
      // handshake while the other finishes.
      await Promise.all([a`SET search_path TO mtest`, b`SET search_path TO mtest`]);

      const results = await Promise.all([migrate(a, [one, two]), migrate(b, [one, two])]);
      const total = results.flatMap((r) => r.applied.map((m) => m.version));
      // Between them they applied each exactly once, and neither threw.
      expect(total.sort()).toEqual([1, 2]);
    } finally {
      await Promise.all([a.end({ timeout: 5 }), b.end({ timeout: 5 })]);
    }
  });
});

describe('reading the migration directory', () => {
  it('orders by number, not by filename', async () => {
    // A lexical sort puts `010` after `001`, which is a bug that first appears
    // on the tenth migration and is invisible until then.
    const list = await loadMigrations();
    const versions = list.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('finds the initial schema', async () => {
    const list = await loadMigrations();
    expect(list[0]).toMatchObject({ version: 1, name: 'initial' });
    expect(list[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS events');
  });
});

afterAll(async () => {
  if (!sql) return;
  await sql.unsafe('DROP SCHEMA IF EXISTS mtest CASCADE');
  await sql.end({ timeout: 5 });
});
