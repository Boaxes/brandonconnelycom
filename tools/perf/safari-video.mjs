// usage: node safari-video.mjs [url]   video frame rates, and the cost of each way of getting a video frame into WebGL, in Safari
const URL = process.argv[2] || 'http://localhost:5173/';
const WD = 'http://localhost:4444';
const req = async (method, path, body) => { const r = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message); return j.value; };
const { sessionId } = await req('POST', '/session', { capabilities: { alwaysMatch: { browserName: process.env.BROWSER || 'safari' } } });
const S = `/session/${sessionId}`;
try {
  await req('POST', S + '/timeouts', { script: 180000 });
  await req('POST', S + '/window/rect', { x: 0, y: 0, width: 1200, height: 800 });
  await req('POST', S + '/url', { url: URL });
  await new Promise((r) => setTimeout(r, 3000));
  const out = await req('POST', S + '/execute/async', { args: [], script: `
    const done = arguments[arguments.length - 1];
    (async () => {
      const files = ['tegu-seed1', 'reptile-demo', 'ne-cosine'];
      const gl = document.createElement('canvas').getContext('webgl2');
      const res = {};
      for (const f of files) {
        const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.src = '/portfolio/' + f + '.mp4';
        await v.play(); await new Promise((r) => setTimeout(r, 500));
        // frame rate
        let n = 0; const t0 = performance.now();
        await new Promise((r) => { const cb = () => { n++; if (performance.now() - t0 < 2000) v.requestVideoFrameCallback(cb); else r(); }; v.requestVideoFrameCallback(cb); });
        const fps = n / ((performance.now() - t0) / 1000);
        // 1. video -> WebGL texture directly
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, v.videoWidth, v.videoHeight);
        let a = 0; for (let i = 0; i < 20; i++) { await new Promise((r) => v.requestVideoFrameCallback(r)); const t = performance.now(); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, v); a += performance.now() - t; }
        // 2. video -> 2D canvas -> WebGL
        const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext('2d');
        let b = 0; for (let i = 0; i < 20; i++) { await new Promise((r) => v.requestVideoFrameCallback(r)); const t = performance.now(); g.drawImage(v, 0, 0); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c); b += performance.now() - t; }
        // 3. createImageBitmap(video) (async), then into a main-memory canvas, then WebGL
        const c2 = document.createElement('canvas'); c2.width = v.videoWidth; c2.height = v.videoHeight; const g2 = c2.getContext('2d', { willReadFrequently: true });
        let cb = 0, ca = 0; for (let i = 0; i < 20; i++) { await new Promise((r) => v.requestVideoFrameCallback(r)); const t0 = performance.now(); const bm = await createImageBitmap(v); const t1 = performance.now(); g2.drawImage(bm, 0, 0); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c2); bm.close(); ca += t1 - t0; cb += performance.now() - t1; }
        // 4. the same, but the main-memory canvas draws the video element itself
        let d = 0; for (let i = 0; i < 20; i++) { await new Promise((r) => v.requestVideoFrameCallback(r)); const t = performance.now(); g2.drawImage(v, 0, 0); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c2); d += performance.now() - t; }
        // main-thread busy time during the async createImageBitmap: sample with a busy-probe
        let blocked = 0; for (let i = 0; i < 10; i++) { await new Promise((r) => v.requestVideoFrameCallback(r)); const p = createImageBitmap(v); const t = performance.now(); let n = 0; let done = false; p.then((b) => { done = true; b.close(); }); while (!done && performance.now() - t < 50) { await Promise.resolve(); n++; if (n % 50 === 0) await new Promise((r) => setTimeout(r, 0)); } blocked += performance.now() - t; }
        res[f] = { w: v.videoWidth, h: v.videoHeight, fps: +fps.toFixed(1), direct: +(a / 20).toFixed(2), viaCanvas: +(b / 20).toFixed(2), bitmapAsyncWait: +(ca / 20).toFixed(2), bitmapThenCpuCanvasUpload: +(cb / 20).toFixed(2), cpuCanvasVideo: +(d / 20).toFixed(2) };
        v.pause();
      }
      done(res);
    })().catch((e) => done(String(e)));
  ` });
  console.log(out);
} finally { await req('DELETE', S); }
