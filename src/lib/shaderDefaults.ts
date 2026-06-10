// Inigo Quilez-style domain-warped FBM nebula.
// Guaranteed full-canvas coverage — no black zones.
export const NEBULA_SHADER = `precision mediump float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec2(3.7, 8.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float t = uTime * 0.12;

  // Two-layer domain warping
  vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(5.2, 1.3)));
  vec2 r = vec2(
    fbm(uv + 4.0 * q + vec2(1.7, 9.2) + t * 0.15),
    fbm(uv + 4.0 * q + vec2(8.3, 2.8) + t * 0.10)
  );
  float f = fbm(uv + 3.5 * r + t * 0.05);

  // Deep-space palette: midnight → teal → gold
  vec3 colA = mix(vec3(0.05, 0.02, 0.15), vec3(0.0, 0.4, 0.65), clamp(f * 2.0, 0.0, 1.0));
  vec3 colB = mix(vec3(0.05, 0.5, 0.5),   vec3(0.9, 0.6, 0.1), clamp(f * 1.5, 0.0, 1.0));
  vec3 col  = mix(colA, colB, clamp(f * f * 4.0, 0.0, 1.0));

  // Brightness modulation + base floor ensures no pitch-black pixels
  col = col * (f * 2.0 + 0.5) + vec3(0.02, 0.01, 0.05);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
