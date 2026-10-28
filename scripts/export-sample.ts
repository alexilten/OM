/**
 * Generates the validation file from a configuration and writes the .3dm + manifest.
 *
 *   npm run export:sample                       # OM 300 / Flagship
 *   npm run export:sample -- my-config.json     # any saved OM Studio configuration
 *
 * Writes the seated state and, when the venue transforms, the standing state too.
 * Then: npm run validate:3dm -- exports/<name>.3dm
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import rhino3dm from 'rhino3dm/rhino3dm.module.js';
import { normalizeConfig, OM_300_FLAGSHIP } from '../src/engine/defaults';
import { analyzeImmersion } from '../src/engine/immersion';
import { generateVenue } from '../src/engine/model';
import type { VenueConfiguration } from '../src/engine/types';
import { exportRhino } from '../src/export/rhino';

const arg = process.argv[2];
const config: VenueConfiguration = arg ? normalizeConfig(JSON.parse(readFileSync(resolve(arg), 'utf8'))) : OM_300_FLAGSHIP;
const model = generateVenue(config);
const rh = await rhino3dm();
const analysis = analyzeImmersion(model, config.analysis);
const outDir = resolve('exports');
mkdirSync(outDir, { recursive: true });
for (const state of model.transformation ? (['seated', 'standing'] as const) : (['seated'] as const)) {
  const { bytes, manifest } = exportRhino(rh, model, { analysis, state });
  const base = resolve(outDir, `${config.id}_round04${state === 'standing' ? '_standing' : ''}`);
  writeFileSync(`${base}.3dm`, bytes);
  writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${base}.3dm (${state}, ${(bytes.length / 1024).toFixed(0)} KB, ${manifest.objectCount} objects, ${manifest.seatCount} seats${state === 'seated' ? `, immersion avg ${analysis.average.toFixed(2)}` : ''})`);
}
