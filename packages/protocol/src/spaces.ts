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
