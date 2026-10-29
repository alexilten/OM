/**
 * Media-surface shader for the live preview. The patch UVs run linearly in azimuth and elevation, so
 * the fragment shader recovers both exactly (on the sphere and the torus form alike) and maps either a
 * generated look or a video with the same rules as `mapUv` in timing.ts.
 */
export const SHOW_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SHOW_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uBeat;
uniform float uBar;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uIntensity;
uniform int uLook;
uniform int uLook2;
uniform float uMix;
uniform int uMode;
uniform bool uUseVideo;
uniform sampler2D uVideo;
uniform vec4 uBounds;
uniform vec3 uPalette0;
uniform vec3 uPalette1;
uniform vec3 uPalette2;

const float PI = 3.141592653589793;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

vec2 mapUv(float az, float el) {
  if (uMode == 1) return vec2((az + PI) / (2.0 * PI), (el + PI / 2.0) / PI);
  if (uMode == 2) { float r = 0.5 * (PI / 2.0 - el) / (PI / 2.0); return vec2(0.5 + r * sin(az), 0.5 - r * cos(az)); }
  return vec2((az - uBounds.x) / (uBounds.y - uBounds.x), (el - uBounds.z) / (uBounds.w - uBounds.z));
}

vec3 look(int id, vec3 d, float az, float el) {
  float t = uTime;
  if (id == 0) { // Nebula
    float n = fbm(d * 2.2 + vec3(0.0, t * 0.02, t * 0.01));
    float m = fbm(d * 4.0 - vec3(t * 0.015));
    vec3 c = mix(uPalette0 * 0.15, uPalette1, smoothstep(0.35, 0.8, n));
    c = mix(c, uPalette2, smoothstep(0.55, 0.9, m) * 0.6);
    float stars = step(0.985, hash(floor(d * 220.0))) * (0.6 + 0.4 * sin(t * 3.0 + hash(floor(d * 220.0)) * 40.0));
    return c * (0.75 + 0.35 * uBeat + 0.3 * uBass) + stars;
  }
  if (id == 1) { // Aurora
    float curtain = fbm(vec3(az * 3.0, t * 0.08, 0.0));
    float band = smoothstep(0.15, 0.0, abs(el - (0.6 + 0.25 * curtain)));
    float rays = 0.5 + 0.5 * sin(az * 60.0 + curtain * 8.0 + t * 0.6);
    vec3 c = mix(uPalette0, uPalette1, smoothstep(0.4, 1.0, el + curtain * 0.3));
    return c * band * (0.4 + 0.6 * rays) * (1.0 + 0.4 * uBeat) + vec3(0.01, 0.02, 0.05);
  }
  if (id == 2) { // Ocean caustics, seen from below
    vec3 p = d * 3.0 + vec3(0.0, 0.0, t * 0.15);
    float c1 = abs(sin(fbm(p) * 12.0 + t * 0.5));
    float caustic = pow(1.0 - c1, 6.0);
    vec3 deep = uPalette2 * 0.25, shallow = uPalette1;
    vec3 c = mix(deep, shallow, smoothstep(-0.2, 1.2, el));
    return c + caustic * vec3(0.6, 0.9, 1.0) * (0.6 + 0.6 * uBass) * smoothstep(-0.1, 0.8, el);
  }
  if (id == 3) { // Tunnel towards the forward direction, zooming on the beat
    vec3 f = normalize(vec3(0.0, 1.0, 0.15));
    float ang = acos(clamp(dot(d, f), -1.0, 1.0));
    float rings = fract(log(ang + 0.05) * 4.0 - t * 0.5 - uBeat * 0.35);
    float spokes = 0.5 + 0.5 * cos(atan(d.x, d.z) * 12.0 + uBar * PI * 0.5);
    float line = smoothstep(0.08, 0.0, abs(rings - 0.5)) + 0.25 * smoothstep(0.9, 1.0, spokes);
    vec3 c = mix(uPalette0, uPalette1, fract(uBar * 0.25 + ang));
    return c * line * (0.5 + 1.2 * uBeat) + uPalette2 * 0.05;
  }
  if (id == 4) { // Cathedral light shafts
    float shafts = pow(0.5 + 0.5 * sin(az * 9.0 + 0.4 * sin(t * 0.07)), 18.0);
    float haze = fbm(d * 3.0 + vec3(t * 0.02));
    vec3 c = mix(vec3(0.05, 0.035, 0.02), uPalette0, shafts * smoothstep(-0.1, 1.2, el));
    return c + uPalette1 * haze * 0.15 * (1.0 + 0.3 * uBeat);
  }
  // Calibration grid: every 10°, brighter every 30°.
  float a = degrees(az), e = degrees(el);
  float g10 = max(smoothstep(0.25, 0.0, abs(fract(a / 10.0 + 0.5) - 0.5) * 10.0), smoothstep(0.25, 0.0, abs(fract(e / 10.0 + 0.5) - 0.5) * 10.0));
  float g30 = max(smoothstep(0.35, 0.0, abs(fract(a / 30.0 + 0.5) - 0.5) * 30.0), smoothstep(0.35, 0.0, abs(fract(e / 30.0 + 0.5) - 0.5) * 30.0));
  return vec3(0.08) + vec3(0.35) * g10 + vec3(0.6, 0.6, 0.2) * g30;
}

void main() {
  float az = mix(uBounds.x, uBounds.y, vUv.x);
  float el = mix(uBounds.z, uBounds.w, vUv.y);
  vec3 d = vec3(cos(el) * sin(az), cos(el) * cos(az), sin(el));
  vec3 c;
  if (uUseVideo) {
    vec2 uv = mapUv(az, el);
    c = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? vec3(0.0) : texture2D(uVideo, uv).rgb;
  } else {
    // Cue crossfade: the outgoing look (uLook2) fades into the incoming one (uLook).
    c = look(uLook, d, az, el);
    if (uMix < 0.999) c = mix(look(uLook2, d, az, el), c, uMix);
  }
  gl_FragColor = vec4(c * uIntensity, 1.0);
}
`;
