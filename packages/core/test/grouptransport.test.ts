/**
 * `HttpGroupTransport` — the URLs it builds and the refusals it turns into
 * something a caller can branch on.
 *
 * The multi-client scenarios exercise all of this end to end, but they exercise
 * the happy path plus whatever the server happens to answer. These pin the
 * shape: an epoch conflict has to be *recognisable* rather than just an error,
 * because it is the one refusal that means "try again" rather than "stop".
 */
import { describe, expect, it } from 'vitest';
import { HttpGroupTransport, isEpochConflict, TransportError } from '../src/index.js';

function stub(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(url, init);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const transport = (fetch: typeof globalThis.fetch) =>
  new HttpGroupTransport({ baseUrl: 'https://host.example', fetch });

describe('URLs', () => {
  it('puts a shelf under the device it belongs to', async () => {
    const { calls, fetch } = stub(() => ok({ available: 3, lastResort: true }));
    await transport(fetch).publishKeyPackages('dev-a', { packages: ['AA=='] });

    expect(calls[0]?.url).toBe('https://host.example/idp/devices/dev-a/key-packages');
    expect(calls[0]?.init.method).toBe('PUT');
  });

  it('escapes ids rather than pasting them into a path', async () => {
    const { calls, fetch } = stub(() => ok({ records: [] }));
    await transport(fetch).fetchHandshake('a/b?c');
    expect(calls[0]?.url).toBe('https://host.example/groups/a%2Fb%3Fc/handshake');
  });

  it('adds a cursor only when there is one', async () => {
    const { calls, fetch } = stub(() => ok({ records: [] }));
    const t = transport(fetch);
    await t.fetchHandshake('1');
    await t.fetchHandshake('1', { since: 0, limit: 10 });

    expect(calls[0]?.url).toBe('https://host.example/groups/1/handshake');
    expect(calls[1]?.url).toBe('https://host.example/groups/1/handshake?since=0&limit=10');
  });

  it('sends `since=0`, which is not the same as sending nothing', async () => {
    // Sequence numbers start at zero, so a falsy check here would silently
    // re-fetch the whole log every time a client was one record behind.
    const { calls, fetch } = stub(() => ok({ records: [] }));
    await transport(fetch).fetchHandshake('1', { since: 0 });
    expect(calls[0]?.url).toContain('since=0');
  });

  it('does not care about a trailing slash on the base URL', async () => {
    const { calls, fetch } = stub(() => ok({ welcomes: [] }));
    await new HttpGroupTransport({ baseUrl: 'https://host.example//', fetch }).welcomes();
    expect(calls[0]?.url).toBe('https://host.example/welcomes');
  });

  it('asks for credentials on every request', async () => {
    let n = 0;
    const { calls, fetch } = stub(() => ok({ records: [] }));
    const t = new HttpGroupTransport({
      baseUrl: 'https://host.example',
      fetch,
      headers: () => ({ authorization: `token-${++n}` }),
    });
    await t.fetchHandshake('1');
    await t.fetchHandshake('1');

    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('token-1');
    expect((calls[1]?.init.headers as Record<string, string>).authorization).toBe('token-2');
  });
});

describe('refusals', () => {
  it('makes an epoch conflict recognisable', async () => {
    // The one refusal that means "rebuild and try again". Every other one means
    // stop, and a caller that cannot tell them apart either retries forever or
    // gives up on a race it would have won.
    const { fetch } = stub(() => ok({ error: 'epoch_conflict', epoch: 7 }, 409));

    const failed = await transport(fetch)
      .appendHandshake('1', { kind: 'commit', epoch: 4, bytes: 'AA==' })
      .catch((e: unknown) => e);

    expect(failed).toBeInstanceOf(TransportError);
    expect(isEpochConflict(failed)).toBe(true);
    expect((failed as TransportError).status).toBe(409);
  });

  it('does not mistake any other refusal for one', async () => {
    const { fetch } = stub(() => ok({ error: 'not_in_group' }, 403));
    const failed = await transport(fetch)
      .appendHandshake('1', { kind: 'commit', epoch: 4, bytes: 'AA==' })
      .catch((e: unknown) => e);

    expect(isEpochConflict(failed)).toBe(false);
    expect((failed as TransportError).reason).toBe('not_in_group');
  });

  it('treats a missing tree as a state, not a failure', async () => {
    // Nobody has committed one since the group opened. Ordinary.
    const { fetch } = stub(() => ok({ error: 'no_tree' }, 404));
    expect(await transport(fetch).getTree('1')).toBeNull();
  });

  it('still throws for anything else on the tree', async () => {
    const { fetch } = stub(() => ok({ error: 'not_in_group' }, 403));
    await expect(transport(fetch).getTree('1')).rejects.toThrow(/not_in_group/);
  });

  it('falls back to the status when the body is not ours', async () => {
    // A proxy or a captive portal answering instead of the server. The status
    // is all there is.
    const { fetch } = stub(() => new Response('<html>Gateway Timeout</html>', { status: 504 }));
    const failed = (await transport(fetch)
      .welcomes()
      .catch((e: unknown) => e)) as TransportError;

    expect(failed.reason).toBe('http_504');
    expect(failed.retryable).toBe(true);
  });
});
