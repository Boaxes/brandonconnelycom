import * as THREE from 'three';
import { SPECIES, SpeciesRenderer } from './Species';
import { Agent, Grid, randomWaterPoint } from './Agent';
import {
  BenthicFish, Crab, type CrawlerConfig, Hunter, Jelly, Octopus, Pod, School, SchoolFish, Sessile, currentAt,
  type Behavior, type Habitat, type HunterConfig, type SchoolConfig,
} from './behaviors';
import { cameraPath, floorHeight, floorNormal, randomFloorNearPath } from '../scene/Terrain';
import { ensureSwim, makeMaterial, OCC_MAX, shared } from '../scene/UnderwaterMaterial';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { attachGround } from '../scene/Terrain';
import { asset, hasAsset } from '../scene/Assets';
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

  /** Hidden proxies of rocks and logs, used to raycast anemones and stars onto real surfaces. */
  private surfaces: THREE.Mesh[] = [];
  private logSurfaces: THREE.Mesh[] = [];

  private scanInstances(key: string, count: number, roughness: number, place: (i: number, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3) => void) {
    const a = asset('scan:' + key);
    const { mat } = makeMaterial({ amp: 0 }, { vertexColors: false, map: a.map, normalMap: a.normalMap, roughness });
    const mesh = new THREE.InstancedMesh(a.geometry, mat, count);
    mesh.name = key;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const proxies: THREE.Mesh[] = [];
    for (let i = 0; i < count; i++) {
      place(i, p, q, sc);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      const proxy = new THREE.Mesh(a.geometry);
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(m);
      proxy.matrixWorld.copy(m);
      proxies.push(proxy);
    }
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.statics.push({ mesh, mats: proxies.map((p) => p.matrix), pos: proxies.map((p) => new THREE.Vector3().setFromMatrixPosition(p.matrix)) });
    return { mesh, proxies };
  }

  /** Scanned set pieces: all placements are kept, only the ones inside the murk are drawn. */
  private statics: { mesh: THREE.InstancedMesh; mats: THREE.Matrix4[]; pos: THREE.Vector3[] }[] = [];

  private cullStatics(cam: THREE.Vector3) {
    const r2 = (VIEW_RANGE + 3) * (VIEW_RANGE + 3);
    for (const s of this.statics) {
      let n = 0;
      for (let i = 0; i < s.pos.length; i++) if (s.pos[i].distanceToSquared(cam) < r2) s.mesh.setMatrixAt(n++, s.mats[i]);
      s.mesh.count = n;
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private scanBounds(key: string) {
    const g = asset('scan:' + key).geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox!;
  }

  private buildRocks() {
    const rnd = mulberry32(42);
    if (hasAsset('scan:rock_boulder')) {
      // photoscanned boulders, rotated and scaled so no two read the same
      const bb = this.scanBounds('rock_boulder');
      const n = 120;
      const { proxies } = this.scanInstances('rock_boulder', n, 0.92, (i, p, q, sc) => {
        const at = (i + rnd()) / n; // evenly spread along the loop so every stretch has some
        const k = 0.3 + Math.pow(rnd(), 1.8) * 1.15;
        sc.set(k * (0.85 + rnd() * 0.3), k * (0.7 + rnd() * 0.5), k * (0.85 + rnd() * 0.3));
        // keep the diver's lane clear: bigger boulders sit further out
        const half = Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 * Math.max(sc.x, sc.z);
        const lane = 1.4 + half * 0.8;
        if (i % 4 !== 0) randomFloorNearPath(lane + 3.5, p, rnd, lane, at); else randomFloorNearPath(lane + 9, p, rnd, lane + 2, at);
        q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.25, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.25));
        p.y -= (bb.max.y - bb.min.y) * sc.y * 0.15; // bed it into the sediment
        const r = Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 * Math.max(sc.x, sc.z) * 0.8;
        this.rocks.push({ pos: p.clone(), r });
      });
      this.surfaces.push(...proxies);
    }
    if (hasAsset('scan:barnacle_rock')) {
      // low shelves of barnacle-crusted rock breaking through the sand
      const { proxies } = this.scanInstances('barnacle_rock', 40, 0.9, (i, p, q, sc) => {
        randomFloorNearPath(5, p, rnd, 1.2, (i + rnd()) / 40);
        const k = 0.8 + rnd() * 0.9;
        sc.set(k, k * (0.8 + rnd() * 0.5), k);
        q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI * 2, 0));
        p.y -= 0.05;
        this.rocks.push({ pos: p.clone(), r: 0.6 * k });
      });
      this.surfaces.push(...proxies);
    }
    if (hasAsset('scan:log')) {
      // waterlogged logs: very Puget Sound, and anemones love them
      const bb = this.scanBounds('log');
      const { proxies } = this.scanInstances('log', 12, 0.95, (i, p, q, sc) => {
        randomFloorNearPath(5, p, rnd, 2.2, (i + 0.3 + rnd() * 0.4) / 12);
        const k = 0.8 + rnd() * 0.5;
        sc.set(k, k, k);
        const yaw = rnd() * Math.PI * 2;
        q.setFromEuler(new THREE.Euler(0, yaw, (rnd() - 0.5) * 0.06));
        p.y -= 0.06;
        // treat the log as a row of small obstacles for the bottom walkers
        const half = (bb.max.x - bb.min.x) * 0.5 * k;
        for (let t = -half; t <= half; t += 0.7) {
          this.rocks.push({ pos: new THREE.Vector3(p.x + Math.cos(yaw) * t, p.y, p.z - Math.sin(yaw) * t), r: 0.35 * k });
        }
      });
      this.surfaces.push(...proxies);
      this.logSurfaces.push(...proxies);
    }
    if (this.rocks.length === 0) this.buildProceduralRocks(rnd);
  }

  /** Point on the top surface of a random rock or log (with its surface normal), or null. */
  private surfacePoint(rnd: () => number, out: THREE.Vector3, normal: THREE.Vector3, preferLogs = 0): boolean {
    const pool = this.logSurfaces.length && rnd() < preferLogs ? this.logSurfaces : this.surfaces;
    if (!pool.length) return false;
    const m = pool[Math.floor(rnd() * pool.length)];
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    _v.set(bb.min.x + (bb.max.x - bb.min.x) * (0.1 + 0.8 * rnd()), bb.max.y + 1, bb.min.z + (bb.max.z - bb.min.z) * (0.1 + 0.8 * rnd())).applyMatrix4(m.matrixWorld);
    this.surfaceRay.set(_v, _v2.set(0, -1, 0));
    const hit = this.surfaceRay.intersectObject(m, false)[0];
    if (!hit || !hit.face) return false;
    normal.copy(hit.face.normal).transformDirection(m.matrixWorld);
    if (normal.y < 0.35) return false; // too steep to hold on
    out.copy(hit.point);
    return true;
  }
  private surfaceRay = new THREE.Raycaster();

  private buildProceduralRocks(rnd: () => number) {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // low-frequency lumps + a little grit, squashed and flattened underneath
      const s = 1 + noise2(x * 1.1 + 5, z * 1.1 + y * 0.8) * 0.28 + noise2(x * 3 + 1, (y + z) * 3) * 0.06;
      const yy = y < 0 ? y * 0.35 : y * 0.75;
      pos.setXYZ(i, x * s, yy * s, z * s);
    }
    // weld the icosphere so the displaced boulder gets smooth normals
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    const flat = mergeVertices(geo);
    flat.computeVertexNormals();
    ensureSwim(flat);
    const cols = new Float32Array(flat.attributes.position.count * 3);
    const base = new THREE.Color(0x4d5148);
    const c = new THREE.Color();
    for (let i = 0; i < cols.length / 3; i++) {
      c.copy(base).offsetHSL(rnd() * 0.02, 0, (rnd() - 0.5) * 0.08);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    flat.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const { mat, uniforms } = makeMaterial({ amp: 0 }, { roughness: 0.9, detail: 2 });
    attachGround(uniforms);
    mat.flatShading = false;
    const count = 70;
    const mesh = new THREE.InstancedMesh(flat, mat, count);
    mesh.name = 'rocks';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      if (i % 3 !== 0) randomFloorNearPath(6, p, rnd, 1.8); else randomFloorNearPath(14, p, rnd, 4);
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
    const sessile = (key: string, count: number, place: (p: THREE.Vector3, up: THREE.Vector3) => boolean, doing: string) => {
      this.pop(key, count);
      let tries = 0;
      let made = 0;
      while (made < count && tries < count * 20) {
        tries++;
        randomFloorNearPath(7, _v, rnd, 0.8);
        up.set(0, 0, 0);
        if (!place(_v, up)) continue;
        if (up.lengthSq() === 0) floorNormal(_v.x, _v.z, up);
        const size = key === 'bullkelp' ? 3 : key === 'sugarkelp' ? 1.2 : key === 'sunflowerstar' ? 0.8 : key === 'tubeanemone' ? 0.5 : 0.4;
        // kelp blades trail down-current, so all kelp shares a heading (+ a little scatter)
        const yaw = key === 'bullkelp' || key === 'sugarkelp' ? 0.4 + (rnd() - 0.5) * 0.7 : rnd() * Math.PI * 2;
        const a = new Sessile(key, { maxSpeed: 0, maxForce: 0, cruise: 0, size }, _v, up, yaw, doing);
        this.addAgent(key, a);
        made++;
      }
    };
    // bull kelp grows in groves: pick grove centres near the camera loop, then scatter stipes around them
    const groves: THREE.Vector3[] = [];
    for (let i = 0; i < 14; i++) groves.push(randomFloorNearPath(10, new THREE.Vector3(), rnd, 5, (i + rnd()) / 14));
    let gi = 0;
    const kelpField = (p: THREE.Vector3) => {
      const g = groves[gi++ % groves.length];
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * (3 + rnd() * 4);
      p.set(g.x + Math.cos(a) * d, 0, g.z + Math.sin(a) * d);
      p.y = floorHeight(p.x, p.z);
      return true;
    };
    sessile('bullkelp', 170, kelpField, 'swaying in the current');
    sessile('sugarkelp', 120, (p) => noise2(p.x * 0.05 + 9, p.z * 0.05 + 2) > 0.1, 'swaying in the current');
    // soft-bottom life on the open sand between the rocks: sea pens stand in loose meadows,
    // tube anemones scattered singly
    const clearOfRocks = (p: THREE.Vector3, r: number) => this.rocks.every((k) => (k.pos.x - p.x) ** 2 + (k.pos.z - p.z) ** 2 > (k.r + r) ** 2);
    sessile('seapen', 260, (p) => noise2(p.x * 0.12 + 40, p.z * 0.12 - 7) > -0.05 && clearOfRocks(p, 0.3), 'filter feeding, polyps open');
    sessile('tubeanemone', 140, (p) => clearOfRocks(p, 0.4), 'fishing with its tentacles');
    // anemones colonise hard surfaces: rocks, shelves and especially the sunken logs
    const onRock = (p: THREE.Vector3, up: THREE.Vector3) => this.surfacePoint(rnd, p, up, 0.45);
    sessile('anemone', 420, onRock, 'filter feeding');
    sessile('ochrestar', 40, (p, up) => (rnd() < 0.6 ? this.surfacePoint(rnd, p, up) : true), 'grazing on mussels');
    sessile('sunflowerstar', 10, () => true, 'hunting urchins, slowly');
    sessile('urchin', 60, (p, up) => (rnd() < 0.5 ? this.surfacePoint(rnd, p, up) : noise2(p.x * 0.06 + 20, p.z * 0.06) > 0.05), 'grazing kelp');
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
    for (const key of ['rockfish', 'blackrockfish']) {
      this.pop(key, 14);
      for (let i = 0; i < 14; i++) {
        this.addAgent(key, new BenthicFish(key, { maxSpeed: 1.6, maxForce: 3, cruise: 0.35, turnRate: 3, clearance: 0.3, size: 0.45 }, ['prawn'], { idle: 'hovering by its rock', hunt: 'snapping at a prawn', eat: 'swallowing' }, [0.4, 1.6]));
      }
    }
    this.pop('lingcod', 5);
    for (let i = 0; i < 5; i++) {
      this.addAgent('lingcod', new BenthicFish('lingcod', { maxSpeed: 4.5, maxForce: 12, cruise: 0.4, turnRate: 4, clearance: 0.2, size: 0.9 }, ['herring'], { idle: 'lying in ambush', hunt: 'lunging at herring', eat: 'swallowing a herring' }, [0.15, 0.6]));
    }
  }

  private buildBenthos() {
    const crab = (key: string, n: number, speed: number, bury: boolean, cfg?: Partial<CrawlerConfig>, size = 0.2) => {
      this.pop(key, n);
      for (let i = 0; i < n; i++) {
        const c = new Crab(key, { maxSpeed: speed * 2.2, maxForce: 1, cruise: speed, size }, bury, cfg);
        randomFloorNearPath(5, c.pos);
        c.goal.copy(c.pos);
        this.addAgent(key, c);
      }
    };
    crab('dungeness', 30, 0.35, true);
    crab('redrock', 22, 0.3, false);
    crab('kelpcrab', 14, 0.2, false, { facing: 'forward' });
    crab('decorator', 12, 0.15, false, { facing: 'forward' });
    crab('prawn', 26, 0.25, false, {
      facing: 'forward', fleeBackward: true, threats: ['octopus', 'rockfish', 'blackrockfish', 'lingcod', 'sculpin'], threatRadius: 1.6,
      roam: 3, walkChance: 0.5, verbs: { idle: 'picking at the bottom', walk: 'walking on its toes', flee: 'tail-flipping away', bury: '' },
    }, 0.2);
    crab('flounder', 12, 0.5, true, {
      facing: 'forward', threats: ['seal', 'sealion', 'octopus', 'dogfish'], threatRadius: 2.5, roam: 5, walkChance: 0.15, lift: 0.08,
      verbs: { idle: 'lying flat, watching', walk: 'gliding over the sand', flee: 'bolting in a cloud of silt', bury: 'half-buried in the sand' },
    }, 0.45);
    crab('sculpin', 10, 0.35, false, {
      facing: 'forward', threats: ['seal', 'octopus', 'dogfish'], threatRadius: 1.8, roam: 2, walkChance: 0.12, lift: 0.04,
      verbs: { idle: 'sitting motionless, camouflaged', walk: 'hopping to a new spot', flee: 'darting off', bury: '' },
    }, 0.3);
    crab('cucumber', 14, 0.025, false, {
      facing: 'forward', threats: [], roam: 1.5, walkChance: 0.7,
      verbs: { idle: 'sifting detritus', walk: 'creeping along', flee: '', bury: '' },
    }, 0.3);
    this.pop('octopus', 2);
    for (let i = 0; i < 2; i++) {
      // den at a large rock
      const big = this.rocks.filter((r) => r.r > 1.0).sort((a, b) => this.pathDistance(a.pos) - this.pathDistance(b.pos));
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
    // a loose group of small sharks patrolling low over the bottom
    this.pop('dogfish', 7);
    for (let i = 0; i < 7; i++) {
      this.hunter('dogfish', {
        prey: ['herring', 'flounder', 'prawn'], huntRange: 8, catchDist: 0.5, airBreather: false, oxygen: [1, 1], cruiseAbove: [0.7, 2.5], eatTime: 4,
        verbs: { cruise: 'patrolling the bottom', hunt: 'closing on prey', eat: 'feeding', breathe: '', rest: '' },
      }, { maxSpeed: 2.8, maxForce: 4, cruise: 0.9, turnRate: 1.8, clearance: 0.7, bankAmount: 0.7, size: 1 });
    }
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
      const sessile = p.key === 'bullkelp' || p.key === 'sugarkelp' || p.key === 'anemone' || p.key === 'seapen' || p.key === 'tubeanemone' || p.key === 'urchin' || p.key === 'ochrestar' || p.key === 'sunflowerstar';
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

    this.updateOccluders(camPos);
    this.cullStatics(camPos);

    // hover picking
    this.pickTimer -= dt;
    if (this.pickTimer < 0) {
      this.pickTimer = 0.08;
      this.pick();
    }
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
      urchin: [0.13, 0.5], ochrestar: [0.18, 0.35], sunflowerstar: [0.45, 0.4], anemone: [0.16, 0.45], bullkelp: [0.25, 0.35],
      flounder: [0.3, 0.45], sculpin: [0.2, 0.5], prawn: [0.1, 0.4], cucumber: [0.16, 0.5],
    };
    const hoverRules: Record<string, [number, number]> = { rockfish: [0.3, 0.45], blackrockfish: [0.3, 0.45], lingcod: [0.5, 0.5], seal: [0.8, 0.5], dogfish: [0.5, 0.45] };
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

  // ---------------------------------------------------------------- camera attention

  private static STATIC = new Set(['bullkelp', 'sugarkelp', 'anemone', 'seapen', 'tubeanemone', 'urchin', 'ochrestar', 'sunflowerstar']);

  private static ATTN: Record<string, number> = {
    octopus: 3, seal: 2.5, sealion: 2.5, orca: 3, humpback: 3, dolphin: 2, porpoise: 2, sixgill: 2.5,
    lingcod: 1.5, rockfish: 1.2, dungeness: 1.3, redrock: 1.3, kelpcrab: 1.1, decorator: 1.1, chinook: 1.2,
    lionsmane: 1.6, seanettle: 1.3, moonjelly: 1,
    blackrockfish: 1.2, flounder: 1.4, sculpin: 1.3, prawn: 1.1, cucumber: 0.9, dogfish: 2.2,
  };

  /** Something worth looking at in front of the camera, weighted by interest and proximity. */
  attentionTarget(pos: THREE.Vector3, fwd: THREE.Vector3): THREE.Vector3 | null {
    let best: Agent | null = null;
    let bestScore = 0;
    for (const [key, w] of Object.entries(World.ATTN)) {
      const p = this.pops.get(key);
      if (!p) continue;
      for (const a of p.agents) {
        if (!a.alive) continue;
        _v.subVectors(a.pos, pos);
        const d = _v.length();
        if (d > 7 || d < 1) continue;
        const facing = _v.dot(fwd) / d;
        if (facing < 0.55) continue; // only things already roughly in view
        const score = w * facing / (1 + d * 0.35);
        if (score > bestScore) { bestScore = score; best = a; }
      }
    }
    return best ? best.pos : null;
  }

  // ---------------------------------------------------------------- autofocus

  /** Distance to what the camera is looking at: the nearest animal near screen centre, else the floor. */
  focusTarget(): number {
    const cam = this.camera;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = 12;
    // march to the floor
    for (let t = 0.4; t < 12; t += 0.2) {
      const x = cam.position.x + fwd.x * t;
      const y = cam.position.y + fwd.y * t;
      const z = cam.position.z + fwd.z * t;
      if (y <= floorHeight(x, z) + 0.05) {
        best = t;
        break;
      }
    }
    // animals whose body overlaps the centre of the frame (plants and fixed life don't pull focus)
    for (const p of this.pops.values()) {
      if (World.STATIC.has(p.key)) continue;
      for (const a of p.agents) {
        if (!a.alive) continue;
        _v2.subVectors(a.pos, cam.position);
        const along = _v2.dot(fwd);
        if (along < 0.3 || along > best) continue;
        const off = Math.sqrt(Math.max(0, _v2.lengthSq() - along * along));
        const r = Math.max(0.15, (a.opts.size || 0.5) * a.scale * 0.5);
        if (off < r + along * 0.06) best = along;
      }
    }
    return Math.max(0.6, best);
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
