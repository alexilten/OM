/**
 * Show presets: generated video looks (GLSL, see shaders.ts), synthesised soundscapes (see audio.ts)
 * and the one-click shows that pair them with a tempo, a lighting palette and a cue arc. Round 11
 * replaced the Round 08 ambient set with cinematic ones; the old looks and sounds stay playable for
 * saved shows but are no longer offered.
 * Everything is generated in the browser: no stock media, no licences, sharp at any LED resolution.
 */

export interface VideoPreset {
  id: string;
  label: string;
  /** Index into the fragment shader's look switch. */
  look: number;
  /** Round 08 looks: still played by saved shows, no longer offered in the menus. */
  legacy?: boolean;
}

export interface Soundscape {
  id: string;
  label: string;
  description: string;
  legacy?: boolean;
}

export interface ShowPreset {
  id: string;
  label: string;
  video: string;
  soundscape: string;
  bpm: number;
  /** Lighting palette (hex), cycled per bar. */
  palette: string[];
  /** The look the Drop and Final cues cut to. */
  drop: string;
  description: string;
}

/**
 * Round 11 looks: cinematic, dark and large-scale rather than ambient screensavers. Each is built for
 * a dome seen from inside: horizons sit on the equator, the forward axis carries the focal event.
 */
export const VIDEO_PRESETS: VideoPreset[] = [
  { id: 'monolith', label: 'Monoliths in the fog', look: 6 },
  { id: 'horizon', label: 'Event horizon', look: 7 },
  { id: 'tesseract', label: 'Folded time lattice', look: 8 },
  { id: 'machine', label: 'Machine glitch', look: 9 },
  { id: 'starman', label: 'Chrome stardust', look: 10 },
  { id: 'sandsea', label: 'Sand sea', look: 11 },
  { id: 'logogram', label: 'Ink logogram', look: 12 },
  { id: 'grid', label: 'Calibration grid', look: 5 },
  { id: 'nebula', label: 'Nebula', look: 0, legacy: true },
  { id: 'aurora', label: 'Aurora', look: 1, legacy: true },
  { id: 'ocean', label: 'Ocean caustics', look: 2, legacy: true },
  { id: 'tunnel', label: 'Geometric tunnel', look: 3, legacy: true },
  { id: 'cathedral', label: 'Cathedral light', look: 4, legacy: true },
];

export const SOUNDSCAPES: Soundscape[] = [
  { id: 'leviathan', label: 'Leviathan', description: 'Sub drone and a throat growl, brass-wall swells every four bars, war drums and impacts in a huge dark room.' },
  { id: 'horizon', label: 'Time dilation', description: 'A ticking clock on the beat, an endlessly rising tone, a heartbeat sub and slow minor swells.' },
  { id: 'machine', label: 'Machine heart', description: 'Distorted kick, crushed snare, metal clanks and a gritty 16th bassline; noise risers every eight bars.' },
  { id: 'glam', label: 'Glam stomp', description: 'Stomp and clap, tambourine, fuzz bass riff and power-chord stabs.' },
  { id: 'sandstorm', label: 'Sandstorm', description: 'Wind, pitch-dropping war drums, a desert-scale vocal lead and sub booms.' },
  { id: 'glyph', label: 'Deep signal', description: 'Whale-like calls in a vast reverb, sparse clicks, reverse swells and a sub floor.' },
  { id: 'pink', label: 'Pink-noise sweep', description: 'Calibration noise that steps around the speaker rings.' },
  { id: 'drone', label: 'Deep drone', description: 'Low detuned drone and slow pads.', legacy: true },
  { id: 'bells', label: 'Wind and glass bells', description: 'Airy noise with pentatonic bells on the beat.', legacy: true },
  { id: 'swell', label: 'Ocean swell', description: 'Surf swells and deep sub pulses, no hard beat.', legacy: true },
  { id: 'pulse', label: 'Four on the floor', description: 'Kick, hats and bass: a club pulse.', legacy: true },
  { id: 'choir', label: 'Choir pad', description: 'Slow vocal-like chords with long reverb tails.', legacy: true },
];

export const SHOW_PRESETS: ShowPreset[] = [
  { id: 'monolith', label: 'Monolith', video: 'monolith', soundscape: 'leviathan', bpm: 60, drop: 'sandsea', palette: ['#c2410c', '#52525b', '#fde68a'], description: 'Slabs the size of cliffs in a burning fog; a brass wall every four bars.' },
  { id: 'event-horizon', label: 'Event Horizon', video: 'horizon', soundscape: 'horizon', bpm: 72, drop: 'tesseract', palette: ['#f59e0b', '#fff7ed', '#1e3a8a'], description: 'A black hole ahead, its disc wrapping the dome; the clock never stops ticking.' },
  { id: 'tesseract', label: 'Tesseract', video: 'tesseract', soundscape: 'horizon', bpm: 90, drop: 'horizon', palette: ['#fbbf24', '#7c2d12', '#e0f2fe'], description: 'An infinite lattice of light that folds on every bar.' },
  { id: 'machine-heart', label: 'Machine Heart', video: 'machine', soundscape: 'machine', bpm: 120, drop: 'machine', palette: ['#dc2626', '#fafafa', '#18181b'], description: 'Industrial: torn scanlines, crushed drums, red and white, strobe-limited hits.' },
  { id: 'starman', label: 'Starman', video: 'starman', soundscape: 'glam', bpm: 132, drop: 'tesseract', palette: ['#e11d48', '#06b6d4', '#facc15'], description: 'Glam stomp under chrome stardust and prism sweeps.' },
  { id: 'sand-sea', label: 'Sand Sea', video: 'sandsea', soundscape: 'sandstorm', bpm: 84, drop: 'monolith', palette: ['#ea580c', '#fbbf24', '#78350f'], description: 'A desert horizon and a storm wall coming in on the drums.' },
  { id: 'logogram', label: 'Logogram', video: 'logogram', soundscape: 'glyph', bpm: 60, drop: 'monolith', palette: ['#d6d3d1', '#44403c', '#0c0a09'], description: 'Circular ink glyphs bloom in white fog; something vast calls back.' },
  { id: 'calibration', label: 'Calibration', video: 'grid', soundscape: 'pink', bpm: 60, drop: 'grid', palette: ['#ffffff'], description: 'Az/el grid and a pink-noise sweep for checking the room.' },
];

export const getShowPreset = (id: string) => SHOW_PRESETS.find((p) => p.id === id);
export const getVideoPreset = (id: string) => VIDEO_PRESETS.find((p) => p.id === id);

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
