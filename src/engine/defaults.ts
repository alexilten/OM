import { DEFAULT_ANALYSIS } from './immersion';
import type { VenueConfiguration } from './types';

/**
 * OM 300 / Flagship — the reference configuration the app opens with.
 * Values are exploratory starting points, not validated design decisions.
 */
export const OM_300_FLAGSHIP: VenueConfiguration = {
  schemaVersion: 1,
  id: 'om-300-flagship',
  name: 'OM 300 / Flagship',
  sphere: { radius: 13 },
  media: {
    azimuthLeftDeg: -110,
    azimuthRightDeg: 110,
    elevationLowerDeg: -7.5,
    elevationUpperDeg: 72,
  },
  floor: { mainFloorElevation: -1.8, slabThickness: 0.3 },
  seating: {
    productId: 'figueras-smart-13033',
    focusY: 5.5,
    frontRowRadius: 4.0,
    rowCount: 12,
    rowPitch: 1.1,
    riserHeight: 0.3,
    sectionAngleDeg: 130,
    aisleCount: 2,
    aisleWidth: 1.2,
    screenClearance: 1.5,
  },
  stage: { type: 'cinematic', width: 9, depth: 3.2, height: 0.9, centerY: 9.0 },
  envelope: { serviceZone: 1.5, overheadClearance: 2.0 },
  led: { enabled: true, productId: 'roe-ruby-c-rbc2.6f', extent: 'full', bandElevationDeg: 10, bandRows: 3, placement: 'tangent', jointGap: 0 },
  analysis: DEFAULT_ANALYSIS,
};

export function cloneConfig(c: VenueConfiguration): VenueConfiguration {
  return JSON.parse(JSON.stringify(c)) as VenueConfiguration;
}

/**
 * Brings a saved configuration up to the current shape. Round 01–02 files carry `ledPreview`
 * (a band of rows); it becomes `led` with the band extent so the file regenerates as it was saved.
 */
export function normalizeConfig(raw: VenueConfiguration & { ledPreview?: { enabled: boolean; productId: string; bandElevationDeg: number; bandRows: number } }): VenueConfiguration {
  const { ledPreview, ...rest } = cloneConfig(raw) as typeof raw;
  const c = rest as VenueConfiguration;
  if (!c.led && ledPreview) c.led = { ...ledPreview, extent: 'band', placement: 'tangent', jointGap: 0 };
  c.led ??= cloneConfig(OM_300_FLAGSHIP).led;
  c.analysis ??= cloneConfig(OM_300_FLAGSHIP).analysis;
  return c;
}
