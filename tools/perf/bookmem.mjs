// usage: node bookmem.mjs [url]   the book's memory while reading it through: page canvases held, page textures, per spread
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--no-first-run', '--window-size=1440,990', '--autoplay-policy=no-user-gesture-required'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL);
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stat = () => page.evaluate(() => {
  const P = window.portfolio, ps = [P.o.inside, ...P.pages];
  const canvases = ps.filter((p) => p.alive).length, bases = ps.filter((p) => p.base).length;
  const textures = P.tex.size;
  return { spread: P.spread, canvases, bases, textures, mb: +((canvases + bases) * 5.87 + textures * 7.83).toFixed(0) };
});
console.log('built    ', JSON.stringify(await stat()));
await page.evaluate(() => window.begin()); await wait(3500);
await page.evaluate(() => window.portfolio.pickUp()); await wait(4000);
let peak = 0;
for (let s = 0; s <= 7; s++) { const x = await stat(); peak = Math.max(peak, x.mb); console.log('spread', s, JSON.stringify(x)); await page.evaluate(() => window.portfolio.next()); await wait(900); }
for (const s of [0, 6, 2]) { await page.evaluate((s) => window.portfolio.flipTo(s, true), s); await wait(900); const x = await stat(); peak = Math.max(peak, x.mb); console.log('jump', s, JSON.stringify(x)); }
console.log('peak book memory ~', peak, 'MB (canvases 5.9 MB each, textures 7.8 MB with mipmaps); before: ~', ((15 + 8) * 5.87 + 15 * 7.83).toFixed(0), 'MB once every page had been seen');
await browser.close();
