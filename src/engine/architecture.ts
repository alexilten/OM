/** Stage generator and architectural envelope (subsystems 6 and 8, Round 01 scope). */
import { mediaBounds, ringOf, sphereRadiusAt } from './media';
import { stageFootprint } from './stage';
import type { Issue, Metric, VenueConfiguration, VenueObject, Vec3 } from './types';

export function stageObjects(c: VenueConfiguration): { objects: VenueObject[]; issues: Issue[] } {
  const st = c.stage;
  const f = c.floor.mainFloorElevation;
  const top = f + st.height;
  const issues: Issue[] = [];
  const fp = stageFootprint(c);
  const meta = { stage_type: st.type, width_m: st.width, depth_m: st.depth, deck_height_m: st.height, deck_z: +top.toFixed(4), area_m2: +fp.area.toFixed(4), plan_width_m: +(fp.max[0] - fp.min[0]).toFixed(6), plan_depth_m: +(fp.max[1] - fp.min[1]).toFixed(6), status: 'conceptual' };
  if (fp.attached) {
    return {
      issues,
      objects: [
        {
          id: 'stage.main',
          name: 'Main_Stage',
          layer: '03_STAGE/Main_Stage',
          category: 'Stage',
          geometry: { kind: 'planProfile', segments: fp.segments, zBottom: f, zTop: top },
          operatingState: 'all',
          metadata: { ...meta, joined_to_screen: 'yes', trim_radius_m: +fp.trimRadius.toFixed(6), back_reach: st.backReach ?? 1, side_reach: st.sideReach ?? 1 },
        },
      ],
    };
  }
  const corners: [number, number][] = [
    [-st.width / 2, st.centerY - st.depth / 2],
    [st.width / 2, st.centerY - st.depth / 2],
    [st.width / 2, st.centerY + st.depth / 2],
    [-st.width / 2, st.centerY + st.depth / 2],
  ];
  const maxPlan = Math.max(...corners.map(([x, y]) => Math.hypot(x, y)));
  const limit = sphereRadiusAt(c.sphere.radius, top, ringOf(c));
  if (maxPlan > limit)
    issues.push({ severity: 'warning', code: 'stage-outside-sphere', message: `Stage corners reach ${(maxPlan - limit).toFixed(2)} m beyond the reference sphere at deck level.`, path: 'stage' });
  return {
    issues,
    objects: [
      {
        id: 'stage.main',
        name: 'Main_Stage',
        layer: '03_STAGE/Main_Stage',
        category: 'Stage',
        geometry: { kind: 'box', min: [-st.width / 2, st.centerY - st.depth / 2, f], max: [st.width / 2, st.centerY + st.depth / 2, top] },
        operatingState: 'all',
        metadata: { ...meta, joined_to_screen: 'no' },
      },
    ],
  };
}

export interface EnvelopeExtents {
  half: number;
  floorZ: number;
  slabBottom: number;
  topZ: number;
}

export function envelopeExtents(c: VenueConfiguration): EnvelopeExtents {
  const b = mediaBounds(c.sphere.radius, c.media);
  const R = c.sphere.radius;
  const half = ringOf(c) + R + c.envelope.serviceZone;
  const topZ = R * Math.sin(b.el1) + c.envelope.overheadClearance;
  return { half, floorZ: c.floor.mainFloorElevation, slabBottom: c.floor.mainFloorElevation - c.floor.slabThickness, topZ };
}

export function architectureObjects(c: VenueConfiguration): VenueObject[] {
  const e = envelopeExtents(c);
  const h = e.half;
  const ring = (z: number): Vec3[] => [
    [-h, -h, z],
    [h, -h, z],
    [h, h, z],
    [-h, h, z],
  ];
  const lo = ring(e.floorZ);
  const hi = ring(e.topZ);
  const meta = { width_m: 2 * h, depth_m: 2 * h, height_m: +(e.topZ - e.floorZ).toFixed(4), note: 'Design envelope = sphere + service zone; not a building' };
  return [
    { id: 'arch.floor', name: 'Main_Floor_Slab', layer: '06_ARCHITECTURE/Floor', category: 'Floor', geometry: { kind: 'box', min: [-h, -h, e.slabBottom], max: [h, h, e.floorZ] }, operatingState: 'all', metadata: { top_z: e.floorZ, thickness_m: c.floor.slabThickness } },
    { id: 'env.bottom', name: 'Envelope_Bottom', layer: '00_REFERENCE/Design_Envelope', category: 'DesignEnvelope', geometry: { kind: 'polyline', points: lo, closed: true }, metadata: meta },
    { id: 'env.top', name: 'Envelope_Top', layer: '00_REFERENCE/Design_Envelope', category: 'DesignEnvelope', geometry: { kind: 'polyline', points: hi, closed: true }, metadata: meta },
    ...lo.map((p, i) => ({ id: `env.edge.${i}`, name: `Envelope_Edge_${i}`, layer: '00_REFERENCE/Design_Envelope', category: 'DesignEnvelope', geometry: { kind: 'line' as const, a: p, b: hi[i] }, metadata: meta })),
  ];
}

export function architectureMetrics(c: VenueConfiguration): Metric[] {
  const e = envelopeExtents(c);
  return [
    { key: 'arch.footprint', label: 'Design envelope footprint', value: `${(2 * e.half).toFixed(1)} × ${(2 * e.half).toFixed(1)}`, unit: 'm', quality: 'derived', group: 'Architecture' },
    { key: 'arch.footprintArea', label: 'Footprint area', value: 4 * e.half * e.half, unit: 'm2', quality: 'derived', group: 'Architecture' },
    { key: 'arch.clearHeight', label: 'Required clear height', value: e.topZ - e.floorZ, unit: 'm', quality: 'estimate', group: 'Architecture' },
  ];
}
