/**
 * Live show preview state (Round 08). The UI state lives in a small zustand store; the media objects
 * (AudioContext, decoded buffer, video element) live in this module, and `live` carries per-frame
 * values (beat, bands, screen colours) from the render loop to the lights. Uploaded files stay in the
 * browser as object URLs: nothing is sent anywhere.
 */
import { create } from 'zustand';
import { ShowAudio, type Bands } from './audio';
import { getShowPreset, SHOW_PRESETS } from './presets';
import { tapTempo, type MappingMode, type Tempo } from './timing';

export type LightMode = 'follow' | 'palette' | 'off';

export interface ShowState {
  presetId: string | null;
  video: { kind: 'preset'; id: string } | { kind: 'file'; name: string; url: string };
  mapping: MappingMode;
  audio: { kind: 'preset'; id: string } | { kind: 'file'; name: string };
  tempo: Tempo;
  tempoSource: 'preset' | 'detected' | 'tap';
  confidence: number | null;
  palette: string[];
  playing: boolean;
  /** Show time shown in the UI (updated about 10× a second). */
  time: number;
  volume: number;
  intensity: number;
  lights: LightMode;
  /** Beat pulse depth 0–1. */
  pulse: number;
  haze: number;
  reducedMotion: boolean;
  /** Hear the mix from the selected seat through the placed speakers. */
  spatial: boolean;
  busy: string | null;
  error: string | null;
  taps: number[];

  applyPreset: (id: string) => void;
  setVideoPreset: (id: string) => void;
  loadVideo: (file: File) => void;
  setMapping: (m: MappingMode) => void;
  setSoundscape: (id: string) => void;
  loadAudio: (file: File) => Promise<void>;
  setBpm: (bpm: number) => void;
  tap: () => void;
  toggle: () => Promise<void>;
  stop: () => void;
  set: (p: Partial<Pick<ShowState, 'volume' | 'intensity' | 'lights' | 'pulse' | 'haze' | 'reducedMotion' | 'spatial'>>) => void;
}

// ─── Runtime objects ────────────────────────────────────────────────────────

let audio: ShowAudio | null = null;
let buffer: AudioBuffer | null = null;
export const getAudio = () => (audio ??= new ShowAudio());

let video: HTMLVideoElement | null = null;
export function getVideo(): HTMLVideoElement | null {
  return video;
}

/** Per-frame values written by the render loop and read by the lights and the transport. */
export const live = {
  time: 0,
  beat: 0,
  bar: 0,
  /** 0–1 pulse at the safe subdivision, already scaled by the pulse depth. */
  pulse: 0,
  bands: { bass: 0, mid: 0, high: 0, rms: 0 } as Bands,
  /** Screen colour by azimuth sector (8 sectors across the media), linear 0–1 RGB. */
  zones: Array.from({ length: 8 }, () => [0.5, 0.5, 0.5] as [number, number, number]),
  average: [0.5, 0.5, 0.5] as [number, number, number],
};

const first = SHOW_PRESETS[0];

export const useShow = create<ShowState>((set, get) => {
  const restart = async () => {
    const s = get();
    if (!s.playing) return;
    const a = getAudio();
    if (s.audio.kind === 'file' && buffer) await a.play({ buffer });
    else if (s.audio.kind === 'preset') await a.play({ soundscape: s.audio.id, tempo: s.tempo });
  };
  return {
    presetId: first.id,
    video: { kind: 'preset', id: first.video },
    mapping: 'canvas',
    audio: { kind: 'preset', id: first.soundscape },
    tempo: { bpm: first.bpm, offset: 0 },
    tempoSource: 'preset',
    confidence: null,
    palette: first.palette,
    playing: false,
    time: 0,
    volume: 0.7,
    intensity: 1,
    lights: 'follow',
    pulse: 0.6,
    haze: 0.4,
    reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    spatial: false,
    busy: null,
    error: null,
    taps: [],

    applyPreset: (id) => {
      const p = getShowPreset(id);
      if (!p) return;
      set({ presetId: id, video: { kind: 'preset', id: p.video }, audio: { kind: 'preset', id: p.soundscape }, tempo: { bpm: p.bpm, offset: 0 }, tempoSource: 'preset', confidence: null, palette: p.palette, error: null });
      void restart();
    },
    setVideoPreset: (id) => set({ video: { kind: 'preset', id }, presetId: null }),
    loadVideo: (file) => {
      const old = get().video;
      if (old.kind === 'file') URL.revokeObjectURL(old.url);
      const url = URL.createObjectURL(file);
      video?.pause();
      video = document.createElement('video');
      video.src = url;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.onerror = () => set({ error: `This browser cannot play ${file.name}. Try H.264 MP4 or WebM.` });
      if (get().playing) void video.play();
      set({ video: { kind: 'file', name: file.name, url }, presetId: null, error: null });
    },
    setMapping: (mapping) => set({ mapping }),
    setSoundscape: (id) => {
      set({ audio: { kind: 'preset', id }, presetId: null });
      void restart();
    },
    loadAudio: async (file) => {
      set({ busy: `Decoding ${file.name} and finding its tempo…`, error: null });
      try {
        const { buffer: b, tempo } = await getAudio().decode(file);
        buffer = b;
        getAudio().seekTo(0);
        set({ audio: { kind: 'file', name: file.name }, tempo: { bpm: tempo.bpm, offset: tempo.offset }, tempoSource: 'detected', confidence: tempo.confidence, presetId: null, busy: null });
        await restart();
      } catch {
        set({ busy: null, error: `Could not decode ${file.name}. Try MP3, WAV, AAC or OGG.` });
      }
    },
    setBpm: (bpm) => {
      set({ tempo: { ...get().tempo, bpm: Math.max(40, Math.min(220, bpm)) }, tempoSource: 'tap' });
      if (get().audio.kind === 'preset') void restart();
    },
    tap: () => {
      const now = getAudio().time();
      const taps = [...get().taps.filter((t) => now - t < 4), now];
      const tempo = tapTempo(taps);
      set({ taps, ...(tempo ? { tempo, tempoSource: 'tap' as const } : {}) });
    },
    toggle: async () => {
      const a = getAudio();
      if (get().playing) {
        a.stop();
        video?.pause();
        set({ playing: false });
        return;
      }
      set({ playing: true });
      await restart();
      if (video) {
        video.currentTime = a.time() % (video.duration || 1);
        void video.play();
      }
    },
    stop: () => {
      audio?.stop();
      audio?.seekTo(0);
      video?.pause();
      if (video) video.currentTime = 0;
      set({ playing: false, time: 0 });
    },
    set: (p) => {
      set(p);
      if (p.volume !== undefined) getAudio().setVolume(p.volume);
    },
  };
});
