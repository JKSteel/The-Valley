import { WORLD, TRAIL } from './config.js';

// Solves the ridge trail as a least-cost closed loop through the mountain band.
//
// The route is constrained to advance monotonically in azimuth, which turns
// what would be a cyclic shortest-path problem into a layered DAG — plain
// dynamic programming over 1024 angular layers, no priority queue needed. The
// loop is closed by running the DP once per starting radius and keeping the
// run that returns to where it began.
//
// No three.js import here on purpose: the route is pure geometry, so it stays
// verifiable from node.

export function solveRidgeTrail(sampleHeight) {
  const A = TRAIL.angularSamples;
  const R = TRAIL.radialCells;
  const rMin = WORLD.ridgeRadius - TRAIL.bandHalfWidth;
  const rMax = WORLD.ridgeRadius + TRAIL.bandHalfWidth;
  const dr = (rMax - rMin) / (R - 1);

  // --- sample the band ----------------------------------------------------
  const X = new Float64Array(A * R);
  const Z = new Float64Array(A * R);
  const H = new Float64Array(A * R);
  const crest = new Float64Array(A);

  for (let a = 0; a < A; a++) {
    const th = (a / A) * Math.PI * 2;
    const ct = Math.cos(th), st = Math.sin(th);
    let highest = -Infinity;

    for (let i = 0; i < R; i++) {
      const r = rMin + i * dr;
      const k = a * R + i;
      X[k] = ct * r;
      Z[k] = st * r;
      H[k] = sampleHeight(X[k], Z[k]);
      if (H[k] > highest) highest = H[k];
    }
    crest[a] = highest;
  }

  // --- cost of one station-to-station step --------------------------------
  // Distance travelled in 3D, multiplied by a steepness penalty, plus a pull
  // toward the skyline. Squaring the gradient is what produces sidling: two
  // gentle steps cost far less than one steep one.
  let gradeCap = TRAIL.maxGrade;

  const stepCost = (k0, k1, a1) => {
    const dx = X[k1] - X[k0], dz = Z[k1] - Z[k0], dh = H[k1] - H[k0];
    const horiz = Math.hypot(dx, dz);
    const slope = horiz > 0 ? Math.abs(dh) / horiz : 0;

    if (slope > gradeCap) return Infinity;   // refused outright, not priced in

    const ds = Math.hypot(horiz, dh);
    return ds * (1 + TRAIL.slopeWeight * slope * slope)
         + TRAIL.crestWeight * (crest[a1] - H[k1]);
  };

  // --- dynamic programme --------------------------------------------------
  const K = TRAIL.maxLateralStep;
  const cur = new Float64Array(R);
  const nxt = new Float64Array(R);

  // start < 0 means "begin anywhere", used for the burn-in lap.
  const runDP = (start, back, laps = 1) => {
    if (start < 0) cur.fill(0);
    else { cur.fill(Infinity); cur[start] = 0; }

    for (let s = 0; s < A * laps; s++) {
      const a0 = s % A, a1 = (s + 1) % A;
      nxt.fill(Infinity);

      for (let i = 0; i < R; i++) {
        const c = cur[i];
        if (c === Infinity) continue;
        const k0 = a0 * R + i;

        for (let d = -K; d <= K; d++) {
          const j = i + d;
          if (j < 0 || j >= R) continue;

          const t = c + stepCost(k0, a1 * R + j, a1);
          if (t < nxt[j]) {
            nxt[j] = t;
            if (back) back[s * R + j] = i;
          }
        }
      }
      cur.set(nxt);
    }
    return start < 0 ? -1 : cur[start];
  };

  // Two unrolled laps from a uniform start. After a full lap the DP has
  // forgotten where it began, so the cheapest state at the end is a radius the
  // optimal cycle actually passes through. That replaces running the whole
  // solve once per starting radius — an R-fold saving, spent on resolution
  // instead, which is what the route was actually short of.
  // A cap that admits no closed route is worse than a steep one, so relax it
  // until a loop exists. In practice the first value holds.
  const back = new Uint16Array(A * R);
  let bestStart = 0;

  for (const cap of [TRAIL.maxGrade, TRAIL.maxGrade * 1.25, TRAIL.maxGrade * 1.6, Infinity]) {
    gradeCap = cap;

    runDP(-1, null, 2);
    bestStart = 0;
    for (let i = 1; i < R; i++) if (cur[i] < cur[bestStart]) bestStart = i;

    if (Number.isFinite(runDP(bestStart, back))) break;
    if (cap === Infinity) throw new Error('no closed ridge route exists');
  }
  const usedGradeCap = gradeCap;

  const radial = new Int32Array(A);
  let j = bestStart;
  for (let s = A - 1; s >= 0; s--) {
    radial[(s + 1) % A] = j;
    j = back[s * R + j];
  }

  // --- smooth -------------------------------------------------------------
  // The DP walks a staircase of discrete cells and wants easing out. A plain
  // box filter is not safe to use for it: smoothing the radius moves the line
  // sideways onto terrain the solver never evaluated, and re-sampling height
  // there reintroduces exactly the steep pinches the grade cap refused. Every
  // degree of steepness in this route once came from that.
  //
  // So relax toward the neighbours only where doing so does not steepen the
  // tread. Flat ground smooths freely; steep ground keeps the solved line.
  const radii = Float64Array.from(radial, (i) => rMin + i * dr);
  const at = (a, r) => {
    const th = (a / A) * Math.PI * 2;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    return { x, z, h: sampleHeight(x, z) };
  };

  const gradeBetween = (p, q) => {
    const horiz = Math.hypot(q.x - p.x, q.z - p.z);
    return horiz > 0 ? Math.abs(q.h - p.h) / horiz : 0;
  };

  for (let pass = 0; pass < TRAIL.smoothPasses; pass++) {
    for (let a = 0; a < A; a++) {
      const prev = (a - 1 + A) % A, next = (a + 1) % A;
      const target = (radii[prev] + radii[next]) * 0.5;
      const candidate = radii[a] + (target - radii[a]) * 0.5;
      if (Math.abs(candidate - radii[a]) < 0.05) continue;

      const before = Math.max(gradeBetween(at(prev, radii[prev]), at(a, radii[a])),
                              gradeBetween(at(a, radii[a]), at(next, radii[next])));
      const c = at(a, candidate);
      const after = Math.max(gradeBetween(at(prev, radii[prev]), c),
                             gradeBetween(c, at(next, radii[next])));

      if (after <= Math.max(before, usedGradeCap)) radii[a] = candidate;
    }
  }

  const points = [];
  for (let a = 0; a < A; a++) points.push(at(a, radii[a]));

  return { points, stats: { ...routeStats(points, crest), gradeCap: usedGradeCap } };
}

function routeStats(points, crest) {
  const n = points.length;
  let length = 0, ascent = 0, descent = 0, steepest = 0, belowCrest = 0;

  for (let i = 0; i < n; i++) {
    const p = points[i], q = points[(i + 1) % n];
    const horiz = Math.hypot(q.x - p.x, q.z - p.z);
    const dh = q.h - p.h;

    length += Math.hypot(horiz, dh);
    if (dh > 0) ascent += dh; else descent -= dh;

    const grade = horiz > 0 ? Math.abs(dh) / horiz : 0;
    if (grade > steepest) steepest = grade;
    belowCrest += crest[i] - p.h;
  }

  const grades = points.map((p, i) => {
    const q = points[(i + 1) % n];
    const horiz = Math.hypot(q.x - p.x, q.z - p.z);
    return horiz > 0 ? Math.abs(q.h - p.h) / horiz : 0;
  }).sort((a, b) => a - b);

  return {
    length, ascent, descent,
    minY: Math.min(...points.map((p) => p.h)),
    maxY: Math.max(...points.map((p) => p.h)),
    steepestGrade: steepest,
    medianGrade: grades[Math.floor(n / 2)],
    p95Grade: grades[Math.floor(n * 0.95)],
    p99Grade: grades[Math.floor(n * 0.99)],
    meanBelowCrest: belowCrest / n,
  };
}
