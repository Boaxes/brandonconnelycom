import * as THREE from 'three';
import { fbm2, noise2, mulberry32 } from '../util/noise';
import { makeMaterial, type UnderwaterUniforms } from './UnderwaterMaterial';

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

/** The loop the camera drifts along; benthic life is seeded near it so it is seen. */
let _path: THREE.CatmullRomCurve3 | null = null;
export function cameraPath(): THREE.CatmullRomCurve3 {
  if (_path) return _path;
  const r = WORLD.size * 0.32;
  const pts: THREE.Vector3[] = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.8 + 0.25 * Math.sin(i * 2.3));
    pts.push(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr * 0.8));
  }
  _path = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  return _path;
}

/** Random floor point within `spread` metres of the camera loop. */
export function randomFloorNearPath(spread: number, out = new THREE.Vector3(), rnd: () => number = Math.random): THREE.Vector3 {
  cameraPath().getPointAt(rnd(), out);
  const a = rnd() * Math.PI * 2;
  const d = Math.sqrt(rnd()) * spread;
  out.x += Math.cos(a) * d;
  out.z += Math.sin(a) * d;
  out.y = floorHeight(out.x, out.z);
  return out;
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
  // the mesh extends well past the simulated area so the edge is never seen through the fog
  const size = WORLD.size * 1.3;
  const seg = 180;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
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
    // jitter xz a little for a less grid-like facet pattern
    const jx = (rnd() - 0.5) * 0.8;
    const jz = (rnd() - 0.5) * 0.8;
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
  // flat shading needs unindexed geometry so each face gets its own normal
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  // zero the uv so the swim shader does nothing to the floor
  const uv = flat.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0, 0);
  const { mat, uniforms } = makeMaterial({ amp: 0 }, { roughness: 0.95, detail: 1 });
  attachGround(uniforms);
  const mesh = new THREE.Mesh(flat, mat);
  mesh.receiveShadow = false;
  mesh.name = 'terrain';
  return mesh;
}


/** Pebbles and shell fragments scattered on the floor. */
export function buildDebris(count = 500): THREE.InstancedMesh {
  const rnd = mulberry32(3);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const n = flat.attributes.position.count;
  const cols = new Float32Array(n * 3).fill(1);
  flat.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const uv = flat.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0, 0);
  const { mat, uniforms } = makeMaterial({ amp: 0 }, { roughness: 0.9, detail: 2 });
  attachGround(uniforms);
  const mesh = new THREE.InstancedMesh(flat, mat, count);
  mesh.name = 'debris';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const half = WORLD.size / 2 - 10;
  for (let i = 0; i < count; i++) {
    p.set((rnd() * 2 - 1) * half, 0, (rnd() * 2 - 1) * half);
    p.y = floorHeight(p.x, p.z) - 0.02;
    const shell = rnd() < 0.35;
    const r = shell ? 0.03 + rnd() * 0.05 : 0.04 + rnd() * 0.1;
    q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
    s.set(r * (0.8 + rnd() * 0.5), r * (shell ? 0.25 : 0.55), r * (0.8 + rnd() * 0.5));
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (shell) c.setHSL(0.08 + rnd() * 0.05, 0.15, 0.5 + rnd() * 0.15);
    else c.setHSL(0.15 + rnd() * 0.1, 0.08, 0.22 + rnd() * 0.18);
    mesh.setColorAt(i, c);
  }
  return mesh;
}
