import { describe, expect, it } from 'vitest';
import { surfaceNormal, surfacePoint, toRad, toSurface } from '../src/engine/coordinates';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { analyzeImmersion } from '../src/engine/immersion';
import { poseAt, posedObjects } from '../src/engine/kinetics';
import { mediaBounds, patchArea, sphereRadiusAt } from '../src/engine/media';
import { generateVenue, tryGenerateVenue } from '../src/engine/model';
import { evaluateSurface, spherePatchNurbs } from '../src/engine/nurbs';
import { checkProscenium, prosceniumSector } from '../src/engine/proscenium';
import { sectionPlane, sphereSection } from '../src/engine/section';
import type { Geometry, VenueConfiguration } from '../src/engine/types';

const venue = (edit?: (c: VenueConfiguration) => void) => {
  const c = cloneConfig(OM_300_FLAGSHIP);
  edit?.(c);
  return generateVenue(c);
};
const torus = (c: VenueConfiguration) => {
  c.sphere.ringRadius = 4;
  c.media.elevationUpperDeg = 90;
};
/** Distance from the tube centre circle. */
const tube = (p: number[], ring: number) => Math.hypot(Math.hypot(p[0], p[1]) - ring, p[2]);

describe('torus form', () => {
  it('surface point, normal and inverse agree', () => {
    const [R, a] = [9, 4];
    const p = surfacePoint(R, 0.7, -0.3, a);
    expect(tube(p, a)).toBeCloseTo(R, 12);
    const [r, az, el] = toSurface(p, a);
    expect(r).toBeCloseTo(R, 12);
    expect(az).toBeCloseTo(0.7, 12);
    expect(el).toBeCloseTo(-0.3, 12);
    // The normal is the tube's outward direction: one step along it stays a tube distance away.
    const n = surfaceNormal(0.7, -0.3);
    expect(tube(p.map((v, k) => v + n[k]), a)).toBeCloseTo(R + 1, 12);
    // Ring 0 is the sphere.
    expect(surfacePoint(7, 0.2, 0.4, 0)).toEqual(surfacePoint(7, 0.2, 0.4));
  });

  it('rational NURBS patch lies exactly on the torus, open at the top', () => {
    const [R, a] = [13, 4];
    const s = spherePatchNurbs(R, toRad(-110), toRad(110), toRad(-7.5), toRad(90), a);
    let worst = 0;
    for (let i = 0; i <= 40; i++)
      for (let j = 0; j <= 40; j++) {
        const p = evaluateSurface(s, toRad(-110 + (220 * i) / 40), toRad(-7.5 + (97.5 * j) / 40));
        worst = Math.max(worst, Math.abs(tube(p, a) - R));
      }
    expect(worst).toBeLessThan(1e-10);
    // At 90° the screen edge is the ring itself: a top opening of radius a.
    const top = evaluateSurface(s, 0.3, toRad(90));
    expect(Math.hypot(top[0], top[1])).toBeCloseTo(a, 9);
    expect(top[2]).toBeCloseTo(R, 9);
  });

  it('area matches the closed form RΔθ[aΔφ + R(sinφ1 − sinφ0)] (Pappus for the full outer half)', () => {
    const b = mediaBounds(10, { azimuthLeftDeg: -180, azimuthRightDeg: 180, elevationLowerDeg: -90, elevationUpperDeg: 90 }, 3);
    // Outer half of a torus: 2π·R·(πa + 2R).
    expect(patchArea(b)).toBeCloseTo(2 * Math.PI * 10 * (Math.PI * 3 + 20), 8);
    expect(sphereRadiusAt(10, 0, 3)).toBeCloseTo(13, 12);
    expect(sphereRadiusAt(10, 10, 3)).toBe(3);
  });

  it('section cut lies on both the plane and the torus', () => {
    const b = mediaBounds(10, OM_300_FLAGSHIP.media, 3);
    const plane = sectionPlane({ enabled: true, mode: 'longitudinal', offset: 2, rotationDeg: 0, flip: false });
    const cut = sphereSection(plane, b);
    expect(cut.full.length).toBeGreaterThan(50);
    expect(cut.media.length).toBeGreaterThan(0);
    for (const p of cut.media.flat()) {
      expect(p[0]).toBeCloseTo(2, 9);
      expect(Math.abs(tube(p, 3) - 10)).toBeLessThan(0.01);
    }
  });

  it('generates every system on the torus: LED, structure and speakers follow the ring', () => {
    const m = venue((c) => {
      torus(c);
      c.led.enabled = true;
      for (const s of Object.values(c.systems)) s.enabled = true;
    });
    const R = m.config.sphere.radius;
    expect(m.metrics.find((x) => x.key === 'sphere.opening')!.value).toBeCloseTo(8, 9);
    expect(m.led!.count).toBeGreaterThan(1000);
    expect(m.led!.maxDeviation).toBeLessThan(0.01);
    expect(m.led!.maxOverlap).toBeLessThan(1e-6);
    const ribs = m.objects.filter((o) => o.category === 'Rib');
    expect(ribs.length).toBeGreaterThan(10);
    for (const o of ribs) expect((o.geometry as Extract<Geometry, { kind: 'meridianArc' }>).ring).toBe(4);
    const speakers = m.objects.filter((o) => o.category === 'Speaker' && o.metadata.ring !== 'zenith');
    for (const o of speakers) {
      const p = (o.geometry as Extract<Geometry, { kind: 'blockInstance' }>).frame.origin;
      expect(tube(p, 4)).toBeGreaterThan(R);
    }
  });

  it('rejects a negative ring radius', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.sphere.ringRadius = -1;
    expect(tryGenerateVenue(c).issues.some((i) => i.code === 'ring-range')).toBe(true);
    // Older saved configurations have no ring and stay spheres.
    const old = cloneConfig(OM_300_FLAGSHIP) as VenueConfiguration;
    delete (old.sphere as { ringRadius?: number }).ringRadius;
    expect(normalizeConfig(old).sphere.ringRadius).toBe(0);
  });
});

describe('seating either side of the origin', () => {
  it('places, rates and checks seats in front of the origin', () => {
    const m = venue((c) => {
      c.transformation.enabled = false;
      c.stage.centerY = 9;
      c.seating.focusY = 9;
      c.seating.rowCount = 6;
    });
    const ahead = m.seats.filter((s) => s.position[1] > 0);
    const behind = m.seats.filter((s) => s.position[1] < 0);
    expect(ahead.length).toBeGreaterThan(20);
    expect(behind.length).toBeGreaterThan(0);
    for (const s of m.seats) expect(s.screenClearance).toBeGreaterThanOrEqual(m.config.seating.screenClearance - 1e-9);
    const a = analyzeImmersion(m, m.config.analysis);
    for (const s of ahead) expect(a.seats.get(s.id)!.score).toBeGreaterThan(0);
  });
});

describe('retractable proscenium', () => {
  const prosc = (c: VenueConfiguration) => {
    c.transformation.proscenium.enabled = true;
    c.led.enabled = true;
    c.structure.enabled = true;
  };
  const m = venue(prosc);
  const tr = m.transformation!;
  const halves = tr.assemblies.filter((a) => a.kind === 'proscenium');
  const patchOf = (objs: typeof m.objects, id: string) => objs.find((o) => o.id === id)!.geometry as Extract<Geometry, { kind: 'spherePatch' }>;

  it('splits the screen into exact fixed sections around two moving halves with the same total area', () => {
    const pieces = m.objects.filter((o) => o.layer === '01_MEDIA/Proscenium');
    expect(pieces.map((o) => o.id).sort()).toEqual(['media.fixed.left', 'media.fixed.right', 'media.fixed.top', 'prosc.screen.left', 'prosc.screen.right']);
    const total = pieces.reduce((t, o) => t + (o.metadata.area_m2 as number), 0);
    const ideal = m.objects.find((o) => o.id === 'media.ideal')!.metadata.area_m2 as number;
    expect(total).toBeCloseTo(ideal, 2);
  });

  it('pushes both halves straight back first, then slides them apart until the opening is clear', () => {
    expect(halves.map((a) => a.id).sort()).toEqual(['prosc.left', 'prosc.right']);
    const left = halves.find((a) => a.id === 'prosc.left')!;
    const right = halves.find((a) => a.id === 'prosc.right')!;
    expect(left.legs![0].travel).toEqual([0, 4, 0]);
    expect(left.legs![1].travel[0]).toBeLessThan(0);
    expect(right.legs![1].travel[0]).toBeGreaterThan(0);
    expect(left.memberIds).toContain('prosc.screen.left');
    expect(left.memberIds.filter((id) => id.startsWith('led.')).length).toBeGreaterThan(20);
    expect(right.memberIds.filter((id) => id.startsWith('led.')).length).toBeGreaterThan(20);
    expect(tr.steps.map((s) => s.id)).toEqual(expect.arrayContaining(['proscenium', 'proscenium-slide']));
    // Halfway through the push nothing has moved sideways.
    const mid = poseAt(tr, left.legs![0].start + left.legs![0].duration / 2).offsets.get('prosc.right')!;
    expect(mid[0]).toBe(0);
    expect(mid[1]).toBeCloseTo(2, 9);
    const end = posedObjects(m.objects, tr, poseAt(tr, tr.duration));
    expect(patchOf(end, 'prosc.screen.right').offset).toEqual(right.travel);
    expect(patchOf(end, 'media.fixed.left').offset).toBeUndefined();
    // Slid clear: the right half's inner edge passes the opening's right edge.
    const w = m.metrics.find((x) => x.key === 'prosc.width')!.value as number;
    expect(right.travel[0]).toBeGreaterThan(w / 2);
  });

  it('the Open slider sets a generative pose: half pushes back only, held in every state when off the timeline', () => {
    const half = venue((c) => {
      prosc(c);
      c.transformation.proscenium.onTimeline = false;
      c.transformation.proscenium.open = 0.25;
    });
    expect(half.transformation!.assemblies.some((a) => a.kind === 'proscenium')).toBe(false);
    expect(patchOf(half.objects, 'prosc.screen.left').offset).toEqual([0, 2, 0]);
    const full = venue((c) => {
      prosc(c);
      c.transformation.enabled = false;
      c.transformation.proscenium.open = 1;
    });
    const off = patchOf(full.objects, 'prosc.screen.left').offset!;
    expect(off[1]).toBe(4);
    expect(off[0]).toBeLessThan(-5);
    const closed = venue((c) => {
      prosc(c);
      c.transformation.proscenium.onTimeline = false;
      c.transformation.proscenium.open = 0;
    });
    expect(patchOf(closed.objects, 'prosc.screen.left').offset).toBeUndefined();
  });

  it('frames the opening in the structure: nothing structural is left in the carriage path', () => {
    const header = m.objects.filter((o) => String(o.metadata.mark ?? '').startsWith('PH'));
    expect(header.length).toBeGreaterThan(0);
    const s = prosceniumSector(m.config)!;
    for (const o of header) expect((o.geometry as Extract<Geometry, { kind: 'latitudeArc' }>).elevation).toBeCloseTo(s.el1, 12);
    const members = new Set(halves.flatMap((a) => a.memberIds));
    const check = checkProscenium(m.config, m.objects, members);
    for (const cat of ['Rib', 'RingGirder', 'BaseRing', 'StructureNode']) expect(check.inPath.has(cat)).toBe(false);
  });

  it('reports what else is in the way and the pocket it needs', () => {
    const busy = venue((c) => {
      prosc(c);
      c.systems.audio.enabled = true;
    });
    expect(busy.issues.some((i) => i.code === 'prosc-path')).toBe(true);
    expect(m.issues.some((i) => i.code === 'prosc-pocket')).toBe(true);
    expect(m.metrics.find((x) => x.key === 'prosc.width')!.value).toBeGreaterThan(10);
  });

  it('validates its settings', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    prosc(c);
    c.transformation.proscenium.topDeg = c.media.elevationLowerDeg;
    expect(tryGenerateVenue(c).issues.some((i) => i.code === 'prosc-top')).toBe(true);
    const d = cloneConfig(OM_300_FLAGSHIP);
    prosc(d);
    d.transformation.proscenium.open = 1.5;
    expect(tryGenerateVenue(d).issues.some((i) => i.code === 'prosc-open')).toBe(true);
  });

  it('works on the torus too', () => {
    const t = venue((c) => {
      prosc(c);
      torus(c);
    });
    expect(patchOf(t.objects, 'prosc.screen.right').ring).toBe(4);
    expect(t.transformation!.assemblies.filter((a) => a.kind === 'proscenium').length).toBe(2);
  });
});
