import * as THREE from 'three';
import { Page, PAGE_H, PAGE_W } from './Page';

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
  leather: { map: THREE.Texture; normal: THREE.Texture };
}

const LEAF_SEG = 28;
const FLIP_TIME = 0.42;
const QUICK_FLIP = 0.22;
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
  private spine: THREE.Mesh;
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
  private flip: { t: number; dir: 1 | -1; to: number; time: number } | null = null;
  private anim = 1;           // pose transition 0..1
  private from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  private rest = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
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
    // lit, like the leather: unlit, the strip of endpaper round the closed book glowed in the dark
    const endMat = new THREE.MeshStandardMaterial({ map: this.endTex, color: 0xd8d0bc, roughness: 0.9 });
    const edge = new THREE.MeshStandardMaterial({ map: this.edgeTexture(), roughness: 0.9, color: 0xf1e8d2 });
    const paperTop = new THREE.MeshBasicMaterial({ color: 0xe6dcc4 });

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

    // the two visible pages
    const pg = new THREE.PlaneGeometry(W, H);
    this.leftPage = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xebe4d2 }));
    this.rightPage = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xebe4d2 }));
    this.leftPage.name = 'left';
    this.rightPage.name = 'right';
    this.root.add(this.leftPage, this.rightPage);
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
    this.leafFront = new THREE.Mesh(this.leafGeoF, new THREE.MeshBasicMaterial({ side: THREE.FrontSide, color: 0xebe4d2, vertexColors: true }));
    this.leafBack = new THREE.Mesh(this.leafGeoB, new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0xebe4d2, vertexColors: true }));
    this.leafPivot.add(this.leafFront, this.leafBack);
    this.leafPivot.visible = false;
    this.root.add(this.leafPivot);

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

  private texFor(i: number): THREE.Texture {
    const page = this.pages[i];
    if (!page) return this.endTex;
    let e = this.tex.get(page);
    if (!e) {
      const t = new THREE.CanvasTexture(page.canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      e = { t, v: page.version };
      this.tex.set(page, e);
    } else if (e.v !== page.version) {
      e.t.needsUpdate = true;
      e.v = page.version;
    }
    return e.t;
  }

  /** Re-upload any pages whose canvases were redrawn (e.g. a species was just logged). */
  refresh() {
    for (const [page, e] of this.tex) {
      if (e.v !== page.version) {
        e.t.needsUpdate = true;
        e.v = page.version;
      }
    }
  }

  setPages(pages: Page[]) {
    this.pages = pages;
    this.spread = Math.min(this.spread, this.maxSpread());
    this.showSpread();
  }

  private setMap(mesh: THREE.Mesh, i: number) {
    const m = mesh.material as THREE.MeshBasicMaterial;
    const t = i < 0 || i >= this.pages.length ? this.endTex : this.texFor(i);
    if (m.map !== t) {
      m.map = t;
      m.needsUpdate = true;
    }
  }

  private showSpread() {
    this.setMap(this.leftPage, 2 * this.spread - 1);
    this.setMap(this.rightPage, 2 * this.spread);
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

  next() { this.flipTo(this.spread + 1); }
  prev() { this.flipTo(this.spread - 1); }

  /** Turn to the spread containing page `i`. */
  showPage(i: number, quick = false) { this.flipTo(Math.floor((i + 1) / 2), quick); }
  /** The spread a page is on. */
  spreadOf(i: number) { return Math.floor((i + 1) / 2); }

  /** Turn to a spread. However far it is, one leaf turns over and lands on it; `quick` for jumps. */
  flipTo(target: number, quick = false) {
    target = THREE.MathUtils.clamp(target, 0, this.maxSpread());
    if (target === this.spread || this.flip || this.state !== 'held') return;
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
    this.flip = { t: 0, dir, to: target, time: quick ? QUICK_FLIP : FLIP_TIME };
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
    this.open = this.openTarget = 0;
    this.layoutBlocks();
    this.root.position.copy(this.rest.p);
    this.root.quaternion.copy(this.rest.q);
    this.root.visible = true;
  }

  /** Where the open spread's left edge and middle are on screen (CSS px), for placing things beside it. */
  screenLeft(camera: THREE.Camera) {
    this.root.updateMatrixWorld();
    const a = _p.set(-this.W, this.H / 2, 0).applyMatrix4(this.root.matrixWorld).project(camera);
    const ax = a.x, ay = a.y;
    const b = _p.set(-this.W, -this.H / 2, 0).applyMatrix4(this.root.matrixWorld).project(camera);
    return {
      x: (Math.min(ax, b.x) + 1) / 2 * window.innerWidth,
      y: (1 - (ay + b.y) / 2) / 2 * window.innerHeight,
    };
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
    // leave the corner card, and the section list beside the book, clear where the window is wide enough to
    const vw = window.innerWidth;
    const fw = THREE.MathUtils.clamp((vw - 2 * 235) / vw, 0.6, 0.92);
    const dh = this.H / (0.8 * 2 * t);
    const dw = (2.04 * this.W) / (fw * 2 * t * (cam.aspect || 1.6));
    return Math.max(0.2, dh, dw);
  }
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
    // keep the page covering the view where it can
    const hh = d1 * t;
    const hw = hh * a;
    const mx = Math.max(0, this.W - hw);
    const my = Math.max(0, this.H / 2 - hh);
    this.offTarget.x = THREE.MathUtils.clamp(this.offTarget.x, -mx, mx);
    this.offTarget.y = THREE.MathUtils.clamp(this.offTarget.y, -my, my);
    this.magTarget = m1;
    return m1;
  }
  resetZoom() { this.magTarget = 1; this.offTarget.set(0, 0); }
  get zoomLevel() { return this.magTarget; }

  private heldPose(camera: THREE.Camera, lowered: number, out: { p: THREE.Vector3; q: THREE.Quaternion }) {
    // held in front of the eye, tilted back a touch like a book in your hands; lowered = dropped out of
    // frame. Brought closer to read, it squares up to the eye.
    const d = this.heldDistance(camera) / this.mag;
    const sq = THREE.MathUtils.clamp((this.mag - 1) * 2, 0, 1);
    _m2.makeRotationX(-0.08 * (1 - sq) + lowered * 0.9);
    _m2.setPosition(this.off.x, d * 0.02 * (1 - sq) + this.off.y - lowered * d * 0.95, -d + lowered * 0.08);
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

  get reading() { return this.state === 'held'; }
  get inHand() { return this.state !== 'rest'; }

  update(dt: number, camera: THREE.Camera) {
    const e = 1 - Math.exp(-dt * 12);
    this.mag += (this.magTarget - this.mag) * e;
    this.off.lerp(this.offTarget, e);
    // pose
    const tgt = { p: _p, q: _q };
    if (this.state === 'lifting') {
      this.anim = Math.min(1, this.anim + dt / 0.7);
      const k = ease(this.anim);
      this.heldPose(camera, 0, tgt);
      this.root.position.lerpVectors(this.from.p, tgt.p, k);
      this.root.position.y += Math.sin(Math.PI * k) * 0.12;
      this.root.quaternion.slerpQuaternions(this.from.q, tgt.q, k);
      if (this.anim > 0.4 && this.openTarget === 0) {
        this.openTarget = Math.PI;
        this.onSound?.('open');
      }
      if (this.anim >= 1) this.state = 'held';
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
    // cover
    if (this.open !== this.openTarget) {
      const sp = dt * 7.5;
      this.open = this.open < this.openTarget ? Math.min(this.openTarget, this.open + sp) : Math.max(this.openTarget, this.open - sp);
      this.layoutBlocks();
    }
    // page turn
    if (this.flip) {
      const f = this.flip;
      f.t = Math.min(1, f.t + dt / f.time);
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
      }
    }
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
    const page = this.pages[idx];
    const link = page?.hitAt(hit.uv.x, 1 - hit.uv.y);
    if (link) return { kind: 'link', href: link.href, page: link.page };
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
