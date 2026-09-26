// usage: node hitch.mjs [url]   (every frame of a scripted session; frames over 25 ms with the shader links and uploads behind them)
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const W = 1440, H = 900;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null,
  args: [`--window-size=${W},${H + 90}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const page = (await browser.pages())[0];
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await page.evaluateOnNewDocument(() => {
  window.__log = []; window.__label = 'load';
  window.__c = { link: 0, up: 0, upPx: 0, what: [] };
  const P = WebGL2RenderingContext.prototype;
  const lp = P.linkProgram; P.linkProgram = function (p) { window.__c.link++; return lp.call(this, p); };
  for (const k of ['texImage2D', 'texStorage2D']) { const o = P[k]; P[k] = function (...a) { window.__c.up++; const w = k === 'texStorage2D' ? a[3] : (a.length >= 9 ? a[3] : a[a.length - 1]?.width); const h = k === 'texStorage2D' ? a[4] : (a.length >= 9 ? a[4] : a[a.length - 1]?.height); if (w * h > 200000) window.__c.what.push(k + ' ' + w + 'x' + h); window.__c.upPx += (w * h) || 0; return o.apply(this, a); }; }
  let last = 0;
  const f = (t) => { if (last) { const c = window.__c; window.__log.push([t, t - last, window.__label, c.link, c.up, c.what.join(',')]); } window.__c = { link: 0, up: 0, upPx: 0, what: [] }; last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
const L = (s) => page.evaluate((s) => (window.__label = s), s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await L('begin'); await page.evaluate(() => window.begin()); await wait(3000);
await L('pickup'); await page.evaluate(() => window.portfolio.pickUp()); await wait(2500);
const max = await page.evaluate(() => window.portfolio.maxSpread());
for (let s = 1; s <= max; s++) { await L('flip->' + s); await page.evaluate(() => window.portfolio.next()); await wait(1000); }
await L('jump->0'); await page.evaluate(() => window.portfolio.flipTo(0, true)); await wait(1000);
await L('lower'); await page.evaluate(() => window.portfolio.lower()); await wait(1500);
await L('lookaround');
for (let k = 0; k < 8; k++) { await page.evaluate(() => window.rig.step(1, 0)); await wait(900); }
await page.evaluate(() => window.rig.step(0, 2)); await L('look up'); await wait(2000);
await page.evaluate(() => window.rig.step(0, -2)); await L('wait visitors'); await wait(40000);
await L('raise'); await page.evaluate(() => window.portfolio.raise()); await wait(1500);
const log = await page.evaluate(() => window.__log);
const hitches = log.filter(([, d]) => d > 25);
const by = {};
for (const [, d, l] of log) { by[l] = by[l] || []; by[l].push(d); }
for (const [l, ds] of Object.entries(by)) { const s = [...ds].sort((a, b) => a - b); console.log(l.padEnd(14), 'n', ds.length, 'p50', s[s.length >> 1].toFixed(1), 'p95', s[Math.floor(s.length * 0.95)].toFixed(1), 'max', s[s.length - 1].toFixed(1), 'over25', ds.filter((d) => d > 25).length); }
for (const [t, d, l, link, up, what] of hitches) console.log(`${l}@${(t / 1000).toFixed(1)}s ${d.toFixed(0)}ms  prev-frame links ${link} uploads ${up} ${what}`);
// the work lands in the frame before the long gap is measured: show both
const idx = new Map(log.map((e, i) => [e, i]));
for (const h of hitches) { const i = idx.get(h); const n = log[i + 1]; if (n) console.log('   next frame: links', n[3], 'uploads', n[4], n[5]); }
console.log('pr', await page.evaluate(() => window.ocean.renderer.getPixelRatio()));
await browser.close();
