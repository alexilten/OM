/**
 * Transformation engine (subsystem 6): kinetic assemblies, the seated → standing sequence, and
 * geometric collision checks along it.
 *
 * Every assembly moves along one explicit straight path, at constant speed, inside a fixed window
 * of the sequence. The sequence plays backwards for standing → seated, so the reverse is exact.
 * Nothing moves before the audience-clearance interlock. All machinery is conceptual: the checks are
 * geometric only, not engineering.
 *
 * Telescopic seating: each row block (between aisles) is a wagon carrying its deck, back riser and
 * seats. Seats fold, then every wagon slides outward along its block's centre line and nests under
 * the back row of that block, leaving `nestOffset` between wagons. A wagon only clears the deck above
 * if folded seats + deck fit within the riser, which the collision check verifies rather than assumes.
 */
import { ringOf, sphereRadiusAt } from './media';
import { onStage, sample, stageFootprint } from './stage';
import { carriageBox, carriageLegs, carriageOf, HALVES, halfId, halfSector, movesOnTimeline, prosceniumSector } from './proscenium';
import type { Geometry, Issue, Metric, SeatRecord, VenueConfiguration, VenueObject, Vec3 } from './types';

export type AssemblyKind = 'telescopic-wagon' | 'stage-lift' | 'proscenium';

export type Envelope =
  | { kind: 'sector'; center: [number, number]; r0: number; r1: number; a0: number; a1: number; z0: number; z1: number }
  /** `outline` (plan, closed) narrows the box to a shaped footprint, such as a deck joined to the screen. */
  | { kind: 'box'; min: Vec3; max: Vec3; outline?: [number, number][] };

export interface KineticAssembly {
  id: string;
  name: string;
  kind: AssemblyKind;
  memberIds: string[];
  /** Straight-line displacement from the seated to the standing state (m). */
  travel: Vec3;
  /** Motion window within the seated → standing sequence (s). */
  start: number;
  duration: number;
  row?: string;
  rowIndex?: number;
  block?: number;
  /** Space the assembly occupies while moving, at its seated position. */
  envelope: Envelope;
  /**
   * A path in straight legs run one after another (the proscenium: back, then aside). `travel`,
   * `start` and `duration` then cover the whole path.
   */
  legs?: { travel: Vec3; start: number; duration: number }[];
}

export interface TransitionStep {
  id: string;
  label: string;
  kind: 'interlock' | 'fold' | 'move' | 'lift';
  start: number;
  duration: number;
}

export interface KineticConflict {
  kind: 'collision' | 'screen';
  a: string;
  b?: string;
  t0: number;
  t1: number;
  message: string;
}

export interface TransformationModel {
  assemblies: KineticAssembly[];
  steps: TransitionStep[];
  /** Seated → standing duration (s); standing → seated plays the same sequence backwards. */
  duration: number;
  /** When the seats fold (s). */
  fold: { start: number; duration: number };
  conflicts: KineticConflict[];
  standing: { area: number; capacity: number };
  /** Object id → assembly id, for posing. */
  memberOf: Map<string, string>;
}

export interface Pose {
  offsets: Map<string, Vec3>;
  /** 0 = seats open, 1 = folded. */
  fold: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const PERSON_M2 = 0.5;
const SAMPLE_S = 1;

export function poseAt(tr: TransformationModel, t: number): Pose {
  const offsets = new Map<string, Vec3>();
  const at = (start: number, duration: number) => (duration > 0 ? clamp01((t - start) / duration) : t >= start ? 1 : 0);
  for (const a of tr.assemblies) {
    const d: Vec3 = [0, 0, 0];
    for (const leg of a.legs ?? [a]) {
      const k = at(leg.start, leg.duration);
      for (let i = 0; i < 3; i++) d[i] += leg.travel[i] * k;
    }
    offsets.set(a.id, d);
  }
  return { offsets, fold: tr.fold.duration > 0 ? clamp01((t - tr.fold.start) / tr.fold.duration) : t >= tr.fold.start ? 1 : 0 };
}

/** A posed copy of one geometry (translation only; machinery never rotates in this round). */
export function translateGeometry(g: Geometry, d: Vec3): Geometry {
  const p = (v: Vec3): Vec3 => [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
  switch (g.kind) {
    case 'point':
      return { ...g, p: p(g.p) };
    case 'line':
      return { ...g, a: p(g.a), b: p(g.b) };
    case 'polyline':
      return { ...g, points: g.points.map(p) };
    case 'spherePatch':
      return { ...g, offset: p(g.offset ?? [0, 0, 0]) };
    case 'box':
      return { ...g, min: p(g.min), max: p(g.max) };
    case 'annularSector':
      return { ...g, center: [g.center[0] + d[0], g.center[1] + d[1]], zBottom: g.zBottom + d[2], zTop: g.zTop + d[2] };
    case 'planProfile': {
      const q = (v: [number, number]): [number, number] => [v[0] + d[0], v[1] + d[1]];
      return { ...g, segments: g.segments.map((s) => (s.kind === 'line' ? { ...s, a: q(s.a), b: q(s.b) } : { ...s, center: q(s.center) })), zBottom: g.zBottom + d[2], zTop: g.zTop + d[2] };
    }
    case 'blockInstance':
    case 'frameBox':
      return { ...g, frame: { ...g.frame, origin: p(g.frame.origin) } };
    default:
      return g;
  }
}

/** Objects as they stand at the end of the sequence (or at any pose). */
export function posedObjects(objects: VenueObject[], tr: TransformationModel, pose: Pose): VenueObject[] {
  return objects.map((o) => {
    const a = tr.memberOf.get(o.id);
    const d = a ? pose.offsets.get(a) : undefined;
    return d && (d[0] || d[1] || d[2]) ? { ...o, geometry: translateGeometry(o.geometry, d) } : o;
  });
}

// ─── Envelope geometry ──────────────────────────────────────────────────────

/** Sector angles follow the seating convention: point = centre + (r·sin a, −r·cos a). */
function samplePoints(e: Envelope): [number, number][] {
  if (e.kind === 'box' && e.outline) return e.outline;
  if (e.kind === 'box')
    return [
      [e.min[0], e.min[1]],
      [e.max[0], e.min[1]],
      [e.max[0], e.max[1]],
      [e.min[0], e.max[1]],
      [(e.min[0] + e.max[0]) / 2, e.min[1]],
      [(e.min[0] + e.max[0]) / 2, e.max[1]],
      [e.min[0], (e.min[1] + e.max[1]) / 2],
      [e.max[0], (e.min[1] + e.max[1]) / 2],
    ];
  const pts: [number, number][] = [];
  const at = (r: number, a: number): [number, number] => [e.center[0] + r * Math.sin(a), e.center[1] - r * Math.cos(a)];
  const na = 12;
  const nr = 4;
  for (let i = 0; i <= na; i++) {
    const a = e.a0 + ((e.a1 - e.a0) * i) / na;
    pts.push(at(e.r0, a), at(e.r1, a));
  }
  for (let j = 1; j < nr; j++) {
    const r = e.r0 + ((e.r1 - e.r0) * j) / nr;
    pts.push(at(r, e.a0), at(r, e.a1));
  }
  return pts;
}

const TOUCH = 1e-3;

/** Machinery keeps at least this plan distance from the screen surface (m). */
export const SCREEN_GAP = 0.2;

function clearOfScreen(c: VenueConfiguration, e: Envelope, pts: [number, number][], d: Vec3): boolean {
  const [z0, z1] = zBand(e);
  const R = c.sphere.radius;
  // The screen stops at the main floor: below it (a lift going into its pit) there is nothing to clear.
  const f = c.floor.mainFloorElevation;
  if (z1 + d[2] <= f) return true;
  const limit = Math.min(sphereRadiusAt(R, Math.max(f, z0 + d[2]), ringOf(c)), sphereRadiusAt(R, z1 + d[2], ringOf(c))) - SCREEN_GAP;
  return pts.every(([x, y]) => Math.hypot(x + d[0], y + d[1]) <= limit + 1e-9);
}

function inside(e: Envelope, x: number, y: number): boolean {
  if (e.kind === 'box') return x > e.min[0] + TOUCH && x < e.max[0] - TOUCH && y > e.min[1] + TOUCH && y < e.max[1] - TOUCH && (!e.outline || inPolygon(e.outline, x, y));
  const dx = x - e.center[0];
  const dy = e.center[1] - y;
  const r = Math.hypot(dx, dy);
  if (r <= e.r0 + TOUCH || r >= e.r1 - TOUCH) return false;
  const a = Math.atan2(dx, dy);
  const tol = TOUCH / r;
  return a > e.a0 + tol && a < e.a1 - tol;
}

function inPolygon(pts: [number, number][], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const zBand = (e: Envelope): [number, number] => (e.kind === 'box' ? [e.min[2], e.max[2]] : [e.z0, e.z1]);

function overlapAt(a: KineticAssembly, da: Vec3, b: KineticAssembly, db: Vec3, pa: [number, number][], pb: [number, number][]): boolean {
  const [a0, a1] = zBand(a.envelope);
  const [b0, b1] = zBand(b.envelope);
  if (Math.min(a1 + da[2], b1 + db[2]) - Math.max(a0 + da[2], b0 + db[2]) <= 1e-6) return false;
  for (const [x, y] of pa) if (inside(b.envelope, x + da[0] - db[0], y + da[1] - db[1])) return true;
  for (const [x, y] of pb) if (inside(a.envelope, x + db[0] - da[0], y + db[1] - da[1])) return true;
  return false;
}

// ─── Generation ─────────────────────────────────────────────────────────────

export interface TransformationResult {
  model?: TransformationModel;
  objects: VenueObject[];
  metrics: Metric[];
  issues: Issue[];
}

const sectorOf = (o: VenueObject) => o.geometry as Extract<Geometry, { kind: 'annularSector' }>;

export function generateTransformation(c: VenueConfiguration, objects: VenueObject[], seats: SeatRecord[]): TransformationResult {
  const t = c.transformation;
  if (!t.enabled) return { objects: [], metrics: [], issues: [] };
  const s = c.seating;
  const floor = c.floor.mainFloorElevation;
  const assemblies: KineticAssembly[] = [];
  const telescopic = t.seating === 'telescopic';

  const t0 = t.clearanceHoldS;
  const moveStart = t0 + (telescopic ? t.foldS : 0);

  if (telescopic) {
    const byWagon = new Map<string, VenueObject[]>();
    for (const o of objects) if (o.parentAssembly?.startsWith('wagon.')) byWagon.set(o.parentAssembly, [...(byWagon.get(o.parentAssembly) ?? []), o]);
    const seatById = new Map(seats.map((x) => [x.id, x]));
    const lastRowOfBlock = new Map<number, number>();
    for (const x of seats) lastRowOfBlock.set(x.block, Math.max(lastRowOfBlock.get(x.block) ?? 0, x.rowIndex));

    for (const [id, members] of byWagon) {
      const memberSeats = members.map((m) => seatById.get(m.id)).filter((x): x is SeatRecord => !!x);
      if (!memberSeats.length) continue;
      const { rowIndex: i, row, block } = memberSeats[0];
      const r = s.frontRowRadius + i * s.rowPitch;
      const z = floor + i * s.riserHeight;
      const deck = members.find((m) => m.category === 'SeatingTier');
      const riser = members.find((m) => m.category === 'SeatingRiser');
      let a0: number;
      let a1: number;
      if (deck) ({ angle0: a0, angle1: a1 } = sectorOf(deck));
      else {
        const alphas = memberSeats.map((x) => Math.atan2(x.position[0], s.focusY - x.position[1]));
        const margin = (0.3 + 0.3) / r;
        a0 = Math.min(...alphas) - margin;
        a1 = Math.max(...alphas) + margin;
      }
      const top = Math.max(z + t.foldedSeatHeight, riser ? sectorOf(riser).zTop : -Infinity);
      const envelope: Envelope = { kind: 'sector', center: [0, s.focusY], r0: r - s.rowPitch / 2, r1: r + s.rowPitch / 2, a0, a1, z0: deck ? z - t.deckThickness : floor, z1: top };
      const beta = (a0 + a1) / 2;
      const nests = (lastRowOfBlock.get(block) ?? i) - i;
      // Nest under the back row, but stop short where the block's outer corners would reach the screen
      // (back rows lose seats near the sphere, so the back row can be narrower than this wagon).
      const dir: Vec3 = [Math.sin(beta), -Math.cos(beta), 0];
      const fitsAt = (d: number) => clearOfScreen(c, envelope, samplePoints(envelope), [dir[0] * d, dir[1] * d, 0]);
      let dist = nests * (s.rowPitch - t.nestOffset);
      if (!fitsAt(dist)) {
        let lo = 0;
        let hi = dist;
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2;
          if (fitsAt(mid)) lo = mid;
          else hi = mid;
        }
        dist = lo;
      }
      const eyes = objects.filter((o) => o.category === 'EyePoint' && memberSeats.some((x) => x.id === o.parentAssembly)).map((o) => o.id);
      assemblies.push({
        id,
        name: `Wagon ${row}${block + 1}`,
        kind: 'telescopic-wagon',
        memberIds: [...members.map((m) => m.id), ...eyes],
        travel: [dir[0] * dist, dir[1] * dist, 0],
        start: moveStart,
        duration: dist / t.wagonSpeed,
        row,
        rowIndex: i,
        block,
        envelope,
      });
    }
  }

  const stage = objects.filter((o) => o.layer.startsWith('03_STAGE'));
  const deck = stage.find((o) => o.id === 'stage.main');
  if (t.stage === 'lift' && deck && c.stage.height > 0) {
    // The lift envelope is the deck's plan bounds (the joined deck's arcs stay inside them).
    const fp = stageFootprint(c);
    const g = { min: [fp.min[0], fp.min[1], c.floor.mainFloorElevation] as Vec3, max: [fp.max[0], fp.max[1], c.floor.mainFloorElevation + c.stage.height] as Vec3, outline: fp.attached ? sample(fp.segments) : undefined };
    assemblies.push({
      id: 'lift.stage',
      name: 'Stage lift',
      kind: 'stage-lift',
      memberIds: stage.map((o) => o.id),
      travel: [0, 0, -c.stage.height],
      start: moveStart,
      duration: c.stage.height / t.stageSpeed,
      envelope: { kind: 'box', min: g.min, max: g.max, outline: g.outline },
    });
  }

  // The proscenium halves push straight back once the house is clear (alongside the seat fold), then
  // slide apart.
  const sector = prosceniumSector(c);
  const pr = t.proscenium;
  if (sector && movesOnTimeline(c))
    for (const h of HALVES) {
      const { push, slide } = carriageLegs(c, sector, h);
      if (!push[1] && !slide[0]) continue;
      const box = carriageBox(c, halfSector(sector, h));
      const pushS = push[1] / pr.speed;
      const legs = [
        { travel: push, start: t0, duration: pushS },
        { travel: slide, start: t0 + pushS, duration: Math.abs(slide[0]) / pr.speed },
      ];
      assemblies.push({
        id: halfId(h),
        name: `Proscenium ${h} half`,
        kind: 'proscenium',
        memberIds: objects.filter((o) => carriageOf(sector, o) === h).map((o) => o.id),
        travel: [slide[0], push[1], 0],
        start: t0,
        duration: legs[0].duration + legs[1].duration,
        envelope: { kind: 'box', min: box.min, max: box.max },
        legs,
      });
    }

  const memberOf = new Map<string, string>();
  for (const a of assemblies) for (const m of a.memberIds) memberOf.set(m, a.id);
  const moveEnd = Math.max(moveStart, ...assemblies.map((a) => a.start + a.duration));
  const wagons = assemblies.filter((a) => a.kind === 'telescopic-wagon');
  const longest = wagons.reduce((m, a) => Math.max(m, a.duration), 0);
  const lift = assemblies.find((a) => a.kind === 'stage-lift');
  const prosc = assemblies.find((a) => a.kind === 'proscenium');
  const proscSlide = prosc?.legs?.[1];
  const steps: TransitionStep[] = [
    { id: 'interlock', label: 'Audience cleared from all moving zones (interlock)', kind: 'interlock', start: 0, duration: t0 },
    ...(telescopic ? [{ id: 'fold', label: 'Seats fold', kind: 'fold' as const, start: t0, duration: t.foldS }] : []),
    ...(longest > 0 ? [{ id: 'move', label: 'Wagons nest under the back rows', kind: 'move' as const, start: moveStart, duration: longest }] : []),
    ...(lift ? [{ id: 'lift', label: 'Stage lowers flush with the floor', kind: 'lift' as const, start: lift.start, duration: lift.duration }] : []),
    ...(prosc?.legs?.[0].duration ? [{ id: 'proscenium', label: 'Proscenium screen pushes back', kind: 'move' as const, start: prosc.start, duration: prosc.legs[0].duration }] : []),
    ...(proscSlide?.duration ? [{ id: 'proscenium-slide', label: 'Proscenium halves slide apart', kind: 'move' as const, start: proscSlide.start, duration: proscSlide.duration }] : []),
  ];
  steps.sort((a, b) => a.start - b.start);

  const tr: TransformationModel = {
    assemblies,
    steps,
    duration: moveEnd,
    fold: { start: t0, duration: telescopic ? t.foldS : 0 },
    conflicts: [],
    standing: { area: 0, capacity: 0 },
    memberOf,
  };

  tr.conflicts = checkConflicts(c, tr);
  tr.standing = standingArea(c, tr);

  // Plan path of every moving assembly, and where the wagons end up.
  const out: VenueObject[] = [];
  for (const a of assemblies) {
    if (!(a.travel[0] || a.travel[1] || a.travel[2])) continue;
    const from: Vec3 =
      a.envelope.kind === 'sector'
        ? (() => {
            const e = a.envelope;
            const rm = (e.r0 + e.r1) / 2;
            const am = (e.a0 + e.a1) / 2;
            return [e.center[0] + rm * Math.sin(am), e.center[1] - rm * Math.cos(am), e.z0];
          })()
        : [(a.envelope.min[0] + a.envelope.max[0]) / 2, (a.envelope.min[1] + a.envelope.max[1]) / 2, a.envelope.max[2]];
    out.push({
      id: `path.${a.id}`,
      name: `Path_${a.name.replace(/\s+/g, '_')}`,
      layer: '04_TRANSFORMATION/Movement_Envelopes',
      category: 'MotionPath',
      geometry: a.legs
        ? { kind: 'polyline', points: a.legs.reduce((pts, l) => [...pts, pts[pts.length - 1].map((v, i) => v + l.travel[i]) as Vec3], [from]), closed: false }
        : { kind: 'line', a: from, b: [from[0] + a.travel[0], from[1] + a.travel[1], from[2] + a.travel[2]] },
      operatingState: 'all',
      metadata: {
        assembly: a.id,
        kind: a.kind,
        travel_m: +(a.legs ? a.legs.reduce((m, l) => m + Math.hypot(...l.travel), 0) : Math.hypot(...a.travel)).toFixed(4),
        start_s: +a.start.toFixed(2),
        duration_s: +a.duration.toFixed(2),
        status: 'conceptual (not engineered)',
      },
    });
  }
  if (lift && lift.envelope.kind === 'box') {
    const { min, max } = lift.envelope;
    const deck = objects.find((o) => o.id === 'stage.main');
    // The pit follows the deck outline, one deck height below the floor.
    const pit: Geometry =
      deck?.geometry.kind === 'planProfile'
        ? { ...deck.geometry, zBottom: min[2] - c.stage.height, zTop: min[2] }
        : { kind: 'box', min: [min[0], min[1], min[2] - c.stage.height], max: [max[0], max[1], min[2]] };
    out.push({
      id: 'pit.stage',
      name: 'Stage_Lift_Pit',
      layer: '04_TRANSFORMATION/Storage_Volumes',
      category: 'StorageVolume',
      geometry: pit,
      operatingState: 'standing',
      metadata: { assembly: lift.id, depth_m: c.stage.height, status: 'conceptual (not engineered)' },
    });
  }

  const issues: Issue[] = [];
  // One warning per kind keeps the issue list readable; the TRANSFORM workspace lists every conflict.
  for (const kind of ['collision', 'screen'] as const) {
    const ks = tr.conflicts.filter((k) => k.kind === kind);
    if (ks.length)
      issues.push({
        severity: 'warning',
        code: `kin-${kind}`,
        message: ks.length === 1 ? ks[0].message : `${ks.length} motion conflicts, e.g. ${ks[0].message}`,
        path: kind === 'collision' ? 'transformation.foldedSeatHeight' : 'seating.screenClearance',
      });
  }
  issues.push({ severity: 'info', code: 'kin-concept', message: 'Transformation machinery is conceptual: paths and collisions are geometric only, not engineered, certified or approved by any manufacturer.', path: 'transformation' });

  const mmss = (sec: number) => `${Math.floor(sec / 60)} min ${String(Math.round(sec % 60)).padStart(2, '0')} s`;
  const metrics: Metric[] = [
    { key: 'kin.duration', label: 'Seated → standing time', value: mmss(tr.duration), quality: 'conceptual', group: 'Transformation' },
    { key: 'kin.assemblies', label: 'Moving assemblies', value: assemblies.filter((a) => a.duration > 0).length, unit: 'count', quality: 'exact', group: 'Transformation' },
    { key: 'kin.conflicts', label: 'Motion conflicts', value: tr.conflicts.length, unit: 'count', quality: 'derived', group: 'Transformation' },
    { key: 'kin.standingArea', label: 'Clear floor when standing', value: tr.standing.area, unit: 'm2', quality: 'derived', group: 'Transformation' },
  ];
  return { model: tr, objects: out, metrics, issues };
}

function checkConflicts(c: VenueConfiguration, tr: TransformationModel): KineticConflict[] {
  // The proscenium carriage is the screen itself; proscenium.ts checks its path against the venue.
  const moving = tr.assemblies.filter((a) => a.kind !== 'proscenium');
  if (!moving.length) return [];
  const pts = new Map(moving.map((a) => [a.id, samplePoints(a.envelope)]));
  const start = Math.min(...moving.map((a) => a.start));
  const times: number[] = [];
  for (let t = start; t < tr.duration; t += SAMPLE_S) times.push(t);
  times.push(tr.duration);

  // Prune once: bounding circles in plan, and pairs whose height bands can ever meet (only lifts move vertically).
  const circles = moving.map((a) => {
    const p = pts.get(a.id)!;
    const x = p.reduce((m, q) => m + q[0], 0) / p.length;
    const y = p.reduce((m, q) => m + q[1], 0) / p.length;
    return { x, y, r: Math.max(...p.map((q) => Math.hypot(q[0] - x, q[1] - y))) + TOUCH };
  });
  const pairs: [number, number][] = [];
  for (let i = 0; i < moving.length; i++)
    for (let j = i + 1; j < moving.length; j++) {
      const [a0, a1] = zBand(moving[i].envelope);
      const [b0, b1] = zBand(moving[j].envelope);
      const reach = Math.abs(moving[i].travel[2]) + Math.abs(moving[j].travel[2]);
      if (Math.min(a1, b1) - Math.max(a0, b0) + reach > 1e-6) pairs.push([i, j]);
    }

  const open = new Map<string, KineticConflict>();
  const done: KineticConflict[] = [];
  for (const t of times) {
    const pose = poseAt(tr, t);
    const seen = new Set<string>();
    for (const a of moving) {
      const da = pose.offsets.get(a.id)!;
      // Screen: the moving envelope keeps SCREEN_GAP from the sphere at every height it occupies.
      if ((da[0] || da[1] || da[2]) && !clearOfScreen(c, a.envelope, pts.get(a.id)!, da)) seen.add(`screen|${a.id}`);
    }
    for (const [i, j] of pairs) {
      const a = moving[i];
      const b = moving[j];
      const da = pose.offsets.get(a.id)!;
      const db = pose.offsets.get(b.id)!;
      // Pairs that do not move relative to each other were checked by the seated layout itself.
      if (da[0] === db[0] && da[1] === db[1] && da[2] === db[2]) continue;
      const ca = circles[i];
      const cb = circles[j];
      if (Math.hypot(ca.x + da[0] - cb.x - db[0], ca.y + da[1] - cb.y - db[1]) >= ca.r + cb.r) continue;
      if (overlapAt(a, da, b, db, pts.get(a.id)!, pts.get(b.id)!)) seen.add(`collision|${a.id}|${b.id}`);
    }
    for (const key of seen) {
      const k = open.get(key);
      if (k) k.t1 = t;
      else {
        const [kind, a, b] = key.split('|');
        open.set(key, { kind: kind as KineticConflict['kind'], a, b, t0: t, t1: t, message: '' });
      }
    }
    for (const [key, k] of open)
      if (!seen.has(key)) {
        done.push(k);
        open.delete(key);
      }
  }
  done.push(...open.values());

  const name = (id: string) => tr.assemblies.find((a) => a.id === id)?.name ?? id;
  const t = c.transformation;
  for (const k of done) {
    const when = `between ${Math.round(k.t0)} s and ${Math.round(k.t1)} s`;
    if (k.kind === 'screen') k.message = `${name(k.a)} comes within ${SCREEN_GAP * 1000} mm of the screen ${when}.`;
    else {
      const a = tr.assemblies.find((x) => x.id === k.a)!;
      const b = tr.assemblies.find((x) => x.id === k.b)!;
      const nb = name(b.id);
      const wagons = a.kind === 'telescopic-wagon' && b.kind === 'telescopic-wagon';
      const need = t.foldedSeatHeight + t.deckThickness;
      k.message =
        wagons && c.seating.riserHeight < need
          ? `${name(k.a)} and ${nb} collide ${when}: folded seats plus deck need ${(need * 1000).toFixed(0)} mm under the next deck, the riser gives ${(c.seating.riserHeight * 1000).toFixed(0)} mm.`
          : `${name(k.a)} and ${nb} collide ${when}.`;
    }
  }
  return done.sort((x, y) => x.t0 - y.t0);
}

/** Clear floor at the end of the sequence, on a 0.25 m grid inside the screen clearance. */
function standingArea(c: VenueConfiguration, tr: TransformationModel) {
  const floor = c.floor.mainFloorElevation;
  const radius = sphereRadiusAt(c.sphere.radius, floor, ringOf(c)) - c.seating.screenClearance;
  const pose = poseAt(tr, tr.duration);
  const cell = 0.25;
  const obstacles: { e: Envelope; d: Vec3 }[] = [];
  if (c.transformation.seating === 'telescopic') for (const a of tr.assemblies) if (a.kind === 'telescopic-wagon') obstacles.push({ e: a.envelope, d: pose.offsets.get(a.id)! });
  if (c.transformation.seating === 'fixed') {
    const s = c.seating;
    const A = (s.sectionAngleDeg * Math.PI) / 180;
    const r0 = s.frontRowRadius - s.rowPitch / 2;
    obstacles.push({ e: { kind: 'sector', center: [0, s.focusY], r0, r1: r0 + s.rowCount * s.rowPitch, a0: -A / 2, a1: A / 2, z0: floor, z1: floor + 1 }, d: [0, 0, 0] });
  }
  const liftsFlush = tr.assemblies.some((a) => a.kind === 'stage-lift');
  const deck = stageFootprint(c);
  let n = 0;
  if (radius > 0)
    for (let x = -radius + cell / 2; x < radius; x += cell)
      for (let y = -radius + cell / 2; y < radius; y += cell) {
        if (x * x + y * y > radius * radius) continue;
        if (!liftsFlush && onStage(deck, x, y)) continue;
        if (obstacles.some(({ e, d }) => inside(e, x - d[0], y - d[1]))) continue;
        n++;
      }
  const area = n * cell * cell;
  return { area, capacity: Math.floor(area / PERSON_M2) };
}
