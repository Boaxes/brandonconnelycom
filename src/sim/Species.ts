import * as THREE from 'three';
import { asset, hasAsset } from '../scene/Assets';
import { makeDepthMaterial, makeMaterial, type SwimParams } from '../scene/UnderwaterMaterial';
import type { Agent } from './Agent';

export interface SpeciesDef {
  key: string;
  name: string;
  latin: string;
  scale: [number, number];
  swim: Partial<SwimParams>;
  appendageAmp?: number;
  tint?: THREE.ColorRepresentation;
  emissive?: { color: THREE.ColorRepresentation; strength: number };
  opacity?: number;
  side?: THREE.Side;
  large?: boolean; // counts as a "large animal" for audio cues
  roughness?: number;
  mode?: number;      // 0 swim, 1 crab gait, 2 jelly bell
  scan: string;       // baked photogrammetry model (public/models/scan_<scan>.glb)
  bendGain?: number;  // how much the body curves into turns
  gait?: number;      // bottom walker: amplitude of the per-step rock and bob (the mesh itself stays rigid)
  translucency?: number; // light passing through thin tissue (jellies, kelp, tentacles)
  palette?: number[];    // per-individual colour morphs, multiplied over the model's colours
}

export const SPECIES: Record<string, SpeciesDef> = {
  // visitors
  orca: { key: 'orca', scan: 'orca', roughness: 0.5, name: 'Orca', latin: 'Orcinus orca', scale: [0.95, 1.1], swim: { amp: 0.28, freq: 0.55, speed: 3.2, axis: 1, bodyStart: 0.45 }, large: true },
  humpback: { key: 'humpback', scan: 'humpback', roughness: 0.5, name: 'Humpback whale', latin: 'Megaptera novaeangliae', scale: [1, 1], swim: { amp: 0.6, freq: 0.5, speed: 1.6, axis: 1, bodyStart: 0.5 }, large: true },
  porpoise: { key: 'porpoise', scan: 'harbor_porpoise', roughness: 0.45, name: 'Harbor porpoise', latin: 'Phocoena phocoena', scale: [0.9, 1.1], swim: { amp: 0.12, freq: 0.6, speed: 6, axis: 1, bodyStart: 0.45 }, large: true },
  sealion: { key: 'sealion', scan: 'ca_sea_lion', roughness: 0.45, name: 'California sea lion', latin: 'Zalophus californianus', scale: [0.95, 1.08], swim: { amp: 0.07, freq: 0.55, speed: 4, axis: 1, bodyStart: 0.45 }, large: true },
  // fish
  chinook: { key: 'chinook', scan: 'salmon', roughness: 0.6, name: 'Chinook salmon', latin: 'Oncorhynchus tshawytscha', scale: [0.8, 1.2], swim: { amp: 0.07, freq: 0.75, speed: 6, axis: 0, bodyStart: 0.35 } },
  herring: { key: 'herring', scan: 'herring', roughness: 0.6, name: 'Pacific herring', latin: 'Clupea pallasii', scale: [0.8, 1.15], swim: { amp: 0.025, freq: 0.8, speed: 9, axis: 0, bodyStart: 0.3 } },
  rockfish: { key: 'rockfish', scan: 'rockfish_copper', roughness: 0.6, name: 'Copper rockfish', latin: 'Sebastes caurinus', scale: [0.8, 1.2], swim: { amp: 0.03, freq: 0.7, speed: 3.5, axis: 0, bodyStart: 0.45 } },
  blackrockfish: { key: 'blackrockfish', scan: 'rockfish_black', roughness: 0.55, name: 'Black rockfish', latin: 'Sebastes melanops', scale: [0.85, 1.2], swim: { amp: 0.03, freq: 0.7, speed: 3.5, axis: 0, bodyStart: 0.45 } },
  flounder: { key: 'flounder', scan: 'starry_flounder', roughness: 0.65, name: 'Starry flounder', latin: 'Platichthys stellatus', scale: [0.8, 1.2], swim: { amp: 0.05, freq: 0.6, speed: 3, axis: 1, bodyStart: 0.35 } },
  sculpin: { key: 'sculpin', scan: 'sculpin', roughness: 0.7, name: 'Buffalo sculpin', latin: 'Enophrys bison', scale: [0.8, 1.2], swim: { amp: 0.03, freq: 0.6, speed: 3, axis: 0, bodyStart: 0.45 } },
  dogfish: { key: 'dogfish', scan: 'dogfish', roughness: 0.55, name: 'Spiny dogfish', latin: 'Squalus suckleyi', scale: [0.85, 1.15], swim: { amp: 0.08, freq: 0.6, speed: 4.5, axis: 0, bodyStart: 0.35 }, large: true },
  // bottom walkers: rigid bodies, the gait is a small rock and bob added per instance
  dungeness: { key: 'dungeness', scan: 'crab_dungeness', gait: 1, name: 'Dungeness crab', latin: 'Metacarcinus magister', scale: [0.9, 1.2], swim: { amp: 0 } },
  redrock: { key: 'redrock', scan: 'crab_helmet', gait: 1, name: 'Helmet crab', latin: 'Telmessus cheiragonus', scale: [0.9, 1.2], swim: { amp: 0 } },
  kelpcrab: { key: 'kelpcrab', scan: 'crab_kelp', gait: 1, name: 'Northern kelp crab', latin: 'Pugettia producta', scale: [0.9, 1.3], swim: { amp: 0 } },
  decorator: { key: 'decorator', scan: 'crab_decorator', gait: 1, name: 'Decorator crab', latin: 'Oregonia gracilis', scale: [0.9, 1.3], swim: { amp: 0 } },
  prawn: { key: 'prawn', scan: 'prawn', gait: 0.6, roughness: 0.5, name: 'Spot prawn', latin: 'Pandalus platyceros', scale: [0.85, 1.2], swim: { amp: 0 } },
  cucumber: { key: 'cucumber', scan: 'sea_cucumber', roughness: 0.6, name: 'California sea cucumber', latin: 'Apostichopus californicus', scale: [0.9, 1.3], swim: { amp: 0.02, freq: 0.3, speed: 0.4, axis: 0, bodyStart: 0 } },
  // camouflaged to the rock it hides in, and on the small side so it fits its crevice
  octopus: { key: 'octopus', scan: 'giant_pacific_octopus', tint: 0xb4a292, roughness: 0.6, name: 'Giant Pacific octopus', latin: 'Enteroctopus dofleini', scale: [0.72, 0.76], swim: { amp: 0 }, appendageAmp: 0.035, large: true },
  // fixed life
  batstar: { key: 'batstar', scan: 'bat_star', roughness: 0.6, name: 'Bat star', latin: 'Patiria miniata', scale: [0.8, 1.3], swim: { amp: 0 } },
  sunflowerstar: { key: 'sunflowerstar', scan: 'sunflower_star', appendageAmp: 0.008, name: 'Sunflower sea star', latin: 'Pycnopodia helianthoides', scale: [0.8, 1.3], swim: { amp: 0 } },
  urchin: { key: 'urchin', scan: 'urchin', name: 'Purple sea urchin', latin: 'Strongylocentrotus purpuratus', scale: [0.8, 1.4], swim: { amp: 0 } },
  sanddollar: { key: 'sanddollar', scan: 'sand_dollar', roughness: 0.7, name: 'Eccentric sand dollar', latin: 'Dendraster excentricus', scale: [0.8, 1.2], swim: { amp: 0 } },
  moonsnail: { key: 'moonsnail', scan: 'moon_snail', roughness: 0.5, name: "Lewis's moon snail", latin: 'Neverita lewisii', scale: [0.8, 1.3], swim: { amp: 0 } },
  scallop: { key: 'scallop', scan: 'scallop', roughness: 0.5, name: 'Rock scallop', latin: 'Crassadoma gigantea', scale: [0.9, 1.5], swim: { amp: 0 } },
};

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _sphere = new THREE.Sphere();

/** A species can be shown only if its scan loaded. */
export function hasSpecies(key: string) {
  const d = SPECIES[key];
  return !!d && hasAsset('scan:' + d.scan);
}

/** How the water is being looked at: for leaving out the animals nobody can see, and choosing a level of detail. */
export interface LodView {
  /** the view's frustum, pushed out a little (something just outside it can still throw a torch shadow in) */
  frustum: THREE.Frustum;
  /** pixels of the drawing buffer per radian at the middle of the view, at the zoom being headed for */
  pxPerRad: number;
}

/**
 * An animal is drawn with a simpler mesh only where both hold: its shape strays by less than LOD_PX on
 * screen, and the whole animal is smaller on screen than LOD_SIZE for that level (px across). The first
 * keeps the outline where it was; the second because a simpler mesh also shades a little differently
 * (its normals are spread over bigger triangles), which only goes unseen on something that small.
 */
const LOD_PX = 0.5;
const LOD_SIZE = [Infinity, 48, 20];

/**
 * The instanced meshes for one species plus the agents they draw: the scan itself, and one mesh for each
 * simpler level of it (tools/assets/lod.mjs), each drawing the animals that suit it this frame.
 */
export class SpeciesRenderer {
  readonly meshes: THREE.InstancedMesh[] = [];
  agents: Agent[] = [];
  private attrs: { phase: THREE.InstancedBufferAttribute; speed: THREE.InstancedBufferAttribute; bend: THREE.InstancedBufferAttribute }[] = [];
  /** how far each level's surface strays from the scan's (m, at scale 1): 0 for the scan */
  private errors = [0];
  /** how far the model reaches from its origin (m, at scale 1): for leaving out what's out of view */
  private reach: number;
  private capacity: number;
  /** the scan itself (the first of `meshes`) */
  get mesh() { return this.meshes[0]; }

  constructor(public def: SpeciesDef, capacity: number) {
    const scanned = asset('scan:' + def.scan);
    this.capacity = capacity;
    const { mat, uniforms } = makeMaterial(def.swim, {
      vertexColors: false,
      map: scanned?.map,
      normalMap: scanned?.normalMap,
      appendageAmp: def.appendageAmp,
      tint: def.tint ? new THREE.Color(def.tint) : undefined,
      transparent: def.opacity !== undefined,
      opacity: def.opacity ?? 1,
      side: def.side,
      emissive: def.emissive?.color,
      roughness: def.roughness,
      mode: def.mode,
      translucency: def.translucency,
    });
    // body length along the swim axis, used to scale turn bending
    const g0 = scanned.geometry;
    g0.computeBoundingBox();
    const bb = g0.boundingBox!;
    uniforms.uSwim3.value.x = bb.max.x - bb.min.x;
    uniforms.uSwim3.value.y = def.bendGain ?? (def.swim.amp ? 0.12 : 0);
    if (def.emissive) mat.emissiveIntensity = def.emissive.strength;
    if (def.opacity !== undefined) mat.depthWrite = false;
    if (!g0.boundingSphere) g0.computeBoundingSphere();
    // (the swim bends the body a little past its bounds: a margin for that)
    this.reach = (g0.boundingSphere!.radius + g0.boundingSphere!.center.length()) * 1.15;
    // opaque life casts torch shadows with the same swim deformation as its colour pass
    const translucent = def.opacity !== undefined;
    const depth = translucent ? null : makeDepthMaterial(uniforms);
    const levels = [g0, ...scanned.lods.map((l) => l.geometry)];
    this.errors.push(...scanned.lods.map((l) => l.error));
    for (const src of levels) {
      // each mesh gets its own geometry: the per-instance attributes below differ per mesh
      const geo = src.clone();
      const mesh = new THREE.InstancedMesh(geo, mat, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.name = def.key;
      mesh.count = 0;
      mesh.castShadow = !translucent;
      mesh.receiveShadow = true;
      if (depth) mesh.customDepthMaterial = depth;
      const attr = () => new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
      const a = { phase: attr(), speed: attr(), bend: attr() };
      geo.setAttribute('instPhase', a.phase);
      geo.setAttribute('instSpeed', a.speed);
      geo.setAttribute('instBend', a.bend);
      mesh.userData.species = this;
      this.meshes.push(mesh);
      this.attrs.push(a);
    }
  }

  add(a: Agent) {
    this.agents.push(a);
    const pal = this.def.palette;
    if (pal) {
      // pick a morph, then nudge its value so no two individuals match exactly
      const c = new THREE.Color(pal[Math.floor(Math.random() * pal.length)]);
      c.multiplyScalar(0.85 + Math.random() * 0.2);
      this.tints.set(a, c);
    }
  }
  private tints = new Map<Agent, THREE.Color>();

  /**
   * The coarsest level whose difference from the scan can't be seen (see LOD_PX, LOD_SIZE). A
   * level coarser than the one an animal has needs a margin (0.7x), so one hovering at a boundary doesn't
   * flick between the two; a finer one is taken as soon as it's needed. `pxPerRad` is taken at the zoom
   * being headed for, so zooming in has the detail in place before the view gets there.
   */
  private level(a: Agent, d: number, pxPerRad: number) {
    const pxPerM = (a.scale * pxPerRad) / Math.max(d, 0.05);
    const size = 2 * this.reach * pxPerM;
    let k = 0;
    for (let i = this.errors.length - 1; i > 0; i--) {
      const margin = i > a.lod ? 0.7 : 1;
      if (this.errors[i] * pxPerM <= LOD_PX * margin && size <= (LOD_SIZE[i] ?? 0) * margin) { k = i; break; }
    }
    a.lod = k;
    return k;
  }

  /**
   * Advance swim phases and upload the instances within `cull` metres of `cam` (and, given a view, in it or
   * near enough to cast a shadow into it), each to the level of detail that suits it.
   */
  sync(dt: number, cam: THREE.Vector3, cull: number, view?: LodView) {
    const rate = this.def.swim.speed ?? 4;
    const c2 = cull * cull;
    const counts = this.meshes.map(() => 0);
    for (const a of this.agents) {
      a.animSpeed += (a.speedMul - a.animSpeed) * Math.min(1, dt * 4);
      a.swimPhase += dt * rate * a.animSpeed;
      if (!a.alive) continue;
      const d2 = a.pos.distanceToSquared(cam);
      if (d2 > c2) continue;
      let k = 0;
      if (view) {
        _sphere.center.copy(a.pos);
        _sphere.radius = this.reach * a.scale;
        if (!view.frustum.intersectsSphere(_sphere)) continue;
        k = this.level(a, Math.sqrt(d2), view.pxPerRad);
      }
      const n = counts[k];
      if (n >= this.capacity) continue;
      _s.setScalar(a.scale);
      if (this.def.gait) {
        // walkers: a rigid body that rocks side to side and bobs a little with each step
        const walk = THREE.MathUtils.clamp((a.animSpeed - 0.7) / 1.4, 0, 1) * this.def.gait;
        const ph = a.swimPhase * 2;
        _e.set(Math.sin(ph) * 0.06 * walk, 0, Math.sin(ph + 1.2) * 0.03 * walk);
        _q.setFromEuler(_e).premultiply(a.quat);
        _p.copy(a.pos);
        _p.y += Math.abs(Math.sin(ph)) * 0.006 * a.scale * walk;
        _m.compose(_p, _q, _s);
      } else _m.compose(a.pos, a.quat, _s);
      const mesh = this.meshes[k];
      const at = this.attrs[k];
      mesh.setMatrixAt(n, _m);
      at.phase.setX(n, a.swimPhase);
      at.speed.setX(n, a.animSpeed);
      at.bend.setX(n, a.bend);
      const tint = this.tints.get(a);
      if (tint) mesh.setColorAt(n, tint);
      counts[k] = n + 1;
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      const at = this.attrs[k];
      at.phase.needsUpdate = at.speed.needsUpdate = at.bend.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }
}
