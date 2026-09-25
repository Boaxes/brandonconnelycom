import * as THREE from 'three';
import { Agent, randomFloorPoint, randomWaterNearPath, type AgentOpts } from './Agent';
import { floorHeight, floorNormal, WORLD } from '../scene/Terrain';
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
  constructor(public cfg: SchoolConfig, public key: string) {
    randomWaterNearPath(10, cfg.homeAbove[0], cfg.homeAbove[1], this.anchor);
    this.target.copy(this.anchor);
  }
  update(dt: number, t: number) {
    // anchor slowly wanders, staying within reach of the camera loop
    if (this.target.distanceTo(this.anchor) < 4 || Math.random() < dt * 0.02) {
      randomWaterNearPath(10, this.cfg.homeAbove[0], this.cfg.homeAbove[1], this.target);
    }
    _a.subVectors(this.target, this.anchor);
    const d = _a.length();
    if (d > 0.01) this.anchor.addScaledVector(_a, Math.min(1, (0.6 * dt) / d));
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
    randomWaterNearPath(12, cfg.cruiseAbove[0], cfg.cruiseAbove[1], this.pos);
    randomWaterNearPath(12, cfg.cruiseAbove[0], cfg.cruiseAbove[1], this.goal);
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
        if (this.pos.distanceTo(this.goal) < 5) randomWaterNearPath(12, cfg.cruiseAbove[0], cfg.cruiseAbove[1], this.goal);
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
          randomFloorPoint(30, this.goal);
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
            randomWaterNearPath(12, cfg.cruiseAbove[0], cfg.cruiseAbove[1], this.goal);
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
    if (this.state === 'breathe') this.contain(0.5, WORLD.surfaceY + 1);
    else this.contain(0.5, WORLD.surfaceY - 0.6);
    this.integrate(dt);
  }
}

// ------------------------------------------------------------------ pods (visitors)

/** A visiting group that transits the field along a path, then leaves. */
export class Pod {
  leaderGoal = new THREE.Vector3();
  path: THREE.Vector3[] = [];
  idx = 0;
  done = false;
  members: Hunter[] = [];
  offsets: THREE.Vector3[] = [];
  constructor(public key: string) {}

  static transitPath(y0: number, y1: number, wiggle = 30): THREE.Vector3[] {
    // cross the field through a point on the camera loop so the pod is actually seen
    const through = randomWaterNearPath(4, y0, y0, new THREE.Vector3());
    const half = WORLD.size / 2 + 25;
    const a = Math.random() * Math.PI * 2;
    const enter = new THREE.Vector3(through.x + Math.cos(a) * half, y0, through.z + Math.sin(a) * half);
    const exit = new THREE.Vector3(through.x - Math.cos(a) * half, y1, through.z - Math.sin(a) * half);
    const pts = [enter];
    const n = 4;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = enter.clone().lerp(exit, t);
      p.x += (Math.random() - 0.5) * wiggle;
      p.z += (Math.random() - 0.5) * wiggle;
      p.y = y0 + (y1 - y0) * t + (Math.random() - 0.5) * 3;
      pts.push(p);
    }
    pts.push(exit);
    return pts;
  }

  update(dt: number, h: Habitat) {
    if (this.members.length === 0) return;
    const leader = this.members[0];
    // leader follows waypoints
    if (this.idx < this.path.length) {
      const wp = this.path[this.idx];
      if (leader.pos.distanceTo(wp) < 8) this.idx++;
    }
    if (this.idx >= this.path.length) {
      this.done = true;
      return;
    }
    const wp = this.path[this.idx];
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      m.timer -= dt;
      m.hunger += dt;
      if (m.cfg.airBreather) m.oxygen -= dt;
      const isLeader = i === 0;
      if (m.state === 'hunt') {
        const p = m.target;
        if (!p || !p.alive || m.timer < 0) {
          m.state = 'cruise';
          m.target = null;
        } else {
          m.doing = m.cfg.verbs.hunt;
          _a.copy(p.pos).addScaledVector(p.vel, 0.4);
          m.seek(_a, 1.5, m.opts.maxSpeed);
          if (m.pos.distanceTo(p.pos) < m.cfg.catchDist * m.scale) {
            h.eat(p);
            m.hunger = 0;
            m.target = null;
            m.state = 'eat';
            m.timer = m.cfg.eatTime;
          }
        }
      } else if (m.state === 'eat') {
        m.doing = m.cfg.verbs.eat;
        m.keepSpeed(m.opts.cruise * 0.6, 0.5);
        if (m.timer < 0) m.state = 'cruise';
      } else if (m.state === 'breathe') {
        m.doing = m.cfg.verbs.breathe;
        _a.set(m.pos.x + m.forward.x * 8, WORLD.surfaceY - 0.1, m.pos.z + m.forward.z * 8);
        m.seek(_a, 1.2, m.opts.cruise);
        if (m.pos.y > WORLD.surfaceY - 1.0) {
          m.oxygen += dt * 40;
          if (m.oxygen > m.cfg.oxygen[0]) m.state = 'cruise';
        }
      } else {
        m.state = 'cruise';
        m.doing = isLeader ? m.cfg.verbs.cruise : 'travelling with the pod';
        if (isLeader) {
          m.seek(wp, 0.9);
        } else {
          // formation: offset from leader in leader's frame
          const off = this.offsets[i];
          _b.copy(off).applyQuaternion(leader.quat).add(leader.pos);
          m.seek(_b, 1.1, m.opts.cruise * 1.05);
          // plus a bit of cohesion/separation with the others
          for (const o of this.members) {
            if (o === m) continue;
            const d = o.pos.distanceTo(m.pos);
            const minD = m.opts.size * 0.9;
            if (d < minD && d > 1e-3) {
              m.acc.addScaledVector(_c.subVectors(m.pos, o.pos).normalize(), ((minD - d) / minD) * m.opts.maxForce * 1.5);
            }
          }
        }
        m.wander(0.3, h.time);
        m.keepSpeed(m.opts.cruise, 0.4);
        if (m.cfg.airBreather && m.oxygen < 0) m.state = 'breathe';
        else if (m.hunger > 10 && Math.random() < dt * 0.5) {
          const p = h.preyNear(m.cfg.prey, m.pos, m.cfg.huntRange);
          if (p) {
            m.target = p;
            m.state = 'hunt';
            m.timer = 10;
          }
        }
      }
      m.contain(0.5, WORLD.surfaceY + (m.state === 'breathe' ? 1 : -0.6), -40); // pods may cross the boundary
      m.integrate(dt);
    }
  }
}

// ------------------------------------------------------------------ benthic fish (rockfish / lingcod)

export class BenthicFish extends Agent implements Behavior {
  home = new THREE.Vector3();
  goal = new THREE.Vector3();
  constructor(public key: string, opts: AgentOpts, public prey: string[], public verbs: { idle: string; hunt: string; eat: string }, public hover: [number, number]) {
    super(opts);
    randomFloorPoint(25, this.home);
    this.home.y += hover[0] + Math.random() * (hover[1] - hover[0]);
    this.pos.copy(this.home);
    this.goal.copy(this.home);
    this.timer = Math.random() * 5;
    this.vel.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(0.2);
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
    } else {
      this.doing = this.verbs.idle;
      if (this.timer < 0) {
        // pick a new hover spot near home
        this.goal.copy(this.home).add(new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 5));
        this.goal.y = Math.max(this.goal.y, floorHeight(this.goal.x, this.goal.z) + this.hover[0]);
        this.timer = 3 + Math.random() * 6;
        if (this.prey.length && Math.random() < 0.35) {
          const p = h.preyNear(this.prey, this.pos, 7);
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

export class Crab extends Agent implements Behavior {
  goal = new THREE.Vector3();
  heading = Math.random() * Math.PI * 2;
  buried = 0;
  private up = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  constructor(public key: string, opts: AgentOpts, public canBury: boolean) {
    super(opts);
    randomFloorPoint(22, this.pos);
    this.goal.copy(this.pos);
    this.timer = Math.random() * 4;
    this.state = 'forage';
  }
  update(dt: number, h: Habitat) {
    this.timer -= dt;
    const threats = h.threatsNear(['octopus', 'seal', 'sealion', 'lingcod'], this.pos, 4.5, _threats);
    if (threats.length && this.state !== 'flee') {
      this.state = 'flee';
      this.buried = 0;
      this.timer = 3;
      _a.subVectors(this.pos, threats[0].pos);
      _a.y = 0;
      this.goal.copy(this.pos).addScaledVector(_a.normalize(), 5);
    }
    let speed = 0;
    switch (this.state) {
      case 'forage':
        this.doing = 'picking through the silt';
        if (this.timer < 0) {
          const r = Math.random();
          if (r < 0.35) {
            this.state = 'walk';
            this.goal.copy(this.pos).add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
            this.timer = 8;
          } else if (this.canBury && r < 0.5) {
            this.state = 'bury';
            this.timer = 10 + Math.random() * 15;
          } else this.timer = 2 + Math.random() * 4;
        }
        break;
      case 'walk':
        this.doing = 'scuttling';
        speed = this.opts.cruise;
        if (this.pos.distanceTo(this.goal) < 0.4 || this.timer < 0) {
          this.state = 'forage';
          this.timer = 2 + Math.random() * 5;
        }
        break;
      case 'flee':
        this.doing = 'scuttling away';
        speed = this.opts.maxSpeed;
        if (this.timer < 0) {
          this.state = 'forage';
          this.timer = 2;
        }
        break;
      case 'bury':
        this.doing = 'buried in the sand';
        this.buried = Math.min(1, this.buried + dt * 0.5);
        if (this.timer < 0) {
          this.state = 'forage';
          this.timer = 2;
        }
        break;
    }
    if (this.state !== 'bury') this.buried = Math.max(0, this.buried - dt * 1.5);
    // move on the floor toward goal, sideways-walking crabs face 90 degrees off their travel direction
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
        const step = Math.min(d, speed * dt);
        this.pos.addScaledVector(_a, step);
        // crabs walk sideways: body faces perpendicular to travel
        const travel = Math.atan2(_a.z, _a.x);
        const face = travel + (this.key === 'kelpcrab' || this.key === 'decorator' ? 0 : Math.PI / 2);
        let diff = face - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * Math.min(1, dt * 4);
        this.speedMul = 2.2;
      }
    } else {
      this.speedMul = this.state === 'bury' ? 0.0 : 0.6;
    }
    // keep on the floor, oriented to the slope
    const half = WORLD.size / 2 - 20;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -half, half);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -half, half);
    const fy = floorHeight(this.pos.x, this.pos.z);
    this.pos.y = fy + 0.02 - this.buried * 0.06 * this.scale;
    floorNormal(this.pos.x, this.pos.z, this.up);
    this.fwd.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    this.orient(this.fwd, this.up);
    this.vel.set(0, 0, 0);
  }
}

// ------------------------------------------------------------------ octopus

export class Octopus extends Agent implements Behavior {
  den = new THREE.Vector3();
  goal = new THREE.Vector3();
  target: Agent | null = null;
  heading = Math.random() * Math.PI * 2;
  private up = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  jetT = 0;
  constructor(public key: string, opts: AgentOpts, den: THREE.Vector3) {
    super(opts);
    this.den.copy(den);
    this.pos.copy(den);
    this.goal.copy(den);
    this.state = 'den';
    this.timer = 5 + Math.random() * 10;
  }
  update(dt: number, h: Habitat) {
    this.timer -= dt;
    let speed = 0;
    switch (this.state) {
      case 'den':
        this.doing = 'resting at its den';
        this.speedMul = 0.35;
        if (this.timer < 0) {
          this.state = 'prowl';
          this.goal.copy(this.den).add(new THREE.Vector3((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24));
          this.timer = 40;
        }
        break;
      case 'prowl': {
        this.doing = 'prowling for crabs';
        speed = this.opts.cruise;
        this.speedMul = 1.3;
        const p = h.preyNear(['dungeness', 'redrock', 'kelpcrab', 'decorator'], this.pos, 6);
        if (p) {
          this.target = p;
          this.state = 'stalk';
          this.timer = 12;
        } else if (this.pos.distanceTo(this.goal) < 0.8 || this.timer < 0) {
          if (Math.random() < 0.35) {
            this.state = 'return';
          } else {
            this.goal.copy(this.den).add(new THREE.Vector3((Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24));
            this.timer = 40;
          }
        }
        break;
      }
      case 'stalk': {
        const p = this.target;
        if (!p || !p.alive || this.timer < 0) {
          this.state = 'prowl';
          this.target = null;
          break;
        }
        const d = this.pos.distanceTo(p.pos);
        this.goal.copy(p.pos);
        if (d > 2.2) {
          this.doing = 'stalking a crab';
          speed = this.opts.cruise * 0.7;
          this.speedMul = 0.9;
        } else {
          this.doing = 'pouncing';
          speed = this.opts.maxSpeed;
          this.speedMul = 2.5;
          if (d < 0.6) {
            h.eat(p);
            this.target = null;
            this.state = 'eat';
            this.timer = 14;
          }
        }
        break;
      }
      case 'eat':
        this.doing = 'eating a crab under its web';
        this.speedMul = 0.6;
        if (this.timer < 0) this.state = 'return';
        break;
      case 'return':
        this.doing = 'returning to its den';
        this.goal.copy(this.den);
        speed = this.opts.cruise;
        this.speedMul = 1.2;
        if (this.pos.distanceTo(this.den) < 0.6) {
          this.state = 'den';
          this.timer = 25 + Math.random() * 40;
        }
        break;
    }
    if (speed > 0) {
      _a.subVectors(this.goal, this.pos);
      _a.y = 0;
      const d = _a.length();
      if (d > 0.05) {
        _a.multiplyScalar(1 / d);
        for (const rk of h.rocks) {
          const dr = rk.pos.distanceTo(this.pos);
          if (dr < rk.r + 0.8 && rk.pos.distanceTo(this.den) > 1) {
            _b.subVectors(this.pos, rk.pos).y = 0;
            _a.addScaledVector(_b.normalize(), (rk.r + 0.8 - dr) * 1.5);
          }
        }
        _a.normalize();
        this.pos.addScaledVector(_a, Math.min(d, speed * dt));
        const face = Math.atan2(_a.z, _a.x);
        let diff = face - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * Math.min(1, dt * 2.5);
      }
    }
    const fy = floorHeight(this.pos.x, this.pos.z);
    this.pos.y = fy + 0.03;
    floorNormal(this.pos.x, this.pos.z, this.up);
    this.fwd.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    this.orient(this.fwd, this.up);
    this.vel.set(0, 0, 0);
  }
}

// ------------------------------------------------------------------ jellies

export class Jelly extends Agent implements Behavior {
  private up = new THREE.Vector3(0, 1, 0);
  private drift = new THREE.Vector3();
  pulse = Math.random() * 10;
  constructor(public key: string, opts: AgentOpts, public band: [number, number], public pulseRate: number, public pulseLift: number) {
    super(opts);
    randomWaterNearPath(12, band[0], band[1], this.pos);
    this.doing = 'drifting with the current';
    this.state = 'drift';
  }
  update(dt: number, h: Habitat) {
    this.pulse += dt * this.pulseRate;
    const beat = Math.max(0, Math.sin(this.pulse));
    h.current(this.pos, this.drift);
    this.vel.lerp(this.drift, Math.min(1, dt * 0.8));
    // pulsing lift, slow sink between beats
    this.vel.y += (beat * this.pulseLift - 0.05) * dt * 4;
    this.vel.y *= 0.985;
    // stay in band
    const fy = floorHeight(this.pos.x, this.pos.z);
    if (this.pos.y < fy + this.band[0]) this.vel.y += dt * 1.2;
    if (this.pos.y > fy + this.band[1] || this.pos.y > WORLD.surfaceY - 1.5) this.vel.y -= dt * 1.2;
    this.pos.addScaledVector(this.vel, dt);
    // wrap horizontally so the drift never empties the scene
    const half = WORLD.size / 2 - 10;
    if (this.pos.x > half) this.pos.x = -half;
    if (this.pos.x < -half) this.pos.x = half;
    if (this.pos.z > half) this.pos.z = -half;
    if (this.pos.z < -half) this.pos.z = half;
    // bell leans a little into its travel direction; model's up is +Y and its bell points up
    this.up.set(this.vel.x * 0.35, 1, this.vel.z * 0.35).normalize();
    _a.set(Math.cos(this.phase), 0, Math.sin(this.phase));
    this.orient(_a, this.up);
    // the renderer advances swimPhase at pulseRate; lock it to the behaviour's pulse so lift matches the bell
    this.speedMul = 1;
    this.animSpeed = 1;
    this.swimPhase = this.pulse;
    this.doing = beat > 0.8 ? 'pulsing' : 'drifting with the current';
  }
}

// ------------------------------------------------------------------ static life (anemones, stars, urchins, kelp)

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
    /* nothing to do: sway is in the shader */
  }
}

/** Slow water movement field shared by jellies/particles. */
export function currentAt(p: THREE.Vector3, t: number, out: THREE.Vector3) {
  const s = 0.02;
  const a = noise2(p.x * s + t * 0.01, p.z * s) * Math.PI * 2;
  const mag = 0.12 + 0.08 * noise2(p.z * s * 2 + 5, t * 0.02);
  return out.set(Math.cos(a) * mag + 0.05, 0, Math.sin(a) * mag);
}
