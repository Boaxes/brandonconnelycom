// usage: node cap.mjs <dev-server-url> <out-dir>   (dev server: needs the window.advance/begin helpers)
// Deterministic captures: seeded Math.random, the rAF loop held, the sim stepped by hand, frames read back.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const URL = process.argv[2], OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const W = 1440, H = 900;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null,
  args: [`--window-size=${W},${H + 90}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required'],
});
const page = (await browser.pages())[0];
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await page.evaluateOnNewDocument(() => {
  const mk = (a) => () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const main = mk(12345), ids = mk(999);
  // three's generateUUID draws from Math.random too: give it its own stream, so creating more or fewer
  // objects (render targets, materials) doesn't change the simulation
  Math.random = () => (new Error().stack.includes('generateUUID') ? ids() : main());
  const raf = window.requestAnimationFrame.bind(window);
  window.__held = [];
  window.requestAnimationFrame = (cb) => { if (window.__hold) { window.__held.push(cb); return 0; } return raf(cb); };
  window.__hold = true; // the site's loop runs once, then waits
});
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 6000));
await page.evaluate(() => { const o = window.ocean; o.adapt = () => {}; o.renderer.setPixelRatio(1.5); o.resize(); });
let T = 0;
const cap = async (name) => {
  const b64 = await page.evaluate((t) => { window.ocean.render(t, 1 / 60); return window.ocean.renderer.domElement.toDataURL('image/png'); }, T);
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64.split(',')[1], 'base64'));
};
const adv = async (s) => { T = await page.evaluate((s) => window.advance(s), s); };
await page.evaluate(() => window.begin());
await adv(3); await cap('intro');
await page.evaluate(() => window.portfolio.pickUp());
await adv(8); await cap('held');
await page.evaluate(() => window.portfolio.flipTo(1, true)); await adv(1); await cap('cascadia');
await page.evaluate(() => window.portfolio.flipTo(3, true)); await adv(1); await cap('tourism');
await page.evaluate(() => window.portfolio.flipTo(8, true)); await adv(0.1); await cap('flipmid');
await adv(1); await cap('credits');
await page.evaluate(() => window.portfolio.lower()); await adv(2); await cap('scene');
await page.evaluate(() => window.rig.step(0, 2)); await adv(2); await cap('up');
await page.evaluate(() => window.rig.step(3, -2)); await adv(2); await cap('se');
await page.evaluate(() => window.rig.step(2, -1)); await adv(20); await cap('later');
await browser.close();
