/**
 * A real message, rendered by the real UI.
 *
 * `test:live` proved the core works in a browser by reading its API. This
 * proves the *seam*: `conversation.svelte.ts` is what every component reads
 * through, and when a signed-in device is running the real core it has to hand
 * back real messages in the shape those components expect.
 *
 * It is also the last gap in `docs/29` §5's "decrypt + render" — the decrypt
 * half was measured natively, and the render half needed a message that had
 * actually been decrypted rather than a fixture.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:livechat
 */
import { chromium } from 'playwright';

const APP = 'http://localhost:5173';
const stamp = Date.now().toString(36);
const password = 'correct horse battery staple';

let failures = 0;
const ok = (label, cond, extra) => {
  console.log(
    `${cond ? '  ok  ' : ' FAIL '} ${label}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 200)}` : ''}`,
  );
  if (!cond) failures++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function signUp(handle) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`      [${handle}] ${m.text().slice(0, 200)}`);
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
  await page.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 60000 });

  // Into the app, which restores the session, loads the faces and starts the
  // real core — the ordinary path, not a test-only one.
  // `?e2e=1` publishes the *app's own* singletons. Importing them by URL gets a
  // different module instance — Vite serves `.ts` and `.js` as separate records
  // — which looks identical, accepts writes, and renders nothing.
  await page.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });

  for (let i = 0; i < 60; i++) {
    const state = await page.evaluate(() => ({
      running: window.__revel?.live?.running ?? false,
      error: window.__revel?.live?.error ?? '',
    }));
    if (state.running) break;
    if (state.error) throw new Error(`${handle}: the core did not start — ${state.error}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const who = await page.evaluate(async () => {
    const { live, myFaces } = window.__revel;
    const face = await myFaces.create('Me');
    return { account: live.stack.account, face: face.id };
  });
  return { handle, page, ...who };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\nsigning up two browsers');
const alice = await signUp(`la${stamp}`);
const bob = await signUp(`lb${stamp}`);
ok('both are running the real core', !!alice.account && !!bob.account);

console.log('\nopening a DM and pointing the UI at it');
const room = await alice.page.evaluate(async (peer) => {
  const { live, core } = window.__revel;
  const info = await live.stack.core.directory.openDm({ account: peer });
  // The UI renders whatever `currentRoomId` points at, and the seam decides
  // where the messages come from. Pointing it at a real room is the whole test.
  core.currentRoomId = info.id;
  return info.id;
}, bob.account);
ok('a real room is open in the UI', !!room);

await wait(4000);
await bob.page.evaluate(async (id) => {
  const { live, core } = window.__revel;
  await live.stack.sync();
  await live.stack.core.directory.refresh();
  core.currentRoomId = id;
}, room);
await wait(2000);

console.log('\nalice sends through the path her keystrokes take');
const body = `rendered at ${Date.now()}`;
await alice.page.evaluate(async (text) => {
  // `core.send` is what the composer calls.
  window.__revel.core.send(text);
}, body);

console.log('\nand it appears in both DOMs');
const showsIt = async (who) => {
  for (let i = 0; i < 25; i++) {
    const found = await who.page.evaluate((text) => document.body.innerText.includes(text), body);
    if (found) return true;
    await wait(700);
  }
  return false;
};

ok("in alice's own list, from her optimistic insert", await showsIt(alice));
ok("in bob's, having crossed MLS and a socket", await showsIt(bob));

const rendered = await bob.page.evaluate(() => {
  const rows = [...document.querySelectorAll('.row')];
  return { rows: rows.length, text: document.body.innerText.slice(0, 300) };
});
ok('bob rendered a message row for it', rendered.rows > 0, rendered);
ok('with the face alice was speaking as', rendered.text.includes('Me'), rendered);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
