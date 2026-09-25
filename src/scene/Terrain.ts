import * as THREE from 'three';
import { fbm2, noise2, mulberry32 } from '../util/noise';
import { ensureSwim, makeMaterial, type UnderwaterUniforms } from './UnderwaterMaterial';

export const WORLD = {
  size: 170,          // metres, square, centred at origin
  surfaceY: 22,       // water surface height above y=0
};

/** The fixed viewpoint's footprint; the local landforms below are placed relative to it. */
const CX = 4;
const CZ = 10;

/** Seafloor height (y) at world x,z. Deterministic, used by sim and mesh. */
export function floorHeight(x: number, z: number): number {
  const s = 0.012;
  let h = fbm2(x * s, z * s, 4) * 3.6;                 // broad swells
  h += fbm2(x * 0.045 + 40, z * 0.045, 3) * 1.4;        // mounds and hollows
  h += fbm2(x * 0.16 + 11, z * 0.16 + 7, 2) * 0.28;      // small lumps
  // gentle slope: deeper toward -z (north, open water), shallower toward +z
  h += z * 0.035;
  // around the viewpoint: the floor rises to the south under a pile of boulders, drops off to the west
  const dz = z - CZ;
  const dx = x - CX;
  h += smooth(3, 11, dz) * 1.6 + smooth(9, 16, dz) * 2.5;
  h -= smooth(5, 18, -dx) * 3.2;
  return h;
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * The stage: one fixed diver's-eye position a metre and a half off the bottom, about 30 ft down.
 * The camera looks around in steps but never moves, so the scenery is composed as a ring around it:
 * each heading has its own landmark (reef, wreck, sand flat, boulder pile, anchor, logs) and the surface is overhead.
 * Placement helpers take a heading (yaw, radians clockwise from north / the starting view) and a distance.
 */
export const STAGE = {
  cam: new THREE.Vector3(CX, 0, CZ),
  height: 1.3,    // camera above the floor
  depth: 9.1,     // camera below the surface (~30 ft)
  fov: 58,
  fwd: new THREE.Vector3(0, 0, -1),  // north: the starting view
  right: new THREE.Vector3(1, 0, 0), // east
  ready: false,
};

export function stage() {
  if (!STAGE.ready) {
    STAGE.cam.y = floorHeight(STAGE.cam.x, STAGE.cam.z) + STAGE.height;
    WORLD.surfaceY = STAGE.cam.y + STAGE.depth;
    STAGE.ready = true;
  }
  return STAGE;
}

/** Horizontal unit vector for a heading (radians clockwise from north). */
export function headingDir(yaw: number, out = new THREE.Vector3()) {
  const s = stage();
  return out.copy(s.fwd).multiplyScalar(Math.cos(yaw)).addScaledVector(s.right, Math.sin(yaw));
}

/** Floor point `dist` metres (horizontal) from the camera along heading `yaw`. */
export function stageFloor(yaw: number, dist: number, out = new THREE.Vector3()): THREE.Vector3 {
  const s = stage();
  headingDir(yaw, out).multiplyScalar(dist).add(s.cam);
  out.y = floorHeight(out.x, out.z);
  return out;
}

/** Water point: like stageFloor, `height` metres above the floor there. */
export function stageWater(yaw: number, dist: number, height: number, out = new THREE.Vector3()): THREE.Vector3 {
  stageFloor(yaw, dist, out);
  out.y += height;
  return out;
}

/** Random floor point in a sector: heading `yaw` ± `spread` radians, `dMin`..`dMax` metres out. */
export function randomFloorInSector(rnd: () => number, yaw: number, spread: number, dMin: number, dMax: number, out = new THREE.Vector3()): THREE.Vector3 {
  return stageFloor(yaw + (rnd() * 2 - 1) * spread, dMin + Math.sqrt(rnd()) * (dMax - dMin), out);
}

/** Random floor point anywhere around the camera, `dMin`..`dMax` metres out. */
export function randomFloorAround(rnd: () => number, dMin: number, dMax: number, out = new THREE.Vector3()): THREE.Vector3 {
  return randomFloorInSector(rnd, 0, Math.PI, dMin, dMax, out);
}

/** Heading of a world point from the camera (radians clockwise from north). */
export function yawOf(p: THREE.Vector3): number {
  const s = stage();
  const dx = p.x - s.cam.x;
  const dz = p.z - s.cam.z;
  return Math.atan2(dx * s.right.x + dz * s.right.z, dx * s.fwd.x + dz * s.fwd.z);
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
/**
 * Where the floor is sand and where it's gravel: rotated, domain-warped fbm (thresholded plain value
 * noise made grid-aligned squares), baked once into a texture over the terrain patch so the floor
 * shader only does one lookup.
 */
const BLEND_SIZE = 96;
const BLEND_RES = 512;
function blendMask() {
  const s = stage();
  const x0 = s.cam.x - BLEND_SIZE / 2;
  const z0 = s.cam.z - BLEND_SIZE / 2;
  const data = new Uint8Array(BLEND_RES * BLEND_RES);
  const c = 0.8, sn = 0.6;
  for (let j = 0; j < BLEND_RES; j++) {
    for (let i = 0; i < BLEND_RES; i++) {
      const x = x0 + (i / BLEND_RES) * BLEND_SIZE;
      const z = z0 + (j / BLEND_RES) * BLEND_SIZE;
      let qx = (c * x - sn * z) * 0.07;
      let qz = (sn * x + c * z) * 0.07;
      qx += noise2(qx * 1.7 + 3.1, qz * 1.7) * 1.3;
      qz += noise2(qx * 1.7 - 5.3, qz * 1.7 + 2) * 1.3;
      const n = fbm2(qx, qz, 4) * 0.5 + 0.5;
      data[j * BLEND_RES + i] = Math.max(0, Math.min(255, Math.round(n * 255)));
    }
  }
  const t = new THREE.DataTexture(data, BLEND_RES, BLEND_RES, THREE.RedFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return { t, rect: new THREE.Vector4(x0, z0, 1 / BLEND_SIZE, 0) };
}

let _ground: Pick<UnderwaterUniforms, 'tSand' | 'tSandN' | 'tGravel' | 'tGravelN' | 'tRock' | 'tRockN' | 'tBlend' | 'uBlendRect'> | null = null;
/** Shared ground/rock textures (loaded once). */
export function groundTextures() {
  if (!_ground) {
    const b = blendMask();
    _ground = {
      tSand: { value: tex('sand_01_diff', true) }, tSandN: { value: tex('sand_01_nor_gl', false) },
      tGravel: { value: tex('sandy_gravel_02_diff', true) }, tGravelN: { value: tex('sandy_gravel_02_nor_gl', false) },
      tRock: { value: tex('rock_06_diff', true) }, tRockN: { value: tex('rock_06_nor_gl', false) },
      tBlend: { value: b.t }, uBlendRect: { value: b.rect },
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
  geo.translate(s0.cam.x, 0, s0.cam.z);
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
