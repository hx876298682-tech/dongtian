/* Screenshot all key routes at desktop + mobile for UI review. */
const { chromium } = require('/Users/huxiao07/Desktop/放置修仙/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright');

const BASE = 'http://127.0.0.1:5173';
const OUT = '/tmp/ui-review';
const routes = [
  ['cultivation', '/cultivation'],
  ['cave', '/dashboard/cave'],
  ['craft', '/craft'],
  ['herbalism', '/craft/herbalism'],
  ['alchemy', '/craft/alchemy'],
  ['expedition', '/expedition'],
  ['character', '/character'],
  ['inventory', '/inventory'],
  ['settings', '/settings'],
  ['breakthrough', '/cultivation/breakthrough'],
];

(async () => {
  const browser = await chromium.launch();
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });

  for (const [name, path] of routes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${name}-1440.png` });
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
    }));
    console.log(`${name} 1440: scrollW=${metrics.scrollW} innerW=${metrics.innerW} scrollH=${metrics.scrollH} innerH=${metrics.innerH} errors=${errors.length}`);
    if (errors.length) console.log('  ERR:', errors.slice(0, 3).join(' | ').slice(0, 300));
    await page.close();
  }

  // mobile pass on key routes
  for (const [name, path] of routes.slice(0, 6)) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${name}-390.png` });
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    console.log(`${name} 390: scrollW=${metrics.scrollW} innerW=${metrics.innerW}`);
    await page.close();
  }

  await browser.close();
})();
