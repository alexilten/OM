import { describe, expect, it } from 'vitest';
import { cross, dot, length, spherePoint } from '../src/engine/coordinates';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { compareLedProducts, minRadiusFor, panelize } from '../src/engine/led';
import { patchArea, mediaBounds } from '../src/engine/media';
import { generateVenue } from '../src/engine/model';
import type { VenueConfiguration } from '../src/engine/types';
import { getLedProduct } from '../src/library/led';

const withProduct = (id: string, edit?: (c: VenueConfiguration) => void) => {
  const c = cloneConfig(OM_300_FLAGSHIP);
  c.led.productId = id;
  edit?.(c);
  return c;
};

describe('LED panelization: rings of true-size units', () => {
  const c = OM_300_FLAGSHIP;
  const p = getLedProduct(c.led.productId)!;
  const { units, summary } = panelize(c, p);
  const R = c.sphere.radius;

  it('keeps every unit rigid and true size, and inside the screen', () => {
    const b = mediaBounds(R, c.media);
    for (const u of units) {
      const f = u.frame!;
      expect(length(f.xAxis)).toBeCloseTo(1, 12);
      expect(length(f.yAxis)).toBeCloseTo(1, 12);
      expect(dot(f.xAxis, f.yAxis)).toBeCloseTo(0, 12);
      expect(dot(cross(f.xAxis, f.yAxis), f.zAxis)).toBeCloseTo(1, 12);
      expect(u.az).toBeGreaterThanOrEqual(b.az0);
      expect(u.az).toBeLessThanOrEqual(b.az1);
    }
    const m = generateVenue(c);
    const block = m.blocks.find((x) => x.id.startsWith('block.led.'))!;
    expect(block.metadata.cabinet_w_m).toBe(p.cabinetWidth.value);
    expect(block.metadata.cabinet_h_m).toBe(p.cabinetHeight.value);
  });

  it('never lets neighbouring faces collide, and reports the gaps instead', () => {
    expect(summary.maxOverlap).toBeLessThan(1e-6);
    expect(summary.maxGap).toBeGreaterThan(0);
    for (const placement of ['tangent', 'balanced'] as const)
      for (const gap of [0, 0.002]) {
        const s = panelize(withProduct(p.id, (x) => ((x.led.placement = placement), (x.led.jointGap = gap))), p).summary;
        expect(s.maxOverlap).toBeLessThan(1e-6);
      }
  });

  it('quantifies deviation exactly: tangent corners stand off by √(R² + (w/2)² + (h/2)²) − R, balanced halves it', () => {
    const w = p.cabinetWidth.value;
    const h = p.cabinetHeight.value;
    const standoff = Math.sqrt(R * R + (w / 2) ** 2 + (h / 2) ** 2) - R;
    expect(summary.maxDeviation).toBeCloseTo(standoff, 9);
    const balanced = panelize(withProduct(p.id, (x) => (x.led.placement = 'balanced')), p).summary;
    expect(balanced.maxDeviation).toBeLessThan(standoff * 0.51);
  });

  it('covers less than the ideal screen and says where (nothing is stretched)', () => {
    expect(summary.coverage).toBeLessThan(1);
    expect(summary.coverage).toBeGreaterThan(0.9);
    expect(summary.count * p.cabinetWidth.value * p.cabinetHeight.value).toBeLessThanOrEqual(patchArea(mediaBounds(R, c.media)) * 1.001);
  });

  it('a larger sphere means less deviation and smaller joint angles', () => {
    const big = panelize(withProduct(p.id, (x) => (x.sphere.radius = 18)), p).summary;
    expect(big.maxDeviation).toBeLessThan(summary.maxDeviation);
    expect(big.maxJointH).toBeLessThan(summary.maxJointH);
  });

  it('totals follow the unit count', () => {
    expect(summary.pixels).toBe(summary.count * p.pixelsX.value * p.pixelsY.value);
    expect(summary.weightKg).toBeCloseTo(summary.count * p.weightKg.value, 6);
    expect(summary.powerMaxW).toBeCloseTo(summary.count * p.powerMaxW.value, 6);
  });
});

describe('LED curvature limits and alternatives', () => {
  const small = (id: string) => withProduct(id, (x) => (x.sphere.radius = 5));
  const faceted = getLedProduct('roe-ruby-rb2.6f')!;

  it('flags a faceted product on a sphere tighter than its 5° hinge allows', () => {
    const s = panelize(small(faceted.id), faceted).summary;
    expect(s.failing).toBeGreaterThan(0);
    expect(s.fits).toBe(false);
    expect(s.maxJointH).toBeGreaterThan(5);
  });

  it('minRadiusFor is the radius where the hinge angle meets the limit', () => {
    const rMin = minRadiusFor(faceted, OM_300_FLAGSHIP);
    const just = panelize(withProduct(faceted.id, (x) => (x.sphere.radius = rMin * 1.01)), faceted).summary;
    expect(just.failing).toBe(0);
  });

  it('names alternatives that fit when curvature fails', () => {
    const c = small(faceted.id);
    c.seating.rowCount = 2;
    c.seating.frontRowRadius = 1.5;
    c.seating.focusY = 0;
    c.stage.centerY = 3;
    c.stage.depth = 1.5;
    c.stage.width = 3;
    const m = generateVenue(c);
    const issue = m.issues.find((i) => i.code === 'led-curvature')!;
    expect(issue.message).toMatch(/Alternatives that fit: .*RB-C 2\.6F/);
    expect(issue.message).toContain(`at least ${(Math.ceil(minRadiusFor(faceted, c) * 10) / 10).toFixed(1)} m`);
  });
});

describe('LED panelization: spherical tiles', () => {
  const p = getLedProduct('konica-dynavision-led')!;
  const c = withProduct(p.id);
  const { units, summary } = panelize(c, p);
  const R = c.sphere.radius;

  it('tiles lie on the sphere, cover it, and count one type per row', () => {
    expect(summary.maxDeviation).toBe(0);
    expect(summary.coverage).toBeGreaterThan(0.999);
    expect(summary.unitTypes).toBe(summary.rows);
    for (const u of units.slice(0, 50)) {
      const q = spherePoint(R, u.patch!.az0, u.patch!.el1);
      expect(length(q)).toBeCloseTo(R, 12);
    }
  });

  it('no tile is wider than the nominal panel, even near the zenith', () => {
    const cap = withProduct(p.id, (x) => (x.media.elevationUpperDeg = 90));
    const s = panelize(cap, p).summary;
    expect(s.tileRange!.wMax).toBeLessThanOrEqual(p.cabinetWidth.value + 1e-9);
  });
});

describe('LED comparison and saved files', () => {
  it('runs every library product on the same screen', () => {
    const rows = compareLedProducts(OM_300_FLAGSHIP);
    expect(rows.map((r) => r.product.id)).toContain('om-custom-modular-sphere');
    for (const r of rows) expect(r.count).toBeGreaterThan(0);
  });

  it('opens Round 01–02 files that carry ledPreview as a band', () => {
    const old = cloneConfig(OM_300_FLAGSHIP) as unknown as Record<string, unknown>;
    delete old.led;
    old.ledPreview = { enabled: true, productId: 'roe-ruby-c-rbc2.6f', bandElevationDeg: 10, bandRows: 3 };
    const c = normalizeConfig(old as unknown as VenueConfiguration);
    expect(c.led.extent).toBe('band');
    expect('ledPreview' in c).toBe(false);
    expect(generateVenue(c).led!.rows).toBe(3);
  });
});
