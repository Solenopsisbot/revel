/**
 * What a broken connection costs.
 *
 * Reported as "why does the webpage send 25 requests in a batch every single
 * second": 8 key-package claims, 5 event fetches, 4 handshakes, 4 group reads,
 * a `/rooms`, a `/welcomes`, and a websocket. That batch is exactly one pass of
 * `syncGroups`, and it ran once a second because two things compounded.
 *
 * The socket reset its backoff counter the instant it *opened*, so a connection
 * that opened and died — a proxy hanging up, a token accepted then rejected —
 * reconnected at `backoff(0)`, one second, forever. And `syncGroups` was
 * triggered by connect, by every reconnect, and by every WELCOME frame, with
 * nothing coalescing or throttling it.
 *
 * A client doing this to a Host is a self-inflicted denial of service, and it
 * is why the rate limiter kept refusing perfectly ordinary work.
 *
 * Measured rather than asserted structurally, because the thing that went wrong
 * was a *rate* and nothing about the shape of the code looked wrong.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:storm
 */
import { chromium } from 'playwright';

const APP = 'http://localhost:5173';
const stamp = Date.now().toString(36);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext();
const p = await ctx.newPage({ viewport: { width: 1200, height: 860 } });
await p.goto(`${APP}/signup`, { waitUntil: 'networkidle' });
await p.fill('input[type=text]', `fl${stamp}`);
await p.fill('input[type=password]', 'correct horse battery staple');
await p.waitForFunction(
  () =>
    ![...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Continue')
      ?.disabled,
);
await p.getByRole('button', { name: 'Continue' }).click();
await p.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 90000 });
await p.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
for (let i = 0; i < 90; i++) {
  if (await p.evaluate(() => window.__revel?.live?.loaded ?? false)) break;
  await wait(500);
}
await p.evaluate(async () => {
  await window.__revel.myFaces.create('Viola');
  window.__revel.onboarding?.dismiss?.();
});
await p.evaluate(async () => {
  const d = window.__revel.live.stack.core.directory;
  const s = await d.createSpace('Solexsis');
  await d.createSpaceRoom(s.id, { name: 'design' });
  await window.__revel.live.refreshSpaces();
});
await wait(4000);

// Kill every socket the moment it opens: the exact flap that produced the storm.
let sockets = 0,
  reqs = 0;
await p.evaluate(() => {
  // A class, not a wrapper function: a formatter will happily rewrite
  // `function (...a) {}` into an arrow, and an arrow cannot be called with
  // `new`. Subclassing says what this is and survives that.
  const Real = window.WebSocket;
  window.WebSocket = class extends Real {
    constructor(...args) {
      super(...args);
      this.addEventListener('open', () => setTimeout(() => this.close(), 50));
    }
  };
});
await p.evaluate(() => window.__revel.live.stack.stream.stop());
p.on('websocket', () => {
  sockets++;
});
p.on('request', (r) => {
  const u = new URL(r.url());
  if (u.origin !== new URL(APP).origin) return;
  const path = u.pathname;
  if (path.startsWith('/_app/') || path.startsWith('/src/') || path.startsWith('/@')) return;
  reqs++;
});
await p.evaluate(() => window.__revel.live.stack.stream.start());
await wait(30000);
const perSecond = reqs / 30;
console.log(`\nwith the socket dying on every open, over 30 seconds:`);
console.log(`  ${sockets} socket attempts`);
console.log(`  ${reqs} HTTP requests  (${perSecond.toFixed(1)}/s)\n`);

let failures = 0;
const ok = (label, cond, extra) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) {
    failures++;
    if (extra !== undefined) console.log(`        ${JSON.stringify(extra)}`);
  }
};

// Generous ceilings, because the exact numbers depend on how many rooms and
// groups the account has. What is being pinned is the order of magnitude: this
// used to be ~9/s on an account with two rooms and about 25/s on a real one.
ok('the backoff escalates instead of polling once a second', sockets <= 10, { sockets });
ok('and the catch-up does not run once per reconnect', perSecond < 3, { perSecond, reqs });

console.log('');
console.log(failures ? `${failures} failed\n` : 'all passed\n');
await b.close();
process.exit(failures ? 1 : 0);
