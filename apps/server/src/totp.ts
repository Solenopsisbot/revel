/**
 * TOTP (RFC 6238), as the IdP's second factor.
 *
 * `docs/03` §3 is clear about what this is and is not: **a policy gate at the
 * IdP, not cryptography.** The wraps still open only with the password-derived
 * KEK, so an IdP that skips its own check gains nothing it did not already
 * lack. What 2FA buys is defence against a *known* password — phishing, reuse —
 * which is the realistic attack, and that is worth having.
 *
 * Which is also why this is fifty lines of HMAC rather than a dependency: the
 * whole algorithm is "HMAC a counter, take four bytes, mod a million", and the
 * parts that are easy to get wrong are not the maths.
 *
 * ## The parts that are easy to get wrong
 *
 * - **Comparison must be constant-time.** A `===` on the code leaks, through
 *   timing, how many leading digits were right — which turns a million-guess
 *   space into six thousand-guess ones.
 * - **A used code must not be reusable.** Otherwise a code phished thirty
 *   seconds ago still works, which is most of what 2FA was meant to stop.
 *   Enforced by the caller recording the counter it accepted; see
 *   [`verifyTotp`]'s `lastCounter`.
 * - **The window has to be small and symmetric.** ±1 step covers clock drift
 *   and a person typing slowly. Wider is a bigger guessing surface for no
 *   benefit somebody can feel.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238's default, and what every authenticator app assumes. */
const STEP_SECONDS = 30;
const DIGITS = 6;
/** ±1 step: 30s either side. Drift and slow typing, not much else. */
const WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A fresh secret, base32, 160 bits — RFC 4226's recommendation. */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Base32 → bytes. Padding and lowercase tolerated; anything else is an error. */
function decodeBase32(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(ch);
    if (index === -1) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one counter step. */
function codeFor(secret: Buffer, counter: number): string {
  // 8-byte big-endian counter. `writeBigUInt64BE` rather than two 32-bit
  // writes, because the high half stops being zero in the year 2242 and a bug
  // that lands then is a bug nobody will be able to find.
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const mac = createHmac('sha1', secret).update(buf).digest();
  // Dynamic truncation, RFC 4226 §5.3.
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const binary =
    (((mac[offset] as number) & 0x7f) << 24) |
    (((mac[offset + 1] as number) & 0xff) << 16) |
    (((mac[offset + 2] as number) & 0xff) << 8) |
    ((mac[offset + 3] as number) & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The current code. For tests and for showing a freshly enrolled secret works. */
export function totpAt(secret: string, at: number): string {
  return codeFor(decodeBase32(secret), Math.floor(at / 1000 / STEP_SECONDS));
}

export interface TotpVerification {
  ok: boolean;
  /**
   * The counter step the code matched, when it did.
   *
   * The caller **must** persist this and pass it back as `lastCounter`, or a
   * code stays valid for its whole window and a phished one works twice.
   */
  counter?: number;
}

/**
 * Check a code, in constant time, refusing anything already used.
 *
 * `lastCounter` is the highest step this account has already spent. A code at
 * or below it is refused even when it is arithmetically correct — that is what
 * makes a code single-use, and single-use is most of what 2FA is for.
 */
export function verifyTotp(
  secret: string,
  code: string,
  at: number,
  lastCounter?: number,
): TotpVerification {
  if (!/^\d{6}$/.test(code)) return { ok: false };

  let bytes: Buffer;
  try {
    bytes = decodeBase32(secret);
  } catch {
    return { ok: false };
  }

  const now = Math.floor(at / 1000 / STEP_SECONDS);
  const given = Buffer.from(code, 'utf8');

  // Every step in the window is checked even after a match, so the time taken
  // does not depend on *which* step matched — a loop that returned early would
  // leak whether the code was early, on time, or late.
  let matched: number | undefined;
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (step < 0) continue;
    const expected = Buffer.from(codeFor(bytes, step), 'utf8');
    if (expected.length === given.length && timingSafeEqual(expected, given)) matched = step;
  }

  if (matched === undefined) return { ok: false };
  // Replay: a code already spent is not a code.
  if (lastCounter !== undefined && matched <= lastCounter) return { ok: false };
  return { ok: true, counter: matched };
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The issuer appears twice — as a label prefix and as a parameter — because
 * older apps read one and newer ones read the other, and an entry that says
 * "viola" with no hint of what it is for is one people delete.
 */
export function totpUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
