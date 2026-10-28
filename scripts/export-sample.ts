/**
 * Generates validation files from a configuration and writes each .3dm + manifest.
 *
 *   npm run export:sample                       # OM 300 / Flagship
 *   npm run export:sample -- my-config.json     # any saved OM Studio configuration
 *   npm run export:sample -- --presets          # the five named venue presets
 *   npm run export:sample -- --packages         # OM 300 with every system on, one file per tier
 *
 * Writes the seated state and, when the venue transforms, the standing state too.
 * Then: npm run validate:3dm -- exports/<name>.3dm
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import rhino3dm from 'rhino3dm/rhino3dm.module.js';
import { cloneConfig, normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { analyzeImmersion } from '../src/engine/immersion';
import { generateVenue } from '../src/engine/model';
import { buildPreset, VENUE_PRESETS } from '../src/engine/presets';
import type { Tier, VenueConfiguration } from '../src/engine/types';
import { exportRhino } from '../src/export/rhino';

const ROUND = 'round06';
const arg = process.argv[2];
const AUDIO_BY_TIER: Record<Tier, string> = { standard: 'l-isa-x8', premium: 'db-soundscape', flagship: 'holoplot-x1' };
const pkg = (tier: Tier): VenueConfiguration => {
  const c = cloneConfig(OM_300_FLAGSHIP);
  c.id = `om-300-${tier}-package`;
  c.name = `OM 300 / ${tier} package`;
  for (const s of Object.values(c.systems)) Object.assign(s, { enabled: true, tier });
  c.systems.audio.product = AUDIO_BY_TIER[tier];
  return c;
};
const configs: VenueConfiguration[] =
  arg === '--presets'
    ? VENUE_PRESETS.map((v) => ({ ...buildPreset(v.size, v.performance), id: v.id, name: v.name }))
    : arg === '--packages'
      ? (['standard', 'premium', 'flagship'] as const).map(pkg)
      : [arg ? normalizeConfig(JSON.parse(readFileSync(resolve(arg), 'utf8'))) : OM_300_FLAGSHIP];
const rh = await rhino3dm();
const outDir = resolve('exports');
mkdirSync(outDir, { recursive: true });

for (const config of configs) {
  const model = generateVenue(config);
  const analysis = analyzeImmersion(model, config.analysis);
  for (const state of model.transformation ? (['seated', 'standing'] as const) : (['seated'] as const)) {
    const { bytes, manifest } = exportRhino(rh, model, { analysis, state });
    const base = resolve(outDir, `${config.id}_${ROUND}${state === 'standing' ? '_standing' : ''}`);
    writeFileSync(`${base}.3dm`, bytes);
    writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 2));
    console.log(`Wrote ${base}.3dm (${state}, ${(bytes.length / 1024).toFixed(0)} KB, ${manifest.objectCount} objects, ${manifest.seatCount} seats${state === 'seated' ? `, immersion avg ${analysis.average.toFixed(2)}` : ''}${manifest.building ? `, building ${manifest.building.fits ? 'fits' : 'does not fit'}` : ''})`);
  }
}
