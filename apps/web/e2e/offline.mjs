/**
 * Unplug the network mid-conversation.
 *
 * `docs/06` phase 2's exit condition, verbatim: "Unplug the network
 * mid-conversation; nothing is lost or duplicated." The harness covers the
 * shape of this, but only a browser has the thing that actually breaks — a
 * real socket that drops, a real IndexedDB, and a person looking at a row
 * wondering whether their message went.
 *
 * Three things it has to get right, and the third is the one that was missing:
 *
 * - Messages sent to you while you were gone arrive when you come back.
 * - They arrive **once**. A catch-up that overlaps what the socket already
 *   pushed is the normal case, not the exception.
 * - A message *you* sent while offline is not silently stranded. It fails
 *   honestly, says so, and can be sent again — and sending it again does not
 *   produce two.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:offline
 */
import { chromium } from 'playwright';

// Defaults to the dev server; point it at a deployment to test the real thing.
//
//   REVEL_E2E_APP=https://revel.chat pnpm test:offline
//
// Against production the rate limits are real (`REVEL_RATE_SCALE` is unset
// there, as it must be), so a suite that signs up three accounts in a minute
// will be throttled rather than broken.
const APP = process.env.REVEL_E2E_APP ?? 'http://localhost:5173';
const password = 'correct horse battery staple';
const stamp = Date.now().toString(36);

let failures = 0;
const ok = (label, cond, extra) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) {
    failures++;
    if (extra !== undefined) console.log(`        ${JSON.stringify(extra).slice(0, 300)}`);
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageErrors = [];

async function signUp(handle, face) {
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => pageErrors.push(`${handle}: ${String(err).slice(0, 160)}`));

  await page.goto(`${APP}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[type=text]', handle);
  await page.fill('input[type=password]', password);
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue')
        ?.disabled,
  );
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 90_000 });

  await page.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => window.__revel?.live?.running ?? false)) break;
    await wait(1000);
  }
  await wait(1500);
  await page.evaluate(async (name) => {
    await window.__revel.myFaces.create(name);
    window.__revel.onboarding?.dismiss?.();
  }, face);
  return { page, context };
}

const A = `oa${stamp}`;
const B = `ob${stamp}`;
const alice = await signUp(A, 'Viola');
const bob = await signUp(B, 'Rae');

await alice.page.getByTitle('Message someone').click();
await alice.page.fill('input[aria-label="Who do you want to message?"]', B);
await alice.page.getByRole('button', { name: 'Start' }).click();
await wait(5000);
await alice.page.evaluate(() => void window.__revel.core.send('before the outage'));
await wait(4000);
await bob.page.evaluate(async () => {
  const { live, core } = window.__revel;
  await live.stack.sync();
  await live.refreshRooms();
  if (core.dms[0]) core.openHome(core.dms[0].id);
});
await wait(5000);

const bodies = (p) =>
  p.evaluate(() =>
    window.__revel.live.stack.rooms
      .state(window.__revel.core.currentRoomId)
      .messages.map((m) => m.body),
  );

ok('bob is in the conversation', (await bodies(bob.page)).includes('before the outage'));

// ---------------------------------------------------------------------------
console.log('\nthe network goes away');
await bob.context.setOffline(true);
await wait(2000);

// Alice keeps talking to a bob who cannot hear her.
for (const line of ['while you were away 1', 'while you were away 2', 'while you were away 3']) {
  await alice.page.evaluate((t) => void window.__revel.core.send(t), line);
  await wait(900);
}
await wait(3000);
ok(
  'bob heard none of it',
  !(await bodies(bob.page)).some((b) => b?.startsWith('while you were away')),
);

// And bob tries to say something into the void.
await bob.page.evaluate(() => void window.__revel.core.send('did this send?'));
await wait(6000);
const stranded = await bob.page.evaluate(() =>
  window.__revel.live.stack.rooms
    .state(window.__revel.core.currentRoomId)
    .messages.filter((m) => m.failed)
    .map((m) => m.body),
);
ok(
  'his own message is marked failed, not left pretending',
  stranded.includes('did this send?'),
  stranded,
);
ok(
  'and the row says so rather than promising it will go on its own',
  await bob.page.evaluate(() => document.body.innerText.includes("Didn't send")),
);
ok(
  'and it is still his own face on it, not Unknown',
  // One of *his* faces, whichever he is speaking as — every account starts
  // with a profile made from its handle, so the created face is not
  // automatically the one that speaks.
  await bob.page.evaluate(() => {
    const { core, live } = window.__revel;
    const stuck = live.stack.rooms.state(core.currentRoomId).messages.find((m) => m.failed);
    const mine = core.myFaces.map((f) => f.name);
    return !!stuck?.face?.name && mine.includes(stuck.face.name);
  }),
  await bob.page.evaluate(
    () =>
      window.__revel.live.stack.rooms
        .state(window.__revel.core.currentRoomId)
        .messages.find((m) => m.failed)?.face ?? null,
  ),
);

// ---------------------------------------------------------------------------
console.log('\nthe network comes back');
await bob.context.setOffline(false);
await bob.page.evaluate(async () => {
  // A reconnect is what a real client waits for; nudging it keeps the test
  // about delivery rather than about backoff timing.
  await window.__revel.live.stack.sync();
});
await wait(8000);

const back = await bodies(bob.page);
ok(
  'everything he missed arrived',
  ['1', '2', '3'].every((n) => back.includes(`while you were away ${n}`)),
  back,
);
ok(
  'exactly once each',
  back.filter((b) => b?.startsWith('while you were away')).length === 3,
  back,
);

// ---------------------------------------------------------------------------
console.log('\nand the message that failed can be sent');
await bob.page.evaluate(async () => {
  const { core, live } = window.__revel;
  const failed = live.stack.rooms.state(core.currentRoomId).messages.find((m) => m.failed);
  await core.retrySend({ clientNonce: failed?.clientNonce });
});
await wait(6000);

const after = await bodies(bob.page);
ok('it went', after.includes('did this send?'), after);
ok('once', after.filter((b) => b === 'did this send?').length === 1, after);
ok(
  'and nothing is still failed',
  !(await bob.page.evaluate(() =>
    window.__revel.live.stack.rooms
      .state(window.__revel.core.currentRoomId)
      .messages.some((m) => m.failed || m.pending),
  )),
);
await wait(4000);
ok('alice received it', (await bodies(alice.page)).includes('did this send?'));

console.log(`\npage errors: ${pageErrors.length ? pageErrors.join('; ') : 'none'}`);
await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
