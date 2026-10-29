/**
 * Immersion analysis engine (subsystem 5).
 *
 * Every seat gets a set of geometric measurements taken from its eye point, each measurement is
 * mapped to a 0–1 sub-score by a published linear ramp, and the sub-scores are combined with
 * user-visible weights. This is a transparent design heuristic, not a validated standard: the
 * ramps and weights are meant to be tuned against physical tests and audience studies.
 */
import { toDeg, toRad } from './coordinates';
import { mediaBounds, ringOf } from './media';
import type { SeatRecord, VenueConfiguration, VenueModel, VenueObject, Vec3 } from './types';

export type ImmersionMetricKey =
  | 'fieldFill'
  | 'hFov'
  | 'vFov'
  | 'originDistance'
  | 'screenDistance'
  | 'headTurn'
  | 'sightline'
  | 'verticalComfort'
  | 'incidence';

export interface Ramp {
  /** Measurement at which the sub-score is 0. */
  zero: number;
  /** Measurement at which the sub-score is 1. Sub-scores interpolate linearly between. */
  one: number;
}

export interface AnalysisSettings {
  weights: Record<ImmersionMetricKey, number>;
  ramps: Record<Exclude<ImmersionMetricKey, 'verticalComfort'>, Ramp>;
  /** Comfortable band for the screen's weighted centre elevation (deg above eye level), and how far beyond it the score falls to 0. */
  verticalBand: { low: number; high: number; falloff: number };
  /** Eye to top of head, for the C-value style sightline check (m). */
  headClearance: number;
  /** Score at or above which a seat counts as premium. */
  premiumThreshold: number;
}

export const DEFAULT_ANALYSIS: AnalysisSettings = {
  weights: {
    fieldFill: 0.25,
    hFov: 0.1,
    vFov: 0.1,
    originDistance: 0.1,
    screenDistance: 0.1,
    headTurn: 0.1,
    sightline: 0.15,
    verticalComfort: 0.05,
    incidence: 0.05,
  },
  ramps: {
    fieldFill: { zero: 0.3, one: 0.85 },
    hFov: { zero: 100, one: 200 },
    vFov: { zero: 30, one: 80 },
    originDistance: { zero: 8, one: 1 },
    screenDistance: { zero: 2, one: 4 },
    headTurn: { zero: 60, one: 10 },
    sightline: { zero: 0, one: 0.12 },
    incidence: { zero: 50, one: 20 },
  },
  verticalBand: { low: 0, high: 30, falloff: 25 },
  headClearance: 0.12,
  premiumThreshold: 0.65,
};

export const METRIC_INFO: Record<ImmersionMetricKey, { label: string; unit: string; help: string }> = {
  fieldFill: { label: 'Field filled by screen', unit: '%', help: 'Share of a forward visual field (±100° × −35°…+50°) covered by visible media, by solid angle.' },
  hFov: { label: 'Horizontal FOV', unit: '°', help: 'Horizontal angle of media within ±15° of eye level.' },
  vFov: { label: 'Vertical FOV', unit: '°', help: 'Vertical angle of media within ±10° of straight ahead.' },
  originDistance: { label: 'Distance to origin', unit: 'm', help: 'Eye point to the sphere centre (the reference eye point).' },
  screenDistance: { label: 'Nearest screen', unit: 'm', help: 'Shortest eye-to-media distance. Close seats resolve pixels and strain focus.' },
  headTurn: { label: 'Head turn to stage', unit: '°', help: 'Plan angle between the seat’s facing direction and the stage focus point.' },
  sightline: { label: 'Sightline clearance (C)', unit: 'm', help: 'Height of the sightline to the stage front edge above the eye of the person in front. 0.12 m clears a head.' },
  verticalComfort: { label: 'Screen centre elevation', unit: '°', help: 'Solid-angle weighted centre of the visible media, degrees above eye level.' },
  incidence: { label: 'Mean incidence', unit: '°', help: 'Average angle between sightlines and the screen normal. Oblique viewing loses brightness and shape.' },
};

export type Grade = 'excellent' | 'good' | 'acceptable' | 'compromised' | 'unacceptable';

export const GRADES: { grade: Grade; min: number; color: string }[] = [
  { grade: 'excellent', min: 0.8, color: '#1a9850' },
  { grade: 'good', min: 0.65, color: '#91cf60' },
  { grade: 'acceptable', min: 0.5, color: '#fee08b' },
  { grade: 'compromised', min: 0.35, color: '#fc8d59' },
  { grade: 'unacceptable', min: -Infinity, color: '#d73027' },
];

export const gradeOf = (score: number): Grade => GRADES.find((g) => score >= g.min)!.grade;

export interface SeatAnalysis {
  seatId: string;
  measurements: Record<ImmersionMetricKey, number>;
  subScores: Record<ImmersionMetricKey, number>;
  score: number;
  grade: Grade;
  warnings: string[];
  /** Seat whose head limits the sightline, if any. */
  blockingSeatId?: string;
}

export interface ImmersionAnalysis {
  seats: Map<string, SeatAnalysis>;
  average: number;
  premiumCount: number;
  warningCount: number;
  gradeCounts: Record<Grade, number>;
  focusPoint: Vec3;
}

const ramp = (v: number, r: Ramp) => {
  const t = (v - r.zero) / (r.one - r.zero);
  return Math.max(0, Math.min(1, Number.isFinite(t) ? t : v >= r.one ? 1 : 0));
};

interface Sample {
  p: Vec3;
  /** Outward unit normal (away from the audience). */
  n: Vec3;
  area: number;
}

function screenSamples(c: VenueConfiguration, stepDeg = 3): Sample[] {
  const ring = ringOf(c);
  const b = mediaBounds(c.sphere.radius, c.media, ring);
  const nu = Math.max(4, Math.ceil(toDeg(b.az1 - b.az0) / stepDeg));
  const nv = Math.max(2, Math.ceil(toDeg(b.el1 - b.el0) / stepDeg));
  const du = (b.az1 - b.az0) / nu;
  const dv = (b.el1 - b.el0) / nv;
  const out: Sample[] = [];
  const floor = c.floor.mainFloorElevation;
  for (let j = 0; j < nv; j++) {
    const ea = b.el0 + j * dv;
    const eb = ea + dv;
    const el = ea + dv / 2;
    const area = b.R * du * (ring * dv + b.R * (Math.sin(eb) - Math.sin(ea)));
    const z = b.R * Math.sin(el);
    if (z < floor) continue; // hidden below the floor
    const rc = ring + b.R * Math.cos(el);
    for (let i = 0; i < nu; i++) {
      const az = b.az0 + (i + 0.5) * du;
      out.push({ p: [rc * Math.sin(az), rc * Math.cos(az), z], n: [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)], area });
    }
  }
  return out;
}

/** Stage focus point: centre of the stage front edge at deck level; the deck centre for a central stage. */
export function stageFocus(c: VenueConfiguration): Vec3 {
  return [0, c.stage.type === 'central' ? c.stage.centerY : c.stage.centerY - c.stage.depth / 2, c.floor.mainFloorElevation + c.stage.height];
}

const FIELD_AZ = toRad(100);
const FIELD_EL_LO = toRad(-35);
const FIELD_EL_HI = toRad(50);
const FIELD_SR = 2 * FIELD_AZ * (Math.sin(FIELD_EL_HI) - Math.sin(FIELD_EL_LO));
const H_BAND = toRad(15);
const V_BAND = toRad(10);
const GAP = toRad(6);

/** Total angle covered by a set of directions, merging neighbours closer than GAP. */
function coverage(angles: number[]): number {
  if (!angles.length) return 0;
  angles.sort((a, b) => a - b);
  let total = 0;
  let start = angles[0];
  let prev = angles[0];
  for (let i = 1; i < angles.length; i++) {
    if (angles[i] - prev > GAP) {
      total += prev - start;
      start = angles[i];
    }
    prev = angles[i];
  }
  return total + (prev - start);
}

function sightlineClearance(seat: SeatRecord, all: SeatRecord[], focus: Vec3, seatWidth: number) {
  const E = seat.eyePoint;
  const dx = focus[0] - E[0];
  const dy = focus[1] - E[1];
  const L2 = dx * dx + dy * dy;
  let best = Infinity;
  let blocker: string | undefined;
  for (const s of all) {
    if (s.rowIndex >= seat.rowIndex) continue;
    const P = s.eyePoint;
    const t = ((P[0] - E[0]) * dx + (P[1] - E[1]) * dy) / L2;
    if (t <= 0 || t >= 1) continue;
    const px = E[0] + t * dx - P[0];
    const py = E[1] + t * dy - P[1];
    if (Math.hypot(px, py) > seatWidth / 2) continue;
    const c = E[2] + t * (focus[2] - E[2]) - P[2];
    if (c < best) {
      best = c;
      blocker = s.id;
    }
  }
  return { c: best, blocker };
}

/** `sampleStepDeg` trades accuracy for speed (3° for display, coarser for search). */
export function analyzeImmersion(model: VenueModel, settings: AnalysisSettings = DEFAULT_ANALYSIS, sampleStepDeg = 3): ImmersionAnalysis {
  const c = model.config;
  const samples = screenSamples(c, sampleStepDeg);
  const focus = stageFocus(c);
  const seatWidth = Number(model.blocks.find((b) => b.id.startsWith('block.seat.'))?.metadata.width_m ?? 0.6);
  const wSum = Object.values(settings.weights).reduce((a, b) => a + b, 0) || 1;
  const seats = new Map<string, SeatAnalysis>();
  const gradeCounts: Record<Grade, number> = { excellent: 0, good: 0, acceptable: 0, compromised: 0, unacceptable: 0 };
  const hAngles: number[] = [];
  const vAngles: number[] = [];
  let total = 0;
  let premium = 0;
  let warned = 0;

  for (const seat of model.seats) {
    const E = seat.eyePoint;
    const fx = seat.facing[0];
    const fy = seat.facing[1];
    hAngles.length = 0;
    vAngles.length = 0;
    let omega = 0;
    let fieldOmega = 0;
    let elSum = 0;
    let incSum = 0;
    let minDist = Infinity;
    for (const { p, n, area } of samples) {
      const vx = p[0] - E[0];
      const vy = p[1] - E[1];
      const vz = p[2] - E[2];
      const r = Math.hypot(vx, vy, vz);
      // Cosine between the inward screen normal and the direction back to the eye.
      const cosInc = (n[0] * vx + n[1] * vy + n[2] * vz) / r;
      if (cosInc <= 0) continue;
      const dOmega = (area * cosInc) / (r * r);
      const azRel = Math.atan2(fx * vy - fy * vx, fx * vx + fy * vy) * -1; // + = to the seat's right
      const elRel = Math.asin(vz / r);
      omega += dOmega;
      elSum += dOmega * elRel;
      incSum += dOmega * Math.acos(Math.min(1, cosInc));
      minDist = Math.min(minDist, r);
      if (Math.abs(azRel) <= FIELD_AZ && elRel >= FIELD_EL_LO && elRel <= FIELD_EL_HI) fieldOmega += dOmega;
      if (Math.abs(elRel) <= H_BAND) hAngles.push(azRel);
      if (Math.abs(azRel) <= V_BAND) vAngles.push(elRel);
    }
    const hFov = toDeg(coverage(hAngles));
    const vFov = toDeg(coverage(vAngles));
    const toFocus = Math.atan2(fx * (focus[1] - E[1]) - fy * (focus[0] - E[0]), fx * (focus[0] - E[0]) + fy * (focus[1] - E[1]));
    const sl = sightlineClearance(seat, model.seats, focus, seatWidth);

    const measurements: Record<ImmersionMetricKey, number> = {
      fieldFill: Math.min(1, fieldOmega / FIELD_SR),
      hFov,
      vFov,
      originDistance: seat.distanceFromOrigin,
      screenDistance: minDist,
      headTurn: Math.abs(toDeg(toFocus)),
      sightline: sl.c,
      verticalComfort: omega > 0 ? toDeg(elSum / omega) : 0,
      incidence: omega > 0 ? toDeg(incSum / omega) : 90,
    };
    const vb = settings.verticalBand;
    const ve = measurements.verticalComfort;
    const subScores: Record<ImmersionMetricKey, number> = {
      fieldFill: ramp(measurements.fieldFill, settings.ramps.fieldFill),
      hFov: ramp(hFov, settings.ramps.hFov),
      vFov: ramp(vFov, settings.ramps.vFov),
      originDistance: ramp(measurements.originDistance, settings.ramps.originDistance),
      screenDistance: ramp(minDist, settings.ramps.screenDistance),
      headTurn: ramp(measurements.headTurn, settings.ramps.headTurn),
      sightline: ramp(sl.c, settings.ramps.sightline),
      verticalComfort: ve < vb.low ? Math.max(0, 1 - (vb.low - ve) / vb.falloff) : ve > vb.high ? Math.max(0, 1 - (ve - vb.high) / vb.falloff) : 1,
      incidence: ramp(measurements.incidence, settings.ramps.incidence),
    };
    let score = 0;
    for (const k of Object.keys(subScores) as ImmersionMetricKey[]) score += subScores[k] * settings.weights[k];
    score /= wSum;

    const warnings: string[] = [];
    if (minDist < settings.ramps.screenDistance.zero) warnings.push(`Within ${settings.ramps.screenDistance.zero} m of the screen`);
    if (sl.c < settings.headClearance) warnings.push(sl.c <= 0 ? 'Stage sightline blocked by the head in front' : 'Stage sightline grazes the head in front');
    if (measurements.headTurn > 45) warnings.push('Head turn to stage over 45°');
    if (ve > vb.high + vb.falloff * 0.6) warnings.push('Steep upward viewing');

    const grade = gradeOf(score);
    gradeCounts[grade]++;
    total += score;
    if (score >= settings.premiumThreshold) premium++;
    if (warnings.length) warned++;
    seats.set(seat.id, { seatId: seat.id, measurements, subScores, score, grade, warnings, blockingSeatId: sl.blocker });
  }

  return {
    seats,
    average: model.seats.length ? total / model.seats.length : 0,
    premiumCount: premium,
    warningCount: warned,
    gradeCounts,
    focusPoint: focus,
  };
}

/** Seat user strings for CAD export (`om.` is prefixed by the exporter). */
export function seatAnalysisMetadata(a: SeatAnalysis): Record<string, string | number> {
  const m: Record<string, string | number> = {
    immersion_score: +a.score.toFixed(4),
    immersion_grade: a.grade,
    sightline_clearance_m: Number.isFinite(a.measurements.sightline) ? +a.measurements.sightline.toFixed(4) : 'clear',
  };
  if (a.blockingSeatId) m.sightline_blocked_by = a.blockingSeatId;
  if (a.warnings.length) m.immersion_warnings = a.warnings.join('; ');
  return m;
}

/** Analysis geometry for CAD: one sightline per seat (eye → stage focus) and the viewing target. */
export function analysisObjects(model: VenueModel, analysis: ImmersionAnalysis): VenueObject[] {
  const out: VenueObject[] = [
    {
      id: 'analysis.target.stage',
      name: 'Stage_Focus',
      layer: '07_ANALYSIS/Viewing_Targets',
      category: 'ViewingTarget',
      geometry: { kind: 'point', p: analysis.focusPoint },
      metadata: { description: 'Centre of the stage front edge at deck level; sightline and head-turn target.' },
    },
  ];
  for (const seat of model.seats) {
    const a = analysis.seats.get(seat.id);
    if (!a) continue;
    out.push({
      id: `analysis.sightline.${seat.id}`,
      name: `Sightline_${seat.row}${String(seat.number).padStart(2, '0')}`,
      layer: '07_ANALYSIS/Sightline_Rays',
      category: 'Sightline',
      geometry: { kind: 'line', a: seat.eyePoint, b: analysis.focusPoint },
      metadata: { seat_id: seat.id, ...seatAnalysisMetadata(a) },
    });
  }
  return out;
}
