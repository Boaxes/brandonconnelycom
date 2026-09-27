// usage: node safari-pages.mjs [url]   Safari: per page, how often it's sent to the GPU and what each send costs
const URL = process.argv[2] || 'http://localhost:5173/';
const WD = 'http://localhost:4444';
const req = async (method, path, body) => { const r = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const { sessionId } = await req('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const S = `/session/${sessionId}`;
const run = (script) => req('POST', S + '/execute/sync', { script, args: [] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await req('POST', S + '/window/rect', { x: 0, y: 0, width: 1440, height: 900 });
  await req('POST', S + '/url', { url: URL });
  for (let i = 0; i < 120; i++) { if (await run('return typeof window.begin === "function" && !!window.portfolio')) break; await wait(500); }
  await run(`window.__p = {}; const P = window.portfolio; const f = P.patch.bind(P); P.patch = (page, t) => { const s = performance.now(); const r = f(page, t); const k = page.number; (window.__p[k] = window.__p[k] || []).push(performance.now() - s); return r; };
    window.__fr = []; let last = 0; const g = (t) => { if (last) window.__fr.push(t - last); last = t; requestAnimationFrame(g); }; requestAnimationFrame(g);`);
  await run('window.begin()'); await wait(3500);
  await run('window.portfolio.pickUp()'); await wait(4000);
  for (const sp of [0, 1, 3, 4, 5]) {
    await run(`window.portfolio.flipTo(${sp}, true)`); await wait(1500);
    await run('window.__p = {}; window.__fr = []'); await wait(4000);
    console.log('spread', sp, await run(`const fr = window.__fr; const fps = (1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)).toFixed(0); return fps + ' fps; ' + Object.entries(window.__p).map(([k, a]) => 'page ' + k + ': ' + (a.length / 4).toFixed(1) + '/s, ' + (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) + ' ms each (' + JSON.stringify(window.portfolio.pages[k - 1].liveRects.map((r) => r.w + 'x' + r.h)) + ')').join('; ')`));
  }
} finally { await req('DELETE', S); }
