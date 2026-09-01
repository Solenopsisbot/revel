/**
 * A space, from the rail button to somebody else reading a room in it.
 *
 * `docs/06` phase 3. The unit tests in `packages/core/test/spaces.test.ts`
 * prove the crypto — that rooms sharing an audience share a group, and that an
 * invite hands over keys and not just a row. This proves the half those cannot
 * reach: that a person can *do* it, through the actual chrome, on two browsers.
 *
 * The assertions worth reading are the ones about what the second person can
 * see. A space's name, its rooms' names and its roles' names are all encrypted
 * events (`docs/04` §1), sent into the one audience every member is in — so
 * "bob sees the space called Solexsis" is a claim about key delivery dressed up
 * as a claim about a rail button.
 *
 *   REVEL_RATE_SCALE=50 pnpm dev:server
 *   pnpm dev
 *   pnpm test:spaces
 */
import { chromium } from 'playwright';

const APP = process.env.REVEL_E2E_APP ?? 'http://localhost:5173';
const password = 'correct horse battery staple';
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
    if (/no group|send failed|could not/i.test(text)) problems.push(`${who}: ${text.slice(0, 140)}`);
  });
}

async function signUp(handle, face) {
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1280, height: 900 } });
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

async function openApp(page) {
  await page.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => window.__revel?.live?.running ?? false)) break;
    await wait(1000);
  }
  await wait(2000);
}

/** Pull everything down and re-read: what a client does on waking up. */
async function resync(page) {
  await page.evaluate(async () => {
    const { live } = window.__revel;
    await live.stack.sync();
    await live.refreshRooms();
    await live.refreshSpaces();
  });
  await wait(3000);
}

const A = `sa${stamp}`;
const B = `sb${stamp}`;
const alice = await signUp(A, 'Viola');
const bob = await signUp(B, 'Rae');

// ---------------------------------------------------------------------------
console.log('\nmaking one');
ok(
  'a fresh account has no spaces at all',
  (await alice.page.evaluate(() => window.__revel.core.spaces.length)) === 0,
);

await alice.page.getByLabel('Make a space').click();
await alice.page.fill('input[aria-label="Space name"]', 'Solexsis');
await alice.page.getByRole('button', { name: 'Make it' }).click();
await wait(9000);

ok('the rail has a space on it', (await alice.page.getByTitle('Solexsis').count()) > 0);
ok(
  'it arrived with a #general, named',
  await alice.page.evaluate(
    () => window.__revel.core.spaces[0]?.rooms.some((r) => r.name === 'general') ?? false,
  ),
  await alice.page.evaluate(() => window.__revel.core.spaces[0]?.rooms.map((r) => r.name)),
);
ok(
  'and the server was never told what it is called',
  await alice.page.evaluate(async () => {
    const { live } = window.__revel;
    const rooms = await live.stack.core.directory.spaceRooms(live.spaces[0].info.id);
    return !JSON.stringify(rooms).includes('Solexsis');
  }),
);

// ---------------------------------------------------------------------------
console.log('\na second room, and a role');
const spaceId = await alice.page.evaluate(() => window.__revel.core.spaces[0].id);

await alice.page.evaluate(async (id) => {
  await window.__revel.core.createRoom(id, 'design');
}, spaceId);
await wait(7000);
ok(
  'the room list has both',
  await alice.page.evaluate(() => {
    const names = window.__revel.core.spaces[0].rooms.map((r) => r.name).sort();
    return names.join(',') === 'design,general';
  }),
  await alice.page.evaluate(() => window.__revel.core.spaces[0].rooms.map((r) => r.name)),
);
ok(
  'and both share one group, because both are "everyone"',
  await alice.page.evaluate(async () => {
    const { live } = window.__revel;
    const rooms = await live.stack.core.directory.spaceRooms(live.spaces[0].info.id);
    return new Set(rooms.map((r) => r.group)).size === 1;
  }),
);

await alice.page.evaluate(async () => {
  await window.__revel.core.addRole('Mods');
});
await wait(6000);
ok(
  'the role is there, with the name the server does not have',
  await alice.page.evaluate(
    () => window.__revel.core.spaces[0].roles.some((r) => r.name === 'Mods') ?? false,
  ),
  await alice.page.evaluate(() => window.__revel.core.spaces[0].roles.map((r) => r.name)),
);
ok(
  '@everyone is present and marked as itself',
  await alice.page.evaluate(
    () => window.__revel.core.spaces[0].roles.find((r) => r.everyone)?.name === '@everyone',
  ),
);

// ---------------------------------------------------------------------------
console.log('\ninviting somebody');
await alice.page.evaluate(
  async ([id, handle]) => {
    const result = await window.__revel.core.inviteToSpace(id, handle);
    if (result.error) throw new Error(result.error);
  },
  [spaceId, B],
);
await wait(9000);
await resync(bob.page);

ok('bob is in a space', (await bob.page.evaluate(() => window.__revel.core.spaces.length)) === 1);
ok(
  'and he can read what it is called',
  (await bob.page.evaluate(() => window.__revel.core.spaces[0]?.name)) === 'Solexsis',
  await bob.page.evaluate(() => window.__revel.core.spaces[0]?.name),
);
ok(
  'and what its rooms are called',
  await bob.page.evaluate(() => {
    const names = (window.__revel.core.spaces[0]?.rooms ?? []).map((r) => r.name).sort();
    return names.join(',') === 'design,general';
  }),
  await bob.page.evaluate(() => (window.__revel.core.spaces[0]?.rooms ?? []).map((r) => r.name)),
);
ok(
  'and what its roles are called — all three sent after his leaf existed',
  await bob.page.evaluate(
    () => window.__revel.core.spaces[0]?.roles.some((r) => r.name === 'Mods') ?? false,
  ),
  await bob.page.evaluate(() => (window.__revel.core.spaces[0]?.roles ?? []).map((r) => r.name)),
);

// ---------------------------------------------------------------------------
console.log('\ntalking in it');
await alice.page.evaluate(() => {
  const { core } = window.__revel;
  const space = core.spaces[0];
  core.openRoom(space.id, space.rooms.find((r) => r.name === 'design').id);
});
await wait(2500);
await alice.page.evaluate(() => void window.__revel.core.send('first words in a real space'));
await wait(8000);
await resync(bob.page);
await bob.page.evaluate(() => {
  const { core } = window.__revel;
  const space = core.spaces[0];
  core.openRoom(space.id, space.rooms.find((r) => r.name === 'design').id);
});
await wait(5000);
ok(
  'bob reads a room he was invited into',
  await bob.page.evaluate(() => document.body.innerText.includes('first words in a real space')),
);

await bob.page.evaluate(() => void window.__revel.core.send('and I can answer'));
await wait(8000);
ok(
  'and can answer in it',
  await alice.page.evaluate(() => document.body.innerText.includes('and I can answer')),
);

// ---------------------------------------------------------------------------
console.log('\ngiving him a role');
await alice.page.evaluate(() => {
  const { core } = window.__revel;
  const space = core.spaces[0];
  const them = space.members.find((m) => m.accountId !== core.myAccountId);
  core.toggleMemberRole(them.accountId, 'Mods');
});
await wait(6000);
ok(
  'the role stuck, by id, on the Host',
  await alice.page.evaluate(() => {
    const { core } = window.__revel;
    const space = core.spaces[0];
    const mods = space.roles.find((r) => r.name === 'Mods');
    const them = space.members.find((m) => m.accountId !== core.myAccountId);
    return them.roles.includes(mods.id);
  }),
  await alice.page.evaluate(() => window.__revel.core.spaces[0].members.map((m) => m.roles)),
);

// ---------------------------------------------------------------------------
console.log('\na room only some people can see');
await alice.page.evaluate(async (id) => {
  const { core } = window.__revel;
  const mods = core.spaces[0].roles.find((r) => r.name === 'Mods');
  await core.createRoom(id, 'mods-only', { kind: 'roles', roles: [mods.id] });
}, spaceId);
await wait(9000);
ok(
  'it got a group of its own, because its audience is different',
  await alice.page.evaluate(async () => {
    const { live } = window.__revel;
    const rooms = await live.stack.core.directory.spaceRooms(live.spaces[0].info.id);
    return new Set(rooms.map((r) => r.group)).size === 2;
  }),
  await alice.page.evaluate(async () => {
    const { live } = window.__revel;
    return (await live.stack.core.directory.spaceRooms(live.spaces[0].info.id)).map((r) => ({
      a: r.audience,
      g: r.group?.slice(0, 6),
    }));
  }),
);

// ---------------------------------------------------------------------------
console.log('\nrenaming things');
await alice.page.evaluate(async (id) => {
  const { core } = window.__revel;
  core.updateSpace(id, { name: 'Solexsis Research' });
  const design = core.spaces[0].rooms.find((r) => r.name === 'design');
  core.renameRoom(id, design.id, 'sketches', 'where the shapes happen');
}, spaceId);
await wait(7000);
await resync(bob.page);
ok(
  'a rename reaches the other person',
  (await bob.page.evaluate(() => window.__revel.core.spaces[0]?.name)) === 'Solexsis Research',
  await bob.page.evaluate(() => window.__revel.core.spaces[0]?.name),
);
ok(
  'and so does a room rename, with its topic',
  await bob.page.evaluate(() => {
    const r = window.__revel.core.spaces[0]?.rooms.find((x) => x.name === 'sketches');
    return r?.topic === 'where the shapes happen';
  }),
  await bob.page.evaluate(() =>
    (window.__revel.core.spaces[0]?.rooms ?? []).map((r) => [r.name, r.topic]),
  ),
);

// ---------------------------------------------------------------------------
console.log('\ndeleting a room');
await alice.page.evaluate(async (id) => {
  const { core } = window.__revel;
  const sketches = core.spaces[0].rooms.find((r) => r.name === 'sketches');
  const result = await core.deleteRoom(id, sketches.id);
  if (result.error) throw new Error(result.error);
}, spaceId);
await wait(6000);
ok(
  'it is gone for the person who deleted it',
  await alice.page.evaluate(
    () => !window.__revel.core.spaces[0].rooms.some((r) => r.name === 'sketches'),
  ),
  await alice.page.evaluate(() => window.__revel.core.spaces[0].rooms.map((r) => r.name)),
);
await resync(bob.page);
ok(
  'and for everybody else',
  await bob.page.evaluate(
    () => !(window.__revel.core.spaces[0]?.rooms ?? []).some((r) => r.name === 'sketches'),
  ),
  await bob.page.evaluate(() => (window.__revel.core.spaces[0]?.rooms ?? []).map((r) => r.name)),
);
ok(
  'while its sibling — which shared its group — still works',
  await bob.page.evaluate(
    () => (window.__revel.core.spaces[0]?.rooms ?? []).some((r) => r.name === 'general'),
  ),
);

// ---------------------------------------------------------------------------
console.log('\nand taking him back out');
// Put bob in the room the next messages go to, so "he cannot see it" is a
// claim about keys rather than about which tab he happens to be on.
await bob.page.evaluate(() => {
  const { core } = window.__revel;
  const space = core.spaces[0];
  core.openRoom(space.id, space.rooms.find((r) => r.name === 'general').id);
});
await wait(2000);
await alice.page.evaluate(() => {
  const { core } = window.__revel;
  const space = core.spaces[0];
  core.openRoom(space.id, space.rooms.find((r) => r.name === 'general').id);
});
await wait(1500);
await alice.page.evaluate(() => void window.__revel.core.send('while he is still here'));
await wait(8000);
await resync(bob.page);
await wait(2000);
ok(
  'he can read the room right up until he is removed',
  await bob.page.evaluate(() => document.body.innerText.includes('while he is still here')),
);

await alice.page.evaluate(() => {
  const { core } = window.__revel;
  const them = core.spaces[0].members.find((m) => m.accountId !== core.myAccountId);
  core.kick(them.accountId);
});
await wait(9000);
await alice.page.evaluate(() => {
  const { core } = window.__revel;
  const space = core.spaces[0];
  core.openRoom(space.id, space.rooms.find((r) => r.name === 'general').id);
});
await wait(1500);
await alice.page.evaluate(() => void window.__revel.core.send('said after he left'));
await wait(8000);
await resync(bob.page);
ok(
  'the membership row is gone',
  (await bob.page.evaluate(() => window.__revel.core.spaces.length)) === 0,
  await bob.page.evaluate(() => window.__revel.core.spaces.map((s) => s.name)),
);
ok(
  'and so are the keys — this is the half a database row cannot do',
  !(await bob.page.evaluate(() => document.body.innerText.includes('said after he left'))),
);

console.log(`\nproblems: ${problems.length ? problems.slice(0, 6).join('; ') : 'none'}`);
await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
