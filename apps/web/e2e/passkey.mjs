/**
 * WebAuthn, against a virtual authenticator.
 *
 * The one part of the identity stack with no test behind it, until now. There
 * is no such thing as an online authenticator — WebAuthn's authenticator is
 * local by construction — but Chrome ships a virtual one behind CDP, which is
 * how WebAuthn is meant to be tested. `hasPrf` is the option that matters: the
 * passkey wrap needs the PRF extension, and an authenticator without it is one
 * this product cannot use.
 *
 * ## Why this is a script and not a vitest file
 *
 * It needs three live things — a browser, the dev server, and an IdP with a
 * database — so it cannot run in the ordinary suite without either starting all
 * of them or silently skipping, and a test that silently skips is one nobody
 * notices has stopped running. It is a script you run on purpose:
 *
 *   docker compose up -d --wait
 *   pnpm dev                 # 5173
 *   pnpm dev:server          # 8080, with a host key
 *   pnpm test:passkey
 *
 * Chrome rather than a downloaded browser: the virtual authenticator is a
 * Chrome feature, and `channel: 'chrome'` uses the one already installed.
 */
import { chromium } from 'playwright';

const APP = 'http://localhost:5173';
const handle = `pk${Date.now().toString(36)}`;
const password = 'correct horse battery staple';

const ok = (label, cond) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) process.exitCode = 1;
  return cond;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`      [page] ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) console.log(`      [http] ${r.status()} ${r.url()}`);
});

const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    ctap2Version: 'ctap2_1',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    // The whole point. Without PRF a passkey is a signature, not a key, and
    // there is nothing to wrap the account key with.
    hasPrf: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
console.log(`virtual authenticator ${authenticatorId} (ctap2_1, prf, resident keys)`);

const fill = async (selector, value) => {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.fill(selector, value);
};

// ---------------------------------------------------------------------------
console.log('\nsign up, then add a passkey');

await page.goto(`${APP}/signup`);
await fill('input[type=text]', handle);
await fill('input[type=password]', password);
await page.getByRole('button', { name: 'Continue' }).click();

await page.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 30000 });
const recovery = (await page.textContent('body')).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){7}/)[0];
ok('sign-up produced a recovery code', /^[A-Z0-9-]{39}$/.test(recovery));

// The acknowledgement is mandatory and Continue stays disabled until it is
// ticked — which is the point of it, and worth asserting rather than working
// around silently.
ok(
  'continuing is blocked until the recovery code is acknowledged',
  await page.getByRole('button', { name: 'Continue' }).isDisabled(),
);
await page.getByRole('checkbox').check();
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForSelector('text=A second way back', { timeout: 15000 });

// The step that could not be tested before: does this device offer a passkey?
const offered = await page.getByRole('button', { name: 'Add a passkey' }).isVisible();
ok('a passkey is offered where an authenticator exists', offered);

await page.getByRole('button', { name: 'Add a passkey' }).click();
await page.waitForURL('**/app', { timeout: 30000 });
ok('adding a passkey lands in the app', page.url().includes('/app'));

const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
ok('the authenticator holds one discoverable credential', credentials.credentials.length === 1);
ok(
  'it is a resident key, so sign-in needs no handle',
  credentials.credentials[0].isResidentCredential,
);

// ---------------------------------------------------------------------------
console.log('\nsign out, then sign in with the passkey alone');

await page.evaluate(
  () =>
    new Promise((r) => {
      const q = indexedDB.deleteDatabase('revel-session');
      q.onsuccess = q.onerror = q.onblocked = () => r();
    }),
);
await page.goto(`${APP}/signin`);
await page.waitForSelector('text=Sign in.', { timeout: 15000 });

const button = page.getByRole('button', { name: 'Use a passkey' });
ok('sign-in offers a passkey', await button.isVisible());

await button.click();
await page.waitForURL('**/app', { timeout: 30000 });
ok('the passkey signed in — no handle, no password', page.url().includes('/app'));

const restored = await page.evaluate(async () => {
  const m = await import('/src/lib/session.svelte.ts');
  const s = await m.session.restore();
  return s ? { handle: s.handle, keyLen: s.accountKey.length } : null;
});
ok('it restored the same account', restored?.handle === handle);
ok('with a 32-byte account key', restored?.keyLen === 32);

// ---------------------------------------------------------------------------
console.log('\nthe passkey is a third door, not a replacement');

await page.evaluate(
  () =>
    new Promise((r) => {
      const q = indexedDB.deleteDatabase('revel-session');
      q.onsuccess = q.onerror = q.onblocked = () => r();
    }),
);
await page.goto(`${APP}/signin`);
await fill('input[type=text]', handle);
await fill('input[type=password]', password);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.waitForURL('**/app', { timeout: 30000 });
ok('the password still works after enrolling a passkey', page.url().includes('/app'));

await browser.close();
console.log(process.exitCode ? '\nFAILED' : '\nall passed');
