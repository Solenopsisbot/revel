/**
 * Where to go after signing in, when you were on your way somewhere.
 *
 * Following an invite link before you have an account is the case this exists
 * for (`docs/18`: "the invite is stashed and survives sign-up"), and it will
 * be the case for anything else that can be linked to.
 *
 * **Same-origin paths only, and validated rather than trusted.** A `?next=`
 * that accepted a full URL is an open redirect: somebody sends
 * `revel.chat/signin?next=https://reve1.chat/app`, you sign in on the real
 * site, and land on a copy that asks you to do it again. Requiring a leading
 * `/` and refusing `//` — which a browser reads as protocol-relative and
 * therefore as another host — is the whole check.
 */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next) return fallback;
  if (!next.startsWith('/')) return fallback;
  if (next.startsWith('//')) return fallback;
  // A backslash is a path separator to some browsers and not to the URL
  // parser, which is exactly the kind of disagreement this check exists to
  // survive.
  if (next.includes('\\')) return fallback;
  return next;
}
