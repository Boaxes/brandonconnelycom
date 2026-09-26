import * as THREE from 'three';

const MAX = 96;

/**
 * Exhaled bubbles: small silvery rings that wobble up, grow a little as the pressure drops, and vanish
 * after a metre or two. A fixed pool drawn as one set of points; `emit` reuses the oldest.
 */
export class Bubbles {
  points: THREE.Points;
  /** how lit they are (the torch or the daylight); set each frame */
  light = 1;
  private pos = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX).fill(1e9);
  private life = new Float32Array(MAX);
  private base = new Float32Array(MAX);
  private seed = new Float32Array(MAX);
  private next = 0;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: 1 }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        varying float vA;
        uniform float uScale;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, size * uScale / -mv.z);
          vA = alpha;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        uniform float uLight;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;
          // a thin bright rim, a faint body and a highlight up and to one side
          float rim = smoothstep(0.62, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
          float hi = 1.0 - smoothstep(0.0, 0.28, length(p - vec2(-0.32, 0.36)));
          float a = (rim * 0.75 + hi * 0.9 + 0.08) * vA;
          gl_FragColor = vec4(vec3(0.82, 0.93, 0.97) * uLight * (0.6 + hi), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** `n` bubbles around `at` (spread in metres); `push` is an initial velocity (e.g. an animal's). */
  emit(at: THREE.Vector3, n = 1, spread = 0.02, push?: THREE.Vector3) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = (push?.x ?? 0) + (Math.random() - 0.5) * 0.08;
      this.vel[i * 3 + 1] = (push?.y ?? 0) + 0.1 + Math.random() * 0.1;
      this.vel[i * 3 + 2] = (push?.z ?? 0) + (Math.random() - 0.5) * 0.08;
      this.base[i] = 0.004 + Math.random() ** 2 * 0.012;
      this.life[i] = 2.2 + Math.random() * 1.6;
      this.seed[i] = Math.random() * 100;
      this.age[i] = 0;
    }
  }

  update(dt: number, t: number, viewportHeight: number, fov: number) {
    this.mat.uniforms.uLight.value = this.light;
    // point size in px per metre at 1 m
    this.mat.uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    for (let i = 0; i < MAX; i++) {
      const age = (this.age[i] += dt);
      if (age > this.life[i]) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      // buoyancy: rise towards a terminal speed that grows with size; any push dies away quickly
      const rise = 0.28 + this.base[i] * 22;
      const drag = 1 - Math.min(1, dt * 3);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] += (rise - this.vel[i * 3 + 1]) * Math.min(1, dt * 2.5);
      const s = this.seed[i];
      const wob = 0.05 + this.base[i] * 6;
      this.pos[i * 3] += (this.vel[i * 3] + Math.sin(t * 9 + s) * wob) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + Math.cos(t * 8 + s * 1.3) * wob) * dt;
      this.size[i] = this.base[i] * (1 + age * 0.12) * (1 + 0.12 * Math.sin(t * 14 + s));
      this.alpha[i] = Math.min(1, age * 8) * (1 - THREE.MathUtils.smoothstep(age, this.life[i] - 0.5, this.life[i]));
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}
