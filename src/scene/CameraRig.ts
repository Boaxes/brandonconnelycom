import * as THREE from 'three';
import { stage } from './Terrain';
import { noise2 } from '../util/noise';

const YAW_STEP = Math.PI / 4;   // 8 headings
const PITCH_STEP = Math.PI / 6; // 30°
const PITCH_MIN = -3;           // straight down
const PITCH_MAX = 3;            // straight up
const TURN_TIME = 0.42;         // seconds per step
const HEADINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const ZOOM_MAX = 4;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * A diver hanging still, about 30 ft down. The camera never moves; the view turns in fixed steps
 * (45° left/right, 30° up/down, all the way round and from straight down to straight up), each step a
 * short eased turn. Breathing and a little handheld drift sit on top.
 *
 * Zoom narrows the field of view and swings the view toward the pointer, so whatever is under it stays
 * under it (a book held up to the eye, a fish across the way). The book is held by `hands`, which follows
 * the diver's head but not the zoom, so zooming reads the page more closely rather than moving it.
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
  /** where the diver's hands are: the head's pose without the zoom */
  readonly hands = new THREE.Object3D();
  /** field of view at 1x */
  readonly baseFov: number;
  zoom = 1;
  zoomTarget = 1;
  /** the opening shot: close on the book; released once, it pulls back to the diver's spot */
  private intro: { pos: THREE.Vector3; quat: THREE.Quaternion } | null = null;
  private introOut = -1; // < 0: holding the opening shot; 0..1: pulling back
  onIntroDone: (() => void) | null = null;
  private off = new THREE.Vector2();       // zoom swing (yaw right +, pitch up +), radians
  private offTarget = new THREE.Vector2();

  constructor(private camera: THREE.PerspectiveCamera) {
    const s = stage();
    camera.position.copy(s.cam);
    this.to.copy(this.target());
    this.base.copy(this.to);
    camera.quaternion.copy(this.to);
    this.baseFov = camera.fov;
  }

  /**
   * Zoom to `level` about a point on screen (NDC, -1..1). Returns the level actually set.
   * Zooming in swings the view toward the point so it stays put; zooming out unwinds the swing, all
   * the way back at 1x.
   */
  setZoom(level: number, ndcX = 0, ndcY = 0) {
    const z0 = this.zoomTarget;
    const z1 = THREE.MathUtils.clamp(level, 1, ZOOM_MAX);
    if (Math.abs(z1 - z0) < 1e-4) return z0;
    if (z1 > z0) {
      const tanV = Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2)) / z0;
      const aspect = this.camera.aspect;
      const k = 1 - z0 / z1;
      this.offTarget.x += Math.atan(ndcX * tanV * aspect) * k;
      this.offTarget.y += Math.atan(ndcY * tanV) * k;
      // never swing further than the edge of the unzoomed view
      const lim = THREE.MathUtils.degToRad(this.baseFov / 2);
      this.offTarget.x = THREE.MathUtils.clamp(this.offTarget.x, -lim * aspect, lim * aspect);
      this.offTarget.y = THREE.MathUtils.clamp(this.offTarget.y, -lim, lim);
    } else {
      this.offTarget.multiplyScalar(z1 <= 1 ? 0 : (z1 - 1) / (z0 - 1));
    }
    this.zoomTarget = z1;
    return z1;
  }

  /** Continuous yaw (radians clockwise from north) and pitch (radians, up +) of the settled view. */
  get yaw() { return this.yawStep * YAW_STEP; }
  get pitch() { return this.pitchStep * PITCH_STEP; }
  get heading() { return HEADINGS[((this.yawStep % 8) + 8) % 8]; }
  get pitchLabel() { return this.pitchStep === 0 ? 'level' : `${this.pitchStep > 0 ? 'up' : 'down'} ${Math.abs(this.pitchStep) * 30}°`; }

  /** Hold the camera at `pos` looking at `look` until `releaseIntro()`. */
  startIntro(pos: THREE.Vector3, look: THREE.Vector3) {
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    this.intro = { pos: pos.clone(), quat: new THREE.Quaternion().setFromRotationMatrix(m) };
    this.introOut = -1;
  }

  /** One slow, scripted pull-back from the opening shot to the diver's spot. */
  releaseIntro() {
    if (this.intro && this.introOut < 0) this.introOut = 0;
  }

  get inIntro() { return !!this.intro; }

  /** Turn by whole steps. */
  step(dYaw: number, dPitch: number) {
    if (!this.enabled) return;
    // still in the opening shot: the first turn pulls back instead
    if (this.intro) { this.releaseIntro(); return; }
    this.setZoom(1);
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
    if (this.intro) {
      let k = 1;
      if (this.introOut >= 0) {
        this.introOut = Math.min(1, this.introOut + dt / 3.6);
        const e = this.introOut;
        k = 1 - (e < 0.5 ? 4 * e * e * e : 1 - (-2 * e + 2) ** 3 / 2);
      }
      this.camera.position.lerp(this.intro.pos, k);
      this.camera.quaternion.slerp(this.intro.quat, k);
      if (this.introOut >= 1) {
        this.intro = null;
        this.onIntroDone?.();
      }
    }
    // handheld: low-frequency yaw / pitch / roll drift
    // (steadier when zoomed in, the way you'd brace to look closely)
    const hh = 1 / Math.sqrt(this.zoom);
    this.camera.rotateY(noise2(t * 0.21, 11.7) * 0.008 * hh);
    this.camera.rotateX((noise2(t * 0.17, 5.3) * 0.006 + Math.sin(this.breath * Math.PI * 2 + 0.6) * 0.003) * hh);
    this.camera.rotateZ(noise2(t * 0.13, 7.9) * 0.008 * hh);
    this.hands.position.copy(this.camera.position);
    this.hands.quaternion.copy(this.camera.quaternion);
    this.hands.updateMatrixWorld();
    // zoom: ease the field of view and the swing toward the pointer
    const e = 1 - Math.exp(-dt * 10);
    this.zoom += (this.zoomTarget - this.zoom) * e;
    this.off.lerp(this.offTarget, e);
    if (Math.abs(this.zoom - this.zoomTarget) < 1e-3) this.zoom = this.zoomTarget;
    this.camera.rotateY(-this.off.x);
    this.camera.rotateX(this.off.y);
    const fov = this.baseFov / this.zoom;
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
