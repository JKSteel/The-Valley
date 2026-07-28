import * as THREE from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere.js';
import { WORLD, OCEAN } from './config.js';

// A flat sheet at sea level, shaded only — no displacement anywhere in this
// file. See the note in config.js for why every displaced version read worse.
//
// Keep this simple. The ripple runs at all distances on purpose: fading it out
// leaves a mirror, which is not what water looks like.

export function createOcean(atmosphere) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphere.uniforms,
      uRipple: { value: new THREE.Vector3(
        OCEAN.rippleScale, OCEAN.rippleSpeed, OCEAN.rippleDepth) },
      uDeep: { value: new THREE.Vector3(...OCEAN.deep) },
    },
    fog: false,

    vertexShader: /* glsl */`
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
      }
    `,

    fragmentShader: /* glsl */`
      ${ATMOSPHERE_GLSL}

      uniform vec3 uRipple;   // scale, drift speed, depth
      uniform vec3 uDeep;

      varying vec3 vWorldPos;

      void main() {
        vec3 view = normalize(vWorldPos - cameraPosition);

        // Enough surface break to stop it reading as glass.
        vec2 q = vWorldPos.xz * uRipple.x
               + vec2(uTime * uRipple.y, uTime * uRipple.y * 0.6);
        float nx = fbm(q + vec2(1.7, 0.0)) - fbm(q - vec2(1.7, 0.0));
        float nz = fbm(q + vec2(0.0, 1.7)) - fbm(q - vec2(0.0, 1.7));
        vec3 n = normalize(vec3(nx * uRipple.z, 1.0, nz * uRipple.z));

        vec3 refl = reflect(view, n);
        refl.y = abs(refl.y);                    // never sample below the horizon
        vec3 sky = skyColor(refl);

        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-view, n), 0.0), 5.0);
        vec3 col = mix(uDeep, sky, fresnel);

        gl_FragColor = vec4(applyAerial(col, vWorldPos, cameraPosition), 1.0);
      }
    `,
  });

  const size = WORLD.iceWallRadius * 2.2;
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;      // terrain draws over it wherever land is above sea level
  return mesh;
}
