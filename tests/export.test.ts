import rhino3dm from 'rhino3dm/rhino3dm.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { OM_300_FLAGSHIP } from '../src/engine/defaults';
import { analyzeImmersion } from '../src/engine/immersion';
import { LAYERS, rhinoLayerPath } from '../src/engine/layers';
import { generateVenue } from '../src/engine/model';
import { exportRhino, type Rhino } from '../src/export/rhino';

let rh: Rhino;
beforeAll(async () => {
  rh = await rhino3dm();
});

describe('Rhino export', () => {
  it('writes a readable .3dm with layers, blocks, metadata and exact media geometry', () => {
    const model = generateVenue(OM_300_FLAGSHIP);
    const { bytes, manifest } = exportRhino(rh, model);
    const doc = rh.File3dm.fromByteArray(bytes);

    expect(doc.settings().modelUnitSystem).toBe(rh.UnitSystem.Meters);

    const paths = new Set<string>();
    for (let i = 0; i < doc.layers().count; i++) paths.add(doc.layers().get(i).fullPath);
    for (const l of LAYERS) expect(paths.has(rhinoLayerPath(l.path))).toBe(true);

    const top = [];
    for (let i = 0; i < doc.objects().count; i++) {
      const o = doc.objects().get(i);
      if (!o.attributes().isInstanceDefinitionObject) top.push(o);
    }
    expect(top.length).toBe(model.objects.length);
    expect(manifest.seatCount).toBe(model.seats.length);
    expect(doc.instanceDefinitions().count).toBe(model.blocks.length);

    const media = top.find((o) => o.attributes().getUserString('om.object_id') === 'media.ideal')!;
    const brep = media.geometry() as InstanceType<Rhino['Brep']>;
    const srf = brep.surfaces().get(0);
    const R = OM_300_FLAGSHIP.sphere.radius;
    const [u0, u1] = srf.domain(0);
    const [v0, v1] = srf.domain(1);
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const p = srf.pointAt(u0 + ((u1 - u0) * i) / 10, v0 + ((v1 - v0) * j) / 10);
        expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(R, 9);
      }

    const seat = top.find((o) => o.attributes().getUserString('om.object_id') === 'seat.A.01')!;
    expect(seat.attributes().getUserString('om.row')).toBe('A');
    expect(seat.attributes().getUserString('om.configuration_id')).toBe(OM_300_FLAGSHIP.id);

    const strings = doc.strings();
    let json = '';
    for (let i = 0; i < strings.count; i++) {
      const entry = strings.get(i) as unknown as [string, string] | { key: string; value: string };
      const [k, v] = Array.isArray(entry) ? entry : [entry.key, entry.value];
      if (k === 'om.configuration') json = v ?? strings.getvalue(i);
    }
    const embedded = JSON.parse(json);
    expect(embedded).toEqual(OM_300_FLAGSHIP);
  });

  it('adds immersion scores to seats and sightlines to 07_ANALYSIS when given an analysis', () => {
    const model = generateVenue(OM_300_FLAGSHIP);
    const analysis = analyzeImmersion(model);
    const { bytes, manifest } = exportRhino(rh, model, { analysis });
    const doc = rh.File3dm.fromByteArray(bytes);
    let rays = 0;
    let targets = 0;
    let scored = 0;
    for (let i = 0; i < doc.objects().count; i++) {
      const a = doc.objects().get(i).attributes();
      if (a.isInstanceDefinitionObject) continue;
      const layer = a.getUserString('om.layer');
      if (layer === '07_ANALYSIS/Sightline_Rays') rays++;
      if (layer === '07_ANALYSIS/Viewing_Targets') targets++;
      if (a.getUserString('om.category') === 'Seat') {
        const id = a.getUserString('om.object_id');
        expect(Number(a.getUserString('om.immersion_score'))).toBeCloseTo(analysis.seats.get(id)!.score, 4);
        expect(a.getUserString('om.immersion_grade')).toBe(analysis.seats.get(id)!.grade);
        scored++;
      }
    }
    expect(rays).toBe(model.seats.length);
    expect(targets).toBe(1);
    expect(scored).toBe(model.seats.length);
    expect(manifest.immersion?.premiumCount).toBe(analysis.premiumCount);
  });

  it('writes spherical LED tiles as exact sphere patches', () => {
    const c = JSON.parse(JSON.stringify(OM_300_FLAGSHIP));
    c.led.productId = 'om-custom-modular-sphere';
    c.led.extent = 'band';
    const model = generateVenue(c);
    const { bytes, manifest } = exportRhino(rh, model);
    const doc = rh.File3dm.fromByteArray(bytes);
    let tiles = 0;
    for (let i = 0; i < doc.objects().count; i++) {
      const o = doc.objects().get(i);
      if (o.attributes().getUserString('om.category') !== 'LEDTile') continue;
      tiles++;
      const srf = (o.geometry() as InstanceType<Rhino['Brep']>).surfaces().get(0);
      const [u0, u1] = srf.domain(0);
      const [v0, v1] = srf.domain(1);
      const p = srf.pointAt((u0 + u1) / 2, (v0 + v1) / 2);
      expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(c.sphere.radius, 9);
    }
    expect(tiles).toBe(manifest.led!.count);
  });

  it('exports the standing state with every moved object one path length away and the stage lowered', () => {
    const model = generateVenue(OM_300_FLAGSHIP);
    const tr = model.transformation!;
    const { bytes, manifest } = exportRhino(rh, model, { state: 'standing' });
    expect(manifest.state).toBe('standing');
    expect(manifest.transformation!.assemblies).toHaveLength(tr.assemblies.length);
    const doc = rh.File3dm.fromByteArray(bytes);
    const travel = new Map(tr.assemblies.map((a) => [a.id, a.travel]));
    let moved = 0;
    for (let i = 0; i < doc.objects().count; i++) {
      const a = doc.objects().get(i).attributes();
      const off = a.getUserString('om.pose_offset');
      if (!off) continue;
      moved++;
      const t = travel.get(tr.memberOf.get(a.getUserString('om.object_id'))!)!;
      off.split(',').forEach((v, k) => expect(Number(v)).toBeCloseTo(t[k], 6));
      expect(a.getUserString('om.operating_state')).toBe('standing');
    }
    expect(moved).toBe(tr.assemblies.filter((a) => a.travel.some((v) => v !== 0)).reduce((n, a) => n + a.memberIds.length, 0));
    expect(manifest.checkpoints.find((c) => c.id === 'stage.main')!.point[2]).toBeCloseTo(OM_300_FLAGSHIP.floor.mainFloorElevation - OM_300_FLAGSHIP.stage.height, 9);
  });
});
