/**
 * Schema migrations.
 *
 * The previous version ran one `schema.sql` full of `IF NOT EXISTS`, which is
 * safe to run at boot and **useless the moment there is data in the database**:
 * it creates what is absent and never alters what is there, so the first time a
 * column needs to change there is nowhere to say so.
 *
 * This is the ordinary versioned-migrations design, and the three details that
 * are easy to leave out are the three that bite:
 *
 * 1. **An advisory lock around the whole run.** Two Hosts booting at once is
 *    now a real scenario rather than a hypothetical — `REVEL_SHARD` exists
 *    precisely because more than one process shares a database — and without
 *    this both would try to apply migration 007 and one would fail on a
 *    duplicate object, at boot, in front of a deploy.
 * 2. **One transaction per migration.** A half-applied migration is worse than
 *    a failed one: it leaves a schema that matches no version number, which
 *    every later run then reasons about wrongly.
 * 3. **A checksum per applied migration.** Editing a migration that has already
 *    run is the classic footgun — it works perfectly on your machine, where it
 *    has never been applied in its old form, and diverges silently everywhere
 *    it has. Recording the hash turns that into an error at the next boot.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';

type Sql = postgres.Sql<Record<string, never>>;

export interface Migration {
  /** The numeric prefix. Applied in ascending order, no gaps required. */
  version: number;
  name: string;
  sql: string;
}

/** SHA-256 of the file, hex. Short enough to read in an error message. */
const checksum = (sql: string): string =>
  createHash('sha256').update(sql).digest('hex').slice(0, 16);

/**
 * Read `migrations/*.sql`, ordered.
 *
 * Sorted by the parsed number rather than by filename, so `010` lands after
 * `009` rather than after `001` — which is how a lexical sort would do it, and
 * is a bug that only appears on the tenth migration.
 */
export async function loadMigrations(): Promise<Migration[]> {
  const dir = fileURLToPath(new URL('./migrations/', import.meta.url));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql'));

  const out: Migration[] = [];
  for (const file of files) {
    const match = /^(\d+)[_-](.+)\.sql$/.exec(file);
    if (!match) throw new Error(`migration ${file} is not named <number>_<name>.sql`);
    out.push({
      version: Number(match[1]),
      name: match[2] as string,
      sql: await readFile(`${dir}${file}`, 'utf8'),
    });
  }

  out.sort((a, b) => a.version - b.version);
  for (let i = 1; i < out.length; i++) {
    if (out[i]?.version === out[i - 1]?.version) {
      throw new Error(`two migrations share version ${out[i]?.version}`);
    }
  }
  return out;
}

export interface MigrateResult {
  applied: Migration[];
  alreadyApplied: number;
}

/**
 * Apply everything not yet applied.
 *
 * Safe to call at every boot and safe to call from several processes at once.
 */
export async function migrate(sql: Sql, migrations: Migration[]): Promise<MigrateResult> {
  // **The lock comes first, before the bookkeeping table exists.**
  //
  // `CREATE TABLE IF NOT EXISTS` is not race-proof — two sessions both find it
  // missing, both try, and one dies on `duplicate key value violates unique
  // constraint "pg_type_typname_nsp_index"`. Creating the ledger *inside* the
  // lock was the whole point of having one, and doing it just above was a bug
  // the concurrency test caught on its first honest run.
  //
  // A session lock rather than a transaction one, because each migration gets
  // its own transaction below and a transaction-scoped lock would be released
  // by the first commit.
  await sql`SELECT pg_advisory_lock(hashtext('revel/migrate'))`;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    integer PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;

    const rows = await sql`SELECT version, name, checksum FROM schema_migrations`;
    const applied = new Map(
      rows.map((r) => [r.version as number, { name: r.name as string, sum: r.checksum as string }]),
    );

    // Check every already-applied migration before running anything new, so an
    // edited one is caught rather than being built on top of.
    for (const migration of migrations) {
      const seen = applied.get(migration.version);
      if (!seen) continue;
      const sum = checksum(migration.sql);
      if (seen.sum !== sum) {
        throw new Error(
          `migration ${migration.version} (${migration.name}) has changed since it was applied ` +
            `(${seen.sum} → ${sum}). Applied migrations are history; add a new one instead.`,
        );
      }
    }

    const pending = migrations.filter((m) => !applied.has(m.version));
    for (const migration of pending) {
      // Its own transaction: a half-applied migration leaves a schema matching
      // no version number, which every later run then reasons about wrongly.
      await sql.begin(async (tx) => {
        await tx.unsafe(migration.sql);
        await tx`
          INSERT INTO schema_migrations (version, name, checksum)
          VALUES (${migration.version}, ${migration.name}, ${checksum(migration.sql)})`;
      });
    }

    return { applied: pending, alreadyApplied: applied.size };
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtext('revel/migrate'))`;
  }
}
