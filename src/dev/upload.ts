/**
 * Dev only (?bench=upload): the ways of getting part of a page canvas into a WebGL texture, timed on the
 * device. Each is run a number of times over the moving area of a real page, the canvas drawn on before
 * every copy (as an animation would), with a one-pixel readPixels at the end so the GPU's work counts too.
 * Results are POSTed to /__perf like the main benchmark.
 */
type Obj = Record<string, unknown>;
type Rect = { x: number; y: number; w: number; h: number };
const W = window as unknown as Obj;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PW = 1024;
const PH = 1434;

export async function runUpload(say: (s: string) => void, meta: Obj) {
  const ocean = W.ocean as { renderer: { getContext(): WebGL2RenderingContext } };
  const book = W.portfolio as { pages: { live: unknown; frames: unknown; liveBounds: Rect; liveRects: Rect[] }[] };
  const gl = ocean.renderer.getContext();
  const anim = book.pages.find((p) => p.live && !p.frames && p.liveRects.length);
  const video = book.pages.find((p) => p.live && p.frames && p.liveRects.length);
  const rects: [string, Rect][] = [];
  if (anim) rects.push(['anim', anim.liveBounds]);
  if (video) rects.push(['video', video.liveBounds]);
  rects.push(['256sq', { x: 300, y: 400, w: 256, h: 256 }]);

  const make = (opts: CanvasRenderingContext2DSettings, w = PW, h = PH) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', opts)!;
    g.fillStyle = '#e8dfc9';
    g.fillRect(0, 0, w, h);
    return g;
  };
  const wrf = make({ willReadFrequently: true });
  const gpu = make({});
  let frame = 0;
  /** what an animation does: draw over the area */
  const scribble = (g: CanvasRenderingContext2D, r: Rect) => {
    frame++;
    g.fillStyle = `hsl(${frame * 17 % 360},40%,70%)`;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = '#223';
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 40; i++) g.lineTo(r.x + Math.random() * r.w, r.y + Math.random() * r.h);
    g.stroke();
  };

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 11, gl.SRGB8_ALPHA8, PW, PH);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const px = new Uint8Array(4);
  // a draw that samples the page texture (as the book does every frame), into a small target
  const sh = (type: number, src: string) => { const o = gl.createShader(type)!; gl.shaderSource(o, src); gl.compileShader(o); return o; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nout vec2 uv; void main(){ vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float; uniform sampler2D t; in vec2 uv; out vec4 c; void main(){ c = texture(t, uv); }'));
  gl.linkProgram(prog);
  const vao = gl.createVertexArray();
  const target = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 256, 358);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const drawWith = (t: WebGLTexture) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, 256, 358);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.flush();
  };
  const texB = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texB);
  gl.texStorage2D(gl.TEXTURE_2D, 11, gl.SRGB8_ALPHA8, PW, PH);
  for (const t of [tex, texB]) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // a small texture the moving area goes to first, then copied into the page's on the GPU
  const staging = gl.createTexture()!;
  const readFb = gl.createFramebuffer()!;
  const drawFb = gl.createFramebuffer()!;
  const viaStaging = (r: Rect, d: ArrayBufferView, into: WebGLTexture) => {
    gl.bindTexture(gl.TEXTURE_2D, staging);
    // (respecified each time: a fresh texture, never one the GPU is still busy with)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, r.w, r.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFb);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, into, 0);
    const y = yOf(r);
    gl.blitFramebuffer(0, 0, r.w, r.h, r.x, y, r.x + r.w, y + r.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, into);
  };
  let flipAB = false;
  const patchCanvases = new Map<string, CanvasRenderingContext2D>();
  const patchOf = (r: Rect, opts: CanvasRenderingContext2DSettings) => {
    const k = `${r.w}x${r.h}${opts.willReadFrequently ? 'r' : ''}`;
    let g = patchCanvases.get(k);
    if (!g) {
      g = make(opts, r.w, r.h);
      g.globalCompositeOperation = 'copy';
      patchCanvases.set(k, g);
    }
    return g;
  };
  const yOf = (r: Rect) => PH - r.y - r.h;

  const ways: [string, (r: Rect) => void | Promise<void>][] = [
    ['wrf getImageData+texSub(array) [now]', (r) => {
      scribble(wrf, r);
      const d = wrf.getImageData(r.x, r.y, r.w, r.h).data;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, d);
    }],
    ['wrf getImageData only', (r) => {
      scribble(wrf, r);
      wrf.getImageData(r.x, r.y, r.w, r.h);
    }],
    ['wrf texSub(array) only', (() => {
      let d: Uint8ClampedArray | null = null;
      return (r: Rect) => {
        d ??= wrf.getImageData(r.x, r.y, r.w, r.h).data;
        if (d.length !== r.w * r.h * 4) d = wrf.getImageData(r.x, r.y, r.w, r.h).data;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, d);
      };
    })()],
    ['wrf -> patch canvas -> texSub(canvas)', (r) => {
      scribble(wrf, r);
      const p = patchOf(r, {});
      p.drawImage(wrf.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), gl.RGBA, gl.UNSIGNED_BYTE, p.canvas);
    }],
    ['gpu -> patch canvas -> texSub(canvas)', (r) => {
      scribble(gpu, r);
      const p = patchOf(r, {});
      p.drawImage(gpu.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), gl.RGBA, gl.UNSIGNED_BYTE, p.canvas);
    }],
    ['gpu getImageData+texSub(array)', (r) => {
      scribble(gpu, r);
      const d = gpu.getImageData(r.x, r.y, r.w, r.h).data;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, d);
    }],
    ['wrf -> wrf patch -> getImageData+texSub', (r) => {
      scribble(wrf, r);
      const p = patchOf(r, { willReadFrequently: true });
      p.drawImage(wrf.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const d = p.getImageData(0, 0, r.w, r.h).data;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, d);
    }],
    ['gpu imageBitmap(rect) -> texSub', async (r) => {
      scribble(gpu, r);
      const b = await createImageBitmap(gpu.canvas, r.x, r.y, r.w, r.h);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), gl.RGBA, gl.UNSIGNED_BYTE, b);
      b.close();
    }],
    ['wrf whole page texSub(canvas)', (r) => {
      scribble(wrf, r);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, wrf.canvas);
    }],
    ['gpu whole page texSub(canvas)', (r) => {
      scribble(gpu, r);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, gpu.canvas);
    }],
    ['generateMipmap only', () => {
      gl.generateMipmap(gl.TEXTURE_2D);
    }],
    ['IN USE: getImageData+texSub+mip, draw [now]', (r) => {
      scribble(wrf, r);
      const d = wrf.getImageData(r.x, r.y, r.w, r.h).data;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, d);
      gl.generateMipmap(gl.TEXTURE_2D);
      drawWith(tex);
    }],
    ['IN USE: texSub, no mip, draw', (r) => {
      scribble(wrf, r);
      const d = wrf.getImageData(r.x, r.y, r.w, r.h).data;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, d);
      drawWith(tex);
    }],
    ['IN USE: patch canvas texSub+mip, draw', (r) => {
      scribble(gpu, r);
      const p = patchOf(r, {});
      p.drawImage(gpu.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), gl.RGBA, gl.UNSIGNED_BYTE, p.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      drawWith(tex);
    }],
    ['IN USE: staging + GPU blit + mip, draw', (r) => {
      scribble(wrf, r);
      const d = wrf.getImageData(r.x, r.y, r.w, r.h).data;
      viaStaging(r, d, tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      drawWith(tex);
    }],
    ['IN USE: two textures by turns +mip, draw', (r) => {
      scribble(wrf, r);
      const d = wrf.getImageData(r.x, r.y, r.w, r.h).data;
      flipAB = !flipAB;
      const t = flipAB ? texB : tex;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, yOf(r), r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, d);
      gl.generateMipmap(gl.TEXTURE_2D);
      drawWith(t);
    }],
  ];

  const results: Obj[] = [];
  const post = () => fetch('/__perf', { method: 'POST', body: JSON.stringify({ meta: { ...meta, mode: 'upload' }, results }) }).catch(() => {});
  const N = 12;
  const only = new URLSearchParams(location.search).get('only');
  for (const [rname, r] of rects) {
    for (const [name, fn] of ways) {
      if (only && !name.includes(only)) continue;
      say(`upload bench: ${rname} ${r.w}x${r.h}\n${name}`);
      await wait(50);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // once untimed (first-use costs), then N times, each timed, the last waiting for the GPU
      await fn(r);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const times: number[] = [];
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        const ti = performance.now();
        await fn(r);
        times.push(performance.now() - ti);
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const total = (performance.now() - t0) / N;
      times.sort((a, b) => a - b);
      results.push({ rect: `${rname} ${r.w}x${r.h}`, way: name, med: +times[N >> 1].toFixed(2), withGpu: +total.toFixed(2) });
      await post();
      // leave the browser a frame between tests
      await new Promise((res) => requestAnimationFrame(() => res(null)));
    }
  }
  for (const t of [tex, texB, staging, target]) gl.deleteTexture(t);
  for (const f of [fbo, readFb, drawFb]) gl.deleteFramebuffer(f);
  say('upload bench done — results sent');
}
