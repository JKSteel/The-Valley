import * as THREE from 'three';
import { CAMERA } from './config.js';
import { Atmosphere } from './atmosphere.js';
import { createSky } from './sky.js';
import { Heightfield } from './heightfield.js';
import { Biomefield } from './biomefield.js';
import { Terrain } from './terrain.js';
import { createOcean } from './ocean.js';
import { createIceWall } from './ice-wall.js';
import { Trail } from './trail.js';
import { FirstPersonControls } from './controls.js';
import { Post } from './post.js';
import { createUI } from './ui.js';

function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;   // handled in the final post pass
  document.body.appendChild(renderer.domElement);

  // A shader that fails to compile is logged to the console and then skipped,
  // so the object simply never appears. Surface it instead.
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = (shader, label) => {
      const text = gl.getShaderInfoLog(shader)?.trim();
      return text ? `--- ${label} ---\n${text}` : '';
    };
    const message = [
      gl.getProgramInfoLog(program)?.trim(),
      log(vs, 'vertex'), log(fs, 'fragment'),
    ].filter(Boolean).join('\n\n');

    console.error(message);
    window.valleyError?.('Shader failed to compile\n\n' + message);
  };

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov, innerWidth / innerHeight, CAMERA.near, CAMERA.far);
  scene.add(camera);                            // the sky is parented to it

  const atmosphere = new Atmosphere();
  camera.add(createSky(atmosphere));

  const heightfield = new Heightfield(renderer);
  const biomefield = new Biomefield(renderer, heightfield);
  const terrain = new Terrain(atmosphere, heightfield, biomefield);
  scene.add(terrain.group);
  scene.add(createOcean(atmosphere));
  scene.add(createIceWall(atmosphere, terrain.groundUniforms));

  const trail = new Trail(atmosphere, heightfield, terrain);
  scene.add(trail.group);

  camera.position.set(0, heightfield.sample(0, 0) + CAMERA.eyeHeight, 0);

  const controls = new FirstPersonControls(
    camera, renderer.domElement, (x, z) => heightfield.sample(x, z));

  // The trail is 73 km around and a long walk from the valley floor.
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyT') return;
    const p = trail.nearest(camera.position.x, camera.position.z);
    camera.position.set(p.x, heightfield.sample(p.x, p.z) + CAMERA.eyeHeight, p.z);
  });

  const post = new Post(renderer, scene, camera);
  const ui = createUI(atmosphere, post, terrain);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight);
  });

  const clock = new THREE.Clock();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.getElapsedTime();

    controls.update(dt);
    terrain.update(camera);
    atmosphere.update(elapsed);
    post.update(elapsed, atmosphere.sunDir);
    ui.update(dt, controls);

    post.render(dt);
  });
}

try {
  start();
} catch (e) {
  console.error(e);
  window.valleyError?.(e.stack || e.message);
}
