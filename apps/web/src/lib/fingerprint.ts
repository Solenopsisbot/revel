/**
 * A device key, in six groups of four digits.
 *
 * The same shape the pairing screen shows (`crates/revel-crypto/src/transfer.rs`
 * — SHA-256 of the 32-byte public key, six 4-digit groups) and deliberately so:
 * you confirm a fingerprint when you add a device, and the point of showing one
 * in the device list is that you can match it against what you confirmed.
 *
 * Reimplemented here in twelve lines rather than reaching for the wasm module,
 * because that module is the crypto engine and this is a settings list — a
 * screen that has to boot a worker to render text is a screen that renders
 * nothing when the worker fails. The format is fixed and documented; if it ever
 * changes, `fingerprint.test.ts` fails rather than the two quietly diverging.
 *
 * Not a secret and not a check the software makes. It is for a human comparing
 * two screens, which is the only thing a fingerprint has ever been for.
 */
export async function fingerprint(publicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', publicKey.slice() as unknown as ArrayBuffer),
  );
  const groups: string[] = [];
  for (let i = 0; i < 6; i++) {
    const chunk =
      ((digest[i * 4]! << 24) >>> 0) +
      (digest[i * 4 + 1]! << 16) +
      (digest[i * 4 + 2]! << 8) +
      digest[i * 4 + 3]!;
    groups.push(String(chunk % 10_000).padStart(4, '0'));
  }
  return groups.join(' ');
}
