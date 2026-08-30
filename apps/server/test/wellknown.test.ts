/**
 * `/.well-known/security.txt`.
 *
 * `docs/29` §6 lists it first among the cheap things that are conspicuous by
 * their absence. The interesting behaviour is the refusal: an unconfigured Host
 * serves nothing, because a contact nobody reads is worse than no contact.
 */
import { SnowflakeFactory } from '@revel/protocol';
import { createApp, Hub, MemoryStore } from '@revel/server';
import { describe, expect, it } from 'vitest';

function host(security?: Parameters<typeof createApp>[0]['security']) {
  return createApp({
    store: new MemoryStore(),
    hub: new Hub(),
    ids: new SnowflakeFactory(1),
    ...(security ? { security } : {}),
    async authenticate() {
      return null;
    },
  });
}

const CONTACT = 'mailto:security@revel.example';

describe('security.txt', () => {
  it('is not served at all when nobody configured a contact', async () => {
    // The difference between a researcher looking for another way to reach you
    // and a researcher believing they already did.
    expect((await host().request('/.well-known/security.txt')).status).toBe(404);
  });

  it('serves the contact when there is one', async () => {
    const res = await host({ contact: [CONTACT] }).request('/.well-known/security.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain(`Contact: ${CONTACT}`);
  });

  it('always carries an Expires, which RFC 9116 requires', async () => {
    const body = await (
      await host({ contact: [CONTACT] }).request('/.well-known/security.txt')
    ).text();
    const expires = /^Expires: (.+)$/m.exec(body)?.[1];
    expect(expires).toBeTruthy();
    expect(new Date(expires as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('computes Expires from now, so a running Host is never stale', async () => {
    // A stale `Expires` is a document saying, in machine-readable form, "this
    // is no longer maintained". Baking one in guarantees it eventually says so.
    const app = host({ contact: [CONTACT], validForDays: 30 });
    const first = await (await app.request('/.well-known/security.txt')).text();
    await new Promise((r) => setTimeout(r, 5));
    const second = await (await app.request('/.well-known/security.txt')).text();

    const at = (body: string) => new Date(/^Expires: (.+)$/m.exec(body)?.[1] as string).getTime();
    expect(at(second)).toBeGreaterThanOrEqual(at(first));
  });

  it('carries the optional fields when they are set, and omits them when not', async () => {
    const full = await (
      await host({
        contact: [CONTACT, 'https://revel.example/security'],
        policy: 'https://revel.example/security-policy',
        acknowledgments: 'https://revel.example/thanks',
        languages: ['en'],
      }).request('/.well-known/security.txt')
    ).text();

    expect(full).toContain('Contact: https://revel.example/security');
    expect(full).toContain('Policy: https://revel.example/security-policy');
    expect(full).toContain('Acknowledgments: https://revel.example/thanks');
    expect(full).toContain('Preferred-Languages: en');

    const bare = await (
      await host({ contact: [CONTACT] }).request('/.well-known/security.txt')
    ).text();
    expect(bare).not.toContain('Policy:');
    expect(bare).not.toContain('Acknowledgments:');
  });

  it('is not served for an empty contact list either', async () => {
    expect((await host({ contact: [] }).request('/.well-known/security.txt')).status).toBe(404);
  });
});
