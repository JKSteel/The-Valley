import { MIST } from './config.js';

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function cardinal(deg) {
  return CARDINALS[Math.round((deg % 360) / 22.5) % 16];
}

// A tiny bespoke panel rather than lil-gui — one less dependency, and these are
// the only knobs that matter while the light is being tuned.
export function createUI(atmosphere, post, terrain) {
  const panel = document.getElementById('panel');
  const host = document.getElementById('panel-controls');
  const veil = document.getElementById('veil');
  const compass = document.getElementById('compass');
  const stats = document.getElementById('stats');

  const u = atmosphere.uniforms;
  const g = terrain.groundUniforms.uGround;

  const specs = [
    ['Sun azimuth',   180, 360, 0.5,
      () => atmosphere.azimuth,
      (v) => atmosphere.setSun(v, atmosphere.elevation), (v) => v.toFixed(0) + '°'],
    ['Sun elevation', -3,  22,  0.1,
      () => atmosphere.elevation,
      (v) => atmosphere.setSun(atmosphere.azimuth, v), (v) => v.toFixed(1) + '°'],
    ['Mist density',   0,   2.5, 0.01,
      () => u.uMist.value.x / MIST.density,
      (v) => { u.uMist.value.x = v * MIST.density; }, (v) => v.toFixed(2) + '×'],
    ['Mist half-height', 80, 1600, 10,
      () => u.uMist.value.y,
      (v) => { u.uMist.value.y = v; }, (v) => v.toFixed(0) + 'm'],
    ['Inscatter',      0,   4,   0.05,
      () => u.uMist.value.z,
      (v) => { u.uMist.value.z = v; }, (v) => v.toFixed(2)],
    ['Cirrus cover',   0.2, 0.9, 0.01,
      () => u.uCirrus.value.y,
      (v) => { u.uCirrus.value.y = v; }, (v) => v.toFixed(2)],
    ['Ground albedo',  0.02, 0.4, 0.005,
      () => g.value.x, (v) => { g.value.x = v; }, (v) => v.toFixed(3)],
    ['Sky fill',       0,   4,   0.02,
      () => g.value.y, (v) => { g.value.y = v; }, (v) => v.toFixed(2)],
    ['Sky warmth',     0,   0.8, 0.01,
      () => g.value.w, (v) => { g.value.w = v; }, (v) => v.toFixed(2)],
    ['Biome chroma',   0,   2,   0.02,
      () => terrain.groundUniforms.uChroma.value,
      (v) => { terrain.groundUniforms.uChroma.value = v; }, (v) => v.toFixed(2)],
    ['Exposure',       0.2, 3,   0.02,
      () => post.final.uniforms.uExposure.value,
      (v) => { post.final.uniforms.uExposure.value = v; }, (v) => v.toFixed(2)],
    ['Bloom',          0,   2,   0.02,
      () => post.bloom.strength,
      (v) => { post.bloom.strength = v; }, (v) => v.toFixed(2)],
    ['God rays',       0,   2,   0.02,
      () => post.godrays.uniforms.uStrength.value,
      (v) => { post.godrays.uniforms.uStrength.value = v; }, (v) => v.toFixed(2)],
  ];

  // Defaults are captured here, before anything has been touched, so they are
  // exactly the values in config.js.
  const controls = specs.map(([label, min, max, step, get, set, fmt]) => {
    const row = document.createElement('label');
    const name = document.createElement('span');
    const readout = document.createElement('span');
    name.textContent = label;

    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min, max, step, value: get() });

    const show = (v) => { readout.textContent = fmt(v); };
    show(get());

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      set(v);
      show(v);
    });

    row.append(name, readout);
    host.append(row, input);

    return { input, set, show, initial: get() };
  });

  const reset = document.createElement('button');
  reset.textContent = 'Reset to defaults';
  reset.addEventListener('click', () => {
    for (const c of controls) {
      c.input.value = c.initial;
      c.set(c.initial);
      c.show(c.initial);
    }
    reset.blur();   // otherwise Space re-triggers it instead of moving the camera
  });
  host.append(reset);

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyH') return;
    const opened = panel.classList.toggle('hidden') === false;
    // Pointer lock hides the cursor, so an open panel is unusable while the
    // camera still owns the mouse. Clicking the world re-locks.
    if (opened) document.exitPointerLock();
  });

  // The veil is a title screen, not a pause screen — once you have entered,
  // releasing the mouse (Esc, or H for the panel) must not bring it back.
  let entered = false;
  document.addEventListener('valley:lock', (e) => {
    if (e.detail) { entered = true; veil.classList.add('hidden'); }
    else if (!entered) veil.classList.remove('hidden');
  });

  let acc = 0, frames = 0, fps = 0;

  return {
    update(dt, controls) {
      acc += dt; frames++;
      if (acc > 0.5) { fps = frames / acc; acc = 0; frames = 0; }

      const h = controls.heading;
      compass.textContent = `${cardinal(h)}  ${h.toFixed(0).padStart(3, '0')}°`;

      const p = controls.camera.position;
      stats.textContent =
        `${fps.toFixed(0)} fps  ·  ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}` +
        `  ·  ${controls.flying ? 'fly' : 'walk'}`;
    },
  };
}
