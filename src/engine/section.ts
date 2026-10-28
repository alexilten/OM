/**
 * Section planes and exact section curves. The viewport clips with the plane (geometry is never
 * modified); these curves draw the true cut line of the sphere and media surface on top.
 */
import { cross, normalize, scale, toRad, toSpherical, add } from './coordinates';
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
