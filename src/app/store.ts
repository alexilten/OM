import { create } from 'zustand';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../engine/defaults';
import { analyzeImmersion, DEFAULT_ANALYSIS, type ImmersionAnalysis } from '../engine/immersion';
import { LAYERS } from '../engine/layers';
import { compareLedProducts, type LedSummary } from '../engine/led';
import { tryGenerateVenue } from '../engine/model';
import { DEFAULT_SECTION, type SectionSettings } from '../engine/section';
import type { Issue, VenueConfiguration, VenueModel } from '../engine/types';
import type { DisplayUnit } from '../engine/units';

export type ViewName = 'iso' | 'top' | 'front' | 'side' | 'audience' | 'reset';
export type MediaDisplay = 'calibration' | 'neutral';
export type Workspace = 'DESIGN' | 'EXPERIENCE' | 'TRANSFORM' | 'ANALYZE' | 'EXPORT';
export type LedColor = 'product' | 'deviation' | 'joints';
/** Playback direction of the transformation timeline: 1 seated → standing, -1 back, 0 paused. */
export type PlayDirection = -1 | 0 | 1;

/** Layers hidden on first load (still exported). */
const HIDDEN_BY_DEFAULT = new Set(['01_MEDIA/LED_Cabinets', '01_MEDIA/LED_Modules', '07_ANALYSIS/Eye_Points']);
const LED_LAYERS = ['01_MEDIA/LED_Cabinets', '01_MEDIA/LED_Modules'];

export interface SeatView {
  seatId: string;
}

interface StudioState {
  config: VenueConfiguration;
  /** Last model generated from a valid configuration; never replaced by an invalid edit. */
  model: VenueModel;
  /** Issues for the current configuration (including blocking errors if it is invalid). */
  issues: Issue[];
  invalid: boolean;
  units: DisplayUnit;
  section: SectionSettings;
  layerVisible: Record<string, boolean>;
  selectedId: string | null;
  mediaDisplay: MediaDisplay;
  workspace: Workspace;
  fov: number;
  view: { name: ViewName; nonce: number };
  seatView: SeatView | null;
  /** Immersion analysis of `model`; recomputed shortly after the model settles. */
  analysis: ImmersionAnalysis | null;
  heatmap: boolean;
  ledColor: LedColor;
  /** Every library LED product on the current screen; recomputed with the analysis. */
  ledComparison: LedSummary[] | null;
  /** Time on the transformation timeline (s): 0 = seated, duration = standing. */
  transformT: number;
  playing: PlayDirection;
  /** Playback speed relative to real time. */
  playRate: number;

  setParam: (path: string, value: unknown) => void;
  /** Applies several edits as one regeneration (e.g. mirrored azimuths). */
  setParams: (entries: [string, unknown][]) => void;
  loadConfig: (c: VenueConfiguration) => void;
  resetParam: (path: string) => void;
  setUnits: (u: DisplayUnit) => void;
  setSection: (s: Partial<SectionSettings>) => void;
  toggleLayer: (path: string) => void;
  select: (id: string | null) => void;
  setMediaDisplay: (m: MediaDisplay) => void;
  setWorkspace: (w: Workspace) => void;
  setFov: (fov: number) => void;
  requestView: (name: ViewName) => void;
  viewFromSeat: (seatId: string | null) => void;
  setHeatmap: (on: boolean) => void;
  setLedColor: (c: LedColor) => void;
  /** Shows or hides the LED cabinet and module layers together. */
  setLedVisible: (on: boolean) => void;
  setTransformT: (t: number) => void;
  play: (dir: PlayDirection) => void;
  setPlayRate: (rate: number) => void;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setPath<T>(obj: T, path: string, value: unknown): T {
  const copy = cloneConfig(obj as VenueConfiguration) as T;
  const keys = path.split('.');
  let o = copy as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
  return copy;
}

const initial = tryGenerateVenue(OM_300_FLAGSHIP);

export const useStudio = create<StudioState>((set, get) => {
  const apply = (config: VenueConfiguration) => {
    const r = tryGenerateVenue(config);
    if (r.model) set({ config, model: r.model, issues: r.issues, invalid: false, transformT: Math.min(get().transformT, r.model.transformation?.duration ?? 0) });
    else set({ config, issues: r.issues, invalid: true });
  };
  return {
    config: cloneConfig(OM_300_FLAGSHIP),
    model: initial.model!,
    issues: initial.issues,
    invalid: false,
    units: 'm',
    section: DEFAULT_SECTION,
    layerVisible: Object.fromEntries(LAYERS.map((l) => [l.path, !HIDDEN_BY_DEFAULT.has(l.path)])),
    selectedId: null,
    mediaDisplay: 'calibration',
    workspace: 'DESIGN',
    fov: 50,
    view: { name: 'iso', nonce: 0 },
    seatView: null,
    analysis: null,
    heatmap: false,
    ledColor: 'product',
    ledComparison: null,
    transformT: 0,
    playing: 0,
    playRate: 10,

    setParam: (path, value) => apply(setPath(get().config, path, value)),
    setParams: (entries) => apply(entries.reduce((c, [p, v]) => setPath(c, p, v), get().config)),
    loadConfig: (c) => {
      apply({ ...normalizeConfig(c), analysis: c.analysis ?? DEFAULT_ANALYSIS });
      set({ selectedId: null, seatView: null });
    },
    resetParam: (path) => apply(setPath(get().config, path, getPath(OM_300_FLAGSHIP, path))),
    setUnits: (units) => set({ units }),
    setSection: (s) => set({ section: { ...get().section, ...s } }),
    toggleLayer: (path) => {
      const v = { ...get().layerVisible };
      const next = !v[path];
      v[path] = next;
      // Toggling a group applies to its children.
      if (!path.includes('/')) for (const k of Object.keys(v)) if (k.startsWith(`${path}/`)) v[k] = next;
      set({ layerVisible: v });
    },
    select: (selectedId) => set({ selectedId }),
    setMediaDisplay: (mediaDisplay) => set({ mediaDisplay }),
    // Only TRANSFORM shows a moved pose; other workspaces always show the seated state.
    setWorkspace: (workspace) => set({ workspace, heatmap: workspace === 'ANALYZE', ...(workspace === 'TRANSFORM' ? {} : { transformT: 0, playing: 0 as const }) }),
    setFov: (fov) => set({ fov }),
    requestView: (name) => set({ view: { name, nonce: get().view.nonce + 1 }, seatView: null }),
    viewFromSeat: (seatId) => set({ seatView: seatId ? { seatId } : null }),
    setHeatmap: (heatmap) => set({ heatmap, workspace: heatmap ? 'ANALYZE' : 'DESIGN' }),
    setLedColor: (ledColor) => {
      set({ ledColor });
      if (ledColor !== 'product') get().setLedVisible(true);
    },
    setLedVisible: (on) => {
      const v = { ...get().layerVisible };
      for (const l of LED_LAYERS) v[l] = on;
      if (on) v['01_MEDIA'] = true;
      // Tangent faces sit exactly on the ideal surface, which would hide them; show one or the other.
      v['01_MEDIA/Ideal_Spherical_Surface'] = !on;
      set({ layerVisible: v });
    },
    setTransformT: (t) => {
      const d = get().model.transformation?.duration ?? 0;
      set({ transformT: Math.max(0, Math.min(d, t)) });
    },
    play: (playing) => {
      const { transformT, model } = get();
      const d = model.transformation?.duration ?? 0;
      // Playing from an end that has nowhere to go restarts from the other end.
      if (playing === 1 && transformT >= d) set({ transformT: 0 });
      if (playing === -1 && transformT <= 0) set({ transformT: d });
      set({ playing });
    },
    setPlayRate: (playRate) => set({ playRate }),
  };
});

// Analysis takes ~0.1 s for 300 seats (the LED comparison about as long), so run it once the model stops changing (e.g. after a drag).
let analysisTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleAnalysis = () => {
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    const { model } = useStudio.getState();
    useStudio.setState({
      analysis: analyzeImmersion(model, model.config.analysis ?? DEFAULT_ANALYSIS),
      ledComparison: model.config.led.enabled ? compareLedProducts(model.config) : null,
    });
  }, 150);
};
useStudio.subscribe((s, prev) => {
  if (s.model !== prev.model) scheduleAnalysis();
});
scheduleAnalysis();

export const isLayerVisible = (vis: Record<string, boolean>, path: string) => vis[path] !== false && vis[path.split('/')[0]] !== false;
