import { describe, expect, it } from 'vitest';
import { AUDIO_PRODUCTS, getAudioProduct } from '../src/library/catalog';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { generateVenue } from '../src/engine/model';
import { validateConfig } from '../src/engine/validate';
import type { Tier, VenueConfiguration } from '../src/engine/types';

const withoutLed = (c: VenueConfiguration) => ({ ...c, led: { ...c.led, enabled: false } });
const allOn = (tier: Tier, product = 'holoplot-x1') => {
  const c = withoutLed(cloneConfig(OM_300_FLAGSHIP));
  for (const s of Object.values(c.systems)) Object.assign(s, { enabled: true, tier, scale: 1 });
  c.systems.audio.product = product;
  return c;
};
const units = (c: VenueConfiguration, system: string) => generateVenue(c).objects.filter((o) => o.metadata.system === system && o.geometry.kind === 'blockInstance');
const dist = (p: number[]) => Math.hypot(p[0], p[1], p[2]);

describe('immersion systems', () => {
  it('scale up with tier and density', () => {
    for (const id of ['lighting', 'audio', 'atmospherics', 'tracking']) {
      const counts = (['standard', 'premium', 'flagship'] as const).map((t) => units(allOn(t), id).length);
      expect(counts[0]).toBeLessThan(counts[1]);
      expect(counts[1]).toBeLessThanOrEqual(counts[2]);
    }
    const dense = allOn('premium');
    dense.systems.lighting.scale = 2;
    expect(units(dense, 'lighting').length).toBeGreaterThan(units(allOn('premium'), 'lighting').length);
  });

  it('a disabled system places nothing and costs nothing', () => {
    const c = allOn('premium');
    c.systems.audio.enabled = false;
    const m = generateVenue(c);
    expect(m.objects.some((o) => o.metadata.system === 'audio')).toBe(false);
    expect(m.systems.systems.find((s) => s.id === 'audio')).toBeUndefined();
  });

  it('puts every speaker behind the screen inside the service zone, for every product and tier', () => {
    for (const p of AUDIO_PRODUCTS)
      for (const tier of ['standard', 'premium', 'flagship'] as const) {
        const c = allOn(tier, p.id);
        const R = c.sphere.radius;
        const speakers = units(c, 'audio').filter((o) => o.category === 'Speaker' && o.metadata.ring !== 'zenith');
        expect(speakers.length).toBeGreaterThan(0);
        for (const o of speakers) {
          const d = dist((o.geometry as { frame: { origin: number[] } }).frame.origin);
          expect(d).toBeGreaterThan(R);
          expect(d).toBeLessThan(R + c.envelope.serviceZone);
        }
      }
  });

  it('stacks matrix modules per position and counts them exactly', () => {
    const c = allOn('flagship', 'holoplot-x1');
    const p = getAudioProduct('holoplot-x1')!;
    const speakers = units(c, 'audio').filter((o) => o.category === 'Speaker');
    const positions = new Set(speakers.map((o) => o.metadata.position)).size;
    expect(speakers.length).toBe(positions * p.modulesPerPosition.flagship);
    const m = generateVenue(c);
    expect(m.systems.systems.find((s) => s.id === 'audio')!.count).toBe(units(c, 'audio').length);
  });

  it('keeps lighting, atmospherics and sensors inside the sphere and gives every hoist a load', () => {
    const c = allOn('flagship');
    const R = c.sphere.radius;
    for (const id of ['lighting', 'atmospherics', 'tracking'])
      for (const o of units(c, id).filter((x) => x.category !== 'Hoist')) expect(dist((o.geometry as { frame: { origin: number[] } }).frame.origin)).toBeLessThan(R);
    const m = generateVenue(c);
    const hoists = m.objects.filter((o) => o.category === 'Hoist');
    expect(hoists.length).toBeGreaterThan(0);
    expect(hoists.every((o) => Number(o.metadata.pick_load_kg) > 0)).toBe(true);
    expect(m.systems.pickLoad).toBeGreaterThan(0);
  });

  it('haptics follow the seat count and warn when motion seats meet telescopic wagons', () => {
    const c = allOn('premium');
    const m = generateVenue(c);
    expect(m.systems.systems.find((s) => s.id === 'haptics')!.count).toBe(m.seats.length);
    const f = generateVenue(allOn('flagship'));
    expect(f.systems.systems.find((s) => s.id === 'haptics')!.count).toBe(2 * f.seats.length);
    expect(f.issues.some((i) => i.code === 'haptics-telescopic')).toBe(true);
  });

  it('places the same units for the same configuration (stable ids)', () => {
    const a = generateVenue(allOn('flagship')).objects.filter((o) => o.metadata.system).map((o) => [o.id, o.geometry]);
    const b = generateVenue(allOn('flagship')).objects.filter((o) => o.metadata.system).map((o) => [o.id, o.geometry]);
    expect(b).toEqual(a);
  });
});

describe('fit-out', () => {
  it('rolls up deck area, guardrails and accessories from the generated tiers and seats', () => {
    const m = generateVenue(withoutLed(OM_300_FLAGSHIP));
    const tiers = m.objects.filter((o) => o.category === 'SeatingTier');
    const area = tiers.reduce((s, o) => {
      const g = o.geometry as { angle0: number; angle1: number; innerRadius: number; outerRadius: number };
      return s + ((g.angle1 - g.angle0) / 2) * (g.outerRadius ** 2 - g.innerRadius ** 2);
    }, 0);
    expect(m.systems.fitout.deckArea).toBeCloseTo(area, 9);
    expect(m.systems.fitout.accessories).toBe(m.seats.length);
    const rails = m.objects.filter((o) => o.category === 'Guardrail');
    expect(rails.length).toBeGreaterThan(0);
    expect(rails.reduce((s, o) => s + Number(o.metadata.length_m), 0)).toBeCloseTo(m.systems.fitout.guardrailLength, 2);
  });

  it('premium fit-out costs more than standard for the same geometry', () => {
    const std = withoutLed(cloneConfig(OM_300_FLAGSHIP));
    std.fitout = { riserDeck: 'deck-ply-steel', guardrail: 'rail-steel', seatAccessory: 'acc-cupholder' };
    expect(generateVenue(std).systems.fitout.cost).toBeLessThan(generateVenue(withoutLed(OM_300_FLAGSHIP)).systems.fitout.cost);
    expect(generateVenue(std).systems.fitout.deckArea).toBe(generateVenue(withoutLed(OM_300_FLAGSHIP)).systems.fitout.deckArea);
  });

  it('rejects unknown items, tiers, densities and audio products', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.fitout.guardrail = 'deck-ply-steel';
    c.systems.lighting.tier = 'gold' as Tier;
    c.systems.audio.scale = 3;
    c.systems.audio.product = 'nope';
    const codes = validateConfig(c).filter((i) => i.severity === 'error').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['unknown-fitout', 'system-tier', 'system-scale', 'unknown-audio']));
  });

  it('opens Round 05 files with every system off and no new geometry beyond guardrails', () => {
    const legacy = cloneConfig(OM_300_FLAGSHIP) as Partial<VenueConfiguration>;
    delete legacy.fitout;
    delete legacy.systems;
    const c = normalizeConfig(legacy as VenueConfiguration);
    expect(Object.values(c.systems).every((s) => !s.enabled)).toBe(true);
    const m = generateVenue(withoutLed(c));
    expect(m.objects.some((o) => o.metadata.system)).toBe(false);
  });
});
