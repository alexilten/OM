/**
 * The show saved with each alternative (Round 09): small, versioned JSON. Uploaded files are never
 * stored, only their names, so a reopened show asks for the file again and falls back to its preset.
 */
import { sortCues, type Cue, type LightMode } from './cues';
import { MOD_CURVES, MOD_SOURCES, MOD_TARGETS, type ModRoute } from './modulation';
import { SOUNDSCAPES, VIDEO_PRESETS } from './presets';
import type { MappingMode } from './timing';

export interface ShowDefinition {
  version: 1;
  presetId: string | null;
  /** Generated look id (also the fallback when the uploaded video is missing). */
  video: string;
  videoFile?: string;
  mapping: MappingMode;
  soundscape: string;
  audioFile?: string;
  bpm: number;
  offset: number;
  palette: string[];
  lights: LightMode;
  pulse: number;
  haze: number;
  intensity: number;
  /** Cues drive the look while playing. */
  cuesOn: boolean;
  cues: Cue[];
  matrix: ModRoute[];
}

const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
const oneOf = <T extends string>(x: unknown, ok: readonly T[], d: T): T => (ok.includes(x as T) ? (x as T) : d);
const HEX = /^#[0-9a-f]{6}$/i;
const palette = (x: unknown, d: string[]) => (Array.isArray(x) && x.length && x.every((c) => typeof c === 'string' && HEX.test(c)) ? (x as string[]).slice(0, 6) : d);
const LIGHTS = ['follow', 'palette', 'off'] as const;
const VIDEOS = VIDEO_PRESETS.map((v) => v.id);

/** Reads a saved show defensively: unknown ids fall back, numbers are clamped, bad cues and routes dropped. */
export function normalizeShow(raw: unknown): ShowDefinition | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const video = oneOf(s.video, VIDEOS, 'nebula');
  const pal = palette(s.palette, ['#3b5bdb', '#7048e8', '#15aabf']);
  const cues = Array.isArray(s.cues)
    ? (s.cues as Record<string, unknown>[])
        .filter((c) => c && typeof c === 'object' && c.look && typeof c.look === 'object')
        .map((c, k): Cue => {
          const l = c.look as Record<string, unknown>;
          return {
            id: typeof c.id === 'string' ? c.id : `cue-${k + 1}`,
            name: typeof c.name === 'string' ? c.name.slice(0, 40) : `Cue ${k + 1}`,
            bar: Math.round(num(c.bar, 0, 999, 0)),
            fadeBars: num(c.fadeBars, 0, 32, 0),
            look: { video: oneOf(l.video, VIDEOS, video), palette: palette(l.palette, pal), lights: oneOf(l.lights, LIGHTS, 'follow'), pulse: num(l.pulse, 0, 1, 0.6), haze: num(l.haze, 0, 1, 0.4), intensity: num(l.intensity, 0.2, 1.5, 1) },
          };
        })
    : [];
  const matrix = Array.isArray(s.matrix)
    ? (s.matrix as Record<string, unknown>[])
        .filter((r) => r && MOD_SOURCES.some((x) => x.id === r.source) && MOD_TARGETS.some((x) => x.id === r.target))
        .map(
          (r, k): ModRoute => ({
            id: typeof r.id === 'string' ? r.id : `mod-${k + 1}`,
            source: r.source as ModRoute['source'],
            target: r.target as ModRoute['target'],
            amount: num(r.amount, -1, 1, 0.5),
            curve: oneOf(r.curve, MOD_CURVES.map((c) => c.id), 'linear'),
          }),
        )
    : [];
  return {
    version: 1,
    presetId: typeof s.presetId === 'string' ? s.presetId : null,
    video,
    ...(typeof s.videoFile === 'string' ? { videoFile: s.videoFile } : {}),
    mapping: oneOf(s.mapping, ['canvas', 'equirect', 'dome'] as const, 'canvas'),
    soundscape: oneOf(s.soundscape, SOUNDSCAPES.map((a) => a.id), 'drone'),
    ...(typeof s.audioFile === 'string' ? { audioFile: s.audioFile } : {}),
    bpm: num(s.bpm, 40, 220, 70),
    offset: num(s.offset, 0, 60, 0),
    palette: pal,
    lights: oneOf(s.lights, LIGHTS, 'follow'),
    pulse: num(s.pulse, 0, 1, 0.6),
    haze: num(s.haze, 0, 1, 0.4),
    intensity: num(s.intensity, 0.2, 1.5, 1),
    cuesOn: s.cuesOn !== false,
    cues: sortCues(cues),
    matrix,
  };
}
