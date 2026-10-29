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
float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
float stars(vec3 d, float scale, float density) {
  vec3 c = floor(d * scale);
  float h = hash(c);
  return step(1.0 - density, h) * (0.5 + 0.5 * sin(uTime * (1.0 + h * 4.0) + h * 60.0));
}
/** Angle from an axis and a 0..2π angle around it, with up = world Z projected off the axis. */
vec2 polarAbout(vec3 d, vec3 axis) {
  vec3 right = normalize(cross(axis, vec3(0.0, 0.0, 1.0)));
  vec3 up = cross(right, axis);
  return vec2(acos(clamp(dot(d, axis), -1.0, 1.0)), atan(dot(d, up), dot(d, right)));
}

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
  if (id == 6) { // Monoliths in the fog: parallax slabs against a burning horizon
    vec3 sunDir = normalize(vec3(0.0, cos(0.1), sin(0.1)));
    float sa = acos(clamp(dot(d, sunDir), -1.0, 1.0));
    vec3 sky = mix(uPalette0 * 0.55, vec3(0.012, 0.01, 0.012), smoothstep(-0.02, 0.75, el));
    sky += uPalette2 * (smoothstep(0.075, 0.06, sa) * 0.9 + exp(-sa * 5.0) * (0.25 + 0.5 * uBass));
    vec3 c = sky;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float n = 5.0 + fk * 6.0;
      float x = az * n / PI * 2.0 + t * 0.004 * (fk + 1.0) + fk * 13.7;
      float cell = floor(x);
      float f = fract(x);
      float w = 0.12 + 0.22 * hash(vec3(cell, fk, 1.0));
      float tall = (0.08 + 0.5 * hash(vec3(cell, fk, 2.0))) / (1.0 + fk * 0.9);
      float present = step(0.3, hash(vec3(cell, fk, 3.0)));
      float slab = present * step(abs(f - 0.5), w * 0.5) * step(el, tall);
      float fog = 0.18 + 0.22 * fk;
      c = mix(c, mix(sky, vec3(0.0), fog + 0.4), slab);
    }
    float ground = smoothstep(0.0, -0.02, el);
    c = mix(c, vec3(0.008), ground);
    float mist = fbm3(vec3(az * 4.0 + t * 0.03, el * 14.0, t * 0.05));
    c += uPalette1 * mist * smoothstep(0.25, -0.05, el) * 0.35;
    float dust = step(0.997, hash(floor(d * 180.0 + vec3(t * 0.4, 0.0, -t * 0.2))));
    return c * (0.85 + 0.5 * uBeat) + dust * uPalette2 * 0.5;
  }
  if (id == 7) { // Event horizon: lensed stars, a photon ring and a swirling disc ahead
    vec3 f = normalize(vec3(0.0, 1.0, 0.18));
    vec2 pa = polarAbout(d, f);
    float rs = 0.22;
    float bend = pa.x + rs * rs / max(pa.x, 0.02);
    vec3 right = normalize(cross(f, vec3(0.0, 0.0, 1.0)));
    vec3 up = cross(right, f);
    vec3 lensed = cos(bend) * f + sin(bend) * (cos(pa.y) * right + sin(pa.y) * up);
    vec3 c = vec3(0.004, 0.004, 0.01) + stars(lensed, 240.0, 0.012) * vec3(0.9, 0.9, 1.0) + uPalette2 * 0.05 * fbm3(lensed * 3.0);
    float u = dot(d, right), v = dot(d, up);
    float rr = length(vec2(u, v / 0.22));
    float swirl = fbm(vec3(atan(v / 0.22, u) * 3.0 - t * 0.6, rr * 9.0, t * 0.05));
    float disc = smoothstep(rs * 1.3, rs * 1.7, rr) * smoothstep(rs * 5.5, rs * 2.2, rr) * (0.4 + 0.9 * swirl);
    float doppler = 0.6 + 0.5 * u / max(rr, 0.01);
    vec3 hot = mix(uPalette0, uPalette1, swirl);
    float ring = exp(-pow((pa.x - rs * 1.55) / 0.012, 2.0));
    float halo = smoothstep(rs * 2.6, rs * 1.5, pa.x) * smoothstep(rs * 1.2, rs * 1.6, pa.x) * fbm3(vec3(pa.y * 4.0 - t * 0.4, pa.x * 20.0, 0.0));
    c += hot * halo * 0.8;
    float front = step(v, 0.0) + step(rs * 1.05, pa.x);
    c = mix(c, c + hot * disc * doppler * 1.6, clamp(front, 0.0, 1.0));
    c *= step(rs, pa.x) + (1.0 - step(rs, pa.x)) * clamp(disc * step(v, 0.0) * 4.0, 0.0, 1.0);
    c += uPalette1 * ring * (1.2 + 1.5 * uBeat + uBass);
    return c;
  }
  if (id == 8) { // Folded time lattice: an endless square corridor of light that turns on each bar
    float bar = floor(uBar);
    int ax = int(mod(bar, 3.0));
    vec3 q = ax == 0 ? d.xyz : ax == 1 ? d.yzx : d.zxy;
    float side = max(abs(q.x), abs(q.z));
    float dist = 1.0 / max(side, 0.02);
    vec3 hit = q * dist;
    float along = hit.y;
    float across = abs(q.x) > abs(q.z) ? hit.z : hit.x;
    float drift = t * 0.6 + uBeat * 0.4;
    float g1 = smoothstep(0.06, 0.0, abs(fract(along * 1.5 - drift) - 0.5) - 0.44);
    float g2 = smoothstep(0.05, 0.0, abs(fract(across * 3.0) - 0.5) - 0.45);
    float books = step(0.55, hash(vec3(floor(along * 6.0 - drift * 4.0), floor(across * 3.0), bar)));
    float fog = exp(-dist * 0.12);
    vec3 c = (uPalette0 * (g1 + g2 * 0.6) + uPalette1 * books * 0.18) * fog;
    c += uPalette2 * smoothstep(0.92, 1.0, abs(q.y)) * 0.6;
    return c * (0.8 + 0.6 * uBeat);
  }
  if (id == 9) { // Machine glitch: torn scanlines, displaced blocks and static on the beat
    float slice = floor(el * 40.0);
    float tear = (hash(vec3(slice, floor(t * 6.0), 1.0)) - 0.5) * 0.4 * step(0.75, hash(vec3(slice, floor(t * 3.0), 2.0)));
    float a2 = az + tear * (0.3 + uBeat);
    vec2 blk = floor(vec2(a2 * 6.0, el * 9.0));
    float on = step(0.82 - 0.3 * uBeat, hash(vec3(blk, floor(t * 4.0))));
    float scan = 0.55 + 0.45 * sin(el * 900.0 + t * 30.0);
    float bars = step(0.94, fract(a2 * 7.0 + floor(uBar) * 0.37));
    float stat = hash(floor(d * 260.0) + floor(t * 24.0));
    vec3 c = uPalette0 * on * scan * 0.9 + uPalette1 * bars * (0.3 + 0.9 * uBeat) + vec3(stat) * 0.06 * (0.3 + uHigh);
    float piston = smoothstep(0.02, 0.0, abs(fract(az * 3.0 / PI) - fract(uBar)) - 0.01);
    return c + uPalette0 * piston * 0.7 + vec3(0.01, 0.0, 0.0);
  }
  if (id == 10) { // Chrome stardust: prism sweeps, burst rays and glitter on the beat
    vec2 pa = polarAbout(d, normalize(vec3(0.0, 1.0, 0.3)));
    float rays = pow(0.5 + 0.5 * cos(pa.y * 14.0 + t * 0.2), 30.0) * exp(-pa.x * 1.2);
    float sweep = 0.5 + 0.5 * sin(el * 6.0 - az * 2.0 + t * 0.7);
    vec3 prism = 0.5 + 0.5 * cos(6.2831 * (sweep + vec3(0.0, 0.33, 0.67)));
    vec3 duo = mix(uPalette0, uPalette1, smoothstep(0.2, 0.8, sweep));
    float band = smoothstep(0.85, 1.0, sweep);
    float glitter = step(1.0 - (0.004 + 0.03 * uBeat), hash(floor(d * 300.0) + floor(t * 8.0)));
    vec3 c = duo * 0.18 + prism * band * 0.55 + uPalette2 * rays * 1.2;
    return c + glitter * vec3(1.0) + stars(d, 200.0, 0.01) * 0.6;
  }
  if (id == 11) { // Sand sea: dune horizon, a pale sun and a storm wall of blowing sand
    float dune = 0.03 + 0.06 * fbm3(vec3(az * 2.5, 0.0, 1.0)) + 0.03 * sin(az * 5.0);
    vec3 sky = mix(uPalette1 * 0.75, uPalette0 * 0.25, smoothstep(0.0, 0.9, el));
    vec3 sunDir = normalize(vec3(0.3, 0.9, 0.35));
    float sa = acos(clamp(dot(d, sunDir), -1.0, 1.0));
    sky += vec3(1.0, 0.95, 0.85) * (smoothstep(0.12, 0.1, sa) * 0.6 + exp(-sa * 3.0) * 0.25);
    float streak = fbm(vec3(az * 3.0 - t * 0.35, el * 30.0, t * 0.08));
    float wall = smoothstep(0.55, 0.0, el) * (0.4 + 0.6 * uBass);
    vec3 c = mix(sky, uPalette0 * 0.8, streak * wall);
    vec3 sand = uPalette2 * (0.25 + 0.2 * fbm3(vec3(az * 30.0, el * 60.0, 0.0)));
    c = mix(c, sand, smoothstep(dune + 0.005, dune - 0.005, el));
    return c * (0.85 + 0.4 * uBeat);
  }
  if (id == 12) { // Ink logogram: circular glyphs bloom in white fog
    vec2 pa = polarAbout(d, normalize(vec3(0.0, 1.0, 0.25)));
    float seed = floor(uBar / 4.0);
    float grow = smoothstep(0.0, 0.5, fract(uBar / 4.0) + 0.02);
    float edge = fbm(vec3(pa.y * 3.0 + seed * 7.0, seed, t * 0.05));
    float r0 = 0.38 * grow;
    float thick = 0.03 + 0.07 * edge + 0.03 * uBass;
    float ink = smoothstep(thick, thick * 0.4, abs(pa.x - r0 - 0.04 * sin(pa.y * 3.0 + seed)));
    float tendril = smoothstep(0.62, 0.8, fbm3(vec3(pa.y * 6.0 + seed * 3.0, pa.x * 8.0 - t * 0.1, seed))) * smoothstep(r0 + 0.25, r0, pa.x) * step(r0 * 0.7, pa.x);
    float fog = 0.55 + 0.25 * fbm3(d * 2.0 + vec3(t * 0.03));
    vec3 c = mix(uPalette0 * fog, uPalette2, clamp(ink + tendril, 0.0, 1.0));
    return c * (0.75 + 0.3 * uBeat) * smoothstep(-0.25, 0.1, el);
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
