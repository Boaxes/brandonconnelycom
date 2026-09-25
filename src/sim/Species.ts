import * as THREE from 'three';
import { asset, hasAsset, type ModelName } from '../scene/Assets';
import { makeDepthMaterial, makeMaterial, type SwimParams } from '../scene/UnderwaterMaterial';
import type { Agent } from './Agent';

export interface SpeciesDef {
  key: string;
  model: ModelName;
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
  scan?: string;      // baked photogrammetry model to use when available
  bendGain?: number;  // how much the body curves into turns
  translucency?: number; // light passing through thin tissue (jellies, kelp, tentacles)
  palette?: number[];    // per-individual colour morphs, multiplied over the model's colours
}

export const SPECIES: Record<string, SpeciesDef> = {
  orca: { key: 'orca', scan: 'orca', roughness: 0.5, model: 'orca', name: 'Orca', latin: 'Orcinus orca', scale: [0.95, 1.1], swim: { amp: 0.28, freq: 0.55, speed: 3.2, axis: 1, bodyStart: 0.45 }, large: true },
  humpback: { key: 'humpback', scan: 'humpback', roughness: 0.5, model: 'humpback', name: 'Humpback whale', latin: 'Megaptera novaeangliae', scale: [1, 1], swim: { amp: 0.6, freq: 0.5, speed: 1.6, axis: 1, bodyStart: 0.5 }, large: true },
  dolphin: { key: 'dolphin', roughness: 0.5, model: 'dolphin_pws', name: "Pacific white-sided dolphin", latin: 'Lagenorhynchus obliquidens', scale: [0.9, 1.1], swim: { amp: 0.12, freq: 0.6, speed: 5.5, axis: 1, bodyStart: 0.45 }, large: true },
  porpoise: { key: 'porpoise', roughness: 0.5, model: 'dalls_porpoise', name: "Dall's porpoise", latin: 'Phocoenoides dalli', scale: [0.9, 1.05], swim: { amp: 0.1, freq: 0.6, speed: 6.5, axis: 1, bodyStart: 0.45 }, large: true },
  chinook: { key: 'chinook', scan: 'salmon', roughness: 0.6, model: 'chinook', name: 'Chinook salmon', latin: 'Oncorhynchus tshawytscha', scale: [0.8, 1.2], swim: { amp: 0.07, freq: 0.75, speed: 6, axis: 0, bodyStart: 0.35 } },
  herring: { key: 'herring', scan: 'herring', roughness: 0.6, model: 'herring', name: 'Pacific herring', latin: 'Clupea pallasii', scale: [0.8, 1.15], swim: { amp: 0.025, freq: 0.8, speed: 9, axis: 0, bodyStart: 0.3 } },
  rockfish: { key: 'rockfish', scan: 'rockfish_copper', roughness: 0.6, model: 'copper_rockfish', name: 'Copper rockfish', latin: 'Sebastes caurinus', scale: [0.8, 1.2], swim: { amp: 0.03, freq: 0.7, speed: 3.5, axis: 0, bodyStart: 0.45 } },
  lingcod: { key: 'lingcod', roughness: 0.6, model: 'lingcod', name: 'Lingcod', latin: 'Ophiodon elongatus', scale: [0.9, 1.3], swim: { amp: 0.05, freq: 0.7, speed: 3, axis: 0, bodyStart: 0.4 } },
  sixgill: { key: 'sixgill', roughness: 0.6, model: 'sixgill', name: 'Bluntnose sixgill shark', latin: 'Hexanchus griseus', scale: [1, 1], swim: { amp: 0.35, freq: 0.6, speed: 1.6, axis: 0, bodyStart: 0.35 }, large: true },
  seal: { key: 'seal', scan: 'harbor_seal', roughness: 0.5, model: 'harbor_seal', name: 'Harbor seal', latin: 'Phoca vitulina', scale: [0.9, 1.1], swim: { amp: 0.09, freq: 0.6, speed: 4.5, axis: 0, bodyStart: 0.5 }, large: true },
  sealion: { key: 'sealion', roughness: 0.5, model: 'steller_sea_lion', name: 'Steller sea lion', latin: 'Eumetopias jubatus', scale: [0.95, 1.05], swim: { amp: 0.12, freq: 0.6, speed: 3.5, axis: 1, bodyStart: 0.55 }, large: true },
  dungeness: { key: 'dungeness', scan: 'crab_dungeness', mode: 1, model: 'dungeness_crab', name: 'Dungeness crab', latin: 'Metacarcinus magister', scale: [0.9, 1.2], swim: { amp: 0 }, appendageAmp: 0.012 },
  redrock: { key: 'redrock', mode: 1, model: 'red_rock_crab', scan: 'crab_helmet', name: 'Helmet crab', latin: 'Telmessus cheiragonus', scale: [0.9, 1.2], swim: { amp: 0 }, appendageAmp: 0.01 },
  kelpcrab: { key: 'kelpcrab', scan: 'crab_kelp', mode: 1, model: 'kelp_crab', name: 'Northern kelp crab', latin: 'Pugettia producta', scale: [0.9, 1.3], swim: { amp: 0 }, appendageAmp: 0.008 },
  decorator: { key: 'decorator', scan: 'crab_decorator', mode: 1, model: 'decorator_crab', name: 'Decorator crab', latin: 'Oregonia gracilis', scale: [0.9, 1.3], swim: { amp: 0 }, appendageAmp: 0.008 },
  octopus: { key: 'octopus', scan: 'giant_pacific_octopus', tint: 0xffb8a0, roughness: 0.5, model: 'giant_pacific_octopus', name: 'Giant Pacific octopus', latin: 'Enteroctopus dofleini', scale: [1.1, 1.4], swim: { amp: 0 }, appendageAmp: 0.09, large: true },
  moonjelly: { key: 'moonjelly', translucency: 0.7, model: 'moon_jelly', name: 'Moon jelly', latin: 'Aurelia labiata', scale: [0.7, 1.3], mode: 2, swim: { amp: 0, speed: 1.6 }, appendageAmp: 0.03, opacity: 0.72, emissive: { color: 0x9fd8ff, strength: 0.08 }, side: THREE.DoubleSide },
  lionsmane: { key: 'lionsmane', translucency: 0.8, model: 'lions_mane', name: "Lion's mane jelly", latin: 'Cyanea capillata', scale: [0.9, 1.4], mode: 2, swim: { amp: 0, speed: 0.9 }, appendageAmp: 0.14, opacity: 0.85, emissive: { color: 0xff8a4a, strength: 0.05 }, side: THREE.DoubleSide },
  seanettle: { key: 'seanettle', translucency: 0.8, model: 'sea_nettle', name: 'Pacific sea nettle', latin: 'Chrysaora fuscescens', scale: [0.8, 1.3], mode: 2, swim: { amp: 0, speed: 1.2 }, appendageAmp: 0.1, opacity: 0.85, emissive: { color: 0xffb060, strength: 0.05 }, side: THREE.DoubleSide },
  ochrestar: { key: 'ochrestar', model: 'ochre_star', name: 'Ochre sea star', latin: 'Pisaster ochraceus', scale: [0.8, 1.4], swim: { amp: 0 } },
  sunflowerstar: { key: 'sunflowerstar', scan: 'sunflower_star', appendageAmp: 0.012, model: 'sunflower_star', name: 'Sunflower sea star', latin: 'Pycnopodia helianthoides', scale: [0.8, 1.3], swim: { amp: 0 } },
  urchin: { key: 'urchin', model: 'red_urchin', scan: 'urchin', name: 'Purple sea urchin', latin: 'Strongylocentrotus purpuratus', scale: [0.8, 1.4], swim: { amp: 0 } },
  anemone: { key: 'anemone', translucency: 0.2, palette: [0xffffff, 0xffffff, 0xfff0dc, 0xffd2b0, 0xffb78a, 0xff9d62, 0xd8a88a], model: 'plumose_anemone', name: 'Plumose anemone', latin: 'Metridium farcimen', scale: [0.7, 1.6], swim: { amp: 0 }, appendageAmp: 0.02, emissive: { color: 0xfff4e0, strength: 0.03 } },
  bullkelp: { key: 'bullkelp', translucency: 0.55, model: 'bull_kelp', name: 'Bull kelp', latin: 'Nereocystis luetkeana', scale: [0.8, 1.35], swim: { amp: 0.55, freq: 0.25, speed: 0.55, axis: 0, bodyStart: 0.0 }, appendageAmp: 0.25, side: THREE.DoubleSide, tint: 0xc4b06a, emissive: { color: 0x5a5a20, strength: 0.12 } },
  seapen: { key: 'seapen', translucency: 0.3, palette: [0xffffff, 0xffe0c0, 0xffc890], model: 'orange_sea_pen', name: 'Orange sea pen', latin: 'Ptilosarcus gurneyi', scale: [0.7, 1.3], swim: { amp: 0.035, freq: 0.25, speed: 0.6, axis: 0, bodyStart: 0.0 }, roughness: 0.55, emissive: { color: 0xff7a2a, strength: 0.08 } },
  tubeanemone: { key: 'tubeanemone', translucency: 0.45, palette: [0xffffff, 0xffe2c0, 0xffb070, 0xc8a0b0], model: 'tube_anemone', name: 'Tube-dwelling anemone', latin: 'Pachycerianthus fimbriatus', scale: [0.8, 1.5], swim: { amp: 0 }, appendageAmp: 0.035, emissive: { color: 0xfff0dc, strength: 0.04 } },
  sugarkelp: { key: 'sugarkelp', translucency: 0.6, model: 'sugar_kelp', name: 'Sugar kelp', latin: 'Saccharina latissima', scale: [0.8, 1.4], swim: { amp: 0.18, freq: 0.3, speed: 0.7, axis: 0, bodyStart: 0.0 }, side: THREE.DoubleSide, tint: 0x9c9250, emissive: { color: 0x40401a, strength: 0.22 } },
  blackrockfish: { key: 'blackrockfish', scan: 'rockfish_black', roughness: 0.6, model: 'copper_rockfish', name: 'Black rockfish', latin: 'Sebastes melanops', scale: [0.85, 1.15], swim: { amp: 0.03, freq: 0.7, speed: 3.5, axis: 0, bodyStart: 0.45 } },
  flounder: { key: 'flounder', scan: 'starry_flounder', roughness: 0.65, model: 'copper_rockfish', name: 'Starry flounder', latin: 'Platichthys stellatus', scale: [0.8, 1.2], swim: { amp: 0.025, freq: 0.7, speed: 4, axis: 1, bodyStart: 0.3 } },
  sculpin: { key: 'sculpin', scan: 'sculpin', roughness: 0.7, model: 'lingcod', name: 'Buffalo sculpin', latin: 'Enophrys bison', scale: [0.8, 1.2], swim: { amp: 0.02, freq: 0.7, speed: 4, axis: 0, bodyStart: 0.4 } },
  prawn: { key: 'prawn', scan: 'prawn', roughness: 0.5, model: 'herring', name: 'Spot prawn', latin: 'Pandalus platyceros', scale: [0.85, 1.2], swim: { amp: 0.006, freq: 0.6, speed: 6, axis: 1, bodyStart: 0.45 } },
  cucumber: { key: 'cucumber', scan: 'sea_cucumber', roughness: 0.7, model: 'lingcod', name: 'California sea cucumber', latin: 'Apostichopus californicus', scale: [0.8, 1.3], swim: { amp: 0.012, freq: 0.5, speed: 0.8, axis: 0, bodyStart: 0.0 } },
  dogfish: { key: 'dogfish', scan: 'dogfish', roughness: 0.55, model: 'sixgill', name: 'Spiny dogfish', latin: 'Squalus suckleyi', scale: [0.85, 1.15], swim: { amp: 0.08, freq: 0.6, speed: 4.5, axis: 0, bodyStart: 0.35 }, large: true },
};

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/** An InstancedMesh for one species plus the agents it draws. */
export class SpeciesRenderer {
  mesh: THREE.InstancedMesh;
  agents: Agent[] = [];
  private phaseAttr: THREE.InstancedBufferAttribute;
  private speedAttr: THREE.InstancedBufferAttribute;
  private bendAttr: THREE.InstancedBufferAttribute;

  constructor(public def: SpeciesDef, capacity: number) {
    const scanned = def.scan && hasAsset('scan:' + def.scan) ? asset('scan:' + def.scan) : null;
    const src = scanned ?? asset(def.model);
    // each renderer gets its own geometry: the per-instance attributes below differ per species
    const geo = src.geometry.clone();
    const { mat, uniforms } = makeMaterial(def.swim, {
      vertexColors: !scanned,
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
      _m.compose(a.pos, a.quat, _s);
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
