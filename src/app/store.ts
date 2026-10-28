import { create } from 'zustand';
import { cloneConfig, OM_300_FLAGSHIP } from '../engine/defaults';
import { LAYERS } from '../engine/layers';
import { tryGenerateVenue } from '../engine/model';
import { DEFAULT_SECTION, type SectionSettings } from '../engine/section';
import type { Issue, VenueConfiguration, VenueModel } from '../engine/types';
import type { DisplayUnit } from '../engine/units';

export type ViewName = 'iso' | 'top' | 'front' | 'side' | 'audience' | 'reset';
export type MediaDisplay = 'calibration' | 'neutral';
export type Workspace = 'DESIGN' | 'EXPERIENCE' | 'TRANSFORM' | 'ANALYZE' | 'EXPORT';

/** Layers hidden on first load (still exported). */
const HIDDEN_BY_DEFAULT = new Set(['01_MEDIA/LED_Cabinets', '07_ANALYSIS/Eye_Points']);

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
    if (r.model) set({ config, model: r.model, issues: r.issues, invalid: false });
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

    setParam: (path, value) => apply(setPath(get().config, path, value)),
    setParams: (entries) => apply(entries.reduce((c, [p, v]) => setPath(c, p, v), get().config)),
    loadConfig: (c) => {
      apply(cloneConfig(c));
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
    setWorkspace: (workspace) => set({ workspace }),
    setFov: (fov) => set({ fov }),
    requestView: (name) => set({ view: { name, nonce: get().view.nonce + 1 }, seatView: null }),
    viewFromSeat: (seatId) => set({ seatView: seatId ? { seatId } : null }),
  };
});

export const isLayerVisible = (vis: Record<string, boolean>, path: string) => vis[path] !== false && vis[path.split('/')[0]] !== false;
