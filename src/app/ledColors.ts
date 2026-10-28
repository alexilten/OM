import { SEAM } from '../engine/led';
import type { LedColor } from './store';

/** Deviation colour scale tops out here (mm); anything beyond reads as the top colour. */
export const DEVIATION_SCALE_MM = 10;

const DEVIATION_STOPS = ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c'];

export const JOINT_CLASSES = [
  { key: 'fine', label: `≤ ${SEAM.fine * 1000} mm`, color: '#1a9850' },
  { key: 'visible', label: `≤ ${SEAM.visible * 1000} mm`, color: '#fee08b' },
  { key: 'open', label: `> ${SEAM.visible * 1000} mm`, color: '#fc8d59' },
  { key: 'fail', label: 'collision or curvature limit', color: '#d73027' },
] as const;

function lerpHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export function deviationColor(mm: number) {
  const t = Math.max(0, Math.min(1, mm / DEVIATION_SCALE_MM)) * (DEVIATION_STOPS.length - 1);
  const i = Math.min(DEVIATION_STOPS.length - 2, Math.floor(t));
  return lerpHex(DEVIATION_STOPS[i], DEVIATION_STOPS[i + 1], t - i);
}

export const DEVIATION_GRADIENT = `linear-gradient(90deg, ${DEVIATION_STOPS.join(', ')})`;

/** Colour of one LED unit from its exported metadata, or undefined for the product colour. */
export function ledUnitColor(meta: Record<string, string | number>, mode: LedColor): string | undefined {
  if (mode === 'deviation') return deviationColor(Number(meta.deviation_mm));
  if (mode === 'joints') {
    if (meta.curvature_ok === 'no' || Number(meta.overlap_max_mm) > SEAM.fine * 1000) return JOINT_CLASSES[3].color;
    const worst = Math.max(Number(meta.gap_max_mm), Number(meta.step_max_mm));
    return worst <= SEAM.fine * 1000 ? JOINT_CLASSES[0].color : worst <= SEAM.visible * 1000 ? JOINT_CLASSES[1].color : JOINT_CLASSES[2].color;
  }
  return undefined;
}
