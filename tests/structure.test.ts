import { describe, expect, it } from 'vitest';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { generateVenue } from '../src/engine/model';
import { structureLayout } from '../src/engine/structure';
import { validateConfig } from '../src/engine/validate';
import { getLedProduct } from '../src/library/led';
import { getStructureSystem } from '../src/library/catalog';
import type { Tier, VenueConfiguration } from '../src/engine/types';

const withoutLed = (c: VenueConfiguration) => ({ ...c, led: { ...c.led, enabled: false } });
const allOn = (tier: Tier) => {
  const c = withoutLed(cloneConfig(OM_300_FLAGSHIP));
  for (const s of Object.values(c.systems)) Object.assign(s, { enabled: true, tier, scale: 1 });
  return c;
};
type Arc = { radius: number; azimuth: number; elevation0: number; elevation1: number };

describe('support structure', () => {
  it('follows the media surface as it scales', () => {
    for (const R of [10, 13, 16]) {
      const c = withoutLed(cloneConfig(OM_300_FLAGSHIP));
      c.sphere.radius = R;
      const m = generateVenue(c);
      const sys = getStructureSystem(c.structure.system)!;
      const ribR = R + getLedProduct(c.led.productId)!.cabinetDepth.value + c.structure.mountGap + sys.ribDepth / 2;
      const ribs = m.objects.filter((o) => o.category === 'Rib');
      expect(ribs.length).toBeGreaterThan(0);
      for (const o of ribs) {
        const g = o.geometry as unknown as Arc;
        expect(g.radius).toBeCloseTo(ribR, 9);
        expect(g.radius * (g.elevation1 - g.elevation0)).toBeLessThanOrEqual(c.structure.maxSegment + 1e-9);
      }
      // Ribs span exactly the screen's azimuth range.
      const az = [...new Set(ribs.map((o) => (o.geometry as unknown as Arc).azimuth))];
      expect(Math.min(...az)).toBeCloseTo((c.media.azimuthLeftDeg * Math.PI) / 180, 9);
      expect(Math.max(...az)).toBeCloseTo((c.media.azimuthRightDeg * Math.PI) / 180, 9);
    }
    const wide = withoutLed(cloneConfig(OM_300_FLAGSHIP));
    wide.media.azimuthLeftDeg = -150;
    wide.media.azimuthRightDeg = 150;
    expect(generateVenue(wide).structure!.ribs).toBeGreaterThan(generateVenue(withoutLed(OM_300_FLAGSHIP)).structure!.ribs);
  });

  it('splits every member into shippable segments, and flags oversize ones', () => {
    const m = generateVenue(withoutLed(OM_300_FLAGSHIP));
    expect(m.structure!.shipping.oversize).toBeUndefined();
    const long = withoutLed(cloneConfig(OM_300_FLAGSHIP));
    long.structure.maxSegment = 13.5;
    long.structure.ribSpacing = 6;
    const l = generateVenue(long);
    expect(l.structure!.segments.length).toBeLessThan(m.structure!.segments.length);
    if (l.structure!.shipping.oversize) expect(l.issues.some((i) => i.code === 'segment-oversize')).toBe(true);
  });

  it('hangs every audio array inside a bay, clear of the ribs', () => {
    const c = allOn('flagship');
    const m = generateVenue(c);
    const l = structureLayout(c)!;
    const half = l.sys.ribWidth / 2 / l.ribR;
    for (const o of m.objects.filter((x) => x.category === 'Speaker' && x.metadata.ring !== 'zenith')) {
      const [x, y] = (o.geometry as { frame: { origin: number[] } }).frame.origin;
      const az = Math.atan2(x, y);
      const gap = Math.min(...l.ribAz.map((a) => Math.abs(az - a)));
      expect(gap).toBeGreaterThan(half);
    }
  });

  it('carries every hung load to named ribs, and the loads add up', () => {
    const m = generateVenue(allOn('flagship'));
    const s = m.structure!;
    expect(s.picks.every((p) => p.carrier !== 'unsupported')).toBe(true);
    expect(s.hungLoad).toBeCloseTo(m.systems.pickLoad, 6);
    const total = s.ribReactions.reduce((t, x) => t + x, 0);
    expect(total).toBeCloseTo(s.steelWeight + s.ledLoad + s.hungLoad, 6);
    // Stage-truss hoists pick up through the screen; the oculus hoists from the crown grid.
    expect(s.picks.some((p) => p.carrier === 'pick-beam' && p.penetratesScreen)).toBe(true);
    expect(s.picks.some((p) => p.carrier === 'crown')).toBe(true);
    expect(m.objects.filter((o) => o.category === 'Chain')).toHaveLength(s.picks.filter((p) => p.carrier !== 'ring').length);
  });

  it('a lighter system lowers the rib reactions for the same loads', () => {
    const steel = allOn('premium');
    const alu = allOn('premium');
    alu.structure.system = 'alu-curved';
    const a = generateVenue(alu).structure!;
    const s = generateVenue(steel).structure!;
    expect(a.steelWeight).toBeLessThan(s.steelWeight);
    expect(Math.max(...a.ribReactions)).toBeLessThan(Math.max(...s.ribReactions));
  });

  it('wraps a full 360° screen without end ribs', () => {
    const c = withoutLed(cloneConfig(OM_300_FLAGSHIP));
    c.media.azimuthLeftDeg = -180;
    c.media.azimuthRightDeg = 180;
    c.stage = { ...c.stage, type: 'central', centerY: 0 };
    const l = structureLayout(c)!;
    expect(l.full).toBe(true);
    expect(l.ribAz.length).toBe(l.bays.length);
    expect(generateVenue(c).structure!.ribs).toBe(l.ribAz.length);
  });

  it('validates its parameters and opens Round 06 files with the structure off', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.structure.system = 'nope';
    c.structure.maxSegment = 20;
    const codes = validateConfig(c).filter((i) => i.severity === 'error').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['unknown-structure', 'structure-segment']));
    const legacy = cloneConfig(OM_300_FLAGSHIP) as Partial<VenueConfiguration>;
    delete legacy.structure;
    const n = normalizeConfig(legacy as VenueConfiguration);
    expect(n.structure.enabled).toBe(false);
    expect(generateVenue(withoutLed(n)).objects.some((o) => o.id.startsWith('struct.'))).toBe(false);
  });
});

describe('FX safety', () => {
  it('keeps flagship lasers above the audience exclusion plane and flags pooling of low fog', () => {
    const m = generateVenue(allOn('flagship'));
    const plane = m.objects.find((o) => o.id === 'fx.laser.exclusion')!;
    const z = (plane.geometry as { zTop: number }).zTop;
    const lasers = m.objects.filter((o) => o.metadata.unit === 'fx-laser');
    expect(lasers.length).toBeGreaterThan(0);
    for (const o of lasers) expect((o.geometry as { frame: { origin: number[] } }).frame.origin[2]).toBeGreaterThan(z);
    expect(m.issues.some((i) => i.code === 'laser-exclusion')).toBe(false);
    expect(m.issues.some((i) => i.code === 'gas-pooling')).toBe(true);
  });
});
