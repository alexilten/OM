/**
 * Exact rational NURBS for the spherical media patch.
 *
 * A patch bounded by azimuth [θ0, θ1] and elevation [φ0, φ1] is an untrimmed iso-parametric
 * rectangle of the sphere, so it can be written exactly as a degree-2 rational tensor-product
 * surface: a circular arc in elevation (the profile) revolved through a circular arc in azimuth.
 * Each arc is split into ≤ 90° rational Bézier spans with middle weight cos(Δ/2).
 *
 * Knot vectors use the openNURBS convention (no superfluous end knots) and are scaled to the
 * arc angle in radians, so the surface domain equals [θ0, θ1] × [φ0, φ1].
 */
import type { Vec3 } from './types';

export interface RationalArc {
  /** Control points as [a, b] pairs in the arc's 2D frame, weights alongside. */
  angles: number[]; // angle of each control point direction
  scales: number[]; // radial scale of each control point (1 or 1/cos(Δ/2))
  weights: number[];
  knots: number[];
}

export function rationalArc(a0: number, a1: number): RationalArc {
  const span = a1 - a0;
  const n = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2) - 1e-9));
  const d = span / n;
  const w = Math.cos(d / 2);
  const angles: number[] = [];
  const scales: number[] = [];
  const weights: number[] = [];
  const knots: number[] = [];
  for (let k = 0; k <= n; k++) {
    angles.push(a0 + k * d);
    scales.push(1);
    weights.push(1);
    if (k < n) {
      angles.push(a0 + (k + 0.5) * d);
      scales.push(1 / w);
      weights.push(w);
    }
    const t = a0 + k * d;
    knots.push(t, t);
  }
  return { angles, scales, weights, knots };
}

export interface RationalSurface {
  degreeU: number;
  degreeV: number;
  /** openNURBS-style knot vectors (length = cvCount + degree - 1). */
  knotsU: number[];
  knotsV: number[];
  /** Euclidean control points [u][v] and their weights. */
  points: Vec3[][];
  weights: number[][];
}

/**
 * u = azimuth, v = elevation; the surface normal (∂u × ∂v) points towards the origin. With `ring` > 0
 * the elevation profile is moved out by the ring radius before it is revolved: still exact, since a
 * translated rational arc keeps its weights, so the torus patch is exact too.
 */
export function spherePatchNurbs(R: number, az0: number, az1: number, el0: number, el1: number, ring = 0): RationalSurface {
  const u = rationalArc(az0, az1);
  const v = rationalArc(el0, el1);
  const points: Vec3[][] = [];
  const weights: number[][] = [];
  for (let i = 0; i < u.angles.length; i++) {
    const su = u.scales[i];
    const dx = Math.sin(u.angles[i]) * su;
    const dy = Math.cos(u.angles[i]) * su;
    const rowP: Vec3[] = [];
    const rowW: number[] = [];
    for (let j = 0; j < v.angles.length; j++) {
      const sv = v.scales[j];
      // Profile control point (ring + R cos v, R sin v) · scale; the ring offset is not scaled.
      const rho = ring + R * Math.cos(v.angles[j]) * sv;
      const z = R * Math.sin(v.angles[j]) * sv;
      rowP.push([rho * dx, rho * dy, z]);
      rowW.push(u.weights[i] * v.weights[j]);
    }
    points.push(rowP);
    weights.push(rowW);
  }
  return { degreeU: 2, degreeV: 2, knotsU: u.knots, knotsV: v.knots, points, weights };
}

// ─── Evaluation (used by tests and analysis; independent of Rhino) ──────────

function fullKnots(k: number[]): number[] {
  return [k[0], ...k, k[k.length - 1]];
}

function basis(knots: number[], degree: number, count: number, t: number): number[] {
  // Cox–de Boor on the full knot vector.
  const U = fullKnots(knots);
  const N = new Array(U.length - 1).fill(0);
  const last = U[U.length - 1];
  for (let i = 0; i < U.length - 1; i++) {
    if ((t >= U[i] && t < U[i + 1]) || (t === last && U[i] < U[i + 1] && U[i + 1] === last)) N[i] = 1;
  }
  for (let p = 1; p <= degree; p++) {
    for (let i = 0; i < U.length - 1 - p; i++) {
      const a = U[i + p] - U[i] === 0 ? 0 : ((t - U[i]) / (U[i + p] - U[i])) * N[i];
      const b = U[i + p + 1] - U[i + 1] === 0 ? 0 : ((U[i + p + 1] - t) / (U[i + p + 1] - U[i + 1])) * N[i + 1];
      N[i] = a + b;
    }
  }
  return N.slice(0, count);
}

export function evaluateSurface(s: RationalSurface, u: number, v: number): Vec3 {
  const Nu = basis(s.knotsU, s.degreeU, s.points.length, u);
  const Nv = basis(s.knotsV, s.degreeV, s.points[0].length, v);
  let x = 0, y = 0, z = 0, w = 0;
  for (let i = 0; i < Nu.length; i++) {
    if (!Nu[i]) continue;
    for (let j = 0; j < Nv.length; j++) {
      const b = Nu[i] * Nv[j] * s.weights[i][j];
      if (!b) continue;
      const p = s.points[i][j];
      x += b * p[0];
      y += b * p[1];
      z += b * p[2];
      w += b;
    }
  }
  return [x / w, y / w, z / w];
}
