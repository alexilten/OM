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
  ledPreview: { enabled: true, productId: 'roe-ruby-c-rbc2.6f', bandElevationDeg: 10, bandRows: 3 },
  analysis: DEFAULT_ANALYSIS,
};

export function cloneConfig(c: VenueConfiguration): VenueConfiguration {
  return JSON.parse(JSON.stringify(c)) as VenueConfiguration;
}
