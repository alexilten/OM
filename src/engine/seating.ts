/**
 * Seating generator (subsystem 4). Rows are arcs about the seating layout origin; each row is a
 * riser above the previous one. Seats keep their product dimensions — a seat that would clash with
 * the sphere clearance or the stage is dropped and counted, never squeezed.
 */
import { getSeatingProduct } from '../library/seating';
import { add, cross, scale, toRad } from './coordinates';
import { sphereRadiusAt } from './media';
import type { BlockDefinition, Frame, Issue, SeatRecord, SeatingProduct, VenueConfiguration, VenueObject, Vec3 } from './types';

export function rowLabel(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export const seatBlockId = (productId: string) => `block.seat.${productId}`;

/** Proxy seat geometry in the seat's local frame: origin = footprint centre at tier level, +Y = facing. */
export function seatBlock(p: SeatingProduct): BlockDefinition {
  const w = p.width.value;
  const d = p.depth.value;
  const a = Math.min(p.armrestWidth.value, w * 0.3);
  const sh = p.seatHeight.value;
  const h = p.overallHeight.value;
  const inner = (w - a) / 2;
  const back = Math.min(0.14, d * 0.25);
  return {
    id: seatBlockId(p.id),
    name: `SEAT_${p.manufacturer}_${p.model}`.replace(/[^A-Za-z0-9_]+/g, '_'),
    description: `${p.manufacturer} ${p.productFamily} ${p.model} — proxy massing at true footprint (${(w * 1000).toFixed(0)} × ${(d * 1000).toFixed(0)} mm). One shared armrest per seat.`,
    parts: [
      { role: 'seat-support', geometry: { kind: 'box', min: [a / 2 - 0.06, -0.08, 0], max: [a / 2 + 0.06, 0.08, sh - 0.12] } },
      { role: 'seat-pan', geometry: { kind: 'box', min: [-inner + a / 2, -d / 2 + back, sh - 0.12], max: [inner + a / 2, d / 2 - 0.04, sh] } },
      { role: 'seat-back', geometry: { kind: 'box', min: [-inner + a / 2, -d / 2, sh - 0.12], max: [inner + a / 2, -d / 2 + back, h] } },
      { role: 'armrest', geometry: { kind: 'box', min: [-w / 2, -d / 2, 0], max: [-w / 2 + a, d / 2 - 0.08, 0.65] } },
    ],
    metadata: {
      manufacturer: p.manufacturer,
      product_family: p.productFamily,
      model: p.model,
      width_m: w,
      depth_m: d,
      width_status: p.width.status,
      depth_status: p.depth.status,
      revision: p.revision,
      geometry_note: 'Proxy massing, not the manufacturer model',
    },
  };
}

export interface SeatingResult {
  objects: VenueObject[];
  seats: SeatRecord[];
  blocks: BlockDefinition[];
  issues: Issue[];
  dropped: { sphere: number; stage: number };
}

export function generateSeating(c: VenueConfiguration): SeatingResult {
  const s = c.seating;
  const product = getSeatingProduct(s.productId)!;
  const R = c.sphere.radius;
  const floor = c.floor.mainFloorElevation;
  const w = product.width.value;
  const d = product.depth.value;
  const A = toRad(s.sectionAngleDeg);
  const block = seatBlock(product);

  const stage = c.stage;
  const stageClear = 1.0;
  const stageMinX = -stage.width / 2 - stageClear;
  const stageMaxX = stage.width / 2 + stageClear;
  const stageMinY = stage.centerY - stage.depth / 2 - stageClear;
  const stageMaxY = stage.centerY + stage.depth / 2 + stageClear;

  const objects: VenueObject[] = [];
  const seats: SeatRecord[] = [];
  const dropped = { sphere: 0, stage: 0 };

  // Radial aisle centre angles, evenly splitting the fan into aisleCount + 1 blocks.
  const aisleAngles = Array.from({ length: s.aisleCount }, (_, k) => -A / 2 + ((k + 1) * A) / (s.aisleCount + 1));

  for (let i = 0; i < s.rowCount; i++) {
    const r = s.frontRowRadius + i * s.rowPitch;
    const z = floor + i * s.riserHeight;
    const label = rowLabel(i);
    const eyeZ = z + product.eyeHeight.value;
    const limit = sphereRadiusAt(R, eyeZ) - s.screenClearance;

    const halfAisle = s.aisleWidth / 2 / r;
    const bounds: [number, number][] = [];
    let start = -A / 2;
    for (const ac of aisleAngles) {
      bounds.push([start, ac - halfAisle]);
      start = ac + halfAisle;
    }
    bounds.push([start, A / 2]);

    const step = w / r;
    const rowSeats: { alpha: number }[] = [];
    for (const [b0, b1] of bounds) {
      const n = Math.floor(((b1 - b0) * r + 1e-9) / w);
      if (n <= 0) continue;
      const mid = (b0 + b1) / 2;
      for (let k = 0; k < n; k++) rowSeats.push({ alpha: mid + (k - (n - 1) / 2) * step });
    }

    let number = 0;
    let minAlpha = Infinity;
    let maxAlpha = -Infinity;
    for (const { alpha } of rowSeats) {
      const pos: Vec3 = [r * Math.sin(alpha), s.focusY - r * Math.cos(alpha), z];
      const facing: Vec3 = [-Math.sin(alpha), Math.cos(alpha), 0];
      const right: Vec3 = [facing[1], -facing[0], 0];
      // Footprint corners in plan.
      const corners = [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ].map(([x, y]) => add(add(pos, scale(right, x)), scale(facing, y)));
      const maxPlan = Math.max(...corners.map((p) => Math.hypot(p[0], p[1])));
      if (maxPlan > limit) {
        dropped.sphere++;
        continue;
      }
      if (corners.some((p) => p[0] > stageMinX && p[0] < stageMaxX && p[1] > stageMinY && p[1] < stageMaxY)) {
        dropped.stage++;
        continue;
      }
      number++;
      minAlpha = Math.min(minAlpha, alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
      const eye = add(add(pos, scale(facing, product.eyeOffset.value)), [0, 0, product.eyeHeight.value]);
      const id = `seat.${label}.${String(number).padStart(2, '0')}`;
      const frame: Frame = { origin: pos, xAxis: right, yAxis: facing, zAxis: cross(right, facing) };
      const rec: SeatRecord = {
        id,
        row: label,
        rowIndex: i,
        number,
        position: pos,
        eyePoint: eye,
        facing,
        screenClearance: sphereRadiusAt(R, eyeZ) - maxPlan,
        distanceFromOrigin: Math.hypot(...eye),
        accessible: false,
      };
      seats.push(rec);
      objects.push({
        id,
        name: `Seat_${label}${number}`,
        layer: '02_AUDIENCE/Seats',
        category: 'Seat',
        geometry: { kind: 'blockInstance', blockId: block.id, frame },
        parentAssembly: `tier.${label}`,
        operatingState: 'seated',
        metadata: {
          row: label,
          seat_number: number,
          product_id: product.id,
          manufacturer: product.manufacturer,
          model: product.model,
          eye_x: +eye[0].toFixed(4),
          eye_y: +eye[1].toFixed(4),
          eye_z: +eye[2].toFixed(4),
        },
      });
      objects.push({
        id: `eye.${label}.${String(number).padStart(2, '0')}`,
        name: `Eye_${label}${number}`,
        layer: '07_ANALYSIS/Eye_Points',
        category: 'EyePoint',
        geometry: { kind: 'point', p: eye },
        parentAssembly: id,
        operatingState: 'seated',
        metadata: { seat: id },
      });
    }

    // Tier platform under the seats actually generated in this row (row A sits on the main floor).
    if (i > 0 && number > 0) {
      const margin = (w / 2 + 0.3) / r;
      objects.push({
        id: `tier.${label}`,
        name: `Tier_${label}`,
        layer: '02_AUDIENCE/Seating_Tiers',
        category: 'SeatingTier',
        geometry: {
          kind: 'annularSector',
          center: [0, s.focusY],
          innerRadius: r - s.rowPitch / 2,
          outerRadius: r + s.rowPitch / 2,
          angle0: minAlpha - margin,
          angle1: maxAlpha + margin,
          zBottom: floor,
          zTop: z,
        },
        operatingState: 'seated',
        metadata: { row: label, riser_m: s.riserHeight, tier_top_z: +z.toFixed(4), row_pitch_m: s.rowPitch, seats: number },
      });
    }
  }

  const issues: Issue[] = [];
  if (dropped.sphere)
    issues.push({ severity: 'info', code: 'seats-dropped-sphere', message: `${dropped.sphere} seat positions fall inside the ${s.screenClearance.toFixed(2)} m screen clearance and were not generated.`, path: 'seating.screenClearance' });
  if (dropped.stage)
    issues.push({ severity: 'info', code: 'seats-dropped-stage', message: `${dropped.stage} seat positions overlap the stage zone (+1 m) and were not generated.`, path: 'stage' });
  if (!seats.length) issues.push({ severity: 'warning', code: 'no-seats', message: 'No seats fit the current geometry.', path: 'seating' });

  return { objects, seats, blocks: [block], issues, dropped };
}
