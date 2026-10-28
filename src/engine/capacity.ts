/**
 * Capacity target: searches row count and fan angle (the two parameters that add seats without
 * changing seat product, spacing or the sphere) for layouts that reach a requested seated capacity.
 * Seats still go through the normal generator, so every candidate is physically valid. Among the
 * candidates, the one with the best average immersion score wins. When the
 * target is out of reach, the result says what limits it instead of forcing a layout.
 */
import { getSeatingProduct } from '../library/seating';
import { cloneConfig } from './defaults';
import { analyzeImmersion, DEFAULT_ANALYSIS, type AnalysisSettings } from './immersion';
import { generateVenue } from './model';
import { generateSeating } from './seating';
import type { VenueConfiguration } from './types';
import { validateConfig } from './validate';

export interface CapacityResult {
  ok: boolean;
  config?: VenueConfiguration;
  seats: number;
  message: string;
}

const MIN_ANGLE = 40;
const MAX_ANGLE = 300;

function seatsFor(base: VenueConfiguration, rows: number, angle: number): number {
  const c = cloneConfig(base);
  c.seating.rowCount = rows;
  c.seating.sectionAngleDeg = angle;
  return generateSeating(c).seats.length;
}

export function fitCapacity(base: VenueConfiguration, target: number, settings: AnalysisSettings = DEFAULT_ANALYSIS): CapacityResult {
  if (!Number.isFinite(target) || target < 1) return { ok: false, seats: 0, message: 'Enter a target capacity of at least 1 seat.' };
  if (validateConfig(base).some((i) => i.severity === 'error')) return { ok: false, seats: 0, message: 'Fix the configuration errors first.' };
  const candidates: { config: VenueConfiguration; seats: number }[] = [];
  let maxSeats = 0;
  for (let rows = 1; rows <= 30; rows++) {
    const most = seatsFor(base, rows, MAX_ANGLE);
    maxSeats = Math.max(maxSeats, most);
    if (most < target) continue;
    // Seat count grows with fan angle, so bisect for the narrowest fan that reaches the target.
    let lo = MIN_ANGLE;
    let hi = MAX_ANGLE;
    if (seatsFor(base, rows, lo) >= target) hi = lo;
    while (hi - lo > 1) {
      const mid = Math.round((lo + hi) / 2);
      if (seatsFor(base, rows, mid) >= target) hi = mid;
      else lo = mid;
    }
    const n = seatsFor(base, rows, hi);
    if (n <= Math.max(target * 1.05, target + 2)) {
      const c = cloneConfig(base);
      c.seating.rowCount = rows;
      c.seating.sectionAngleDeg = hi;
      candidates.push({ config: c, seats: n });
    }
  }
  if (!candidates.length) {
    const product = getSeatingProduct(base.seating.productId);
    if (maxSeats < target)
      return {
        ok: false,
        seats: maxSeats,
        message: `At most ${maxSeats} ${product ? `${product.manufacturer} ${product.model}` : ''} seats fit inside a ${base.sphere.radius.toFixed(1)} m sphere with ${base.seating.screenClearance.toFixed(2)} m screen clearance and ${base.seating.rowPitch.toFixed(2)} m row pitch. Increase the radius, reduce the clearance or choose a narrower seat.`,
      };
    return { ok: false, seats: maxSeats, message: `No row/fan combination lands within 5% above ${target}. Try a slightly different target or change the aisles.` };
  }
  // Rank the candidates by average immersion score (coarse sampling for speed).
  let best = candidates[0];
  let bestScore = -1;
  for (const cand of candidates) {
    // Seats and scores do not depend on the LED system, so skip panelizing it for each candidate.
    const probe = cloneConfig(cand.config);
    probe.led.enabled = false;
    const score = analyzeImmersion(generateVenue(probe), settings, 6).average;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return {
    ok: true,
    config: best.config,
    seats: best.seats,
    message: `${best.seats} seats in ${best.config.seating.rowCount} rows across a ${best.config.seating.sectionAngleDeg}° fan. This had the highest average immersion (${bestScore.toFixed(2)}) of the ${candidates.length} row counts that fit.`,
  };
}
