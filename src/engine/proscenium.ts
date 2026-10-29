/**
 * Retractable proscenium (Round 10). A front sector of the media surface is a carriage split at the
 * forward axis into two halves. Opening runs in two legs, driven by one 0–1 `open` value: the first half
 * of the range pushes both halves straight back along +Y by `travel`; the second half slides each half
 * sideways (±X) until it clears the opening. The fixed screen is split into exact patches around the
 * opening (left, right and above), so every pose is an exact surface. With `onTimeline` each half is a
 * two-leg kinetic assembly on the TRANSFORM timeline (closed seated, at `open` standing); otherwise the
 * halves are generated at `open` in every state.
 *
 * Path check: a point is in the way when, at some pose along a half's two legs, it lies between that
 * half's screen face and its back face (screen + unit depth). The push leg is solved exactly, the slide
 * leg sampled every 0.2 m. Geometric only, like every kinetic check.
 */
import { surfacePoint, toDeg, toRad } from './coordinates';
import { getLedProduct } from '../library/led';
import { mediaBounds, patchArea, ringOf, type MediaBounds } from './media';
import type { Geometry, Issue, Metric, VenueConfiguration, VenueObject, Vec3 } from './types';

export const PROSCENIUM_ID = 'prosc';
export type CarriageHalf = 'left' | 'right';
export const HALVES: CarriageHalf[] = ['left', 'right'];
export const halfId = (h: CarriageHalf) => `${PROSCENIUM_ID}.${h}`;
/** Clearance past the opening edge once a half has slid aside (m). */
const SLIDE_MARGIN = 0.2;
const LAYER = '01_MEDIA/Proscenium';

export interface ProsceniumSector {
  az0: number;
  az1: number;
  el0: number;
  el1: number;
}

/** The moving sector in radians, or undefined when there is no proscenium. */
export function prosceniumSector(c: VenueConfiguration): ProsceniumSector | undefined {
  const p = c.transformation.proscenium;
  if (!p?.enabled) return undefined;
  const b = mediaBounds(c.sphere.radius, c.media, ringOf(c));
  const half = toRad(p.widthDeg) / 2;
  const s = { az0: Math.max(b.az0, -half), az1: Math.min(b.az1, half), el0: b.el0, el1: Math.min(b.el1, toRad(p.topDeg)) };
  return s.az1 - s.az0 > 1e-6 && s.el1 - s.el0 > 1e-6 ? s : undefined;
}

export const inSector = (s: ProsceniumSector, az: number, el: number) => az >= s.az0 - 1e-9 && az <= s.az1 + 1e-9 && el >= s.el0 - 1e-9 && el <= s.el1 + 1e-9;

/** Azimuth where the carriage splits (the forward axis, unless the sector is clipped to one side). */
const splitAz = (s: ProsceniumSector) => Math.max(s.az0, Math.min(s.az1, 0)) === 0 ? 0 : (s.az0 + s.az1) / 2;

/** One half of the sector. */
export const halfSector = (s: ProsceniumSector, h: CarriageHalf): ProsceniumSector => (h === 'left' ? { ...s, az1: splitAz(s) } : { ...s, az0: splitAz(s) });

/** The carriage's two legs at an opening amount u (0–1): push back along +Y, then slide aside along ±X. */
export function carriageLegs(c: VenueConfiguration, s: ProsceniumSector, h: CarriageHalf, u = c.transformation.proscenium.open): { push: Vec3; slide: Vec3 } {
  const p = c.transformation.proscenium;
  const box = carriageBox(c, halfSector(s, h));
  // Each half slides until its inner edge passes the opening's outer edge.
  const full = h === 'left' ? -(box.max[0] - carriageBox(c, s).min[0] + SLIDE_MARGIN) : carriageBox(c, s).max[0] - box.min[0] + SLIDE_MARGIN;
  const a = Math.min(1, 2 * u);
  const b = Math.max(0, 2 * u - 1);
  return { push: [0, p.travel * a, 0], slide: [full * b, 0, 0] };
}

/** Static offset of a half: its legs at `open` when held, else none (the timeline moves it). */
export function heldOffset(c: VenueConfiguration, h: CarriageHalf): Vec3 | undefined {
  const s = prosceniumSector(c);
  if (!s || movesOnTimeline(c)) return undefined;
  const { push, slide } = carriageLegs(c, s, h);
  const d: Vec3 = [push[0] + slide[0], push[1] + slide[1], push[2] + slide[2]];
  return d[0] || d[1] || d[2] ? d : undefined;
}

/** Whether the carriage moves on the seated → standing timeline. */
export const movesOnTimeline = (c: VenueConfiguration) => c.transformation.enabled && !!c.transformation.proscenium?.onTimeline;

/** The carriage half an object rides on: its screen, or an LED unit whose centre falls in that half. */
export function carriageOf(s: ProsceniumSector, o: VenueObject): CarriageHalf | undefined {
  if (o.parentAssembly?.startsWith(`${PROSCENIUM_ID}.`)) return o.parentAssembly.slice(PROSCENIUM_ID.length + 1) as CarriageHalf;
  if (!o.category.startsWith('LED') || typeof o.metadata.azimuth_deg !== 'number') return undefined;
  const az = toRad(o.metadata.azimuth_deg as number);
  if (!inSector(s, az, toRad(o.metadata.elevation_deg as number))) return undefined;
  return az < splitAz(s) ? 'left' : 'right';
}

const patch = (b: MediaBounds, az0: number, az1: number, el0: number, el1: number): Geometry => ({
  kind: 'spherePatch',
  radius: b.R,
  azimuth0: az0,
  azimuth1: az1,
  elevation0: el0,
  elevation1: el1,
  ...(b.ring ? { ring: b.ring } : {}),
});

/** The carriage screen and the fixed screen around the opening. Empty without a proscenium. */
export function prosceniumObjects(c: VenueConfiguration): VenueObject[] {
  const s = prosceniumSector(c);
  if (!s) return [];
  const b = mediaBounds(c.sphere.radius, c.media, ringOf(c));
  const area = (az0: number, az1: number, el0: number, el1: number) => +patchArea({ ...b, az0, az1, el0, el1 }).toFixed(4);
  const fixed = (id: string, name: string, az0: number, az1: number, el0: number, el1: number): VenueObject => ({
    id: `media.fixed.${id}`,
    name: `Screen_Fixed_${name}`,
    layer: LAYER,
    category: 'MediaSection',
    geometry: patch(b, az0, az1, el0, el1),
    operatingState: 'all',
    metadata: { section: 'fixed', area_m2: area(az0, az1, el0, el1) },
  });
  const out: VenueObject[] = HALVES.map((h) => {
    const q = halfSector(s, h);
    const { push, slide } = carriageLegs(c, s, h, 1);
    return {
      id: `prosc.screen.${h}`,
      name: `Proscenium_Screen_${h === 'left' ? 'Left' : 'Right'}`,
      layer: LAYER,
      category: 'ProsceniumScreen',
      geometry: patch(b, q.az0, q.az1, q.el0, q.el1),
      parentAssembly: halfId(h),
      operatingState: 'all',
      metadata: {
        section: `moving-${h}`,
        azimuth0_deg: +toDeg(q.az0).toFixed(4),
        azimuth1_deg: +toDeg(q.az1).toFixed(4),
        elevation0_deg: +toDeg(q.el0).toFixed(4),
        elevation1_deg: +toDeg(q.el1).toFixed(4),
        push_m: push[1],
        slide_m: slide[0],
        open: c.transformation.proscenium.open,
        area_m2: area(q.az0, q.az1, q.el0, q.el1),
        status: 'conceptual (not engineered)',
      },
    };
  });
  if (s.az0 > b.az0 + 1e-6) out.push(fixed('left', 'Left', b.az0, s.az0, b.el0, b.el1));
  if (s.az1 < b.az1 - 1e-6) out.push(fixed('right', 'Right', s.az1, b.az1, b.el0, b.el1));
  if (s.el1 < b.el1 - 1e-6) out.push(fixed('top', 'Above_Opening', s.az0, s.az1, s.el1, b.el1));
  return out;
}

/** Plan box of the carriage at its closed position: x and y of the sector, z from its lower edge to its top. */
export function carriageBox(c: VenueConfiguration, s: ProsceniumSector): { min: Vec3; max: Vec3 } {
  const ring = ringOf(c);
  const R = c.sphere.radius;
  const pts: Vec3[] = [];
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++) pts.push(surfacePoint(R, s.az0 + ((s.az1 - s.az0) * i) / 8, s.el0 + ((s.el1 - s.el0) * j) / 8, ring));
  const floor = c.floor.mainFloorElevation;
  const min: Vec3 = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(floor, Math.min(...pts.map((p) => p[2])))];
  const max: Vec3 = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[2]))];
  return { min, max };
}

/** Exact or sampled points of a geometry for the path check (curves at 8 segments). */
function pointsOf(g: Geometry): Vec3[] {
  switch (g.kind) {
    case 'point':
      return [g.p];
    case 'line':
      return [g.a, g.b, [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2, (g.a[2] + g.b[2]) / 2]];
    case 'polyline':
      return g.points;
    case 'blockInstance':
    case 'frameBox':
      return [g.frame.origin];
    case 'latitudeArc':
      return Array.from({ length: 9 }, (_, i) => surfacePoint(g.radius, g.azimuth0 + ((g.azimuth1 - g.azimuth0) * i) / 8, g.elevation, g.ring));
    case 'meridianArc':
      return Array.from({ length: 9 }, (_, i) => surfacePoint(g.radius, g.azimuth, g.elevation0 + ((g.elevation1 - g.elevation0) * i) / 8, g.ring));
    case 'box':
      return [g.min, g.max, [g.min[0], g.max[1], g.min[2]], [g.max[0], g.min[1], g.max[2]]];
    default:
      return [];
  }
}

/** Layers whose objects never obstruct the carriage (the screen itself, references, analysis, audience). */
const PASSIVE = ['00_REFERENCE', '01_MEDIA/Ideal_Spherical_Surface', '01_MEDIA/LED_Cabinets', '01_MEDIA/LED_Modules', '01_MEDIA/Proscenium', '01_MEDIA/Service_Clearances', '02_AUDIENCE', '04_TRANSFORMATION', '07_ANALYSIS', '08_PRESENTATION'];
const PASSIVE_CATEGORIES = new Set(['BuildingEnvelope', 'DesignEnvelope', 'Circulation', 'SafetyVolume']);

export interface ProsceniumResult {
  issues: Issue[];
  metrics: Metric[];
  /** Ids of objects in the carriage's path, by category. */
  inPath: Map<string, string[]>;
}

export function checkProscenium(c: VenueConfiguration, objects: VenueObject[], members: Set<string>): ProsceniumResult {
  const s = prosceniumSector(c);
  if (!s) return { issues: [], metrics: [], inPath: new Map() };
  const p = c.transformation.proscenium;
  const R = c.sphere.radius;
  const ring = ringOf(c);
  const led = c.led.enabled ? getLedProduct(c.led.productId) : undefined;
  const depth = (led?.cabinetDepth.value ?? 0.1) + 0.05;
  // Is q between a half's screen face and its back face once the half has moved by (dx, 0..dy, 0)?
  const behind = (h: ProsceniumSector, q: Vec3, dx: number, dy: number) => {
    const x = q[0] - dx;
    const z = q[2];
    if (Math.abs(z) >= R) return false;
    const rho = ring + Math.sqrt(R * R - z * z);
    if (Math.abs(x) >= rho) return false;
    const ys = Math.sqrt(rho * rho - x * x);
    if (q[1] < ys - 0.05 || q[1] > ys + depth + dy) return false;
    return inSector(h, Math.atan2(x, ys), Math.atan2(z, Math.hypot(x, ys) - ring));
  };
  const sweeps = HALVES.map((h) => ({ h: halfSector(s, h), ...carriageLegs(c, s, h) }));
  const blocked = (q: Vec3) =>
    sweeps.some(({ h, push, slide }) => {
      if (behind(h, q, 0, push[1])) return true;
      const n = Math.ceil(Math.abs(slide[0]) / 0.2);
      for (let k = 1; k <= n; k++) {
        const dx = (slide[0] * k) / n;
        if (behind(h, [q[0], q[1] - push[1], q[2]], dx, 0)) return true;
      }
      return false;
    });
  const inPath = new Map<string, string[]>();
  for (const o of objects) {
    if (members.has(o.id) || PASSIVE.some((l) => o.layer.startsWith(l)) || PASSIVE_CATEGORIES.has(o.category)) continue;
    if (pointsOf(o.geometry).some(blocked)) inPath.set(o.category, [...(inPath.get(o.category) ?? []), o.id]);
  }

  const box = carriageBox(c, s);
  const width = box.max[0] - box.min[0];
  const height = box.max[2] - box.min[2];
  const back = surfacePoint(R, 0, 0, ring)[1] + depth + p.travel * Math.min(1, 2 * p.open);
  const envelope = ring + R + c.envelope.serviceZone;
  const issues: Issue[] = [];
  const count = [...inPath.values()].reduce((n, ids) => n + ids.length, 0);
  if (count) {
    const list = [...inPath].map(([cat, ids]) => `${ids.length} ${cat.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}${ids.length > 1 ? 's' : ''}`).join(', ');
    issues.push({
      severity: 'warning',
      code: 'prosc-path',
      message: `${count} items sit in the proscenium's path (${list}). Move them clear or mount them on the carriage.${c.structure.enabled ? ' The support structure already frames the opening with a portal header.' : ''}`,
      path: 'transformation.proscenium.widthDeg',
    });
  }
  if (back > envelope + 1e-6)
    issues.push({
      severity: 'info',
      code: 'prosc-pocket',
      message: `Retracted, the carriage reaches ${back.toFixed(2)} m forward of the origin, ${(back - envelope).toFixed(2)} m past the service zone. The building needs a ${width.toFixed(1)} m wide pocket there.`,
      path: 'transformation.proscenium.travel',
    });
  const metrics: Metric[] = [
    { key: 'prosc.width', label: 'Proscenium opening width', value: width, unit: 'm', quality: 'exact', group: 'Transformation' },
    { key: 'prosc.height', label: 'Proscenium opening height', value: height, unit: 'm', quality: 'exact', group: 'Transformation' },
    { key: 'prosc.area', label: 'Moving screen area', value: patchArea({ ...mediaBounds(R, c.media, ring), ...s }), unit: 'm2', quality: 'exact', group: 'Transformation' },
    { key: 'prosc.open', label: 'Proscenium open', value: `${Math.round(p.open * 100)}%`, quality: 'exact', group: 'Transformation' },
    { key: 'prosc.time', label: 'Proscenium open time (back, then aside)', value: `${Math.round((p.travel * Math.min(1, 2 * p.open) + Math.abs(sweeps[1].slide[0])) / p.speed)} s`, quality: 'conceptual', group: 'Transformation' },
    { key: 'prosc.inPath', label: 'Items in the proscenium path', value: count, unit: 'count', quality: 'derived', group: 'Transformation' },
  ];
  return { issues, metrics, inPath };
}
