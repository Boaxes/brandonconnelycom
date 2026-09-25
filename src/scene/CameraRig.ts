import * as THREE from 'three';
import { floorHeight, WORLD } from './Terrain';

/**
 * Camera drifts along a closed loop a few metres above the seafloor.
 * Scroll progress (0..1) advances along the loop; a slow idle drift keeps it
 * alive when the visitor isn't scrolling. Mouse adds a gentle look-around.
 */
export class CameraRig {
  path: THREE.CatmullRomCurve3;
  progress = 0;          // smoothed
  targetProgress = 0;    // from scroll
  idle = 0;              // extra drift when idle
  mouse = new THREE.Vector2();
  /** debug: when set, the camera is placed here instead of on the path */
  override: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private look = new THREE.Vector2();
  private lookTarget = new THREE.Vector2();
  private pos = new THREE.Vector3();
  private ahead = new THREE.Vector3();
  private bob = 0;

  constructor(private camera: THREE.PerspectiveCamera) {
    const r = WORLD.size * 0.32;
    const pts: THREE.Vector3[] = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.8 + 0.25 * Math.sin(i * 2.3));
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr * 0.8;
      pts.push(new THREE.Vector3(x, 0, z));
    }
    this.path = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
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
    this.idle += dt * 0.0035;
    const goal = this.targetProgress * 0.9 + this.idle;
    // shortest-path smoothing on a loop
    let diff = goal - this.progress;
    this.progress += diff * Math.min(1, dt * 1.8);

    const u = ((this.progress % 1) + 1) % 1;
    this.path.getPointAt(u, this.pos);
    this.path.getPointAt((u + 0.03) % 1, this.ahead);
    const h = floorHeight(this.pos.x, this.pos.z);
    const hAhead = floorHeight(this.ahead.x, this.ahead.z);
    this.bob = Math.sin(t * 0.35) * 0.35 + Math.sin(t * 0.21 + 1.3) * 0.25;
    const y = Math.max(h, hAhead) + 4.2 + this.bob;
    this.camera.position.set(this.pos.x, y, this.pos.z);

    this.lookTarget.set(this.mouse.x * 0.25, -this.mouse.y * 0.12);
    this.look.lerp(this.lookTarget, Math.min(1, dt * 2.5));

    const target = new THREE.Vector3(this.ahead.x, Math.max(h, hAhead) + 3.2 + this.bob * 0.6, this.ahead.z);
    // rotate look direction around the camera by mouse
    const dir = target.sub(this.camera.position).normalize();
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.look.x);
    dir.applyQuaternion(yaw);
    dir.y += this.look.y;
    this.camera.lookAt(this.camera.position.clone().add(dir));
    // slight roll from drift
    this.camera.rotateZ(Math.sin(t * 0.18) * 0.012);
  }
}
