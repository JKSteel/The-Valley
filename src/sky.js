import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere.js';

// The sky is a small sphere parented to the camera and drawn first with depth
// testing off, so it costs nothing and never interacts with the far plane.
export function createSky(atmosphere) {
  const material = new THREE.ShaderMaterial({
    uniforms: atmosphere.uniforms,
    depthTest: false,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,

    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(mat3(modelMatrix) * position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,

    fragmentShader: /* glsl */`
      ${ATMOSPHERE_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(vDir), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 32), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}
