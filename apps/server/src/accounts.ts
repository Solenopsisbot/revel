/**
 * Handles: the human name for an account key.
 *
 * `docs/03` §2. An account *is* a public key and exists whether or not any IdP
 * has heard of it; a handle is a name registered at one. Until this existed you
 * could open a DM with forty-three characters of base64url and not with a name,
 * which is a chat app only in the sense that a socket is a conversation.
 *
 * ## What claiming a handle proves
 *
 * That you hold a device whose certificate is signed by the account key — which
 * is what a session already proves (`auth.ts`). Nothing more is needed and
 * nothing more is asked: the handle binds to the key, and the key is the thing
 * that cannot be taken.
 *
 * The full design has OPAQUE registration at the IdP with a password and a
 * second factor (`docs/03` §3), which is a different thing for a different
 * reason — it protects the *key backup*, not the handle. That is phase 1's
 * remaining half and it is not here.
 *
 * ## What is deliberately missing
 *
 * **Foreign handles.** `docs/03` §2 resolves them by fetching
 * `/.well-known/uca/handles/<handle>` from another IdP and verifying inclusion
 * in its transparency log. Neither the fetch nor the log exists, so this
 * resolves handles at *this* IdP and refuses the rest by saying so, rather than
 * silently treating `viola@elsewhere` as the local `viola` — which would be a
 * message delivered to the wrong person with the right name.
 */
import {
  type AccountProfile,
  ClaimHandle,
  normaliseHandle,
  parseAddress,
  UpdateProfile,
} from '@revel/protocol';
import type { Hono } from 'hono';
import type { Actor } from './policy.js';
import type { Account, Store } from './store/types.js';

export interface AccountDeps {
  store: Store;
  /** This IdP's name — the part after the `@`. */
  idp: string;
  authenticate(req: Request): Promise<Actor | null>;
  now?: () => number;
}

/**
 * Handles the routing owns and nobody may take.
 *
 * `me` is a path segment here, so an account called `me` would be unreachable
 * by name. Short and deliberate: reserving a long list of "official-looking"
 * words is a policy decision, and this is not the place to make one.
 */
const RESERVED = new Set(['me']);

export function mountAccounts(app: Hono, deps: AccountDeps): void {
  const now = deps.now ?? (() => Date.now());

  /** Who am I, and what am I called. */
  app.get('/idp/accounts/me', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const account = await deps.store.getAccount(actor.accountId);
    // An account with no handle is a perfectly ordinary state — the key exists,
    // nobody has named it. Saying so beats 404, which reads as "you do not
    // exist" to a client that has just successfully signed in.
    if (!account) return c.json({ id: actor.accountId, handle: null }, 200);
    return c.json(profile(account, deps.idp));
  });

  /**
   * Claim a handle.
   *
   * Idempotent for the holder, refused for anybody else. Claiming a second one
   * releases the first: two handles pointing at one account would make
   * "what is this person called" have two answers.
   */
  app.post('/idp/accounts/me/handle', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const parsed = ClaimHandle.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_handle' }, 400);
    const handle = normaliseHandle(parsed.data.handle);
    if (RESERVED.has(handle)) return c.json({ error: 'handle_reserved' }, 409);

    const existing = await deps.store.getAccount(actor.accountId);
    const { account, claimed } = await deps.store.claimHandle({
      id: actor.accountId,
      handle,
      displayName: existing?.displayName ?? null,
      avatar: existing?.avatar ?? null,
      status: existing?.status ?? 'active',
      createdAt: existing?.createdAt ?? now(),
      movedTo: null,
    });

    if (!claimed && account.id !== actor.accountId) {
      return c.json({ error: 'handle_taken' }, 409);
    }
    return c.json(profile(account, deps.idp), claimed ? 201 : 200);
  });

  app.patch('/idp/accounts/me', async (c) => {
    const actor = await deps.authenticate(c.req.raw);
    if (!actor) return c.json({ error: 'unauthenticated' }, 401);

    const parsed = UpdateProfile.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);

    const patch: Partial<Pick<Account, 'displayName' | 'avatar'>> = {};
    if (parsed.data.displayName !== undefined) patch.displayName = parsed.data.displayName;
    if (parsed.data.avatar !== undefined) patch.avatar = parsed.data.avatar;

    const account = await deps.store.updateAccount(actor.accountId, patch);
    if (!account) return c.json({ error: 'claim_a_handle_first' }, 409);
    return c.json(profile(account, deps.idp));
  });

  /**
   * Resolve an address to an account.
   *
   * Takes a full address or a bare handle; a bare one is read against *this*
   * IdP, which is the only default a server can honestly supply. A client
   * showing a bare name has to know whose provider it is on (`docs/17`), and
   * that is a client concern.
   */
  app.get('/idp/accounts/:address', async (c) => {
    const address = parseAddress(decodeURIComponent(c.req.param('address')), deps.idp);
    if (!address) return c.json({ error: 'invalid_address' }, 400);

    // Refused rather than resolved locally. Treating `viola@elsewhere` as the
    // local `viola` is a message delivered to the wrong person with the right
    // name, which is the exact failure `docs/17` warns about when it says the
    // bare handle is never a key.
    if (address.idp !== deps.idp) {
      return c.json({ error: 'foreign_idp', idp: address.idp }, 501);
    }

    const account = await deps.store.getAccountByHandle(address.handle);
    if (!account) return c.json({ error: 'no_such_account' }, 404);
    return c.json(profile(account, deps.idp));
  });
}

/**
 * Resolve an address to an account id, for the routes that take one.
 *
 * Exported because `/rooms/dm` wants it: being able to DM a name rather than a
 * key is most of the point of handles existing.
 */
export async function resolveAddress(
  deps: Pick<AccountDeps, 'store' | 'idp'>,
  input: string,
): Promise<{ id: string } | { error: 'invalid_address' | 'foreign_idp' | 'no_such_account' }> {
  const address = parseAddress(input, deps.idp);
  if (!address) return { error: 'invalid_address' };
  if (address.idp !== deps.idp) return { error: 'foreign_idp' };

  const account = await deps.store.getAccountByHandle(address.handle);
  return account ? { id: account.id } : { error: 'no_such_account' };
}

function profile(account: Account, idp: string): AccountProfile {
  return {
    id: account.id,
    handle: account.handle,
    idp,
    ...(account.displayName ? { displayName: account.displayName } : {}),
    ...(account.avatar ? { avatar: account.avatar } : {}),
    status: account.status,
    createdAt: account.createdAt,
    movedTo: account.movedTo,
  };
}
