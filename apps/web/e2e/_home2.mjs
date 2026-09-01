import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [w, h, tag] of [[1280, 900, 'desk'], [390, 844, 'phone']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: `/tmp/h-${tag}.png`, fullPage: true });
  await page.close();
}
await browser.close();
console.log('done');
