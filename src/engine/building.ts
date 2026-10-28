/**
 * Venue fit (subsystem 8, Round 05): places the configured venue in a simplified existing building
 * and checks it geometrically. This is a feasibility study only, not structural, fire, egress,
 * accessibility or code review.
 *
 * The venue claims its design envelope (sphere + service zone, square in plan, up to the overhead
 * clearance) plus a circulation walkway around it. Columns inside the sphere clash with the audience
 * and screen; columns in the service zone clash with the screen's support structure.
 */
import { envelopeExtents } from './architecture';
import { mediaBounds } from './media';
import type { Issue, Metric, VenueConfiguration, VenueObject, Vec3 } from './types';

export type ColumnStatus = 'clear' | 'circulation' | 'service' | 'inside';

export interface BuildingColumn {
  id: string;
  /** Plan centre. */
  x: number;
  y: number;
  status: ColumnStatus;
  /** Plan distance from the sphere centre to the nearest face of the column. */
  distance: number;
}

export interface FitCheck {
  key: string;
  label: string;
  ok: boolean;
  /** Blocking checks decide `fits`; the others are advice. */
  blocking: boolean;
  detail: string;
}

export interface BuildingFit {
  fits: boolean;
  checks: FitCheck[];
  columns: BuildingColumn[];
  /** Wall clearance to the design envelope on each side (m); negative = the envelope crosses the wall. */
  margins: { left: number; right: number; front: number; back: number; top: number };
  /** Largest sphere radius this building takes with the current media, envelope and floor settings. */
  maxRadius: number;
  /** Building volume the venue claims (envelope + circulation footprint × clear height used). */
  volumeUsed: number;
  /** Depth the stage pit or main floor goes below the existing structural floor (0 if none). */
  excavation: number;
}

/** Building walls in venue coordinates. */
export function buildingRect(c: VenueConfiguration) {
  const b = c.building;
  return { x0: b.offsetX - b.width / 2, x1: b.offsetX + b.width / 2, y0: b.offsetY - b.depth / 2, y1: b.offsetY + b.depth / 2 };
}

export function columnPositions(c: VenueConfiguration): { id: string; x: number; y: number }[] {
  const { columns } = c.building;
  if (columns.layout === 'none') return [];
  const r = buildingRect(c);
  // Columns sit just inside the walls; a grid repeats the perimeter spacing across the floor.
  const inset = columns.size / 2;
  const line = (a: number, b: number, spacing: number) => {
    const n = Math.max(1, Math.round((b - a - 2 * inset) / spacing));
    return Array.from({ length: n + 1 }, (_, k) => a + inset + ((b - a - 2 * inset) * k) / n);
  };
  const xs = line(r.x0, r.x1, columns.spacingX);
  const ys = line(r.y0, r.y1, columns.spacingY);
  const out: { id: string; x: number; y: number }[] = [];
  xs.forEach((x, i) =>
    ys.forEach((y, j) => {
      const edge = i === 0 || j === 0 || i === xs.length - 1 || j === ys.length - 1;
      if (columns.layout === 'grid' || edge) out.push({ id: `col.${i}.${j}`, x, y });
    }),
  );
  return out;
}

/** Plan distance from the origin to the nearest point of a square column. */
function nearestDistance(x: number, y: number, size: number) {
  const dx = Math.max(0, Math.abs(x) - size / 2);
  const dy = Math.max(0, Math.abs(y) - size / 2);
  return Math.hypot(dx, dy);
}

export function analyzeFit(c: VenueConfiguration): BuildingFit {
  const b = c.building;
  const R = c.sphere.radius;
  const e = envelopeExtents(c);
  const r = buildingRect(c);
  const top = b.floorElevation + b.clearHeight;
  const margins = { left: -e.half - r.x0, right: r.x1 - e.half, front: r.y1 - e.half, back: -e.half - r.y0, top: top - e.topZ };
  const minPlan = Math.min(margins.left, margins.right, margins.front, margins.back);
  const service = R + c.envelope.serviceZone;
  const walkway = e.half + b.circulationWidth;

  const columns: BuildingColumn[] = columnPositions(c).map(({ id, x, y }) => {
    const distance = nearestDistance(x, y, b.columns.size);
    // Inside the square envelope + walkway but outside the service ring counts as circulation.
    const inWalk = Math.abs(x) - b.columns.size / 2 < walkway && Math.abs(y) - b.columns.size / 2 < walkway;
    const status: ColumnStatus = distance < R ? 'inside' : distance < service ? 'service' : inWalk ? 'circulation' : 'clear';
    return { id, x, y, status, distance };
  });
  const clash = columns.filter((k) => k.status === 'inside' || k.status === 'service');
  const inWalk = columns.filter((k) => k.status === 'circulation');

  const pitBottom = c.transformation.enabled && c.transformation.stage === 'lift' ? c.floor.mainFloorElevation - c.stage.height : Infinity;
  const slabBottom = c.floor.mainFloorElevation - c.floor.slabThickness;
  const lowest = Math.min(slabBottom, pitBottom - c.floor.slabThickness);
  const excavation = Math.max(0, b.floorElevation - lowest);

  // Reverse fit: the largest R the walls, roof and columns allow (floor, media angles and zones fixed).
  const el1 = mediaBounds(R, c.media).el1;
  const planHalf = Math.min(b.width / 2 - Math.abs(b.offsetX), b.depth / 2 - Math.abs(b.offsetY)) - b.circulationWidth - c.envelope.serviceZone;
  const byRoof = Math.sin(el1) > 1e-6 ? (top - c.envelope.overheadClearance) / Math.sin(el1) : Infinity;
  const byColumns = Math.min(Infinity, ...columns.map((k) => k.distance - c.envelope.serviceZone));
  const maxRadius = Math.max(0, Math.min(planHalf, byRoof, byColumns));

  const m = (v: number) => `${v.toFixed(2)} m`;
  const checks: FitCheck[] = [
    { key: 'plan', label: 'Footprint fits between the walls', ok: minPlan >= 0, blocking: true, detail: minPlan >= 0 ? `Tightest wall clearance ${m(minPlan)}.` : `The design envelope crosses a wall by ${m(-minPlan)}.` },
    { key: 'height', label: 'Clear height', ok: margins.top >= 0, blocking: true, detail: margins.top >= 0 ? `${m(margins.top)} spare above the envelope.` : `Needs ${m(-margins.top)} more clear height.` },
    { key: 'columns', label: 'No columns in the sphere or screen support zone', ok: clash.length === 0, blocking: true, detail: clash.length ? `${clash.length} column${clash.length > 1 ? 's' : ''} clash (nearest ${m(Math.min(...clash.map((k) => k.distance)))} from the centre).` : `${columns.length} columns, all outside the service zone.` },
    { key: 'circulation', label: `Circulation walkway (${m(b.circulationWidth)})`, ok: minPlan >= b.circulationWidth && inWalk.length === 0, blocking: false, detail: minPlan < b.circulationWidth ? `Tightest walkway ${m(Math.max(0, minPlan))}.` : inWalk.length ? `${inWalk.length} column${inWalk.length > 1 ? 's' : ''} stand in the walkway.` : 'Clear on all sides.' },
    { key: 'floor', label: 'Fits on the existing floor', ok: excavation === 0, blocking: false, detail: excavation ? `Floor slab or stage pit goes ${m(excavation)} below the structural floor (excavation or a raised building floor).` : `Raised ${m(slabBottom - b.floorElevation)} above the structural floor.` },
  ];
  return {
    fits: checks.every((k) => !k.blocking || k.ok),
    checks,
    columns,
    margins,
    maxRadius,
    volumeUsed: (2 * walkway) ** 2 * (e.topZ - Math.min(b.floorElevation, lowest)),
    excavation,
  };
}

export interface BuildingResult {
  fit?: BuildingFit;
  objects: VenueObject[];
  metrics: Metric[];
  issues: Issue[];
}

export function generateBuilding(c: VenueConfiguration): BuildingResult {
  const b = c.building;
  if (!b.enabled) return { objects: [], metrics: [], issues: [] };
  const fit = analyzeFit(c);
  const r = buildingRect(c);
  const z0 = b.floorElevation;
  const z1 = z0 + b.clearHeight;
  const ring = (z: number): Vec3[] => [
    [r.x0, r.y0, z],
    [r.x1, r.y0, z],
    [r.x1, r.y1, z],
    [r.x0, r.y1, z],
  ];
  const lo = ring(z0);
  const hi = ring(z1);
  const meta = { width_m: b.width, depth_m: b.depth, clear_height_m: b.clearHeight, floor_z: z0, status: 'simplified existing building (concept)' };
  const e = envelopeExtents(c);
  const w = e.half + b.circulationWidth;
  const walk: Vec3[] = [
    [-w, -w, c.floor.mainFloorElevation],
    [w, -w, c.floor.mainFloorElevation],
    [w, w, c.floor.mainFloorElevation],
    [-w, w, c.floor.mainFloorElevation],
  ];
  const s = b.columns.size / 2;
  const objects: VenueObject[] = [
    { id: 'bldg.outline.floor', name: 'Building_Floor_Outline', layer: '06_ARCHITECTURE/Building_Envelope', category: 'BuildingEnvelope', geometry: { kind: 'polyline', points: lo, closed: true }, metadata: meta },
    { id: 'bldg.outline.roof', name: 'Building_Roof_Outline', layer: '06_ARCHITECTURE/Building_Envelope', category: 'BuildingEnvelope', geometry: { kind: 'polyline', points: hi, closed: true }, metadata: meta },
    ...lo.map((p, i) => ({ id: `bldg.edge.${i}`, name: `Building_Corner_${i}`, layer: '06_ARCHITECTURE/Building_Envelope', category: 'BuildingEnvelope', geometry: { kind: 'line' as const, a: p, b: hi[i] }, metadata: meta })),
    { id: 'bldg.circulation', name: 'Circulation_Walkway', layer: '06_ARCHITECTURE/Circulation', category: 'Circulation', geometry: { kind: 'polyline', points: walk, closed: true }, metadata: { width_m: b.circulationWidth, ok: fit.checks.find((k) => k.key === 'circulation')!.ok ? 'yes' : 'no' } },
    ...fit.columns.map((k) => ({
      id: k.id,
      name: `Column_${k.id.slice(4).replace('.', '_')}`,
      layer: '06_ARCHITECTURE/Structure',
      category: 'Column',
      geometry: { kind: 'box' as const, min: [k.x - s, k.y - s, z0] as Vec3, max: [k.x + s, k.y + s, z1] as Vec3 },
      operatingState: 'all' as const,
      metadata: { fit_status: k.status, distance_m: +k.distance.toFixed(4), size_m: b.columns.size },
    })),
  ];
  const issues: Issue[] = fit.checks
    .filter((k) => !k.ok)
    .map((k) => ({ severity: k.blocking ? ('warning' as const) : ('info' as const), code: `fit-${k.key}`, message: `Building fit: ${k.detail}`, path: k.key === 'columns' ? 'building.columns.layout' : k.key === 'height' ? 'building.clearHeight' : k.key === 'floor' ? 'building.floorElevation' : 'building.width' }));
  issues.push({ severity: 'info', code: 'fit-concept', message: 'Building fit is a geometric feasibility check only: no structural, fire, egress, accessibility or code review.', path: 'building' });
  const metrics: Metric[] = [
    { key: 'fit.status', label: 'Fits the building', value: fit.fits ? 'yes' : 'no', quality: 'derived', group: 'Architecture' },
    { key: 'fit.maxRadius', label: 'Largest sphere for this building', value: fit.maxRadius, unit: 'm', quality: 'derived', group: 'Architecture' },
    { key: 'fit.columnClashes', label: 'Column clashes', value: fit.columns.filter((k) => k.status === 'inside' || k.status === 'service').length, unit: 'count', quality: 'exact', group: 'Architecture' },
    { key: 'fit.volume', label: 'Building volume used', value: fit.volumeUsed, unit: 'm3', quality: 'estimate', group: 'Architecture' },
  ];
  return { fit, objects, metrics, issues };
}
