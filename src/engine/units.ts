/**
 * Display units. Geometry is always stored and generated in metres; feet exist only at the
 * input/output boundary so switching units can never rescale the model.
 */
export type DisplayUnit = 'm' | 'ft';

export const M_PER_FT = 0.3048;

export const toDisplay = (metres: number, u: DisplayUnit) => (u === 'm' ? metres : metres / M_PER_FT);
export const fromDisplay = (value: number, u: DisplayUnit) => (u === 'm' ? value : value * M_PER_FT);

export function formatLength(metres: number, u: DisplayUnit, digits = 2): string {
  if (u === 'm') return `${metres.toFixed(digits)} m`;
  const ft = metres / M_PER_FT;
  return `${ft.toFixed(digits)} ft`;
}

export function formatArea(m2: number, u: DisplayUnit): string {
  return u === 'm' ? `${m2.toFixed(1)} m²` : `${(m2 / (M_PER_FT * M_PER_FT)).toFixed(0)} ft²`;
}
