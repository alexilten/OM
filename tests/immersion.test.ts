import { describe, expect, it } from 'vitest';
import { fitCapacity } from '../src/engine/capacity';
import { cloneConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { analyzeImmersion, DEFAULT_ANALYSIS, gradeOf, METRIC_INFO, type ImmersionMetricKey } from '../src/engine/immersion';
import { generateVenue } from '../src/engine/model';
import { validateConfig } from '../src/engine/validate';

const KEYS = Object.keys(METRIC_INFO) as ImmersionMetricKey[];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('Immersion analysis', () => {
  const model = generateVenue(OM_300_FLAGSHIP);
  const analysis = analyzeImmersion(model);

  it('scores every seat, and every score is the published weighted sum of its sub-scores', () => {
    expect(analysis.seats.size).toBe(model.seats.length);
    const w = DEFAULT_ANALYSIS.weights;
    const wSum = KEYS.reduce((a, k) => a + w[k], 0);
    for (const a of analysis.seats.values()) {
      for (const k of KEYS) {
        expect(a.subScores[k]).toBeGreaterThanOrEqual(0);
        expect(a.subScores[k]).toBeLessThanOrEqual(1);
      }
      expect(a.score).toBeCloseTo(KEYS.reduce((t, k) => t + a.subScores[k] * w[k], 0) / wSum, 12);
      expect(a.grade).toBe(gradeOf(a.score));
    }
    const counted = Object.values(analysis.gradeCounts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(model.seats.length);
  });

  it('is deterministic', () => {
    const again = analyzeImmersion(generateVenue(OM_300_FLAGSHIP));
    expect(again.average).toBe(analysis.average);
    expect(again.premiumCount).toBe(analysis.premiumCount);
  });

  it('a single weight makes the score equal that sub-score', () => {
    const weights = Object.fromEntries(KEYS.map((k) => [k, k === 'sightline' ? 1 : 0])) as Record<ImmersionMetricKey, number>;
    const only = analyzeImmersion(model, { ...DEFAULT_ANALYSIS, weights });
    for (const a of only.seats.values()) expect(a.score).toBeCloseTo(a.subScores.sightline, 12);
  });

  it('responds logically to geometry', () => {
    // A shallower screen fills less of every seat's field of view.
    const low = cloneConfig(OM_300_FLAGSHIP);
    low.media.elevationUpperDeg = 30;
    const lowA = analyzeImmersion(generateVenue(low));
    const fill = (an: typeof analysis) => mean([...an.seats.values()].map((s) => s.measurements.fieldFill));
    expect(fill(lowA)).toBeLessThan(fill(analysis));

    // A steeper rake clears more heads.
    const steep = cloneConfig(OM_300_FLAGSHIP);
    steep.seating.riserHeight = 0.45;
    const steepA = analyzeImmersion(generateVenue(steep));
    const sl = (an: typeof analysis) => mean([...an.seats.values()].map((s) => s.subScores.sightline));
    expect(sl(steepA)).toBeGreaterThan(sl(analysis));

    // Within the default layout, seats nearer the reference eye point score higher on that metric.
    const seats = [...model.seats].sort((a, b) => a.distanceFromOrigin - b.distanceFromOrigin);
    const near = analysis.seats.get(seats[0].id)!;
    const far = analysis.seats.get(seats[seats.length - 1].id)!;
    expect(near.subScores.originDistance).toBeGreaterThan(far.subScores.originDistance);
  });

  it('names the seat that blocks a sightline, always from a row in front', () => {
    for (const s of model.seats) {
      const a = analysis.seats.get(s.id)!;
      if (!a.blockingSeatId) continue;
      const b = model.seats.find((x) => x.id === a.blockingSeatId)!;
      expect(b.rowIndex).toBeLessThan(s.rowIndex);
    }
  });
});

describe('Capacity target', () => {
  it('reaches a feasible target with a valid layout and no clearance violations', () => {
    const r = fitCapacity(OM_300_FLAGSHIP, 260);
    expect(r.ok).toBe(true);
    expect(validateConfig(r.config!).filter((i) => i.severity === 'error')).toEqual([]);
    const m = generateVenue(r.config!);
    expect(m.seats.length).toBe(r.seats);
    expect(r.seats).toBeGreaterThanOrEqual(260);
    expect(r.seats).toBeLessThanOrEqual(273);
    for (const s of m.seats) expect(s.screenClearance).toBeGreaterThanOrEqual(r.config!.seating.screenClearance - 1e-9);
  });

  it('refuses an impossible target and explains the limit', () => {
    const r = fitCapacity(OM_300_FLAGSHIP, 5000);
    expect(r.ok).toBe(false);
    expect(r.config).toBeUndefined();
    expect(r.message).toMatch(/At most \d+/);
  });
});
