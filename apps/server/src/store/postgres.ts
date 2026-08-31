/**
 * The Postgres [`Store`]. What a real Host runs.
 *
 * [`MemoryStore`] is the reference implementation and this is the one that has
 * to survive a restart, two processes, and a race. Everything they must agree
 * about is pinned by `test/store.test.ts`, which runs one suite against both —
 * because a test double that has quietly drifted from the real thing is worse
 * than no double at all: the whole suite goes green while production is wrong.
 *
 * ## Three things Postgres does that a Map cannot
 *
 * 1. **`appendHandshake` is one transaction with the group row locked.** In
 *    memory the epoch check is safe because JavaScript does not interleave; in
 *    Postgres two processes really do read epoch 4 at the same moment, and
 *    without `SELECT … FOR UPDATE` both would be told to go ahead. That is the
 *    commit race, and it forks the group in a way nothing can repair — everyone
 *    after the fork fails to decrypt, sender included.
 * 2. **`claimKeyPackage` and `takeChallenge` are `DELETE … RETURNING`.**
 *    Selecting and then deleting is two round trips with a gap in the middle,
 *    and a one-time key package handed out twice is exactly the forward secrecy
 *    it exists to provide, gone.
 * 3. **Ordering is `(length(id), id)`, never plain `id`.** Snowflakes are text
 *    (`docs/04` §6 — they exceed 2^53 and JSON has no bigint) and clients order
 *    them with `compareIds`, which compares them as `BigInt`. A lexical sort
 *    disagrees the moment two ids differ in length — '9999999999999999999'
 *    sorts *after* '10000000000000000000' because '9' > '1'. Sorting by
 *    `(length, text)` is numeric order for decimal strings with no leading
 *    zeros, which is what a snowflake is. The bug is invisible until a room
 *    crosses a digit boundary, at which point history reorders itself.
 *
 * ## Numbers
 *
 * `bigint` columns come back as strings — the driver refuses to silently lose
 * precision, which is right. Every one here is a millisecond timestamp, well
 * inside 2^53, so they are converted at the boundary by [`num`] and nowhere
 * else. Snowflake ids stay text the whole way and are never converted.
 */

import type { Event, HandshakeRecord, KeyPackageSupply, KeyPackageUpload } from '@revel/protocol';
import postgres from 'postgres';
import { loadMigrations, type MigrateResult, migrate as runMigrations } from './migrate.js';
import type {
  Account,
  Blob,
  Challenge,
  ClaimedPackage,
  Device,
  Group,
  GroupMember,
  GroupMemberInput,
  HandshakeAppend,
  HandshakeResult,
  Membership,
  Override,
  Role,
  Room,
  Session,
  Store,
  StoredPushSubscription,
  StoredWelcome,
} from './types.js';

type Sql = postgres.Sql<Record<string, never>>;
type Row = Record<string, unknown>;

/** A `bigint` column, as a number. See the note on numbers above. */
const num = (v: unknown): number => Number(v);
/** A nullable `bigint` column. `null` is meaningful everywhere it appears. */
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * The snowflake order, as SQL.
 *
 * Exported so nothing has to remember to write it: every ordered read of an id
 * column goes through this, and the index in `schema.sql` is built on the same
 * expression so the sort is free.
 */
const ID_ORDER = (sql: Sql, column: string, dir: 'ASC' | 'DESC') =>
  dir === 'ASC'
    ? sql`ORDER BY length(${sql(column)}) ASC, ${sql(column)} ASC`
    : sql`ORDER BY length(${sql(column)}) DESC, ${sql(column)} DESC`;

export interface PostgresStoreOptions {
  /** `postgres://user:pass@host:port/db`. */
  url: string;
  /** Bounded, because a Host is not the only thing on its database server. */
  max?: number;
}

export class PostgresStore implements Store {
  readonly sql: Sql;

  constructor(options: PostgresStoreOptions | Sql) {
    this.sql =
      typeof options === 'function'
        ? (options as Sql)
        : postgres(options.url, { max: options.max ?? 10, onnotice: () => {} });
  }

  /**
   * Apply any migration this database has not seen.
   *
   * Safe at every boot and safe from several processes at once — see
   * `migrate.ts` for the three details that make that true. Returns what it
   * did, so a caller can say so rather than migrating in silence.
   */
  async migrate(): Promise<MigrateResult> {
    return runMigrations(this.sql, await loadMigrations());
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  // ---------------------------------------------------------------------------
  // Rooms and membership
  // ---------------------------------------------------------------------------

  #room(row: Row): Room {
    return {
      id: row.id as string,
      kind: row.kind as Room['kind'],
      spaceId: (row.space_id as string | null) ?? null,
      groupId: (row.group_id as string | null) ?? null,
      streamPaging: row.stream_paging as boolean,
      notifyHints: row.notify_hints as boolean,
    };
  }

  async getRoom(id: string): Promise<Room | null> {
    const [row] = await this.sql`SELECT * FROM rooms WHERE id = ${id}`;
    return row ? this.#room(row) : null;
  }

  async createRoom(room: Room, members: string[]): Promise<{ room: Room; created: boolean }> {
    // `ON CONFLICT DO NOTHING` rather than a read followed by an insert: a 1:1
    // DM's id is derived from its two accounts, so two people opening each
    // other at the same instant genuinely collide here, and the loser must get
    // the winner's room rather than an error.
    return await this.sql.begin(async (sql) => {
      const inserted = await sql`
        INSERT INTO rooms (id, kind, space_id, group_id, stream_paging, notify_hints)
        VALUES (${room.id}, ${room.kind}, ${room.spaceId}, ${room.groupId},
                ${room.streamPaging}, ${room.notifyHints})
        ON CONFLICT (id) DO NOTHING
        RETURNING *`;

      if (!inserted[0]) {
        const [existing] = await sql`SELECT * FROM rooms WHERE id = ${room.id}`;
        return { room: this.#room(existing as Row), created: false };
      }

      for (const accountId of members) {
        await sql`
          INSERT INTO memberships (room_id, account_id, role_ids)
          VALUES (${room.id}, ${accountId}, ${sql.array([] as string[])})
          ON CONFLICT (room_id, account_id) DO NOTHING`;
      }
      return { room: this.#room(inserted[0]), created: true };
    });
  }

  async listAccountRooms(accountId: string): Promise<Room[]> {
    const rows = await this.sql`
      SELECT r.* FROM rooms r
      JOIN memberships m ON m.room_id = r.id
      WHERE m.account_id = ${accountId}`;
    return rows.map((r) => this.#room(r));
  }

  async listRoomMembers(roomId: string): Promise<Membership[]> {
    const rows = await this.sql`SELECT * FROM memberships WHERE room_id = ${roomId}`;
    return rows.map((r) => ({
      roomId: r.room_id as string,
      accountId: r.account_id as string,
      roleIds: (r.role_ids as string[]) ?? [],
    }));
  }

  async addMember(roomId: string, accountId: string, roleIds: string[] = []): Promise<void> {
    await this.sql`
      INSERT INTO memberships (room_id, account_id, role_ids)
      VALUES (${roomId}, ${accountId}, ${this.sql.array(roleIds)})
      ON CONFLICT (room_id, account_id) DO UPDATE SET role_ids = EXCLUDED.role_ids`;
  }

  async removeMember(roomId: string, accountId: string): Promise<void> {
    await this.sql`
      DELETE FROM memberships WHERE room_id = ${roomId} AND account_id = ${accountId}`;
  }

  async getMembership(roomId: string, accountId: string): Promise<Membership | null> {
    const [row] = await this.sql`
      SELECT * FROM memberships WHERE room_id = ${roomId} AND account_id = ${accountId}`;
    return row
      ? {
          roomId: row.room_id as string,
          accountId: row.account_id as string,
          roleIds: (row.role_ids as string[]) ?? [],
        }
      : null;
  }

  async getRoles(spaceId: string, roleIds: string[]): Promise<Role[]> {
    if (!roleIds.length) return [];
    const rows = await this.sql`
      SELECT * FROM roles WHERE space_id = ${spaceId} AND id = ANY(${this.sql.array(roleIds)})`;
    return rows.map((r) => ({
      id: r.id as string,
      spaceId: r.space_id as string,
      bits: r.bits as string,
      position: r.position as number,
    }));
  }

  async getOverrides(roomId: string): Promise<Override[]> {
    const rows = await this.sql`SELECT * FROM overrides WHERE room_id = ${roomId}`;
    return rows.map((r) => ({
      roomId: r.room_id as string,
      roleId: r.role_id as string,
      allow: r.allow as string,
      deny: r.deny as string,
    }));
  }

  async isOwner(spaceId: string, accountId: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM space_owners WHERE space_id = ${spaceId} AND account_id = ${accountId}`;
    return !!row;
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  #account(row: Row): Account {
    return {
      id: row.id as string,
      handle: row.handle as string,
      displayName: (row.display_name as string | null) ?? null,
      avatar: (row.avatar as string | null) ?? null,
      status: row.status as Account['status'],
      createdAt: num(row.created_at),
      movedTo: (row.moved_to as string | null) ?? null,
    };
  }

  async getAccount(id: string): Promise<Account | null> {
    const [row] = await this.sql`SELECT * FROM accounts WHERE id = ${id}`;
    return row ? this.#account(row) : null;
  }

  async getAccountByHandle(handle: string): Promise<Account | null> {
    // Byte comparison, not `ILIKE`. Folding happens once at the edge; a store
    // that folded too would be a second place to get it wrong, and `Viola` vs
    // `viola` resolving differently in two layers is an impersonation vector.
    const [row] = await this.sql`SELECT * FROM accounts WHERE handle = ${handle}`;
    return row ? this.#account(row) : null;
  }

  async claimHandle(account: Account): Promise<{ account: Account; claimed: boolean }> {
    return await this.sql.begin(async (sql) => {
      // Serialise on the handle, for the same reason `claimKeyPackage` does.
      //
      // The read below is unlocked, so two accounts claiming one handle at the
      // same instant both saw it free and both wrote — and the loser did not
      // get `claimed: false`, it got a `duplicate key` exception. `accounts.ts`
      // does not catch, so a routine collision became a 500 where the route is
      // written to return 409 `handle_taken`, and `types.ts` promises "the
      // existing binding when the handle is taken".
      //
      // Namespaced by a constant so this lock space and the key-package one
      // cannot be confused for each other by a reader.
      await sql`
        SELECT pg_advisory_xact_lock(hashtext('revel/handle'), hashtext(${account.handle}))`;

      const [holder] = await sql`SELECT * FROM accounts WHERE handle = ${account.handle}`;
      if (holder) return { account: this.#account(holder), claimed: false };

      const [previous] = await sql`SELECT * FROM accounts WHERE id = ${account.id}`;
      if (previous) {
        // Move the handle rather than adding a second one. Two handles on one
        // account would make `getAccountByHandle` and `getAccount` disagree
        // about what somebody is called.
        const [updated] = await sql`
          UPDATE accounts SET handle = ${account.handle} WHERE id = ${account.id} RETURNING *`;
        return { account: this.#account(updated as Row), claimed: true };
      }

      const [created] = await sql`
        INSERT INTO accounts (id, handle, display_name, avatar, status, created_at, moved_to)
        VALUES (${account.id}, ${account.handle}, ${account.displayName}, ${account.avatar},
                ${account.status}, ${account.createdAt}, ${account.movedTo})
        RETURNING *`;
      return { account: this.#account(created as Row), claimed: true };
    });
  }

  async updateAccount(
    id: string,
    patch: Partial<Pick<Account, 'displayName' | 'avatar'>>,
  ): Promise<Account | null> {
    const [row] = await this.sql`
      UPDATE accounts SET
        display_name = ${patch.displayName !== undefined ? patch.displayName : this.sql`display_name`},
        avatar = ${patch.avatar !== undefined ? patch.avatar : this.sql`avatar`}
      WHERE id = ${id}
      RETURNING *`;
    return row ? this.#account(row) : null;
  }

  async accountExists(accountId: string): Promise<boolean> {
    // An account exists exactly when a live device has been enrolled for it.
    // Registration is phase 1 (`docs/06`); this is enough for the one thing it
    // is for — refusing to open a DM with a string somebody typed wrong.
    const [row] = await this.sql`
      SELECT 1 FROM devices WHERE account_id = ${accountId} AND revoked_at IS NULL LIMIT 1`;
    return !!row;
  }

  // ---------------------------------------------------------------------------
  // Devices, challenges, sessions
  // ---------------------------------------------------------------------------

  #device(row: Row): Device {
    return {
      pub: row.pub as string,
      accountId: row.account_id as string,
      label: row.label as string,
      registeredAt: num(row.registered_at),
      revokedAt: numOrNull(row.revoked_at),
    };
  }

  async getDevice(pub: string): Promise<Device | null> {
    const [row] = await this.sql`SELECT * FROM devices WHERE pub = ${pub}`;
    return row ? this.#device(row) : null;
  }

  async registerDevice(device: Device): Promise<{ device: Device; created: boolean }> {
    // `DO NOTHING`, never `DO UPDATE`. Re-registering a revoked device must not
    // un-revoke it, or "sign out this device" lasts exactly as long as it takes
    // to press the button again on the device you were signing out.
    const [inserted] = await this.sql`
      INSERT INTO devices (pub, account_id, label, registered_at, revoked_at)
      VALUES (${device.pub}, ${device.accountId}, ${device.label},
              ${device.registeredAt}, ${device.revokedAt})
      ON CONFLICT (pub) DO NOTHING
      RETURNING *`;
    if (inserted) return { device: this.#device(inserted), created: true };

    const [existing] = await this.sql`SELECT * FROM devices WHERE pub = ${device.pub}`;
    return { device: this.#device(existing as Row), created: false };
  }

  async revokeDevice(pub: string, at: number): Promise<boolean> {
    return await this.sql.begin(async (sql) => {
      const [row] = await sql`
        UPDATE devices SET revoked_at = ${at}
        WHERE pub = ${pub} AND revoked_at IS NULL
        RETURNING pub`;
      if (!row) return false;
      // Sessions and the push channel go in the same transaction. A revoked
      // device's push endpoint is a live line to a phone somebody has just
      // signed out — keeping it would mean the one action whose entire purpose
      // is "stop talking to that device" leaves the loudest channel open.
      await sql`DELETE FROM sessions WHERE device_pub = ${pub}`;
      await sql`DELETE FROM push_subscriptions WHERE device_pub = ${pub}`;
      return true;
    });
  }

  async putChallenge(nonceHash: string, challenge: Challenge): Promise<void> {
    await this.sql`
      INSERT INTO challenges (nonce_hash, device_pub, expires_at)
      VALUES (${nonceHash}, ${challenge.devicePub}, ${challenge.expiresAt})
      ON CONFLICT (nonce_hash) DO UPDATE
        SET device_pub = EXCLUDED.device_pub, expires_at = EXCLUDED.expires_at`;
  }

  async takeChallenge(nonceHash: string): Promise<Challenge | null> {
    // Single-use, in one statement. Two round trips is how the same nonce gets
    // spent twice, and a nonce spent twice is a signature that can be replayed.
    const [row] = await this.sql`
      DELETE FROM challenges WHERE nonce_hash = ${nonceHash} RETURNING *`;
    if (!row) return null;
    const challenge = { devicePub: row.device_pub as string, expiresAt: num(row.expires_at) };
    return challenge.expiresAt < Date.now() ? null : challenge;
  }

  async putSession(tokenHash: string, session: Session): Promise<void> {
    await this.sql`
      INSERT INTO sessions (token_hash, device_pub, account_id, expires_at)
      VALUES (${tokenHash}, ${session.devicePub}, ${session.accountId}, ${session.expiresAt})
      ON CONFLICT (token_hash) DO UPDATE
        SET device_pub = EXCLUDED.device_pub,
            account_id = EXCLUDED.account_id,
            expires_at = EXCLUDED.expires_at`;
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    const [row] = await this.sql`SELECT * FROM sessions WHERE token_hash = ${tokenHash}`;
    if (!row) return null;
    const session = {
      devicePub: row.device_pub as string,
      accountId: row.account_id as string,
      expiresAt: num(row.expires_at),
    };
    if (session.expiresAt < Date.now()) {
      await this.sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
      return null;
    }
    return session;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
  }

  async deleteDeviceSessions(devicePub: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE device_pub = ${devicePub}`;
  }

  async sweepExpired(now: number): Promise<{ challenges: number; sessions: number }> {
    const challenges = await this.sql`DELETE FROM challenges WHERE expires_at < ${now}`;
    const sessions = await this.sql`DELETE FROM sessions WHERE expires_at < ${now}`;
    return { challenges: challenges.count, sessions: sessions.count };
  }

  async listAccountDevices(
    accountId: string,
    opts: { includeRevoked?: boolean } = {},
  ): Promise<Device[]> {
    const rows = opts.includeRevoked
      ? await this.sql`SELECT * FROM devices WHERE account_id = ${accountId}`
      : await this
          .sql`SELECT * FROM devices WHERE account_id = ${accountId} AND revoked_at IS NULL`;
    return rows.map((r) => this.#device(r));
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  #event(row: Row): Event {
    const event: Event = {
      id: row.id as string,
      room: row.room_id as string,
      sender: row.sender as string,
      epoch: row.epoch as number,
      class: row.class as Event['class'],
      payload: row.payload as string,
      size: row.size as number,
      clientNonce: (row.client_nonce as string | null) ?? '',
      createdAt: num(row.created_at),
      purgedAt: numOrNull(row.purged_at),
    };
    // Optional on the wire, so absent rather than null — a `stream: null` on an
    // event from a room without stream paging would fail its own schema.
    if (row.stream != null) event.stream = row.stream as string;
    if (row.notify != null) event.notify = row.notify as string[];
    return event;
  }

  async appendEvent(e: Event): Promise<{ event: Event; deduped: boolean }> {
    // Idempotency is scoped per device by the partial unique index: two devices
    // may legitimately pick the same nonce and neither may shadow the other.
    const [inserted] = await this.sql`
      INSERT INTO events (id, room_id, sender, epoch, class, payload, size,
                          client_nonce, created_at, purged_at, stream, notify)
      VALUES (${e.id}, ${e.room}, ${e.sender}, ${e.epoch}, ${e.class}, ${e.payload}, ${e.size},
              ${e.clientNonce}, ${e.createdAt}, ${e.purgedAt ?? null}, ${e.stream ?? null},
              ${e.notify ? this.sql.array(e.notify) : null})
      ON CONFLICT (sender, client_nonce) WHERE client_nonce IS NOT NULL DO NOTHING
      RETURNING *`;
    if (inserted) return { event: this.#event(inserted), deduped: false };

    const [existing] = await this.sql`
      SELECT * FROM events WHERE sender = ${e.sender} AND client_nonce = ${e.clientNonce}`;
    return { event: this.#event(existing as Row), deduped: true };
  }

  async listEvents(
    roomId: string,
    opts: { before?: string; limit?: number } = {},
  ): Promise<Event[]> {
    const limit = opts.limit ?? 50;
    // Newest `limit` first — which is what the index is for — then reversed, so
    // the caller gets ascending order like `MemoryStore`'s `slice(-limit)`.
    const rows = opts.before
      ? await this.sql`
          SELECT * FROM events
          WHERE room_id = ${roomId}
            AND (length(id), id) < (length(${opts.before}::text), ${opts.before}::text)
          ${ID_ORDER(this.sql, 'id', 'DESC')}
          LIMIT ${limit}`
      : await this.sql`
          SELECT * FROM events WHERE room_id = ${roomId}
          ${ID_ORDER(this.sql, 'id', 'DESC')}
          LIMIT ${limit}`;
    return rows.reverse().map((r) => this.#event(r));
  }

  async purgeEvent(roomId: string, eventId: string): Promise<boolean> {
    // The bytes go, the row stays. A client that has this cached learns to drop
    // its copy rather than silently diverging from everyone else, and it can
    // only learn that from a tombstone.
    // `purged_at IS NULL`, like `purgeBlob`. Without it a retried request or a
    // double-clicked moderation action returns true twice, broadcasts twice,
    // and rewrites the tombstone's timestamp — losing when the purge actually
    // happened, which is the one fact the tombstone exists to carry.
    const [row] = await this.sql`
      UPDATE events SET payload = '', size = 0, purged_at = ${Date.now()}
      WHERE room_id = ${roomId} AND id = ${eventId} AND purged_at IS NULL
      RETURNING id`;
    return !!row;
  }

  // ---------------------------------------------------------------------------
  // Blobs
  // ---------------------------------------------------------------------------

  #blob(row: Row): Blob {
    return {
      id: row.id as string,
      roomId: row.room_id as string,
      uploader: row.uploader as string,
      size: row.size as number,
      hash: row.hash as string,
      createdAt: num(row.created_at),
      purgedAt: numOrNull(row.purged_at),
    };
  }

  async putBlob(blob: Blob, bytes: Uint8Array): Promise<Blob> {
    // **Returns what is stored, not what was offered.** First write wins, and
    // on a collision the caller gets the row that is actually there.
    //
    // This used to `return blob` unconditionally after an `ON CONFLICT DO
    // NOTHING`, which meant a colliding upload got a 201 and a blob id whose
    // bytes belonged to somebody else — and re-uploading over a *purged* id
    // reported `purgedAt: null` for a row that was still purged with its bytes
    // gone. Claiming to have stored ciphertext that was discarded is the one
    // answer an upload must never give.
    const [inserted] = await this.sql`
      INSERT INTO blobs (id, room_id, uploader, size, hash, created_at, purged_at, bytes)
      VALUES (${blob.id}, ${blob.roomId}, ${blob.uploader}, ${blob.size}, ${blob.hash},
              ${blob.createdAt}, ${blob.purgedAt}, ${bytes})
      ON CONFLICT (id) DO NOTHING
      RETURNING id, room_id, uploader, size, hash, created_at, purged_at`;
    if (inserted) return this.#blob(inserted);

    const [existing] = await this.sql`
      SELECT id, room_id, uploader, size, hash, created_at, purged_at FROM blobs
      WHERE id = ${blob.id}`;
    return this.#blob(existing as Row);
  }

  async getBlob(id: string): Promise<Blob | null> {
    const [row] = await this.sql`
      SELECT id, room_id, uploader, size, hash, created_at, purged_at FROM blobs WHERE id = ${id}`;
    return row ? this.#blob(row) : null;
  }

  async readBlob(id: string): Promise<Uint8Array | null> {
    const [row] = await this.sql`SELECT bytes FROM blobs WHERE id = ${id}`;
    const bytes = row?.bytes as Uint8Array | null | undefined;
    return bytes ? new Uint8Array(bytes) : null;
  }

  async purgeBlob(id: string, at: number): Promise<boolean> {
    const [row] = await this.sql`
      UPDATE blobs SET bytes = NULL, size = 0, purged_at = ${at}
      WHERE id = ${id} AND purged_at IS NULL
      RETURNING id`;
    return !!row;
  }

  // ---------------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------------

  async putPushSubscription(subscription: StoredPushSubscription): Promise<void> {
    // One per device, replacing. A device has one push channel, and keeping
    // stale ones means waking a browser profile somebody deleted.
    await this.sql`
      INSERT INTO push_subscriptions (device_pub, kind, endpoint, p256dh, auth, created_at)
      VALUES (${subscription.devicePub}, ${subscription.kind}, ${subscription.endpoint},
              ${subscription.keys?.p256dh ?? null}, ${subscription.keys?.auth ?? null},
              ${subscription.createdAt})
      ON CONFLICT (device_pub) DO UPDATE
        SET kind = EXCLUDED.kind, endpoint = EXCLUDED.endpoint,
            p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
            created_at = EXCLUDED.created_at`;
  }

  async getPushSubscription(devicePub: string): Promise<StoredPushSubscription | null> {
    const [row] = await this.sql`
      SELECT * FROM push_subscriptions WHERE device_pub = ${devicePub}`;
    if (!row) return null;
    const subscription: StoredPushSubscription = {
      devicePub: row.device_pub as string,
      kind: row.kind as StoredPushSubscription['kind'],
      endpoint: row.endpoint as string,
      createdAt: num(row.created_at),
    };
    if (row.p256dh != null && row.auth != null) {
      subscription.keys = { p256dh: row.p256dh as string, auth: row.auth as string };
    }
    return subscription;
  }

  async deletePushSubscription(devicePub: string): Promise<void> {
    await this.sql`DELETE FROM push_subscriptions WHERE device_pub = ${devicePub}`;
  }

  // ---------------------------------------------------------------------------
  // Key packages
  // ---------------------------------------------------------------------------

  async publishKeyPackages(devicePub: string, upload: KeyPackageUpload): Promise<KeyPackageSupply> {
    await this.sql.begin(async (sql) => {
      // Replace rather than append. A device that has just restored from backup
      // holds different private halves than whatever is on the shelf, and
      // adding to a stale shelf means handing out packages nobody can open.
      await sql`DELETE FROM key_packages WHERE device_pub = ${devicePub}`;
      if (upload.packages.length) {
        // One statement. `docs/03` §5 has devices keeping 20+ packages on the
        // shelf, and a routine top-up was 20 serialised round trips inside a
        // transaction.
        const rows = upload.packages.map((keyPackage) => ({
          device_pub: devicePub,
          key_package: keyPackage,
        }));
        await sql`INSERT INTO key_packages ${sql(rows, 'device_pub', 'key_package')}`;
      }
      if (upload.lastResort) {
        await sql`
          INSERT INTO last_resort_packages (device_pub, key_package)
          VALUES (${devicePub}, ${upload.lastResort})
          ON CONFLICT (device_pub) DO UPDATE SET key_package = EXCLUDED.key_package`;
      }
    });
    return this.keyPackageSupply(devicePub);
  }

  async keyPackageSupply(devicePub: string): Promise<KeyPackageSupply> {
    // Both halves in one statement: this runs on every claim and at the end of
    // every top-up, and two sequential awaits for one answer is a round trip
    // spent on nothing.
    const [row] = await this.sql`
      SELECT
        (SELECT count(*)::int FROM key_packages WHERE device_pub = ${devicePub}) AS n,
        EXISTS(SELECT 1 FROM last_resort_packages WHERE device_pub = ${devicePub}) AS lr`;
    return { available: (row?.n as number) ?? 0, lastResort: !!row?.lr };
  }

  async claimKeyPackage(devicePub: string, groupId: string): Promise<ClaimedPackage | null> {
    return await this.sql.begin(async (sql) => {
      // Serialise this (group, device) slot for the length of the transaction.
      //
      // **Without this the reuse check below is a race that drains a shelf.**
      // The `SELECT` is an unlocked read, so two overlapping claims for the
      // same slot both see "no outstanding claim", both fall through to the
      // `DELETE`, and each takes a *different* one-time package — while only
      // one of them ends up recorded in `key_package_claims`. The caller handed
      // the unrecorded one holds a package nothing matches, and the shelf is
      // down two instead of one. That is exactly the retry-loop drain the
      // authorised-claim fix exists to stop (`docs/03` §5), reintroduced by the
      // gap between the read and the write.
      //
      // A transaction-scoped advisory lock rather than a row lock, because the
      // row whose absence is the problem cannot be locked. It is released on
      // commit or abort with no bookkeeping, and a hash collision between two
      // unrelated slots costs a little blocking and never correctness.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${groupId}), hashtext(${devicePub}))`;

      // An outstanding claim is reused rather than burning a second package: a
      // commit refused for an epoch conflict gets retried, and a retry loop
      // that ate a package per attempt would be a way to drain somebody's shelf
      // (`docs/03` §5, the authorised-claim fix).
      const [outstanding] = await sql`
        SELECT key_package, last_resort FROM key_package_claims
        WHERE group_id = ${groupId} AND device_pub = ${devicePub}`;
      if (outstanding) {
        return {
          keyPackage: outstanding.key_package as string,
          lastResort: outstanding.last_resort as boolean,
        };
      }

      // One statement, oldest first. Selecting and then deleting is a race in
      // which two concurrent adds hand out the same one-time package — and a
      // one-time package used twice is the forward secrecy it exists to
      // provide, gone. `FOR UPDATE SKIP LOCKED` so two concurrent claims take
      // two different packages instead of one blocking on the other.
      const [taken] = await sql`
        DELETE FROM key_packages
        WHERE (device_pub, seq) IN (
          SELECT device_pub, seq FROM key_packages
          WHERE device_pub = ${devicePub}
          ORDER BY seq ASC LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING key_package`;

      let claim: ClaimedPackage | null = null;
      if (taken) {
        claim = { keyPackage: taken.key_package as string, lastResort: false };
      } else {
        const [fallback] = await sql`
          SELECT key_package FROM last_resort_packages WHERE device_pub = ${devicePub}`;
        // The last-resort package is *not* deleted: it is the one that may be
        // reused, which is the whole point of having one.
        if (fallback) claim = { keyPackage: fallback.key_package as string, lastResort: true };
      }
      if (!claim) return null;

      await sql`
        INSERT INTO key_package_claims (group_id, device_pub, key_package, last_resort)
        VALUES (${groupId}, ${devicePub}, ${claim.keyPackage}, ${claim.lastResort})
        ON CONFLICT (group_id, device_pub) DO NOTHING`;
      return claim;
    });
  }

  async hasClaim(groupId: string, devicePub: string): Promise<boolean> {
    const [row] = await this.sql`
      SELECT 1 FROM key_package_claims
      WHERE group_id = ${groupId} AND device_pub = ${devicePub}`;
    return !!row;
  }

  // ---------------------------------------------------------------------------
  // Groups and the handshake log
  // ---------------------------------------------------------------------------

  #group(row: Row): Group {
    return {
      id: row.id as string,
      epoch: row.epoch as number,
      pendingProposals: row.pending_proposals as number,
    };
  }

  #member(row: Row): GroupMember {
    return {
      groupId: row.group_id as string,
      devicePub: row.device_pub as string,
      accountId: row.account_id as string,
      addedEpoch: row.added_epoch as number,
      lastActiveAt: num(row.last_active_at),
    };
  }

  async getGroup(id: string): Promise<Group | null> {
    const [row] = await this.sql`SELECT * FROM groups WHERE id = ${id}`;
    return row ? this.#group(row) : null;
  }

  async createGroup(id: string, roomId: string, creator: GroupMemberInput): Promise<Group> {
    return await this.sql.begin(async (sql) => {
      const [row] = await sql`
        INSERT INTO groups (id, epoch, pending_proposals) VALUES (${id}, 0, 0)
        ON CONFLICT (id) DO NOTHING
        RETURNING *`;
      // Binding the room in the same transaction: a group with no room is
      // unreachable, and a room pointing at a group that does not exist is a
      // room nobody can post to.
      await sql`UPDATE rooms SET group_id = ${id} WHERE id = ${roomId}`;
      await sql`
        INSERT INTO group_members (group_id, device_pub, account_id, added_epoch, last_active_at)
        VALUES (${id}, ${creator.devicePub}, ${creator.accountId}, 0, ${Date.now()})
        ON CONFLICT (group_id, device_pub) DO NOTHING`;
      if (row) return this.#group(row);
      const [existing] = await sql`SELECT * FROM groups WHERE id = ${id}`;
      return this.#group(existing as Row);
    });
  }

  async getGroupRooms(groupId: string): Promise<Room[]> {
    const rows = await this.sql`SELECT * FROM rooms WHERE group_id = ${groupId}`;
    return rows.map((r) => this.#room(r));
  }

  async listGroupMembers(groupId: string): Promise<GroupMember[]> {
    const rows = await this.sql`SELECT * FROM group_members WHERE group_id = ${groupId}`;
    return rows.map((r) => this.#member(r));
  }

  async getGroupMember(groupId: string, devicePub: string): Promise<GroupMember | null> {
    const [row] = await this.sql`
      SELECT * FROM group_members WHERE group_id = ${groupId} AND device_pub = ${devicePub}`;
    return row ? this.#member(row) : null;
  }

  async touchGroupMember(groupId: string, devicePub: string, at: number): Promise<void> {
    await this.sql`
      UPDATE group_members SET last_active_at = ${at}
      WHERE group_id = ${groupId} AND device_pub = ${devicePub}`;
  }

  async leaveGroup(groupId: string, devicePub: string): Promise<void> {
    await this.sql.begin(async (sql) => {
      await sql`
        DELETE FROM group_members WHERE group_id = ${groupId} AND device_pub = ${devicePub}`;
      await sql`
        DELETE FROM key_package_claims
        WHERE group_id = ${groupId} AND device_pub = ${devicePub}`;
      await sql`
        DELETE FROM group_welcomes WHERE group_id = ${groupId} AND device_pub = ${devicePub}`;
    });
  }

  async appendHandshake(input: HandshakeAppend): Promise<HandshakeResult> {
    return await this.sql.begin(async (sql) => {
      // `FOR UPDATE`. This is the line that makes two processes safe, and the
      // reason the epoch check lives in the store rather than the route: two
      // devices really do read epoch 4 at the same moment, and without the lock
      // both are told to go ahead. That forks the group irreparably — everyone
      // after the fork fails to decrypt, sender included.
      const [locked] = await sql`SELECT * FROM groups WHERE id = ${input.groupId} FOR UPDATE`;
      if (!locked) return { accepted: false, reason: 'epoch_conflict', epoch: 0 } as const;

      const group = this.#group(locked);
      if (input.epoch !== group.epoch) {
        return { accepted: false, reason: 'epoch_conflict', epoch: group.epoch } as const;
      }

      if (input.welcome) {
        const claimed = await sql`
          SELECT device_pub FROM key_package_claims
          WHERE group_id = ${group.id}
            AND device_pub = ANY(${sql.array(input.welcome.devices)})`;
        const has = new Set(claimed.map((r) => r.device_pub as string));
        const unclaimed = input.welcome.devices.filter((d) => !has.has(d));
        if (unclaimed.length) {
          return {
            accepted: false,
            reason: 'unclaimed_welcome',
            epoch: group.epoch,
            devices: unclaimed,
          } as const;
        }
      }

      // `seq` is dense per group and assigned here rather than by a sequence,
      // because clients page the log by it and a gap would look like a dropped
      // record — which is precisely the attack `docs/29` §4 has them check for.
      const [counted] = await sql`
        SELECT count(*)::int AS n FROM handshake_log WHERE group_id = ${group.id}`;
      const seq = (counted?.n as number) ?? 0;

      const record: HandshakeRecord = {
        group: group.id,
        seq,
        kind: input.kind,
        epoch: input.epoch,
        sender: input.sender,
        bytes: input.bytes,
        createdAt: input.at,
      };
      await sql`
        INSERT INTO handshake_log (group_id, seq, kind, epoch, sender, bytes, created_at)
        VALUES (${group.id}, ${seq}, ${input.kind}, ${input.epoch}, ${input.sender},
                ${input.bytes}, ${input.at})`;

      if (input.kind === 'proposal') {
        await sql`
          UPDATE groups SET pending_proposals = pending_proposals + 1 WHERE id = ${group.id}`;
        return { accepted: true, record, epoch: group.epoch } as const;
      }

      // A commit sweeps up every proposal that was waiting, whether or not it
      // included them — the ones it missed are stale at the new epoch anyway.
      const epoch = group.epoch + 1;
      await sql`
        UPDATE groups SET epoch = ${epoch}, pending_proposals = 0 WHERE id = ${group.id}`;

      // Before the Welcome rows, so the tree is never the missing half of an
      // invitation somebody can already see. Never backwards: a retried record
      // must not hand joiners a tree older than the epoch their Welcome is for.
      if (input.tree) {
        await sql`
          INSERT INTO group_trees (group_id, epoch, tree)
          VALUES (${group.id}, ${epoch}, ${input.tree})
          ON CONFLICT (group_id) DO UPDATE
            SET epoch = EXCLUDED.epoch, tree = EXCLUDED.tree
            WHERE group_trees.epoch <= EXCLUDED.epoch`;
      }

      // **Everything below is batched, because the group row is locked.** That
      // lock is the single serialisation point for a group's whole handshake
      // log, so a round trip taken while holding it is a round trip every other
      // commit for that group waits on. A loop here made adding one person with
      // five devices fifteen serialised round trips; `docs/31` §2's 2,000-member
      // scenario made it thousands.
      const added = input.added ?? [];
      if (added.length) {
        const rows = added.map((member) => ({
          group_id: group.id,
          device_pub: member.devicePub,
          account_id: member.accountId,
          added_epoch: epoch,
          last_active_at: input.at,
        }));
        await sql`
          INSERT INTO group_members ${sql(rows, 'group_id', 'device_pub', 'account_id', 'added_epoch', 'last_active_at')}
          ON CONFLICT (group_id, device_pub) DO UPDATE
            SET added_epoch = EXCLUDED.added_epoch, last_active_at = EXCLUDED.last_active_at`;
      }

      const removed = input.removed ?? [];
      if (removed.length) {
        await sql`
          DELETE FROM group_members
          WHERE group_id = ${group.id} AND device_pub = ANY(${sql.array(removed)})`;
        // This group's queued Welcome goes with them. One still sitting there
        // would let a removed device walk back in — and only this group's, since
        // the device may be legitimately joining others.
        await sql`
          DELETE FROM group_welcomes
          WHERE group_id = ${group.id} AND device_pub = ANY(${sql.array(removed)})`;
      }

      if (input.welcome?.devices.length) {
        const bytes = input.welcome.bytes;
        const rows = input.welcome.devices.map((device_pub) => ({
          device_pub,
          group_id: group.id,
          bytes,
          created_at: input.at,
        }));
        await sql`
          INSERT INTO group_welcomes ${sql(rows, 'device_pub', 'group_id', 'bytes', 'created_at')}
          ON CONFLICT (device_pub, group_id) DO UPDATE
            SET bytes = EXCLUDED.bytes, created_at = EXCLUDED.created_at`;
        await sql`
          DELETE FROM key_package_claims
          WHERE group_id = ${group.id} AND device_pub = ANY(${sql.array(input.welcome.devices)})`;
      }

      return { accepted: true, record, epoch } as const;
    });
  }

  async listHandshake(
    groupId: string,
    opts: { since?: number; limit?: number } = {},
  ): Promise<HandshakeRecord[]> {
    const rows = await this.sql`
      SELECT * FROM handshake_log
      WHERE group_id = ${groupId} AND seq > ${opts.since ?? -1}
      ORDER BY seq ASC
      LIMIT ${opts.limit ?? 200}`;
    return rows.map((r) => ({
      group: r.group_id as string,
      seq: r.seq as number,
      kind: r.kind as HandshakeRecord['kind'],
      epoch: r.epoch as number,
      sender: r.sender as string,
      bytes: r.bytes as string,
      createdAt: num(r.created_at),
    }));
  }

  async listWelcomes(devicePub: string, groupId?: string): Promise<StoredWelcome[]> {
    const rows = groupId
      ? await this.sql`
          SELECT * FROM group_welcomes
          WHERE device_pub = ${devicePub} AND group_id = ${groupId}
          ORDER BY created_at ASC`
      : await this.sql`
          SELECT * FROM group_welcomes WHERE device_pub = ${devicePub} ORDER BY created_at ASC`;
    return rows.map((r) => ({
      groupId: r.group_id as string,
      bytes: r.bytes as string,
      createdAt: num(r.created_at),
    }));
  }

  async ackWelcome(devicePub: string, groupId: string): Promise<void> {
    await this.sql`
      DELETE FROM group_welcomes WHERE device_pub = ${devicePub} AND group_id = ${groupId}`;
  }

  async putTree(groupId: string, epoch: number, tree: string): Promise<void> {
    await this.sql`
      INSERT INTO group_trees (group_id, epoch, tree)
      VALUES (${groupId}, ${epoch}, ${tree})
      ON CONFLICT (group_id) DO UPDATE
        SET epoch = EXCLUDED.epoch, tree = EXCLUDED.tree
        WHERE group_trees.epoch <= EXCLUDED.epoch`;
  }

  async getTree(groupId: string): Promise<{ epoch: number; tree: string } | null> {
    const [row] = await this.sql`SELECT epoch, tree FROM group_trees WHERE group_id = ${groupId}`;
    return row ? { epoch: row.epoch as number, tree: row.tree as string } : null;
  }
}
