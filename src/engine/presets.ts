/**
 * Configuration presets (Round 05). Two independent systems, as in the brief:
 *  - size presets set the scale: sphere radius, rows, fan and front row (target seated capacity);
 *  - performance presets set the arrangement: stage, seating focus, media coverage, operating state.
 * A preset is only parameter values: `buildPreset` runs them through the same engine as any edit,
 * and OM 300 × Cinematic reproduces the default flagship exactly. The building is the site, so
 * presets never change it.
 */
import { cloneConfig, OM_300_FLAGSHIP } from './defaults';
import type { VenueConfiguration } from './types';

export interface SizePreset {
  id: string;
  label: string;
  /** Target seated capacity; a conceptual starting point, not a guarantee. */
  target: number;
  description: string;
  radius: number;
  rowCount: number;
  frontRowRadius: number;
  sectionAngleDeg: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'om-150', label: 'OM 150', target: 150, description: 'Intimate: strong immersion, premium seating, compact footprint.', radius: 10, rowCount: 10, frontRowRadius: 3.0, sectionAngleDeg: 130 },
  { id: 'om-300', label: 'OM 300', target: 300, description: 'Flagship: about 300 premium seats, transformable, balanced capacity and experience.', radius: 13, rowCount: 12, frontRowRadius: 4.0, sectionAngleDeg: 130 },
  { id: 'om-400', label: 'OM 400', target: 400, description: 'Expanded: more seats with the media scaled up to keep viewing quality.', radius: 15, rowCount: 12, frontRowRadius: 4.5, sectionAngleDeg: 135 },
];

export interface PerformancePreset {
  id: string;
  label: string;
  description: string;
  /** Applies the arrangement to a configuration already set to a size; `s` = radius / 13 m. */
  apply: (c: VenueConfiguration, s: number, size: SizePreset) => void;
}

const REF_R = 13;

function frontal(c: VenueConfiguration, s: number, size: SizePreset) {
  c.media.azimuthLeftDeg = -110;
  c.media.azimuthRightDeg = 110;
  c.seating.focusY = 5.5 * s;
  c.seating.frontRowRadius = size.frontRowRadius;
  c.seating.rowCount = size.rowCount;
  c.seating.sectionAngleDeg = size.sectionAngleDeg;
  c.seating.aisleCount = 2;
  c.operatingState = 'seated';
}

export const PERFORMANCE_PRESETS: PerformancePreset[] = [
  {
    id: 'cinematic',
    label: 'Cinematic Immersion',
    description: 'Premium seated viewing; a low cinematic stage under the screen.',
    apply: (c, s, size) => {
      frontal(c, s, size);
      c.stage = { ...c.stage, type: 'cinematic', width: 9 * s, depth: 3.2 * s, height: 0.9, centerY: 9 * s };
    },
  },
  {
    id: 'seated-concert',
    label: 'Seated Concert',
    description: 'A deeper concert stage; the fan opens a little wider.',
    apply: (c, s, size) => {
      frontal(c, s, size);
      c.seating.sectionAngleDeg = size.sectionAngleDeg + 10;
      c.stage = { ...c.stage, type: 'concert', width: 11 * s, depth: 4.5 * s, height: 1.0, centerY: 8.4 * s };
    },
  },
  {
    id: 'standing-concert',
    label: 'Standing Concert',
    description: 'The seated-concert venue transformed: seating nested, stage lowered, open floor.',
    apply: (c, s, size) => {
      PERFORMANCE_PRESETS[1].apply(c, s, size);
      c.transformation.enabled = true;
      c.operatingState = 'standing';
    },
  },
  {
    id: 'proscenium',
    label: 'Theatrical Proscenium',
    description: 'A wide, deep stage framed by a narrower screen; a tighter fan facing it.',
    apply: (c, s, size) => {
      frontal(c, s, size);
      c.media.azimuthLeftDeg = -95;
      c.media.azimuthRightDeg = 95;
      c.seating.focusY = 4.5 * s;
      c.seating.sectionAngleDeg = 100;
      c.stage = { ...c.stage, type: 'proscenium', width: 12 * s, depth: 5 * s, height: 1.0, centerY: 7.5 * s };
    },
  },
  {
    id: 'in-the-round',
    label: 'Theater in the Round',
    description: 'Central stage, audience all around, screen all the way round; fewer rows.',
    apply: (c, s, size) => {
      c.media.azimuthLeftDeg = -180;
      c.media.azimuthRightDeg = 180;
      c.seating.focusY = 0;
      c.seating.frontRowRadius = 5.2 * s;
      c.seating.rowCount = Math.max(3, Math.round((size.rowCount * 5) / 12));
      c.seating.sectionAngleDeg = 330;
      c.seating.aisleCount = 4;
      c.stage = { ...c.stage, type: 'central', width: 6 * s, depth: 6 * s, height: 0.9, centerY: 0 };
      c.operatingState = 'seated';
    },
  },
];

export const getSizePreset = (id: string) => SIZE_PRESETS.find((p) => p.id === id);
export const getPerformancePreset = (id: string) => PERFORMANCE_PRESETS.find((p) => p.id === id);

/**
 * Builds a configuration from a size and a performance preset. Everything the presets do not set
 * (seat product, LED system, analysis, transformation details, building) comes from `base`.
 */
export function buildPreset(sizeId: string, performanceId: string, base: VenueConfiguration = OM_300_FLAGSHIP): VenueConfiguration {
  const size = getSizePreset(sizeId);
  const perf = getPerformancePreset(performanceId);
  if (!size || !perf) throw new Error(`Unknown preset ${sizeId} × ${performanceId}`);
  const c = cloneConfig(base);
  const s = size.radius / REF_R;
  c.sphere.radius = size.radius;
  c.floor.mainFloorElevation = +(-1.8 * s).toFixed(4);
  perf.apply(c, s, size);
  c.stage = { ...c.stage, width: +c.stage.width.toFixed(3), depth: +c.stage.depth.toFixed(3), centerY: +c.stage.centerY.toFixed(3) };
  c.seating.focusY = +c.seating.focusY.toFixed(3);
  c.seating.frontRowRadius = +c.seating.frontRowRadius.toFixed(3);
  c.id = `${size.id}-${perf.id}`;
  c.name = `${size.label} / ${perf.label}`;
  c.preset = { size: size.id, performance: perf.id };
  return c;
}

/** The named starting points from the brief, all built from the two preset systems. */
export const VENUE_PRESETS: { id: string; name: string; size: string; performance: string }[] = [
  { id: 'om-150', name: 'OM 150 / Intimate', size: 'om-150', performance: 'cinematic' },
  { id: 'om-300', name: 'OM 300 / Flagship', size: 'om-300', performance: 'cinematic' },
  { id: 'om-400', name: 'OM 400 / Expanded', size: 'om-400', performance: 'cinematic' },
  { id: 'om-standing', name: 'OM Standing / Concert', size: 'om-300', performance: 'standing-concert' },
  { id: 'om-360', name: 'OM 360 / Theater in the Round', size: 'om-300', performance: 'in-the-round' },
];

/** True when the configuration still has exactly the values its preset would give (ignoring id and name). */
export function matchesPreset(c: VenueConfiguration): boolean {
  if (!c.preset || !getSizePreset(c.preset.size) || !getPerformancePreset(c.preset.performance)) return false;
  const p = buildPreset(c.preset.size, c.preset.performance, c);
  const strip = (x: VenueConfiguration) => JSON.stringify({ ...x, id: '', name: '' });
  return strip(p) === strip(c);
}
