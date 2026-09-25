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
  waterColor: { value: new THREE.Color(0x1c6f80) },
  deepColor: { value: new THREE.Color(0x0a3947) },
  fogDensity: { value: 0.019 },
  causticStrength: { value: 0.7 },
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
  uDetail: { value: number };          // 1 = seafloor: procedural ripples + mottling
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
  float t = uTime * uSwim.z * speedMul + phase;
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
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

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

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + vertexHead)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase_ = instPhase + uSwim2.y;
          float speedMul_ = instSpeed;
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
        if (uDetail > 0.5) {
          // sand ripples: bands warped by low-frequency noise, plus dark silt mottling
          vec2 p = vWorldPos.xz;
          float warp = vnoise(p * 0.15) * 4.0;
          float ripple = sin(p.x * 2.6 + p.y * 0.9 + warp) * 0.5 + 0.5;
          ripple = smoothstep(0.2, 0.9, ripple);
          float mottle = vnoise(p * 0.35 + 7.0) * 0.6 + vnoise(p * 1.3) * 0.4;
          diffuseColor.rgb *= 0.86 + ripple * 0.18;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.78, 0.7), smoothstep(0.55, 0.8, mottle));
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
          reflectedLight.indirectDiffuse *= mix(1.0, 0.45, depth);
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
          vec3 fogCol = mix(uDeepColor, uWaterColor, pow(upness, 0.8) * 1.15);
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
  };
}

export function makeMaterial(swim?: Partial<SwimParams>, opts?: {
  tint?: THREE.Color; appendageAmp?: number; roughness?: number; transparent?: boolean; opacity?: number;
  vertexColors?: boolean; color?: THREE.ColorRepresentation; side?: THREE.Side; emissive?: THREE.ColorRepresentation;
  detail?: boolean;
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
  if (opts?.detail) uniforms.uDetail.value = 1;
  patchMaterial(mat, uniforms);
  return { mat, uniforms };
}
