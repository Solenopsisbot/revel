/**
 * `/.well-known/security.txt` — RFC 9116.
 *
 * `docs/29` §6 lists it first among the cheap things that are conspicuous by
 * their absence, and Kith had one.
 *
 * ## Why an unconfigured Host serves nothing
 *
 * There is no default contact, and a Host with no contact configured returns
 * 404 rather than a file with a placeholder in it. A `security.txt` pointing at
 * an address nobody reads is worse than none: it is the difference between a
 * researcher looking for another way to reach you and a researcher believing
 * they already did.
 *
 * The same reasoning applies to `Expires`, which RFC 9116 requires. A stale
 * one is a document that says, in machine-readable form, "this is no longer
 * maintained" — so the value is computed from now rather than baked in, and a
 * Host that stops running stops serving it.
 */
import type { Hono } from 'hono';

export interface SecurityContact {
  /**
   * How to report. A `mailto:` or `https:` URI, per RFC 9116 — at least one is
   * required and the file is meaningless without it.
   */
  contact: string[];
  /** Where the written disclosure policy lives (`docs/29` §6). */
  policy?: string;
  /** Where researchers who have reported are credited. No bounty; credit. */
  acknowledgments?: string;
  /** Languages a report will actually be read in. */
  languages?: string[];
  /** A key a reporter can encrypt to. */
  encryption?: string;
  /** How long the file claims to be current. RFC 9116 requires it. */
  validForDays?: number;
}

export interface WellKnownDeps {
  security?: SecurityContact;
  now?: () => number;
}

/** Long enough not to be busywork, short enough that a dead Host expires. */
const DEFAULT_VALID_DAYS = 180;

export function mountWellKnown(app: Hono, deps: WellKnownDeps): void {
  const now = deps.now ?? (() => Date.now());

  app.get('/.well-known/security.txt', (c) => {
    const security = deps.security;
    if (!security?.contact.length) {
      // Nothing, rather than something misleading. See the note above.
      return c.text('', 404);
    }

    const validUntil = new Date(
      now() + (security.validForDays ?? DEFAULT_VALID_DAYS) * 86_400_000,
    ).toISOString();

    const lines = [
      ...security.contact.map((c) => `Contact: ${c}`),
      `Expires: ${validUntil}`,
      ...(security.policy ? [`Policy: ${security.policy}`] : []),
      ...(security.acknowledgments ? [`Acknowledgments: ${security.acknowledgments}`] : []),
      ...(security.languages?.length
        ? [`Preferred-Languages: ${security.languages.join(', ')}`]
        : []),
      ...(security.encryption ? [`Encryption: ${security.encryption}`] : []),
    ];

    return c.text(`${lines.join('\n')}\n`, 200, {
      'content-type': 'text/plain; charset=utf-8',
    });
  });
}
