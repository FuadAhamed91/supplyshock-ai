// Stylised water for the diorama, built on MeshStandardMaterial so lights,
// shadows, fog and reflections still apply. The sea shades from pale shallows
// to deeper blue away from the shore, foams along the coast and the quay and
// carries two layers of drifting ripples; the river flows along its course.
import * as THREE from 'three';
import { mulberry32 } from '../sim/rng.js';

const SIZE = 128;

/** Tileable ripples: normal in RGB, height in A. Integer wave vectors keep it seamless. */
function rippleTexture() {
  const rng = mulberry32(11);
  const waves = [[1, 2], [3, -1], [2, 3], [-4, 1], [5, 2], [1, -6], [-6, -3], [7, 4], [-3, 8], [9, -2]]
    .map(([kx, ky]) => ({ kx, ky, a: 1 / Math.hypot(kx, ky), p: rng() * Math.PI * 2 }));
  const height = new Float32Array(SIZE * SIZE);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let h = 0;
      for (const w of waves) h += w.a * Math.sin(((w.kx * x + w.ky * y) / SIZE) * Math.PI * 2 + w.p);
      height[y * SIZE + x] = h;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  const at = (x, y) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const data = new Uint8Array(SIZE * SIZE * 4);
  const n = new THREE.Vector3();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      n.set(-(at(x + 1, y) - at(x - 1, y)) * 3, -(at(x, y + 1) - at(x, y - 1)) * 3, 1).normalize();
      const i = (y * SIZE + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = ((at(x, y) - lo) / (hi - lo)) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const PARS = /* glsl */`
uniform float uTime;
uniform sampler2D uRipple;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
varying vec3 vWaterPos;
varying vec2 vWaterUv;
float wFoam;
vec2 wSlope;

// Mirrors coastX() and the quay box in terrain.js.
float waterCoastX(float z) { return -47.0 + 2.4 * sin(z * 0.09) + 1.4 * sin(z * 0.21 + 1.3); }
float waterBox(vec2 p, vec2 c, vec2 h) {
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
`;

const COLOR = /* glsl */`
#ifdef WATER_SEA
  vec2 wp = vWaterPos.xz;
  vec4 r1 = texture2D(uRipple, wp * 0.03 + uTime * vec2(0.008, 0.005));
  vec4 r2 = texture2D(uRipple, wp * 0.052 + uTime * vec2(-0.006, 0.009));
  float noise = (r1.a + r2.a) * 0.5;
  // distance to the nearest shore: the coastline or the quay
  float shore = min(waterCoastX(wp.y) - 0.4 - wp.x, waterBox(wp, vec2(-50.5, 6.0), vec2(7.0, 16.0)));
  vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 26.0, shore + (noise - 0.5) * 5.0));
  // a soft foam rim on the shore, and thin broken lines rolling in towards it
  float rim = 1.0 - smoothstep(0.1, 1.0 + noise * 1.4, shore);
  float roll = fract(shore * 0.21 + uTime * 0.07 + noise * 0.4);
  float lines = smoothstep(0.84, 0.94, roll) * (1.0 - smoothstep(0.94, 1.0, roll));
  lines *= (1.0 - smoothstep(1.0, 9.0, shore)) * smoothstep(0.4, 0.62, noise);
  wFoam = clamp(max(rim * 0.85, lines * 0.55), 0.0, 1.0);
#else
  // u runs across the river (0..1 over 5.2 units), v along its course in world units
  vec2 q = vec2(vWaterUv.x * 5.2, vWaterUv.y);
  vec4 r1 = texture2D(uRipple, vec2(q.x * 0.11, q.y * 0.045 - uTime * 0.05));
  vec4 r2 = texture2D(uRipple, vec2(q.x * 0.19 + 0.37, q.y * 0.08 - uTime * 0.08));
  float across = 1.0 - abs(vWaterUv.x - 0.5) * 2.0; // 1 mid-channel, 0 at the banks
  vec3 water = mix(uShallow, uDeep, smoothstep(0.05, 0.85, across));
  float streak = smoothstep(0.6, 0.86, r1.a * 0.6 + r2.a * 0.4) * smoothstep(0.2, 0.6, across);
  water = mix(water, uFoam, streak * 0.2);
  wFoam = (1.0 - smoothstep(0.0, 0.2, across)) * 0.5;
#endif
  wSlope = r1.xy + r2.xy - 1.0;
  diffuseColor.rgb = mix(water, uFoam, wFoam);
`;

const NORMAL = /* glsl */`
  {
    vec2 s = wSlope * WATER_RIPPLE * (1.0 - wFoam * 0.8);
    normal = normalize(mat3(viewMatrix) * normalize(vec3(s.x, 1.0, s.y)));
  }
`;

function waterMaterial(kind, shared, { shallow, deep, ripple }) {
  // Low roughness plus a strong sky reflection is what makes the sea read as
  // water rather than painted plaster: the sun lands as a tight glint, which
  // the bloom pass in world.js lets bleed into a sparkle.
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.02, envMapIntensity: 1.7 });
  const uniforms = {
    ...shared,
    uShallow: { value: new THREE.Color(shallow) },
    uDeep: { value: new THREE.Color(deep) },
    uFoam: { value: new THREE.Color('#FFFFFF') },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;\nvarying vec2 vWaterUv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWaterUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#define WATER_${kind.toUpperCase()}\n#define WATER_RIPPLE ${ripple.toFixed(2)}\n${PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, wFoam);')
      .replace('#include <normal_fragment_maps>', NORMAL);
  };
  mat.customProgramCacheKey = () => `water-${kind}`;
  return mat;
}

export function createWater() {
  const shared = { uTime: { value: 0 }, uRipple: { value: rippleTexture() } };
  return {
    sea: waterMaterial('sea', shared, { shallow: '#B6E6E8', deep: '#5E9FD8', ripple: 0.3 }),
    river: waterMaterial('river', shared, { shallow: '#C4E9E8', deep: '#79B4E2', ripple: 0.26 }),
    update(time) { shared.uTime.value = time; },
  };
}
