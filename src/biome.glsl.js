import { WORLD, MOUNTAIN } from './config.js';

const f = (n) => n.toFixed(1);

// Biomes are not drawn as regions with borders. Two heavily domain-warped
// noise fields — moisture and substrate — are baked once, and everything else
// is read off that plane. Boundaries come out ragged and interlocking rather
// than Voronoi-crisp, and adjacent biomes always share a gradient.
//
// They differ mostly in VALUE and TEXTURE, barely in hue. Colour is meant to
// arrive from the sky; a desert sitting next to a swamp next to a forest in
// saturated colour would read as a tech demo.

export const BIOME_FIELD_GLSL = /* glsl */`
vec4 biomeField(vec2 p) {
  // Warp first, so no boundary can follow a circle of constant radius.
  vec2 w = vec2(fbm(p * 0.00021 + 11.3), fbm(p * 0.00021 - 7.1)) - 0.5;
  vec2 q = p + w * 2600.0;

  float moisture  = fbm(q * 0.00013 + 3.1);
  float substrate = fbm(q * 0.00019 + 31.7);

  // Braided channels: the iso-line of a noise field, which gives connected
  // curvilinear courses rather than blobs. fbm is centred on 0.5, so this band
  // has to be narrow — at 0.74 it would cover half the valley.
  float ridge = 1.0 - abs(fbm(q * 0.00040 + 5.5) * 2.0 - 1.0);
  float channel = smoothstep(0.945, 0.99, ridge);

  // Channels only make sense on the flats.
  channel *= 1.0 - smoothstep(${f(WORLD.valleyRadius * 0.82)}, ${f(WORLD.valleyRadius)}, length(p));

  return vec4(moisture, substrate, channel, 1.0);
}
`;

// Maps the baked field, plus altitude and slope, onto a surface.
// Reflectances are relative to uGround.x, so the global albedo slider still
// governs the whole world.
export const BIOME_SURFACE_GLSL = /* glsl */`
const vec3 C_TUSSOCK = vec3(1.06, 0.95, 0.66);
const vec3 C_DUNE    = vec3(1.28, 1.14, 0.87);
const vec3 C_SALT    = vec3(1.46, 1.43, 1.36);
const vec3 C_SWAMP   = vec3(0.44, 0.50, 0.40);
const vec3 C_FOREST  = vec3(0.31, 0.37, 0.26);
const vec3 C_BRAID   = vec3(1.31, 1.27, 1.15);
const vec3 C_ROCK    = vec3(0.78, 0.77, 0.75);
const vec3 C_SCREE   = vec3(1.02, 0.99, 0.94);
const vec3 C_SNOW    = vec3(2.60, 2.68, 2.82);

// detail.x = feature size, detail.y = strength, detail.z = wet sheen
void surfaceAt(vec4 field, float height, float slope,
               out vec3 albedo, out vec3 detail) {
  float moisture = field.x, substrate = field.y, channel = field.z;

  // Thresholds are placed against the measured fbm distribution (mean 0.500,
  // sd 0.128), not across a notional 0..1 — see tools/check-biomes.js.
  // Narrow bands: tussock is the middle of this ramp, so a wide transition
  // leaves it covering most of the valley by default.
  float dryness = smoothstep(0.495, 0.425, moisture);
  float wetness = smoothstep(0.505, 0.575, moisture);

  vec3 dry = mix(C_DUNE, C_SALT, smoothstep(0.40, 0.60, substrate));
  vec3 wet = mix(C_SWAMP, C_FOREST, smoothstep(0.40, 0.60, substrate));

  albedo = C_TUSSOCK;
  albedo = mix(albedo, dry, dryness);
  albedo = mix(albedo, wet, wetness);
  albedo = mix(albedo, C_BRAID, channel);

  // Dunes ripple, swamp is glassy, gravel is coarse and busy.
  detail = vec3(0.40, 1.0, 0.0);
  detail = mix(detail, vec3(0.16, 0.7, 0.0), dryness);
  detail = mix(detail, vec3(0.55, 0.4, 0.8), wetness);
  detail = mix(detail, vec3(1.30, 1.3, 0.0), channel);

  // Above the valley the ground turns to rock and scree. Steep faces shed
  // their loose material, so they show more rock and less scree.
  float alpine = smoothstep(${f(WORLD.valleyFloorY + 500)}, ${f(WORLD.valleyFloorY + 1300)}, height);
  vec3 highGround = mix(C_SCREE, C_ROCK, smoothstep(0.35, 0.75, slope));
  albedo = mix(albedo, highGround, alpine);
  detail = mix(detail, vec3(1.10, 1.5, 0.0), alpine);

  // Snow, which will not sit on anything steep. This is the surface that
  // actually catches the sunset. The line sits above the trail's high point,
  // so the track stays walkable rather than buried.
  float snow = smoothstep(${f(MOUNTAIN.snowLine)}, ${f(MOUNTAIN.snowFull)}, height)
             * (1.0 - smoothstep(0.52, 0.86, slope));
  albedo = mix(albedo, C_SNOW, snow);
  detail = mix(detail, vec3(0.70, 0.35, 0.10), snow);

  // Pulling toward each surface's own luminance rather than toward grey keeps
  // the value structure intact while the chroma comes off.
  albedo = mix(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), albedo, uChroma);
}
`;
