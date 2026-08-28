/**
 * Permission bitfields.
 *
 * Pruned from Kith's set (`docs/04` §4) because the server cannot see content:
 * there is no ADD_REACTIONS (a reaction is an event, so SEND covers it) and no
 * MANAGE_OWN_MESSAGES (authors always may, enforced in-band by the reducer).
 *
 * Permissions attach to ROLES and roles attach to ACCOUNTS — so all of a plural
 * system's faces share them, and an agent resolves through identical machinery.
 * There is deliberately no separate "bot permission" concept.
 */

export const Permission = {
  /** See the room and read its history. The real gate is key possession. */
  VIEW: 1n << 0n,
  /** Post events. Covers messages, reactions, receipts, typing. */
  SEND: 1n << 1n,
  /** Upload and attach media. */
  SEND_MEDIA: 1n << 2n,
  /** Purge others' events, and pin. Authors can always redact their own. */
  MANAGE_EVENTS: 1n << 3n,
  /** Use a `notify` hint covering the whole room. */
  MENTION_EVERYONE: 1n << 4n,
  /** Create, edit and delete rooms. */
  MANAGE_ROOMS: 1n << 5n,
  /** Create, edit and assign roles below your own highest. */
  MANAGE_ROLES: 1n << 6n,
  /** Space name, icon, listing, settings. */
  MANAGE_SPACE: 1n << 7n,
  /** Add, configure and remove agents. */
  MANAGE_AGENTS: 1n << 8n,
  KICK: 1n << 9n,
  BAN: 1n << 10n,
  INVITE: 1n << 11n,
  /** Owner-equivalent. Short-circuits every check. */
  ADMINISTRATOR: 1n << 62n,
} as const;

export type PermissionName = keyof typeof Permission;

/** What `@everyone` gets in a new space. */
export const DEFAULT_EVERYONE =
  Permission.VIEW | Permission.SEND | Permission.SEND_MEDIA | Permission.INVITE;

export function combine(...flags: bigint[]): bigint {
  return flags.reduce((a, f) => a | f, 0n);
}

export function everything(): bigint {
  return Object.values(Permission).reduce((a, f) => a | f, 0n);
}

/** Does `bits` grant `flag`? ADMINISTRATOR short-circuits to true. */
export function has(bits: bigint, flag: bigint): boolean {
  if ((bits & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) return true;
  return (bits & flag) === flag;
}

/** Ignores the ADMINISTRATOR shortcut — for "do they literally hold this". */
export function hasExact(bits: bigint, flag: bigint): boolean {
  return (bits & flag) === flag;
}

export function listPermissions(bits: bigint): PermissionName[] {
  return (Object.keys(Permission) as PermissionName[]).filter((n) => hasExact(bits, Permission[n]));
}

/** Stored and transported as a base-10 string; JSON has no bigint. */
export function serialize(bits: bigint): string {
  return bits.toString();
}

export function parse(v: string | null | undefined): bigint {
  if (!v) return 0n;
  return BigInt(v);
}

/** One role's allow/deny masks on one room. */
export interface RoomOverride {
  roleId: string;
  allow: bigint;
  deny: bigint;
}

export interface ResolveInput {
  /** Bitfields of every role the account holds, `@everyone` included. */
  roleBits: { roleId: string; bits: bigint }[];
  /** Overrides on the room being checked. */
  overrides?: RoomOverride[];
  isOwner?: boolean;
}

/**
 * Effective permissions: union the roles, then apply room overrides — all
 * denies before any allows, so a deny on one role cannot be silently undone by
 * an allow on another.
 *
 * The client runs this exact function so its UI gating agrees with the server
 * (`docs/04` §4). If they disagree, users see buttons that then fail.
 */
export function resolve({ roleBits, overrides = [], isOwner = false }: ResolveInput): bigint {
  if (isOwner) return everything();

  let bits = roleBits.reduce((a, r) => a | r.bits, 0n);
  if ((bits & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) return everything();

  const held = new Set(roleBits.map((r) => r.roleId));
  const mine = overrides.filter((o) => held.has(o.roleId));
  for (const o of mine) bits &= ~o.deny;
  for (const o of mine) bits |= o.allow;
  return bits;
}

/**
 * Privilege-escalation guard: you may only grant permissions you hold, and
 * never ADMINISTRATOR unless you are an owner (`docs/18`).
 */
export function canGrant(actor: bigint, wanted: bigint, isOwner = false): boolean {
  if (isOwner) return true;
  if ((wanted & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) return false;
  if ((actor & Permission.ADMINISTRATOR) === Permission.ADMINISTRATOR) {
    return (wanted & Permission.ADMINISTRATOR) === 0n;
  }
  return (wanted & ~actor) === 0n;
}

/** You cannot act on a role at or above your own highest. */
export function canActOnRole(actorHighest: number, targetPosition: number, isOwner = false): boolean {
  if (isOwner) return true;
  return actorHighest > targetPosition;
}
