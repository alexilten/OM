import { describe, expect, it } from 'vitest';
import { spherePoint, toRad, toSpherical } from '../src/engine/coordinates';
import { cloneConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { mediaBounds, patchArea } from '../src/engine/media';
import { generateVenue, tryGenerateVenue } from '../src/engine/model';
import { evaluateSurface, spherePatchNurbs } from '../src/engine/nurbs';
import { sectionPlane, sphereSection } from '../src/engine/section';
import type { Geometry, VenueModel } from '../src/engine/types';
import { fromDisplay, toDisplay } from '../src/engine/units';
import { getSeatingProduct } from '../src/library/seating';

const geom = <K extends Geometry['kind']>(m: VenueModel, id: string, kind: K) => {
  const o = m.objects.find((x) => x.id === id)!;
  expect(o.geometry.kind).toBe(kind);
  return o.geometry as Extract<Geometry, { kind: K }>;
};

describe('coordinate system', () => {
  it('follows P(θ, φ) = (R cosφ sinθ, R cosφ cosθ, R sinφ)', () => {
    expect(spherePoint(10, 0, 0)).toEqual([0, 10, 0]); // forward = +Y
    const right = spherePoint(10, Math.PI / 2, 0);
    expect(right[0]).toBeCloseTo(10); // +θ = audience right = +X
    expect(spherePoint(10, 0, Math.PI / 2)[2]).toBeCloseTo(10); // +φ = up = +Z
    const [r, az, el] = toSpherical(spherePoint(7, 0.3, -0.4));
    expect(r).toBeCloseTo(7, 12);
    expect(az).toBeCloseTo(0.3, 12);
    expect(el).toBeCloseTo(-0.4, 12);
  });
});

describe('spherical media surface', () => {
  it('rational NURBS patch lies exactly on the sphere (not a cylinder)', () => {
    const R = 13;
    const s = spherePatchNurbs(R, toRad(-110), toRad(110), toRad(-7.5), toRad(72));
    let worst = 0;
    for (let i = 0; i <= 50; i++)
      for (let j = 0; j <= 50; j++) {
        const u = toRad(-110) + (toRad(220) * i) / 50;
        const v = toRad(-7.5) + (toRad(79.5) * j) / 50;
        const p = evaluateSurface(s, u, v);
        worst = Math.max(worst, Math.abs(Math.hypot(...p) - R));
      }
    expect(worst).toBeLessThan(1e-10);
    // Double curvature: the patch's mid-height meridian is curved, so a cylinder cannot match it.
    const top = evaluateSurface(s, 0, toRad(72));
    const bottom = evaluateSurface(s, 0, toRad(-7.5));
    expect(Math.hypot(top[0], top[1])).toBeLessThan(Math.hypot(bottom[0], bottom[1]) - 1);
  });

  it('patch edges hit the configured azimuth and elevation limits', () => {
    const s = spherePatchNurbs(10, -1, 1.2, -0.2, 0.9);
    const corner = evaluateSurface(s, -1, -0.2);
    const expected = spherePoint(10, -1, -0.2);
    corner.forEach((c, k) => expect(c).toBeCloseTo(expected[k], 10));
  });

  it('area matches the closed form R²Δθ(sinφ1 − sinφ0)', () => {
    const b = mediaBounds(10, { azimuthLeftDeg: -180, azimuthRightDeg: 180, elevationLowerDeg: -90, elevationUpperDeg: 90 });
    expect(patchArea(b)).toBeCloseTo(4 * Math.PI * 100, 8);
  });
});

describe('world origin invariance', () => {
  it('changing floor elevation or screen crop never moves the sphere centre', () => {
    const base = generateVenue(OM_300_FLAGSHIP);
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.floor.mainFloorElevation = -2.6;
    c.media.elevationLowerDeg = -12;
    c.media.azimuthRightDeg = 140;
    const moved = generateVenue(c);
    expect(geom(moved, 'ref.sphere', 'sphere').center).toEqual([0, 0, 0]);
    expect(geom(moved, 'ref.origin', 'point').p).toEqual([0, 0, 0]);
    expect(geom(moved, 'media.ideal', 'spherePatch').radius).toBe(geom(base, 'media.ideal', 'spherePatch').radius);
    // Floor moved: stage and front row follow the floor, the sphere does not.
    expect(geom(moved, 'stage.main', 'planProfile').zBottom).toBeCloseTo(-2.6);
    expect(moved.seats[0].position[2]).toBeCloseTo(-2.6);
  });

  it('changing the radius regenerates dependent geometry', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.sphere.radius = 16;
    const m = generateVenue(c);
    expect(geom(m, 'ref.sphere', 'sphere').radius).toBe(16);
    expect(geom(m, 'media.ideal', 'spherePatch').radius).toBe(16);
    expect(m.seats.length).toBeGreaterThan(generateVenue(OM_300_FLAGSHIP).seats.length);
    const half = geom(m, 'arch.floor', 'box').max[0];
    expect(half).toBeCloseTo(16 + c.envelope.serviceZone);
  });
});

describe('seating', () => {
  const m = generateVenue(OM_300_FLAGSHIP);
  const product = getSeatingProduct(OM_300_FLAGSHIP.seating.productId)!;

  it('seat count equals generated seat objects and eye points', () => {
    const seatObjs = m.objects.filter((o) => o.category === 'Seat');
    expect(seatObjs.length).toBe(m.seats.length);
    expect(m.objects.filter((o) => o.category === 'EyePoint').length).toBe(m.seats.length);
    expect(m.metrics.find((x) => x.key === 'aud.seats')!.value).toBe(m.seats.length);
    expect(m.seats.length).toBeGreaterThan(250);
  });

  it('seats keep the product footprint and never overlap within a row', () => {
    const block = m.blocks.find((b) => b.id.includes(product.id))!;
    expect(block.metadata.width_m).toBe(product.width.value);
    expect(block.metadata.depth_m).toBe(product.depth.value);
    const rows = new Map<string, typeof m.seats>();
    m.seats.forEach((s) => rows.set(s.row, [...(rows.get(s.row) ?? []), s]));
    for (const seats of rows.values())
      for (let i = 1; i < seats.length; i++) {
        const d = Math.hypot(seats[i].position[0] - seats[i - 1].position[0], seats[i].position[1] - seats[i - 1].position[1]);
        expect(d).toBeGreaterThanOrEqual(product.width.value * 0.999);
      }
  });

  it('respects the screen clearance and tier/eye heights update together', () => {
    for (const s of m.seats) expect(s.screenClearance).toBeGreaterThanOrEqual(OM_300_FLAGSHIP.seating.screenClearance - 1e-9);
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.seating.riserHeight = 0.4;
    const steeper = generateVenue(c);
    const tierK = steeper.objects.find((o) => o.id.startsWith('tier.K.'))!.geometry as Extract<Geometry, { kind: 'annularSector' }>;
    const seatK = steeper.seats.find((s) => s.row === 'K')!;
    expect(tierK.zTop).toBeCloseTo(seatK.position[2]);
    expect(seatK.eyePoint[2] - seatK.position[2]).toBeCloseTo(product.eyeHeight.value);
  });

  it('is deterministic (stable ids for identical input)', () => {
    const again = generateVenue(cloneConfig(OM_300_FLAGSHIP));
    expect(again.objects.map((o) => o.id)).toEqual(m.objects.map((o) => o.id));
  });
});

describe('validation', () => {
  it('rejects invalid parameters instead of generating a corrupt scene', () => {
    const bad = cloneConfig(OM_300_FLAGSHIP);
    bad.media.elevationUpperDeg = -20;
    const r1 = tryGenerateVenue(bad);
    expect(r1.model).toBeUndefined();
    expect(r1.issues.some((i) => i.code === 'elevation-order')).toBe(true);

    const overlap = cloneConfig(OM_300_FLAGSHIP);
    overlap.seating.rowPitch = 0.5;
    expect(tryGenerateVenue(overlap).issues.some((i) => i.code === 'row-pitch')).toBe(true);

    const nan = cloneConfig(OM_300_FLAGSHIP);
    nan.sphere.radius = Number.NaN;
    expect(tryGenerateVenue(nan).model).toBeUndefined();
  });
});

describe('units', () => {
  it('feet are a display concern only and round-trip exactly', () => {
    expect(fromDisplay(toDisplay(13, 'ft'), 'ft')).toBeCloseTo(13, 12);
    expect(toDisplay(0.3048, 'ft')).toBeCloseTo(1, 12);
  });
});

describe('section', () => {
  it('cuts the sphere in a circle of radius √(R² − d²)', () => {
    const b = mediaBounds(13, OM_300_FLAGSHIP.media);
    const plane = sectionPlane({ enabled: true, mode: 'longitudinal', offset: 5, rotationDeg: 0, flip: false });
    const { full, media } = sphereSection(plane, b);
    for (const p of full) {
      expect(p[0]).toBeCloseTo(5, 9);
      expect(Math.hypot(...p)).toBeCloseTo(13, 9);
    }
    expect(media.length).toBeGreaterThan(0);
  });
});
