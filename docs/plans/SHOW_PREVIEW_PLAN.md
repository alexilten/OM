# OM Studio — Live Show Preview

Plan, revision 1 (2026-10-28). Requested by Alex: media and video on the sphere, audio with soundscape presets, lighting that takes its colour from the content, and one tempo that pulses everything together, so a venue can be judged by a short, cohesive example show rather than by geometry alone. It lives in the **EXPERIENCE** tab.

## 1. Vision

A designer picks a venue, presses play, and sits in any seat watching a show: content wraps the screen, the lighting rig breathes with the picture, the audio comes from the arrays that Round 06 placed, and the haze, beams and seat haptics land on the beat. Swapping the seat, the LED product, the lighting tier or the audio product changes what they see and hear, so the preview becomes a design tool and a sales tool at once.

Success looks like this:

- A first-time user goes from opening the app to a synchronised show in under 30 seconds, using presets only, with nothing uploaded.
- The same user can drop in their own video and track and get a coherent result without touching a setting.
- Every effect is driven by the venue model: the fixtures, speakers, hazers and seats that light up are the real objects from the design, not decoration.
- It runs at 60 fps on a recent laptop and degrades gracefully, never by freezing the editor.

## 2. Experience (EXPERIENCE tab)

The tab has three parts:

- **Left panel, "Show".**
  - Content source: an upload, an ambient preset or the calibration grid.
  - Mapping: whole sphere (equirectangular), dome master (fisheye) or flat canvas. A flat canvas is fitted to the media patch, with a choice of fit, fill or stretch.
  - Audio source: an upload or a soundscape preset.
  - Tempo: detected BPM, tap tempo, ×½ / ×2 and nudge.
  - Look: lighting follows the content, a fixed palette, or off.
  - Intensity sliders for lights, haze and pulse.
  - A Show preset menu that sets all of the above at once.
- **Viewport.**
  - Free orbit, or **From seat**: the selected seat's eye point and field of view, which already exist from Round 02.
  - A beat indicator.
  - Optional overlays showing which fixtures and speakers are active.
- **Bottom transport.** It reuses the Round 04 timeline component, with:
  - Play / pause, position and loop.
  - A beat and bar ruler.
  - A simple **cue list** (Intro, Build, Drop, Outro) that crossfades looks over N bars.
  - **Record clip**, which saves a short WebM of the viewport with its audio for sharing.

Audio only starts after a click, as browsers require, and there is a master volume with a limiter.

## 3. Architecture

The preview is a client-side real-time layer on top of the engine. It reads `VenueModel` (media patch, LED summary, system units, seats). It never writes geometry, and none of it reaches the CAD export.

| Subsystem | Built on | Responsibilities |
|---|---|---|
| **Show clock** | Web Audio `AudioContext.currentTime` as the master clock | Transport, beat grid (BPM, phase, bar), cue playback. Video and lights follow the audio clock, so drift between them cannot accumulate. |
| **Media engine** | `HTMLVideoElement` → `THREE.VideoTexture`; GLSL shaders for presets | Maps content onto the exact media patch, using the same az/el UVs as the calibration grid. Three mapping modes. Shows the LED wall's native pixel count, and offers a pitch-true inspection mode that renders the cabinet pixel grid at close range. |
| **Audio engine** | Web Audio: decoded buffers, synthesised soundscapes, `AnalyserNode` | Playback; bass / mid / high energy and RMS each frame; onset detection. BPM and beat phase are estimated in a Worker by onset-envelope autocorrelation, and tap tempo overrides them. A **virtual-speaker binaural render**: each Round 06 speaker position becomes an HRTF panner relative to the chosen seat, so moving seats changes the image. |
| **Lighting engine** | GPU downsample of the current frame (about 32×16) read back at 15–20 Hz; k-means palette every 0.5 s | **Zone mapping**: each wash fixture takes the colour of the screen region nearest it, ambilight-style. Spots and lasers take the dominant palette colours. Beams are drawn as additive cones whose visibility rises with the Atmospherics system's haze. A small number of real lights tint the audience and floor. |
| **Modulation matrix** | Plain data: source → target × amount × curve | **Sources**: beat, bar, bass / mid / high, RMS, content brightness and content colour. **Targets**: video brightness, speed and shader parameters; light intensity, colour, movement and strobe; haze level; haptic pulse (seats glow on the heatmap layer); LED global intensity. |
| **Effects bus** | Events from the matrix | Drives the Round 06 system units by id (fixture `sys.lighting.fx-spot.12`), so the preview always shows what the design actually contains. |

### Data and storage

- A `ShowDefinition` is saved with each alternative. It holds the preset ids, mapping, tempo settings, the modulation matrix and the cue list. It is small JSON, versioned like the venue configuration.
- Uploaded media never leaves the browser. Files play from object URLs and can be cached in IndexedDB on that machine. The repo and Pages site are public, so nothing user-supplied is uploaded or committed.
- The fixtures placed in Round 06 get a conceptual **DMX patch** (universe and address). Later, this lets a cue list export towards real control (sACN / Art-Net, a lighting desk or a media server) and accept MIDI clock or OSC tempo from a DAW through Web MIDI.

## 4. Presets

Ambient video presets are **generated GLSL shaders, not stock clips**. They are licence-clean, a few kilobytes each, sharp at any LED resolution, and natively beat-addressable. A handful of CC0 clips can be added later if wanted.

| Show preset | Video (shader) | Soundscape (synthesised) | Tempo | Lighting look |
|---|---|---|---|---|
| Deep Space | Nebula and slow star drift | Low drone, shimmering pads | 70 BPM, felt not heard | Cool zone-follow, slow breathe |
| Aurora | Curtains of light across the dome | Wind, glass bells | 80 | Green / violet palette, soft haze |
| Ocean | Caustics seen from below the surface | Swell, deep sub pulses | No beat (swell-driven) | Blue zone-follow, haze high |
| Pulse | Geometric tunnel, beat-synced zoom | Four-on-the-floor techno | 124 | Strobe-limited hits on the beat, lasers on bar 4 |
| Cathedral | Slow architectural light shafts | Choir pad, reverb | 60 | Warm white beams through haze |
| Calibration | Az/el grid | Pink noise sweep around the speakers | None | Static white |

## 5. Safety, honesty and performance

- **Photosensitivity**: flashes are capped at 3 per second, following WCAG 2.3.1 and Harding-style limits, with a large red-flash guard. There is a reduced-motion switch, and the OS reduced-motion setting is respected.
- **Hearing**: a limiter on the master output, a sensible default level, and no autoplay.
- **Representational, not predictive**:
  - The screen is shown in display colour, not calibrated nits.
  - The audio is a binaural sketch from speaker positions, not an acoustic simulation. Real coverage comes from the manufacturer's tools: HOLOPLOT Plan, d&b ArrayCalc / Soundscape, L-Acoustics Soundvision.
  - Beams are artistic.
  - The UI says all of this in one line.
- **Performance budget**:
  - 60 fps on a 2023 laptop at 1080p.
  - In preview, the LED cabinets collapse to one textured patch, and seats and blocks freeze into static instances.
  - Colour readback runs at 20 Hz or less, and BPM analysis runs off the main thread.
  - Quality steps down automatically: resolution scale, then beams, then real lights.
  - The editor stays responsive. Leaving the tab stops the show and frees the video and audio.

## 6. Roadmap placement

The preview depends on the Round 06 fixtures and speakers. It also benefits from the Round 07 structure, which shows what is behind a perforated or acoustically open screen. It is large enough for two rounds.

| Round | Scope | Acceptance |
|---|---|---|
| **06** Catalog & immersion systems *(in progress)* | Tiered fit-out; lighting, audio, haptics, atmospherics and tracking as layers with tier, density and product | Units are placed, counted and costed; layers are exported to Rhino. Every fixture and speaker has a stable id that the preview can address. |
| **07** LED support structure | Generative ribs, ring girders, brackets, splices, shippable segments, pick-up points carrying audio and lighting loads | Loads from Round 06 units appear in the pick-up schedule; segments respect shipping limits |
| **08** Live Show Preview I: media, audio, clock | EXPERIENCE tab; upload and shader presets on the sphere (3 mappings); From-seat view; audio upload and soundscapes; BPM detection and tap; virtual-speaker binaural render; transport | A 4K equirectangular clip and a track play in sync within one frame for 10 minutes. Detected BPM is within 2% on reference tracks. Seat changes move the audio image. 60 fps budget met. |
| **09** Live Show Preview II: light and harmony | Content-driven lighting (zone and palette); beams in haze; modulation matrix; show presets; cue list with crossfades; haptic and haze visualisation; clip recording; flash-safety limiter | Wash colours track the adjacent screen region within 100 ms. Every preset runs from one click. Flash limiter verified. Recorded clip plays back with audio. |
| **10** CAD deliverables | CSV schedules, DXF, GLB, PDF sheets, every state | The validator covers every state |
| **11** Optimisation | Reverse configuration, immersion-driven search, comparison dashboards | Deterministic, explainable proposals |

The research on immersive effects running in a separate thread (haze, lasers, haptics, emerging tech) feeds the Round 09 effect targets and the atmospherics and haptics catalog.

## 7. Open questions and risks

1. **Codecs**: H.264 and VP9 play everywhere. HEVC and ProRes do not play in most browsers, so large masters need a transcode first. Very large equirect files (8K and up) may exceed GPU texture limits, so the preview downsamples and shows the native-resolution maths separately.
2. **Stagework parity**: which Stagework features mattered most (media library, timeline, live input)? Sharing a screen recording would let us match its feel.
3. **Content rights**: uploads stay local. If OM wants shareable demo shows on the public site, they need content OM owns or CC0 content.
4. **Real control**: is a path to a real lighting desk or media server (Disguise, grandMA, Resolume) wanted? It changes how much effort goes into the DMX patch and cue export.
5. **Risk, audio/video sync on mobile Safari**: autoplay and decode limits differ there. Desktop is the target, and mobile is best-effort.
