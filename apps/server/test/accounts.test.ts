/**
 * Handles — the human name for an account key.
 *
 * The rule most of this file is defending: **the bare handle is never a key**
 * (`docs/17`). Handles are not unique across IdPs, they can be given up and
 * taken by somebody else, and treating one as an identifier is how a message
 * gets delivered to the wrong person with the right name.
 */
import {
  AccountProfile,
  type DeviceCert,
  decodeDeviceCert,
  displayAddress,
  formatAddress,
  fromBase64,
  HostInfo,
  parseAddress,
  verifyDeviceCert,
} from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import { authHarness } from './authHelpers.js';

const IDP = 'revel.test';

describe('parsing an address', () => {
  it('reads a full address', () => {
    expect(parseAddress('viola@revel.chat', IDP)).toEqual({ handle: 'viola', idp: 'revel.chat' });
  });

  it('reads a bare handle against the viewer‘s IdP', () => {
    expect(parseAddress('viola', IDP)).toEqual({ handle: 'viola', idp: IDP });
  });

  it('folds case, because two spellings of one name is an impersonation vector', () => {
    expect(parseAddress('Viola@Revel.Chat', IDP)).toEqual({
      handle: 'viola',
      idp: 'revel.chat',
    });
  });

  it('accepts a provider with a port, which is what a local one has', () => {
    // The dev Host names itself `localhost:<port>` because that is where it
    // answers — and `IdpName` used to forbid the colon, so every address
    // resolution on a local deployment failed with `invalid_address`. A
    // whole-app failure caused by a regex, worked around twice before it was
    // fixed once.
    expect(parseAddress('viola@localhost:8080', IDP)).toEqual({
      handle: 'viola',
      idp: 'localhost:8080',
    });
  });

  it('still refuses things that are not a provider at all', () => {
    // Widening the pattern is only safe while it stays a pattern.
    expect(parseAddress('viola@not a host', IDP)).toBeNull();
    expect(parseAddress('viola@revel.chat:notaport', IDP)).toBeNull();
    expect(parseAddress('viola@revel.chat:8080:9090', IDP)).toBeNull();
  });

  it('splits on the last @, so a handle cannot smuggle one in', () => {
    // `a@b@c` has to be somebody at `c`, not `a` at `b@c`.
    expect(parseAddress('a@b@revel.chat', IDP)).toBeNull();
  });

  it('refuses things that are not addresses', () => {
    for (const bad of ['', 'a', 'has space@x.com', 'viola@', '@revel.chat', 'v'.repeat(40)]) {
      expect(parseAddress(bad, IDP)).toBeNull();
    }
  });

  it('shows bare on your own provider and full on anybody else‘s', () => {
    // `docs/17`: on the hosted instance addresses look like plain usernames,
    // and the moment a foreign account appears its provider becomes visible —
    // which is exactly when you would want to know.
    const local = { handle: 'viola', idp: 'revel.chat' };
    const foreign = { handle: 'ash', idp: 'cool.town' };
    expect(displayAddress(local, 'revel.chat')).toBe('viola');
    expect(displayAddress(foreign, 'revel.chat')).toBe('ash@cool.town');
    expect(formatAddress(local)).toBe('viola@revel.chat');
  });
});

describe('what a Host says about itself', () => {
  it('publishes its name, its IdP and its external sender, unauthenticated', async () => {
    // Unauthenticated on purpose: two of the three are needed *before* you can
    // authenticate. The name goes into the challenge you sign, and the external
    // sender goes into a group at creation.
    const h = await authHarness();
    const res = await h.get('/.well-known/revel/host');
    expect(res.status).toBe(200);

    const info = (await res.json()) as any;
    expect(HostInfo.safeParse(info).success).toBe(true);
    expect(info.host).toBe(IDP);
  });

  it('publishes a certificate that verifies', async () => {
    // Baked into the group context of every group opened while it is
    // published, and unchangeable there without a commit. A Host that
    // published a certificate its own account key never signed would be
    // unable to propose into any of them, and would find out much later.
    const h = await authHarness();
    const info = (await (await h.get('/.well-known/revel/host')).json()) as any;
    const cert = decodeDeviceCert(fromBase64(info.externalSender));

    expect(cert).not.toBeNull();
    expect(cert?.label).toBe(IDP);
    expect(await verifyDeviceCert(cert as DeviceCert)).toBe(true);
  });

  it('may legitimately publish none', async () => {
    // A Host that does not act as an external sender is a coherent deployment,
    // not an error: its groups simply refuse external proposals.
    const h = await authHarness({ externalSender: null });
    const info = (await (await h.get('/.well-known/revel/host')).json()) as any;
    expect(info.externalSender).toBeNull();
  });
});

describe('claiming a handle', () => {
  it('binds it to the account behind the session', async () => {
    const h = await authHarness();
    const alice = await h.person('laptop');
    const res = await h.post('/idp/accounts/me/handle', { handle: 'viola' }, await alice.token());

    expect(res.status).toBe(201);
    const account = (await res.json()) as any;
    expect(AccountProfile.safeParse(account).success).toBe(true);
    expect(account).toMatchObject({ id: alice.accountId, handle: 'viola', idp: IDP });
  });

  it('folds case on the way in', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const res = await h.post('/idp/accounts/me/handle', { handle: 'Viola' }, await alice.token());
    expect(((await res.json()) as any).handle).toBe('viola');
  });

  it('is refused when somebody else has it, in any casing', async () => {
    const h = await authHarness();
    const alice = await h.person('alice');
    const bob = await h.person('bob');
    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, await alice.token());

    const res = await h.post('/idp/accounts/me/handle', { handle: 'VIOLA' }, await bob.token());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'handle_taken' });
  });

  it('is a no-op when you already have it', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const token = await alice.token();
    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, token);

    const again = await h.post('/idp/accounts/me/handle', { handle: 'viola' }, token);
    expect(again.status).toBe(200);
    expect(((await again.json()) as any).handle).toBe('viola');
  });

  it('releases the old one when you change it', async () => {
    // Two handles pointing at one account would make "what is this person
    // called" have two answers, and leave the old name unusable by anybody.
    const h = await authHarness();
    const alice = await h.person('alice');
    const bob = await h.person('bob');
    const aliceToken = await alice.token();

    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, aliceToken);
    await h.post('/idp/accounts/me/handle', { handle: 'vi' }, aliceToken);

    expect((await h.get('/idp/accounts/viola')).status).toBe(404);
    expect(
      (await h.post('/idp/accounts/me/handle', { handle: 'viola' }, await bob.token())).status,
    ).toBe(201);
  });

  it('refuses a handle the routing owns', async () => {
    // `me` is a path segment, so an account called `me` would be unreachable.
    const h = await authHarness();
    const alice = await h.person();
    const res = await h.post('/idp/accounts/me/handle', { handle: 'me' }, await alice.token());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'handle_reserved' });
  });

  it('refuses a handle that is not one', async () => {
    const h = await authHarness();
    const token = await (await h.person()).token();
    for (const handle of ['a', 'has space', 'Viola!', 'x'.repeat(33), '']) {
      expect((await h.post('/idp/accounts/me/handle', { handle }, token)).status).toBe(400);
    }
  });

  it('needs a session', async () => {
    const h = await authHarness();
    expect((await h.post('/idp/accounts/me/handle', { handle: 'viola' })).status).toBe(401);
  });
});

describe('a profile', () => {
  it('says who you are before you have a name', async () => {
    // An account with no handle is an ordinary state: the key exists, nobody
    // has named it. 404 would read as "you do not exist" to a client that has
    // just successfully signed in.
    const h = await authHarness();
    const alice = await h.person();
    const res = await h.get('/idp/accounts/me', await alice.token());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: alice.accountId, handle: null });
  });

  it('carries a display name and avatar once set', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const token = await alice.token();
    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, token);

    const res = await h.patch(
      '/idp/accounts/me',
      { displayName: 'Viola', avatar: 'blob-1' },
      token,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: 'Viola', avatar: 'blob-1' });
  });

  it('can have them cleared', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const token = await alice.token();
    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, token);
    await h.patch('/idp/accounts/me', { displayName: 'Viola' }, token);

    const res = await h.patch('/idp/accounts/me', { displayName: null }, token);
    expect((await res.json()) as any).not.toHaveProperty('displayName');
  });

  it('cannot be edited before a handle exists', async () => {
    const h = await authHarness();
    const alice = await h.person();
    const res = await h.patch('/idp/accounts/me', { displayName: 'Viola' }, await alice.token());
    expect(res.status).toBe(409);
  });
});

describe('resolving an address', () => {
  it('finds a local account by bare handle', async () => {
    const h = await authHarness();
    const alice = await h.person();
    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, await alice.token());

    const res = await h.get('/idp/accounts/viola');
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).id).toBe(alice.accountId);
  });

  it('finds it by full address too', async () => {
    const h = await authHarness();
    const alice = await h.person();
    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, await alice.token());
    const res = await h.get(`/idp/accounts/${encodeURIComponent(`viola@${IDP}`)}`);
    expect(((await res.json()) as any).id).toBe(alice.accountId);
  });

  it('refuses a foreign IdP rather than guessing', async () => {
    // The failure this prevents is the worst one available: treating
    // `viola@elsewhere` as the local `viola` delivers a message to the wrong
    // person with the right name.
    const h = await authHarness();
    const alice = await h.person();
    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, await alice.token());

    const res = await h.get(`/idp/accounts/${encodeURIComponent('viola@cool.town')}`);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: 'foreign_idp', idp: 'cool.town' });
  });

  it('404s a name nobody has', async () => {
    const h = await authHarness();
    expect((await h.get('/idp/accounts/nobody')).status).toBe(404);
  });

  it('is public, because a directory that needs a login is not one', async () => {
    // You have to be able to look somebody up before you know them. What is
    // exposed is exactly what `docs/03` §9 already lists as public: handle,
    // display name, avatar.
    const h = await authHarness();
    const alice = await h.person();
    await h.post('/idp/accounts/me/handle', { handle: 'viola' }, await alice.token());
    expect((await h.get('/idp/accounts/viola')).status).toBe(200);
  });
});

describe('opening a DM by name', () => {
  async function two() {
    const h = await authHarness();
    const alice = await h.person('alice');
    const bob = await h.person('bob');
    await h.post('/idp/accounts/me/handle', { handle: 'alice' }, await alice.token());
    await h.post('/idp/accounts/me/handle', { handle: 'bob' }, await bob.token());
    return { h, alice, bob };
  }

  it('works, which is the whole point of handles existing', async () => {
    const { h, alice, bob } = await two();
    const res = await h.post('/rooms/dm', { address: 'bob' }, await alice.token());
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).members.sort()).toEqual(
      [alice.accountId, bob.accountId].sort(),
    );
  });

  it('lands in the same room as opening by key', async () => {
    const { h, alice, bob } = await two();
    const byName = (await (
      await h.post('/rooms/dm', { address: 'bob' }, await alice.token())
    ).json()) as any;
    const byKey = (await (
      await h.post('/rooms/dm', { account: bob.accountId }, await alice.token())
    ).json()) as any;
    expect(byName.id).toBe(byKey.id);
  });

  it('refuses a foreign address rather than guessing', async () => {
    const { h, alice } = await two();
    const res = await h.post('/rooms/dm', { address: 'bob@cool.town' }, await alice.token());
    expect(res.status).toBe(501);
  });

  it('404s a name nobody has', async () => {
    const { h, alice } = await two();
    expect((await h.post('/rooms/dm', { address: 'nobody' }, await alice.token())).status).toBe(
      404,
    );
  });

  it('insists on exactly one of key or name', async () => {
    // Both would need a rule about which wins, and any rule is a way to think
    // you addressed a key and have addressed a name.
    const { h, alice, bob } = await two();
    const token = await alice.token();
    expect((await h.post('/rooms/dm', {}, token)).status).toBe(400);
    expect(
      (await h.post('/rooms/dm', { address: 'bob', account: bob.accountId }, token)).status,
    ).toBe(400);
  });
});
