/**
 * Rooms, as the server describes them.
 *
 * The other half of `envelope.ts`: that one says what an event in a room looks
 * like, this one says how a room comes to exist and how a client finds out
 * which ones it is in. Until this existed, `apps/server` could carry a
 * conversation perfectly well and there was no way to start one.
 *
 * Nothing here is encrypted, and that is the point of the short list. A room's
 * *name*, topic and member faces live inside the ciphertext as `room.name` and
 * `room.faces` events (`docs/04` §2). What is out here is only what the server
 * has to enforce policy on: who is in it, what kind of thing it is, and which
 * MLS group opens it.
 */
import { z } from 'zod';
import { AccountId, Snowflake } from './ids.js';

/**
 * `docs/04` §1's `rooms.kind`.
 *
 * It decides what may be done to the membership, which is why it is out here
 * rather than being inferred from `space` being null. A 1:1 DM's id is derived
 * from exactly two accounts (`dmRoomId`), so admitting a third would leave the
 * id describing something that is no longer true.
 */
export const RoomKind = z.enum(['space', 'dm', 'group']);
export type RoomKind = z.infer<typeof RoomKind>;

export const RoomInfo = z.object({
  id: Snowflake,
  kind: RoomKind,
  /** Null for a DM or a group DM — those are rooms with no space (`docs/03` §4). */
  space: Snowflake.nullable(),
  /** The MLS group that opens it, or null before anybody has created one. */
  group: Snowflake.nullable(),
  /** Accounts the server will deliver to. Not the MLS roster; see `docs/03` §5. */
  members: z.array(AccountId),
  /**
   * Which audience this room's group serves, or absent for a DM.
   *
   * The canonical key from `audienceKey()`. Sent because the client needs it to
   * find the one room every member of a space is in — that is where a space's
   * name lives, and a name carried anywhere narrower is one most of the space
   * cannot read.
   */
  audience: z.string().max(2000).optional(),
  /** Whether a `stream` hint may be attached to events here (`docs/03` §7). */
  streamPaging: z.boolean(),
  /** Whether a `notify` hint may be attached. */
  notifyHints: z.boolean(),
});
export type RoomInfo = z.infer<typeof RoomInfo>;

/**
 * Open a DM with somebody, by key or by name.
 *
 * Idempotent: the id is derived from the pair, so asking twice — or both people
 * asking at once — yields the same room.
 *
 * Both forms, because they are for different callers. A person types a name; a
 * client that already holds a roster has the key, and should use it — a handle
 * can be given up and taken by somebody else, and a key cannot (`docs/17`).
 */
export const CreateDm = z
  .object({
    account: AccountId.optional(),
    /** `viola` or `viola@revel.chat`. Bare resolves at the Host's own IdP. */
    address: z.string().min(2).max(290).optional(),
  })
  .refine((v) => (v.account === undefined) !== (v.address === undefined), {
    message: 'give exactly one of account or address',
  });
export type CreateDm = z.infer<typeof CreateDm>;

/**
 * Open a group DM.
 *
 * Not idempotent, and deliberately: two group DMs with the same people are two
 * different conversations, which is how every chat app that has them behaves
 * and what people expect when they start a second one.
 */
export const CreateGroupRoom = z.object({
  /** Everyone besides the caller. The caller is always a member. */
  accounts: z.array(AccountId).min(1).max(50),
});
export type CreateGroupRoom = z.infer<typeof CreateGroupRoom>;

export const RoomMembersInput = z.object({ accounts: z.array(AccountId).min(1).max(50) });
export type RoomMembersInput = z.infer<typeof RoomMembersInput>;
