/**
 * Modulation matrix (Round 09): plain data routes from show sources (beat, audio bands, screen colour)
 * to targets (screen, lights, haze, haptics). Pure, so the same evaluation runs in tests.
 */

export type ModSource = 'beat' | 'bar' | 'bass' | 'mid' | 'high' | 'rms' | 'brightness' | 'warmth';
export type ModTarget = 'screen.brightness' | 'screen.speed' | 'lights.intensity' | 'lights.strobe' | 'lights.sweep' | 'haze' | 'haptics';
export type ModCurve = 'linear' | 'squared' | 'sqrt' | 'invert';

export interface ModRoute {
  id: string;
  source: ModSource;
  target: ModTarget;
  /** −1 to 1. */
  amount: number;
  curve: ModCurve;
}

export const MOD_SOURCES: { id: ModSource; label: string; tip: string }[] = [
  { id: 'beat', label: 'Beat', tip: 'Pulse on each beat (already flash-limited).' },
  { id: 'bar', label: 'Bar', tip: 'Pulse on the first beat of each bar.' },
  { id: 'bass', label: 'Bass', tip: 'Audio energy 20–150 Hz.' },
  { id: 'mid', label: 'Mids', tip: 'Audio energy 150 Hz–2 kHz.' },
  { id: 'high', label: 'Highs', tip: 'Audio energy 2–10 kHz.' },
  { id: 'rms', label: 'Loudness', tip: 'Overall audio level.' },
  { id: 'brightness', label: 'Screen brightness', tip: 'Average luminance of the content.' },
  { id: 'warmth', label: 'Screen warmth', tip: 'Red versus blue balance of the content.' },
];

export const MOD_TARGETS: { id: ModTarget; label: string; tip: string }[] = [
  { id: 'screen.brightness', label: 'Screen brightness', tip: 'Scales the media surface.' },
  { id: 'screen.speed', label: 'Look speed', tip: 'Speeds up or slows the generated looks.' },
  { id: 'lights.intensity', label: 'Light intensity', tip: 'Scales every beam.' },
  { id: 'lights.strobe', label: 'Strobe', tip: 'White hits on the beat above half level, never more than 3 per second.' },
  { id: 'lights.sweep', label: 'Beam sweep', tip: 'Moves the beams side to side.' },
  { id: 'haze', label: 'Haze', tip: 'Adds to the haze level.' },
  { id: 'haptics', label: 'Haptic seats', tip: 'Drives the seat transducers (shown as a glow under the seats).' },
];

export const MOD_CURVES: { id: ModCurve; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'squared', label: 'Punchy' },
  { id: 'sqrt', label: 'Soft' },
  { id: 'invert', label: 'Inverted' },
];

export type SourceValues = Record<ModSource, number>;
export type TargetValues = Record<ModTarget, number>;

export const ZERO_TARGETS: TargetValues = { 'screen.brightness': 0, 'screen.speed': 0, 'lights.intensity': 0, 'lights.strobe': 0, 'lights.sweep': 0, haze: 0, haptics: 0 };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function shape(x: number, curve: ModCurve): number {
  const v = clamp(x, 0, 1);
  return curve === 'squared' ? v * v : curve === 'sqrt' ? Math.sqrt(v) : curve === 'invert' ? 1 - v : v;
}

/** Sum of every route into each target, clamped to −1…1. */
export function evaluateMatrix(routes: ModRoute[], src: SourceValues): TargetValues {
  const out: TargetValues = { ...ZERO_TARGETS };
  for (const r of routes) out[r.target] += clamp(r.amount, -1, 1) * shape(src[r.source], r.curve);
  for (const k of Object.keys(out) as ModTarget[]) out[k] = clamp(out[k], -1, 1);
  return out;
}

/** Relative luminance (Rec. 709) and a 0–1 warmth (red over blue) of a linear RGB colour. */
export const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const warmth = (c: readonly number[]) => clamp(0.5 + (c[0] - c[2]) * 0.5, 0, 1);

let n = 0;
export const routeId = () => `mod-${Date.now().toString(36)}-${(n++).toString(36)}`;
const r = (id: string, source: ModSource, target: ModTarget, amount: number, curve: ModCurve = 'linear'): ModRoute => ({ id, source, target, amount, curve });

/** A sensible starting matrix: beat drives the lights, bass the screen and seats, loudness the haze. */
export const DEFAULT_MATRIX: ModRoute[] = [
  r('m1', 'beat', 'lights.intensity', 0.6),
  r('m2', 'bass', 'screen.brightness', 0.25, 'squared'),
  r('m3', 'bass', 'haptics', 0.9, 'squared'),
  r('m4', 'rms', 'haze', 0.3, 'sqrt'),
  r('m5', 'high', 'lights.sweep', 0.4),
];

/** Per-preset matrices; presets not listed use the default. */
export const PRESET_MATRICES: Record<string, ModRoute[]> = {
  // Weight: the bass moves the room (haze, seats, screen), the bar start hits the lights.
  monolith: [r('m1', 'bass', 'haze', 0.7, 'sqrt'), r('m2', 'bass', 'haptics', 1, 'squared'), r('m3', 'bass', 'screen.brightness', 0.35, 'squared'), r('m4', 'bar', 'lights.intensity', 0.8, 'squared'), r('m5', 'rms', 'lights.sweep', 0.2)],
  'event-horizon': [r('m1', 'beat', 'lights.intensity', 0.4), r('m2', 'bass', 'haptics', 0.9, 'squared'), r('m3', 'rms', 'screen.speed', 0.4), r('m4', 'mid', 'screen.brightness', 0.3), r('m5', 'rms', 'haze', 0.4, 'sqrt')],
  tesseract: [r('m1', 'beat', 'lights.intensity', 0.5), r('m2', 'high', 'lights.sweep', 0.6), r('m3', 'mid', 'screen.speed', 0.5), r('m4', 'bass', 'haptics', 0.8, 'squared')],
  'machine-heart': [r('m1', 'beat', 'lights.intensity', 0.9, 'squared'), r('m2', 'bar', 'lights.strobe', 0.95), r('m3', 'bass', 'screen.brightness', 0.5, 'squared'), r('m4', 'high', 'screen.speed', 0.7), r('m5', 'bass', 'haptics', 1, 'squared'), r('m6', 'mid', 'lights.sweep', 0.6)],
  starman: [r('m1', 'beat', 'lights.intensity', 0.8), r('m2', 'bar', 'lights.strobe', 0.8), r('m3', 'high', 'lights.sweep', 0.7), r('m4', 'mid', 'screen.speed', 0.4), r('m5', 'bass', 'haptics', 0.7, 'squared')],
  'sand-sea': [r('m1', 'bass', 'haze', 0.8, 'sqrt'), r('m2', 'bass', 'haptics', 0.9, 'squared'), r('m3', 'beat', 'lights.intensity', 0.5), r('m4', 'high', 'screen.speed', 0.4)],
  logogram: [r('m1', 'rms', 'screen.speed', 0.5, 'sqrt'), r('m2', 'bass', 'haptics', 0.8, 'squared'), r('m3', 'rms', 'haze', 0.5, 'sqrt'), r('m4', 'mid', 'lights.intensity', 0.4)],
  calibration: [],
};
export const matrixFor = (presetId: string | null) => (presetId && PRESET_MATRICES[presetId] ? PRESET_MATRICES[presetId] : DEFAULT_MATRIX).map((x) => ({ ...x }));
