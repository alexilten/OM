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

`ImmersionAnalysis` (R02) lives in `src/engine/immersion.ts`; its settings (weights, ramps) are part of `VenueConfiguration.analysis` so saved files reproduce scores. The LED system (R03) is `VenueConfiguration.led` plus `src/engine/led.ts`; Round 01–02 files carrying `ledPreview` are migrated on open. The transformation (R04) is `VenueConfiguration.transformation` plus `src/engine/kinetics.ts` (`KineticAssembly`, `TransitionStep`, `TransformationModel`, `poseAt`); seats carry their aisle block and their wagon as `parentAssembly`. The building (R05) is `VenueConfiguration.building` plus `src/engine/building.ts` (`analyzeFit`); `operatingState` sets which end of the transformation the venue is shown and exported in; `preset` records the size × performance preset it started from (`src/engine/presets.ts`). A project (`src/engine/project.ts`) is a list of configurations, one per alternative.

## 5. Development rounds and acceptance criteria

| Round | Scope | Acceptance (must be demonstrated) | Status |
|---|---|---|---|
| **00** Research & architecture | Brief review, product research, architecture, data model, this plan | Research notes with verified vs unknown data; risks listed | **Done** — `docs/research/ROUND_00_RESEARCH.md` |
| **01** Spherical PoC | Origin, reference sphere, exact media patch with az/el limits, floor elevation, simple stage, basic tiered seating, orbit camera, section cut, `.3dm` export | Radius change regenerates everything; surface stays spherical (tested to 1e-10 m); floor change never moves the origin; seat count = generated objects; `.3dm` opens with metres, layers, blocks, metadata, correct coordinates (independent Python check) | **Done** (see §8) |
| **02** Seating & experience | Seat product system, generative tiers with accessibility positions, capacity target solver, sightlines (head-clearance proxies, C-value later), immersion scoring + heatmap, view-from-seat FOV | Heatmap responds logically to geometry; every score traceable to its inputs; capacity target never yields impossible layouts | **Done** except accessibility positions (see §9) |
| **03** LED systems | Panelization strategies for families 01–05, deviation/gap visualisation, counts, resolution, weight, power, alternatives when curvature fails | Cabinets keep true size; ideal vs built difference shown and quantified | **Done** (see §8c) |
| **04** Transformation | Kinetic assemblies (retractable banks, lifts, translating rows, stage lifts), state machine, bottom timeline, playback, collision/clearance checks, section animation | Explicit paths; forward/reverse; audience cleared before motion; conflicts flagged; machinery marked conceptual | **Done** (see §8d) |
| **05** Presets & venue fit | OM 150/300/400/Standing/360 presets × performance presets, project store, duplication, building envelope with columns, fit analysis | Presets use the same engine; save/reopen reproduces geometry | **Done** (see §8e) |
| **06** Catalog & immersion systems | Standard / Premium / Flagship fit-out (seats, riser decks, guardrails, seat accessories); lighting rigs, immersive audio (HOLOPLOT, d&b Soundscape, L-ISA, generic), haptics, atmospherics and tracking as layers with on/off, tier, density and product | Units placed, counted, costed and exported on their layers; every fixture and speaker has a stable id | **Done** (see §8f) |
| **07** LED support structure | Generative, productised structure behind the media surface (ribs, ring girders, brackets, splices, shippable segments, schedules, install logistics, service walkway) that carries the audio arrays, lighting truss and hoists | Pick-up schedule includes Round 06 loads; segments respect shipping limits; scales with the media surface | **Done** (see §8g) |
| **08** Live Show Preview I | EXPERIENCE tab: video upload + shader ambient presets mapped on the sphere, from-seat view, audio upload + synthesised soundscapes, BPM detection / tap tempo, virtual-speaker binaural preview, transport | A/V in sync within one frame over 10 min; BPM within 2 %; 60 fps budget — see `docs/plans/SHOW_PREVIEW_PLAN.md` | **Done** (see §8h) |
| **09** Live Show Preview II | Content-driven lighting (zone + palette), beams in haze, modulation matrix (beat / bands / colour → video, lights, haze, haptics), show presets, cue list, clip recording, flash-safety limiter | Washes track adjacent screen colour within 100 ms; one-click presets; flash limiter verified | **Done** (see §8i) |
| **10** Venue forms | Retractable proscenium: a front sector of the screen (azimuth and elevation set by sliders) on its own carrier that slides back along the forward axis to open a stage portal, as a kinetic assembly on the TRANSFORM timeline. Seating anywhere along the forward axis: blocks in front of and behind the origin, with sightlines and immersion scored either side. Torus form: the screen becomes a torus section (major radius, tube radius) with the top cut off by an upper elevation limit, alongside the sphere | Proscenium moves without clashing (screen, structure, stage) and exports both states; seats in front of the origin keep screen clearance and score; torus surface is exact in Rhino and LED, structure and analysis follow it | Done (§8j) |
| **11** Show content | Replace the stock-feeling looks and soundscapes with cinematic, original ones: monumental slabs, a black hole, a folding lattice, industrial noise, glam starfields, a desert storm, ink glyphs; trailer-scale sound design (brass walls, Shepard rise, ticking clock, crushed drums, war drums, vocal clusters) that builds and drops with a six-cue arc | Every preset uses only the new looks and sounds; its sound and cues land on the same bars; old saved shows still open | Done (§8k) |
| **12** CAD deliverables | Exact geometry everywhere practical, named blocks, multiple state exports, schedules (CSV), DXF, GLB, PDF sheets | Export validator extended to every state | Planned |
| **13** Optimisation | Reverse configuration ("250 premium seats", "fit 30 m wide"), immersion-driven layout search, comparison dashboards | Deterministic, explainable proposals | Planned |

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
| 2026-10-28 | Presets are two independent systems: size (radius, rows, front row, fan) and performance (stage, seating focus, screen coverage, operating state). Everything else scales with R / 13 m. OM 300 × Cinematic is exactly the flagship default | "Presets use the same engine"; any size works with any arrangement, and an edited preset is still a normal configuration |
| 2026-10-28 | The building is the site: presets and alternatives never change it unless the designer does | Lets OM 150/300/400 be checked against one building directly |
| 2026-10-28 | Venue fit claims the design envelope (sphere + service zone) plus a circulation walkway; a column inside the sphere or the service zone is a clash, one in the walkway is advice | Simple, explainable rules that match "screen support envelope" and "audience circulation" in the brief |
| 2026-10-28 | Alternatives live in the browser (localStorage) and regenerate on compare; nothing derived is stored | A saved project always reproduces its geometry |
| 2026-10-28 | Fit-out and immersion systems are catalog choices with three tiers (Standard = industry standard, Premium = high-end cinema/theatre, Flagship = bespoke immersive), plus per-system on/off and a density multiplier 0.5–2. A package button sets the seat, fit-out and every system tier at once | "Swap industry standards and premiums" and "scale up in desirability" without a new set of parameters per product |
| 2026-10-28 | Audio arrays sit behind the screen (front face R + 0.35 m) in rings inside the media span, one product chosen per venue (HOLOPLOT X1 matrix, d&b Soundscape 44S, L-ISA X8, generic); matrix products stack modules per position | Keeps the room clear and ties every flown load to the Round 07 structure; requires an acoustically transparent screen (flagged) |
| 2026-10-28 | Lighting hangs on a stage truss, a base wash ring and (flagship) a halo in the oculus; hoists carry their share of truss + fixture weight as `pick_load_kg`. Overhead rigs are scored as screen hidden from the reference eye | Gives Round 07 the pick-up points and loads; makes the cost of overhead rigs to the screen visible |
| 2026-10-28 | Costs are placeholders for comparing options, labelled so everywhere | No supplier pricing yet |
| 2026-10-28 | The live show preview (Rounds 08–09) runs client-side on one audio clock; ambient video and soundscape presets are generated (shaders, Web Audio synthesis), uploads never leave the browser | Licence-clean, sharp at LED resolution, beat-addressable; the site and repo are public. Plan: `docs/plans/SHOW_PREVIEW_PLAN.md` |
| 2026-10-28 | Generative sliders on the left, layers and alternatives on the right | Alex prefers the Stagework layout |
| 2026-10-28 | The support structure is ribs on meridians (rib sphere = R + LED depth + mounting gap + half the rib depth) and ring girders on latitudes on the ribs' outer face, evenly spaced to target spacings, from the floor to a top compression ring (≤ 85°) | Follows the media surface exactly as it scales; every piece is a circular arc, which is how rolled members are made and shipped |
| 2026-10-28 | Every member is split into equal segments no longer than the shipping length and classed by its chord × (sagitta + depth) × width against 20' / 40' containers and a standard trailer | Productised: piece count, splice count, heaviest lift and transport fall out of the geometry |
| 2026-10-28 | The structure is the rigging backbone: arrays snap into bays; a hoist picks up vertically from a pick beam between the two ribs behind the screen (its chain passes through the LED, flagged), or from a crown grid over the oculus; every hung load is assigned to named ribs and the rib reactions add up exactly to structure + LED + hung loads | "Tie perfectly into the overhead lighting and rigging"; loads stay traceable for a future structural engineer |
| 2026-10-28 | Public app on GitHub Pages, rebuilt on every push to main | Alex asked for public links (https://alexilten.github.io/OM/) |
| 2026-10-28 | Venue preset, show, media, sound and playback live in a menu strip under the top bar; notices collapse into one row; left sections start collapsed except Reference sphere; metrics float centred | Alex's Stagework-style layout feedback |
| 2026-10-28 | Show playback is driven by the audio clock; beat pulses are limited to 3 per second (WCAG 2.3.1) and switch off with reduced motion | One master clock keeps screen, lights and sound locked; photosensitivity safety by default |
| 2026-10-28 | The show is saved with each alternative as a small versioned `ShowDefinition` (cues, modulation, tempo, look); uploaded files are never stored, only their names | Alternatives can be compared as shows; nothing user-supplied leaves the browser |
| 2026-10-28 | Cue looks crossfade over bars on the audio clock; the modulation matrix is plain data (source → target × amount × curve); every strobe hit passes a 3-per-second flash guard and beat-flashed saturated red is softened | Musical structure without a timeline editor; safety cannot be routed around |
| 2026-10-29 | Torus form = the sphere's profile circle (tube radius R) offset from the vertical axis by a ring radius a; ring 0 is the sphere. P(θ,φ) = ((a + R cosφ) sinθ, (a + R cosφ) cosθ, R sinφ), so azimuth, elevation and the normal keep their meaning and every subsystem takes `ring` as one extra argument. At 90° upper elevation the top opens with radius a | One exact rational NURBS for both forms; "cut the top off" is the existing elevation limit |
| 2026-10-29 | "Scoots back in z space" read as depth: the proscenium pushes back along +Y, away from the audience (Z is up in OM Studio), then its two halves slide apart; one 0–1 Open slider drives both legs, played on the TRANSFORM timeline or held in every state | Alex: "a generative slider where it pushes back and then opens up with a slide" |
| 2026-10-29 | Round 10 becomes Venue forms (retractable proscenium, seating either side of the origin, torus with the top cut off); CAD deliverables move to 11 and optimisation to 12 | Alex's geometry asks change the form itself, so they land before the deliverables are fixed |
| 2026-10-29 | Round 11 becomes Show content (cinematic looks and sound); CAD deliverables move to 12 and optimisation to 13. The new content is inspired by epic film scores, industrial music and glam rock, but names no artist or film | Alex: the old presets felt "lame… off the shelf"; step it up to "epic and badass beats and visuals" |
| 2026-10-29 | The overhead lighting is one circular crown truss set into the slice just above the screen's top edge (stage truss and halo removed); it follows the radius, ring radius and top edge, with a 0–20° "below top edge" slider, and hangs off the top ring girder. Default top edge lowered from 72° to 54° (three quarters) | Alex: the overhead rig was "confusing and gets in the way"; it should be "circular… embedded into the top slice… tied to the generative slider system", and the default top "a little lower… maybe 3/4" |
| 2026-10-29 | The stage is joined to the screen by default: width × depth is the thrust in front, and the deck runs back ("Back to the screen", 0–1) and out to the sides ("Out to the sides", 0–1, measured to where the wing line meets the screen) until it meets the screen, trimmed to an exact arc of the screen's plan circle (50 mm joint, 200 mm when the deck is a lift). "Stand-alone" restores the rectangle; central stages and older files stay stand-alone | Alex: the stage "should go back and to the side until it hits the spherical surface and then terminate cleanly… a nice sliding scaling element", with stand-alone as a box to tick |
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

## 8e. Round 05 status

Delivered:

- `src/engine/presets.ts` — size presets OM 150 (R 10 m), OM 300 (R 13 m), OM 400 (R 15 m) × performance presets Cinematic Immersion, Seated Concert, Standing Concert, Theatrical Proscenium, Theater in the Round; the five named venues from the brief built from them. With the default seats: OM 150 → 153 seats, OM 300 → 304, OM 400 → 397; OM 360 (in the round, screen all the way round, central stage) → 293 seats, all premium; the standing preset shows and exports the transformed state. All 15 combinations generate without motion conflicts.
- `src/engine/building.ts` — simplified existing building (clear width, depth, height, structural floor, venue offset, circulation walkway, columns none / perimeter / grid) and fit checks: walls, clear height, columns in the sphere or service zone, walkway, floor or pit below the structural floor. Reports the largest sphere the building takes (exact, tested) and which size presets fit. Default: a 36 × 40 × 19 m clear-span hall with perimeter columns; OM 150 and OM 300 fit; OM 400 needs about 0.6 m more clear height and its walkway narrows to 1.5 m.
- `src/engine/project.ts` — alternatives with unique ids and names, duplicate, delete, add from preset or file, parse with migration (invalid alternatives are dropped and named).
- UI: Alternatives list in the left panel (switch, duplicate, delete, compare table of seats, premium seats, immersion, standing, LED units, changeover time and building fit, best values highlighted); Venue preset section (named venues, size × performance, apply or add as alternative, "edited since" note); Building fit section (verdict, checks, fit sphere to building, which sizes fit, building and column parameters); columns drawn red when they clash, orange in the walkway, ghosted when clear; Show and export as seated or standing.
- Rhino export: building outline and corners on `06_ARCHITECTURE/Building_Envelope`, columns with `om.fit_status` on `Structure`, walkway on `Circulation`; building summary in the manifest. `npm run export:sample -- --presets` writes all five named venues (seated and standing).
- `scripts/validate_3dm.py` — new checks: building outline size and floor, column count, each column's clash status recomputed from its geometry, clash count, a "fits" verdict really has the envelope inside the walls with no clashes. All 12 preset files pass.
- Public app: GitHub Pages workflow, live at https://alexilten.github.io/OM/.
- Tests: 58 (13 new).

Known limits: entrances, exits, support spaces and mechanical access are not modelled yet; the building is a rectangle aligned with the venue (no rotation, no imported CAD); in-the-round closes the screen, so use the section cut to look inside; alternatives are stored per browser (Save/Open moves single alternatives between machines).

## 8f. Round 06 status

Delivered:

- `src/library/catalog.ts` — tiered catalog: riser decks (steel/ply, acoustically damped, bespoke with services), guardrails (steel, glass, glass with LED cap rail), seat accessories (cup holder, side table + USB-C, service console); seat products mapped to tiers. Immersion systems with per-tier units: lighting (moving-head spots, LED washes, show lasers, box truss, chain hoists), immersive audio, haptics (inertial transducer; Powersoft Mover; D-BOX G5 actuators, figures from the Round 06 FX research), atmospherics (hazer, low fog, scent), tracking (cameras, depth sensors). Audio products: HOLOPLOT X1 MD96 (100 kg, 650 W continuous from the data sheet), d&b 44S (3.6 kg), L-Acoustics X8 (12 kg), generic grid. Costs are placeholders.
- `src/engine/systems.ts` — places every unit as a block instance on its layer: arrays in rings behind the screen (plus a flagship zenith array and floor subwoofers), a stage truss shrunk to stay inside the sphere, a base wash ring, a flagship halo in the oculus, hazers on a floor ring, cameras on the front arc aimed at the audience. Roll-ups per system and in total: units, power, weight, placeholder cost; rigging pick-up points and suspended load; share of the screen hidden by overhead rigs. Fit-out: riser deck area from the generated tiers, guardrails along the rear edge of each block's top row where the drop exceeds 0.6 m, accessories per seat.
- Defaults (OM 300): premium fit-out, premium lighting, premium HOLOPLOT audio, premium haptics, standard atmospherics, tracking off. With every system on, the three packages come to: Standard 51 placed units + 330 seat transducers, $1.2 M (Minispace, 330 seats); Premium 146 + 304, $5.7 M (Smart, 304 seats); Flagship 313 + 326 actuators, $14.0 M (Opus at 1.3 m pitch, 163 seats). Costs are placeholders. Round 05 files open with every system off.
- Validation: unknown items, tiers, density outside 0.5–2, unknown audio product; warnings when arrays do not fit the service zone, no ring fits the media, overhead rigs hide more than 5 % of the screen, or flagship motion seats meet telescopic wagons.
- UI: Fit-out & products (package Standard / Premium / Flagship, per-category picks with price badges, deck / guardrail / cost totals) and Immersion systems (per-system on/off, tier, density, audio product, totals) sections; system units coloured by system in the viewport; Systems group in All metrics.
- Rhino export: units on `05_TECHNICAL/{Lighting, Audio, Rigging, AV_Equipment}`, guardrails on `02_AUDIENCE/Guardrails`, `SYS_*` block definitions, systems summary in the manifest. `npm run export:sample -- --packages` writes OM 300 with every system on at each tier.
- `scripts/validate_3dm.py` — new checks: placed units per system match the manifest, speakers between the screen and the service-zone limit, fixtures/hazers/sensors inside the sphere, guardrail length, every hoist carries a load. All 18 files (presets + packages, seated and standing) pass.
- Roadmap: live show preview planned as Rounds 08–09 (`docs/plans/SHOW_PREVIEW_PLAN.md`); CAD deliverables move to 10, optimisation to 11.
- Tests: 69 (11 new).

Known limits: placement rules are not a lighting or acoustic design (coverage comes from the manufacturers' tools); the FX mounting zones, laser exclusion volumes, heavy-gas pooling and rules F1–F12 from the FX research are scheduled with Round 07; units do not yet hang from structure.

## 8g. Round 07 status

Delivered:

- Layout: generative sliders on the left, layers and alternatives on the right.
- `src/engine/structure.ts` — support structure generated from the media patch and LED depth with three productised systems (`STRUCTURE_SYSTEMS`): Standard curved steel box-truss ribs with RHS rings, Premium rolled RHS 300×200 ribs, Flagship curved aluminium space-frame ribs. Rib and ring spacing, mounting gap, shipping segment length and service walkways are parameters. Output: ribs, ring girders, base and top rings, node brackets (rib × ring), base plates, splices, service walkways, pick beams, crown beams and chains, each with marks (R03-2, G05-1, P01, C02), lengths, chords, sagittas, weights and shipping class.
- Tie-in: audio arrays snap to slots inside the bays (never on a rib) with their front on the ribs' front face; stage-truss hoists pick up from pick beams behind the screen (chains through the LED are counted and flagged for rigging ports), halo hoists and the zenith array from a crown grid over the oculus; loads go to named ribs. OM 300 default (steel): 23 ribs × 8 rings, 165 segments all in 20' containers, 33 t structure, 23 t LED, 21 t hung with every flagship system on, largest rib reaction ≈ 4.2 t, ≈ 13 erection days (placeholder rate). Aluminium cuts the structure to 11 t and the largest reaction to 3.0 t.
- FX safety from the Round 06 research: an audience laser exclusion plane (3.0 m above / 2.5 m beside the seating) on `07_ANALYSIS/FX_Safety_Volumes`, with a warning for any laser below it; low-fog / CO2 pooling advice for the seating bowl.
- UI: Support structure & rigging section (system, spacings, gap, segment, walkways; ribs × rings, segments, weights, reaction, cost and days; shipping summary; pick-up schedule by carrier); structure drawn in steel grey, pick and crown beams and chains in orange.
- Rhino export: ribs and rings as exact arcs on `01_MEDIA/LED_Structure`, nodes and base plates as blocks on `LED_Mounting`, walkways on `Service_Clearances`, chains on `05_TECHNICAL/Rigging`; structure summary in the manifest.
- `scripts/validate_3dm.py` — new checks: segment counts, every rib on the rib sphere, structure inside the service zone, every segment within its shipping class, chain count, one node per rib × ring. All 18 files pass, including OM 360 (full 360° ring, no end ribs).
- Tests: 77 (8 new).

Known limits: loads are summed per rib, not analysed (no wind, seismic, buckling or connection design); bracing, cable trays, LED sub-frames and access ladders are not modelled; walkways are flat rings on alternate girder levels; the crown grid is radial beams to a hub.

## 8h. Round 08 status

Delivered:

- EXPERIENCE tab is live. The show plays on the media surface in a dark room view, with beams from every placed lighting fixture.
- Top menu strip (all tabs): Venue (named venues, size, performance, alternative name), Show presets (Deep Space 70, Aurora 80, Ocean 60, Pulse 124, Cathedral 60, Calibration 60 BPM), Media, Sound and the transport (play / pause, stop, time, beat dots, BPM). Using any show control opens EXPERIENCE; leaving the tab stops the sound.
- `src/show/`: `timing.ts` (beat phase, tap tempo, flash-safe subdivision, BPM and downbeat detection by onset autocorrelation, content mapping), `presets.ts`, `shaders.ts` (six generated looks in GLSL: nebula, aurora, ocean caustics, geometric tunnel, cathedral light, az/el calibration grid), `audio.ts` (Web Audio: limiter, analyser, decoded tracks, six synthesised soundscapes on a lookahead scheduler, up to 16 HRTF virtual speakers at the placed speaker positions), `store.ts`.
- Media: upload any browser-playable video (it stays in the browser), mapped as Fit screen, Equirect 360 or Dome master. Audio: upload a track (MP3, WAV, AAC, OGG); its tempo and downbeat are detected from the first 90 s, with ½, ×2 and tap to correct.
- Lights: Follow screen (each fixture takes the colour of the screen sector in front of it, sampled from the video ~10× a second, or the palette for generated looks), Palette (rotates per bar) or Off; pulse, haze and screen brightness sliders; reduced motion. From a seat the floor wash beams are hidden and the rest dimmed so they don't block the view.
- Layout feedback: notices collapsed into one row, left sections start collapsed except Reference sphere, metrics bar centred, axis legend moved to the top right.
- Tests: 86 (9 new: BPM 90/120/140 within 1 BPM, downbeat offset, beat phase, tap tempo, flash limit across 40–220 BPM, three mappings, preset references).

Known limits: show settings are not yet saved with alternatives; the binaural preview is a sketch, not an acoustic prediction; brightness is display colour, not calibrated LED nits. Content-driven lighting refinement, cues, modulation and clip recording are Round 09.

## 8i. Round 09 status

Delivered:

- **Cue list**: each show preset gets an arc (Intro, Build, Drop, Outro over 40 bars, looping); every cue stores a look (generated video, palette, lighting mode, pulse, haze, brightness) and crossfades from the previous one over N bars, including a GPU crossfade between two generated looks. Add, rename, move, store the current look, jump to, delete. A cue ruler across the bottom of the viewport shows the loop with the playhead; click to jump.
- **Modulation matrix** (`src/show/modulation.ts`): routes from beat, bar, bass, mids, highs, loudness, screen brightness and warmth to screen brightness, look speed, light intensity, strobe, beam sweep, haze and haptic seats, with amount and curve. Per-preset defaults (Pulse adds strobe on the bar; Ocean drives haze from the swell).
- **Effects in the scene**: beams sweep and strobe; a low haze layer glows with the screen colour (when Atmospherics is on); haptic seats glow under each seat (when Haptics is on); the screen spills soft light onto the room.
- **Safety** (`src/show/safety.ts`): a sliding-window flash guard (never more than 3 strobe hits in any second, reduced motion turns them off) and red-flash softening on beat-pulsed colour.
- **Saved with the alternative**: the show (preset, look, mapping, tempo, cues, matrix) is stored in the alternative and the project file, so switching alternatives switches shows; a reopened show that used uploads asks for them again and plays its generated stand-ins meanwhile.
- **Record clip**: the viewport and the limited master mix into a WebM (VP9 + Opus) or MP4 on Safari, up to 30 s, downloaded from the transport; nothing is uploaded.
- Fix: the project save listener was nested inside the analysis listener (from Round 05), adding a new subscription on every state change; it is now registered once.
- Tests: 99 (13 new: matrix shaping, sums and clamping, per-preset copies, cue arcs, fades, video crossfade, looping, palette blend, bar time, flash guard window, red softening, saved-show normalisation and a project round trip).

Known limits: no DMX patch or show-control export yet; MIDI clock / OSC tempo input not started; the haze layer and spill light are artistic, not photometric; recording frame rate depends on the viewer's GPU.

## 8j. Round 10 status

Delivered:

- **Torus form** (Reference sphere → Sphere | Torus, open top): tube radius, ring radius, outer diameter and top opening (typing an opening sets the ring and opens the top). The screen, Rhino NURBS (exact, max error ~1e-14 m), section cut (marching squares over the torus, inner half of a spindle torus excluded), viewport, LED panelization (rings and tiles), support structure (ribs, rings, nodes, picks), speakers and lighting, immersion analysis, seating clearance, building fit and design envelope all follow the ring. Metrics: tube radius, outer diameter, ring radius, top opening.
- **Seating either side of the origin**: "Seating position Y" slides the whole layout along the forward axis across ±(ring + R), with a live count of seats in front of and behind the origin and a "Centre on origin" button. Clearance, stage clash, immersion and telescopic wagons work on both sides.
- **Retractable proscenium** (Transformation → Proscenium): one generative **Open** slider (0–1). The first half of the range pushes the front screen sector straight back along +Y by the push-back distance; the second half splits it down the forward axis and slides the two halves apart (±X) until the opening is clear. "Play it on the seated → standing timeline" runs it as two-leg assemblies (closed seated, at the slider standing); off, it holds the slider pose in every state, with or without the transformation. Opening width (azimuth), opening top (elevation), push back and speed are sliders too. The screen is split into exact sections (left, right, above the opening) plus the two moving halves; LED units ride on the half their centre falls in. The support structure frames the opening with a portal header: ribs inside the opening start at the header, ring girders below it stop at the jamb ribs. A path check covers both legs (push solved exactly, slide sampled every 0.2 m) and lists anything else in the way (speakers behind the front screen, for example) and the building pocket needed past the service zone.
- **Exports**: the torus sample (`npm run export:sample -- --torus`: open top, proscenium, every system on) and every preset export in both states pass the validator, which now measures distances from the torus tube, checks the proscenium sections add up to the whole screen, sit exactly on the surface less their offset, and that every moved object is offset by exactly its assembly's travel.
- Tests: 112 (13 new: torus point/normal/inverse, exact torus NURBS and top opening, Pappus area, torus section, every system on the torus, ring validation and old-file upgrade, seats in front of the origin, proscenium split, carriage motion, portal header, path and pocket reporting, validation, proscenium on the torus).

Known limits: speakers and other items in its path are reported, not moved; the building pocket is reported, not drawn into the building fit; the torus uses the outer half only (elevation ±90°).

## 8k. Round 11 status

Delivered:

- **Seven new looks** (GLSL on the sphere, `src/show/shaders.ts`): Monolith (cliff-sized slabs in burning fog), Event Horizon (a black hole with its disc wrapping the dome), Tesseract (an endless lattice that folds on every bar), Machine (torn scanlines and red/white industrial noise), Starman (chrome stardust and prism sweeps), Sand Sea (desert horizon and a storm wall), Logogram (circular ink glyphs blooming in fog), plus a calibration grid. The Round 08 looks are kept for old saved shows but hidden from the menus.
- **Six new soundscapes** synthesised in Web Audio (`src/show/audio.ts`), with new instruments: convolution reverb with a generated impulse, tanh drive, feedback echo, a braam (detuned saws in octaves through a driven, snapping low-pass), trailer impacts, Shepard-Risset rise, toms, FM metal clanks, snare, clap, clock tick, felt piano, filtered note lines, reverse risers, pipe organ and formant voices. Leviathan, Horizon, Machine, Glam, Sandstorm and Glyph each follow the same 44-bar arc as the cues (`partAt`): intro, build with a rise, a hard drop, breakdown, final and outro.
- **Presets** pair each look with its sound, tempo and a contrasting drop look. Cue arcs have six cues (Intro, Build, hard-cut Drop at 1.25 intensity, Breakdown, Final at 1.35, Outro), and each preset has its own modulation matrix.
- Tests: show tests updated and 4 new (presets use only current content, contrasting drops and matrices, unique shader slots and old ids still load, sound arc matches cue bars).

Known limits: the soundscapes are generative (random variation per pass), so no two loops are identical; the shaders are tuned for desktop GPUs and fall back to lower frame rates in software rendering.

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
14. **Candidate buildings**: are there real sites to test? Width, depth, clear height, column grid and floor level for two or three would make the fit check concrete (and show which size each can take).
15. **Product shortlist and pricing**: which lighting, audio and haptics suppliers are in conversation (HOLOPLOT, d&b, L-Acoustics, Powersoft, D-BOX)? Real prices would replace every placeholder cost.
16. **Screen acoustics**: speakers behind the LED need an acoustically transparent screen. Is a perforated or open-frame LED acceptable, or should arrays go above and below the screen instead?
17. **Flagship seats**: motion seats (D-BOX class) cannot fold into telescopic wagons. Should flagship venues favour motion seating or the standing transformation?
18. **Structure**: is there a preferred steel fabricator or a rigging contractor's standard (truss vs RHS vs aluminium)? And is a 20' container the right shipping unit, or is site access by trailer?
19. **Rigging through the screen**: are rigging ports in the LED acceptable for stage-truss chains, or should overhead rigging come only from the building roof and the oculus?
