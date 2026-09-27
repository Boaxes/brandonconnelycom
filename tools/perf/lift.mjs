// usage: node lift.mjs <url> <outdir> [w h]   frames of the opening and the book's lift at a phone size (rAF held, sim stepped)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [URL, OUT, W = 390, H = 844] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null, args: ['--no-first-run', '--window-size=500,950'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => (window.__hold ? 0 : raf(cb)); window.__hold = true; });
await page.goto(URL);
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 4000));
let T = 0;
const cap = async (name) => { const b = await page.evaluate((t) => { window.ocean.render(t, 1 / 60); return window.ocean.renderer.domElement.toDataURL('image/jpeg', 0.8); }, T); fs.writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(b.split(',')[1], 'base64')); };
await page.evaluate(() => window.begin());
T = await page.evaluate(() => window.advance(3)); await cap('0-intro');
await page.evaluate(() => window.portfolio.pickUp());
for (let i = 1; i <= 9; i++) { T = await page.evaluate(() => window.advance(0.1)); await cap(`${i}-lift`); }
T = await page.evaluate(() => window.advance(2)); await cap('z-held');
await browser.close();
