// CPU mirror of terrain-height.glsl.js, for offline route work.
//
// It will not match the GPU bit for bit — float32 vs float64 in the hash — but
// it is the same function with the same statistics, which is what tuning the
// route weights needs. The shipped route is always solved against the real
// baked heightmap.

import { WORLD, MOUNTAIN } from '../src/config.js';

const fract = (x) => x - Math.floor(x);
const mix = (a, b, t) => a + (b - a) * t;

export function smoothstep(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

function hash21(px, pz) {
  let x = fract(px * 0.1031), y = fract(pz * 0.1031), z = fract(px * 0.1031);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

function vnoise(px, pz) {
  const ix = Math.floor(px), iz = Math.floor(pz);
  const fx = px - ix, fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return mix(mix(hash21(ix, iz),     hash21(ix + 1, iz),     ux),
             mix(hash21(ix, iz + 1), hash21(ix + 1, iz + 1), ux), uz);
}

export function fbm(px, pz) {
  let a = 0.5, s = 0, norm = 0;
  for (let i = 0; i < 5; i++) {
    s += a * vnoise(px, pz); norm += a;
    px *= 2.03; pz *= 2.03; a *= 0.5;
  }
  return s / norm;
}

function ridged(px, pz) {
  let a = 1, s = 0, f = 1, norm = 0;
  for (let i = 0; i < MOUNTAIN.octaves; i++) {
    let n = vnoise(px * f, pz * f);
    n = 1 - Math.abs(n * 2 - 1);
    s += n * n * a;
    norm += a;
    f *= MOUNTAIN.lacunarity; a *= MOUNTAIN.roughness;
  }
  return s / norm;
}

export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  const warpFade = 0.4 + 0.6 * (1 - smoothstep(WORLD.ridgeRadius, WORLD.coastRadius, r));
  const rw = r + (fbm(x * 0.00016, z * 0.00016) - 0.5) * 1800 * warpFade;

  const foot    = smoothstep(WORLD.valleyRadius, WORLD.foothillRadius, rw);
  const wall    = smoothstep(WORLD.foothillRadius, WORLD.ridgeRadius, rw);
  const descent = smoothstep(WORLD.ridgeRadius, WORLD.coastRadius, rw);
  const envelope = (foot * 0.10 + Math.pow(wall, 1.45) * 0.90) * (1 - descent);

  let h = WORLD.valleyFloorY + envelope * WORLD.ridgePeakY;
  h += ridged(x * MOUNTAIN.baseFrequency, z * MOUNTAIN.baseFrequency)
       * WORLD.ridgePeakY * MOUNTAIN.relief * envelope;
  h += (fbm(x * 0.00035, z * 0.00035) - 0.5) * 30 * (1 - foot);
  return mix(h, -140, smoothstep(WORLD.coastRadius, WORLD.coastRadius + 1400, rw));
}
