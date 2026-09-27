// usage: node vcheck.mjs [url] [safari|chrome]   how often each animated page redraws while shown (video pages should follow their video's frame rate)
const URL = process.argv[2] || 'http://localhost:5173/';
const WD = process.argv[3] === 'chrome' ? null : 'http://localhost:4444';
import puppeteer from 'puppeteer-core';
let run, close;
if (WD) {
  const req = async (method, path, body) => { const r = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
  const { sessionId } = await req('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  const S = `/session/${sessionId}`;
  await req('POST', S + '/window/rect', { x: 0, y: 0, width: 1440, height: 900 });
  await req('POST', S + '/url', { url: URL });
  run = (script, args = []) => req('POST', S + '/execute/sync', { script: 'return (' + script + ')', args });
  close = () => req('DELETE', S);
} else {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-backgrounding-occluded-windows'] });
  const page = (await b.pages())[0];
  await page.goto(URL);
  run = (script, args = []) => page.evaluate(new Function('...args', 'return (' + script + ')'), ...args);
  close = () => b.close();
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 120; i++) { if (await run('typeof window.begin === "function" && !!window.portfolio')) break; await wait(500); }
await run('window.begin()'); await wait(3500);
await run('window.portfolio.pickUp()'); await wait(4000);
console.log(await run('JSON.stringify({ state: window.portfolio.state, open: window.portfolio.reading, t: window.world.time, vis: document.visibilityState })'));
for (const sp of [0, 1, 3, 4, 5]) {
  await run('window.portfolio.flipTo(' + sp + ', true)'); await wait(1500);
  const a = await run('[window.portfolio.o.inside, ...window.portfolio.pages].map((p) => p.version)');
  await wait(2000);
  const b = await run('[window.portfolio.o.inside, ...window.portfolio.pages].map((p) => p.version)');
  const idx = [2 * sp - 1, 2 * sp].map((i) => i + 1);
  console.log('spread', sp, idx.map((i) => `page ${i - 1}: ${((b[i] - a[i]) / 2).toFixed(1)} redraws/s`).join(', '));
}
await close();
