/**
 * Snowflake IDs — time-sortable, coordination-free.
 *
 * Events need a total order per room and the server assigns it (`docs/04` §6).
 * Sorting by id therefore has to mean sorting by time, which a random id can't
 * do and a database sequence can't do across shards.
 *
 * Layout, 64 bits packed into a bigint:
 *   42 bits  milliseconds since REVEL_EPOCH  (~139 years)
 *   12 bits  shard      (room or process)
 *   10 bits  sequence   (1024 ids per ms per shard)
 */

import { z } from 'zod';

/** 2026-01-01T00:00:00Z. Later than Unix epoch so the timestamp field is smaller. */
export const REVEL_EPOCH = 1767225600000;

const SHARD_BITS = 12n;
const SEQ_BITS = 10n;
const MAX_SHARD = (1 << 12) - 1;
const MAX_SEQ = (1 << 10) - 1;

export class SnowflakeFactory {
  #shard: bigint;
  #lastMs = -1;
  #seq = 0;

  constructor(shard = 0) {
    if (!Number.isInteger(shard) || shard < 0 || shard > MAX_SHARD) {
      throw new RangeError(`shard must be an integer in 0..${MAX_SHARD}, got ${shard}`);
    }
    this.#shard = BigInt(shard);
  }

  next(now = Date.now()): string {
    if (now === this.#lastMs) {
      this.#seq += 1;
      if (this.#seq > MAX_SEQ) {
        // Exhausted this millisecond. Spin rather than emit a duplicate — an
        // out-of-order or repeated event id would corrupt the room's ordering.
        while (Date.now() <= now) {
          /* wait for the clock */
        }
        return this.next();
      }
    } else if (now > this.#lastMs) {
      this.#lastMs = now;
      this.#seq = 0;
    } else {
      // The clock went backwards (NTP correction). Keep issuing against the
      // last millisecond we used so ids never travel back in time.
      this.#seq += 1;
      if (this.#seq > MAX_SEQ) {
        this.#lastMs += 1;
        this.#seq = 0;
      }
      return pack(this.#lastMs, this.#shard, this.#seq);
    }
    return pack(this.#lastMs, this.#shard, this.#seq);
  }
}

function pack(ms: number, shard: bigint, seq: number): string {
  const t = BigInt(ms - REVEL_EPOCH);
  if (t < 0n) throw new RangeError('timestamp precedes the Revel epoch');
  return ((t << (SHARD_BITS + SEQ_BITS)) | (shard << SEQ_BITS) | BigInt(seq)).toString();
}

/** Milliseconds since the Unix epoch that this id was minted. */
export function timestampOf(id: string): number {
  return Number(BigInt(id) >> (SHARD_BITS + SEQ_BITS)) + REVEL_EPOCH;
}

export function shardOf(id: string): number {
  return Number((BigInt(id) >> SEQ_BITS) & BigInt(MAX_SHARD));
}

/** Ids are decimal strings of unbounded length, so compare numerically. */
export function compareIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isSnowflake(v: string): boolean {
  return /^\d{1,20}$/.test(v) && BigInt(v) < 1n << 64n;
}

// ---------------------------------------------------------------------------
// The other two kinds of identifier
// ---------------------------------------------------------------------------

/**
 * An account id: base64url of the account's public key, unpadded.
 *
 * **Not a snowflake.** `docs/04` §1 makes `accounts.id` the account pubkey and
 * the client produces it with `toAccountId` in `packages/core` — 43 characters
 * for a 32-byte key. Anywhere that types an account id as a snowflake rejects
 * every real one.
 *
 * Character set and length only. It deliberately does not check that the
 * base64url decodes to a valid key: that is the crypto's job, it would have to
 * change for `docs/03` §12's post-quantum keys, and a schema that half-checks
 * a signature is a schema people trust further than it deserves.
 */
export const AccountId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'not an account id');

/**
 * A role id. Opaque, assigned by the space that owns the role.
 *
 * Not a snowflake — `role-everyone` is a real one — and a named type rather
 * than a reused `AccountId`, which it happens to be shape-compatible with. That
 * compatibility is exactly the trap: `mentions` was typed as the generic
 * snowflake `Id` because a face id fits it too, and the result was a mention
 * list that could hold the wrong kind of id and fail silently (`31` §28).
 */
export const RoleId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'not a role id');

/**
 * A device public key, as it appears on an event's `sender`.
 *
 * Same encoding as an account id, and a separate type on purpose: they are
 * different keys, and confusing them is how you get a permission check that
 * passes for the wrong subject.
 */
export const DevicePub = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'not a device key');

/** A snowflake, for schemas. `isSnowflake` is the runtime check. */
export const Snowflake = z.string().regex(/^\d{1,20}$/, 'not a snowflake');

/**
 * The room id for a 1:1 DM between two accounts.
 *
 * `docs/03` §4: "The 1:1 DM id is deterministic from the sorted account pair so
 * opening is idempotent (Kith's trick)." Sorted, so both ends compute the same
 * one; derived, so a client can name the room before it exists — which is what
 * makes a DM deep link work and what stops two people who open each other at
 * the same moment creating two rooms.
 *
 * Sixty-three bits of SHA-256, formatted as a snowflake. It carries no
 * timestamp, and does not need to: `docs/04` §6 requires time-sortable ids for
 * *events*, because a room's total order depends on it. A room id only has to
 * be unique.
 *
 * **Collisions are the server's problem, not this function's.** Sixty-three
 * bits is far past the point of accident, but a deliberate collision would be a
 * way to squat somebody's DM. The server therefore checks that a room at this
 * id has the members it should, and refuses rather than merging — which turns
 * the worst case from a confidentiality bug into a visible error.
 *
 * Async because the hash is: `crypto.subtle` is the one implementation present
 * in every browser and in Node without a dependency, and computing a DM id is
 * nowhere near a hot path.
 */
export async function dmRoomId(a: string, b: string): Promise<string> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  // Domain-separated, so this hash can never be confused with another use of
  // the same two account ids, and length-prefixed rather than delimited so no
  // pair of accounts can be spelled two ways.
  const input = new TextEncoder().encode(`revel/dm/v1\n${lo.length}:${lo}\n${hi.length}:${hi}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));

  let value = 0n;
  for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(digest[i] as number);
  // Top bit cleared: a snowflake is a signed 64-bit value everywhere it is
  // stored, and a database that reads this back as negative is a bad afternoon.
  return String(value & 0x7fff_ffff_ffff_ffffn);
}
