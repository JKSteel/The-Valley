import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { POST } from './config.js';

// Backlit haze lives or dies in post. Chain is:
//   scene -> god rays -> bloom -> tonemap/dither/vignette -> screen
// Everything upstream stays in linear HDR; only the final pass encodes sRGB.

const GodRaysShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uSunUV:     { value: new THREE.Vector2(0.5, 0.5) },
    uStrength:  { value: POST.godrayStrength },
    uDecay:     { value: POST.godrayDecay },
    uVisible:   { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2  uSunUV;
    uniform float uStrength, uDecay, uVisible;
    varying vec2 vUv;

    const int SAMPLES = 40;

    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);

      if (uVisible < 0.5 || uStrength <= 0.0) { gl_FragColor = scene; return; }

      // March toward the sun, accumulating only what is already very bright.
      // Dark terrain therefore occludes the shafts for free — no separate
      // occlusion buffer needed.
      vec2 delta = (vUv - uSunUV) / float(SAMPLES) * 0.9;
      vec2 uv = vUv;
      float weight = 1.0;
      vec3 shafts = vec3(0.0);

      for (int i = 0; i < SAMPLES; i++) {
        uv -= delta;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        shafts += max(s - 1.25, 0.0) * weight;
        weight *= uDecay;
      }
      shafts /= float(SAMPLES);

      // Fade as the sun approaches the screen edge, or the shafts pop.
      vec2 d = abs(uSunUV - 0.5);
      float edge = smoothstep(0.85, 0.42, max(d.x, d.y));

      gl_FragColor = vec4(scene.rgb + shafts * uStrength * edge, scene.a);
    }
  `,
};

const FinalShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uExposure:  { value: POST.exposure },
    uVignette:  { value: POST.vignette },
    uTime:      { value: 0 },
  },
  vertexShader: GodRaysShader.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uExposure, uVignette, uTime;
    varying vec2 vUv;

    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    vec3 linearToSRGB(vec3 c) {
      return mix(c * 12.92,
                 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055,
                 step(0.0031308, c));
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb * uExposure;

      col = aces(col);
      col = linearToSRGB(col);

      vec2 q = vUv - 0.5;
      col *= 1.0 - uVignette * dot(q, q) * 1.6;

      // Wide smooth sky gradients band hard in 8 bits. Dither after encoding.
      col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.godrays = new ShaderPass(GodRaysShader);
    this.composer.addPass(this.godrays);

    this.bloom = new UnrealBloomPass(size, POST.bloomStrength,
                                     POST.bloomRadius, POST.bloomThreshold);
    this.composer.addPass(this.bloom);

    this.final = new ShaderPass(FinalShader);
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);

    this._v = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  update(elapsed, sunDir) {
    // Project a point far along the sun direction into screen space.
    this._v.copy(this.camera.position).addScaledVector(sunDir, 20000).project(this.camera);
    this.godrays.uniforms.uSunUV.value.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);

    this.camera.getWorldDirection(this._fwd);
    this.godrays.uniforms.uVisible.value = this._fwd.dot(sunDir) > 0.0 ? 1 : 0;

    this.final.uniforms.uTime.value = elapsed;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  render(dt) { this.composer.render(dt); }
}
