import { describe, expect, it } from 'vitest';
import { EventInput, encodePayload, payloadBytes } from '../src/envelope.js';
import { EncryptedEvent, parseEncrypted } from '../src/events.js';

const validInput = {
  epoch: 3,
  class: 'normal' as const,
  payload: encodePayload(new Uint8Array([1, 2, 3])),
  clientNonce: 'abcdefgh',
};

describe('event envelope', () => {
  it('accepts a well-formed input', () => {
    expect(EventInput.safeParse(validInput).success).toBe(true);
  });

  it('round-trips the opaque payload', () => {
    const bytes = new Uint8Array([0, 255, 128, 7]);
    expect(payloadBytes({ payload: encodePayload(bytes) })).toEqual(bytes);
  });

  it('rejects a negative epoch', () => {
    expect(EventInput.safeParse({ ...validInput, epoch: -1 }).success).toBe(false);
  });

  it('rejects an oversized payload so one event cannot be a file', () => {
    const huge = 'A'.repeat(70000);
    expect(EventInput.safeParse({ ...validInput, payload: huge }).success).toBe(false);
  });

  it('requires a client nonce, because retries must be idempotent', () => {
    const { clientNonce: _, ...without } = validInput;
    expect(EventInput.safeParse(without).success).toBe(false);
    expect(EventInput.safeParse({ ...validInput, clientNonce: 'short' }).success).toBe(false);
  });

  it('rejects an unknown delivery class', () => {
    expect(EventInput.safeParse({ ...validInput, class: 'urgent' }).success).toBe(false);
  });

  it('caps the notify list', () => {
    const many = Array.from({ length: 300 }, (_, i) => String(i + 1));
    expect(EventInput.safeParse({ ...validInput, notify: many }).success).toBe(false);
  });

  it('rejects a non-snowflake stream id', () => {
    expect(EventInput.safeParse({ ...validInput, stream: 'not-an-id' }).success).toBe(false);
  });
});

describe('encrypted events', () => {
  it('parses a message with a face snapshot', () => {
    const ev = {
      v: 1,
      type: 'm.message',
      face: { id: '12', name: 'June', color: 'mint' },
      body: 'she does this every single time',
    };
    const parsed = parseEncrypted(ev);
    expect(parsed.known).toBe(true);
    if (parsed.known && parsed.event.type === 'm.message') {
      expect(parsed.event.face?.name).toBe('June');
    }
  });

  it.each([
    ['m.edit', { target: '1', body: 'fixed' }],
    ['m.redact', { target: '1' }],
    ['m.reaction', { target: '1', key: 'heart' }],
    ['m.receipt', { upTo: '1' }],
    ['m.typing', {}],
    ['m.pin', { target: '1' }],
    ['m.annotation', { target: '1', kind: 'translation:de', body: 'hallo' }],
    ['room.name', { name: 'design' }],
    ['room.faces', { faces: [{ id: '1', name: 'June' }] }],
  ])('accepts %s', (type, rest) => {
    expect(EncryptedEvent.safeParse({ v: 1, type, ...rest }).success).toBe(true);
  });

  it('surfaces an unknown type as a fallback rather than failing', () => {
    // docs/29 §1 rule 3: a newer client's event type must render as something,
    // not vanish and not throw.
    const parsed = parseEncrypted({ v: 1, type: 'm.poll', question: 'lunch?' });
    expect(parsed.known).toBe(false);
    if (!parsed.known) {
      expect(parsed.type).toBe('m.poll');
      expect(parsed.raw.question).toBe('lunch?');
    }
  });

  it('does not throw on malformed or hostile input', () => {
    for (const junk of [null, undefined, 42, 'string', [], { v: 2 }, { type: 5 }]) {
      expect(() => parseEncrypted(junk)).not.toThrow();
      expect(parseEncrypted(junk).known).toBe(false);
    }
  });

  it('rejects a message whose required field is missing', () => {
    expect(EncryptedEvent.safeParse({ v: 1, type: 'm.message' }).success).toBe(false);
    expect(EncryptedEvent.safeParse({ v: 1, type: 'm.edit', body: 'x' }).success).toBe(false);
  });

  it('keeps unknown fields on a known type, so a v1 client cannot destroy v2 data', () => {
    // docs/29 §1 rule 2 — the most commonly skipped rule, and the one that
    // silently eats data when an old client edits a new message.
    const withFuture = {
      v: 1,
      type: 'm.message',
      body: 'hi',
      somethingFromV2: { nested: true },
    };
    const parsed = EncryptedEvent.parse(withFuture) as Record<string, unknown>;
    expect(parsed.somethingFromV2).toEqual({ nested: true });
  });
});
