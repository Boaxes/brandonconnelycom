// usage: node safari.mjs [url]   (needs `safaridriver --port 4444` running and Safari → Settings → Developer → Allow remote automation)
// Frame timings in real Safari: the book held on each spread, rapid page turns, section jumps.
const URL = process.argv[2] || 'http://localhost:5173/';
const WD = 'http://localhost:4444';
const req = async (method, path, body) => {
  const r = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message);
  return j.value;
};
const { sessionId } = await req('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const S = `/session/${sessionId}`;
const run = (script, args = []) => req('POST', S + '/execute/sync', { script, args });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await req('POST', S + '/window/rect', { x: 0, y: 0, width: Number(process.env.W || 1440), height: Number(process.env.H || 900) });
  await req('POST', S + '/url', { url: URL });
  for (let i = 0; i < 120; i++) { if (await run('return typeof window.begin === "function" && !!window.portfolio')) break; await wait(500); }
  await wait(1500);
  console.log(await run(`
    window.__log = []; window.__label = 'idle';
    window.__c = { up: 0, px: 0, what: [] };
    const P = WebGL2RenderingContext.prototype;
    for (const k of ['texImage2D', 'texStorage2D', 'texSubImage2D']) { const o = P[k]; P[k] = function (...a) { const s = a[a.length - 1]; const w = k === 'texStorage2D' ? a[3] : s && s.width; const h = k === 'texStorage2D' ? a[4] : s && s.height; if (w * h > 50000) { window.__c.up++; window.__c.px += w * h; } return o.apply(this, a); }; }
    const time = (obj, key, name) => { const f = obj[key].bind(obj); obj[key] = (...a) => { const t = performance.now(); const r = f(...a); window.__c[name] = (window.__c[name] || 0) + performance.now() - t; return r; }; };
    time(window.ocean, 'render', 'render'); time(window.world, 'update', 'world'); time(window.portfolio, 'update', 'book');
    time(window.portfolio, 'patch', 'patch'); time(window.portfolio, 'prefetch', 'prefetch');
    for (const p of [portfolio.o.inside, ...portfolio.pages]) { if (p.live) { const lv = p.live; p.live = (...a) => { const t = performance.now(); lv(...a); window.__c.live = (window.__c.live || 0) + performance.now() - t; }; time(p, 'tick', 'tick'); } }
    const di = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function (...a) { const t = performance.now(); const r = di.apply(this, a); const k = a[0] instanceof HTMLVideoElement ? 'dVideo' : 'dCanvas'; window.__c[k] = (window.__c[k] || 0) + performance.now() - t; return r; };
    const ts = WebGL2RenderingContext.prototype.texSubImage2D; WebGL2RenderingContext.prototype.texSubImage2D = function (...a) { const t = performance.now(); const r = ts.apply(this, a); window.__c.tsub = (window.__c.tsub || 0) + performance.now() - t; return r; };
    let last = 0;
    const f = (t) => { if (last) window.__log.push([t, t - last, window.__label, window.__c]); window.__c = { up: 0, px: 0 }; last = t; requestAnimationFrame(f); };
    requestAnimationFrame(f);
    return navigator.userAgent + ' dpr ' + devicePixelRatio + ' pr ' + ocean.renderer.getPixelRatio() + ' size ' + innerWidth + 'x' + innerHeight;
  `));
  const L = (s) => run('window.__label = arguments[0]', [s]);
  await run('window.begin()'); await wait(3500);
  await run('window.portfolio.pickUp()'); await wait(4000);
  const max = await run('return window.portfolio.maxSpread()');
  for (let s = 0; s <= max; s++) { await run('window.portfolio.flipTo(arguments[0], true)', [s]); await wait(900); await L('held ' + s); await wait(2500); }
  await L('x'); await run('window.portfolio.flipTo(0, true)'); await wait(1200);
  await L('rapid fwd'); for (let s = 0; s < max + 2; s++) { await run('window.portfolio.next()'); await wait(150); }
  await L('x'); await wait(800);
  await L('rapid back'); for (let s = 0; s < max + 2; s++) { await run('window.portfolio.prev()'); await wait(150); }
  await L('x'); await wait(800);
  await L('slow turns'); for (let s = 0; s < max; s++) { await run('window.portfolio.next()'); await wait(700); }
  await L('x'); await wait(500);
  await run('window.portfolio.lower()'); await wait(1500); await L('scene'); await wait(3000);
  const log = await run('return window.__log');
  const by = {};
  for (const [, d, l, c] of log) (by[l] = by[l] || []).push([d, c]);
  for (const [l, es] of Object.entries(by)) {
    if (l === 'idle' || l === 'x') continue;
    const ds = es.map((e) => e[0]).sort((a, b) => a - b);
    const avg = (k) => (es.reduce((s, e) => s + (e[1][k] || 0), 0) / es.length).toFixed(2);
    const mb = (es.reduce((s, e) => s + e[1].px * 4, 0) / 1e6 / (es.reduce((s, e) => s + e[0], 0) / 1000)).toFixed(0);
    console.log(l.padEnd(12), 'n', String(es.length).padStart(4), 'p50', ds[ds.length >> 1].toFixed(1), 'p95', ds[Math.floor(ds.length * 0.95)].toFixed(1), 'max', ds[ds.length - 1].toFixed(1), '>25:', ds.filter((d) => d > 25).length, '| book', avg('book'), 'tick', avg('tick'), 'live', avg('live'), 'patch', avg('patch'), 'texSub', avg('tsub'), 'drawVid', avg('dVideo'), 'drawCanvas', avg('dCanvas'), 'prefetch', avg('prefetch'), '| upload MB/s', mb);
  }
  const spikes = [];
  for (const [t, d, l, c] of spikes) console.log(`  ${l} ${d.toFixed(0)}ms  render ${(c.render || 0).toFixed(1)} world ${(c.world || 0).toFixed(1)} book ${(c.book || 0).toFixed(1)} uploads ${c.up}`);
} finally {
  await req('DELETE', S);
}
