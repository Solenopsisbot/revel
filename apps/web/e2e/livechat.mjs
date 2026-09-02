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

console.log('\nalice starts a conversation by typing a handle');
// A new account gets the welcome overlay, and a person dismisses it before
// doing anything else. It is modal, so leaving it up means every click below
// lands on the scrim instead.
for (const who of [alice, bob]) {
  await who.page.evaluate(() => window.__revel.onboarding?.dismiss?.());
}
// Through the sidebar, the way a person does it: press +, type a name, submit.
await alice.page.getByTitle('Start a conversation').click();
await alice.page.getByRole('menuitem', { name: 'Message someone' }).click();
await alice.page.fill('input[aria-label="Who do you want to message?"]', bob.handle);
await alice.page.getByRole('button', { name: 'Start', exact: true }).click();
await alice.page.waitForFunction(
  () => window.__revel.core.scope === 'home' && window.__revel.core.currentRoomId.length > 5,
  { timeout: 30000 },
);
const room = await alice.page.evaluate(() => window.__revel.core.currentRoomId);
ok('a real room is open in the UI', !!room);

// The row in her sidebar is named after the person, not a key.
const named = await alice.page.evaluate(async () => {
  for (let i = 0; i < 20; i++) {
    const dm = window.__revel.core.dms[0];
    if (dm?.name && !/^[A-Za-z0-9_-]{8}$/.test(dm.name)) return dm.name;
    await new Promise((r) => setTimeout(r, 400));
  }
  return window.__revel.core.dms[0]?.name ?? '';
});
ok('and the sidebar names them from the directory', named === bob.handle, named);

await wait(4000);
// Bob does what a client does on waking: take what is waiting, and look at the
// room list. Then open it the way a person would — by clicking it.
await bob.page.evaluate(async () => {
  const { live } = window.__revel;
  await live.stack.sync();
  await live.refreshRooms();
});
await bob.page.waitForFunction(() => window.__revel.core.dms.length > 0, { timeout: 30000 });
await bob.page.evaluate(() => window.__revel.core.openHome(window.__revel.core.dms[0].id));
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
// Compared against whichever face alice is actually speaking as, not a name
// this test picked. Every account now starts with a profile made from its
// handle, and creating a second face does not silently take over from it —
// so hardcoding the created name asserted the wrong thing the moment that
// stopped being the only face in the book.
const speaking = await alice.page.evaluate(() => {
  const { core } = window.__revel;
  return core.myFaces.find((f) => f.id === core.speakingHere)?.name ?? '';
});
ok('with the face alice was speaking as', !!speaking && rendered.text.includes(speaking), {
  speaking,
  ...rendered,
});

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
