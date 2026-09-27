import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/**
 * The scans' textures are GPU-compressed (KTX2, see tools/assets/optimize.mjs): transcoded, in workers, to
 * whatever this GPU takes. One loader for everything, set up once the renderer exists.
 */
let gltf: GLTFLoader | null = null;
export function setupLoaders(renderer: THREE.WebGLRenderer) {
  const ktx2 = new KTX2Loader().setTranscoderPath(import.meta.env.BASE_URL + 'basis/').detectSupport(renderer);
  gltf = new GLTFLoader().setKTX2Loader(ktx2);
}
function loader() {
  if (!gltf) throw new Error('setupLoaders() first');
  return gltf;
}

/**
 * Baked photogrammetry scans from tools/blender/scans.py (textured, one material each).
 * `swim` says how to derive the swim-deformation coordinates from the geometry.
 */
export type SwimRule = 'body' | 'radial' | 'octopus' | 'static';
export const SCANS: Record<string, { swim: SwimRule; core?: number }> = {
  herring: { swim: 'body' },
  salmon: { swim: 'body' },
  rockfish_copper: { swim: 'body' },
  rockfish_black: { swim: 'body' },
  giant_pacific_octopus: { swim: 'octopus', core: 0.22 },
  crab_dungeness: { swim: 'radial', core: 0.3 },
  crab_helmet: { swim: 'radial', core: 0.32 },
  crab_kelp: { swim: 'radial', core: 0.26 },
  crab_decorator: { swim: 'radial', core: 0.26 },
  sunflower_star: { swim: 'radial', core: 0.16 },
  urchin: { swim: 'static' },
  bat_star: { swim: 'static' },
  scallop: { swim: 'static' },
  harbor_porpoise: { swim: 'body' },
  sea_cucumber: { swim: 'body' },
  starry_flounder: { swim: 'body' },
  sculpin: { swim: 'body' },
  prawn: { swim: 'body' },
  dogfish: { swim: 'body' },
  ca_sea_lion: { swim: 'body' },
  orca: { swim: 'body' },
  humpback: { swim: 'body' },
  rock_boulder: { swim: 'static' },
  // the book's rock, seen from half a metre in the opening: a CC0 Poly Haven scan with 2K maps
  hero_rock: { swim: 'static' },
  driftwood: { swim: 'static' },
  wreck: { swim: 'static' },
  anchor: { swim: 'static' },
  barrel: { swim: 'static' },
  sand_dollar: { swim: 'static' },
  moon_snail: { swim: 'static' },
};

/** Packs of several ready-made pieces in one file; each mesh is registered as 'scan:<key>_<i>'. */
export const SCAN_SETS: Record<string, number> = { rockset: 5 };

export interface ModelAsset {
  geometry: THREE.BufferGeometry;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  /**
   * Simpler versions of the mesh, coarsest last (tools/assets/lod.mjs), each with how far its surface
   * strays from the scan's (m, at the model's own size)
   */
  lods: { geometry: THREE.BufferGeometry; error: number }[];
}

const assets = new Map<string, ModelAsset>();

/** Derive swim coordinates (x: position along body / appendage 0..1, y: part id) from geometry. */
export function computeSwim(g: THREE.BufferGeometry, rule: SwimRule, core = 0.3) {
  const pos = g.getAttribute('position');
  const n = pos.count;
  const arr = new Float32Array(n * 2);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const len = bb.max.x - bb.min.x;
  if (rule === 'body') {
    for (let i = 0; i < n; i++) arr[i * 2] = (bb.max.x - pos.getX(i)) / len;
  } else if (rule === 'radial' || rule === 'octopus') {
    // appendages are whatever lies beyond a core radius around the body centre (in the ground plane)
    const cx = rule === 'octopus' ? bb.min.x + len * 0.3 : (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const r0 = core * Math.max(len, bb.max.z - bb.min.z) * 0.5;
    let rmax = 0;
    for (let i = 0; i < n; i++) rmax = Math.max(rmax, Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz));
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const r = Math.hypot(x - cx, pos.getZ(i) - cz);
      const behind = rule === 'octopus' && x < cx; // the mantle stays rigid
      if (r > r0 && !behind) {
        arr[i * 2] = (r - r0) / Math.max(rmax - r0, 1e-4);
        arr[i * 2 + 1] = 1;
      }
    }
  }
  g.setAttribute('swim', new THREE.BufferAttribute(arr, 2));
}

async function loadOne(loader: GLTFLoader, url: string) {
  const gltf = await loader.loadAsync(url);
  let mesh: THREE.Mesh | null = null;
  const levels: THREE.Mesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    if (/^lod\d$/.test(o.name)) levels.push(o as THREE.Mesh);
    else if (!mesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error('no mesh in ' + url);
  const place = (m: THREE.Mesh) => m.geometry.clone().applyMatrix4(m.matrixWorld);
  const m = mesh as THREE.Mesh;
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  const lods = levels.sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({
    geometry: place(l),
    error: (l.userData.lodError ?? Infinity) * l.matrixWorld.getMaxScaleOnAxis(),
  }));
  return { geo: place(m), mat: (mat as THREE.MeshStandardMaterial) ?? null, lods };
}

async function loadSet(loader: GLTFLoader, key: string, url: string) {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  meshes.forEach((m, i) => {
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    // each piece sits on y=0, centred on its footprint
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geo.deleteAttribute('color');
    computeSwim(geo, 'static');
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    for (const t of [mat.map, mat.normalMap]) if (t) t.anisotropy = 8;
    assets.set(`scan:${key}_${i}`, { geometry: geo, map: mat.map ?? undefined, normalMap: mat.normalMap ?? undefined, lods: [] });
  });
}

/** Visitors that don't appear in the first ~40 s: fetched after the scene is already showing. */
export const LATE = new Set(['orca', 'humpback', 'harbor_porpoise']);

/** Fetch the late visitors in the background. */
export async function loadLate(): Promise<void> {
  const loader_ = loader();
  const base = import.meta.env.BASE_URL + 'models/';
  await Promise.all([...LATE].map((key) => loadScan(loader_, base, key)));
}

async function loadScan(loader: GLTFLoader, base: string, key: string) {
  try {
    const { geo, mat, lods } = await loadOne(loader, base + 'scan_' + key + '.glb');
    // (the levels share the scan's vertices, so their swim coordinates come out the same)
    for (const g of [geo, ...lods.map((l) => l.geometry)]) {
      g.deleteAttribute('color');
      computeSwim(g, SCANS[key].swim, SCANS[key].core);
      g.computeBoundingSphere();
    }
    for (const t of [mat?.map, mat?.normalMap]) if (t) t.anisotropy = 8;
    assets.set('scan:' + key, { geometry: geo, map: mat?.map ?? undefined, normalMap: mat?.normalMap ?? undefined, lods });
  } catch (e) {
    console.warn('scan missing', key, e);
  }
}

/** Load everything needed for the opening; resolves when those geometries are ready. Reports progress 0..1. */
export async function loadAll(onProgress?: (p: number) => void): Promise<void> {
  const loader_ = loader();
  const base = import.meta.env.BASE_URL + 'models/';
  const scanKeys = Object.keys(SCANS).filter((k) => !LATE.has(k));
  const total = scanKeys.length + Object.keys(SCAN_SETS).length;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  await Promise.all([
    ...Object.keys(SCAN_SETS).map(async (key) => {
      try {
        await loadSet(loader_, key, base + 'scan_' + key + '.glb');
      } catch (e) {
        console.warn('scan set missing', key, e);
      }
      tick();
    }),
    ...scanKeys.map(async (key) => {
      await loadScan(loader_, base, key);
      tick();
    }),
  ]);
}

export function hasAsset(name: string) {
  return assets.has(name);
}

export function asset(name: string): ModelAsset {
  const a = assets.get(name);
  if (!a) throw new Error('model not loaded: ' + name);
  return a;
}
