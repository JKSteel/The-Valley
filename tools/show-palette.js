// Prints what each surface actually looks like on screen, sunlit and shaded,
// through the real tone curve.  node tools/show-palette.js
//
// Screen colour is not readable from the config: albedo passes through a
// chromatic illuminant, ACES and an sRGB encode before it reaches the eye. At
// one point every biome here was a different shade of the same orange, and
// nothing in the palette constants said so.

import { PALETTE, GROUND, SUN } from '../src/config.js';

const lin = (hex) => [16, 8, 0].map((s) => {
  const c = ((hex >> s) & 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const mul = (a, k) => a.map((v) => v * k);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
const P = (n) => mul(lin(PALETTE[n][0]), PALETTE[n][1]);

const aces = (x) => Math.min(Math.max((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0), 1);
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const display = (c) => c.map((v) => srgb(aces(v)));

function describe(c) {
  const o = display(c);
  const mx = Math.max(...o), mn = Math.min(...o);
  const rgb = o.map((v) => String(Math.round(v * 255)).padStart(3)).join(',');
  if (mx - mn < 0.004) return `rgb(${rgb})  neutral`;

  let h;
  if (mx === o[0]) h = 60 * (((o[1] - o[2]) / (mx - mn)) % 6);
  else if (mx === o[1]) h = 60 * ((o[2] - o[0]) / (mx - mn) + 2);
  else h = 60 * ((o[0] - o[1]) / (mx - mn) + 4);
  h = Math.round((h + 360) % 360);

  const name = h < 20 || h >= 330 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow'
    : h < 160 ? 'green' : h < 200 ? 'cyan' : h < 250 ? 'blue' : h < 290 ? 'violet' : 'magenta';
  return `rgb(${rgb})  ${String(h).padStart(3)}deg ${name}`;
}

const ring = add(mix(P('eastHorizon'), P('westHorizon'), 0.5), mul(P('beltOfVenus'), 0.35));
const dome = mix(P('zenith'), P('eastSky'), 0.5);
const hemi = mix(dome, ring, GROUND.skyWarmth);

const ambient = mul(hemi, GROUND.skyFill);
const direct = mul(P('sunLight'), Math.sin(SUN.elevation * Math.PI / 180) * GROUND.sunGain);

const SURFACES = {
  tussock: [1.06, 0.95, 0.66], dune:  [1.28, 1.14, 0.87], salt:  [1.46, 1.43, 1.36],
  swamp:   [0.44, 0.50, 0.40], forest:[0.31, 0.37, 0.26], braid: [1.31, 1.27, 1.15],
  rock:    [0.78, 0.77, 0.75], scree: [1.02, 0.99, 0.94], snow:  [2.60, 2.68, 2.82],
};

console.log(`sun elevation ${SUN.elevation} deg   sky warmth ${GROUND.skyWarmth}   ` +
            `sky fill ${GROUND.skyFill}   chroma ${GROUND.chroma}\n`);
console.log('surface     sunlit                        shaded');

for (const [name, c] of Object.entries(SURFACES)) {
  const luma = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const a = c.map((v) => luma + (v - luma) * GROUND.chroma);
  console.log(`  ${name.padEnd(9)} ${describe(a.map((v, i) => v * GROUND.albedo * (direct[i] + ambient[i]))).padEnd(29)} ` +
              describe(a.map((v, i) => v * GROUND.albedo * ambient[i])));
}

console.log('\nilluminants');
console.log(`  direct    ${describe(direct)}`);
console.log(`  ambient   ${describe(ambient)}`);
