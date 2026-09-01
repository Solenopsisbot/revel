/**
 * The app on a phone.
 *
 * Every other suite here drives a 1280x800 window, which is the shape none of
 * `docs/24` is about. This one runs a 390px viewport with a coarse pointer and
 * checks the three things that go wrong there and nowhere else.
 *
 * **The device layer is actually on.** `layout.narrow` and `layout.coarse`
 * decide the hamburger, the drawers, the long-press menus and the 44px floor,
 * and they are set from `matchMedia` inside one subscription. When that
 * subscription did not run — it lived in `/app`'s script behind an effect that
 * threw — a phone silently rendered the desktop three-column shell with no way
 * to reach the room list at all. Nothing else caught it, because at 1280 the
 * correct rendering and the broken one are the same rendering.
 *
 * **Nothing scrolls sideways.** A single element wider than the viewport turns
 * the whole app into a horizontally scrolling page, and the drawer gesture
 * fights it.
 *
 * **Targets are reachable.** `docs/24` says 44px minimum. Measured by probing
 * the corners of a 44x44 square rather than by reading a bounding box, because
 * several controls deliberately keep a small painted box and grow an unpainted
 * `::after` out to the floor — a rect cannot see that and a finger can.
 *
 * Fixtures only, so it needs no account and no server:
 *
 *   pnpm dev
 *   pnpm test:mobile
 */
import { chromium } from 'playwright';

const APP = process.env.REVEL_E2E_APP ?? 'http://localhost:5173';

let failures = 0;
const ok = (label, cond, extra) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}`);
  if (!cond) {
    failures++;
    if (extra !== undefined) console.log(`        ${JSON.stringify(extra).slice(0, 400)}`);
  }
};

/**
 * Everything measurable about one screen, gathered in the page.
 *
 * Deliberately skips two classes of element rather than reporting them:
 * anything a clipping ancestor cuts off (the haze blobs bleed past the edge on
 * purpose, inside `overflow: hidden`), and anything whose probe square falls
 * outside the viewport or whose own centre belongs to something else — a row
 * half under the sticky header is occluded, not small, and measuring it would
 * report a defect that is not there.
 */
const MEASURE = () => {
  const out = { overflow: [], small: [] };
  const vw = innerWidth;
  const vh = innerHeight;
  if (document.documentElement.scrollWidth > vw + 1) {
    out.overflow.push({ what: 'the document itself', w: document.documentElement.scrollWidth });
  }
  const seen = new Set();
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const id = `${el.tagName.toLowerCase()}.${[...el.classList].filter((c) => !c.startsWith('s-')).join('.')}`;

    let clipped = false;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).overflowX !== 'visible') {
        clipped = true;
        break;
      }
    }
    if (!clipped && r.right > vw + 1 && r.left >= 0 && r.left < vw && !seen.has(`o${id}`)) {
      seen.add(`o${id}`);
      out.overflow.push({ what: id, right: Math.round(r.right), vw });
    }

    if (!el.matches('button, a[href], [role=button], input, select, summary')) continue;
    if (el.hasAttribute('disabled')) continue;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const reach = 21;
    if (cx - reach < 0 || cx + reach > vw || cy - reach < 0 || cy + reach > vh) continue;
    const hits = (dx, dy) =>
      document.elementsFromPoint(cx + dx, cy + dy).some((n) => n === el || el.contains(n));
    if (!hits(0, 0)) continue;
    const big = r.width >= 44 && r.height >= 44;
    if (big) continue;
    if (hits(-reach, -reach) && hits(reach, -reach) && hits(-reach, reach) && hits(reach, reach))
      continue;
    const k = `t${id}${Math.round(r.width)}x${Math.round(r.height)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (cs.display === 'inline') continue;
    out.small.push({
      what: id,
      label: (el.getAttribute('aria-label') || el.title || el.textContent || '')
        .trim()
        .slice(0, 40),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }
  return out;
};

/**
 * Targets that are under 44 on purpose and stay that way.
 *
 * `button.author` is the name at the head of a message. It opens a profile, and
 * so does the 44px avatar one gap to its left — growing the name to 44 would
 * push every message's first line apart to buy a second route to the same card.
 *
 * The other exemption is computed rather than listed: an element whose used
 * `display` is `inline` is a run of text inside a sentence, and `min-height`
 * does nothing to one anyway. Forcing those to 44 would put holes in
 * paragraphs — `Email security@revel.chat.` is the shape in question. Anything
 * standalone is `block`, `flex` or `inline-flex` and stays in scope.
 */
const ALLOWED = new Set(['button.author']);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

async function open(path) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  // The first-run overlay covers whatever is behind it, so without this every
  // screen would measure the same overlay.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('revel.onboarded', 'yes');
    } catch {
      /* private mode */
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${path}: ${String(e).split('\n')[0].slice(0, 160)}`));
  await page.goto(`${APP}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  return page;
}

const app = (q = '') => `/app?demo=1&touch=1${q}`;

console.log('\nthe device layer, which decides every other answer here');
{
  const page = await open(app());
  ok('the shell knows it is narrow', (await page.locator('.shell.narrow').count()) === 1);
  ok(
    'there is a visible way to the room list, not only a swipe',
    (await page.locator('[aria-label="Spaces and rooms"]').count()) === 1,
  );
  ok(
    'the touch floor is 44px, not the mouse zero',
    (await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--tap').trim(),
    )) === '44px',
  );
  ok(
    'the drawer opens from the button',
    await (async () => {
      await page.click('[aria-label="Spaces and rooms"]');
      await page.waitForTimeout(500);
      return page.evaluate(() => document.querySelector('.nav').getBoundingClientRect().x >= 0);
    })(),
  );
  ok(
    'and picking a room puts it away again',
    await (async () => {
      await page.locator('.nav button', { hasText: 'off-topic' }).first().click();
      await page.waitForTimeout(500);
      return page.evaluate(() => document.querySelector('.nav').getBoundingClientRect().right <= 1);
    })(),
  );
  await page.context().close();
}

console.log('\nsettings, which is a full screen here rather than a card');
{
  const page = await open(app('&settings=notifications'));
  const seen = await page.evaluate(() => {
    const close = document.querySelector('.close');
    const tab = document.querySelector('nav .item.sel');
    if (!close || !tab) return null;
    const c = close.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    return {
      // Fully on screen and not scrolled away with the pane.
      closeReachable: c.top >= 0 && c.right <= innerWidth && c.width > 0,
      // Scrolled into view, and clear of the close parked over the strip.
      tabVisible: t.left >= 0 && t.right <= innerWidth,
      tabUnderClose: t.right > c.left && t.left < c.right,
    };
  });
  ok('the way out is on screen', seen?.closeReachable, seen);
  ok('the section you are in is scrolled into view', seen?.tabVisible, seen);
  ok('and is not hiding under the close button', seen?.tabUnderClose === false, seen);
  await page.context().close();
}

console.log('\nlong-press menus, which are a sheet on a finger');
{
  const page = await open(app());
  await page.click('[aria-label="Spaces and rooms"]');
  await page.waitForTimeout(400);
  await page.click('[title="Solexsis — settings and invites"]');
  await page.waitForTimeout(500);
  const menu = await page.evaluate(() => {
    const el = document.querySelector('.ctx');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      sheet: el.classList.contains('sheet'),
      onScreen: r.left >= 0 && r.right <= innerWidth,
      atBottom: Math.abs(r.bottom - innerHeight) < 2,
      // Hidden by CSS rather than removed from the markup — the shortcut is
      // still true, there is just no key here to press. So: none *shown*.
      keys: [...el.querySelectorAll('kbd')].filter((k) => getComputedStyle(k).display !== 'none')
        .length,
      hasScrim: !!document.querySelector('.sheet-scrim'),
    };
  });
  ok('it is a sheet, not a card at the pointer', menu?.sheet, menu);
  ok('anchored to the bottom edge, within reach', menu?.atBottom, menu);
  ok('and fully on screen rather than off the left', menu?.onScreen, menu);
  ok('no keyboard shortcuts offered to a device with no keyboard', menu?.keys === 0, menu);
  ok('with a scrim, so the tap that dismisses it is obvious', menu?.hasScrim, menu);
  await page.context().close();
}

console.log('\nevery screen: nothing off the side, nothing too small to hit');
for (const [name, path] of [
  ['the homepage', '/'],
  ['the security page', '/security'],
  ['sign-up', '/signup'],
  ['sign-in', '/signin'],
  ['a room', app()],
  ['settings', app('&settings=account')],
  ['appearance', app('&settings=appearance')],
  ['devices', app('&settings=devices')],
  ['notifications', app('&settings=notifications')],
]) {
  const page = await open(path);
  const m = await page.evaluate(MEASURE);
  const small = m.small.filter((s) => !ALLOWED.has(s.what));
  ok(`${name} — nothing scrolls sideways`, m.overflow.length === 0, m.overflow);
  ok(`${name} — everything is reachable`, small.length === 0, small);
  await page.context().close();
}

console.log('');
if (errors.length) {
  console.log('page errors:');
  for (const e of errors) console.log(`  ${e}`);
} else {
  console.log('page errors: none');
}
console.log(failures || errors.length ? `\n${failures} failed\n` : '\nall passed\n');
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
