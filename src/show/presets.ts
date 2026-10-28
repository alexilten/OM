/**
 * Show presets (Round 08): generated ambient video looks (GLSL, see shaders.ts), synthesised soundscapes
 * (see audio.ts) and the one-click shows that pair them with a tempo and a lighting palette.
 * Everything is generated in the browser: no stock media, no licences, sharp at any LED resolution.
 */

export interface VideoPreset {
  id: string;
  label: string;
  /** Index into the fragment shader's look switch. */
  look: number;
}

export interface Soundscape {
  id: string;
  label: string;
  description: string;
}

export interface ShowPreset {
  id: string;
  label: string;
  video: string;
  soundscape: string;
  bpm: number;
  /** Lighting palette (hex), cycled per bar; Round 09 adds content-driven looks. */
  palette: string[];
  description: string;
}

export const VIDEO_PRESETS: VideoPreset[] = [
  { id: 'nebula', label: 'Nebula', look: 0 },
  { id: 'aurora', label: 'Aurora', look: 1 },
  { id: 'ocean', label: 'Ocean caustics', look: 2 },
  { id: 'tunnel', label: 'Geometric tunnel', look: 3 },
  { id: 'cathedral', label: 'Cathedral light', look: 4 },
  { id: 'grid', label: 'Calibration grid', look: 5 },
];

export const SOUNDSCAPES: Soundscape[] = [
  { id: 'drone', label: 'Deep drone', description: 'Low detuned drone and slow pads.' },
  { id: 'bells', label: 'Wind and glass bells', description: 'Airy noise with pentatonic bells on the beat.' },
  { id: 'swell', label: 'Ocean swell', description: 'Surf swells and deep sub pulses, no hard beat.' },
  { id: 'pulse', label: 'Four on the floor', description: 'Kick, hats and bass: a club pulse.' },
  { id: 'choir', label: 'Choir pad', description: 'Slow vocal-like chords with long reverb tails.' },
  { id: 'pink', label: 'Pink-noise sweep', description: 'Calibration noise that steps around the speaker rings.' },
];

export const SHOW_PRESETS: ShowPreset[] = [
  { id: 'deep-space', label: 'Deep Space', video: 'nebula', soundscape: 'drone', bpm: 70, palette: ['#3b5bdb', '#7048e8', '#15aabf'], description: 'Nebula drift, felt-not-heard pulse, cool slow breathing light.' },
  { id: 'aurora', label: 'Aurora', video: 'aurora', soundscape: 'bells', bpm: 80, palette: ['#2f9e44', '#9c36b5', '#20c997'], description: 'Curtains of light across the dome with glass bells.' },
  { id: 'ocean', label: 'Ocean', video: 'ocean', soundscape: 'swell', bpm: 60, palette: ['#1971c2', '#0c8599', '#1864ab'], description: 'Under the surface: caustics, swell and deep sub.' },
  { id: 'pulse', label: 'Pulse', video: 'tunnel', soundscape: 'pulse', bpm: 124, palette: ['#e8590c', '#d6336c', '#f59f00', '#ffffff'], description: 'A beat-synced tunnel and a club pulse; strobe-limited hits.' },
  { id: 'cathedral', label: 'Cathedral', video: 'cathedral', soundscape: 'choir', bpm: 60, palette: ['#ffd8a8', '#ffe066', '#fff4e6'], description: 'Warm light shafts and a choir pad.' },
  { id: 'calibration', label: 'Calibration', video: 'grid', soundscape: 'pink', bpm: 60, palette: ['#ffffff'], description: 'Az/el grid and a pink-noise sweep for checking the room.' },
];

export const getShowPreset = (id: string) => SHOW_PRESETS.find((p) => p.id === id);
export const getVideoPreset = (id: string) => VIDEO_PRESETS.find((p) => p.id === id);

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
