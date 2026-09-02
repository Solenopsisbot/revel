/**
 * The invite key, between following a link and having an account.
 *
 * `revel.chat/i/<code>#<key>` puts a credential in the URL fragment, which is
 * exactly where it belongs — browsers never send a fragment to a server, so it
 * reaches the page and nothing else (`docs/03` §4). But `docs/18` also wants
 * the invite to survive sign-up, and sign-up is three navigations away.
 *
 * `sessionStorage`, not `localStorage`: this is key material with one job and a
 * lifetime of a few minutes. A tab closing should end it, and it should never
 * be sitting in a profile that syncs between machines.
 */

import type { InvitePreview } from '@revel/protocol';

/** Where the Host lives. Same origin in dev, behind the vite proxy. */
const HOST = import.meta.env.VITE_HOST_URL ?? '';

/**
 * What an invite looks like before you have an account.
 *
 * A plain `fetch` rather than a `Transport`, because the whole point of this
 * endpoint is that it takes no authentication — you follow a link before you
 * are anybody. Building a signed-in stack to ask would be the tail wagging the
 * dog, and on a device with no account there is no stack to build.
 */
export async function previewInvite(code: string): Promise<InvitePreview> {
  const res = await fetch(`${HOST}/invites/${encodeURIComponent(code)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as InvitePreview;
}

const KEY = 'revel.invite';

/** Long enough for a sign-up, short enough that a stale tab is not a hazard. */
const MAX_AGE = 30 * 60 * 1000;

interface Stashed {
  code: string;
  secret: string;
  at: number;
}

export function stashInvite(code: string, secret: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ code, secret, at: Date.now() } satisfies Stashed));
  } catch {
    // Private browsing, a full quota, a locked-down profile. The link still
    // works in this tab — `secret` is held in memory by the page that read it.
    // Only the trip through sign-up is lost, and that fails visibly.
  }
}

/**
 * The key for this code, if it was stashed and has not gone stale.
 *
 * Matched on the code, so a link followed after a different one does not get
 * handed the wrong key and a confusing signature failure.
 */
export function readStash(code: string): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const found = JSON.parse(raw) as Stashed;
    if (found.code !== code) return null;
    if (Date.now() - found.at > MAX_AGE) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return found.secret;
  } catch {
    return null;
  }
}

export function clearStash(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear, or nowhere to clear it from */
  }
}

/**
 * An invite link inside a message body, if there is one.
 *
 * Same origin only. `previewInvite` asks *this* Host about the code, so a link
 * to somebody else's deployment is a link we cannot describe and should not
 * pretend to — it renders as an ordinary link, which is the honest fallback.
 *
 * The fragment is required. Without it the link cannot be used (`/i/<code>`
 * says so in words), and a card offering to join something nobody can join is
 * worse than no card.
 */
export function inviteIn(text: string): { code: string; url: string } | null {
  if (typeof location === 'undefined') return null;
  // Deliberately not global-flagged and deliberately first-match: a message
  // with two invites in it is not a shape worth designing a stack of cards for.
  const found = text.match(/https?:\/\/[^\s<>"]+\/i\/([a-z0-9-]{4,64})#([^\s<>"]+)/i);
  if (!found) return null;
  const [url, code] = found;
  try {
    if (new URL(url).origin !== location.origin) return null;
  } catch {
    return null;
  }
  return { code: code as string, url };
}
