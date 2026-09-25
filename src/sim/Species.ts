import * as THREE from 'three';
import { geometry, type ModelName } from '../scene/Assets';
import { makeMaterial, type SwimParams } from '../scene/UnderwaterMaterial';
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
}

export const SPECIES: Record<string, SpeciesDef> = {
  orca: { key: 'orca', roughness: 0.5, model: 'orca', name: 'Orca', latin: 'Orcinus orca', scale: [0.95, 1.1], swim: { amp: 0.28, freq: 0.55, speed: 3.2, axis: 1, bodyStart: 0.45 }, large: true },
  humpback: { key: 'humpback', roughness: 0.5, model: 'humpback', name: 'Humpback whale', latin: 'Megaptera novaeangliae', scale: [1, 1], swim: { amp: 0.6, freq: 0.5, speed: 1.6, axis: 1, bodyStart: 0.5 }, large: true },
  dolphin: { key: 'dolphin', roughness: 0.5, model: 'dolphin_pws', name: "Pacific white-sided dolphin", latin: 'Lagenorhynchus obliquidens', scale: [0.9, 1.1], swim: { amp: 0.12, freq: 0.6, speed: 5.5, axis: 1, bodyStart: 0.45 }, large: true },
  porpoise: { key: 'porpoise', roughness: 0.5, model: 'dalls_porpoise', name: "Dall's porpoise", latin: 'Phocoenoides dalli', scale: [0.9, 1.05], swim: { amp: 0.1, freq: 0.6, speed: 6.5, axis: 1, bodyStart: 0.45 }, large: true },
  chinook: { key: 'chinook', roughness: 0.42, model: 'chinook', name: 'Chinook salmon', latin: 'Oncorhynchus tshawytscha', scale: [0.8, 1.2], swim: { amp: 0.07, freq: 0.75, speed: 6, axis: 0, bodyStart: 0.35 } },
  herring: { key: 'herring', roughness: 0.42, model: 'herring', name: 'Pacific herring', latin: 'Clupea pallasii', scale: [0.8, 1.15], swim: { amp: 0.025, freq: 0.8, speed: 9, axis: 0, bodyStart: 0.3 } },
  rockfish: { key: 'rockfish', roughness: 0.42, model: 'copper_rockfish', name: 'Copper rockfish', latin: 'Sebastes caurinus', scale: [0.8, 1.2], swim: { amp: 0.03, freq: 0.7, speed: 3.5, axis: 0, bodyStart: 0.45 } },
  lingcod: { key: 'lingcod', roughness: 0.42, model: 'lingcod', name: 'Lingcod', latin: 'Ophiodon elongatus', scale: [0.9, 1.3], swim: { amp: 0.05, freq: 0.7, speed: 3, axis: 0, bodyStart: 0.4 } },
  sixgill: { key: 'sixgill', roughness: 0.42, model: 'sixgill', name: 'Bluntnose sixgill shark', latin: 'Hexanchus griseus', scale: [1, 1], swim: { amp: 0.35, freq: 0.6, speed: 1.6, axis: 0, bodyStart: 0.35 }, large: true },
  seal: { key: 'seal', roughness: 0.5, model: 'harbor_seal', name: 'Harbor seal', latin: 'Phoca vitulina', scale: [0.9, 1.1], swim: { amp: 0.09, freq: 0.6, speed: 4.5, axis: 0, bodyStart: 0.5 }, large: true },
  sealion: { key: 'sealion', roughness: 0.5, model: 'steller_sea_lion', name: 'Steller sea lion', latin: 'Eumetopias jubatus', scale: [0.95, 1.05], swim: { amp: 0.12, freq: 0.6, speed: 3.5, axis: 1, bodyStart: 0.55 }, large: true },
  dungeness: { key: 'dungeness', model: 'dungeness_crab', name: 'Dungeness crab', latin: 'Metacarcinus magister', scale: [0.9, 1.2], swim: { amp: 0 }, appendageAmp: 0.012 },
  redrock: { key: 'redrock', model: 'red_rock_crab', name: 'Red rock crab', latin: 'Cancer productus', scale: [0.9, 1.2], swim: { amp: 0 }, appendageAmp: 0.01 },
  kelpcrab: { key: 'kelpcrab', model: 'kelp_crab', name: 'Northern kelp crab', latin: 'Pugettia producta', scale: [0.9, 1.3], swim: { amp: 0 }, appendageAmp: 0.008 },
  decorator: { key: 'decorator', model: 'decorator_crab', name: 'Decorator crab', latin: 'Oregonia gracilis', scale: [0.9, 1.3], swim: { amp: 0 }, appendageAmp: 0.008 },
  octopus: { key: 'octopus', roughness: 0.5, model: 'giant_pacific_octopus', name: 'Giant Pacific octopus', latin: 'Enteroctopus dofleini', scale: [1.1, 1.4], swim: { amp: 0 }, appendageAmp: 0.09, large: true },
  moonjelly: { key: 'moonjelly', model: 'moon_jelly', name: 'Moon jelly', latin: 'Aurelia labiata', scale: [0.7, 1.3], swim: { amp: 0 }, appendageAmp: 0.03, opacity: 0.72, emissive: { color: 0x9fd8ff, strength: 0.08 }, side: THREE.DoubleSide },
  lionsmane: { key: 'lionsmane', model: 'lions_mane', name: "Lion's mane jelly", latin: 'Cyanea capillata', scale: [0.9, 1.4], swim: { amp: 0 }, appendageAmp: 0.14, opacity: 0.85, emissive: { color: 0xff8a4a, strength: 0.05 }, side: THREE.DoubleSide },
  seanettle: { key: 'seanettle', model: 'sea_nettle', name: 'Pacific sea nettle', latin: 'Chrysaora fuscescens', scale: [0.8, 1.3], swim: { amp: 0 }, appendageAmp: 0.1, opacity: 0.85, emissive: { color: 0xffb060, strength: 0.05 }, side: THREE.DoubleSide },
  ochrestar: { key: 'ochrestar', model: 'ochre_star', name: 'Ochre sea star', latin: 'Pisaster ochraceus', scale: [0.8, 1.4], swim: { amp: 0 } },
  sunflowerstar: { key: 'sunflowerstar', model: 'sunflower_star', name: 'Sunflower sea star', latin: 'Pycnopodia helianthoides', scale: [0.8, 1.3], swim: { amp: 0 } },
  urchin: { key: 'urchin', model: 'red_urchin', name: 'Red sea urchin', latin: 'Mesocentrotus franciscanus', scale: [0.8, 1.4], swim: { amp: 0 } },
  anemone: { key: 'anemone', model: 'plumose_anemone', name: 'Plumose anemone', latin: 'Metridium farcimen', scale: [0.7, 1.6], swim: { amp: 0 }, appendageAmp: 0.02, emissive: { color: 0xfff4e0, strength: 0.12 } },
  bullkelp: { key: 'bullkelp', model: 'bull_kelp', name: 'Bull kelp', latin: 'Nereocystis luetkeana', scale: [0.8, 1.35], swim: { amp: 0.55, freq: 0.25, speed: 0.55, axis: 0, bodyStart: 0.0 }, appendageAmp: 0.25, side: THREE.DoubleSide, tint: 0xc4b06a, emissive: { color: 0x5a5a20, strength: 0.28 } },
  sugarkelp: { key: 'sugarkelp', model: 'sugar_kelp', name: 'Sugar kelp', latin: 'Saccharina latissima', scale: [0.8, 1.4], swim: { amp: 0.18, freq: 0.3, speed: 0.7, axis: 0, bodyStart: 0.0 }, side: THREE.DoubleSide, tint: 0x9c9250, emissive: { color: 0x40401a, strength: 0.22 } },
};

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/** An InstancedMesh for one species plus the agents it draws. */
export class SpeciesRenderer {
  mesh: THREE.InstancedMesh;
  agents: Agent[] = [];
  private phaseAttr: THREE.InstancedBufferAttribute;
  private speedAttr: THREE.InstancedBufferAttribute;

  constructor(public def: SpeciesDef, capacity: number) {
    const geo = geometry(def.model);
    const { mat } = makeMaterial(def.swim, {
      appendageAmp: def.appendageAmp,
      tint: def.tint ? new THREE.Color(def.tint) : undefined,
      transparent: def.opacity !== undefined,
      opacity: def.opacity ?? 1,
      side: def.side,
      emissive: def.emissive?.color,
      roughness: def.roughness,
    });
    if (def.emissive) mat.emissiveIntensity = def.emissive.strength;
    if (def.opacity !== undefined) mat.depthWrite = false;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = def.key;
    this.mesh.count = 0;
    this.phaseAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.phaseAttr.setUsage(THREE.DynamicDrawUsage);
    this.speedAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.speedAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instPhase', this.phaseAttr);
    geo.setAttribute('instSpeed', this.speedAttr);
    this.mesh.userData.species = this;
  }

  add(a: Agent) {
    this.agents.push(a);
  }

  /** Advance swim phases and push agent transforms to the GPU. */
  sync(dt: number) {
    const n = Math.min(this.agents.length, this.mesh.instanceMatrix.count);
    const rate = this.def.swim.speed ?? 4;
    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      a.animSpeed += (a.speedMul - a.animSpeed) * Math.min(1, dt * 4);
      a.swimPhase += dt * rate * a.animSpeed;
      _s.setScalar(a.scale);
      _m.compose(a.pos, a.quat, _s);
      this.mesh.setMatrixAt(i, _m);
      this.phaseAttr.setX(i, a.swimPhase);
      this.speedAttr.setX(i, a.animSpeed);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.speedAttr.needsUpdate = true;
  }
}
