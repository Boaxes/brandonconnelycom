// usage: node safari-upload.mjs [url]   Safari: cost of texSubImage2D from a main-memory canvas, by size
const URL = process.argv[2] || 'http://localhost:5173/';
const WD = 'http://localhost:4444';
const req = async (method, path, body) => { const r = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const { sessionId } = await req('POST', '/session', { capabilities: { alwaysMatch: { browserName: process.env.BROWSER || 'safari' } } });
const S = `/session/${sessionId}`;
try {
  await req('POST', S + '/window/rect', { x: 0, y: 0, width: 1200, height: 800 });
  await req('POST', S + '/url', { url: URL });
  await new Promise((r) => setTimeout(r, 2000));
  console.log(await req('POST', S + '/execute/sync', { args: [], script: `
    const gl = document.createElement('canvas').getContext('webgl2');
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, 1024, 1434);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const out = [];
    const sizes = [[844,116],[512,512],[700,600],[724,724],[800,640],[872,514],[900,560],[916,600],[916,674],[1024,512],[1024,520],[1024,700],[916,225]];
    for (const [w, h] of sizes) {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, w, h); g.fillStyle = '#333'; g.font = '30px serif'; g.fillText('x', 10, 40);
      let t = 0;
      for (let i = 0; i < 12; i++) { g.fillRect(i, i, 3, 3); const s = performance.now(); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c); t += performance.now() - s; }
      const d = g.getImageData(0, 0, w, h).data;
      let t2 = 0;
      for (let i = 0; i < 12; i++) { const s = performance.now(); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d); t2 += performance.now() - s; }
      let t3 = 0;
      for (let i = 0; i < 12; i++) { g.fillRect(i, i, 3, 3); const s = performance.now(); const dd = g.getImageData(0, 0, w, h).data; t3 += performance.now() - s; }
      out.push(w + 'x' + h + ' (' + (w * h / 1e6).toFixed(2) + ' Mpx): canvas ' + (t / 12).toFixed(2) + ' ms, typed array ' + (t2 / 12).toFixed(2) + ' ms, getImageData ' + (t3 / 12).toFixed(2) + ' ms');
    }
    return out.join('\\n');
  ` }));
} finally { await req('DELETE', S); }
