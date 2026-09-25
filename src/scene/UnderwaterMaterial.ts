import * as THREE from 'three';

/**
 * One shared material recipe for everything in the water.
 * Patches MeshStandardMaterial with:
 *   - procedural swim / sway deformation driven by uv.x (position along spine)
 *     and uv.y (part id: 0 body, 0.5 fin, 1 appendage)
 *   - projected caustic light on upward-facing surfaces
 *   - depth-based light attenuation and distance fog toward the water colour
 */

export const shared = {
  time: { value: 0 },
  surfaceY: { value: 22 },
  // Puget Sound at ~18 m: green-brown gloom, a few metres of visibility
  waterColor: { value: new THREE.Color(0x24463c) },
  deepColor: { value: new THREE.Color(0x102420) },
  fogDensity: { value: 0.125 },
  causticStrength: { value: 0.25 },
  sunDir: { value: new THREE.Vector3(0.3, 1, 0.2).normalize() },
};

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

const vertexHead = /* glsl */ `
uniform float uTime;
uniform vec4 uSwim;
uniform vec4 uSwim2;
attribute float instPhase;
attribute float instSpeed;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

vec3 swimOffset(vec3 p, vec2 uv, float phase, float speedMul) {
  float u = uv.x;
  float part = uv.y;
  // phase is integrated on the CPU per instance (speed changes stay continuous);
  // non-instanced meshes fall back to clock time
  float t = phase + uTime * uSwim.z * speedMul;
  float amp = uSwim.x;
  float bodyStart = uSwim2.x;
  vec3 o = vec3(0.0);
  if (part < 0.75) {
    // body + fins: travelling wave increasing toward the tail
    float f = smoothstep(bodyStart, 1.0, u);
    f = f * f;
    float w = sin(u * uSwim.y * 6.2831 - t) * amp * f;
    if (uSwim.w > 0.5) o.y += w; else o.z += w;
    // gentle roll of the head counter to the tail
    float h = (1.0 - smoothstep(0.0, bodyStart, u)) * amp * 0.12 * sin(-t);
    if (uSwim.w > 0.5) o.y += h; else o.z += h;
  } else {
    // appendages: tentacles, legs, blades. sway with u, both axes
    float a = uSwim2.z * u * u;
    o.x += sin(t * 0.7 + phase * 3.0 + u * 3.0) * a;
    o.z += cos(t * 0.55 + phase * 2.0 + u * 2.5) * a;
    o.y += sin(t * 0.9 + phase + u * 4.0) * a * 0.4;
  }
  return o;
}
`;

const fragmentHead = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uWaterColor;
uniform vec3 uDeepColor;
uniform float uFogDensity;
uniform float uCausticStrength;
uniform vec3 uSunDir;
uniform vec3 uTint;
uniform vec4 uEmissive;
uniform float uDetail;
uniform sampler2D tSand;
uniform sampler2D tSandN;
uniform sampler2D tGravel;
uniform sampler2D tGravelN;
uniform sampler2D tRock;
uniform sampler2D tRockN;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
vec3 gNormalOverride = vec3(0.0);

// perturb a world normal with a tangent-space normal map sample on a horizontal surface
vec3 perturbUp(vec3 n, vec3 tn, float strength) {
  vec3 helper = abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(n, helper));
  vec3 b = normalize(cross(t, n));
  vec3 d = normalize(t * tn.x + b * tn.y + n * max(tn.z, 0.05) / max(strength, 0.001));
  return d;
}

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

float causticPattern(vec2 p, float t) {
  // cheap animated caustic: layered warped sine bands
  vec2 q = p;
  q += 0.35 * vec2(sin(p.y * 0.9 + t * 0.6), cos(p.x * 0.8 - t * 0.5));
  float a = sin(q.x * 1.7 + t * 0.9) * sin(q.y * 1.5 - t * 0.7);
  float b = sin((q.x + q.y) * 1.1 - t * 0.8) * sin((q.x - q.y) * 1.3 + t * 0.6);
  float c = abs(a) * 0.6 + abs(b) * 0.4;
  c = pow(c, 3.0);
  vec2 q2 = p * 2.3 + vec2(t * 0.15, -t * 0.1);
  float d = abs(sin(q2.x * 1.3 + sin(q2.y * 1.1 + t)) * sin(q2.y * 1.2 - t * 0.5));
  d = pow(d, 4.0);
  return c * 1.1 + d * 0.5;
}
`;

export function patchMaterial(mat: THREE.Material, u: UnderwaterUniforms) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uSurfaceY = shared.surfaceY;
    shader.uniforms.uWaterColor = shared.waterColor;
    shader.uniforms.uDeepColor = shared.deepColor;
    shader.uniforms.uFogDensity = shared.fogDensity;
    shader.uniforms.uCausticStrength = shared.causticStrength;
    shader.uniforms.uSunDir = shared.sunDir;
    shader.uniforms.uSwim = u.uSwim;
    shader.uniforms.uSwim2 = u.uSwim2;
    shader.uniforms.uTint = u.uTint;
    shader.uniforms.uEmissive = u.uEmissive;
    shader.uniforms.uDetail = u.uDetail;
    shader.uniforms.tSand = u.tSand;
    shader.uniforms.tSandN = u.tSandN;
    shader.uniforms.tGravel = u.tGravel;
    shader.uniforms.tGravelN = u.tGravelN;
    shader.uniforms.tRock = u.tRock;
    shader.uniforms.tRockN = u.tRockN;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + vertexHead)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase_ = instPhase + uSwim2.y;
          float speedMul_ = 0.0;
        #else
          float phase_ = uSwim2.y;
          float speedMul_ = uSwim2.w;
        #endif
        transformed += swimOffset(position, uv, phase_, speedMul_);
        `,
      )
      .replace(
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

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + fragmentHead)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        diffuseColor.rgb *= uTint;
        if (uDetail < 0.5) {
          // creature skin: fine mottle and a faint darker top-to-bottom gradient in model space
          float m = vnoise(vWorldPos.xz * 9.0 + vWorldPos.y * 5.0) * 0.5 + vnoise(vWorldPos.xy * 23.0) * 0.5;
          diffuseColor.rgb *= 0.9 + m * 0.2;
        }
        if (uDetail > 0.5 && uDetail < 1.5) {
          // seafloor: sand / gravel blended by noise, tiled at two scales to hide repetition
          vec2 p = vWorldPos.xz;
          vec2 uv1 = p * 0.22;
          vec2 uv2 = p * 0.045 + 3.1;
          float blend = smoothstep(0.35, 0.65, vnoise(p * 0.06 + 11.0) * 0.7 + vnoise(p * 0.2) * 0.3);
          float slope = 1.0 - clamp(normalize(vWorldNormal).y, 0.0, 1.0);
          blend = clamp(blend + slope * 1.5, 0.0, 1.0);
          vec3 sand = mix(texture2D(tSand, uv1).rgb, texture2D(tSand, uv2).rgb, 0.5);
          sand *= 0.85 + 0.3 * texture2D(tSand, p * 1.1 + 0.37).g;  // close-range grain
          vec3 grav = mix(texture2D(tGravel, uv1).rgb, texture2D(tGravel, uv2 * 1.7).rgb, 0.5);
          vec3 tex = mix(sand, grav, blend);
          // cold silt tint, keep vertex colour as broad variation
          tex *= vec3(0.78, 0.82, 0.74);
          diffuseColor.rgb = tex * mix(vec3(1.0), diffuseColor.rgb * 1.7, 0.45);
          vec3 tn = mix(texture2D(tSandN, uv1).xyz, texture2D(tGravelN, uv1).xyz, blend) * 2.0 - 1.0;
          gNormalOverride = perturbUp(normalize(vWorldNormal), tn, 0.9);
        } else if (uDetail > 1.5) {
          // rocks: triplanar rock texture
          vec3 n = abs(normalize(vWorldNormal));
          n = n / (n.x + n.y + n.z);
          vec3 p = vWorldPos * 0.35;
          vec3 tx = texture2D(tRock, p.zy).rgb * n.x + texture2D(tRock, p.xz).rgb * n.y + texture2D(tRock, p.xy).rgb * n.z;
          diffuseColor.rgb = tx * vec3(0.7, 0.74, 0.7) * mix(vec3(1.0), diffuseColor.rgb * 2.0, 0.3);
          vec3 tn = (texture2D(tRockN, p.zy).xyz * n.x + texture2D(tRockN, p.xz).xyz * n.y + texture2D(tRockN, p.xy).xyz * n.z) * 2.0 - 1.0;
          gNormalOverride = perturbUp(normalize(vWorldNormal), tn, 0.7);
        }
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>
        if (uDetail > 0.5) {
          normal = normalize((viewMatrix * vec4(gNormalOverride, 0.0)).xyz);
        }
        `,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `
        #include <lights_fragment_end>
        {
          // caustics: project along sun direction, modulate by facing and depth
          vec3 n = normalize(vWorldNormal);
          float up = clamp(dot(n, uSunDir), 0.0, 1.0);
          float depth = clamp((uSurfaceY - vWorldPos.y) / uSurfaceY, 0.0, 1.0);
          float depthAtt = mix(1.0, 0.55, depth);
          vec2 pp = vWorldPos.xz + vWorldPos.y * 0.18 * uSunDir.xz;
          float c = causticPattern(pp * 0.55, uTime * 0.7);
          vec3 caustic = vec3(0.8, 0.97, 1.0) * c * up * uCausticStrength * depthAtt * 1.6;
          reflectedLight.directDiffuse += diffuseColor.rgb * caustic;
          // ambient darkens with depth
          reflectedLight.indirectDiffuse *= mix(1.0, 0.6, depth);
          // fresnel rim: light wrapping around wet bodies
          vec3 vdir = normalize(cameraPosition - vWorldPos);
          float rim = pow(1.0 - clamp(dot(n, vdir), 0.0, 1.0), 3.0);
          reflectedLight.indirectDiffuse += uWaterColor * rim * 0.35 * (uDetail < 0.5 ? 1.0 : 0.3);
        }
        `,
      )
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `
        {
          float dist = length(vWorldPos - cameraPosition);
          float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          f = clamp(f, 0.0, 1.0);
          // fog colour: lighter when looking up toward the surface
          vec3 vd = normalize(vWorldPos - cameraPosition);
          float upness = clamp(vd.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 fogCol = mix(uDeepColor, uWaterColor, clamp(pow(upness, 1.2) * 1.05, 0.0, 1.0));
          gl_FragColor.rgb += uEmissive.rgb * uEmissive.w;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, f);
        }
        `,
      );
  };
  // ensure a unique program per swim configuration
  mat.customProgramCacheKey = () => 'underwater';
}

export function makeUniforms(swim?: Partial<SwimParams>, opts?: { tint?: THREE.Color; appendageAmp?: number }): UnderwaterUniforms {
  const s: SwimParams = { amp: 0, freq: 0.9, speed: 4, axis: 0, bodyStart: 0.3, ...swim };
  return {
    uSwim: { value: new THREE.Vector4(s.amp, s.freq, s.speed, s.axis) },
    uSwim2: { value: new THREE.Vector4(s.bodyStart, 0, opts?.appendageAmp ?? 0, 1) },
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
  detail?: number;
}) {
  const mat = new THREE.MeshStandardMaterial({
    flatShading: true,
    vertexColors: opts?.vertexColors ?? true,
    roughness: opts?.roughness ?? 0.85,
    metalness: 0.0,
    transparent: opts?.transparent ?? false,
    opacity: opts?.opacity ?? 1,
    color: opts?.color ?? 0xffffff,
    side: opts?.side ?? THREE.FrontSide,
    emissive: opts?.emissive ?? 0x000000,
  });
  const uniforms = makeUniforms(swim, opts);
  if (opts?.detail) uniforms.uDetail.value = opts.detail;
  patchMaterial(mat, uniforms);
  return { mat, uniforms };
}
