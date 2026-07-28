import * as THREE from 'three';
import { bakeField } from './bake.js';
import { NOISE_GLSL } from './noise.glsl.js';
import { TERRAIN_HEIGHT_GLSL } from './terrain-height.glsl.js';
import { WORLD } from './config.js';

// Bakes terrainHeight() once into a float texture, then never evaluates it
// again. The GPU samples the texture in the vertex shader; the CPU samples a
// lower-resolution readback for ground queries. One definition, two consumers,
// so walking can never disagree with what you see.

export const RENDER_RES = 4096;   // ~9 m per texel across the baked extent
const QUERY_RES = 2048;           // ~18 m per texel, read back to a Float32Array

const BAKE_GLSL = /* glsl */`
  ${NOISE_GLSL}
  ${TERRAIN_HEIGHT_GLSL}
  uniform vec2 uExtent;     // world min, world size (square)
  varying vec2 vUv;
  void main() {
    vec2 world = uExtent.x + vUv * uExtent.y;
    gl_FragColor = vec4(terrainHeight(world), 0.0, 0.0, 1.0);
  }
`;

export class Heightfield {
  constructor(renderer) {
    // Wide enough that the coastline finishes dropping to the sea bed well
    // inside the texture, so every edge texel is already below sea level.
    this.size = WORLD.coastRadius * 2.5;      // 37.5 km square, centred on origin
    this.min = -this.size / 2;

    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error('Float render targets unavailable (needs WebGL2 + EXT_color_buffer_float)');
    }

    // 32-bit float textures are not filterable in WebGL2 without this. Asking
    // for LinearFilter without it makes the texture incomplete, and every
    // sample silently returns zero — a flat world at sea level.
    this.filterable = !!renderer.extensions.get('OES_texture_float_linear');
    if (!this.filterable) {
      console.warn('OES_texture_float_linear missing — heightmap will sample stepped');
    }

    const bake = (res, format) => bakeField(renderer, {
      res, format,
      type: THREE.FloatType,
      filter: this.filterable ? THREE.LinearFilter : THREE.NearestFilter,
      uniforms: { uExtent: { value: new THREE.Vector2(this.min, this.size) } },
      fragmentShader: BAKE_GLSL,
    });

    // Single-channel float keeps the render texture at 67 MB rather than 268.
    this.texture = bake(RENDER_RES, THREE.RedFormat).texture;

    const queryTarget = bake(QUERY_RES, THREE.RGBAFormat);
    this.queryRes = QUERY_RES;
    this.heights = this._readback(renderer, queryTarget, QUERY_RES);
    queryTarget.dispose();

    this._verify();
  }

  // A failed readback returns zeros, which would look like a flat world at sea
  // level rather than an error. Check two points the profile pins exactly.
  _verify() {
    const centre = this.sample(0, 0);
    const offshore = this.sample(WORLD.coastRadius + 3000, 0);

    if (Math.abs(centre - WORLD.valleyFloorY) > 25 || offshore > -100) {
      throw new Error(
        `Heightmap readback looks wrong: centre ${centre.toFixed(1)}m ` +
        `(expected ~${WORLD.valleyFloorY}m), offshore ${offshore.toFixed(1)}m (expected ~-140m)`);
    }
  }

  _readback(renderer, target, res) {
    // readPixels needs RGBA; keep only the red channel.
    const rgba = new Float32Array(res * res * 4);
    renderer.readRenderTargetPixels(target, 0, 0, res, res, rgba);

    const heights = new Float32Array(res * res);
    for (let i = 0; i < heights.length; i++) heights[i] = rgba[i * 4];
    return heights;
  }

  // Bilinear ground height. Row 0 of the readback is v = 0, matching the
  // texture the GPU samples, so both sides agree.
  sample(x, z) {
    const n = this.queryRes;
    const u = ((x - this.min) / this.size) * (n - 1);
    const v = ((z - this.min) / this.size) * (n - 1);

    const x0 = Math.min(Math.max(Math.floor(u), 0), n - 1);
    const z0 = Math.min(Math.max(Math.floor(v), 0), n - 1);
    const x1 = Math.min(x0 + 1, n - 1);
    const z1 = Math.min(z0 + 1, n - 1);

    const fx = Math.min(Math.max(u - x0, 0), 1);
    const fz = Math.min(Math.max(v - z0, 0), 1);

    const h = this.heights;
    const h00 = h[z0 * n + x0], h10 = h[z0 * n + x1];
    const h01 = h[z1 * n + x0], h11 = h[z1 * n + x1];

    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) +
           (h01 * (1 - fx) + h11 * fx) * fz;
  }
}
