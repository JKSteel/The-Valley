import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';
import { SUN, MIST, PALETTE, CIRRUS, WORLD } from './config.js';

// The atmosphere is one GLSL function, `skyColor(dir)`, shared by every
// material in the world. Mist colour is *defined* as skyColor along the view
// ray, so distant terrain always melts into the exact horizon behind it and
// picks up the west-gold / east-violet field for free. Nothing has to be
// hand-matched.

export const ATMOSPHERE_GLSL = /* glsl */`
uniform vec3  uSunDir;
uniform vec3  uSunDisc, uSunHalo, uSunLight;
uniform vec3  uWestHorizon, uWestSky, uEastHorizon, uEastSky;
uniform vec3  uBelt, uEarthShadow, uZenith, uGroundCol;
uniform vec2  uSunCos;          // x = outer (soft edge), y = inner (solid core)
uniform float uTime;
uniform vec4  uMist;            // density, halfHeight, inscatter, anisotropy
uniform vec4  uCirrus;          // height, coverage, stretch, opacity
uniform float uCirrusDrift;

#define PI 3.14159265359

${NOISE_GLSL}

// Henyey-Greenstein phase — the tight forward lobe that puts a halo around the
// sun in mist and makes backlit ridges glow at their edges.
float phaseHG(float cosT, float g) {
  float gg = g * g;
  return (1.0 - gg) / (4.0 * PI * pow(max(1.0 + gg - 2.0 * g * cosT, 1e-4), 1.5));
}

// Cirrus deck, sampled as a plane at uCirrus.x metres. Returns coverage 0..1.
float cirrusDensity(vec3 dir) {
  float up = dir.y;
  if (up < 0.012) return 0.0;
  vec2 p = dir.xz / up * uCirrus.x * 0.00035;
  p.x /= uCirrus.z;                                  // streak horizontally
  p += vec2(uTime * uCirrusDrift, 0.0);
  float warp = fbm(p * 0.5) - 0.5;                   // bend the streaks
  float d = fbm(p + vec2(warp * 1.6, warp * 0.4));
  d = smoothstep(uCirrus.y, uCirrus.y + 0.22, d);
  return d * smoothstep(0.012, 0.16, up) * smoothstep(1.0, 0.55, up);
}

vec3 skyColor(vec3 dir) {
  dir = normalize(dir);
  float h = dir.y;

  // Azimuthal position in the directional colour field: +1 west (sunward),
  // -1 east (anti-solar). This one scalar drives the whole palette.
  vec2 fwd = normalize(dir.xz + vec2(1e-5));
  vec2 sunFwd = normalize(uSunDir.xz + vec2(1e-5));
  float w = dot(fwd, sunFwd);

  vec3 col = mix(uEastSky, uWestSky, smoothstep(-0.35, 0.9, w));

  // Deepen toward zenith
  float up = clamp(h, 0.0, 1.0);
  col = mix(col, uZenith, smoothstep(0.0, 0.62, up) * 0.92);

  // Horizon haze — where all the light piles up at this sun elevation
  vec3 hazeCol = mix(uEastHorizon, uWestHorizon, smoothstep(-0.55, 0.95, w));
  float haze = exp(-max(h, 0.0) * 8.5);
  col = mix(col, hazeCol, haze * 0.88);

  // Belt of Venus — the pink band opposite the sun, and the earth's shadow
  // rising underneath it. This is the real reason the east goes violet.
  float band  = exp(-pow((h - 0.06) / 0.08, 2.0));
  float anti  = smoothstep(0.4, -0.9, w);
  col += uBelt * band * anti * 1.25;

  float shadow = smoothstep(0.05, -0.03, h) * smoothstep(0.15, -0.85, w);
  col = mix(col, uEarthShadow, shadow * 0.6);

  // Cirrus, lit from beneath by a sun that is nearly on the horizon
  float cd = dot(dir, uSunDir);
  float cirrus = cirrusDensity(dir);
  if (cirrus > 0.001) {
    float lit = pow(max(cd, 0.0), 2.0);
    vec3 cirrusCol = mix(uEastHorizon * 1.1, uWestHorizon * 1.5, smoothstep(-0.4, 0.9, w));
    cirrusCol += uSunHalo * lit * 0.5;
    col = mix(col, cirrusCol, cirrus * uCirrus.w);
  }

  // Sun: soft halo always, solid disc through partial cirrus occlusion
  float halo = pow(max(cd, 0.0), 340.0) * 0.85
             + pow(max(cd, 0.0),  14.0) * 0.20
             + pow(max(cd, 0.0),   3.0) * 0.055;
  col += uSunHalo * halo;

  float disc = smoothstep(uSunCos.x, uSunCos.y, cd);
  col += uSunDisc * disc * mix(1.0, 0.35, cirrus);

  // Below the horizon: stay near the haze colour so distant land dissolves
  // into it rather than hitting a hard edge.
  col = mix(col, mix(hazeCol * 0.5, uGroundCol, smoothstep(0.0, -0.22, h)),
            smoothstep(0.005, -0.02, h));

  return col;
}

// Exponential height mist, integrated analytically along the view ray.
// Density halves every uMist.y metres of altitude, which is what hides the
// ocean and the ice wall from the valley floor and uncovers them on the ridge.
vec3 applyAerial(vec3 color, vec3 worldPos, vec3 camPos) {
  vec3 ray = worldPos - camPos;
  float dist = length(ray);
  if (dist < 1e-3) return color;
  vec3 rd = ray / dist;

  float H = uMist.y / 0.6931472;                       // half-height -> e-fold
  float baseline = uMist.x * exp(-(camPos.y - ${WORLD.valleyFloorY.toFixed(1)}) / H);

  float optical;
  if (abs(rd.y) < 1e-4) {
    optical = baseline * dist;
  } else {
    optical = baseline * H * (1.0 - exp(-dist * rd.y / H)) / rd.y;
  }
  float transmittance = exp(-max(optical, 0.0));

  vec3 mistCol = skyColor(rd);
  float cosT = dot(rd, uSunDir);
  mistCol += uSunHalo * phaseHG(cosT, uMist.w) * uMist.z;

  return mix(mistCol, color, transmittance);
}
`;

// --- uniform construction -------------------------------------------------

const linear = ([hex, gain]) =>
  new THREE.Color().setHex(hex, THREE.SRGBColorSpace).multiplyScalar(gain);

export function createAtmosphereUniforms() {
  const sunCosOuter = Math.cos(THREE.MathUtils.degToRad(SUN.angularSize * 0.5 * 1.9));
  const sunCosInner = Math.cos(THREE.MathUtils.degToRad(SUN.angularSize * 0.5));

  return {
    uSunDir:      { value: sunDirection() },
    uSunDisc:     { value: linear(PALETTE.sunDisc).multiplyScalar(SUN.intensity / 22) },
    uSunHalo:     { value: linear(PALETTE.sunHalo) },
    uSunLight:    { value: linear(PALETTE.sunLight) },
    uWestHorizon: { value: linear(PALETTE.westHorizon) },
    uWestSky:     { value: linear(PALETTE.westSky) },
    uEastHorizon: { value: linear(PALETTE.eastHorizon) },
    uEastSky:     { value: linear(PALETTE.eastSky) },
    uBelt:        { value: linear(PALETTE.beltOfVenus) },
    uEarthShadow: { value: linear(PALETTE.earthShadow) },
    uZenith:      { value: linear(PALETTE.zenith) },
    uGroundCol:   { value: linear(PALETTE.ground) },
    uSunCos:      { value: new THREE.Vector2(sunCosOuter, sunCosInner) },
    uTime:        { value: 0 },
    uMist:        { value: new THREE.Vector4(MIST.density, MIST.halfHeight,
                                             MIST.inscatter, MIST.anisotropy) },
    uCirrus:      { value: new THREE.Vector4(CIRRUS.height, CIRRUS.coverage,
                                             CIRRUS.stretch, CIRRUS.opacity) },
    uCirrusDrift: { value: CIRRUS.drift },
  };
}

// Azimuth measured clockwise from north, with -Z north and +X east.
export function sunDirection(azimuthDeg = SUN.azimuth, elevationDeg = SUN.elevation) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  ).normalize();
}

// Every material that uses ATMOSPHERE_GLSL shares one uniform object, so a
// single edit repaints the entire world at once.
export class Atmosphere {
  constructor() {
    this.uniforms = createAtmosphereUniforms();
    this.azimuth = SUN.azimuth;
    this.elevation = SUN.elevation;
  }

  get sunDir() { return this.uniforms.uSunDir.value; }

  setSun(azimuthDeg, elevationDeg) {
    this.azimuth = azimuthDeg;
    this.elevation = elevationDeg;
    this.uniforms.uSunDir.value.copy(sunDirection(azimuthDeg, elevationDeg));
  }

  set(name, value) { this.uniforms[name].value = value; }

  update(elapsed) { this.uniforms.uTime.value = elapsed; }
}
