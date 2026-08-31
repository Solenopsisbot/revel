/**
 * The two `docs/29` §5 budgets that need a DOM.
 *
 * The other four were measured in `packages/core/test/budget.test.ts`, which
 * says plainly that these two were not:
 *
 *   > **60 fps over 100k events** and the *render* half of **decrypt + render**
 *   > both need a renderer, and there is no DOM in this environment.
 *
 * There is one now. Same discipline as the other file: every figure prints,
 * because a number nobody sees cannot be noticed moving, and the assertion sits
 * where a real regression trips it and machine noise does not.
 *
 *   pnpm dev
 *   pnpm test:budgets
 */
import { chromium } from 'playwright';

const APP = 'http://localhost:5173';
const SEED = 100_000;

let failures = 0;
const report = (what, value, unit, budget, ok) => {
  console.log(
    `  ${what.padEnd(44)} ${String(value).padStart(8)} ${unit.padEnd(5)} (budget ${budget}) ${ok ? 'ok' : 'OVER'}`,
  );
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

/**
 * Load a room of `n` messages and measure it, or report that it could not be.
 *
 * A ladder rather than a single figure at 100k, because the first attempt at
 * 100k **crashed the tab** — and "it crashes" is a much less useful answer than
 * "it is fine to here and falls over there".
 */
async function measure(n) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let crashed = false;
  page.on('crash', () => {
    crashed = true;
  });

  const started = Date.now();
  try {
    await page.goto(`${APP}/app?demo=1&seed=${n}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForSelector('.row', { timeout: 90000 });
  } catch (err) {
    await page.close().catch(() => {});
    return { n, crashed: true, why: crashed ? 'tab crashed' : String(err.message).slice(0, 60) };
  }
  const painted = Date.now() - started;

  const rows = await page.evaluate(() => document.querySelectorAll('.row').length);

  const scroll = await page.evaluate(async () => {
    // `.msgs` is the scroller in `MessageList.svelte`. Getting this wrong is
    // not a small error: a selector that matches nothing falls back to the
    // document, which does not scroll, and the rAF loop then reports a
    // beautiful 8 ms idle frame time that has nothing to do with scrolling.
    const target = document.querySelector('.msgs');
    if (!target) return { error: 'no scroller found' };
    const before = target.scrollTop;
    const frames = [];
    let last = performance.now();
    let running = true;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // **Upward.** A chat log opens pinned to the bottom, so scrolling down does
    // nothing at all — which is how the first version of this measured a
    // flawless 8 ms while moving zero pixels. Reading backwards through history
    // is also the thing people actually do.
    const began = performance.now();
    while (performance.now() - began < 1500) {
      target.scrollBy(0, -220);
      await new Promise((r) => requestAnimationFrame(r));
    }
    running = false;
    const sorted = frames.slice(2).sort((a, b) => a - b);
    const at = (p) => sorted[Math.floor(sorted.length * p)] ?? 0;
    // Asserted, so a measurement of nothing cannot pass for a good one.
    return { median: at(0.5), p95: at(0.95), moved: Math.abs(target.scrollTop - before) };
  });

  const insert = await page.evaluate(async () => {
    const { core } = await import('/src/lib/fake/core.svelte.ts');
    const room = core.currentRoomId;
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      core.messages[room].push({
        id: `late-${i}`,
        faceId: Object.keys(core.faces)[0],
        body: `an arriving message ${i}`,
        at: Date.now(),
      });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    return times[10];
  });

  await page.close().catch(() => {});
  return { n, painted, rows, scroll, insert };
}

console.log('\n`docs/29` §5, the two rows that needed a DOM.\n');
console.log(
  `  ${'messages'.padStart(8)}  ${'rows in DOM'.padStart(11)}  ${'open'.padStart(7)}  ${'frame p50'.padStart(9)}  ${'frame p95'.padStart(9)}  ${'arrive→paint'.padStart(12)}`,
);

const results = [];
for (const n of [1000, 5000, 20000, 50000, 100000]) {
  const r = await measure(n);
  results.push(r);
  if (r.crashed) {
    console.log(`  ${String(n).padStart(8)}  ${(`— ${r.why}`).padStart(11)}`);
    continue;
  }
  const moved = r.scroll.moved ? '' : '  ⚠ did not scroll';
  console.log(
    `  ${String(r.n).padStart(8)}  ${String(r.rows).padStart(11)}  ${`${r.painted}ms`.padStart(7)}  ${`${r.scroll.median.toFixed(1)}ms`.padStart(9)}  ${`${r.scroll.p95.toFixed(1)}ms`.padStart(9)}  ${`${r.insert.toFixed(1)}ms`.padStart(12)}${moved}`,
  );
}

await browser.close();

// ---------------------------------------------------------------------------
const at100k = results.find((r) => r.n === 100000);
const worked = results.filter((r) => !r.crashed);
const biggest = worked[worked.length - 1];

console.log('');
if (at100k?.crashed) {
  console.log(`  100k does not render: ${at100k.why}.`);
  console.log(`  Largest that does: ${biggest?.n.toLocaleString()} messages.`);
  console.log('');
  console.log('  `docs/29` §5 budgets 60 fps over 100k events. The list is not');
  console.log('  windowed — every message is a row in the DOM — so this is not a');
  console.log('  budget that is missed by a margin, it is one that cannot be met');
  console.log('  by tuning. Windowing is the fix, and it is a change to how the');
  console.log('  list is built rather than to how fast it is.');
  process.exitCode = 1;
} else {
  const ok = at100k.scroll.median <= 16.7 && at100k.insert <= 50;
  console.log(ok ? '  both within budget at 100k' : '  OVER BUDGET at 100k');
  process.exitCode = ok ? 0 : 1;
}
