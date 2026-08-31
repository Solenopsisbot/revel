/**
 * The notification rules, wired to a real client.
 *
 * `notify.test.ts` tests `decide` as a function. This tests that the function
 * is actually *reached* — that a message travelling through MLS, a server, a
 * socket and a reducer produces the decision `docs/35` says it should.
 *
 * The distinction earned its keep the day it was written: the rules engine had
 * been specified, implemented, documented and tested for a day with **no
 * callers at all**. A pure function nothing calls passes every test it has.
 */
import { describe, expect, it } from 'vitest';
import { World, wasmBuilt } from './harness.js';

const scenarios = wasmBuilt ? describe : describe.skip;

/** Two people in one room, both synced. */
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

  bob.notified.length = 0;
  return { world, alice, bob, room };
}

scenarios('a message arriving at a real client', () => {
  it('produces a decision, with the rule that fired', async () => {
    const { world, alice, bob, room } = await pair();

    await alice.say(room, 'the pub at seven');
    await world.settle();

    const decided = bob.notified.filter((n) => n.room === room);
    expect(decided).toHaveLength(1);
    expect(decided[0]?.decision).toMatchObject({
      notify: true,
      mark: 'badge',
      rule: 'everything',
    });
    expect(decided[0]?.decision.because).toBe('this room notifies for everything');
    await world.close();
  });

  it('never tells you about your own message', async () => {
    // The rule is account-level, and this is the path where that matters: the
    // sender reduces its own event on the way through.
    const { world, alice, room } = await pair();
    alice.notified.length = 0;

    await alice.say(room, 'talking to myself');
    await world.settle();

    for (const n of alice.notified) expect(n.decision.notify).toBe(false);
    await world.close();
  });

  it('honours a mute against a real message', async () => {
    const { world, alice, bob, room } = await pair();
    bob.notifySettings = { default: 'everything', rooms: { [room]: 'nothing' } };

    await alice.say(room, 'chatter');
    await world.settle();

    const decided = bob.notified.filter((n) => n.room === room);
    expect(decided[0]?.decision).toMatchObject({ notify: false, mark: 'dot', rule: 'muted' });
    await world.close();
  });

  it('resolves a reply to you from room state, not from the payload', async () => {
    // `Candidate.replyTo` is the *author* of the replied-to message, and the
    // payload only carries the message id. The engine looks the author up in
    // the room it already has — this is the test that the lookup happens and
    // finds the right person.
    const { world, alice, bob, room } = await pair();
    bob.notifySettings = { default: 'mentions' };

    await bob.say(room, 'anybody know the postgres flag');
    await world.settle();
    const mine = bob.messages(room).find((m) => m.body?.includes('postgres'));
    if (!mine) throw new Error('bob message not found');

    bob.notified.length = 0;
    await alice.reply(room, mine.id, 'it is --wait');
    await world.settle();

    const decided = bob.notified.filter((n) => n.room === room);
    expect(decided[0]?.decision).toMatchObject({ notify: true, rule: 'reply' });
    await world.close();
  });

  it('does not fire a reply rule for a reply to somebody else', async () => {
    const { world, alice, bob, room } = await pair();
    bob.notifySettings = { default: 'mentions' };

    await alice.say(room, 'a question');
    await world.settle();
    const theirs = bob.messages(room).find((m) => m.body === 'a question');
    if (!theirs) throw new Error('alice message not found');

    bob.notified.length = 0;
    await alice.reply(room, theirs.id, 'answering myself');
    await world.settle();

    const decided = bob.notified.filter((n) => n.room === room);
    expect(decided[0]?.decision.rule).toBe('mentions-only');
    expect(decided[0]?.decision.notify).toBe(false);
    await world.close();
  });

  it('notifies on a real mention in a mentions-only room', async () => {
    // The headline rule, end to end, and the one that exercises the fix that
    // made `mentions` an `AccountId`: the engine matches this against the
    // reading account, so a client putting a *face* id here would produce
    // silence and no error.
    const { world, alice, bob, room } = await pair();
    bob.notifySettings = { default: 'mentions' };

    await alice.mention(room, [bob.account], 'viola, the build is red');
    await world.settle();

    const decided = bob.notified.filter((n) => n.room === room);
    expect(decided[0]?.decision).toMatchObject({ notify: true, rule: 'mention' });
    expect(decided[0]?.decision.because).toBe('you were mentioned');
    await world.close();
  });

  it('stays quiet when the mention names somebody else', async () => {
    const { world, alice, bob, room } = await pair();
    bob.notifySettings = { default: 'mentions' };

    await alice.mention(room, [alice.account], 'note to self');
    await world.settle();

    const decided = bob.notified.filter((n) => n.room === room);
    expect(decided[0]?.decision).toMatchObject({ notify: false, rule: 'mentions-only' });
    await world.close();
  });

  it('suppresses everything under DND, and still marks it', async () => {
    const { world, alice, bob, room } = await pair();
    bob.notifySettings = { default: 'everything', dnd: true };

    await alice.say(room, 'it is 3am');
    await world.settle();

    const decided = bob.notified.filter((n) => n.room === room);
    expect(decided[0]?.decision).toMatchObject({ notify: false, mark: 'badge', rule: 'dnd' });
    await world.close();
  });

  it('says nothing at all about a room the directory has not loaded', async () => {
    // A missing `place` suppresses rather than guesses. A wrong `kind` would
    // turn a DM into a space room and silently downgrade it to the global
    // default, which is the failure nobody would ever trace back to here.
    const { world, alice, bob, room } = await pair();
    bob.notifyPlaces.set(room, null);

    await alice.say(room, 'into the void');
    await world.settle();

    expect(bob.notified.filter((n) => n.room === room)).toHaveLength(0);
    await world.close();
  });
});
