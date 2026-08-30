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
 * A device public key, as it appears on an event's `sender`.
 *
 * Same encoding as an account id, and a separate type on purpose: they are
 * different keys, and confusing them is how you get a permission check that
 * passes for the wrong subject.
 */
export const DevicePub = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'not a device key');

/** A snowflake, for schemas. `isSnowflake` is the runtime check. */
export const Snowflake = z.string().regex(/^\d{1,20}$/, 'not a snowflake');
