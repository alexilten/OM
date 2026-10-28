import { getLedProduct } from '../library/led';
import { getSeatingProduct } from '../library/seating';
import type { Issue, VenueConfiguration } from './types';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isInt = (n: number) => Number.isInteger(n);

/**
 * Checks a configuration before generation. Any `error` blocks regeneration, so an invalid edit
 * can never silently corrupt the scene; the app keeps showing the last valid model.
 */
export function validateConfig(c: VenueConfiguration): Issue[] {
  const issues: Issue[] = [];
  const err = (path: string, code: string, message: string) => issues.push({ severity: 'error', code, message, path });
  const warn = (path: string, code: string, message: string) => issues.push({ severity: 'warning', code, message, path });

  const numbers: [string, unknown][] = [
    ['sphere.radius', c.sphere.radius],
    ['media.azimuthLeftDeg', c.media.azimuthLeftDeg],
    ['media.azimuthRightDeg', c.media.azimuthRightDeg],
    ['media.elevationLowerDeg', c.media.elevationLowerDeg],
    ['media.elevationUpperDeg', c.media.elevationUpperDeg],
    ['floor.mainFloorElevation', c.floor.mainFloorElevation],
    ['floor.slabThickness', c.floor.slabThickness],
    ['seating.focusY', c.seating.focusY],
    ['seating.frontRowRadius', c.seating.frontRowRadius],
    ['seating.rowCount', c.seating.rowCount],
    ['seating.rowPitch', c.seating.rowPitch],
    ['seating.riserHeight', c.seating.riserHeight],
    ['seating.sectionAngleDeg', c.seating.sectionAngleDeg],
    ['seating.aisleCount', c.seating.aisleCount],
    ['seating.aisleWidth', c.seating.aisleWidth],
    ['seating.screenClearance', c.seating.screenClearance],
    ['stage.width', c.stage.width],
    ['stage.depth', c.stage.depth],
    ['stage.height', c.stage.height],
    ['stage.centerY', c.stage.centerY],
    ['envelope.serviceZone', c.envelope.serviceZone],
    ['envelope.overheadClearance', c.envelope.overheadClearance],
    ['ledPreview.bandElevationDeg', c.ledPreview.bandElevationDeg],
    ['ledPreview.bandRows', c.ledPreview.bandRows],
  ];
  for (const [path, v] of numbers) if (!finite(v)) err(path, 'not-a-number', `${path} must be a finite number.`);
  if (issues.length) return issues;

  const R = c.sphere.radius;
  if (R < 3 || R > 60) err('sphere.radius', 'radius-range', 'Sphere radius must be between 3 m and 60 m.');

  const { azimuthLeftDeg: aL, azimuthRightDeg: aR, elevationLowerDeg: eL, elevationUpperDeg: eU } = c.media;
  if (aL < -180 || aR > 180) err('media.azimuthLeftDeg', 'azimuth-range', 'Azimuth limits must lie within ±180°.');
  if (aR - aL < 1) err('media.azimuthRightDeg', 'azimuth-order', 'Right azimuth must exceed left azimuth by at least 1°.');
  if (eL < -90 || eU > 90) err('media.elevationLowerDeg', 'elevation-range', 'Elevation limits must lie within ±90°.');
  if (eU - eL < 1) err('media.elevationUpperDeg', 'elevation-order', 'Upper elevation must exceed lower elevation by at least 1°.');

  const f = c.floor.mainFloorElevation;
  if (f >= 0) err('floor.mainFloorElevation', 'floor-above-origin', 'The main floor must lie below the sphere origin (the reference eye point).');
  if (Math.abs(f) >= R * 0.9) err('floor.mainFloorElevation', 'floor-outside-sphere', 'The main floor must cut the sphere well inside its radius.');
  if (c.floor.slabThickness <= 0) err('floor.slabThickness', 'slab', 'Slab thickness must be positive.');

  const s = c.seating;
  const product = getSeatingProduct(s.productId);
  if (!product) err('seating.productId', 'unknown-seat', `Unknown seating product "${s.productId}".`);
  if (!isInt(s.rowCount) || s.rowCount < 1 || s.rowCount > 60) err('seating.rowCount', 'row-count', 'Row count must be a whole number from 1 to 60.');
  if (!isInt(s.aisleCount) || s.aisleCount < 0 || s.aisleCount > 12) err('seating.aisleCount', 'aisle-count', 'Aisle count must be a whole number from 0 to 12.');
  if (s.sectionAngleDeg < 10 || s.sectionAngleDeg > 340) err('seating.sectionAngleDeg', 'section-angle', 'Seating fan angle must be between 10° and 340°.');
  if (s.frontRowRadius < 1) err('seating.frontRowRadius', 'front-row', 'Front row radius must be at least 1 m.');
  if (s.riserHeight < 0 || s.riserHeight > 0.6) err('seating.riserHeight', 'riser', 'Riser height must be between 0 and 0.6 m.');
  if (s.screenClearance < 0) err('seating.screenClearance', 'clearance', 'Screen clearance cannot be negative.');
  if (product) {
    const minPitch = product.depth.value + product.minClearway.value;
    if (s.rowPitch < minPitch)
      err('seating.rowPitch', 'row-pitch', `Row pitch ${s.rowPitch.toFixed(2)} m is less than seat depth + clearway (${minPitch.toFixed(2)} m) for ${product.manufacturer} ${product.model}; seats would overlap.`);
    if (product.depthOpen && s.rowPitch < product.depthOpen.value + product.minClearway.value)
      warn('seating.rowPitch', 'row-pitch-reclined', `Row pitch does not leave a clearway when ${product.model} is fully reclined.`);
  }
  if (s.aisleCount > 0 && s.aisleWidth < 1.1)
    warn('seating.aisleWidth', 'aisle-width', 'Aisle narrower than 1.1 m (common UK guidance, BS 9999); confirm with egress design.');
  if (s.riserHeight > 0.38)
    warn('seating.riserHeight', 'riser-steep', 'Riser exceeds 380 mm; aisle steps would need intermediate half-steps.');

  if (c.stage.width <= 0 || c.stage.depth <= 0 || c.stage.height < 0) err('stage.width', 'stage-size', 'Stage dimensions must be positive.');
  if (c.envelope.serviceZone < 0 || c.envelope.overheadClearance < 0) err('envelope.serviceZone', 'envelope', 'Envelope clearances cannot be negative.');

  if (c.ledPreview.enabled) {
    if (!getLedProduct(c.ledPreview.productId)) err('ledPreview.productId', 'unknown-led', `Unknown LED product "${c.ledPreview.productId}".`);
    if (!isInt(c.ledPreview.bandRows) || c.ledPreview.bandRows < 1 || c.ledPreview.bandRows > 40)
      err('ledPreview.bandRows', 'led-rows', 'LED preview rows must be a whole number from 1 to 40.');
  }

  return issues;
}
