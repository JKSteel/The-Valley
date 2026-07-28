import * as THREE from 'three';
import { CAMERA, SUN } from './config.js';

// Pointer-lock first person. Walk mode clamps to the ground; fly mode (F) is
// for scouting composition while the world is being built.
export class FirstPersonControls {
  constructor(camera, domElement, getGroundHeight) {
    this.camera = camera;
    this.dom = domElement;
    this.getGroundHeight = getGroundHeight;

    this.enabled = false;
    this.flying = false;
    this.yaw = -THREE.MathUtils.degToRad(SUN.azimuth);   // open facing the sunset
    this.pitch = 0;
    this.keys = new Set();
    this.lookSpeed = 0.0021;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();

    this._bind();
  }

  _bind() {
    // Bound to the window, not the canvas: the start veil is a fixed-position
    // overlay and would otherwise swallow the click before it ever lands.
    window.addEventListener('click', (e) => {
      if (e.target?.closest?.('#panel')) return;   // let the sliders work
      this.dom.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.enabled = document.pointerLockElement === this.dom;
      document.dispatchEvent(new CustomEvent('valley:lock', { detail: this.enabled }));
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      this.yaw -= e.movementX * this.lookSpeed;
      this.pitch -= e.movementY * this.lookSpeed;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    });

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyF') this.flying = !this.flying;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get heading() {
    // Yaw 0 looks down -Z (north); positive yaw turns anticlockwise. Compass
    // degrees run clockwise from north, hence the negation.
    return ((-THREE.MathUtils.radToDeg(this.yaw)) % 360 + 360) % 360;
  }

  update(dt) {
    const k = this.keys;

    this._euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);

    if (!this.enabled) return;

    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = this.flying ? CAMERA.flySpeed * (running ? 4 : 1)
                              : (running ? CAMERA.runSpeed : CAMERA.walkSpeed);

    // Horizontal basis — walking should ignore pitch entirely.
    this._dir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this._move.set(0, 0, 0);
    if (k.has('KeyW')) this._move.add(this._dir);
    if (k.has('KeyS')) this._move.sub(this._dir);
    if (k.has('KeyD')) this._move.add(this._right);
    if (k.has('KeyA')) this._move.sub(this._right);
    if (this._move.lengthSq() > 0) this._move.normalize();

    const fromX = this.camera.position.x, fromZ = this.camera.position.z;
    this.camera.position.addScaledVector(this._move, speed * dt);

    if (this.flying) {
      const lift = (k.has('Space') ? 1 : 0) - (k.has('KeyC') ? 1 : 0);
      this.camera.position.y += lift * speed * dt;
    } else {
      // The sea bed is 140 m down and perfectly walkable as far as the height
      // query is concerned, so without this you can stroll underwater to the
      // ice wall. The waterline is the edge of the world on foot.
      const ahead = this.getGroundHeight(this.camera.position.x, this.camera.position.z);
      if (ahead < CAMERA.shoreLimit) {
        this.camera.position.x = fromX;
        this.camera.position.z = fromZ;
      }

      // Smoothed rather than snapped: the query heightmap is coarser than the
      // rendered one, so a hard clamp reads as a jitter underfoot.
      const target = this.getGroundHeight(this.camera.position.x, this.camera.position.z)
                   + CAMERA.eyeHeight;
      this.camera.position.y += (target - this.camera.position.y) * Math.min(1, dt * 12);
    }
  }
}
