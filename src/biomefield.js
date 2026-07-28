import * as THREE from 'three';
import { bakeField } from './bake.js';
import { NOISE_GLSL } from './noise.glsl.js';
import { BIOME_FIELD_GLSL } from './biome.glsl.js';

// Moisture, substrate and channel mask, baked once. Boundaries are hundreds of
// metres across, so 8-bit at half the heightmap's resolution is ample — 16 MB
// against the heightmap's 67.
export const BIOME_RES = 2048;

export class Biomefield {
  constructor(renderer, heightfield) {
    this.size = heightfield.size;
    this.min = heightfield.min;

    this.target = bakeField(renderer, {
      res: BIOME_RES,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      filter: THREE.LinearFilter,
      uniforms: { uExtent: { value: new THREE.Vector2(this.min, this.size) } },
      fragmentShader: /* glsl */`
        ${NOISE_GLSL}
        ${BIOME_FIELD_GLSL}
        uniform vec2 uExtent;
        varying vec2 vUv;
        void main() {
          gl_FragColor = biomeField(uExtent.x + vUv * uExtent.y);
        }
      `,
    });

    this.texture = this.target.texture;
  }
}
