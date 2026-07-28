import * as THREE from 'three';

// Renders a world-space field into a texture once at startup. Both the
// heightmap and the biome field go through here.

const QUAD = new THREE.PlaneGeometry(2, 2);
const CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const BAKE_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export function bakeField(renderer, { fragmentShader, uniforms, res, format, type, filter }) {
  const target = new THREE.WebGLRenderTarget(res, res, {
    format, type,
    minFilter: filter, magFilter: filter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });

  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: BAKE_VERTEX, fragmentShader,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(QUAD, material));

  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, CAMERA);
  renderer.setRenderTarget(previous);

  material.dispose();
  return target;
}
