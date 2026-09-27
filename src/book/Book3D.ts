import * as THREE from 'three';
import { CANVAS_OPTIONS, Page, PAGE_H, PAGE_W, WEBKIT } from './Page';

/**
 * A real 3D book: leather covers on a hinge, page blocks, and one leaf that curls over the spine
 * when a page is turned. Pages are canvases (see Page.ts) shown as textures.
 *
 * Book-local frame: the spine runs along +Y at x = 0, pages lie in the XY plane and face +Z (the reader).
 * The right-hand block sits on x ∈ [0, W], the left on x ∈ [-W, 0].
 *
 * States: resting somewhere in the world (closed) → lifted to the camera and opened → held (reading)
 * ⇄ lowered out of view (watching the water) → put away.
 */
export type BookState = 'rest' | 'lifting' | 'held' | 'lowering' | 'lowered' | 'raising';
export type BookSound = 'pickup' | 'open' | 'close' | 'page' | 'lower' | 'raise';

export interface BookOptions {
  width: number;        // one page (m)
  height: number;
  thickness: number;    // page block (m)
  cover: number;        // leather tint
  foil: string;         // title colour
  title: string[];      // cover lines, first is largest
  endpaper: string;
  /** a page pasted inside the front cover, facing the first page (in place of the plain endpaper) */
  inside?: Page;
  leather: { map: THREE.Texture; normal: THREE.Texture };
}

const LEAF_SEG = 28;
const FLIP_TIME = 0.32;
const QUICK_FLIP = 0.22;
/** a turn hurrying to land because another was asked for: a whole turn would take this long */
const RUSH_FLIP = 0.12;
const OPEN_TIME = 0.5;
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _light = new THREE.Vector3(-0.3, 0.35, 1).normalize();

function ease(t: number) { return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; }

export class Book3D {
  root = new THREE.Group();
  state: BookState = 'lowered';
  /** index of the current spread: left page = 2s - 1, right page = 2s */
  spread = 0;
  onSound: ((s: BookSound) => void) | null = null;
  pages: Page[];

  private W: number;
  private H: number;
  private th: number;
  private ct = 0.004; // cover board thickness
  private frontPivot = new THREE.Group();
  private leftBlock: THREE.Mesh;
  private rightBlock: THREE.Mesh;
  private leftPage: THREE.Mesh;
  private rightPage: THREE.Mesh;
  private leafFront: THREE.Mesh;
  private leafBack: THREE.Mesh;
  private leafGeoF: THREE.PlaneGeometry;
  private leafGeoB: THREE.PlaneGeometry;
  private leafPivot = new THREE.Group();
  private open = 0;           // cover angle 0..π
  private openTarget = 0;
  private openT = 0; // 0..1 through the opening swing
  private flip: { t: number; dir: 1 | -1; to: number; time: number; rush: boolean } | null = null;
  /** the spread asked for while a turn was under way: turned to as soon as it lands */
  private queued: number | null = null;
  /**
   * One page at a time (a phone held upright, where a spread would be too small to read): the book is
   * held closer and slides sideways to show the left or the right page of the spread.
   */
  onePage = false;
  /** one page at a time: which page of the spread is in view (0 left, 1 right) */
  private side: 0 | 1 = 0;
  /** how far the book has slid sideways to put that page in the middle (m) */
  private slide = 0;
  /** one page at a time: the page asked for while a turn was under way */
  private queuedPage: number | null = null;
  /** where things beside the book's right edge are anchored (the section buttons): moves and zooms with it */
  readonly edge = new THREE.Group();
  get pageWidth() { return this.W; }
  get pageHeight() { return this.H; }
  /** how far the open pages stand in front of the spine, toward the reader */
  get pageDepth() { return this.th / 2; }
  private anim = 1;           // pose transition 0..1
  private from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private rest = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  /** where a page's moving parts are copied out to on their way to the GPU, outside WebKit (one canvas per size) */
  private patches = new Map<string, CanvasRenderingContext2D>();
  /** each page's texture, and the page versions it holds (all of it, and the parts drawn in full) */
  private tex = new Map<Page, { t: THREE.CanvasTexture; v: number; full: number }>();
  private endTex: THREE.CanvasTexture;
  private clock = 0;
  private liveDt = 0;
  /** frame time, smoothed; and whether it's been running long enough to halve the pages' redraw rate */
  private frameDt = 1 / 60;
  private slow = false;

  constructor(private o: BookOptions, pages: Page[]) {
    this.pages = pages;
    this.W = o.width;
    this.H = o.height;
    this.th = o.thickness;
    const W = this.W;
    const H = this.H;
    const leather = new THREE.MeshStandardMaterial({
      map: o.leather.map, normalMap: o.leather.normal, color: o.cover, roughness: 0.62, metalness: 0,
    });
    // the endpapers are the page planes at either end (texFor gives them this); the boards' inner faces
    // are the leather turned in round them, as on a real hardback
    this.endTex = this.flatTexture(o.endpaper);
    const edge = new THREE.MeshStandardMaterial({ map: this.edgeTexture(), roughness: 0.9, color: 0xcfc5ae });
    const paperTop = new THREE.MeshBasicMaterial({ color: 0xe6dcc4 });

    // Built like a real book opened in the middle: two rigid halves hinged on the spine at mid-thickness.
    // The back half (back board, half the pages, the lower half of the spine) stays put; the front half
    // (front board, the other half of the pages, the upper half of the spine) is `frontPivot` and swings
    // over in one piece. Nothing is shown, hidden or resized as it opens, so no gap or pop can appear; open
    // flat, both halves' pages lie level at th/2.
    const turnIn = new THREE.MeshStandardMaterial({ map: o.leather.map, color: o.cover, roughness: 0.7, metalness: 0 });
    const board = new THREE.BoxGeometry(W + 0.005, H + 0.007, this.ct);
    const back = new THREE.Mesh(board, [leather, leather, leather, leather, turnIn, leather]);
    back.position.set(W / 2 + 0.0015, 0, -this.ct / 2);
    this.root.add(back);
    const front = new THREE.Mesh(board, [leather, leather, leather, leather, leather, turnIn]);
    front.position.set(W / 2 + 0.0015, 0, this.th / 2 + this.ct / 2);
    this.frontPivot.position.set(0, 0, this.th / 2);
    this.frontPivot.add(front);
    this.root.add(this.frontPivot);
    // gold title on the front cover
    const title = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.86, W * 0.86 * 1.2),
      new THREE.MeshStandardMaterial({ map: this.titleTexture(), transparent: true, metalness: 0.7, roughness: 0.35, color: 0xffffff }),
    );
    title.position.set(W / 2 + 0.002, H * 0.08, this.th / 2 + this.ct + 0.0006);
    this.frontPivot.add(title);
    // the spine, one half on each side of the hinge: closed they make one piece; open flat each folds away
    // inside the other half's pages, and in between they stay joined at the hinge (no hole where the spine was)
    const half = this.th / 2 + this.ct;
    const spineGeo = new THREE.BoxGeometry(this.ct, H + 0.007, half);
    const spineBack = new THREE.Mesh(spineGeo, leather);
    spineBack.position.set(-this.ct / 2, 0, this.th / 2 - half / 2);
    this.root.add(spineBack);
    const spineFront = new THREE.Mesh(spineGeo, leather);
    spineFront.position.set(-this.ct / 2, 0, half / 2); // (in the front half's frame, whose origin is the hinge)
    this.frontPivot.add(spineFront);

    // half the pages in each half
    const block = new THREE.BoxGeometry(W, H, this.th / 2);
    this.rightBlock = new THREE.Mesh(block, [edge, edge, edge, edge, paperTop, paperTop]);
    this.leftBlock = new THREE.Mesh(block, [edge, edge, edge, edge, paperTop, paperTop]);
    this.rightBlock.position.set(W / 2, 0, this.th / 4);
    this.leftBlock.position.set(W / 2, 0, this.th / 4);
    this.root.add(this.rightBlock);
    this.frontPivot.add(this.leftBlock);

    // the two visible pages
    const pg = new THREE.PlaneGeometry(W, H);
    this.leftPage = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xebe4d2 }));
    this.rightPage = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xebe4d2 }));
    this.leftPage.name = 'left';
    this.rightPage.name = 'right';
    // each on its half's inner face: the left one faces down while closed, and the reader once turned over
    this.rightPage.position.set(W / 2, 0, this.th / 2 + 0.0006);
    this.leftPage.position.set(W / 2, 0, -0.0006);
    this.leftPage.rotation.y = Math.PI;
    this.root.add(this.rightPage);
    this.frontPivot.add(this.leftPage);
    // the gutter: pages curve down into the spine, so they darken toward it
    const gutterTex = this.gutterTexture();
    const gw = W * 0.2;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(gw, H),
        new THREE.MeshBasicMaterial({ map: gutterTex, transparent: true, depthWrite: false, color: 0x000000, side: THREE.DoubleSide }),
      );
      if (side < 0) m.scale.x = -1;
      m.position.x = side * gw / 2;
      m.renderOrder = 2;
      (side < 0 ? this.leftPage : this.rightPage).add(m);
      m.position.x -= side * (W / 2);
      m.position.z = 0.0003;
    }

    // the turning leaf: two sides with their own UVs (the back reads mirrored otherwise)
    this.leafGeoF = new THREE.PlaneGeometry(W, H, LEAF_SEG, 1);
    this.leafGeoB = new THREE.PlaneGeometry(W, H, LEAF_SEG, 1);
    const uvB = this.leafGeoB.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvB.count; i++) uvB.setX(i, 1 - uvB.getX(i));
    // the leaf wears exactly the pages' paper tint; its shading comes from how it actually bends (vertex
    // colours, 1.0 when flat), so it never changes colour as it lifts off or lands
    for (const g of [this.leafGeoF, this.leafGeoB]) {
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
    }
    // (a texture from the start, though they get a page's at each turn, so the shaders built for them before
    // the first turn are the ones it uses)
    this.leafFront = new THREE.Mesh(this.leafGeoF, new THREE.MeshBasicMaterial({ side: THREE.FrontSide, color: 0xebe4d2, vertexColors: true, map: this.endTex }));
    this.leafBack = new THREE.Mesh(this.leafGeoB, new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0xebe4d2, vertexColors: true, map: this.endTex }));
    this.leafPivot.add(this.leafFront, this.leafBack);
    this.leafPivot.visible = false;
    this.root.add(this.leafPivot);

    this.root.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; }
    });
    // (at the cover board's edge, which stands a few mm proud of the pages)
    this.edge.position.set(W + 0.004, 0, this.th / 2 + 0.001);
    this.root.add(this.edge);
    this.layoutBlocks();
    this.showSpread();
  }

  // ---------------------------------------------------------------- textures

  private flatTexture(color: string) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private edgeTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#efe6cf';
    g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 2) {
      g.fillStyle = `rgba(120,100,70,${0.08 + Math.random() * 0.14})`;
      g.fillRect(0, y, 64, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private gutterTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 4;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.42)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 4);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  private titleTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 614;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = this.o.foil;
    g.strokeStyle = this.o.foil;
    g.textAlign = 'center';
    g.lineWidth = 3;
    g.strokeRect(22, 22, 468, 570);
    g.lineWidth = 1.5;
    g.strokeRect(34, 34, 444, 546);
    const [first, ...rest] = this.o.title;
    g.font = `46px 'Special Elite', monospace`;
    g.fillText(first.toUpperCase(), 256, 250);
    g.font = `26px 'Special Elite', monospace`;
    rest.forEach((l, i) => g.fillText(l.toUpperCase(), 256, 310 + i * 40));
    g.beginPath(); g.moveTo(196, 280); g.lineTo(316, 280); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  /** Page `i`; -1 is the one inside the front cover, if there is one. */
  private pageAt(i: number): Page | undefined {
    return i === -1 ? this.o.inside : this.pages[i];
  }

  private texFor(i: number): THREE.Texture {
    const page = this.pageAt(i);
    if (!page) return this.endTex;
    let e = this.tex.get(page);
    if (!e) {
      const t = new THREE.CanvasTexture(page.canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      e = { t, v: page.version, full: page.fullVersion };
      this.tex.set(page, e);
    } else this.upload(page, e);
    return e.t;
  }

  /** Re-upload any pages whose canvases were redrawn (their moving parts, or a picture arriving). */
  refresh() {
    for (const [page, e] of this.tex) this.upload(page, e);
  }

  /** The renderer, so an animating page can send just its moving parts to the GPU instead of the whole page. */
  renderer: THREE.WebGLRenderer | null = null;

  private upload(page: Page, e: { t: THREE.CanvasTexture; v: number; full: number }) {
    if (e.v === page.version) return;
    if (e.full !== page.fullVersion || !this.patch(page, e.t)) e.t.needsUpdate = true;
    e.v = page.version;
    e.full = page.fullVersion;
  }

  /**
   * Copy just the page's moving parts into its texture (a 1024×1434 page 30 times a second, twice over for
   * a spread, was most of what the GPU did for the book). Only once the whole page is on the GPU and no
   * full upload is waiting; false if it can't, and the whole page goes as before. One copy of the area
   * round all the moving parts: in WebKit each copy is a wait on the GPU process.
   */
  private patch(page: Page, t: THREE.CanvasTexture) {
    const r = this.renderer;
    if (!r || !page.liveRects.length) return false;
    const props = r.properties.get(t) as { __webglTexture?: WebGLTexture; __version?: number };
    if (!props.__webglTexture || props.__version !== t.version) return false;
    const gl = r.getContext() as WebGL2RenderingContext;
    const st = r.state;
    st.bindTexture(gl.TEXTURE_2D, props.__webglTexture, gl.TEXTURE0);
    // as three uploads it: flipped, straight alpha, no colour conversion (sRGB has the working space's primaries)
    st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, t.flipY);
    st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, t.premultiplyAlpha);
    st.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    st.pixelStorei(gl.UNPACK_ALIGNMENT, t.unpackAlignment);
    const rc = page.liveBounds;
    // (the texture is flipped: its rows count up from the bottom of the page)
    const y = t.flipY ? PAGE_H - rc.y - rc.h : rc.y;
    if (WEBKIT) {
      // the page canvas is in main memory: its pixels as a plain array (three times quicker there than
      // handing WebGL the canvas)
      const px = page.g.getImageData(rc.x, rc.y, rc.w, rc.h).data;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rc.x, y, rc.w, rc.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    } else {
      // the area copied onto a canvas of its own, which WebGL takes straight from the GPU
      const key = rc.w + 'x' + rc.h;
      let g = this.patches.get(key);
      if (!g) {
        const c = document.createElement('canvas');
        c.width = rc.w;
        c.height = rc.h;
        g = c.getContext('2d', CANVAS_OPTIONS)!;
        g.globalCompositeOperation = 'copy';
        this.patches.set(key, g);
      }
      g.drawImage(page.canvas, rc.x, rc.y, rc.w, rc.h, 0, 0, rc.w, rc.h);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rc.x, y, gl.RGBA, gl.UNSIGNED_BYTE, g.canvas);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    return true;
  }

  setPages(pages: Page[]) {
    this.pages = pages;
    this.spread = Math.min(this.spread, this.maxSpread());
    this.showSpread();
  }

  private setMap(mesh: THREE.Mesh, i: number) {
    const m = mesh.material as THREE.MeshBasicMaterial;
    const t = this.texFor(i);
    if (m.map !== t) {
      m.map = t;
      m.needsUpdate = true;
    }
  }

  private showSpread() {
    this.layoutBlocks();
    this.setMap(this.leftPage, 2 * this.spread - 1);
    this.setMap(this.rightPage, 2 * this.spread);
  }

  maxSpread() { return Math.floor(this.pages.length / 2); }

  // ---------------------------------------------------------------- geometry

  private layoutBlocks() {
    this.frontPivot.rotation.y = -this.open;
    this.leafPivot.position.set(0, 0, this.th / 2 + 0.0012);
  }

  /** Curl the leaf: θ0 is the sheet's angle about the spine (0 = lying right, π = lying left). */
  private curl(theta0: number, bend: number) {
    const n = LEAF_SEG;
    const ds = this.W / n;
    for (const geo of [this.leafGeoF, this.leafGeoB]) {
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      let x = 0;
      let z = 0;
      for (let i = 0; i <= n; i++) {
        pos.setXYZ(i, x, this.H / 2, z);
        pos.setXYZ(i + n + 1, x, -this.H / 2, z);
        const u = (i + 0.5) / n;
        const th = theta0 + bend * Math.pow(u, 1.4);
        x += Math.cos(th) * ds;
        z += Math.sin(th) * ds;
      }
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
    }
    // shade by the bend: each column's facing toward a light up and to the left of the reader, relative
    // to lying flat (so flat = exactly the page colour on either side)
    const L = _light;
    const flat = L.z;
    const pos = this.leafGeoF.getAttribute('position') as THREE.BufferAttribute;
    for (const [geo, sign] of [[this.leafGeoF, 1], [this.leafGeoB, -1]] as const) {
      const col = geo.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i <= n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n, i + 1);
        const tx = pos.getX(b) - pos.getX(a);
        const tz = pos.getZ(b) - pos.getZ(a);
        // normal of the strip at this column (perpendicular to its tangent, facing +z when flat)
        const len = Math.hypot(tx, tz) || 1;
        const nx = (-tz / len) * sign;
        const nz = (tx / len) * sign;
        const lit = (nx * L.x + nz * L.z) / flat;
        const shade = THREE.MathUtils.clamp(0.62 + 0.38 * lit, 0.62, 1.0);
        col.setXYZ(i, shade, shade, shade);
        col.setXYZ(i + n + 1, shade, shade, shade);
      }
      col.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- page turning

  get busy() { return !!this.flip; }

  /** (counted from wherever the turns already asked for will land; one page at a time, a page at a time) */
  next() { if (this.onePage) this.toPage(this.pageHeading() + 1); else this.flipTo(this.heading() + 1); }
  prev() { if (this.onePage) this.toPage(this.pageHeading() - 1); else this.flipTo(this.heading() - 1); }
  private heading() { return this.queued ?? this.flip?.to ?? this.spread; }
  private pageHeading() { return this.queuedPage ?? 2 * (this.flip?.to ?? this.spread) - 1 + this.side; }
  /** the page in view, one page at a time (-1 is the one inside the cover) */
  get page() { return 2 * this.spread - 1 + this.side; }

  /** Turn to the spread containing page `i` (one page at a time: to page `i` itself). */
  showPage(i: number, quick = false) {
    if (this.onePage) this.toPage(i, quick);
    else this.flipTo(Math.floor((i + 1) / 2), quick);
  }

  /**
   * One page at a time: to page `i`. On the same spread the book just slides across to it; otherwise a
   * leaf turns while the book slides, landing on it. Asked during a turn, like flipTo.
   */
  toPage(i: number, quick = false) {
    i = THREE.MathUtils.clamp(i, this.o.inside ? -1 : 0, this.pages.length - 1);
    if (!this.reading) return;
    if (this.flip) {
      if (i !== this.pageHeading()) {
        this.queuedPage = i;
        this.flip.rush = true;
      }
      return;
    }
    const s = this.spreadOf(i);
    if (s !== this.spread) this.flipTo(s, quick || Math.abs(s - this.spread) > 1);
    this.side = i === 2 * s - 1 ? 0 : 1;
  }
  /** The spread a page is on. */
  spreadOf(i: number) { return Math.floor((i + 1) / 2); }

  /**
   * Turn to a spread. However far it is, one leaf turns over and lands on it; `quick` for jumps. Asked
   * during a turn, that turn hurries to land and the next one follows straight on.
   */
  flipTo(target: number, quick = false) {
    target = THREE.MathUtils.clamp(target, 0, this.maxSpread());
    if (!this.reading) return;
    if (this.flip) {
      this.queued = target === this.flip.to ? null : target;
      if (this.queued !== null) this.flip.rush = true;
      return;
    }
    if (target === this.spread) return;
    const dir: 1 | -1 = target > this.spread ? 1 : -1;
    if (dir === 1) {
      // the sheet leaving the right: front = current right page, back = the new left page
      this.setMap(this.leafFront, 2 * this.spread);
      this.setMap(this.leafBack, 2 * target - 1);
      this.setMap(this.rightPage, 2 * target);
    } else {
      this.setMap(this.leafFront, 2 * target);
      this.setMap(this.leafBack, 2 * this.spread - 1);
      this.setMap(this.leftPage, 2 * target - 1);
    }
    this.flip = { t: 0, dir, to: target, time: quick ? QUICK_FLIP : FLIP_TIME, rush: false };
    this.leafPivot.visible = true;
    this.curl(dir === 1 ? 0 : Math.PI, 0);
    this.onSound?.('page');
  }

  // ---------------------------------------------------------------- poses

  /** Lay the closed book down in the world (cover up, top edge pointing along `away`). */
  placeAtRest(pos: THREE.Vector3, up: THREE.Vector3, away: THREE.Vector3) {
    const z = up.clone().normalize();
    const y = away.clone().addScaledVector(z, -away.dot(z)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    _m.makeBasis(x, y, z);
    this.rest.q.setFromRotationMatrix(_m);
    // centre the closed book (which sits on x ∈ [0, W]) on the point
    this.rest.p.copy(pos).addScaledVector(x, -this.W / 2).addScaledVector(z, 0.004);
    this.state = 'rest';
    this.open = this.openTarget = this.openT = 0;
    this.layoutBlocks();
    this.root.position.copy(this.rest.p);
    this.root.quaternion.copy(this.rest.q);
    this.root.visible = true;
  }

  /** Centre of the closed book where it rests (for framing the opening shot). */
  get restCentre() {
    return new THREE.Vector3(this.W / 2, 0, this.th / 2).applyMatrix4(this.root.matrixWorld);
  }

  /** What holds the book up: the diver's hands (the camera if unset). */
  holder: THREE.Object3D | null = null;

  /**
   * How far in front of the eye the open book is held: close enough that the spread fills most of the
   * view (about 80% of the height, or the width between the controls, whichever runs out first), so the type is easy to
   * read, but clear of the controls; never nearer than 0.2 m.
   */
  heldDistance(camera: THREE.Camera) {
    const cam = camera as THREE.PerspectiveCamera;
    const fov = this.fitFov ?? cam.fov;
    const t = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const aspect = cam.aspect || 1.6;
    const dh = this.H / (0.8 * 2 * t);
    // one page at a time: the page nearly fills the width
    if (this.onePage) return Math.max(0.2, dh, (1.04 * this.W) / (0.94 * 2 * t * aspect));
    // leave room beside it for the section buttons, where the window is wide enough to
    const vw = window.innerWidth;
    const fw = THREE.MathUtils.clamp((vw - 2 * this.sideRoom) / vw, 0.6, 0.92);
    const dw = (2.04 * this.W) / (fw * 2 * t * aspect);
    return Math.max(0.2, dh, dw);
  }
  /** room kept clear either side of the open book (CSS px), for what goes beside it */
  sideRoom = 235;
  /** the unzoomed field of view the held size is fitted to */
  fitFov: number | null = null;

  /**
   * Reading closer: the book is brought toward the eye along the line through the pointer, staying square
   * to the view (the view itself doesn't turn), so what's under the pointer stays under it and the lines
   * of type stay straight.
   */
  mag = 1;
  private magTarget = 1;
  private off = new THREE.Vector2();
  private offTarget = new THREE.Vector2();

  zoomAt(level: number, ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera) {
    if (this.state !== 'held' && this.state !== 'lifting') return this.magTarget;
    const m0 = this.magTarget;
    const m1 = THREE.MathUtils.clamp(level, 1, 3);
    if (Math.abs(m1 - m0) < 1e-4) return m0;
    const d = this.heldDistance(camera);
    const t = Math.tan(THREE.MathUtils.degToRad((this.fitFov ?? camera.fov) / 2));
    const a = camera.aspect;
    const d0 = d / m0;
    const d1 = d / m1;
    this.offTarget.x += ndcX * t * a * (d1 - d0);
    this.offTarget.y += ndcY * t * (d1 - d0);
    if (m1 <= 1.001) this.offTarget.set(0, 0);
    this.magTarget = m1;
    this.keepOnPage(camera);
    return m1;
  }

  /** Read closer: slide the book by a distance on screen (NDC), as two fingers drag it. */
  panBy(ndcX: number, ndcY: number, camera: THREE.PerspectiveCamera) {
    if (this.magTarget <= 1.001) return;
    const t = Math.tan(THREE.MathUtils.degToRad((this.fitFov ?? camera.fov) / 2));
    const d = this.heldDistance(camera) / this.magTarget;
    this.offTarget.x += ndcX * t * camera.aspect * d;
    this.offTarget.y += ndcY * t * d;
    this.keepOnPage(camera);
  }

  /** keep the page (one page at a time, the page in view) covering the view where it can */
  private keepOnPage(camera: THREE.PerspectiveCamera) {
    const t = Math.tan(THREE.MathUtils.degToRad((this.fitFov ?? camera.fov) / 2));
    const hh = (this.heldDistance(camera) / this.magTarget) * t;
    const hw = hh * camera.aspect;
    const mx = Math.max(0, (this.onePage ? this.W / 2 : this.W) - hw);
    const my = Math.max(0, this.H / 2 - hh);
    this.offTarget.x = THREE.MathUtils.clamp(this.offTarget.x, -mx, mx);
    this.offTarget.y = THREE.MathUtils.clamp(this.offTarget.y, -my, my);
  }
  resetZoom() { this.magTarget = 1; this.offTarget.set(0, 0); }
  get zoomLevel() { return this.magTarget; }

  private heldPose(camera: THREE.Camera, lowered: number, out: { p: THREE.Vector3; q: THREE.Quaternion }) {
    // held in front of the eye, tilted back a touch like a book in your hands; lowered = dropped out of
    // frame. Brought closer to read, it squares up to the eye.
    const d = this.heldDistance(camera) / this.mag;
    const sq = THREE.MathUtils.clamp((this.mag - 1) * 2, 0, 1);
    _m2.makeRotationX(-0.08 * (1 - sq) + lowered * 0.9);
    // (the root is the spine: shut, the book is slid left so it sits in the middle of the view, and it
    // slides back as it opens, keeping the open spread centred; one page at a time, it slides on across to
    // centre the page in view)
    const opened = this.open / Math.PI;
    const shut = (1 - opened) * this.W / 2;
    _m2.setPosition(this.off.x - shut + this.slide * opened, d * 0.02 * (1 - sq) + this.off.y - lowered * d * 0.95, -d + lowered * 0.08);
    _m.multiplyMatrices((this.holder ?? camera).matrixWorld, _m2);
    _m.decompose(out.p, out.q, _s);
    return out;
  }

  pickUp() {
    if (this.state !== 'rest') return;
    this.from.p.copy(this.root.position);
    this.from.q.copy(this.root.quaternion);
    this.state = 'lifting';
    this.anim = 0;
    this.onSound?.('pickup');
  }

  lower() {
    if (this.state !== 'held' && this.state !== 'raising') return;
    this.resetZoom();
    this.state = 'lowering';
    this.anim = 0;
    this.onSound?.('lower');
  }

  raise() {
    if (this.state === 'rest') return this.pickUp();
    if (this.state !== 'lowered' && this.state !== 'lowering') return;
    this.state = 'raising';
    this.anim = 0;
    this.root.visible = true;
    this.openTarget = Math.PI;
    this.onSound?.('raise');
  }

  /** held and fully open (not while it's still swinging open) */
  get reading() { return this.state === 'held' && this.open === Math.PI; }
  get inHand() { return this.state !== 'rest'; }

  update(dt: number, camera: THREE.Camera) {
    const e = 1 - Math.exp(-dt * 12);
    this.mag += (this.magTarget - this.mag) * e;
    this.off.lerp(this.offTarget, e);
    this.slide += ((this.onePage ? (this.side === 0 ? 1 : -1) * this.W / 2 : 0) - this.slide) * e;
    // pose
    const tgt = { p: _p, q: _q };
    if (this.state === 'lifting') {
      this.anim = Math.min(1, this.anim + dt / 0.7);
      const k = ease(this.anim);
      this.heldPose(camera, 0, tgt);
      this.root.position.lerpVectors(this.from.p, tgt.p, k);
      this.root.position.y += Math.sin(Math.PI * k) * 0.12;
      this.root.quaternion.slerpQuaternions(this.from.q, tgt.q, k);
      // it rises shut and turns to face you, then opens in your hands
      if (this.anim >= 1) {
        this.state = 'held';
        if (this.openTarget === 0) {
          this.openTarget = Math.PI;
          this.onSound?.('open');
        }
      }
    } else if (this.state === 'held') {
      this.heldPose(camera, 0, tgt);
      this.root.position.copy(tgt.p);
      this.root.quaternion.copy(tgt.q);
    } else if (this.state === 'lowering' || this.state === 'raising') {
      this.anim = Math.min(1, this.anim + dt / 0.3);
      const k = ease(this.anim);
      this.heldPose(camera, this.state === 'lowering' ? k : 1 - k, tgt);
      this.root.position.copy(tgt.p);
      this.root.quaternion.copy(tgt.q);
      if (this.anim >= 1) {
        this.state = this.state === 'lowering' ? 'lowered' : 'held';
        if (this.state === 'lowered') this.root.visible = false;
      }
    }
    // opening: the front half swings over, easing out of the hinge and settling flat
    if (this.open !== this.openTarget) {
      const dir = this.openTarget > this.open ? 1 : -1;
      this.openT = THREE.MathUtils.clamp(this.openT + dir * dt / OPEN_TIME, 0, 1);
      this.open = Math.PI * ease(this.openT);
      if (Math.abs(this.open - this.openTarget) < 1e-4) this.open = this.openTarget;
      this.layoutBlocks();
    }
    // page turn
    if (this.flip) {
      const f = this.flip;
      f.t = Math.min(1, f.t + dt / (f.rush ? Math.min(f.time, RUSH_FLIP) : f.time));
      const k = ease(f.t);
      const theta = f.dir === 1 ? Math.PI * k : Math.PI * (1 - k);
      // the free edge trails the spine as the sheet lifts, then catches up and lays flat
      const s = Math.sin(Math.PI * f.t);
      this.curl(theta, -f.dir * 1.05 * s * s * (1.15 - 0.3 * f.t));
      if (f.t >= 1) {
        this.spread = f.to;
        this.flip = null;
        this.leafPivot.visible = false;
        this.showSpread();
        const q = this.queued;
        this.queued = null;
        if (q !== null) this.flipTo(q, Math.abs(q - this.spread) > 1);
        const qp = this.queuedPage;
        this.queuedPage = null;
        if (qp !== null) this.toPage(qp);
      }
    }
    this.tickPages(dt);
    this.prefetch();
  }

  /**
   * While a spread is open and nothing is turning, put the neighbouring spreads' pages on the GPU, one a
   * frame, so a turn doesn't wait on uploading them.
   */
  private prefetch() {
    const r = this.renderer;
    if (!r || !this.reading || this.flip) return;
    for (const s of [this.spread + 1, this.spread - 1]) {
      if (s < 0 || s > this.maxSpread()) continue;
      for (const i of [2 * s - 1, 2 * s]) {
        const page = this.pageAt(i);
        if (!page || this.tex.has(page)) continue;
        r.initTexture(this.texFor(i));
        return;
      }
    }
  }

  /** Animated pages move only while they can be seen: the open spread, and both sides of a turning leaf. */
  private tickPages(dt: number) {
    this.clock += dt;
    const seen = new Set<Page>();
    if (this.root.visible && this.state !== 'rest' && this.open > 0) {
      const spreads = this.flip ? [this.spread, this.flip.to] : [this.spread];
      for (const s of spreads) {
        for (const i of [2 * s - 1, 2 * s]) {
          const p = this.pageAt(i);
          if (p) seen.add(p);
        }
      }
    }
    for (const p of [this.o.inside, ...this.pages]) p?.setShown(seen.has(p), this.clock);
    // Moving parts redraw up to 60 times a second (every frame on most screens); a page of screen
    // recordings only when one of them has a new frame. When both pages of a spread move, they take turns,
    // one a frame: in Safari (so on every iPhone) getting a redrawn page to WebGL means waiting on the
    // browser's GPU process, and two of those in one frame would stall it.
    // While frames come in late (Safari on a busy page, a slow phone), redrawing at 60 costs more frames
    // than it shows: then the moving parts redraw at 30, which is where they used to be.
    this.frameDt += (dt - this.frameDt) * 0.05;
    if (this.slow ? this.frameDt < 1 / 57 : this.frameDt > 1 / 50) this.slow = !this.slow;
    this.liveDt += dt;
    if (this.liveDt >= (this.slow ? 1 / 31 : 1 / 64)) {
      this.liveDt = 0;
      let next: Page | null = null;
      for (const p of seen) if (p.due && (!next || p.drawnAt < next.drawnAt)) next = p;
      next?.tick(this.clock);
    }
    this.refresh();
  }

  // ---------------------------------------------------------------- interaction

  /** Meshes a click can land on. */
  targets(): THREE.Object3D[] {
    return this.state === 'rest' ? [this.root] : this.state === 'held' ? [this.leftPage, this.rightPage] : [];
  }

  /** What a pointer over this intersection would do. */
  describe(hit: THREE.Intersection): { kind: 'pickup' } | { kind: 'link'; href?: string; page?: number } | { kind: 'turn'; dir: 1 | -1 } | null {
    if (this.state === 'rest') return { kind: 'pickup' };
    if (this.state !== 'held' || !hit.uv) return null;
    const side = hit.object === this.rightPage ? 1 : -1;
    const idx = side === 1 ? 2 * this.spread : 2 * this.spread - 1;
    const page = this.pageAt(idx);
    const link = page?.hitAt(hit.uv.x, 1 - hit.uv.y);
    if (link) return { kind: 'link', href: link.href, page: link.page };
    if (this.onePage) {
      // one page at a time: the right half of the page goes on, the left half back
      const dir = hit.uv.x > 0.5 ? 1 : -1;
      const p = this.page;
      if (dir === 1 ? p < this.pages.length - 1 : p > (this.o.inside ? -1 : 0)) return { kind: 'turn', dir };
      return null;
    }
    if (side === 1 && this.spread < this.maxSpread()) return { kind: 'turn', dir: 1 };
    if (side === -1 && this.spread > 0) return { kind: 'turn', dir: -1 };
    return null;
  }

  click(hit: THREE.Intersection): boolean {
    const d = this.describe(hit);
    if (!d) return false;
    if (d.kind === 'pickup') this.pickUp();
    else if (d.kind === 'turn') (d.dir === 1 ? this.next() : this.prev());
    else if (d.href) window.open(d.href, d.href.startsWith('mailto:') ? '_self' : '_blank', 'noopener');
    else if (d.page !== undefined) this.showPage(d.page);
    return true;
  }
}

export { PAGE_W, PAGE_H };
