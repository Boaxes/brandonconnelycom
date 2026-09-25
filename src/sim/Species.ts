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
  seal: { key: 'seal', scan: 'harbor_seal', roughness: 0.5, name: 'Harbor seal', latin: 'Phoca vitulina', scale: [0.95, 1.05], swim: { amp: 0.09, freq: 0.6, speed: 4.5, axis: 0, bodyStart: 0.5 }, large: true },
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
  octopus: { key: 'octopus', scan: 'giant_pacific_octopus', tint: 0xffb8a0, roughness: 0.5, name: 'Giant Pacific octopus', latin: 'Enteroctopus dofleini', scale: [1.1, 1.3], swim: { amp: 0 }, appendageAmp: 0.035, large: true },
  // fixed life
  batstar: { key: 'batstar', scan: 'bat_star', roughness: 0.6, name: 'Bat star', latin: 'Patiria miniata', scale: [0.8, 1.3], swim: { amp: 0 } },
  sunflowerstar: { key: 'sunflowerstar', scan: 'sunflower_star', appendageAmp: 0.008, name: 'Sunflower sea star', latin: 'Pycnopodia helianthoides', scale: [0.8, 1.3], swim: { amp: 0 } },
  urchin: { key: 'urchin', scan: 'urchin', name: 'Purple sea urchin', latin: 'Strongylocentrotus purpuratus', scale: [0.8, 1.4], swim: { amp: 0 } },
  scallop: { key: 'scallop', scan: 'scallop', roughness: 0.5, name: 'Rock scallop', latin: 'Crassadoma gigantea', scale: [0.9, 1.5], swim: { amp: 0 } },
};

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** A species can be shown only if its scan loaded. */
export function hasSpecies(key: string) {
  const d = SPECIES[key];
  return !!d && hasAsset('scan:' + d.scan);
}

/** An InstancedMesh for one species plus the agents it draws. */
export class SpeciesRenderer {
  mesh: THREE.InstancedMesh;
  agents: Agent[] = [];
  private phaseAttr: THREE.InstancedBufferAttribute;
  private speedAttr: THREE.InstancedBufferAttribute;
  private bendAttr: THREE.InstancedBufferAttribute;

  constructor(public def: SpeciesDef, capacity: number) {
    const scanned = asset('scan:' + def.scan);
    const src = scanned;
    // each renderer gets its own geometry: the per-instance attributes below differ per species
    const geo = src.geometry.clone();
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
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    uniforms.uSwim3.value.x = bb.max.x - bb.min.x;
    uniforms.uSwim3.value.y = def.bendGain ?? (def.swim.amp ? 0.12 : 0);
    if (def.emissive) mat.emissiveIntensity = def.emissive.strength;
    if (def.opacity !== undefined) mat.depthWrite = false;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = def.key;
    this.mesh.count = 0;
    // opaque life casts torch shadows with the same swim deformation as its colour pass
    const translucent = def.opacity !== undefined;
    this.mesh.castShadow = !translucent;
    this.mesh.receiveShadow = true;
    if (!translucent) this.mesh.customDepthMaterial = makeDepthMaterial(uniforms);
    this.phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.phaseAttr.setUsage(THREE.DynamicDrawUsage);
    this.speedAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.speedAttr.setUsage(THREE.DynamicDrawUsage);
    this.bendAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.bendAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instPhase', this.phaseAttr);
    geo.setAttribute('instSpeed', this.speedAttr);
    geo.setAttribute('instBend', this.bendAttr);
    this.mesh.userData.species = this;
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

  /** Advance swim phases and upload only the instances within `cull` metres of `cam`. */
  sync(dt: number, cam: THREE.Vector3, cull: number) {
    const rate = this.def.swim.speed ?? 4;
    const c2 = cull * cull;
    let n = 0;
    for (const a of this.agents) {
      a.animSpeed += (a.speedMul - a.animSpeed) * Math.min(1, dt * 4);
      a.swimPhase += dt * rate * a.animSpeed;
      if (!a.alive || a.pos.distanceToSquared(cam) > c2) continue;
      if (n >= this.mesh.instanceMatrix.count) break;
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
      this.mesh.setMatrixAt(n, _m);
      this.phaseAttr.setX(n, a.swimPhase);
      this.speedAttr.setX(n, a.animSpeed);
      this.bendAttr.setX(n, a.bend);
      const tint = this.tints.get(a);
      if (tint) this.mesh.setColorAt(n, tint);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.speedAttr.needsUpdate = true;
    this.bendAttr.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
