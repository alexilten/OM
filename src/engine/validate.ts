import { getAudioProduct, getCatalogItem, getStructureSystem, SYSTEMS, type CatalogCategory } from '../library/catalog';
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
    ['led.bandElevationDeg', c.led.bandElevationDeg],
    ['led.bandRows', c.led.bandRows],
    ['led.jointGap', c.led.jointGap],
    ['transformation.nestOffset', c.transformation.nestOffset],
    ['transformation.deckThickness', c.transformation.deckThickness],
    ['transformation.foldedSeatHeight', c.transformation.foldedSeatHeight],
    ['transformation.wagonSpeed', c.transformation.wagonSpeed],
    ['transformation.stageSpeed', c.transformation.stageSpeed],
    ['transformation.clearanceHoldS', c.transformation.clearanceHoldS],
    ['transformation.foldS', c.transformation.foldS],
    ['building.width', c.building.width],
    ['building.depth', c.building.depth],
    ['building.clearHeight', c.building.clearHeight],
    ['building.floorElevation', c.building.floorElevation],
    ['building.offsetX', c.building.offsetX],
    ['building.offsetY', c.building.offsetY],
    ['building.circulationWidth', c.building.circulationWidth],
    ['building.columns.spacingX', c.building.columns.spacingX],
    ['building.columns.spacingY', c.building.columns.spacingY],
    ['building.columns.size', c.building.columns.size],
  ];
  for (const [path, v] of numbers) if (!finite(v)) err(path, 'not-a-number', `${path} must be a finite number.`);
  if (issues.length) return issues;

  const R = c.sphere.radius;
  if (R < 3 || R > 60) err('sphere.radius', 'radius-range', 'Sphere radius must be between 3 m and 60 m.');
  const ring = c.sphere.ringRadius ?? 0;
  if (!finite(ring) || ring < 0 || ring > 60) err('sphere.ringRadius', 'ring-range', 'Torus ring radius must be between 0 m and 60 m.');
  else if (ring > 0 && c.media.elevationUpperDeg > 89.9 && ring < 1.5)
    warn('sphere.ringRadius', 'ring-opening', `The top opening is only ${(2 * ring).toFixed(1)} m across; too small for rigging access.`);

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

  if (c.led.enabled) {
    if (!getLedProduct(c.led.productId)) err('led.productId', 'unknown-led', `Unknown LED product "${c.led.productId}".`);
    if (c.led.extent !== 'full' && c.led.extent !== 'band') err('led.extent', 'led-extent', 'LED extent must be "full" or "band".');
    if (c.led.placement !== 'tangent' && c.led.placement !== 'balanced') err('led.placement', 'led-placement', 'LED placement must be "tangent" or "balanced".');
    if (!isInt(c.led.bandRows) || c.led.bandRows < 1 || c.led.bandRows > 40) err('led.bandRows', 'led-rows', 'LED band rows must be a whole number from 1 to 40.');
    if (c.led.jointGap < 0 || c.led.jointGap > 0.02) err('led.jointGap', 'led-gap', 'LED joint gap must be between 0 and 20 mm.');
  }

  const t = c.transformation;
  if (t.enabled) {
    if (t.seating !== 'telescopic' && t.seating !== 'fixed') err('transformation.seating', 'kin-seating', 'Seating transformation must be "telescopic" or "fixed".');
    if (t.stage !== 'lift' && t.stage !== 'fixed') err('transformation.stage', 'kin-stage', 'Stage transformation must be "lift" or "fixed".');
    if (t.nestOffset <= 0 || t.nestOffset >= c.seating.rowPitch) err('transformation.nestOffset', 'kin-nest', 'Nest offset must be above zero and below the row pitch.');
    if (t.deckThickness <= 0 || t.foldedSeatHeight <= 0) err('transformation.deckThickness', 'kin-deck', 'Deck thickness and folded seat height must be above zero.');
    if (t.wagonSpeed <= 0 || t.stageSpeed <= 0) err('transformation.wagonSpeed', 'kin-speed', 'Machinery speeds must be above zero.');
    if (t.clearanceHoldS < 0 || t.foldS < 0) err('transformation.clearanceHoldS', 'kin-time', 'Hold and fold times cannot be negative.');
  }

  const p = t.proscenium;
  if (p?.enabled) {
    if (![p.widthDeg, p.topDeg, p.travel, p.speed].every(finite)) err('transformation.proscenium.widthDeg', 'prosc-number', 'Proscenium settings must be finite numbers.');
    else {
      if (p.widthDeg < 10 || p.widthDeg > 180) err('transformation.proscenium.widthDeg', 'prosc-width', 'Proscenium width must be between 10° and 180° of azimuth.');
      if (p.topDeg <= c.media.elevationLowerDeg + 1) err('transformation.proscenium.topDeg', 'prosc-top', 'The proscenium top must be at least 1° above the screen\'s lower edge.');
      if (p.travel < 0 || p.travel > 20) err('transformation.proscenium.travel', 'prosc-travel', 'Proscenium travel must be between 0 and 20 m.');
      if (p.speed <= 0) err('transformation.proscenium.speed', 'prosc-speed', 'Proscenium speed must be above zero.');
      if (!finite(p.open) || p.open < 0 || p.open > 1) err('transformation.proscenium.open', 'prosc-open', 'Proscenium opening must be between 0 (closed) and 1 (fully open).');
    }
  }

  if (c.operatingState !== 'seated' && c.operatingState !== 'standing') err('operatingState', 'operating-state', 'Operating state must be "seated" or "standing".');
  else if (c.operatingState === 'standing' && !t.enabled) err('operatingState', 'standing-needs-transformation', 'The standing state needs the transformation turned on.');

  const b = c.building;
  if (b.enabled) {
    if (b.width < 5 || b.depth < 5 || b.width > 300 || b.depth > 300) err('building.width', 'building-size', 'Building width and depth must be between 5 m and 300 m.');
    if (b.clearHeight < 3 || b.clearHeight > 100) err('building.clearHeight', 'building-height', 'Building clear height must be between 3 m and 100 m.');
    if (b.circulationWidth < 0) err('building.circulationWidth', 'building-circulation', 'Circulation width cannot be negative.');
    if (!['none', 'perimeter', 'grid'].includes(b.columns.layout)) err('building.columns.layout', 'building-columns', 'Column layout must be "none", "perimeter" or "grid".');
    else if (b.columns.layout !== 'none') {
      if (b.columns.spacingX < 2 || b.columns.spacingY < 2) err('building.columns.spacingX', 'building-column-spacing', 'Column spacing must be at least 2 m.');
      if (b.columns.size <= 0 || b.columns.size > 3) err('building.columns.size', 'building-column-size', 'Column size must be above zero and at most 3 m.');
    }
  }

  const fitout: [keyof VenueConfiguration['fitout'], CatalogCategory][] = [
    ['riserDeck', 'riser-deck'],
    ['guardrail', 'guardrail'],
    ['seatAccessory', 'seat-accessory'],
  ];
  for (const [key, category] of fitout)
    if (getCatalogItem(c.fitout[key])?.category !== category) err(`fitout.${key}`, 'unknown-fitout', `Unknown ${category.replace('-', ' ')} "${c.fitout[key]}".`);
  for (const spec of SYSTEMS) {
    const s = c.systems[spec.id];
    if (!s) {
      err(`systems.${spec.id}`, 'system-missing', `System "${spec.id}" is missing.`);
      continue;
    }
    if (!['standard', 'premium', 'flagship'].includes(s.tier)) err(`systems.${spec.id}.tier`, 'system-tier', `${spec.label} tier must be standard, premium or flagship.`);
    if (!finite(s.scale) || s.scale < 0.5 || s.scale > 2) err(`systems.${spec.id}.scale`, 'system-scale', `${spec.label} density must be between 0.5 and 2.`);
  }
  if (c.systems.audio && !getAudioProduct(c.systems.audio.product ?? '')) err('systems.audio.product', 'unknown-audio', `Unknown audio array product "${c.systems.audio.product}".`);

  const st = c.structure;
  if (st.enabled) {
    if (!getStructureSystem(st.system)) err('structure.system', 'unknown-structure', `Unknown structure system "${st.system}".`);
    if (!finite(st.ribSpacing) || st.ribSpacing < 1 || st.ribSpacing > 8) err('structure.ribSpacing', 'structure-ribs', 'Rib spacing must be between 1 and 8 m.');
    if (!finite(st.ringSpacing) || st.ringSpacing < 1 || st.ringSpacing > 8) err('structure.ringSpacing', 'structure-rings', 'Ring spacing must be between 1 and 8 m.');
    if (!finite(st.mountGap) || st.mountGap < 0 || st.mountGap > 0.5) err('structure.mountGap', 'structure-gap', 'Mounting gap must be between 0 and 0.5 m.');
    if (!finite(st.maxSegment) || st.maxSegment < 2 || st.maxSegment > 13.5) err('structure.maxSegment', 'structure-segment', 'Shipping segment length must be between 2 and 13.5 m.');
  }

  if (c.analysis) {
    const w = Object.values(c.analysis.weights);
    if (w.some((v) => !finite(v) || v < 0)) err('analysis.weights', 'weights', 'Immersion weights must be zero or positive numbers.');
    else if (w.every((v) => v === 0)) err('analysis.weights', 'weights-zero', 'At least one immersion weight must be above zero.');
  }

  return issues;
}
