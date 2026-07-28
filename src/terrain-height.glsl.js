import { WORLD, MOUNTAIN } from './config.js';

// The single source of truth for terrain shape. Baked once into a texture by
// heightfield.js; nothing else evaluates it. Requires NOISE_GLSL.
//
// The radial profile is the world's skeleton: dead flat out to valleyRadius,
// gentle through the foothills, then a 3.7 km wall rising to the crest, then
// the seaward descent. Noise perturbs it; noise never defines it.

const f = (n) => n.toFixed(1);

export const TERRAIN_HEIGHT_GLSL = /* glsl */`
float ridged(vec2 p) {
  float a = 1.0, s = 0.0, fr = 1.0, norm = 0.0;
  for (int i = 0; i < ${MOUNTAIN.octaves}; i++) {
    float n = vnoise(p * fr);
    n = 1.0 - abs(n * 2.0 - 1.0);
    s += n * n * a;
    norm += a;
    fr *= ${f(MOUNTAIN.lacunarity)}; a *= ${f(MOUNTAIN.roughness)};
  }
  return s / norm;   // normalised, so roughness changes shape and not scale
}

float terrainHeight(vec2 p) {
  float r = length(p);

  // Warp the radius before it enters the profile, so the rim is an irregular
  // ring rather than a perfect circle. Everything downstream inherits this.
  // The warp is eased off past the ridge: out there it would push the
  // coastline beyond the baked texture, where clamping would turn the last
  // texel of land into a plateau running to the horizon.
  float warpFade = 0.4 + 0.6 * (1.0 - smoothstep(${f(WORLD.ridgeRadius)}, ${f(WORLD.coastRadius)}, r));
  float warp = (fbm(p * 0.00016) - 0.5) * 1800.0 * warpFade;
  float rw = r + warp;

  float foot    = smoothstep(${f(WORLD.valleyRadius)},   ${f(WORLD.foothillRadius)}, rw);
  float wall    = smoothstep(${f(WORLD.foothillRadius)}, ${f(WORLD.ridgeRadius)},    rw);
  float descent = smoothstep(${f(WORLD.ridgeRadius)},    ${f(WORLD.coastRadius)},    rw);

  // Envelope peaks on the crest and falls away on both sides.
  float envelope = (foot * 0.10 + pow(wall, 1.45) * 0.90) * (1.0 - descent);

  float h = ${f(WORLD.valleyFloorY)} + envelope * ${f(WORLD.ridgePeakY)};

  // Ridged detail, confined to the mountains so the floor stays a floor.
  // ~1.8 km base wavelength puts roughly two cells across the wall; eight
  // octaves take the finest detail down to about 11 m.
  h += ridged(p * ${MOUNTAIN.baseFrequency}) * ${f(WORLD.ridgePeakY)} * ${f(MOUNTAIN.relief)} * envelope;

  // Very low relief on the valley floor — broad swells to catch the light,
  // nowhere near enough to read as hills.
  h += (fbm(p * 0.00035) - 0.5) * 30.0 * (1.0 - foot);

  // Outside the coast, fall away to the sea bed.
  h = mix(h, -140.0, smoothstep(${f(WORLD.coastRadius)}, ${f(WORLD.coastRadius + 1400)}, rw));

  return h;
}
`;
