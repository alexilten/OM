/**
 * Section planes and exact section curves. The viewport clips with the plane (geometry is never
 * modified); these curves draw the true cut line of the sphere and media surface on top.
 */
import { cross, dot, normalize, scale, surfacePoint, toRad, toSpherical, add } from './coordinates';
import type { Vec3 } from './types';
import type { MediaBounds } from './media';

export type SectionMode = 'longitudinal' | 'transverse' | 'horizontal';

export interface SectionSettings {
  enabled: boolean;
  mode: SectionMode;
  /** Plane position along its normal axis (m). */
  offset: number;
  /** Rotation of vertical section planes about Z (degrees). */
  rotationDeg: number;
  /** Keep the opposite half. */
  flip: boolean;
}

export const DEFAULT_SECTION: SectionSettings = { enabled: false, mode: 'longitudinal', offset: 0, rotationDeg: 0, flip: false };

/** Plane as n·p = d; the kept half-space is n·p ≤ d. */
export interface SectionPlane {
  normal: Vec3;
  d: number;
}

export function sectionPlane(s: SectionSettings): SectionPlane {
  let n: Vec3;
  const r = toRad(s.rotationDeg);
  if (s.mode === 'longitudinal') n = [Math.cos(r), -Math.sin(r), 0]; // cut along Y: plane x = offset
  else if (s.mode === 'transverse') n = [Math.sin(r), Math.cos(r), 0]; // cut across: plane y = offset
  else n = [0, 0, 1]; // plan cut: z = offset
  return s.flip ? { normal: scale(n, -1), d: -s.offset } : { normal: n, d: s.offset };
}

/** Intersection of a plane with the origin-centred sphere, split into runs inside the media patch. */
export function sphereSection(plane: SectionPlane, b: MediaBounds, steps = 720): { full: Vec3[]; media: Vec3[][] } {
  if (b.ring) return torusSection(plane, b);
  const n = normalize(plane.normal);
  const R = b.R;
  if (Math.abs(plane.d) >= R) return { full: [], media: [] };
  const c = scale(n, plane.d);
  const rho = Math.sqrt(R * R - plane.d * plane.d);
  const helper: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(helper, n));
  const v = cross(n, u);
  const full: Vec3[] = [];
  const media: Vec3[][] = [];
  let run: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const p = add(c, add(scale(u, rho * Math.cos(t)), scale(v, rho * Math.sin(t))));
    full.push(p);
    const [, az, el] = toSpherical(p);
    const inside = az >= b.az0 - 1e-9 && az <= b.az1 + 1e-9 && el >= b.el0 - 1e-9 && el <= b.el1 + 1e-9;
    if (inside) run.push(p);
    else if (run.length) {
      media.push(run);
      run = [];
    }
  }
  if (run.length) media.push(run);
  // Join a run that wraps across t = 0.
  if (media.length > 1 && media[0][0] === full[0] && media[media.length - 1].at(-1) === full[full.length - 1]) {
    media[0] = [...media.pop()!, ...media[0]];
  }
  return { full, media };
}

/**
 * Plane cut of the torus form: marching squares over (azimuth, elevation) with the zero crossings found
 * by linear interpolation, chained into polylines. `full` holds the first loop (dashed in the viewport);
 * `media` holds every piece inside the media patch.
 */
function torusSection(plane: SectionPlane, b: MediaBounds, nu = 360, nv = 180): { full: Vec3[]; media: Vec3[][] } {
  const n = normalize(plane.normal);
  const P = (i: number, j: number) => surfacePoint(b.R, -Math.PI + (2 * Math.PI * i) / nu, -Math.PI + (2 * Math.PI * j) / nv, b.ring);
  const f = (p: Vec3) => dot(n, p) - plane.d;
  const vals: number[][] = [];
  for (let i = 0; i <= nu; i++) vals.push(Array.from({ length: nv + 1 }, (_, j) => f(P(i, j))));
  const edgePoint = (i0: number, j0: number, i1: number, j1: number): Vec3 => {
    const a = vals[i0][j0];
    const t = a / (a - vals[i1][j1]);
    const p0 = P(i0, j0);
    const p1 = P(i1, j1);
    return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
  };
  const segs: [Vec3, Vec3][] = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const corners: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const pts: Vec3[] = [];
      for (let k = 0; k < 4; k++) {
        const [a0, b0] = corners[k];
        const [a1, b1] = corners[(k + 1) % 4];
        if (vals[a0][b0] < 0 !== vals[a1][b1] < 0) pts.push(edgePoint(a0, b0, a1, b1));
      }
      if (pts.length >= 2) segs.push([pts[0], pts[1]]);
      if (pts.length === 4) segs.push([pts[2], pts[3]]);
    }
  // Chain segments by shared end points.
  const key = (p: Vec3) => `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(5)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, k) => s.forEach((p) => ends.set(key(p), [...(ends.get(key(p)) ?? []), k])));
  const used = new Set<number>();
  const loops: Vec3[][] = [];
  for (let k = 0; k < segs.length; k++) {
    if (used.has(k)) continue;
    used.add(k);
    let line = [...segs[k]];
    // Grow forwards, then backwards from the seed segment.
    for (let pass = 0; pass < 2; pass++) {
      for (;;) {
        const next = (ends.get(key(line[line.length - 1])) ?? []).find((m) => !used.has(m));
        if (next === undefined) break;
        used.add(next);
        const [p, q] = segs[next];
        line.push(key(p) === key(line[line.length - 1]) ? q : p);
      }
      line = line.reverse();
    }
    loops.push(line);
  }
  const media: Vec3[][] = [];
  for (const loop of loops) {
    let run: Vec3[] = [];
    for (const p of loop) {
      const rho = Math.hypot(p[0], p[1]) - b.ring;
      const az = Math.atan2(p[0], p[1]);
      const el = Math.atan2(p[2], rho);
      // The inner half of a spindle torus (R > ring) folds back through the axis; its points are R from
      // the far side of the ring, not the near side, so the distance test leaves them out.
      const onOuter = Math.abs(Math.hypot(rho, p[2]) - b.R) < 1e-3 * b.R;
      const inside = rho > 0 && onOuter && az >= b.az0 - 1e-6 && az <= b.az1 + 1e-6 && el >= b.el0 - 1e-6 && el <= b.el1 + 1e-6;
      if (inside) run.push(p);
      else if (run.length) {
        media.push(run);
        run = [];
      }
    }
    if (run.length) media.push(run);
  }
  return { full: loops.flat().length ? loops.sort((a, c) => c.length - a.length)[0] : [], media };
}
