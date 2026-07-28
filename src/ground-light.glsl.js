// Shared surface lighting. Requires ATMOSPHERE_GLSL to be included first, and
// a uGround uniform (albedo, sky fill, sun gain). Terrain, trail and markers
// all go through this so nothing can drift out of agreement with the sky.
export const GROUND_LIGHT_GLSL = /* glsl */`
uniform vec4  uGround;    // albedo, sky fill, sun gain, sky warmth
uniform float uChroma;

// Hemisphere ambient built straight from the palette — no cirrus and no sun
// disc, so it costs a few mixes instead of a second full skyColor call.
//
// Weighted toward the dome, not the horizon: a horizontal surface sees the
// whole sky, and the blue upper dome covers far more solid angle than the
// bright band at the horizon. Skylight here is therefore cool while the sun is
// warm, and that split is what lets albedo differences read as different hues
// instead of all going brown.
vec3 ambientSky(float ny) {
  vec3 ring = mix(uEastHorizon, uWestHorizon, 0.5) + uBelt * 0.35;
  vec3 dome = mix(uZenith, uEastSky, 0.5);
  vec3 hemi = mix(dome, ring, uGround.w);
  return hemi * (0.45 + 0.55 * clamp(ny, 0.0, 1.0));
}

// Reflected light before the atmosphere gets to it. Split out so callers can
// add their own highlights — wet ground, snow glitter — while these still land
// on the near side of the mist.
vec3 surfaceLight(vec3 albedo, vec3 n) {
  float ndl = max(dot(n, uSunDir), 0.0);
  return albedo * (uSunLight * ndl * uGround.z + ambientSky(n.y) * uGround.y);
}

vec3 shadeGround(vec3 albedo, vec3 n, vec3 worldPos) {
  return applyAerial(surfaceLight(albedo, n), worldPos, cameraPosition);
}
`;
