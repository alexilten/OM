/**
 * Fit-out and immersion systems (Round 06). Reads the catalog choices and system settings and places
 * conceptual units (fixtures, speakers, hoists, hazers, cameras) as block instances on their layers,
 * so they can be counted, costed and later hung from the Round 07 structure. Positions follow simple
 * placement rules, not a lighting or acoustic design; every cost and most weights are placeholders.
 */
import { getAudioProduct, getCatalogItem, getSystem, SYSTEMS, type SystemUnit } from '../library/catalog';
import { cross, normalize, scale, spherePoint, sub, toRad, toSpherical, add, dot } from './coordinates';
import { mediaBounds, sphereRadiusAt } from './media';
import type { BlockDefinition, Frame, Issue, Metric, SeatRecord, SystemId, Tier, VenueConfiguration, VenueObject, Vec3 } from './types';

export interface UnitTally {
  unitId: string;
  name: string;
  count: number;
  cost: number;
  weight: number;
  power: number;
}

export interface SystemSummary {
  id: SystemId;
  label: string;
  tier: Tier;
  product?: string;
  units: UnitTally[];
  count: number;
  /** W, kg and USD totals; costs are placeholders. */
  power: number;
  weight: number;
  cost: number;
}

export interface FitoutSummary {
  deckArea: number;
  guardrailLength: number;
  accessories: number;
  cost: number;
  weight: number;
  power: number;
}

export interface SystemsSummary {
  systems: SystemSummary[];
  fitout: FitoutSummary;
  /** Rigging pick-up points and the load they carry (kg), for the Round 07 structure. */
  pickPoints: number;
  pickLoad: number;
  /** Share of the media solid angle hidden by overhead rigging, seen from the reference eye. */
  occlusion: number;
  totals: { count: number; power: number; weight: number; cost: number };
}

const RIGGING = '05_TECHNICAL/Rigging';
const RINGS: Record<Tier, number[]> = { standard: [8], premium: [5, 30, 55], flagship: [0, 22, 44, 66] };
const SUBS: Record<Tier, number> = { standard: 4, premium: 8, flagship: 12 };
const WASH_RING: Record<Tier, number> = { standard: 12, premium: 18, flagship: 24 };
const HAPTICS_PER_SEAT: Record<Tier, number> = { standard: 1, premium: 1, flagship: 2 };
const ATMOS: Record<string, Partial<Record<Tier, number>>> = { 'atm-haze': { standard: 2, premium: 4, flagship: 6 }, 'atm-fog': { premium: 2, flagship: 4 }, 'atm-scent': { flagship: 6 } };
const TRACKING: Record<string, Partial<Record<Tier, number>>> = { 'trk-cam': { standard: 4, premium: 8, flagship: 12 }, 'trk-depth': { flagship: 8 } };

const Z: Vec3 = [0, 0, 1];
const blockIdOf = (system: SystemId, unit: SystemUnit) => `block.sys.${system}.${unit.id}`;

/** Local frame at `origin` whose +Y faces `target` and +Z stays as close to up as possible. */
export function facingFrame(origin: Vec3, target: Vec3): Frame {
  const y = normalize(sub(target, origin));
  const up = Math.abs(dot(y, Z)) > 0.99 ? normalize([origin[0] || 1e-9, origin[1], 0]) : Z;
  const z = normalize(sub(up, scale(y, dot(up, y))));
  return { origin, xAxis: cross(y, z), yAxis: y, zAxis: z };
}

/** Points spaced evenly (half a step in from the start) along a closed polyline. */
function alongClosed(points: Vec3[], n: number, phase = 0.5): Vec3[] {
  const segs = points.map((p, i) => [p, points[(i + 1) % points.length]] as const);
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  const total = lens.reduce((s, l) => s + l, 0);
  return Array.from({ length: n }, (_, k) => {
    let d = ((k + phase) / n) * total;
    let i = 0;
    while (d > lens[i] && i < lens.length - 1) d -= lens[i++];
    const [a, b] = segs[i];
    const t = d / lens[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  });
}

const circlePoints = (r: number, z: number, n: number, phase = 0): Vec3[] => Array.from({ length: n }, (_, k) => [r * Math.sin(((k + phase) / n) * 2 * Math.PI), r * Math.cos(((k + phase) / n) * 2 * Math.PI), z]);

/** Plan distance of the farthest corner of a rectangle about (0, cy). */
const rectReach = (hx: number, cy: number, hy: number) => Math.max(Math.hypot(hx, cy - hy), Math.hypot(hx, cy + hy));

export function generateSystems(c: VenueConfiguration, objects: VenueObject[], seats: SeatRecord[]) {
  const out: VenueObject[] = [];
  const blocks = new Map<string, BlockDefinition>();
  const issues: Issue[] = [];
  const tallies = new Map<SystemId, Map<string, UnitTally>>();
  const R = c.sphere.radius;
  const f = c.floor.mainFloorElevation;
  const mb = mediaBounds(R, c.media);
  let occlusion = 0;
  let pickPoints = 0;
  let pickLoad = 0;

  const tally = (system: SystemId, unit: SystemUnit, n: number) => {
    const t = tallies.get(system) ?? new Map<string, UnitTally>();
    tallies.set(system, t);
    const u = t.get(unit.id) ?? { unitId: unit.id, name: unit.name, count: 0, cost: 0, weight: 0, power: 0 };
    u.count += n;
    u.cost += n * unit.cost.value;
    u.weight += n * unit.weight.value;
    u.power += n * unit.power.value;
    t.set(unit.id, u);
  };

  const place = (system: SystemId, unit: SystemUnit, layer: string, category: string, frame: Frame, extra: Record<string, string | number> = {}) => {
    const blockId = blockIdOf(system, unit);
    if (!blocks.has(blockId)) {
      const [w, d, h] = unit.size;
      blocks.set(blockId, {
        id: blockId,
        name: `SYS_${unit.name}`.replace(/[^A-Za-z0-9_]+/g, '_'),
        description: `${unit.name}: proxy box ${(w * 1000).toFixed(0)} × ${(d * 1000).toFixed(0)} × ${(h * 1000).toFixed(0)} mm, front face on local +Y.`,
        parts: [{ role: `system-${system}`, geometry: { kind: 'box', min: [-w / 2, -d / 2, 0], max: [w / 2, d / 2, h] } }],
        metadata: { system, unit: unit.id, weight_kg: unit.weight.value, weight_status: unit.weight.status, power_w: unit.power.value, power_status: unit.power.status, cost_usd: unit.cost.value, cost_status: unit.cost.status, geometry_note: 'Proxy massing, not the manufacturer model' },
      });
    }
    const k = out.filter((o) => o.metadata.unit === unit.id && o.metadata.system === system).length;
    const o = frame.origin;
    out.push({
      id: `sys.${system}.${unit.id}.${k}`,
      name: `${unit.name.replace(/[^A-Za-z0-9]+/g, '_')}_${k + 1}`,
      layer,
      category,
      geometry: { kind: 'blockInstance', blockId, frame },
      operatingState: 'all',
      metadata: { system, unit: unit.id, tier: c.systems[system].tier, x: +o[0].toFixed(4), y: +o[1].toFixed(4), z: +o[2].toFixed(4), status: 'conceptual', ...extra },
    });
    tally(system, unit, 1);
  };

  const n = (system: SystemId, base: number) => Math.max(1, Math.round(base * c.systems[system].scale));

  /** Adds the solid angle an overhead object hides from the reference eye, when it sits in front of the screen. */
  const occlude = (p: Vec3, area: number) => {
    const [d, az, el] = toSpherical(p);
    if (d < R && az >= mb.az0 && az <= mb.az1 && el >= mb.el0 && el <= mb.el1) occlusion += area / (d * d);
  };

  // ── Lighting ──────────────────────────────────────────────────────────────
  const L = c.systems.lighting;
  if (L.enabled) {
    const spec = getSystem('lighting').tiers[L.tier];
    const unitOf = (id: string) => spec.units.find((u) => u.id === id);
    const truss = unitOf('truss')!;
    const hoist = unitOf('hoist')!;
    const lightLayer = getSystem('lighting').layer;
    const deckTop = f + c.stage.height;
    const st = c.stage;
    // Stage truss: 0.5 m outside the stage edge, 5.5 m above the deck, shrunk to stay inside the sphere.
    const tz = Math.min(deckTop + 5.5, R * 0.8);
    const limit = sphereRadiusAt(R, tz) - 0.5;
    let hx = st.width / 2 + 0.5;
    let hy = st.depth / 2 + 0.5;
    if (rectReach(hx, st.centerY, hy) > limit) {
      let lo = 0.1;
      let hi = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (rectReach(hx * mid, st.centerY, hy * mid) <= limit) lo = mid;
        else hi = mid;
      }
      hx *= lo;
      hy *= lo;
      issues.push({ severity: 'info', code: 'truss-shrunk', message: `The stage truss was reduced to ${(2 * hx).toFixed(1)} × ${(2 * hy).toFixed(1)} m to stay inside the sphere.`, path: 'systems.lighting' });
    }
    const rect: Vec3[] = [
      [-hx, st.centerY - hy, tz],
      [hx, st.centerY - hy, tz],
      [hx, st.centerY + hy, tz],
      [-hx, st.centerY + hy, tz],
    ];
    const perimeter = 4 * (hx + hy);
    const stageTarget: Vec3 = [0, st.centerY, deckTop];
    let rigLoad = 0;
    out.push({ id: 'sys.lighting.truss.stage', name: 'Stage_Truss', layer: RIGGING, category: 'Truss', geometry: { kind: 'polyline', points: rect, closed: true }, operatingState: 'all', metadata: { system: 'lighting', unit: truss.id, length_m: +perimeter.toFixed(3), z: +tz.toFixed(4), status: 'conceptual' } });
    tally('lighting', truss, perimeter);
    rigLoad += perimeter * truss.weight.value;
    for (let i = 0; i < 4; i++) for (let s = 0; s * 0.5 < (i % 2 ? 2 * hy : 2 * hx); s++) {
      const a = rect[i];
      const b = rect[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = Math.min(1, (s * 0.5 + 0.25) / len);
      occlude([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, tz], 0.5 * truss.size[2]);
    }
    const hang = (unit: SystemUnit, points: Vec3[], target: (p: Vec3) => Vec3, layer: string, category: string) =>
      points.forEach((p) => {
        const o: Vec3 = [p[0], p[1], p[2] - 0.25 - unit.size[2]];
        place('lighting', unit, layer, category, facingFrame(o, [target(o)[0], target(o)[1], o[2]]));
        occlude(o, unit.size[0] * unit.size[2]);
        rigLoad += unit.weight.value;
      });
    const spot = unitOf('fx-spot');
    const wash = unitOf('fx-wash')!;
    if (spot) hang(spot, alongClosed(rect, n('lighting', perimeter / 1.5)), () => stageTarget, lightLayer, 'LightingFixture');
    hang(wash, alongClosed(rect, n('lighting', perimeter / (spot ? 2.5 : 2))), () => stageTarget, lightLayer, 'LightingFixture');
    const trussHoists = Math.max(4, Math.ceil(perimeter / 6));
    alongClosed(rect, trussHoists, 0).forEach((p) => place('lighting', hoist, RIGGING, 'Hoist', facingFrame([p[0], p[1], p[2] + 0.25], [0, 0, p[2] + 0.25]), { pick_load_kg: +(rigLoad / trussHoists).toFixed(1), rig: 'stage truss' }));
    pickPoints += trussHoists;
    pickLoad += rigLoad;

    // Wash ring at the screen base, just inside the sphere, lighting the room and the audience.
    const wz = f + 0.3;
    const wr = sphereRadiusAt(R, wz) - 0.8;
    const nw = n('lighting', WASH_RING[L.tier]);
    for (let k = 0; k < nw; k++) {
      const az = mb.az0 + ((k + 0.5) / nw) * (mb.az1 - mb.az0);
      const o: Vec3 = [wr * Math.sin(az), wr * Math.cos(az), wz];
      place('lighting', wash, lightLayer, 'LightingFixture', facingFrame(o, [0, 0, wz]), { rig: 'base ring' });
    }

    // Flagship halo: a ring hung in the oculus above the screen's top edge, with movers and lasers.
    const laser = unitOf('fx-laser');
    if (laser && spot) {
      const hz = Math.min(R * Math.sin(mb.el1), R * 0.95);
      const hr = Math.max(1.5, Math.min(0.75 * R * Math.cos(mb.el1), sphereRadiusAt(R, hz) - 1));
      const circ = 2 * Math.PI * hr;
      out.push({ id: 'sys.lighting.truss.halo', name: 'Halo_Truss', layer: RIGGING, category: 'Truss', geometry: { kind: 'circle', center: [0, 0, hz], normal: Z, radius: hr }, operatingState: 'all', metadata: { system: 'lighting', unit: truss.id, length_m: +circ.toFixed(3), z: +hz.toFixed(4), status: 'conceptual' } });
      tally('lighting', truss, circ);
      let haloLoad = circ * truss.weight.value;
      circlePoints(hr, hz, Math.max(8, Math.ceil(circ / 0.5))).forEach((p) => occlude(p, (circ / Math.max(8, Math.ceil(circ / 0.5))) * truss.size[2]));
      const down = (p: Vec3): Vec3 => [p[0] * 0.3, p[1] * 0.3, f];
      for (const [unit, count, phase] of [[spot, n('lighting', 12), 0.5], [laser, n('lighting', 6), 0.25]] as const)
        circlePoints(hr, hz, count, phase).forEach((p) => {
          const o: Vec3 = [p[0], p[1], p[2] - 0.25 - unit.size[2]];
          place('lighting', unit, lightLayer, 'LightingFixture', facingFrame(o, down(o)), { rig: 'halo' });
          occlude(o, unit.size[0] * unit.size[2]);
          haloLoad += unit.weight.value;
        });
      const haloHoists = Math.max(4, Math.ceil(circ / 6));
      circlePoints(hr, hz + 0.25, haloHoists).forEach((p) => place('lighting', hoist, RIGGING, 'Hoist', facingFrame(p, [0, 0, p[2]]), { pick_load_kg: +(haloLoad / haloHoists).toFixed(1), rig: 'halo' }));
      pickPoints += haloHoists;
      pickLoad += haloLoad;
    }
  }

  // ── Immersive audio ───────────────────────────────────────────────────────
  const A = c.systems.audio;
  const product = getAudioProduct(A.product ?? '');
  if (A.enabled && product) {
    const layer = getSystem('audio').layer;
    const main = product.main;
    const [, depth, h] = main.size;
    const modules = product.family === 'matrix' ? product.modulesPerPosition[A.tier] : 1;
    const gap = 0.35;
    const rc = R + gap + depth / 2;
    if (gap + depth > c.envelope.serviceZone)
      issues.push({ severity: 'warning', code: 'audio-service-zone', message: `${main.name} arrays need ${(gap + depth).toFixed(2)} m behind the screen; the service zone is ${c.envelope.serviceZone.toFixed(2)} m.`, path: 'envelope.serviceZone' });
    const halfAngle = (modules * h) / 2 / rc;
    const rings = RINGS[A.tier].map(toRad).filter((e) => e - halfAngle >= mb.el0 && e + halfAngle <= mb.el1);
    if (!rings.length) issues.push({ severity: 'warning', code: 'audio-no-rings', message: 'No array ring fits inside the media surface; widen its elevation range.', path: 'media' });
    let positions = 0;
    for (const [ri, e] of rings.entries()) {
      const count = Math.max(2, Math.round(product.positionsPerRing[A.tier] * A.scale * Math.cos(e)));
      for (let k = 0; k < count; k++) {
        const az = mb.az0 + ((k + 0.5) / count) * (mb.az1 - mb.az0);
        const centre = spherePoint(rc, az, e);
        const frame = facingFrame(centre, [0, 0, 0]);
        for (let m = 0; m < modules; m++) {
          const origin = add(centre, scale(frame.zAxis, (m - modules / 2) * h));
          place('audio', main, layer, 'Speaker', { ...frame, origin }, { ring: ri, position: positions, module: m, product: product.label, front_radius_m: +(R + gap).toFixed(4) });
        }
        positions++;
      }
    }
    // Flagship zenith array, hung on the axis in the oculus (or behind a closed dome) and aimed down.
    if (A.tier === 'flagship') {
      const closed = mb.el1 > toRad(88);
      const zz = closed ? R + gap : R * Math.sin(mb.el1) + 0.5;
      const nz = Math.max(3, Math.round(4 * A.scale));
      circlePoints(0.8, zz, nz).forEach((p) => {
        const frame = facingFrame(p, [p[0] * 2, p[1] * 2, f]);
        for (let m = 0; m < modules; m++) place('audio', main, layer, 'Speaker', { ...frame, origin: add(p, scale(frame.zAxis, (m - modules / 2) * h)) }, { ring: 'zenith', position: positions, module: m, product: product.label });
        positions++;
      });
      if (!closed) pickPoints += nz;
    }
    // Subwoofers on the floor behind the screen base.
    const ns = n('audio', SUBS[A.tier]);
    const sr = sphereRadiusAt(R, f) + gap + product.sub.size[1] / 2;
    for (let k = 0; k < ns; k++) {
      const az = mb.az0 + ((k + 0.5) / ns) * (mb.az1 - mb.az0);
      const o: Vec3 = [sr * Math.sin(az), sr * Math.cos(az), f];
      place('audio', product.sub, layer, 'Subwoofer', facingFrame(o, [0, 0, f]), { product: product.label });
    }
    const flown = out.filter((o) => o.category === 'Speaker');
    pickLoad += flown.length * main.weight.value;
    pickPoints += product.family === 'matrix' ? positions : Math.ceil(positions / 2);
    issues.push({ severity: 'info', code: 'audio-transparent-screen', message: 'Speakers sit behind the media surface: the LED screen must be acoustically transparent (perforated or open-frame). Confirm transmission loss with the LED supplier.', path: 'systems.audio' });
  }

  // ── Haptics (metrics only: seats carry the transducers) ──────────────────
  const H = c.systems.haptics;
  if (H.enabled) {
    tally('haptics', getSystem('haptics').tiers[H.tier].units[0], Math.round(seats.length * HAPTICS_PER_SEAT[H.tier] * H.scale));
    if (H.tier === 'flagship' && c.transformation.enabled && c.transformation.seating === 'telescopic')
      issues.push({ severity: 'warning', code: 'haptics-telescopic', message: 'Flagship motion seats cannot fold, so they cannot nest in telescopic wagons. Choose fixed seating or a lower haptics tier.', path: 'systems.haptics.tier' });
  }

  // ── Atmospherics: on a floor ring inside the screen base ─────────────────
  const AT = c.systems.atmospherics;
  if (AT.enabled) {
    const units = getSystem('atmospherics').tiers[AT.tier].units.flatMap((u) => Array.from({ length: ATMOS[u.id][AT.tier] ? n('atmospherics', ATMOS[u.id][AT.tier]!) : 0 }, () => u));
    const r = sphereRadiusAt(R, f) - 0.6;
    circlePoints(r, f, units.length, 0.5).forEach((p, k) => place('atmospherics', units[k], getSystem('atmospherics').layer, 'Atmospherics', facingFrame(p, [0, 0, f])));
  }

  // ── Tracking: cameras on the front arc, aimed at the audience ────────────
  const T = c.systems.tracking;
  if (T.enabled) {
    const eye: Vec3 = seats.length ? scale(seats.reduce((s, x) => add(s, x.eyePoint), [0, 0, 0] as Vec3), 1 / seats.length) : [0, 0, 0];
    const span = Math.min(toRad(70), -mb.az0, mb.az1);
    for (const [ui, u] of getSystem('tracking').tiers[T.tier].units.entries()) {
      const count = n('tracking', TRACKING[u.id][T.tier] ?? 0);
      const z = f + 2.5 + ui * 0.7;
      const r = sphereRadiusAt(R, z) - 0.3;
      for (let k = 0; k < count; k++) {
        const az = -span + ((k + 0.5) / count) * 2 * span;
        const o: Vec3 = [r * Math.sin(az), r * Math.cos(az), z];
        place('tracking', u, getSystem('tracking').layer, 'Sensor', facingFrame(o, eye));
      }
    }
  }

  // ── Fit-out: decks, guardrails, accessories ───────────────────────────────
  const deck = getCatalogItem(c.fitout.riserDeck)!;
  const rail = getCatalogItem(c.fitout.guardrail)!;
  const acc = getCatalogItem(c.fitout.seatAccessory)!;
  const tiers = objects.filter((o) => o.category === 'SeatingTier' && o.geometry.kind === 'annularSector');
  let deckArea = 0;
  const topOfBlock = new Map<string, VenueObject>();
  for (const o of tiers) {
    const g = o.geometry as Extract<VenueObject['geometry'], { kind: 'annularSector' }>;
    deckArea += ((g.angle1 - g.angle0) / 2) * (g.outerRadius ** 2 - g.innerRadius ** 2);
    const key = String(o.metadata.block ?? 'all');
    const prev = topOfBlock.get(key);
    if (!prev || (prev.geometry as typeof g).zTop < g.zTop) topOfBlock.set(key, o);
  }
  const railH = rail.dims?.height ?? 1.1;
  let railLength = 0;
  for (const [key, o] of topOfBlock) {
    const g = o.geometry as Extract<VenueObject['geometry'], { kind: 'annularSector' }>;
    // Guarding is needed where the rear edge drops more than 0.6 m (a common threshold; codes vary).
    if (g.zTop - f < 0.6) continue;
    const r = g.outerRadius;
    const steps = Math.max(2, Math.ceil(((g.angle1 - g.angle0) * r) / 0.5));
    const points: Vec3[] = Array.from({ length: steps + 1 }, (_, k) => {
      const a = g.angle0 + ((g.angle1 - g.angle0) * k) / steps;
      return [g.center[0] + r * Math.sin(a), g.center[1] - r * Math.cos(a), g.zTop + railH];
    });
    const len = r * (g.angle1 - g.angle0);
    railLength += len;
    out.push({
      id: `guardrail.${o.metadata.row}.${key}`,
      name: `Guardrail_${o.metadata.row}_${key}`,
      layer: '02_AUDIENCE/Guardrails',
      category: 'Guardrail',
      geometry: { kind: 'polyline', points, closed: false },
      operatingState: 'all',
      metadata: { product: rail.name, item: rail.id, tier: rail.tier, length_m: +len.toFixed(3), height_m: railH, fall_m: +(g.zTop - f).toFixed(3), line: 'top of rail', status: 'conceptual' },
    });
  }
  const fitout: FitoutSummary = {
    deckArea,
    guardrailLength: railLength,
    accessories: seats.length,
    cost: deckArea * deck.cost.value + railLength * rail.cost.value + seats.length * acc.cost.value,
    weight: deckArea * deck.weight.value + railLength * rail.weight.value + seats.length * acc.weight.value,
    power: deckArea * deck.power.value + railLength * rail.power.value + seats.length * acc.power.value,
  };

  // ── Summary and metrics ──────────────────────────────────────────────────
  const systems: SystemSummary[] = SYSTEMS.filter((s) => c.systems[s.id].enabled && tallies.has(s.id)).map((s) => {
    const units = [...tallies.get(s.id)!.values()];
    const sum = (k: 'cost' | 'weight' | 'power') => units.reduce((t, u) => t + u[k], 0);
    return { id: s.id, label: s.label, tier: c.systems[s.id].tier, product: s.id === 'audio' ? product?.label : undefined, units, count: units.filter((u) => u.unitId !== 'truss').reduce((t, u) => t + u.count, 0), cost: sum('cost'), weight: sum('weight'), power: sum('power') };
  });
  const omega = (mb.az1 - mb.az0) * (Math.sin(mb.el1) - Math.sin(mb.el0));
  const summary: SystemsSummary = {
    systems,
    fitout,
    pickPoints,
    pickLoad,
    occlusion: omega > 0 ? occlusion / omega : 0,
    totals: {
      count: systems.reduce((t, s) => t + s.count, 0),
      power: systems.reduce((t, s) => t + s.power, 0) + fitout.power,
      weight: systems.reduce((t, s) => t + s.weight, 0) + fitout.weight,
      cost: systems.reduce((t, s) => t + s.cost, 0) + fitout.cost,
    },
  };

  const metric = (key: string, label: string, value: number | string, unit: Metric['unit'], quality: Metric['quality'] = 'estimate'): Metric => ({ key, label, value, unit, quality, group: 'Systems' });
  const metrics: Metric[] = [
    metric('fit.deckArea', 'Riser deck area', deckArea, 'm2', 'derived'),
    metric('fit.guardrail', 'Guardrail length', railLength, 'm', 'derived'),
    metric('fit.cost', 'Fit-out cost (placeholder)', fitout.cost, 'USD'),
    ...systems.flatMap((s) => [
      metric(`sys.${s.id}.count`, `${s.label}: units`, s.count, 'count', 'exact'),
      metric(`sys.${s.id}.power`, `${s.label}: power`, s.power, 'W'),
      metric(`sys.${s.id}.cost`, `${s.label}: cost (placeholder)`, s.cost, 'USD'),
    ]),
    metric('sys.pickPoints', 'Rigging pick-up points', pickPoints, 'count', 'derived'),
    metric('sys.pickLoad', 'Suspended load (rigging + flown audio)', pickLoad, 'kg'),
    metric('sys.occlusion', 'Screen hidden by overhead rigs', `${(summary.occlusion * 100).toFixed(1)} %`, ''),
    metric('sys.power', 'Systems + fit-out power', summary.totals.power, 'W'),
    metric('sys.weight', 'Systems + fit-out weight', summary.totals.weight, 'kg'),
    metric('sys.cost', 'Systems + fit-out cost (placeholder)', summary.totals.cost, 'USD'),
  ];
  if (summary.occlusion > 0.05)
    issues.push({ severity: 'warning', code: 'rig-occlusion', message: `Overhead rigging hides about ${(summary.occlusion * 100).toFixed(1)} % of the screen from the reference eye.`, path: 'systems.lighting' });

  return { objects: out, blocks: [...blocks.values()], metrics, issues, summary };
}
