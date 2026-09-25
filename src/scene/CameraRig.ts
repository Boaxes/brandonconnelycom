import * as THREE from 'three';
import { stage } from './Terrain';
import { noise2 } from '../util/noise';

/**
 * A diver hanging still a couple of metres off the bottom. The camera never travels: the animals come
 * to it. On top of the fixed framing:
 *   - breathing: a slow rise on the inhale, sink on the exhale
 *   - handheld drift: low-frequency noise on yaw, pitch and roll
 *   - the mouse adds a small parallax look-around
 */
export class CameraRig {
  mouse = new THREE.Vector2();
  /** debug: when set, the camera is placed here instead */
  override: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** 0..1 breathing phase for anything that wants to sync to it (bubbles, audio) */
  breath = 0;
  private look = new THREE.Vector2();
  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {
    window.addEventListener('mousemove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
    const s = stage();
    camera.position.copy(s.cam);
    camera.lookAt(s.look);
  }

  update(dt: number, t: number) {
    if (this.override) {
      this.camera.position.copy(this.override.pos);
      this.camera.lookAt(this.override.look);
      return;
    }
    const s = stage();
    // breathing: ~5 s cycle, inhale lifts, exhale sinks; plus slow buoyancy wander
    this.breath = (t / 5.2) % 1;
    const lift = Math.sin(this.breath * Math.PI * 2) * 0.05 + noise2(t * 0.05, 3.1) * 0.08;
    const sway = noise2(t * 0.04, 8.3) * 0.08;
    this.pos.copy(s.cam).addScaledVector(s.right, sway);
    this.pos.y += lift;
    this.camera.position.copy(this.pos);

    // mouse parallax: a small look-around, eased
    this.look.lerp(new THREE.Vector2(this.mouse.x * 0.35, -this.mouse.y * 0.2), Math.min(1, dt * 2));
    this.target.copy(s.look).addScaledVector(s.right, this.look.x);
    this.target.y += this.look.y;
    this.camera.lookAt(this.target);
    // handheld: low-frequency yaw / pitch / roll drift
    this.camera.rotateY(noise2(t * 0.21, 11.7) * 0.012);
    this.camera.rotateX(noise2(t * 0.17, 5.3) * 0.008 + Math.sin(this.breath * Math.PI * 2 + 0.6) * 0.004);
    this.camera.rotateZ(noise2(t * 0.13, 7.9) * 0.01);
  }
}
