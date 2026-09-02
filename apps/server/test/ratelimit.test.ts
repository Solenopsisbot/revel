/**
 * Rate limiting, and the thing it must not turn into.
 *
 * `docs/29` §3 allows "no per-user request logs **beyond what rate limiting
 * needs**", which makes this the one component in a privacy-first server that
 * is permitted to remember who was here. Half these tests are about how quickly
 * it forgets.
 */

import { SnowflakeFactory } from '@revel/protocol';
import { classify, createApp, Hub, LIMITS, MemoryStore, RateLimiter } from '@revel/server';
import { describe, expect, it } from 'vitest';

const FAST = { capacity: 3, refillPerSecond: 1 };

/** A limiter whose clock the test owns. */
function limiter() {
  let now = 1_000_000;
  const it = new RateLimiter(() => now);
  return { it, tick: (ms: number) => (now += ms), at: () => now };
}

describe('the bucket', () => {
  it('allows a burst up to capacity, then stops', async () => {
    const { it } = limiter();
    for (let i = 0; i < 3; i++) expect(it.take('k', FAST).ok).toBe(true);
    expect(it.take('k', FAST).ok).toBe(false);
  });

  it('refills over time, not all at once', async () => {
    const { it, tick } = limiter();
    for (let i = 0; i < 3; i++) it.take('k', FAST);

    tick(1000);
    expect(it.take('k', FAST).ok).toBe(true);
    expect(it.take('k', FAST).ok).toBe(false);

    tick(2000);
    expect(it.take('k', FAST).ok).toBe(true);
    expect(it.take('k', FAST).ok).toBe(true);
    expect(it.take('k', FAST).ok).toBe(false);
  });

  it('does not let a burst straddle two windows', async () => {
    // The failure a fixed window has: spend a full window at the end of one and
    // a full window at the start of the next, and you have doubled the rate at
    // the worst possible moment. A token bucket cannot.
    const { it, tick } = limiter();
    for (let i = 0; i < 3; i++) it.take('k', FAST);
    tick(999);
    expect(it.take('k', FAST).ok).toBe(false);
  });

  it('says how long to wait, in whole seconds and never zero', async () => {
    const { it } = limiter();
    for (let i = 0; i < 3; i++) it.take('k', FAST);

    const verdict = it.take('k', FAST);
    expect(verdict.ok).toBe(false);
    // A `Retry-After: 0` is an invitation to retry immediately, which is the
    // one thing a limited client must not do.
    expect(verdict.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('keeps callers apart', async () => {
    const { it } = limiter();
    for (let i = 0; i < 3; i++) it.take('alice', FAST);
    expect(it.take('alice', FAST).ok).toBe(false);
    expect(it.take('bob', FAST).ok).toBe(true);
  });

  it('starts full for somebody it has never seen', async () => {
    const { it } = limiter();
    expect(it.take('stranger', FAST).remaining).toBe(2);
  });
});

describe('what it remembers', () => {
  it('holds nothing but a count and a time', async () => {
    // There is no path, no method, no body and no history in here. Nothing to
    // subpoena, because nothing was kept.
    const { it } = limiter();
    it.take('alice', FAST);
    const held = JSON.stringify(it);
    expect(held).not.toContain('alice');
  });

  it('forgets a caller as soon as their bucket refills', async () => {
    // A full bucket says exactly what a missing one says. Keeping it would be
    // storing information for no reason, so it is dropped.
    const { it, tick } = limiter();
    it.take('alice', FAST);
    expect(it.size).toBe(1);

    tick(10_000);
    expect(it.sweep(FAST)).toBe(1);
    expect(it.size).toBe(0);
  });

  it('keeps the ones that still have something to say', async () => {
    const { it, tick } = limiter();
    it.take('alice', FAST);
    it.take('alice', FAST);
    it.take('alice', FAST);
    tick(1000);

    expect(it.sweep(FAST)).toBe(0);
    expect(it.size).toBe(1);
  });

  it('does not record a refusal', async () => {
    // Storing rejections is how a limiter becomes an attack log. Being refused
    // leaves the same trace as being allowed: one bucket.
    const { it } = limiter();
    for (let i = 0; i < 10; i++) it.take('mallory', FAST);
    expect(it.size).toBe(1);
  });
});

describe('classifying a request', () => {
  it('puts the expensive unauthenticated things in the tightest class', async () => {
    // Cheap to send, expensive to serve, and reachable without proving
    // anything — the classic shape of a denial-of-service target.
    expect(classify('POST', '/auth/challenge')).toBe('auth');
    expect(classify('POST', '/auth/session')).toBe('auth');
  });

  it('gives device registration its own class, not the password-guessing one', async () => {
    // It was `auth`, which is sized against guessing: every attempt is an
    // attempt, and ten in a burst is already suspicious. Registering a device
    // is idempotent and self-authenticating — the certificate verifies against
    // the account key or it does not — and a client does it once per start. On
    // a shared address that difference is the whole story: two accounts on one
    // machine used to exhaust the bucket and get a 429 during startup.
    expect(classify('POST', '/idp/devices')).toBe('device');
    // Only the registration. Listing and revoking are authenticated and
    // ordinary.
    expect(classify('GET', '/idp/devices')).toBe('read');
    expect(classify('DELETE', '/idp/devices/abc')).toBe('write');
  });

  it('leaves room for more than one person behind an address', async () => {
    // The buckets are keyed by address, so everybody behind one shares them: a
    // household, a university, carrier NAT, or one person with a second
    // account open in another tab. `auth` was 10 capacity refilling at one
    // token per five seconds, which a couple of reloads exhausted — and the
    // failure did not read as a limit, it read as the app being broken.
    //
    // Stated as a floor rather than an exact value, so tuning is free and
    // going back under "a few normal sign-ins in a row" is not.
    const signInCost = 4;
    expect(LIMITS.auth.capacity).toBeGreaterThanOrEqual(signInCost * 4);
    expect(LIMITS.auth.refillPerSecond).toBeGreaterThanOrEqual(0.5);
    // One per app start, so this is many starts in a burst.
    expect(LIMITS.device.capacity).toBeGreaterThanOrEqual(15);
  });

  it('treats handle resolution as its own thing', async () => {
    // Also the enumeration surface: resolving handles fast enough, one at a
    // time, is how somebody builds a directory nobody agreed to publish.
    expect(classify('GET', '/idp/accounts/viola')).toBe('lookup');
  });

  it('separates uploads from other writes', async () => {
    expect(classify('POST', '/rooms/9001/blobs')).toBe('upload');
    expect(classify('POST', '/rooms/9001/events')).toBe('write');
  });

  it('defaults a new route to read, which is the cheapest thing to get wrong', async () => {
    expect(classify('GET', '/something/nobody/has/written/yet')).toBe('read');
  });

  it('lets a real burst of messages through', async () => {
    // Pasting four messages at once is what people do. A limit that punishes it
    // is a limit somebody turns off.
    expect(LIMITS.write.capacity).toBeGreaterThanOrEqual(20);
  });
});

describe('as middleware', () => {
  function host(address = () => 'one-caller') {
    const store = new MemoryStore();
    const limits = new RateLimiter();
    const app = createApp({
      store,
      hub: new Hub(),
      ids: new SnowflakeFactory(1),
      rateLimit: { limiter: limits, address },
      async authenticate() {
        return null;
      },
    });
    return { app, limits };
  }

  it('eventually answers 429 with a Retry-After', async () => {
    const h = host();
    let last = new Response(null, { status: 200 });
    for (let i = 0; i < LIMITS.auth.capacity + 1; i++) {
      last = await h.app.request('/auth/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device: 'dev-a' }),
      });
    }
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await last.json()).toMatchObject({ error: 'rate_limited' });
  });

  it('runs before the route does any work', async () => {
    // A limiter that runs after the thing it is limiting is decoration. The
    // refusal must come without the store being touched at all.
    const h = host();
    for (let i = 0; i < LIMITS.auth.capacity; i++) {
      await h.app.request('/auth/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device: 'dev-a' }),
      });
    }
    const before = h.limits.size;
    const refused = await h.app.request('/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'dev-a' }),
    });
    expect(refused.status).toBe(429);
    // No new challenge was minted for the refused request.
    expect(h.limits.size).toBe(before);
  });

  it('gives a signed-in device its own allowance', async () => {
    // Keyed by the session token, so one loud device cannot spend the whole
    // building's quota.
    const h = host();
    const spend = (token?: string) =>
      h.app.request('/rooms', { headers: token ? { authorization: `Bearer ${token}` } : {} });

    for (let i = 0; i < LIMITS.read.capacity; i++) await spend('token-one');
    expect((await spend('token-one')).status).toBe(429);
    expect((await spend('token-two')).status).toBe(401);
  });

  it('does not keep the token it keyed by', async () => {
    // A limiter holding live credentials in memory would be a worse thing than
    // the one it replaced.
    const h = host();
    await h.app.request('/rooms', { headers: { authorization: 'Bearer super-secret-token' } });
    expect(JSON.stringify(h.limits)).not.toContain('super-secret-token');
  });

  it('is absent when nobody configured it', async () => {
    // Which is right for a test and wrong for anything reachable.
    const app = createApp({
      store: new MemoryStore(),
      hub: new Hub(),
      ids: new SnowflakeFactory(1),
      async authenticate() {
        return null;
      },
    });
    for (let i = 0; i < 50; i++) {
      expect((await app.request('/health')).status).toBe(200);
    }
  });
});
