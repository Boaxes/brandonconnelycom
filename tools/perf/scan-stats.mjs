// usage: node scan-stats.mjs [url]   triangles, instances and texture sizes of every mesh in the scene; what's drawn per view
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--no-first-run', '--window-size=1440,990'] });
const page = (await browser.pages())[0];
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL);
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 4000));
const out = await page.evaluate(async () => {
  const rows = [];
  window.ocean.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry; const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const tex = m && m.map && m.map.image ? `${m.map.image.width}x${m.map.image.height}` : '';
    rows.push({ name: o.name || o.parent?.name || o.type, tris: Math.round(tris), inst: n, cap: o.isInstancedMesh ? o.instanceMatrix.count : 1, culled: o.frustumCulled, shadow: o.castShadow, tex });
  });
  rows.sort((a, b) => b.tris * Math.max(1, b.inst) - a.tris * Math.max(1, a.inst));
  window.begin();
  await new Promise((r) => setTimeout(r, 3500));
  window.portfolio.pickUp();
  await new Promise((r) => setTimeout(r, 4000));
  window.portfolio.lower();
  await new Promise((r) => setTimeout(r, 2000));
  const views = [];
  const r = window.ocean.renderer;
  r.info.autoReset = false;
  for (let k = 0; k < 8; k++) {
    r.info.reset(); window.ocean.render(window.world.time, 0);
    views.push(`${window.rig.heading}: ${(r.info.render.triangles / 1e6).toFixed(2)}M tris, ${r.info.render.calls} calls`);
    window.rig.step(1, 0); await new Promise((res) => setTimeout(res, 900));
  }
  r.info.autoReset = true;
  const cam = window.ocean.camera.position;
  const sp = [];
  for (const [key, p] of window.world.pops) {
    const ms = p.renderer.meshes; const m = { count: ms.reduce((s, x) => s + x.count, 0) }; const tris = ms.reduce((s, x) => s + x.count * (x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position.count) / 3, 0) / Math.max(1, m.count);
    const d = p.agents.filter((a) => a.alive).map((a) => a.pos.distanceTo(cam)).sort((a, b) => a - b);
    const near = d.filter((x) => x < 20);
    sp.push({ key, tris, alive: d.length, drawn: m.count, triTotal: tris * m.count, dmin: d[0]?.toFixed(1), dmed: d[d.length >> 1]?.toFixed(1), over8: near.filter((x) => x > 8).length });
  }
  sp.sort((a, b) => b.triTotal - a.triTotal);
  views.push('--- species now: ' + sp.map((x) => `${x.key} ${x.drawn}×${x.tris} = ${(x.triTotal / 1000).toFixed(0)}k (nearest ${x.dmin} m, median ${x.dmed} m, ${x.over8} drawn beyond 8 m)`).join('\n'));
  return { rows: rows.slice(0, 30), views, geoMem: r.info.memory };
});
for (const x of out.rows) console.log(String(x.tris).padStart(8), 'tris ×', String(x.inst).padStart(3), `(cap ${x.cap})`, x.culled ? 'culled ' : 'ALWAYS ', x.shadow ? 'shadow' : '      ', x.tex.padEnd(10), x.name);
console.log(out.views.join('\n'), JSON.stringify(out.geoMem));
await browser.close();
