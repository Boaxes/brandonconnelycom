import * as THREE from 'three';
import { stage, WORLD } from './Terrain';
import { shared, WATER_GLSL, waterUniforms } from './UnderwaterMaterial';

/** Diver's torch, in the camera's local space. Shared by the light, the particles and the beam pass. */
export const TORCH = {
  pos: new THREE.Vector3(0.18, -0.28, 0),
  dir: new THREE.Vector3(-0.03, -0.16, -1).normalize(),
  angle: Math.PI * 0.2,
  penumbra: 0.75,
  color: new THREE.Color(0xffe6c2),
  intensity: 24,
  range: 16,
};

/** Background: in-scattered water light at infinity, the same colour the materials fade to. */
export function buildBackdrop(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(WORLD.size * 1.6, 24, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...waterUniforms() },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w; // push to far plane
      }
    `,
    fragmentShader: /* glsl */ `
      ${WATER_GLSL}
      varying vec3 vDir;
      void main() { gl_FragColor = vec4(waterScatter(normalize(vDir)), 1.0); }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true, // sits on the far plane; rejected behind the page's depth card
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  m.name = 'backdrop';
  return m;
}

/**
 * Suspended silt and plankton: a dense cloud that follows the camera.
 * Particles are lit by the ambient gloom and, much more strongly, by the torch cone,
 * fade through the water like everything else, and grow into soft discs when out of focus.
 */
export function buildParticles(count = 7000): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const box = 16; // metres, cube around the camera
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * box;
    pos[i * 3 + 1] = (Math.random() - 0.5) * box;
    pos[i * 3 + 2] = (Math.random() - 0.5) * box;
    seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const outer = Math.cos(TORCH.angle);
  const inner = Math.cos(TORCH.angle * (1 - TORCH.penumbra));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...waterUniforms(),
      uTime: shared.time, uFocus: shared.focus, uAperture: shared.aperture,
      uCamPos: { value: new THREE.Vector3() }, uBox: { value: box },
      uTorchPos: { value: TORCH.pos }, uTorchDir: { value: TORCH.dir }, uTorchCos: { value: new THREE.Vector2(outer, inner) },
      uTorchColor: { value: TORCH.color }, uPxScale: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${WATER_GLSL}
      attribute float seed;
      uniform float uTime;
      uniform float uFocus;
      uniform float uAperture;
      uniform vec3 uCamPos;
      uniform float uBox;
      uniform vec3 uTorchPos;
      uniform vec3 uTorchDir;
      uniform vec2 uTorchCos;
      uniform vec3 uTorchColor;
      uniform float uPxScale;
      varying vec3 vCol;
      varying float vSoft;
      void main() {
        vec3 p = position;
        float t = uTime * 0.1;
        // slow drift with the current, individual wobble, then wrap into the cube around the camera
        p.x += t * 0.5 + sin(t * 1.3 + seed * 40.0) * 0.5;
        p.y += -t * 0.22 * (0.4 + seed) + cos(t * 0.9 + seed * 17.0) * 0.3;
        p.z += cos(t * 0.7 + seed * 30.0) * 0.5;
        p = mod(p - uCamPos + uBox * 0.5, uBox) - uBox * 0.5 + uCamPos;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        // right against the lens a flake would be a huge blurred blob: skip those
        if (d < 0.7) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

        // torch contribution (view space: the torch rides with the camera)
        vec3 L = mv.xyz - uTorchPos;
        float dl = length(L);
        float cone = smoothstep(uTorchCos.x, uTorchCos.y, dot(L / dl, uTorchDir));
        vec3 torch = uTorchColor * cone * waterTransmit(dl) / (1.0 + dl * dl * 0.35) * 2.2;
        vec3 ambient = uWaterColor * 0.9;
        float size = 0.35 + seed * 0.9 + step(0.97, seed) * 1.2;  // a few larger flakes
        vec3 lit = (ambient + torch) * (0.25 + 0.55 * seed);
        vec3 T = waterTransmit(d);
        vCol = lit * T;

        // depth of field: circle of confusion grows away from the focus distance
        float basePx = size * 18.0 / max(d, 0.3) * uPxScale;
        float coc = uAperture * abs(1.0 / uFocus - 1.0 / d) * 60.0 * uPxScale;
        float px = min(basePx + coc, 34.0 * uPxScale);
        gl_PointSize = max(px, 1.0);
        // energy spreads over the larger disc
        float spread = (basePx * basePx) / max(px * px, 1.0);
        vCol *= clamp(spread, 0.02, 1.0) * clamp(basePx, 0.0, 1.0);
        vSoft = clamp(coc / max(px, 1.0), 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vSoft;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        // in focus: soft dot; out of focus: flatter disc with a faint rim, like lens bokeh
        float dot_ = 1.0 - r * r;
        float disc = smoothstep(1.0, 0.85, r) * (0.8 + 0.3 * smoothstep(0.6, 0.95, r));
        float a = mix(dot_, disc, vSoft);
        gl_FragColor = vec4(vCol * a, 1.0);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 10;
  pts.name = 'particles';
  return pts;
}

export function buildLights(): THREE.Object3D[] {
  // dim green daylight filtering down through 18 m of plankton
  const hemi = new THREE.HemisphereLight(0x5f917a, 0x2e3d33, 2.0);
  const sun = new THREE.DirectionalLight(0xa8d0b2, 0.9);
  sun.position.copy(shared.sunDir.value).multiplyScalar(80);
  return [hemi, sun];
}

/** A diver's torch: warm spot mounted on the camera, casting soft shadows. */
export function buildTorch(): THREE.SpotLight {
  const torch = new THREE.SpotLight(TORCH.color, TORCH.intensity, TORCH.range, TORCH.angle, TORCH.penumbra, 1.4);
  torch.position.copy(TORCH.pos);
  torch.target.position.copy(TORCH.pos).add(TORCH.dir);
  torch.castShadow = true;
  torch.shadow.mapSize.set(1024, 1024); // soft (radius 5) shadows at a few metres: 1K is plenty
  torch.shadow.camera.near = 0.2;
  torch.shadow.camera.far = TORCH.range;
  torch.shadow.bias = -0.0006;
  torch.shadow.normalBias = 0.06;
  torch.shadow.radius = 5;
  torch.name = 'torch';
  return torch;
}

const _aim = new THREE.Vector3();
/**
 * The diver points the torch at what they're watching: it eases toward `target` (world space), or,
 * with nothing to watch, slowly sweeps between the two strips of scene beside the page.
 */
export function aimTorch(torch: THREE.SpotLight, camera: THREE.Camera, target: THREE.Vector3 | null, sweep: THREE.Vector3, dt: number) {
  camera.updateMatrixWorld();
  _aim.copy(target ?? sweep);
  camera.worldToLocal(_aim).sub(TORCH.pos).normalize();
  TORCH.dir.lerp(_aim, Math.min(1, dt * (target ? 1.6 : 0.5))).normalize();
  torch.target.position.copy(TORCH.pos).add(TORCH.dir);
}

/**
 * The underside of the surface, 30 ft up. Straight overhead is Snell's window: the sky squeezed into a
 * bright disc (~97° across) that shimmers with the waves; outside it the surface is a dim mirror of the
 * depths. Seen through 9 m of murk it reads as a soft green glow with moving light, which is what you
 * get looking up on a real dive.
 */
export function buildSurface(): THREE.Mesh {
  const s = stage();
  const geo = new THREE.PlaneGeometry(160, 160, 1, 1);
  geo.rotateX(Math.PI / 2); // facing down
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...waterUniforms(), uTime: shared.time, uSunDir: shared.sunDir },
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${WATER_GLSL}
      uniform float uTime;
      varying vec3 vWorld;
      uniform vec3 uSunDir;
      // A rough sea seen from below. The surface height is three long swells plus three octaves of
      // drifting noise chop (each octave rotated and moving its own way, so nothing lines up into a
      // pattern). Its slope bends the view ray: where the surface tilts past the critical angle it becomes
      // a mirror of the dark water below, so Snell's window breaks into moving bright and dark facets
      // instead of a calm disc; troughs focus the light and crests spread it.
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y) * 2.0 - 1.0;
      }
      float height(vec2 p, float t, float fw) {
        float h = 0.0;
        h += 0.34 * sin(dot(p, vec2(0.80, 0.60)) * 0.57 - t * 0.74);
        h += 0.22 * sin(dot(p, vec2(0.34, 0.94)) * 0.9 - t * 0.94 + 1.3);
        h += 0.14 * sin(dot(p, vec2(0.97, -0.24)) * 1.37 - t * 1.16 + 4.1);
        float amp = 0.13;
        float f = 0.7;
        mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
        vec2 q = p;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float keep = 1.0 - smoothstep(0.25, 0.9, f * fw);
          vec2 drift = vec2(cos(fi * 2.1 + 0.4), sin(fi * 2.1 + 0.4)) * sqrt(9.81 / (6.2831853 * f)) * 0.35;
          h += amp * keep * vnoise(q * f + drift * t * f);
          q = rot * q;
          f *= 2.03;
          amp *= 0.42;
        }
        return h;
      }
      void main() {
        vec3 fromCam = vWorld - cameraPosition;
        vec3 v = normalize(fromCam);
        vec2 p = vWorld.xz;
        float fw = length(fwidth(p));
        float e = max(0.06, fw);
        float h0 = height(p, uTime, fw);
        float hx = height(p + vec2(e, 0.0), uTime, fw);
        float hz = height(p + vec2(0.0, e), uTime, fw);
        float hx2 = height(p - vec2(e, 0.0), uTime, fw);
        float hz2 = height(p - vec2(0.0, e), uTime, fw);
        vec2 g = vec2(hx - hx2, hz - hz2) / (2.0 * e);
        float curv = (hx + hx2 + hz + hz2 - 4.0 * h0) / (e * e);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        // water to air: the normal facing the viewer points down
        vec3 r = refract(v, -n, 1.333);
        float cosi = clamp(dot(v, n), 0.0, 1.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);
        float through = dot(r, r) > 1e-4 ? (1.0 - fres) : 0.0;
        // near the critical angle the light thins out rather than cutting off
        through *= smoothstep(0.6, 0.8, cosi);
        vec3 sky = vec3(0.6, 0.84, 0.8) * (1.2 + 1.3 * pow(max(r.y, 0.0), 2.0));
        sky += vec3(1.0, 0.95, 0.8) * pow(max(dot(r, uSunDir), 0.0), 40.0) * 4.0;
        sky *= clamp(1.0 + curv * 0.12, 0.6, 1.8);
        vec3 mirror = mix(uDeepColor, uWaterColor, 0.35) * (0.8 + 0.2 * clamp(-curv * 0.3, -1.0, 1.0));
        vec3 c = mix(mirror, sky, through);
        gl_FragColor = vec4(applyWater(c, fromCam), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(s.cam.x, WORLD.surfaceY, s.cam.z);
  m.renderOrder = -5;
  m.frustumCulled = false;
  m.name = 'surface';
  return m;
}
