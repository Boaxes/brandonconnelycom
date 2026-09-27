// usage: node ui-shots.mjs [url] [outdir]   screenshots of the interface on desktop and phone sizes, book open, zoomed, one page at a time
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || 'shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null, args: ['--no-first-run', '--window-size=1500,1000', '--autoplay-policy=no-user-gesture-required'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, vp] of [['desk', { width: 1440, height: 860, deviceScaleFactor: 1 }], ['phone', { width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['land', { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto(URL);
  await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
  await page.evaluate(() => window.begin()); await wait(3500);
  await page.evaluate(() => window.portfolio.pickUp()); await wait(3500);
  await page.screenshot({ path: `${OUT}/${name}-open.png` });
  await page.evaluate(() => window.portfolio.flipTo(3, true)); await wait(1200);
  await page.evaluate(() => { window.portfolio.next(); }); await wait(900);
  await page.screenshot({ path: `${OUT}/${name}-next.png` });
  await page.evaluate(() => window.portfolio.zoomAt(1.8, 0.3, 0.1, window.ocean.camera)); await wait(900);
  await page.screenshot({ path: `${OUT}/${name}-zoom.png` });
  await page.evaluate(() => window.portfolio.resetZoom()); await page.evaluate(() => window.portfolio.lower()); await wait(1500);
  await page.screenshot({ path: `${OUT}/${name}-down.png` });
  await page.close();
}
await browser.close();
