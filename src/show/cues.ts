/**
 * Cue list (Round 09). A cue starts at a bar and fades from the previous cue's look over `fadeBars`.
 * The list loops after its length. Pure functions: the render loop calls `lookAt` every frame.
 */
import { hexToRgb, type ShowPreset } from './presets';

export type LightMode = 'follow' | 'palette' | 'off';

/** Everything a cue sets. Numbers fade; the video crossfades; the lighting mode switches halfway. */
export interface ShowLook {
  video: string;
  palette: string[];
  lights: LightMode;
  pulse: number;
  haze: number;
  intensity: number;
}

export interface Cue {
  id: string;
  name: string;
  /** Start bar (0-based, 4/4). */
  bar: number;
  fadeBars: number;
  look: ShowLook;
}

/** The look at a moment: blended numbers and palette, plus the two videos and their mix. */
export interface LiveLook {
  cueIndex: number;
  video: string;
  /** Video being faded from (equal to `video` when no fade is running). */
  fromVideo: string;
  /** 0 = fully `fromVideo`, 1 = fully `video`. */
  mix: number;
  palette: [number, number, number][];
  lights: LightMode;
  pulse: number;
  haze: number;
  intensity: number;
}

export const sortCues = (cues: Cue[]) => [...cues].sort((a, b) => a.bar - b.bar);

/** Bars before the list loops: eight bars after the last cue starts (at least eight). */
export const showLength = (cues: Cue[]) => (cues.length ? Math.max(8, Math.max(...cues.map((c) => c.bar)) + 8) : 8);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const PALETTE_SIZE = 3;
const paletteRgb = (p: string[]) => Array.from({ length: PALETTE_SIZE }, (_, i) => hexToRgb(p[i % p.length] ?? '#ffffff'));

export function blendLooks(a: ShowLook, b: ShowLook, t: number): Omit<LiveLook, 'cueIndex'> {
  const pa = paletteRgb(a.palette);
  const pb = paletteRgb(b.palette);
  return {
    video: b.video,
    fromVideo: a.video,
    mix: a.video === b.video ? 1 : t,
    palette: pa.map((c, i) => [lerp(c[0], pb[i][0], t), lerp(c[1], pb[i][1], t), lerp(c[2], pb[i][2], t)] as [number, number, number]),
    lights: t < 0.5 ? a.lights : b.lights,
    pulse: lerp(a.pulse, b.pulse, t),
    haze: lerp(a.haze, b.haze, t),
    intensity: lerp(a.intensity, b.intensity, t),
  };
}

/**
 * The look at `bar` (fractional, from the show start). Before the first cue the first cue holds;
 * the list loops after `showLength`, and the first cue fades in from the last one on each loop.
 */
export function lookAt(cuesIn: Cue[], bar: number): LiveLook | null {
  const cues = sortCues(cuesIn);
  if (!cues.length) return null;
  const len = showLength(cues);
  const b = ((bar % len) + len) % len;
  let i = -1;
  for (let k = 0; k < cues.length; k++) if (cues[k].bar <= b) i = k;
  if (i < 0) return { cueIndex: 0, ...blendLooks(cues[0].look, cues[0].look, 1) };
  const cur = cues[i];
  // Looping back to the first cue fades from the last; on the very first pass nothing came before.
  const prev = i > 0 ? cues[i - 1] : bar >= len ? cues[cues.length - 1] : cur;
  const t = cur.fadeBars > 0 ? Math.min(1, (b - cur.bar) / cur.fadeBars) : 1;
  return { cueIndex: i, ...blendLooks(prev.look, cur.look, t) };
}

/** Show time (s) at the start of a bar. */
export const barTime = (bar: number, tempo: { bpm: number; offset: number }) => tempo.offset + (bar * 4 * 60) / tempo.bpm;

let n = 0;
export const cueId = () => `cue-${Date.now().toString(36)}-${(n++).toString(36)}`;

/**
 * A six-part cinematic arc over 44 bars for a show preset: a near-dark Intro, a long Build, a hard-cut
 * Drop to the preset's contrast look, a Breakdown back to the home look, a Final hit and a long Outro.
 */
export function presetCues(p: ShowPreset): Cue[] {
  const base: ShowLook = { video: p.video, palette: p.palette, lights: 'follow', pulse: 0.6, haze: 0.4, intensity: 1 };
  if (p.id === 'calibration') return [{ id: 'cue-1', name: 'Calibration', bar: 0, fadeBars: 0, look: { ...base, lights: 'palette', pulse: 0, haze: 0.1 } }];
  const hit: ShowLook = { ...base, video: p.drop, palette: [...p.palette.slice(1), p.palette[0]], pulse: 1, haze: 0.85, intensity: 1.25 };
  return [
    { id: 'cue-1', name: 'Intro', bar: 0, fadeBars: 0, look: { ...base, pulse: 0.1, haze: 0.3, intensity: 0.45 } },
    { id: 'cue-2', name: 'Build', bar: 8, fadeBars: 6, look: { ...base, pulse: 0.55, haze: 0.55, intensity: 0.9 } },
    { id: 'cue-3', name: 'Drop', bar: 16, fadeBars: 0, look: hit },
    { id: 'cue-4', name: 'Breakdown', bar: 24, fadeBars: 2, look: { ...base, pulse: 0.25, haze: 0.6, intensity: 0.6 } },
    { id: 'cue-5', name: 'Final', bar: 28, fadeBars: 0, look: { ...hit, intensity: 1.35 } },
    { id: 'cue-6', name: 'Outro', bar: 36, fadeBars: 4, look: { ...base, pulse: 0.1, haze: 0.35, intensity: 0.35 } },
  ];
}
