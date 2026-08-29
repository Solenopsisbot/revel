/**
 * Does moving the crypto off the main thread actually work?
 *
 * The same workload, run twice on one page: once with the engine on the main
 * thread and once through the Worker. What we care about is not how long the
 * work takes — it takes as long as it takes either way — but **how long the
 * main thread is unable to do anything else while it happens**.
 *
 * That is measured by a loop that gets a turn every time the event loop is free
 * and records the longest it ever waited. When the main thread is blocked it
 * cannot run, so the longest gap is the longest stall a person would have felt.
 * At 60fps, anything over ~17 ms is a dropped frame.
 */

import { type CryptoEngine, Session, spawnCryptoEngine } from '@revel/crypto';
import init, { Account, Device } from '@revel/crypto-wasm';
import wasmUrl from '@revel/crypto-wasm/revel_crypto_bg.wasm?url';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const LINE = new TextEncoder().encode('the buttons need to feel pressable');

/**
 * How long the main thread goes between turns of its own event loop.
 *
 * A `MessageChannel` ping-pong rather than `setTimeout`, for two reasons. It
 * runs as fast as the loop allows instead of every 4 ms, so it catches short
 * stalls. And it is **not** subject to the background-tab timer clamp — a tab
 * that isn't painting throttles nested `setTimeout` to about once a second,
 * which the first version of this dutifully reported as a 955 ms stall during
 * the run where the main thread was doing nothing at all.
 */
function stallMeter() {
  const channel = new MessageChannel();
  let last = performance.now();
  let worst = 0;
  let stopped = false;

  channel.port1.onmessage = () => {
    if (stopped) return;
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    channel.port2.postMessage(null);
  };
  channel.port2.postMessage(null);

  return {
    /** Forget everything so far — call immediately before the measured work. */
    reset() {
      last = performance.now();
      worst = 0;
    },
    /**
     * The longest gap seen, read after giving the loop a turn.
     *
     * The yield is the whole point: a stall is only observable on the tick
     * *after* it ends, so reading synchronously after a block of blocking work
     * reports zero — which is what the first version of this did, and it looked
     * like very good news.
     */
    async settle(): Promise<number> {
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      return worst;
    },
    stop() {
      stopped = true;
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/**
 * How long to exercise each engine before measuring it.
 *
 * `docs/31` §5 learned this the hard way: V8 compiles wasm twice and swaps in
 * the optimised build on a wall clock, so a cold instance measures the baseline
 * compiler. It matters twice as much here, because the two engines are not
 * warmed equally by accident — generating the key packages tiers up the main
 * thread's module and does nothing at all for the Worker's. Without this the
 * Worker looked 4.8x slower at identical work.
 */
const WARMUP_MS = Number(new URLSearchParams(location.search).get('warm') ?? 2000);

/** Churn a small group until the clock runs out, and throw it all away. */
async function warm(run: (kps: Uint8Array[]) => Promise<void> | void, kps: Uint8Array[]) {
  const until = performance.now() + WARMUP_MS;
  while (performance.now() < until) {
    await run(kps);
  }
}

/** Key packages for `n` would-be members, generated up front and not timed. */
function keyPackages(n: number): Uint8Array[] {
  const account = new Account();
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const device = new Device(account, `d${i}`);
    out.push(device.keyPackage());
    device.free();
  }
  account.free();
  return out;
}

interface Row {
  where: string;
  work: number;
  stall: number;
  size: number;
}

/** The workload: open a group, admit everyone in one commit, send a message. */
async function throughEngine(
  engine: CryptoEngine,
  kps: Uint8Array[],
  warmKps: Uint8Array[],
  meter: ReturnType<typeof stallMeter>,
): Promise<Row> {
  await engine.open({ deviceLabel: 'laptop' });

  await warm(async (batch) => {
    await engine.createGroup('g-warm');
    await engine.stageAdd('g-warm', batch);
    await engine.commit('g-warm');
    await engine.applyPending('g-warm');
    for (let i = 0; i < 200; i++) await engine.encrypt('g-warm', LINE);
    await engine.forget('g-warm');
  }, warmKps);

  await engine.createGroup('g-bench');

  meter.reset();
  const t = performance.now();
  await engine.stageAdd('g-bench', kps);
  await engine.commit('g-bench');
  const state = await engine.applyPending('g-bench');
  await engine.encrypt('g-bench', LINE);
  const work = performance.now() - t;

  const stall = await meter.settle();
  await engine.close();
  return { where: 'Worker', work, stall, size: state.size };
}

/** The identical workload with nothing between it and the paint loop. */
async function onMainThread(
  kps: Uint8Array[],
  warmKps: Uint8Array[],
  meter: ReturnType<typeof stallMeter>,
): Promise<Row> {
  const session = new Session({ deviceLabel: 'laptop' });

  await warm((batch) => {
    session.createGroup('g-warm');
    session.stageAdd('g-warm', batch);
    session.commit('g-warm');
    session.applyPending('g-warm');
    for (let i = 0; i < 200; i++) session.encrypt('g-warm', LINE);
    session.forget('g-warm');
  }, warmKps);

  session.createGroup('g-bench');

  meter.reset();
  const t = performance.now();
  session.stageAdd('g-bench', kps);
  session.commit('g-bench');
  const state = session.applyPending('g-bench');
  session.encrypt('g-bench', LINE);
  const work = performance.now() - t;

  const stall = await meter.settle();
  session.close();
  return { where: 'Main thread', work, stall, size: state.size };
}

const ms = (v: number) => (v < 10 ? v.toFixed(1) : v.toFixed(0));
const frames = (v: number) => Math.max(0, Math.round(v / 16.7));

function render(rows: Row[]) {
  $('out').innerHTML = `
    <table>
      <thead><tr>
        <th>engine</th><th>leaves</th><th>work took</th>
        <th>longest main-thread stall</th><th>dropped frames</th>
      </tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr class="${r.where.startsWith('Worker') ? 'good' : 'bad'}">
            <td>${r.where}</td><td>${r.size}</td><td>${ms(r.work)} ms</td>
            <td><b>${ms(r.stall)} ms</b></td><td>${frames(r.stall)}</td>
          </tr>`,
        )
        .join('')}</tbody>
    </table>`;
}

async function run() {
  const button = $('run') as HTMLButtonElement;
  button.disabled = true;
  $('error').textContent = '';
  $('out').innerHTML = '<p>loading wasm on the main thread…</p>';

  try {
    const n = Number((document.getElementById('leaves') as HTMLInputElement).value) || 500;

    // The main-thread run needs the module here too, and the harness needs it
    // to generate key packages. The Worker loads its own copy.
    await init({ module_or_path: wasmUrl });

    $('out').innerHTML = `<p>generating ${n} key packages…</p>`;
    await new Promise((r) => setTimeout(r, 0));
    const kps = keyPackages(n);
    const warmKps = keyPackages(25);

    const meter = stallMeter();
    const rows: Row[] = [];

    $('out').innerHTML = `<p>warming the main thread for ${WARMUP_MS / 1000}s, then running…</p>`;
    await new Promise((r) => setTimeout(r, 30));
    rows.push(await onMainThread(kps, warmKps, meter));
    render(rows);
    await new Promise((r) => setTimeout(r, 30));

    // Two Workers, one after the other, because they do not cost the same. The
    // first one this page ever spawns is reproducibly ~5x slower at identical
    // work than the second — see the note under the table.
    for (const label of ['Worker (first)', 'Worker (second)']) {
      const engine = spawnCryptoEngine({ wasm: wasmUrl });
      $('out').innerHTML = `<p>${label}: warming for ${WARMUP_MS / 1000}s, then running…</p>`;
      rows.push({ ...(await throughEngine(engine, kps, warmKps, meter)), where: label });
      render(rows);
      await new Promise((r) => setTimeout(r, 30));
    }
    meter.stop();
    render(rows);

    (window as unknown as { __worker: Row[] }).__worker = rows;
    console.table(rows);
  } catch (e) {
    $('error').textContent = `${e}\n${(e as Error)?.stack ?? ''}`;
  } finally {
    button.disabled = false;
  }
}

$('run').addEventListener('click', run);
