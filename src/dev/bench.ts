/**
 * Dev only (?bench): a benchmark that runs on the device itself, for phones, where the desktop tools can't
 * see. It takes the book up and times frames on a still spread, an animated one, one with screen recordings,
 * while flipping fast, and on the animated spread with one cost at a time switched off; then with the book
 * down. After each step the results so far are POSTed to the dev server (/__perf -> .shots/perf-*.json),
 * so a tab the phone kills part way still reports.
 *
 * "sync" is the time to render a frame and wait for the GPU to finish it (a one-pixel readPixels after the
 * render): a stand-in for GPU time where there are no timer queries (Safari).
 */
type Fn = (...a: never[]) => unknown;
type Obj = Record<string, unknown>;

const W = window as unknown as Obj;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean, ms = 20000) => {
  const t0 = performance.now();
  while (!ok() && performance.now() - t0 < ms) await wait(100);
};

const samples: Record<string, number[]> = {};
let recording = false;
const add = (k: string, v: number) => { if (recording) (samples[k] ??= []).push(v); };

/** time every call of obj[name] under `key` */
function timeIt(obj: Obj, name: string, key: string) {
  const f = obj[name] as Fn;
  obj[name] = function (this: unknown, ...a: never[]) {
    const t0 = performance.now();
    const r = f.apply(this, a);
    add(key, performance.now() - t0);
    return r;
  };
}

/** swap obj[name] for `with` while running `body`, then put it back */
async function without(obj: Obj, name: string, stub: unknown, body: () => Promise<void>) {
  const saved = obj[name];
  obj[name] = stub;
  try { await body(); } finally { obj[name] = saved; }
}

const q = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const r1 = (x: number) => Math.round(x * 10) / 10;

export async function run() {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:8px;top:calc(8px + env(safe-area-inset-top));z-index:99999;font:12px/1.35 monospace;'
    + 'background:rgba(0,0,0,.72);color:#fff;padding:6px 8px;border-radius:6px;pointer-events:none;max-width:90vw;white-space:pre-wrap';
  document.body.appendChild(panel);
  const say = (s: string) => { panel.textContent = s; };
  say('bench: loading…');
  await until(() => typeof W.begin === 'function' && !!W.portfolio, 120000);

  const ocean = W.ocean as Obj & { renderer: Obj & { getContext(): WebGL2RenderingContext; getPixelRatio(): number; setPixelRatio(n: number): void; domElement: HTMLCanvasElement; shadowMap: Obj }; scene: Obj & { getObjectByName(n: string): Obj }; resize(): void };
  const book = W.portfolio as Obj & { pages: (Obj & { live: unknown; frames: unknown; liveRects: { w: number; h: number }[] })[]; reading: boolean; busy: boolean; onePage: boolean; root: Obj; showPage(i: number, q?: boolean): void; next(): void; lower(): void; pickUp(): void; state: string; page: number };
  const world = W.world as Obj;
  const gl = ocean.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const meta = {
    ua: navigator.userAgent,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    css: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio,
    pr: ocean.renderer.getPixelRatio(),
    canvas: `${ocean.renderer.domElement.width}x${ocean.renderer.domElement.height}`,
    onePage: book.onePage,
    cores: navigator.hardwareConcurrency,
  };
  if (new URLSearchParams(location.search).get('bench') === 'upload') {
    const { runUpload } = await import('./upload');
    await runUpload(say, meta);
    (ocean.renderer as unknown as { resetState(): void }).resetState();
    return;
  }
  // the pixel ratio stays where it starts (the adaptive step-down would move under the measurements)
  ocean.adapt = () => {};

  // frame intervals, and the JS time of each frame
  const raf = window.requestAnimationFrame.bind(window);
  let lastT = 0;
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (lastT) add('interval', t - lastT);
    lastT = t;
    const t0 = performance.now();
    cb(t);
    add('js', performance.now() - t0);
  });
  timeIt(world, 'update', 'world');
  timeIt(book, 'update', 'book');
  timeIt(book, 'tickPages', 'pages');
  timeIt(book, 'refresh', 'upload');
  timeIt(book, 'patch', 'patch');
  timeIt(ocean, 'render', 'render');
  for (const p of [book.o && (book.o as Obj).inside, ...book.pages].filter(Boolean) as Obj[]) {
    timeIt(p, 'tick', 'draw');
    timeIt(p, 'ensure', 'redraw');
  }
  // sync mode: each render waits for the GPU
  let sync = false;
  const px = new Uint8Array(4);
  const render = ocean.render as Fn;
  ocean.render = function (this: unknown, ...a: never[]) {
    if (!sync) return render.apply(this, a);
    const t0 = performance.now();
    render.apply(this, a);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    add('sync', performance.now() - t0);
  };

  const results: Obj[] = [];
  const post = () => fetch('/__perf', { method: 'POST', body: JSON.stringify({ meta, results }) }).catch(() => {});
  const names: string[] = [];
  const measure = async (name: string, ms = 3000) => {
    names.push(name);
    say(`bench ${names.length}: ${name}\n` + results.map((r) => `${r.name}: ${r.fps} fps, sync ${r.sync} ms`).join('\n'));
    await wait(700);
    for (const k in samples) delete samples[k];
    recording = true;
    await wait(ms);
    recording = false;
    const iv = samples.interval ?? [];
    const res: Obj = {
      name,
      fps: Math.round(1000 / (iv.reduce((a, b) => a + b, 0) / Math.max(1, iv.length))),
      frame: { med: r1(q(iv, 0.5)), p90: r1(q(iv, 0.9)), max: r1(q(iv, 1)), over34: iv.filter((x) => x > 34).length, n: iv.length },
      js: {} as Obj,
    };
    for (const k of ['js', 'world', 'book', 'pages', 'draw', 'upload', 'patch', 'redraw', 'render']) {
      const a = samples[k] ?? [];
      (res.js as Obj)[k] = { med: r1(q(a, 0.5)), p90: r1(q(a, 0.9)), max: r1(q(a, 1)), perFrame: r1(a.reduce((x, y) => x + y, 0) / Math.max(1, iv.length)), n: a.length };
    }
    // then the GPU's share, frame by frame
    for (const k in samples) delete samples[k];
    sync = true;
    recording = true;
    await wait(1500);
    recording = false;
    sync = false;
    res.sync = r1(q(samples.sync ?? [], 0.5));
    results.push(res);
    await post();
  };

  // ---- the book up
  (W.begin as () => void)();
  await wait(3000);
  book.pickUp();
  await until(() => book.reading);
  await wait(1500);

  const pages = book.pages;
  const spreadOf = (i: number) => Math.floor((i + 1) / 2);
  const pair = (i: number) => { const s = spreadOf(i); return [pages[2 * s - 1], pages[2 * s]].filter(Boolean); };
  const stillAt = pages.findIndex((_, i) => i > 2 && pair(i).every((p) => !p.live));
  const animAt = pages.findIndex((p) => p.live && !p.frames);
  const videoAt = pages.findIndex((p) => p.live && p.frames);
  Object.assign(meta, { pages: pages.length, stillAt, animAt, videoAt });
  const go = async (i: number) => {
    book.showPage(i, true);
    await wait(300);
    await until(() => !book.busy);
    await wait(500);
  };

  if (new URLSearchParams(location.search).get('bench') === 'patch') {
    (meta as Obj).mode = 'patch';
    await patchVariants(book as unknown as Obj, ocean.renderer as unknown as Renderer, measure, go, animAt, videoAt, add);
    say('bench done — results sent\n' + results.map((r) => `${r.name}: ${r.fps} fps`).join('\n'));
    return;
  }
  await go(stillAt);
  await measure('still page');
  if (animAt >= 0) { await go(animAt); await measure('animated page'); }
  if (videoAt >= 0) { await go(videoAt); await measure('video page'); await go(stillAt); }

  // flipping fast from the still page on
  await go(stillAt);
  let flipping = true;
  const flipper = (async () => { while (flipping) { book.next(); await wait(280); } })();
  await measure('flipping fast', 3500);
  flipping = false;
  await flipper;
  await wait(800);

  // the animated spread with one thing at a time taken away
  const at = animAt >= 0 ? animAt : videoAt;
  if (at >= 0) {
    await go(at);
    await measure('anim: again');
    const lives = pages.map((p) => p.live);
    pages.forEach((p) => (p.live = null));
    await measure('anim: no page animation');
    pages.forEach((p, i) => (p.live = lives[i]));
    await without(book, 'refresh', () => {}, () => measure('anim: drawn, not uploaded'));
    await without(gl as unknown as Obj, 'generateMipmap', () => {}, () => measure('anim: no mipmaps'));
    await without(book.root, 'visible', false, () => measure('anim: book hidden'));
  }
  const pr = ocean.renderer.getPixelRatio();
  ocean.renderer.setPixelRatio(1);
  ocean.resize();
  await measure('pixel ratio 1');
  ocean.renderer.setPixelRatio(pr);
  ocean.resize();
  await without(ocean.renderer.shadowMap, 'autoUpdate', false, () => measure('no shadow pass'));
  const life = ocean.scene.getObjectByName('life');
  if (life) await without(life, 'visible', false, () => measure('no animals'));
  await without(ocean.water as Obj, 'render', () => {}, () => measure('no water pass'));

  // ---- the book down
  book.lower();
  await wait(1500);
  await measure('book down');
  say('bench done — results sent\n' + results.map((r) => `${r.name}: ${r.fps} fps, sync ${r.sync} ms`).join('\n'));
}

type Rect = { x: number; y: number; w: number; h: number };
type PageLike = { g: CanvasRenderingContext2D; canvas: HTMLCanvasElement; liveBounds: Rect; liveRects: Rect[] };
type Renderer = {
  getContext(): WebGL2RenderingContext;
  properties: { get(o: unknown): { __webglTexture?: WebGLTexture; __version?: number } };
  state: { bindTexture(target: number, t: WebGLTexture | null, unit?: number): void; bindFramebuffer(target: number, fb: WebGLFramebuffer | null): boolean; pixelStorei(p: number, v: number | boolean): void; disable(cap: number): void };
};
type Tex = { version: number; flipY: boolean; premultiplyAlpha: boolean; unpackAlignment: number };

/**
 * The book's own upload of a page's moving parts (Book3D.patch) swapped for other ways of doing it, each
 * timed in the real frame on the animated page and the page of screen recordings.
 */
async function patchVariants(book: Obj, r: Renderer, measure: (n: string, ms?: number) => Promise<void>,
  go: (i: number) => Promise<void>, animAt: number, videoAt: number, add: (k: string, v: number) => void) {
  const gl = r.getContext();
  const PH = 1434;
  /** bound and ready for a partial copy, as Book3D.patch checks; null if the whole page must go */
  const ready = (page: PageLike, t: Tex) => {
    if (!page.liveRects.length) return null;
    const props = r.properties.get(t);
    if (!props.__webglTexture || props.__version !== t.version) return null;
    return props.__webglTexture;
  };
  const unpack = (t: Tex) => {
    r.state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, t.flipY);
    r.state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, t.premultiplyAlpha);
    r.state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    r.state.pixelStorei(gl.UNPACK_ALIGNMENT, t.unpackAlignment);
  };
  const cache = new Map<string, Uint8ClampedArray>();
  const patches = new Map<string, CanvasRenderingContext2D>();
  const staging = gl.createTexture()!;
  const readFb = gl.createFramebuffer()!;
  const drawFb = gl.createFramebuffer()!;
  const variants: [string, (page: PageLike, t: Tex) => boolean][] = [
    ['now: getImageData + texSub', (page, t) => (book.__patch as (p: PageLike, t: Tex) => boolean).call(book, page, t)],
    ['getImageData only (no upload)', (page, t) => {
      if (!ready(page, t)) return false;
      const rc = page.liveBounds;
      page.g.getImageData(rc.x, rc.y, rc.w, rc.h);
      return true;
    }],
    ['texSub of a kept array (no getImageData)', (page, t) => {
      const wt = ready(page, t);
      if (!wt) return false;
      const rc = page.liveBounds;
      const k = `${rc.x},${rc.y},${rc.w},${rc.h}`;
      let d = cache.get(k);
      if (!d) cache.set(k, (d = page.g.getImageData(rc.x, rc.y, rc.w, rc.h).data));
      r.state.bindTexture(gl.TEXTURE_2D, wt, gl.TEXTURE0);
      unpack(t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rc.x, t.flipY ? PH - rc.y - rc.h : rc.y, rc.w, rc.h, gl.RGBA, gl.UNSIGNED_BYTE, d);
      gl.generateMipmap(gl.TEXTURE_2D);
      return true;
    }],
    ['staging texture + GPU blit', (page, t) => {
      const wt = ready(page, t);
      if (!wt) return false;
      const rc = page.liveBounds;
      const d = page.g.getImageData(rc.x, rc.y, rc.w, rc.h).data;
      r.state.bindTexture(gl.TEXTURE_2D, staging, gl.TEXTURE0);
      unpack(t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, rc.w, rc.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
      r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
      r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFb);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, wt, 0);
      r.state.disable(gl.SCISSOR_TEST);
      const y = t.flipY ? PH - rc.y - rc.h : rc.y;
      gl.blitFramebuffer(0, 0, rc.w, rc.h, rc.x, y, rc.x + rc.w, y + rc.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      r.state.bindTexture(gl.TEXTURE_2D, wt, gl.TEXTURE0);
      gl.generateMipmap(gl.TEXTURE_2D);
      return true;
    }],
    ['patch canvas -> texSub(canvas)', (page, t) => {
      const wt = ready(page, t);
      if (!wt) return false;
      const rc = page.liveBounds;
      const k = rc.w + 'x' + rc.h;
      let g = patches.get(k);
      if (!g) {
        const c = document.createElement('canvas');
        c.width = rc.w;
        c.height = rc.h;
        g = c.getContext('2d')!;
        g.globalCompositeOperation = 'copy';
        patches.set(k, g);
      }
      g.drawImage(page.canvas, rc.x, rc.y, rc.w, rc.h, 0, 0, rc.w, rc.h);
      r.state.bindTexture(gl.TEXTURE_2D, wt, gl.TEXTURE0);
      unpack(t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rc.x, t.flipY ? PH - rc.y - rc.h : rc.y, gl.RGBA, gl.UNSIGNED_BYTE, g.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      return true;
    }],
    ['whole page each time (three)', () => false],
  ];
  book.__patch = (Object.getPrototypeOf(book) as Obj).patch;
  for (const [label, at] of [['anim', animAt], ['video', videoAt]] as const) {
    if (at < 0) continue;
    await go(at);
    for (const [name, fn] of variants) {
      book.patch = function (page: PageLike, t: Tex) {
        const t0 = performance.now();
        const ok = fn(page, t);
        add('patch', performance.now() - t0);
        return ok;
      };
      await measure(`${label}: ${name}`);
    }
  }
  delete book.patch; // (back to Book3D's own)
}
