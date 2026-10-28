/**
 * Browser-side file actions. Everything runs locally: rhino3dm's wasm is bundled with the app and
 * no geometry or configuration leaves the machine.
 */
import type { ImmersionAnalysis } from '../engine/immersion';
import wasmUrl from 'rhino3dm/rhino3dm.wasm?url';
import { normalizeConfig } from '../engine/defaults';
import type { VenueConfiguration, VenueModel } from '../engine/types';
import { validateConfig } from '../engine/validate';

function download(bytes: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

let rhinoPromise: Promise<unknown> | null = null;

export async function exportRhinoFile(model: VenueModel, analysis?: ImmersionAnalysis) {
  const [{ default: rhino3dm }, { exportRhino }] = await Promise.all([import('rhino3dm/rhino3dm.module.js'), import('../export/rhino')]);
  rhinoPromise ??= rhino3dm({ locateFile: () => wasmUrl });
  const rh = (await rhinoPromise) as Awaited<ReturnType<typeof rhino3dm>>;
  const { bytes, manifest } = exportRhino(rh, model, { analysis });
  download(bytes as BlobPart, `${slug(model.config.name)}_${stamp()}.3dm`, 'application/octet-stream');
  return manifest;
}

export function saveConfiguration(config: VenueConfiguration) {
  download(JSON.stringify(config, null, 2), `${slug(config.name)}_${stamp()}.omstudio.json`, 'application/json');
}

export async function openConfiguration(file: File): Promise<VenueConfiguration> {
  const parsed = normalizeConfig(JSON.parse(await file.text()));
  if (parsed.schemaVersion !== 1) throw new Error('Unsupported OM Studio configuration version.');
  const errors = validateConfig(parsed).filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));
  return parsed;
}
