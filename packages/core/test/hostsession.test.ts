/**
 * Signing in when the Host says "not right now".
 *
 * A rate limit is transient by definition and says so in a header, and this is
 * the *startup* path — everything else in the app waits on it. Giving up on a
 * 429 left a signed-in account with no core at all: no rooms, no messages, and
 * nothing on screen saying why. Two accounts on one machine was enough to
 * cause it, because the limiter buckets by address.
 *
 * Every request here is safe to repeat, which is what makes retrying the right
 * answer rather than a hopeful one. `register` is idempotent by design;
 * `/auth/challenge` mints a fresh nonce; `/auth/session` spends one, and a
 * refusal from the limiter means the handler never ran, so the nonce is still
 * there.
 */
import { HostSession, HttpTransport } from '@revel/core';
import { describe, expect, it } from 'vitest';

/** Enough of a `CryptoEngine` for the two things `HostSession` asks it. */
const crypto = {
  identity: async () => ({
    certificate: new Uint8Array([1, 2, 3]),
    devicePublicKey: new Uint8Array(32).fill(9),
  }),
  signAuth: async () => new Uint8Array(64).fill(4),
} as unknown as ConstructorParameters<typeof HostSession>[0]['crypto'];

/** A fetch that replays a scripted list of responses and records the calls. */
function scripted(responses: Response[]) {
  const calls: string[] = [];
  const fetch = async (url: string | URL | Request) => {
    calls.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request: ${String(url)}`);
    return next;
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const limited = (retryAfter?: string) =>
  new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    ...(retryAfter ? { headers: { 'retry-after': retryAfter } } : {}),
  });
const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

function session(responses: Response[], slept: number[] = []) {
  const { fetch, calls } = scripted(responses);
  const host = new HostSession({
    crypto,
    baseUrl: 'https://revel.chat',
    fetch,
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { host, calls, slept };
}

describe('a Host that is rate limiting', () => {
  it('tries again rather than failing the whole start', async () => {
    const slept: number[] = [];
    const { host, calls } = session([limited(), ok()], slept);
    await host.register();
    expect(calls).toHaveLength(2);
    expect(slept).toHaveLength(1);
  });

  it('waits as long as the server asked, because it knows and we are guessing', async () => {
    const slept: number[] = [];
    const { host } = session([limited('2'), ok()], slept);
    await host.register();
    expect(slept).toEqual([2000]);
  });

  it('clamps a long Retry-After rather than sleeping through the app opening', async () => {
    // A server asking for a minute is telling us to stop, not to hang. The
    // caller has a Try again button for that case.
    const slept: number[] = [];
    const { host } = session([limited('600'), ok()], slept);
    await host.register();
    expect(slept[0]).toBeLessThanOrEqual(4000);
  });

  it('gives up eventually, with the reason intact', async () => {
    // Three attempts, not forever: a client that retries without end is a
    // client helping to keep the server down.
    const slept: number[] = [];
    const { host, calls } = session([limited(), limited(), limited()], slept);
    await expect(host.register()).rejects.toMatchObject({ reason: 'rate_limited', status: 429 });
    expect(calls).toHaveLength(3);
  });
});

describe('a Host that is refusing on the merits', () => {
  it('does not retry a refusal that will not change', async () => {
    // A 403 will still be a 403 in a second, and asking again is noise that
    // delays the honest answer.
    const slept: number[] = [];
    const { host, calls } = session(
      [new Response(JSON.stringify({ error: 'device_revoked' }), { status: 403 })],
      slept,
    );
    await expect(host.register()).rejects.toMatchObject({ reason: 'device_revoked' });
    expect(calls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('backs off on a 5xx too, which is the other transient one', async () => {
    const slept: number[] = [];
    const { host, calls } = session([new Response('nope', { status: 502 }), ok()], slept);
    await host.register();
    expect(calls).toHaveLength(2);
  });
});

describe('signing in', () => {
  it('survives a limit in the middle of the challenge-response', async () => {
    // Two requests, either of which can be refused. The nonce from the first
    // is still good when the second is retried — the limiter runs in front of
    // the handler, so a refused request never spent anything.
    const slept: number[] = [];
    const { host, calls } = session(
      [
        ok({ host: 'revel.chat', nonce: 'bm9uY2U=' }),
        limited('1'),
        ok({ token: 't', account: 'a', device: 'd', expiresAt: Date.now() + 60_000 }),
      ],
      slept,
    );
    const result = await host.ensure();
    expect(result.token).toBe('t');
    expect(calls).toHaveLength(3);
    expect(calls[1]).toContain('/auth/session');
    expect(calls[2]).toContain('/auth/session');
  });
});

describe('the ordinary transport, when the Host is limiting', () => {
  /**
   * Separate from `HostSession` above and with a *narrower* rule.
   *
   * `HostSession` retries 5xx as well, because everything it sends is
   * explicitly safe to repeat. This one carries arbitrary operations —
   * `POST /spaces` among them — so it retries only 429, where the limiter
   * running in front of the handler is proof the request had no effect.
   */
  const limited = () =>
    new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'retry-after': '0' },
    });

  function transport(responses: Response[]) {
    const calls: string[] = [];
    const fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      const next = responses.shift();
      if (!next) throw new Error(`unexpected request: ${String(url)}`);
      return next;
    }) as unknown as typeof globalThis.fetch;
    return { t: new HttpTransport({ baseUrl: 'https://revel.chat', fetch }), calls };
  }

  it('rides out a limit rather than leaving half a space behind', async () => {
    // The reported shape: making a space is three requests, and a limit landing
    // on the second left one that existed, had no rooms, and could not be
    // finished or undone.
    const { t, calls } = transport([
      limited(),
      new Response(JSON.stringify({ id: 's1', visibility: 'private' }), { status: 201 }),
    ]);
    await t.createSpace();
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 500, because the handler may have run', async () => {
    // The distinction that makes the retry above safe. Repeating a create that
    // might have half-succeeded is how one request becomes two spaces.
    const { t, calls } = transport([new Response('boom', { status: 500 })]);
    await expect(t.createSpace()).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('gives up after a few, with the reason intact', async () => {
    const { t, calls } = transport([limited(), limited(), limited()]);
    await expect(t.createSpace()).rejects.toMatchObject({ reason: 'rate_limited' });
    expect(calls).toHaveLength(3);
  });
});
