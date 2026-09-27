// usage: node rapid.mjs [url] [cpuThrottle]   rapid page flipping and section jumps; frames over 25 ms with what was behind them
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const THROTTLE = Number(process.argv[3] || 1);
const MOBILE = !!process.env.MOBILE;
const W = MOBILE ? 844 : 1440, H = MOBILE ? 390 : 900;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null,
  args: [`--window-size=${W},${H + 90}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const page = (await browser.pages())[0];
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 3 : 2, mobile: MOBILE });
await page.evaluateOnNewDocument(() => {
  window.__log = []; window.__label = 'load';
  window.__c = { link: 0, up: 0, what: [] };
  const P = WebGL2RenderingContext.prototype;
  const lp = P.linkProgram; P.linkProgram = function (p) { window.__c.link++; return lp.call(this, p); };
  for (const k of ['texImage2D', 'texStorage2D', 'texSubImage2D']) { const o = P[k]; P[k] = function (...a) { const s = a[a.length - 1]; const w = k === 'texStorage2D' ? a[3] : s?.width; const h = k === 'texStorage2D' ? a[4] : s?.height; if (w * h > 100000) { window.__c.up++; window.__c.what.push(k.replace('tex', '') + ' ' + w + 'x' + h); } return o.apply(this, a); }; }
  let last = 0;
  const f = (t) => { if (last) { const c = window.__c; window.__log.push([t, t - last, window.__label, c.link, c.up, c.what.join(',')]); } window.__c = { link: 0, up: 0, what: [] }; last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const L = (s) => page.evaluate((s) => (window.__label = s), s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluate(() => window.begin()); await wait(3500);
await page.evaluate(() => window.portfolio.pickUp()); await wait(3500);
const max = await page.evaluate(() => window.portfolio.maxSpread());
await L('rapid fwd');
for (let s = 0; s < max + 2; s++) { await page.evaluate(() => window.portfolio.next()); await wait(150); }
await wait(800);
await L('rapid back');
for (let s = 0; s < max + 2; s++) { await page.evaluate(() => window.portfolio.prev()); await wait(150); }
await wait(800);
await L('jumps');
for (const sp of [5, 1, 6, 3, 0, 4, 2, 6, 0]) { await page.evaluate((sp) => window.portfolio.flipTo(sp, true), sp); await wait(400); }
await wait(800);
await L('rapid fwd 2');
for (let s = 0; s < max + 2; s++) { await page.evaluate(() => window.portfolio.next()); await wait(150); }
await wait(1000);
const log = await page.evaluate(() => window.__log);
const by = {};
for (const [, d, l] of log) (by[l] = by[l] || []).push(d);
for (const [l, ds] of Object.entries(by)) { if (l === 'load') continue; const s = [...ds].sort((a, b) => a - b); console.log(l.padEnd(12), 'n', ds.length, 'p50', s[s.length >> 1].toFixed(1), 'p95', s[Math.floor(s.length * 0.95)].toFixed(1), 'max', s[s.length - 1].toFixed(1), '>25:', ds.filter((d) => d > 25).length); }
for (const [t, d, l, link, up, what] of log.filter(([, d, l]) => d > 25 && l !== 'load')) console.log(`  ${l}@${(t / 1000).toFixed(1)}s ${d.toFixed(0)}ms links ${link} uploads ${up} ${what}`);
const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
console.log('js heap MB', mem, 'spread', await page.evaluate(() => window.portfolio.spread), 'textures', await page.evaluate(() => window.ocean.renderer.info.memory.textures));
await browser.close();
