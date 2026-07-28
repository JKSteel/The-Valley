// Art direction and world constants.
//
// The world is a bounded diorama organised in polar coordinates about the
// origin. Height is f(radius, angle): a hand-authored radial profile that noise
// perturbs but never overrides. Radii below are the profile's control points.

export const WORLD = {
  seed: 20260728,

  // Radial profile control points (metres from centre).
  // The floor is genuinely flat out to valleyRadius — ~113 km² of it — and the
  // climb is deferred to the foothill band so the mountains read as a wall
  // around an expanse, not as an expanse made of foothills.
  valleyRadius:   6000,   // flat floor, biomes live here
  foothillRadius: 6800,   // gentle rise begins
  ridgeRadius:   10500,   // the crest — the trail follows this band
  coastRadius:   15000,   // outer slope meets the sea
  oceanRadius:   28000,   // rough ocean
  iceWallRadius: 36000,   // ice wall, encircling

  valleyFloorY:     40,
  ridgePeakY:     2200,   // must out-climb the valley mist by a wide margin

  // The tallest the wall can be and still sit below the lowest saddle on the
  // rim — 405 m of clearance. Above about 5200 m it breaks the skyline from
  // the valley floor and the reveal is gone. See tools/check-reveal.js.
  iceWallHeight:  4800,
  iceWallBase:    -300,   // sunk, so it rises straight out of the water
};

// DESIGN INVARIANT — the reveal.
// Ocean and ice wall must be invisible from the valley floor and visible from
// the ridge. Two mechanisms enforce it:
//   1. OCCLUSION — the mountain ring blocks the sight line. Load-bearing, and
//      independent of the weather: the lowest saddle clears the worst-case
//      sight line by over a kilometre.
//   2. MIST — haze finishes off whatever occlusion leaves. At the current
//      density this is a supporting player, not the mechanism.
// halfHeight is what opens the view as you climb: density falls with altitude,
// so the air clears on the way up. Run tools/check-reveal.js after touching
// any of it.
export const MIST = {
  // Dialled in by eye. Thin enough that the far rim stays legible across the
  // valley — at this density occlusion, not haze, is what hides the ocean.
  density:      0.00014,  // extinction at valleyFloorY
  halfHeight:     600,    // metres for density to halve
  inscatter:      1.15,   // forward-scattering gain toward the sun
  anisotropy:     0.76,   // Henyey-Greenstein g, how tight the sun's halo is
};

export const SUN = {
  azimuth:   288,   // degrees clockwise from north — WNW, matching the photo
  elevation:  12.0, // degrees. Pinned; this sunset does not progress.
  angularSize: 1.4, // degrees. Oversized — reads better than the true 0.53°.
  intensity:  22.0, // HDR, drives the bloom
};

// The directional colour field. Looking west is gold, east is violet-blue, and
// the same palette drives sky, mist and water so everything agrees. Walking the
// ridge trail traverses the whole wheel — that traverse is the piece.
export const PALETTE = {
  // West — into the sun
  sunDisc:      [0xfff4d6, 34.0],
  sunHalo:      [0xffb057,  3.2],
  // What the sun actually lights the ground with. Deliberately not sunHalo:
  // that saturated orange is right for the glow around the disc, but using it
  // as an illuminant collapses every albedo in the world onto one hue.
  sunLight:     [0xffe0b8,  2.6],
  westHorizon:  [0xf7cf9c,  1.05],
  westSky:      [0x6f7fae,  0.58],

  // East — away from the sun
  eastHorizon:  [0xc3aec8,  0.50],  // pale violet haze
  beltOfVenus:  [0xe2a3ad,  0.62],  // the pink band opposite the sun
  earthShadow:  [0x5c6c8f,  0.34],  // dusky blue beneath the belt
  eastSky:      [0x2f5a94,  0.40],

  zenith:       [0x18355f,  0.30],
  ground:       [0x0d1016,  0.10],  // below the horizon
};

// Ground response. With the sun at 4 degrees, N.L on flat ground is about
// 0.07 — direct light contributes almost nothing down there and skylight does
// nearly all the work, so the fill term is the one that matters.
export const GROUND = {
  albedo:  0.14,   // linear. Dry tussock is ~0.2; this stays a touch darker.
  skyFill: 2.00,
  sunGain: 0.50,

  // Fraction of the ambient taken from the bright horizon ring rather than the
  // blue dome. A warm ambient flattens every albedo onto one hue — unless the
  // albedos are saturated enough to survive it, which is what the chroma below
  // buys. These two are a pair: raising warmth without raising chroma turns the
  // whole world brown, which is where this started.
  skyWarmth: 0.60,

  chroma: 1.8,     // biome saturation, about their own luminance
};

// Mountain roughness.
//
// Each octave contributes slope in proportion to (gain x lacunarity)^k. With
// gain 0.5 and lacunarity 2.07 that ratio is 1.035, so every finer octave adds
// *more* gradient than the last and the surface ends up all crag — a median of
// 40 degrees across the ridge band, which nothing can be walked across. Below
// about 0.45 the series decays and large forms set the slope instead of fine
// detail, which is how real ranges behave.
export const MOUNTAIN = {
  relief:        0.36,    // ridged amplitude as a fraction of ridgePeakY
  roughness:     0.30,    // per-octave gain
  lacunarity:    2.07,
  octaves:       8,
  baseFrequency: 0.00055,

  // Peaks reach ~2971 m and the trail tops out at 2614 m, so the snow line has
  // to live in that window: high enough that the track is never buried, low
  // enough that the summits actually catch the sunset. This puts snow on
  // roughly the top 3% of the mountain band.
  snowLine: 2640,
  snowFull: 2900,
};

// The ridge trail. Rather than draping a line over the literal crest — which
// is unwalkable and looks wrong — the route is solved as a least-cost loop
// through the mountain band. Penalising slope squared while rewarding height
// makes it sidle below the peaks and cross at saddles by itself, which is what
// makes a track read as a track rather than a stripe of paint.
export const TRAIL = {
  bandHalfWidth: 1750,  // search band either side of ridgeRadius
  angularSamples: 1024, // stations around the loop (~64 m apart at the crest)
  radialCells:     144, // ~24 m apart
  maxLateralStep:    6, // cells of sideways movement per station
  slopeWeight:      80, // cost multiplier on gradient squared
  crestWeight:    0.12, // pull toward the skyline, in cost per metre below it
  maxGrade:       0.40, // tan of the steepest step allowed — about 22 degrees.
                        // A hard cap, not a penalty: a track builder refuses
                        // ground above a grade rather than pricing it in. The
                        // solver relaxes this only if no route exists at all.
                        // It also bounds the smoothing pass, which is the only
                        // thing that ever made this route steep.
  smoothPasses:     12,
  width:           2.6, // tread, metres
  lift:           0.12, // above the ground, to beat z-fighting
  station:         6.0, // ribbon vertex spacing, metres
  markerSpacing:   150,
};

// The ocean.
// A flat, calm sea. Deliberately so.
//
// This was displaced water for several rounds — Gerstner geometry, a long
// analytic swell, statistical whitecaps — and every version read worse than
// this one. Two reasons it never worked, both worth keeping written down:
//
//   1. The sea is only ever seen from the ridge, 4.5 km away and 2200 m up, at
//      about six degrees of depression. At that grazing angle almost every
//      wave is sub-pixel, and sub-pixel motion is a fizz, not a swell.
//   2. Making it big enough to read from up there meant 40 m crests — and the
//      valley floor sits at 40 m, so the sea came up through the ground.
//
// Flat water cannot clip anything, cannot boil, and suits the stillness of the
// rest of the world. The ripple below is a shading detail only; there is no
// displacement anywhere in this file.
export const OCEAN = {
  rippleScale: 0.012,   // ~83 m features
  rippleSpeed:  0.10,
  rippleDepth:  0.55,
  // Already linear, not sRGB. Kept as raw numbers because converting a hex
  // through setHex and then scaling it is how this ended up 20x too dark and
  // reading as a black mirror.
  deep: [0.010, 0.019, 0.030],
};

// The ice wall. Sheer by intent — flutes and strata give it scale without ever
// suggesting a way up. It is 226 km around and has no ends, which is most of
// what makes it read as impassable.
export const ICE = {
  albedo:        0.62,
  glow:          2.4,   // light transmitted through the wall when backlit
  // Metres the face stands proud. This is real geometry, not a normal map:
  // without a broken silhouette, self-shadowing and parallax, shaded relief on
  // a smooth cylinder reads as texture painted on a flat board, which is
  // exactly what it looked like.
  displace:       520,
  foot:           240,  // metres the wave-planed base stands out from the face
  crevasse:      0.22,  // fracture clefts — sparse; this is a shelf, not a serac field
  strata:        0.25,  // layering on the face above the foot, kept faint
  shadow:        0.55,  // strength of the low-sun shadowing across the face
  topVariation:  0.06,  // tabular: the crest is near level, as an ice shelf is
  waviness:       260,  // metres of radial wander
  // 1280 puts ~3.5 vertices across the 621 m relief scale, so it displaces as
  // geometry instead of staying a normal map. The 176 m scale still cannot be
  // carried by the mesh and is left to shading, which is what normal maps are
  // legitimately for.
  radialSegments: 1280,
  heightSegments:   80,
};

export const CIRRUS = {
  height:     5200,
  coverage:     0.52,
  stretch:      5.0,   // horizontal streaking
  opacity:      0.85,
  drift:        0.004, // very slow
};

export const CAMERA = {
  shoreLimit: 0.5,   // walking stops at the waterline; the sea bed is not a floor
  eyeHeight:  1.7,
  walkSpeed:  3.4,
  runSpeed:  11.0,
  flySpeed:  90.0,
  near:       0.5,
  far:    80000,
  fov:       58,
};

export const POST = {
  exposure:       1.0,
  bloomStrength:  0.62,
  bloomRadius:    0.75,
  bloomThreshold: 1.15,
  godrayStrength: 0.5,
  godrayDecay:    0.965,
  vignette:       0.34,
};
