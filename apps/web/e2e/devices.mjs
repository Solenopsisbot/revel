/**
 * Two devices, one account.
 *
 * `docs/06` phase 2's exit condition asks for "two devices each", and until
 * now that was true only in the sense that pairing worked. The second device
 * signed in, saw the room list, and could not read a word or send one:
 * `no group … in this session (holding: none)`.
 *
 * The reason is the architecture, not a bug in it. `docs/03` §1 gives every
 * device its own MLS leaf, and a leaf can only be added by a device already
 * inside the group — so a device that pairs later needs one of its siblings to
 * commit it in. Nothing did that. `syncGroups` now does, on every sync, which
 * is cheap because the claim endpoint already skips devices that are in the
 * group: one request that comes back empty and commits nothing.
 *
 * What this does **not** assert is that the new device can read history from
 * before it joined. It cannot, and that is the property working: MLS keys move
 * forward, and a device that was not in the group at an epoch never had them.
 * There is an assertion for that below, so nobody later mistakes it for a bug.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:devices
 */
import { chromium } from 'playwright';
import { password } from './_password.mjs';

// Defaults to the dev server; point it at a deployment to test the real thing.
//
//   REVEL_E2E_APP=https://revel.chat pnpm test:offline
//
// Against production the rate limits are real (`REVEL_RATE_SCALE` is unset
// there, as it must be), so a suite that signs up three accounts in a minute
// will be throttled rather than broken.
const APP = process.env.REVEL_E2E_APP ?? 'http://localhost:5173';
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
const problems = [];

function watch(page, who) {
  page.on('pageerror', (err) => problems.push(`${who}: ${String(err).slice(0, 150)}`));
  page.on('console', (m) => {
    const text = m.text();
    if (/no group|send failed/i.test(text)) problems.push(`${who}: ${text.slice(0, 120)}`);
  });
}

/** A signed-up account, in its own context so it has its own device store. */
async function signUp(handle, face) {
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  watch(page, handle);
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
  await openApp(page);
  await page.evaluate(async (name) => {
    await window.__revel.myFaces.create(name);
    window.__revel.onboarding?.dismiss?.();
  }, face);
  return { page, context };
}

async function openApp(page, openFirstRoom = false) {
  await page.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => window.__revel?.live?.running ?? false)) break;
    await wait(1000);
  }
  await wait(2000);
  // `/app` lands on home now, deliberately: any automatic open marks a room
  // read. A person clicks the conversation; a test has to as well.
  if (openFirstRoom) {
    await page.evaluate(() => {
      const { core } = window.__revel;
      if (core.dms[0]) core.openHome(core.dms[0].id);
    });
    await wait(2500);
  }
}

const A = `da${stamp}`;
const B = `db${stamp}`;
const alice = await signUp(A, 'Viola');
const bob = await signUp(B, 'Rae');

await alice.page.getByTitle('Start a conversation').click();
await alice.page.getByRole('menuitem', { name: 'Message someone' }).click();
await alice.page.fill('input[aria-label="Who do you want to message?"]', B);
await alice.page.getByRole('button', { name: 'Start', exact: true }).click();
await wait(5000);
await alice.page.evaluate(() => void window.__revel.core.send('said before the second device'));
await wait(4000);
await bob.page.evaluate(async () => {
  const { live, core } = window.__revel;
  await live.stack.sync();
  await live.refreshRooms();
  if (core.dms[0]) core.openHome(core.dms[0].id);
});
await wait(5000);
ok(
  'the conversation is running on one device',
  await bob.page.evaluate(() => document.body.innerText.includes('said before the second device')),
);

const account = await alice.page.evaluate(() => window.__revel.session.current?.accountPub);

// ---------------------------------------------------------------------------
console.log('\npairing a second device');
const second = await browser.newContext();
const two = await second.newPage({ viewport: { width: 1280, height: 800 } });
watch(two, 'device two');
await two.goto(`${APP}/signin?step=scan`, { waitUntil: 'networkidle' });

const link = await two.evaluate(async () => {
  for (let i = 0; i < 40; i++) {
    const found = [...document.querySelectorAll('*')]
      .map((e) => e.textContent || '')
      .find((t) => t.trim().startsWith('revel://add?'));
    if (found) return found.trim();
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
});
ok('the new device shows a pairing code', !!link);

// The first device approves. `/add-device` is its own route, so this navigates
// away from the app — which is why adoption cannot happen here and has to
// happen on the next sync.
await alice.page.goto(`${APP}/add-device`, { waitUntil: 'load' });
await wait(2000);
await alice.page.fill('input', link);
await alice.page.getByRole('button', { name: 'Continue' }).click();
await wait(1500);
await alice.page.getByRole('button', { name: /They match/ }).click();
await wait(9000);

ok('it signed itself in', (await two.evaluate(() => location.pathname)).startsWith('/app'));
await openApp(two);
ok(
  'as the same account',
  (await two.evaluate(() => window.__revel.session.current?.accountPub)) === account,
);
ok(
  'and it can see the conversation',
  (await two.evaluate(() => window.__revel.core.dms.length)) === 1,
);
ok(
  'but is not in the group yet',
  (await two.evaluate(async () => (await window.__revel.live.stack.crypto.groups()).length)) === 0,
);

// ---------------------------------------------------------------------------
console.log('\nthe first device adopts it');
await openApp(alice.page, true);
await alice.page.evaluate(async () => {
  await window.__revel.live.stack.sync();
});
await wait(8000);
await two.evaluate(async () => {
  const { live, core } = window.__revel;
  await live.stack.sync();
  await live.refreshRooms();
  if (core.dms[0]) core.openHome(core.dms[0].id);
});
await wait(8000);

ok(
  'the second device is in the group',
  (await two.evaluate(async () => (await window.__revel.live.stack.crypto.groups()).length)) === 1,
);
ok(
  'and cannot read what was said before it joined',
  !(await two.evaluate(() => document.body.innerText.includes('said before the second device'))),
);

// ---------------------------------------------------------------------------
console.log('\nboth devices, one conversation');
await bob.page.evaluate(() => void window.__revel.core.send('can you both hear me'));
await wait(8000);
ok(
  'the second device hears it',
  await two.evaluate(() => document.body.innerText.includes('can you both hear me')),
);
ok(
  'and so does the first',
  await alice.page.evaluate(() => document.body.innerText.includes('can you both hear me')),
);

await two.evaluate(() => void window.__revel.core.send('sent from the second device'));
await wait(8000);
ok(
  'the second device can send',
  await bob.page.evaluate(() => document.body.innerText.includes('sent from the second device')),
);

await alice.page.evaluate(() => void window.__revel.core.send('and the first one still works'));
await wait(8000);
ok(
  'and adding a leaf did not break the first',
  await bob.page.evaluate(() => document.body.innerText.includes('and the first one still works')),
);

console.log(`\nproblems: ${problems.length ? problems.slice(0, 4).join('; ') : 'none'}`);
await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
