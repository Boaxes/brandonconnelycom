import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ensureSwim } from './UnderwaterMaterial';

/** Procedural models from tools/blender/creatures.py (vertex coloured, swim coords in uv). */
export type ModelName =
  | 'orca' | 'humpback' | 'dolphin_pws' | 'dalls_porpoise'
  | 'chinook' | 'herring' | 'copper_rockfish' | 'lingcod' | 'sixgill'
  | 'harbor_seal' | 'steller_sea_lion'
  | 'dungeness_crab' | 'red_rock_crab' | 'kelp_crab' | 'decorator_crab'
  | 'giant_pacific_octopus' | 'moon_jelly' | 'lions_mane' | 'sea_nettle'
  | 'ochre_star' | 'sunflower_star' | 'red_urchin' | 'plumose_anemone'
  | 'bull_kelp' | 'sugar_kelp' | 'orange_sea_pen' | 'tube_anemone';

export const MODEL_NAMES: ModelName[] = [
  'orca', 'humpback', 'dolphin_pws', 'dalls_porpoise',
  'chinook', 'herring', 'copper_rockfish', 'lingcod', 'sixgill',
  'harbor_seal', 'steller_sea_lion',
  'dungeness_crab', 'red_rock_crab', 'kelp_crab', 'decorator_crab',
  'giant_pacific_octopus', 'moon_jelly', 'lions_mane', 'sea_nettle',
  'ochre_star', 'sunflower_star', 'red_urchin', 'plumose_anemone',
  'bull_kelp', 'sugar_kelp', 'orange_sea_pen', 'tube_anemone',
];

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
  sea_cucumber: { swim: 'body' },
  starry_flounder: { swim: 'body' },
  sculpin: { swim: 'body' },
  prawn: { swim: 'body' },
  dogfish: { swim: 'body' },
  harbor_seal: { swim: 'body' },
  orca: { swim: 'body' },
  humpback: { swim: 'body' },
  barnacle_rock: { swim: 'static' },
  rock_boulder: { swim: 'static' },
  log: { swim: 'static' },
};

export interface ModelAsset {
  geometry: THREE.BufferGeometry;
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
}

const assets = new Map<string, ModelAsset>();

function srgbToLinearColors(g: THREE.BufferGeometry) {
  const col = g.getAttribute('color');
  if (!col) return;
  // authored as display (sRGB) values in the generator; the renderer wants linear
  const rgb = new Float32Array(col.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < col.count; i++) {
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.SRGBColorSpace);
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
}

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

async function loadOne(loader: GLTFLoader, url: string): Promise<{ geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial | null }> {
  const gltf = await loader.loadAsync(url);
  let mesh: THREE.Mesh | null = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error('no mesh in ' + url);
  const m = mesh as THREE.Mesh;
  const geo = m.geometry.clone();
  geo.applyMatrix4(m.matrixWorld);
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  return { geo, mat: (mat as THREE.MeshStandardMaterial) ?? null };
}

/** Load every model; resolves when all geometries are ready. Reports progress 0..1. */
export async function loadAll(onProgress?: (p: number) => void): Promise<void> {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  const scanKeys = Object.keys(SCANS);
  const total = MODEL_NAMES.length + scanKeys.length;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  await Promise.all([
    ...MODEL_NAMES.map(async (name) => {
      const { geo } = await loadOne(loader, base + name + '.glb');
      srgbToLinearColors(geo);
      ensureSwim(geo, true); // procedural models encode swim coordinates in their uv
      geo.computeBoundingSphere();
      assets.set(name, { geometry: geo });
      tick();
    }),
    ...scanKeys.map(async (key) => {
      try {
        const { geo, mat } = await loadOne(loader, base + 'scan_' + key + '.glb');
        geo.deleteAttribute('color');
        computeSwim(geo, SCANS[key].swim, SCANS[key].core);
        geo.computeBoundingSphere();
        assets.set('scan:' + key, { geometry: geo, map: mat?.map ?? undefined, normalMap: mat?.normalMap ?? undefined });
      } catch (e) {
        console.warn('scan missing, falling back to procedural', key, e);
      }
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

/** Back-compat: geometry of a procedural model. */
export function geometry(name: ModelName): THREE.BufferGeometry {
  return asset(name).geometry;
}
