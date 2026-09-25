import * as THREE from 'three';
import { stage } from './Terrain';
import { noise2 } from '../util/noise';

const YAW_STEP = Math.PI / 4;   // 8 headings
const PITCH_STEP = Math.PI / 6; // 30°
const PITCH_MIN = -3;           // straight down
const PITCH_MAX = 3;            // straight up
const TURN_TIME = 0.42;         // seconds per step
const HEADINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * A diver hanging still, about 30 ft down. The camera never moves; the view turns in fixed steps
 * (45° left/right, 30° up/down, all the way round and from straight down to straight up), each step a
 * short eased turn. Breathing and a little handheld drift sit on top.
 */
export class CameraRig {
  /** debug: when set, the camera is placed here instead */
  override: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** 0..1 breathing phase for anything that wants to sync to it */
  breath = 0;
  /** step indices: yaw 0 = north (the starting view, the book), pitch 0 = level */
  yawStep = 0;
  pitchStep = 0;
  /** turning is off while a book is being read */
  enabled = true;
  onChange: (() => void) | null = null;
  private from = new THREE.Quaternion();
  private to = new THREE.Quaternion();
  private t = 1;
  private base = new THREE.Quaternion();

  constructor(private camera: THREE.PerspectiveCamera) {
    const s = stage();
    camera.position.copy(s.cam);
    this.to.copy(this.target());
    this.base.copy(this.to);
    camera.quaternion.copy(this.to);
  }

  /** Continuous yaw (radians clockwise from north) and pitch (radians, up +) of the settled view. */
  get yaw() { return this.yawStep * YAW_STEP; }
  get pitch() { return this.pitchStep * PITCH_STEP; }
  get heading() { return HEADINGS[((this.yawStep % 8) + 8) % 8]; }
  get pitchLabel() { return this.pitchStep === 0 ? 'level' : `${this.pitchStep > 0 ? 'up' : 'down'} ${Math.abs(this.pitchStep) * 30}°`; }

  /** Turn by whole steps. */
  step(dYaw: number, dPitch: number) {
    if (!this.enabled) return;
    const p = THREE.MathUtils.clamp(this.pitchStep + dPitch, PITCH_MIN, PITCH_MAX);
    if (dYaw === 0 && p === this.pitchStep) return;
    this.yawStep += dYaw;
    this.pitchStep = p;
    this.from.copy(this.base);
    this.to.copy(this.target());
    this.t = 0;
    this.onChange?.();
  }

  /** Back to the starting view. */
  reset() {
    if (!this.enabled) return;
    // take the short way round
    const k = Math.round(this.yawStep / 8) * 8;
    this.step(k - this.yawStep, -this.pitchStep);
  }

  private target() {
    // heading turns clockwise from north (-z); pitch up is positive. Straight up/down stop just short
    // of vertical so the heading still means something.
    const pitch = THREE.MathUtils.clamp(this.pitchStep * PITCH_STEP, -1.52, 1.52);
    _e.set(pitch, -this.yawStep * YAW_STEP, 0, 'YXZ');
    return _q.setFromEuler(_e);
  }

  update(dt: number, t: number) {
    if (this.override) {
      this.camera.position.copy(this.override.pos);
      this.camera.lookAt(this.override.look);
      return;
    }
    const s = stage();
    // eased step turn
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / TURN_TIME);
      const k = this.t < 0.5 ? 4 * this.t ** 3 : 1 - (-2 * this.t + 2) ** 3 / 2;
      this.base.slerpQuaternions(this.from, this.to, k);
    }
    // breathing: ~5 s cycle, inhale lifts, exhale sinks; plus slow buoyancy wander
    this.breath = (t / 5.2) % 1;
    const lift = Math.sin(this.breath * Math.PI * 2) * 0.04 + noise2(t * 0.05, 3.1) * 0.05;
    this.camera.position.set(s.cam.x + noise2(t * 0.04, 8.3) * 0.05, s.cam.y + lift, s.cam.z + noise2(t * 0.04, 2.9) * 0.05);
    this.camera.quaternion.copy(this.base);
    // handheld: low-frequency yaw / pitch / roll drift
    this.camera.rotateY(noise2(t * 0.21, 11.7) * 0.008);
    this.camera.rotateX(noise2(t * 0.17, 5.3) * 0.006 + Math.sin(this.breath * Math.PI * 2 + 0.6) * 0.003);
    this.camera.rotateZ(noise2(t * 0.13, 7.9) * 0.008);
  }
}
