import { describe, expect, it } from 'vitest';
import { SHOW_PRESETS, SOUNDSCAPES, VIDEO_PRESETS, hexToRgb } from '../src/show/presets';
import { MAX_FLASHES_PER_SECOND, beatPhase, detectBpm, mapUv, pulse, safeSubdivision, tapTempo } from '../src/show/timing';

/** A click track: short decaying 1 kHz bursts on every beat, with a little noise. */
function clickTrack(bpm: number, seconds: number, offset = 0, sampleRate = 22050) {
  const out = new Float32Array(seconds * sampleRate);
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = ((seed / 2147483647) * 2 - 1) * 0.01;
  }
  for (let t = offset; t < seconds; t += 60 / bpm) {
    const s0 = Math.round(t * sampleRate);
    for (let k = 0; k < 0.03 * sampleRate && s0 + k < out.length; k++) out[s0 + k] += Math.sin((2 * Math.PI * 1000 * k) / sampleRate) * Math.exp(-k / (0.006 * sampleRate));
  }
  return { samples: out, sampleRate };
}

describe('show timing', () => {
  it('detects the tempo of click tracks', () => {
    for (const bpm of [90, 120, 140]) {
      const { samples, sampleRate } = clickTrack(bpm, 30);
      const r = detectBpm(samples, sampleRate);
      expect(Math.abs(r.bpm - bpm)).toBeLessThanOrEqual(1);
      expect(r.confidence).toBeGreaterThan(1);
    }
  });

  it('finds the downbeat offset', () => {
    const { samples, sampleRate } = clickTrack(120, 20, 0.2);
    const r = detectBpm(samples, sampleRate);
    const period = 60 / r.bpm;
    const err = Math.abs(((r.offset - 0.2 + period / 2) % period) - period / 2);
    expect(err).toBeLessThan(0.05);
  });

  it('beat phase and pulse', () => {
    const p = beatPhase(2.25, { bpm: 120, offset: 0 });
    expect(p.beat).toBe(4);
    expect(p.phase).toBeCloseTo(0.5);
    expect(p.inBar).toBe(0);
    expect(beatPhase(-0.25, { bpm: 120, offset: 0 }).inBar).toBe(3);
    expect(pulse(0)).toBe(1);
    expect(pulse(0.5)).toBeLessThan(0.06);
  });

  it('tap tempo uses the median interval', () => {
    expect(tapTempo([1])).toBeUndefined();
    const taps = [0, 0.5, 1.0, 1.52, 2.0, 2.5];
    const t = tapTempo(taps)!;
    expect(t.bpm).toBeCloseTo(120, 0);
    expect(t.offset).toBe(2.5);
  });

  it('never pulses faster than 3 flashes per second', () => {
    for (let bpm = 40; bpm <= 220; bpm += 1) {
      const s = safeSubdivision(bpm);
      expect((bpm / 60) * s).toBeLessThanOrEqual(MAX_FLASHES_PER_SECOND);
    }
    expect(safeSubdivision(60)).toBe(2);
    expect(safeSubdivision(124)).toBe(1);
    expect(safeSubdivision(200)).toBe(0);
  });
});

describe('content mapping', () => {
  const b = { az0: -1, az1: 1, el0: 0, el1: 1 };
  it('canvas fits the screen bounds', () => {
    expect(mapUv(-1, 0, 'canvas', b)).toEqual([0, 0]);
    expect(mapUv(0, 0.5, 'canvas', b)).toEqual([0.5, 0.5]);
  });
  it('equirect places forward at the centre', () => {
    const [u, v] = mapUv(0, 0, 'equirect', b);
    expect(u).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(0.5);
    expect(mapUv(0, Math.PI / 2, 'equirect', b)[1]).toBeCloseTo(1);
  });
  it('dome master: zenith in the centre, forward horizon at the bottom', () => {
    const z = mapUv(0.7, Math.PI / 2, 'dome', b);
    expect(z[0]).toBeCloseTo(0.5);
    expect(z[1]).toBeCloseTo(0.5);
    const f = mapUv(0, 0, 'dome', b);
    expect(f[0]).toBeCloseTo(0.5);
    expect(f[1]).toBeCloseTo(0);
  });
});

describe('show presets', () => {
  it('reference existing looks and soundscapes', () => {
    const ids = new Set(SHOW_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(SHOW_PRESETS.length);
    for (const p of SHOW_PRESETS) {
      expect(VIDEO_PRESETS.some((v) => v.id === p.video)).toBe(true);
      expect(SOUNDSCAPES.some((s) => s.id === p.soundscape)).toBe(true);
      expect(p.palette.length).toBeGreaterThan(0);
      for (const c of p.palette) expect(hexToRgb(c).every((x) => x >= 0 && x <= 1)).toBe(true);
    }
  });
});
