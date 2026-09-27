// usage: node chrome-bench.mjs [mode]   runs the on-device benchmark (src/dev/bench.ts, ?bench[=mode]) in real Chrome;
// results land in .shots/perf-other[-mode].json like a phone's
import puppeteer from 'puppeteer-core';
const mode = process.argv[2];
// DPR=0: the screen's own density (no emulation)
const DPR = Number(process.env.DPR ?? 2);
const W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  defaultViewport: null,
  args: [`--window-size=${W},${H + 90}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required'],
});
const page = (await browser.pages())[0];
const cdp = await page.createCDPSession();
if (DPR) await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/?bench' + (mode ? '=' + mode : ''), { waitUntil: 'load' });
await page.waitForFunction(() => document.body.innerText.includes('bench done'), { timeout: 400000, polling: 1000 });
await browser.close();
