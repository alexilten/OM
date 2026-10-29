# Round 06 research: environmental FX, lasers, haptics and emerging technologies

Read on 2026-10-28. Companion to `ROUND_00_RESEARCH.md`; same rules. Every value carries a status:

- **verified**: read from the cited manufacturer or primary document on 2026-10-28.
- **secondary**: from a dealer listing, trade press or a reliable secondary source.
- **estimate**: derived here from the OM geometry or from verified values. The derivation is shown.
- **conceptual**: a design proposal with no product or rule behind it yet.

Nothing here is a safety approval. Lasers, haze, CO2, pyro and flame need the local authority having
jurisdiction (AHJ), a laser safety officer and the venue's fire engineer. OM Studio should report these
rules as **issues**, never claim compliance (master plan risk R9).

The goal of this note is to let the build thread implement each technology as a **generative layer**:
pick a product and a tier, and the engine places units in the right mounting zone of the sphere,
counts them, rolls up power, weight, control channels and consumables, and raises safety issues.

---

## 1. What the OM geometry means for effects

Reference: OM 300 flagship, `R = 13 m`, media 220° × (−7.5° … 72°), floor −1.8 m, 12 rows at 0.3 m risers,
standing capacity 666. Coordinates as in master plan §2 (Z up, origin = sphere centre).

| Fact | Value | Consequence for FX |
|---|---|---|
| Media surface area | `R²·Δθ·(sin φ1 − sin φ0)` = 169 × 3.840 × 1.082 ≈ **702 m²** (estimate) | Almost every line of sight ends on LED. Anything in the air (haze, hanging objects, drones) is seen against the picture. |
| Air volume inside the sphere above the floor | cap of height 14.8 m: `πH²(3R − H)/3` ≈ **5,550 m³** (estimate) | Sizes haze, scent and purge. The open rear (|θ| > 110°) connects it to the hall, so the real volume is larger; treat 5,550 m³ as the show volume. |
| The audience sits in a **bowl** | The floor is the lowest point of a concave shell | Heavier-than-air gases (CO2 from jets, low fog, dry ice) pool in the seating and standing floor. This is the single most important FX safety finding for OM. |
| Crown opening | above φ = 72°: ring radius `R cos 72°` ≈ 4.0 m at z ≈ 12.4 m (estimate) | The natural home for the overhead truss ring (Round 06/07), downward lasers, kinetic winches, IR transmitters and drone anchors. |
| Rear arc | 140° of azimuth behind the audience with no LED | Space for laser projectors, followspots, projectors, haze outlets and tracking cameras without cutting the screen. |
| LED joints | Round 03: wedge gaps up to 52 mm near the top ring for flat cabinets | Possible air path for wind, haze and scent from the plenum (conceptual); vendor-spherical tiles (family 04) are sound-transmissive, which suggests they could be air-permeable too (unknown). |
| Service zone behind the LED | 1.5 m (default `envelope.serviceZone`) | A ring plenum that can carry ducted haze, wind and scent outlets and the hazers themselves. |
| Transformation | 3 min 16 s seated → standing (Round 04) | Haze and scent purges are much slower than the changeover (§3.2), so atmospherics carry over between modes. |

### 1.1 Mounting zones (shared by every FX layer)

Each FX product declares which zones it may use. The engine derives every zone from the configuration,
so effects follow the sphere when it scales (and, after Round 07, hang from its pick-up points).

| Zone id | Geometry (engine frame) | Typical tenants |
|---|---|---|
| `crown` | Truss ring at the top opening: radius `R cos φ1 − 0.5 m`, height `R sin φ1` | lasers (downward is forbidden over audience, see §4), kinetic winches, IR transmitters, drone anchors, house haze outlets, projectors for floor mapping |
| `rearArc` | Arc of radius ≈ `R` at azimuths `θ1 … 360° + θ0`, from top-of-back-row + 3 m up to the building clear height | laser projectors, followspots, tracking cameras, projectors, haze outlets |
| `plenum` | Shell between `R + cabinet depth` and `R + serviceZone`, over the media extent | hazers, ducted wind and scent outlets, subwoofers (Round 06 audio) |
| `lowerRing` | Ring at the bottom media edge `z = R sin φ0` (−1.7 m) down to the floor | low-fog nozzles, floor-level wind, IR transmitters, low-level extraction grilles |
| `seat` | One per seat block, from `SeatRecord` | haptics, seat air/water/scent/heat, seat LEDs, interaction buttons |
| `floor` | Standing floor and wagon decks (Round 04) | haptic floor tiles, floor projection target, low-level CO2 sensors |
| `stage` | `StageDefinition` footprint and lift | CO2 jets, low fog, confetti, holographic gauze, kinetic scenery |

Layer paths: the existing `05_TECHNICAL` group gets new children, created even when empty
(master plan §7): `Atmospherics`, `Lasers`, `Haptics`, `SFX`, `Kinetics`, `Interaction`, `Projection`,
plus `07_ANALYSIS/FX_Safety_Volumes` for the laser exclusion volume, dry zone, gas pooling zone and
drone flight volume.

---

## 2. Shared data model (proposal for the Round 06 catalog)

Fits the existing `SpecValue {value, status, source}` pattern in `src/library`.

```ts
type FxTier = 'off' | 'standard' | 'premium' | 'flagship';
type MountZone = 'crown' | 'rearArc' | 'plenum' | 'lowerRing' | 'seat' | 'floor' | 'stage';

interface FxProduct {
  id: string;                       // 'mdg-theone'
  family: FxFamily;                 // 'haze' | 'lowFog' | 'scent' | 'wind' | 'thermal' | 'water' |
                                    // 'co2' | 'flame' | 'laser' | 'haptic' | 'motionSeat' | 'kinetic' |
                                    // 'projection' | 'holographic' | 'drone' | 'crowdLighting' | 'tracking'
  manufacturer: string; model: string;
  zones: MountZone[];
  powerW: SpecValue; weightKg: SpecValue; envelope: SpecValue<[number, number, number]>;
  control: ('DMX' | 'ArtNet' | 'sACN' | 'audio' | 'IR' | 'proprietary')[];
  dmxChannels?: number;             // feeds a universe count
  consumables?: { kind: string; ratePerHour: SpecValue }[];
  coverage?: SpecValue;             // m³, m², m or seats per unit, depending on family
  hazards: FxHazard[];              // drives validator issues, §8
}

interface FxSystemConfig {          // one per family in VenueConfiguration.fx
  tier: FxTier;
  productId: string;
  density?: number;                 // 0–1 scaler inside the tier
  zones?: MountZone[];              // override the default zones
  options?: Record<string, number | boolean>;
}
```

The generator per family is `place(config, model) → { units: VenueObject[], metrics: Metric[], issues: Issue[] }`.
Units are Rhino blocks with user strings (product, tier, zone, DMX address, circuit) like seats and
cabinets today. Roll-ups go to one `fx` metrics group: unit count, connected power, average power,
weight per zone (for the Round 07 pick-up schedule), DMX/Art-Net universes (`ceil(Σ channels / 512)`),
consumables per show hour.

---

## 3. Environmental FX

### 3.1 Haze

| Product | Data | Status |
|---|---|---|
| MDG theONE (fog/haze, mineral oil + CO2/N2 propellant) | Haze mode: 1,100–1,480 W, 100–250 VAC, 33.5 kg generator, 106 × 76 × 61 cm, **65 ml/h fluid** and 0.35 kg/h gas at max, 308 h per 20 L; fog mode up to 100 m³/min, 1 L/h; DMX + RJ45 ([theONE datasheet](https://goknight.com/content/documentation/Product-data-sheet_theONE.pdf)) | verified |
| MDG ATMe (single high-output hazer, onboard DMX) | Listed by dealers as MDG's dedicated touring hazer ([listing](https://goknight.com/mdg-mdgatme-atme-single-high-output-haze-generator-with-onboard-dmx/)) | secondary |
| Look Solutions Unique 2.1, Antari HZ series, Smoke Factory Data II | Common water/glycol hazers | secondary (names only) |

**Exposure.** The Equity/League study behind the ESTA guidance sets peak levels of **25 mg/m³ for mineral oil
haze** (chronic oil mist 5 mg/m³ 8-h TWA) and **40 mg/m³ for glycol smoke**; glycerin fluids were not covered
([Equity, equipment-based guidelines](https://www.actorsequity.org/resources/Producers/safe-and-sanitary/smoke-and-haze/equipment-based.pdf)).
In that test an MDG Atmosphere took up to 190 s to fall below 25 mg/m³ at 3–6 ft from the outlet, and 0 s at
12 ft or more (verified, same source). So the generator should keep outlets **≥ 3.7 m (12 ft) from any
seat or standing position** (estimate from that table) and favour the plenum and rear arc.

**Fire detection.** Haze trips optical point smoke detectors. Common practice (secondary) is aspirating
detection (VESDA class, [Honeywell VESDA-E](https://securityandfire.honeywell.com/notifier/en-us/browseallcategories/aspirating-smoke-detection/vesda-e/conventional-vesda-e-ves))
with raised thresholds or cue-linked isolation of zones during haze, plus a fire watch while isolated; the
method is the AHJ's call. The layer should therefore:

- add an `07_ANALYSIS` note and an issue when haze is on: "detection strategy required (aspirating or beam,
  isolation procedure)";
- record which detection zones (sphere interior, plenum, rear arc) the haze reaches.

**Haze on an LED dome.** Haze scatters screen light back into the room. On a 700 m² emissive surface this
raises the black level and lowers contrast everywhere at once; it is also drawn into fan-cooled, rear-serviced
cabinets and deposits oil film. No published measurement was found (status: conceptual). Implement haze
density as a parameter with a visible **contrast penalty** in the immersion analysis (flagged conceptual) and
a maintenance note on the LED product (fan-cooled vs fanless).

**Scaling (estimate).**
- Show volume `V` from §1. Units = `ceil(V / Vunit)` with `Vunit` = 3,000 m³ standard, 2,000 m³ premium
  (more even), 1,500 m³ flagship (ducted, zoned). OM 300: 2 / 3 / 4 units.
- Each hazer is paired with a distribution fan; the flagship tier ducts to `n` outlets evenly spaced in the
  plenum ring (`n = 2 × units`) so haze arrives evenly across the dome rather than from one side.
- **Purge.** With well-mixed air `C(t) = C0·e^(−ACH·t/60)`, the time to reduce by a factor `f` is
  `t = 60·ln f / ACH` minutes. At 6 air changes per hour a 20× reduction takes ≈ 30 min; at 12 ACH, 15 min.
  Both exceed the 3 min 16 s transformation, so the layer reports "haze will persist into the next mode".
  The ACH value is an HVAC input (placeholder 6).

| Tier | Haze layer |
|---|---|
| Standard | 1–2 hazers on the rear arc, DMX, fans |
| Premium | Hazers in the plenum, ducted to 4–6 outlets; haze density sensor (nephelometer class) |
| Flagship | Zoned ducted haze (plenum ring + crown), density feedback loop, HVAC purge mode linked to show control |

### 3.2 Low fog and CO2 (heavy gases) — the bowl problem

| Product | Data | Status |
|---|---|---|
| MDG ICE FOG Q | 2,850 W, 208/230 VAC, 113 kg on wheels, 90 ml/min fluid (glycol/water), liquid CO2 cooling: ≈3 L/min low-pressure (70 min per 180 L dewar) or ≈2.77 kg/min high-pressure (≈13 min per 35 kg bottle), 0.5–4.5 µm particles ([MDG](https://www.mdgfog.com/en/ice-fog-q)) | verified |
| MagicFX CO2 Jet | jet up to 8 m (humidity dependent), up to **0.5 kg/s** liquid CO2, 2.85 kg, 20 W, 230 V ([Thomann listing](https://www.thomannmusic.com/magic_fx_co2_jet_i.htm)) | secondary |

Both put CO2 into a venue whose audience sits in the lowest part of a concave shell. One CO2 jet at 0.5 kg/s
for a 2 s burst releases 1 kg ≈ 0.55 m³ of gas. The layer must:

- generate a **gas pooling zone** (`07_ANALYSIS/FX_Safety_Volumes`): the floor and the first rows up to a set
  height (placeholder 1.2 m above the standing floor);
- require **low-level extraction** in the `lowerRing` zone and **CO2 sensors** at seated and standing head
  height (placeholder: one per 50 m² of floor);
- raise an **error** if heavy-gas effects are enabled without low-level extraction, and a warning with the
  total CO2 per show (kg) from the cue count;
- low fog is stage-only by default; in standing mode it may flow onto the floor, flagged as a trip and
  visibility hazard for egress.

### 3.3 Scent

| Approach | Products | Status |
|---|---|---|
| Seat-level micro-dosing | CJ 4DPLEX 4DX seat effects include scent ([4DX](https://en.wikipedia.org/wiki/4DX)) | verified (effect exists; hardware specs not public) |
| Room / HVAC diffusion | ScentAir, Prolitec, Air Aroma (cold-air nebulising into supply air) | secondary (names only, no specs read) |
| Sphere reference | "wind, scent, and fog" listed for *Postcard from Earth* ([Everything Immersive](https://everythingimmersive.com/events/darren-aronofskys-postcard-from-earth)) | secondary |

Room scent can only change as fast as the air changes (§3.1 purge formula), so a room-scale scent cue
lasts tens of minutes. Seat-level dosing is the only way to get several scents in one show. The layer
therefore separates **ambient scent** (HVAC, 1 per air-handling zone, standard tier) from **cue scent**
(seat or row emitters, flagship). Issue rules: scent cue spacing shorter than the clear-down time → warning;
always generate a **sensory opt-out seat zone** (placeholder 10 % of seats, conceptual) with seat effects off.

### 3.4 Wind

- **Seat airflow** (face-directed air jets) is a standard 4DX effect ([4DX](https://en.wikipedia.org/wiki/4DX)) — verified that it exists.
- **Room wind**: effect fans (e.g. Antari AF series, secondary) on the rear arc and lower ring; flagship
  ducted from the plenum through the LED joints or perforated tiles (conceptual: needs the LED vendor's
  air-permeability data, Round 00 R1).
- Scaling (estimate): room wind units = one per 30° of media azimuth on the lower ring (OM 300: 8),
  plus `seat` units per row block in flagship. Wind also moves haze; record that dependency.

### 3.5 Temperature

- **Seat hot air**: 4DX lists "hot air" near the seat ([4DX](https://en.wikipedia.org/wiki/4DX)) — verified that it exists.
- **Radiant heat** (infrared emitters in the crown or rear arc) for "sun" moments; **cold** from CO2 bursts
  (inherits §3.2) or HVAC set-point swings (slow, minutes; conceptual).
- Flagship only for seat heat; radiant heat premium and up. Issue: radiant emitters must not aim at the LED
  face (surface temperature rise unknown).

### 3.6 Water, mist, rain, snow, bubbles

- 4DX near-seat water spray, rain, snow and bubbles are verified effect categories ([4DX](https://en.wikipedia.org/wiki/4DX)).
- Indoor LED fronts are not built for wetting. The layer generates a **dry zone**: no free water, snow or
  bubble fluid within a set distance of the media surface (placeholder 2 m, conceptual) and a check that
  each wet unit's spray cone stays out of it.
- Allowed: seat-level face mist (flagship), stage-zone rain behind a drain tray, snow/bubbles from the
  crown only if the fall footprint misses the dome (in a sphere it nearly always hits, so default off).

### 3.7 Pyro, flame, confetti

- Flame effects before an audience fall under NFPA 160 and pyrotechnics under NFPA 1126 in the US (secondary).
- In a closed LED dome heat, soot and debris land on the screen. Default: **excluded**. Enabling them is an
  explicit override that raises an error-level issue until a distance-to-LED and detection plan is recorded.
- Confetti/streamers: stage-only, flagged for LED cleaning.

---

## 4. Lasers

| Product | Data | Status |
|---|---|---|
| Kvant Clubmax 10 FB4 | 10 W RGB (637/525/445 nm), 40 kpps @ 8°, 60° max scan, **13 kg**, 293 × 168 × 353 mm, 340 VA, FB4 (Ethernet/Art-Net/DMX/ILDA), scan-fail safety, < 20 ms shutter, masking plate, keyed E-stop, EN 60825-1 + FDA, optional **PASS** power/scan monitor for audience scanning ([Kvant](https://www.kvantlasers.sk/products/clubmax-10-fb4)) | verified |
| Kvant Clubmax 2000/3000/6000 FB4 | Smaller/larger output steps of the same family ([spec sheet](https://cdn.shopify.com/s/files/1/2680/6950/files/Clubmax_2000_FB4_technical_specification_sheet.pdf?21667)) | secondary |
| Pangolin Beyond / QuickShow | Show control; Kvant ships QuickShow | verified (bundled software per Kvant page) |

**Rules that become geometry.**
- **US**: any show laser above 5 mW needs an FDA variance; Class 3B/4 cannot be used publicly before it is
  approved. Variance condition 13(a): beams stay **≥ 3.0 m above** and **≥ 2.5 m laterally** from any surface
  where the audience can be. Audience scanning needs a special variance, power measurement and scan-fail
  detection ([lasershowsafety.info, US laws](https://www.lasershowsafety.info/styled/nonstacks/us-laws.html)).
- **Elsewhere** (2014 survey, unofficial): permits in the UK, Germany, Austria, Sweden, Finland; MPE must be
  measured on site where scanning is allowed (Finland quotes MPE as low as 1 mW/cm²); France bans audience
  scanning indoors; the Netherlands commonly keeps beams ≥ 3 m above ground ([audience-scanning survey](https://lasershowsafety.info/styled/nonstacks/audscan.html)). Treat as secondary.

**Laser exclusion volume (generative).** Offset every audience standing surface (stage top, each riser tread,
standing floor, aisles, vomitories) up by 3.0 m and out by 2.5 m. Store it in `07_ANALYSIS/FX_Safety_Volumes`.
For OM 300 the back-row tread is ≈ +1.5 m (11 risers × 0.3 m above −1.8 m, estimate), so beams must stay above ≈ +4.5 m over
the back of the house; over the standing floor (−1.8 m) above +1.2 m.

**Laser canvas metric.** For each projector at position `P` and each sample `S` on the media surface, the beam
`P→S` is legal if the segment never enters the exclusion volume. The share of legal media area is the
laser canvas. Rough check for OM 300 (estimate): screen points above +4.5 m are those above φ ≈ 20.3°, i.e.
`(sin 72° − sin 20.3°)/(sin 72° − sin(−7.5°))` ≈ **56 %** of the media area over the seated house; more over the
stage, where the exclusion top is only ≈ +2.1 m.

**Placement (proposal).** Projectors on the `rearArc` at or above the exclusion top, aimed forward/up; and at
the stage edge aimed up. **Never** in the crown aimed down over the audience unless the audience-scanning flag
(with variance, PASS-type monitor and measured MPE) is set. Count scales with azimuth coverage:
standard 2 (stereo pair, rear arc), premium 4–6 (rear arc + stage), flagship 8–12 incl. crown fans of beams
across the dome.

**Lasers on an LED surface.** Every beam ends on LED, so reflections, camera-sensor damage (broadcast/film
cameras in the house) and any risk to the LED face need checking with the vendor and laser safety officer
(conceptual). Lasers depend on haze for visible beams: laser on + haze off → warning.

---

## 5. Haptics and motion seats

| Product | Data | Status |
|---|---|---|
| Powersoft **Mover** (moving-magnet linear shaker) | **100 W for up to 900 N**, direct-drive version moves the seat base **±15 mm**, inertial version has no offset, down to **5 Hz** with a subharmonic generator; driven by Powersoft Quattrocanali 4-channel class-D amps (1U, 1,200–9,600 W) ([EE World](https://www.eeworldonline.com/las-vegas-sphere-infrasonics-haptics-and-4d-effects/)) | secondary (trade press quoting the manufacturer) |
| Sphere reference | **10,000 of 18,000** seats haptic, **718** Quattrocanali amps, **2,500** channels ([Live Design](https://www.livedesignonline.com/news/sphere-entertainment-partners-powersoft-immersive-sound-and-haptic-seating)) → ≈ **4 seats per channel**, ≈ 3.5 channels per amp (estimate) | verified figures, derived ratios |
| D-BOX **G5** motion actuator | **38.1 mm (1.5 in)** stroke, **114 kg** vertical payload per actuator, **150 W average** (540 W for four), 0–100 Hz, one Haptic Bridge drives up to 4 actuators ([D-BOX G5 spec sheet](https://support.d-box.com/hubfs/knowledge-base/231-914-0009-EN7_D-BOX_G5%20Spec%20Sheet.pdf)) | verified |
| CJ 4DPLEX **4DX** | 3-axis seat motion, sway, leg tickler, vibration, plus near-seat air, water, scent, hot air; room bubbles, fog, wind, strobes, snow, rain ([4DX](https://en.wikipedia.org/wiki/4DX)) | verified (effect list) |
| ButtKicker, Subpac, Woojer | Inertial transducers and wearables | secondary (names only) |
| Ultraleap (mid-air ultrasound haptics) | Halved its workforce in 2024, sold hand tracking and focused on haptics ([invidis](https://invidis.com/sixteen-nine/2024/07/02/ultraleap-halving-workforce-selling-off-hand-tracking-and-focusing-on-haptics-interactive-tech/)) | secondary; small-area (desk-scale) effect, not seat-scale |

**Tiers and scaling (OM 300, 304 seats; power is estimate from verified unit values).**

| Tier | Per seat | Channels | Power | Notes |
|---|---|---|---|---|
| Standard | 1 inertial transducer (bass shaker class) | zoned, 4 seats/channel (Sphere ratio) → 76 | placeholder | Infrasound "feel" only |
| Premium | 1 Mover direct drive (±15 mm) | 1–4 seats/channel → 76–304 | 304 × 100 W = **30.4 kW** connected | Per-row or per-seat effects; 19–76 four-channel amps |
| Flagship | D-BOX-class 2 actuators + seat air/water/scent/heat emitters | 1 bridge per 2 seats | 608 × 150 W = **91 kW average** | Compare: LED dome ≈ 702 m² × 210 W/0.25 m² max ≈ 590 kW (estimate) |

- Seat products must declare the haptic mount (under-seat base vs beam-mounted) because telescopic wagons
  (Round 04) fold seats; flagship motion seats may not fold, which blocks the telescopic standing mode. The
  layer raises an error when `transformation.seating = 'telescopic'` and the haptic product is non-folding.
- **Standing mode: haptic floor.** Sphere's example drives a four-person platform with four direct-drive Movers
  at 5 Hz (EE World, above). Proposal (conceptual): wagon deck tiles of 2 × 2 m with 4 Movers each →
  OM 300 standing floor area ≈ 666 / 2.5 p/m² ≈ 266 m² → ≈ 67 tiles, 268 Movers, ≈ 27 kW.
- Weight per seat and amp rack count go to the electrical and Round 07 schedules.

---

## 6. Emerging technologies

### 6.1 Kinetic elements

| Product | Data | Status |
|---|---|---|
| Kinetic Lights DMX winch | **3 kg** load, 16-bit / **1 mm** repeatable positioning, Art-Net DMX, uniform speed ([ISP Audio](https://www.isp-audio.com/en/new-product/lighting-product/1867-kinetic-lights-winch-led-pixel-prolight-sound-2018)) | secondary |
| EGO Kinetic winches | 3.3, 6, 9, 12 m travel variants ([audioeffetti](https://audioeffetti.com/en/category/special-effects/kinetic-systems/ego-professional-kinwinch-kinetic-9-m-winch-2-in-1-version-rgb-and-pixel-incl-power-and-signal-cables-p13873)) | secondary |
| Heavier automation (Kinesys, TAIT, Stage Technologies) | Hoists and motion control for scenery | secondary (names only) |

Everything that hangs in a sphere hides part of the screen. Proposal: a winch grid inside the crown opening
(spacing placeholder 0.8 m → ≈ 78 winches in the 4 m-radius opening, estimate), each with a **park height**
(out of sight, above φ1) and a **show drop**. The layer reuses the Round 02 ray sampler to report the
**media area hidden** per seat at each drop (warning above a threshold), and registers drops as kinetic
assemblies in the Round 04 timeline so collisions with lasers (§4) and drones (§6.4) are checked.

### 6.2 Projection mapping

On an LED dome, projection is for the non-LED surfaces: the stage, scenic pieces, the rear arc wall and the
standing floor. Brightness has to compete with the dome. Sizing rule (estimate):
`lumens = (π · L · A) / (ρ · η)`, with `L` target floor luminance, `A` area, `ρ` floor reflectance, `η` system
efficiency. For a 266 m² standing floor at 100 cd/m², ρ = 0.8, η = 0.7: ≈ **150,000 lm**, i.e. 4 × 40,000-lm
class laser projectors (Barco UDX / Christie / Panasonic class, secondary) in the crown, plus edge blending.
The KM DYNAVISION dome peaks at 600 cd/m² (Round 00), so a floor at 100 cd/m² is a design choice to show.

### 6.3 Holographic and volumetric displays

| Technique | Products | Fit in a sphere |
|---|---|---|
| Transparent gauze projection | Holotronica Holo-Gauze ([Installation](https://www.installation-international.com/technology/holotronica-unveils-holo-gauze-3d-display-system)) | Stage zone; a fan of 130° seating sees it from wide angles, report the off-axis share. |
| Pepper's ghost (angled foil + hidden source) | Musion class (secondary) | Narrow viewing cone; the generator should compute the share of seats inside it. Conflicts with a 220° screen behind it. |
| Fog / mist screens, holographic fans | FogScreen, Hypervsn class (secondary) | Mist conflicts with the dry zone (§3.6); fans are small props. |
| Haze-volumetric | Lasers or projectors into haze | Comes free with §3.1 and §4. |

Status: conceptual layer, stage zone only, with a viewing-cone metric per seat.

### 6.4 Indoor drones

Verity Studios: Lucie micro-drone **50–58 g**; own indoor positioning ("Kedges" placed around the flight area)
with centimetre accuracy corrected ~1,000 times/s; multi-layer redundancy and a software geofence checked
on each drone; 160 drones in a 2019 Guinness record; Verity has never used nets over audiences
([Live Design interview](https://www.livedesignonline.com/news/inside-job-steve-maassen-vertity-studios-indoor-drones)) — secondary.

Proposal: a **flight volume** = sphere interior minus the laser exclusion volume minus a clearance off the LED
(placeholder 1 m), Kedge anchors on the crown and lower rings, flagship tier only. Shares the obstruction metric
with kinetics.

### 6.5 Audience interaction and tracking

| Product | Data | Status |
|---|---|---|
| PixMob wristbands | IR-controlled from transmitters run by DMX/Art-Net consoles; each transmitter ≈ **100 m** range; arena ≈ 16 transmitters, stadium 32–48; zoned "crowd pixels"; ≈ $5–10 per person ([Architect](https://www.architectmagazine.com/technology/products/when-the-audience-becomes-the-concert-lighting_o)) | secondary |
| BlackTrax (CAST) | Beacons on performers/props feed position to consoles, media and audio ([CAST](https://cast-soft.com/blacktrax-lighting-control-precision-meets-creative-vision/)) | verified (function; no accuracy published) |
| zactrack | Radio-based performer tracking with anchors and trackers; PRO anchor ≈ $8.8k ([dealer](https://goknight.com/zactrack-zac4026770-1-pro-anchor/)) | secondary |
| Seat-integrated | Seat LEDs, response buttons, phone companion apps | conceptual |

Scaling (estimate): IR is line-of-sight, so PixMob-class coverage in OM is set by occlusion, not range. Place 4
transmitters on the crown ring (one per quadrant) plus 2 at the stage; every seat eye point is checked for a
clear line to ≥ 2 transmitters with the existing ray tools. Performer tracking anchors: 6–8 around the stage and
rear arc (placeholder). Crowd cameras for standing mode go on the crown ring; record a privacy notice issue.

---

## 7. Tier summary (what each tier switches on)

| Family | Standard | Premium | Flagship |
|---|---|---|---|
| Haze | 1–2 hazers, rear arc | ducted plenum, 4–6 outlets | zoned, density feedback, HVAC purge link |
| Low fog / CO2 | off | stage low fog + extraction | + CO2 jets, sensors, pooling analysis |
| Scent | ambient (HVAC) | ambient + row emitters | per-seat cue scent |
| Wind | off | room fans, lower ring | + plenum ducted + seat airflow |
| Temperature | off | radiant heat | + seat hot air |
| Water | off | stage rain (drained) | + seat face mist |
| Lasers | 2 (rear arc) | 4–6 (rear arc + stage) | 8–12 incl. crown fans; scanning only with variance flag |
| Haptics | inertial, zoned | Mover direct drive per seat | motion seats + haptic standing floor |
| Kinetics | off | winch grid in crown, small count | full crown grid + heavier scenic automation |
| Projection | stage | stage + rear arc | + standing floor mapping |
| Holographic | off | gauze on stage | + volumetric haze |
| Drones | off | off | micro-drone swarm |
| Interaction | phone app | wristbands + IR | + performer tracking + seat LEDs/buttons |

---

## 8. Validator rules (become `Issue`s)

| # | Rule | Level |
|---|---|---|
| F1 | A laser beam path or scan zone enters the laser exclusion volume without the audience-scanning flag | error |
| F2 | Lasers on, haze off | warning |
| F3 | Haze on: detection strategy (aspirating/beam, isolation, fire watch) not recorded | warning |
| F4 | Haze or scent outlet within 3.7 m of an audience position | warning |
| F5 | CO2 jets or low fog on without low-level extraction and CO2 sensors | error |
| F6 | Wet unit's spray cone enters the LED dry zone | error |
| F7 | Flame, pyro or confetti on (explicit override required) | error |
| F8 | Kinetic drop or drone volume hides more than the threshold share of media for any seat | warning |
| F9 | Haptic product cannot fold but seating is telescopic | error |
| F10 | Purge time longer than the changeover or the scent cue spacing | info / warning |
| F11 | No sensory opt-out seat zone defined while seat effects are on | warning |
| F12 | Any FX unit outside its declared zones or clashing with the LED structure (after Round 07) | error |

---

## 9. Recommended implementation order

1. **Mounting zones + FX catalog shape** (§1.1, §2) on top of the Round 06 catalog; zone geometry as
   `07_ANALYSIS` objects so designers can see them.
2. **Haptics** (seat-bound, simplest geometry, biggest power number) and **haze** (volume-bound, drives F3/F10).
3. **Laser exclusion volume + laser canvas** (the most valuable analysis; reuses ray sampling).
4. **Heavy-gas pooling + extraction** (safety-critical in a bowl).
5. Wind, scent, temperature, water as seat/zone units with the dry zone.
6. Kinetics, projection, interaction coverage, drones, holographic: placement + obstruction/coverage metrics.
7. Round 07: all crown/rear-arc/plenum units become loads on the structure's pick-up points.

## 10. Open questions for the OM team

1. Which jurisdictions are the first OM sites in? Laser scanning, haze and CO2 rules differ (US variance vs EU).
2. Are fan-cooled LED cabinets acceptable with haze, or must the LED product be fanless/sealed?
3. Is a seated → standing changeover with lingering haze acceptable, or is a faster purge (higher ACH) required?
4. Should flagship seats prioritise motion (D-BOX class, non-folding) or the telescopic standing mode?
5. Can the LED vendor supply air-permeable or perforated tiles for wind/scent/haze from the plenum?
6. Is a sensory-friendly seat zone a product requirement (and how large)?
