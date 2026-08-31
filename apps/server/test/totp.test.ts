/**
 * TOTP.
 *
 * The maths is RFC 4226 and is checked against its own published test vectors,
 * which is the only honest way to test an algorithm somebody else specified.
 * Everything after that is the parts that are easy to get wrong and are not the
 * maths: replay, the window, and what happens to a malformed input.
 */
import { describe, expect, it } from 'vitest';
import { generateTotpSecret, totpAt, totpUri, verifyTotp } from '../src/totp.js';

/** RFC 4226 §D's secret, `12345678901234567890`, base32. */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const STEP = 30_000;

describe('the algorithm', () => {
  it('matches RFC 6238 test vectors', () => {
    // The published SHA-1 vectors. If these pass, the HMAC, the counter
    // encoding and the dynamic truncation are all right — and if they fail,
    // nothing else in this file is worth reading.
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(totpAt(RFC_SECRET, seconds * 1000)).toBe(expected);
    }
  });

  it('rolls over on the step boundary and not before', () => {
    const base = 1_700_000_000_000 - (1_700_000_000_000 % STEP);
    expect(totpAt(RFC_SECRET, base)).toBe(totpAt(RFC_SECRET, base + STEP - 1));
    expect(totpAt(RFC_SECRET, base)).not.toBe(totpAt(RFC_SECRET, base + STEP));
  });

  it('generates a 160-bit base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(secret);
  });
});

describe('verifying', () => {
  const now = 1_700_000_000_000;

  it('accepts the current code', () => {
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now).ok).toBe(true);
  });

  it('accepts one step either side, for drift and slow typing', () => {
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - STEP), now).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + STEP), now).ok).toBe(true);
  });

  it('refuses two steps out, so the guessing surface stays small', () => {
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 2 * STEP), now).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 2 * STEP), now).ok).toBe(false);
  });

  it('refuses a code that has already been spent', () => {
    // **The one that matters.** Without it a code phished thirty seconds ago
    // still works, which is most of what 2FA was meant to stop.
    const code = totpAt(RFC_SECRET, now);
    const first = verifyTotp(RFC_SECRET, code, now);
    expect(first.ok).toBe(true);
    expect(first.counter).toBeDefined();

    const replay = verifyTotp(RFC_SECRET, code, now, first.counter);
    expect(replay.ok).toBe(false);
  });

  it('refuses an older code even when it is inside the window', () => {
    // Having spent step N, step N-1 is not available either — otherwise the
    // window becomes a way to walk backwards through spent codes.
    const spent = verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now);
    const earlier = totpAt(RFC_SECRET, now - STEP);
    expect(verifyTotp(RFC_SECRET, earlier, now, spent.counter).ok).toBe(false);
  });

  it('still accepts the next code after one is spent', () => {
    const spent = verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now);
    const next = now + STEP;
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, next), next, spent.counter).ok).toBe(true);
  });

  it('refuses a wrong code', () => {
    const wrong = totpAt(RFC_SECRET, now) === '000000' ? '111111' : '000000';
    expect(verifyTotp(RFC_SECRET, wrong, now).ok).toBe(false);
  });

  it('refuses malformed input rather than throwing', () => {
    // These arrive from a request body. A verifier that throws is a 500 where
    // a 401 belongs, and a 500 is a different answer — which is an oracle.
    for (const code of ['', '12345', '1234567', 'abcdef', '12 345', '½34567']) {
      expect(verifyTotp(RFC_SECRET, code, now).ok).toBe(false);
    }
    expect(verifyTotp('not base32!', '123456', now).ok).toBe(false);
  });
});

describe('the enrolment URI', () => {
  it('carries the issuer in both places apps read it', () => {
    // Older apps read the label prefix, newer ones the parameter. An entry that
    // says "viola" with no hint of what it is for is one people delete.
    const uri = totpUri('Revel', 'viola@idp.example', RFC_SECRET);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Revel:viola%40idp\.example\?/);
    expect(uri).toContain('issuer=Revel');
    expect(uri).toContain(`secret=${RFC_SECRET}`);
  });

  it('escapes an account that would otherwise break the label', () => {
    const uri = totpUri('Revel', 'a/b:c', RFC_SECRET);
    expect(uri).toContain('Revel:a%2Fb%3Ac');
  });
});
