// usage: node behave.mjs [url]   checks the book's behaviour: restart on return, videos rewound, queued turns, turn on press
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null,
  args: ['--window-size=1440,990', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-backgrounding-occluded-windows'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => { window.__videos = new Set(); const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__videos.add(this); return p.call(this); }; });
await page.goto(URL);
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (f, ...a) => page.evaluate(f, ...a);
const ok = (name, cond, detail = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
await ev(() => window.begin()); await wait(3500);
await ev(() => window.portfolio.pickUp()); await wait(4000);
// restart on return: the tourism page's moving parts are timed from when it came into view
await ev(() => window.portfolio.flipTo(3, true)); await wait(3000);
const shown1 = await ev(() => window.portfolio.pages[5].shownAt);
await ev(() => window.portfolio.flipTo(1, true)); await wait(1500);
const vids = await ev(() => [...window.__videos].map((v) => ({ src: v.src.split('/').pop(), t: +v.currentTime.toFixed(2), paused: v.paused })));
ok('videos off-view are paused and rewound', vids.every((v) => v.paused && v.t === 0), JSON.stringify(vids));
await ev(() => window.portfolio.flipTo(3, true)); await wait(600);
const [shown2, clock] = await ev(() => [window.portfolio.pages[5].shownAt, window.portfolio.clock]);
ok('animation restarts on return', shown2 > shown1 && clock - shown2 < 1.0, `shown ${shown1.toFixed(2)} -> ${shown2.toFixed(2)}, now ${clock.toFixed(2)}`);
const tegu = await ev(() => [...window.__videos].filter((v) => /tegu/.test(v.src)).map((v) => +v.currentTime.toFixed(2)));
ok('tegu videos playing again from the start', tegu.every((t) => t > 0 && t < 1.5), JSON.stringify(tegu));
// queued turns: three quick next()s during one turn land three spreads on
await ev(() => window.portfolio.flipTo(0, true)); await wait(1200);
const t0 = Date.now();
await ev(() => { const p = window.portfolio; p.next(); setTimeout(() => p.next(), 60); setTimeout(() => p.next(), 120); });
await page.waitForFunction(() => window.portfolio.spread === 3 && !window.portfolio.busy, { timeout: 5000 }).catch(() => {});
ok('three quick clicks land on spread 3', await ev(() => window.portfolio.spread) === 3, `took ${Date.now() - t0} ms`);
// turn length
await wait(500);
const len = await ev(async () => { const p = window.portfolio; const s = performance.now(); p.next(); while (p.busy) await new Promise((r) => requestAnimationFrame(r)); return performance.now() - s; });
ok('a single turn takes ~0.32 s', len > 280 && len < 450, `${len.toFixed(0)} ms`);
// turn on press: mouse down on the right-hand page starts a turn before the button comes up
await wait(500);
const pt = await ev(() => { const P = window.portfolio, cam = window.ocean.camera; P.root.updateMatrixWorld(); const v = new window.THREE.Vector3(P.W * 0.95, -P.H * 0.2, P.th / 2).applyMatrix4(P.root.matrixWorld).project(cam); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, sp: P.spread }; });
const under = await ev((x, y) => { const e = document.elementFromPoint(x, y); const P = window.portfolio; const r = new window.THREE.Raycaster(); r.setFromCamera(new window.THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), window.ocean.camera); const h = r.intersectObjects(P.targets(), false)[0]; return { el: e && (e.id || e.tagName), hit: h ? h.object.name : null, d: h ? P.describe(h) : null, state: P.state }; }, pt.x, pt.y);
console.log('under pointer', JSON.stringify(under), pt);
await page.mouse.move(pt.x, pt.y);
await page.mouse.down();
await wait(80);
const busyOnPress = await ev(() => window.portfolio.busy);
await page.mouse.up();
await wait(700);
const sp2 = await ev(() => window.portfolio.spread);
ok('page turns on press, once', busyOnPress && sp2 === pt.sp + 1, `busy on press ${busyOnPress}, spread ${pt.sp} -> ${sp2}`);
await browser.close();
