import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere.js';
import { GROUND_LIGHT_GLSL } from './ground-light.glsl.js';
import { BIOME_SURFACE_GLSL } from './biome.glsl.js';
import { RENDER_RES } from './heightfield.js';
import { GROUND } from './config.js';

// Geometry clipmap. Nested square rings centred on the camera, each level
// twice the cell size of the one inside it, all sampling the baked heightmap
// in the vertex shader.
//
// Every level shares one snapped centre. That is what keeps this simple: each
// ring's hole is then exactly the extent of its child, so the levels nest
// perfectly and none of the usual clipmap trim geometry is needed. It works
// because level 0 is wider than the snap step, so the camera can never fall
// out of the finest level.

const SEGS      = 160;   // cells per side, every level
const BASE_CELL = 8;     // metres, level 0 — matches the heightmap texel
const LEVELS    = 6;     // level 5 reaches +-20 km

const HALF = SEGS / 2;
const SNAP = 2 * BASE_CELL * 2 ** (LEVELS - 1);   // 512 m

function buildLevelGeometry(hollow) {
  const stride = SEGS + 1;
  const positions = new Float32Array(stride * stride * 3);

  for (let j = 0; j <= SEGS; j++) {
    for (let i = 0; i <= SEGS; i++) {
      const o = (j * stride + i) * 3;
      positions[o]     = i - HALF;   // grid index, scaled by cell size in the shader
      positions[o + 1] = 0;
      positions[o + 2] = j - HALF;
    }
  }

  // Rings omit the middle half in each axis — exactly the child's footprint.
  const lo = SEGS / 4, hi = (SEGS * 3) / 4;
  const index = [];
  for (let j = 0; j < SEGS; j++) {
    for (let i = 0; i < SEGS; i++) {
      if (hollow && i >= lo && i < hi && j >= lo && j < hi) continue;
      const a = j * stride + i, b = a + 1, c = b + stride, d = a + stride;
      index.push(a, d, b, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return geometry;
}

const VERTEX = /* glsl */`
  uniform sampler2D uHeight;
  uniform vec2  uField;      // world min, world size
  uniform vec2  uCenter;
  uniform float uCell;

  varying vec3 vWorldPos;

  void main() {
    vec2 local = position.xz;

    // Geomorph the outer band toward this level's even vertices. At full
    // strength the odd vertices land on their even neighbours, so the edge
    // becomes exactly the coarser level's edge and the T-junction closes.
    // local is vec2 — .y is the world z axis.
    float d = max(abs(local.x), abs(local.y)) / ${HALF.toFixed(1)};
    float a = clamp((d - 0.72) / 0.24, 0.0, 1.0);
    local -= mod(local, 2.0) * a;

    vec2 wp = uCenter + local * uCell;
    vec2 uv = (wp - uField.x) / uField.y;

    // Valid in a vertex shader: on WebGL2 three compiles this source as
    // GLSL 3.00 ES with '#define texture2D texture', and GLSL3's texture()
    // works in both stages. texture2DLod is NOT shimmed and will not compile.
    float h = texture2D(uHeight, uv).r;
    vWorldPos = vec3(wp.x, h, wp.y);

    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const FRAGMENT = /* glsl */`
  ${ATMOSPHERE_GLSL}

  ${GROUND_LIGHT_GLSL}
  ${BIOME_SURFACE_GLSL}

  uniform sampler2D uHeight;
  uniform sampler2D uBiome;
  uniform vec2  uField;
  uniform float uTexel;      // world metres per heightmap texel

  varying vec3 vWorldPos;

  void main() {
    // Normals from the heightmap rather than the mesh, so shading detail is
    // independent of which clipmap level you happen to be standing on.
    vec2 uv = (vWorldPos.xz - uField.x) / uField.y;
    float du = uTexel / uField.y;

    float hL = texture2D(uHeight, uv - vec2(du, 0.0)).r;
    float hR = texture2D(uHeight, uv + vec2(du, 0.0)).r;
    float hD = texture2D(uHeight, uv - vec2(0.0, du)).r;
    float hU = texture2D(uHeight, uv + vec2(0.0, du)).r;
    vec3 n = normalize(vec3(hL - hR, 2.0 * uTexel, hD - hU));

    float dist = length(vWorldPos - cameraPosition);
    float slope = clamp(1.0 - n.y, 0.0, 1.0);

    vec3 albedo, detail;
    surfaceAt(texture2D(uBiome, uv), vWorldPos.y, slope, albedo, detail);

    // The heightmap resolves nothing below ~9 m, so flat ground arrives as a
    // single normal. Break it up close to the camera at whatever grain this
    // biome calls for, and fade it out well before it can alias.
    float near = 1.0 - smoothstep(80.0, 600.0, dist);
    if (near * detail.y > 0.002) {
      vec2 dp = vWorldPos.xz * detail.x;
      float dx = vnoise(dp + vec2(0.5, 0.0)) - vnoise(dp - vec2(0.5, 0.0));
      float dz = vnoise(dp + vec2(0.0, 0.5)) - vnoise(dp - vec2(0.0, 0.5));
      n = normalize(n + vec3(-dx, 0.0, -dz) * 1.4 * detail.y * near);
    }

    // Mottling at two scales, so the ground reads as a surface at every range
    // rather than only where the detail normal reaches. 625 m survives to the
    // horizon; 59 m is still several pixels wide at 2 km, so neither aliases.
    float macro = vnoise(vWorldPos.xz * 0.0016);
    float meso  = vnoise(vWorldPos.xz * 0.017);
    float mesoFade = 1.0 - smoothstep(300.0, 2200.0, dist);

    albedo *= uGround.x * (0.78 + 0.44 * macro) * (1.0 + 0.34 * (meso - 0.5) * mesoFade);

    vec3 lit = surfaceLight(albedo, n);

    // Standing water throws the low sun straight back at you. Without this,
    // swamp reads as dark dirt rather than as something wet.
    if (detail.z > 0.01) {
      vec3 hv = normalize(normalize(cameraPosition - vWorldPos) + uSunDir);
      lit += uSunHalo * pow(max(dot(n, hv), 0.0), 90.0) * detail.z * 0.9;
    }

    gl_FragColor = vec4(applyAerial(lit, vWorldPos, cameraPosition), 1.0);
  }
`;

export class Terrain {
  constructor(atmosphere, heightfield, biomefield) {
    this.group = new THREE.Group();
    this.levels = [];

    const field = new THREE.Vector2(heightfield.min, heightfield.size);
    const texel = heightfield.size / RENDER_RES;

    // Shared across every level — and with the trail — so the panel retunes
    // the whole world at once.
    this.groundUniforms = {
      uGround: {
        value: new THREE.Vector4(
          GROUND.albedo, GROUND.skyFill, GROUND.sunGain, GROUND.skyWarmth),
      },
      uChroma: { value: GROUND.chroma },
    };

    const solid = buildLevelGeometry(false);
    const ring = buildLevelGeometry(true);

    for (let l = 0; l < LEVELS; l++) {
      const uCenter = { value: new THREE.Vector2() };

      const material = new THREE.ShaderMaterial({
        // Spread shares the atmosphere's uniform objects, so one edit still
        // repaints every level at once.
        uniforms: {
          ...atmosphere.uniforms,
          uHeight: { value: heightfield.texture },
          uBiome:  { value: biomefield.texture },
          uField:  { value: field },
          uTexel:  { value: texel },
          uCell:   { value: BASE_CELL * 2 ** l },
          ...this.groundUniforms,
          uCenter,
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.DoubleSide,
        fog: false,
      });

      const mesh = new THREE.Mesh(l === 0 ? solid : ring, material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.levels.push(uCenter);
    }
  }

  // One snapped centre for all levels keeps the nesting exact.
  update(camera) {
    const cx = Math.round(camera.position.x / SNAP) * SNAP;
    const cz = Math.round(camera.position.z / SNAP) * SNAP;
    for (const uCenter of this.levels) uCenter.value.set(cx, cz);
  }
}
