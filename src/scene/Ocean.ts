import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { shared } from './UnderwaterMaterial';
import { buildDebris, buildTerrain, WORLD } from './Terrain';
import { buildBackdrop, buildGodRays, buildLights, buildParticles, buildSurface } from './Environment';

/** Vignette + subtle chromatic softening, applied after bloom. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.35 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      // faint wobble as if seen through moving water
      uv += vec2(sin(uv.y * 14.0 + uTime * 0.6), cos(uv.x * 12.0 + uTime * 0.5)) * 0.0012;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      vec2 d = uv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.2;
      c *= clamp(v, 0.0, 1.0);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class Ocean {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  final: ShaderPass;
  terrain: THREE.Mesh;
  clock = new THREE.Clock();
  quality = 1;
  private frameTimes: number[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 600);
    this.camera.position.set(0, 6, 30);

    shared.surfaceY.value = WORLD.surfaceY;
    this.scene.background = shared.deepColor.value;

    this.terrain = buildTerrain();
    this.scene.add(this.terrain);
    this.scene.add(buildDebris());
    this.scene.add(buildBackdrop());
    this.scene.add(buildSurface());
    this.scene.add(buildGodRays());
    this.scene.add(buildParticles());
    for (const l of buildLights()) this.scene.add(l);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.7, 0.9);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /** Adaptive quality: drop pixel ratio if we can't hold ~50fps. */
  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const pr = this.renderer.getPixelRatio();
    if (avg > 1 / 45 && pr > 0.75) {
      this.renderer.setPixelRatio(Math.max(0.75, pr - 0.25));
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.resize();
      this.quality = this.renderer.getPixelRatio();
    } else if (avg < 1 / 58 && pr < Math.min(window.devicePixelRatio, 2)) {
      this.renderer.setPixelRatio(Math.min(Math.min(window.devicePixelRatio, 2), pr + 0.25));
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.resize();
      this.quality = this.renderer.getPixelRatio();
    }
  }

  render(time: number, dt: number) {
    shared.time.value = time;
    this.final.uniforms.uTime.value = time;
    this.adapt(dt);
    this.composer.render();
  }
}
