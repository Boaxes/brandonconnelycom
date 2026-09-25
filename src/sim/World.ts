import * as THREE from 'three';
import { SPECIES, SpeciesRenderer } from './Species';
import { Agent, Grid, randomFloorPoint, randomWaterPoint } from './Agent';
import {
  BenthicFish, Crab, Hunter, Jelly, Octopus, Pod, School, SchoolFish, Sessile, currentAt,
  type Behavior, type Habitat, type HunterConfig, type SchoolConfig,
} from './behaviors';
import { cameraPath, floorHeight, floorNormal, randomFloorNearPath } from '../scene/Terrain';
import { makeMaterial } from '../scene/UnderwaterMaterial';
import { attachGround } from '../scene/Terrain';
import { mulberry32, noise2 } from '../util/noise';
import { hideLabel, showLabel } from '../ui/overlay';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
/** beyond this nothing is visible through the murk, so it isn't drawn */
const VIEW_RANGE = 16;

interface Population {
  key: string;
  renderer: SpeciesRenderer;
  agents: Behavior[];
}

export class World implements Habitat {
  time = 0;
  rocks: { pos: THREE.Vector3; r: number }[] = [];
  pops = new Map<string, Population>();
  schools: School[] = [];
  pods: Pod[] = [];
  watchMode = false;
  visibleCount = 0;
  /** species keys seen close to the camera this session (drained by the UI) */
  observed: string[] = [];
  private observedSet = new Set<string>();
  private herringGrid = new Grid<SchoolFish>(2.5);
  private salmonGrid = new Grid<SchoolFish>(4);
  private respawnQueue: { agent: Agent; at: number }[] = [];
  private pointer = new THREE.Vector2(-10, -10);
  private pointerPx = new THREE.Vector2();
  private pickTimer = 0;
  private visitorTimer = 25;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private group = new THREE.Group();

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.group.name = 'life';
    scene.add(this.group);
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.pointerPx.set(e.clientX, e.clientY);
    });
    window.addEventListener('pointerleave', () => this.pointer.set(-10, -10));
  }

  // ---------------------------------------------------------------- setup

  private pop(key: string, capacity: number): Population {
    let p = this.pops.get(key);
    if (!p) {
      const r = new SpeciesRenderer(SPECIES[key], capacity);
      this.group.add(r.mesh);
      p = { key, renderer: r, agents: [] };
      this.pops.set(key, p);
    }
    return p;
  }

  private addAgent(key: string, a: Behavior) {
    const p = this.pops.get(key)!;
    const def = SPECIES[key];
    a.scale = def.scale[0] + Math.random() * (def.scale[1] - def.scale[0]);
    p.agents.push(a);
    p.renderer.add(a);
  }

  populate() {
    this.buildRocks();
    this.buildFlora();
    this.buildFish();
    this.buildBenthos();
    this.buildJellies();
    this.buildResidents();
    // one visitor group right away so the opening isn't empty
    this.spawnVisitor('orca');
  }

  private buildRocks() {
    const rnd = mulberry32(42);
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // low-frequency lumps + a little grit, squashed and flattened underneath
      const s = 1 + noise2(x * 1.1 + 5, z * 1.1 + y * 0.8) * 0.28 + noise2(x * 3 + 1, (y + z) * 3) * 0.06;
      const yy = y < 0 ? y * 0.35 : y * 0.75;
      pos.setXYZ(i, x * s, yy * s, z * s);
    }
    const flat = geo;
    flat.computeVertexNormals();
    const cols = new Float32Array(flat.attributes.position.count * 3);
    const base = new THREE.Color(0x4d5148);
    const c = new THREE.Color();
    for (let i = 0; i < cols.length / 3; i++) {
      c.copy(base).offsetHSL(rnd() * 0.02, 0, (rnd() - 0.5) * 0.08);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    flat.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const uv = flat.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0, 0);
    const { mat, uniforms } = makeMaterial({ amp: 0 }, { roughness: 0.9, detail: 2 });
    attachGround(uniforms);
    mat.flatShading = false;
    const count = 70;
    const mesh = new THREE.InstancedMesh(flat, mat, count);
    mesh.name = 'rocks';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      if (i % 2 === 0) randomFloorNearPath(14, p, rnd); else randomFloorPoint(15, p);
      const r = 0.6 + Math.pow(rnd(), 2) * 2.4;
      p.y -= r * 0.25;
      q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3));
      s.set(r * (0.8 + rnd() * 0.6), r * (0.6 + rnd() * 0.5), r * (0.8 + rnd() * 0.6));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      this.rocks.push({ pos: p.clone(), r: Math.max(s.x, s.z) });
    }
    this.group.add(mesh);
  }

  private buildFlora() {
    const rnd = mulberry32(99);
    const up = new THREE.Vector3();
    const sessile = (key: string, count: number, place: (p: THREE.Vector3) => boolean, doing: string) => {
      this.pop(key, count);
      let tries = 0;
      let made = 0;
      while (made < count && tries < count * 20) {
        tries++;
        randomFloorPoint(12, _v);
        if (!place(_v)) continue;
        floorNormal(_v.x, _v.z, up);
        const size = key === 'bullkelp' ? 3 : key === 'sugarkelp' ? 1.2 : key === 'sunflowerstar' ? 0.8 : 0.4;
        // kelp blades trail down-current, so all kelp shares a heading (+ a little scatter)
        const yaw = key === 'bullkelp' || key === 'sugarkelp' ? 0.4 + (rnd() - 0.5) * 0.7 : rnd() * Math.PI * 2;
        const a = new Sessile(key, { maxSpeed: 0, maxForce: 0, cruise: 0, size }, _v, up, yaw, doing);
        this.addAgent(key, a);
        made++;
      }
    };
    // bull kelp grows in groves: pick grove centres near the camera loop, then scatter stipes around them
    const groves: THREE.Vector3[] = [];
    for (let i = 0; i < 14; i++) groves.push(randomFloorNearPath(16, new THREE.Vector3(), rnd));
    let gi = 0;
    const kelpField = (p: THREE.Vector3) => {
      const g = groves[gi++ % groves.length];
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * (3 + rnd() * 4);
      p.set(g.x + Math.cos(a) * d, 0, g.z + Math.sin(a) * d);
      p.y = floorHeight(p.x, p.z);
      return true;
    };
    sessile('bullkelp', 150, kelpField, 'swaying in the current');
    sessile('sugarkelp', 120, (p) => noise2(p.x * 0.05 + 9, p.z * 0.05 + 2) > 0.1, 'swaying in the current');
    // anemones cluster on and around rocks
    // anemones crowd the boulders: place them on rock surfaces (raised by the rock's height)
    let ai = 0;
    const onRock = (p: THREE.Vector3) => {
      const rk = this.rocks[ai++ % this.rocks.length];
      const a = rnd() * Math.PI * 2;
      const d = rnd() * rk.r * 0.9;
      p.set(rk.pos.x + Math.cos(a) * d, 0, rk.pos.z + Math.sin(a) * d);
      // approximate the boulder's dome height at this point
      const h = Math.sqrt(Math.max(0, 1 - (d / rk.r) * (d / rk.r))) * rk.r * 0.55;
      p.y = rk.pos.y + h - 0.05;
      return rk.r > 0.8;
    };
    sessile('anemone', 220, onRock, 'filter feeding');
    sessile('ochrestar', 40, () => true, 'grazing on mussels');
    sessile('sunflowerstar', 10, () => true, 'hunting urchins, slowly');
    sessile('urchin', 60, (p) => noise2(p.x * 0.06 + 20, p.z * 0.06) > 0.05, 'grazing kelp');
    // stars and urchins sit slightly into the floor so they don't hover
    for (const k of ['ochrestar', 'sunflowerstar', 'urchin']) for (const a of this.pops.get(k)!.agents) a.pos.y -= 0.01;
  }

  private buildFish() {
    const herringCfg: SchoolConfig = { neighbor: 1.6, separation: 0.45, cohesion: 0.9, alignment: 1.3, sepWeight: 0.9, fleeRadius: 6, predators: ['seal', 'sealion', 'dolphin', 'porpoise', 'lingcod', 'humpback'], homeAbove: [2.5, 9] };
    const salmonCfg: SchoolConfig = { neighbor: 4, separation: 1.1, cohesion: 0.6, alignment: 1.0, sepWeight: 0.8, fleeRadius: 12, predators: ['orca', 'sealion', 'seal'], homeAbove: [3, 12] };
    const herringN = 480;
    this.pop('herring', herringN);
    for (let s = 0; s < 4; s++) {
      const school = new School(herringCfg, 'herring');
      this.schools.push(school);
      for (let i = 0; i < herringN / 4; i++) {
        const f = new SchoolFish('herring', school, { maxSpeed: 3.2, maxForce: 9, cruise: 1.1, turnRate: 6, clearance: 0.6, size: 0.28 });
        school.members.push(f);
        this.addAgent('herring', f);
      }
    }
    const salmonN = 36;
    this.pop('chinook', salmonN);
    for (let s = 0; s < 2; s++) {
      const school = new School(salmonCfg, 'chinook');
      this.schools.push(school);
      for (let i = 0; i < salmonN / 2; i++) {
        const f = new SchoolFish('chinook', school, { maxSpeed: 6, maxForce: 10, cruise: 1.6, turnRate: 4, clearance: 1, size: 0.9 });
        school.members.push(f);
        this.addAgent('chinook', f);
      }
    }
    this.pop('rockfish', 20);
    for (let i = 0; i < 20; i++) {
      this.addAgent('rockfish', new BenthicFish('rockfish', { maxSpeed: 1.6, maxForce: 3, cruise: 0.35, turnRate: 3, clearance: 0.3, size: 0.45 }, [], { idle: 'hovering by its rock', hunt: '', eat: '' }, [0.4, 1.6]));
    }
    this.pop('lingcod', 5);
    for (let i = 0; i < 5; i++) {
      this.addAgent('lingcod', new BenthicFish('lingcod', { maxSpeed: 4.5, maxForce: 12, cruise: 0.4, turnRate: 4, clearance: 0.2, size: 0.9 }, ['herring'], { idle: 'lying in ambush', hunt: 'lunging at herring', eat: 'swallowing a herring' }, [0.15, 0.6]));
    }
  }

  private buildBenthos() {
    const crab = (key: string, n: number, speed: number, bury: boolean) => {
      this.pop(key, n);
      for (let i = 0; i < n; i++) {
        const c = new Crab(key, { maxSpeed: speed * 2.2, maxForce: 1, cruise: speed, size: 0.2 }, bury);
        randomFloorNearPath(9, c.pos);
        c.goal.copy(c.pos);
        this.addAgent(key, c);
      }
    };
    crab('dungeness', 40, 0.35, true);
    crab('redrock', 26, 0.3, false);
    crab('kelpcrab', 16, 0.2, false);
    crab('decorator', 12, 0.15, false);
    this.pop('octopus', 2);
    for (let i = 0; i < 2; i++) {
      // den at a large rock
      const big = this.rocks.filter((r) => r.r > 1.4).sort((a, b) => this.pathDistance(a.pos) - this.pathDistance(b.pos));
      const rk = big[i] ?? this.rocks[0];
      const den = rk.pos.clone().add(new THREE.Vector3(rk.r * 1.1, 0, 0));
      den.y = floorHeight(den.x, den.z);
      this.addAgent('octopus', new Octopus('octopus', { maxSpeed: 1.6, maxForce: 1, cruise: 0.45, size: 1.2 }, den));
    }
  }

  private buildJellies() {
    const jelly = (key: string, n: number, band: [number, number], rate: number, lift: number) => {
      this.pop(key, n);
      for (let i = 0; i < n; i++) this.addAgent(key, new Jelly(key, { maxSpeed: 0.5, maxForce: 0.5, cruise: 0.1, size: 0.4 }, band, rate, lift));
    };
    jelly('moonjelly', 36, [1.5, 14], 1.6, 0.16);
    jelly('lionsmane', 4, [4, 15], 0.9, 0.18);
    jelly('seanettle', 9, [3, 14], 1.2, 0.17);
  }

  private hunter(key: string, cfg: HunterConfig, opts: ConstructorParameters<typeof Hunter>[2]) {
    const h = new Hunter(key, cfg, opts);
    this.addAgent(key, h);
    return h;
  }

  private buildResidents() {
    this.pop('seal', 5);
    for (let i = 0; i < 5; i++) {
      this.hunter('seal', {
        prey: ['herring', 'chinook'], huntRange: 16, catchDist: 0.7, airBreather: true, oxygen: [70, 140], restOnBottom: true, cruiseAbove: [1.5, 10], eatTime: 3,
        verbs: { cruise: 'patrolling', hunt: 'chasing herring', eat: 'eating', breathe: 'surfacing to breathe', rest: 'resting on the bottom' },
      }, { maxSpeed: 5.5, maxForce: 9, cruise: 1.4, turnRate: 3.5, clearance: 0.8, size: 1.6 });
    }
    this.pop('sealion', 2);
    for (let i = 0; i < 2; i++) {
      this.hunter('sealion', {
        prey: ['chinook', 'herring'], huntRange: 22, catchDist: 1.0, airBreather: true, oxygen: [60, 120], cruiseAbove: [3, 14], eatTime: 3,
        verbs: { cruise: 'cruising', hunt: 'chasing salmon', eat: 'eating', breathe: 'surfacing to breathe', rest: 'resting' },
      }, { maxSpeed: 7, maxForce: 10, cruise: 1.9, turnRate: 3, clearance: 1, size: 3 });
    }
    this.pop('sixgill', 1);
    this.hunter('sixgill', {
      prey: ['chinook'], huntRange: 10, catchDist: 1.2, airBreather: false, oxygen: [1, 1], cruiseAbove: [1.2, 4], eatTime: 6,
      verbs: { cruise: 'patrolling the bottom', hunt: 'closing on a salmon', eat: 'feeding', breathe: '', rest: '' },
    }, { maxSpeed: 2.6, maxForce: 3, cruise: 0.8, turnRate: 1.2, clearance: 1.2, bankAmount: 0.6, size: 4 });
    // pods/visitors get created on a timer
    this.pop('orca', 6);
    this.pop('dolphin', 10);
    this.pop('porpoise', 5);
    this.pop('humpback', 1);
  }

  // ---------------------------------------------------------------- visitors

  private spawnVisitor(kind: 'orca' | 'dolphin' | 'porpoise' | 'humpback') {
    const pop = this.pops.get(kind)!;
    if (pop.agents.length > 0) return; // already here
    const pod = new Pod(kind);
    let count = 1;
    let cfg: HunterConfig;
    let opts: ConstructorParameters<typeof Hunter>[2];
    if (kind === 'orca') {
      count = 4 + Math.floor(Math.random() * 3);
      cfg = { prey: ['chinook'], huntRange: 30, catchDist: 1.6, airBreather: true, oxygen: [50, 100], cruiseAbove: [6, 14], eatTime: 4, verbs: { cruise: 'leading the pod', hunt: 'hunting Chinook salmon', eat: 'sharing a salmon', breathe: 'surfacing to breathe', rest: '' } };
      opts = { maxSpeed: 9, maxForce: 8, cruise: 2.6, turnRate: 1.6, clearance: 2.5, bankAmount: 0.8, size: 7 };
      pod.path = Pod.transitPath(6 + Math.random() * 4, 5 + Math.random() * 4, 30);
    } else if (kind === 'dolphin') {
      count = 6 + Math.floor(Math.random() * 4);
      cfg = { prey: ['herring'], huntRange: 20, catchDist: 0.7, airBreather: true, oxygen: [35, 70], cruiseAbove: [6, 14], eatTime: 2, verbs: { cruise: 'leading the group', hunt: 'chasing herring', eat: 'eating', breathe: 'surfacing to breathe', rest: '' } };
      opts = { maxSpeed: 10, maxForce: 14, cruise: 3.2, turnRate: 3, clearance: 2, bankAmount: 1.2, size: 2.3 };
      pod.path = Pod.transitPath(6 + Math.random() * 4, 5 + Math.random() * 4, 30);
    } else if (kind === 'porpoise') {
      count = 2 + Math.floor(Math.random() * 3);
      cfg = { prey: ['herring'], huntRange: 16, catchDist: 0.6, airBreather: true, oxygen: [30, 60], cruiseAbove: [5, 13], eatTime: 2, verbs: { cruise: 'leading the group', hunt: 'chasing herring', eat: 'eating', breathe: 'surfacing to breathe', rest: '' } };
      opts = { maxSpeed: 12, maxForce: 16, cruise: 3.6, turnRate: 3, clearance: 2, bankAmount: 1.2, size: 2 };
      pod.path = Pod.transitPath(6 + Math.random() * 4, 5 + Math.random() * 4, 30);
    } else {
      count = 1;
      cfg = { prey: ['herring'], huntRange: 30, catchDist: 4.5, airBreather: true, oxygen: [80, 140], cruiseAbove: [8, 13], eatTime: 8, verbs: { cruise: 'passing through', hunt: 'lunging at a herring ball', eat: 'straining a mouthful of herring', breathe: 'surfacing to breathe', rest: '' } };
      opts = { maxSpeed: 4.5, maxForce: 3, cruise: 1.7, turnRate: 0.7, clearance: 4, bankAmount: 0.4, size: 14 };
      pod.path = Pod.transitPath(7 + Math.random() * 3, 6 + Math.random() * 3, 20);
    }
    const start = pod.path[0];
    const dir = pod.path[1].clone().sub(start).normalize();
    for (let i = 0; i < count; i++) {
      const h = new Hunter(kind, cfg, opts);
      h.oxygen = cfg.oxygen[0] * (0.3 + Math.random() * 0.7);
      const off = new THREE.Vector3(-i * opts.size * 0.9 - (i > 0 ? opts.size * 0.3 : 0), (Math.random() - 0.5) * opts.size * 0.4, (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * opts.size * 0.55);
      pod.offsets.push(off);
      h.pos.copy(start).addScaledVector(dir, -i * opts.size * 0.9);
      h.pos.z += off.z;
      h.vel.copy(dir).multiplyScalar(opts.cruise);
      h.forward.copy(dir);
      h.state = 'cruise';
      pod.members.push(h);
      this.addAgent(kind, h);
    }
    this.pods.push(pod);
  }

  private removeVisitor(pod: Pod) {
    const pop = this.pops.get(pod.key)!;
    pop.agents.length = 0;
    pop.renderer.agents.length = 0;
    this.pods.splice(this.pods.indexOf(pod), 1);
  }

  private pathDistance(p: THREE.Vector3): number {
    const path = (this as unknown as { _pathPts?: THREE.Vector3[] })._pathPts ?? ((this as unknown as { _pathPts?: THREE.Vector3[] })._pathPts = cameraPath().getSpacedPoints(60));
    let best = Infinity;
    for (const q of path) {
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // ---------------------------------------------------------------- habitat api

  preyNear(keys: string[], pos: THREE.Vector3, radius: number): Agent | null {
    let best: Agent | null = null;
    let bd = radius * radius;
    for (const k of keys) {
      const p = this.pops.get(k);
      if (!p) continue;
      for (const a of p.agents) {
        if (!a.alive) continue;
        if (a instanceof Crab && a.buried > 0.6) continue; // buried crabs are safe
        const d = a.pos.distanceToSquared(pos);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
    }
    return best;
  }

  eat(prey: Agent) {
    prey.alive = false;
    // move it far away & out of sight, bring it back later somewhere else
    prey.pos.set(0, -50, 0);
    this.respawnQueue.push({ agent: prey, at: this.time + 20 + Math.random() * 40 });
  }

  threatsNear(keys: string[], pos: THREE.Vector3, radius: number, out: Agent[]): Agent[] {
    out.length = 0;
    const r2 = radius * radius;
    for (const k of keys) {
      const p = this.pops.get(k);
      if (!p) continue;
      for (const a of p.agents) {
        if (!a.alive) continue;
        if (a.state === 'rest' || a.state === 'den' || a.state === 'eat') continue;
        if (a.pos.distanceToSquared(pos) < r2) out.push(a);
      }
    }
    return out;
  }

  current(pos: THREE.Vector3, out: THREE.Vector3) {
    return currentAt(pos, this.time, out);
  }

  // ---------------------------------------------------------------- update

  update(dt: number, t: number) {
    this.time = t;
    // respawns
    while (this.respawnQueue.length && this.respawnQueue[0].at < t) {
      const { agent } = this.respawnQueue.shift()!;
      agent.alive = true;
      if (agent instanceof SchoolFish) {
        agent.pos.copy(agent.school.anchor).add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6));
        agent.vel.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(agent.opts.cruise);
      } else if (agent instanceof Crab) {
        randomFloorNearPath(9, agent.pos);
        agent.goal.copy(agent.pos);
        agent.state = 'forage';
        agent.buried = 0;
      } else {
        randomWaterPoint(2, 8, 25, agent.pos);
      }
    }
    this.respawnQueue.sort((a, b) => a.at - b.at);

    // schools + neighbour grids
    for (const s of this.schools) s.update(dt, t);
    const herring = this.pops.get('herring')!.agents as SchoolFish[];
    const salmon = this.pops.get('chinook')!.agents as SchoolFish[];
    this.herringGrid.rebuild(herring.filter((a) => a.alive));
    this.salmonGrid.rebuild(salmon.filter((a) => a.alive));
    // staggered neighbour refresh: a quarter of each school per frame
    const frame = Math.floor(t * 60);
    for (let i = 0; i < herring.length; i++) {
      const f = herring[i];
      if ((i + frame) % 4 === 0) {
        f.neighbors.length = 0;
        this.herringGrid.each(f.pos, f.school.cfg.neighbor, (o) => { if (f.neighbors.length < 12) f.neighbors.push(o); });
      }
    }
    for (let i = 0; i < salmon.length; i++) {
      const f = salmon[i];
      if ((i + frame) % 2 === 0) {
        f.neighbors.length = 0;
        this.salmonGrid.each(f.pos, f.school.cfg.neighbor, (o) => { if (f.neighbors.length < 10) f.neighbors.push(o); });
      }
    }

    // agents
    const camPos = this.camera.position;
    for (const p of this.pops.values()) {
      const podKind = p.key === 'orca' || p.key === 'dolphin' || p.key === 'porpoise' || p.key === 'humpback';
      if (podKind) continue; // driven by their pod
      for (const a of p.agents) {
        if (!a.alive) continue;
        // far-away sessile things and crabs update less often
        const d2 = a.pos.distanceToSquared(camPos);
        if (d2 > 90 * 90 && (a instanceof Crab || a instanceof Sessile) && Math.random() > 0.2) continue;
        a.update(dt, this);
      }
    }
    for (const pod of [...this.pods]) {
      pod.update(dt, this);
      if (pod.done) this.removeVisitor(pod);
    }
    // visitor schedule
    this.visitorTimer -= dt;
    if (this.visitorTimer < 0) {
      this.visitorTimer = 45 + Math.random() * 60;
      const r = Math.random();
      const kind = r < 0.4 ? 'orca' : r < 0.65 ? 'dolphin' : r < 0.85 ? 'porpoise' : 'humpback';
      this.spawnVisitor(kind);
    }

    // push to GPU + count visible
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    let vis = 0;
    for (const p of this.pops.values()) {
      p.renderer.sync(dt, camPos, VIEW_RANGE);
      const sessile = p.key === 'bullkelp' || p.key === 'sugarkelp' || p.key === 'anemone' || p.key === 'urchin' || p.key === 'ochrestar' || p.key === 'sunflowerstar';
      if (sessile) {
        if (!this.observedSet.has(p.key)) for (const a of p.agents) if (a.pos.distanceToSquared(camPos) < 7 * 7 && this.frustum.containsPoint(a.pos)) { this.observedSet.add(p.key); this.observed.push(p.key); break; }
        continue;
      }
      for (const a of p.agents) {
        if (!a.alive) continue;
        const d2 = a.pos.distanceToSquared(camPos);
        if (d2 < 10 * 10 && this.frustum.containsPoint(a.pos)) {
          vis++;
          if (d2 < 7 * 7 && !this.observedSet.has(p.key)) {
            this.observedSet.add(p.key);
            this.observed.push(p.key);
          }
        }
      }
    }
    this.visibleCount = vis;

    // hover picking
    this.pickTimer -= dt;
    if (this.pickTimer < 0) {
      this.pickTimer = 0.08;
      this.pick();
    }
  }

  private pick() {
    if (this.pointer.x < -5) {
      hideLabel();
      return;
    }
    // screen-space picking: project every candidate and take the closest to the
    // pointer within its projected radius. More forgiving than a ray for small fish.
    const cam = this.camera;
    const focal = (window.innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360);
    let best: { a: Agent; r: SpeciesRenderer; d: number } | null = null;
    for (const p of this.pops.values()) {
      const def = SPECIES[p.key];
      for (const a of p.agents) {
        if (!a.alive) continue;
        _v.copy(a.pos).applyMatrix4(cam.matrixWorldInverse);
        const depth = -_v.z;
        if (depth < 0.5 || depth > 9) continue;
        _v2.copy(a.pos).project(cam);
        const sx = (_v2.x + 1) / 2 * window.innerWidth;
        const sy = (1 - _v2.y) / 2 * window.innerHeight;
        const size = (a.opts.size || 0.5) * a.scale;
        const radiusPx = Math.max(10, (size * 0.5 * focal) / depth);
        const dx = sx - this.pointerPx.x;
        const dy = sy - this.pointerPx.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radiusPx + 6) continue;
        // score: prefer near the pointer, then nearer to the camera
        const score = dist / radiusPx + depth * 0.01;
        if (!best || score < best.d) best = { a, r: p.renderer, d: score };
        void def;
      }
    }
    if (best) showLabel(this.pointerPx.x, this.pointerPx.y, best.r.def.name, best.r.def.latin, best.a.doing);
    else hideLabel();
  }

  nearestLargeAnimal(pos: THREE.Vector3): { key: string; dist: number } | null {
    let best: { key: string; dist: number } | null = null;
    for (const p of this.pops.values()) {
      if (!SPECIES[p.key].large) continue;
      for (const a of p.agents) {
        if (!a.alive) continue;
        const d = a.pos.distanceTo(pos);
        if (!best || d < best.dist) best = { key: p.key, dist: d };
      }
    }
    return best;
  }

  /** debug helper */
  count() {
    const out: Record<string, number> = {};
    for (const p of this.pops.values()) out[p.key] = p.agents.filter((a) => a.alive).length;
    return out;
  }

  static v = _v;
  static v2 = _v2;
}
