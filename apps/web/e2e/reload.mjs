/**
 * A reload lands where you were, and asks for nothing that does not exist.
 *
 * `docs/19`: "Links are shareable, the back button works, and refreshing lands
 * you where you were." Two ways that was false at once, and they compounded:
 *
 * - `applyUrl` ran at init, when a signed-in client's room list has not arrived
 *   yet, so `?dm=<id>` matched nothing. Then `syncUrl` wrote the empty location
 *   over the address bar — so a reload both failed to reopen the conversation
 *   *and* deleted the link that would have.
 * - `core.currentRoomId` is `''` with nothing open, and it was being passed
 *   through as a room id. That registered a socket subscription for `''`, and
 *   every reconnect asked for `/rooms//events`, forever, once per reconnect.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:reload
 */
import { chromium } from 'playwright';
import { password } from './_password.mjs';

const APP = process.env.REVEL_E2E_APP ?? 'http://localhost:5173';
const stamp = Date.now().toString(36);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (label, cond, extra) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) {
    failures++;
    if (extra !== undefined) console.log(`        ${JSON.stringify(extra).slice(0, 300)}`);
  }
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const bad = [];

async function signUp(handle) {
  const page = await (await browser.newContext()).newPage({
    viewport: { width: 1200, height: 860 },
  });
  page.on('response', (r) => {
    // The shape of the bug: a room id that is not there at all.
    if (new URL(r.url()).pathname.includes('//events')) bad.push(r.url());
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
  await page.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 90_000 });
  await open(page);
  return page;
}

async function open(page, path = '/app?e2e=1') {
  await page.goto(`${APP}${path}`, { waitUntil: 'load' });
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__revel?.live?.loaded ?? false)) break;
    await wait(500);
  }
  await wait(1200);
}

console.log('\ntwo accounts and a conversation between them');
const alice = await signUp(`rl${stamp}`);
const bob = await signUp(`rm${stamp}`);
const them = await bob.evaluate(() => window.__revel.live.stack.account);

const dm = await alice.evaluate(async (peer) => {
  const room = await window.__revel.live.stack.core.directory.openDm({ account: peer });
  window.__revel.core.openHome(room.id);
  return room.id;
}, them);
await wait(2500);
ok('a DM exists and is open', !!dm);
ok('and the address bar says so', alice.url().includes(`dm=${dm}`), alice.url());

console.log('\nreloading it');
await open(alice, `/app?e2e=1&dm=${dm}`);
ok(
  'the address bar still points at the conversation',
  alice.url().includes(`dm=${dm}`),
  alice.url(),
);
ok(
  'and the app is actually in it, not merely claiming to be',
  (await alice.evaluate(() => window.__revel.core.currentRoomId)) === dm,
  await alice.evaluate(() => window.__revel.core.currentRoomId),
);

console.log('\nand a link to a room that is gone');
await open(alice, '/app?e2e=1&dm=1234567890123456789');
ok(
  'gives up rather than pinning the address bar to it',
  !alice.url().includes('1234567890123456789'),
  alice.url(),
);

console.log('\nand nothing ever asked for a room with no id');
ok('no /rooms//events', bad.length === 0, bad.slice(0, 3));

console.log('');
console.log(failures ? `${failures} failed\n` : 'all passed\n');
await browser.close();
process.exit(failures ? 1 : 0);
