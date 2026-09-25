import * as THREE from 'three';
import { hasSpecies, SPECIES, SpeciesRenderer } from './Species';
import { Agent, Grid, randomWaterPoint } from './Agent';
import {
  BenthicFish, Crab, type CrawlerConfig, Hunter, School, SchoolFish, Scripted, Sessile, currentAt,
  type Behavior, type Habitat, type HunterConfig, type SchoolConfig,
} from './behaviors';
import { Director } from './Director';
import {
  floorHeight, floorNormal, inMargins, marginYaw, PAPER_W, randomFloorInMargins, randomFloorInView, stage, stageFloor,
} from '../scene/Terrain';
import { makeMaterial, OCC_MAX, shared } from '../scene/UnderwaterMaterial';
import { asset, hasAsset } from '../scene/Assets';
import { mulberry32 } from '../util/noise';
import { hideLabel, showLabel } from '../ui/overlay';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
/** beyond this nothing is visible through the murk, so it isn't drawn */
const VIEW_RANGE = 18;

interface Population {
  key: string;
  renderer: SpeciesRenderer;
  agents: Behavior[];
}

/**
 * Everything alive in front of the fixed viewpoint. Set pieces and residents are laid out mostly in the
 * two strips of scene visible either side of the notebook page; the director brings the visitors.
 */
export class World implements Habitat {
  time = 0;
  rocks: { pos: THREE.Vector3; r: number }[] = [];
  pops = new Map<string, Population>();
  schools: School[] = [];
  watchMode = false;
  visibleCount = 0;
  director!: Director;
  /** species keys seen close to the camera this session (drained by the UI) */
  observed: string[] = [];
  private observedSet = new Set<string>();
  private herringGrid = new Grid<SchoolFish>(2.5);
  private salmonGrid = new Grid<SchoolFish>(4);
  private respawnQueue: { agent: Agent; at: number }[] = [];
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private group = new THREE.Group();
  private selected: { a: Agent; r: SpeciesRenderer; until: number } | null = null;

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.group.name = 'life';
    scene.add(this.group);
    // names show on click (the page itself takes clicks in the middle)
    window.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('#content, #controls, a, button')) return;
      this.select(e.clientX, e.clientY);
    });
  }

  // ---------------------------------------------------------------- setup

  private pop(key: string, capacity: number): Population | null {
    if (!hasSpecies(key)) return null;
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
    const p = this.pops.get(key);
    if (!p) return;
    const def = SPECIES[key];
    a.scale = def.scale[0] + Math.random() * (def.scale[1] - def.scale[0]);
    p.agents.push(a);
    p.renderer.add(a);
  }

  populate() {
    stage();
    this.buildRocks();
    this.buildFixedLife();
    this.buildFish();
    this.buildBenthos();
    this.buildScriptedPools();
    this.director = new Director(this);
  }

  /** Hidden proxies of rocks and logs, used to raycast stars and urchins onto real surfaces. */
  private surfaces: THREE.Mesh[] = [];
  private surfaceRay = new THREE.Raycaster();

  private scanInstances(key: string, places: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[], roughness: number, tint?: number) {
    const a = asset('scan:' + key);
    const { mat } = makeMaterial({ amp: 0 }, { vertexColors: false, map: a.map, normalMap: a.normalMap, roughness, tint: tint !== undefined ? new THREE.Color(tint) : undefined });
    const mesh = new THREE.InstancedMesh(a.geometry, mat, places.length);
    mesh.name = key;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const proxies: THREE.Mesh[] = [];
    places.forEach((pl, i) => {
      m.compose(pl.p, pl.q, pl.s);
      mesh.setMatrixAt(i, m);
      const proxy = new THREE.Mesh(a.geometry);
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(m);
      proxy.matrixWorld.copy(m);
      proxies.push(proxy);
    });
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return proxies;
  }

  private scanBounds(key: string) {
    const g = asset('scan:' + key).geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox!;
  }

  /** Where the octopus lives: a boulder in the right-hand strip. */
  den = new THREE.Vector3();

  private buildRocks() {
    const rnd = mulberry32(42);
    const m = marginYaw();
    const band = (side: number, f: number) => side * (m.inner + (m.outer - m.inner) * f);
    // boulders: the big scanned boulder plus three rounded rocks from a scanned set (the set's other two
    // are squared-off blocks that read as quarried stone), mixed so no two neighbours read the same
    const kinds = ['rock_boulder', 'rockset_0', 'rockset_1', 'rockset_2'].filter((k) => hasAsset('scan:' + k));
    if (kinds.length) {
      const places = new Map<string, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[]>();
      let turn = 0;
      /** size: rough footprint diameter (m) wanted */
      const put = (p: THREE.Vector3, size: number, kind = kinds[turn++ % kinds.length]) => {
        const bb = this.scanBounds(kind);
        const foot = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
        const k = size / foot;
        const s = new THREE.Vector3(k * (0.85 + rnd() * 0.3), k * (0.75 + rnd() * 0.45), k * (0.85 + rnd() * 0.3));
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.2, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.2));
        p.y -= (bb.max.y - bb.min.y) * s.y * 0.12; // bed it into the sediment
        if (!places.has(kind)) places.set(kind, []);
        places.get(kind)!.push({ p, q, s });
        const r = Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 * Math.max(s.x, s.z) * 0.8;
        this.rocks.push({ pos: p.clone(), r });
      };
      // composed pieces: a big boulder in each strip to frame the shot, the right one is the octopus den
      put(stageFloor(band(1, 0.72), 6.4), 2.3, kinds[0]);
      // the den: at the foot of that boulder, on the side facing the camera
      const denRock = this.rocks[this.rocks.length - 1];
      this.den.subVectors(stage().cam, denRock.pos).setY(0).normalize().multiplyScalar(denRock.r + 0.45).add(denRock.pos);
      this.den.y = floorHeight(this.den.x, this.den.z);
      put(stageFloor(band(-1, 0.35), 4.6), 1.6);
      put(stageFloor(band(-1, 0.85), 8.5), 2.6);
      put(stageFloor(band(1, 0.2), 9.5), 1.8);
      // scattered: mostly in the strips, some mid-frame for when the page is hidden, some far for depth
      for (let i = 0; i < 16; i++) {
        const p = randomFloorInMargins(rnd, 3, 13);
        put(p, Math.min(0.6 + Math.pow(rnd(), 1.8) * 1.9, 0.5 + p.distanceTo(stage().cam) * 0.15));
      }
      for (let i = 0; i < 8; i++) put(randomFloorInView(rnd, 6, 14, undefined, 0.6), 0.9 + rnd() * 1.5);
      for (let i = 0; i < 6; i++) put(randomFloorInView(rnd, 12, 17, undefined, 1.3), 1.8 + rnd() * 1.8);
      // the set was shot in drier, brighter light than the boulder: bring it down to match
      for (const [kind, pl] of places) this.surfaces.push(...this.scanInstances(kind, pl, 0.92, kind === 'rock_boulder' ? undefined : 0x9a9a92));
    }
    if (hasAsset('scan:log')) {
      // two waterlogged logs, one in each strip
      const bb = this.scanBounds('log');
      const places: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
      for (const [yaw, dist, turn] of [[band(-1, 0.6), 6.8, 0.5], [band(1, 0.4), 10.5, -0.3]]) {
        const p = stageFloor(yaw, dist);
        p.y -= 0.06;
        const heading = Math.atan2(stage().fwd.z, stage().fwd.x) + Math.PI / 2 + turn;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -heading, (rnd() - 0.5) * 0.06));
        places.push({ p, q, s: new THREE.Vector3(1, 1, 1) });
        const half = (bb.max.x - bb.min.x) * 0.5;
        for (let t = -half; t <= half; t += 0.7) {
          this.rocks.push({ pos: new THREE.Vector3(p.x + Math.cos(heading) * t, p.y, p.z + Math.sin(heading) * t), r: 0.35 });
        }
      }
      this.surfaces.push(...this.scanInstances('log', places, 0.95));
    }
    if (hasAsset('scan:scallop')) {
      // empty shells lying about, some upside down, half sunk in the silt
      const places: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
      for (let i = 0; i < 70; i++) {
        const p = i < 45 ? randomFloorInMargins(rnd, 2.2, 9) : randomFloorInView(rnd, 2.5, 10);
        p.y -= 0.004;
        const flip = rnd() < 0.35 ? Math.PI : 0;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(flip + (rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3));
        const k = 0.5 + rnd() * 0.6;
        places.push({ p, q, s: new THREE.Vector3(k, k, k) });
      }
      this.scanInstances('scallop', places, 0.6);
    }
  }

  /** Point on the top surface of a random rock or log (with its surface normal), or null. */
  private surfacePoint(rnd: () => number, out: THREE.Vector3, normal: THREE.Vector3, marginsOnly = true): boolean {
    if (!this.surfaces.length) return false;
    const m = this.surfaces[Math.floor(rnd() * this.surfaces.length)];
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    _v.set(bb.min.x + (bb.max.x - bb.min.x) * (0.1 + 0.8 * rnd()), bb.max.y + 1, bb.min.z + (bb.max.z - bb.min.z) * (0.1 + 0.8 * rnd())).applyMatrix4(m.matrixWorld);
    this.surfaceRay.set(_v, _v2.set(0, -1, 0));
    const hit = this.surfaceRay.intersectObject(m, false)[0];
    if (!hit || !hit.face) return false;
    normal.copy(hit.face.normal).transformDirection(m.matrixWorld);
    if (normal.y < 0.35) return false; // too steep to hold on
    if (marginsOnly && !inMargins(hit.point)) return false;
    if (hit.point.distanceTo(stage().cam) > 11) return false;
    out.copy(hit.point);
    return true;
  }

  private buildFixedLife() {
    const rnd = mulberry32(9);
    const up = new THREE.Vector3();
    const sessile = (key: string, count: number, place: (p: THREE.Vector3, up: THREE.Vector3) => boolean, doing: string, size: number) => {
      if (!this.pop(key, count)) return;
      let made = 0;
      for (let tries = 0; made < count && tries < count * 40; tries++) {
        up.set(0, 0, 0);
        if (!place(_v, up)) continue;
        if (up.lengthSq() === 0) floorNormal(_v.x, _v.z, up);
        const a = new Sessile(key, { maxSpeed: 0, maxForce: 0, cruise: 0, size }, _v, up, rnd() * Math.PI * 2, doing);
        this.addAgent(key, a);
        a.pos.y -= 0.01; // settle into the silt so nothing hovers
        made++;
      }
    };
    const floorIn = (dMin: number, dMax: number) => (p: THREE.Vector3) => { randomFloorInMargins(rnd, dMin, dMax, p); return true; };
    const onRockOr = (chance: number, dMin: number, dMax: number) => (p: THREE.Vector3, n: THREE.Vector3) =>
      rnd() < chance ? this.surfacePoint(rnd, p, n) : floorIn(dMin, dMax)(p);
    sessile('batstar', 12, onRockOr(0.4, 2.4, 9), 'grazing on film and detritus', 0.2);
    sessile('sunflowerstar', 2, floorIn(3.5, 7), 'hunting urchins, slowly', 0.7);
    sessile('urchin', 18, onRockOr(0.5, 2.6, 9), 'grazing drift kelp', 0.12);
    sessile('scallop', 10, floorIn(2.4, 7), 'filter feeding, eyes along its mantle', 0.12);
  }

  private buildFish() {
    const herringCfg: SchoolConfig = { neighbor: 1.6, separation: 0.45, cohesion: 0.9, alignment: 1.3, sepWeight: 0.9, fleeRadius: 5, predators: ['seal', 'porpoise', 'dogfish', 'orca'], homeAbove: [2.5, 6] };
    const salmonCfg: SchoolConfig = { neighbor: 4, separation: 1.1, cohesion: 0.6, alignment: 1.0, sepWeight: 0.8, fleeRadius: 8, predators: ['orca', 'seal'], homeAbove: [3, 7] };
    const herringN = 160;
    if (this.pop('herring', herringN)) {
      const school = new School(herringCfg, 'herring');
      this.schools.push(school);
      for (let i = 0; i < herringN; i++) {
        const f = new SchoolFish('herring', school, { maxSpeed: 3.2, maxForce: 9, cruise: 1.1, turnRate: 6, clearance: 0.6, size: 0.28 });
        school.members.push(f);
        this.addAgent('herring', f);
      }
    }
    const salmonN = 8;
    if (this.pop('chinook', salmonN)) {
      const school = new School(salmonCfg, 'chinook');
      this.schools.push(school);
      for (let i = 0; i < salmonN; i++) {
        const f = new SchoolFish('chinook', school, { maxSpeed: 6, maxForce: 10, cruise: 1.6, turnRate: 4, clearance: 1, size: 0.9 });
        school.members.push(f);
        this.addAgent('chinook', f);
      }
    }
    // rockfish hang around the boulders in the two strips, and now and then come to look at the diver
    const rnd = mulberry32(21);
    // copper rockfish sit low by the boulders; black rockfish hang in loose groups up in the water column
    for (const [key, n, lo, hi, idle] of [['rockfish', 4, 0.4, 1.4, 'hovering by its rock'], ['blackrockfish', 8, 1.6, 3.6, 'hanging in the water column']] as const) {
      if (!this.pop(key, n)) continue;
      for (let i = 0; i < n; i++) {
        const f = new BenthicFish(key, { maxSpeed: 1.6, maxForce: 3, cruise: 0.35, turnRate: 3, clearance: 0.3, size: 0.45 }, ['prawn'], { idle, hunt: 'snapping at a prawn', eat: 'swallowing' }, [lo, hi]);
        const rk = this.rocks[Math.floor(rnd() * Math.min(this.rocks.length, 12))];
        if (key === 'rockfish' && rk && inMargins(rk.pos)) f.home.copy(rk.pos).add(new THREE.Vector3((rnd() - 0.5) * 2, 0, (rnd() - 0.5) * 2));
        else randomFloorInMargins(rnd, key === 'rockfish' ? 3 : 4, key === 'rockfish' ? 8 : 9, f.home, i % 2 ? 1 : -1, 0.08);
        f.home.y = floorHeight(f.home.x, f.home.z) + lo + rnd() * (hi - lo);
        f.pos.copy(f.home);
        f.goal.copy(f.home);
        this.addAgent(key, f);
      }
    }
    // a few small sharks patrolling low over the bottom, passing through the frame
    if (this.pop('dogfish', 3)) {
      for (let i = 0; i < 3; i++) {
        this.hunter('dogfish', {
          prey: ['herring', 'prawn'], huntRange: 6, catchDist: 0.5, airBreather: false, oxygen: [1, 1], cruiseAbove: [0.6, 2], eatTime: 4,
          verbs: { cruise: 'patrolling the bottom', hunt: 'closing on prey', eat: 'feeding', breathe: '', rest: '' },
        }, { maxSpeed: 2.4, maxForce: 3, cruise: 0.8, turnRate: 1.6, clearance: 0.6, bankAmount: 0.7, size: 1 });
      }
    }
  }

  private buildBenthos() {
    const rnd = mulberry32(5);
    const crawl = (key: string, n: number, speed: number, bury: boolean, cfg: Partial<CrawlerConfig>, size: number, dMin = 2.4, dMax = 8) => {
      if (!this.pop(key, n)) return;
      for (let i = 0; i < n; i++) {
        const c = new Crab(key, { maxSpeed: speed * 2.2, maxForce: 1, cruise: speed, size }, bury, cfg);
        randomFloorInMargins(rnd, dMin, dMax, c.pos);
        c.home.copy(c.pos);
        c.goal.copy(c.pos);
        this.addAgent(key, c);
      }
    };
    const crab = { threats: ['octopus', 'seal'], threatRadius: 2.5, roam: 2.5 };
    crawl('dungeness', 4, 0.3, true, crab, 0.2);
    crawl('redrock', 3, 0.25, false, crab, 0.2);
    crawl('kelpcrab', 2, 0.18, false, { ...crab, facing: 'forward' }, 0.15);
    crawl('decorator', 2, 0.12, false, { ...crab, facing: 'forward', roam: 1.5 }, 0.12);
    crawl('prawn', 8, 0.22, false, {
      facing: 'forward', fleeBackward: true, threats: ['octopus', 'rockfish', 'blackrockfish', 'sculpin', 'dogfish'], threatRadius: 1.4,
      roam: 1.8, walkChance: 0.5, verbs: { idle: 'picking at the bottom', walk: 'walking on its toes', flee: 'tail-flipping away', bury: '' },
    }, 0.2);
    crawl('flounder', 2, 0.45, true, {
      facing: 'forward', threats: ['seal', 'octopus', 'dogfish'], threatRadius: 2, roam: 3, walkChance: 0.15, lift: 0.08,
      verbs: { idle: 'lying flat, watching', walk: 'gliding over the sand', flee: 'bolting in a cloud of silt', bury: 'half-buried in the sand' },
    }, 0.45, 3, 8);
    crawl('sculpin', 3, 0.3, false, {
      facing: 'forward', threats: ['seal', 'octopus', 'dogfish'], threatRadius: 1.5, roam: 1.2, walkChance: 0.12, lift: 0.04,
      verbs: { idle: 'sitting motionless, camouflaged', walk: 'hopping to a new spot', flee: 'darting off', bury: '' },
    }, 0.3);
    crawl('cucumber', 3, 0.02, false, {
      facing: 'forward', threats: [], roam: 0.8, walkChance: 0.7,
      verbs: { idle: 'sifting detritus', walk: 'creeping along', flee: '', bury: '' },
    }, 0.3);
  }

  /** Visitors driven by the director: a pool of scripted bodies per species, hidden until used.
   *  Called again once the late-loading visitors arrive; species already pooled are left alone. */
  buildScriptedPools() {
    const pools: [string, number, ConstructorParameters<typeof Scripted>[1]][] = [
      ['seal', 2, { maxSpeed: 4, maxForce: 3.2, cruise: 1.5, turnRate: 2.4, clearance: 0.8, bankAmount: 0.8, size: 1.6 }],
      ['orca', 4, { maxSpeed: 4, maxForce: 2.2, cruise: 2.6, turnRate: 0.8, clearance: 3, bankAmount: 0.6, size: 7 }],
      ['porpoise', 3, { maxSpeed: 5, maxForce: 5, cruise: 3.2, turnRate: 2, clearance: 1.5, bankAmount: 1, size: 1.6 }],
      ['humpback', 1, { maxSpeed: 2.5, maxForce: 0.8, cruise: 1.6, turnRate: 0.3, clearance: 4, bankAmount: 0.3, size: 14 }],
      ['octopus', 1, { maxSpeed: 0.6, maxForce: 1, cruise: 0.12, size: 1.2 }],
    ];
    for (const [key, n, opts] of pools) {
      if (this.pops.get(key)?.agents.length) continue;
      if (!this.pop(key, n)) continue;
      for (let i = 0; i < n; i++) {
        const s = new Scripted(key, opts);
        s.crawl = key === 'octopus';
        this.addAgent(key, s);
      }
    }
  }

  /** A free scripted body of this species, or null if they're all busy. */
  scripted(key: string): Scripted | null {
    const p = this.pops.get(key);
    if (!p) return null;
    for (const a of p.agents) if (a instanceof Scripted && a.done && !a.alive) return a;
    return null;
  }

  school(key: string): School | undefined {
    return this.schools.find((s) => s.key === key);
  }

  private hunter(key: string, cfg: HunterConfig, opts: ConstructorParameters<typeof Hunter>[2]) {
    const h = new Hunter(key, cfg, opts);
    this.addAgent(key, h);
    return h;
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
    // respawns: eaten animals come back later, out of sight
    while (this.respawnQueue.length && this.respawnQueue[0].at < t) {
      const { agent } = this.respawnQueue.shift()!;
      agent.alive = true;
      if (agent instanceof SchoolFish) {
        agent.pos.copy(agent.school.anchor).add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6));
        agent.vel.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(agent.opts.cruise);
      } else if (agent instanceof Crab) {
        agent.pos.copy(agent.home);
        agent.goal.copy(agent.pos);
        agent.state = 'forage';
        agent.buried = 0;
      } else if (agent instanceof BenthicFish) {
        agent.pos.copy(agent.home);
      } else {
        randomWaterPoint(1, 4, 10, 16, agent.pos);
      }
    }
    this.respawnQueue.sort((a, b) => a.at - b.at);

    // schools + neighbour grids
    for (const s of this.schools) s.update(dt, t);
    const herring = (this.pops.get('herring')?.agents ?? []) as SchoolFish[];
    const salmon = (this.pops.get('chinook')?.agents ?? []) as SchoolFish[];
    this.herringGrid.rebuild(herring.filter((a) => a.alive));
    this.salmonGrid.rebuild(salmon.filter((a) => a.alive));
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

    this.director.update(dt);
    for (const p of this.pops.values()) {
      for (const a of p.agents) {
        if (!a.alive) continue;
        a.update(dt, this);
        // a finished visitor has swum out of frame: park it until the director needs it again
        if (a instanceof Scripted && a.done) a.alive = false;
      }
    }

    // push to GPU + count visible
    const camPos = this.camera.position;
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    let vis = 0;
    for (const p of this.pops.values()) {
      p.renderer.sync(dt, camPos, VIEW_RANGE);
      for (const a of p.agents) {
        if (!a.alive) continue;
        const d2 = a.pos.distanceToSquared(camPos);
        if (d2 > 11 * 11 || !this.frustum.containsPoint(a.pos) || !this.onScreen(a.pos)) continue;
        vis++;
        if (d2 < 9 * 9 && !this.observedSet.has(p.key)) {
          this.observedSet.add(p.key);
          this.observed.push(p.key);
        }
      }
    }
    this.visibleCount = vis;

    this.updateOccluders(camPos);
    this.updateLabel();
  }

  /** In the visible part of the frame: beside the page, or anywhere when the page is hidden. */
  private onScreen(p: THREE.Vector3): boolean {
    if (this.watchMode) return true;
    const x = this.screenX(p);
    const w = window.innerWidth;
    const half = Math.min(PAPER_W, w) / 2;
    return x < w / 2 - half || x > w / 2 + half;
  }

  private screenX(p: THREE.Vector3) {
    _v2.copy(p).project(this.camera);
    return (_v2.x + 1) / 2 * window.innerWidth;
  }

  // ---------------------------------------------------------------- contact occlusion

  private occCand: { x: number; z: number; r: number; s: number; d: number }[] = [];

  /** Collect the rocks and bottom-dwellers nearest the camera; the floor shader darkens under them. */
  private updateOccluders(cam: THREE.Vector3) {
    const c = this.occCand;
    c.length = 0;
    const R2 = 15 * 15;
    const push = (x: number, z: number, r: number, s: number) => {
      const dx = x - cam.x;
      const dz = z - cam.z;
      const d = dx * dx + dz * dz;
      if (d < R2 && s > 0.02) c.push({ x, z, r, s, d });
    };
    for (const rk of this.rocks) push(rk.pos.x, rk.pos.z, rk.r * 1.25, 0.6);
    const floorRules: Record<string, [number, number]> = {
      dungeness: [0.24, 0.6], redrock: [0.2, 0.6], kelpcrab: [0.14, 0.45], decorator: [0.12, 0.45], octopus: [0.9, 0.6],
      urchin: [0.13, 0.5], batstar: [0.18, 0.35], sunflowerstar: [0.45, 0.4], scallop: [0.1, 0.4],
      flounder: [0.3, 0.45], sculpin: [0.2, 0.5], prawn: [0.1, 0.4], cucumber: [0.16, 0.5],
    };
    const hoverRules: Record<string, [number, number]> = { rockfish: [0.3, 0.45], blackrockfish: [0.3, 0.45], seal: [0.8, 0.5], dogfish: [0.5, 0.45] };
    for (const [key, [r, s]] of Object.entries(floorRules)) {
      const p = this.pops.get(key);
      if (!p) continue;
      for (const a of p.agents) if (a.alive) push(a.pos.x, a.pos.z, r * a.scale, s);
    }
    for (const [key, [r, s]] of Object.entries(hoverRules)) {
      const p = this.pops.get(key);
      if (!p) continue;
      for (const a of p.agents) {
        if (!a.alive) continue;
        // soft shadow that spreads and fades as the animal rises off the bottom
        const h = Math.max(0, a.pos.y - floorHeight(a.pos.x, a.pos.z));
        push(a.pos.x, a.pos.z, r * a.scale * (1 + h * 0.4), s * Math.exp(-h * 0.9));
      }
    }
    c.sort((a, b) => a.d - b.d);
    const n = Math.min(OCC_MAX, c.length);
    const occ = shared.occ.value;
    for (let i = 0; i < n; i++) occ[i].set(c[i].x, c[i].z, c[i].r, c[i].s);
    shared.occCount.value = n;
  }

  // ---------------------------------------------------------------- torch and focus

  /** Where the diver's attention is: the director's current visitor if one is in view. */
  hero(): Agent | null {
    const h = this.director.hero;
    if (!h || !h.alive || h.pos.distanceTo(this.camera.position) > 12 || !this.onScreen(h.pos)) return null;
    return h;
  }

  // ---------------------------------------------------------------- click labels

  private select(px: number, py: number) {
    // screen-space picking: project every candidate and take the closest to the click within its
    // projected radius. More forgiving than a ray for small animals.
    const cam = this.camera;
    const focal = (window.innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360);
    let best: { a: Agent; r: SpeciesRenderer; d: number } | null = null;
    for (const p of this.pops.values()) {
      for (const a of p.agents) {
        if (!a.alive) continue;
        _v.copy(a.pos).applyMatrix4(cam.matrixWorldInverse);
        const depth = -_v.z;
        if (depth < 0.4 || depth > 12) continue;
        _v2.copy(a.pos).project(cam);
        const sx = (_v2.x + 1) / 2 * window.innerWidth;
        const sy = (1 - _v2.y) / 2 * window.innerHeight;
        const size = (a.opts.size || 0.5) * a.scale;
        const radiusPx = Math.max(14, (size * 0.5 * focal) / depth);
        const dist = Math.hypot(sx - px, sy - py);
        if (dist > radiusPx + 8) continue;
        const score = dist / radiusPx + depth * 0.02;
        if (!best || score < best.d) best = { a, r: p.renderer, d: score };
      }
    }
    if (best) this.selected = { a: best.a, r: best.r, until: this.time + 7 };
    else {
      this.selected = null;
      hideLabel();
    }
  }

  /** Keep the tag pinned to the animal while it's in view, for a few seconds. */
  private updateLabel() {
    const s = this.selected;
    if (!s) return;
    if (!s.a.alive || this.time > s.until || !this.onScreen(s.a.pos)) {
      this.selected = null;
      hideLabel();
      return;
    }
    _v2.copy(s.a.pos).project(this.camera);
    if (_v2.z > 1) {
      this.selected = null;
      hideLabel();
      return;
    }
    const sx = (_v2.x + 1) / 2 * window.innerWidth;
    const sy = (1 - _v2.y) / 2 * window.innerHeight;
    showLabel(sx, sy, s.r.def.name, s.r.def.latin, s.a.doing);
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
}
