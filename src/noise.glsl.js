// Shared noise. Included by the atmosphere (cirrus) and by the heightfield
// bake, so both stay in step.
export const NOISE_GLSL = /* glsl */`
// Uniform on [0,1). The obvious formulation — fract(p.x * p.y) after both have
// already been fract'd — returns a product of two uniforms, so it has mean 0.25
// and piles up near zero. Thresholds placed across 0..1 then only ever catch
// the tails.
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i),                 hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float a = 0.5, s = 0.0, norm = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); norm += a; p *= 2.03; a *= 0.5; }
  return s / norm;   // normalised, so callers can reason about the distribution
}
`;
