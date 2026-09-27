import * as THREE from 'three';
import { hasSpecies, SPECIES, SpeciesRenderer, type LodView } from './Species';
import { Agent, Grid, randomWaterPoint } from './Agent';
import {
  BenthicFish, Crab, type CrawlerConfig, Hunter, School, SchoolFish, Scripted, Sessile, currentAt,
  type Behavior, type Habitat, type HunterConfig, type SchoolConfig,
} from './behaviors';
import { Director } from './Director';
import { floorHeight, floorNormal, randomFloorAround, randomFloorInSector, stage, stageFloor } from '../scene/Terrain';
import { makeMaterial, OCC_MAX, shared } from '../scene/UnderwaterMaterial';
import { asset, hasAsset } from '../scene/Assets';
import { mulberry32 } from '../util/noise';
import { Bubbles } from '../scene/Bubbles';
import { addObstacle, bottomAt, escapeDir, finishObstacles, resetObstacles } from './Obstacles';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const D = Math.PI / 180;
/** beyond this nothing is visible through the murk, so it isn't drawn */
const VIEW_RANGE = 20;

interface Population {
  key: string;
  renderer: SpeciesRenderer;
  agents: Behavior[];
}

type Place = { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };

/**
 * Everything around the fixed viewpoint. The ring of scenery gives each heading its own character:
 *   N   the book on a flat rock, the octopus's boulder beyond, sand sloping away into the murk
 *   NE  a boulder reef with rockfish        E   a wooden wreck, a barrel, a bottle
 *   SE  a sand flat: sand dollars, moon snails, flounder      S   a pile of big boulders up a rising slope
 *   SW  more boulders and a log             W   an old anchor at the lip of a drop-off
 *   NW  a second log with sculpin and crabs          up: the surface, 30 ft overhead
 */
export class World implements Habitat {
  time = 0;
  /** the drawing buffer's height (px), and how much further in a zoom under way is going: set each frame */
  viewPx = 1000;
  zoomAhead = 1;
  private lodView: LodView = { frustum: new THREE.Frustum(), pxPerRad: 1 };
  /** obstacles on the floor: centre, radius, and the height of their top (for swimmers) */
  rocks: { pos: THREE.Vector3; r: number; top?: number }[] = [];
  pops = new Map<string, Population>();
  schools: School[] = [];
  director!: Director;
  visibleCount = 0;
  /** where the portfolio book lies before it's picked up */
  bookRest = { pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  /** things worth pointing the torch at when nothing is happening */
  landmarks: THREE.Vector3[] = [];
  /** where the octopus lives, and which way it faces from there */
  den = new THREE.Vector3();
  denFacing = new THREE.Vector3();
  private herringGrid = new Grid<SchoolFish>(2.5);
  private salmonGrid = new Grid<SchoolFish>(4);
  private respawnQueue: { agent: Agent; at: number }[] = [];
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private group = new THREE.Group();
  private surfaces: THREE.Mesh[] = [];
  private surfaceRay = new THREE.Raycaster();

  /** exhaled air: the sea lion in the opening, a burst when it bolts */
  bubbles = new Bubbles();

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.group.name = 'life';
    scene.add(this.group);
    scene.add(this.bubbles.points);
  }

  // ---------------------------------------------------------------- setup

  private pop(key: string, capacity: number): Population | null {
    if (!hasSpecies(key)) return null;
    let p = this.pops.get(key);
    if (!p) {
      const r = new SpeciesRenderer(SPECIES[key], capacity);
      this.group.add(...r.meshes);
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

  populate(view: () => { yaw: number; pitch: number }) {
    const s = stage();
    this.buildScenery();
    resetObstacles(s.cam);
    for (const m of this.surfaces) addObstacle(m.geometry, m.matrix);
    finishObstacles();
    this.buildFixedLife();
    this.buildFish();
    this.buildBenthos();
    this.buildScriptedPools();
    this.director = new Director(this, view);
  }

  private scanInstances(key: string, places: Place[], roughness: number, tint?: number) {
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

  private bounds(key: string) {
    const g = asset('scan:' + key).geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox!;
  }

  /**
   * Settle a placed piece onto the terrain: its bottom band of vertices is compared with the floor under
   * each one, and the piece is lowered (or raised) until nearly all of that band is under the sediment,
   * then pushed in a little more. On a slope that buries the uphill side rather than leaving the
   * downhill side hanging in the water.
   */
  private ground(key: string, pl: Place, bury = 0.08) {
    const g = asset('scan:' + key).geometry;
    const bb = this.bounds(key);
    const h = bb.max.y - bb.min.y;
    const m = new THREE.Matrix4().compose(pl.p, pl.q, pl.s);
    const pos = g.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 2000));
    const gaps: number[] = [];
    for (let i = 0; i < pos.count; i += step) {
      if (pos.getY(i) > bb.min.y + h * 0.15) continue;
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      gaps.push(_v.y - floorHeight(_v.x, _v.z));
    }
    if (!gaps.length) return;
    gaps.sort((a, b) => a - b);
    pl.p.y -= gaps[Math.floor(gaps.length * 0.92)] + bury * h * pl.s.y;
  }

  /** Register a placed piece as an obstacle (approximated by circles along its long axis). */
  private obstacle(key: string, pl: Place, radiusScale = 0.8) {
    const bb = this.bounds(key);
    const sx = (bb.max.x - bb.min.x) * pl.s.x;
    const sz = (bb.max.z - bb.min.z) * pl.s.z;
    const top = pl.p.y + bb.max.y * pl.s.y;
    const long = Math.max(sx, sz);
    const short = Math.min(sx, sz);
    const axis = new THREE.Vector3(sx >= sz ? 1 : 0, 0, sx >= sz ? 0 : 1).applyQuaternion(pl.q).setY(0).normalize();
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const centre = new THREE.Vector3(cx * pl.s.x, 0, cz * pl.s.z).applyQuaternion(pl.q).add(pl.p);
    const r = short * 0.5 * radiusScale;
    const n = Math.max(1, Math.round(long / Math.max(short, 0.3)));
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (long - short);
      this.rocks.push({ pos: centre.clone().addScaledVector(axis, t), r: Math.max(r, 0.08), top });
    }
  }

  /** Top of a placed scan at x,z (ray cast straight down), or false. */
  private topAt(proxies: THREE.Mesh[], x: number, z: number, out: THREE.Vector3, normal?: THREE.Vector3): boolean {
    this.surfaceRay.set(_v.set(x, 50, z), _v2.set(0, -1, 0));
    const hit = this.surfaceRay.intersectObjects(proxies, false)[0];
    if (!hit) return false;
    out.copy(hit.point);
    if (normal && hit.face) normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    return true;
  }

  private buildScenery() {
    const rnd = mulberry32(42);
    const s = stage();
    const q = (yaw: number, tiltX = 0, tiltZ = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ));
    /** rotation for a piece whose long (x) axis should run across the line of sight at heading h */
    const across = (h: number) => -h;

    // ---- boulders: the big scanned boulder plus three rounded rocks from a scanned set
    const kinds = ['rock_boulder', 'rockset_0', 'rockset_1', 'rockset_2'].filter((k) => hasAsset('scan:' + k));
    const rockPlaces = new Map<string, Place[]>();
    let turn = 0;
    const boulder = (p: THREE.Vector3, size: number, kind = kinds[turn++ % kinds.length]) => {
      if (!kind) return null;
      const bb = this.bounds(kind);
      const foot = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      const k = size / foot;
      const pl: Place = {
        p,
        q: q(rnd() * Math.PI * 2, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2),
        s: new THREE.Vector3(k * (0.85 + rnd() * 0.3), k * (0.75 + rnd() * 0.45), k * (0.85 + rnd() * 0.3)),
      };
      this.ground(kind, pl, 0.1);
      if (!rockPlaces.has(kind)) rockPlaces.set(kind, []);
      rockPlaces.get(kind)!.push(pl);
      this.obstacle(kind, pl);
      return pl;
    };
    // N: a big boulder behind the book, and a few rocks framing the view
    boulder(stageFloor(24 * D, 5.8), 2.2, 'rock_boulder');
    boulder(stageFloor(-30 * D, 4.2), 1.3);
    boulder(stageFloor(-14 * D, 7.5), 1.8);
    boulder(stageFloor(40 * D, 3.4), 0.8);
    // NE: the reef
    for (let i = 0; i < 9; i++) boulder(randomFloorInSector(rnd, 50 * D, 16 * D, 3, 7), 0.8 + rnd() * 1.5);
    // S: the octopus's crevice, a narrow gap between two boulders at the foot of the pile. Its front is
    // kept clear so the gap can be seen from the camera, if you know to look.
    const crevA = 172 * D;
    const crevB = 189 * D;
    const crevDist = 4.4;
    boulder(stageFloor(crevA, crevDist), 1.45, 'rock_boulder');
    boulder(stageFloor(crevB, crevDist + 0.2), 1.35, 'rockset_1');
    const crev = stageFloor(180.5 * D, crevDist + 0.95);
    const clearOfCrevice = (p: THREE.Vector3) => {
      const d = Math.hypot(p.x - s.cam.x, p.z - s.cam.z);
      let off = Math.atan2(p.x - s.cam.x, -(p.z - s.cam.z)) - 180 * D;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      return !(Math.abs(off) < 14 * D && d < crevDist + 1.4) && p.distanceTo(crev) > 1.3;
    };
    // S: a pile of big boulders up the rising slope, rubble at its foot; SW: more of it; W: a few
    for (let i = 0; i < 7; i++) boulder(randomFloorInSector(rnd, 182 * D, 26 * D, 6.5, 9.5), 2.4 + rnd() * 1.4);
    for (let i = 0; i < 10; i++) {
      const p = randomFloorInSector(rnd, 180 * D, 34 * D, 3.8, 6.5);
      const size = 0.7 + rnd() * 1.3;
      if (clearOfCrevice(p)) boulder(p, size);
    }
    for (let i = 0; i < 5; i++) boulder(randomFloorInSector(rnd, 228 * D, 16 * D, 4.5, 8), 1.2 + rnd() * 1.6);
    for (let i = 0; i < 3; i++) boulder(randomFloorInSector(rnd, 255 * D, 12 * D, 4, 7), 0.7 + rnd() * 1.0);
    // everywhere, far off: shapes in the murk so no direction is empty
    for (let i = 0; i < 14; i++) boulder(randomFloorAround(rnd, 11, 17), 1.4 + rnd() * 2);
    // the octopus sits back in the gap, facing out, so the rocks either side hide most of it
    this.den.copy(crev);
    this.den.y = floorHeight(crev.x, crev.z);
    this.denFacing.subVectors(s.cam, crev).setY(0).normalize();
    for (const [kind, pl] of rockPlaces) {
      this.surfaces.push(...this.scanInstances(kind, pl, 0.92, kind === 'rock_boulder' ? undefined : 0x9a9a92));
    }

    // ---- N: the book's rock. The big boulder, just in front of the camera and tall enough that the book
    // lies a little below the middle of the opening view, tipped toward the diver so its cover reads.
    // The opening shot looks at it from half a metre, so it's a high-resolution scan (Poly Haven's
    // boulder_01, scaled evenly), falling back to the boulder used elsewhere.
    const heroKey = hasAsset('scan:hero_rock') ? 'hero_rock' : hasAsset('scan:rock_boulder') ? 'rock_boulder' : null;
    if (heroKey) {
      const bb = this.bounds(heroKey);
      const at = stageFloor(2 * D, 1.8);
      const topY = s.cam.y - 0.16;
      const sy = (topY - at.y + 0.12) / (bb.max.y - bb.min.y);
      const k = heroKey === 'hero_rock' ? sy : 1.25 / Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      // long side across the line of sight
      const pl: Place = { p: at.clone(), q: q(heroKey === 'hero_rock' ? across(2 * D) + Math.PI / 2 : -0.2), s: new THREE.Vector3(k, sy, k * 0.9) };
      pl.p.y = topY - bb.max.y * sy;
      const proxies = this.scanInstances(heroKey, [pl], 0.9, heroKey === 'hero_rock' ? 0x8f968c : 0x8e8c84);
      this.surfaces.push(...proxies);
      this.obstacle(heroKey, pl);
      // rest it on the rock just in front of the summit, cover tilted toward the camera
      const toCam = new THREE.Vector3().subVectors(s.cam, at).setY(0).normalize();
      const c = at.clone().addScaledVector(toCam, 0.08);
      if (!this.topAt(proxies, c.x, c.z, this.bookRest.pos)) this.bookRest.pos.set(c.x, topY, c.z);
      const side = new THREE.Vector3(0, 1, 0).cross(toCam).normalize();
      const n = this.bookRest.up.set(0, 1, 0).applyAxisAngle(side, 0.5);
      // lift it until no part of the rock pokes through the tilted cover
      let lift = 0;
      const b = this.bookRest.pos;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (const r of [0.08, 0.17]) {
          const ox = Math.cos(a) * r;
          const oz = Math.sin(a) * r;
          if (!this.topAt(proxies, b.x + ox, b.z + oz, _v)) continue;
          const plane = b.y - (n.x * ox + n.z * oz) / n.y;
          lift = Math.max(lift, _v.y - plane);
        }
      }
      b.y += lift + 0.01;
    } else {
      stageFloor(0, 2.2, this.bookRest.pos);
    }

    // ---- set pieces
    // scans shot in daylight on land read bleached down here: `tint` pulls them into the water's palette
    const piece = (key: string, pl: Place, obstacle = true, roughness = 0.9, tint?: number, bury = 0.04) => {
      if (!hasAsset('scan:' + key)) return null;
      this.ground(key, pl, bury);
      const proxies = this.scanInstances(key, [pl], roughness, tint);
      if (obstacle) this.obstacle(key, pl, 0.7);
      this.surfaces.push(...proxies);
      return proxies;
    };
    // E: the wreck lying at an angle across the view, half sunk in the silt
    const wreckAt = stageFloor(98 * D, 5.6);
    this.landmarks.push(wreckAt.clone().add(new THREE.Vector3(0, 0.9, 0)));
    piece('wreck', { p: wreckAt, q: q(across(98 * D) + 0.5, 0.03, -0.12), s: new THREE.Vector3(1, 1, 1) }, true, 0.9, 0xb0a890, 0.12);
    piece('barrel', { p: stageFloor(78 * D, 3.9), q: q(1.1, 1.45, 0.2), s: new THREE.Vector3(1, 1, 1) }, true, 0.8, 0x8a7a6c);
    // W: the anchor, lying on its side where the floor falls away
    this.landmarks.push(stageFloor(268 * D, 3.2).add(new THREE.Vector3(0, 0.2, 0)));
    this.landmarks.push(stageFloor(50 * D, 5).add(new THREE.Vector3(0, 0.6, 0)));   // the reef
    this.landmarks.push(stageFloor(140 * D, 3.5));                                   // the sand-dollar bed
    this.landmarks.push(stageFloor(182 * D, 7).add(new THREE.Vector3(0, 1.2, 0)));  // the boulder pile
    this.landmarks.push(stageFloor(206 * D, 3.9), stageFloor(322 * D, 4.2));         // the driftwood
    piece('anchor', { p: stageFloor(268 * D, 3.2), q: q(0.4, 0, 0.08), s: new THREE.Vector3(1.2, 1.2, 1.2) }, true, 0.75, 0x7a6558, 0.1);
    // SW and NW: two big pieces of waterlogged driftwood, the kind every Puget Sound beach is piled with
    const wood = hasAsset('scan:driftwood') ? 'driftwood' : hasAsset('scan:log') ? 'log' : null;
    if (wood) {
      const places: Place[] = [
        { p: stageFloor(206 * D, 3.9), q: q(across(206 * D) + 0.4, 0, 0.03), s: new THREE.Vector3(1, 1, 1) },
        { p: stageFloor(322 * D, 4.2), q: q(across(322 * D) - 0.5, 0, -0.03), s: new THREE.Vector3(0.85, 0.85, 0.85) },
      ];
      for (const pl of places) this.ground(wood, pl, 0.18);
      this.surfaces.push(...this.scanInstances(wood, places, 0.95, 0x7d7a68));
      for (const pl of places) this.obstacle(wood, pl, 0.8);
    }
    // everywhere: empty shells lying about, some upside down, half sunk in the silt
    if (hasAsset('scan:scallop')) {
      const places: Place[] = [];
      for (let i = 0; i < 90; i++) {
        const p = randomFloorAround(rnd, 1.2, 10);
        p.y -= 0.004;
        const k = 0.5 + rnd() * 0.6;
        places.push({ p, q: q(rnd() * Math.PI * 2, (rnd() < 0.35 ? Math.PI : 0) + (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3), s: new THREE.Vector3(k, k, k) });
      }
      this.scanInstances('scallop', places, 0.6);
    }
  }

  /** Point on the top surface of a random rock or prop (with its normal), within reach, or false. */
  private surfacePoint(rnd: () => number, out: THREE.Vector3, normal: THREE.Vector3): boolean {
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
    if (normal.y < 0.4) return false; // too steep to hold on
    if (hit.point.distanceTo(stage().cam) > 11 || hit.point.distanceTo(this.bookRest.pos) < 0.5) return false;
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
        if (_v.distanceTo(this.bookRest.pos) < 0.45) continue;
        if (up.lengthSq() === 0) floorNormal(_v.x, _v.z, up);
        const a = new Sessile(key, { maxSpeed: 0, maxForce: 0, cruise: 0, size }, _v, up, rnd() * Math.PI * 2, doing);
        this.addAgent(key, a);
        a.pos.y -= 0.008; // settle into the silt so nothing hovers
        made++;
      }
    };
    const sector = (yaw: number, spread: number, dMin: number, dMax: number) => (p: THREE.Vector3) => { randomFloorInSector(rnd, yaw * D, spread * D, dMin, dMax, p); return true; };
    const onRockOr = (chance: number, fallback: (p: THREE.Vector3) => boolean) => (p: THREE.Vector3, n: THREE.Vector3) =>
      rnd() < chance ? this.surfacePoint(rnd, p, n) : fallback(p);
    sessile('batstar', 16, onRockOr(0.35, (p) => { randomFloorAround(rnd, 1.6, 7, p); return true; }), 'grazing on film and detritus', 0.2);
    sessile('sunflowerstar', 3, sector(-12, 30, 2.2, 4.5), 'hunting urchins, slowly', 0.7);
    sessile('urchin', 22, onRockOr(0.55, sector(40, 40, 3, 8)), 'grazing drift kelp', 0.12);
    sessile('scallop', 10, sector(300, 40, 2.4, 6), 'filter feeding, eyes along its mantle', 0.12);
    // SE: the sand flat
    sessile('sanddollar', 60, sector(140, 22, 1.8, 5.5), 'half-buried, filtering the current', 0.08);
    sessile('moonsnail', 7, sector(128, 24, 1.8, 5), 'ploughing through the sand for clams', 0.1);
    // sand dollars stand up at an angle in the sediment in dense beds
    for (const a of this.pops.get('sanddollar')?.agents ?? []) {
      a.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3 + Math.random() * 0.6));
      a.pos.y -= 0.02;
    }
  }

  private buildFish() {
    const herringCfg: SchoolConfig = { neighbor: 1.6, separation: 0.45, cohesion: 0.9, alignment: 1.3, sepWeight: 0.9, fleeRadius: 5, predators: ['sealion', 'porpoise', 'dogfish', 'orca'], homeAbove: [4, 7] };
    const salmonCfg: SchoolConfig = { neighbor: 4, separation: 1.1, cohesion: 0.6, alignment: 1.0, sepWeight: 0.8, fleeRadius: 8, predators: ['orca', 'sealion'], homeAbove: [3, 6] };
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
    // copper rockfish hold station on the NE reef; black rockfish hang over the wreck and the reef
    const rnd = mulberry32(21);
    const fish = (key: string, n: number, lo: number, hi: number, idle: string, where: () => THREE.Vector3) => {
      if (!this.pop(key, n)) return;
      for (let i = 0; i < n; i++) {
        const f = new BenthicFish(key, { maxSpeed: 1.6, maxForce: 3, cruise: 0.35, turnRate: 3, clearance: 0.3, size: 0.45 }, ['prawn'], { idle, hunt: 'snapping at a prawn', eat: 'swallowing' }, [lo, hi]);
        f.home.copy(where());
        f.home.y = bottomAt(f.home.x, f.home.z) + lo + rnd() * (hi - lo);
        f.pos.copy(f.home);
        f.goal.copy(f.home);
        this.addAgent(key, f);
      }
    };
    fish('rockfish', 6, 0.4, 1.3, 'hovering by its rock', () => (rnd() < 0.7 ? randomFloorInSector(rnd, 48 * D, 18 * D, 3.5, 8) : randomFloorInSector(rnd, 170 * D, 30 * D, 5, 8)));
    fish('blackrockfish', 10, 1.4, 3.6, 'hanging in the water column', () => (rnd() < 0.55 ? randomFloorInSector(rnd, 96 * D, 14 * D, 4.5, 7.5) : randomFloorInSector(rnd, 50 * D, 20 * D, 3.5, 7)));
    // a few small sharks patrolling low over the bottom
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
    const crawl = (key: string, n: number, speed: number, bury: boolean, cfg: Partial<CrawlerConfig>, size: number, yaw: number, spread: number, dMin = 1.8, dMax = 7) => {
      if (!this.pop(key, n)) return;
      for (let i = 0; i < n; i++) {
        const c = new Crab(key, { maxSpeed: speed * 2.2, maxForce: 1, cruise: speed, size }, bury, cfg);
        randomFloorInSector(rnd, yaw * D, spread * D, dMin, dMax, c.pos);
        c.home.copy(c.pos);
        c.goal.copy(c.pos);
        this.addAgent(key, c);
      }
    };
    const crab = { threats: ['octopus', 'sealion'], threatRadius: 2.5, roam: 2.5 };
    crawl('dungeness', 5, 0.3, true, crab, 0.2, 200, 60);
    crawl('redrock', 3, 0.25, false, crab, 0.2, 170, 30);
    crawl('kelpcrab', 2, 0.18, false, { ...crab, facing: 'forward' }, 0.15, 320, 20);
    crawl('decorator', 3, 0.12, false, { ...crab, facing: 'forward', roam: 1.5 }, 0.12, 40, 30);
    crawl('prawn', 10, 0.22, false, {
      facing: 'forward', fleeBackward: true, threats: ['octopus', 'rockfish', 'blackrockfish', 'sculpin', 'dogfish'], threatRadius: 1.4,
      roam: 1.8, walkChance: 0.5, verbs: { idle: 'picking at the bottom', walk: 'walking on its toes', flee: 'tail-flipping away', bury: '' },
    }, 0.2, 60, 40);
    crawl('flounder', 3, 0.45, true, {
      facing: 'forward', threats: ['sealion', 'octopus', 'dogfish'], threatRadius: 2, roam: 3, walkChance: 0.15, lift: 0.08,
      verbs: { idle: 'lying flat, watching', walk: 'gliding over the sand', flee: 'bolting in a cloud of silt', bury: 'half-buried in the sand' },
    }, 0.45, 140, 22, 2.5, 7);
    crawl('sculpin', 4, 0.3, false, {
      facing: 'forward', threats: ['sealion', 'octopus', 'dogfish'], threatRadius: 1.5, roam: 1.2, walkChance: 0.12, lift: 0.04,
      verbs: { idle: 'sitting motionless, camouflaged', walk: 'hopping to a new spot', flee: 'darting off', bury: '' },
    }, 0.3, 320, 40);
    crawl('cucumber', 4, 0.02, false, {
      facing: 'forward', threats: [], roam: 0.8, walkChance: 0.7,
      verbs: { idle: 'sifting detritus', walk: 'creeping along', flee: '', bury: '' },
    }, 0.3, 150, 60, 2.5, 7);
  }

  /** Visitors driven by the director: a pool of scripted bodies per species, hidden until used.
   *  Called again once the late-loading visitors arrive; species already pooled are left alone. */
  buildScriptedPools() {
    const pools: [string, number, ConstructorParameters<typeof Scripted>[1]][] = [
      ['sealion', 2, { maxSpeed: 4, maxForce: 3.2, cruise: 1.5, turnRate: 2.4, clearance: 0.8, bankAmount: 0.8, size: 1.9 }],
      ['orca', 5, { maxSpeed: 4.5, maxForce: 2.2, cruise: 2.6, turnRate: 0.8, clearance: 3, bankAmount: 0.6, size: 7 }],
      ['porpoise', 3, { maxSpeed: 5, maxForce: 5, cruise: 3.2, turnRate: 2, clearance: 1.5, bankAmount: 1, size: 1.6 }],
      ['humpback', 1, { maxSpeed: 2.5, maxForce: 0.8, cruise: 1.6, turnRate: 0.3, clearance: 4, bankAmount: 0.3, size: 14 }],
      ['octopus', 1, { maxSpeed: 0.6, maxForce: 1, cruise: 0.12, size: 1.5 }],
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
        randomWaterPoint(1, 4, 12, 16, agent.pos);
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
    this.bubbles.update(dt, t, window.innerHeight, this.camera.fov);
    for (const p of this.pops.values()) {
      for (const a of p.agents) {
        if (!a.alive) continue;
        a.update(dt, this);
        // a finished visitor has swum out of sight: park it until the director needs it again
        if (a instanceof Scripted && a.done) a.alive = false;
      }
    }
    this.separate();

    // push to GPU + count what's in view
    const camPos = this.camera.position;
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    // what's drawn: in view or near enough to throw a torch shadow into it, each at the detail it needs
    const lv = this.lodView;
    lv.frustum.copy(this.frustum);
    for (const pl of lv.frustum.planes) pl.constant += 2;
    lv.pxPerRad = (this.viewPx / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))) * this.zoomAhead;
    let vis = 0;
    for (const p of this.pops.values()) {
      p.renderer.sync(dt, camPos, VIEW_RANGE, lv);
      for (const a of p.agents) {
        if (a.alive && a.pos.distanceToSquared(camPos) < 11 * 11 && this.frustum.containsPoint(a.pos)) vis++;
      }
    }
    this.visibleCount = vis;
    this.updateOccluders(camPos);
  }

  // ---------------------------------------------------------------- collisions

  private bodyGrid = new Map<number, Agent[]>();

  /**
   * Soft collisions: overlapping bodies are pushed apart, and swimmers are pushed out of rocks and props.
   * Scripted visitors and fixed life don't give way; everything else does.
   */
  private separate() {
    const grid = this.bodyGrid;
    grid.clear();
    const C = 1.6;
    const bodies: Agent[] = [];
    for (const p of this.pops.values()) {
      for (const a of p.agents) {
        if (!a.alive) continue;
        bodies.push(a);
        const k = (Math.floor(a.pos.x / C) + 512) * 1031 + (Math.floor(a.pos.z / C) + 512);
        let c = grid.get(k);
        if (!c) grid.set(k, (c = []));
        c.push(a);
      }
    }
    const radius = (a: Agent) => Math.max(0.04, (a.opts.size || 0.3) * a.scale * 0.32);
    const fixed = (a: Agent) => a instanceof Sessile || a instanceof Scripted;
    const floorDweller = (a: Agent) => a instanceof Crab || a instanceof Sessile;
    for (const a of bodies) {
      if (fixed(a)) continue;
      const ra = radius(a);
      const cx = Math.floor(a.pos.x / C);
      const cz = Math.floor(a.pos.z / C);
      // big visitors can reach further than one cell
      for (let x = cx - 2; x <= cx + 2; x++) {
        for (let z = cz - 2; z <= cz + 2; z++) {
          const cell = grid.get((x + 512) * 1031 + (z + 512));
          if (!cell) continue;
          for (const b of cell) {
            if (b === a) continue;
            // schooling fish sort themselves out; a herring only avoids other things
            if (a instanceof SchoolFish && b instanceof SchoolFish && a.school === b.school) continue;
            const flat = floorDweller(a) && floorDweller(b);
            _v.subVectors(a.pos, b.pos);
            if (flat) _v.y = 0;
            const d = _v.length();
            const min = ra + radius(b);
            if (d >= min || d < 1e-5) continue;
            // share the correction with a movable partner (it gets its own half from its side)
            const share = fixed(b) ? 1 : 0.5;
            a.pos.addScaledVector(_v.multiplyScalar(1 / d), (min - d) * share);
          }
        }
      }
      // swimmers out of rocks and props (crawlers already steer round them). Swimmers normally rise over
      // them on their own (the height map counts as floor); anything that still ends up inside slides
      // out sideways a little each frame and stops pushing inward, rather than jumping to the top.
      if (!(a instanceof Crab) && !(a instanceof Scripted && (a.crawl || a.settling))) {
        if (escapeDir(a.pos, ra * 0.5, _v)) {
          if (_v.y > 0.5) a.pos.y += 0.01;
          else {
            a.pos.addScaledVector(_v, 0.025);
            const into = a.vel.dot(_v);
            if (into < 0) a.vel.addScaledVector(_v, -into);
          }
        }
      }
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
      urchin: [0.13, 0.5], batstar: [0.18, 0.35], sunflowerstar: [0.45, 0.4], scallop: [0.1, 0.4], moonsnail: [0.1, 0.45],
      flounder: [0.3, 0.45], sculpin: [0.2, 0.5], prawn: [0.1, 0.4], cucumber: [0.16, 0.5],
    };
    const hoverRules: Record<string, [number, number]> = { rockfish: [0.3, 0.45], blackrockfish: [0.3, 0.45], sealion: [0.8, 0.5], dogfish: [0.5, 0.45] };
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

  // ---------------------------------------------------------------- attention, picking

  /** Where the diver's attention is: the director's current visitor if it's in view and near. */
  hero(): Agent | null {
    const h = this.director.hero;
    if (!h || !h.alive || h.pos.distanceTo(this.camera.position) > 13) return null;
    this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    return this.frustum.containsPoint(h.pos) ? h : null;
  }

  /**
   * The animal under a screen point (CSS px), or null. Screen-space: every candidate is projected and
   * the closest to the pointer within its projected size wins, which is forgiving for small animals.
   */
  pick(px: number, py: number): { key: string; agent: Agent } | null {
    const cam = this.camera;
    const focal = (window.innerHeight / 2) / Math.tan((cam.fov * Math.PI) / 360);
    let best: { key: string; agent: Agent; d: number } | null = null;
    for (const p of this.pops.values()) {
      for (const a of p.agents) {
        if (!a.alive) continue;
        _v.copy(a.pos).applyMatrix4(cam.matrixWorldInverse);
        const depth = -_v.z;
        if (depth < 0.4 || depth > 14) continue;
        _v2.copy(a.pos).project(cam);
        const sx = (_v2.x + 1) / 2 * window.innerWidth;
        const sy = (1 - _v2.y) / 2 * window.innerHeight;
        const size = (a.opts.size || 0.5) * a.scale;
        const radiusPx = Math.max(16, (size * 0.5 * focal) / depth);
        const dist = Math.hypot(sx - px, sy - py);
        if (dist > radiusPx + 8) continue;
        const score = dist / radiusPx + depth * 0.02;
        if (!best || score < best.d) best = { key: p.key, agent: a, d: score };
      }
    }
    return best ? { key: best.key, agent: best.agent } : null;
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
