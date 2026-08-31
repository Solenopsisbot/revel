/**
 * Badges, marks, and the room you come back to.
 *
 * Three accounts, because the interesting case needs somebody to be looking
 * *elsewhere*: a badge is a claim about a conversation that is not on screen,
 * and with two accounts the only room either of them has is the one they are
 * in. Bob talks to Kit, Alice talks to Bob, and every assertion here is about
 * the row Bob is not reading.
 *
 * What it covers that no unit test can:
 *
 * - An unread count for a room the client has never opened. The room's state
 *   is only loaded because the sidebar asked for a number, which is the exact
 *   path that used to return zero forever.
 * - `docs/35`'s `badge` versus `dot` — a DM is about you and gets a count, a
 *   muted one gets the quiet dot and still counts unread.
 * - Reading a room clears it, and a message arriving in the room you are
 *   already looking at never badges.
 * - A reload comes back to the room you chose, not the first in the list.
 *   That one matters because looking at a room marks it read, so landing on
 *   an arbitrary DM would clear a badge for a message you never saw.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:unread
 */
import { chromium } from 'playwright';

const APP = 'http://localhost:5173';
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
/** The open MLS wasm trap (`docs/31` §32). Counted so a run says whether it hit. */
const cryptoFailures = [];

/** A signed-up account with one face, sitting in the app with the real core up. */
async function signUp(handle, face) {
  const page = await (await browser.newContext()).newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on('pageerror', (err) => pageErrors.push(`${handle}: ${String(err).slice(0, 160)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (text.includes('could not persist crypto')) cryptoFailures.push(handle);
    if (text.includes('send failed')) console.log(`  [${handle}] ${text.slice(0, 240)}`);
  });

  await page.goto(`${APP}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[type=text]', handle);
  await page.fill('input[type=password]', password);
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue')
        ?.disabled,
  );
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 60_000 });

  await page.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__revel?.live?.running ?? false)) break;
    await wait(1000);
  }
  await wait(1200);
  await page.evaluate(async (name) => {
    await window.__revel.myFaces.create(name);
    window.__revel.onboarding?.dismiss?.();
  }, face);
  return page;
}

async function openDm(page, handle) {
  await page.getByTitle('Message someone').click();
  await page.fill('input[aria-label="Who do you want to message?"]', handle);
  await page.getByRole('button', { name: 'Start' }).click();
  await wait(4000);
}

const A = `ua${stamp}`;
const B = `ub${stamp}`;
const C = `uc${stamp}`;

const alice = await signUp(A, 'Viola');
const bob = await signUp(B, 'Rae');
const kit = await signUp(C, 'Kit');

await openDm(alice, B);
await alice.evaluate(() => void window.__revel.core.send('from alice'));
await openDm(kit, B);
await kit.evaluate(() => void window.__revel.core.send('from kit'));
await wait(3000);

await bob.evaluate(async () => {
  const { live } = window.__revel;
  await live.stack.sync();
  await live.refreshRooms();
});
await wait(4000);

console.log('\ntwo conversations, one of them being read');
ok('bob has both', (await bob.evaluate(() => window.__revel.core.dms.length)) === 2);

// Bob deliberately opens Kit's, so Alice's is the one nobody is looking at.
const kitRoom = await bob.evaluate(async () => {
  const { live, core } = window.__revel;
  for (const dm of core.dms) {
    const state = await live.stack.core.conversation.open(dm.id);
    if (state.messages.some((m) => m.body === 'from kit')) {
      core.openHome(dm.id);
      return dm.id;
    }
  }
  return null;
});
await wait(3000);
ok('bob is reading kit', !!kitRoom);

const rowsFor = (k) =>
  bob.evaluate(
    (kr) =>
      window.__revel.core.dms.map((d) => ({
        reading: d.id === kr,
        unread: d.unread,
        mention: d.mention,
      })),
    k,
  );

console.log('\na conversation nobody is looking at');
// Start from a known zero. Bob's app opens a room on load and reading one
// marks it read, so without this the count depends on which conversation
// happened to be in front of him while the first messages landed.
await bob.evaluate(async () => {
  const { live, notifications, core } = window.__revel;
  for (const dm of core.dms) {
    await live.markRead(dm.id);
    notifications.clear(dm.id);
  }
});
await wait(2000);
await alice.evaluate(() => void window.__revel.core.send('one'));
await wait(1500);
await alice.evaluate(() => void window.__revel.core.send('two'));
await wait(4000);

const rows = await rowsFor(kitRoom);
ok('badges the room bob is not in', rows.find((r) => !r.reading)?.unread === 2, rows);
ok('leaves the one he is', rows.find((r) => r.reading)?.unread === undefined, rows);
ok(
  'a DM is about you, so it counts rather than dots',
  rows.find((r) => !r.reading)?.mention === true,
  rows,
);
ok(
  'the rail says something is waiting',
  await bob.evaluate(() => !!document.querySelector('[aria-label="unread"]')),
);

console.log('\nreading it');
const aliceRoom = await bob.evaluate(
  (kr) => window.__revel.core.dms.find((d) => d.id !== kr).id,
  kitRoom,
);
await bob.evaluate((r) => window.__revel.core.openHome(r), aliceRoom);
await wait(3000);
ok('clears the badge', !(await bob.evaluate(() => window.__revel.core.dms.some((d) => d.unread))));

await alice.evaluate(() => void window.__revel.core.send('three'));
await wait(7000);
ok(
  'and a message in the room on screen never badges',
  !(await bob.evaluate(() => window.__revel.core.dms.some((d) => d.unread))),
);
const rendered = await bob.evaluate(() => ({
  dom: document.body.innerText.includes('three'),
  inState: window.__revel.live.stack.rooms
    .state(window.__revel.core.currentRoomId)
    .messages.map((m) => m.body),
  showing: window.__revel.core.currentRoomId,
}));
// Same `docs/31` §32 trap, seen from the other side: when it fires during
// `send` the message never leaves, and alice's own copy sits there as failed.
// Reported rather than asserted, for the same reason as the muted case below.
const aliceSent = await alice.evaluate(() =>
  window.__revel.live.stack.rooms
    .state(window.__revel.core.currentRoomId)
    .messages.some((m) => m.body === 'three' && !m.failed),
);
if (!aliceSent) {
  console.log("  --    skipped: alice's send failed — the docs/31 §32 wasm trap");
} else {
  ok('but it does render', rendered.dom, rendered);
}

console.log('\nmuting it — `docs/35`: mute wins, always');
await bob.evaluate((r) => window.__revel.core.openHome(r), kitRoom);
await bob.evaluate(async (r) => {
  const { core, live, notifications } = window.__revel;
  core.dmsSeed.push({ id: r, kind: 'dm', withIds: [], mineIds: [], notify: 'nothing' });
  await live.markRead(r);
  notifications.clear(r);
}, aliceRoom);
await wait(2000);
await alice.evaluate(() => void window.__revel.core.send('four'));
await wait(5000);

const muted = await bob.evaluate(
  (r) => ({
    mark: window.__revel.notifications.mark(r),
    dm: window.__revel.core.dms.find((d) => d.id === r) ?? null,
    arrived: window.__revel.live.stack.rooms.state(r).messages.some((m) => m.body === 'four'),
  }),
  aliceRoom,
);
// `docs/31` §32: the MLS wasm traps on `exportGroup` after a device sends a
// silent event and then receives in the same room, and when it trips on the
// *sending* side the message never leaves. Asserting on a message that was
// never sent would turn an open crypto bug into a flaky notification test, so
// this says so instead.
if (!muted.arrived) {
  console.log('  --    skipped: "four" never arrived — the docs/31 §32 wasm trap');
} else {
  ok('a quiet dot, never a badge', muted.mark === 'dot' && muted.dm?.mention === false, muted);
  ok('and it still counts as unread', (muted.dm?.unread ?? 0) > 0, muted);
}

console.log('\ncoming back');
await bob.reload({ waitUntil: 'load' });
for (let i = 0; i < 60; i++) {
  if (await bob.evaluate(() => window.__revel?.live?.running ?? false)) break;
  await wait(1000);
}
await wait(5000);
ok(
  'reopens the room bob chose, not the first in the list',
  await bob.evaluate((k) => window.__revel.core.currentRoomId === k, kitRoom),
  await bob.evaluate(() => window.__revel.core.currentRoomId),
);

console.log(`\npage errors: ${pageErrors.length ? pageErrors.join('; ') : 'none'}`);
console.log(`crypto persist failures (docs/31 §32): ${cryptoFailures.length}`);
await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
