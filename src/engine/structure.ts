/**
 * Support structure behind the media surface (Round 07). Generated from the media patch, the LED depth
 * and the chosen structure system: curved ribs on meridians, ring girders on latitudes (on the outer
 * face of the ribs), a base ring on the floor and a top compression ring at the oculus. Every member is
 * split into shippable segments with splices, and the structure is the rigging backbone: audio arrays
 * hang in its bays, and hoists pick up from pick beams between ribs (or the crown grid in the oculus).
 *
 * Conceptual only: member sizes are placeholders, loads are summed, not analysed, and nothing here is
 * engineered. It answers "how much, how many pieces, how heavy, does it ship, where do loads land".
 */
import { getLedProduct } from '../library/led';
import { getStructureSystem, SHIPPING, type StructureSystem } from '../library/catalog';
import { facingFrame, sub, surfaceNormal, surfacePoint, toRad } from './coordinates';
import { mediaBounds, ringOf } from './media';
import { prosceniumSector } from './proscenium';
import type { BlockDefinition, Issue, Metric, VenueConfiguration, VenueObject, Vec3 } from './types';
import type { LedSummary } from './led';

export interface StructureLayout {
  sys: StructureSystem;
  /** Torus ring radius (0 = sphere); the radii below are then tube radii about the ring. */
  ring: number;
  /** Radius of the ribs' front face, rib centreline, ring girder centreline and the structure's back. */
  front: number;
  ribR: number;
  ringR: number;
  back: number;
  az0: number;
  az1: number;
  /** The media wraps all the way round (no end ribs). */
  full: boolean;
  ribAz: number[];
  /** Bays between neighbouring ribs, as [azimuth0, azimuth1, rib index 0, rib index 1]. */
  bays: [number, number, number, number][];
  /** Rib foot (on the floor), lowest girder, top ring. */
  elFoot: number;
  rings: { el: number; kind: 'base' | 'girder' | 'top' }[];
  elTop: number;
  /** The top is open (oculus), so the top ring carries a crown grid. */
  crown: boolean;
}

/** A load the systems want hung from the structure. */
export interface PickRequest {
  id: string;
  source: string;
  /** Hoist top or array centre. */
  position: Vec3;
  load: number;
  /** Hoists pick up vertically; arrays hang inside a bay. */
  kind: 'hoist' | 'array';
}

export interface Segment {
  mark: string;
  member: 'rib' | 'ring' | 'pick-beam' | 'crown-beam';
  length: number;
  chord: number;
  sagitta: number;
  weight: number;
  shipping: string;
}

export interface PickPoint {
  id: string;
  source: string;
  load: number;
  /** What carries it: a pick beam in a bay, the crown grid, a ring girder, the building roof or nothing. */
  carrier: 'pick-beam' | 'crown' | 'ring' | 'roof' | 'unsupported';
  position: Vec3;
  /** Ribs that share the load. */
  ribs: number[];
  /** The chain passes through the media surface. */
  penetratesScreen: boolean;
}

export interface StructureSummary {
  system: string;
  ribs: number;
  rings: number;
  nodes: number;
  splices: number;
  segments: Segment[];
  picks: PickPoint[];
  /** kg: structure self weight, LED, hung loads; per-rib base reactions. */
  steelWeight: number;
  ledLoad: number;
  hungLoad: number;
  ribReactions: number[];
  cost: number;
  walkwayLength: number;
  cranePicks: number;
  installDays: number;
  /** Segment count by shipping class id (or 'oversize'). */
  shipping: Record<string, number>;
}

const MAX_TOP = toRad(85);

export function structureLayout(c: VenueConfiguration): StructureLayout | undefined {
  const st = c.structure;
  const sys = getStructureSystem(st.system);
  if (!st.enabled || !sys) return undefined;
  const R = c.sphere.radius;
  const ring = ringOf(c);
  const f = c.floor.mainFloorElevation;
  const b = mediaBounds(R, c.media, ring);
  const ledDepth = getLedProduct(c.led.productId)?.cabinetDepth.value ?? 0.1;
  const front = R + ledDepth + st.mountGap;
  const ribR = front + sys.ribDepth / 2;
  const ringR = front + sys.ribDepth + sys.ringDepth / 2;
  const back = front + sys.ribDepth + sys.ringDepth;
  const elFoot = Math.asin(Math.max(-1, Math.min(1, f / ribR)));
  const elTop = Math.min(b.el1, MAX_TOP);
  const elLow = Math.max(b.el0, elFoot);
  const n = Math.max(1, Math.ceil(((elTop - elLow) * ribR) / st.ringSpacing));
  const rings: StructureLayout['rings'] = [];
  if (elLow - elFoot > 0.01) rings.push({ el: elFoot, kind: 'base' });
  for (let j = 0; j <= n; j++) rings.push({ el: elLow + ((elTop - elLow) * j) / n, kind: j === n ? 'top' : j === 0 && !rings.length ? 'base' : 'girder' });
  const span = b.az1 - b.az0;
  const full = span >= 2 * Math.PI - 1e-6;
  // Rib spacing is measured on the equator (the torus form's equator is ring + ribR from the axis).
  const nB = Math.max(1, Math.ceil(((ring + ribR) * span) / st.ribSpacing));
  const ribAz = Array.from({ length: full ? nB : nB + 1 }, (_, i) => b.az0 + (span * i) / nB);
  const bays = Array.from({ length: nB }, (_, i) => [ribAz[i], i + 1 < ribAz.length ? ribAz[i + 1] : ribAz[0] + 2 * Math.PI, i, (i + 1) % ribAz.length] as [number, number, number, number]);
  return { sys, ring, front, ribR, ringR, back, az0: b.az0, az1: b.az1, full, ribAz, bays, elFoot, rings, elTop, crown: b.el1 < MAX_TOP };
}

/** Bay containing an azimuth (or undefined outside the structure). */
export function bayOf(l: StructureLayout, az: number): number | undefined {
  for (let i = 0; i < l.bays.length; i++) {
    const [a0, a1] = l.bays[i];
    const a = az < a0 - 1e-9 ? az + 2 * Math.PI : az;
    if (a >= a0 - 1e-9 && a <= a1 + 1e-9) return i;
  }
  return undefined;
}

function shippingClass(length: number, chord: number, sagitta: number, depth: number, width: number): string {
  const dims = [chord, sagitta + depth, width].sort((x, y) => y - x);
  for (const s of SHIPPING) if (dims.every((d, i) => d <= s.dims[i])) return s.id;
  return length > 0 ? 'oversize' : SHIPPING[0].id;
}

const arcProps = (radius: number, angle: number) => ({ length: radius * angle, chord: 2 * radius * Math.sin(angle / 2), sagitta: radius * (1 - Math.cos(angle / 2)) });

export function generateStructure(c: VenueConfiguration, l: StructureLayout, picks: PickRequest[], led?: LedSummary) {
  const st = c.structure;
  const sys = l.sys;
  const R = c.sphere.radius;
  const f = c.floor.mainFloorElevation;
  const objects: VenueObject[] = [];
  const issues: Issue[] = [];
  const segments: Segment[] = [];
  const nRib = l.ribAz.length;
  const ribLoad = new Array<number>(nRib).fill(0);
  const STRUCT = '01_MEDIA/LED_Structure';
  const MOUNT = '01_MEDIA/LED_Mounting';

  const ringGeo = l.ring ? { ring: l.ring } : {};
  const addSegment = (s: Omit<Segment, 'shipping'>, depth: number, width: number) => {
    const seg = { ...s, shipping: shippingClass(s.length, s.chord, s.sagitta, depth, width) };
    segments.push(seg);
    return seg;
  };

  // Retractable proscenium: ribs inside the opening stop on a portal header at the opening's top, and
  // ring girders below the header skip the bays the carriage slides through.
  const prosc = prosceniumSector(c);
  const headerEl = prosc && prosc.el1 < l.elTop - 1e-6 ? prosc.el1 : undefined;
  const inOpening = (az: number) => !!prosc && az > prosc.az0 + 1e-9 && az < prosc.az1 - 1e-9;
  const bayInOpening = (b: [number, number, number, number]) => !!prosc && Math.min(b[1], prosc.az1) - Math.max(b[0], prosc.az0) > 1e-9;
  const below = (el: number) => prosc !== undefined && el < (headerEl ?? Infinity) - 1e-9;

  // Ribs: one meridian arc per rib, split into equal shippable segments.
  l.ribAz.forEach((az, i) => {
    if (inOpening(az) && headerEl === undefined) return;
    const foot = inOpening(az) ? headerEl! : l.elFoot;
    const ribAngle = l.elTop - foot;
    const ribSegs = Math.max(1, Math.ceil((l.ribR * ribAngle) / st.maxSegment));
    for (let s = 0; s < ribSegs; s++) {
      const e0 = foot + (ribAngle * s) / ribSegs;
      const e1 = foot + (ribAngle * (s + 1)) / ribSegs;
      const a = arcProps(l.ribR, e1 - e0);
      const weight = a.length * sys.ribKgPerM.value;
      const mark = `R${String(i + 1).padStart(2, '0')}-${s + 1}`;
      const seg = addSegment({ mark, member: 'rib', ...a, weight }, sys.ribDepth, sys.ribWidth);
      ribLoad[i] += weight;
      objects.push({
        id: `struct.rib.${i}.${s}`,
        name: `Rib_${mark}`,
        layer: STRUCT,
        category: 'Rib',
        geometry: { kind: 'meridianArc', radius: l.ribR, azimuth: az, elevation0: e0, elevation1: e1, ...ringGeo },
        operatingState: 'all',
        metadata: { mark, rib: i, segment: s, length_m: +a.length.toFixed(4), chord_m: +a.chord.toFixed(4), sagitta_m: +a.sagitta.toFixed(4), weight_kg: +weight.toFixed(1), shipping: seg.shipping, section: sys.name, status: 'conceptual' },
      });
    }
  });

  // Ring girders: latitude arcs on the outer face of the ribs, grouped into segments of whole bays.
  // Rings below the proscenium header break into runs either side of the opening.
  let ringCount = 0;
  const header = headerEl === undefined ? [] : [{ el: headerEl, kind: 'header' as const }];
  [...l.rings, ...header].forEach((ring, j) => {
    const plan = l.ring + l.ringR * Math.cos(ring.el);
    const bayAngle = l.bays[0][1] - l.bays[0][0];
    const perSeg = Math.max(1, Math.floor(st.maxSegment / Math.max(1e-6, plan * bayAngle)));
    ringCount++;
    const runs: (typeof l.bays)[] = [[]];
    for (const bay of l.bays) {
      const keep = ring.kind === 'header' ? bayInOpening(bay) : !(below(ring.el) && bayInOpening(bay));
      if (keep) runs[runs.length - 1].push(bay);
      else if (runs[runs.length - 1].length) runs.push([]);
    }
    const chunks = runs.filter((run) => run.length).flatMap((run) => Array.from({ length: Math.ceil(run.length / perSeg) }, (_, k) => run.slice(k * perSeg, (k + 1) * perSeg)));
    chunks.forEach((chunk, s) => {
      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      const a = arcProps(plan, last[1] - first[0]);
      const weight = a.length * sys.ringKgPerM.value;
      const mark = `${ring.kind === 'header' ? 'PH' : 'G'}${String(j + 1).padStart(2, '0')}-${s + 1}`;
      const seg = addSegment({ mark, member: 'ring', ...a, weight }, sys.ringDepth, sys.ringWidth);
      // Half of each ring segment's weight lands on the ribs at its ends.
      ribLoad[first[2]] += weight / 2;
      ribLoad[last[3]] += weight / 2;
      objects.push({
        id: `struct.ring.${j}.${s}`,
        name: `Ring_${mark}`,
        layer: STRUCT,
        category: ring.kind === 'base' ? 'BaseRing' : ring.kind === 'top' ? 'TopRing' : 'RingGirder',
        geometry: { kind: 'latitudeArc', radius: l.ringR, elevation: ring.el, azimuth0: first[0], azimuth1: last[1], ...ringGeo },
        operatingState: 'all',
        metadata: { mark, ring: j, kind: ring.kind, length_m: +a.length.toFixed(4), chord_m: +a.chord.toFixed(4), sagitta_m: +a.sagitta.toFixed(4), weight_kg: +weight.toFixed(1), shipping: seg.shipping, status: 'conceptual' },
      });
    });
  });

  // Node brackets at every rib × ring crossing, and base plates under every rib.
  const nodeBlock: BlockDefinition = {
    id: 'block.struct.node',
    name: `STRUCT_Node_${sys.id}`.replace(/[^A-Za-z0-9_]+/g, '_'),
    description: `Rib × ring node bracket (${sys.name}); proxy box, front face on local +Y.`,
    parts: [{ role: 'structure-node', geometry: { kind: 'box', min: [-(sys.ribWidth / 2 + 0.05), -(sys.ribDepth + sys.ringDepth) / 2, -0.15], max: [sys.ribWidth / 2 + 0.05, (sys.ribDepth + sys.ringDepth) / 2, 0.15] } }],
    metadata: { weight_kg: sys.nodeKg.value, weight_status: sys.nodeKg.status, geometry_note: 'Proxy massing' },
  };
  const baseBlock: BlockDefinition = {
    id: 'block.struct.base',
    name: 'STRUCT_Base_Plate',
    description: 'Rib base plate and anchors on the floor slab; proxy box.',
    parts: [{ role: 'structure-base', geometry: { kind: 'box', min: [-0.35, -0.35, 0], max: [0.35, 0.35, 0.04] } }],
    metadata: { weight_kg: sys.baseKg.value, weight_status: sys.baseKg.status, geometry_note: 'Proxy massing' },
  };
  const nodeR = l.front + (sys.ribDepth + sys.ringDepth) / 2;
  let nodes = 0;
  l.ribAz.forEach((az, i) => {
    [...l.rings, ...header].forEach((ring, j) => {
      // Inside the proscenium opening only the header and the rings above it carry nodes.
      if (inOpening(az) ? below(ring.el) : ring.kind === 'header') return;
      const p = surfacePoint(nodeR, az, ring.el, l.ring);
      objects.push({ id: `struct.node.${i}.${j}`, name: `Node_R${i + 1}_G${j + 1}`, layer: MOUNT, category: 'StructureNode', geometry: { kind: 'blockInstance', blockId: nodeBlock.id, frame: facingFrame(p, sub(p, surfaceNormal(az, ring.el))) }, operatingState: 'all', metadata: { rib: i, ring: j, weight_kg: sys.nodeKg.value, status: 'conceptual' } });
      ribLoad[i] += sys.nodeKg.value;
      nodes++;
    });
    const foot = surfacePoint(l.ribR, az, l.elFoot, l.ring);
    const base: Vec3 = [foot[0], foot[1], f];
    objects.push({ id: `struct.base.${i}`, name: `Base_R${i + 1}`, layer: MOUNT, category: 'BasePlate', geometry: { kind: 'blockInstance', blockId: baseBlock.id, frame: facingFrame(base, [0, 0, f]) }, operatingState: 'all', metadata: { rib: i, weight_kg: sys.baseKg.value, status: 'conceptual' } });
    ribLoad[i] += sys.baseKg.value;
  });
  const splices = segments.filter((s) => s.member === 'rib').length - nRib + segments.filter((s) => s.member === 'ring').length - (l.full ? 0 : l.rings.length);
  for (let i = 0; i < nRib; i++) ribLoad[i] += (splices / nRib) * sys.spliceKg.value;

  // LED load: shared equally by the ribs (cabinets hang on the rings between them).
  const ledLoad = led && c.led.enabled ? led.weightKg : 0;
  for (let i = 0; i < nRib; i++) ribLoad[i] += ledLoad / nRib;

  // Pick-ups: every load the systems hang is carried to named ribs.
  const media = mediaBounds(R, c.media, l.ring);
  const pickPoints: PickPoint[] = [];
  const pickBeams = new Map<string, { bay: number; el: number }>();
  const crownBeams = new Map<string, number>();
  const topRing = l.rings[l.rings.length - 1];
  const rInner = l.ring + l.ringR * Math.cos(topRing.el);
  // The crown grid sits on the top ring, raised on posts if something hangs higher (zenith arrays, halo hoists).
  const inOculus = (p: PickRequest) => l.crown && p.kind === 'hoist' && Math.hypot(p.position[0], p.position[1]) < rInner && p.position[2] > l.front * Math.sin(l.elTop) - 1;
  const crownZ = Math.max(l.ringR * Math.sin(topRing.el) + sys.ringDepth, ...picks.filter(inOculus).map((p) => p.position[2] + 0.3));
  const hub = 0.6;
  const nearestRib = (az: number) => l.ribAz.reduce((best, a, i) => (Math.abs(Math.atan2(Math.sin(az - a), Math.cos(az - a))) < Math.abs(Math.atan2(Math.sin(az - l.ribAz[best]), Math.cos(az - l.ribAz[best]))) ? i : best), 0);
  for (const p of picks) {
    const [x, y, z] = p.position;
    const az = Math.atan2(x, y);
    const bay = bayOf(l, az);
    const share = (ribs: number[]) => ribs.forEach((r) => (ribLoad[r] += p.load / ribs.length));
    if (p.kind === 'array') {
      const ribs = bay === undefined ? [] : [l.bays[bay][2], l.bays[bay][3]];
      share(ribs);
      pickPoints.push({ id: p.id, source: p.source, load: p.load, carrier: ribs.length ? 'ring' : 'unsupported', position: p.position, ribs, penetratesScreen: false });
      continue;
    }
    // Vertical line up from the pick to the ribs' front surface (r is measured from the tube centre circle).
    const r = Math.hypot(x, y) - l.ring;
    const zHit = Math.abs(r) < l.front ? Math.sqrt(l.front * l.front - r * r) : -Infinity;
    const el = Math.atan2(zHit, r);
    let carrier: PickPoint['carrier'] = 'unsupported';
    let top: Vec3 | undefined;
    let ribs: number[] = [];
    if (bay !== undefined && zHit > z && el <= l.elTop + 1e-9 && el >= l.elFoot) {
      carrier = 'pick-beam';
      top = [x, y, zHit];
      ribs = [l.bays[bay][2], l.bays[bay][3]];
      pickBeams.set(`${bay}:${el.toFixed(3)}`, { bay, el });
    } else if (inOculus(p)) {
      carrier = 'crown';
      top = [x, y, crownZ];
      const k = nearestRib(az);
      ribs = [k];
      crownBeams.set(az.toFixed(4), az);
    } else if (c.building.enabled) {
      carrier = 'roof';
      top = [x, y, c.building.floorElevation + c.building.clearHeight];
    }
    share(ribs);
    const pen = carrier === 'pick-beam' && el >= media.el0 && el <= media.el1;
    pickPoints.push({ id: p.id, source: p.source, load: p.load, carrier, position: top ?? p.position, ribs, penetratesScreen: pen });
    if (top)
      objects.push({ id: `struct.chain.${p.id}`, name: `Chain_${p.id.replace(/[^A-Za-z0-9]+/g, '_')}`, layer: '05_TECHNICAL/Rigging', category: 'Chain', geometry: { kind: 'line', a: p.position, b: top }, operatingState: 'all', metadata: { pick: p.id, carrier, load_kg: +p.load.toFixed(1), length_m: +Math.hypot(top[2] - p.position[2]).toFixed(3), penetrates_screen: pen ? 'yes' : 'no', status: 'conceptual' } });
  }
  [...pickBeams].forEach(([key, { bay, el }], k) => {
    const [a0, a1] = l.bays[bay];
    const a = arcProps(l.ring + l.ribR * Math.cos(el), a1 - a0);
    const weight = a.length * sys.ringKgPerM.value;
    ribLoad[l.bays[bay][2]] += weight / 2;
    ribLoad[l.bays[bay][3]] += weight / 2;
    const mark = `P${String(k + 1).padStart(2, '0')}`;
    addSegment({ mark, member: 'pick-beam', ...a, weight }, sys.ringDepth, sys.ringWidth);
    objects.push({ id: `struct.pickbeam.${key.replace(/[^0-9]+/g, '_')}`, name: `PickBeam_${mark}`, layer: STRUCT, category: 'PickBeam', geometry: { kind: 'latitudeArc', radius: l.ribR, elevation: el, azimuth0: a0, azimuth1: a1, ...ringGeo }, operatingState: 'all', metadata: { mark, bay, weight_kg: +weight.toFixed(1), status: 'conceptual' } });
  });
  [...crownBeams.values()].forEach((az, k) => {
    const r0 = rInner;
    // Outside the screen's azimuth range there is no top ring: the beam runs to the nearest end rib's top instead.
    const end = bayOf(l, az) === undefined ? l.ribAz[nearestRib(az)] : az;
    const a: Vec3 = [r0 * Math.sin(end), r0 * Math.cos(end), crownZ];
    const length = Math.hypot(a[0] - hub * Math.sin(az), a[1] - hub * Math.cos(az));
    const weight = length * sys.ringKgPerM.value;
    const mark = `C${String(k + 1).padStart(2, '0')}`;
    addSegment({ mark, member: 'crown-beam', length, chord: length, sagitta: 0, weight }, sys.ringDepth, sys.ringWidth);
    ribLoad[nearestRib(az)] += weight;
    objects.push({ id: `struct.crown.${k}`, name: `CrownBeam_${mark}`, layer: STRUCT, category: 'CrownBeam', geometry: { kind: 'line', a, b: [hub * Math.sin(az), hub * Math.cos(az), crownZ] }, operatingState: 'all', metadata: { mark, weight_kg: +weight.toFixed(1), status: 'conceptual' } });
  });

  // Service walkways on the back of alternate girder levels, clear of the floor.
  let walkwayLength = 0;
  if (st.walkways) {
    const girders = l.rings.map((ring, j) => ({ ...ring, j })).filter((ring) => ring.kind === 'girder' && l.back * Math.sin(ring.el) >= f + 2.4);
    girders.filter((_, k) => k % 2 === 0).forEach((ring) => {
      const inner = l.ring + l.back * Math.cos(ring.el);
      const z = l.back * Math.sin(ring.el);
      const outer = inner + 0.6;
      const span = l.full ? 2 * Math.PI : l.az1 - l.az0;
      walkwayLength += ((inner + outer) / 2) * span;
      if (Math.hypot(outer - l.ring, z) > R + c.envelope.serviceZone + 1e-9)
        issues.push({ severity: 'warning', code: 'walkway-service-zone', message: `The service walkway at ${z.toFixed(1)} m reaches ${(Math.hypot(outer - l.ring, z) - R).toFixed(2)} m behind the screen; the service zone is ${c.envelope.serviceZone.toFixed(2)} m.`, path: 'envelope.serviceZone' });
      // A full ring is drawn as two halves (a closed annular sector has no seam to extrude from).
      const parts: [number, number][] = l.full ? [[0, Math.PI], [Math.PI, 2 * Math.PI]] : [[Math.PI - l.az1, Math.PI - l.az0]];
      parts.forEach(([angle0, angle1], h) =>
        objects.push({
          id: `struct.walkway.${ring.j}${l.full ? `.${h}` : ''}`,
          name: `Service_Walkway_G${ring.j + 1}${l.full ? `_${h + 1}` : ''}`,
          layer: '01_MEDIA/Service_Clearances',
          category: 'ServiceWalkway',
          geometry: { kind: 'annularSector', center: [0, 0], innerRadius: inner, outerRadius: outer, angle0, angle1, zBottom: z - 0.05, zTop: z },
          operatingState: 'all',
          metadata: { ring: ring.j, width_m: 0.6, z: +z.toFixed(4), status: 'conceptual' },
        }),
      );
    });
  }

  if (l.back > R + c.envelope.serviceZone + 1e-9)
    issues.push({ severity: 'warning', code: 'structure-service-zone', message: `The structure needs ${(l.back - R).toFixed(2)} m behind the screen; the service zone is ${c.envelope.serviceZone.toFixed(2)} m.`, path: 'envelope.serviceZone' });
  const oversize = segments.filter((s) => s.shipping === 'oversize');
  if (oversize.length)
    issues.push({ severity: 'warning', code: 'segment-oversize', message: `${oversize.length} segments do not fit a container or standard trailer; shorten the shipping segment.`, path: 'structure.maxSegment' });
  const penetrations = pickPoints.filter((p) => p.penetratesScreen).length;
  if (penetrations)
    issues.push({ severity: 'info', code: 'screen-penetrations', message: `${penetrations} hoist chains pass through the media surface to pick beams behind it; the LED needs rigging ports there.`, path: 'structure' });
  const unsupported = pickPoints.filter((p) => p.carrier === 'unsupported').length;
  if (unsupported) issues.push({ severity: 'warning', code: 'pick-unsupported', message: `${unsupported} pick-ups have nothing to hang from (outside the structure and no building roof).`, path: 'structure' });

  const steelWeight = segments.reduce((t, s) => t + s.weight, 0) + nodes * sys.nodeKg.value + nRib * sys.baseKg.value + splices * sys.spliceKg.value;
  const hungLoad = pickPoints.filter((p) => p.ribs.length).reduce((t, p) => t + p.load, 0);
  const shipping: Record<string, number> = {};
  for (const s of segments) shipping[s.shipping] = (shipping[s.shipping] ?? 0) + 1;
  const cranePicks = segments.length;
  const summary: StructureSummary = {
    system: sys.name,
    ribs: nRib,
    rings: ringCount,
    nodes,
    splices,
    segments,
    picks: pickPoints,
    steelWeight,
    ledLoad,
    hungLoad,
    ribReactions: ribLoad,
    cost: steelWeight * sys.costPerKg.value,
    walkwayLength,
    cranePicks,
    installDays: Math.ceil(cranePicks / sys.picksPerDay),
    shipping,
  };

  const m = (key: string, label: string, value: number, unit: Metric['unit'], quality: Metric['quality'] = 'estimate'): Metric => ({ key, label, value, unit, quality, group: 'Structure' });
  const metrics: Metric[] = [
    m('struct.ribs', 'Ribs', nRib, 'count', 'exact'),
    m('struct.rings', 'Ring girders', ringCount, 'count', 'exact'),
    m('struct.segments', 'Shipping segments', segments.length, 'count', 'exact'),
    m('struct.maxSegment', 'Heaviest segment', Math.max(...segments.map((s) => s.weight)), 'kg'),
    m('struct.weight', 'Structure weight', steelWeight, 'kg'),
    m('struct.hung', 'Hung load (rigging + audio)', hungLoad, 'kg'),
    m('struct.led', 'LED load', ledLoad, 'kg', 'derived'),
    m('struct.maxReaction', 'Largest rib base reaction', Math.max(...ribLoad), 'kg'),
    m('struct.picks', 'Pick-up points', pickPoints.length, 'count', 'exact'),
    m('struct.cost', 'Structure cost (placeholder)', summary.cost, 'USD'),
    m('struct.days', 'Erection days (one crew, placeholder)', summary.installDays, 'count'),
    m('struct.walkway', 'Service walkway', walkwayLength, 'm', 'derived'),
  ];

  return { objects, blocks: [nodeBlock, baseBlock], metrics, issues, summary };
}
