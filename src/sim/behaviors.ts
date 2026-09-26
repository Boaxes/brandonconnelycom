import * as THREE from 'three';
import { Agent, randomFloorPoint, randomWaterPoint, type AgentOpts } from './Agent';
import { floorHeight, floorNormal, stage, stageWater, yawOf, WORLD } from '../scene/Terrain';
import { bottomAt } from './Obstacles';
import { noise2 } from '../util/noise';

/** What behaviors can ask of the world. Implemented by World. */
export interface Habitat {
  time: number;
  /** nearest live prey of any of the given species within radius */
  preyNear(keys: string[], pos: THREE.Vector3, radius: number): Agent | null;
  /** prey was caught: respawn it elsewhere */
  eat(prey: Agent): void;
  /** positions of predators of the given kinds within radius */
  threatsNear(keys: string[], pos: THREE.Vector3, radius: number, out: Agent[]): Agent[];
  /** rocks as (centre, radius) for benthic navigation */
  rocks: { pos: THREE.Vector3; r: number }[];
  current(pos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _threats: Agent[] = [];

export interface Behavior extends Agent {
  update(dt: number, h: Habitat): void;
  key: string;
}

// ------------------------------------------------------------------ schooling fish

export interface SchoolConfig {
  neighbor: number;
  separation: number;
  cohesion: number;
  alignment: number;
  sepWeight: number;
  fleeRadius: number;
  predators: string[];
  homeAbove: [number, number]; // preferred height band above floor
}

export class School {
  anchor = new THREE.Vector3();
  target = new THREE.Vector3();
  members: SchoolFish[] = [];
  panic = 0;
  /** set by the director: the school's anchor follows these points in turn, at `routeSpeed` */
  route: THREE.Vector3[] = [];
  routeSpeed = 2;
  constructor(public cfg: SchoolConfig, public key: string) {
    randomWaterPoint(cfg.homeAbove[0], cfg.homeAbove[1], 16, 24, this.anchor);
    this.target.copy(this.anchor);
  }
  update(dt: number, t: number) {
    let speed = 0.6;
    if (this.route.length) {
      this.target.copy(this.route[0]);
      speed = this.routeSpeed;
      if (this.anchor.distanceTo(this.target) < 2) this.route.shift();
    } else if (this.target.distanceTo(this.anchor) < 4 || Math.random() < dt * 0.02) {
      // idle: loiter out in the murk beyond the frame until the director sends it past
      randomWaterPoint(this.cfg.homeAbove[0], this.cfg.homeAbove[1], 16, 24, this.target);
    }
    _a.subVectors(this.target, this.anchor);
    const d = _a.length();
    if (d > 0.01) this.anchor.addScaledVector(_a, Math.min(1, (speed * dt) / d));
    this.anchor.y += Math.sin(t * 0.2 + this.anchor.x) * dt * 0.15;
    this.panic = Math.max(0, this.panic - dt * 0.5);
  }
}

export class SchoolFish extends Agent implements Behavior {
  neighbors: SchoolFish[] = [];
  constructor(public key: string, public school: School, opts: AgentOpts) {
    super(opts);
    this.pos.copy(school.anchor).add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6));
    this.vel.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(opts.cruise);
  }
  update(dt: number, h: Habitat) {
    const cfg = this.school.cfg;
    // boids from neighbours (filled by World via grid)
    let n = 0;
    _a.set(0, 0, 0); // cohesion
    _b.set(0, 0, 0); // alignment
    _c.set(0, 0, 0); // separation
    for (const o of this.neighbors) {
      if (o === this) continue;
      const d = o.pos.distanceTo(this.pos);
      if (d > cfg.neighbor) continue;
      n++;
      _a.add(o.pos);
      _b.add(o.vel);
      if (d < cfg.separation && d > 1e-4) {
        _c.addScaledVector(new THREE.Vector3().subVectors(this.pos, o.pos), (cfg.separation - d) / (d * cfg.separation));
      }
    }
    if (n > 0) {
      _a.multiplyScalar(1 / n);
      this.seek(_a, cfg.cohesion);
      _b.multiplyScalar(1 / n).normalize().multiplyScalar(this.opts.cruise).sub(this.vel).multiplyScalar(cfg.alignment);
      this.acc.add(_b);
      this.acc.addScaledVector(_c, cfg.sepWeight * this.opts.maxForce);
    }
    // stay with the school anchor
    const da = this.pos.distanceTo(this.school.anchor);
    this.seek(this.school.anchor, da > 10 ? 0.9 : 0.25);
    // predators
    const threats = h.threatsNear(cfg.predators, this.pos, cfg.fleeRadius, _threats);
    let fleeing = false;
    for (const tt of threats) {
      const d = tt.pos.distanceTo(this.pos);
      const w = 1.6 * (1 - d / cfg.fleeRadius) + 0.4;
      this.flee(tt.pos, w);
      fleeing = true;
    }
    if (fleeing) {
      this.school.panic = 1;
      this.doing = 'fleeing';
      this.state = 'flee';
    } else {
      this.doing = this.school.panic > 0 ? 'regrouping' : 'schooling';
      this.state = 'school';
    }
    this.keepSpeed(fleeing ? this.opts.maxSpeed : this.opts.cruise, fleeing ? 0.9 : 0.5);
    this.wander(0.35, h.time);
    this.contain(0.4, WORLD.surfaceY - 0.6);
    this.integrate(dt);
  }
}

// ------------------------------------------------------------------ hunters

export interface HunterConfig {
  prey: string[];
  huntRange: number;
  catchDist: number;
  airBreather: boolean;
  oxygen: [number, number];   // seconds between breaths
  restOnBottom?: boolean;
  cruiseAbove: [number, number];
  eatTime: number;
  verbs: { cruise: string; hunt: string; eat: string; breathe: string; rest: string };
}

export class Hunter extends Agent implements Behavior {
  target: Agent | null = null;
  goal = new THREE.Vector3();
  oxygen: number;
  hunger = Math.random() * 20;
  constructor(public key: string, public cfg: HunterConfig, opts: AgentOpts) {
    super(opts);
    randomWaterPoint(cfg.cruiseAbove[0], cfg.cruiseAbove[1], 4, 16, this.pos);
    randomWaterPoint(cfg.cruiseAbove[0], cfg.cruiseAbove[1], 4, 16, this.goal);
    this.oxygen = cfg.oxygen[0] + Math.random() * (cfg.oxygen[1] - cfg.oxygen[0]);
    this.vel.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(opts.cruise);
  }
  update(dt: number, h: Habitat) {
    const cfg = this.cfg;
    this.timer -= dt;
    this.hunger += dt;
    if (cfg.airBreather && this.state !== 'breathe') this.oxygen -= dt;

    switch (this.state) {
      case 'cruise': {
        this.doing = cfg.verbs.cruise;
        if (this.pos.distanceTo(this.goal) < 2) randomWaterPoint(cfg.cruiseAbove[0], cfg.cruiseAbove[1], 4, 16, this.goal);
        this.seek(this.goal, 0.6);
        this.wander(0.6, h.time);
        this.keepSpeed(this.opts.cruise, 0.5);
        if (cfg.airBreather && this.oxygen < 0) this.state = 'breathe';
        else if (this.hunger > 12) {
          const p = h.preyNear(cfg.prey, this.pos, cfg.huntRange);
          if (p) {
            this.target = p;
            this.state = 'hunt';
            this.timer = 14;
          }
        } else if (cfg.restOnBottom && Math.random() < dt * 0.01) {
          this.state = 'rest';
          randomFloorPoint(3, 12, this.goal);
          this.goal.y += 0.6;
          this.timer = 12 + Math.random() * 12;
        }
        break;
      }
      case 'hunt': {
        this.doing = cfg.verbs.hunt;
        const p = this.target;
        if (!p || !p.alive || this.timer < 0 || (cfg.airBreather && this.oxygen < -4)) {
          this.state = 'cruise';
          this.target = null;
          break;
        }
        // pursue: aim ahead of the prey
        _a.copy(p.pos).addScaledVector(p.vel, 0.4);
        this.seek(_a, 1.4, this.opts.maxSpeed);
        if (this.pos.distanceTo(p.pos) < cfg.catchDist * this.scale) {
          h.eat(p);
          this.hunger = 0;
          this.target = null;
          this.state = 'eat';
          this.timer = cfg.eatTime;
        }
        break;
      }
      case 'eat': {
        this.doing = cfg.verbs.eat;
        this.keepSpeed(this.opts.cruise * 0.5, 0.5);
        this.wander(0.5, h.time);
        if (this.timer < 0) this.state = 'cruise';
        break;
      }
      case 'breathe': {
        this.doing = cfg.verbs.breathe;
        _a.set(this.pos.x + this.forward.x * 6, WORLD.surfaceY - 0.15, this.pos.z + this.forward.z * 6);
        this.seek(_a, 1.2, this.opts.cruise);
        if (this.pos.y > WORLD.surfaceY - 0.9) {
          this.timer = this.timer < -100 ? this.timer : 0; // no-op guard
          this.oxygen += dt * 25;
          if (this.oxygen > cfg.oxygen[0] + Math.random() * (cfg.oxygen[1] - cfg.oxygen[0])) {
            this.state = 'cruise';
            randomWaterPoint(cfg.cruiseAbove[0], cfg.cruiseAbove[1], 4, 16, this.goal);
          }
        }
        break;
      }
      case 'rest': {
        this.doing = cfg.verbs.rest;
        this.arrive(this.goal, 4, 0.8);
        if (this.pos.distanceTo(this.goal) < 1.2) {
          this.vel.multiplyScalar(0.9);
        }
        if (this.timer < 0 || (cfg.airBreather && this.oxygen < 0)) {
          this.state = cfg.airBreather && this.oxygen < 0 ? 'breathe' : 'cruise';
        }
        break;
      }
    }
    const cam = stage().cam;
    if (this.pos.distanceTo(cam) < 2.2) this.flee(cam, 1.2);
    if (this.state === 'breathe') this.contain(0.5, WORLD.surfaceY + 1);
    else this.contain(0.5, WORLD.surfaceY - 0.6);
    this.integrate(dt);
    if (!cfg.airBreather) this.keepSwimming();
  }

  /**
   * Sharks can't stop: they need water moving over their gills. Keep a minimum forward speed along the
   * level, and never let them climb or dive steeper than about 25° (rising over a rock is a slope, not
   * a hover nose-up).
   */
  private keepSwimming() {
    const min = this.opts.cruise * 0.75;
    let hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs < min) {
      _a.set(this.forward.x, 0, this.forward.z);
      if (_a.lengthSq() < 1e-4) _a.set(Math.cos(this.phase), 0, Math.sin(this.phase));
      _a.normalize();
      if (hs > 1e-3) _a.lerp(_b.set(this.vel.x / hs, 0, this.vel.z / hs), 0.5).normalize();
      this.vel.x = _a.x * min;
      this.vel.z = _a.z * min;
      hs = min;
    }
    const maxVy = hs * 0.47;
    this.vel.y = THREE.MathUtils.clamp(this.vel.y, -maxVy, maxVy);
    this.forward.y = THREE.MathUtils.clamp(this.forward.y, -0.42, 0.42);
    this.forward.normalize();
  }
}

// ------------------------------------------------------------------ benthic fish (rockfish / lingcod)

export class BenthicFish extends Agent implements Behavior {
  /** only one fish comes up to the camera at a time */
  static inspecting: BenthicFish | null = null;
  static lastInspect = -30;
  home = new THREE.Vector3();
  goal = new THREE.Vector3();
  private looked = 0;
  constructor(public key: string, opts: AgentOpts, public prey: string[], public verbs: { idle: string; hunt: string; eat: string }, public hover: [number, number]) {
    super(opts);
    randomFloorPoint(3, 10, this.home);
    this.home.y += hover[0] + Math.random() * (hover[1] - hover[0]);
    this.pos.copy(this.home);
    this.goal.copy(this.home);
    this.timer = Math.random() * 5;
    this.vel.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(0.2);
  }
  /** Cut a visit to the camera short (something bigger is coming). */
  leave() {
    if (this.state !== 'inspect') return;
    this.state = 'cruise';
    this.looked = 0;
    BenthicFish.inspecting = null;
    this.goal.copy(this.home);
    this.timer = 6;
  }
  /**
   * Swim over to hang just in front of the diver for a few seconds. `viewYaw` is where the camera is
   * looking: the fish stops a little to the side of it (not dead centre, where the book is held).
   * False if it can't right now.
   */
  comeLook(viewYaw: number): boolean {
    if (BenthicFish.inspecting || this.pos.distanceTo(stage().cam) > 11) return false;
    BenthicFish.inspecting = this;
    this.state = 'inspect';
    this.timer = 16;
    this.looked = 0;
    const side = Math.sign(Math.sin(yawOf(this.pos) - viewYaw)) || 1;
    stageWater(viewYaw + side * (0.42 + Math.random() * 0.12), 1.8 + Math.random() * 0.6, stage().height - 0.35 + Math.random() * 0.3, this.goal);
    return true;
  }
  update(dt: number, h: Habitat) {
    this.timer -= dt;
    if (this.state === 'hunt') {
      const p = (this as unknown as { target?: Agent }).target;
      if (!p || !p.alive || this.timer < 0) {
        this.state = 'cruise';
      } else {
        this.doing = this.verbs.hunt;
        this.seek(p.pos, 1.5, this.opts.maxSpeed);
        if (this.pos.distanceTo(p.pos) < 0.5 * this.scale) {
          h.eat(p);
          this.state = 'eat';
          this.timer = 4;
        }
      }
    } else if (this.state === 'eat') {
      this.doing = this.verbs.eat;
      this.arrive(this.home, 3, 0.6);
      if (this.timer < 0) this.state = 'cruise';
    } else if (this.state === 'inspect') {
      // rockfish are curious: drift up to the diver, hang there looking, then drift back
      this.doing = 'coming over to look at you';
      const cam = stage().cam;
      const d = this.pos.distanceTo(this.goal);
      if (d > 0.35 && this.looked === 0) this.arrive(this.goal, 1.6, 0.9);
      else {
        this.looked += dt;
        this.vel.multiplyScalar(1 - Math.min(1, dt * 2));
      }
      if (this.looked > 0) {
        _a.subVectors(cam, this.pos).setY(0).normalize();
        this.forward.lerp(_a, Math.min(1, dt * 1.2)).normalize();
      }
      if (this.timer < 0 || this.looked > 4 + (this.id % 3)) {
        this.state = 'cruise';
        this.looked = 0;
        BenthicFish.inspecting = null;
        BenthicFish.lastInspect = h.time;
        this.goal.copy(this.home);
        this.timer = 6;
      }
    } else {
      this.doing = this.verbs.idle;
      if (this.timer < 0) {
        // pick a new hover spot near home
        this.goal.copy(this.home).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 3));
        this.goal.y = Math.max(this.goal.y, bottomAt(this.goal.x, this.goal.z) + this.hover[0]);
        this.timer = 3 + Math.random() * 6;
        if (this.prey.length && Math.random() < 0.35) {
          const p = h.preyNear(this.prey, this.pos, 2.5);
          if (p) {
            (this as unknown as { target?: Agent }).target = p;
            this.state = 'hunt';
            this.timer = 5;
          }
        }
      }
      this.arrive(this.goal, 2.5, 0.8);
      this.wander(0.25, h.time);
      // slow, sculling motion
      if (this.vel.length() < 0.15) this.speedMul = 0.45;
    }
    // don't swim into the lens
    const cam = stage().cam;
    if (this.state !== 'inspect' && this.pos.distanceTo(cam) < 1.6) this.flee(cam, 1.2);
    this.contain(0.3, WORLD.surfaceY - 2, 15);
    this.integrate(dt);
    // bottom fish hold a level posture even when nudging up or down
    this.forward.y *= 0.25;
    this.forward.normalize();
    this.orient(this.forward, new THREE.Vector3(0, 1, 0));
    this.speedMul = Math.max(0.4, this.speedMul);
  }
}

// ------------------------------------------------------------------ crabs

export interface CrawlerConfig {
  /** how the body faces its travel direction: crabs walk sideways, prawns reverse away from threats */
  facing: 'sideways' | 'forward';
  canBury: boolean;
  threats: string[];
  threatRadius: number;
  roam: number;           // metres per excursion
  walkChance: number;     // per decision
  lift: number;           // height of the body above the floor while moving (flatfish glide)
  fleeBackward?: boolean; // tail-flip away while still facing the threat
  verbs: { idle: string; walk: string; flee: string; bury: string };
}

const CRAB: CrawlerConfig = {
  facing: 'sideways', canBury: false, threats: ['octopus', 'sealion', 'lingcod'], threatRadius: 4.5,
  roam: 8, walkChance: 0.35, lift: 0,
  verbs: { idle: 'picking through the silt', walk: 'scuttling', flee: 'scuttling away', bury: 'buried in the sand' },
};

/** Anything that lives on the floor and walks, creeps or glides over it. */
export class Crab extends Agent implements Behavior {
  goal = new THREE.Vector3();
  /** excursions stay around here, so the foreground doesn't slowly empty */
  home = new THREE.Vector3();
  heading = Math.random() * Math.PI * 2;
  buried = 0;
  cfg: CrawlerConfig;
  private up = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private liftNow = 0;
  constructor(public key: string, opts: AgentOpts, canBury: boolean, cfg?: Partial<CrawlerConfig>) {
    super(opts);
    this.cfg = { ...CRAB, canBury, ...cfg };
    randomFloorPoint(2.5, 10, this.pos);
    this.goal.copy(this.pos);
    this.home.copy(this.pos);
    this.timer = Math.random() * 4;
    this.state = 'forage';
  }
  update(dt: number, h: Habitat) {
    const cfg = this.cfg;
    this.timer -= dt;
    let threat: Agent | null = null;
    if (cfg.threats.length) {
      const threats = h.threatsNear(cfg.threats, this.pos, cfg.threatRadius, _threats);
      threat = threats[0] ?? null;
    }
    if (threat && this.state !== 'flee') {
      this.state = 'flee';
      this.buried = 0;
      this.timer = 3;
      _a.subVectors(this.pos, threat.pos);
      _a.y = 0;
      this.goal.copy(this.pos).addScaledVector(_a.normalize(), 5);
    }
    let speed = 0;
    switch (this.state) {
      case 'forage':
        this.doing = cfg.verbs.idle;
        if (this.timer < 0) {
          const r = Math.random();
          if (r < cfg.walkChance) {
            this.state = 'walk';
            this.goal.copy(this.home).add(new THREE.Vector3((Math.random() - 0.5) * cfg.roam, 0, (Math.random() - 0.5) * cfg.roam));
            this.timer = 8 + cfg.roam;
          } else if (cfg.canBury && r < cfg.walkChance + 0.15) {
            this.state = 'bury';
            this.timer = 10 + Math.random() * 15;
          } else this.timer = 2 + Math.random() * 4;
        }
        break;
      case 'walk':
        this.doing = cfg.verbs.walk;
        speed = this.opts.cruise;
        if (this.pos.distanceTo(this.goal) < 0.4 || this.timer < 0) {
          this.state = 'forage';
          this.timer = 2 + Math.random() * 5;
        }
        break;
      case 'flee':
        this.doing = cfg.verbs.flee;
        speed = this.opts.maxSpeed;
        if (this.timer < 0) {
          this.state = 'forage';
          this.timer = 2;
        }
        break;
      case 'bury':
        this.doing = cfg.verbs.bury;
        this.buried = Math.min(1, this.buried + dt * 0.5);
        if (this.timer < 0) {
          this.state = 'forage';
          this.timer = 2;
        }
        break;
    }
    if (this.state !== 'bury') this.buried = Math.max(0, this.buried - dt * 1.5);
    if (speed > 0) {
      _a.subVectors(this.goal, this.pos);
      _a.y = 0;
      const d = _a.length();
      if (d > 0.05) {
        _a.multiplyScalar(1 / d);
        // rock avoidance
        for (const rk of h.rocks) {
          const dr = rk.pos.distanceTo(this.pos);
          if (dr < rk.r + 0.6) {
            _b.subVectors(this.pos, rk.pos).y = 0;
            _a.addScaledVector(_b.normalize(), (rk.r + 0.6 - dr) * 1.5);
          }
        }
        _a.normalize();
        this.pos.addScaledVector(_a, Math.min(d, speed * dt));
        const travel = Math.atan2(_a.z, _a.x);
        let face = travel + (cfg.facing === 'sideways' ? Math.PI / 2 : 0);
        if (cfg.fleeBackward && this.state === 'flee') face = travel + Math.PI;
        let diff = face - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * Math.min(1, dt * 4);
        this.speedMul = 2.2;
      }
    } else {
      this.speedMul = this.state === 'bury' ? 0.0 : 0.6;
    }
    // flatfish lift off the sand to glide, then settle
    this.liftNow += ((speed > 0 ? cfg.lift : 0) - this.liftNow) * Math.min(1, dt * 3);
    // keep on the floor, oriented to the slope
    const fy = floorHeight(this.pos.x, this.pos.z);
    this.pos.y = fy + 0.02 + this.liftNow - this.buried * 0.06 * this.scale;
    floorNormal(this.pos.x, this.pos.z, this.up);
    this.fwd.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    this.orient(this.fwd, this.up);
    this.vel.set(0, 0, 0);
  }
}

// ------------------------------------------------------------------ static life (stars, urchins, scallops)

export class Sessile extends Agent implements Behavior {
  constructor(public key: string, opts: AgentOpts, pos: THREE.Vector3, up: THREE.Vector3, yaw: number, doing: string) {
    super(opts);
    this.pos.copy(pos);
    _a.set(Math.cos(yaw), 0, Math.sin(yaw));
    this.orient(_a, up);
    this.doing = doing;
    this.state = 'sessile';
    this.speedMul = 0.7 + Math.random() * 0.6;
  }
  update() {
    /* nothing to do */
  }
}

// ------------------------------------------------------------------ scripted (director)

export interface Leg {
  to: THREE.Vector3;
  speed: number;          // m/s toward it
  hold?: number;          // seconds to linger on arrival
  face?: THREE.Vector3;   // while lingering, turn to look at this (the camera)
  doing?: string;
  radius?: number;        // arrival radius
  /** glide exactly onto the point for the last metre and stay put (a posed moment, e.g. behind a rock) */
  settle?: boolean;
}

/**
 * An animal on a route handed out by the director. It steers toward each leg's point in turn with the
 * ordinary steering physics, so the path stays fluid (banking, body bend) rather than rail-like.
 */
export class Scripted extends Agent implements Behavior {
  legs: Leg[] = [];
  crawl = false;   // stays on the floor (octopus)
  /** travels at the surface: body this far under it (m), rising and dipping gently as it breathes */
  surfaceRide: number | null = null;
  private ridePhase = Math.random() * Math.PI * 2;
  done = true;
  private holdT = 0;
  heading = 0;
  private up = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  constructor(public key: string, opts: AgentOpts) {
    super(opts);
    this.state = 'scripted';
    this.alive = false;
  }
  start(from: THREE.Vector3, legs: Leg[], doing = '') {
    this.pos.copy(from);
    this.surfaceRide = null;
    this.legs = legs;
    this.done = false;
    this.alive = true;
    this.holdT = 0;
    this.doing = doing || legs[0]?.doing || '';
    if (legs.length) {
      // placed straight onto a settle mark: start still, already facing what it's looking at
      const posed = !!legs[0].settle && legs[0].to.distanceTo(from) < 1e-3;
      _a.subVectors(posed && legs[0].face ? legs[0].face : legs[0].to, from).normalize();
      this.vel.copy(_a).multiplyScalar(posed ? 0 : legs[0].speed);
      this.forward.copy(_a);
      this.heading = Math.atan2(_a.z, _a.x);
    }
  }
  /** Replace the remaining route (interrupting any linger). */
  setLegs(legs: Leg[]) {
    this.legs = legs;
    this.holdT = 0;
  }
  /** gliding onto a settle point: collisions and floor-keeping leave it alone */
  get settling() {
    const leg = this.legs[0];
    return !!leg?.settle && this.pos.distanceTo(leg.to) < 1.2;
  }

  update(dt: number) {
    const leg = this.legs[0];
    if (leg?.settle && !this.crawl && this.pos.distanceTo(leg.to) < 1.2) {
      // posed: ease onto the mark and hold, turning to look at `face`
      if (leg.doing) this.doing = leg.doing;
      this.pos.lerp(leg.to, 1 - Math.exp(-dt * 1.6));
      this.vel.multiplyScalar(1 - Math.min(1, dt * 3));
      this.speedMul = 0.5;
      if (this.holdT <= 0 && leg.hold) this.holdT = leg.hold;
      if (this.holdT > 0) {
        this.holdT -= dt;
        if (this.holdT <= 0) { this.legs.shift(); return; }
      }
      if (leg.face) {
        _a.subVectors(leg.face, this.pos).normalize();
        this.forward.lerp(_a, Math.min(1, dt * 2)).normalize();
        this.orient(this.forward, _b.set(0, 1, 0));
      }
      this.bend *= 1 - Math.min(1, dt * 3);
      return;
    }
    if (!leg) {
      this.done = true;
      this.keepSpeed(this.opts.cruise, 0.3);
      if (!this.crawl) this.integrate(dt);
      return;
    }
    if (leg.doing) this.doing = leg.doing;
    const d = this.pos.distanceTo(leg.to);
    const r = leg.radius ?? Math.max(0.35, this.opts.size * 0.3);
    let speed = 0;
    if (this.holdT > 0) {
      // lingering: bleed off speed and hang there (drifting back only if it slid well off the spot)
      this.holdT -= dt;
      if (d > 1.2) this.arrive(leg.to, 1.5, 0.4);
      this.vel.multiplyScalar(1 - Math.min(1, dt * 2.5));
      if (this.holdT <= 0) this.legs.shift();
    } else if (d < r) {
      if (leg.hold) this.holdT = leg.hold;
      else this.legs.shift();
    } else {
      // ease into a linger point, keep pace otherwise
      speed = leg.hold ? Math.min(leg.speed, 0.25 + d * 0.5) : leg.speed;
      if (!this.crawl) this.seek(leg.to, 1, speed);
    }
    if (this.crawl) {
      if (speed > 0) {
        _a.subVectors(leg.to, this.pos).setY(0).normalize();
        this.pos.addScaledVector(_a, Math.min(d, speed * dt));
        let diff = Math.atan2(_a.z, _a.x) - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * Math.min(1, dt * 1.5);
        this.speedMul = 1.1;
      } else {
        this.speedMul = 0.35;
        // settled: turn slowly to face whatever it's watching
        if (this.holdT > 0 && leg.face) {
          _a.subVectors(leg.face, this.pos).setY(0).normalize();
          let diff = Math.atan2(_a.z, _a.x) - this.heading;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          this.heading += diff * Math.min(1, dt * 0.6);
        }
      }
      this.pos.y = floorHeight(this.pos.x, this.pos.z) + 0.03;
      floorNormal(this.pos.x, this.pos.z, this.up);
      this.fwd.set(Math.cos(this.heading), 0, Math.sin(this.heading));
      this.orient(this.fwd, this.up);
      this.vel.set(0, 0, 0);
      return;
    }
    // keep off the bottom
    const floor = bottomAt(this.pos.x, this.pos.z) + (this.opts.clearance ?? 0.5);
    if (this.pos.y < floor) this.acc.y += (floor - this.pos.y) * this.opts.maxForce;
    if (this.surfaceRide !== null) {
      // a slow roll up to the surface and down again, each animal on its own rhythm
      this.acc.y = 0;
      this.vel.y *= 0.9;
    }
    this.integrate(dt);
    if (this.surfaceRide !== null) {
      this.ridePhase += dt * 0.55;
      const want = WORLD.surfaceY - this.surfaceRide - Math.max(0, Math.sin(this.ridePhase)) * 0.45;
      this.pos.y += (want - this.pos.y) * Math.min(1, dt * 1.5);
    }
    if (this.holdT > 0) {
      // lingering: slow sculling, and turn to look at whatever it came to see
      this.speedMul = 0.55;
      if (leg.face) {
        _a.subVectors(leg.face, this.pos).normalize();
        _a.y *= 0.6;
        this.forward.lerp(_a.normalize(), Math.min(1, dt * 2.2)).normalize();
        this.orient(this.forward, _b.set(0, 1, 0));
        this.bend *= 1 - Math.min(1, dt * 3);
      }
    }
  }
}

/** Slow water movement field shared by jellies/particles. */
export function currentAt(p: THREE.Vector3, t: number, out: THREE.Vector3) {
  const s = 0.02;
  const a = noise2(p.x * s + t * 0.01, p.z * s) * Math.PI * 2;
  const mag = 0.12 + 0.08 * noise2(p.z * s * 2 + 5, t * 0.02);
  return out.set(Math.cos(a) * mag + 0.05, 0, Math.sin(a) * mag);
}
