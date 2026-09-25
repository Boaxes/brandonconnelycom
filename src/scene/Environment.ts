import * as THREE from 'three';
import { WORLD } from './Terrain';
import { shared } from './UnderwaterMaterial';

/** Water surface seen from below: a big plane with an animated refraction-ish shader. */
export function buildSurface(): THREE.Mesh {
  const size = WORLD.size * 2.5;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(Math.PI / 2); // face downward
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.time,
      uWaterColor: shared.waterColor,
      uSkyColor: { value: new THREE.Color(0x9fd9e6) },
      uSunColor: { value: new THREE.Color(0xfff6d8) },
      uSunDir: shared.sunDir,
      uFogDensity: shared.fogDensity,
      uDeepColor: shared.deepColor,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uWaterColor;
      uniform vec3 uSkyColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform float uFogDensity;
      uniform vec3 uDeepColor;
      varying vec3 vWorldPos;

      float wave(vec2 p, float t) {
        float w = 0.0;
        w += sin(p.x * 0.35 + t * 0.9) * 0.5;
        w += sin((p.x * 0.5 + p.y * 0.7) * 0.45 - t * 0.7) * 0.35;
        w += sin((p.y - p.x * 0.3) * 0.9 + t * 1.3) * 0.2;
        w += sin((p.x * 0.8 + p.y * 0.2) * 1.7 - t * 1.9) * 0.1;
        return w;
      }
      void main() {
        vec3 vd = normalize(vWorldPos - cameraPosition);
        vec2 p = vWorldPos.xz;
        float e = 0.6;
        float h = wave(p, uTime);
        float hx = wave(p + vec2(e, 0.0), uTime) - h;
        float hz = wave(p + vec2(0.0, e), uTime) - h;
        vec3 n = normalize(vec3(-hx, e * 1.6, -hz)); // pointing up (toward air)
        // from below: looking up at the underside; Snell's window brightens near the sun
        float facing = clamp(dot(-vd, -n), 0.0, 1.0);
        float sunSpot = pow(clamp(dot(reflect(vd, -n), -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 6.0);
        float window = pow(clamp(-vd.y, 0.0, 1.0), 1.4);
        vec3 col = mix(uWaterColor * 1.6, uSkyColor, window * 0.85);
        col += uSunColor * sunSpot * 0.9 * window;
        // wave crest highlights
        float crest = smoothstep(0.75, 1.05, h) * 0.08;
        col += vec3(crest);
        col = mix(col, uWaterColor * 1.2, 0.35 * (1.0 - facing));
        float dist = length(vWorldPos - cameraPosition);
        float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist * 0.3);
        float upness = clamp(vd.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 fogCol = mix(uDeepColor, uWaterColor, clamp(pow(upness, 0.8) * 1.15, 0.0, 1.0));
        col = mix(col, fogCol, clamp(f, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.FrontSide,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WORLD.surfaceY;
  mesh.name = 'surface';
  return mesh;
}

/** Background: a large inverted sphere with a vertical gradient (deep below, bright above). */
export function buildBackdrop(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(WORLD.size * 1.6, 24, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uWaterColor: shared.waterColor,
      uDeepColor: shared.deepColor,
      uSkyColor: { value: new THREE.Color(0x7fc6d8) },
    },
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
      uniform vec3 uWaterColor;
      uniform vec3 uDeepColor;
      uniform vec3 uSkyColor;
      varying vec3 vDir;
      void main() {
        float up = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        // must match the fog colour in UnderwaterMaterial so fogged geometry blends into the backdrop
        vec3 c = mix(uDeepColor, uWaterColor, clamp(pow(up, 0.8) * 1.15, 0.0, 1.0));
        c = mix(c, uSkyColor * 0.55, smoothstep(0.8, 1.0, up));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  m.name = 'backdrop';
  return m;
}

/** God rays: a fan of additive translucent slanted quads hanging from the surface. */
export function buildGodRays(count = 28): THREE.Group {
  const g = new THREE.Group();
  g.name = 'godrays';
  const geo = new THREE.PlaneGeometry(1, 1, 1, 8);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.time, uSunDir: shared.sunDir },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      varying float vY;
      varying float vSeed;
      varying float vX;
      void main() {
        vY = uv.y;
        vX = uv.x;
        vSeed = seed;
        vec3 p = position;
        // wobble across the width slightly over time
        p.x += sin(uTime * 0.25 + seed * 6.28 + uv.y * 3.0) * 0.6 * (1.0 - uv.y);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vY;
      varying float vSeed;
      varying float vX;
      void main() {
        float edge = smoothstep(0.0, 0.25, vX) * smoothstep(1.0, 0.75, vX);
        float flick = 0.6 + 0.4 * sin(uTime * (0.6 + vSeed) + vSeed * 20.0);
        float a = edge * pow(vY, 1.6) * flick * 0.26;
        gl_FragColor = vec4(vec3(0.7, 0.9, 1.0) * a, a);
      }
    `,
  });
  const seeds = new Float32Array(geo.attributes.position.count);
  for (let i = 0; i < seeds.length; i++) seeds[i] = 0.5;
  for (let i = 0; i < count; i++) {
    const gg = geo.clone();
    const s = new Float32Array(gg.attributes.position.count).fill(Math.random());
    gg.setAttribute('seed', new THREE.BufferAttribute(s, 1));
    const m = new THREE.Mesh(gg, mat);
    const w = 3 + Math.random() * 8;
    const h = WORLD.surfaceY * (0.7 + Math.random() * 0.5);
    m.scale.set(w, h, 1);
    m.position.set((Math.random() - 0.5) * WORLD.size * 0.9, WORLD.surfaceY - h / 2 + 1, (Math.random() - 0.5) * WORLD.size * 0.9);
    m.rotation.y = Math.random() * Math.PI;
    m.rotation.z = (Math.random() - 0.5) * 0.35;
    m.frustumCulled = false;
    m.renderOrder = 5;
    g.add(m);
  }
  return g;
}

/** Marine snow / plankton particles drifting through the volume. */
export function buildParticles(count = 2600): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = WORLD.size;
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * size;
    pos[i * 3 + 1] = Math.random() * WORLD.surfaceY;
    pos[i * 3 + 2] = (Math.random() - 0.5) * size;
    seed[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.time, uFogDensity: shared.fogDensity, uSurfaceY: shared.surfaceY },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime;
      uniform float uFogDensity;
      uniform float uSurfaceY;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * 0.12;
        p.x += sin(t + seed * 40.0) * 1.2 + t * 0.6;
        p.y += -t * 0.35 * (0.5 + seed);
        p.z += cos(t * 0.8 + seed * 30.0) * 1.2;
        p.y = mod(p.y, uSurfaceY);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = (1.0 + seed * 1.6) * (30.0 / max(d, 1.0)) + 0.6;
        float f = exp(-uFogDensity * uFogDensity * d * d);
        vA = f * (0.35 + 0.45 * seed);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = dot(c, c);
        if (r > 0.25) discard;
        float a = (1.0 - r * 4.0) * vA;
        gl_FragColor = vec4(vec3(0.85, 0.95, 1.0), a);
      }
    `,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = 'particles';
  return pts;
}

export function buildLights(): THREE.Object3D[] {
  const hemi = new THREE.HemisphereLight(0x9fd8e6, 0x3b4a3c, 1.15);
  const sun = new THREE.DirectionalLight(0xe8f8ff, 1.7);
  sun.position.copy(shared.sunDir.value).multiplyScalar(80);
  const fill = new THREE.DirectionalLight(0x2b6b7a, 0.35);
  fill.position.set(-40, 10, -30);
  return [hemi, sun, fill];
}
