/**
 * The device fingerprint format, pinned.
 *
 * This is a reimplementation of `transfer::fingerprint` in Rust, which the
 * pairing screen uses — the whole value of showing one in the device list is
 * that a person can compare it against the one they confirmed when they added
 * the device. Two implementations of one format is a thing that drifts, so the
 * format is asserted here rather than trusted.
 */
import { describe, expect, it } from 'vitest';
import { fingerprint } from './fingerprint.js';

describe('a device fingerprint', () => {
  it('is six groups of four digits', async () => {
    const fp = await fingerprint(new Uint8Array(32));
    expect(fp).toMatch(/^\d{4}(?: \d{4}){5}$/);
  });

  it('is SHA-256 of the key, big-endian, four bytes at a time, mod 10000', async () => {
    // Pinned against the Rust: SHA-256 of 32 zero bytes begins
    // 66687aad f862bd77 6c8fc18b 8e9f8e20 08971485 6ee233b3 …
    // so the groups are those words mod 10 000.
    const want = [0x66687aad, 0xf862bd77, 0x6c8fc18b, 0x8e9f8e20, 0x08971485, 0x6ee233b3]
      .map((w) => String(w % 10_000).padStart(4, '0'))
      .join(' ');
    expect(await fingerprint(new Uint8Array(32))).toBe(want);
  });

  it('changes completely when the key does', async () => {
    const a = await fingerprint(new Uint8Array(32));
    const b = await fingerprint(new Uint8Array(32).fill(1));
    expect(a).not.toBe(b);
  });
});
