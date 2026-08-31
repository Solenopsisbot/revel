/**
 * Two browsers, one room, one encrypted message.
 *
 * `packages/core` has 1,100 tests and a multi-client harness, and until now
 * none of it had ever run in a browser. This is the seam that was never tested:
 * real MLS in wasm, a real socket, a real Host, a real IndexedDB — and two
 * independent origins that have to agree.
 *
 * Nearly every genuine bug in this project has come from connecting two halves
 * that were individually fine. This connects the two biggest ones.
 *
 *   docker compose up -d --wait
 *   pnpm dev            # 5173
 *   REVEL_RATE_SCALE=50 pnpm dev:server   # 8080, with a host key
 *   pnpm test:live
 *
 * The scale is required, not optional. In development every caller shares one
 * rate-limit bucket — there is no proxy to read an address from — so two
 * browsers signing up against one box exhaust the `auth` capacity between them
 * before either finishes. That is the limiter working; this is how to test
 * around it without weakening the default.
 */
import { chromium } from 'playwright';

const APP = 'http://localhost:5173';
const stamp = Date.now().toString(36);
const password = 'correct horse battery staple';

let failures = 0;
const ok = (label, cond, extra) => {
  console.log(
    `${cond ? '  ok  ' : ' FAIL '} ${label}${extra !== undefined && !cond ? ` — ${JSON.stringify(extra)}` : ''}`,
  );
  if (!cond) failures++;
  return cond;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

/** A signed-up browser with the real core running. */
async function open(handle) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`      [${handle}] ${m.text().slice(0, 240)}`);
  });

  await page.goto(`${APP}/signup`, { waitUntil: 'networkidle' });
  await page.fill('input[type=text]', handle);
  await page.fill('input[type=password]', password);
  // Enabled *and* stable: the button is disabled until both fields validate,
  // and clicking during hydration detaches it mid-click.
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

  const started = await page.evaluate(async () => {
    const { session } = await import('/src/lib/session.svelte.ts');
    const s = await session.restore();
    if (!s) return { error: 'no session' };
    const { startLive } = await import('/src/lib/live.ts');
    try {
      window.__live = await startLive(s);
      return { account: window.__live.account, device: window.__live.device };
    } catch (err) {
      return { error: String((err && err.message) || err) };
    }
  });

  return { handle, page, ...started };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('signing up two browsers and starting the real core');
const alice = await open(`al${stamp}`);
const bob = await open(`bo${stamp}`);

ok('alice started the real core', !alice.error, alice.error);
ok('bob started the real core', !bob.error, bob.error);
if (alice.error || bob.error) {
  await browser.close();
  process.exit(1);
}
ok('they are different accounts', alice.account !== bob.account);

// ---------------------------------------------------------------------------
console.log('\nalice opens a room with bob');

const room = await alice.page.evaluate(async (peer) => {
  try {
    const info = await window.__live.core.directory.openDm({ account: peer });
    return { id: info.id };
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
}, bob.account);
ok('a DM room exists', !!room.id, room.error);
if (!room.id) {
  await browser.close();
  process.exit(1);
}

// Bob has to take the Welcome before he can read anything. Normally the socket
// tells him; asking explicitly here means a socket problem shows up as a socket
// assertion rather than as "the message never arrived".
await wait(3000);
const bobSync = await bob.page.evaluate(async () => {
  const before = window.__live.socketStatus();
  try {
    await window.__live.sync();
    await window.__live.core.directory.refresh();
    return {
      socket: before,
      rooms: window.__live.core.directory.rooms().map((r) => ({ id: r.id, group: r.group })),
    };
  } catch (err) {
    return { socket: before, error: String((err && err.message) || err) };
  }
});
ok('bob socket is open', bobSync.socket === 'open', bobSync.socket);
ok('bob sees the room, with a group', !!bobSync.rooms?.[0]?.group, bobSync);

const bobGroups = await bob.page.evaluate(async () => ({
  groups: await window.__live.crypto.groups(),
  welcomes: await window.__live.groups.acceptWelcomes().catch((e) => String(e)),
}));
ok('bob has joined the MLS group', (bobGroups.groups ?? []).length > 0, bobGroups);

// ---------------------------------------------------------------------------
console.log('\nalice sends, bob receives');

const body = `hello from ${alice.handle} at ${Date.now()}`;
const sent = await alice.page.evaluate(
  async ([id, text]) => {
    try {
      // `send` takes the *body* and wraps it into an `m.message` itself.
      // Passing a whole event double-wraps it, which decrypts perfectly and
      // then renders as an unknown type — a good failure, and one the fallback
      // in `docs/29` §1 rule 2 preserved intact rather than dropping.
      await window.__live.core.conversation.send(id, text);
      return { ok: true };
    } catch (err) {
      return { error: String((err && err.message) || err) };
    }
  },
  [room.id, body],
);
ok('alice sent it', sent.ok, sent.error);

// Poll rather than sleep once: the socket is delivery, and delivery has a
// latency that is not worth guessing at.
let seen = null;
for (let i = 0; i < 25 && !seen; i++) {
  await wait(800);
  seen = await bob.page.evaluate(async (id) => {
    try {
      await window.__live.core.conversation.open(id).catch(() => {});
      const messages = window.__live.core.conversation.timeline(id);
      const bodies = messages.map((m) => (m.body && m.body.body) || m.body);
      return bodies.length
        ? { bodies, shapes: messages.map((m) => JSON.stringify(m).slice(0, 300)) }
        : null;
    } catch (err) {
      return { error: String((err && err.message) || err) };
    }
  }, room.id);
  if (seen && seen.error) break;
}

ok('bob received something', !!seen && !seen.error, seen);
ok('and it decrypted to what alice sent', !!seen?.bodies?.some((b) => b === body), seen?.shapes);

// ---------------------------------------------------------------------------
console.log('\nthe Host cannot read it');

const stored = await alice.page.evaluate(async (id) => {
  const res = await fetch(`/rooms/${id}/events?limit=10`, {
    headers: await window.__live.session.headers(),
  });
  const body = await res.json();
  return { status: res.status, payloads: (body.events ?? []).map((e) => e.payload) };
}, room.id);

ok('the Host has the event', stored.payloads.length > 0, stored);
ok(
  'and its payload is ciphertext, not the message',
  stored.payloads.every((p) => typeof p === 'string' && !atob(p).includes('hello from')),
);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
