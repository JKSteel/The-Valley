import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere.js';
import { GROUND_LIGHT_GLSL } from './ground-light.glsl.js';
import { NOISE_GLSL } from './noise.glsl.js';
import { WORLD, ICE } from './config.js';

// A cylindrical shell enclosing the world, 226 km around, seen from inside.
//
// The relief is real geometry, not a normal map. Shaded relief on a smooth
// cylinder has no broken silhouette, no parallax and no self-shadowing, and at
// 25 km it reads as texture painted on a flat board. The same field displaces
// the vertices and defines the shading normal, so the two describe one surface.
//
// All ring noise is sampled on the unit circle, which makes it periodic by
// construction. Sampling on world XZ would leave a seam where the wall closes.

// Shared by both stages — this is what keeps geometry and shading in step.
//
// A tabular shelf, not a glacier snout: broad gentle bulges carrying long,
// even vertical flutes, and a wave-planed foot at the waterline.
const ICE_FIELD_GLSL = /* glsl */`
  float iceField(vec2 dir, float y) {
    // Plan shape. Gentle and large — the face is close to a plane.
    float broad = fbm(dir * 9.0 + vec2(y * 0.00026, -y * 0.00016));

    // Vertical flutes, ridged rather than plain noise so every rib has the
    // same depth on every bearing. Plain noise leaves whole arcs of the ring
    // almost flat, which is why one heading looked modelled and another
    // looked painted on. Squared off at the crests to keep them rounded.
    float rv = vnoise(dir * 150.0 + vec2(y * 0.00040, -y * 0.00024));
    float rib = 1.0 - abs(rv * 2.0 - 1.0);
    rib = rib * rib * (3.0 - 2.0 * rib);

    return broad * 0.45 + rib * 0.55;
  }

  // Face relief with the foot folded in, so vertex and fragment agree on one
  // surface. The swell planes the base smooth and leaves it standing out from
  // the face; the flutes die away as they reach it.
  float iceRelief(vec2 dir, float y, float footOut) {
    float foot = 1.0 - smoothstep(80.0, 460.0, y);
    return iceField(dir, y) * (1.0 - foot * 0.80) + foot * footOut;
  }
`;

const VERTEX = /* glsl */`
  ${NOISE_GLSL}
  ${ICE_FIELD_GLSL}

  uniform vec2 uSpan;      // base y, height
  uniform vec4 uShape;     // crest variation, radial waviness, displacement, foot

  attribute float aV;

  varying vec3  vWorldPos;
  varying vec2  vDir;
  varying float vV;
  varying float vRadius;

  void main() {
    vec2 dir = normalize(position.xz);
    float R = length(position.xz);

    // Near level. A tabular shelf is cut off flat along the top; the crest
    // only steps where the plan shape swells.
    float crest = fbm(dir * 9.0);
    float top = uSpan.x + uSpan.y * (1.0 - uShape.x * 0.5 + uShape.x * crest);
    float y = mix(uSpan.x, top, aV);

    float wobble = fbm(dir * 5.0) - 0.5;

    // Inward, so high relief stands toward the viewer.
    float footOut = uShape.w / max(uShape.z, 1.0);
    float radius = R + wobble * uShape.y - (iceRelief(dir, y, footOut) - 0.5) * uShape.z;

    vec2 xz = dir * radius;
    vDir = dir;
    vV = aV;
    vRadius = radius;
    vWorldPos = vec3(xz.x, y, xz.y);

    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const FRAGMENT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_LIGHT_GLSL}
  ${ICE_FIELD_GLSL}

  uniform vec4 uIce;       // albedo, glow, displacement, crevasse
  uniform vec3 uIce2;      // strata contrast, shadow strength, foot

  varying vec3  vWorldPos;
  varying vec2  vDir;
  varying float vV;
  varying float vRadius;

  // A shelf face is very nearly white. Blue belongs only where the ice is
  // genuinely deep — groove bottoms, clefts, under the planed foot.
  const vec3 C_DEEP = vec3(0.40, 0.63, 0.87);   // compressed ice, deep in a groove
  const vec3 C_MID  = vec3(0.80, 0.89, 0.97);
  const vec3 C_PALE = vec3(0.95, 0.975, 1.00);  // the face itself
  const vec3 C_FOOT = vec3(0.68, 0.82, 0.92);   // wave-planed base, faintly blue
  const vec3 C_GLOW = vec3(0.52, 0.78, 1.00);   // light that has come through

  void main() {
    vec3 radial  = vec3(vDir.x, 0.0, vDir.y);
    vec3 tangent = vec3(-vDir.y, 0.0, vDir.x);
    vec2 t2 = vec2(tangent.x, tangent.z);
    float y = vWorldPos.y;
    float amp = uIce.z;

    float footOut = uIce2.z / max(amp, 1.0);
    float f0 = iceRelief(vDir, y, footOut);

    // Normal of the displaced surface r = R - amp*f, from the gradient of the
    // implicit form. Because it comes from the same field the vertices used,
    // shading and silhouette agree instead of contradicting one another.
    float e = 0.0016, ey = 45.0;
    float fT = (iceRelief(normalize(vDir + t2 * e), y, footOut) - f0) / e;
    float fY = (iceRelief(vDir, y + ey, footOut) - f0) / ey;

    vec3 outward = normalize(radial
                           + tangent * (amp * fT / vRadius)
                           + vec3(0.0, 1.0, 0.0) * (amp * fY));
    vec3 n = -outward;                       // the inner face is what we see

    // Cast shadow across the face. The sun is 12 degrees up, so it throws long
    // shadows sideways off every buttress — that is most of what makes relief
    // read as relief rather than as a stain.
    vec2 sunH = uSunDir.xz;
    float along = dot(normalize(sunH + vec2(1e-5)), t2);
    float rise = uSunDir.y / max(length(sunH), 0.001);
    float occ = 0.0;
    for (int s = 1; s <= 2; s++) {
      float d = float(s) * 0.0045;
      occ = max(occ, iceRelief(normalize(vDir + t2 * (d * along)),
                               y + d * vRadius * rise, footOut) - f0);
    }
    float shadow = 1.0 - smoothstep(0.02, 0.16, occ) * uIce2.y;

    // Fracture clefts: the iso-line of a second field, so they run as connected
    // fissures rather than blobs. More of them high up where the ice moves.
    float fr = 1.0 - abs(fbm(vDir * 34.0 + vec2(y * 0.00075, y * 0.00042)) * 2.0 - 1.0);
    float crevasse = smoothstep(0.945, 0.998, fr) * mix(0.25, 1.0, vV) * uIce.w;

    // Faint layering on the face. Kept low-contrast on purpose — a shelf face
    // is close to featureless white, and busy strata is what made this read as
    // a dirty board rather than as ice.
    float strata = mix(0.5, 0.5 + 0.5 * sin(y * 0.020 + fbm(vDir * 26.0) * 7.0), uIce2.x);

    // Recesses see less sky, but gently: deep occlusion here reads as grime.
    float ao = mix(0.74, 1.0, smoothstep(0.20, 0.70, f0));

    vec3 albedo = mix(C_MID, C_PALE, smoothstep(0.34, 0.74, f0));
    albedo = mix(C_DEEP, albedo, smoothstep(0.06, 0.38, f0));   // blue only when deep
    albedo = mix(albedo, C_PALE, strata * 0.18);
    albedo = mix(albedo, C_DEEP * 0.7, crevasse);

    // The wave-planed foot, with the smooth horizontal banding the swell cuts
    // into it. Confined to the base — the face above stays clean.
    float footMask = 1.0 - smoothstep(140.0, 540.0, y);
    float band = 0.5 + 0.5 * sin(y * 0.055 + fbm(vDir * 12.0) * 5.0);
    albedo = mix(albedo, mix(C_FOOT, C_PALE, band * 0.7 + 0.15), footMask * 0.8);

    albedo *= uIce.x * ao;

    float ndl = max(dot(n, uSunDir), 0.0) * shadow;
    vec3 lit = albedo * (uSunLight * ndl * uGround.z + ambientSky(n.y) * uGround.y);

    vec3 view = normalize(vWorldPos - cameraPosition);
    vec3 hv = normalize(uSunDir - view);
    lit += uSunLight * pow(max(dot(n, hv), 0.0), 60.0) * 0.35 * shadow * (1.0 - crevasse);

    // Backlit translucency. Looking west into the sun the wall is not lit from
    // our side at all, and everything you see is light that has travelled
    // through the ice — which is what stops the far side reading as a slab.
    // Thin edges pass more, so the flutes glow and the recesses stay dark.
    float through = pow(max(dot(view, uSunDir), 0.0), 4.0);
    lit += C_GLOW * through * uIce.y * (1.0 - ndl) * mix(0.35, 1.0, vV)
         * mix(0.35, 1.3, f0);

    gl_FragColor = vec4(applyAerial(lit, vWorldPos, cameraPosition), 1.0);
  }
`;

export function createIceWall(atmosphere, groundUniforms) {
  const R = ICE.radialSegments, V = ICE.heightSegments;

  const positions = new Float32Array(R * (V + 1) * 3);
  const aV = new Float32Array(R * (V + 1));

  for (let v = 0; v <= V; v++) {
    for (let i = 0; i < R; i++) {
      const th = (i / R) * Math.PI * 2;
      const k = v * R + i;
      positions[k * 3]     = Math.cos(th) * WORLD.iceWallRadius;
      positions[k * 3 + 1] = 0;
      positions[k * 3 + 2] = Math.sin(th) * WORLD.iceWallRadius;
      aV[k] = v / V;
    }
  }

  const index = [];
  for (let v = 0; v < V; v++) {
    for (let i = 0; i < R; i++) {
      const j = (i + 1) % R;                 // wraps, so there is no seam quad
      const a = v * R + i, b = v * R + j;
      const c = (v + 1) * R + j, d = (v + 1) * R + i;
      index.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aV', new THREE.BufferAttribute(aV, 1));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphere.uniforms,
      ...groundUniforms,
      uSpan:  { value: new THREE.Vector2(WORLD.iceWallBase, WORLD.iceWallHeight) },
      uShape: { value: new THREE.Vector4(
        ICE.topVariation, ICE.waviness, ICE.displace, ICE.foot) },
      uIce:   { value: new THREE.Vector4(ICE.albedo, ICE.glow, ICE.displace, ICE.crevasse) },
      uIce2:  { value: new THREE.Vector3(ICE.strata, ICE.shadow, ICE.foot) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
