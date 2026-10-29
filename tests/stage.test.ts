import { describe, expect, it } from 'vitest';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { generateVenue } from '../src/engine/model';
import { ringOf, sphereRadiusAt } from '../src/engine/media';
import { areaOf, onStage, planBounds, stageFootprint, STAGE_LIFT_GAP, STAGE_SCREEN_GAP } from '../src/engine/stage';
import { validateConfig } from '../src/engine/validate';
import type { Geometry } from '../src/engine/types';

const deck = (c = cloneConfig(OM_300_FLAGSHIP)) => generateVenue(c).objects.find((o) => o.id === 'stage.main')!.geometry;

describe('stage joined to the screen', () => {
  it('runs back and out to the sides and ends on an exact arc of the screen', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    const g = deck(c) as Extract<Geometry, { kind: 'planProfile' }>;
    expect(g.kind).toBe('planProfile');
    const arcs = g.segments.filter((s) => s.kind === 'arc');
    expect(arcs.length).toBeGreaterThan(0);
    const f = c.floor.mainFloorElevation;
    const screen = Math.min(sphereRadiusAt(c.sphere.radius, f, ringOf(c)), sphereRadiusAt(c.sphere.radius, f + c.stage.height, ringOf(c)));
    for (const a of arcs) if (a.kind === 'arc') expect(a.radius).toBeCloseTo(screen - STAGE_LIFT_GAP, 12);
    // The thrust lip in front is the configured width; the outline is closed.
    const lip = g.segments.find((s) => s.kind === 'line' && Math.abs(s.a[1] - (c.stage.centerY - c.stage.depth / 2)) < 1e-12 && Math.abs(s.b[1] - s.a[1]) < 1e-12)!;
    expect(lip.kind === 'line' && Math.abs(lip.b[0] - lip.a[0])).toBeCloseTo(c.stage.width, 12);
    const end = (s: (typeof g.segments)[number]) => (s.kind === 'line' ? s.b : [s.center[0] + s.radius * Math.cos(s.angle1), s.center[1] + s.radius * Math.sin(s.angle1)]);
    const start = (s: (typeof g.segments)[number]) => (s.kind === 'line' ? s.a : [s.center[0] + s.radius * Math.cos(s.angle0), s.center[1] + s.radius * Math.sin(s.angle0)]);
    g.segments.forEach((s, i) => {
      const n = g.segments[(i + 1) % g.segments.length];
      expect(Math.hypot(end(s)[0] - start(n)[0], end(s)[1] - start(n)[1])).toBeLessThan(1e-9);
    });
  });
  it('a fixed deck keeps a 50 mm joint; area and bounds are exact', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.transformation.enabled = false;
    const fp = stageFootprint(c);
    const f = c.floor.mainFloorElevation;
    expect(fp.trimRadius).toBeCloseTo(Math.min(sphereRadiusAt(13, f, 0), sphereRadiusAt(13, f + c.stage.height, 0)) - STAGE_SCREEN_GAP, 12);
    // Full reach: the deck is the disc segment behind the wing line plus the thrust in front.
    const r = fp.trimRadius;
    const y1 = c.stage.centerY + c.stage.depth / 2;
    const segment = r * r * Math.acos(y1 / r) - y1 * Math.sqrt(r * r - y1 * y1);
    expect(fp.area).toBeCloseTo(segment + c.stage.width * c.stage.depth, 9);
    expect(areaOf(fp.segments)).toBeCloseTo(fp.area, 12);
    expect(planBounds(fp.segments).max[1]).toBeCloseTo(r, 12);
  });
  it('the reach sliders scale it between the thrust and the screen', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    const full = stageFootprint(c).area;
    c.stage.sideReach = 0.5;
    const half = stageFootprint(c).area;
    c.stage.sideReach = 0;
    const narrow = stageFootprint(c);
    c.stage.backReach = 0;
    const thrust = stageFootprint(c);
    expect(full).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(narrow.area);
    expect(narrow.max[0]).toBeCloseTo(c.stage.width / 2, 12);
    expect(thrust.area).toBeCloseTo(c.stage.width * c.stage.depth, 12);
    c.stage.backReach = 1.5;
    expect(validateConfig(c).some((i) => i.code === 'stage-reach')).toBe(true);
  });
  it('stand-alone is the old rectangle; old files and central stages stay stand-alone', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.stage.attached = false;
    expect(deck(c).kind).toBe('box');
    const old = cloneConfig(OM_300_FLAGSHIP);
    delete old.stage.attached;
    expect(normalizeConfig(old).stage.attached).toBe(false);
    const central = cloneConfig(OM_300_FLAGSHIP);
    central.stage = { ...central.stage, type: 'central', centerY: 0 };
    expect(deck(central).kind).toBe('box');
  });
  it('seats keep clear of the wings, and the lift moves the shaped deck without conflicts', () => {
    const m = generateVenue(cloneConfig(OM_300_FLAGSHIP));
    const fp = stageFootprint(m.config);
    expect(m.seats.every((s) => !onStage(fp, s.position[0], s.position[1], 0.5))).toBe(true);
    expect(m.transformation!.conflicts).toEqual([]);
    const pit = m.objects.find((o) => o.id === 'pit.stage')!;
    expect(pit.geometry.kind).toBe('planProfile');
  });
});
