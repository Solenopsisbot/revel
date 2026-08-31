/**
 * Faces, for a real account, in a real browser.
 *
 * The book lives in `@revel/core` and is sealed per account on this device.
 * What this checks is the part that only a browser can: that it loads on
 * sign-in, survives a reload, and that a face created in the UI gets an id the
 * wire will actually accept.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:faces
 */
import { chromium } from 'playwright';

const APP = 'http://localhost:5173';
const handle = `fc${Date.now().toString(36)}`;
const password = 'correct horse battery staple';

let failures = 0;
const ok = (label, cond, extra) => {
  console.log(
    `${cond ? '  ok  ' : ' FAIL '} ${label}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`,
  );
  if (!cond) failures++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`      [page] ${m.text().slice(0, 200)}`);
});

console.log('\nsigning up');
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

await page.goto(`${APP}/app`, { waitUntil: 'load' });
await page.waitForTimeout(3000);

// ---------------------------------------------------------------------------
const fresh = await page.evaluate(async () => {
  const { myFaces } = await import('/src/lib/faces.svelte.ts');
  return {
    live: myFaces.live,
    count: myFaces.book.faces.length,
    account: myFaces.account.slice(0, 10),
  };
});
ok('a signed-in account uses the real book', fresh.live, fresh);
ok('and starts with no faces, rather than fixtures', fresh.count === 0, fresh);

// ---------------------------------------------------------------------------
console.log('\ncreating a face');
const made = await page.evaluate(async () => {
  const { myFaces } = await import('/src/lib/faces.svelte.ts');
  const face = await myFaces.create('Ash', { colour: 'aqua', pronouns: 'they/them' });
  return { face, count: myFaces.book.faces.length, primary: myFaces.book.primary };
});
ok('it is in the book', made.count === 1, made);
ok('and it is the primary, because something has to be', made.primary === made.face.id);
// The whole point of minting rather than slugging: `FaceRef.id` is a snowflake,
// and a face called "Ash" with the id `ash` fails the payload schema on the way
// out and arrives as an unknown event.
ok('its id is a snowflake the wire will accept', /^\d{1,20}$/.test(made.face.id), made.face.id);

// ---------------------------------------------------------------------------
console.log('\nacross a reload');
await page.goto(`${APP}/app`, { waitUntil: 'load' });
await page.waitForTimeout(3000);
const after = await page.evaluate(async () => {
  const { myFaces } = await import('/src/lib/faces.svelte.ts');
  return {
    live: myFaces.live,
    faces: myFaces.book.faces.map((f) => ({ id: f.id, name: f.name, pronouns: f.pronouns })),
  };
});
ok('the book comes back sealed from this device', after.live && after.faces.length === 1, after);
ok(
  'with the face intact',
  after.faces[0]?.name === 'Ash' && after.faces[0]?.pronouns === 'they/them',
  after.faces,
);
ok('and the same id', after.faces[0]?.id === made.face.id);

// ---------------------------------------------------------------------------
console.log('\nchoosing per room');
const chosen = await page.evaluate(async () => {
  const { myFaces } = await import('/src/lib/faces.svelte.ts');
  const june = await myFaces.create('June', { colour: 'mint' });
  await myFaces.speak('room-a', june.id);
  return {
    inA: myFaces.speaking('room-a')?.name,
    inB: myFaces.speaking('room-b')?.name,
    june: june.id,
  };
});
ok('the room choice applies where it was made', chosen.inA === 'June', chosen);
// Per room, not per account: the "would this reveal a link" check asks about the
// room you are in, so one global selection would let you switch where it is
// harmless and arrive where it is not.
ok('and does not leak into another room', chosen.inB === 'Ash', chosen);

// ---------------------------------------------------------------------------
console.log('\nthe fixtures still work without an account');
const demo = await context.newPage();
await demo.goto(`${APP}/app?demo=1`, { waitUntil: 'load' });
await demo.waitForTimeout(2000);
const fixtures = await demo.evaluate(async () => {
  const { myFaces } = await import('/src/lib/faces.svelte.ts');
  const { core } = await import('/src/lib/fake/core.svelte.ts');
  return { live: myFaces.live, names: core.myFaces.map((f) => f.name) };
});
ok('demo mode is not live', !fixtures.live, fixtures);
ok('and still has the fixture faces', fixtures.names.length >= 3, fixtures.names);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
