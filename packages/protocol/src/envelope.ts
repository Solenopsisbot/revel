/**
 * The server-visible event envelope.
 *
 * This is the whole contract between client and server for messaging. The
 * server assigns `id`, checks policy, stores `payload` as opaque bytes and
 * fans it out. It never parses the payload — that is the property the entire
 * design rests on (`docs/02` principle 3, `docs/04` §2).
 *
 * Every field here had to justify being outside the ciphertext. The list is
 * short on purpose; `docs/03` §7 records why each one is unavoidable.
 */
import { z } from 'zod';
import { fromBase64, toBase64 } from './base64.js';
import { AccountId, DevicePub, Snowflake } from './ids.js';

/**
 * Delivery class. Exists so a typing indicator can't wake a phone and a read
 * receipt can't cost a push notification.
 */
export const EventClass = z.enum([
  /** Not stored. Typing, live presence. Dropped if nobody is listening. */
  'ephemeral',
  /** Stored, never notifies. Receipts, reactions. */
  'silent',
  /** Stored, may notify. Messages. */
  'normal',
]);
export type EventClass = z.infer<typeof EventClass>;

/** What a client sends. The server assigns the rest. */
export const EventInput = z.object({
  /** Which era key opens `payload`. The server checks it is a live epoch. */
  epoch: z.number().int().min(0),
  class: EventClass,
  /** Ciphertext. Opaque to the server, capped so one event can't be a file. */
  payload: z.string().base64().max(65536),
  /**
   * Thread id, only when the room enables stream paging. A documented,
   * opt-in metadata leak — it lets the server page a thread without seeing it
   * (`docs/03` §7).
   */
  stream: Snowflake.optional(),
  /**
   * Accounts to wake. Only when the room enables notify hints; trades "who was
   * mentioned" for battery on busy rooms. Off by default.
   *
   * Account ids, not snowflakes — `docs/04` §1 makes an account id its public
   * key. This was typed as a snowflake and would have rejected every real one;
   * nothing had populated it yet, which is the only reason it was cheap to fix.
   */
  notify: z.array(AccountId).max(256).optional(),
  /**
   * The franking commitment — `HMAC-SHA256(key, plaintext)`, base64.
   *
   * Server-visible and opaque to it: 32 bytes that commit to a plaintext it
   * has never seen and cannot derive. What it buys is that a *reporter* cannot
   * invent a message, because the value a moderator checks against came from
   * the Host rather than from them (`docs/03` §9, `franking.ts`).
   *
   * Optional because most event classes have nothing to report — a receipt, a
   * typing notice, a roster announcement. Absent means "not reportable", which
   * is honest rather than a gap: a message sent before this existed genuinely
   * cannot be proven, and pretending otherwise would be the one lie that
   * matters on a moderation screen.
   */
  commitment: z.string().base64().max(64).optional(),
  /** Idempotency key so a retry after a dropped response can't duplicate. */
  clientNonce: z.string().min(8).max(64),
});
export type EventInput = z.infer<typeof EventInput>;

/** What the server stores and broadcasts. */
export const Event = EventInput.extend({
  id: Snowflake,
  room: Snowflake,
  /** The device that sent it — not the account. Attribution to a person, and
   *  to which of their faces, is inside the ciphertext. */
  sender: DevicePub,
  size: z.number().int().nonnegative(),
  createdAt: z.number().int(),
  /** Set when the bytes have been purged; the tombstone survives so clients
   *  can drop their local copy rather than silently diverge. */
  purgedAt: z.number().int().nullable().default(null),
});
export type Event = z.infer<typeof Event>;

/** Bytes the server will never look inside. */
export function payloadBytes(e: Pick<Event, 'payload'>): Uint8Array {
  return fromBase64(e.payload);
}

export function encodePayload(bytes: Uint8Array): string {
  return toBase64(bytes);
}
