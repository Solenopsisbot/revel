import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../src/base64.js';

describe('base64', () => {
  it('matches known vectors from RFC 4648', () => {
    const enc = (s: string) => toBase64(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foob')).toBe('Zm9vYg==');
    expect(enc('fooba')).toBe('Zm9vYmE=');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });

  it('agrees with the platform implementation on random bytes', () => {
    // Hand-rolled codecs are exactly where off-by-one padding bugs live, so
    // check against Node's rather than only against ourselves.
    for (let n = 0; n < 200; n++) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (Math.random() * 256) | 0;
      const ours = toBase64(bytes);
      expect(ours).toBe(Buffer.from(bytes).toString('base64'));
      expect(fromBase64(ours)).toEqual(bytes);
    }
  });

  it('round-trips every single byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    expect(fromBase64(toBase64(all))).toEqual(all);
  });

  it('handles all three padding lengths', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const b = new Uint8Array(n).fill(0xab);
      expect(fromBase64(toBase64(b))).toEqual(b);
    }
  });

  it('rejects invalid characters rather than silently decoding garbage', () => {
    expect(() => fromBase64('!!!!')).toThrow(SyntaxError);
    expect(() => fromBase64('Zm9v$Zm')).toThrow(SyntaxError);
  });
});
