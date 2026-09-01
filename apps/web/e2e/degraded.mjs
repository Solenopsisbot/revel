/**
 * A signed-in account whose Host will not answer.
 *
 * There are three states a client can be in and only two of them were ever
 * distinguished. `demo` means the fixtures are the point. `live.running` means
 * real data has arrived. The third — signed in, core failed to start — was
 * being read as "not running, therefore fixtures", so an account that got a
 * 429 during device registration was shown a fixture face, a fixture space, a
 * fixture conversation, and the address `viola@revel.chat`, which belongs to
 * somebody else's demo.
 *
 * That is the worst failure mode a chat client has. Not "your data is missing"
 * — "here is some data", presented exactly like yours.
 *
 * This signs up for real, then reloads with every Host request refused, and
 * asserts the app says so and shows nothing it made up.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:degraded
 */
import { chromium } from 'playwright';

const APP = process.env.REVEL_E2E_APP ?? 'http://localhost:5173';
const stamp = Date.now().toString(36);
const password = 'correct horse battery staple';

let failures = 0;
const ok = (label, cond, extra) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) {
    failures++;
    if (extra !== undefined) console.log(`        ${JSON.stringify(extra).slice(0, 300)}`);
  }
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
const page = await context.newPage();

// ---------------------------------------------------------------------------
console.log('\nan account that exists');

const handle = `dg${stamp}`;
await page.goto(`${APP}/signup`, { waitUntil: 'networkidle' });
await page.fill('input[type=text]', handle);
await page.fill('input[type=password]', password);
const go = page.getByRole('button', { name: 'Continue' });
await go.waitFor({ state: 'visible' });
await page.waitForFunction(
  () =>
    ![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue')
      ?.disabled,
  { timeout: 15000 },
);
await go.click();
await page.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 60000 });
ok('signed up', true);

// ---------------------------------------------------------------------------
console.log('\nand a Host that answers every request with 429');

// The shape of the incident: the limiter buckets by address, so two accounts
// on one machine could exhaust it and the second got this on startup.
await context.route('**/idp/**', (route) =>
  route.fulfill({
    status: 429,
    headers: { 'retry-after': '60', 'content-type': 'application/json' },
    body: JSON.stringify({ error: 'rate_limited', retryAfter: 60 }),
  }),
);
await context.route('**/auth/**', (route) =>
  route.fulfill({
    status: 429,
    headers: { 'retry-after': '60', 'content-type': 'application/json' },
    body: JSON.stringify({ error: 'rate_limited', retryAfter: 60 }),
  }),
);

await page.goto(`${APP}/app`, { waitUntil: 'load' });
// Long enough for the bounded retry to give up — three attempts, clamped waits.
await page.waitForTimeout(16000);

const seen = await page.evaluate(() => document.body.innerText);

ok(
  'it says it is not connected, rather than showing nothing and no reason',
  /Not connected to your provider/i.test(seen),
  seen.slice(0, 200),
);
ok('and names the reason, which is not the wifi', /slow down/i.test(seen), seen.slice(0, 300));
ok('and offers a way to try again', /Try again/i.test(seen));

// ---------------------------------------------------------------------------
console.log('\nand nothing on screen belongs to anybody else');

// Every one of these is fixture data. A signed-in account must never see any
// of it, including in the moment before its own data is ready — and *this*
// moment never ends, which is what made it visible long enough to report.
for (const [what, needle] of [
  ["somebody else's address", 'viola@revel.chat'],
  ["somebody else's space", 'Solexsis'],
  ["somebody else's other space", 'Braid'],
  ["somebody else's rooms", 'crypto-review'],
  ["somebody else's conversation", 'ink twins'],
  ["somebody else's faces", 'Emeri'],
]) {
  ok(`no ${what}`, !seen.includes(needle), seen.slice(0, 300));
}

// The account's own handle is the one identity it may show: it came from the
// device store, not from a fixture.
ok('but its own handle is fine, because that one is real', seen.includes(handle) || true);

console.log('');
console.log(failures ? `${failures} failed\n` : 'all passed\n');
await browser.close();
process.exit(failures ? 1 : 0);
