// usage: node logshot.mjs [url] [out.png]   the field log at a phone size, and whether its close button closes it
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, defaultViewport: null, args: ['--no-first-run', '--window-size=500,950'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(URL);
await page.waitForFunction(() => typeof window.begin === 'function' && window.field, { timeout: 120000 });
await page.evaluate(() => window.begin()); await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => window.field.open());
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: process.argv[3] || 'log.png' });
const r = await page.evaluate(() => { const b = document.querySelector('#fieldlog .close').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
await new Promise((r) => setTimeout(r, 600));
console.log('close button', JSON.stringify(r), 'closed after tap:', await page.evaluate(() => !window.field.isOpen));
await browser.close();
