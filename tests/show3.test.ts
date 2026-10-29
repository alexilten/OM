import { describe, expect, it } from 'vitest';
import { ARC_BARS, partAt } from '../src/show/audio';
import { presetCues, showLength } from '../src/show/cues';
import { normalizeShow } from '../src/show/definition';
import { matrixFor, DEFAULT_MATRIX } from '../src/show/modulation';
import { SHOW_PRESETS, SOUNDSCAPES, VIDEO_PRESETS } from '../src/show/presets';

describe('Round 11 show content', () => {
  const current = SHOW_PRESETS.filter((p) => p.id !== 'calibration');
  it('every preset uses current looks and soundscapes, never the legacy set', () => {
    for (const p of SHOW_PRESETS) {
      const v = VIDEO_PRESETS.find((x) => x.id === p.video);
      const a = SOUNDSCAPES.find((x) => x.id === p.soundscape);
      const d = VIDEO_PRESETS.find((x) => x.id === p.drop);
      expect(v && !v.legacy, p.id).toBe(true);
      expect(a && !a.legacy, p.id).toBe(true);
      expect(d && !d.legacy, p.id).toBe(true);
    }
  });
  it('each preset drops to a contrasting look and has its own matrix', () => {
    for (const p of current) {
      if (p.id !== 'machine-heart') expect(p.drop, p.id).not.toBe(p.video);
      expect(matrixFor(p.id), p.id).not.toEqual(DEFAULT_MATRIX);
    }
  });
  it('looks have unique shader indices and the legacy looks stay loadable', () => {
    const looks = VIDEO_PRESETS.map((v) => v.look);
    expect(new Set(looks).size).toBe(looks.length);
    expect(normalizeShow({ video: 'nebula' })!.video).toBe('nebula');
    expect(normalizeShow({ video: 'cathedral' })!.video).toBe('cathedral');
  });
  it('the soundscape arc lands on the same bars as the cues', () => {
    const cues = presetCues(current[0]);
    expect(showLength(cues)).toBe(ARC_BARS);
    const parts = cues.map((c) => partAt(c.bar));
    expect(parts).toEqual(['intro', 'build', 'drop', 'break', 'final', 'outro']);
    expect(partAt(ARC_BARS + 17)).toBe('drop');
    expect(partAt(-1)).toBe('outro');
  });
});
