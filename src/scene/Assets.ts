import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type ModelName =
  | 'orca' | 'humpback' | 'dolphin_pws' | 'dalls_porpoise'
  | 'chinook' | 'herring' | 'copper_rockfish' | 'lingcod' | 'sixgill'
  | 'harbor_seal' | 'steller_sea_lion'
  | 'dungeness_crab' | 'red_rock_crab' | 'kelp_crab' | 'decorator_crab'
  | 'giant_pacific_octopus' | 'moon_jelly' | 'lions_mane' | 'sea_nettle'
  | 'ochre_star' | 'sunflower_star' | 'red_urchin' | 'plumose_anemone'
  | 'bull_kelp' | 'sugar_kelp';

export const MODEL_NAMES: ModelName[] = [
  'orca', 'humpback', 'dolphin_pws', 'dalls_porpoise',
  'chinook', 'herring', 'copper_rockfish', 'lingcod', 'sixgill',
  'harbor_seal', 'steller_sea_lion',
  'dungeness_crab', 'red_rock_crab', 'kelp_crab', 'decorator_crab',
  'giant_pacific_octopus', 'moon_jelly', 'lions_mane', 'sea_nettle',
  'ochre_star', 'sunflower_star', 'red_urchin', 'plumose_anemone',
  'bull_kelp', 'sugar_kelp',
];

const geometries = new Map<ModelName, THREE.BufferGeometry>();

/** Load every model; resolves when all geometries are ready. Reports progress 0..1. */
export async function loadAll(onProgress?: (p: number) => void): Promise<void> {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL + 'models/';
  let done = 0;
  await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(base + name + '.glb');
      let geo: THREE.BufferGeometry | null = null;
      gltf.scene.traverse((o) => {
        if (!geo && (o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry;
      });
      if (!geo) throw new Error('no mesh in ' + name);
      const g = geo as THREE.BufferGeometry;
      // vertex colours arrive as COLOR_0 (vec4). Keep only rgb for our material.
      const col = g.getAttribute('color');
      if (col && col.itemSize === 4) {
        const rgb = new Float32Array(col.count * 3);
        for (let i = 0; i < col.count; i++) {
          rgb[i * 3] = col.getX(i);
          rgb[i * 3 + 1] = col.getY(i);
          rgb[i * 3 + 2] = col.getZ(i);
        }
        g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      }
      g.computeBoundingSphere();
      g.computeBoundingBox();
      geometries.set(name, g);
      done++;
      onProgress?.(done / MODEL_NAMES.length);
    }),
  );
}

export function geometry(name: ModelName): THREE.BufferGeometry {
  const g = geometries.get(name);
  if (!g) throw new Error('model not loaded: ' + name);
  return g;
}
