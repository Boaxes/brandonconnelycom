import * as THREE from 'three';
import { Page, PAGE_H, PAGE_W } from './Page';

/**
 * A real 3D book: leather covers on a hinge, page blocks, index tabs, and one leaf that curls over the
 * spine when a page is turned. Pages are canvases (see Page.ts) shown as textures.
 *
 * Book-local frame: the spine runs along +Y at x = 0, pages lie in the XY plane and face +Z (the reader).
 * The right-hand block sits on x ∈ [0, W], the left on x ∈ [-W, 0].
 *
 * Resting, the book lives in the world (on its rock, in the water). Once picked up it moves into an
 * overlay scene drawn after all the water effects through its own narrow-angle camera: it's held square
 * to the eye, perfectly still and always sharp, nearly as flat as a document but still a real book, and
 * the overlay camera zooms and pans over it like a PDF viewer.
 *
 * States: resting in the world (closed) → lifted and opened → held (reading) ⇄ lowered out of view.
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
  leather: { map: THREE.Texture; normal: THREE.Texture };
  /** index tabs down the fore-edge: each jumps to a page */
  tabs?: { label: string; page: number }[];
}

/** The scene and camera the held book is drawn in. */
export interface Overlay { scene: THREE.Scene; camera: THREE.PerspectiveCamera }

const LEAF_SEG = 30;
const LEAF_ROWS = 8;
const FLIP_TIME = 0.78;
const RIFFLE_TIME = 0.26;
const TAB_W = 0.026;
const TAB_H = 0.0335;
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function ease(t: number) { return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; }
function easeOut(t: number) { return 1 - (1 - t) ** 3; }

/** Paper for the turning leaf: shaded by how it faces the light, with a faint sheen along the bend. */
function leafMaterial(side: THREE.Side) {
  return new THREE.ShaderMaterial({
    side,
    toneMapped: false,
    uniforms: { map: { value: null as THREE.Texture | null }, uFlip: { value: side === THREE.BackSide ? -1 : 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      uniform float uFlip;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal) * uFlip;
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        vec3 L = normalize(vec3(-0.35, 0.45, 1.0));
        // flat and square to the eye reads exactly like the pages around it
        float d = max(dot(n, L), 0.0) / max(dot(vec3(0.0, 0.0, 1.0), L), 1e-3);
        float shade = mix(0.55, 1.0, clamp(d, 0.0, 1.0));
        float sheen = pow(max(dot(reflect(-L, n), vV), 0.0), 18.0) * 0.1;
        vec4 c = texture2D(map, vUv);
        gl_FragColor = vec4(c.rgb * shade + sheen, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
}

export class Book3D {
  root = new THREE.Group();
  state: BookState = 'lowered';
  /** index of the current spread: left page = 2s - 1, right page = 2s */
  spread = 0;
  onSound: ((s: BookSound) => void) | null = null;
  pages: Page[];
  /** where the held book is drawn; set by the app */
  overlay: Overlay | null = null;
  /** zoom and pan of the reading view (overlay camera), eased toward the targets */
  view = { zoom: 1, x: 0, y: 0 };
  private viewTarget = { zoom: 1, x: 0, y: 0 };

  private W: number;
  private H: number;
  private th: number;
  private ct = 0.004; // cover board thickness
  private frontPivot = new THREE.Group();
  private spine: THREE.Mesh;
  private leftBlock: THREE.Mesh;
  private rightBlock: THREE.Mesh;
  private leftPage: THREE.Mesh;
  private rightPage: THREE.Mesh;
  private leafFront: THREE.Mesh;
  private leafBack: THREE.Mesh;
  private leafGeo: THREE.PlaneGeometry;
  private leafPivot = new THREE.Group();
  private shadowR: THREE.Mesh;
  private shadowL: THREE.Mesh;
  private tabs: { mesh: THREE.Mesh; page: number; i: number }[] = [];
  private open = 0;           // cover angle 0..π
  private openTarget = 0;
  private flip: { t: number; dir: 1 | -1; to: number; time: number } | null = null;
  private goal: number | null = null;   // final spread of a multi-page jump
  private peel = 0;           // hover lift of the next page's corner, 0..1
  private peelTarget = 0;
  private peelDir: 1 | -1 = 1;
  private anim = 1;           // pose transition 0..1
  private from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private tex = new Map<Page, { t: THREE.CanvasTexture; v: number }>();
  private endTex: THREE.CanvasTexture;

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
    this.endTex = this.flatTexture(o.endpaper);
    const endMat = new THREE.MeshBasicMaterial({ map: this.endTex, color: 0xd8d0bc, toneMapped: false });
    const edge = new THREE.MeshStandardMaterial({ map: this.edgeTexture(), roughness: 0.9, color: 0xf1e8d2 });
    const paperTop = new THREE.MeshBasicMaterial({ color: 0xe6dcc4, toneMapped: false });

    // back cover (under the right block) and the front cover on a hinge at the spine
    const board = new THREE.BoxGeometry(W + 0.008, H + 0.012, this.ct);
    const back = new THREE.Mesh(board, [leather, leather, leather, leather, endMat, leather]);
    back.position.set(W / 2 + 0.002, 0, -this.ct / 2);
    this.root.add(back);
    const front = new THREE.Mesh(board, [leather, leather, leather, leather, leather, endMat]);
    front.position.set(W / 2 + 0.002, 0, this.th / 2 + this.ct / 2);
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
    // spine
    this.spine = new THREE.Mesh(new THREE.BoxGeometry(this.ct, H + 0.012, this.th + this.ct * 2), leather);
    this.spine.position.set(-this.ct / 2, 0, this.th / 2);
    this.root.add(this.spine);

    // page blocks
    const block = new THREE.BoxGeometry(W, H, 1);
    this.rightBlock = new THREE.Mesh(block, [edge, edge, edge, edge, paperTop, paperTop]);
    this.leftBlock = new THREE.Mesh(block, [edge, edge, edge, edge, paperTop, paperTop]);
    this.root.add(this.rightBlock, this.leftBlock);

    // the two visible pages: unlit, so the paper and ink read exactly as drawn
    const pg = new THREE.PlaneGeometry(W, H);
    this.leftPage = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ toneMapped: false }));
    this.rightPage = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ toneMapped: false }));
    this.leftPage.name = 'left';
    this.rightPage.name = 'right';
    this.root.add(this.leftPage, this.rightPage);
    // the gutter: pages curve down into the spine, so they darken toward it
    const gutterTex = this.gradientTexture([[0, 0.42], [0.35, 0.12], [1, 0]]);
    const gw = W * 0.2;
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(gw, H),
        new THREE.MeshBasicMaterial({ map: gutterTex, transparent: true, depthWrite: false, color: 0x000000, side: THREE.DoubleSide, toneMapped: false }),
      );
      if (side < 0) m.scale.x = -1;
      m.position.set(side * gw / 2 - side * (W / 2), 0, 0.0003);
      m.renderOrder = 2;
      (side < 0 ? this.leftPage : this.rightPage).add(m);
    }
    // the shadow a turning leaf casts on the page underneath it: darkest under its free edge
    const shTex = this.gradientTexture([[0, 0.05], [0.8, 0.5], [1, 0]]);
    const shadow = (side: 1 | -1) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, H),
        new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0, toneMapped: false }),
      );
      m.renderOrder = 3;
      m.visible = false;
      (side < 0 ? this.leftPage : this.rightPage).add(m);
      return m;
    };
    this.shadowR = shadow(1);
    this.shadowL = shadow(-1);

    // the turning leaf: a grid (so a corner can lead), two sides with their own UVs
    this.leafGeo = new THREE.PlaneGeometry(W, H, LEAF_SEG, LEAF_ROWS);
    const back2 = this.leafGeo.clone();
    const uvB = back2.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvB.count; i++) uvB.setX(i, 1 - uvB.getX(i));
    this.leafFront = new THREE.Mesh(this.leafGeo, leafMaterial(THREE.FrontSide));
    this.leafBack = new THREE.Mesh(this.leafGeo, leafMaterial(THREE.BackSide));
    // both sides share one deforming position buffer; the back only needs its own mirrored UVs
    this.leafBack.geometry = new THREE.BufferGeometry();
    this.leafBack.geometry.setIndex(this.leafGeo.getIndex());
    this.leafBack.geometry.setAttribute('position', this.leafGeo.getAttribute('position'));
    this.leafBack.geometry.setAttribute('normal', this.leafGeo.getAttribute('normal'));
    this.leafBack.geometry.setAttribute('uv', uvB);
    this.leafPivot.add(this.leafFront, this.leafBack);
    this.leafPivot.visible = false;
    this.root.add(this.leafPivot);
    this.leafFront.frustumCulled = this.leafBack.frustumCulled = false;

    // index tabs down the fore-edge
    (o.tabs ?? []).forEach((t, i) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(TAB_W, TAB_H),
        new THREE.MeshBasicMaterial({ map: this.tabTexture(t.label, i), transparent: true, toneMapped: false }),
      );
      m.name = 'tab';
      m.userData.page = t.page;
      this.root.add(m);
      this.tabs.push({ mesh: m, page: t.page, i });
    });

    this.root.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; }
    });
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

  /** alpha ramp along x: [position 0..1, alpha] stops */
  private gradientTexture(stops: [number, number][]) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 4;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 128, 0);
    for (const [p, a] of stops) grad.addColorStop(p, `rgba(0,0,0,${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 4);
    return new THREE.CanvasTexture(c);
  }

  private tabTexture(label: string, i: number) {
    const c = document.createElement('canvas');
    c.width = 104;
    c.height = 138;
    const g = c.getContext('2d')!;
    const colours = ['#d8cfb8', '#c9b98f', '#b9c2a4', '#c7a99a', '#a9b8bd', '#cdb6a0'];
    g.fillStyle = colours[i % colours.length];
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(88, 0); g.quadraticCurveTo(104, 0, 104, 16);
    g.lineTo(104, 120); g.quadraticCurveTo(104, 136, 88, 136); g.lineTo(0, 136); g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 0, 6, 136);
    g.save();
    g.translate(58, 68);
    g.rotate(Math.PI / 2);
    g.fillStyle = '#2a2622';
    g.font = `21px 'Special Elite', monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let s = label.toUpperCase();
    while (g.measureText(s).width > 128 && s.length > 3) s = s.slice(0, -1);
    g.fillText(s, 0, 1);
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
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

  private texFor(i: number): THREE.Texture {
    const page = this.pages[i];
    if (!page) return this.endTex;
    let e = this.tex.get(page);
    if (!e) {
      const t = new THREE.CanvasTexture(page.canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 16;
      e = { t, v: page.version };
      this.tex.set(page, e);
    } else if (e.v !== page.version) {
      e.t.needsUpdate = true;
      e.v = page.version;
    }
    return e.t;
  }

  /** Re-upload any pages whose canvases were redrawn. */
  refresh() {
    for (const [page, e] of this.tex) {
      if (e.v !== page.version) {
        e.t.needsUpdate = true;
        e.v = page.version;
      }
    }
  }

  private setMap(mesh: THREE.Mesh, i: number) {
    const t = i < 0 || i >= this.pages.length ? this.endTex : this.texFor(i);
    const m = mesh.material as THREE.MeshBasicMaterial | THREE.ShaderMaterial;
    if ((m as THREE.ShaderMaterial).isShaderMaterial) {
      (m as THREE.ShaderMaterial).uniforms.map.value = t;
    } else if ((m as THREE.MeshBasicMaterial).map !== t) {
      (m as THREE.MeshBasicMaterial).map = t;
      m.needsUpdate = true;
    }
  }

  private showSpread() {
    this.setMap(this.leftPage, 2 * this.spread - 1);
    this.setMap(this.rightPage, 2 * this.spread);
    this.placeTabs();
  }

  maxSpread() { return Math.floor(this.pages.length / 2); }

  // ---------------------------------------------------------------- geometry

  private layoutBlocks() {
    // closed: all pages on the right under the cover; open: split between the two sides
    const f = THREE.MathUtils.smoothstep(this.open, Math.PI * 0.55, Math.PI);
    const r = this.th * (1 - f / 2);
    const l = this.th * (f / 2);
    this.rightBlock.scale.z = Math.max(r, 1e-4);
    this.rightBlock.position.set(this.W / 2, 0, r / 2);
    this.leftBlock.scale.z = Math.max(l, 1e-4);
    this.leftBlock.position.set(-this.W / 2, 0, l / 2);
    this.leftBlock.visible = l > 0.0005;
    this.rightPage.position.set(this.W / 2, 0, r + 0.0006);
    this.leftPage.position.set(-this.W / 2, 0, l + 0.0006);
    this.leftPage.visible = this.open > Math.PI * 0.9;
    this.rightPage.visible = this.open > 0.3;
    this.frontPivot.rotation.y = -this.open;
    // open, the spine is folded away under the pages (it only reads from the side)
    this.spine.visible = this.open < 1.4;
    this.leafPivot.position.set(0, 0, this.th / 2 + 0.0012);
    this.placeTabs();
  }

  /** Tabs stick out of the fore-edge of the side their page is on: right if it's still ahead, left once passed. */
  private placeTabs() {
    const open = this.open > Math.PI * 0.9;
    const f = THREE.MathUtils.smoothstep(this.open, Math.PI * 0.55, Math.PI);
    const r = this.th * (1 - f / 2);
    const l = this.th * (f / 2);
    for (const t of this.tabs) {
      t.mesh.visible = open;
      const right = t.page >= 2 * this.spread;
      const y = this.H / 2 - 0.02 - t.i * (TAB_H + 0.0036);
      t.mesh.position.set(right ? this.W + TAB_W / 2 - 0.003 : -this.W - TAB_W / 2 + 0.003, y, (right ? r : l) - 0.0004);
      t.mesh.rotation.z = right ? 0 : Math.PI;
    }
  }

  /**
   * Bend the leaf. Every row of the sheet is a strip hinged at the spine: θ0 is its angle about the spine
   * (0 = lying right, π = lying left), `bend` lets the free edge lag or lead, and `skew` makes the bottom
   * corner lead the top, so the sheet turns with a diagonal curl the way a page lifted by its corner does.
   */
  private curl(theta0: number, bend: number, skew: number) {
    const n = LEAF_SEG;
    const ds = this.W / n;
    const pos = this.leafGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let r = 0; r <= LEAF_ROWS; r++) {
      const v = r / LEAF_ROWS;                  // 0 top, 1 bottom
      const y = this.H / 2 - v * this.H;
      let x = 0;
      let z = 0;
      for (let i = 0; i <= n; i++) {
        pos.setXYZ(r * (n + 1) + i, x, y, z);
        const u = (i + 0.5) / n;
        const th = theta0 + bend * Math.pow(u, 1.4) + skew * v * Math.pow(u, 1.2);
        x += Math.cos(th) * ds;
        z += Math.sin(th) * ds;
      }
    }
    pos.needsUpdate = true;
    this.leafGeo.computeVertexNormals();
    this.leafGeo.computeBoundingSphere();
  }

  /** The leaf's shadow on the page it's leaving or landing on. */
  private shade(theta: number, lift: number) {
    const pos = this.leafGeo.getAttribute('position') as THREE.BufferAttribute;
    const mid = Math.floor(LEAF_ROWS / 2) * (LEAF_SEG + 1) + LEAF_SEG;
    const edgeX = pos.getX(mid);
    const onRight = edgeX > 0;
    const sh = onRight ? this.shadowR : this.shadowL;
    const other = onRight ? this.shadowL : this.shadowR;
    other.visible = false;
    const reach = THREE.MathUtils.clamp(Math.abs(edgeX) + 0.02 + lift * 0.03, 0.01, this.W);
    sh.visible = lift > 0.001;
    sh.scale.x = reach;
    // plane is centred: put it between the spine and the leaf's edge (page-local x runs -W/2..W/2)
    sh.position.set(onRight ? -this.W / 2 + reach / 2 : this.W / 2 - reach / 2, 0, 0.0005);
    sh.rotation.y = onRight ? 0 : Math.PI;
    (sh.material as THREE.MeshBasicMaterial).opacity = 0.55 * lift * (0.35 + 0.65 * Math.sin(Math.min(Math.PI, theta)));
  }

  // ---------------------------------------------------------------- page turning

  get busy() { return !!this.flip; }

  next() { this.flipTo(this.spread + 1); }
  prev() { this.flipTo(this.spread - 1); }

  /** Turn to the spread containing page `i`. */
  showPage(i: number) { this.flipTo(Math.floor((i + 1) / 2)); }

  /**
   * Turn to a spread. One page turns with a full, unhurried curl; a longer jump riffles: a few quick
   * leaves go over, then the last one lands on the right spread.
   */
  flipTo(target: number) {
    target = THREE.MathUtils.clamp(target, 0, this.maxSpread());
    if (this.state !== 'held') return;
    if (this.flip) {
      this.goal = target === this.spread ? null : target;
      return;
    }
    if (target === this.spread) return;
    const dist = Math.abs(target - this.spread);
    this.goal = dist > 1 ? target : null;
    const dir: 1 | -1 = target > this.spread ? 1 : -1;
    // riffle: spread the jump over at most four leaves
    const step = dist > 1 ? Math.max(1, Math.ceil((dist - 1) / 3)) : 1;
    const to = dist > 1 ? this.spread + dir * Math.min(step, dist - 1) : target;
    this.startFlip(to, dist > 1 ? RIFFLE_TIME : FLIP_TIME);
  }

  private startFlip(to: number, time: number) {
    const dir: 1 | -1 = to > this.spread ? 1 : -1;
    if (dir === 1) {
      // the sheet leaving the right: front = current right page, back = the new left page
      this.setMap(this.leafFront, 2 * this.spread);
      this.setMap(this.leafBack, 2 * to - 1);
      this.setMap(this.rightPage, 2 * to);
    } else {
      this.setMap(this.leafFront, 2 * to);
      this.setMap(this.leafBack, 2 * this.spread - 1);
      this.setMap(this.leftPage, 2 * to - 1);
    }
    // carry on from a corner that's already lifted under the pointer
    const t0 = this.peel > 0 && this.peelDir === dir ? 0.06 * this.peel : 0;
    this.peel = this.peelTarget = 0;
    this.flip = { t: t0, dir, to, time };
    this.leafPivot.visible = true;
    this.onSound?.('page');
  }

  /** The pointer is near a page's outer edge: lift that corner a little (0 = let it settle). */
  hover(dir: 1 | -1 | 0) {
    if (this.state !== 'held' || this.flip) { this.peelTarget = 0; return; }
    if (dir === 1 && this.spread >= this.maxSpread()) dir = 0;
    if (dir === -1 && this.spread <= 0) dir = 0;
    if (dir !== 0 && this.peel > 0.01 && dir !== this.peelDir) { this.peelTarget = 0; return; }
    if (dir !== 0 && this.peel <= 0.01) {
      this.peelDir = dir;
      // under the lifting corner is the next page on that side
      if (dir === 1) {
        this.setMap(this.leafFront, 2 * this.spread);
        this.setMap(this.leafBack, 2 * this.spread + 1);
        this.setMap(this.rightPage, 2 * this.spread + 2);
      } else {
        this.setMap(this.leafFront, 2 * this.spread - 2);
        this.setMap(this.leafBack, 2 * this.spread - 1);
        this.setMap(this.leftPage, 2 * this.spread - 3);
      }
    }
    this.peelTarget = dir === 0 ? 0 : 1;
  }

  // ---------------------------------------------------------------- poses

  /** Lay the closed book down in the world (cover up, top edge pointing along `away`). */
  placeAtRest(pos: THREE.Vector3, up: THREE.Vector3, away: THREE.Vector3) {
    const z = up.clone().normalize();
    const y = away.clone().addScaledVector(z, -away.dot(z)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    _m.makeBasis(x, y, z);
    this.root.quaternion.setFromRotationMatrix(_m);
    // centre the closed book (which sits on x ∈ [0, W]) on the point
    this.root.position.copy(pos).addScaledVector(x, -this.W / 2).addScaledVector(z, 0.004);
    this.state = 'rest';
    this.open = this.openTarget = 0;
    this.layoutBlocks();
    this.root.visible = true;
  }

  /** Centre of the closed book on its rock (for the opening shot). */
  get restCentre() {
    return new THREE.Vector3(this.W / 2, 0, this.th / 2).applyMatrix4(this.root.matrixWorld);
  }

  /**
   * How far in front of the overlay camera the open book is held: so the spread (tabs included) fills
   * about 80% of the height, or the width between the corner controls, whichever runs out first.
   */
  heldDistance() {
    const cam = this.overlay!.camera;
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const vw = window.innerWidth;
    const fw = THREE.MathUtils.clamp((vw - 2 * 200) / vw, 0.62, 0.92);
    const dh = this.H / (0.8 * 2 * t);
    const dw = (2 * this.W + 2 * TAB_W) / (fw * 2 * t * (cam.aspect || 1.6));
    return Math.max(dh, dw);
  }

  /** Held pose in the overlay camera's space: square to the eye; lowered = slid down out of frame. */
  private heldPose(lowered: number, out: { p: THREE.Vector3; q: THREE.Quaternion }) {
    const d = this.heldDistance();
    const t = Math.tan(THREE.MathUtils.degToRad(this.overlay!.camera.fov / 2));
    out.p.set(0, d * t * 0.03 - lowered * d * t * 2.3, -d);
    out.q.setFromAxisAngle(_v.set(1, 0, 0), -lowered * 0.5);
    return out;
  }

  /**
   * Pick the book up off its rock. It moves into the overlay scene without a jump on screen: its pose in
   * the world camera's view is carried over, with the depth stretched by the ratio of the two cameras'
   * fields of view, which keeps its position and size on screen the same.
   */
  pickUp(worldCamera?: THREE.PerspectiveCamera) {
    if (this.state !== 'rest' || !this.overlay) return;
    if (worldCamera) {
      worldCamera.updateMatrixWorld();
      this.root.updateMatrixWorld();
      _m.multiplyMatrices(worldCamera.matrixWorldInverse, this.root.matrixWorld);
      _m.decompose(this.from.p, this.from.q, _s);
      // x/(z·tan) is what reaches the screen, so stretching only the depth keeps position and size
      this.from.p.z *= Math.tan(THREE.MathUtils.degToRad(worldCamera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(this.overlay.camera.fov / 2));
    }
    this.overlay.scene.add(this.root);
    this.root.position.copy(this.from.p);
    this.root.quaternion.copy(this.from.q);
    this.state = 'lifting';
    this.anim = 0;
    this.onSound?.('pickup');
  }

  lower() {
    if (this.state !== 'held' && this.state !== 'raising') return;
    this.hover(0);
    this.state = 'lowering';
    this.anim = 0;
    this.resetView();
    this.onSound?.('lower');
  }

  raise() {
    if (this.state !== 'lowered' && this.state !== 'lowering') return;
    this.state = 'raising';
    this.anim = 0;
    this.root.visible = true;
    this.openTarget = Math.PI;
    this.onSound?.('raise');
  }

  get reading() { return this.state === 'held'; }
  get inHand() { return this.state !== 'rest'; }
  get inOverlay() { return this.state !== 'rest'; }

  // ---------------------------------------------------------------- reading view (zoom and pan)

  /** Visible half-height of the page plane at the current zoom (m). */
  private halfView(zoom: number) {
    const cam = this.overlay!.camera;
    return this.heldDistance() * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) / zoom;
  }

  private clampView(v: { zoom: number; x: number; y: number }) {
    const cam = this.overlay!.camera;
    const hh = this.halfView(v.zoom);
    const hw = hh * cam.aspect;
    const bx = this.W + TAB_W;
    const by = this.H / 2 + 0.01;
    const yc = this.heldDistance() * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.03;
    v.x = THREE.MathUtils.clamp(v.x, -Math.max(0, bx - hw), Math.max(0, bx - hw));
    v.y = THREE.MathUtils.clamp(v.y, yc - Math.max(0, by - hh), yc + Math.max(0, by - hh));
  }

  /** Zoom the reading view about a point on screen (NDC), PDF-style: what's under the pointer stays put. */
  zoomAt(level: number, ndcX: number, ndcY: number) {
    if (!this.overlay || this.state !== 'held') return this.viewTarget.zoom;
    const cam = this.overlay.camera;
    const v = this.viewTarget;
    const z1 = THREE.MathUtils.clamp(level, 1, 3.5);
    const h0 = this.halfView(v.zoom);
    const h1 = this.halfView(z1);
    const px = v.x + ndcX * h0 * cam.aspect;
    const py = v.y + ndcY * h0;
    v.x = px - ndcX * h1 * cam.aspect;
    v.y = py - ndcY * h1;
    v.zoom = z1;
    if (z1 <= 1.001) { v.x = 0; v.y = 0; }
    this.clampView(v);
    return z1;
  }

  /** Drag the zoomed page around (pixels). */
  pan(dxPx: number, dyPx: number) {
    if (!this.overlay || this.viewTarget.zoom <= 1.001) return;
    const h = this.halfView(this.viewTarget.zoom);
    const k = (2 * h) / window.innerHeight;
    this.viewTarget.x -= dxPx * k;
    this.viewTarget.y += dyPx * k;
    this.clampView(this.viewTarget);
    this.view.x = this.viewTarget.x;
    this.view.y = this.viewTarget.y;
  }

  get zoomLevel() { return this.viewTarget.zoom; }
  resetView() { this.viewTarget.zoom = 1; this.viewTarget.x = 0; this.viewTarget.y = 0; }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    const tgt = { p: _v.clone(), q: _q.clone() };
    if (this.state === 'lifting') {
      this.anim = Math.min(1, this.anim + dt / 1.2);
      const k = ease(this.anim);
      this.heldPose(0, tgt);
      this.root.position.lerpVectors(this.from.p, tgt.p, k);
      // an arc up toward the eye, not a straight slide
      this.root.position.y += Math.sin(Math.PI * k) * 0.08;
      this.root.quaternion.slerpQuaternions(this.from.q, tgt.q, easeOut(this.anim));
      if (this.anim > 0.5 && this.openTarget === 0) {
        this.openTarget = Math.PI;
        this.onSound?.('open');
      }
      if (this.anim >= 1) this.state = 'held';
    } else if (this.state === 'held') {
      this.heldPose(0, tgt);
      this.root.position.copy(tgt.p);
      this.root.quaternion.copy(tgt.q);
    } else if (this.state === 'lowering' || this.state === 'raising') {
      this.anim = Math.min(1, this.anim + dt / 0.55);
      const k = ease(this.anim);
      this.heldPose(this.state === 'lowering' ? k : 1 - k, tgt);
      this.root.position.copy(tgt.p);
      this.root.quaternion.copy(tgt.q);
      if (this.anim >= 1) {
        this.state = this.state === 'lowering' ? 'lowered' : 'held';
        if (this.state === 'lowered') this.root.visible = false;
      }
    }
    // reading view
    if (this.overlay && this.state !== 'rest') {
      const e = 1 - Math.exp(-dt * 12);
      const v = this.view;
      v.zoom += (this.viewTarget.zoom - v.zoom) * e;
      v.x += (this.viewTarget.x - v.x) * e;
      v.y += (this.viewTarget.y - v.y) * e;
      const cam = this.overlay.camera;
      if (cam.zoom !== v.zoom) {
        cam.zoom = v.zoom;
        cam.updateProjectionMatrix();
      }
      cam.position.set(v.x, v.y, 0);
    }
    // cover
    if (this.open !== this.openTarget) {
      const sp = dt * 3.2;
      this.open = this.open < this.openTarget ? Math.min(this.openTarget, this.open + sp) : Math.max(this.openTarget, this.open - sp);
      this.layoutBlocks();
    }
    // page turn
    if (this.flip) {
      const f = this.flip;
      f.t = Math.min(1, f.t + dt / f.time);
      const k = ease(f.t);
      const s = Math.sin(Math.PI * f.t);
      const theta = f.dir === 1 ? Math.PI * k : Math.PI * (1 - k);
      // the free edge lags the spine, and the bottom corner leads: a diagonal curl that relaxes flat
      const quick = f.time < FLIP_TIME;
      this.curl(theta, -f.dir * (quick ? 0.5 : 1.05) * s, f.dir * (quick ? 0.15 : 0.42) * s * (1 - f.t));
      this.shade(theta, s);
      if (f.t >= 1) {
        this.spread = f.to;
        this.flip = null;
        this.leafPivot.visible = false;
        this.shadowR.visible = this.shadowL.visible = false;
        this.showSpread();
        if (this.goal !== null && this.goal !== this.spread) {
          const g = this.goal;
          const dist = Math.abs(g - this.spread);
          const dir = g > this.spread ? 1 : -1;
          if (dist === 1) { this.goal = null; this.startFlip(g, FLIP_TIME * 0.8); }
          else this.startFlip(this.spread + dir * Math.min(dist - 1, Math.max(1, Math.ceil((dist - 1) / 2))), RIFFLE_TIME);
        } else this.goal = null;
      }
    } else if (this.peel > 0 || this.peelTarget > 0) {
      // a corner lifting under the pointer
      this.peel += (this.peelTarget - this.peel) * (1 - Math.exp(-dt * (this.peelTarget > this.peel ? 10 : 7)));
      if (this.peelTarget === 0 && this.peel < 0.01) {
        this.peel = 0;
        this.leafPivot.visible = false;
        this.shadowR.visible = this.shadowL.visible = false;
        this.showSpread();
      } else {
        this.leafPivot.visible = true;
        const p = this.peel;
        const d = this.peelDir;
        const theta = d === 1 ? 0.02 * p : Math.PI - 0.02 * p;
        this.curl(theta, d * 0.2 * p, d * 0.55 * p);
        this.shade(theta, 0.35 * p);
      }
    }
  }

  // ---------------------------------------------------------------- interaction

  /** Meshes a click can land on. */
  targets(): THREE.Object3D[] {
    if (this.state === 'rest') return [this.root];
    if (this.state !== 'held') return [];
    return [this.leftPage, this.rightPage, ...this.tabs.map((t) => t.mesh)];
  }

  /** What a pointer over this intersection would do. */
  describe(hit: THREE.Intersection): { kind: 'pickup' } | { kind: 'link'; href?: string; page?: number } | { kind: 'turn'; dir: 1 | -1; edge: boolean } | null {
    if (this.state === 'rest') return { kind: 'pickup' };
    if (this.state !== 'held' || !hit.uv) return null;
    if (hit.object.name === 'tab') return { kind: 'link', page: hit.object.userData.page as number };
    const side = hit.object === this.rightPage ? 1 : -1;
    const idx = side === 1 ? 2 * this.spread : 2 * this.spread - 1;
    const page = this.pages[idx];
    const link = page?.hitAt(hit.uv.x, 1 - hit.uv.y);
    if (link) return { kind: 'link', href: link.href, page: link.page };
    const edge = side === 1 ? hit.uv.x > 0.82 : hit.uv.x < 0.18;
    if (side === 1 && this.spread < this.maxSpread()) return { kind: 'turn', dir: 1, edge };
    if (side === -1 && this.spread > 0) return { kind: 'turn', dir: -1, edge };
    return null;
  }

  click(hit: THREE.Intersection, worldCamera?: THREE.PerspectiveCamera): boolean {
    const d = this.describe(hit);
    if (!d) return false;
    if (d.kind === 'pickup') this.pickUp(worldCamera);
    else if (d.kind === 'turn') (d.dir === 1 ? this.next() : this.prev());
    else if (d.href) window.open(d.href, d.href.startsWith('mailto:') ? '_self' : '_blank', 'noopener');
    else if (d.page !== undefined) this.showPage(d.page);
    return true;
  }
}

export { PAGE_W, PAGE_H };
