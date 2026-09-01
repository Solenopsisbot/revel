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

// `?e2e=1` publishes the app's own singletons — importing them by URL gets a
// different module instance, which looks identical and is not the one the UI
// renders from.
await page.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
await page.waitForTimeout(3000);

// ---------------------------------------------------------------------------
const fresh = await page.evaluate(async () => {
  const { myFaces } = window.__revel;
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
  const { myFaces } = window.__revel;
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
// `?e2e=1` publishes the app's own singletons — importing them by URL gets a
// different module instance, which looks identical and is not the one the UI
// renders from.
await page.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
await page.waitForTimeout(3000);
const after = await page.evaluate(async () => {
  const { myFaces } = window.__revel;
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
  const { myFaces } = window.__revel;
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
console.log('\ntwo faces, one conversation, and what the other side learns');

// `docs/11`'s actual feature, end to end: a plural account speaks as one face,
// then another, and the person on the other end sees two people — while the
// account is warned, before it happens, that this is what links them.
//
// Every one of these read fixture data until now. `facesHere` was `dm.mineIds`
// (empty for a real room), `facesSpokenHere` read the fixture message map, and
// `addFaceHere` checked a fixture list and returned. So the disclosure warning
// a plural person relies on was silent for exactly the accounts that have one.

/** A second account, in its own context so it has its own sealed store. */
async function signUpAnother(who) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${APP}/signup`, { waitUntil: 'networkidle' });
  await p.fill('input[type=text]', who);
  await p.fill('input[type=password]', password);
  await p.waitForFunction(
    () =>
      ![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue')
        ?.disabled,
  );
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 60000 });
  await p.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
  for (let i = 0; i < 90; i++) {
    if (await p.evaluate(() => window.__revel?.live?.running ?? false)) break;
    await p.waitForTimeout(1000);
  }
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.__revel.onboarding?.dismiss?.());
  return p;
}

const otherHandle = `fd${Date.now().toString(36)}`;
const other = await signUpAnother(otherHandle);

// The welcome overlay sits over the rail, and this is the first part of this
// test that clicks anything rather than driving the app through `__revel`.
await page.evaluate(() => window.__revel.onboarding?.dismiss?.());
await page.waitForTimeout(500);
await page.getByTitle('Message someone').click();
await page.fill('input[aria-label="Who do you want to message?"]', otherHandle);
await page.getByRole('button', { name: 'Start' }).click();
await page.waitForTimeout(5000);

// Ash speaks first. June exists but has never been here.
const ashId = await page.evaluate(
  () => window.__revel.core.myFaces.find((f) => f.name === 'Ash').id,
);
await page.evaluate((id) => window.__revel.core.addFaceHere(id), ashId);
await page.evaluate(() => void window.__revel.core.send('ash speaking'));
await page.waitForTimeout(4000);

const facesNamed = () =>
  page.evaluate(() =>
    (window.__revel.core.facesHere ?? []).map((id) => window.__revel.core.faceCard(id).name),
  );
ok('a face is here once it has spoken', (await facesNamed()).includes('Ash'), await facesNamed());

const juneId = await page.evaluate(
  () => window.__revel.core.myFaces.find((f) => f.name === 'June').id,
);
ok(
  'and bringing another one in would reveal the link',
  await page.evaluate((id) => window.__revel.core.revealsLinkHere(id), juneId),
);

await page.evaluate((id) => window.__revel.core.addFaceHere(id), juneId);
await page.waitForTimeout(1500);
ok('joining puts it here', (await facesNamed()).includes('June'), await facesNamed());

await page.evaluate(() => void window.__revel.core.send('june speaking'));
await page.waitForTimeout(4000);
await other.evaluate(async () => {
  const { live, core } = window.__revel;
  await live.stack.sync();
  await live.refreshRooms();
  if (core.dms[0]) core.openHome(core.dms[0].id);
});
await other.waitForTimeout(5000);

const seen = await other.evaluate(() => {
  const state = window.__revel.live.room(window.__revel.core.currentRoomId);
  return {
    roster: [...state.faces.values()].map((f) => f.name).sort(),
    ash: state.messages.find((m) => m.body === 'ash speaking')?.face?.name,
    june: state.messages.find((m) => m.body === 'june speaking')?.face?.name,
  };
});
ok('the other side sees both faces on the roster', seen.roster.join(',') === 'Ash,June', seen);
ok('and each message wears the one that sent it', seen.ash === 'Ash' && seen.june === 'June', seen);

// ---------------------------------------------------------------------------
console.log('\nthe fixtures still work without an account');
const demo = await context.newPage();
await demo.goto(`${APP}/app?demo=1&e2e=1`, { waitUntil: 'load' });
await demo.waitForTimeout(2000);
const fixtures = await demo.evaluate(async () => {
  const { myFaces, core } = window.__revel;
  return { live: myFaces.live, names: core.myFaces.map((f) => f.name) };
});
ok('demo mode is not live', !fixtures.live, fixtures);
ok('and still has the fixture faces', fixtures.names.length >= 3, fixtures.names);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
