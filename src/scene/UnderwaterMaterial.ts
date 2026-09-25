import * as THREE from 'three';

/**
 * One shared material recipe for everything in the water.
 * Patches MeshStandardMaterial with:
 *   - procedural swim / sway deformation driven by the `swim` attribute
 *     (x = position along spine / appendage, y = part id: 0 body, 0.5 fin, 1 appendage)
 *   - faint projected caustics on upward-facing surfaces
 *   - contact occlusion on the seafloor from nearby rocks and animals
 *   - water: per-channel absorption along the view path (red dies first) plus in-scattering
 */

export const OCC_MAX = 48;

export const shared = {
  time: { value: 0 },
  surfaceY: { value: 22 },
  // in-scattered light at infinity, looking up (waterColor) and looking down (deepColor)
  waterColor: { value: new THREE.Color(0x24463c) },
  deepColor: { value: new THREE.Color(0x0f221d) },
  // extinction per metre for r, g, b. Red is absorbed fastest; the plankton makes blue drop too.
  absorb: { value: new THREE.Vector3(0.42, 0.24, 0.3) },
  causticStrength: { value: 0.22 },
  sunDir: { value: new THREE.Vector3(0.3, 1, 0.2).normalize() },
  // contact occluders on the floor: (x, z, radius, strength)
  occ: { value: Array.from({ length: OCC_MAX }, () => new THREE.Vector4()) },
  occCount: { value: 0 },
  // camera focus (m) and aperture, shared by the DOF pass and the particles
  focus: { value: 4 },
  aperture: { value: 0.22 },
};

/** GLSL shared by every shader that needs to look through the water. */
export const WATER_GLSL = /* glsl */ `
uniform vec3 uWaterColor;
uniform vec3 uDeepColor;
uniform vec3 uAbsorb;
vec3 waterScatter(vec3 dir) {
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(uDeepColor, uWaterColor, clamp(pow(up, 1.3) * 1.08, 0.0, 1.0));
}
vec3 waterTransmit(float d) { return exp(-uAbsorb * d); }
vec3 applyWater(vec3 c, vec3 fromCam) {
  float d = max(length(fromCam), 1e-4);
  vec3 T = waterTransmit(d);
  return c * T + waterScatter(fromCam / d) * (1.0 - T);
}
`;

export function waterUniforms() {
  return { uWaterColor: shared.waterColor, uDeepColor: shared.deepColor, uAbsorb: shared.absorb };
}

export interface SwimParams {
  amp: number;      // lateral amplitude at the tail (model units)
  freq: number;     // waves along the body
  speed: number;    // rad/s
  axis: number;     // 0 = lateral (fish), 1 = vertical (cetaceans/seals)
  bodyStart: number; // u at which the body begins to flex (head stays stiff)
}

export interface UnderwaterUniforms {
  uSwim: { value: THREE.Vector4 };  // amp, freq, speed, axis
  uSwim2: { value: THREE.Vector4 }; // bodyStart, phase, appendageAmp, speedMul
  uSwim3: { value: THREE.Vector4 }; // body length (m), bend gain, mode (0 swim, 1 crab gait, 2 jelly bell), translucency
  uTint: { value: THREE.Color };
  uEmissive: { value: THREE.Vector4 }; // rgb glow, strength
  uDetail: { value: number };          // 1 = seafloor (textured), 2 = rock (triplanar)
  tSand: { value: THREE.Texture | null };
  tSandN: { value: THREE.Texture | null };
  tGravel: { value: THREE.Texture | null };
  tGravelN: { value: THREE.Texture | null };
  tRock: { value: THREE.Texture | null };
  tRockN: { value: THREE.Texture | null };
}

const SWIM_GLSL = /* glsl */ `
uniform float uTime;
uniform vec4 uSwim;
uniform vec4 uSwim2;
uniform vec4 uSwim3;
attribute vec2 swim;
attribute float instPhase;
attribute float instSpeed;
attribute float instBend;

// p: model-space position, s: swim coords, walk: 0..1 locomotion intensity, bend: turn rate
vec3 swimOffset(vec3 p, vec2 s, float phase, float speedMul, float walk, float bend) {
  float u = s.x;
  float part = s.y;
  // phase is integrated on the CPU per instance (speed changes stay continuous);
  // non-instanced meshes fall back to clock time
  float t = phase + uTime * uSwim.z * speedMul;
  float amp = uSwim.x;
  float bodyStart = uSwim2.x;
  float mode = uSwim3.z;
  vec3 o = vec3(0.0);
  if (mode > 1.5) {
    // jelly: the bell contracts on each pulse, tentacles trail
    float c = max(0.0, sin(t));
    c = c * c;
    if (part < 0.75) {
      o.xz -= p.xz * 0.16 * c;
      o.y += p.y * 0.12 * c;
    } else {
      float a = uSwim2.z * u * u;
      o.x += sin(t * 0.5 + phase * 3.0 + u * 3.0) * a;
      o.z += cos(t * 0.4 + phase * 2.0 + u * 2.5) * a;
      o.y += (c * 0.15 - 0.05) * u * a * 4.0;
    }
    return o;
  }
  if (part < 0.75) {
    // body + fins: travelling wave increasing toward the tail
    float f = smoothstep(bodyStart, 1.0, u);
    f = f * f;
    float w = sin(u * uSwim.y * 6.2831 - t) * amp * f;
    if (uSwim.w > 0.5) o.y += w; else o.z += w;
    // gentle counter-yaw of the head
    float h = (1.0 - smoothstep(0.0, bodyStart, u)) * amp * 0.12 * sin(-t);
    if (uSwim.w > 0.5) o.y += h; else o.z += h;
    // curve the whole body into turns: head and tail swing toward the inside of the arc
    float k = u - 0.4;
    o.z -= bend * uSwim3.y * uSwim3.x * k * k;
  } else if (mode > 0.5) {
    // crab legs: alternating stepping when walking, a slight idle twitch otherwise
    float side = p.z > 0.0 ? 1.0 : -1.0;
    float legPhase = side * 1.5708 + p.x * 40.0;
    float step_ = t * 1.6 + legPhase;
    float lift = max(0.0, sin(step_));
    float a = uSwim2.z * u;
    o.y += lift * a * 5.0 * walk;
    o.x += cos(step_) * a * 3.0 * walk;
    o.y += sin(t * 0.8 + legPhase) * a * 0.4 * (1.0 - walk);
  } else {
    // appendages: tentacles, kelp blades. sway with u, both axes
    float a = uSwim2.z * u * u;
    o.x += sin(t * 0.7 + phase * 3.0 + u * 3.0) * a;
    o.z += cos(t * 0.55 + phase * 2.0 + u * 2.5) * a;
    o.y += sin(t * 0.9 + phase + u * 4.0) * a * 0.4;
  }
  return o;
}
`;

const SWIM_BEGIN = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  float phase_ = instPhase + uSwim2.y;
  float speedMul_ = 0.0;
  float walk_ = clamp(instSpeed - 0.7, 0.0, 1.0);
  float bend_ = instBend;
#else
  float phase_ = uSwim2.y;
  float speedMul_ = uSwim2.w;
  float walk_ = 0.0;
  float bend_ = 0.0;
#endif
transformed += swimOffset(position, swim, phase_, speedMul_, walk_, bend_);
`;

const fragmentHead = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform float uCausticStrength;
uniform vec3 uSunDir;
uniform vec3 uTint;
uniform vec4 uEmissive;
uniform float uDetail;
uniform vec4 uSwim3;
uniform sampler2D tSand;
uniform sampler2D tSandN;
uniform sampler2D tGravel;
uniform sampler2D tGravelN;
uniform sampler2D tRock;
uniform sampler2D tRockN;
uniform vec4 uOcc[${OCC_MAX}];
uniform int uOccCount;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
vec3 gNormalOverride = vec3(0.0);
${WATER_GLSL}

// perturb a world normal with a tangent-space normal map sample
vec3 perturbUp(vec3 n, vec3 tn, float strength) {
  vec3 helper = abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(n, helper));
  vec3 b = normalize(cross(t, n));
  return normalize(t * tn.x + b * tn.y + n * max(tn.z, 0.05) / max(strength, 0.001));
}

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

float causticPattern(vec2 p, float t) {
  vec2 q = p;
  q += 0.35 * vec2(sin(p.y * 0.9 + t * 0.6), cos(p.x * 0.8 - t * 0.5));
  float a = sin(q.x * 1.7 + t * 0.9) * sin(q.y * 1.5 - t * 0.7);
  float b = sin((q.x + q.y) * 1.1 - t * 0.8) * sin((q.x - q.y) * 1.3 + t * 0.6);
  float c = pow(abs(a) * 0.6 + abs(b) * 0.4, 3.0);
  vec2 q2 = p * 2.3 + vec2(t * 0.15, -t * 0.1);
  float d = pow(abs(sin(q2.x * 1.3 + sin(q2.y * 1.1 + t)) * sin(q2.y * 1.2 - t * 0.5)), 4.0);
  return c * 1.1 + d * 0.5;
}

// soft darkening of the floor under rocks and animals
float contactAO(vec3 p) {
  float ao = 1.0;
  for (int i = 0; i < ${OCC_MAX}; i++) {
    if (i >= uOccCount) break;
    vec4 o = uOcc[i];
    vec2 d = p.xz - o.xy;
    float k = dot(d, d) / (o.z * o.z);
    ao *= 1.0 - o.w * exp(-k * 2.4);
  }
  return ao;
}
`;

function injectVertex(vs: string, withWorld: boolean) {
  let out = vs.replace('#include <common>', '#include <common>\n' + SWIM_GLSL + (withWorld ? 'varying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\n' : ''))
    .replace('#include <begin_vertex>', SWIM_BEGIN);
  if (withWorld) {
    out = out.replace(
      '#include <worldpos_vertex>',
      /* glsl */ `
      #include <worldpos_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        vWorldPos = wp.xyz;
        vec3 tn = objectNormal;
        #ifdef USE_INSTANCING
          tn = mat3(instanceMatrix) * tn;
        #endif
        vWorldNormal = normalize(mat3(modelMatrix) * tn);
      }
      `,
    );
  }
  return out;
}

export function patchMaterial(mat: THREE.Material, u: UnderwaterUniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms(), {
      uTime: shared.time,
      uSurfaceY: shared.surfaceY,
      uCausticStrength: shared.causticStrength,
      uSunDir: shared.sunDir,
      uOcc: shared.occ,
      uOccCount: shared.occCount,
    }, u);

    shader.vertexShader = injectVertex(shader.vertexShader, true);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + fragmentHead)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        diffuseColor.rgb *= uTint;
        if (uDetail > 0.5 && uDetail < 1.5) {
          // seafloor: sand / gravel blended by noise, tiled at two scales to hide repetition
          vec2 p = vWorldPos.xz;
          vec2 uv1 = p * 0.22;
          vec2 uv2 = p * 0.045 + 3.1;
          float blend = smoothstep(0.35, 0.65, vnoise(p * 0.06 + 11.0) * 0.7 + vnoise(p * 0.2) * 0.3);
          float slope = 1.0 - clamp(normalize(vWorldNormal).y, 0.0, 1.0);
          blend = clamp(blend + slope * 1.5, 0.0, 1.0);
          vec3 sand = mix(texture2D(tSand, uv1).rgb, texture2D(tSand, uv2).rgb, 0.5);
          sand *= 0.85 + 0.3 * texture2D(tSand, p * 1.1 + 0.37).g;
          vec3 grav = mix(texture2D(tGravel, uv1).rgb, texture2D(tGravel, uv2 * 1.7).rgb, 0.5);
          vec3 tex = mix(sand, grav, blend);
          tex *= vec3(0.74, 0.78, 0.7);  // cold silt tint
          diffuseColor.rgb = tex * mix(vec3(1.0), diffuseColor.rgb * 1.7, 0.45);
          vec3 tn = mix(texture2D(tSandN, uv1).xyz, texture2D(tGravelN, uv1).xyz, blend) * 2.0 - 1.0;
          gNormalOverride = perturbUp(normalize(vWorldNormal), tn, 0.9);
        } else if (uDetail > 1.5) {
          // rocks: triplanar rock texture
          vec3 n = abs(normalize(vWorldNormal));
          n = n / (n.x + n.y + n.z);
          vec3 p = vWorldPos * 0.35;
          vec3 tx = texture2D(tRock, p.zy).rgb * n.x + texture2D(tRock, p.xz).rgb * n.y + texture2D(tRock, p.xy).rgb * n.z;
          diffuseColor.rgb = tx * vec3(0.62, 0.66, 0.62) * mix(vec3(1.0), diffuseColor.rgb * 2.0, 0.3);
          vec3 tn = (texture2D(tRockN, p.zy).xyz * n.x + texture2D(tRockN, p.xz).xyz * n.y + texture2D(tRockN, p.xy).xyz * n.z) * 2.0 - 1.0;
          gNormalOverride = perturbUp(normalize(vWorldNormal), tn, 0.7);
        }
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>
        if (uDetail > 0.5) normal = normalize((viewMatrix * vec4(gNormalOverride, 0.0)).xyz);
        `,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        {
          vec3 n = normalize(vWorldNormal);
          float up = clamp(dot(n, uSunDir), 0.0, 1.0);
          float depth = clamp((uSurfaceY - vWorldPos.y) / uSurfaceY, 0.0, 1.0);
          vec2 pp = vWorldPos.xz + vWorldPos.y * 0.18 * uSunDir.xz;
          float c = causticPattern(pp * 0.55, uTime * 0.7);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.8, 0.97, 1.0) * c * up * uCausticStrength * mix(1.0, 0.55, depth) * 1.6;
          reflectedLight.indirectDiffuse *= mix(1.0, 0.6, depth);
          if (uDetail > 0.5 && uDetail < 1.5) {
            float ao = contactAO(vWorldPos);
            reflectedLight.indirectDiffuse *= ao;
            reflectedLight.directDiffuse *= mix(1.0, ao, 0.6);
          }
          // wet rim: a little of the water's light wraps around bodies
          vec3 vdir = normalize(cameraPosition - vWorldPos);
          float rim = pow(1.0 - clamp(dot(n, vdir), 0.0, 1.0), 3.0);
          reflectedLight.indirectDiffuse += uWaterColor * rim * (uDetail < 0.5 ? 0.3 : 0.08);
          // thin living tissue (jellies, kelp, tentacles): light passes through instead of stopping at
          // the surface. Undersides glow with the down-welling water light, and silhouettes (more tissue
          // along the ray) brighten, which is what makes a jelly's rim or a kelp blade read as translucent.
          if (uSwim3.w > 0.0) {
            float through = clamp(-dot(n, uSunDir), 0.0, 1.0);
            float edge = pow(1.0 - abs(dot(n, vdir)), 1.5);
            vec3 lit = uWaterColor * (0.55 + 1.3 * through) + reflectedLight.directDiffuse * 0.35;
            reflectedLight.indirectDiffuse += diffuseColor.rgb * lit * uSwim3.w * (0.45 + 1.1 * edge);
          }
        }
        `,
      )
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `
        gl_FragColor.rgb += uEmissive.rgb * uEmissive.w;
        if (uSwim3.z > 1.5) {
          // jelly: glassy, you see through the middle of the bell and the tissue shows at the silhouette
          float facing = abs(dot(normalize(vWorldNormal), normalize(cameraPosition - vWorldPos)));
          gl_FragColor.a *= mix(1.0, 0.22, facing * facing);
        }
        gl_FragColor.rgb = applyWater(gl_FragColor.rgb, vWorldPos - cameraPosition);
        `,
      );
  };
  mat.customProgramCacheKey = () => 'underwater-v3';
}

/** Depth material for the torch's shadow map that deforms exactly like the colour pass. */
export function makeDepthMaterial(u: UnderwaterUniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime: shared.time, uSwim: u.uSwim, uSwim2: u.uSwim2, uSwim3: u.uSwim3 });
    shader.vertexShader = injectVertex(shader.vertexShader, false);
  };
  m.customProgramCacheKey = () => 'underwater-depth-v3';
  return m;
}

export function makeUniforms(swim?: Partial<SwimParams>, opts?: { tint?: THREE.Color; appendageAmp?: number; mode?: number; translucency?: number }): UnderwaterUniforms {
  const s: SwimParams = { amp: 0, freq: 0.9, speed: 4, axis: 0, bodyStart: 0.3, ...swim };
  return {
    uSwim: { value: new THREE.Vector4(s.amp, s.freq, s.speed, s.axis) },
    uSwim2: { value: new THREE.Vector4(s.bodyStart, 0, opts?.appendageAmp ?? 0, 1) },
    uSwim3: { value: new THREE.Vector4(1, 0, opts?.mode ?? 0, opts?.translucency ?? 0) },
    uTint: { value: opts?.tint ?? new THREE.Color(1, 1, 1) },
    uEmissive: { value: new THREE.Vector4(0, 0, 0, 0) },
    uDetail: { value: 0 },
    tSand: { value: null }, tSandN: { value: null }, tGravel: { value: null }, tGravelN: { value: null },
    tRock: { value: null }, tRockN: { value: null },
  };
}

export function makeMaterial(swim?: Partial<SwimParams>, opts?: {
  tint?: THREE.Color; appendageAmp?: number; roughness?: number; transparent?: boolean; opacity?: number;
  vertexColors?: boolean; color?: THREE.ColorRepresentation; side?: THREE.Side; emissive?: THREE.ColorRepresentation;
  detail?: number; flat?: boolean; mode?: number; map?: THREE.Texture; normalMap?: THREE.Texture; translucency?: number;
}) {
  const mat = new THREE.MeshStandardMaterial({
    flatShading: opts?.flat ?? false,
    vertexColors: opts?.vertexColors ?? true,
    roughness: opts?.roughness ?? 0.85,
    metalness: 0.0,
    transparent: opts?.transparent ?? false,
    opacity: opts?.opacity ?? 1,
    color: opts?.color ?? 0xffffff,
    side: opts?.side ?? THREE.FrontSide,
    emissive: opts?.emissive ?? 0x000000,
    map: opts?.map ?? null,
    normalMap: opts?.normalMap ?? null,
  });
  const uniforms = makeUniforms(swim, opts);
  if (opts?.detail) uniforms.uDetail.value = opts.detail;
  patchMaterial(mat, uniforms);
  return { mat, uniforms };
}

/** Geometries without a swim attribute (terrain, rocks) get a zero one so the shader is uniform. */
export function ensureSwim(geo: THREE.BufferGeometry, fromUv = false) {
  if (geo.getAttribute('swim')) return;
  const n = geo.getAttribute('position').count;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const arr = new Float32Array(n * 2);
  if (fromUv && uv) for (let i = 0; i < n; i++) { arr[i * 2] = uv.getX(i); arr[i * 2 + 1] = uv.getY(i); }
  geo.setAttribute('swim', new THREE.BufferAttribute(arr, 2));
}
