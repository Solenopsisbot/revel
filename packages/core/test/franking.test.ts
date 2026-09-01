/**
 * Message franking, through the real crypto (`docs/03` §9).
 *
 * `packages/protocol/test/franking.test.ts` proves the primitive. This proves
 * the wiring, which is the part that can silently not happen: the key has to
 * survive being encrypted, decrypted and reduced, and the commitment has to
 * reach the Host and be stored — and if either quietly does not, a report
 * queue looks fine and verifies nothing.
 */
import { fromBase64, verifyFranking } from '@revel/protocol';
import { describe, expect, it } from 'vitest';
import { World, wasmBuilt } from './harness.js';

const scenarios = wasmBuilt ? describe : describe.skip;

scenarios('franking', () => {
  it('lets a member prove what was said, and stops them inventing it', async () => {
    // `docs/03` §9, end to end and through the real crypto. This is the whole
    // reason a report queue can be trusted: the value a moderator checks
    // against comes from the *Host*, and the reporter never controlled it.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    await bob.replenish();
    await world.settle();

    const room = await alice.core.directory.openDm({ account: bob.account });
    await world.settle();
    await alice.core.conversation.send(room.id, 'something worth reporting');
    await world.settle();
    await bob.sync();
    await world.settle();

    // What the Host is holding. It cannot open this and did not choose it.
    const stored = (world.store.events.get(room.id) ?? []).filter((e) => e.commitment);
    expect(stored).toHaveLength(1);
    const claimed = stored[0]!.commitment as string;

    // What bob — an ordinary member, not the sender — holds after decrypting.
    // The key travelled inside the ciphertext, which is what lets *any* member
    // report rather than only the person who sent it.
    const message = bob.rooms.state(room.id).messages.at(-1)!;
    expect(message.body).toBe('something worth reporting');
    expect(message.frank).toBeTruthy();

    // A report is the plaintext plus the key. Reconstructed exactly as it was
    // encrypted, which is the one definition both ends can agree on.
    const said = {
      v: 1,
      type: 'm.message',
      body: message.body,
      face: message.face,
      frank: message.frank,
    };
    const key = fromBase64(message.frank as string);
    const plaintext = new TextEncoder().encode(JSON.stringify(said));
    expect(await verifyFranking(key, plaintext, claimed)).toBe(true);

    // And the thing that makes the queue worth having: he cannot substitute a
    // message that was never sent.
    const forged = new TextEncoder().encode(
      JSON.stringify({ ...said, body: 'something much worse' }),
    );
    expect(await verifyFranking(key, forged, claimed)).toBe(false);
    await world.close();
  });

  it('franks messages and nothing else', async () => {
    // A receipt, a typing notice, a roster announcement — none of them is a
    // thing anybody reports, and 32 bytes on each is permanent overhead.
    const world = await World.create();
    const alice = await world.join('alice');
    const bob = await world.join('bob');
    await bob.replenish();
    await world.settle();

    const room = await alice.core.directory.openDm({ account: bob.account });
    await world.settle();
    await alice.core.conversation.send(room.id, 'hello');
    await alice.core.conversation.markRead(room.id);
    await world.settle();

    const events = world.store.events.get(room.id) ?? [];
    const franked = events.filter((e) => e.commitment);
    expect(franked).toHaveLength(1);
    expect(events.length).toBeGreaterThan(franked.length);
    await world.close();
  });
});
