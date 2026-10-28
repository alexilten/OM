import { describe, expect, it } from 'vitest';
import { analyzeFit } from '../src/engine/building';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { generateVenue } from '../src/engine/model';
import { buildPreset, matchesPreset, PERFORMANCE_PRESETS, SIZE_PRESETS, VENUE_PRESETS } from '../src/engine/presets';
import { addAlternative, duplicateAlternative, parseProject, PROJECT_SCHEMA, removeAlternative, type ProjectFile } from '../src/engine/project';
import type { VenueConfiguration } from '../src/engine/types';

const withoutLed = (c: VenueConfiguration) => ({ ...c, led: { ...c.led, enabled: false } });
const strip = (c: VenueConfiguration) => JSON.stringify({ ...c, id: '', name: '' });

describe('presets', () => {
  it('OM 300 × Cinematic is exactly the flagship default', () => {
    expect(strip(buildPreset('om-300', 'cinematic'))).toBe(strip(OM_300_FLAGSHIP));
    expect(matchesPreset(OM_300_FLAGSHIP)).toBe(true);
    const edited = cloneConfig(OM_300_FLAGSHIP);
    edited.seating.rowCount = 11;
    expect(matchesPreset(edited)).toBe(false);
  });

  it('size presets land near their target capacity', () => {
    for (const s of SIZE_PRESETS) {
      const m = generateVenue(withoutLed(buildPreset(s.id, 'cinematic')));
      expect(m.seats.length).toBeGreaterThan(s.target * 0.9);
      expect(m.seats.length).toBeLessThan(s.target * 1.15);
    }
  });

  it('every size × performance combination is valid and moves without conflicts', () => {
    for (const s of SIZE_PRESETS)
      for (const p of PERFORMANCE_PRESETS) {
        const m = generateVenue(withoutLed(buildPreset(s.id, p.id)));
        expect(m.seats.length).toBeGreaterThan(50);
        expect(m.transformation!.conflicts).toEqual([]);
      }
  });

  it('presets are independent: a performance preset keeps the size and the building', () => {
    const base = cloneConfig(OM_300_FLAGSHIP);
    base.building.width = 50;
    const c = buildPreset('om-150', 'proscenium', base);
    expect(c.sphere.radius).toBe(10);
    expect(c.stage.type).toBe('proscenium');
    expect(c.building.width).toBe(50);
    expect(c.preset).toEqual({ size: 'om-150', performance: 'proscenium' });
  });

  it('theater in the round surrounds a central stage; standing concert is the transformed state', () => {
    const round = generateVenue(withoutLed(buildPreset('om-300', 'in-the-round')));
    const angles = round.seats.map((s) => Math.atan2(s.position[0], s.position[1]));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI * 1.6);
    expect(round.config.stage.centerY).toBe(0);
    const standing = buildPreset('om-300', 'standing-concert');
    expect(standing.operatingState).toBe('standing');
    expect(strip({ ...standing, operatingState: 'seated', preset: undefined })).toBe(strip({ ...buildPreset('om-300', 'seated-concert'), preset: undefined }));
  });

  it('names the five starting venues from the brief', () => {
    expect(VENUE_PRESETS.map((v) => v.name)).toEqual(['OM 150 / Intimate', 'OM 300 / Flagship', 'OM 400 / Expanded', 'OM Standing / Concert', 'OM 360 / Theater in the Round']);
  });
});

describe('project alternatives', () => {
  const project: ProjectFile = { schema: PROJECT_SCHEMA, activeId: OM_300_FLAGSHIP.id, alternatives: [cloneConfig(OM_300_FLAGSHIP)] };

  it('duplicates with a new id and name and identical geometry', () => {
    const { project: p, id } = duplicateAlternative(project, OM_300_FLAGSHIP.id);
    expect(p.alternatives).toHaveLength(2);
    expect(id).not.toBe(OM_300_FLAGSHIP.id);
    expect(p.activeId).toBe(id);
    const copy = p.alternatives.find((a) => a.id === id)!;
    expect(copy.name).toBe('OM 300 / Flagship (copy)');
    const a = generateVenue(withoutLed(OM_300_FLAGSHIP));
    const b = generateVenue(withoutLed(copy));
    expect(b.objects.map((o) => [o.id, o.geometry])).toEqual(a.objects.map((o) => [o.id, o.geometry]));
    const again = duplicateAlternative(p, OM_300_FLAGSHIP.id).project;
    expect(new Set(again.alternatives.map((x) => x.id)).size).toBe(3);
    expect(new Set(again.alternatives.map((x) => x.name)).size).toBe(3);
  });

  it('saves and reopens with the same geometry, dropping invalid alternatives', () => {
    let p = addAlternative(project, buildPreset('om-150', 'cinematic')).project;
    const bad = cloneConfig(OM_300_FLAGSHIP);
    bad.id = 'broken';
    bad.sphere.radius = -1;
    const saved = JSON.parse(JSON.stringify({ ...p, alternatives: [...p.alternatives, bad] }));
    const { project: reopened, dropped } = parseProject(saved);
    expect(dropped).toEqual([bad.name]);
    expect(reopened.alternatives.map((a) => a.id)).toEqual(p.alternatives.map((a) => a.id));
    for (const c of reopened.alternatives) {
      const orig = p.alternatives.find((a) => a.id === c.id)!;
      expect(generateVenue(withoutLed(c)).objects).toEqual(generateVenue(withoutLed(orig)).objects);
    }
    p = removeAlternative(p, p.activeId);
    expect(p.alternatives).toHaveLength(1);
    expect(removeAlternative(p, p.activeId)).toBe(p);
  });
});

describe('building fit', () => {
  it('the default flagship fits its default building', () => {
    const m = generateVenue(withoutLed(OM_300_FLAGSHIP));
    expect(m.fit!.fits).toBe(true);
    expect(m.fit!.columns.every((k) => k.status === 'clear')).toBe(true);
    expect(m.objects.filter((o) => o.category === 'Column')).toHaveLength(m.fit!.columns.length);
  });

  it('flags columns inside the sphere and the service zone', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.building.columns.layout = 'grid';
    const fit = analyzeFit(c);
    expect(fit.fits).toBe(false);
    const R = c.sphere.radius;
    for (const k of fit.columns) {
      if (k.status === 'inside') expect(k.distance).toBeLessThan(R);
      if (k.status === 'service') expect(k.distance).toBeLessThan(R + c.envelope.serviceZone);
      if (k.status === 'clear' || k.status === 'circulation') expect(k.distance).toBeGreaterThanOrEqual(R + c.envelope.serviceZone);
    }
    expect(fit.columns.some((k) => k.status === 'inside')).toBe(true);
  });

  it('flags a building that is too narrow or too low, and the largest radius it takes is exact', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.building.width = 28;
    expect(analyzeFit(c).checks.find((k) => k.key === 'plan')!.ok).toBe(false);
    const low = cloneConfig(OM_300_FLAGSHIP);
    low.building.clearHeight = 15;
    expect(analyzeFit(low).checks.find((k) => k.key === 'height')!.ok).toBe(false);

    const r = cloneConfig(OM_300_FLAGSHIP);
    r.building.columns.layout = 'none';
    r.building.circulationWidth = 0;
    const max = analyzeFit(r).maxRadius;
    r.sphere.radius = max - 1e-6;
    expect(analyzeFit(r).fits).toBe(true);
    r.sphere.radius = max + 0.01;
    expect(analyzeFit(r).fits).toBe(false);
  });

  it('reports excavation when the stage pit goes below the structural floor', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.building.floorElevation = -2.1;
    const fit = analyzeFit(c);
    expect(fit.excavation).toBeCloseTo(c.stage.height, 9);
    expect(fit.checks.find((k) => k.key === 'floor')!.ok).toBe(false);
    expect(fit.fits).toBe(true);
  });

  it('opens Round 04 files without a building or operating state, unchanged', () => {
    const legacy = cloneConfig(OM_300_FLAGSHIP) as Partial<VenueConfiguration>;
    delete legacy.building;
    delete legacy.operatingState;
    delete legacy.preset;
    const c = normalizeConfig(legacy as VenueConfiguration);
    expect(c.building.enabled).toBe(false);
    expect(c.operatingState).toBe('seated');
    expect(generateVenue(withoutLed(c)).objects.some((o) => o.layer.startsWith('06_ARCHITECTURE/Building'))).toBe(false);
  });
});
