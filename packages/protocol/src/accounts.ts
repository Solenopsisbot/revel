/**
 * Accounts, handles and addresses.
 *
 * `docs/03` §2: an account *is* a public key, globally unique with no registry.
 * A **handle** is a human name for that key, registered at an IdP, and the full
 * address is email-shaped — `viola@revel.chat`.
 *
 * ## The bare handle is never a key
 *
 * `docs/17`: "**Handles are not unique across IdPs.** Two different people can
 * both be `viola`. So the *full address* is the identifier everywhere it
 * matters — invites, mentions that resolve to a specific person, blocking,
 * verification. The bare handle is a display convenience, never a key."
 *
 * That rule is why [`parseAddress`] exists and why nothing here accepts a bare
 * handle without also being told which IdP it belongs to. It is very easy to
 * write the convenient version by accident, and the failure mode is delivering
 * a message to the wrong person with the right name.
 *
 * ## And the account id underneath is not either
 *
 * A handle can be given up and taken by somebody else. The account public key
 * cannot. Anything that has to still mean the same person next year — a
 * membership, a ban, a room's audience — stores the account id, and the handle
 * is looked up for display.
 */
import { z } from 'zod';
import { AccountId } from './ids.js';

/**
 * A handle as it is *stored* — already folded to lowercase.
 *
 * `Viola` and `viola` being two accounts is an impersonation vector, so there
 * is one canonical spelling and everything below the edge sees only that.
 */
export const Handle = z.string().regex(/^[a-z0-9_-]{2,32}$/, 'not a handle');

/**
 * A handle as somebody *typed* it.
 *
 * Lenient about case and strict about everything else: a person typing `Viola`
 * into a sign-up box should get `viola`, not a validation error. The split is
 * the point — input is forgiving, storage is canonical, and there is exactly
 * one place ([`normaliseHandle`]) where one becomes the other.
 */
export const HandleInput = z.string().regex(/^[A-Za-z0-9_-]{2,32}$/, 'not a handle');

/** An IdP's name, as it appears after the `@`. */
export const IdpName = z.string().regex(/^[a-z0-9.-]{1,253}$/, 'not an idp name');

export const AccountStatus = z.enum(['active', 'suspended']);
export type AccountStatus = z.infer<typeof AccountStatus>;

export const AccountProfile = z.object({
  id: AccountId,
  handle: Handle,
  /** The IdP this handle is registered at. Half of the real identifier. */
  idp: IdpName,
  displayName: z.string().max(80).optional(),
  /** A blob id. The bytes are encrypted like any other (`docs/22`). */
  avatar: z.string().max(128).optional(),
  status: AccountStatus,
  createdAt: z.number().int(),
  /**
   * Where this account moved to, if it has (`docs/03` §2).
   *
   * Carried so a client can follow, and currently never set: moving requires
   * the account key to sign `{moved_to, at}`, which is a flow that does not
   * exist. Present in the shape rather than absent so adding it later is not a
   * protocol change.
   */
  movedTo: IdpName.nullable(),
});
export type AccountProfile = z.infer<typeof AccountProfile>;

/**
 * What a client needs to know about a Host before it does anything.
 *
 * Fetched once, unauthenticated, because two of the three things in it are
 * needed *before* you can authenticate: the Host's name goes into the challenge
 * signature, and the external sender goes into a group at creation and can
 * never be added for free afterwards (`docs/03` §5, `docs/29` §1).
 */
export const HostInfo = z.object({
  /** The name that appears in a device-auth challenge. */
  host: z.string().max(255),
  /** The IdP this box serves handles for. Often the same box; not always. */
  idp: IdpName,
  /**
   * The Host's device certificate, base64, or null if it does not act as one.
   *
   * A client puts this in the `external_senders` group context extension when
   * it opens a group. Null is a legitimate answer — a Host that has published
   * no external sender simply cannot propose — and produces groups that refuse
   * external proposals entirely rather than a reason to fail.
   */
  externalSender: z.string().base64().nullable(),
});
export type HostInfo = z.infer<typeof HostInfo>;

export const ClaimHandle = z.object({ handle: HandleInput });
export type ClaimHandle = z.infer<typeof ClaimHandle>;

export const UpdateProfile = z.object({
  displayName: z.string().max(80).nullable().optional(),
  avatar: z.string().max(128).nullable().optional(),
});
export type UpdateProfile = z.infer<typeof UpdateProfile>;

/** `viola` and `revel.chat`, from `viola@revel.chat`. */
export interface Address {
  handle: string;
  idp: string;
}

/**
 * Parse an address, or a bare handle against a default IdP.
 *
 * The default is the *viewer's* IdP, which is what makes `docs/17`'s display
 * rule reversible: bare on your own provider, full otherwise. Passing the
 * wrong default here resolves a name to a stranger, so it is a required
 * argument rather than something with a sensible-looking fallback.
 */
export function parseAddress(input: string, defaultIdp: string): Address | null {
  const at = input.lastIndexOf('@');
  const handle = normaliseHandle(at === -1 ? input : input.slice(0, at));
  const idp = (at === -1 ? defaultIdp : input.slice(at + 1)).toLowerCase();

  if (!Handle.safeParse(handle).success) return null;
  if (!IdpName.safeParse(idp).success) return null;
  return { handle, idp };
}

/** How an address is written. */
export function formatAddress(address: Address): string {
  return `${address.handle}@${address.idp}`;
}

/**
 * How an address is *shown* (`docs/17`).
 *
 * Bare when the viewer is on the same IdP, full otherwise — so on the hosted
 * instance addresses look like plain usernames, and the moment a foreign
 * account appears in a room its provider becomes visible, which is exactly
 * when you would want to know.
 */
export function displayAddress(address: Address, viewerIdp: string): string {
  return address.idp === viewerIdp.toLowerCase() ? address.handle : formatAddress(address);
}

/**
 * Fold a handle for storage and comparison.
 *
 * Case only. Deliberately not Unicode confusable folding: that is a real
 * problem, it needs a table and a policy about which scripts may mix, and a
 * half-done version is worse than none because it looks like protection.
 */
export function normaliseHandle(handle: string): string {
  return handle.trim().toLowerCase();
}
