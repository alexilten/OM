import { describe, expect, it } from 'vitest';
import { sphereRadiusAt } from '../src/engine/media';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { poseAt, posedObjects, SCREEN_GAP } from '../src/engine/kinetics';
import { generateVenue } from '../src/engine/model';
import type { Geometry, VenueConfiguration } from '../src/engine/types';

const venue = (edit?: (c: VenueConfiguration) => void) => {
  const c = cloneConfig(OM_300_FLAGSHIP);
  edit?.(c);
  return generateVenue(c);
};

describe('transformation: seated ↔ standing', () => {
  const m = venue();
  const tr = m.transformation!;

  it('gives every moving assembly an explicit straight path on 04_TRANSFORMATION', () => {
    const moving = tr.assemblies.filter((a) => a.travel.some((v) => v !== 0));
    expect(moving.length).toBeGreaterThan(20);
    for (const a of moving) {
      const path = m.objects.find((o) => o.id === `path.${a.id}`)!;
      expect(path.layer).toBe('04_TRANSFORMATION/Movement_Envelopes');
      expect(path.metadata.status).toContain('conceptual');
      const g = path.geometry as Extract<Geometry, { kind: 'line' }>;
      for (let k = 0; k < 3; k++) expect(g.b[k] - g.a[k]).toBeCloseTo(a.travel[k], 9);
    }
  });

  it('starts from the seated state and ends at the full travel; reverse is the same path backwards', () => {
    const start = poseAt(tr, 0);
    const end = poseAt(tr, tr.duration);
    expect(start.fold).toBe(0);
    expect(end.fold).toBe(1);
    for (const a of tr.assemblies) {
      start.offsets.get(a.id)!.forEach((v) => expect(Math.abs(v)).toBe(0));
      end.offsets.get(a.id)!.forEach((v, k) => expect(v).toBeCloseTo(a.travel[k], 12));
    }
    // Monotonic along the path: any earlier time is never further along than a later one.
    const a = tr.assemblies.find((x) => x.kind === 'telescopic-wagon' && x.duration > 0)!;
    const along = (t: number) => Math.hypot(...poseAt(tr, t).offsets.get(a.id)!);
    const ts = Array.from({ length: 50 }, (_, i) => (i / 49) * tr.duration);
    for (let i = 1; i < ts.length; i++) expect(along(ts[i])).toBeGreaterThanOrEqual(along(ts[i - 1]) - 1e-12);
  });

  it('clears the audience before anything moves', () => {
    const hold = OM_300_FLAGSHIP.transformation.clearanceHoldS;
    expect(tr.steps[0].kind).toBe('interlock');
    expect(tr.steps[0].duration).toBe(hold);
    for (const a of tr.assemblies) expect(a.start).toBeGreaterThanOrEqual(hold);
    const p = poseAt(tr, hold - 0.01);
    expect(p.fold).toBe(0);
    for (const d of p.offsets.values()) d.forEach((v) => expect(Math.abs(v)).toBe(0));
  });

  it('has no conflicts by default, and every moved seat stays clear of the screen', () => {
    expect(tr.conflicts).toEqual([]);
    const R = m.config.sphere.radius;
    const standing = posedObjects(m.objects, tr, poseAt(tr, tr.duration));
    for (const o of standing.filter((x) => x.category === 'Seat')) {
      const [x, y, z] = (o.geometry as Extract<Geometry, { kind: 'blockInstance' }>).frame.origin;
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(sphereRadiusAt(R, z) - SCREEN_GAP + 1e-9);
    }
  });

  it('flags collisions when the riser is too low for folded seats, and explains why', () => {
    const low = venue((c) => (c.seating.riserHeight = 0.25)).transformation!;
    expect(low.conflicts.length).toBeGreaterThan(0);
    expect(low.conflicts.every((k) => k.kind === 'collision')).toBe(true);
    expect(low.conflicts[0].message).toMatch(/riser gives 250 mm/);
  });

  it('lowers the stage flush with the floor and gains standing room', () => {
    const lift = tr.assemblies.find((a) => a.kind === 'stage-lift')!;
    expect(lift.travel).toEqual([0, 0, -m.config.stage.height]);
    const stage = posedObjects(m.objects, tr, poseAt(tr, tr.duration)).find((o) => o.id === 'stage.main')!.geometry as Extract<Geometry, { kind: 'planProfile' }>;
    expect(stage.zTop).toBeCloseTo(m.config.floor.mainFloorElevation, 9);
    const fixed = venue((c) => (c.transformation.seating = 'fixed')).transformation!;
    expect(fixed.assemblies.map((a) => a.kind)).toEqual(['stage-lift']);
    expect(tr.standing.capacity).toBeGreaterThan(fixed.standing.capacity);
    expect(m.metrics.find((x) => x.key === 'aud.standing')!.value).toBe(tr.standing.capacity);
  });

  it('marks the machinery conceptual and can be turned off', () => {
    expect(m.issues.some((i) => i.code === 'kin-concept')).toBe(true);
    const off = venue((c) => (c.transformation.enabled = false));
    expect(off.transformation).toBeUndefined();
    expect(off.objects.some((o) => o.layer.startsWith('04_TRANSFORMATION'))).toBe(false);
  });

  it('opens Round 01–03 files without a transformation section', () => {
    const legacy = cloneConfig(OM_300_FLAGSHIP) as Partial<VenueConfiguration>;
    delete legacy.transformation;
    const c = normalizeConfig(legacy as VenueConfiguration);
    expect(c.transformation).toEqual(OM_300_FLAGSHIP.transformation);
  });
});
