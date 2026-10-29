/**
 * Stage footprint. Stand-alone, the deck is the plain width × depth rectangle. Joined to the screen
 * (`stage.attached`, the default), the rectangle stays as a thrust in front and the deck then runs back
 * (`backReach`) and out to the sides (`sideReach`) until it meets the screen, where it is trimmed exactly
 * to the screen's plan circle at deck height. The outline is lines and arcs, so Rhino gets a clean edge.
 */
import { ringOf, sphereRadiusAt } from './media';
import type { PlanSegment, VenueConfiguration } from './types';

/** Gap left between the deck edge and the screen surface (m); a lift keeps the machinery clearance. */
export const STAGE_SCREEN_GAP = 0.05;
export const STAGE_LIFT_GAP = 0.2;

type P = [number, number];

export interface StageFootprint {
  attached: boolean;
  /** Closed outline, counter-clockwise in plan. */
  segments: PlanSegment[];
  area: number;
  min: P;
  max: P;
  /** Plan radius the deck is trimmed to (attached only). */
  trimRadius: number;
  /** Rectangles (before trimming) that make up the deck, for clearance tests. */
  rects: { min: P; max: P }[];
}

export function attachedStage(c: VenueConfiguration) {
  return c.stage.type !== 'central' && !!c.stage.attached;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function stageFootprint(c: VenueConfiguration): StageFootprint {
  const st = c.stage;
  const hw = st.width / 2;
  const y0 = st.centerY - st.depth / 2;
  const y1 = st.centerY + st.depth / 2;
  // Trimmed to the tightest screen radius over the deck's height above the floor; a lift keeps the 200 mm
  // machinery clearance, a fixed deck a 50 mm joint.
  const f = c.floor.mainFloorElevation;
  const lift = c.transformation.enabled && c.transformation.stage === 'lift' && st.height > 0;
  const radiusAt = (z: number) => sphereRadiusAt(c.sphere.radius, z, ringOf(c));
  const rd = Math.min(radiusAt(f), radiusAt(f + st.height)) - (lift ? STAGE_LIFT_GAP : STAGE_SCREEN_GAP);
  if (!attachedStage(c) || rd <= 0) {
    const rect = { min: [-hw, y0] as P, max: [hw, y1] as P };
    return { attached: false, segments: polygon([[-hw, y0], [hw, y0], [hw, y1], [-hw, y1]]), area: st.width * st.depth, min: rect.min, max: rect.max, trimRadius: Infinity, rects: [rect] };
  }
  // The thrust runs back to the trim circle (or part way, with backReach < 1); the wings start behind it.
  const yb = Math.max(y1, y1 + clamp01(st.backReach ?? 1) * (rd - y1));
  // Side reach is measured to where the wing line meets the screen, so the whole slider range does something.
  const xMeet = y1 < rd ? Math.sqrt(rd * rd - y1 * y1) : hw;
  const xs = Math.max(hw, hw + clamp01(st.sideReach ?? 1) * (Math.max(hw, xMeet) - hw));
  const rects = [{ min: [-hw, y0] as P, max: [hw, yb] as P }];
  let outline: P[] = [[-hw, y0], [hw, y0], [hw, yb], [-hw, yb]];
  if (yb > y1 + 1e-9 && xs > hw + 1e-9) {
    rects.push({ min: [-xs, y1], max: [xs, yb] });
    outline = [[-hw, y0], [hw, y0], [hw, y1], [xs, y1], [xs, yb], [-xs, yb], [-xs, y1], [-hw, y1]];
  }
  const segments = clipToCircle(outline, rd);
  return { attached: true, segments, area: areaOf(segments), ...planBounds(segments), trimRadius: rd, rects };
}

/** True when (x, y) is on the deck or within `clear` of it (trimming ignored: the screen bounds it anyway). */
export function onStage(f: StageFootprint, x: number, y: number, clear = 0) {
  return f.rects.some((r) => x > r.min[0] - clear && x < r.max[0] + clear && y > r.min[1] - clear && y < r.max[1] + clear);
}

const polygon = (pts: P[]): PlanSegment[] => pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length] }));

/**
 * A counter-clockwise polygon intersected with the origin-centred disc of radius r. Edges are cut where
 * they cross the circle and each exit is joined to the next entry by a counter-clockwise arc. Assumes the
 * result is one piece, which holds for the stage outlines above.
 */
function clipToCircle(pts: P[], r: number): PlanSegment[] {
  const inside = (p: P) => Math.hypot(p[0], p[1]) <= r + 1e-12;
  if (pts.every(inside)) return polygon(pts);
  // Inside pieces of every edge, in order, as [start, end, startsOnCircle, endsOnCircle].
  const pieces: { a: P; b: P }[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const d: P = [b[0] - a[0], b[1] - a[1]];
    const A = d[0] * d[0] + d[1] * d[1];
    const B = 2 * (a[0] * d[0] + a[1] * d[1]);
    const C = a[0] * a[0] + a[1] * a[1] - r * r;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return;
    const s = Math.sqrt(disc);
    const t0 = Math.max(0, (-B - s) / (2 * A));
    const t1 = Math.min(1, (-B + s) / (2 * A));
    if (t1 - t0 < 1e-12) return;
    const at = (t: number): P => [a[0] + d[0] * t, a[1] + d[1] * t];
    pieces.push({ a: at(t0), b: at(t1) });
  });
  const onCircle = (p: P) => Math.abs(Math.hypot(p[0], p[1]) - r) < 1e-9;
  const out: PlanSegment[] = [];
  pieces.forEach((pc, i) => {
    out.push({ kind: 'line', a: pc.a, b: pc.b });
    const next = pieces[(i + 1) % pieces.length];
    if (onCircle(pc.b) && onCircle(next.a)) {
      const a0 = Math.atan2(pc.b[1], pc.b[0]);
      let a1 = Math.atan2(next.a[1], next.a[0]);
      while (a1 <= a0 + 1e-12) a1 += 2 * Math.PI;
      out.push({ kind: 'arc', center: [0, 0], radius: r, angle0: a0, angle1: a1 });
    }
  });
  return out.filter((s) => s.kind === 'arc' || Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 1e-9);
}

/** Points along an outline (arcs every ~2°), for bounds and display. */
export function sample(segments: PlanSegment[], step = Math.PI / 90): P[] {
  const out: P[] = [];
  for (const s of segments) {
    if (s.kind === 'line') out.push(s.a);
    else {
      const n = Math.max(2, Math.ceil((s.angle1 - s.angle0) / step));
      for (let k = 0; k < n; k++) {
        const a = s.angle0 + ((s.angle1 - s.angle0) * k) / n;
        out.push([s.center[0] + s.radius * Math.cos(a), s.center[1] + s.radius * Math.sin(a)]);
      }
    }
  }
  return out;
}

/** Exact plan bounds of an outline (arc extremes included). */
export function planBounds(segments: PlanSegment[]): { min: P; max: P } {
  const pts: P[] = [];
  for (const s of segments) {
    if (s.kind === 'line') pts.push(s.a, s.b);
    else {
      const at = (a: number): P => [s.center[0] + s.radius * Math.cos(a), s.center[1] + s.radius * Math.sin(a)];
      pts.push(at(s.angle0), at(s.angle1));
      for (let k = Math.ceil(s.angle0 / (Math.PI / 2)); k * (Math.PI / 2) < s.angle1; k++) pts.push(at(k * (Math.PI / 2)));
    }
  }
  return { min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
}

/** Enclosed area by Green's theorem (lines and arcs exactly). */
export function areaOf(segments: PlanSegment[]) {
  let A = 0;
  for (const s of segments) {
    if (s.kind === 'line') A += s.a[0] * s.b[1] - s.b[0] * s.a[1];
    else {
      const [cx, cy] = s.center;
      const { radius: r, angle0: a0, angle1: a1 } = s;
      A += r * r * (a1 - a0) + cx * r * (Math.sin(a1) - Math.sin(a0)) - cy * r * (Math.cos(a1) - Math.cos(a0));
    }
  }
  return A / 2;
}
