/**
 * Project store (Round 05): a project is a list of design alternatives, each a full configuration.
 * Alternatives are compared by regenerating them, never by storing results, so a saved project
 * always reproduces its geometry.
 */
import { normalizeConfig } from './defaults';
import type { VenueConfiguration } from './types';
import { validateConfig } from './validate';

export const PROJECT_SCHEMA = 'om-studio/project@1';

export interface ProjectFile {
  schema: typeof PROJECT_SCHEMA;
  activeId: string;
  alternatives: VenueConfiguration[];
}

/** `base`, or `base-2`, `base-3`… whichever is not taken. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = base.replace(/-\d+$/, '');
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const stem = base.replace(/ \(\d+\)$/, '');
  for (let n = 2; ; n++) if (!used.has(`${stem} (${n})`)) return `${stem} (${n})`;
}

/** Adds `config` as a new alternative with an id and name no other alternative uses; returns its id. */
export function addAlternative(p: ProjectFile, config: VenueConfiguration, after?: string): { project: ProjectFile; id: string } {
  const c = normalizeConfig(config);
  c.id = uniqueId(c.id, p.alternatives.map((a) => a.id));
  c.name = uniqueName(c.name, p.alternatives.map((a) => a.name));
  const i = after ? p.alternatives.findIndex((a) => a.id === after) : -1;
  const alternatives = [...p.alternatives];
  alternatives.splice(i >= 0 ? i + 1 : alternatives.length, 0, c);
  return { project: { ...p, alternatives, activeId: c.id }, id: c.id };
}

export function duplicateAlternative(p: ProjectFile, id: string): { project: ProjectFile; id: string } {
  const src = p.alternatives.find((a) => a.id === id);
  if (!src) throw new Error(`No alternative ${id}`);
  return addAlternative(p, { ...src, name: `${src.name} (copy)` }, id);
}

export function removeAlternative(p: ProjectFile, id: string): ProjectFile {
  if (p.alternatives.length <= 1) return p;
  const i = p.alternatives.findIndex((a) => a.id === id);
  const alternatives = p.alternatives.filter((a) => a.id !== id);
  const activeId = p.activeId === id ? alternatives[Math.max(0, i - 1)].id : p.activeId;
  return { ...p, alternatives, activeId };
}

export function replaceAlternative(p: ProjectFile, config: VenueConfiguration): ProjectFile {
  return { ...p, alternatives: p.alternatives.map((a) => (a.id === config.id ? config : a)) };
}

/** Reads a project, migrating each configuration; invalid alternatives are dropped and named. */
export function parseProject(raw: unknown): { project: ProjectFile; dropped: string[] } {
  const r = raw as Partial<ProjectFile>;
  if (r?.schema !== PROJECT_SCHEMA || !Array.isArray(r.alternatives)) throw new Error('Not an OM Studio project.');
  const dropped: string[] = [];
  const alternatives: VenueConfiguration[] = [];
  for (const a of r.alternatives) {
    try {
      const c = normalizeConfig(a);
      if (validateConfig(c).some((i) => i.severity === 'error') || alternatives.some((x) => x.id === c.id)) throw new Error();
      alternatives.push(c);
    } catch {
      dropped.push((a as VenueConfiguration)?.name ?? 'unnamed');
    }
  }
  if (!alternatives.length) throw new Error('The project has no valid alternatives.');
  const activeId = alternatives.some((a) => a.id === r.activeId) ? r.activeId! : alternatives[0].id;
  return { project: { schema: PROJECT_SCHEMA, activeId, alternatives }, dropped };
}
