import { describe, expect, it } from 'vitest';
import { blendLooks, lookAt, presetCues, showLength, barTime, type Cue } from '../src/show/cues';
import { normalizeShow } from '../src/show/definition';
import { DEFAULT_MATRIX, evaluateMatrix, matrixFor, shape, type SourceValues } from '../src/show/modulation';
import { SHOW_PRESETS, VIDEO_PRESETS, getShowPreset } from '../src/show/presets';
import { FlashGuard, guardRed } from '../src/show/safety';
import { OM_300_FLAGSHIP, cloneConfig } from '../src/engine/defaults';
import { parseProject, PROJECT_SCHEMA } from '../src/engine/project';

const zero: SourceValues = { beat: 0, bar: 0, bass: 0, mid: 0, high: 0, rms: 0, brightness: 0, warmth: 0 };

describe('modulation matrix', () => {
  it('shapes and sums routes, clamped to ±1', () => {
    expect(shape(0.5, 'squared')).toBe(0.25);
    expect(shape(0.25, 'sqrt')).toBe(0.5);
    expect(shape(0.2, 'invert')).toBeCloseTo(0.8);
    const out = evaluateMatrix(
      [
        { id: 'a', source: 'bass', target: 'haze', amount: 0.8, curve: 'linear' },
        { id: 'b', source: 'rms', target: 'haze', amount: 0.8, curve: 'linear' },
        { id: 'c', source: 'beat', target: 'lights.intensity', amount: -0.5, curve: 'linear' },
      ],
      { ...zero, bass: 1, rms: 1, beat: 1 },
    );
    expect(out.haze).toBe(1);
    expect(out['lights.intensity']).toBe(-0.5);
    expect(out.haptics).toBe(0);
  });
  it('silence and no beat leave every target at rest with the default matrix', () => {
    const out = evaluateMatrix(DEFAULT_MATRIX, zero);
    expect(Object.values(out).every((v) => v === 0)).toBe(true);
  });
  it('gives every preset its own copy of a matrix', () => {
    const a = matrixFor('machine-heart');
    a[0].amount = -1;
    expect(matrixFor('machine-heart')[0].amount).not.toBe(-1);
    expect(matrixFor('machine-heart').some((r) => r.target === 'lights.strobe')).toBe(true);
  });
});

describe('cue list', () => {
  const p = getShowPreset('monolith')!;
  const cues = presetCues(p);
  it('builds a six-part arc for every preset, with real looks', () => {
    for (const sp of SHOW_PRESETS) {
      const cs = presetCues(sp);
      expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) expect(VIDEO_PRESETS.some((v) => v.id === c.look.video)).toBe(true);
    }
    expect(cues.map((c) => c.name)).toEqual(['Intro', 'Build', 'Drop', 'Breakdown', 'Final', 'Outro']);
    expect(showLength(cues)).toBe(44);
  });
  it('holds, fades and crossfades the video between cues', () => {
    expect(lookAt(cues, 4)!.cueIndex).toBe(0);
    const mid = lookAt(cues, 11)!; // Build fades over bars 8–14
    expect(mid.cueIndex).toBe(1);
    expect(mid.intensity).toBeCloseTo(0.45 + (0.9 - 0.45) * 0.5);
    const drop = lookAt(cues, 16.01)!; // Drop is a hard cut to the preset's contrast look
    expect(drop.video).toBe('sandsea');
    expect(drop.mix).toBe(1);
    expect(drop.intensity).toBeCloseTo(1.25);
    expect(lookAt(cues, 28.5)!.intensity).toBeCloseTo(1.35);
  });
  it('loops after its length', () => {
    expect(lookAt(cues, 44 + 10)!.cueIndex).toBe(1);
    expect(lookAt(cues, 43)!.cueIndex).toBe(5);
  });
  it('blends palettes and switches the lighting mode halfway', () => {
    const a = { video: 'nebula', palette: ['#000000'], lights: 'follow' as const, pulse: 0, haze: 0, intensity: 1 };
    const b = { ...a, palette: ['#ffffff'], lights: 'off' as const };
    expect(blendLooks(a, b, 0.25).palette[0][0]).toBeCloseTo(0.25);
    expect(blendLooks(a, b, 0.25).lights).toBe('follow');
    expect(blendLooks(a, b, 0.75).lights).toBe('off');
  });
  it('converts bars to show time', () => {
    expect(barTime(8, { bpm: 120, offset: 0.5 })).toBeCloseTo(16.5);
  });
  it('an empty list has no look', () => {
    expect(lookAt([] as Cue[], 3)).toBeNull();
  });
});

describe('flash safety', () => {
  it('never lets more than three flashes into any second', () => {
    const g = new FlashGuard();
    const accepted: number[] = [];
    for (let t = 0; t < 10; t += 0.1) if (g.allow(t)) accepted.push(t);
    for (const t of accepted) expect(accepted.filter((x) => x >= t && x < t + 1 - 1e-9).length).toBeLessThanOrEqual(3);
    expect(accepted.length).toBeGreaterThan(20);
  });
  it('softens saturated red, leaves other colours alone', () => {
    const r = guardRed([1, 0, 0]);
    expect(r[0] / (r[0] + r[1] + r[2])).toBeLessThan(0.8);
    expect(guardRed([0.2, 0.6, 0.9])).toEqual([0.2, 0.6, 0.9]);
  });
});

describe('saved show', () => {
  it('normalises bad input and keeps good input', () => {
    expect(normalizeShow(null)).toBeUndefined();
    const s = normalizeShow({ video: 'nope', bpm: 999, cues: [{ name: 'A', bar: 4, fadeBars: 2, look: { video: 'aurora', pulse: 3 } }, 'junk'], matrix: [{ source: 'bass', target: 'haze', amount: 5 }, { source: 'x', target: 'haze' }] })!;
    expect(s.video).toBe('monolith');
    expect(s.bpm).toBe(220);
    expect(s.cues).toHaveLength(1);
    expect(s.cues[0].look.video).toBe('aurora');
    expect(s.cues[0].look.pulse).toBe(1);
    expect(s.matrix).toHaveLength(1);
    expect(s.matrix[0].amount).toBe(1);
  });
  it('survives a project save and reopen with its alternative', () => {
    const c = cloneConfig(OM_300_FLAGSHIP);
    c.show = normalizeShow({ presetId: 'machine-heart', video: 'machine', bpm: 124, cues: presetCues(getShowPreset('machine-heart')!), matrix: matrixFor('machine-heart') });
    const reopened = parseProject(JSON.parse(JSON.stringify({ schema: PROJECT_SCHEMA, activeId: c.id, alternatives: [c] }))).project;
    expect(normalizeShow(reopened.alternatives[0].show)).toEqual(c.show);
  });
});
