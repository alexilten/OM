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
  sphere: { radius: 13, ringRadius: 0 },
  media: {
    azimuthLeftDeg: -110,
    azimuthRightDeg: 110,
    elevationLowerDeg: -7.5,
    elevationUpperDeg: 54,
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
  transformation: {
    enabled: true,
    seating: 'telescopic',
    nestOffset: 0.25,
    deckThickness: 0.08,
    foldedSeatHeight: 0.2,
    wagonSpeed: 0.08,
    stage: 'lift',
    stageSpeed: 0.05,
    clearanceHoldS: 60,
    foldS: 20,
    proscenium: { enabled: false, widthDeg: 70, topDeg: 30, travel: 4, speed: 0.1, open: 1, onTimeline: true },
  },
  building: {
    enabled: true,
    width: 36,
    depth: 40,
    clearHeight: 19,
    floorElevation: -3.3,
    offsetX: 0,
    offsetY: -2,
    circulationWidth: 2,
    columns: { layout: 'perimeter', spacingX: 9, spacingY: 10, size: 0.6 },
  },
  fitout: { riserDeck: 'deck-acoustic', guardrail: 'rail-glass', seatAccessory: 'acc-side-table' },
  systems: {
    lighting: { enabled: true, tier: 'premium', scale: 1, crownDropDeg: 0 },
    audio: { enabled: true, tier: 'premium', scale: 1, product: 'holoplot-x1' },
    haptics: { enabled: true, tier: 'premium', scale: 1 },
    atmospherics: { enabled: true, tier: 'standard', scale: 1 },
    tracking: { enabled: false, tier: 'standard', scale: 1 },
  },
  structure: { enabled: true, system: 'steel-truss', ribSpacing: 2.4, ringSpacing: 3.0, mountGap: 0.1, maxSegment: 6.0, walkways: true },
  operatingState: 'seated',
  preset: { size: 'om-300', performance: 'cinematic' },
  led: { enabled: true, productId: 'roe-ruby-c-rbc2.6f', extent: 'full', bandElevationDeg: 10, bandRows: 3, placement: 'tangent', jointGap: 0 },
  analysis: DEFAULT_ANALYSIS,
};

export function cloneConfig(c: VenueConfiguration): VenueConfiguration {
  return JSON.parse(JSON.stringify(c)) as VenueConfiguration;
}

/**
 * Brings a saved configuration up to the current shape. Round 01–02 files carry `ledPreview`
 * (a band of rows); it becomes `led` with the band extent so the file regenerates as it was saved.
 * Files before Round 04 get the default transformation; files before Round 05 get the default
 * building with its fit check off, so they regenerate the same objects, and the seated state.
 * Files before Round 06 get the default fit-out (costed only, no new geometry) and every system off.
 * Files before Round 07 get the default structure switched off.
 */
export function normalizeConfig(raw: VenueConfiguration & { ledPreview?: { enabled: boolean; productId: string; bandElevationDeg: number; bandRows: number } }): VenueConfiguration {
  const { ledPreview, ...rest } = cloneConfig(raw) as typeof raw;
  const c = rest as VenueConfiguration;
  if (!c.led && ledPreview) c.led = { ...ledPreview, extent: 'band', placement: 'tangent', jointGap: 0 };
  c.led ??= cloneConfig(OM_300_FLAGSHIP).led;
  c.transformation ??= cloneConfig(OM_300_FLAGSHIP).transformation;
  c.transformation.proscenium ??= { ...cloneConfig(OM_300_FLAGSHIP).transformation.proscenium };
  c.transformation.proscenium.open ??= 1;
  c.transformation.proscenium.onTimeline ??= true;
  c.analysis ??= cloneConfig(OM_300_FLAGSHIP).analysis;
  c.building ??= { ...cloneConfig(OM_300_FLAGSHIP).building, enabled: false };
  c.sphere.ringRadius ??= 0;
  c.operatingState ??= 'seated';
  c.fitout ??= cloneConfig(OM_300_FLAGSHIP).fitout;
  if (!c.systems) {
    const systems = cloneConfig(OM_300_FLAGSHIP).systems;
    for (const s of Object.values(systems)) s.enabled = false;
    c.systems = systems;
  }
  c.systems.lighting.crownDropDeg ??= 0;
  c.structure ??= { ...cloneConfig(OM_300_FLAGSHIP).structure, enabled: false };
  return c;
}
