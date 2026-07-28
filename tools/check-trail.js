// Solves the ridge trail against a CPU mirror of the terrain and reports
// whether the result is actually walkable.  node tools/check-trail.js
//
// Re-run after touching MOUNTAIN, TRAIL or the radial profile — mountain
// roughness and route quality are tightly coupled, and it is easy to make the
// range look better while quietly making the track a scramble.

import { solveRidgeTrail } from '../src/trail-route.js';
import { terrainHeight } from './terrain-mirror.js';

const deg = (grade) => Math.atan(grade) * 180 / Math.PI;
const pct = (n, d) => ((n / d) * 100).toFixed(0) + '%';

const t0 = Date.now();
const { points, stats } = solveRidgeTrail(terrainHeight);
const elapsed = Date.now() - t0;

console.log(`solved ${points.length} stations in ${elapsed} ms\n`);
console.log(`  length           ${(stats.length / 1000).toFixed(1)} km`);
console.log(`  ascent           ${stats.ascent.toFixed(0)} m   descent ${stats.descent.toFixed(0)} m`);
console.log(`  altitude         ${stats.minY.toFixed(0)} m to ${stats.maxY.toFixed(0)} m`);
console.log(`  median grade     ${deg(stats.medianGrade).toFixed(1)} deg`);
console.log(`  95th pct grade   ${deg(stats.p95Grade).toFixed(1)} deg`);
console.log(`  99th pct grade   ${deg(stats.p99Grade).toFixed(1)} deg`);
console.log(`  steepest         ${deg(stats.steepestGrade).toFixed(1)} deg  ` +
            `(cap ${deg(stats.gradeCap).toFixed(1)} deg)`);
console.log(`  mean below crest ${stats.meanBelowCrest.toFixed(0)} m`);

// Thresholds pitched at a DOC alpine tramping track: sustained walking grade,
// pinches that are steep but not scrambling, and a line that stays on the
// skyline rather than escaping to easier ground below.
const checks = [
  ['closes the loop',       Math.hypot(points[0].x - points.at(-1).x,
                                       points[0].z - points.at(-1).z) < 400],
  ['median grade < 10 deg', deg(stats.medianGrade) < 10],
  ['95th pct < 24 deg',     deg(stats.p95Grade) < 24],
  ['99th pct < 26 deg',     deg(stats.p99Grade) < 26],
  ['nothing above the cap',
    Math.atan(stats.steepestGrade) <= Math.atan(stats.gradeCap) + 1e-6],
  ['stays near the crest',  stats.meanBelowCrest < 320],
  ['ascent is plausible',   stats.ascent > 1500 && stats.ascent < 30000],
];

console.log();
let failed = false;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? ' ok ' : 'BAD '} ${label}`);
  failed ||= !ok;
}

// The shape of the distribution matters more than any single number.
const buckets = new Array(8).fill(0);
for (let i = 0; i < points.length; i++) {
  const p = points[i], q = points[(i + 1) % points.length];
  const horiz = Math.hypot(q.x - p.x, q.z - p.z);
  buckets[Math.min(Math.floor(deg(horiz > 0 ? Math.abs(q.h - p.h) / horiz : 0) / 5), 7)]++;
}
console.log('\n  grade distribution');
buckets.forEach((n, i) => {
  const label = i === 7 ? '35+' : `${i * 5}-${i * 5 + 5}`;
  console.log(`    ${label.padStart(5)} deg ` +
              `${'#'.repeat(Math.round(n / points.length * 50)).padEnd(50)} ${pct(n, points.length)}`);
});

console.log(failed ? '\nROUTE UNSATISFACTORY' : '\nroute is walkable');
process.exit(failed ? 1 : 0);
