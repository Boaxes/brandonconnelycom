// usage: URL=http://localhost:5173/ [UNCAP=1] [FIXPR=1.5] [SECS=5] [TRACE=state] node prof.mjs
// Frame-time profiler: drives the site in real (headed, GPU) Chrome through its states.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = process.env.URL || 'http://localhost:5173/';
const DPR = Number(process.env.DPR || 2);
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
const SECS = Number(process.env.SECS || 5);
const TRACE = process.env.TRACE; // state name to trace

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  defaultViewport: null,
  args: [`--window-size=${W},${H + 90}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--no-first-run', '--enable-privileged-webgl-extensions', '--enable-webgl-draft-extensions', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    ...(process.env.UNCAP ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
});
const page = (await browser.pages())[0];
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log('[page]', m.type(), m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));

// instrument
await page.evaluate((fixPR) => {
  if (fixPR) { window.ocean.adapt = () => {}; window.ocean.renderer.setPixelRatio(fixPR); window.ocean.resize(); }
  const ext = window.ocean.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2');
  console.warn('timer ext', !!ext);
  const P = (window.__prof = { render: [], world: [], book: [], frames: [], gl: null });
  const wrap = (obj, key, bucket) => {
    const f = obj[key].bind(obj);
    obj[key] = (...a) => { const t = performance.now(); const r = f(...a); P[bucket].push(performance.now() - t); return r; };
  };
  wrap(window.ocean, 'render', 'render');
  wrap(window.world, 'update', 'world');
  wrap(window.portfolio, 'update', 'book');
  let last = performance.now();
  const raf = () => { const n = performance.now(); P.frames.push(n - last); last = n; requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  // count texture uploads
  const gl = window.ocean.renderer.getContext();
  P.uploads = 0; P.uploadBytes = 0; P.mips = 0; P.draws = 0;
  for (const k of ['texImage2D', 'texSubImage2D']) {
    const f = gl[k].bind(gl);
    gl[k] = (...a) => {
      P.uploads++;
      const src = a[a.length - 1];
      if (src && src.width) P.uploadBytes += src.width * src.height * 4;
      return f(...a);
    };
  }
  const gm = gl.generateMipmap.bind(gl);
  gl.generateMipmap = (t) => { P.mips++; return gm(t); };
}, Number(process.env.FIXPR || 0));

async function measure(name) {
  if (TRACE === name) await page.tracing.start({ path: `trace-${name}.json`, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu', 'viz', 'cc', 'blink'] });
  await page.evaluate(() => { const P = window.__prof; P.render = []; P.world = []; P.book = []; P.frames = []; P.uploads = 0; P.uploadBytes = 0; P.mips = 0; });
  await new Promise((r) => setTimeout(r, SECS * 1000));
  if (TRACE === name) await page.tracing.stop();
  const s = await page.evaluate(() => {
    const P = window.__prof;
    const st = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; const mean = a.reduce((x, y) => x + y, 0) / (a.length || 1); return { mean: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +q(1).toFixed(2) }; };
    const info = window.ocean.renderer.info;
    return {
      fps: +(1000 / (P.frames.reduce((x, y) => x + y, 0) / P.frames.length)).toFixed(1),
      frame: st(P.frames), render: st(P.render), world: st(P.world), book: st(P.book),
      uploadsPerFrame: +(P.uploads / P.frames.length).toFixed(2), uploadMBps: +(P.uploadBytes / 1e6 / (P.frames.reduce((x, y) => x + y, 0) / 1000)).toFixed(1),
      mipsPerFrame: +(P.mips / P.frames.length).toFixed(2),
      calls: info.render.calls, tris: info.render.triangles, pr: window.ocean.renderer.getPixelRatio(),
    };
  });
  console.log(name.padEnd(16), JSON.stringify(s));
  return s;
}

const results = {};
// the opening
await page.evaluate(() => { window.begin(); });
await new Promise((r) => setTimeout(r, 3500));
results.intro = await measure('intro');
await page.evaluate(() => window.portfolio.pickUp());
await new Promise((r) => setTimeout(r, 7000));
results.held_spread0 = await measure('held_spread0');
const goto = async (sp) => { await page.evaluate((sp) => window.portfolio.flipTo(sp, true), sp); await new Promise((r) => setTimeout(r, 1200)); };
await goto(1); results.held_cascadia = await measure('held_cascadia');
await goto(3); results.held_tourism = await measure('held_tourism');
await goto(4); results.held_reptile = await measure('held_reptile');
await goto(5); results.held_numerical = await measure('held_numerical');
await goto(8); results.held_static = await measure('held_static');
// page flipping continuously
await goto(2);
await page.evaluate(() => { window.__flipper = setInterval(() => { const p = window.portfolio; if (!p.busy) p.spread < 5 ? p.next() : p.flipTo(2); }, 500); });
results.flipping = await measure('flipping');
await page.evaluate(() => clearInterval(window.__flipper));
await page.evaluate(() => window.portfolio.lower());
await new Promise((r) => setTimeout(r, 2000));
results.scene = await measure('scene');
fs.writeFileSync(process.env.OUT || 'result.json', JSON.stringify(results, null, 1));
await browser.close();
