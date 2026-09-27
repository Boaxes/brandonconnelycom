// usage: node touch.mjs [url]   phone held upright: tap halves of the page, fast swipes, a pinch; checks where the book ends up
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null, args: ['--no-first-run', '--window-size=500,950', '--autoplay-policy=no-user-gesture-required'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const cdp = await page.createCDPSession();
await page.goto(URL);
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (f, ...a) => page.evaluate(f, ...a);
const ok = (name, cond, detail = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await wait(40); await touch('touchEnd', []); };
const swipe = async (x0, x1, y) => { await touch('touchStart', [[x0, y]]); for (let k = 1; k <= 5; k++) { await touch('touchMove', [[x0 + (x1 - x0) * k / 5, y]]); await wait(12); } await touch('touchEnd', []); };
await ev(() => window.begin()); await wait(3500);
await ev(() => window.portfolio.pickUp()); await wait(4000);
ok('one page at a time in portrait', await ev(() => window.portfolio.onePage));
await ev(() => window.portfolio.showPage(1, true)); await wait(900);
const p0 = await ev(() => window.portfolio.page);
await tap(330, 600); await wait(700);
const p1 = await ev(() => window.portfolio.page);
ok('tap right half: next page', p1 === p0 + 1, `${p0} -> ${p1}`);
await tap(60, 600); await wait(700);
ok('tap left half: previous page', await ev(() => window.portfolio.page) === p0);
// three fast swipes to the left
const t0 = Date.now();
for (let k = 0; k < 3; k++) { await swipe(320, 120, 600); await wait(60); }
await page.waitForFunction((p) => window.portfolio.page === p && !window.portfolio.busy, { timeout: 4000 }, p0 + 3).catch(() => {});
ok('three fast swipes: three pages on', await ev(() => window.portfolio.page) === p0 + 3, `page ${await ev(() => window.portfolio.page)}, ${Date.now() - t0} ms`);
await swipe(100, 320, 600); await wait(700);
ok('swipe right: back a page', await ev(() => window.portfolio.page) === p0 + 2);
// pinch out on the page
await touch('touchStart', [[170, 400], [220, 420]]);
for (let k = 1; k <= 8; k++) { await touch('touchMove', [[170 - k * 12, 400 - k * 8], [220 + k * 12, 420 + k * 8]]); await wait(16); }
await touch('touchEnd', []); await wait(600);
const z = await ev(() => window.portfolio.zoomLevel);
ok('pinch zooms the book', z > 1.5, `zoom ${z.toFixed(2)}`);
ok('section buttons hidden in portrait', await ev(() => !document.getElementById('marks').classList.contains('on')));
ok('corner controls hidden while reading', await ev(() => getComputedStyle(document.getElementById('controls')).opacity === '0'));
await browser.close();
