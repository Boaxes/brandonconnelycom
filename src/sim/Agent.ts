import * as THREE from 'three';
import { randomFloorAround, WORLD } from '../scene/Terrain';
import { bottomAt } from './Obstacles';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export type Vec3 = THREE.Vector3;

export interface AgentOpts {
  maxSpeed: number;
  maxForce: number;
  cruise: number;         // preferred speed
  turnRate?: number;      // rad/s for heading smoothing
  clearance?: number;     // metres above floor to keep
  bankAmount?: number;    // roll on turns
  size: number;           // approximate body length (m)
}

/** Base moving thing. Position/velocity integration and steering helpers. */
export class Agent {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  acc = new THREE.Vector3();
  forward = new THREE.Vector3(1, 0, 0);
  quat = new THREE.Quaternion();
  scale = 1;
  phase = Math.random() * Math.PI * 2;
  speedMul = 1;         // animation speed multiplier (target)
  animSpeed = 1;        // smoothed multiplier actually used
  swimPhase = Math.random() * Math.PI * 2; // integrated wave phase
  bend = 0;             // smoothed yaw rate (rad/s), curves the body into turns
  state = 'cruise';
  doing = 'cruising';
  timer = 0;            // generic per-state timer
  alive = true;
  static nextId = 1;
  id = Agent.nextId++;
  private bank = 0;

  constructor(public opts: AgentOpts) {}

  // ---- steering helpers (accumulate into acc, capped in integrate) ----
  seek(target: Vec3, weight = 1, desiredSpeed = this.opts.cruise) {
    _v.subVectors(target, this.pos);
    const d = _v.length();
    if (d < 1e-4) return;
    _v.multiplyScalar(desiredSpeed / d).sub(this.vel).multiplyScalar(weight);
    this.acc.add(_v);
  }

  arrive(target: Vec3, slowRadius: number, weight = 1) {
    _v.subVectors(target, this.pos);
    const d = _v.length();
    if (d < 1e-4) return;
    const sp = d < slowRadius ? this.opts.cruise * (d / slowRadius) : this.opts.cruise;
    _v.multiplyScalar(sp / d).sub(this.vel).multiplyScalar(weight);
    this.acc.add(_v);
  }

  flee(from: Vec3, weight = 1) {
    _v.subVectors(this.pos, from);
    const d = _v.length();
    if (d < 1e-4) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _v.normalize().multiplyScalar(this.opts.maxSpeed).sub(this.vel).multiplyScalar(weight);
    this.acc.add(_v);
  }

  /** Random wander: a small random target ahead. */
  wander(strength = 1, t = 0) {
    const a = t * 0.7 + this.phase * 10;
    _v.set(Math.sin(a * 1.3) * 0.7, Math.sin(a * 0.9 + 1.0) * 0.25, Math.cos(a * 1.1) * 0.7).multiplyScalar(strength * this.opts.maxForce * 0.6);
    this.acc.add(_v);
  }

  /** Keep a preferred cruising speed along the current heading. */
  keepSpeed(target = this.opts.cruise, weight = 0.6) {
    const sp = this.vel.length();
    if (sp < 1e-4) {
      this.acc.addScaledVector(this.forward, target * weight);
      return;
    }
    _v.copy(this.vel).multiplyScalar((target - sp) / sp).multiplyScalar(weight);
    this.acc.add(_v);
  }

  /** Stay inside the world volume; strong push near the edges. */
  contain(minY = 0.5, maxY = WORLD.surfaceY - 0.4, marginXZ = 18) {
    const half = WORLD.size / 2 - marginXZ;
    const f = this.opts.maxForce * 2.5;
    if (this.pos.x > half) this.acc.x -= f * ((this.pos.x - half) / marginXZ + 0.4);
    if (this.pos.x < -half) this.acc.x += f * ((-half - this.pos.x) / marginXZ + 0.4);
    if (this.pos.z > half) this.acc.z -= f * ((this.pos.z - half) / marginXZ + 0.4);
    if (this.pos.z < -half) this.acc.z += f * ((-half - this.pos.z) / marginXZ + 0.4);
    // rocks and props count as floor: swimmers rise over them the way they rise over a slope
    const floor = bottomAt(this.pos.x, this.pos.z);
    const clearance = this.opts.clearance ?? 1.2;
    const gap = this.pos.y - floor;
    if (gap < minY + clearance) {
      this.acc.y += f * (1.5 + (minY + clearance - gap) * 2);
      if (this.vel.y < 0) this.vel.y *= 0.8;
    }
    // look ahead along velocity for rising floor
    _v2.copy(this.pos).addScaledVector(this.vel, 1.2);
    const fAhead = bottomAt(_v2.x, _v2.z);
    if (_v2.y - fAhead < clearance + 0.8) this.acc.y += f * 1.2;
    if (this.pos.y > maxY) {
      this.acc.y -= f * (1 + (this.pos.y - maxY) * 2);
    }
  }

  /** Integrate velocity/position and update orientation. Returns speed. */
  integrate(dt: number): number {
    // cap force
    const fl = this.acc.length();
    if (fl > this.opts.maxForce) this.acc.multiplyScalar(this.opts.maxForce / fl);
    this.vel.addScaledVector(this.acc, dt);
    const sp = this.vel.length();
    if (sp > this.opts.maxSpeed) this.vel.multiplyScalar(this.opts.maxSpeed / sp);
    this.pos.addScaledVector(this.vel, dt);
    this.acc.set(0, 0, 0);

    // orientation: smooth heading toward velocity
    if (sp > 0.05) {
      _fwd.copy(this.vel).normalize();
      const rate = (this.opts.turnRate ?? 2.5) * dt;
      _v2.copy(this.forward);
      this.forward.lerp(_fwd, Math.min(1, rate)).normalize();
      // signed yaw rate: positive = turning left
      const yaw = (_v2.z * this.forward.x - _v2.x * this.forward.z) / Math.max(dt, 1e-4);
      this.bend += (THREE.MathUtils.clamp(yaw, -3, 3) - this.bend) * Math.min(1, dt * 5);
    } else {
      this.bend *= 1 - Math.min(1, dt * 3);
    }
    // banking from lateral acceleration
    _right.crossVectors(this.forward, UP);
    if (_right.lengthSq() < 1e-6) _right.set(0, 0, 1);
    _right.normalize();
    const lateral = _right.dot(this.vel) ; // approx
    const targetBank = -THREE.MathUtils.clamp(lateral * 0.15, -0.6, 0.6) * (this.opts.bankAmount ?? 1);
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 3);
    _up.crossVectors(_right, this.forward).normalize();
    // apply bank around forward
    if (this.bank !== 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(this.forward, this.bank);
      _up.applyQuaternion(q);
      _right.applyQuaternion(q);
    }
    _m.makeBasis(this.forward, _up, _right);
    this.quat.setFromRotationMatrix(_m);
    // animation speed follows swim speed
    this.speedMul = THREE.MathUtils.clamp(0.35 + sp / this.opts.cruise, 0.3, 2.6);
    return sp;
  }

  /** Set orientation directly from a forward and up vector (for crawlers). */
  orient(forward: Vec3, up: Vec3) {
    _fwd.copy(forward).normalize();
    _right.crossVectors(_fwd, up).normalize();
    _up.crossVectors(_right, _fwd).normalize();
    _m.makeBasis(_fwd, _up, _right);
    this.quat.setFromRotationMatrix(_m);
    this.forward.copy(_fwd);
  }

  distTo(p: Vec3) {
    return this.pos.distanceTo(p);
  }
}

/** Uniform grid for neighbour lookups among agents of one species. */
export class Grid<T extends Agent> {
  private cells = new Map<number, T[]>();
  constructor(private cell: number) {}
  private key(x: number, y: number, z: number) {
    const ix = Math.floor(x / this.cell) + 512;
    const iy = Math.floor(y / this.cell) + 512;
    const iz = Math.floor(z / this.cell) + 512;
    return (ix * 1031 + iy) * 1031 + iz;
  }
  rebuild(items: T[]) {
    this.cells.clear();
    for (const a of items) {
      const k = this.key(a.pos.x, a.pos.y, a.pos.z);
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(a);
    }
  }
  /** Visit neighbours within radius (approximate: cells overlapping the sphere). */
  each(p: Vec3, radius: number, fn: (a: T) => void) {
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const cz = Math.floor(p.z / this.cell);
    const r2 = radius * radius;
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let z = cz - r; z <= cz + r; z++) {
          const c = this.cells.get(((x + 512) * 1031 + (y + 512)) * 1031 + (z + 512));
          if (!c) continue;
          for (const a of c) if (a.pos.distanceToSquared(p) <= r2) fn(a);
        }
  }
}

export function randomInDisc(radius: number, out = new THREE.Vector3()) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * radius;
  return out.set(Math.cos(a) * r, 0, Math.sin(a) * r);
}

/** Random floor point in front of the camera, `dMin`..`dMax` metres out. */
export function randomFloorPoint(dMin = 2.5, dMax = 12, out = new THREE.Vector3()) {
  return randomFloorAround(Math.random, dMin, dMax, out);
}

/** Random point in the water in front of the camera, `minAbove`..`maxAbove` metres off the bottom. */
export function randomWaterPoint(minAbove = 2, maxAbove = 8, dMin = 3, dMax = 14, out = new THREE.Vector3()) {
  randomFloorAround(Math.random, dMin, dMax, out);
  out.y += minAbove + Math.random() * (maxAbove - minAbove);
  out.y = Math.min(out.y, WORLD.surfaceY - 1.5);
  return out;
}

