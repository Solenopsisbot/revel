/**
 * The handshake schemas.
 *
 * Mostly boundary checks, plus the one that matters most: an account id is a
 * public key, not a snowflake, and a schema that confuses the two rejects every
 * real identifier the client produces.
 */
import { describe, expect, it } from 'vitest';
import {
  AccountId,
  ClaimRequest,
  EventInput,
  HandshakeInput,
  HandshakeRecord,
  KeyPackageUpload,
  parseServerFrame,
  Snowflake,
} from '../src/index.js';

/** What `toAccountId` in `packages/core` actually emits: base64url, unpadded. */
const ACCOUNT = 'k7Yb3QzL0pW9xNvR2sTgHfMdEcJaUiOb1nKlPqRsTuV';

describe('account ids', () => {
  it('accepts what the client produces', () => {
    expect(AccountId.safeParse(ACCOUNT).success).toBe(true);
  });

  it('is not a snowflake, which is the bug this replaced', () => {
    // `notify` was typed as an array of snowflakes. Every real account id would
    // have been rejected the first time anybody populated it, and nobody had.
    expect(Snowflake.safeParse(ACCOUNT).success).toBe(false);
    expect(EventInput.safeParse(event({ notify: [ACCOUNT] })).success).toBe(true);
  });

  it('rejects things that are not identifiers at all', () => {
    for (const bad of ['has spaces', 'a/b', '', 'x'.repeat(129), '{"json":1}']) {
      expect(AccountId.safeParse(bad).success).toBe(false);
    }
  });
});

describe('key package uploads', () => {
  it('takes a shelf with an optional last-resort package', () => {
    const parsed = KeyPackageUpload.safeParse({
      packages: [b64('a'), b64('b')],
      lastResort: b64('z'),
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty shelf — a device that has run dry still says so', () => {
    expect(KeyPackageUpload.safeParse({ packages: [] }).success).toBe(true);
  });

  it('rejects a package that is not base64', () => {
    expect(KeyPackageUpload.safeParse({ packages: ['nope!'] }).success).toBe(false);
  });

  it('caps how many can be published at once', () => {
    const packages = Array.from({ length: 201 }, (_, i) => b64(`kp${i}`));
    expect(KeyPackageUpload.safeParse({ packages }).success).toBe(false);
  });
});

describe('claims', () => {
  it('needs at least one account', () => {
    expect(ClaimRequest.safeParse({ accounts: [] }).success).toBe(false);
  });

  it('takes a batch, because a mass add is one commit', () => {
    const accounts = Array.from({ length: 200 }, (_, i) => `${ACCOUNT.slice(0, 40)}${i % 10}ab`);
    expect(ClaimRequest.safeParse({ accounts }).success).toBe(true);
  });
});

describe('handshake entries', () => {
  const base = { kind: 'commit', epoch: 3, bytes: b64('commit') };

  it('round-trips a bare commit', () => {
    expect(HandshakeInput.parse(base)).toMatchObject({ kind: 'commit', epoch: 3 });
  });

  it('carries a welcome addressed to devices', () => {
    const parsed = HandshakeInput.safeParse({
      ...base,
      welcome: { bytes: b64('welcome'), devices: ['dev-a', 'dev-b'] },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a welcome addressed to nobody', () => {
    const parsed = HandshakeInput.safeParse({ ...base, welcome: { bytes: b64('w'), devices: [] } });
    expect(parsed.success).toBe(false);
  });

  it('rejects a negative epoch', () => {
    expect(HandshakeInput.safeParse({ ...base, epoch: -1 }).success).toBe(false);
  });

  it('rejects a kind that is not proposal or commit', () => {
    // `welcome` is deliberately absent: a Welcome is addressed to specific
    // devices and this log is fanned out to everyone.
    expect(HandshakeInput.safeParse({ ...base, kind: 'welcome' }).success).toBe(false);
  });

  it('caps the bytes well above a real commit and below a denial of service', () => {
    expect(HandshakeInput.safeParse({ ...base, bytes: 'A'.repeat(400_000) }).success).toBe(false);
  });

  it('allows a Welcome large enough for a batched add', () => {
    // `docs/31`: batching 500 adds puts 500 members' secrets in one Welcome.
    const big = 'A'.repeat(1_000_000);
    expect(
      HandshakeInput.safeParse({ ...base, welcome: { bytes: big, devices: ['d'] } }).success,
    ).toBe(true);
  });
});

describe('handshake records', () => {
  const record = {
    group: '12345',
    seq: 0,
    kind: 'proposal',
    epoch: 1,
    sender: 'dev-a',
    bytes: b64('p'),
    createdAt: 1,
  };

  it('round-trips one from a device', () => {
    expect(HandshakeRecord.parse(record).sender).toBe('dev-a');
  });

  it('allows `server` as a sender, for an external-sender proposal', () => {
    // `docs/03` §5 configures the Host as an MLS external sender so it can
    // propose on a membership change. It still cannot commit.
    expect(HandshakeRecord.parse({ ...record, sender: 'server' }).sender).toBe('server');
  });
});

describe('the new server frames', () => {
  it('parses a HANDSHAKE frame', () => {
    const frame = parseServerFrame({
      op: 'HANDSHAKE',
      d: {
        group: '1',
        seq: 2,
        kind: 'commit',
        epoch: 1,
        sender: 'dev-a',
        bytes: b64('c'),
        createdAt: 9,
      },
    });
    expect(frame?.op).toBe('HANDSHAKE');
  });

  it('parses a COMMIT_REQUESTED nudge', () => {
    const frame = parseServerFrame({ op: 'COMMIT_REQUESTED', d: { group: '1', deadline: 100 } });
    expect(frame).toMatchObject({ op: 'COMMIT_REQUESTED', d: { deadline: 100 } });
  });

  it('parses a WELCOME frame', () => {
    const frame = parseServerFrame({ op: 'WELCOME', d: { group: '1', bytes: b64('w') } });
    expect(frame?.op).toBe('WELCOME');
  });

  it('still returns null for a frame from a newer server', () => {
    // Adding these ops must not have made an unknown one throw: `docs/29` §1's
    // whole point is that a client meeting something newer degrades quietly.
    expect(parseServerFrame({ op: 'TELEPATHY', d: {} })).toBeNull();
  });
});

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function event(over: Record<string, unknown> = {}) {
  return {
    epoch: 1,
    class: 'normal',
    payload: b64('ciphertext'),
    clientNonce: 'nonce-abcdefgh',
    ...over,
  };
}
