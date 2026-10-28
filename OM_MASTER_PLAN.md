# OM Studio — Master Plan

Confidential. Living document; update the **Decisions** and **Status** sections every round.

Last updated: 2026-10-28 (Rounds 00–02 merged; Round 03 complete pending review).

---

## 1. Product objectives

OM Studio is a browser-based parametric design tool for OM immersive venues (target reference:
≈300 seated / ≈500 standing). One parametric system, anchored at the centre of a reference sphere,
generates the media surface, audience, stage, machinery and envelope, and exports professional Rhino
geometry.

The tool must let a designer:

1. Shape a **true spherical media surface** and see its consequences immediately.
2. Lay out **premium seating** at real product dimensions and measure viewing quality per seat.
3. Compare **real LED construction strategies** against the ideal sphere (deviation, counts, pixels, weight, power).
4. Animate **venue transformation** (seated → standing) with physically coherent moving components.
5. Cut **sections**, check **fit in existing buildings**, save and compare **alternatives**.
6. **EXPORT RHINO**: exact, layered, metadata-rich `.3dm` files that match the live configuration.

Non-goals for now: certified engineering, acoustic simulation, cost estimating without quotes, AI-generated geometry.

## 2. Coordinate system (non-negotiable)

- Right-handed, **Z up**, **metres** internally (feet only at the UI boundary).
- **(0, 0, 0) = reference sphere centre = reference eye point.**
- **+X** audience right, **+Y** forward (performance direction), **+Z** up.
- Azimuth θ from +Y towards +X; elevation φ from the equator: `P(θ, φ) = (R cosφ sinθ, R cosφ cosθ, R sinφ)`.
- Every subsystem builds in this frame. The viewport rotates one group −90° about X for Three.js (Y up);
  the Rhino export writes engine coordinates unchanged.

Implemented in `src/engine/coordinates.ts`.

## 3. Technical architecture

```
VenueConfiguration (JSON, the only source of truth)
        │  validateConfig → errors block regeneration
        ▼
generateVenue()  ─────────────────────────────────────────────────────────────┐
  1 Geometry engine        coordinates, units, layers, ids                     │
  2 Spherical media        reference sphere, exact NURBS patch, edges, metrics │
  3 LED panelization       (R01: tangent preview band; R03: full)              │
  4 Seating generator      rows, tiers, seats, eye points                      │
  5 Immersion analysis     (R02)                                               │
  6 Stage generator        (R01: platform)                                     │
  7 Transformation engine  (R04)                                               │
  8 Architectural envelope (R01: design envelope + slab; R05: building fit)    │
  9 Asset library          src/library/* with per-value verification status    │
        ▼                                                                      │
VenueModel { objects[], blocks[], seats[], metrics[], issues[] }               │
        ├──► Viewport (React Three Fiber) — display tessellation only          │
        └──► 10 CAD export (rhino3dm) — exact geometry, same model ────────────┘
```

| Concern | Choice | Why |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Typed, fast iteration, small toolchain. |
| 3D | Three.js via React Three Fiber + drei | Instancing for seats/cabinets, clipping planes for sections, good camera tools. |
| State | Zustand store holding the configuration, last valid model, UI state | Simple; the model is regenerated synchronously (≈3.5 ms for OM 300 in Node). Move to a Web Worker when LED panelization makes it slow. |
| Geometry | Pure TS engine with **neutral geometry descriptors** (`spherePatch`, `annularSector`, `blockInstance`, …) | Each descriptor maps to exact CAD and to a display mesh; neither is authoritative. |
| LED panelization (R03) | Per-product strategies: faceted tangent tiling by latitude bands, single-axis curved bands (conical approximation), flexible module tessellation, vendor-spherical (vendor tile grid). Each returns cabinets with true dimensions + deviation/gap fields. | Never stretch cabinets; compare strategies honestly. |
| Audience analysis (R02) | Deterministic per-seat metrics (distance to origin, H/V field of view of visible media, visible-surface fraction by ray sampling, head-turn angle, incidence, obstruction by head envelope, vertical comfort) combined with **user-visible weights**. | Transparent, traceable; weights evolve with tests. |
| Kinematics (R04) | Kinetic assemblies with explicit states, axes, travel, envelopes; timeline = state machine of keyframed phases; swept-volume AABB/OBB collision checks. | Components move along explicit paths, never morph. |
| Rhino export | `rhino3dm` (wasm) in browser and Node; Rhino.Compute later for trims/booleans/section caps | Verified this round: exact NURBS, blocks, layers, user strings. |
| Persistence | Configuration JSON (download/open now; project store + alternatives in R05). The full config is also embedded in every `.3dm`. | Reproducible: reopening regenerates identical geometry and ids. |
| Confidentiality | No CDN fonts/HDRIs/analytics; rhino3dm wasm bundled locally; robots `noindex`. | Brief §29.10. |

### Stable identifiers

Ids are derived from configuration structure (`seat.C.07`, `tier.C`, `led.r1.c042`, `media.ideal`), so the
same configuration always yields the same ids. Round 04 kinetic assemblies will key off these.

## 4. Data model (implemented subset in `src/engine/types.ts`)

`VenueConfiguration` → `SphereDefinition`, `MediaSurfaceDefinition`, `FloorDefinition`, `SeatingLayout`,
`StageDefinition`, `EnvelopeDefinition`, `LedPreviewDefinition`.
Library: `SeatingProduct`, `LedProduct` with `SpecValue {value, status: manufacturer|secondary|placeholder|conceptual, source}`.
Generated: `VenueModel`, `VenueObject`, `BlockDefinition`, `SeatRecord` (= `AudienceEyePoint`), `Metric` (quality: exact|derived|estimate|conceptual), `Issue`.
Export: `ExportManifest`.

`ImmersionAnalysis` (R02) lives in `src/engine/immersion.ts`; its settings (weights, ramps) are part of `VenueConfiguration.analysis` so saved files reproduce scores. The LED system (R03) is `VenueConfiguration.led` plus `src/engine/led.ts`; Round 01–02 files carrying `ledPreview` are migrated on open. The transformation (R04) is `VenueConfiguration.transformation` plus `src/engine/kinetics.ts` (`KineticAssembly`, `TransitionStep`, `TransformationModel`, `poseAt`); seats carry their aisle block and their wagon as `parentAssembly`. Still to add: `BuildingEnvelope` (R05).

## 5. Development rounds and acceptance criteria

| Round | Scope | Acceptance (must be demonstrated) | Status |
|---|---|---|---|
| **00** Research & architecture | Brief review, product research, architecture, data model, this plan | Research notes with verified vs unknown data; risks listed | **Done** — `docs/research/ROUND_00_RESEARCH.md` |
| **01** Spherical PoC | Origin, reference sphere, exact media patch with az/el limits, floor elevation, simple stage, basic tiered seating, orbit camera, section cut, `.3dm` export | Radius change regenerates everything; surface stays spherical (tested to 1e-10 m); floor change never moves the origin; seat count = generated objects; `.3dm` opens with metres, layers, blocks, metadata, correct coordinates (independent Python check) | **Done** (see §8) |
| **02** Seating & experience | Seat product system, generative tiers with accessibility positions, capacity target solver, sightlines (head-clearance proxies, C-value later), immersion scoring + heatmap, view-from-seat FOV | Heatmap responds logically to geometry; every score traceable to its inputs; capacity target never yields impossible layouts | **Done** except accessibility positions (see §9) |
| **03** LED systems | Panelization strategies for families 01–05, deviation/gap visualisation, counts, resolution, weight, power, alternatives when curvature fails | Cabinets keep true size; ideal vs built difference shown and quantified | **Done** (see §8c) |
| **04** Transformation | Kinetic assemblies (retractable banks, lifts, translating rows, stage lifts), state machine, bottom timeline, playback, collision/clearance checks, section animation | Explicit paths; forward/reverse; audience cleared before motion; conflicts flagged; machinery marked conceptual | **Done** (see §8d) |
| **05** Presets & venue fit | OM 150/300/400/Standing/360 presets × performance presets, project store, duplication, building envelope with columns, fit analysis | Presets use the same engine; save/reopen reproduces geometry | Planned |
| **06** CAD deliverables | Exact geometry everywhere practical, named blocks, multiple state exports, schedules (CSV), DXF, GLB, PDF sheets | Export validator extended to every state | Planned |
| **07** Optimisation | Reverse configuration ("250 premium seats", "fit 30 m wide"), immersion-driven layout search, comparison dashboards | Deterministic, explainable proposals | Planned |

## 6. Known risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Purpose-built spherical LED vendors (KM, Cosm, Unilumin) publish almost no cabinet data | Family 04 numbers are placeholders; comparisons could mislead | Status badges everywhere; request NDA datasheets; keep family 04/05 marked conceptual |
| R2 | Conventional cabinets are single-axis | Faceting gaps/deviation may be visible at OM viewing distances (eye ≈ 1–10 m from screen) | Quantified in R03: at R = 13 m, 500 mm flat cabinets stand off 4.8 mm at the corners and open wedge joints up to 52 mm near the top ring. Next: pixel-pitch vs viewing distance, and a physical mock-up |
| R3 | `rhino3dm` cannot trim/boolean/offset | Screen openings, section caps and solid unions need another path | Untrimmed iso-patches cover the core; Rhino.Compute (authorised server, confidential) or RhinoCommon plug-in later |
| R4 | Immersion scoring has no validated standard | Scores could be over-trusted | Expose every sub-metric and weight; label as design heuristic; calibrate with audience studies |
| R5 | Transformable machinery is unengineered | Animations could be read as feasible | Conceptual status on every kinetic assembly; collision checks only geometric; consultant review (Gala/Figueras) |
| R6 | Seating dimensions mostly placeholders | Capacity numbers shift when real data arrives | Library values carry status; capacity metric labelled by product status; obtain datasheets |
| R7 | Single-thread regeneration cost grows with LED tiling (thousands of cabinets) | UI lag | Per-subsystem memoisation, Web Worker, instancing (already used) |
| R8 | Confidentiality | Public exposure of concept | No third-party runtime requests. Alex confirmed on 2026-10-28 that the repository is public by choice |
| R9 | Life-safety/egress not modelled | Seat layouts may be non-compliant | Validator warnings (aisle width, riser) now; egress module later; never claim compliance |

## 7. Decisions made

| Date | Decision | Reason |
|---|---|---|
| 2026-10-28 | Engine is pure TypeScript, independent of Three.js | Same model drives viewport and CAD; testable in Node |
| 2026-10-28 | Media surface exported as an **untrimmed rational NURBS** iso-patch whose domain equals [θ0, θ1] × [φ0, φ1] in radians | Exact sphere without trimming; designers can read angles from the surface domain in Rhino |
| 2026-10-28 | Rows are arcs about a movable seating layout origin `(0, focusY)`, not about the sphere centre | Lets rows face the stage while keeping eye points near the sphere origin; brief warns against forcing concentric arcs |
| 2026-10-28 | Seats that violate clearance are dropped and counted, never squeezed | "Do not create impossible layouts" |
| 2026-10-28 | Seats and LED cabinets are Rhino blocks; per-instance metadata in user strings | Light files, editable definitions |
| 2026-10-28 | Every layer in the hierarchy is created even when empty | Stable layer structure across rounds |
| 2026-10-28 | OM 300 default: R = 13 m, 220° × (−7.5° … 72°), floor −1.8 m, 12 rows, Figueras Smart 13033 → 304 seats | Starting point near the pitch target; not a design recommendation |
| 2026-10-28 | System fonts only; no CDN assets | Confidentiality and offline use |
| 2026-10-28 | Immersion score = weighted mean of 9 sub-scores, each a linear ramp of one geometric measurement; ramps, weights and thresholds live in the configuration | Every number is traceable and tunable; labelled a design heuristic (R4) |
| 2026-10-28 | Sightlines use a C-value proxy: height of the eye→stage-front-edge line above the eye of the nearest seat in front, within half a seat width | Standard spectator-sightline practice; the blocking seat is named so the fix is obvious |
| 2026-10-28 | Capacity target varies only row count and fan angle, runs every candidate through the normal generator, and picks the highest average immersion | Never produces a layout the generator would not; product, pitch and clearance stay the designer's choice |
| 2026-10-28 | Analysis runs 150 ms after the model settles, not during slider drags | ≈0.12 s for 300 seats; keeps geometry edits fluid |
| 2026-10-28 | Flat units (families 01–03) are laid in latitude rings that touch at the pole-side corners and open wedge gaps towards the equator; each ring sits at the lowest elevation that clears the ring below | A ring of rectangles approximates a cone, so faces cannot meet along whole edges. Touching on centre lines (Round 01) made faces collide by up to 27 mm, which cannot be built |
| 2026-10-28 | Families 04–05 are spherical tiles cut from the sphere, one tile type per row, never wider than the nominal panel | Matches how purpose-built domes are made; the cost shows up as tile-type count instead of deviation |
| 2026-10-28 | Curvature check uses the hinge angle between ring neighbours (≈ w/R, rising towards the poles), solved exactly for the minimum radius | The old 2·atan(w/2ρ) estimate overstated the angle at high latitudes |
| 2026-10-28 | Units are never stretched; uncovered strips at the top edge and row ends are reported | "Cabinets keep true size" |
| 2026-10-28 | Seated → standing uses telescopic wagons: one per row and aisle block, each sliding straight back along its block's centre line until it nests one row pitch (less a nest offset) under the row behind; the back row stays put. The stage lowers by its own height | The most common retractable-seating type (Gala/Figueras/Hussey class). Straight paths are explicit and easy to engineer later |
| 2026-10-28 | Sequence: interlock hold (house confirmed empty) → seats fold → wagons and stage lift move together. Standing → seated is the same sequence played backwards | "Audience cleared before motion" is structural: no assembly starts before the hold ends |
| 2026-10-28 | Collisions are geometric only: plan footprints sampled every 1 s against every other assembly whose height band overlaps; touching is allowed, overlap is a conflict. Wagons stop short to keep 200 mm from the screen | Fast enough to run on every edit (≈0.1–0.2 s); labelled conceptual (R5) |
| 2026-10-28 | Standing capacity at 0.5 m² per person on the clear floor of the standing state (0.25 m grid inside the screen clearance) | Conceptual density, to be replaced by the OM team's figure (see §9 question 12) |

## 8. Round 01 status

Delivered:

- `src/engine/*` — coordinates, validation, sphere/media, seating, stage/envelope, LED preview band, sections, units, model assembly.
- `src/library/*` — 5 seating and 5 LED entries with sources and per-value status.
- `src/export/rhino.ts` — `.3dm` writer (browser button and `npm run export:sample`).
- `scripts/validate_3dm.py` — independent check (units, 59 layers, object/layer counts, block instances, exact-sphere sampling of the media surface, origin/seat/stage coordinates, stage dimensions, tier heights, envelope containment).
- `tests/*` — 14 tests: spherical exactness, origin invariance, regeneration, seat counts/footprints, clearance, determinism, validation, units, section, export round-trip.
- UI: layer panel, parameter panel with sliders + exact inputs + per-parameter reset, linked radius/diameter/circumference, symmetric azimuths, m/ft, issues list, metrics with quality badges, view presets, seat selection with VIEW FROM THIS SEAT and FOV, longitudinal/transverse/plan section with exact sphere cut line, calibration-grid media content, save/open JSON, EXPORT RHINO.

Known Round 01 limitations: section cuts are not capped (hollow solids); seats are proxy massing at true
footprint; LED band is a preview, not panelization; workspace tabs other than DESIGN are disabled.

## 8b. Round 02 status

Delivered:

- `src/engine/immersion.ts` — per-seat measurements from the eye point (field of view filled by screen by solid angle, horizontal/vertical FOV, distance to origin, nearest screen, head turn to stage, sightline C-value, screen centre elevation, mean incidence), linear ramps, weights, grades (excellent ≥ 0.80, good ≥ 0.65, acceptable ≥ 0.50, compromised ≥ 0.35), warnings and the blocking seat. OM 300 default: average 0.69, 193 premium seats (≥ 0.65).
- `src/engine/capacity.ts` — capacity target: bisects fan angle for each row count, keeps candidates within +5 % of the target, ranks by average immersion, and explains the limit when the target cannot fit.
- UI: ANALYZE workspace (heatmap + legend), Immersion analysis section (summary, grade bar, weight sliders, reset), Target capacity with Fit, seat panel with the full score breakdown (value, sub-score, weight per metric), the blocking seat as a link and the sightline drawn in the viewport, immersion average and premium count in the metrics bar.
- Rhino export: seats carry `om.immersion_score`, `om.immersion_grade`, `om.sightline_clearance_m`, `om.sightline_blocked_by`, `om.immersion_warnings`; one line per seat on `07_ANALYSIS/Sightline_Rays`; the stage focus point on `07_ANALYSIS/Viewing_Targets`; summary in the manifest.
- `scripts/validate_3dm.py` — new checks: one ray per seat, rays end on the target and start at seated eye height, grades follow thresholds, seat scores average to the manifest figure.
- Tests: 22 (traceability of every score, determinism, single-weight isolation, geometry response, blocking seat in front, capacity feasibility and refusal, export round-trip of scores and rays).

Not yet done in Round 02: wheelchair and companion positions (needs the jurisdiction and target count, see §9 question 9); C-value currently targets the stage front edge only, not the screen.

## 8c. Round 03 status

Delivered:

- `src/engine/led.ts` — panelization per family. Rings of true-size flat units (01 faceted, 02 single-axis curved, 03 flexible) with tangent or balanced placement and a design joint gap; spherical tiles (04, 05) cut to the sphere. Every unit carries deviation, widest gap, deepest collision, face step, hinge angles and a curvature verdict; totals cover count, unit types, coverage, resolution, pixels, weight, max/average power, uncovered strips. `compareLedProducts` runs all five library products on the same screen; `minRadiusFor` gives the smallest radius each product can make.
- OM 300 default (RB-C 2.6F, R = 13 m, full screen): 2,721 cabinets, 96.9 % covered, 19,008 × 6,720 px, 22.6 t, 571 kW max, 4.8 mm max deviation (2.4 mm balanced), wedge joints up to 52 mm, hinge 2.32° in rings and 3.13° between rings, no collisions. RB2.6F (5° hinge) needs R ≥ 6.44 m; family 04 needs 2,856 tiles in 36 types.
- Curvature failures name the products that would fit and the radius that would make the chosen one fit.
- UI: LED system panel (product with data-status badge, strategy, extent, placement, joint gap, summary, colour by product / deviation / joints with legend, comparison table that switches product on click). Showing the units hides the ideal surface they sit on.
- Rhino export: units on `01_MEDIA/LED_Cabinets` (flexible modules on `LED_Modules`) with all measurements as user strings; spherical tiles as exact NURBS sphere patches; LED summary in the manifest.
- `scripts/validate_3dm.py` — new checks: unit count, metadata, rigid (unscaled) transforms, block matches the product's true size, face-corner deviation equals the reported maximum, tiles are exact sphere patches, tile-type count.
- Tests: 36 (14 new for LED: rigidity and true size, no collisions in any placement, exact deviation formula, coverage below 100 %, radius response, totals, curvature failure, minimum radius, alternatives, tiles on the sphere, tile width cap at the zenith, comparison, legacy file migration, tile export).

Known limits: deviation is per unit (corner stand-off), so rings show one colour in deviation mode; joints mode shows where it matters. Tiles at the zenith become triangular gores. Substructure, mounting and service access are not modelled. Tile exports are large (≈ 17 MB for 2,856 Breps).

## 8d. Round 04 status

Delivered:

- `src/engine/kinetics.ts` — telescopic seating wagons (deck, back riser, seats and eye points per row × aisle block), a stage lift, the seated → standing sequence (interlock hold, seat fold, wagons and lift), `poseAt(t)` for any moment in either direction, straight motion paths on `04_TRANSFORMATION/Movement_Envelopes`, the stage pit on `Storage_Volumes`, collision and screen-clearance checks with timed conflicts that explain the cause, and standing area/capacity measured on the standing state.
- Seating: with telescopic seating each row is split into wagon decks per aisle block with a back riser, instead of solid tiers from the floor.
- OM 300 default: 33 moving assemblies (32 wagons + stage lift; the back row stays), 3:16 seated → standing (60 s hold, 20 s fold, 117 s wagons in parallel with an 18 s stage lift), no conflicts, 333 m² clear floor → 666 standing. With a 250 mm riser the folded seats (200 mm + 80 mm deck) no longer fit under the row behind: 31 collisions, each naming the wagons, the time window and the shortfall.
- UI: TRANSFORM workspace with a bottom timeline (step lanes, conflict markers, scrubber, play forward and back, ×1–×30, Seated/Standing jumps, live state "clearing the house / in transit / standing"), the viewport shows the pose at any time (wagons slide, seats fold, stage lowers; the section cut works on the moving geometry), and a Transformation panel (seating and stage mode, nest offset, deck, folded seat height, speeds, hold and fold times, summary, clickable conflicts).
- Rhino export: seated or standing state (EXPORT RHINO follows the timeline; `export:sample` writes both). Moved objects carry `om.pose_offset` and `om.operating_state`; the manifest lists every assembly with its travel and timing, the conflict count and standing capacity.
- `scripts/validate_3dm.py` — new checks: one straight path per moving assembly equal to its travel, paths marked conceptual, nothing moves before the clearance hold, the right number of objects moved, each by exactly its path, moved seats folded, lowered stage flush with the floor, no seated sightlines in the standing file.
- Tests: 45 (9 new: explicit paths, start/end poses and monotonic playback, audience cleared first, no conflicts and screen gap, riser-shortfall collisions, stage lift and standing gain, conceptual flag and off switch, legacy files, standing export).

Known limits: folding is drawn by scaling the seat block (the export keeps the seat block and marks it folded); wagons move straight, so curved or pivoting banks are not modelled yet; the side blocks stop short of full nesting where the screen comes first; drives, guides, pits for wagons and egress during transformation are not modelled.

## 9. Open questions for the OM team

1. **Pitch deck**: please share it; Round 02 seating/stage presets should match its diagrams.
2. **Screen-to-audience distance**: what minimum eye-to-LED distance is acceptable at 2.6 mm pitch? (Drives `screenClearance`, currently 1.5 m.)
3. **Horizon**: should the reference eye point (sphere centre) sit at seated eye height of the central rows (current default), or above the audience?
4. **Stage relationship**: should the stage cut into the media surface (opening) or sit in front of it? Openings need trimming (Rhino.Compute).
5. **LED vendors**: can we request NDA datasheets from Konica Minolta, Cosm and Unilumin, and confirm ROE's Ruby-C step size and power figures?
6. **Seating**: which Figueras/Ferco models are on the shortlist, so placeholders can be replaced?
7. **Rhino**: which Rhino version do your teams use, and is an internal Rhino.Compute server acceptable for confidential geometry?
8. **Previous tools**: can any Stagework/ManicAI source or exports be shared for reuse (UI patterns, layer conventions)?
9. **Accessibility**: which code applies (e.g. ADA, UK Approved Document M, EN 17210) and how many wheelchair/companion positions should OM 300 provide, and where?
10. **Immersion weights**: do the default weights match the OM team's priorities? The fastest way to calibrate is to rate a handful of seats in a mock-up and fit the ramps to those ratings.
11. **LED joints**: what wedge joint between faceted cabinets is acceptable at OM viewing distances? It sets whether families 01–02 are viable or 04–05 are required (currently up to 52 mm near the top ring at R = 13 m).
12. **Standing density and changeover**: what standing density should OM plan for (currently 0.5 m² per person), and what changeover time is acceptable? The default sequence takes 3:16 at 80 mm/s, of which 60 s is the clearance hold.
13. **Transformation suppliers**: are Gala Systems or Figueras (or others) already in conversation? Their wagon dimensions and speeds would replace the conceptual defaults.
