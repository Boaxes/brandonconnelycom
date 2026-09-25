import * as THREE from 'three';
import { fbm2, noise2, mulberry32 } from '../util/noise';
import { ensureSwim, makeMaterial, type UnderwaterUniforms } from './UnderwaterMaterial';

export const WORLD = {
  size: 170,          // metres, square, centred at origin
  surfaceY: 22,       // water surface height above y=0
};

/** Seafloor height (y) at world x,z. Deterministic, used by sim and mesh. */
export function floorHeight(x: number, z: number): number {
  const s = 0.012;
  let h = fbm2(x * s, z * s, 4) * 3.6;                 // broad swells
  h += fbm2(x * 0.045 + 40, z * 0.045, 3) * 1.4;        // mounds and hollows
  h += fbm2(x * 0.16 + 11, z * 0.16 + 7, 2) * 0.28;      // small lumps
  // gentle slope: deeper toward -z (open water), shallower toward +z
  h += z * 0.035;
  // a slight channel through the middle
  h -= Math.exp(-((x + 20) * (x + 20)) / 900) * 1.4;
  return h;
}

/**
 * The stage: one fixed diver's-eye viewpoint a couple of metres off the bottom, looking down the slope
 * into deeper water. The portfolio page covers the middle of the screen, so what matters are the strips
 * of scene visible either side of it; life and scenery are placed by camera-relative yaw and distance.
 */
export const PAPER_W = 760; // px, keep in sync with --paper-w in ui/style.css
export const STAGE = {
  cam: new THREE.Vector3(4, 0, 10),
  look: new THREE.Vector3(4, 0, -2),
  height: 1.45,   // camera above the floor
  fov: 58,
  fwd: new THREE.Vector3(),   // horizontal forward
  right: new THREE.Vector3(), // horizontal right
  ready: false,
};

export function stage() {
  if (!STAGE.ready) {
    STAGE.cam.y = floorHeight(STAGE.cam.x, STAGE.cam.z) + STAGE.height;
    // look down the slope with a bit of downward pitch: the floor is where the detail is
    STAGE.look.y = floorHeight(STAGE.look.x, STAGE.look.z) - 0.9;
    STAGE.fwd.subVectors(STAGE.look, STAGE.cam).setY(0).normalize();
    STAGE.right.set(-STAGE.fwd.z, 0, STAGE.fwd.x);
    STAGE.ready = true;
  }
  return STAGE;
}

/** Yaw band (radians from forward) of the strips visible beside the page, for the current window. */
export function marginYaw(): { inner: number; outer: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const th = Math.tan(THREE.MathUtils.degToRad(STAGE.fov / 2)) * (w / h);
  const outer = Math.atan(th);
  const inner = Math.atan(th * Math.min(1, PAPER_W / w));
  // page covers (nearly) everything: fall back to a sensible band so the scene is still laid out
  if (outer - inner < 0.12) return { inner: 0.42, outer: 0.72 };
  return { inner, outer };
}

/** Floor point `dist` metres (horizontal) from the camera, `yaw` radians right of forward. */
export function stageFloor(yaw: number, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
  const s = stage();
  out.copy(s.cam).addScaledVector(s.fwd, Math.cos(yaw) * dist).addScaledVector(s.right, Math.sin(yaw) * dist);
  out.y = floorHeight(out.x, out.z);
  return out;
}

/** Water point: like stageFloor, `height` metres above the floor there. */
export function stageWater(yaw: number, dist: number, height: number, out = new THREE.Vector3()): THREE.Vector3 {
  stageFloor(yaw, dist, out);
  out.y += height;
  return out;
}

/**
 * Random floor point in the strips beside the page (side -1 left, 1 right, 0 either),
 * `dMin`..`dMax` metres out. `pad` keeps it a little inside the strip.
 */
export function randomFloorInMargins(rnd: () => number, dMin: number, dMax: number, out = new THREE.Vector3(), side = 0, pad = 0.03): THREE.Vector3 {
  const m = marginYaw();
  const sd = side || (rnd() < 0.5 ? -1 : 1);
  const yaw = sd * (m.inner + pad + rnd() * Math.max(0.01, m.outer - m.inner - 2 * pad));
  return stageFloor(yaw, dMin + rnd() * (dMax - dMin), out);
}

/** Random floor point anywhere in front of the camera (`spread` > 1 reaches past the frame edges). */
export function randomFloorInView(rnd: () => number, dMin: number, dMax: number, out = new THREE.Vector3(), spread = 1.1): THREE.Vector3 {
  const yaw = (rnd() * 2 - 1) * marginYaw().outer * spread;
  return stageFloor(yaw, dMin + Math.sqrt(rnd()) * (dMax - dMin), out);
}

/** Yaw of a world point relative to the camera's forward (radians, + = right). */
export function yawOf(p: THREE.Vector3): number {
  const s = stage();
  const dx = p.x - s.cam.x;
  const dz = p.z - s.cam.z;
  return Math.atan2(dx * s.right.x + dz * s.right.z, dx * s.fwd.x + dz * s.fwd.z);
}

/** True if a point is in one of the visible strips beside the page. */
export function inMargins(p: THREE.Vector3): boolean {
  const m = marginYaw();
  const y = Math.abs(yawOf(p));
  return y > m.inner && y < m.outer;
}

export function floorNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.5;
  const hx = floorHeight(x + e, z) - floorHeight(x - e, z);
  const hz = floorHeight(x, z + e) - floorHeight(x, z - e);
  return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}

const _texLoader = new THREE.TextureLoader();
function tex(name: string, srgb: boolean): THREE.Texture {
  const t = _texLoader.load(import.meta.env.BASE_URL + 'textures/' + name + '.jpg');
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
let _ground: Pick<UnderwaterUniforms, 'tSand' | 'tSandN' | 'tGravel' | 'tGravelN' | 'tRock' | 'tRockN'> | null = null;
/** Shared ground/rock textures (loaded once). */
export function groundTextures() {
  if (!_ground) {
    _ground = {
      tSand: { value: tex('sand_01_diff', true) }, tSandN: { value: tex('sand_01_nor_gl', false) },
      tGravel: { value: tex('sandy_gravel_02_diff', true) }, tGravelN: { value: tex('sandy_gravel_02_nor_gl', false) },
      tRock: { value: tex('rock_06_diff', true) }, tRockN: { value: tex('rock_06_nor_gl', false) },
    };
  }
  return _ground;
}
export function attachGround(u: UnderwaterUniforms) {
  Object.assign(u, groundTextures());
}

export function buildTerrain(): THREE.Mesh {
  // only ~20 m around the fixed viewpoint is ever visible through the murk: a small, dense patch
  const size = 90;
  const seg = 220;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const s0 = stage();
  geo.translate(s0.cam.x, 0, s0.cam.z - 15);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0x7f7a60);
  const silt = new THREE.Color(0x565c4c);
  const dark = new THREE.Color(0x3f4538);
  const shell = new THREE.Color(0x9a9480);
  const c = new THREE.Color();
  const rnd = mulberry32(7);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // jitter xz a little so the grid never lines up into visible rows
    const jx = (rnd() - 0.5) * 0.35;
    const jz = (rnd() - 0.5) * 0.35;
    pos.setX(i, x + jx);
    pos.setZ(i, z + jz);
    const y = floorHeight(x + jx, z + jz);
    pos.setY(i, y);
    const m = fbm2(x * 0.03 + 7, z * 0.03 + 3, 3) * 0.5 + 0.5;
    const patch = noise2(x * 0.09, z * 0.09) * 0.5 + 0.5;
    c.copy(sand).lerp(silt, Math.pow(m, 1.3));
    if (patch > 0.68) c.lerp(shell, (patch - 0.68) * 2.2);
    if (m < 0.3) c.lerp(dark, 0.4);
    c.offsetHSL(0, 0, (rnd() - 0.5) * 0.04);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  ensureSwim(geo);
  const { mat, uniforms } = makeMaterial({ amp: 0 }, { roughness: 0.95, detail: 1 });
  attachGround(uniforms);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
