// usage: node texmem.mjs [url]   GPU memory of the scene's textures (uncompressed RGBA8 with mipmaps), biggest first
import puppeteer from 'puppeteer-core';
const URL = process.argv[2] || 'http://localhost:5173/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--no-first-run'] });
const page = (await browser.pages())[0];
await page.goto(URL);
await page.waitForFunction(() => typeof window.begin === 'function' && window.portfolio, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 3000));
console.log(await page.evaluate(() => {
  const seen = new Map();
  window.ocean.scene.traverse((o) => {
    if (!o.material) return;
    for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap']) {
      const t = m[k]; if (!t || !t.image || seen.has(t)) continue;
      const w = t.image.width, h = t.image.height;
      // (a compressed texture: the bytes of its mip levels as they go to the GPU)
      const mb = t.isCompressedTexture ? t.mipmaps.reduce((s, m) => s + m.data.byteLength, 0) / 1e6 : w * h * 4 * 1.333 / 1e6;
      seen.set(t, { who: (o.name || '?') + '.' + k + (t.isCompressedTexture ? ' (compressed)' : ''), w, h, mb });
    }
    const u = m => m && m.uniforms; for (const m of [].concat(o.material)) { const U = u(m); if (U) for (const [k, v] of Object.entries(U)) { const t = v && v.value; if (t && t.isTexture && t.image && !seen.has(t)) seen.set(t, { who: (o.name || '?') + '.' + k, w: t.image.width, h: t.image.height, mb: t.image.width * t.image.height * 4 * 1.333 / 1e6 }); } }
  });
  const rows = [...seen.values()].sort((a, b) => b.mb - a.mb);
  const total = rows.reduce((s, r) => s + r.mb, 0);
  return rows.slice(0, 24).map((r) => `${r.mb.toFixed(1).padStart(6)} MB ${r.w}x${r.h} ${r.who}`).join('\n') + `\n TOTAL scene textures (excl. book pages, render targets): ${total.toFixed(0)} MB in ${rows.length} textures`;
}));
await browser.close();
