/**
 * The performance budgets in `docs/29` §5, measured.
 *
 * > The product claims "instant" (`05` §1). **Claims need numbers, and numbers
 * > need to be measured or they rot.**
 *
 * ## What this can and cannot be
 *
 * `docs/29` wants these "measured in CI on a fixed machine where possible", and
 * this is not a fixed machine — it is whatever the suite happens to run on,
 * under whatever else is running. So the design problem is real: **a timing
 * test that flakes gets disabled, and a disabled budget is not a budget.**
 *
 * The answer here is to separate two jobs that usually get conflated:
 *
 * 1. **Report the number.** Every measurement prints. A budget's whole purpose
 *    is that somebody notices when it moves, and a number nobody sees cannot be
 *    noticed. These are the figures that belong in `docs/31`.
 * 2. **Fail on a regression.** The assertion is set where a genuine
 *    regression — an accidental O(n²), a synchronous decrypt on the paint path,
 *    a store that stopped using its index — trips it, and machine noise does
 *    not. Where the measured value has an order of magnitude of headroom, that
 *    threshold *is* the budget. Where it does not, the comment says so.
 *
 * Two of §5's six rows are not here, because they need a renderer: **60 fps
 * scrolling over 100k events** and the render half of **decrypt + render**.
 * They are measured in `apps/web/e2e/budgets.mjs` against a real browser —
 * `pnpm test:budgets` — and their figures are summarised at the bottom of this
 * file, so "we measure §5" is now true of all six rows rather than four.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LocalCryptoEngine } from '@revel/crypto';
import init from '@revel/crypto-wasm';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addPending, IndexedDbStore, type LocalEvent, reduceAll } from '../src/index.js';
import { emptyRoom } from '../src/rooms/state.js';

const WASM = fileURLToPath(new URL('../../crypto-wasm/revel_crypto_bg.wasm', import.meta.url));
const built = existsSync(WASM);

/**
 * The median of several runs, not the mean.
 *
 * One garbage collection or one scheduler hiccup moves a mean and does not move
 * a median, and the question here is "how long does this normally take" rather
 * than "what is the worst thing that happened while measuring".
 */
async function median(runs: number, fn: () => unknown | Promise<unknown>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    await fn();
    times.push(performance.now() - started);
  }
  return times.sort((a, b) => a - b)[Math.floor(times.length / 2)] as number;
}

/** Prints so the number is visible, and returns it so it can be asserted on. */
function report(what: string, ms: number, budget: number): number {
  const verdict = ms <= budget ? 'ok' : 'OVER';
  console.log(
    `  ${what.padEnd(46)} ${ms.toFixed(1).padStart(8)} ms   (budget ${budget} ms) ${verdict}`,
  );
  return ms;
}

/** A room's worth of already-decrypted events, as the local store holds them. */
function history(roomId: string, count: number): LocalEvent[] {
  const base = 1767225600000000000n;
  return Array.from({ length: count }, (_, i) => ({
    id: String(base + BigInt(i)),
    account: i % 7 === 0 ? 'acct-bob' : 'acct-alice',
    at: 1_700_000_000_000 + i * 1000,
    payload: {
      known: true as const,
      event: {
        v: 1,
        type: 'm.message',
        body: `message number ${i}, which is about as long as a real one tends to be`,
      },
    },
  }));
}

describe('cold open, from the local store', () => {
  it('paints a room of 5,000 events well inside 300 ms', async () => {
    // `docs/29` §5's headline: cold open to last room painted, from local state
    // and without touching the network. That is `open()` — snapshot if there is
    // one, replay the log if there is not — and the replay is the slow path,
    // which is the one worth measuring.
    const store = await IndexedDbStore.open({
      factory: new IDBFactory(),
      name: `budget-cold-${Date.now()}`,
    });
    await store.putEvents('9001', history('9001', 5000));

    const ms = await median(5, async () => {
      const state = reduceAll(emptyRoom('9001'), await store.listEvents('9001'), {});
      expect(state.messages.length).toBe(5000);
    });

    report('cold open, 5,000 events, read + reduce', ms, 300);
    // The budget itself, because the headroom is real. If this trips it is an
    // accidental O(n²) in the reducer or a store that stopped using its index —
    // not a busy machine.
    expect(ms).toBeLessThan(300);
    await store.close();
    // The generous timeout covers *writing* the fixture, which is not what is
    // being measured — `fake-indexeddb` is a JavaScript shim and its bulk
    // writes are slower than a browser's. The read is the budgeted half, and
    // measuring it is what found the cursor-per-row bug in `listEvents`:
    // 5,639 ms to read 5,000 events became 13 ms.
  }, 60_000);

  it('reduces close to linearly, which is the property that matters', async () => {
    // A budget met at 5,000 and missed at 50,000 is a budget that will be
    // missed by anybody who has used the app for a year. Ratio rather than
    // absolute time, so this says something about the algorithm rather than
    // about the machine it ran on.
    //
    // **In memory, deliberately.** The reducer is where the algorithmic risk
    // lives — it is the thing doing per-event work against growing state — and
    // measuring it through `fake-indexeddb` measures the shim instead. See the
    // note below on why that is not a small distortion.
    const small = await median(5, () => reduceAll(emptyRoom('a'), history('a', 4000), {}));
    const large = await median(5, () => reduceAll(emptyRoom('b'), history('b', 32000), {}));

    const ratio = large / small;
    console.log(`  ${'8x the events costs'.padEnd(46)} ${ratio.toFixed(1).padStart(8)} x`);
    report('reduce 32,000 events', large, 300);

    // Eight times the work should cost roughly eight times as much. Twenty-four
    // is the alarm: it means something in there is super-linear, which is a
    // room that works for a month and then does not.
    expect(ratio).toBeLessThan(24);
  }, 120_000);
});

describe('the optimistic echo', () => {
  it('puts a message on screen in well under 16 ms', async () => {
    // `docs/29` §5: keypress → local echo, one frame at 60 fps. This is the one
    // budget a person can actually feel, and it is why `send` inserts before it
    // encrypts: everything after step 1 is allowed to take as long as it takes.
    let state = reduceAll(emptyRoom('9001'), history('9001', 5000), {});

    const ms = await median(200, () => {
      state = addPending(state, {
        id: 'local:x',
        account: 'acct-alice',
        at: Date.now(),
        body: 'a message somebody just typed',
        clientNonce: 'nonce-x',
      });
    });

    report('optimistic insert into a 5,000-message room', ms, 16);
    expect(ms).toBeLessThan(16);
  });
});

describe('room switch', () => {
  it('re-reads a cached room in well under 100 ms', async () => {
    // A snapshot exists, so this is the fast path: no replay, no network.
    const store = await IndexedDbStore.open({
      factory: new IDBFactory(),
      name: `budget-switch-${Date.now()}`,
    });
    const state = reduceAll(emptyRoom('9001'), history('9001', 5000), {});
    await store.putRoom(state);

    const ms = await median(10, async () => {
      const loaded = await store.getRoom('9001');
      expect(loaded?.messages.length).toBe(5000);
    });

    report('room switch, cached snapshot of 5,000', ms, 100);
    expect(ms).toBeLessThan(100);
    await store.close();
  });
});

(built ? describe : describe.skip)('MLS, through the wasm the browser runs', () => {
  it('commits to a 200-leaf group inside 500 ms', async () => {
    // `docs/29` §5's last row, and the one `docs/31` §5 already measured
    // natively — 212 ms to remove a member at 500 leaves in a browser. This is
    // the check that a change to the crypto core has not moved it, which is
    // exactly what §5 asks for: "re-run whenever the crypto core changes".
    await init({ module_or_path: readFileSync(WASM) });

    const alice = new LocalCryptoEngine();
    await alice.open({ deviceLabel: 'alice' });
    await alice.createGroup('g');

    const packages: Uint8Array[] = [];
    const others: LocalCryptoEngine[] = [];
    for (let i = 0; i < 199; i++) {
      const e = new LocalCryptoEngine();
      await e.open({ deviceLabel: `d${i}` });
      others.push(e);
      packages.push(await e.keyPackage());
    }
    await alice.stageAdd('g', packages);
    await alice.commit('g');
    await alice.applyPending('g');
    expect((await alice.state('g')).size).toBe(200);

    // An empty commit at 200 leaves: the epoch change every membership move
    // costs, without the cost of building the membership change itself.
    const ms = await median(3, async () => {
      await alice.commit('g');
      await alice.applyPending('g');
    });

    report('MLS commit + apply, 200 leaves', ms, 500);
    expect(ms).toBeLessThan(500);

    await alice.close();
    for (const e of others) await e.close();
  }, 120_000);

  it('encrypts a message in the flat time the design depends on', async () => {
    // `docs/31` §2: "sending is flat at ~50 µs regardless of group size". That
    // flatness is load-bearing — it is why the group-size ceiling is a
    // bandwidth question rather than a CPU one — so it is worth a guard.
    await init({ module_or_path: readFileSync(WASM) });

    const alice = new LocalCryptoEngine();
    await alice.open({ deviceLabel: 'alice' });
    await alice.createGroup('flat');

    const body = new TextEncoder().encode('a message of an ordinary sort of length');
    const ms = await median(500, () => alice.encrypt('flat', body));

    report('MLS encrypt, one message', ms, 5);
    expect(ms).toBeLessThan(5);
    await alice.close();
  }, 60_000);
});

describe('what is not measured here', () => {
  it('says so, rather than leaving a gap that looks like a pass', () => {
    // Two of `docs/29` §5's six rows need a renderer and there is no DOM in
    // this environment: **60 fps over 100k events**, and **decrypt + render an
    // incoming message** — the decrypt half is covered above and the render
    // half is not. `docs/33` calls the reference page the visual check, and
    // that is where these belong.
    //
    // Written as a test so the omission is in the same list as the budgets and
    // cannot quietly become "we measure §5".
    // **Measured now**, in `apps/web/e2e/budgets.mjs`, against a real browser.
    // Kept here as a pointer rather than deleted, because "we measure §5" should
    // say where — and because what it found is worth knowing before anybody
    // reads the four figures above and assumes the whole table is green:
    //
    //   * 100,000 messages open in **0.96 s** and scroll at a steady 8.3 ms
    //     frame — 60 fps, with 150 rows in the DOM rather than 100,000;
    //   * an arriving message paints in **16.6 ms at any room size**, flat,
    //     against a 50 ms budget.
    //
    // Both were badly over before (`docs/31` §31): 20,000 crashed the tab, and
    // an arriving message took 5.4 s in a room of 5,000.
    const elsewhere = ['message list scroll, 100k events, 60 fps', 'decrypt + render, < 50 ms'];
    expect(elsewhere).toHaveLength(2);
  });
});
