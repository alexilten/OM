import { describe, expect, it } from 'vitest';
import { cloneConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { generateVenue } from '../src/engine/model';
import { crownRing } from '../src/engine/systems';
import { validateConfig } from '../src/engine/validate';

const flagship = () => {
  const c = cloneConfig(OM_300_FLAGSHIP);
  for (const s of Object.values(c.systems)) (s.enabled = true), (s.tier = 'flagship');
  return c;
};

describe('lighting crown ring', () => {
  it('defaults to a lower top edge, about three quarters of the old one', () => {
    expect(OM_300_FLAGSHIP.media.elevationUpperDeg).toBe(54);
  });
  it('is one circular truss just above the screen top edge, with no stage truss', () => {
    const c = flagship();
    const m = generateVenue(c);
    const truss = m.objects.filter((o) => o.category === 'Truss');
    expect(truss.map((o) => o.id)).toEqual(['sys.lighting.truss.crown']);
    const g = truss[0].geometry;
    expect(g.kind).toBe('circle');
    const cr = crownRing(c);
    const R = c.sphere.radius;
    // On the sphere (0.3 m inset) and just above the 54° top edge.
    expect(Math.hypot(cr.radius, cr.z)).toBeCloseTo(R - 0.3, 9);
    expect((cr.el * 180) / Math.PI).toBeGreaterThan(54);
    expect((cr.el * 180) / Math.PI).toBeLessThan(56);
    // Every overhead fixture rides the crown.
    const fixtures = m.objects.filter((o) => o.category === 'LightingFixture' && o.metadata.rig !== 'base ring');
    expect(fixtures.length).toBeGreaterThan(20);
    expect(fixtures.every((o) => o.metadata.rig === 'crown')).toBe(true);
    for (const o of fixtures) expect(Math.abs(Math.hypot(o.metadata.x as number, o.metadata.y as number) - cr.radius)).toBeLessThan(1);
  });
  it('follows the top-edge, radius and drop sliders', () => {
    const c = flagship();
    const a = crownRing(c);
    c.media.elevationUpperDeg = 40;
    const b = crownRing(c);
    expect(b.z).toBeLessThan(a.z);
    expect(b.radius).toBeGreaterThan(a.radius);
    c.systems.lighting.crownDropDeg = 10;
    expect((crownRing(c).el * 180) / Math.PI).toBeCloseTo(30 + (0.35 / c.sphere.radius) * (180 / Math.PI), 6);
    c.sphere.radius = 16;
    expect(crownRing(c).radius).toBeGreaterThan(b.radius);
    expect(validateConfig(c).filter((i) => i.severity === 'error')).toHaveLength(0);
    c.systems.lighting.crownDropDeg = 30;
    expect(validateConfig(c).some((i) => i.code === 'crown-drop')).toBe(true);
  });
  it('hides less of the screen than the old stage truss', () => {
    const m = generateVenue(flagship());
    expect(m.systems.occlusion).toBeLessThan(0.02);
  });
});
