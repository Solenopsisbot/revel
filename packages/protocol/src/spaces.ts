/**
 * Spaces, as the wire sees them.
 *
 * Deliberately thin, for the same reason `rooms.ts` is: a space's **name,
 * topic and description are not here**. They live inside the ciphertext as
 * events (`docs/04` §2), so the server neither holds them nor can leak them.
 * What is out here is only what the server has to enforce policy on — who is
 * in it, what roles exist, and which rooms belong to it.
 */
import { z } from 'zod';
import { AccountId, Snowflake } from './ids.js';

/** `docs/18` §Creating a space. Public means listed, and is opt-in. */
export const SpaceVisibility = z.enum(['invite', 'link', 'public']);
export type SpaceVisibility = z.infer<typeof SpaceVisibility>;

export const SpaceInfo = z.object({
  id: Snowflake,
  visibility: SpaceVisibility,
  /** Whether the asking account owns it. Owners short-circuit every check. */
  owner: z.boolean(),
  /**
   * The asking account's effective permissions here, base-10.
   *
   * Sent so the client can gate its UI with **the same numbers the server
   * enforced** — `docs/04` §4 asks for one resolution function run in both
   * places, and shipping the result removes the second round trip without
   * introducing a second implementation.
   */
  permissions: z.string(),
});
export type SpaceInfo = z.infer<typeof SpaceInfo>;

export const RoleInfo = z.object({
  id: Snowflake,
  /** Permission bits, base-10 — JSON has no bigint (`docs/04` §1). */
  bits: z.string(),
  position: z.number().int().min(0),
});
export type RoleInfo = z.infer<typeof RoleInfo>;

export const SpaceMemberInfo = z.object({
  account: AccountId,
  /** `@everyone` is never listed: it applies to every member by definition. */
  roles: z.array(Snowflake),
});
export type SpaceMemberInfo = z.infer<typeof SpaceMemberInfo>;

/**
 * Creating a space takes nothing.
 *
 * Not even a name — that is an encrypted event sent once the space exists, so
 * asking for it here would mean either sending it in the clear or holding a
 * half-made space until the client sent the second request.
 */
export const CreateSpace = z.object({
  visibility: SpaceVisibility.optional(),
});
export type CreateSpace = z.infer<typeof CreateSpace>;

/**
 * A room inside a space, and who may see it.
 *
 * `audience` is the crypto boundary and everything else is policy (`docs/03`
 * §4). `everyone` shares the space's group, so a twelve-room space is one
 * commit; anything narrower gets its own group.
 */
export const RoomAudience = z.union([
  z.object({ kind: z.literal('everyone') }),
  z.object({ kind: z.literal('roles'), roles: z.array(Snowflake).min(1).max(32) }),
  z.object({ kind: z.literal('list'), accounts: z.array(AccountId).min(1).max(200) }),
]);
export type RoomAudience = z.infer<typeof RoomAudience>;

export const CreateSpaceRoom = z.object({
  /** Defaults to everyone in the space, which is what most rooms are. */
  audience: RoomAudience.optional(),
  streamPaging: z.boolean().optional(),
  notifyHints: z.boolean().optional(),
});
export type CreateSpaceRoom = z.infer<typeof CreateSpaceRoom>;

export const RoleInput = z.object({
  /** Base-10 bits. Validated against what the caller may grant, not just parsed. */
  bits: z.string().regex(/^\d{1,20}$/),
  position: z.number().int().min(0).max(1000).optional(),
});
export type RoleInput = z.infer<typeof RoleInput>;

export const SpaceMembersInput = z.object({
  accounts: z.array(AccountId).min(1).max(100),
});
export type SpaceMembersInput = z.infer<typeof SpaceMembersInput>;

export const MemberRolesInput = z.object({
  roles: z.array(Snowflake).max(64),
});
export type MemberRolesInput = z.infer<typeof MemberRolesInput>;

// ---------------------------------------------------------------------------
// Invite links (`docs/03` §4 — the Wormhole trick, `docs/18` §Joining)
// ---------------------------------------------------------------------------

/**
 * An invite as the Host sees it — which is not enough to redeem.
 *
 * `pub` is the public half of a keypair minted on the inviter's device. The
 * private half lives in the URL fragment (`revel.chat/i/<code>#<key>`) and
 * never reaches the server, so redeeming means signing a challenge with
 * something this row does not contain.
 *
 * **No name, no key material, no member list.** A space's name is an encrypted
 * event (`docs/04` §1) and the Host has never been told it, so an invite
 * cannot carry one either — which is why the landing page learns what the
 * space is called only after joining it.
 */
export const InviteInfo = z.object({
  code: z.string().min(1).max(64),
  space: Snowflake,
  pub: z.string().max(128),
  createdBy: AccountId,
  createdAt: z.number().int(),
  uses: z.number().int().nonnegative(),
  /** Absent means unlimited, which the UI says in words rather than as an ∞. */
  maxUses: z.number().int().positive().optional(),
  /** Absent means it does not expire. */
  expiresAt: z.number().int().optional(),
});
export type InviteInfo = z.infer<typeof InviteInfo>;

export const CreateInvite = z.object({
  /** Base64url Ed25519 public key. Minted on the device, never derived here. */
  pub: z.string().min(16).max(128),
  maxUses: z.number().int().positive().max(10_000).optional(),
  /** How long it lives, in milliseconds. Absent means forever. */
  ttl: z
    .number()
    .int()
    .positive()
    .max(365 * 24 * 60 * 60 * 1000)
    .optional(),
});
export type CreateInvite = z.infer<typeof CreateInvite>;

/**
 * What an invite looks like to somebody who has not joined yet.
 *
 * Deliberately almost nothing. The Host cannot describe a space it has never
 * been told the name of, and inventing a preview would mean putting a name
 * where `docs/04` §1 says one may not go. What is here is what the Host
 * genuinely knows and a stranger genuinely needs: does this link work, and how
 * many people are on the other side of it.
 */
export const InvitePreview = z.object({
  code: z.string(),
  space: Snowflake,
  members: z.number().int().nonnegative(),
  /**
   * The handle of whoever made the link. `docs/18` asks for it, and it is the
   * one thing on this page that lets somebody judge whether a link is real:
   * "Viola invited you" is a claim you can check against who sent it to you,
   * and "1 person is in this space" is not.
   *
   * Absent when the IdP does not know them — a foreign account, or one that
   * never claimed a handle. Not an error: the link still works.
   */
  invitedBy: z.string().max(64).optional(),
  /** Whether it is spent, expired, or fine — the client says which, in words. */
  status: z.enum(['ok', 'expired', 'used_up', 'revoked']),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

/**
 * Redeeming: a signature over the challenge, by the key in the fragment.
 *
 * The challenge is `redeem:<code>:<account>`, so a signature captured off one
 * account's redemption cannot be replayed to join a different one.
 */
export const RedeemInvite = z.object({
  /** Base64url Ed25519 signature over `redeem:<code>:<account>`. */
  signature: z.string().min(16).max(256),
});
export type RedeemInvite = z.infer<typeof RedeemInvite>;

// ---------------------------------------------------------------------------
// Bans (`docs/03` §9 — "bans persist across rejoin")
// ---------------------------------------------------------------------------

export const BanInput = z.object({
  account: AccountId,
  /**
   * Free text, and **for the other moderators**. Nothing sends it to the
   * person banned — a reason delivered to them is a conversation, and a
   * moderation log is a note to the people who share the decision.
   */
  reason: z.string().max(500).optional(),
});
export type BanInput = z.infer<typeof BanInput>;

export const BanInfo = z.object({
  account: AccountId,
  by: AccountId,
  at: z.number().int(),
  reason: z.string().max(500).optional(),
});
export type BanInfo = z.infer<typeof BanInfo>;

/**
 * The canonical name for an audience.
 *
 * **The rule, never the resulting member set.** Two rooms keyed on who
 * currently matches could silently share a group and then diverge as roles are
 * assigned — and there is no un-merging encrypted history. Sorted so that the
 * same rule written in a different order is the same audience.
 */
export function audienceKey(audience: RoomAudience): string {
  switch (audience.kind) {
    case 'everyone':
      return 'everyone';
    case 'roles':
      return `roles:${[...new Set(audience.roles)].sort().join(',')}`;
    case 'list':
      return `list:${[...new Set(audience.accounts)].sort().join(',')}`;
  }
}
