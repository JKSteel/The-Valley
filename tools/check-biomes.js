// Reports how much of the world each biome actually covers, and how much snow
// sits on the tops.  node tools/check-biomes.js
//
// Written because thresholds that look reasonable across 0..1 can sit at the
// 97th percentile of the noise that feeds them, leaving a valley that is
// entirely one biome with slivers of everything else. Percentiles are not
// guessable; measure them.

import { WORLD, MOUNTAIN, TRAIL } from '../src/config.js';
import { fbm, terrainHeight } from './terrain-mirror.js';

const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

// Mirrors BIOME_FIELD_GLSL.
function biomeField(x, z) {
  const wx = fbm(x * 0.00021 + 11.3, z * 0.00021 + 11.3) - 0.5;
  const wz = fbm(x * 0.00021 - 7.1, z * 0.00021 - 7.1) - 0.5;
  const qx = x + wx * 2600, qz = z + wz * 2600;

  const moisture  = fbm(qx * 0.00013 + 3.1, qz * 0.00013 + 3.1);
  const substrate = fbm(qx * 0.00019 + 31.7, qz * 0.00019 + 31.7);

  const ridge = 1 - Math.abs(fbm(qx * 0.00040 + 5.5, qz * 0.00040 + 5.5) * 2 - 1);
  let channel = smoothstep(0.945, 0.99, ridge);
  channel *= 1 - smoothstep(WORLD.valleyRadius * 0.82, WORLD.valleyRadius, Math.hypot(x, z));

  return { moisture, substrate, channel };
}

// Mirrors the weighting in surfaceAt, reported as the dominant surface.
function classify(field, height, slope) {
  const dryness = smoothstep(0.495, 0.425, field.moisture);
  const wetness = smoothstep(0.505, 0.575, field.moisture);
  const coarse = smoothstep(0.40, 0.60, field.substrate);

  const alpine = smoothstep(WORLD.valleyFloorY + 500, WORLD.valleyFloorY + 1300, height);
  const snow = smoothstep(MOUNTAIN.snowLine, MOUNTAIN.snowFull, height)
             * (1 - smoothstep(0.52, 0.86, slope));

  // Exact weights of the sequential mixes in surfaceAt:
  //   mix(mix(mix(TUSSOCK, dry, dryness), wet, wetness), BRAID, channel)
  const w = {
    tussock: (1 - dryness) * (1 - wetness),
    dune:    dryness * (1 - wetness) * (1 - coarse),
    salt:    dryness * (1 - wetness) * coarse,
    swamp:   wetness * (1 - coarse),
    forest:  wetness * coarse,
  };
  for (const k of Object.keys(w)) w[k] = Math.max(w[k], 0) * (1 - field.channel) * (1 - alpine);
  w.braid = field.channel * (1 - alpine);
  w.rock  = alpine * (1 - snow) * smoothstep(0.35, 0.75, slope);
  w.scree = alpine * (1 - snow) * (1 - smoothstep(0.35, 0.75, slope));
  w.snow  = alpine * snow;

  return Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
}

function survey(rMax, label) {
  const counts = {};
  let n = 0;
  const step = 60;
  for (let x = -rMax; x <= rMax; x += step) {
    for (let z = -rMax; z <= rMax; z += step) {
      const r = Math.hypot(x, z);
      if (r > rMax) continue;
      const h = terrainHeight(x, z);
      const e = 25;
      const gx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
      const gz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
      // slope as used in the shader: 1 - n.y
      const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
      const b = classify(biomeField(x, z), h, slope);
      counts[b] = (counts[b] || 0) + 1;
      n++;
    }
  }
  console.log(`\n${label} (${n} samples)`);
  for (const [b, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const share = c / n;
    console.log(`  ${b.padEnd(9)} ${'#'.repeat(Math.round(share * 44)).padEnd(44)} ${(share * 100).toFixed(1)}%`);
  }
  return counts;
}

const floor = survey(WORLD.valleyRadius, 'VALLEY FLOOR');
const band = survey(WORLD.ridgeRadius + TRAIL.bandHalfWidth, 'WHOLE WORLD to the rim');

const share = (counts, key) => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (counts[key] || 0) / total;
};

console.log();
let failed = false;
const checks = [
  ['no biome dominates the floor', Math.max(...Object.values(floor)) /
     Object.values(floor).reduce((a, b) => a + b, 0) < 0.55],
  ['at least 5 surfaces on the floor', Object.keys(floor).filter(
     (k) => share(floor, k) > 0.03).length >= 5],
  ['dune present',   share(floor, 'dune') > 0.04],
  ['swamp present',  share(floor, 'swamp') > 0.04],
  ['braid present',  share(floor, 'braid') > 0.01],
  ['snow on the tops', share(band, 'snow') > 0.005],
];
for (const [label, ok] of checks) {
  console.log(`  ${ok ? ' ok ' : 'BAD '} ${label}`);
  failed ||= !ok;
}

console.log(failed ? '\nBIOMES UNBALANCED' : '\nbiomes balanced');
process.exit(failed ? 1 : 0);
