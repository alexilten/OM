/**
 * LED panelization engine (subsystem 4).
 *
 * Every unit keeps its true manufacturer size: nothing is stretched or scaled to fit the sphere.
 * The strategy follows the construction family:
 *
 * - **Rings** (01 faceted, 02 single-axis curved, 03 flexible): flat units in rows along latitudes.
 *   Row pitch and per-row column pitch are chosen so neighbouring front faces meet along their
 *   centre lines; whatever does not fit is left uncovered and reported. Away from those centre
 *   lines the faces open gaps, collide or step, and every joint is measured.
 * - **Spherical tiles** (04 purpose-built, 05 custom modular): panels cut from the sphere itself,
 *   one tile shape per row, so they lie on the ideal surface and every row is a separate type.
 *
 * Measurements per unit: deviation from the ideal sphere, worst joint gap, overlap (collision) and
 * face step against its neighbours, and the joint angles it needs. Totals cover count, resolution,
 * weight and power. `compareLedProducts` runs every library product on the same screen so the UI
 * can offer alternatives when a product's curvature limit fails.
 */
import { getLedProduct, LED_PRODUCTS } from '../library/led';
import { add, cross, dot, normalize, scale, sub, surfaceNormal, surfacePoint, toDeg, toRad } from './coordinates';
import { mediaBounds, patchArea, ringOf } from './media';
import type { BlockDefinition, Frame, Issue, LedProduct, Metric, Vec3, VenueConfiguration, VenueObject } from './types';

export type LedStrategy = 'rings' | 'spherical-tiles';

export const strategyFor = (p: LedProduct): LedStrategy =>
  p.family === '04-purpose-built-spherical' || p.family === '05-custom-modular-spherical' ? 'spherical-tiles' : 'rings';

export const STRATEGY_LABEL: Record<LedStrategy, string> = {
  rings: 'Latitude rings of true-size flat units',
  'spherical-tiles': 'Spherical tiles cut to the sphere (one type per row)',
};

/** Joint tolerances used for colouring and warnings (metres). */
export const SEAM = { fine: 0.0005, visible: 0.002 } as const;

export const ledBlockId = (productId: string) => `block.led.${productId}`;

export function ledBlock(p: LedProduct): BlockDefinition {
  const w = p.cabinetWidth.value;
  const h = p.cabinetHeight.value;
  const d = p.cabinetDepth.value;
  const face = Math.min(0.004, d / 3);
  return {
    id: ledBlockId(p.id),
    name: `LED_${p.manufacturer}_${p.model}`.replace(/[^A-Za-z0-9_]+/g, '_'),
    description: `${p.manufacturer} ${p.model} unit envelope ${(w * 1000).toFixed(0)} × ${(h * 1000).toFixed(0)} × ${(d * 1000).toFixed(0)} mm. Local origin = front face centre, +Z = display normal (towards audience).`,
    parts: [
      { role: 'led-face', geometry: { kind: 'box', min: [-w / 2, -h / 2, -face], max: [w / 2, h / 2, 0] } },
      { role: 'led-body', geometry: { kind: 'box', min: [-w / 2, -h / 2, -d], max: [w / 2, h / 2, -face] } },
    ],
    metadata: {
      manufacturer: p.manufacturer,
      product_family: p.productFamily,
      model: p.model,
      cabinet_w_m: w,
      cabinet_h_m: h,
      cabinet_d_m: d,
      pixel_pitch_mm: +(p.pixelPitch.value * 1000).toFixed(3),
      dims_status: p.cabinetWidth.status,
      revision: p.revision,
    },
  };
}

export interface LedUnit {
  id: string;
  row: number;
  col: number;
  az: number;
  el: number;
  /** Rings: rigid frame of the flat unit (front face centre). */
  frame?: Frame;
  /** Tiles: exact spherical extents (radians). */
  patch?: { az0: number; az1: number; el0: number; el1: number };
  /** Largest distance of the front face from the ideal sphere (m). */
  deviation: number;
  /** Widest opening to a neighbour (m). */
  gap: number;
  /** Deepest collision with a neighbour (m, ≥ 0). */
  overlap: number;
  /** Largest out-of-plane step between neighbouring faces (m). */
  step: number;
  /** Angle needed between this unit and its row neighbour, and the unit below (deg). */
  jointH: number;
  jointV: number;
  curvatureOk: boolean;
}

export interface LedSummary {
  product: LedProduct;
  strategy: LedStrategy;
  count: number;
  rows: number;
  unitTypes: number;
  pixels: number;
  resolutionH: number;
  resolutionV: number;
  weightKg: number;
  powerMaxW: number;
  powerAvgW: number;
  coverage: number;
  maxDeviation: number;
  maxGap: number;
  maxOverlap: number;
  maxStep: number;
  maxJointH: number;
  maxJointV: number;
  /** Units whose required joint angle or bend exceeds the product limit. */
  failing: number;
  failingFromElevationDeg?: number;
  /** Product curvature limit used for the check (deg), if it has one. */
  limitDeg?: number;
  /** Smallest sphere radius at which this product meets its curvature limit everywhere (m); Infinity if never. */
  minRadius: number;
  /** Uncovered strip above the top row (m of arc), and widest uncovered strip at a row end (m). */
  topStrip: number;
  sideStrip: number;
  /** Tiles only: smallest and largest tile width and height (m). */
  tileRange?: { wMin: number; wMax: number; hMin: number; hMax: number };
  fits: boolean;
}

export interface Panelization {
  units: LedUnit[];
  summary: LedSummary;
}

const corners = (f: Frame, w: number, h: number) => {
  const at = (sx: number, sy: number) => add(f.origin, add(scale(f.xAxis, (sx * w) / 2), scale(f.yAxis, (sy * h) / 2)));
  return { bl: at(-1, -1), br: at(1, -1), tl: at(-1, 1), tr: at(1, 1) };
};

const angleBetween = (a: Vec3, b: Vec3) => toDeg(Math.acos(Math.max(-1, Math.min(1, dot(a, b)))));

function frameAt(Rc: number, az: number, el: number, ring = 0): Frame {
  const origin = surfacePoint(Rc, az, el, ring);
  const zAxis = scale(surfaceNormal(az, el), -1);
  const xAxis: Vec3 = [Math.cos(az), -Math.sin(az), 0];
  return { origin, xAxis, yAxis: cross(zAxis, xAxis), zAxis };
}

function limitOf(p: LedProduct): number | undefined {
  if (p.family === '01-faceted' || p.family === '02-single-axis-curved') return p.curveConcaveDeg?.value;
  return undefined;
}

/** Hinge angle between ring neighbours (angle between their normals), degrees. */
function hingeAngle(Rc: number, el: number, w: number, h: number, g: number, ring = 0): number {
  const dAz = ringPitch(Rc, el, w, h, g, ring);
  const c = Math.cos(el) ** 2 * Math.cos(dAz) + Math.sin(el) ** 2;
  return toDeg(Math.acos(Math.max(-1, Math.min(1, c))));
}

/** Smallest radius at which every row stays within the product's joint-angle or bend limit. */
export function minRadiusFor(p: LedProduct, c: VenueConfiguration): number {
  // Flexible modules bend along the row to the sphere's own radius.
  if (p.family === '03-flexible') return p.minBendRadius?.value ?? 0;
  const L = limitOf(p);
  if (L === undefined) return 0;
  // The ring taper widens the pitch towards the poles, so the highest ring needs the largest hinge.
  const ring = ringOf(c);
  const b = mediaBounds(c.sphere.radius, c.media, ring);
  const el = Math.min(Math.max(Math.abs(b.el0), Math.abs(b.el1)), toRad(89));
  const w = p.cabinetWidth.value;
  const h = p.cabinetHeight.value;
  const fits = (R: number) => hingeAngle(R, el, w, h, c.led.jointGap, ring) <= L;
  let hi = 1000;
  if (!fits(hi)) return Infinity;
  let lo = Math.max(w, h);
  if (fits(lo)) return lo;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Azimuth pitch for one ring. A ring of rectangles approximates a cone, so faces cannot meet along
 * their whole side edges: they touch at the corners nearest the pole (no collision) and open a
 * wedge towards the equator, as a built faceted dome does.
 *
 * Closed form: with neighbours at ±a, the pole-side corners are `g` apart when
 * K·sin a − (w/2)·cos a = g/2, where K = ring + Rc·cos(el) − (h/2)·|sin(el)| (ring = 0 on a sphere).
 */
function ringPitch(Rc: number, el: number, w: number, h: number, g: number, ring = 0): number {
  const K = ring + Rc * Math.cos(el) - (h / 2) * Math.abs(Math.sin(el));
  const r = Math.hypot(K, w / 2);
  return 2 * (Math.atan2(w / 2, K) + Math.asin(Math.min(1, g / (2 * r))));
}

interface Ring {
  el: number;
  azs: number[];
  dAz: number;
}

/** Azimuths of one ring at elevation `el`, centred on the screen's azimuth span. */
function ringAt(Rc: number, el: number, w: number, h: number, g: number, az0: number, az1: number, ring = 0): Ring {
  const dAz = ringPitch(Rc, el, w, h, g, ring);
  const k = Math.floor((az1 - az0) / dAz + 1e-9);
  const mid = (az0 + az1) / 2;
  return { el, dAz, azs: Array.from({ length: Math.max(0, k) }, (_, i) => mid + (i - (k - 1) / 2) * dAz) };
}

/** Index of the unit in `ring` covering azimuth `az` (nearest centre). */
const nearestIn = (ring: Ring, az: number) => Math.max(0, Math.min(ring.azs.length - 1, Math.round((az - ring.azs[0]) / ring.dAz)));

/**
 * Whether two rings keep at least `g` open everywhere: each bottom corner of the upper ring against the
 * unit below it, and each top corner of the lower ring against the unit above it (the minimum
 * opening along two straight edges is always at one of these corners). Scalar maths; this is the hot loop.
 */
function ringsClear(Rc: number, w: number, h: number, g: number, lower: Ring, upper: Ring, ring = 0): boolean {
  const test = (from: Ring, sy: number, to: Ring) => {
    const ce = Math.cos(from.el);
    const se = Math.sin(from.el);
    const te = Math.cos(to.el);
    const ts = Math.sin(to.el);
    for (const az of from.azs) {
      const ca = Math.cos(az);
      const sa = Math.sin(az);
      for (const sx of [-1, 1]) {
        // Corner = origin + sx·x·w/2 + sy·y·h/2, with x = (ca, −sa, 0) and y = (−se·sa, −se·ca, ce).
        const px = (ring + Rc * ce) * sa + (sx * w * ca) / 2 - (sy * h * se * sa) / 2;
        const py = (ring + Rc * ce) * ca - (sx * w * sa) / 2 - (sy * h * se * ca) / 2;
        const pz = Rc * se + (sy * h * ce) / 2;
        const taz = to.azs[nearestIn(to, Math.atan2(px, py))];
        const tc = Math.cos(taz);
        const tsn = Math.sin(taz);
        const dx = px - (ring + Rc * te) * tsn;
        const dy = py - (ring + Rc * te) * tc;
        const dz = pz - Rc * ts;
        if (Math.abs(dx * tc - dy * tsn) > w / 2 + 1e-9) continue; // over an opening at the row end
        const ly = -dx * ts * tsn - dy * ts * tc + dz * te;
        if (-sy * ly - h / 2 < g - 1e-9) return false;
      }
    }
    return true;
  };
  return test(upper, -1, lower) && test(lower, 1, upper);
}

function panelizeRings(c: VenueConfiguration, p: LedProduct): Panelization {
  const R = c.sphere.radius;
  const w = p.cabinetWidth.value;
  const h = p.cabinetHeight.value;
  const g = c.led.jointGap;
  // Tangent: face centres on the sphere, corners behind it. Balanced: pulled forward by half the corner
  // stand-off so the face straddles the sphere and the worst deviation halves.
  const standoff = Math.sqrt(R * R + (w / 2) ** 2 + (h / 2) ** 2) - R;
  const Rc = c.led.placement === 'balanced' ? R - standoff / 2 : R;
  const ring = ringOf(c);
  const b = mediaBounds(R, c.media, ring);
  const limit = limitOf(p);
  const minBend = p.family === '03-flexible' ? p.minBendRadius?.value : undefined;
  const dEl0 = 2 * Math.atan((h + g) / (2 * Rc));
  const band = c.led.extent === 'band';
  const maxRows = band ? c.led.bandRows : Infinity;
  let el = band ? Math.max(b.el0 + dEl0 / 2, toRad(c.led.bandElevationDeg) - ((c.led.bandRows - 1) / 2) * dEl0) : b.el0 + dEl0 / 2;

  // Rings are laid bottom-up. Each ring sits at the lowest elevation that keeps a `g` opening to the
  // ring below everywhere (columns do not line up, so corners decide), so nothing collides.
  const rows: LedUnit[][] = [];
  const rings: Ring[] = [];
  let sideStrip = 0;
  let lastEl = el;
  while (rows.length < maxRows && el + dEl0 / 2 <= b.el1 + 1e-9) {
    const rg = ringAt(Rc, el, w, h, g, b.az0, b.az1, ring);
    const { dAz, azs } = rg;
    if (!azs.length) break;
    sideStrip = Math.max(sideStrip, (((b.az1 - b.az0) - azs.length * dAz) / 2) * (ring + R * Math.cos(el)));
    const row: LedUnit[] = azs.map((az, i) => {
      const frame = frameAt(Rc, az, el, ring);
      const cs = corners(frame, w, h);
      let deviation = Math.abs(Rc - R);
      for (const q of [cs.bl, cs.br, cs.tl, cs.tr]) deviation = Math.max(deviation, Math.abs(Math.hypot(Math.hypot(q[0], q[1]) - ring, q[2]) - R));
      return { id: `led.r${String(rows.length).padStart(2, '0')}.c${String(i).padStart(3, '0')}`, row: rows.length, col: i, az, el, frame, deviation, gap: 0, overlap: 0, step: 0, jointH: 0, jointV: 0, curvatureOk: true };
    });
    rows.push(row);
    rings.push(rg);
    lastEl = el;
    let lo = el;
    let hi = el + 2 * dEl0;
    // 20 halvings of 2·dEl0 resolve the elevation to well under a micrometre of arc.
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (ringsClear(Rc, w, h, g, rg, ringAt(Rc, mid, w, h, g, b.az0, b.az1, ring), ring)) hi = mid;
      else lo = mid;
    }
    el = hi;
  }

  const note = (u: LedUnit, gap: number, step: number) => {
    if (gap > u.gap) u.gap = gap;
    if (-gap > u.overlap) u.overlap = -gap;
    if (step > u.step) u.step = step;
  };

  // Row joints: right edge of A against left edge of B.
  for (const row of rows)
    for (let i = 0; i + 1 < row.length; i++) {
      const A = row[i];
      const B = row[i + 1];
      const fa = A.frame!;
      const fb = B.frame!;
      const t = normalize(add(fa.xAxis, fb.xAxis));
      const n = normalize(add(fa.zAxis, fb.zAxis));
      const ca = corners(fa, w, h);
      const cb = corners(fb, w, h);
      for (const d of [sub(cb.bl, ca.br), sub(cb.tl, ca.tr)]) {
        const gap = dot(d, t);
        const step = Math.abs(dot(d, n));
        note(A, gap, step);
        note(B, gap, step);
      }
      const j = angleBetween(fa.zAxis, fb.zAxis);
      A.jointH = Math.max(A.jointH, j);
      B.jointH = Math.max(B.jointH, j);
    }

  // Ring joints, measured as they were solved: bottom corners of each unit against the unit below,
  // top corners of each unit against the unit above.
  const ringJoint = (from: LedUnit, corner: Vec3, to: LedUnit, sy: number) => {
    const f = to.frame!;
    const d = sub(corner, f.origin);
    if (Math.abs(dot(d, f.xAxis)) > w / 2 + 1e-9) return;
    const gap = -sy * dot(d, f.yAxis) - h / 2;
    const step = Math.abs(dot(d, f.zAxis));
    note(from, gap, step);
    note(to, gap, step);
    const j = angleBetween(from.frame!.zAxis, f.zAxis);
    from.jointV = Math.max(from.jointV, j);
    to.jointV = Math.max(to.jointV, j);
  };
  for (let r = 1; r < rows.length; r++) {
    for (const U of rows[r]) {
      const cs = corners(U.frame!, w, h);
      for (const q of [cs.bl, cs.br]) ringJoint(U, q, rows[r - 1][nearestIn(rings[r - 1], Math.atan2(q[0], q[1]))], -1);
    }
    for (const L of rows[r - 1]) {
      const cs = corners(L.frame!, w, h);
      for (const q of [cs.tl, cs.tr]) ringJoint(L, q, rows[r][nearestIn(rings[r], Math.atan2(q[0], q[1]))], 1);
    }
  }

  const units = rows.flat();
  let failingFrom: number | undefined;
  for (const u of units) {
    if (limit !== undefined) u.curvatureOk = u.jointH <= limit + 1e-9;
    else if (minBend !== undefined) u.curvatureOk = Rc >= minBend;
    if (!u.curvatureOk) failingFrom = Math.min(failingFrom ?? Infinity, Math.abs(toDeg(u.el)));
  }

  const ideal = patchArea(b);
  const equator = rows.reduce((best, row) => (row.length && (!best.length || Math.abs(row[0].el) < Math.abs(best[0].el)) ? row : best), [] as LedUnit[]);
  const topStrip = !band && rows.length ? Math.max(0, (b.el1 - (lastEl + dEl0 / 2)) * R) : 0;
  return { units, summary: summarize(c, p, 'rings', units, rows.length, 1, units.length * w * h, ideal, equator.length * p.pixelsX.value, rows.length * p.pixelsY.value, units.length * p.pixelsX.value * p.pixelsY.value, units.length, limit, failingFrom, topStrip, sideStrip) };
}

function panelizeTiles(c: VenueConfiguration, p: LedProduct): Panelization {
  const ring = ringOf(c);
  const b = mediaBounds(c.sphere.radius, c.media, ring);
  const R = b.R;
  const w = p.cabinetWidth.value;
  const h = p.cabinetHeight.value;
  const g = c.led.jointGap;
  let el0 = b.el0;
  let el1 = b.el1;
  let n = Math.max(1, Math.round(((el1 - el0) * R) / (h + g)));
  if (c.led.extent === 'band') {
    const dEl = (h + g) / R;
    const centre = toRad(c.led.bandElevationDeg);
    el0 = Math.max(b.el0, centre - (c.led.bandRows * dEl) / 2);
    el1 = Math.min(b.el1, centre + (c.led.bandRows * dEl) / 2);
    n = Math.max(0, Math.round(((el1 - el0) * R) / (h + g)));
  }
  const units: LedUnit[] = [];
  const range = { wMin: Infinity, wMax: 0, hMin: Infinity, hMax: 0 };
  let area = 0;
  const dEl = n ? (el1 - el0) / n : 0;
  for (let j = 0; j < n; j++) {
    const ea = el0 + j * dEl;
    const eb = ea + dEl;
    const em = (ea + eb) / 2;
    const rho = ring + R * Math.cos(em);
    // Size each row from its widest (equator-side) edge so no tile exceeds the nominal width.
    const wide = ring + R * Math.cos(ea <= 0 && eb >= 0 ? 0 : Math.min(Math.abs(ea), Math.abs(eb)));
    const k = Math.max(1, Math.ceil(((b.az1 - b.az0) * wide) / (w + g) - 1e-9));
    const dAz = (b.az1 - b.az0) / k;
    const gAz = rho > 1e-9 ? Math.min(dAz / 2, g / rho) : 0;
    const gEl = g / R;
    const pe0 = ea + gEl / 2;
    const pe1 = eb - gEl / 2;
    // Tile edges are latitude arcs, so a tile is widest on the edge nearest the equator.
    const near = pe0 <= 0 && pe1 >= 0 ? 0 : Math.min(Math.abs(pe0), Math.abs(pe1));
    const far = Math.max(Math.abs(pe0), Math.abs(pe1));
    range.wMin = Math.min(range.wMin, (dAz - gAz) * (ring + R * Math.cos(far)));
    range.wMax = Math.max(range.wMax, (dAz - gAz) * (ring + R * Math.cos(near)));
    range.hMin = Math.min(range.hMin, (pe1 - pe0) * R);
    range.hMax = Math.max(range.hMax, (pe1 - pe0) * R);
    for (let i = 0; i < k; i++) {
      const az0 = b.az0 + i * dAz + gAz / 2;
      const az1 = az0 + dAz - gAz;
      area += R * (az1 - az0) * (ring * (pe1 - pe0) + R * (Math.sin(pe1) - Math.sin(pe0)));
      units.push({
        id: `led.r${String(j).padStart(2, '0')}.c${String(i).padStart(3, '0')}`,
        row: j,
        col: i,
        az: (az0 + az1) / 2,
        el: em,
        patch: { az0, az1, el0: pe0, el1: pe1 },
        deviation: 0,
        gap: g,
        overlap: 0,
        step: 0,
        jointH: 0,
        jointV: 0,
        curvatureOk: true,
      });
    }
  }
  // Widest row sets the horizontal resolution; rows × tile height sets the vertical.
  const widestRow = Math.max(0, ...Array.from({ length: n }, (_, j) => {
    const em = el0 + (j + 0.5) * dEl;
    return (b.az1 - b.az0) * (ring + R * Math.cos(em));
  }));
  const resH = widestRow / p.pixelPitch.value;
  const resV = ((el1 - el0) * R) / p.pixelPitch.value;
  const unitArea = w * h;
  if (!n) Object.assign(range, { wMin: 0, hMin: 0 });
  const s = summarize(c, p, 'spherical-tiles', units, n, n, area, patchArea(b), resH, resV, area / p.pixelPitch.value ** 2, area / unitArea, undefined, undefined, 0, 0);
  s.tileRange = range;
  return { units, summary: s };
}

function summarize(
  c: VenueConfiguration,
  p: LedProduct,
  strategy: LedStrategy,
  units: LedUnit[],
  rows: number,
  unitTypes: number,
  coveredArea: number,
  idealArea: number,
  resolutionH: number,
  resolutionV: number,
  pixels: number,
  /** Count in standard-unit equivalents for weight and power. */
  unitEquivalents: number,
  limitDeg: number | undefined,
  failingFromElevationDeg: number | undefined,
  topStrip: number,
  sideStrip: number,
): LedSummary {
  let maxDeviation = 0;
  let maxGap = 0;
  let maxOverlap = 0;
  let maxStep = 0;
  let maxJointH = 0;
  let maxJointV = 0;
  let failing = 0;
  for (const u of units) {
    maxDeviation = Math.max(maxDeviation, u.deviation);
    maxGap = Math.max(maxGap, u.gap);
    maxOverlap = Math.max(maxOverlap, u.overlap);
    maxStep = Math.max(maxStep, u.step);
    maxJointH = Math.max(maxJointH, u.jointH);
    maxJointV = Math.max(maxJointV, u.jointV);
    if (!u.curvatureOk) failing++;
  }
  return {
    product: p,
    strategy,
    count: units.length,
    rows,
    unitTypes,
    pixels,
    resolutionH,
    resolutionV,
    weightKg: unitEquivalents * p.weightKg.value,
    powerMaxW: unitEquivalents * p.powerMaxW.value,
    powerAvgW: unitEquivalents * p.powerAvgW.value,
    coverage: idealArea > 0 ? Math.min(1, coveredArea / idealArea) : 0,
    maxDeviation,
    maxGap,
    maxOverlap,
    maxStep,
    maxJointH,
    maxJointV,
    failing,
    failingFromElevationDeg,
    limitDeg,
    minRadius: minRadiusFor(p, c),
    topStrip,
    sideStrip,
    fits: failing === 0 && maxOverlap <= SEAM.fine,
  };
}

export function panelize(c: VenueConfiguration, p: LedProduct): Panelization {
  return strategyFor(p) === 'spherical-tiles' ? panelizeTiles(c, p) : panelizeRings(c, p);
}

/** Every library product on the current screen, for the comparison table and alternatives. */
export function compareLedProducts(c: VenueConfiguration): LedSummary[] {
  return LED_PRODUCTS.map((p) => panelize(c, p).summary);
}

export interface LedResult {
  objects: VenueObject[];
  blocks: BlockDefinition[];
  metrics: Metric[];
  issues: Issue[];
  summary?: LedSummary;
}

const mm = (v: number) => +(v * 1000).toFixed(2);

export function generateLed(c: VenueConfiguration): LedResult {
  if (!c.led.enabled) return { objects: [], blocks: [], metrics: [], issues: [] };
  const p = getLedProduct(c.led.productId)!;
  const { units, summary: s } = panelize(c, p);
  const tiles = s.strategy === 'spherical-tiles';
  const block = tiles ? undefined : ledBlock(p);
  const layer = p.family === '03-flexible' ? '01_MEDIA/LED_Modules' : '01_MEDIA/LED_Cabinets';
  const objects: VenueObject[] = units.map((u) => ({
    id: u.id,
    name: `LED_R${u.row}_C${u.col}`,
    layer,
    category: tiles ? 'LEDTile' : p.family === '03-flexible' ? 'LEDModule' : 'LEDCabinet',
    geometry: tiles
      ? { kind: 'spherePatch', radius: c.sphere.radius, azimuth0: u.patch!.az0, azimuth1: u.patch!.az1, elevation0: u.patch!.el0, elevation1: u.patch!.el1, ...(ringOf(c) ? { ring: ringOf(c) } : {}) }
      : { kind: 'blockInstance', blockId: block!.id, frame: u.frame! },
    parentAssembly: 'led.system',
    operatingState: 'all',
    metadata: {
      product_id: p.id,
      row: u.row,
      column: u.col,
      azimuth_deg: +toDeg(u.az).toFixed(4),
      elevation_deg: +toDeg(u.el).toFixed(4),
      deviation_mm: mm(u.deviation),
      gap_max_mm: mm(u.gap),
      overlap_max_mm: mm(u.overlap),
      step_max_mm: mm(u.step),
      joint_h_deg: +u.jointH.toFixed(3),
      joint_v_deg: +u.jointV.toFixed(3),
      curvature_ok: u.curvatureOk ? 'yes' : 'no',
      ...(tiles ? { tile_type: `T${String(u.row).padStart(2, '0')}` } : {}),
    },
  }));

  const issues: Issue[] = [];
  const name = `${p.manufacturer} ${p.model}`;
  if (p.family === '01-faceted' || p.family === '02-single-axis-curved')
    issues.push({
      severity: 'warning',
      code: 'led-compound',
      message: `${p.model} curves about one axis only. Rows need up to ${s.maxJointV.toFixed(2)}° between them in the second direction, which relies on custom mounting (unverified).`,
      path: 'led.productId',
    });
  if (s.failing) {
    // Rings never collide, so curvature alone decides; this avoids re-panelizing every product here.
    const alts = LED_PRODUCTS.filter((x) => x.id !== p.id && minRadiusFor(x, c) <= c.sphere.radius).map((x) => `${x.manufacturer} ${x.model}`);
    const need = p.family === '03-flexible' ? `bending tighter than ${p.minBendRadius?.value} m` : `up to ${s.maxJointH.toFixed(2)}° between cabinets; ${p.model} allows ${s.limitDeg}°`;
    const radius = Number.isFinite(s.minRadius) ? ` Or increase the radius to at least ${(Math.ceil(s.minRadius * 10) / 10).toFixed(1)} m.` : '';
    issues.push({
      severity: 'warning',
      code: 'led-curvature',
      message: `${s.failing === s.count ? `All ${s.count} units` : `${s.failing} units above ${s.failingFromElevationDeg!.toFixed(1)}° elevation`} need ${need}. ${alts.length ? `Alternatives that fit: ${alts.join(', ')}.` : 'No library product fits.'}${radius}`,
      path: 'led.productId',
    });
  }
  if (s.maxOverlap > SEAM.fine)
    issues.push({
      severity: 'warning',
      code: 'led-collision',
      message: `Neighbouring ${tiles ? 'tiles' : 'cabinet faces'} collide by up to ${mm(s.maxOverlap)} mm. Add a joint gap${c.led.placement === 'tangent' ? ' or switch to balanced placement' : ''}.`,
      path: 'led.jointGap',
    });
  if (c.led.extent === 'full' && (s.topStrip > 0.05 || s.sideStrip > 0.05))
    issues.push({
      severity: 'info',
      code: 'led-uncovered',
      message: `True-size units leave ${mm(s.topStrip).toFixed(0)} mm uncovered at the top edge and up to ${mm(s.sideStrip).toFixed(0)} mm at the row ends (${((1 - s.coverage) * 100).toFixed(1)}% of the screen). Nothing is stretched to close it.`,
      path: 'media.elevationUpperDeg',
    });
  if (p.family === '04-purpose-built-spherical')
    issues.push({ severity: 'info', code: 'led-tooling', message: `${name} panels are made for one sphere radius; ${s.unitTypes} panel types at R = ${c.sphere.radius.toFixed(2)} m. A different radius means new tooling.`, path: 'sphere.radius' });
  if (p.family === '05-custom-modular-spherical')
    issues.push({ severity: 'info', code: 'led-concept', message: `${name} is a concept. ${s.unitTypes} tile types; weight and power are scaled from a 0.4 m concept tile.`, path: 'led.productId' });

  const status = (v: { status: string }) => (v.status === 'manufacturer' ? 'derived' : v.status === 'conceptual' ? 'conceptual' : 'estimate') as Metric['quality'];
  const metrics: Metric[] = [
    { key: 'led.product', label: 'LED system', value: name, quality: status(p.cabinetWidth), group: 'LED' },
    { key: 'led.strategy', label: 'Panelization', value: STRATEGY_LABEL[s.strategy], quality: 'exact', group: 'LED' },
    { key: 'led.cabinets', label: tiles ? 'Tiles' : p.family === '03-flexible' ? 'Modules' : 'Cabinets', value: s.count, unit: 'count', quality: 'exact', group: 'LED' },
    { key: 'led.types', label: 'Unit types', value: s.unitTypes, unit: 'count', quality: 'exact', group: 'LED' },
    { key: 'led.coverage', label: 'Screen covered', value: `${(s.coverage * 100).toFixed(1)}%`, quality: 'derived', group: 'LED' },
    { key: 'led.resolution', label: 'Resolution (widest row × rows)', value: `${Math.round(s.resolutionH).toLocaleString()} × ${Math.round(s.resolutionV).toLocaleString()}`, quality: status(p.pixelPitch), group: 'LED' },
    { key: 'led.pixels', label: 'Pixels', value: Math.round(s.pixels), unit: 'px', quality: status(p.pixelPitch), group: 'LED' },
    { key: 'led.pitch', label: 'Pixel pitch', value: +(p.pixelPitch.value * 1000).toFixed(3), unit: '', quality: p.pixelPitch.status === 'manufacturer' ? 'exact' : 'conceptual', group: 'LED' },
    { key: 'led.weight', label: 'Weight (excl. structure)', value: s.weightKg, unit: 'kg', quality: status(p.weightKg), group: 'LED' },
    { key: 'led.power', label: 'Max power', value: s.powerMaxW, unit: 'W', quality: status(p.powerMaxW), group: 'LED' },
    { key: 'led.powerAvg', label: 'Average power', value: s.powerAvgW, unit: 'W', quality: status(p.powerAvgW), group: 'LED' },
    { key: 'led.deviation', label: 'Max deviation from sphere', value: s.maxDeviation, unit: 'm', quality: 'exact', group: 'LED' },
    { key: 'led.gap', label: 'Widest joint gap', value: s.maxGap, unit: 'm', quality: 'exact', group: 'LED' },
    { key: 'led.overlap', label: 'Deepest collision', value: s.maxOverlap, unit: 'm', quality: 'exact', group: 'LED' },
    { key: 'led.step', label: 'Largest face step', value: s.maxStep, unit: 'm', quality: 'exact', group: 'LED' },
    { key: 'led.joint', label: 'Joint angle needed (row / ring)', value: `${s.maxJointH.toFixed(2)}° / ${s.maxJointV.toFixed(2)}°`, quality: 'exact', group: 'LED' },
  ];
  return { objects, blocks: block ? [block] : [], metrics, issues, summary: s };
}
