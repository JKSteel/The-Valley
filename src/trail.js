import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere.js';
import { GROUND_LIGHT_GLSL } from './ground-light.glsl.js';
import { RENDER_RES } from './heightfield.js';
import { solveRidgeTrail } from './trail-route.js';
import { TRAIL } from './config.js';

// The route comes from trail-route.js; this file only turns it into geometry.
//
// Both the tread and the markers sample the same height texture the terrain
// does, in their own vertex shaders. That is what keeps them welded to the
// rendered surface: nothing here relies on the coarser CPU heightmap the route
// was solved against.

const HEIGHT_SAMPLE = /* glsl */`
  uniform sampler2D uHeight;
  uniform vec2 uField;        // world min, world size

  float groundAt(vec2 wxz) {
    return texture2D(uHeight, (wxz - uField.x) / uField.y).r;
  }
`;

const TREAD_VERTEX = /* glsl */`
  ${HEIGHT_SAMPLE}
  uniform float uLift;

  attribute float aAcross;    // -1 .. 1 across the tread

  varying vec3  vWorldPos;
  varying float vAcross;

  void main() {
    vec2 wxz = position.xz;
    vAcross = aAcross;
    vWorldPos = vec3(wxz.x, groundAt(wxz) + uLift, wxz.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const TREAD_FRAGMENT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_LIGHT_GLSL}
  ${HEIGHT_SAMPLE}
  uniform float uTexel;

  varying vec3  vWorldPos;
  varying float vAcross;

  void main() {
    // Same normal source as the terrain, so the tread lies in the hillside
    // rather than looking pasted onto it.
    vec2 uv = (vWorldPos.xz - uField.x) / uField.y;
    float du = uTexel / uField.y;
    float hL = texture2D(uHeight, uv - vec2(du, 0.0)).r;
    float hR = texture2D(uHeight, uv + vec2(du, 0.0)).r;
    float hD = texture2D(uHeight, uv - vec2(0.0, du)).r;
    float hU = texture2D(uHeight, uv + vec2(0.0, du)).r;
    vec3 n = normalize(vec3(hL - hR, 2.0 * uTexel, hD - hU));

    // Worn earth and gravel: lighter and warmer than the surrounding ground,
    // scuffed along its length, darker at the edges where it beds in.
    float wear = 0.82 + 0.36 * vnoise(vWorldPos.xz * 1.7);
    float edge = 1.0 - 0.45 * smoothstep(0.45, 1.0, abs(vAcross));

    vec3 albedo = vec3(1.06, 0.97, 0.84) * uGround.x * 1.45 * wear * edge;

    gl_FragColor = vec4(shadeGround(albedo, n, vWorldPos), 1.0);
  }
`;

const MARKER_VERTEX = /* glsl */`
  ${HEIGHT_SAMPLE}

  attribute vec2 aBase;       // marker footing, world XZ
  attribute vec3 aTint;

  varying vec3 vWorldPos;
  varying vec3 vTint;
  varying vec3 vNormal;

  void main() {
    vec2 wxz = aBase + position.xz;
    vTint = aTint;
    vNormal = normal;
    vWorldPos = vec3(wxz.x, groundAt(aBase) + position.y, wxz.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const MARKER_FRAGMENT = /* glsl */`
  ${ATMOSPHERE_GLSL}
  ${GROUND_LIGHT_GLSL}

  varying vec3 vWorldPos;
  varying vec3 vTint;
  varying vec3 vNormal;

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;

    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 light = uSunLight * ndl * uGround.z * 1.4 + ambientSky(n.y) * uGround.y * 1.5;

    // The orange carries a little of its own light. A marker you cannot pick
    // out of the hillside is not doing its job.
    vec3 col = vTint * light + vTint * 0.06;

    gl_FragColor = vec4(applyAerial(col, vWorldPos, cameraPosition), 1.0);
  }
`;

export class Trail {
  constructor(atmosphere, heightfield, terrain) {
    const { points, stats } = solveRidgeTrail((x, z) => heightfield.sample(x, z));
    this.stats = stats;

    // Centripetal Catmull-Rom removes the DP's residual staircase and gives
    // even spacing along the loop in one step.
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p.x, 0, p.z)), true, 'centripetal');

    const stations = Math.max(256, Math.round(stats.length / TRAIL.station));
    this.path = curve.getSpacedPoints(stations).slice(0, stations);

    const shared = {
      uHeight: { value: heightfield.texture },
      uField:  { value: new THREE.Vector2(heightfield.min, heightfield.size) },
      uTexel:  { value: heightfield.size / RENDER_RES },
      ...terrain.groundUniforms,
    };

    this.group = new THREE.Group();
    this.group.add(this._buildTread(atmosphere, shared));
    this.group.add(this._buildMarkers(atmosphere, shared));
  }

  _tangent(i) {
    const n = this.path.length;
    const a = this.path[(i - 1 + n) % n], b = this.path[(i + 1) % n];
    const tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1;
    return [tx / len, tz / len];
  }

  _buildTread(atmosphere, shared) {
    const n = this.path.length;
    const half = TRAIL.width / 2;

    const positions = new Float32Array(n * 2 * 3);
    const across = new Float32Array(n * 2);

    for (let i = 0; i < n; i++) {
      const p = this.path[i];
      const [tx, tz] = this._tangent(i);
      // Perpendicular in the ground plane.
      const px = tz * half, pz = -tx * half;

      const o = i * 6;
      positions[o]     = p.x - px; positions[o + 1] = 0; positions[o + 2] = p.z - pz;
      positions[o + 3] = p.x + px; positions[o + 4] = 0; positions[o + 5] = p.z + pz;
      across[i * 2] = -1; across[i * 2 + 1] = 1;
    }

    const index = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = a + 1;
      const c = ((i + 1) % n) * 2, d = c + 1;   // wraps, closing the loop
      index.push(a, c, b, b, c, d);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    const material = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere.uniforms, ...shared, uLift: { value: TRAIL.lift } },
      vertexShader: TREAD_VERTEX,
      fragmentShader: TREAD_FRAGMENT,
      side: THREE.DoubleSide,
      // Coplanar with the terrain by construction, so it needs both a small
      // lift and a depth bias to stay out of a z-fight.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  _buildMarkers(atmosphere, shared) {
    // A DOC-style orange triangle on a weathered post, plate square to the
    // direction of travel so it faces you as you walk up to it.
    const post = new THREE.BoxGeometry(0.07, 1.35, 0.07)
      .translate(0, 0.675, 0).toNonIndexed();
    const postPos = post.attributes.position.array;
    const postNrm = post.attributes.normal.array;

    const plate = new Float32Array([
      -0.13, 1.00, 0.0,   0.13, 1.00, 0.0,   0.0, 1.33, 0.0,
    ]);
    const plateNrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);

    const POST_TINT = new THREE.Color().setHex(0x2b2620, THREE.SRGBColorSpace);
    const PLATE_TINT = new THREE.Color().setHex(0xff6a13, THREE.SRGBColorSpace);

    const spacing = Math.max(20, TRAIL.markerSpacing);
    const step = Math.max(1, Math.round(spacing / TRAIL.station));

    const positions = [], bases = [], normals = [], tints = [];

    const emit = (src, nrm, tint, mx, mz, tx, tz) => {
      for (let v = 0; v < src.length; v += 3) {
        const lx = src[v], ly = src[v + 1], lz = src[v + 2];
        // Rotate so local +z runs along the trail.
        positions.push(lx * tz + lz * tx, ly, -lx * tx + lz * tz);
        normals.push(nrm[v] * tz + nrm[v + 2] * tx, nrm[v + 1],
                     -nrm[v] * tx + nrm[v + 2] * tz);
        bases.push(mx, mz);
        tints.push(tint.r, tint.g, tint.b);
      }
    };

    for (let i = 0; i < this.path.length; i += step) {
      const p = this.path[i];
      const [tx, tz] = this._tangent(i);
      emit(postPos, postNrm, POST_TINT, p.x, p.z, tx, tz);
      emit(plate, plateNrm, PLATE_TINT, p.x, p.z, tx, tz);
    }

    this.markerCount = Math.ceil(this.path.length / step);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aBase', new THREE.Float32BufferAttribute(bases, 2));
    geometry.setAttribute('aTint', new THREE.Float32BufferAttribute(tints, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    const material = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere.uniforms, ...shared },
      vertexShader: MARKER_VERTEX,
      fragmentShader: MARKER_FRAGMENT,
      side: THREE.DoubleSide,
      fog: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  nearest(x, z) {
    let best = this.path[0], bestD = Infinity;
    for (const p of this.path) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
}
