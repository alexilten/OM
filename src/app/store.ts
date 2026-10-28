import { create } from 'zustand';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../engine/defaults';
import { analyzeImmersion, DEFAULT_ANALYSIS, type ImmersionAnalysis } from '../engine/immersion';
import { LAYERS } from '../engine/layers';
import { compareLedProducts, type LedSummary } from '../engine/led';
import { buildPreset } from '../engine/presets';
import { addAlternative, duplicateAlternative, parseProject, PROJECT_SCHEMA, removeAlternative, replaceAlternative, type ProjectFile } from '../engine/project';
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
  /** Every alternative in the project; the active one mirrors `config`. */
  project: ProjectFile;

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
  selectAlternative: (id: string) => void;
  duplicateActive: () => void;
  deleteAlternative: (id: string) => void;
  /** Replaces the active alternative with a preset, keeping its id and building. */
  applyPreset: (size: string, performance: string, name?: string) => void;
  /** Adds a preset as a new alternative (keeping the current building) and switches to it. */
  addPreset: (size: string, performance: string, name?: string) => void;
  /** Adds an opened configuration as a new alternative. */
  addConfig: (c: VenueConfiguration) => void;
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

const STORAGE_KEY = 'om-studio.project';

/** The project saved in this browser, or a fresh one holding the flagship. */
function loadProject(): ProjectFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseProject(JSON.parse(raw)).project;
  } catch {
    // Unreadable or blocked storage: start fresh.
  }
  return { schema: PROJECT_SCHEMA, activeId: OM_300_FLAGSHIP.id, alternatives: [cloneConfig(OM_300_FLAGSHIP)] };
}

const startProject = loadProject();
const startConfig = startProject.alternatives.find((a) => a.id === startProject.activeId)!;
const initial = (() => {
  const r = tryGenerateVenue(startConfig);
  return r.model ? { config: startConfig, ...r } : { config: cloneConfig(OM_300_FLAGSHIP), ...tryGenerateVenue(OM_300_FLAGSHIP) };
})();

/** Timeline position of a configuration's operating state. */
const restT = (m: VenueModel) => (m.config.operatingState === 'standing' ? (m.transformation?.duration ?? 0) : 0);

export const useStudio = create<StudioState>((set, get) => {
  const apply = (config: VenueConfiguration) => {
    const r = tryGenerateVenue(config);
    const project = replaceAlternative(get().project, config);
    if (r.model) {
      // Outside TRANSFORM the venue shows its operating state; inside, the timeline keeps its place.
      const transformT = get().workspace === 'TRANSFORM' ? Math.min(get().transformT, r.model.transformation?.duration ?? 0) : restT(r.model);
      set({ config, model: r.model, issues: r.issues, invalid: false, transformT, project });
    } else set({ config, issues: r.issues, invalid: true, project });
  };
  const switchTo = (project: ProjectFile) => {
    set({ project, selectedId: null, seatView: null, playing: 0 });
    apply(project.alternatives.find((a) => a.id === project.activeId)!);
  };
  return {
    config: initial.config,
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
    transformT: restT(initial.model!),
    playing: 0,
    playRate: 10,
    project: startProject,

    setParam: (path, value) => apply(setPath(get().config, path, value)),
    setParams: (entries) => apply(entries.reduce((c, [p, v]) => setPath(c, p, v), get().config)),
    loadConfig: (c) => {
      apply({ ...normalizeConfig(c), id: get().config.id, analysis: c.analysis ?? DEFAULT_ANALYSIS });
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
    setWorkspace: (workspace) => set({ workspace, heatmap: workspace === 'ANALYZE', ...(workspace === 'TRANSFORM' ? {} : { transformT: restT(get().model), playing: 0 as const }) }),
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
    selectAlternative: (id) => {
      if (id !== get().project.activeId) switchTo({ ...get().project, activeId: id });
    },
    duplicateActive: () => switchTo(duplicateAlternative(get().project, get().project.activeId).project),
    deleteAlternative: (id) => switchTo(removeAlternative(get().project, id)),
    applyPreset: (size, performance, name) => {
      const { config } = get();
      const c = buildPreset(size, performance, config);
      apply({ ...c, id: config.id, name: name ?? c.name });
    },
    addPreset: (size, performance, name) => {
      const c = buildPreset(size, performance, get().config);
      switchTo(addAlternative(get().project, { ...c, name: name ?? c.name }, get().project.activeId).project);
    },
    addConfig: (c) => switchTo(addAlternative(get().project, { ...normalizeConfig(c), analysis: c.analysis ?? DEFAULT_ANALYSIS }).project),
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

// Keep the project in this browser; storage can be unavailable (private windows, previews).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStudio.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(useStudio.getState().project));
    } catch {
      // Not persisted; the session still works.
    }
  }, 400);
});
});
scheduleAnalysis();

// Keep the project in this browser; storage can be unavailable (private windows, previews).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStudio.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(useStudio.getState().project));
    } catch {
      // Not persisted; the session still works.
    }
  }, 400);
});

export const isLayerVisible = (vis: Record<string, boolean>, path: string) => vis[path] !== false && vis[path.split('/')[0]] !== false;
