/**
 * Show timing (Round 08): tempo, beat phase, tap tempo, flash safety and BPM detection. Pure functions,
 * no Web Audio, so they run in tests and in a Worker.
 */

export interface Tempo {
  bpm: number;
  /** Time of a downbeat (s on the show clock). */
  offset: number;
}

export interface BeatPhase {
  /** Whole beats since the offset. */
  beat: number;
  /** 0 at the beat, rising to 1 just before the next. */
  phase: number;
  /** Beat within a 4/4 bar (0–3). */
  inBar: number;
}

export function beatPhase(t: number, tempo: Tempo): BeatPhase {
  const x = ((t - tempo.offset) * tempo.bpm) / 60;
  const beat = Math.floor(x);
  return { beat, phase: x - beat, inBar: ((beat % 4) + 4) % 4 };
}

/** A decaying pulse at the start of each beat: 1 on the beat, about 0 halfway through. */
export const pulse = (phase: number, sharpness = 6) => Math.exp(-phase * sharpness);

/** Tempo from tap times (s): median interval of the last eight taps; undefined until two taps agree. */
export function tapTempo(taps: number[]): Tempo | undefined {
  const recent = taps.slice(-8);
  const gaps = recent.slice(1).map((t, i) => t - recent[i]).filter((g) => g > 0.25 && g < 2);
  if (gaps.length < 1) return undefined;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { bpm: +(60 / median).toFixed(1), offset: recent[recent.length - 1] };
}

/** Photosensitivity: at most 3 flashes per second (WCAG 2.3.1). Largest of 4, 2, 1 pulses per beat that stays under it. */
export const MAX_FLASHES_PER_SECOND = 3;
export function safeSubdivision(bpm: number, wanted = 4): number {
  for (const s of [4, 2, 1]) if (s <= wanted && (bpm / 60) * s <= MAX_FLASHES_PER_SECOND) return s;
  return 0;
}

/**
 * Tempo detection: spectral-flux-free energy onset envelope, autocorrelated over 60–180 BPM, weighted
 * gently towards 120 BPM (the octave errors every detector makes), then the beat offset that lines the
 * grid up with the strongest onsets.
 */
export function detectBpm(samples: Float32Array, sampleRate: number, range: [number, number] = [60, 180]): Tempo & { confidence: number } {
  const hop = 512;
  const frames = Math.floor(samples.length / hop) - 1;
  if (frames < 16) return { bpm: 120, offset: 0, confidence: 0 };
  const energy = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let e = 0;
    for (let k = i * hop; k < i * hop + 2 * hop && k < samples.length; k++) e += samples[k] * samples[k];
    energy[i] = Math.log1p(1000 * e);
  }
  const onset = new Float32Array(frames);
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  const mean = onset.reduce((t, x) => t + x, 0) / frames;
  for (let i = 0; i < frames; i++) onset[i] = Math.max(0, onset[i] - mean);

  const fps = sampleRate / hop;
  let best = { bpm: 120, score: -Infinity };
  let total = 0;
  let count = 0;
  for (let bpm = range[0]; bpm <= range[1]; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    let s = 0;
    // Fractional lag: linear interpolation, summed over two and four beats too (steadier peaks).
    for (const mult of [1, 2, 4]) {
      const L = lag * mult;
      const l0 = Math.floor(L);
      const w = L - l0;
      for (let i = 0; i + l0 + 1 < frames; i++) s += onset[i] * (onset[i + l0] * (1 - w) + onset[i + l0 + 1] * w);
    }
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = s * weight;
    total += score;
    count++;
    if (score > best.score) best = { bpm, score };
  }
  // Offset: the phase whose beat frames collect the most onset energy.
  const lag = (60 / best.bpm) * fps;
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let p = 0; p < lag; p++) {
    let sum = 0;
    for (let x = p; x < frames; x += lag) sum += onset[Math.round(x)] ?? 0;
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = p;
    }
  }
  return { bpm: best.bpm, offset: (bestPhase * hop) / sampleRate, confidence: total > 0 ? best.score / (total / count) : 0 };
}

// ─── Content mapping (mirrored in the GLSL) ────────────────────────────────

export type MappingMode = 'canvas' | 'equirect' | 'dome';

/** Texture coordinate for a direction on the sphere (azimuth, elevation in radians). */
export function mapUv(az: number, el: number, mode: MappingMode, bounds: { az0: number; az1: number; el0: number; el1: number }): [number, number] {
  if (mode === 'equirect') return [(az + Math.PI) / (2 * Math.PI), (el + Math.PI / 2) / Math.PI];
  if (mode === 'dome') {
    // Dome master (fisheye): zenith at the centre, the horizon on the rim, forward (+Y) at the bottom.
    const r = (0.5 * (Math.PI / 2 - el)) / (Math.PI / 2);
    return [0.5 + r * Math.sin(az), 0.5 - r * Math.cos(az)];
  }
  return [(az - bounds.az0) / (bounds.az1 - bounds.az0), (el - bounds.el0) / (bounds.el1 - bounds.el0)];
}
