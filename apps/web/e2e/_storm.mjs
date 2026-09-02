/** What does an idle, populated, signed-in app actually send? */
import { chromium } from 'playwright';
const APP = process.env.REVEL_E2E_APP ?? 'http://localhost:5173';
const stamp = Date.now().toString(36);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ channel: 'chrome' });

async function up(h, face) {
  const p = await (await b.newContext()).newPage({ viewport: { width: 1200, height: 860 } });
  await p.goto(`${APP}/signup`, { waitUntil: 'networkidle' });
  await p.fill('input[type=text]', h);
  await p.fill('input[type=password]', 'correct horse battery staple');
  await p.waitForFunction(() => ![...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Continue')?.disabled);
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.waitForSelector('text=YOUR RECOVERY CODE', { timeout: 90000 });
  await p.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
  for (let i = 0; i < 90; i++) { if (await p.evaluate(() => window.__revel?.live?.loaded ?? false)) break; await wait(500); }
  await p.evaluate(async (f) => { await window.__revel.myFaces.create(f); window.__revel.onboarding?.dismiss?.(); }, face);
  return p;
}

const alice = await up(`za${stamp}`, 'Viola');
const link = await alice.evaluate(async () => {
  const d = window.__revel.live.stack.core.directory;
  const s = await d.createSpace('Solexsis');
  await window.__revel.live.refreshSpaces();
  const m = await d.createInvite(s.id, { history: false });
  return `${location.origin}/i/${m.invite.code}#${m.secret}`;
});
const carol = await up(`zc${stamp}`, 'Carol');
await carol.goto(link, { waitUntil: 'networkidle' });
await wait(2000);
await carol.getByRole('button', { name: 'Join', exact: true }).click();
await wait(10000);
await carol.goto(`${APP}/app?e2e=1`, { waitUntil: 'load' });
for (let i = 0; i < 60; i++) { if (await carol.evaluate(() => window.__revel?.live?.loaded ?? false)) break; await wait(500); }
await wait(4000);

console.log('\nboth in a space. now counting 20 seconds of doing absolutely nothing.\n');
for (const [who, page] of [['alice', alice], ['carol', carol]]) {
  const counts = new Map();
  const bump = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);
  const on = (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(APP).origin) return;
    let p = u.pathname;
    if (p.startsWith('/_app/') || p.startsWith('/src/') || p.startsWith('/@') || p.startsWith('/node_modules/')) return;
    p = p.replace(/\/\d{6,}/g, '/<id>').replace(/\/[A-Za-z0-9_-]{20,}/g, '/<key>');
    bump(`${r.method()} ${p}`);
  };
  page.on('request', on);
  let ws = 0;
  const onws = () => { ws++; };
  page.on('websocket', onws);
  await wait(20000);
  page.off('request', on);
  page.off('websocket', onws);
  const total = [...counts.values()].reduce((a, c) => a + c, 0);
  console.log(`${who}: ${total} requests + ${ws} websockets in 20s`);
  for (const [k, v] of [...counts].sort((a, c) => c[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('');
}
await b.close();
