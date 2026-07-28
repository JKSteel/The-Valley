// Verifies the design invariant in config.js: the ocean and ice wall must be
// hidden from the valley floor and visible from the ridge.
//
// Two mechanisms enforce it and they are checked separately, because they fail
// under different conditions:
//   1. OCCLUSION — the mountain ring geometrically blocks the sight line. This
//      is the load-bearing one, and it is independent of mist.
//   2. MIST — haze finishes off whatever occlusion leaves. Thinning the mist
//      weakens this and nothing else.
//
// Run after changing MIST, SUN, the radial profile or MOUNTAIN.
//   node tools/check-reveal.js

import { WORLD, MIST, TRAIL } from '../src/config.js';
import { terrainHeight } from './terrain-mirror.js';

const H = MIST.halfHeight / Math.LN2;   // half-height -> e-folding distance
const eyeY = WORLD.valleyFloorY + 1.7;
const iceTop = WORLD.iceWallHeight;

// --- 1. occlusion -----------------------------------------------------------

// Lowest saddle anywhere on the rim: the one place a sight line could sneak out.
function lowestCrest(samples = 720) {
  let lowest = Infinity, atAzimuth = 0;
  for (let a = 0; a < samples; a++) {
    const th = (a / samples) * Math.PI * 2;
    const ct = Math.cos(th), st = Math.sin(th);
    let crest = -Infinity;
    for (let r = WORLD.ridgeRadius - TRAIL.bandHalfWidth;
             r <= WORLD.ridgeRadius + TRAIL.bandHalfWidth; r += 50) {
      const h = terrainHeight(ct * r, st * r);
      if (h > crest) crest = h;
    }
    if (crest < lowest) { lowest = crest; atAzimuth = th * 180 / Math.PI; }
  }
  return { lowest, atAzimuth };
}

// Height of the sight line where it crosses the rim. Worst case is an observer
// at the far edge of the valley floor looking clear across it, which gives the
// sight line the longest run-up and so the greatest height at the crossing.
function sightLineAtRim(targetY) {
  const toRim = WORLD.valleyRadius + WORLD.ridgeRadius;
  const toTarget = WORLD.valleyRadius + WORLD.iceWallRadius;
  return eyeY + (targetY - eyeY) * (toRim / toTarget);
}

const { lowest, atAzimuth } = lowestCrest();

const occlusionCases = [
  ['ice wall top', sightLineAtRim(iceTop)],
  ['near shore',   sightLineAtRim(0)],
];

console.log(`OCCLUSION   lowest saddle on the rim ${lowest.toFixed(0)} m ` +
            `(azimuth ${atAzimuth.toFixed(0)} deg)\n`);

let failed = false;
for (const [label, lineY] of occlusionCases) {
  const clearance = lowest - lineY;
  const ok = clearance > 150;
  failed ||= !ok;
  console.log(`  ${ok ? ' ok ' : 'BAD '} sight line to ${label.padEnd(14)} ` +
              `crosses the rim at ${lineY.toFixed(0).padStart(5)} m  ` +
              `- blocked by ${clearance.toFixed(0)} m`);
}

// --- 2. mist ----------------------------------------------------------------

function transmittance(camY, targetY, horizontal) {
  const dist = Math.hypot(horizontal, targetY - camY);
  const rdY = (targetY - camY) / dist;
  const baseline = MIST.density * Math.exp(-(camY - WORLD.valleyFloorY) / H);

  const optical = Math.abs(rdY) < 1e-4
    ? baseline * dist
    : baseline * H * (1 - Math.exp(-dist * rdY / H)) / rdY;

  return Math.exp(-Math.max(optical, 0));
}

const crest = WORLD.ridgePeakY;
const mistCases = [
  ['ridge crest -> near shore', crest, 0,      WORLD.coastRadius - WORLD.ridgeRadius,   'visible'],
  ['ridge crest -> ice wall',   crest, iceTop, WORLD.iceWallRadius - WORLD.ridgeRadius, 'visible'],
  ['ridge crest -> far ocean',  crest, 0,      WORLD.oceanRadius - WORLD.ridgeRadius,   null],
  ['valley floor -> far crest', eyeY,  crest,  WORLD.ridgeRadius,                       null],
];

console.log(`\nMIST        density ${MIST.density}  half-height ${MIST.halfHeight} m\n`);

for (const [label, camY, targetY, horizontal, expect] of mistCases) {
  const t = transmittance(camY, targetY, horizontal);
  let mark = '    ';
  if (expect === 'visible') {
    const ok = t >= 0.12;
    mark = ok ? ' ok ' : 'BAD ';
    failed ||= !ok;
  }
  console.log(`  ${mark}${label.padEnd(28)} ${(t * 100).toFixed(1).padStart(5)}% visible` +
              (expect ? `   (want ${expect})` : ''));
}

console.log(failed ? '\nINVARIANT BROKEN' : '\ninvariant holds');
process.exit(failed ? 1 : 0);
