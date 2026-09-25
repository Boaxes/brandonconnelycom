import * as THREE from 'three';
import { fbm2, noise2, mulberry32 } from '../util/noise';
import { makeMaterial } from './UnderwaterMaterial';

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

export function floorNormal(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.5;
  const hx = floorHeight(x + e, z) - floorHeight(x - e, z);
  const hz = floorHeight(x, z + e) - floorHeight(x, z - e);
  return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}

export function buildTerrain(): THREE.Mesh {
  const size = WORLD.size;
  const seg = 110;
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
  const { mat } = makeMaterial({ amp: 0 }, { roughness: 0.95, detail: true });
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
  const { mat } = makeMaterial({ amp: 0 }, { roughness: 0.9 });
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
