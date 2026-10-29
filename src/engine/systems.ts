/**
 * Fit-out and immersion systems (Round 06). Reads the catalog choices and system settings and places
 * conceptual units (fixtures, speakers, hoists, hazers, cameras) as block instances on their layers,
 * so they can be counted, costed and later hung from the Round 07 structure. Positions follow simple
 * placement rules, not a lighting or acoustic design; every cost and most weights are placeholders.
 */
import { getAudioProduct, getCatalogItem, getSystem, SYSTEMS, type SystemUnit } from '../library/catalog';
import { add, facingFrame, length, scale, sub, surfaceNormal, surfacePoint, toRad, toSurface } from './coordinates';
import { mediaBounds, ringOf, sphereRadiusAt } from './media';
import type { PickRequest, StructureLayout } from './structure';
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

const circlePoints = (r: number, z: number, n: number, phase = 0): Vec3[] => Array.from({ length: n }, (_, k) => [r * Math.sin(((k + phase) / n) * 2 * Math.PI), r * Math.cos(((k + phase) / n) * 2 * Math.PI), z]);

/**
 * The lighting crown ring: its centre-line radius, height and elevation. It sits just above the screen's
 * top edge (or `crownDropDeg` below it), on the sphere and inset by half a truss depth.
 */
export function crownRing(c: VenueConfiguration) {
  const R = c.sphere.radius;
  const ring = ringOf(c);
  const top = Math.min(toRad(c.media.elevationUpperDeg), toRad(75));
  const el = Math.max(toRad(c.media.elevationLowerDeg) + toRad(5), top - toRad(c.systems.lighting.crownDropDeg ?? 0)) + 0.35 / R;
  const r = R - 0.3;
  return { radius: ring + r * Math.cos(el), z: r * Math.sin(el), el };
}

/** `layout`: the support structure, when enabled; arrays then sit in its bays and every hung load becomes a pick request. */
export function generateSystems(c: VenueConfiguration, objects: VenueObject[], seats: SeatRecord[], layout?: StructureLayout) {
  const out: VenueObject[] = [];
  const blocks = new Map<string, BlockDefinition>();
  const issues: Issue[] = [];
  const tallies = new Map<SystemId, Map<string, UnitTally>>();
  const R = c.sphere.radius;
  const ring = ringOf(c);
  const f = c.floor.mainFloorElevation;
  const mb = mediaBounds(R, c.media, ring);
  /** Horizontal radius of the screen surface at height z (sphere or torus form). */
  const radiusAt = (z: number) => sphereRadiusAt(R, z, ring);
  let occlusion = 0;
  const picks: PickRequest[] = [];

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
    const [d, az, el] = toSurface(p, ring);
    if (d < R && az >= mb.az0 && az <= mb.az1 && el >= mb.el0 && el <= mb.el1) occlusion += area / length(p) ** 2;
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
    const stageTarget: Vec3 = [0, c.stage.centerY, deckTop];
    // Crown ring: one circular truss set into the slice just above the screen's top edge, so the rig reads
    // as part of the dome instead of a frame hung in the room. It follows the radius, ring radius and top
    // edge, and sits `crownDropDeg` below the top edge (capped at 75° so a closed dome keeps a usable ring).
    const cr = crownRing(c);
    const circ = 2 * Math.PI * cr.radius;
    let rigLoad = circ * truss.weight.value;
    out.push({ id: 'sys.lighting.truss.crown', name: 'Crown_Truss', layer: RIGGING, category: 'Truss', geometry: { kind: 'circle', center: [0, 0, cr.z], normal: Z, radius: cr.radius }, operatingState: 'all', metadata: { system: 'lighting', unit: truss.id, length_m: +circ.toFixed(3), z: +cr.z.toFixed(4), elevation_deg: +((cr.el * 180) / Math.PI).toFixed(3), status: 'conceptual' } });
    tally('lighting', truss, circ);
    const segs = Math.max(8, Math.ceil(circ / 0.5));
    circlePoints(cr.radius, cr.z, segs).forEach((p) => occlude(p, (circ / segs) * truss.size[2]));
    // Fixtures sit on the truss's inner face, below its centre line, aimed into the room.
    const mount = (unit: SystemUnit, count: number, phase: number, target: (o: Vec3) => Vec3, rig: string) =>
      circlePoints(cr.radius - truss.size[1] / 2 - unit.size[1] / 2, cr.z - unit.size[2], count, phase).forEach((o) => {
        place('lighting', unit, lightLayer, 'LightingFixture', facingFrame(o, target(o)), { rig });
        occlude(o, unit.size[0] * unit.size[2]);
        rigLoad += unit.weight.value;
      });
    const spot = unitOf('fx-spot');
    const wash = unitOf('fx-wash')!;
    const laser = unitOf('fx-laser');
    // Spots cover the stage; washes cross the room to the far side of the audience; lasers fan straight down.
    if (spot) mount(spot, n('lighting', circ / 3), 0.5, () => stageTarget, 'crown');
    mount(wash, n('lighting', circ / (spot ? 4 : 3)), 0.25, (o) => [-o[0] * 0.4, -o[1] * 0.4, f], 'crown');
    if (laser) mount(laser, n('lighting', 6), 0.125, (o) => [o[0] * 0.3, o[1] * 0.3, f], 'crown');
    // The crown hangs off the top ring girder where the screen has one; elsewhere it is hoisted.
    const nh = Math.max(4, Math.ceil(circ / 6));
    circlePoints(cr.radius, cr.z + truss.size[2] / 2, nh).forEach((p, k) => {
      const az = Math.atan2(p[0], p[1]);
      const onRing = layout && az >= mb.az0 && az <= mb.az1;
      if (!onRing) place('lighting', hoist, RIGGING, 'Hoist', facingFrame(p, [0, 0, p[2]]), { pick_load_kg: +(rigLoad / nh).toFixed(1), rig: 'crown' });
      picks.push({ id: `crown.${k}`, source: `crown ring pick ${k + 1}`, position: onRing ? p : [p[0], p[1], p[2] + hoist.size[2]], load: rigLoad / nh + (onRing ? 0 : hoist.weight.value), kind: onRing ? 'array' : 'hoist' });
    });

    // Wash ring at the screen base, just inside the sphere, lighting the room and the audience.
    const wz = f + 0.3;
    const wr = radiusAt(wz) - 0.8;
    const nw = n('lighting', WASH_RING[L.tier]);
    for (let k = 0; k < nw; k++) {
      const az = mb.az0 + ((k + 0.5) / nw) * (mb.az1 - mb.az0);
      const o: Vec3 = [wr * Math.sin(az), wr * Math.cos(az), wz];
      place('lighting', wash, lightLayer, 'LightingFixture', facingFrame(o, [0, 0, wz]), { rig: 'base ring' });
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
    // In the structure the array's front sits on the ribs' front face; without it, 0.35 m behind the screen.
    const gap = layout ? layout.front - R : 0.35;
    const rc = R + gap + depth / 2;
    if (layout && depth > layout.sys.ribDepth + 1e-9)
      issues.push({ severity: 'info', code: 'audio-deeper-than-ribs', message: `${main.name} is ${((depth - layout.sys.ribDepth) * 1000).toFixed(0)} mm deeper than the ribs; ring girders are notched or the arrays sit between rings.`, path: 'structure.system' });
    if (gap + depth > c.envelope.serviceZone)
      issues.push({ severity: 'warning', code: 'audio-service-zone', message: `${main.name} arrays need ${(gap + depth).toFixed(2)} m behind the screen; the service zone is ${c.envelope.serviceZone.toFixed(2)} m.`, path: 'envelope.serviceZone' });
    const halfAngle = (modules * h) / 2 / rc;
    const rings = RINGS[A.tier].map(toRad).filter((e) => e - halfAngle >= mb.el0 && e + halfAngle <= mb.el1);
    if (!rings.length) issues.push({ severity: 'warning', code: 'audio-no-rings', message: 'No array ring fits inside the media surface; widen its elevation range.', path: 'media' });
    let positions = 0;
    for (const [ri, e] of rings.entries()) {
      // Positions scale with the ring's circumference (the torus form's rings are longer).
      const count = Math.max(2, Math.round((product.positionsPerRing[A.tier] * A.scale * (ring + R * Math.cos(e))) / R));
      // With a structure, positions snap to evenly spread slots inside the bays, clear of the ribs.
      const perBay = layout ? Math.ceil(count / layout.bays.length) : 1;
      const slots = layout ? layout.bays.length * perBay : count;
      for (let k = 0; k < count; k++) {
        let az = mb.az0 + ((k + 0.5) / count) * (mb.az1 - mb.az0);
        if (layout) {
          const slot = Math.floor(((k + 0.5) / count) * slots);
          const [a0, a1] = layout.bays[Math.floor(slot / perBay)];
          az = a0 + (((slot % perBay) + 0.5) / perBay) * (a1 - a0);
        }
        const centre = surfacePoint(rc, az, e, ring);
        const frame = facingFrame(centre, sub(centre, surfaceNormal(az, e)));
        for (let m = 0; m < modules; m++) {
          const origin = add(centre, scale(frame.zAxis, (m - modules / 2) * h));
          place('audio', main, layer, 'Speaker', { ...frame, origin }, { ring: ri, position: positions, module: m, product: product.label, front_radius_m: +(R + gap).toFixed(4) });
        }
        picks.push({ id: `audio.${ri}.${k}`, source: `${product.label} ring ${ri + 1} position ${k + 1}`, position: centre, load: modules * main.weight.value, kind: 'array' });
        positions++;
      }
    }
    // Flagship zenith array, hung on the axis in the oculus (or behind a closed dome) and aimed down.
    if (A.tier === 'flagship') {
      const closed = !ring && mb.el1 > toRad(88);
      const zz = closed ? R + gap : R * Math.sin(mb.el1) + 0.5;
      const nz = Math.max(3, Math.round(4 * A.scale));
      circlePoints(0.8, zz, nz).forEach((p, k) => {
        const frame = facingFrame(p, [p[0] * 2, p[1] * 2, f]);
        for (let m = 0; m < modules; m++) place('audio', main, layer, 'Speaker', { ...frame, origin: add(p, scale(frame.zAxis, (m - modules / 2) * h)) }, { ring: 'zenith', position: positions, module: m, product: product.label });
        if (!closed) picks.push({ id: `audio.zenith.${k}`, source: `${product.label} zenith ${k + 1}`, position: [p[0], p[1], p[2] + 0.5], load: modules * main.weight.value, kind: 'hoist' });
        positions++;
      });
    }
    // Subwoofers on the floor behind the screen base.
    const ns = n('audio', SUBS[A.tier]);
    const sr = radiusAt(f) + gap + product.sub.size[1] / 2;
    for (let k = 0; k < ns; k++) {
      const az = mb.az0 + ((k + 0.5) / ns) * (mb.az1 - mb.az0);
      const o: Vec3 = [sr * Math.sin(az), sr * Math.cos(az), f];
      place('audio', product.sub, layer, 'Subwoofer', facingFrame(o, [0, 0, f]), { product: product.label });
    }
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
    const r = radiusAt(f) - 0.6;
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
      const r = radiusAt(z) - 0.3;
      for (let k = 0; k < count; k++) {
        const az = -span + ((k + 0.5) / count) * 2 * span;
        const o: Vec3 = [r * Math.sin(az), r * Math.cos(az), z];
        place('tracking', u, getSystem('tracking').layer, 'Sensor', facingFrame(o, eye));
      }
    }
  }

  // ── FX safety (Round 06 FX research): laser exclusion and heavy-gas pooling ──
  const lasers = out.filter((o) => o.metadata.unit === 'fx-laser');
  const audienceTiers = objects.filter((o) => o.category === 'SeatingTier' && o.geometry.kind === 'annularSector');
  if (lasers.length && audienceTiers.length) {
    // Audience-scanning lasers need 3.0 m above (and 2.5 m beside) any surface the audience can reach
    // (US FDA laser show variance practice). One conservative plane over the whole seating fan.
    const gs = audienceTiers.map((o) => o.geometry as Extract<VenueObject['geometry'], { kind: 'annularSector' }>);
    const top = Math.max(f, ...gs.map((g) => g.zTop)) + 3.0;
    out.push({
      id: 'fx.laser.exclusion',
      name: 'Laser_Exclusion_Plane',
      layer: '07_ANALYSIS/FX_Safety_Volumes',
      category: 'SafetyVolume',
      geometry: { kind: 'annularSector', center: gs[0].center, innerRadius: Math.max(0, Math.min(...gs.map((g) => g.innerRadius)) - 2.5), outerRadius: Math.max(...gs.map((g) => g.outerRadius)) + 2.5, angle0: Math.min(...gs.map((g) => g.angle0)), angle1: Math.max(...gs.map((g) => g.angle1)), zBottom: top - 0.02, zTop: top },
      operatingState: 'seated',
      metadata: { rule: '3.0 m above / 2.5 m beside audience surfaces', z: +top.toFixed(3), status: 'conceptual' },
    });
    const low = lasers.filter((o) => (o.geometry as { frame: Frame }).frame.origin[2] < top);
    if (low.length) issues.push({ severity: 'warning', code: 'laser-exclusion', message: `${low.length} lasers sit below the audience exclusion plane (${top.toFixed(1)} m); they must not scan the audience from there.`, path: 'systems.lighting' });
  }
  if (AT.enabled && AT.tier !== 'standard')
    issues.push({ severity: 'info', code: 'gas-pooling', message: 'Low fog (and any CO2 effects) is heavier than air and pools at the lowest point of the seating bowl and the stage pit: provide low-level extraction and CO2 / O2 sensors there.', path: 'systems.atmospherics' });

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
    pickPoints: picks.length,
    pickLoad: picks.reduce((t, p) => t + p.load, 0),
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
    metric('sys.pickPoints', 'Rigging pick-up points', summary.pickPoints, 'count', 'derived'),
    metric('sys.pickLoad', 'Suspended load (rigging + flown audio)', summary.pickLoad, 'kg'),
    metric('sys.occlusion', 'Screen hidden by overhead rigs', `${(summary.occlusion * 100).toFixed(1)} %`, ''),
    metric('sys.power', 'Systems + fit-out power', summary.totals.power, 'W'),
    metric('sys.weight', 'Systems + fit-out weight', summary.totals.weight, 'kg'),
    metric('sys.cost', 'Systems + fit-out cost (placeholder)', summary.totals.cost, 'USD'),
  ];
  if (summary.occlusion > 0.05)
    issues.push({ severity: 'warning', code: 'rig-occlusion', message: `Overhead rigging hides about ${(summary.occlusion * 100).toFixed(1)} % of the screen from the reference eye.`, path: 'systems.lighting' });

  return { objects: out, blocks: [...blocks.values()], metrics, issues, summary, picks };
}
