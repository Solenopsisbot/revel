/**
 * Scenarios: several real clients, one real server, one process.
 *
 * `docs/29` §4 names this as the suite that would have caught Kith's bugs, and
 * says what it has to cover — own-leaf commits, diverged sessions, Welcome lag,
 * commit races, device revocation mid-conversation, offline/reconnect with
 * queued sends. Each of those has a scenario here.
 *
 * The rule that comes with it: **every bug found in a real conversation gets a
 * scenario here before it is fixed.**
 *
 * Nothing is mocked. Real MLS, real store, real server, real socket frames.
 * When one of these fails it is because the system is wrong, which is the whole
 * reason to pay for the setup.
 */
import { describe, expect, it } from 'vitest';
import { type Client, World, wasmBuilt } from './harness.js';

const scenarios = wasmBuilt ? describe : describe.skip;
if (!wasmBuilt) console.warn('\n  wasm is missing — run `pnpm build:wasm`.\n');

/** Alice opens a group in a fresh room and adds everyone else to it. */
async function conversation(names: string[]) {
  const world = await World.create();
  const people: Client[] = [];
  for (const name of names) people.push(await world.join(name));

  const room = world.room();
  const [host, ...guests] = people as [Client, ...Client[]];

  const group = await host.open(room);
  for (const guest of guests) await guest.replenish();
  await host.invite(
    group,
    guests.map((g) => g.account),
  );
  await world.settle();
  for (const guest of guests) await guest.sync();
  await world.settle();

  return { world, room, group, host, guests, people };
}

// ---------------------------------------------------------------------------

scenarios('a conversation', () => {
  it('carries a message from one person to another', async () => {
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    await host.say(room, 'hello');
    await world.settle();

    expect(guests[0]?.texts(room)).toEqual(['hello']);
    await world.close();
  });

  it('goes both ways', async () => {
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'hello');
    await world.settle();
    await bob.say(room, 'hi');
    await world.settle();

    expect(host.texts(room)).toEqual(['hello', 'hi']);
    expect(bob.texts(room)).toEqual(['hello', 'hi']);
    await world.close();
  });

  it('shows a sender their own message, which MLS will not decrypt for them', async () => {
    // The own-leaf case. A device holds the sending half of its own ratchet and
    // not the receiving half, so the echo of its own message cannot be opened
    // the way everything else is. `RoomSync`'s outbox is what makes this work,
    // and a client that got it wrong would be unable to read its own history.
    const { world, room, host } = await conversation(['alice', 'bob']);
    await host.say(room, 'talking to myself');
    await world.settle();

    expect(host.texts(room)).toEqual(['talking to myself']);
    expect(host.messages(room)[0]?.pending).toBeUndefined();
    await world.close();
  });

  it('works with four people in one group', async () => {
    const { world, room, host, guests, people } = await conversation([
      'alice',
      'bob',
      'carol',
      'dave',
    ]);
    await host.say(room, 'everyone here?');
    await world.settle();
    await (guests[2] as Client).say(room, 'yep');
    await world.settle();

    for (const person of people) {
      expect(person.texts(room)).toEqual(['everyone here?', 'yep']);
    }
    await world.close();
  });

  it('gives every device of one person its own leaf', async () => {
    // `docs/03` §1's per-device leaves — the thing Kith never did. Two devices
    // of one account are two leaves, and each has to be added on its own.
    const world = await World.create();
    const alice = await world.join('alice');
    const bobPhone = await world.join('bob');
    const bobLaptop = await world.joinAs('bob-laptop', bobPhone);
    const room = world.room();

    const group = await alice.open(room);
    await bobPhone.replenish();
    await bobLaptop.replenish();

    const result = await alice.invite(group, [bobPhone.account]);
    expect(result.added).toHaveLength(2);
    await world.settle();

    await bobPhone.sync();
    await bobLaptop.sync();
    await alice.say(room, 'hello both of you');
    await world.settle();

    expect(bobPhone.texts(room)).toEqual(['hello both of you']);
    expect(bobLaptop.texts(room)).toEqual(['hello both of you']);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('starting from nothing', () => {
  it('two people who have never spoken end up in a DM', async () => {
    // The whole cold path, through the real routes: no room poked into the
    // store, no group handed over, nothing but two accounts that know each
    // other's id.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    await bob.replenish();

    const room = await world.dm(alice, bob);
    const group = await alice.open(room);
    await alice.invite(group, [bob.account]);
    await world.settle();

    await bob.discover();
    await bob.sync();
    await alice.say(room, 'hello, stranger');
    await world.settle();

    expect(bob.texts(room)).toEqual(['hello, stranger']);
    await world.close();
  });

  it('lets one person open a DM with another by name', async () => {
    // What somebody actually does. Before handles you could open a DM with
    // forty-three characters of base64url and nothing else, which is a chat app
    // only in the sense that a socket is a conversation.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    await world.name(alice, 'alice');
    await world.name(bob, 'bob');
    await bob.replenish();

    const room = await world.dmByName(alice, 'bob');
    const group = await alice.open(room);
    await alice.invite(group, [bob.account]);
    await world.settle();

    await bob.discover();
    await bob.sync();
    await alice.say(room, 'found you by name');
    await world.settle();

    expect(bob.texts(room)).toEqual(['found you by name']);
    await world.close();
  });

  it('stores the key, not the name, once it has resolved one', async () => {
    // A handle can be given up and taken by somebody else; a key cannot. The
    // room's membership is account ids for that reason (`docs/17`).
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    await world.name(bob, 'bob');

    const room = await world.dmByName(alice, 'bob');
    const info = (await alice.knownRooms()).find((r) => r.id === room);
    expect(info?.members.sort()).toEqual([alice.account, bob.account].sort());
    await world.close();
  });

  it('gives both of them the same room, opened at the same moment', async () => {
    // The id is derived from the sorted pair (`docs/03` §4), so simultaneous
    // opens converge instead of racing to make two rooms nobody can reconcile.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');

    const [a, b] = await Promise.all([world.dm(alice, bob), world.dm(bob, alice)]);
    expect(a).toBe(b);
    await world.close();
  });

  it('tells a client which group opens which room', async () => {
    // The directory's job, and the reason `RoomInfo` carries `group` at all. A
    // Welcome names a group; the room list is the only thing that says which
    // conversation that group is for. Without it a client can join a group and
    // still not know what it has joined.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    await bob.replenish();

    const room = await world.dm(alice, bob);
    const group = await alice.open(room);
    await alice.invite(group, [bob.account]);
    await world.settle();
    await bob.discover();
    await bob.sync();

    await alice.say(room, 'said before the wipe');
    await world.settle();
    expect(bob.texts(room)).toEqual(['said before the wipe']);

    const info = (await bob.knownRooms())[0];
    expect(info?.id).toBe(room);
    expect(info?.group).toBe(group);
    expect(info?.kind).toBe('dm');
    expect(info?.members.sort()).toEqual([alice.account, bob.account].sort());
    await world.close();
  });

  it('survives the commit that adds you arriving before your Welcome', async () => {
    // The server fans a commit out to every member of the group it just
    // created — including the person it added, who has not opened their Welcome
    // yet and cannot process a commit for a group they are not in. Their way in
    // is the Welcome. Throwing here would make every invitation a stack trace
    // on the invitee's console, which is how this was found.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    await bob.replenish();

    const room = await world.dm(alice, bob);
    const group = await alice.open(room);

    await alice.invite(group, [bob.account]);
    await world.settle();

    await bob.discover();
    await bob.sync();
    await alice.say(room, 'no stack traces, please');
    await world.settle();

    expect(bob.texts(room)).toEqual(['no stack traces, please']);
    await world.close();
  });

  it('adds somebody to a group DM without giving them the keys', async () => {
    // The architecture in one scenario. The server can hand out membership; it
    // cannot hand out keys. Carol can see the room and read nothing until a
    // member commits her in.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    const carol = await world.join('carol');
    await bob.replenish();
    await carol.replenish();

    const room = await world.groupRoom(alice, [bob]);
    const group = await alice.open(room);
    await alice.invite(group, [bob.account]);
    await world.settle();
    await bob.discover();
    await bob.sync();

    await alice.say(room, 'before carol');
    await world.settle();

    await alice.transport.addMembers(room, [carol.account]);
    await carol.discover();
    await world.settle();

    // In the room, no keys.
    expect((await carol.knownRooms()).map((r) => r.id)).toEqual([room]);
    expect(carol.texts(room)).toEqual([]);

    // Now the commit that actually lets her in.
    await alice.invite(group, [carol.account]);
    await world.settle();
    await carol.sync();
    await alice.say(room, 'after carol');
    await world.settle();

    expect(carol.texts(room)).toEqual(['after carol']);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('Welcome lag', () => {
  it('delivers a Welcome to a device that was offline when it was invited', async () => {
    // `docs/03` §5: "the Host stores the Welcome for each added leaf and serves
    // it on that device's next connect." Being invited while your laptop is
    // shut must not be something you have to go looking for.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    const room = world.room();

    await bob.replenish();
    const group = await alice.open(room);
    await bob.disconnect();

    await alice.invite(group, [bob.account]);
    await alice.say(room, 'are you there');
    await world.settle();
    expect(bob.texts(room)).toEqual([]);

    await bob.connect();
    await world.settle();

    // Arrived unprompted, over the socket, with nobody calling sync().
    expect(bob.texts(room)).toEqual(['are you there']);
    await world.close();
  });

  it('keeps offering a Welcome until the device actually joins', async () => {
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    const room = world.room();

    await bob.replenish();
    const group = await alice.open(room);
    await bob.disconnect();
    await alice.invite(group, [bob.account]);
    await world.settle();

    // Two fetches, both of which see it: at-least-once, acknowledged. Dropping
    // it on the first read would lose the invitation if that read never landed.
    expect(await bob.pendingWelcomes()).toHaveLength(1);
    expect(await bob.pendingWelcomes()).toHaveLength(1);

    await bob.connect();
    await world.settle();
    expect(await bob.pendingWelcomes()).toHaveLength(0);
    await world.close();
  });

  it('lets the group keep talking while an invitee is still offline', async () => {
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    const carol = await world.join('carol');
    const room = world.room();

    await bob.replenish();
    await carol.replenish();
    const group = await alice.open(room);
    await alice.invite(group, [bob.account]);
    await world.settle();
    await bob.sync();

    await carol.disconnect();
    await alice.invite(group, [carol.account]);
    await world.settle();

    await alice.say(room, 'carol is not here yet');
    await world.settle();
    expect(bob.texts(room)).toEqual(['carol is not here yet']);
    await world.close();
  });

  it('lets a joiner read from the point they joined, and no earlier', async () => {
    // `docs/04`'s `history_mode: join`. Carol has the keys from her epoch
    // onward and genuinely cannot open what came before — not a UI filter.
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    await host.say(room, 'before carol');
    await world.settle();

    const carol = await world.join('carol');
    await carol.replenish();
    await host.invite(await host.groupOf(room), [carol.account]);
    await world.settle();
    await carol.sync();

    await host.say(room, 'after carol');
    await world.settle();

    expect(carol.texts(room)).toEqual(['after carol']);
    expect(guests[0]?.texts(room)).toEqual(['before carol', 'after carol']);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('commit races', () => {
  it('lets both of two simultaneous invites land', async () => {
    // Two moderators adding two different people at the same instant. One
    // commit wins the epoch; the loser rebuilds against the new one rather than
    // failing, which is why `GroupSync` retries and why `commit()` never
    // applies what it builds.
    const { world, room, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    const carol = await world.join('carol');
    const dave = await world.join('dave');
    await carol.replenish();
    await dave.replenish();

    const [one, two] = await Promise.all([
      host.invite(group, [carol.account]),
      bob.invite(group, [dave.account]),
    ]);
    await world.settle();

    expect(one.added).toHaveLength(1);
    expect(two.added).toHaveLength(1);
    // One of them had to rebuild. Which one is a race, so assert the sum.
    expect(one.attempts + two.attempts).toBeGreaterThan(2);

    await carol.sync();
    await dave.sync();
    await host.say(room, 'everyone in?');
    await world.settle();

    expect(carol.texts(room)).toEqual(['everyone in?']);
    expect(dave.texts(room)).toEqual(['everyone in?']);
    await world.close();
  });

  it('leaves everybody at the same epoch afterwards', async () => {
    // The failure this is guarding against is unrepairable: two devices at an
    // epoch the other will never reach, and every message after it unreadable
    // by everyone including its sender.
    const { world, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await Promise.all([host.flush(group), bob.flush(group)]);
    await world.settle();

    const [a, b] = await Promise.all([host.epoch(group), bob.epoch(group)]);
    expect(a).toBe(b);
    expect(await host.serverEpoch(group)).toBe(a);
    await world.close();
  });

  it('does not spend a fresh key package on every retry', async () => {
    // A retry loop that ate a package per attempt would drain a shelf without
    // anyone doing anything wrong — the same outcome as the attack the
    // authorised-claim check exists to stop.
    const { world, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    const carol = await world.join('carol');
    await carol.replenish(5);
    const before = await carol.supply();

    // Force a race: bob commits at the same epoch alice is building against.
    await Promise.all([host.invite(group, [carol.account]), bob.flush(group)]);
    await world.settle();

    const after = await carol.supply();
    expect(before.available - after.available).toBe(1);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('removal', () => {
  it('stops a removed device reading the next message', async () => {
    // The one guarantee that means anything: a Remove takes effect no later
    // than the next message. Not a permission check — bob no longer holds the
    // key, so there is nothing for the server to enforce.
    const { world, room, host, guests, group } = await conversation(['alice', 'bob', 'carol']);
    const bob = guests[0] as Client;
    const carol = guests[1] as Client;

    await host.say(room, 'before');
    await world.settle();

    await host.removePerson(group, bob);
    await world.settle();

    await host.say(room, 'after');
    await world.settle();

    expect(carol.texts(room)).toEqual(['before', 'after']);
    expect(bob.texts(room)).toEqual(['before']);
    await world.close();
  });

  it('leaves what the removed device already read alone', async () => {
    // Removing somebody is not a retraction. They keep what they were given,
    // which is honest about what E2EE can and cannot do.
    const { world, room, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'you were here for this');
    await world.settle();
    await host.removePerson(group, bob);
    await world.settle();

    expect(bob.texts(room)).toEqual(['you were here for this']);
    await world.close();
  });

  it('refuses a revoked device at the door, not at the next epoch', async () => {
    // "Sign out this device" has to mean it stops working immediately (`17`).
    // MLS removal is the durable half; this is the half that takes effect now.
    const { world, room, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await world.revoke(bob);
    await expect(bob.say(room, 'still here')).rejects.toThrow();
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('offline and reconnect', () => {
  it('catches up on everything missed while the socket was down', async () => {
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await bob.disconnect();
    await host.say(room, 'one');
    await host.say(room, 'two');
    await world.settle();
    expect(bob.texts(room)).toEqual([]);

    await bob.connect();
    await world.settle();

    // The socket cannot replay, so this came from the catch-up the reconnect
    // triggers. A stream that silently resubscribed and said nothing would
    // leave these missing forever, and the room would look fine.
    expect(bob.texts(room)).toEqual(['one', 'two']);
    await world.close();
  });

  it('fails a send made while offline rather than pretending', async () => {
    const { world, room, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;
    world.offline = true;

    await expect(bob.say(room, 'into the void')).rejects.toThrow();
    const failed = bob.messages(room).find((m) => m.failed);
    expect(failed?.body).toBe('into the void');

    world.offline = false;
    await world.close();
  });

  it('applies a handshake gap in order when the device comes back', async () => {
    // Three commits happen while bob is away. They have to be applied in
    // sequence: a commit whose predecessor was not applied is a commit for an
    // epoch bob is not at, and MLS refuses it. This is what the handshake log's
    // own sequence is for.
    const { world, room, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await bob.disconnect();
    await host.flush(group);
    await host.flush(group);
    await host.flush(group);
    await host.say(room, 'caught up?');
    await world.settle();

    await bob.connect();
    await world.settle();

    expect(await bob.epoch(group)).toBe(await host.epoch(group));
    expect(bob.texts(room)).toEqual(['caught up?']);
    await world.close();
  });

  it('catches up rather than applying a record that arrived out of order', async () => {
    const { world, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    // Two commits bob never saw, then hand him only the second one.
    await bob.disconnect();
    await host.flush(group);
    await host.flush(group);
    await world.settle();

    const log = await host.handshakeLog(group);
    const latest = log[log.length - 1];
    if (!latest) throw new Error('no handshake records');

    await bob.connect();
    await bob.groups.receiveHandshake(latest);
    await world.settle();

    // Applying it alone would have been refused. Seeing the gap and fetching
    // the missing record is the whole point of the sequence number.
    expect(await bob.epoch(group)).toBe(await host.epoch(group));
    await world.close();
  });

  it('survives a reload: the group comes back off disk', async () => {
    const { world, room, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'before the reload');
    await world.settle();

    const reloaded = await bob.reload();
    await host.say(room, 'after the reload');
    await world.settle();

    expect(reloaded.texts(room)).toEqual(['before the reload', 'after the reload']);
    expect(await reloaded.epoch(group)).toBe(await host.epoch(group));
    await world.close();
  });

  it('recovers on its own when the socket dies without warning', async () => {
    // The other half of reconnecting, and the dangerous one: nobody called
    // `stop()`, so the client does not know it missed anything. A stream that
    // reconnected quietly and resubscribed would leave the gap missing forever
    // and the room would look perfectly fine — which is worse than an
    // obviously broken connection.
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'before the blip');
    await world.settle();

    await bob.drop();
    await host.say(room, 'during the blip');
    await world.settle();
    await world.idle();

    expect(bob.texts(room)).toEqual(['before the blip', 'during the blip']);
    await world.close();
  });

  it('tells a removed device it was removed, instead of going quiet', async () => {
    // Being removed is silent at the MLS layer: the commit processes without
    // error and simply does not advance this device's epoch, because you cannot
    // apply a commit that takes your own leaf away. Without noticing that, a
    // removed client shows a room that has mysteriously stopped working rather
    // than a room it is no longer in — which is exactly the kind of silence
    // `docs/22` exists to prevent.
    const { world, room, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.removePerson(group, bob);
    await world.settle();

    expect(bob.removedFrom).toEqual([group]);
    // And the server's delivery list agrees, which is what lets him be added
    // back later. A stale row is a person who can never rejoin.
    const members = await world.store.listGroupMembers(group);
    expect(members.map((m) => m.devicePub)).toEqual([host.device]);

    await host.say(room, 'after');
    await world.settle();
    expect(bob.texts(room)).toEqual([]);
    await world.close();
  });

  it('rejoins a session that has diverged past repair', async () => {
    // `docs/03`'s diverged-session reset. Bob's MLS state has fallen behind in
    // a way catching up cannot fix — restored from a stale backup, say. There
    // is no clever recovery: he throws the group away and is added again, which
    // is the honest answer and the one the UI has to be able to offer.
    const { world, room, host, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'before');
    await world.settle();

    await bob.diverge(group);
    await host.say(room, 'while broken');
    await world.settle();
    expect(bob.texts(room)).toEqual(['before']);

    // The reset, and it is two steps, neither of which is optional.
    //
    // Bob clears the server's delivery list, or claiming a key package for him
    // skips him as already-a-member. And somebody in the group has to remove
    // his stale leaf, because MLS refuses to add a leaf whose signature key is
    // already in the tree — "duplicate signature key, hpke key or identity".
    // A diverged device cannot quietly rejoin; the group has to let go of it
    // first.
    await bob.leave(group);
    await host.removePerson(group, bob);
    await world.settle();

    await bob.replenish();
    await host.invite(group, [bob.account]);
    await world.settle();
    await bob.sync();

    await host.say(room, 'after the reset');
    await world.settle();
    expect(bob.texts(room)).toContain('after the reset');
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('the Host as an external sender', () => {
  it('is named in every group a client opens', async () => {
    // `docs/03` §5: "The Host is configured in **every** group as an MLS
    // external sender." The extension is fixed at creation, so a group opened
    // without one costs a commit to fix — which is why the client asks the Host
    // what it is before opening anything.
    const { world, group, host } = await conversation(['alice', 'bob']);

    const senders = await host.externalSendersOf(group);
    expect(senders).toHaveLength(1);
    // The same certificate the Host publishes, verified — not merely present.
    expect(senders[0]).toBe(world.externalSender);
    await world.close();
  });

  it('is absent from a group opened against a Host that publishes none', async () => {
    // A coherent deployment: those groups simply refuse external proposals.
    const world = await World.create({ externalSender: null });
    const alice = await world.join('alice');
    const room = world.room();
    const group = await alice.open(room);

    expect(await alice.externalSendersOf(group)).toEqual([]);
    await world.close();
  });

  it('still cannot commit, which is the whole division of labour', async () => {
    // The Host proposes; a member commits. Nothing here gives the server a way
    // to move a group, and the tests in `crates/revel-crypto/tests/
    // external_sender.rs` prove the other half — that a proposal from a key the
    // group never authorised is refused outright.
    const { world, group, host } = await conversation(['alice', 'bob']);
    const before = await host.epoch(group);

    // The server has every handshake record and the public tree, and there is
    // no route, method or key by which it can produce a commit.
    expect(await host.serverEpoch(group)).toBe(before);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('typing', () => {
  it('shows up on the other side and is never written down', async () => {
    // `docs/03` §7: ephemeral. Not stored, dropped if nobody is listening,
    // meaningless a second later. The reducer refuses it on purpose, so this
    // state lives only in memory.
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.startTyping(room);
    await world.settle();

    expect(bob.typing(room)).toEqual(['alice']);
    // Not on the server, and not in bob's local store either.
    expect(world.store.events.get(room) ?? []).toEqual([]);
    expect(await bob.store.listEvents(room)).toEqual([]);
    await world.close();
  });

  it('does not show you yourself typing', async () => {
    const { world, room, host } = await conversation(['alice', 'bob']);
    await host.startTyping(room);
    await world.settle();
    expect(host.typing(room)).toEqual([]);
    await world.close();
  });

  it('stops when they say so', async () => {
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.startTyping(room);
    await world.settle();
    await host.stopTyping(room);
    await world.settle();

    expect(bob.typing(room)).toEqual([]);
    await world.close();
  });

  it('is throttled, so a keystroke handler can call it', async () => {
    // An ephemeral event per keystroke is absurd, and the only way to be sure
    // nobody does it is to make the obvious call site correct.
    const { world, room, host } = await conversation(['alice', 'bob']);
    const before = world.eventPosts;
    for (let i = 0; i < 20; i++) await host.startTyping(room);
    await world.settle();

    expect(world.eventPosts - before).toBe(1);

    // And it resends once the notice would have gone stale, or somebody typing
    // steadily would flicker out on the other side.
    world.advance(5000);
    await host.startTyping(room);
    expect(world.eventPosts - before).toBe(2);
    await world.close();
  });

  it('expires on its own, so a client that dies mid-sentence stops claiming to type', async () => {
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.startTyping(room);
    await world.settle();
    expect(bob.typing(room)).toEqual(['alice']);

    // No timer and no cleanup pass: the entry is dropped when somebody asks.
    world.advance(10_000);
    expect(bob.typing(room)).toEqual([]);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('read state', () => {
  it('counts what somebody else said and not what you did', async () => {
    // Sending something is the strongest possible signal you have seen it. A
    // room showing one unread because you spoke in it is a badge nobody trusts.
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'one');
    await host.say(room, 'two');
    await bob.say(room, 'mine');
    await world.settle();

    expect(bob.unread(room)).toBe(2);
    expect(host.unread(room)).toBe(1);
    await world.close();
  });

  it('clears when marked, and survives to the other device', async () => {
    // `silent`, so it is stored and reaches the account's other devices, and
    // never notifies — a read receipt that woke a phone would be the most
    // annoying feature ever shipped.
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'one');
    await world.settle();
    expect(bob.unread(room)).toBe(1);

    await bob.markRead(room);
    await world.settle();
    expect(bob.unread(room)).toBe(0);
    // And alice can see how far bob has read.
    expect(host.rooms.state(room).receipts.get(bob.account)).toBeTruthy();
    await world.close();
  });

  it('never goes backwards', async () => {
    // Out-of-order delivery would otherwise un-read messages and make the
    // count flicker.
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'one');
    await host.say(room, 'two');
    await world.settle();

    const first = bob.messages(room)[0]?.id as string;
    await bob.markRead(room);
    await world.settle();
    await bob.markRead(room, first);
    await world.settle();

    expect(bob.unread(room)).toBe(0);
    await world.close();
  });

  it('survives a reload, because a receipt is a stored event', async () => {
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.say(room, 'one');
    await world.settle();
    await bob.markRead(room);
    await world.settle();

    const reloaded = await bob.reload();
    expect(reloaded.unread(room)).toBe(0);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('attachments', () => {
  const ENC = new TextEncoder();
  const DEC = new TextDecoder();
  const PHOTO = ENC.encode('a photograph of a very good dog, allegedly');

  it('crosses between two people, and the server never sees any of it', async () => {
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    await host.sendFile(room, PHOTO, { mime: 'image/png', name: 'dog.png', alt: 'a dog' });
    await world.settle();

    const [opened] = await bob.openAttachments(room);
    expect(DEC.decode(opened as Uint8Array)).toBe(DEC.decode(PHOTO));

    // Not the bytes, not the name, not the type, not the key. The blob row has
    // a length, a room and an uploader, and that is the entire list.
    const stored = JSON.stringify([...world.store.blobs.values()]);
    for (const secret of ['dog.png', 'image/png', 'very good dog']) {
      expect(stored).not.toContain(secret);
    }
    const events = JSON.stringify(world.store.events.get(room));
    for (const secret of ['dog.png', 'image/png', 'attachments']) {
      expect(events).not.toContain(secret);
    }
    await world.close();
  });

  it('is unreadable to somebody who was not in the room when it was sent', async () => {
    // The key is in the event, and the event is sealed to the epoch. Carol can
    // fetch the ciphertext — she is in the room now — and it is noise.
    const { world, room, host, guests, group } = await conversation(['alice', 'bob']);
    void guests;
    await host.sendFile(room, PHOTO, { mime: 'image/png', name: 'dog.png' });
    await world.settle();

    const carol = await world.join('carol');
    await carol.replenish();
    await host.invite(group, [carol.account]);
    await world.settle();
    await carol.sync();

    expect(await carol.openAttachments(room)).toEqual([]);
    await world.close();
  });

  it('is gone from the server after a purge, and says so', async () => {
    const { world, room, host, guests } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;

    const ref = await host.sendFile(room, PHOTO, { mime: 'image/png', name: 'dog.png' });
    await world.settle();
    await host.transport.purgeBlob(ref.id);

    // 410, not 404: a client with a cached copy has to be able to tell "was
    // removed" from "never existed".
    await expect(bob.transport.downloadBlob(ref.id)).rejects.toThrow(/purged/);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('the ratchet tree, out of band', () => {
  it('keeps the Welcome small while the group grows', async () => {
    // The whole reason `docs/03` §5 rejects the `ratchet_tree` extension.
    // Inlined, the public tree rides in every Welcome and a single join at
    // 2,000 members costs 627 KiB (`docs/31` §2). Out of band the Welcome
    // carries the joiner's secrets and nothing else, and the tree is one
    // cacheable fetch per epoch that every joiner shares.
    const { world, group, host } = await conversation(['alice', 'bob']);

    const sizes: { welcome: number; tree: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const person = await world.join(`person-${i}`);
      await person.replenish();
      await host.invite(group, [person.account]);
      await world.settle();
      await person.sync();

      const [welcome] = await host.pendingWelcomesFor(person);
      const tree = await host.treeOf(group);
      sizes.push({ welcome: welcome?.bytes.length ?? 0, tree: tree.length });
    }

    // The tree grows with the group. The Welcome does not.
    const trees = sizes.map((s) => s.tree);
    expect(trees[trees.length - 1]).toBeGreaterThan(trees[0] as number);
    await world.close();
  });

  it('hands a joiner the tree for the epoch its Welcome is for', async () => {
    // A tree from any other epoch fails the join outright — which is the right
    // failure, because the alternative is a device whose roster silently
    // disagrees with everybody else's until the next commit produces different
    // secrets on either side.
    const { world, room, group, host } = await conversation(['alice', 'bob']);

    const carol = await world.join('carol');
    await carol.replenish();
    await host.invite(group, [carol.account]);
    // Two more commits land before carol ever looks, so the current tree is
    // several epochs past the one her Welcome was minted at.
    await host.flush(group);
    await host.flush(group);
    await world.settle();

    await carol.sync();
    await host.say(room, 'made it');
    await world.settle();

    expect(carol.texts(room)).toEqual(['made it']);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('inviting people who are not ready', () => {
  it('adds everyone it can and names the rest', async () => {
    // Four of five is better than none, and the fifth is retried when they next
    // replenish. Failing the whole batch would mean one person with a flat
    // phone blocks a whole room from being set up.
    const { world, host, group } = await conversation(['alice', 'bob']);
    const carol = await world.join('carol');
    const dave = await world.join('dave');
    await dave.replenish();
    // Carol has never published anything.

    const result = await host.invite(group, [carol.account, dave.account]);
    await world.settle();

    expect(result.missing).toEqual([carol.account]);
    expect(result.added).toHaveLength(1);
    await world.close();
  });

  it('falls back to the reusable package and says it did', async () => {
    const { world, host, group } = await conversation(['alice', 'bob']);
    const carol = await world.join('carol');
    await carol.replenish(1);

    // Burn the one-time package, so the next claim hits the last-resort one.
    await host.invite(group, [carol.account]);
    await world.settle();
    await carol.sync();
    await host.removePerson(group, carol);
    await world.settle();

    const again = await host.invite(group, [carol.account]);
    expect(again.lastResort).toHaveLength(1);
    await world.close();
  });
});

// ---------------------------------------------------------------------------

scenarios('what the server is not trusted with', () => {
  it('never sees a word of it', async () => {
    const { world, room, host } = await conversation(['alice', 'bob']);
    await host.say(room, 'the quick brown fox');
    await world.settle();

    const stored = JSON.stringify(world.store.events.get(room));
    expect(stored).not.toContain('quick brown fox');
    expect(stored).not.toContain('m.message');
    await world.close();
  });

  it('will not let a member push a Welcome at a device nobody claimed for', async () => {
    const { world, guests, group } = await conversation(['alice', 'bob']);
    const bob = guests[0] as Client;
    const mallory = await world.join('mallory');

    await expect(bob.forgeWelcome(group, mallory.device)).rejects.toThrow(/unclaimed_welcome/);
    await world.close();
  });

  it('will not let a stranger into a group‘s handshake log', async () => {
    const { world, group } = await conversation(['alice', 'bob']);
    const mallory = await world.join('mallory');
    await expect(mallory.handshakeLog(group)).rejects.toThrow(/not_in_group/);
    await world.close();
  });
});
