/**
 * Generates the Round 01 validation file from a configuration and writes the .3dm + manifest.
 *
 *   npm run export:sample                       # OM 300 / Flagship
 *   npm run export:sample -- my-config.json     # any saved OM Studio configuration
 *
 * Then: npm run validate:3dm -- exports/<name>.3dm
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import rhino3dm from 'rhino3dm/rhino3dm.module.js';
import { OM_300_FLAGSHIP } from '../src/engine/defaults';
import { generateVenue } from '../src/engine/model';
import type { VenueConfiguration } from '../src/engine/types';
import { exportRhino } from '../src/export/rhino';

const arg = process.argv[2];
const config: VenueConfiguration = arg ? JSON.parse(readFileSync(resolve(arg), 'utf8')) : OM_300_FLAGSHIP;
const model = generateVenue(config);
const rh = await rhino3dm();
const { bytes, manifest } = exportRhino(rh, model);

const outDir = resolve('exports');
mkdirSync(outDir, { recursive: true });
const base = resolve(outDir, `${config.id}_round01`);
writeFileSync(`${base}.3dm`, bytes);
writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${base}.3dm (${(bytes.length / 1024).toFixed(0)} KB, ${manifest.objectCount} objects, ${manifest.seatCount} seats)`);
