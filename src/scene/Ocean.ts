import * as THREE from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { shared, WATER_GLSL, waterUniforms } from './UnderwaterMaterial';
import { buildTerrain, stage, WORLD } from './Terrain';
import { buildBackdrop, buildLights, buildParticles, buildSurface, buildTorch, TORCH } from './Environment';

/**
 * Pass 1 (linear HDR, reads scene colour + depth):
 *   - depth of field with a circle of confusion from the shared focus distance
 *   - the torch beam: in-scattering raymarched through drifting silt, stopped by scene depth
 */
const WaterPostShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.2 },
    uFar: { value: 70 },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPxScale: { value: 1 },
    uTime: shared.time,
    uFocus: shared.focus,
    uAperture: shared.aperture,
    uTorchPos: { value: TORCH.pos },
    uTorchDir: { value: TORCH.dir },
    uTorchCos: { value: new THREE.Vector2(Math.cos(TORCH.angle), Math.cos(TORCH.angle * (1 - TORCH.penumbra))) },
    uTorchColor: { value: TORCH.color },
    uBeam: { value: 0.09 },
    uSharpNear: { value: 0 },
    uShafts: { value: 0.26 },
    uFrame: { value: 0 },
    ...waterUniforms(),
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    #include <packing>
    ${WATER_GLSL}
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float uNear;
    uniform float uFar;
    uniform mat4 uProjInv;
    uniform mat4 uCamWorld;
    uniform vec2 uResolution;
    uniform float uPxScale;
    uniform float uTime;
    uniform float uFocus;
    uniform float uAperture;
    uniform float uSharpNear;
    uniform vec3 uTorchPos;
    uniform vec3 uTorchDir;
    uniform vec2 uTorchCos;
    uniform vec3 uTorchColor;
    uniform float uBeam;
    uniform float uShafts;
    uniform float uFrame;
    varying vec2 vUv;

    float viewDist(vec2 uv, out vec3 viewPos) {
      float z = texture2D(tDepth, uv).x;
      vec4 ndc = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      vec4 v = uProjInv * ndc;
      viewPos = v.xyz / v.w;
      return z >= 0.99999 ? uFar : length(viewPos);
    }
    float depthAt(vec2 uv) {
      float z = texture2D(tDepth, uv).x;
      return z >= 0.99999 ? uFar : -perspectiveDepthToViewZ(z, uNear, uFar);
    }
    float cocPx(float d) {
      // everything nearer than uSharpNear is sharp (the book in hand; the opening's book and sea lion),
      // with a short ramp behind it so there's no seam on the rock
      float coc = min(uAperture * abs(1.0 / uFocus - 1.0 / max(d, 0.05)) * 60.0 * uPxScale, 6.0 * uPxScale);
      return uSharpNear > 0.0 ? coc * smoothstep(uSharpNear, uSharpNear + 0.8, d) : coc;
    }
    float hash13(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.zyx + 31.32);
      return fract((p.x + p.y) * p.z);
    }
    float noise3(vec3 p) {
      vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
    }

    void main() {
      vec3 viewPos;
      float dist = viewDist(vUv, viewPos);
      float d = depthAt(vUv);

      // ---- depth of field (gather along a golden-angle spiral)
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float c0 = cocPx(d);
      if (c0 > 1.0) {
        vec3 acc = col;
        float wsum = 1.0;
        const int TAPS = 14;
        for (int i = 1; i < TAPS; i++) {
          float fi = float(i);
          float r = sqrt(fi / float(TAPS)) * c0;
          float a = fi * 2.39996;
          vec2 o = vec2(cos(a), sin(a)) * r / uResolution;
          vec2 suv = vUv + o;
          float sd = depthAt(suv);
          float sc = cocPx(sd);
          // a sample contributes if its own blur reaches this pixel; sharp foreground stays sharp
          float w = clamp(sc - r + 1.0, 0.0, 1.0);
          if (sd < d) w *= clamp(sc / max(c0, 0.001), 0.0, 1.0);
          acc += texture2D(tDiffuse, suv).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      }

      // ---- torch beam: in-scattering along the view ray
      vec3 rd = normalize(viewPos);
      float tMax = min(dist, 14.0);
      const int STEPS = 12;
      float stepLen = tMax / float(STEPS);
      // interleaved-gradient jitter, fixed per pixel: a per-frame jitter shimmered
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec3 beam = vec3(0.0);
      for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + jitter) * stepLen;
        vec3 p = rd * t;
        vec3 L = p - uTorchPos;
        float dl = length(L);
        float cone = smoothstep(uTorchCos.x, uTorchCos.y, dot(L / dl, uTorchDir));
        if (cone <= 0.0) continue;
        vec3 wp = (uCamWorld * vec4(p, 1.0)).xyz;
        float silt = 0.35 + 1.3 * noise3(wp * 1.6 + vec3(uTime * 0.05, -uTime * 0.03, uTime * 0.04));
        beam += cone * silt * waterTransmit(dl + t) / (1.0 + dl * dl * 0.3);
      }
      col += uTorchColor * beam * stepLen * uBeam;

      // ---- sunlight shafts: faint streaks radiating from overhead, only through thick water, drifting
      vec3 dw = normalize(mat3(uCamWorld) * rd);
      float ang = atan(dw.x, dw.z);
      float sh = sin(ang * 23.0 + uTime * 0.07) * 0.5 + sin(ang * 37.0 - uTime * 0.05 + 1.3) * 0.3 + sin(ang * 61.0 + uTime * 0.11) * 0.2;
      sh = pow(sh * 0.5 + 0.5, 3.0);
      float upward = smoothstep(0.1, 0.75, dw.y) * (1.0 - smoothstep(0.9, 0.99, dw.y));
      col += uWaterColor * sh * upward * (1.0 - exp(-0.12 * min(dist, 30.0))) * uShafts;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** Pass 3 (display space, after tonemapping): dome-port distortion, colour fringing, vignette, grain + dither. */
const LensShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uBarrel: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uBarrel;
    varying vec2 vUv;
    vec2 barrel(vec2 uv, float k) {
      vec2 c = uv - 0.5;
      c.x *= uResolution.x / uResolution.y;
      float r2 = dot(c, c);
      c *= 1.0 + k * r2;
      c.x /= uResolution.x / uResolution.y;
      return c + 0.5;
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      // slight barrel distortion (dome port) with a touch of lateral colour at the edges
      // (eased off while reading, so lines of type stay straight)
      float k = -0.035 * uBarrel;
      vec3 c;
      float ca = 1.0 + 0.012 * uBarrel;
      c.r = texture2D(tDiffuse, barrel(vUv, k * ca)).r;
      c.g = texture2D(tDiffuse, barrel(vUv, k)).g;
      c.b = texture2D(tDiffuse, barrel(vUv, k * (2.0 - ca))).b;
      // vignette
      vec2 d = vUv - 0.5;
      d.x *= uResolution.x / uResolution.y * 0.8;
      // mostly top and bottom: the sides are where the scene shows beside the page
      d.x *= 0.55;
      c *= mix(1.0, smoothstep(0.95, 0.25, length(d)), 0.4);
      // film grain, stronger in the shadows; triangular dither breaks 8-bit banding
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      vec2 px = gl_FragCoord.xy;
      float g = hash(px + fract(uTime * 13.7) * 91.0) - 0.5;
      c += g * 0.03 * (1.0 - lum * 0.7);
      float dth = (hash(px * 1.37 + uTime) + hash(px * 0.73 - uTime) - 1.0) / 255.0;
      c += dth;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

/**
 * UnrealBloomPass without its last step: instead of blending the blur back over the whole frame in a
 * full-resolution pass of its own, it's left in its (half-resolution) texture for the output pass to add.
 * Steps 1–3 are UnrealBloomPass.render's, unchanged.
 */
class BloomPass extends UnrealBloomPass {
  bloomOf(renderer: THREE.WebGLRenderer, input: THREE.Texture): THREE.Texture {
    const quad = (this as unknown as { _fsQuad: FullScreenQuad })._fsQuad;
    const oldClear = renderer.getClearColor(new THREE.Color());
    const oldAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    const pass = (m: THREE.Material, to: THREE.WebGLRenderTarget) => {
      quad.material = m;
      renderer.setRenderTarget(to);
      renderer.clear();
      quad.render(renderer);
    };
    // 1. bright areas
    const hp = this.highPassUniforms as Record<string, THREE.IUniform>;
    hp.tDiffuse.value = input;
    hp.luminosityThreshold.value = this.threshold;
    pass(this.materialHighPassFilter, this.renderTargetBright);
    // 2. blur each mip
    let from = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      m.uniforms.colorTexture.value = from.texture;
      m.uniforms.direction.value = BLUR_X;
      pass(m, this.renderTargetsHorizontal[i]);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = BLUR_Y;
      pass(m, this.renderTargetsVertical[i]);
      from = this.renderTargetsVertical[i];
    }
    // 3. composite the mips
    const c = this.compositeMaterial.uniforms;
    c.bloomStrength.value = this.strength;
    c.bloomRadius.value = this.radius;
    c.bloomTintColors.value = this.bloomTintColors;
    pass(this.compositeMaterial, this.renderTargetsHorizontal[0]);
    renderer.setClearColor(oldClear, oldAlpha);
    renderer.autoClear = oldAutoClear;
    return this.renderTargetsHorizontal[0].texture;
  }
}

export class Ocean {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  bloom: BloomPass;
  water: ShaderPass;
  lens: ShaderPass;
  /** the scene: multisampled, with a depth texture the water pass reads */
  target: THREE.WebGLRenderTarget;
  terrain: THREE.Mesh;
  particles: THREE.Points;
  torch: THREE.SpotLight;
  quality = 1;
  private scenePass: RenderPass;
  private output: OutputPass;
  /** after the water pass (linear HDR) */
  private post: THREE.WebGLRenderTarget;
  /** after bloom, tonemapping and sRGB, before the lens */
  private graded: THREE.WebGLRenderTarget;
  private frameTimes: number[] = [];
  private frame = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // (PCFSoftShadowMap is gone from three: it fell back to this with a console warning)
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 70);
    this.camera.position.set(0, 6, 30);

    stage(); // sets the surface height from the viewpoint
    shared.surfaceY.value = WORLD.surfaceY;
    this.scene.background = shared.deepColor.value;

    this.terrain = buildTerrain();
    this.scene.add(this.terrain);
    this.scene.add(buildBackdrop());
    this.scene.add(buildSurface());
    this.particles = buildParticles();
    this.scene.add(this.particles);
    this.lights = buildLights() as THREE.Light[];
    for (const l of this.lights) this.scene.add(l);
    this.lightBase = this.lights.map((l) => l.intensity);
    this.torch = buildTorch();
    this.camera.add(this.torch);
    this.camera.add(this.torch.target);
    this.scene.add(this.camera);

    // The passes, wired by hand: scene → water (DOF, torch beam) → bloom + tonemapping → lens → screen.
    // Only the scene is multisampled; each full-screen pass after it writes a plain target (an EffectComposer
    // gives every pass a copy of its first target, so each of them was rendered 4× multisampled and then
    // resolved, depth and all, for no difference in the picture), and the bloom is added in the tonemapping
    // pass rather than blended over the frame in a pass of its own.
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.target.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.target.depthTexture.type = THREE.UnsignedIntType;
    const plain = { type: THREE.HalfFloatType, depthBuffer: false };
    this.post = new THREE.WebGLRenderTarget(size.x, size.y, plain);
    this.graded = new THREE.WebGLRenderTarget(size.x, size.y, plain);
    this.scenePass = new RenderPass(this.scene, this.camera);
    this.water = new ShaderPass(WaterPostShader);
    // ShaderPass clones its uniforms: point the live ones back at the shared objects, or focus and time
    // would stay frozen at their initial values
    this.water.uniforms.uFocus = shared.focus;
    this.water.uniforms.uAperture = shared.aperture;
    this.water.uniforms.uTime = shared.time;
    this.water.uniforms.tDepth.value = this.target.depthTexture;
    this.bloom = new BloomPass(new THREE.Vector2(size.x, size.y), 0.14, 0.6, 0.92);
    this.output = new OutputPass();
    const fs = this.output.material.fragmentShader;
    const read = 'gl_FragColor = texture2D( tDiffuse, vUv );';
    if (!fs.includes(read)) throw new Error('OutputShader changed: the bloom has nowhere to go');
    this.output.uniforms.tBloom = { value: null };
    this.output.material.fragmentShader = fs
      .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tBloom;')
      .replace(read, 'gl_FragColor = texture2D( tDiffuse, vUv ) + texture2D( tBloom, vUv );');
    this.lens = new ShaderPass(LensShader);
    this.lens.renderToScreen = true;

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    for (const t of [this.target, this.post, this.graded]) t.setSize(w * pr, h * pr);
    this.bloom.setSize(w * pr, h * pr);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.water.uniforms.uResolution.value.set(size.x, size.y);
    this.lens.uniforms.uResolution.value.set(size.x, size.y);
    const pxScale = this.renderer.getPixelRatio() * (h / 900);
    this.water.uniforms.uPxScale.value = pxScale;
    (this.particles.material as THREE.ShaderMaterial).uniforms.uPxScale.value = pxScale;
  }

  /**
   * Adaptive quality: if we can't hold ~48 fps over a few seconds, drop the pixel ratio a notch.
   * It only ever steps down (stepping back up and down again resized the targets every few seconds,
   * which showed as flicker), and never below 1.
   */
  private adapt(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 180) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    this.frameTimes.length = 0;
    const median = sorted[sorted.length >> 1];
    const pr = this.renderer.getPixelRatio();
    if (median > 1 / 48 && pr > 1) {
      const next = Math.max(1, pr - 0.25);
      this.renderer.setPixelRatio(next);
      this.resize();
      this.quality = next;
    }
  }

  /** 0 = black (the dive starts in darkness), 1 = full light. Eased by the intro. */
  fade = 0;

  /** depth (m) nearer than which nothing is blurred: set to the book while it's held up */
  sharpNear = 0;
  /** 0..1: how much of the dome-port lens distortion to apply (none while reading) */
  barrel = 1;

  /**
   * 0..1: daylight reaching the bottom. At 0 the water is black and only the torch lights anything; it
   * scales the ambient lights, the colour the water scatters, the caustics and the surface overhead.
   */
  daylight = 1;
  /** 0..1: the torch switched on (the opening turns it on with a flicker) */
  torchOn = 1;
  private lights: THREE.Light[] = [];
  private lightBase: number[] = [];
  private waterBase = shared.waterColor.value.clone();
  private deepBase = shared.deepColor.value.clone();
  private causticBase = shared.causticStrength.value;

  private applyDaylight() {
    const d = this.daylight;
    this.lights.forEach((l, i) => (l.intensity = this.lightBase[i] * d));
    shared.waterColor.value.copy(this.waterBase).multiplyScalar(d);
    shared.deepColor.value.copy(this.deepBase).multiplyScalar(d);
    shared.causticStrength.value = this.causticBase * d;
    shared.daylight.value = d;
  }

  /** dims the torch (close up on the book in the opening shot it would blow everything out) */
  torchScale = 1;

  render(time: number, dt: number) {
    shared.time.value = time;
    const f = this.fade * this.fade;
    this.renderer.toneMappingExposure = 1.4 * f;
    this.torch.intensity = TORCH.intensity * THREE.MathUtils.smoothstep(this.fade, 0.25, 0.6) * this.torchScale * this.torchOn;
    this.applyDaylight();
    (this.particles.material as THREE.ShaderMaterial).uniforms.uCamPos.value.copy(this.camera.position);
    const u = this.water.uniforms;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    this.camera.updateMatrixWorld();
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    u.uFrame.value = this.frame++ % 64;
    this.lens.uniforms.uTime.value = time;
    this.lens.uniforms.uBarrel.value = this.barrel;
    u.uSharpNear.value = this.sharpNear;
    this.adapt(dt);
    const r = this.renderer;
    this.scenePass.render(r, this.target, this.target, dt, false);
    this.water.render(r, this.post, this.target, dt, false);
    this.output.uniforms.tBloom.value = this.bloom.bloomOf(r, this.post.texture);
    this.output.render(r, this.graded, this.post, dt, false);
    this.lens.render(r, null as unknown as THREE.WebGLRenderTarget, this.graded, dt, false);
  }
}
