import * as THREE from 'three';
import { cameraPath, floorHeight } from './Terrain';
import { noise2 } from '../util/noise';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A diver drifting along a closed loop a couple of metres above the seafloor.
 * Scroll progress (0..1) advances along the loop; a slow idle drift keeps it moving
 * when the visitor isn't scrolling. On top of the path:
 *   - breathing: a slow rise on the inhale, sink on the exhale
 *   - handheld drift: low-frequency noise on yaw, pitch and roll
 *   - attention: the gaze eases toward the most interesting animal nearby, then lets go
 *   - the mouse adds a gentle look-around
 */
export class CameraRig {
  path: THREE.CatmullRomCurve3;
  progress = 0;          // smoothed
  targetProgress = 0;    // from scroll
  idle = 0;              // extra drift when idle
  mouse = new THREE.Vector2();
  /** debug: when set, the camera is placed here instead of on the path */
  override: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** supplied by the world: something worth looking at near the camera, or null */
  attention: ((pos: THREE.Vector3, fwd: THREE.Vector3) => THREE.Vector3 | null) | null = null;
  /** 0..1 breathing phase for anything that wants to sync to it (bubbles, audio) */
  breath = 0;
  private look = new THREE.Vector2();
  private lookTarget = new THREE.Vector2();
  private pos = new THREE.Vector3();
  private ahead = new THREE.Vector3();
  private gaze = new THREE.Vector3();
  private gazeInit = false;
  private attnWeight = 0;
  private attnActive = false;
  private attnPoint = new THREE.Vector3();
  private attnRef: THREE.Vector3 | null = null;
  private attnTimer = 0;
  private height = 3;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.path = cameraPath();
    window.addEventListener('mousemove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
  }

  /** Called from the page's scroll listener with 0..1. */
  setScroll(p: number) {
    this.targetProgress = p;
  }

  update(dt: number, t: number) {
    if (this.override) {
      this.camera.position.copy(this.override.pos);
      this.camera.lookAt(this.override.look);
      return;
    }
    // idle drift: keep moving slowly even without scrolling
    this.idle += dt * 0.003;
    const goal = this.targetProgress * 0.9 + this.idle;
    this.progress += (goal - this.progress) * Math.min(1, dt * 1.5);

    const u = ((this.progress % 1) + 1) % 1;
    this.path.getPointAt(u, this.pos);
    this.path.getPointAt((u + 0.02) % 1, this.ahead);

    // hold roughly 2.4 m above the highest ground nearby, eased so bumps don't jolt the camera
    const hFloor = Math.max(floorHeight(this.pos.x, this.pos.z), floorHeight(this.ahead.x, this.ahead.z));
    this.height += (hFloor + 2.4 - this.height) * Math.min(1, dt * 0.8);

    // breathing: ~5 s cycle, inhale lifts, exhale sinks
    this.breath = (t / 5.2) % 1;
    const breathLift = Math.sin(this.breath * Math.PI * 2) * 0.07;
    // slow buoyancy wander
    const wander = noise2(t * 0.05, 3.1) * 0.35;
    this.camera.position.set(this.pos.x, this.height + breathLift + wander, this.pos.z);

    // path gaze: a point ahead, a little below eye level
    const pathLook = new THREE.Vector3(this.ahead.x, hFloor + 1.1, this.ahead.z);

    // attention: re-evaluate every ~1.5 s, ease the gaze toward it, release when it goes behind
    this.attnTimer -= dt;
    const fwd = new THREE.Vector3().subVectors(pathLook, this.camera.position).normalize();
    if (this.attention && this.attnTimer <= 0) {
      this.attnTimer = 1.5;
      const p = this.attention(this.camera.position, fwd);
      this.attnActive = !!p;
      this.attnRef = p;
    }
    if (this.attnRef) this.attnPoint.copy(this.attnRef); // follow the animal as it moves
    this.attnWeight += ((this.attnActive ? 0.55 : 0) - this.attnWeight) * Math.min(1, dt * 0.6);
    const lookAt = pathLook.clone().lerp(this.attnPoint, this.attnWeight);
    if (!this.gazeInit) {
      this.gaze.copy(lookAt);
      this.gazeInit = true;
    }
    this.gaze.lerp(lookAt, Math.min(1, dt * 1.2));

    // mouse look-around
    this.lookTarget.set(this.mouse.x * 0.25, -this.mouse.y * 0.12);
    this.look.lerp(this.lookTarget, Math.min(1, dt * 2.5));

    const dir = new THREE.Vector3().subVectors(this.gaze, this.camera.position).normalize();
    // handheld: low-frequency yaw / pitch drift
    const hy = noise2(t * 0.23, 11.7) * 0.035 - this.look.x;
    const hp = noise2(t * 0.19, 5.3) * 0.025 + this.look.y + Math.sin(this.breath * Math.PI * 2 + 0.6) * 0.008;
    dir.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(UP, hy));
    dir.y += hp;
    this.camera.lookAt(this.camera.position.clone().add(dir));
    this.camera.rotateZ(noise2(t * 0.13, 7.9) * 0.02);
  }
}
