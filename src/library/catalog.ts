/**
 * Fit-out and immersion-system catalog, revision R06 (2026-10-28).
 *
 * Tiers: standard = industry-standard auditorium practice, premium = high-end cinema / theatre,
 * flagship = bespoke immersive-venue level. Every cost, weight and power figure here is a
 * placeholder for comparing options, not a quote; items name a product class, not a selected
 * manufacturer model, unless a source is given. Replace with supplier data as it arrives.
 */
import type { SpecValue, SystemId, Tier } from '../engine/types';

const p = (value: number, note?: string): SpecValue => ({ value, status: 'placeholder', note });
const sec = (value: number, source: string, note?: string): SpecValue => ({ value, status: 'secondary', source, note });
const m = (value: number, source: string, note?: string): SpecValue => ({ value, status: 'manufacturer', source, note });

export const TIERS: { id: Tier; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'premium', label: 'Premium' },
  { id: 'flagship', label: 'Flagship' },
];

export type CatalogCategory = 'riser-deck' | 'guardrail' | 'seat-accessory';

export interface CatalogItem {
  id: string;
  category: CatalogCategory;
  tier: Tier;
  name: string;
  description: string;
  /** What `cost`, `weight` and `power` are per. */
  unit: 'm2' | 'm' | 'seat';
  cost: SpecValue;
  weight: SpecValue;
  power: SpecValue;
  /** Category-specific dimensions (m). */
  dims?: Record<string, number>;
}

export const CATALOG: CatalogItem[] = [
  // Seating decks (the wagon / tier floors).
  { id: 'deck-ply-steel', category: 'riser-deck', tier: 'standard', name: 'Steel frame, plywood deck, carpet', description: 'Industry-standard tiered deck: steel sub-frame, 18 mm ply, contract carpet.', unit: 'm2', cost: p(180), weight: p(45), power: p(0), dims: { thickness: 0.08 } },
  { id: 'deck-acoustic', category: 'riser-deck', tier: 'premium', name: 'Acoustically damped modular deck', description: 'Isolated modular deck with damping layer, step nosing lights, timber or vinyl finish.', unit: 'm2', cost: p(420), weight: p(60), power: p(2, 'Nosing lights'), dims: { thickness: 0.1 } },
  { id: 'deck-bespoke', category: 'riser-deck', tier: 'flagship', name: 'Bespoke deck with integrated services', description: 'Thin composite deck with under-seat air, power and data, LED edge lighting, hardwood finish.', unit: 'm2', cost: p(950), weight: p(70), power: p(6, 'Edge lighting and seat services'), dims: { thickness: 0.12 } },
  // Guardrails at fall edges.
  { id: 'rail-steel', category: 'guardrail', tier: 'standard', name: 'Painted steel tube guardrail', description: 'Code-height steel tube rail with mid-rail.', unit: 'm', cost: p(220), weight: p(12), power: p(0), dims: { height: 1.1 } },
  { id: 'rail-glass', category: 'guardrail', tier: 'premium', name: 'Frameless glass balustrade', description: 'Laminated glass in a base shoe with a timber or metal cap rail; keeps sightlines open.', unit: 'm', cost: p(750), weight: p(40), power: p(0), dims: { height: 1.1 } },
  { id: 'rail-led', category: 'guardrail', tier: 'flagship', name: 'Glass balustrade with LED cap rail', description: 'Glass balustrade with an addressable LED cap rail that joins the show.', unit: 'm', cost: p(1400), weight: p(42), power: p(15) , dims: { height: 1.1 } },
  // Per-seat accessories.
  { id: 'acc-cupholder', category: 'seat-accessory', tier: 'standard', name: 'Armrest cup holder', description: 'Integrated cup holder on the shared armrest.', unit: 'seat', cost: p(35), weight: p(0.3), power: p(0) },
  { id: 'acc-side-table', category: 'seat-accessory', tier: 'premium', name: 'Swivel side table and USB-C', description: 'Swivel tray table, USB-C charging, aisle-light on row ends.', unit: 'seat', cost: p(240), weight: p(3), power: p(5) },
  { id: 'acc-service-console', category: 'seat-accessory', tier: 'flagship', name: 'Service console', description: 'Side console with call button, wireless charging, personal audio jack and storage.', unit: 'seat', cost: p(900), weight: p(8), power: p(15) },
];

/** Seat products by tier (ids into src/library/seating.ts). */
export const SEAT_TIER: Record<string, Tier> = {
  'figueras-minispace-5067': 'standard',
  'figueras-smart-13033': 'premium',
  'ferco-premium-opus': 'flagship',
  'ferco-verona': 'flagship',
  'generic-lounge-pair': 'flagship',
};

export const getCatalogItem = (id: string) => CATALOG.find((i) => i.id === id);
export const catalogFor = (category: CatalogCategory) => CATALOG.filter((i) => i.category === category);

// ─── Immersion and technical systems ────────────────────────────────────────

/** One kind of unit a system places (a fixture, a speaker, a camera…). */
export interface SystemUnit {
  id: string;
  name: string;
  /** Proxy box (m) for the viewport and the Rhino block. */
  size: [number, number, number];
  cost: SpecValue;
  weight: SpecValue;
  power: SpecValue;
}

export interface SystemTier {
  description: string;
  units: SystemUnit[];
}

export interface SystemSpec {
  id: SystemId;
  label: string;
  layer: string;
  description: string;
  tiers: Record<Tier, SystemTier>;
}

const unit = (id: string, name: string, size: [number, number, number], cost: number, weight: number, power: number): SystemUnit => ({ id, name, size, cost: p(cost), weight: p(weight), power: p(power) });

const SPOT = unit('fx-spot', 'Moving-head spot/profile', [0.45, 0.35, 0.7], 18000, 35, 900);
const WASH = unit('fx-wash', 'LED wash / beam', [0.35, 0.3, 0.5], 9000, 20, 500);
const LASER = unit('fx-laser', 'Show laser (projection-safe zone)', [0.4, 0.3, 0.2], 30000, 15, 600);
const TRUSS = unit('truss', 'Box truss, per metre', [1, 0.4, 0.4], 450, 12, 0);
const HOIST = unit('hoist', 'Chain hoist / rigging point', [0.3, 0.3, 0.6], 3500, 60, 1500);

export const SYSTEMS: SystemSpec[] = [
  {
    id: 'lighting',
    label: 'Lighting rigs',
    layer: '05_TECHNICAL/Lighting',
    description: 'Show lighting kept below the screen line where possible; overhead rigs are scored for how much screen they hide.',
    tiers: {
      standard: { description: 'Stage truss over the stage plus a floor-level wash ring at the screen base.', units: [WASH, TRUSS, HOIST] },
      premium: { description: 'Adds moving-head spots on the stage truss and a denser wash ring.', units: [SPOT, WASH, TRUSS, HOIST] },
      flagship: { description: 'Adds an overhead halo ring of movers and show lasers above the audience.', units: [SPOT, WASH, LASER, TRUSS, HOIST] },
    },
  },
  {
    id: 'audio',
    label: 'Immersive audio',
    layer: '05_TECHNICAL/Audio',
    description: 'Spherical speaker arrays behind the screen (needs an acoustically transparent or perforated screen), an overhead/zenith array and subwoofers. The array product is chosen separately from the tier.',
    tiers: {
      standard: { description: 'One ring of arrays at ear level and floor subwoofers.', units: [] },
      premium: { description: 'Two rings, overhead arrays and more subwoofers.', units: [] },
      flagship: { description: 'Three rings and a zenith array for full spherical coverage, beam-steered subwoofer arrays.', units: [] },
    },
  },
  {
    id: 'haptics',
    label: 'Haptic seats',
    layer: '02_AUDIENCE/Seats',
    description: 'Tactile transducers fitted to seats; no separate geometry, seats carry the metadata.',
    tiers: {
      standard: { description: 'One inertial bass transducer per seat, zoned about 4 seats per amplifier channel (the Sphere ratio). Infrasound "feel" only.', units: [unit('hap-inertial', 'Inertial tactile transducer', [0.15, 0.15, 0.06], 250, 2, 50)] },
      premium: {
        description: 'One Powersoft Mover direct-drive shaker per seat (±15 mm seat-base motion), per-row or per-seat effects.',
        units: [{ id: 'hap-mover', name: 'Powersoft Mover (direct drive)', size: [0.2, 0.2, 0.1], cost: p(900), weight: p(6), power: sec(100, 'fx-research', 'Up to 900 N; trade press quoting Powersoft') }],
      },
      flagship: {
        description: 'Motion seats: two D-BOX G5-class actuators per seat (38 mm stroke). They do not fold, so they conflict with telescopic seating.',
        units: [{ id: 'hap-dbox-g5', name: 'D-BOX G5 motion actuator', size: [0.15, 0.15, 0.2], cost: p(3000), weight: p(9), power: m(150, 'fx-research', 'Average; 540 W for four. D-BOX G5 spec sheet') }],
      },
    },
  },
  {
    id: 'atmospherics',
    label: 'Atmospherics',
    layer: '05_TECHNICAL/AV_Equipment',
    description: 'Haze, low fog and scent at the screen base, behind the audience.',
    tiers: {
      standard: { description: 'Hazers only.', units: [unit('atm-haze', 'Hazer', [0.5, 0.3, 0.3], 3000, 15, 1500)] },
      premium: { description: 'Hazers and low-fog units.', units: [unit('atm-haze', 'Hazer', [0.5, 0.3, 0.3], 3500, 15, 1500), unit('atm-fog', 'Low-fog unit', [0.8, 0.5, 0.5], 9000, 60, 3000)] },
      flagship: { description: 'Hazers, low fog and zoned scent diffusers.', units: [unit('atm-haze', 'Hazer', [0.5, 0.3, 0.3], 3500, 15, 1500), unit('atm-fog', 'Low-fog unit', [0.8, 0.5, 0.5], 9000, 60, 3000), unit('atm-scent', 'Scent diffuser', [0.3, 0.2, 0.3], 2500, 5, 100)] },
    },
  },
  {
    id: 'tracking',
    label: 'Audience tracking',
    layer: '05_TECHNICAL/AV_Equipment',
    description: 'Cameras and sensors at the screen base for interactive content and audience analytics.',
    tiers: {
      standard: { description: 'A few wide cameras for show control.', units: [unit('trk-cam', 'Tracking camera', [0.15, 0.15, 0.2], 2500, 2, 25)] },
      premium: { description: 'Overlapping cameras covering every seat.', units: [unit('trk-cam', 'Tracking camera', [0.15, 0.15, 0.2], 4000, 2, 30)] },
      flagship: { description: 'Dense cameras plus depth sensors for per-seat interaction.', units: [unit('trk-cam', 'Tracking camera', [0.15, 0.15, 0.2], 6000, 2, 35), unit('trk-depth', 'Depth sensor', [0.2, 0.1, 0.1], 1500, 1, 15)] },
    },
  },
];

export const getSystem = (id: SystemId) => SYSTEMS.find((s) => s.id === id)!;

// ─── Audio array products ───────────────────────────────────────────────────

export interface AudioProduct {
  id: string;
  label: string;
  /** Matrix arrays are stacked into beam-steered clusters; point sources are spread one per position. */
  family: 'matrix' | 'point';
  main: SystemUnit;
  sub: SystemUnit;
  /** Array positions per ring at each tier (before the density scale). */
  positionsPerRing: Record<Tier, number>;
  /** Modules per position (matrix arrays stack modules into one array). */
  modulesPerPosition: Record<Tier, number>;
  sources: { id: string; title: string; url: string; accessed: string }[];
  note: string;
}

const ACCESSED = '2026-10-28';
const box = (w: number, h: number, d: number): [number, number, number] => [w, d, h];

export const AUDIO_PRODUCTS: AudioProduct[] = [
  {
    id: 'holoplot-x1',
    label: 'HOLOPLOT X1 Matrix Array',
    family: 'matrix',
    main: { id: 'holoplot-md96', name: 'HOLOPLOT X1 MD96 module', size: box(0.8, 0.6, 0.457), cost: p(60000, 'Not published; placeholder'), weight: m(100, 'holo-md96'), power: m(650, 'holo-md96', 'Continuous consumption; 1,450 W max') },
    sub: { id: 'holoplot-s21', name: 'HOLOPLOT S21 subwoofer', size: box(0.7, 0.7, 0.8), cost: p(15000), weight: p(90), power: p(1500) },
    positionsPerRing: { standard: 6, premium: 10, flagship: 14 },
    modulesPerPosition: { standard: 2, premium: 3, flagship: 4 },
    sources: [{ id: 'holo-md96', title: 'HOLOPLOT X1 MD96 data sheet 1.1', url: 'https://cdn.prod.website-files.com/684970021e66775b3730e124/685bbb66b77965f0f225311c_220221_MD96_data-sheet_final.pdf', accessed: ACCESSED }],
    note: '3D beamforming / wave-field synthesis matrix array (the technology used at Sphere, Las Vegas). Modules stack into arrays; coverage is set in HOLOPLOT Plan.',
  },
  {
    id: 'db-soundscape',
    label: 'd&b Soundscape (44S point sources)',
    family: 'point',
    main: { id: 'db-44s', name: 'd&b 44S loudspeaker', size: box(0.39, 0.128, 0.15), cost: p(2500), weight: m(3.6, 'db-44s'), power: m(150, 'db-44s', 'RMS power handling, not consumption; amplifiers separate') },
    sub: { id: 'db-sub', name: 'd&b subwoofer (class)', size: box(0.6, 0.6, 0.6), cost: p(7000), weight: p(60), power: p(1200) },
    positionsPerRing: { standard: 16, premium: 24, flagship: 36 },
    modulesPerPosition: { standard: 1, premium: 1, flagship: 1 },
    sources: [{ id: 'db-44s', title: 'd&b audiotechnik 44S data sheet 1.2', url: 'https://www.dbaudio.com/assets/products/downloads/manuals-documentation/xs-series/dbaudio-datasheet-44s-1.2-en.pdf', accessed: ACCESSED }],
    note: 'Object-based rendering (En-Scene / En-Space) over many small point sources.',
  },
  {
    id: 'l-isa-x8',
    label: 'L-Acoustics L-ISA (X8 point sources)',
    family: 'point',
    main: { id: 'la-x8', name: 'L-Acoustics X8 coaxial', size: box(0.25, 0.424, 0.278), cost: p(4000), weight: m(12, 'la-x8'), power: p(300, 'Amplifier share; not published as consumption') },
    sub: { id: 'la-sub', name: 'L-Acoustics subwoofer (class)', size: box(0.6, 0.6, 0.7), cost: p(8000), weight: p(70), power: p(1500) },
    positionsPerRing: { standard: 14, premium: 20, flagship: 30 },
    modulesPerPosition: { standard: 1, premium: 1, flagship: 1 },
    sources: [{ id: 'la-x8', title: 'L-Acoustics X8 data sheet', url: 'https://global-uploads.webflow.com/5f4013c686a8c427bc62226e/5f4013c686a8c4169862235f_L-Acoustics-X8-Data-Sheet.pdf', accessed: ACCESSED }],
    note: 'Object-based immersive mixing (L-ISA) over coaxial point sources. X8 outline taken as 250 × 424 × 278 mm from the data sheet figures (axis labels not machine-readable).',
  },
  {
    id: 'generic-grid',
    label: 'Generic speaker grid',
    family: 'point',
    main: { id: 'gen-fr', name: 'Full-range cabinet (class)', size: box(0.4, 0.6, 0.35), cost: p(4500), weight: p(25), power: p(600) },
    sub: { id: 'gen-sub', name: 'Subwoofer (class)', size: box(0.7, 0.7, 0.7), cost: p(6000), weight: p(70), power: p(1500) },
    positionsPerRing: { standard: 16, premium: 24, flagship: 32 },
    modulesPerPosition: { standard: 1, premium: 1, flagship: 1 },
    sources: [],
    note: 'Placeholder class for comparing layouts; no product selected.',
  },
];

export const getAudioProduct = (id: string) => AUDIO_PRODUCTS.find((a) => a.id === id);


// ─── Support structure behind the media surface ─────────────────────────────

/** A rib and ring girder product family. Masses per metre and costs are placeholders unless noted. */
export interface StructureSystem {
  id: string;
  tier: Tier;
  name: string;
  description: string;
  /** Rib section depth (radial) and width (m). */
  ribDepth: number;
  ribWidth: number;
  ribKgPerM: SpecValue;
  /** Ring girder section depth (radial) and width (m); rings sit on the outer face of the ribs. */
  ringDepth: number;
  ringWidth: number;
  ringKgPerM: SpecValue;
  /** Node bracket (rib × ring), splice and base plate masses (kg). */
  nodeKg: SpecValue;
  spliceKg: SpecValue;
  baseKg: SpecValue;
  /** Fabricated, delivered cost per kg (USD). */
  costPerKg: SpecValue;
  /** Crane or hoist picks one crew sets per day. */
  picksPerDay: number;
}

const rhs = (h: number, b: number, t: number) => +(2 * (h + b) * t * 7850).toFixed(1);

export const STRUCTURE_SYSTEMS: StructureSystem[] = [
  {
    id: 'steel-truss',
    tier: 'standard',
    name: 'Curved steel box-truss ribs + RHS rings',
    description: 'Industry-standard: rolled steel box-truss ribs, RHS 200×100 ring girders, bolted splices, galvanised. Heaviest, cheapest per kg, any steel fabricator.',
    ribDepth: 0.45,
    ribWidth: 0.3,
    ribKgPerM: p(38, 'Steel box truss, 450 × 300, CHS chords'),
    ringDepth: 0.2,
    ringWidth: 0.1,
    ringKgPerM: p(rhs(0.2, 0.1, 0.006), 'RHS 200×100×6 from section and 7,850 kg/m³'),
    nodeKg: p(25),
    spliceKg: p(14),
    baseKg: p(45),
    costPerKg: p(6.5),
    picksPerDay: 14,
  },
  {
    id: 'rhs-rolled',
    tier: 'premium',
    name: 'Rolled RHS ribs + RHS rings',
    description: 'Rolled RHS 300×200 ribs: shallower than truss, so more room for audio and walkways; cleaner for perforated screens.',
    ribDepth: 0.3,
    ribWidth: 0.2,
    ribKgPerM: p(rhs(0.3, 0.2, 0.008), 'RHS 300×200×8 from section and 7,850 kg/m³'),
    ringDepth: 0.2,
    ringWidth: 0.1,
    ringKgPerM: p(rhs(0.2, 0.1, 0.006), 'RHS 200×100×6 from section and 7,850 kg/m³'),
    nodeKg: p(30),
    spliceKg: p(20),
    baseKg: p(55),
    costPerKg: p(7.5),
    picksPerDay: 14,
  },
  {
    id: 'alu-curved',
    tier: 'flagship',
    name: 'Curved aluminium space-frame ribs',
    description: 'Purpose-built curved aluminium ribs with integrated LED rails and cable trays: about a third of the steel weight, faster install, highest cost per kg.',
    ribDepth: 0.35,
    ribWidth: 0.25,
    ribKgPerM: p(14),
    ringDepth: 0.15,
    ringWidth: 0.1,
    ringKgPerM: p(7),
    nodeKg: p(8),
    spliceKg: p(5),
    baseKg: p(30),
    costPerKg: p(24),
    picksPerDay: 22,
  },
];

export const getStructureSystem = (id: string) => STRUCTURE_SYSTEMS.find((s) => s.id === id);

/** Shipping envelopes (inside length × width × height, m), smallest first. */
export const SHIPPING: { id: string; label: string; dims: [number, number, number] }[] = [
  { id: 'container-20', label: "20' container", dims: [5.9, 2.35, 2.39] },
  { id: 'container-40', label: "40' container", dims: [12.03, 2.35, 2.39] },
  { id: 'trailer', label: 'Standard trailer', dims: [13.6, 2.45, 2.7] },
];
