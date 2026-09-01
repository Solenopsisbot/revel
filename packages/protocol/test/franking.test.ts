/**
 * Message franking (`docs/03` §9).
 *
 * The property being defended: **a reporter cannot invent a message.**
 * Moderators here are members, not the server, so a report hands over
 * plaintext nobody else has seen — and without a commitment the server holds,
 * a moderator acting on one is acting on the reporter's word.
 */
import { describe, expect, it } from 'vitest';
import { commitment, frankingKey, toBase64, verifyFranking } from '../src/index.js';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('franking a message', () => {
  it('verifies the plaintext it was made from', async () => {
    const key = frankingKey();
    const said = bytes('{"v":1,"type":"m.message","body":"hello"}');
    expect(await verifyFranking(key, said, await commitment(key, said))).toBe(true);
  });

  it('refuses a plaintext that was never sent — the whole point', async () => {
    // A reporter holds the key, because it travels inside the ciphertext. What
    // they cannot do is produce a *different* message that matches the
    // commitment the server is holding.
    const key = frankingKey();
    const real = await commitment(key, bytes('what was actually said'));
    expect(await verifyFranking(key, bytes('something much worse'), real)).toBe(false);
    // Not even a single byte.
    expect(await verifyFranking(key, bytes('what was actually saId'), real)).toBe(false);
  });

  it('refuses the right plaintext under a different key', async () => {
    const said = bytes('what was actually said');
    const real = await commitment(frankingKey(), said);
    expect(await verifyFranking(frankingKey(), said, real)).toBe(false);
  });

  it('refuses a malformed commitment rather than throwing', async () => {
    // Every byte of this comes from somewhere untrusted — a moderator's client
    // is parsing a report written by whoever filed it.
    const key = frankingKey();
    const said = bytes('hello');
    expect(await verifyFranking(key, said, 'not base64 !!')).toBe(false);
    expect(await verifyFranking(key, said, '')).toBe(false);
    expect(await verifyFranking(key, said, toBase64(new Uint8Array(8)))).toBe(false);
  });

  it('mints a fresh key every time', async () => {
    // A key shared between two messages would let anybody who can open one
    // prove things about the other.
    const keys = new Set(Array.from({ length: 64 }, () => toBase64(frankingKey())));
    expect(keys.size).toBe(64);
    expect(frankingKey()).toHaveLength(32);
  });

  it('produces a commitment that reveals nothing about length', async () => {
    // Fixed width, so the envelope does not leak how long the message was —
    // `docs/03` §7 is careful about metadata and this is server-visible.
    const key = frankingKey();
    const short = await commitment(key, bytes('hi'));
    const long = await commitment(key, bytes('x'.repeat(4000)));
    expect(short.length).toBe(long.length);
  });
});
