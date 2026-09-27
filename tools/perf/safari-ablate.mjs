// usage: node safari-ablate.mjs [url]   Safari: frame time with each render pass stubbed out (book held on a still page)
const URL = process.argv[2] || 'http://localhost:5173/';
const WD = 'http://localhost:4444';
const req = async (method, path, body) => { const r = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const { sessionId } = await req('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
const S = `/session/${sessionId}`;
const run = (script) => req('POST', S + '/execute/sync', { script, args: [] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await req('POST', S + '/window/rect', { x: 0, y: 0, width: Number(process.env.W || 1440), height: Number(process.env.H || 900) });
  await req('POST', S + '/url', { url: URL });
  for (let i = 0; i < 120; i++) { if (await run('return typeof window.begin === "function" && !!window.portfolio')) break; await wait(500); }
  await run(`window.__f = []; let last = 0; const f = (t) => { if (last) window.__f.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); if (${!!process.env.FIXPR}) { ocean.adapt = () => {}; ocean.renderer.setPixelRatio(${Number(process.env.FIXPR || 1)}); ocean.resize(); }`);
  await run('window.begin()'); await wait(3500);
  await run('window.portfolio.pickUp()'); await wait(4000);
  await run('window.portfolio.flipTo(6, true)'); await wait(1500);
  const ms = async () => { await wait(500); await run('window.__f = []'); await wait(2500); return run('const s = [...window.__f].sort((a, b) => a - b); return +s[s.length >> 1].toFixed(1) + "/" + (1000 / (window.__f.reduce((a, b) => a + b, 0) / window.__f.length)).toFixed(0) + "fps"'); };
  const T = { water: 'ocean.water.render', bloom: 'ocean.bloom.bloomOf', output: 'ocean.output.render', scene: 'ocean.scenePass.render', shadow: 'ocean.renderer.shadowMap.render' };
  const info = await run('return "pr " + ocean.renderer.getPixelRatio() + " canvas " + ocean.renderer.domElement.width + "x" + ocean.renderer.domElement.height');
  for (const st of ['held', 'scene']) {
    if (st === 'scene') { await run('window.portfolio.lower()'); await wait(2000); }
    const out = ['base ' + await ms()];
    for (const [k, path] of Object.entries(T)) {
      await run(`window.__o = ${path}; ${path} = ${k === 'bloom' ? '() => ocean.bloom.renderTargetsHorizontal[0].texture' : '() => {}'};`);
      out.push(k + '-off ' + await ms());
      await run(`${path} = window.__o;`);
    }
    await run('ocean.scene.getObjectByName("life").visible = false'); out.push('no-animals ' + await ms()); await run('ocean.scene.getObjectByName("life").visible = true');
    await run('ocean.particles.visible = false'); out.push('no-particles ' + await ms()); await run('ocean.particles.visible = true');
    console.log(info, st, out.join(' | '));
  }
} finally { await req('DELETE', S); }
