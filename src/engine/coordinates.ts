/**
 * OM Studio coordinate conventions. Every subsystem builds geometry in this one frame.
 *
 *   - Right-handed, Z-up, metres.
 *   - (0, 0, 0) is the centre of the reference sphere AND the reference eye point.
 *   - +X = audience right, +Y = nominal forward / performance direction, +Z = up.
 *   - Azimuth θ is measured in the XY plane from +Y towards +X (θ > 0 is to the right).
 *   - Elevation φ is measured from the XY plane (the sphere's equator) towards +Z.
 *
 *   P(θ, φ) = (R cosφ sinθ, R cosφ cosθ, R sinφ)
 *
 * Torus form (Round 10): the screen can be a torus about Z with ring radius a (the tube centre circle
 * lies in the equator plane at radius a) and tube radius R. Elevation is then measured about the tube
 * centre, P(θ, φ) = ((a + R cosφ) sinθ, (a + R cosφ) cosθ, R sinφ), and the surface normal is the same
 * direction (cosφ sinθ, cosφ cosθ, sinφ) as on the sphere. a = 0 is the sphere.
 *
 * The viewport (Three.js, Y-up) renders engine geometry inside a single group rotated -90° about X,
 * so no engine coordinate is ever rewritten for display, and the CAD export writes engine
 * coordinates unchanged (Rhino is Z-up too).
 */
import type { Frame, Vec3 } from './types';

export const WORLD_ORIGIN: Vec3 = [0, 0, 0];
export const AXIS_X: Vec3 = [1, 0, 0];
export const AXIS_Y: Vec3 = [0, 1, 0];
export const AXIS_Z: Vec3 = [0, 0, 1];

export const DEG = Math.PI / 180;
export const toRad = (deg: number) => deg * DEG;
export const toDeg = (rad: number) => rad / DEG;

/** Point on a sphere of radius R centred at the world origin. */
export function spherePoint(R: number, azimuth: number, elevation: number): Vec3 {
  const c = Math.cos(elevation);
  return [R * c * Math.sin(azimuth), R * c * Math.cos(azimuth), R * Math.sin(elevation)];
}

/** Point on the screen surface: a torus of ring radius `ring` and tube radius R; ring = 0 is the sphere. */
export function surfacePoint(R: number, azimuth: number, elevation: number, ring = 0): Vec3 {
  const rho = ring + R * Math.cos(elevation);
  return [rho * Math.sin(azimuth), rho * Math.cos(azimuth), R * Math.sin(elevation)];
}

/** Outward unit normal of the screen surface at (azimuth, elevation), the same for sphere and torus. */
export const surfaceNormal = (azimuth: number, elevation: number): Vec3 => spherePoint(1, azimuth, elevation);

/** Inverse of surfacePoint: [distance from the tube centre circle, azimuth, elevation]. */
export function toSurface(p: Vec3, ring = 0): [number, number, number] {
  if (!ring) return toSpherical(p);
  const rho = Math.hypot(p[0], p[1]) - ring;
  return [Math.hypot(rho, p[2]), Math.atan2(p[0], p[1]), Math.atan2(p[2], rho)];
}

/** Inverse of spherePoint for any non-zero point: [radius, azimuth, elevation]. */
export function toSpherical(p: Vec3): [number, number, number] {
  const r = Math.hypot(p[0], p[1], p[2]);
  return [r, Math.atan2(p[0], p[1]), Math.asin(p[2] / r)];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / length(a));

/** Local frame at `origin` whose +Y faces `target` and +Z stays as close to up as possible. */
export function facingFrame(origin: Vec3, target: Vec3): Frame {
  const y = normalize(sub(target, origin));
  const up: Vec3 = Math.abs(dot(y, AXIS_Z)) > 0.99 ? normalize([origin[0] || 1e-9, origin[1], 0]) : AXIS_Z;
  const z = normalize(sub(up, scale(y, dot(up, y))));
  return { origin, xAxis: cross(y, z), yAxis: y, zAxis: z };
}

