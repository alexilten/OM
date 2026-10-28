import type { LedProduct, SourceReference, SpecValue } from '../engine/types';

/**
 * LED construction library, revision R00 (2026-10-28). One entry per construction family.
 * Only values read from a manufacturer document are `manufacturer`. Purpose-built spherical
 * systems publish almost no cabinet data, so those entries are mostly placeholders; they exist so
 * the families can be compared, not so their numbers can be relied on.
 */

const ACCESSED = '2026-10-28';
const m = (value: number, source: string, note?: string): SpecValue => ({ value, status: 'manufacturer', source, note });
const ms = (value: string, source: string, note?: string): SpecValue<string> => ({ value, status: 'manufacturer', source, note });
const s = (value: number, source: string, note?: string): SpecValue => ({ value, status: 'secondary', source, note });
const p = (value: number, note?: string): SpecValue => ({ value, status: 'placeholder', note });
const ps = (value: string, note?: string): SpecValue<string> => ({ value, status: 'placeholder', note });
const c = (value: number, note?: string): SpecValue => ({ value, status: 'conceptual', note });

const ROE_RUBY_2025: SourceReference = {
  id: 'roe-ruby-2025',
  title: 'ROE Visual Ruby series brochure (Sep 11 2025)',
  url: 'https://www.roevisual.com/uploads/files/Product File/Ruby/ruby-series-brochure-sep_-11_-2025.pdf',
  accessed: ACCESSED,
};
const ROE_RUBYC_2024: SourceReference = {
  id: 'roe-rubyc-2024',
  title: 'ROE Visual Ruby-C 2.6 brochure (Jan 22 2024)',
  url: 'https://www.roevisual.com/uploads/files/Product File/Ruby-C/ruby-c-2.6-brochure-jan-22-2024.pdf',
  accessed: ACCESSED,
};

export const LED_PRODUCTS: LedProduct[] = [
  {
    id: 'roe-ruby-rb2.6f',
    family: '01-faceted',
    manufacturer: 'ROE Visual',
    productFamily: 'Ruby',
    model: 'RB2.6F',
    cabinetWidth: m(0.5, 'roe-ruby-2025'),
    cabinetHeight: m(0.5, 'roe-ruby-2025'),
    cabinetDepth: m(0.073, 'roe-ruby-2025'),
    pixelPitch: m(0.002604, 'roe-ruby-2025'),
    pixelsX: m(192, 'roe-ruby-2025'),
    pixelsY: m(192, 'roe-ruby-2025'),
    weightKg: m(8.1, 'roe-ruby-2025'),
    powerMaxW: m(210, 'roe-ruby-2025', 'Common anode'),
    powerAvgW: m(105, 'roe-ruby-2025'),
    curveConcaveDeg: m(5, 'roe-ruby-2025'),
    curveConvexDeg: m(5, 'roe-ruby-2025'),
    curvatureDirection: ms('single axis (inter-cabinet)', 'roe-ruby-2025'),
    serviceAccess: ms('front / rear', 'roe-ruby-2025'),
    mounting: ps('hung or ground-stacked frame; sphere mounting needs custom substructure'),
    sources: [ROE_RUBY_2025],
    revision: 'R00',
  },
  {
    id: 'roe-ruby-c-rbc2.6f',
    family: '02-single-axis-curved',
    manufacturer: 'ROE Visual',
    productFamily: 'Ruby-C',
    model: 'RB-C 2.6F',
    cabinetWidth: m(0.5, 'roe-ruby-2025'),
    cabinetHeight: m(0.5, 'roe-ruby-2025'),
    cabinetDepth: m(0.108, 'roe-ruby-2025'),
    pixelPitch: m(0.002604, 'roe-ruby-2025'),
    pixelsX: m(192, 'roe-ruby-2025'),
    pixelsY: m(192, 'roe-ruby-2025'),
    weightKg: m(8.32, 'roe-ruby-2025', 'Ruby-C 2.6 brochure (Jan 2024) lists 8.3 kg'),
    powerMaxW: m(210, 'roe-ruby-2025', 'Ruby-C 2.6 brochure (Jan 2024) lists 160 W max / 80 W avg; conflict unresolved'),
    powerAvgW: m(105, 'roe-ruby-2025'),
    curveConcaveDeg: m(30, 'roe-ruby-2025'),
    curveConvexDeg: m(30, 'roe-ruby-2025', 'Convex only on custom tiles'),
    curvatureDirection: ms('single axis', 'roe-ruby-2025'),
    curvatureIncrement: ms('"divided into 30 small steps" (≈1° per step inferred, not stated)', 'roe-ruby-2025'),
    viewingAngleDeg: m(140, 'roe-rubyc-2024'),
    serviceAccess: ms('rear (product page also claims front service; unresolved)', 'roe-ruby-2025'),
    mounting: ps('custom substructure following the sphere'),
    sources: [ROE_RUBY_2025, ROE_RUBYC_2024],
    revision: 'R00',
  },
  {
    id: 'hikvision-soft-1.5',
    family: '03-flexible',
    manufacturer: 'Hikvision',
    productFamily: 'Soft LED module (indoor)',
    model: 'DS-D41Q15CA-1GS',
    cabinetWidth: s(0.32, 'hik-soft', 'Module, not a cabinet'),
    cabinetHeight: s(0.16, 'hik-soft'),
    cabinetDepth: p(0.012),
    pixelPitch: s(0.001538, 'hik-soft'),
    pixelsX: s(208, 'hik-soft', 'Derived: 320 mm / 1.538 mm'),
    pixelsY: s(104, 'hik-soft', 'Derived: 160 mm / 1.538 mm'),
    weightKg: p(0.4),
    powerMaxW: p(25),
    powerAvgW: p(9),
    curvatureDirection: ps('bends about one axis at a time; compound fit needs small modules'),
    minBendRadius: p(0.5, 'Not published in the sources read'),
    serviceAccess: ps('front (magnetic)'),
    mounting: ps('magnetic modules on a CNC-formed substructure'),
    sources: [{ id: 'hik-soft', title: 'Hikvision DS-D41Q15CA-1GS soft LED module (product listing)', url: 'https://display.hikvision.com/en/products/led-displays/led-modules/soft-led-module-for-indoor-series/ds-d41q15ca-1gs', accessed: ACCESSED }],
    revision: 'R00',
  },
  {
    id: 'konica-dynavision-led',
    family: '04-purpose-built-spherical',
    manufacturer: 'Konica Minolta',
    productFamily: 'DYNAVISION-LED',
    model: 'Dome / spherical-segment type',
    cabinetWidth: p(0.5, 'Panel size not published'),
    cabinetHeight: p(0.5),
    cabinetDepth: p(0.1),
    pixelPitch: m(0.0027, 'km-manten', 'Manten Nagoya; system quoted from 1.9 mm'),
    pixelsX: p(185),
    pixelsY: p(185),
    weightKg: p(8),
    powerMaxW: p(150),
    powerAvgW: p(60),
    curvatureDirection: ms('compound: "3D curved surface cut from part of a sphere"', 'km-manten'),
    serviceAccess: ps('unknown'),
    mounting: ps('dome substructure (vendor supplied)'),
    sources: [
      { id: 'km-manten', title: 'Overview of 8K LED Dome digital planetarium Manten Nagoya (Konica Minolta)', url: 'https://research.konicaminolta.com/jp/wp-content/uploads/2023/02/Overview-of-8K-LED-Dome-based-digital-planetarium-Manten-Nagoya.pdf', accessed: ACCESSED },
      { id: 'km-components', title: 'DYNAVISION-LED components', url: 'https://www.konicaminolta.com/planetarium/hard/planetariums/led_dome_system/dynavision-led/components/', accessed: ACCESSED },
    ],
    revision: 'R00',
    notes: 'Panels are made for a specific sphere radius; a different OM radius would need new tooling. Dome reference: 15 m dia., 2.7 mm, 8K, 600 cd/m².',
  },
  {
    id: 'om-custom-modular-sphere',
    family: '05-custom-modular-spherical',
    manufacturer: 'OM (concept)',
    productFamily: 'Custom modular spherical',
    model: 'Concept tile',
    cabinetWidth: c(0.4),
    cabinetHeight: c(0.4),
    cabinetDepth: c(0.1),
    pixelPitch: c(0.0025),
    pixelsX: c(160),
    pixelsY: c(160),
    weightKg: c(5),
    powerMaxW: c(120),
    powerAvgW: c(50),
    curvatureDirection: { value: 'compound (tile cut to sphere)', status: 'conceptual' },
    serviceAccess: { value: 'front (target)', status: 'conceptual' },
    mounting: { value: 'tessellated substructure', status: 'conceptual' },
    sources: [],
    revision: 'R00',
    notes: 'Conceptual until a manufacturer confirms feasibility. Comparable vendors: Cosm CX, Unilumin U-Sphere (no cabinet data published).',
  },
];

export function getLedProduct(id: string): LedProduct | undefined {
  return LED_PRODUCTS.find((p) => p.id === id);
}
