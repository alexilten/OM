/**
 * generateVenue: the one entry point from configuration to model. Subsystems run in dependency
 * order (sphere → media → stage → seating → LED → architecture) and only ever read the configuration,
 * never each other's display state.
 */
import { getSeatingProduct } from '../library/seating';
import { architectureMetrics, architectureObjects, stageObjects } from './architecture';
import { LAYERS } from './layers';
import { generateLed } from './led';
import { mediaMetrics, mediaObjects, referenceObjects, sphereRadiusAt } from './media';
import { generateSeating } from './seating';
import type { Issue, Metric, VenueConfiguration, VenueModel } from './types';
import { validateConfig } from './validate';

export class InvalidConfigurationError extends Error {
  constructor(public issues: Issue[]) {
    super(issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' '));
  }
}

export function generateVenue(config: VenueConfiguration): VenueModel {
  const validation = validateConfig(config);
  if (validation.some((i) => i.severity === 'error')) throw new InvalidConfigurationError(validation);

  const issues: Issue[] = [...validation];
  const R = config.sphere.radius;
  const floor = config.floor.mainFloorElevation;
  const bottomZ = R * Math.sin((config.media.elevationLowerDeg * Math.PI) / 180);
  if (bottomZ < floor)
    issues.push({ severity: 'info', code: 'media-below-floor', message: `The lower ${(floor - bottomZ).toFixed(2)} m of the media surface lies below the main floor and will be hidden.`, path: 'media.elevationLowerDeg' });

  const stage = stageObjects(config);
  const seating = generateSeating(config);
  const led = generateLed(config);
  issues.push(...stage.issues, ...seating.issues, ...led.issues);

  const objects = [...referenceObjects(config), ...mediaObjects(config), ...stage.objects, ...seating.objects, ...led.objects, ...architectureObjects(config)];

  const known = new Set(LAYERS.map((l) => l.path));
  for (const o of objects) if (!known.has(o.layer)) throw new Error(`Object ${o.id} uses unknown layer ${o.layer}`);
  const ids = new Set<string>();
  for (const o of objects) {
    if (ids.has(o.id)) throw new Error(`Duplicate object id ${o.id}`);
    ids.add(o.id);
  }

  const product = getSeatingProduct(config.seating.productId)!;
  const seats = seating.seats;
  const rows = new Set(seats.map((s) => s.row)).size;
  const eyeZ = seats.map((s) => s.eyePoint[2]);
  const nearest = seats.length ? Math.min(...seats.map((s) => s.distanceFromOrigin)) : 0;
  const minClear = seats.length ? Math.min(...seats.map((s) => s.screenClearance)) : 0;
  const floorRadius = sphereRadiusAt(R, floor);

  const audience: Metric[] = [
    { key: 'aud.seats', label: 'Seated capacity', value: seats.length, unit: 'count', quality: 'exact', group: 'Audience' },
    { key: 'aud.rows', label: 'Rows', value: rows, unit: 'count', quality: 'exact', group: 'Audience' },
    { key: 'aud.product', label: 'Seat type', value: `${product.manufacturer} ${product.model}`, quality: product.width.status === 'manufacturer' ? 'derived' : 'estimate', group: 'Audience' },
    { key: 'aud.dropped', label: 'Seat positions rejected', value: seating.dropped.sphere + seating.dropped.stage, unit: 'count', quality: 'exact', group: 'Audience' },
    { key: 'aud.eyeMin', label: 'Lowest eye point', value: eyeZ.length ? Math.min(...eyeZ) : 0, unit: 'm', quality: 'derived', group: 'Audience' },
    { key: 'aud.eyeMax', label: 'Highest eye point', value: eyeZ.length ? Math.max(...eyeZ) : 0, unit: 'm', quality: 'derived', group: 'Audience' },
    { key: 'aud.nearestOrigin', label: 'Nearest eye point to origin', value: nearest, unit: 'm', quality: 'derived', group: 'Audience' },
    { key: 'aud.minClear', label: 'Min seat-to-sphere clearance', value: minClear, unit: 'm', quality: 'derived', group: 'Audience' },
    // Conceptual only: 0.5 m² per standing person on the floor disc inside the screen clearance.
    { key: 'aud.standing', label: 'Standing capacity (concept, not occupancy)', value: Math.floor((Math.PI * Math.max(0, floorRadius - config.seating.screenClearance) ** 2 - config.stage.width * config.stage.depth) / 0.5), unit: 'count', quality: 'conceptual', group: 'Audience' },
  ];

  return {
    config,
    objects,
    blocks: [...seating.blocks, ...led.blocks],
    led: led.summary,
    seats,
    metrics: [...mediaMetrics(config), ...led.metrics, ...audience, ...architectureMetrics(config)],
    issues,
  };
}

/** Never throws: returns either a model or the blocking issues. */
export function tryGenerateVenue(config: VenueConfiguration): { model?: VenueModel; issues: Issue[] } {
  try {
    const model = generateVenue(config);
    return { model, issues: model.issues };
  } catch (e) {
    if (e instanceof InvalidConfigurationError) return { issues: e.issues };
    return { issues: [{ severity: 'error', code: 'generator-failure', message: (e as Error).message }] };
  }
}
