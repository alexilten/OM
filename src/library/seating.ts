import type { SeatingProduct, SpecValue } from '../engine/types';

/**
 * Seating library, revision R00 (2026-10-28).
 *
 * Only values read from a manufacturer page are marked `manufacturer`; values read from a
 * specification aggregator are `secondary`; everything else is a `placeholder` chosen from general
 * auditorium practice so the generator can run. See docs/research/ROUND_00_RESEARCH.md.
 */

const m = (value: number, source: string, note?: string): SpecValue => ({ value, status: 'manufacturer', source, note });
const s = (value: number, source: string, note?: string): SpecValue => ({ value, status: 'secondary', source, note });
const p = (value: number, note?: string): SpecValue => ({ value, status: 'placeholder', note });
const ps = (value: string, note?: string): SpecValue<string> => ({ value, status: 'placeholder', note });

const ACCESSED = '2026-10-28';

export const SEATING_PRODUCTS: SeatingProduct[] = [
  {
    id: 'figueras-smart-13033',
    category: 'premium-theater',
    manufacturer: 'Figueras',
    productFamily: 'Smart',
    model: '13033',
    width: m(0.6, 'fig-smart', 'Minimum centre-to-centre "60 cm nominal"; usable width ≥ 56 cm'),
    depth: p(0.62, 'Depth with seat tipped up; datasheet table not machine-readable, confirm with Figueras'),
    overallHeight: p(1.0),
    seatHeight: p(0.45),
    armrestWidth: p(0.05, 'Shared armrests between adjacent seats'),
    eyeHeight: p(1.12, 'Typical seated eye height above tier floor'),
    eyeOffset: p(0.05),
    preferredRowPitch: p(1.1, 'Premium spacing assumption; Figueras does not state a row pitch on the product page'),
    minClearway: p(0.4),
    transformable: ps('fixed', 'Floor-anchored; not listed as Mutasub-compatible'),
    sources: [{ id: 'fig-smart', title: 'Figueras Smart 13033 product sheet', url: 'https://figueras.com/wp-content/uploads/2024/07/13033_Smart_EN-1.pdf', accessed: ACCESSED }],
    revision: 'R00',
  },
  {
    id: 'ferco-premium-opus',
    category: 'luxury-cinema',
    manufacturer: 'Ferco Seating',
    productFamily: 'Premium',
    model: 'Opus',
    width: s(0.9, 'ferco-opus'),
    depth: s(0.845, 'ferco-opus', 'Depth when closed'),
    overallHeight: p(1.05),
    seatHeight: p(0.45),
    armrestWidth: p(0.1),
    eyeHeight: p(1.1),
    eyeOffset: p(0.0),
    preferredRowPitch: p(1.3, 'Luxury cinema assumption'),
    minClearway: p(0.45),
    transformable: ps('fixed'),
    sources: [{ id: 'ferco-opus', title: 'Ferco Premium Opus (SpecifiedBy listing)', url: 'https://product-explorer.specifiedby.com/ferco-seating-systems/premium-opus-cinema-seat?sm=1', accessed: ACCESSED }],
    revision: 'R00',
  },
  {
    id: 'ferco-verona',
    category: 'executive-recliner',
    manufacturer: 'Ferco Seating',
    productFamily: 'Verona',
    model: 'Verona (single)',
    width: s(0.9, 'ferco-verona'),
    depth: s(1.0, 'ferco-verona', 'Depth when closed'),
    depthOpen: s(1.69, 'ferco-verona', 'Listed depth; assumed fully reclined'),
    overallHeight: s(1.06, 'ferco-verona'),
    seatHeight: p(0.45),
    armrestWidth: p(0.15),
    eyeHeight: p(1.0, 'Reclined eye height is lower than upright'),
    eyeOffset: p(-0.1),
    preferredRowPitch: p(2.0, 'Needs reclined depth + clearway'),
    minClearway: p(0.3, 'Measured from fully reclined footrest'),
    transformable: ps('fixed'),
    sources: [{ id: 'ferco-verona', title: 'Ferco Verona cinema seat (SpecifiedBy listing)', url: 'https://product-explorer.specifiedby.com/ferco-seating-systems/verona-cinema-seat?sm=1+', accessed: ACCESSED }],
    revision: 'R00',
  },
  {
    id: 'figueras-minispace-5067',
    category: 'compact-retractable',
    manufacturer: 'Figueras',
    productFamily: 'Minispace',
    model: '5067',
    width: p(0.55),
    depth: p(0.6),
    overallHeight: p(0.95),
    seatHeight: p(0.45),
    armrestWidth: p(0.05),
    eyeHeight: p(1.12),
    eyeOffset: p(0.05),
    preferredRowPitch: p(0.95),
    minClearway: p(0.35),
    transformable: { value: 'Mutasub-compatible (underfloor)', status: 'manufacturer', source: 'fig-mutasub' },
    sources: [{ id: 'fig-mutasub', title: 'Figueras Mutasub seating system', url: 'https://figueras.com/systems/mutasub-seating-system', accessed: ACCESSED }],
    revision: 'R00',
    notes: 'Compatibility with Mutasub is stated by Figueras; dimensions are placeholders until the 5067 sheet is obtained.',
  },
  {
    id: 'generic-lounge-pair',
    category: 'lounge-social',
    manufacturer: 'Generic',
    productFamily: 'Lounge',
    model: 'Pair sofa (concept)',
    width: p(0.85, 'Per-person share of a two-person lounge unit'),
    depth: p(0.95),
    overallHeight: p(0.85),
    seatHeight: p(0.42),
    armrestWidth: p(0.2),
    eyeHeight: p(1.05),
    eyeOffset: p(0.0),
    preferredRowPitch: p(1.8),
    minClearway: p(0.6),
    transformable: ps('loose / movable'),
    sources: [],
    revision: 'R00',
    notes: 'Design category only. No product selected yet.',
  },
];

export function getSeatingProduct(id: string): SeatingProduct | undefined {
  return SEATING_PRODUCTS.find((p) => p.id === id);
}
