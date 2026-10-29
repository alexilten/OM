/**
 * OM Studio parametric data model.
 *
 * `VenueConfiguration` is the single source of truth. Everything else (`VenueModel`, viewport meshes,
 * the Rhino file) is regenerated from it, so a saved configuration always reproduces its geometry.
 * All lengths are metres and all angles in the configuration are degrees; generated geometry uses radians.
 */

import type { AnalysisSettings } from './immersion';
import type { LedSummary } from './led';
import type { TransformationModel } from './kinetics';
import type { BuildingFit } from './building';
import type { SystemsSummary } from './systems';
import type { StructureSummary } from './structure';

export type Vec3 = [number, number, number];

// ─── Verification ────────────────────────────────────────────────────────────

/**
 * How much a specification value can be trusted.
 *  - manufacturer: read from a manufacturer datasheet or product page (source recorded).
 *  - secondary:    read from a reseller / specification aggregator; confirm with the manufacturer.
 *  - placeholder:  an assumption so the tool can run; must be replaced before relying on it.
 *  - conceptual:   describes an idea that no manufacturer has offered yet.
 */
export type VerificationStatus = 'manufacturer' | 'secondary' | 'placeholder' | 'conceptual';

export interface SpecValue<T = number> {
  value: T;
  status: VerificationStatus;
  /** Key into the product's `sources` list. */
  source?: string;
  note?: string;
}

export interface SourceReference {
  id: string;
  title: string;
  url: string;
  /** ISO date the source was read. */
  accessed: string;
}

// ─── Configuration (source of truth) ────────────────────────────────────────

export interface SphereDefinition {
  /** Radius of the reference sphere (the tube radius of the torus form). Its centre is always the world origin. */
  radius: number;
  /**
   * Torus form (Round 10): ring radius of the tube centre circle in the equator plane. 0 or absent is
   * the sphere; above 0 the screen is a torus section, and an upper elevation below 90° cuts the top off.
   */
  ringRadius?: number;
}

export interface MediaSurfaceDefinition {
  /** Left edge azimuth in degrees (negative = audience left). */
  azimuthLeftDeg: number;
  /** Right edge azimuth in degrees. */
  azimuthRightDeg: number;
  /** Lower edge elevation in degrees above the sphere equator (may be negative). */
  elevationLowerDeg: number;
  /** Upper edge elevation in degrees. 90 closes the patch at the zenith. */
  elevationUpperDeg: number;
}

export interface FloorDefinition {
  /** Main floor elevation relative to the sphere origin (normally negative). */
  mainFloorElevation: number;
  slabThickness: number;
}

export type SeatingCategory =
  | 'premium-theater'
  | 'luxury-cinema'
  | 'executive-recliner'
  | 'compact-retractable'
  | 'lounge-social';

export interface SeatingLayout {
  productId: string;
  /** Rows are arcs about the seating layout origin (0, focusY, floor). Seats face this point. */
  focusY: number;
  /** Plan distance from the layout origin to the first row's seat reference points. */
  frontRowRadius: number;
  rowCount: number;
  /** Plan distance between successive rows (back-to-back). */
  rowPitch: number;
  /** Height step between successive rows. */
  riserHeight: number;
  /** Total plan angle of the seating fan, centred on -Y (behind the layout origin). */
  sectionAngleDeg: number;
  /** Number of radial aisles inside the fan. */
  aisleCount: number;
  aisleWidth: number;
  /**
   * Minimum plan clearance between a seat's rear edge and the reference sphere, measured at the
   * seat's eye height. Seats that violate it are not generated (and are reported).
   */
  screenClearance: number;
}

export type StageType = 'minimal' | 'concert' | 'cinematic' | 'proscenium' | 'central' | 'custom';

export interface StageDefinition {
  type: StageType;
  width: number;
  depth: number;
  /** Deck height above the main floor. */
  height: number;
  /** Plan position of the stage centre on the Y axis. */
  centerY: number;
}

export interface EnvelopeDefinition {
  /** Plan zone kept clear behind the media surface for structure, LED service and MEP. */
  serviceZone: number;
  /** Vertical clearance above the highest part of the media surface. */
  overheadClearance: number;
}

export interface LedSystemDefinition {
  enabled: boolean;
  productId: string;
  /** Whole media surface, or a quick band of rows around one latitude. */
  extent: 'full' | 'band';
  /** Elevation of the band's centre line, degrees (band extent only). */
  bandElevationDeg: number;
  /** Number of unit rows in the band (band extent only). */
  bandRows: number;
  /** Flat units: face centres on the sphere (tangent), or pulled forward so faces straddle it (balanced). */
  placement: 'tangent' | 'balanced';
  /** Design joint between neighbouring units (m). */
  jointGap: number;
}

/**
 * Seated ↔ standing transformation. Every value here is conceptual: the machinery is not engineered,
 * and the checks are geometric only.
 */
export interface TransformationDefinition {
  enabled: boolean;
  /** Telescopic: each row block is a wagon that nests under the back row. Fixed: seats stay put. */
  seating: 'telescopic' | 'fixed';
  /** Plan offset left between nested wagons (m). */
  nestOffset: number;
  /** Wagon deck thickness (m). */
  deckThickness: number;
  /** Height of a folded seat above its deck (m). */
  foldedSeatHeight: number;
  /** Wagon travel speed (m/s). */
  wagonSpeed: number;
  /** Lift: the stage deck lowers flush with the floor for standing. */
  stage: 'lift' | 'fixed';
  stageSpeed: number;
  /** Hold before any motion while the audience clears the moving zones (s). */
  clearanceHoldS: number;
  /** Seat fold time (s). */
  foldS: number;
  /** Front section of the screen that slides back (+Y) to open a proscenium. */
  proscenium: ProsceniumDefinition;
}

/**
 * Retractable proscenium (Round 10). A sector of the media surface centred on the forward axis, from
 * the screen's lower edge up to `topDeg`, is a separate carriage that slides straight back along +Y by
 * `travel` and then splits and slides apart, leaving a proscenium opening in the front of the sphere.
 * `open` sets how far; `onTimeline` plays it on the seated → standing sequence. LED units whose centres fall in the sector
 * ride on the carriage.
 */
export interface ProsceniumDefinition {
  enabled: boolean;
  /** Width of the moving section, degrees of azimuth centred on +Y. */
  widthDeg: number;
  /** Upper edge of the moving section, degrees of elevation. */
  topDeg: number;
  /** Distance the section slides back along +Y (m). */
  travel: number;
  /** Carriage speed (m/s). */
  speed: number;
  /**
   * How far open, 0–1. The first half of the range pushes the carriage back by `travel`; the second
   * half splits it at the forward axis and slides each half sideways until the opening is clear.
   */
  open: number;
  /**
   * On: closed when seated, opening to `open` on the seated → standing timeline (needs the
   * transformation). Off: held at `open` in every state.
   */
  onTimeline: boolean;
}

/**
 * A simplified existing building the venue is placed in (Round 05 venue fit). Positions are in venue
 * coordinates: the building rectangle is centred at (offsetX, offsetY), axis-aligned, and the
 * structural floor is an elevation relative to the sphere origin like every other z.
 */
export interface BuildingDefinition {
  enabled: boolean;
  /** Clear inside width (X) and depth (Y), wall face to wall face. */
  width: number;
  depth: number;
  /** Clear height from the structural floor to the underside of the roof structure. */
  clearHeight: number;
  /** Top of the existing structural floor. */
  floorElevation: number;
  offsetX: number;
  offsetY: number;
  /** Walkway kept clear between the venue's design envelope and the walls. */
  circulationWidth: number;
  columns: {
    layout: 'none' | 'perimeter' | 'grid';
    /** Centre-to-centre spacing along X and Y. */
    spacingX: number;
    spacingY: number;
    /** Square column section. */
    size: number;
  };
}

/**
 * Support structure behind the media surface (Round 07): curved ribs on meridians and ring girders on
 * latitudes, generated from the media patch and the LED depth, split into shippable segments. It is
 * also the rigging backbone: audio arrays hang in its bays and hoists pick up from it.
 */
export interface StructureDefinition {
  enabled: boolean;
  /** Rib and ring product family (id into STRUCTURE_SYSTEMS). */
  system: string;
  /** Target rib spacing measured along the equator (m). */
  ribSpacing: number;
  /** Target ring girder spacing measured along a rib (m). */
  ringSpacing: number;
  /** Gap between the back of the LED and the front of the ribs (m). */
  mountGap: number;
  /** Longest segment (arc length) shipped in one piece (m). */
  maxSegment: number;
  /** Service walkways behind the structure on alternate ring levels. */
  walkways: boolean;
}

/** The two end states of the transformation. */
export type VenueState = 'seated' | 'standing';

/** Quality tier for catalog items and immersion systems. */
export type Tier = 'standard' | 'premium' | 'flagship';

/** Fit-out products chosen from the catalog (ids into src/library/catalog.ts). */
export interface FitoutDefinition {
  riserDeck: string;
  guardrail: string;
  seatAccessory: string;
}

export interface SystemSetting {
  enabled: boolean;
  tier: Tier;
  /** Density multiplier on the tier's unit count (0.5–2). */
  scale: number;
  /** Product choice where a system offers several (audio: an id from AUDIO_PRODUCTS). */
  product?: string;
}

export type SystemId = 'lighting' | 'audio' | 'haptics' | 'atmospherics' | 'tracking';

/** Immersion and technical systems, each a set of conceptual units on its own layer. */
export type SystemsDefinition = Record<SystemId, SystemSetting>;

/** Where a configuration came from; edits after applying a preset keep this as a record. */
export interface PresetOrigin {
  size: string;
  performance: string;
}

export interface VenueConfiguration {
  schemaVersion: 1;
  id: string;
  name: string;
  sphere: SphereDefinition;
  media: MediaSurfaceDefinition;
  floor: FloorDefinition;
  seating: SeatingLayout;
  stage: StageDefinition;
  envelope: EnvelopeDefinition;
  led: LedSystemDefinition;
  transformation: TransformationDefinition;
  building: BuildingDefinition;
  fitout: FitoutDefinition;
  systems: SystemsDefinition;
  structure: StructureDefinition;
  /** The state the venue is shown and exported in outside the TRANSFORM timeline. */
  operatingState: VenueState;
  preset?: PresetOrigin;
  /** Immersion weights and ramps. Optional so Round 01 files still open; defaults apply when absent. */
  analysis?: AnalysisSettings;
  /** The live show preview saved with this alternative (Round 09). Never affects geometry or export. */
  show?: import('../show/definition').ShowDefinition;
}

// ─── Component library ───────────────────────────────────────────────────────

export interface SeatingProduct {
  id: string;
  category: SeatingCategory;
  manufacturer: string;
  productFamily: string;
  model: string;
  /** Seat centre-to-centre width in a row. */
  width: SpecValue;
  /** Depth with the seat closed / upright. */
  depth: SpecValue;
  /** Depth fully reclined or opened, if applicable. */
  depthOpen?: SpecValue;
  overallHeight: SpecValue;
  seatHeight: SpecValue;
  armrestWidth: SpecValue;
  /** Seated eye height above the tier floor. */
  eyeHeight: SpecValue;
  /** Eye point offset forward of the seat footprint centre. */
  eyeOffset: SpecValue;
  preferredRowPitch: SpecValue;
  minClearway: SpecValue;
  transformable: SpecValue<string>;
  sources: SourceReference[];
  revision: string;
  notes?: string;
}

export type LedFamily =
  | '01-faceted'
  | '02-single-axis-curved'
  | '03-flexible'
  | '04-purpose-built-spherical'
  | '05-custom-modular-spherical';

export interface LedProduct {
  id: string;
  family: LedFamily;
  manufacturer: string;
  productFamily: string;
  model: string;
  cabinetWidth: SpecValue;
  cabinetHeight: SpecValue;
  cabinetDepth: SpecValue;
  pixelPitch: SpecValue;
  pixelsX: SpecValue;
  pixelsY: SpecValue;
  weightKg: SpecValue;
  powerMaxW: SpecValue;
  powerAvgW: SpecValue;
  /** Max concave inter-cabinet / cabinet curve angle in degrees, if applicable. */
  curveConcaveDeg?: SpecValue;
  curveConvexDeg?: SpecValue;
  curvatureDirection: SpecValue<string>;
  curvatureIncrement?: SpecValue<string>;
  minBendRadius?: SpecValue;
  viewingAngleDeg?: SpecValue;
  serviceAccess: SpecValue<string>;
  mounting: SpecValue<string>;
  sources: SourceReference[];
  revision: string;
  notes?: string;
}

// ─── Generated model ─────────────────────────────────────────────────────────

/** Orthonormal local frame; used for block instances (seats, cabinets). */
export interface Frame {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
}

/**
 * Neutral geometry descriptors. Each one maps to exact CAD geometry (Rhino) and to a display mesh
 * (Three.js); neither representation is the source of truth.
 */
export type Geometry =
  | { kind: 'point'; p: Vec3 }
  | { kind: 'line'; a: Vec3; b: Vec3 }
  | { kind: 'polyline'; points: Vec3[]; closed: boolean }
  /** Full circle in a plane with the given normal. */
  | { kind: 'circle'; center: Vec3; normal: Vec3; radius: number }
  /** Arc of a latitude circle on the reference sphere. */
  | { kind: 'latitudeArc'; radius: number; elevation: number; azimuth0: number; azimuth1: number; ring?: number }
  /** Arc of a meridian on the reference sphere. */
  | { kind: 'meridianArc'; radius: number; azimuth: number; elevation0: number; elevation1: number; ring?: number }
  /** Sphere, or with `ring` > 0 the full torus about Z through `center`. */
  | { kind: 'sphere'; center: Vec3; radius: number; ring?: number }
  /** Exact azimuth/elevation-bounded patch of the origin-centred sphere (radians). */
  | { kind: 'spherePatch'; radius: number; azimuth0: number; azimuth1: number; elevation0: number; elevation1: number; ring?: number; /** Translation applied after the patch is built (a moved carriage). */ offset?: Vec3 }
  /** Axis-aligned box. */
  | { kind: 'box'; min: Vec3; max: Vec3 }
  /** Box in a local frame: x ∈ [-sx/2, sx/2], y ∈ [-sy/2, sy/2], z ∈ [z0, z0 + sz]. */
  | { kind: 'frameBox'; frame: Frame; size: Vec3; z0: number }
  /**
   * Annular sector extruded vertically. `angle` is measured in plan about `center` from -Y
   * towards +X (so a fan behind the centre spans negative-to-positive angles).
   */
  | {
      kind: 'annularSector';
      center: [number, number];
      innerRadius: number;
      outerRadius: number;
      angle0: number;
      angle1: number;
      zBottom: number;
      zTop: number;
    }
  | { kind: 'blockInstance'; blockId: string; frame: Frame };

export type LayerPath = string; // e.g. "02_AUDIENCE/Seats"

export type OperatingState = 'seated' | 'standing' | 'all';

export interface VenueObject {
  /** Stable identifier: the same configuration always yields the same ids. */
  id: string;
  name: string;
  layer: LayerPath;
  category: string;
  geometry: Geometry;
  parentAssembly?: string;
  operatingState?: OperatingState;
  /** Exported to Rhino as user strings. */
  metadata: Record<string, string | number>;
}

export interface BlockPart {
  geometry: Geometry;
  /** Material hint for the viewport. */
  role: string;
}

export interface BlockDefinition {
  id: string;
  name: string;
  description: string;
  parts: BlockPart[];
  metadata: Record<string, string | number>;
}

export interface SeatRecord {
  id: string;
  row: string;
  rowIndex: number;
  number: number;
  /** Seat floor reference point (footprint centre on the tier). */
  position: Vec3;
  eyePoint: Vec3;
  facing: Vec3;
  /** Plan distance from the eye point to the reference sphere at eye height. */
  screenClearance: number;
  distanceFromOrigin: number;
  accessible: boolean;
  /** Aisle block within the row (0 = leftmost seen from the stage side). */
  block: number;
}

export type MetricQuality = 'exact' | 'derived' | 'estimate' | 'conceptual';

export interface Metric {
  key: string;
  label: string;
  value: number | string;
  unit?: 'm' | 'm2' | 'm3' | 'deg' | 'count' | 'kg' | 'W' | 'px' | 'USD' | '';
  quality: MetricQuality;
  group: 'Geometry' | 'Media' | 'LED' | 'Audience' | 'Transformation' | 'Architecture' | 'Systems' | 'Structure';
}

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Configuration path the issue refers to, e.g. "media.elevationUpperDeg". */
  path?: string;
}

export interface VenueModel {
  config: VenueConfiguration;
  objects: VenueObject[];
  blocks: BlockDefinition[];
  seats: SeatRecord[];
  metrics: Metric[];
  issues: Issue[];
  /** LED panelization totals, when the LED system is enabled. */
  led?: LedSummary;
  /** Kinetic assemblies and the seated → standing sequence, when enabled. */
  transformation?: TransformationModel;
  /** Building fit, when a building is defined. */
  fit?: BuildingFit;
  /** Fit-out and immersion systems: counts, loads and placeholder costs. */
  systems: SystemsSummary;
  /** Support structure, segments and pick-up schedule, when enabled. */
  structure?: StructureSummary;
}
