/**
 * Base64 without `Buffer`.
 *
 * This package is the shared contract — it runs in browsers, in Node, in Bun
 * and inside the agent host. `Buffer` is Node-only, so a dependency on it would
 * quietly break the web client, which is the primary target.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : ALPHABET[c & 63];
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.endsWith('==') ? s.slice(0, -2) : s.endsWith('=') ? s.slice(0, -1) : s;
  const out = new Uint8Array((clean.length * 3) >> 2);
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    // `charCodeAt` can exceed the table, and an index past a `Uint8Array` is
    // `undefined` rather than a throw — so a non-Latin character used to sail
    // through the `=== 255` check and shift garbage into the output instead of
    // being rejected. Zod's `.base64()` covers anything that came off a wire;
    // `fromAccountId` does not, which is where this would have been felt.
    const code = clean.charCodeAt(i);
    const v = code < 256 ? (LOOKUP[code] as number) : 255;
    if (v === 255) throw new SyntaxError(`invalid base64 at index ${i}`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}
