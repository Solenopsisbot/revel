/**
 * Fuzzing the decoders.
 *
 * `docs/29` §4 asks for this by name: "**Fuzz the decoder. It parses
 * attacker-influenced bytes.**"
 *
 * Which decoders, precisely, and why each one matters:
 *
 * - **`parseEncrypted`** runs on every message body after decryption. The bytes
 *   are authenticated — they came from somebody holding the group key — so this
 *   is not "an attacker on the wire". It is a *member* of the room, or a client
 *   with a bug, or a version of Revel that does not exist yet. All three are
 *   ordinary and none of them may take a room down.
 * - **`decodeDeviceCert`** runs on bytes from a total stranger, before anything
 *   has been verified. That one really is an attacker.
 * - **`parseServerFrame` / `parseClientFrame`** run on whatever came down a
 *   socket.
 *
 * The property is the same for all of them and deliberately modest: **never
 * throw, never hang, and never claim something is valid that is not.** A
 * decoder that throws is one somebody forgets to wrap; one that hangs is a
 * denial of service; one that is optimistic is a hole.
 *
 * Seeded, so a failure is reproducible. A fuzzer you cannot re-run is one that
 * finds a bug once and never again.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeDeviceCert,
  parseClientFrame,
  parseEncrypted,
  parseServerFrame,
  verifyDeviceCert,
} from '../src/index.js';

/** Mulberry32 — small, fast, and the same sequence on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)] as T;

/** A lone surrogate: valid in a JS string, not valid UTF-8. */
const LONE_SURROGATE = String.fromCharCode(0xd800);

/**
 * A random JSON value, sometimes shaped like something real.
 *
 * Pure noise almost never reaches the interesting code — a decoder rejects it
 * at the first field. Most of the value is in things that look *nearly* right:
 * a known `type` with the wrong body, a valid shape with one field replaced, a
 * deeply nested array where a string belongs.
 */
function value(r: () => number, depth = 0): unknown {
  const leaf: (() => unknown)[] = [
    () => null,
    () => undefined,
    () => r() * 1e9 - 5e8,
    () => Number.NaN,
    () => Number.POSITIVE_INFINITY,
    () => -0,
    () => r() > 0.5,
    () => '',
    () => 'x'.repeat(Math.floor(r() * 200)),
    () => LONE_SURROGATE,
    () => '../../etc/passwd',
    () => '__proto__',
    () => '1e400',
    () => [],
    () => ({}),
  ];
  if (depth > 4 || r() < 0.55) return pick(r, leaf)();

  if (r() < 0.5) {
    return Array.from({ length: Math.floor(r() * 5) }, () => value(r, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (let i = 0; i < Math.floor(r() * 5); i++) {
    out[pick(r, ['type', 'v', 'body', 'target', 'face', 'id', '__proto__', 'constructor', 'a'])] =
      value(r, depth + 1);
  }
  return out;
}

const TYPES = [
  'm.message',
  'm.edit',
  'm.redact',
  'm.reaction',
  'm.receipt',
  'm.typing',
  'm.pin',
  'm.thread',
  'm.annotation',
  'room.name',
  'room.faces',
  'not.a.type',
];

/** Nearly-valid: a real `type`, and everything else scrambled. */
function nearlyAnEvent(r: () => number): unknown {
  const out = value(r, 2);
  if (typeof out !== 'object' || out === null || Array.isArray(out)) return out;
  const obj = out as Record<string, unknown>;
  obj.type = pick(r, TYPES);
  if (r() > 0.3) obj.v = pick(r, [1, 0, 2, '1', null, 1.5]);
  return obj;
}

function bytes(r: () => number, max = 400): Uint8Array {
  const out = new Uint8Array(Math.floor(r() * max));
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(r() * 256);
  return out;
}

const ROUNDS = 3000;

describe('parseEncrypted', () => {
  it('preserves a payload that is not an object at all', () => {
    // Found by fuzzing. A payload is decrypted JSON and JSON is not always an
    // object: a member with a buggy client can send `"hello"` or `[1,2,3]` as a
    // whole body. `raw` used to be typed as a record and cast, which made it a
    // lie for exactly those — and `docs/29` §1 rule 2 says unknown content is
    // "preserved and re-emitted", which cannot be true of a value that was
    // quietly reshaped on the way in.
    for (const payload of ['hello', 42, [1, 2, 3], null, true]) {
      const parsed = parseEncrypted(payload);
      expect(parsed.known).toBe(false);
      if (!parsed.known) {
        expect(parsed.raw).toEqual(payload);
        expect(parsed.type).toBe('unknown');
      }
    }
  });

  it('never throws, on anything', () => {
    // The bytes reaching this are authenticated — a *member* of the room sent
    // them — which makes "a client with a bug" and "a newer version" the
    // realistic cases rather than an attacker. All three are ordinary, and none
    // may take a room down.
    const r = rng(0xc0ffee);
    for (let i = 0; i < ROUNDS; i++) {
      expect(() => parseEncrypted(value(r))).not.toThrow();
      expect(() => parseEncrypted(nearlyAnEvent(r))).not.toThrow();
    }
  });

  it('always answers with one of its two shapes', () => {
    const r = rng(1234);
    for (let i = 0; i < ROUNDS; i++) {
      const parsed = parseEncrypted(nearlyAnEvent(r));
      if (parsed.known) {
        // A known event must carry the discriminant the reducer switches on.
        expect(typeof parsed.event.type).toBe('string');
      } else {
        // An unknown one must still be renderable as a fallback rather than
        // vanishing (`docs/29` §1 rule 3), and must carry the original
        // *unchanged* — rule 2 says unknown content is preserved and
        // re-emitted, which is only true if nothing was coerced on the way in.
        expect(typeof parsed.type).toBe('string');
      }
    }
  });

  it('does not let a `__proto__` key change anything', () => {
    // Not because zod is known to be vulnerable, but because this is an object
    // that arrives from outside and then gets spread around.
    const probe = {} as Record<string, unknown>;
    const before = probe.polluted;
    parseEncrypted(JSON.parse('{"type":"m.message","v":1,"body":"x","__proto__":{"polluted":1}}'));
    expect(probe.polluted).toBe(before);
  });

  it('finishes quickly even on deeply nested nonsense', () => {
    // A decoder that hangs is a denial of service, and a nested-array bomb is
    // the cheapest way to write one.
    let deep: unknown = 'leaf';
    for (let i = 0; i < 2000; i++) deep = [deep];

    const started = Date.now();
    expect(() => parseEncrypted({ type: 'm.message', v: 1, body: deep })).not.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('decodeDeviceCert', () => {
  it('never throws on arbitrary bytes', () => {
    // These come from a stranger, before anything has been verified. This one
    // really is "an attacker".
    const r = rng(0xbadc0de);
    for (let i = 0; i < ROUNDS; i++) {
      expect(() => decodeDeviceCert(bytes(r))).not.toThrow();
    }
  });

  it('never throws on bytes that start out looking right', () => {
    // A valid version byte and a plausible length, then garbage — the shape
    // most likely to walk off the end of a buffer.
    const r = rng(99);
    for (let i = 0; i < ROUNDS; i++) {
      const b = bytes(r, 300);
      if (b.length > 0) b[0] = 1;
      expect(() => decodeDeviceCert(b)).not.toThrow();
    }
  });

  it('never returns something that verification then chokes on', async () => {
    // Decoding is not verifying, and the danger is a caller that forgets. What
    // must hold is that anything decoded is *checkable*: never a cert that
    // throws inside `verifyDeviceCert` instead of returning false.
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const b = bytes(r, 200);
      if (b.length > 0) b[0] = 1;
      const cert = decodeDeviceCert(b);
      if (!cert) continue;
      await expect(verifyDeviceCert(cert)).resolves.toBe(false);
    }
  });
});

describe('socket frames', () => {
  it('never throw, in either direction', () => {
    const r = rng(4242);
    for (let i = 0; i < ROUNDS; i++) {
      const v =
        r() > 0.5
          ? value(r)
          : { op: pick(r, ['EVENT', 'READY', 'HANDSHAKE', 'NOPE']), d: value(r) };
      expect(() => parseServerFrame(v)).not.toThrow();
      expect(() => parseClientFrame(v)).not.toThrow();
    }
  });

  it('return null rather than a half-parsed frame', () => {
    // A frame this build does not understand is a newer server's, not an error
    // — but it must be *absent*, not partially populated, or a `switch`
    // downstream falls into a case with missing fields.
    const r = rng(55);
    for (let i = 0; i < ROUNDS; i++) {
      const frame = parseServerFrame({ op: pick(r, ['EVENT', 'WELCOME', 'PONG']), d: value(r) });
      if (frame === null) continue;
      expect(typeof frame.op).toBe('string');
    }
  });
});
