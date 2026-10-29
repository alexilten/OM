/**
 * Live show preview state (Rounds 08–09). The UI state lives in a small zustand store; the media objects
 * (AudioContext, decoded buffer, video element) live in this module, and `live` carries per-frame
 * values (beat, bands, screen colours, the cue look, modulation) from the render loop to the lights.
 * Uploaded files stay in the browser as object URLs: nothing is sent anywhere.
 */
import { create } from 'zustand';
import { ShowAudio, type Bands } from './audio';
import { barTime, cueId, presetCues, sortCues, type Cue, type LightMode, type LiveLook, type ShowLook } from './cues';
import type { ShowDefinition } from './definition';
import { matrixFor, routeId, ZERO_TARGETS, type ModRoute, type TargetValues } from './modulation';
import { getShowPreset, SHOW_PRESETS } from './presets';
import { tapTempo, type MappingMode, type Tempo } from './timing';

export type { LightMode };

type LookKey = 'lights' | 'pulse' | 'haze' | 'intensity';

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
  /** Cues drive the look while playing. */
  cuesOn: boolean;
  cues: Cue[];
  /** Cue playing now (updated by the render loop when it changes). */
  cueIndex: number;
  matrix: ModRoute[];
  recording: boolean;
  /** Last recorded clip, as an object URL to download. */
  clip: { url: string; name: string; seconds: number } | null;
  /** A file a reopened show used that has to be chosen again. */
  missing: string | null;
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
  /** Moves the show clock (s), keeping play or pause. */
  seek: (t: number) => Promise<void>;
  set: (p: Partial<Pick<ShowState, 'volume' | 'reducedMotion' | 'spatial' | 'cuesOn' | LookKey>>) => void;
  addCue: () => void;
  updateCue: (id: string, p: Partial<Omit<Cue, 'id' | 'look'>>) => void;
  removeCue: (id: string) => void;
  /** Stores the current look into a cue. */
  captureCue: (id: string) => void;
  /** Merges look fields into one cue. */
  updateCueLook: (id: string, look: Partial<ShowLook>) => void;
  jumpToCue: (id: string) => Promise<void>;
  addRoute: () => void;
  updateRoute: (id: string, p: Partial<Omit<ModRoute, 'id'>>) => void;
  removeRoute: (id: string) => void;
  setRecording: (on: boolean) => void;
  setClip: (clip: ShowState['clip']) => void;
  /** Loads a saved show (or the default when the alternative has none). */
  load: (def: ShowDefinition | undefined) => void;
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
  /** Fractional bars since the downbeat. */
  barPos: 0,
  /** 0–1 pulse at the safe subdivision, already scaled by the pulse depth. */
  pulse: 0,
  bands: { bass: 0, mid: 0, high: 0, rms: 0 } as Bands,
  /** Screen colour by azimuth sector (8 sectors across the media), linear 0–1 RGB. */
  zones: Array.from({ length: 8 }, () => [0.5, 0.5, 0.5] as [number, number, number]),
  average: [0.5, 0.5, 0.5] as [number, number, number],
  /** The look in force (from the cues or the panel). */
  look: null as LiveLook | null,
  /** Modulation outputs, −1…1. */
  mod: { ...ZERO_TARGETS } as TargetValues,
  /** Strobe level 0–1 (only ever set through the flash guard). */
  strobe: 0,
};

const first = SHOW_PRESETS[0];

/** The panel's look (what the sliders show). */
export const panelLook = (s: ShowState): ShowLook => ({ video: s.video.kind === 'preset' ? s.video.id : 'monolith', palette: s.palette, lights: s.lights, pulse: s.pulse, haze: s.haze, intensity: s.intensity });

export function toDefinition(s: ShowState): ShowDefinition {
  return {
    version: 1,
    presetId: s.presetId,
    video: s.video.kind === 'preset' ? s.video.id : (s.cues[0]?.look.video ?? 'monolith'),
    ...(s.video.kind === 'file' ? { videoFile: s.video.name } : {}),
    mapping: s.mapping,
    soundscape: s.audio.kind === 'preset' ? s.audio.id : 'leviathan',
    ...(s.audio.kind === 'file' ? { audioFile: s.audio.name } : {}),
    bpm: s.tempo.bpm,
    offset: s.tempo.offset,
    palette: s.palette,
    lights: s.lights,
    pulse: s.pulse,
    haze: s.haze,
    intensity: s.intensity,
    cuesOn: s.cuesOn,
    cues: s.cues,
    matrix: s.matrix,
  };
}

export const useShow = create<ShowState>((set, get) => {
  const restart = async (from?: number) => {
    const s = get();
    if (!s.playing) return;
    const a = getAudio();
    if (s.audio.kind === 'file' && buffer) await a.play({ buffer }, from);
    else await a.play({ soundscape: s.audio.kind === 'preset' ? s.audio.id : 'leviathan', tempo: s.tempo }, from);
  };
  const syncVideo = (t: number) => {
    if (video && video.duration) video.currentTime = t % video.duration;
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
    cuesOn: true,
    cues: presetCues(first),
    cueIndex: 0,
    matrix: matrixFor(first.id),
    recording: false,
    clip: null,
    missing: null,
    busy: null,
    error: null,
    taps: [],

    applyPreset: (id) => {
      const p = getShowPreset(id);
      if (!p) return;
      set({
        presetId: id,
        video: { kind: 'preset', id: p.video },
        audio: { kind: 'preset', id: p.soundscape },
        tempo: { bpm: p.bpm, offset: 0 },
        tempoSource: 'preset',
        confidence: null,
        palette: p.palette,
        cues: presetCues(p),
        cueIndex: 0,
        matrix: matrixFor(id),
        missing: null,
        error: null,
      });
      void restart();
    },
    setVideoPreset: (id) => {
      set({ video: { kind: 'preset', id }, presetId: null });
      // With cues running, the change goes into the cue playing now.
      const s = get();
      if (s.cuesOn && s.cues[s.cueIndex]) get().updateCueLook(s.cues[s.cueIndex].id, { video: id });
    },
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
      set({ video: { kind: 'file', name: file.name, url }, presetId: null, error: null, missing: null });
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
        set({ audio: { kind: 'file', name: file.name }, tempo: { bpm: tempo.bpm, offset: tempo.offset }, tempoSource: 'detected', confidence: tempo.confidence, presetId: null, busy: null, missing: null });
        await restart(0);
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
        syncVideo(a.time());
        void video.play();
      }
    },
    stop: () => {
      audio?.stop();
      audio?.seekTo(0);
      video?.pause();
      if (video) video.currentTime = 0;
      set({ playing: false, time: 0, recording: false });
    },
    seek: async (t) => {
      const to = Math.max(0, t);
      const a = getAudio();
      if (get().playing) await restart(to);
      else a.seekTo(to);
      syncVideo(to);
      set({ time: to });
    },
    set: (p) => {
      set(p);
      if (p.volume !== undefined) getAudio().setVolume(p.volume);
      const s = get();
      const look: Partial<ShowLook> = {};
      for (const k of ['lights', 'pulse', 'haze', 'intensity'] as const) if (p[k] !== undefined) (look as Record<string, unknown>)[k] = p[k];
      if (Object.keys(look).length && s.cuesOn && s.cues[s.cueIndex]) get().updateCueLook(s.cues[s.cueIndex].id, look);
    },
    addCue: () => {
      const s = get();
      const last = s.cues.reduce((m, c) => Math.max(m, c.bar), -8);
      const bar = Math.max(last + 8, Math.ceil(live.barPos));
      const cue: Cue = { id: cueId(), name: `Cue ${s.cues.length + 1}`, bar, fadeBars: 2, look: panelLook(s) };
      set({ cues: sortCues([...s.cues, cue]) });
    },
    updateCue: (id, p) => set({ cues: sortCues(get().cues.map((c) => (c.id === id ? { ...c, ...p } : c))) }),
    removeCue: (id) => set({ cues: get().cues.filter((c) => c.id !== id), cueIndex: 0 }),
    captureCue: (id) => set({ cues: get().cues.map((c) => (c.id === id ? { ...c, look: panelLook(get()) } : c)) }),
    jumpToCue: async (id) => {
      const c = get().cues.find((x) => x.id === id);
      if (!c) return;
      // Land just after the fade so the cue shows as stored.
      await get().seek(barTime(c.bar, get().tempo));
      const l = c.look;
      set({ video: get().video.kind === 'file' ? get().video : { kind: 'preset', id: l.video }, palette: l.palette, lights: l.lights, pulse: l.pulse, haze: l.haze, intensity: l.intensity });
    },
    addRoute: () => set({ matrix: [...get().matrix, { id: routeId(), source: 'beat', target: 'lights.intensity', amount: 0.5, curve: 'linear' }] }),
    updateRoute: (id, p) => set({ matrix: get().matrix.map((r) => (r.id === id ? { ...r, ...p } : r)) }),
    removeRoute: (id) => set({ matrix: get().matrix.filter((r) => r.id !== id) }),
    setRecording: (recording) => set({ recording }),
    setClip: (clip) => {
      const old = get().clip;
      if (old) URL.revokeObjectURL(old.url);
      set({ clip });
    },
    load: (def) => {
      get().stop();
      const p = getShowPreset(def?.presetId ?? first.id) ?? first;
      if (!def) {
        set({ presetId: p.id, video: { kind: 'preset', id: p.video }, audio: { kind: 'preset', id: p.soundscape }, tempo: { bpm: p.bpm, offset: 0 }, tempoSource: 'preset', confidence: null, palette: p.palette, mapping: 'canvas', lights: 'follow', pulse: 0.6, haze: 0.4, intensity: 1, cuesOn: true, cues: presetCues(p), cueIndex: 0, matrix: matrixFor(p.id), missing: null, error: null });
        return;
      }
      const missing = [def.videoFile, def.audioFile].filter(Boolean).join(' and ');
      set({
        presetId: def.presetId,
        video: { kind: 'preset', id: def.video },
        audio: { kind: 'preset', id: def.soundscape },
        tempo: { bpm: def.bpm, offset: def.offset },
        tempoSource: def.presetId ? 'preset' : 'tap',
        confidence: null,
        palette: def.palette,
        mapping: def.mapping,
        lights: def.lights,
        pulse: def.pulse,
        haze: def.haze,
        intensity: def.intensity,
        cuesOn: def.cuesOn,
        cues: def.cues,
        cueIndex: 0,
        matrix: def.matrix,
        missing: missing ? `This show used ${missing}. Uploads stay on the computer they were chosen on, so choose ${def.videoFile && def.audioFile ? 'them' : 'it'} again; the generated look and soundscape stand in until then.` : null,
        error: null,
      });
    },
    updateCueLook: (id: string, look: Partial<ShowLook>) => set({ cues: get().cues.map((c) => (c.id === id ? { ...c, look: { ...c.look, ...look } } : c)) }),
  };
});
