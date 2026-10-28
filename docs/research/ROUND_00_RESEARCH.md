# Round 00 — Product research notes

Read on 2026-10-28. Sources are manufacturer documents unless marked otherwise. "Verified" means the
number was read from the cited document; it does not mean the product is suitable for OM.

The OM pitch deck was not available in the workspace, and no Stagework, ManicAI or NvidiaMaestro
source was provided. Nothing here assumes their contents.

## 1. LED construction families

| Family | Representative product | What is verified | What is unknown | Consequence for OM geometry |
|---|---|---|---|---|
| 01 Faceted (flat cabinets) | ROE Visual Ruby RB2.6F | 500 × 500 × 73 mm, 2.604 mm pitch, 192 × 192 px, 8.1 kg, 210 / 105 W, curve ±5°, front/rear service ([Ruby series brochure, Sep 2025](https://www.roevisual.com/uploads/files/Product%20File/Ruby/ruby-series-brochure-sep_-11_-2025.pdf)) | Sphere-specific mounting hardware | Each flat cabinet tangent to a 13 m sphere stands 4.8 mm proud at the corners and needs ≈2.2° between neighbours in both directions. Horizontal joints are within the 5° curve range; the vertical direction needs custom brackets. Gaps/wedges between rows must be resolved. |
| 02 Single-axis curved | ROE Visual Ruby-C RB-C 2.6F | 500 × 500 × 108 mm, 2.604 mm, 192 × 192 px, 8.32 kg, concave 30° / convex 30° (convex on custom tiles only), "bending divided into 30 small steps", rear service (same brochure). Viewing angle 140° ([Ruby-C 2.6 brochure, Jan 2024](https://www.roevisual.com/uploads/files/Product%20File/Ruby-C/ruby-c-2.6-brochure-jan-22-2024.pdf)) | Exact step size (≈1° is inferred, not stated). The two ROE documents disagree on power (210/105 W vs 160/80 W) and service access (rear vs front/rear). | Curves in one axis only, so a sphere is approximated as a stack of conical/cylindrical bands. Ruby-C 1.9BV2 is limited to ±20°. |
| 03 Flexible modules | Hikvision soft LED module DS-D41Q15CA-1GS | 320 × 160 mm, 1.538 mm pitch (product listing title, secondary) | Bend radius, weight, power; the product page now redirects | Small modules on a CNC-formed substructure can follow compound curvature with small faceting error. Thermal and service design rests on the substructure. |
| 04 Purpose-built spherical | Konica Minolta DYNAVISION-LED | Panels are "a 3D curved surface cut from part of a sphere"; pitch from 1.9 mm (2.7 mm at Manten Nagoya); 15 m dome; 8K there, up to 11K delivered; 600 cd/m² max; sound-transmissive panels ([KM research paper](https://research.konicaminolta.com/jp/wp-content/uploads/2023/02/Overview-of-8K-LED-Dome-based-digital-planetarium-Manten-Nagoya.pdf), [components page](https://www.konicaminolta.com/planetarium/hard/planetariums/led_dome_system/dynavision-led/components/)) | Panel size, weight, power, how panels are tooled for a radius | True compound curvature, but panels are made for one radius. Changing the OM radius would change the tooling. |
| 04 Purpose-built spherical | Cosm CX System / LED dome | Marketing only: "8K+" domes, matte-black finish, 23 m Fort Worth conversion ([CX Display](https://tech.cosm.com/products/cx-system/cx-display)) | Pitch, tile geometry, structure, weight, power | Same class as KM. Need an NDA datasheet. |
| 04 Purpose-built spherical | Unilumin U-Sphere | Sphere diameters listed as 9.8, 12, 15, 20, 23, 27, 40 (units not stated, presumably m); 4K–16K; 7680 Hz refresh ([U-Sphere page](https://www.unilumin.com/?p=6249)) | Pitch, module geometry, everything physical | The diameter list hints at fixed radii per tooling set; worth asking whether OM radii should snap to a vendor's list. |
| 05 Custom modular spherical | (concept) | Nothing | Everything | Kept in the library as a conceptual entry so its trade-offs can be compared. |

**Key geometric finding.** Only family 04 (and possibly 03) make a true compound-curved sphere. Families
01 and 02 approximate it, so the software must keep the ideal surface and the built surface apart and
report deviation, gaps and required joint angles. Round 01 already reports corner deviation and joint
angle for a preview band; Round 03 turns this into full panelization.

## 2. Premium seating

| Category | Product | Verified | Unknown |
|---|---|---|---|
| Premium traditional theater | Figueras Smart 13033 | Minimum centre-to-centre "60 cm nominal", usable width ≥ 56 cm, shared armrests, floor-anchored ([product sheet](https://figueras.com/wp-content/uploads/2024/07/13033_Smart_EN-1.pdf)) | Depth, heights (dimension table not machine-readable) |
| Luxury cinema | Ferco Premium Opus | Width 900 mm, closed depth 845 mm (SpecifiedBy listing, secondary) ([listing](https://product-explorer.specifiedby.com/ferco-seating-systems/premium-opus-cinema-seat?sm=1)) | Height, recline depth, row pitch |
| Executive recliner | Ferco Verona | Width 900 mm (twin 1520), depth 1000 closed / 1690 listed, height 1060 (secondary) ([listing](https://product-explorer.specifiedby.com/ferco-seating-systems/verona-cinema-seat?sm=1+)) | Whether 1690 is the fully reclined depth |
| Compact premium retractable | Figueras Minispace 5067 | Listed by Figueras as compatible with Mutasub underfloor storage ([Mutasub](https://figueras.com/systems/mutasub-seating-system)) | Dimensions |
| Lounge / social | none selected | — | — |

Placeholders (eye height 1.0–1.12 m, row pitch, clearways) are labelled as such in
`src/library/seating.ts` and flagged in the UI metrics.

General guidance found (UK CPD article on retractable seating, [Building.co.uk](https://www.building.co.uk/cpd/cpd-18-2014-specifying-retractable-seating/5070480.article)):
row depth ≥ 850 mm recommended; telescopic rises 260–380 mm; aisles ≥ 1100 mm; seatways ≥ 300 mm with
7 seats max beside one aisle or 14 between two (BS 9999). The validator warns on aisles < 1.1 m and
risers > 380 mm. These are UK references only; local code review is needed.

## 3. Transformation machinery

| System | Verified behaviour | OM relevance |
|---|---|---|
| Figueras Mutasub | Seats grouped (≤ 12 per group) on an aluminium beam fold under the floor; covers form the walkable floor; each row has its own programme; electric actuator with manual fallback ([Mutasub](https://figueras.com/systems/mutasub-seating-system)) | Flat-floor conversion for a raked or flat floor; needs a pit under every row. Works only with specific compact seats. |
| Figueras Mutarail / Mutawheel | Rail- and wheel-mounted movable seating ([Mutarail](https://figueras.com/systems/mutarail-seating-system)) | Horizontal translation into storage zones. |
| Gala Systems Venue Translation | Each row on its own platform shifts horizontally under the adjacent row; 5 mm gaps when flat; one operator, ~10 min conversion; SPIRALIFT actuators with identical footprint per row, suiting a shallow pit; Forum Evolution Burgos, 1371 seats ([Gala](https://www.galasystems.com/news/designing-transformable-venues-with-curved-row-seating)) | The most direct precedent for curved rows becoming a flat dance floor. |
| Gala SPIRALIFT | A steel ribbon that spirals into a column and unspools flat when lowered ([Core77](https://www.core77.com/posts/73475/Gala-Systems-Clever-Spiralift-Design-Turns-Columns-Flat-to-Create-Disappearing-Auditorium-Seating)) | Compact vertical actuation for tier platforms. Stroke/load data needs Gala. |
| Telescopic (Hussey Quattro etc.) | Rows fold into the depth of one row; specs behind login ([Hussey](https://www.husseyseating.com/?p=21367)) | Simple retractable bank; needs wall-side storage and 2.1 m clear above. |

None of these is engineered for OM. The transformation engine (Round 04) will treat each as a
mechanism strategy with explicit travel paths, envelopes and conceptual status.

## 4. Rhino export

`rhino3dm` 8.35 (npm, wasm) was tested in this round and can write: layers with parents, unit system,
exact rational NURBS surfaces, Breps, extrusions, arc curves, block definitions and instance references,
per-object user strings and document strings. It cannot trim, boolean or offset; those need Rhino.Compute
or RhinoCommon later (e.g. openings in the media surface, cut caps for sections). The Python rhino3dm
binding reads the files back independently.
