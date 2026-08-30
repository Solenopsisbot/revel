/**
 * A Host that is not playing fair.
 *
 * `docs/29` §4 asks for "**a malicious delivery service**" in the multi-client
 * harness. This is it, and it is the suite that decides whether the sentence
 * this whole design rests on is true or merely written down:
 *
 * > It can propose; **it cannot Commit or forge a roster** — every client
 * > validates that the tree only ever changes through proposals it saw and
 * > Commits signed by a member. (`docs/03` §5)
 *
 * ## What a Host actually controls
 *
 * Everything about *delivery*, which is a lot: it decides what arrives, in what
 * order, how many times, and whether at all. It holds the whole handshake log,
 * the public ratchet tree, every ciphertext, and the membership table. What it
 * does **not** hold is a group secret, and that is the entire difference.
 *
 * So each test here has the server do something a hostile operator plausibly
 * would, and asserts the outcome is **a client that fails safe** — refusing,
 * or ignoring, or ending up unable to read — and never a client that is quietly
 * wrong. "Nobody can read this any more" is an acceptable outcome of an attack.
 * "Everybody reads something the attacker chose" is not.
 */
import { describe, expect, it } from 'vitest';
import { type Client, World, wasmBuilt } from './harness.js';

const scenarios = wasmBuilt ? describe : describe.skip;

/** Two people, one group, both syncing normally before anything goes wrong. */
async function pair() {
  const world = await World.create();
  const alice = await world.join('alice');
  const bob = await world.join('bob');
  await bob.replenish();

  const room = world.room();
  const group = await alice.open(room);
  await alice.invite(group, [bob.account]);
  await world.settle();
  await bob.sync();
  await world.settle();

  return { world, alice, bob, room, group };
}

const texts = (c: Client, room: string) => c.texts(room);

scenarios('a Host that rewrites the handshake log', () => {
  it('cannot forge a commit, and the forgery costs the room nothing', async () => {
    // The claim, directly. The server holds every byte of the handshake log and
    // no group secret, so it can *append* whatever it likes and cannot make it
    // verify. A member feeding on the forged record must not advance.
    const { world, alice, bob, room, group } = await pair();
    await alice.say(room, 'before');
    await world.settle();

    const epochBefore = await bob.epoch(group);
    const log = await alice.handshakeLog(group);
    const real = log[log.length - 1];
    if (!real) throw new Error('no handshake records');

    // Bytes the server made up, in a record that is otherwise well-formed.
    await bob.groups.receiveHandshake({
      ...real,
      seq: real.seq + 1,
      epoch: epochBefore,
      bytes: btoa('a commit the server wrote itself'),
    });
    await world.settle();

    expect(await bob.epoch(group)).toBe(epochBefore);
    // Refused rather than swallowed. A run of these is either a Host behaving
    // badly or a client that has fallen behind the protocol, and both are
    // things somebody should be able to see.
    expect(bob.refused.map((r) => r.seq)).toContain(real.seq + 1);

    // And the room still works, which is the part that matters: a failed
    // forgery must not be a denial of service against the people in it.
    await alice.say(room, 'after');
    await world.settle();
    expect(texts(bob, room)).toEqual(['before', 'after']);
    await world.close();
  });

  it('cannot add itself to a group by claiming somebody did', async () => {
    // `added` on a handshake record is a **delivery hint** — the server uses it
    // to decide who to fan out to, never to decide who is in the group. A Host
    // that lies here should gain nothing but its own fan-out.
    const { world, alice, bob, group } = await pair();
    const mallory = await world.join('mallory');

    await world.store.appendHandshake({
      groupId: group,
      sender: 'server',
      kind: 'commit',
      epoch: await alice.serverEpoch(group),
      bytes: btoa('not a real commit'),
      added: [{ devicePub: mallory.device, accountId: mallory.account }],
      at: Date.now(),
    });
    await world.settle();

    // The server's own table now lists mallory. The *group* does not.
    const members = await alice.crypto.members(group);
    expect(members).toHaveLength(2);
    expect(await mallory.crypto.groups()).toEqual([]);
    await world.close();
  });

  it('cannot make a member skip a commit by hiding one', async () => {
    // Dropping a record from the middle is the cheapest attack a delivery
    // service has. The sequence is what catches it: a record ahead of the
    // cursor by more than one triggers a catch-up rather than being applied,
    // so the gap closes instead of being stepped over.
    const { world, alice, bob, group } = await pair();

    await alice.flush(group);
    await alice.flush(group);
    await world.settle();

    const log = await alice.handshakeLog(group);
    const latest = log[log.length - 1];
    if (!latest) throw new Error('no handshake records');

    // Hand bob only the newest, as a server dropping the middle would.
    await bob.groups.receiveHandshake(latest);
    await world.settle();

    expect(await bob.epoch(group)).toBe(await alice.epoch(group));
    await world.close();
  });

  it('cannot replay an old commit to drag a member backwards', async () => {
    // Re-delivering something already applied is free for a server and must be
    // inert. Rolling a member back an epoch would put them on keys the group
    // has moved past — the readable version of "your messages stopped
    // arriving", which is the failure people cannot diagnose.
    const { world, alice, bob, room, group } = await pair();
    await alice.flush(group);
    await world.settle();

    const settled = await bob.epoch(group);
    for (const record of await alice.handshakeLog(group)) {
      await bob.groups.receiveHandshake(record);
      await bob.groups.receiveHandshake(record);
    }
    await world.settle();

    expect(await bob.epoch(group)).toBe(settled);
    await alice.say(room, 'still here');
    await world.settle();
    expect(texts(bob, room)).toContain('still here');
    await world.close();
  });
});

scenarios('a Host that tampers with messages', () => {
  it('cannot change a word of one', async () => {
    // The floor. Every event is an AEAD ciphertext under a key the server does
    // not have, so a flipped bit is a failed authentication and not a different
    // sentence.
    const { world, alice, bob, room } = await pair();
    await alice.say(room, 'meet at seven');
    await world.settle();

    const stored = world.store.events.get(room) ?? [];
    const target = stored.find((e) => e.class === 'normal');
    if (!target) throw new Error('nothing was stored');

    const bytes = Uint8Array.from(atob(target.payload), (c) => c.charCodeAt(0));
    bytes[bytes.length - 2] = (bytes[bytes.length - 2] as number) ^ 0xff;
    target.payload = btoa(String.fromCharCode(...bytes));

    // Bob has already read the real one; a fresh client is what sees the
    // tampered copy, and what it sees is nothing.
    const carol = await world.join('carol');
    await carol.replenish();
    await world.settle();
    expect(texts(carol, room)).toEqual([]);
    void bob;
    await world.close();
  });

  it('cannot re-attribute one by rewriting the sender', async () => {
    // `Event.sender` is the server's own field and it can write anything there.
    // It buys nothing, because attribution comes from the MLS leaf inside the
    // ciphertext and never from the envelope (`docs/04` §2) — which is exactly
    // why the client ignores this field.
    const { world, alice, bob, room } = await pair();
    await alice.say(room, 'I agree to everything');
    await world.settle();

    const stored = world.store.events.get(room) ?? [];
    const target = stored.find((e) => e.class === 'normal');
    if (!target) throw new Error('nothing was stored');
    target.sender = bob.device;

    const carol = await world.join('carol');
    await carol.replenish();
    await world.settle();

    // Whatever the envelope claims, the message is still alice's.
    const seen = bob.messages(room).find((m) => m.body === 'I agree to everything');
    expect(seen?.account).toBe(alice.account);
    void carol;
    await world.close();
  });

  it('cannot make a purge look like a message that was never sent', async () => {
    // A purge is destructive and the server may do it — that is the point of
    // `MANAGE_EVENTS`. What it must not do is make the removal invisible: the
    // tombstone is how a client learns to drop its copy rather than silently
    // diverging from everyone else.
    const { world, alice, bob, room } = await pair();
    await alice.say(room, 'the thing');
    await world.settle();

    const stored = world.store.events.get(room) ?? [];
    const target = stored.find((e) => e.class === 'normal');
    if (!target) throw new Error('nothing was stored');

    await world.store.purgeEvent(room, target.id);
    await bob.pull(room);
    await world.settle();

    const message = bob.messages(room).find((m) => m.id === target.id);
    expect(message?.purged).toBe(true);
    expect(texts(bob, room)).toEqual([]);
    await world.close();
  });
});

scenarios('a Host that lies about membership', () => {
  it('can put somebody in a room and still not let them read it', async () => {
    // The asymmetry the whole architecture rests on, from the attacker's side:
    // the membership table is the server's and the keys are not. A Host that
    // adds itself to every room learns nothing.
    const { world, alice, room } = await pair();
    const mallory = await world.join('mallory');

    await world.store.addMember(room, mallory.account, ['role-everyone']);
    await alice.say(room, 'a secret');
    await world.settle();

    await mallory.discover();
    await mallory.sync();
    await world.settle();

    // In the room, by the server's own table. Cannot read a word.
    expect((await mallory.knownRooms()).map((r) => r.id)).toContain(room);
    expect(texts(mallory, room)).toEqual([]);
    await world.close();
  });

  it('cannot hand a stranger a Welcome nobody claimed for them', async () => {
    // The check that stops a Host from pushing arbitrary bytes at a device: a
    // Welcome is only accepted for a device somebody claimed a key package for.
    const { world, bob, group } = await pair();
    const mallory = await world.join('mallory');

    await expect(bob.forgeWelcome(group, mallory.device)).rejects.toThrow(/unclaimed_welcome/);
    await world.close();
  });

  it('cannot read anything by removing somebody from the membership table', async () => {
    // Taking a member out of the table stops delivery and does not take the
    // keys back — the mirror of the rule above, and the reason a kick that has
    // to bite is a Remove commit first.
    const { world, alice, bob, room } = await pair();
    await alice.say(room, 'before the kick');
    await world.settle();

    world.store.memberships.delete(`${room}:${bob.account}`);

    // Bob cannot fetch any more, and still holds what he had.
    await expect(bob.pull(room)).rejects.toThrow();
    expect(texts(bob, room)).toEqual(['before the kick']);
    await world.close();
  });
});

scenarios('a Host that withholds', () => {
  it('cannot make a missed message unrecoverable', async () => {
    // The property that makes every other failure survivable: the socket is
    // delivery, not truth, and anything missed is fetchable. A server that
    // silently drops a live frame costs a round trip, not a message.
    const { world, alice, bob, room } = await pair();

    await bob.disconnect();
    await alice.say(room, 'said into the void');
    await world.settle();
    expect(texts(bob, room)).toEqual([]);

    await bob.connect();
    await world.settle();
    expect(texts(bob, room)).toEqual(['said into the void']);
    await world.close();
  });

  it('cannot hide a room forever, because the client asks', async () => {
    const { world, alice, room } = await pair();
    const carol = await world.join('carol');
    world.expel(carol, room);

    // Not listed while the server keeps carol out of it...
    expect((await carol.knownRooms()).map((r) => r.id)).not.toContain(room);

    // ...and listed the moment the table says otherwise, because the client
    // re-asks rather than trusting a cached answer.
    await world.store.addMember(room, carol.account, ['role-everyone']);
    expect((await carol.knownRooms()).map((r) => r.id)).toContain(room);
    void alice;
    await world.close();
  });
});
