/**
 * CAD export engine (subsystem 10): VenueModel → Rhino .3dm via McNeel's rhino3dm (openNURBS).
 *
 * The same code runs in the browser (EXPORT RHINO) and in Node (scripts/export-sample.ts), so the
 * file a designer downloads is the file the validator checks.
 *
 * Representation choices:
 *  - Reference sphere: exact Rhino sphere.
 *  - Media surface: exact rational NURBS patch (see engine/nurbs.ts), wrapped in a Brep.
 *  - Edges and datums: exact arcs / circles / lines.
 *  - Tiers: planar arc-and-line profile extruded (Rhino Extrusion).
 *  - Seats, LED cabinets: block definitions + instance references with per-instance user strings.
 */
import type rhino3dmFactory from 'rhino3dm';
import { LAYERS, ROOT_LAYER, rhinoLayerPath } from '../engine/layers';
import { spherePoint } from '../engine/coordinates';
import { analysisObjects, seatAnalysisMetadata, type ImmersionAnalysis } from '../engine/immersion';
import { posedObjects, poseAt } from '../engine/kinetics';
import { spherePatchNurbs } from '../engine/nurbs';
import type { Frame, Geometry, VenueModel, VenueObject } from '../engine/types';

export type Rhino = Awaited<ReturnType<typeof rhino3dmFactory>>;
type GeometryBase = InstanceType<Rhino['GeometryBase']>;
type ObjectAttributes = InstanceType<Rhino['ObjectAttributes']>;

export const EXPORT_SCHEMA = 'om-studio/export@1';

/** Which end of the transformation the geometry shows. Venues without a transformation are always seated. */
export type ExportState = 'seated' | 'standing';

export interface ExportManifest {
  schema: string;
  configurationId: string;
  configurationName: string;
  state: ExportState;
  generatedAt: string;
  units: 'Meters';
  layers: string[];
  objectCount: number;
  countsByLayer: Record<string, number>;
  countsByKind: Record<string, number>;
  blocks: { name: string; instances: number }[];
  seatCount: number;
  led?: {
    productId: string;
    strategy: string;
    count: number;
    unitTypes: number;
    unit: { w: number; h: number; d: number };
    maxDeviation: number;
    coverage: number;
  };
  transformation?: {
    duration: number;
    assemblies: { id: string; kind: string; members: number; travel: [number, number, number]; start: number; duration: number }[];
    conflicts: number;
    standingArea: number;
    standingCapacity: number;
  };
  building?: { width: number; depth: number; clearHeight: number; fits: boolean; maxRadius: number; columns: number; clashes: number };
  systems: {
    units: Record<string, number>;
    guardrailLength: number;
    deckArea: number;
    pickPoints: number;
    pickLoadKg: number;
    powerW: number;
    costUsdPlaceholder: number;
  };
  immersion?: { average: number; premiumCount: number; warningCount: number; gradeCounts: Record<string, number> };
  sphereRadius: number;
  media: { azimuth0: number; azimuth1: number; elevation0: number; elevation1: number };
  checkpoints: { id: string; point: [number, number, number] }[];
}

function frameTransform(rh: Rhino, f: Frame) {
  const t = rh.Transform.identity();
  t.m00 = f.xAxis[0]; t.m01 = f.yAxis[0]; t.m02 = f.zAxis[0]; t.m03 = f.origin[0];
  t.m10 = f.xAxis[1]; t.m11 = f.yAxis[1]; t.m12 = f.zAxis[1]; t.m13 = f.origin[1];
  t.m20 = f.xAxis[2]; t.m21 = f.yAxis[2]; t.m22 = f.zAxis[2]; t.m23 = f.origin[2];
  return t;
}

function nurbsPatch(rh: Rhino, R: number, az0: number, az1: number, el0: number, el1: number) {
  const def = spherePatchNurbs(R, az0, az1, el0, el1);
  const cu = def.points.length;
  const cv = def.points[0].length;
  const s = rh.NurbsSurface.create(3, true, def.degreeU + 1, def.degreeV + 1, cu, cv);
  for (let i = 0; i < cu; i++)
    for (let j = 0; j < cv; j++) {
      const [x, y, z] = def.points[i][j];
      const w = def.weights[i][j];
      // rhino3dm expects homogeneous control points (x·w, y·w, z·w, w).
      s.points().set(i, j, [x * w, y * w, z * w, w]);
    }
  const ku = s.knotsU();
  def.knotsU.forEach((k, i) => ku.set(i, k));
  const kv = s.knotsV();
  def.knotsV.forEach((k, i) => kv.set(i, k));
  if (!s.isValid) throw new Error('Media surface NURBS is invalid');
  return s;
}

/** Converts a neutral geometry descriptor into rhino3dm geometry (block instances excluded). */
export function toRhinoGeometry(rh: Rhino, g: Geometry): GeometryBase {
  switch (g.kind) {
    case 'point':
      return new rh.Point(g.p);
    case 'line':
      return new rh.LineCurve(g.a, g.b);
    case 'polyline': {
      const pts = g.closed ? [...g.points, g.points[0]] : g.points;
      return new rh.PolylineCurve(pts);
    }
    case 'circle': {
      if (Math.abs(g.normal[2] - 1) > 1e-12) throw new Error('Only horizontal circles are supported');
      return rh.ArcCurve.createFromCircle(new rh.Circle(g.center, g.radius));
    }
    case 'latitudeArc': {
      const m = (g.azimuth0 + g.azimuth1) / 2;
      return rh.ArcCurve.createFromArc(
        rh.Arc.createFromPoints(spherePoint(g.radius, g.azimuth0, g.elevation), spherePoint(g.radius, m, g.elevation), spherePoint(g.radius, g.azimuth1, g.elevation)),
      );
    }
    case 'meridianArc': {
      const m = (g.elevation0 + g.elevation1) / 2;
      return rh.ArcCurve.createFromArc(
        rh.Arc.createFromPoints(spherePoint(g.radius, g.azimuth, g.elevation0), spherePoint(g.radius, g.azimuth, m), spherePoint(g.radius, g.azimuth, g.elevation1)),
      );
    }
    case 'sphere':
      return rh.Brep.createFromSphere(new rh.Sphere(g.center, g.radius));
    case 'spherePatch':
      return rh.Brep.createFromSurface(nurbsPatch(rh, g.radius, g.azimuth0, g.azimuth1, g.elevation0, g.elevation1));
    case 'box':
      return new rh.BoundingBox(g.min, g.max).toBrep();
    case 'frameBox': {
      const b = new rh.BoundingBox([-g.size[0] / 2, -g.size[1] / 2, g.z0], [g.size[0] / 2, g.size[1] / 2, g.z0 + g.size[2]]).toBrep();
      b.transform(frameTransform(rh, g.frame));
      return b;
    }
    case 'annularSector': {
      const [cx, cy] = g.center;
      const z = g.zBottom;
      const at = (r: number, a: number): number[] => [cx + r * Math.sin(a), cy - r * Math.cos(a), z];
      const am = (g.angle0 + g.angle1) / 2;
      const outer = rh.Arc.createFromPoints(at(g.outerRadius, g.angle0), at(g.outerRadius, am), at(g.outerRadius, g.angle1));
      const inner = rh.Arc.createFromPoints(at(g.innerRadius, g.angle1), at(g.innerRadius, am), at(g.innerRadius, g.angle0));
      const pc = new rh.PolyCurve();
      pc.appendArc(outer);
      pc.appendLine(new rh.Line(at(g.outerRadius, g.angle1), at(g.innerRadius, g.angle1)));
      pc.appendArc(inner);
      pc.appendLine(new rh.Line(at(g.innerRadius, g.angle0), at(g.outerRadius, g.angle0)));
      const h = g.zTop - g.zBottom;
      let ex = rh.Extrusion.create(pc, h, true);
      // The extrusion direction follows the profile plane normal; flip if it went downward.
      if (ex.getBoundingBox(true).max[2] < g.zTop - 1e-6) ex = rh.Extrusion.create(pc, -h, true);
      return ex;
    }
    case 'blockInstance':
      throw new Error('Block instances are added through the instance table');
  }
}

function attributesFor(rh: Rhino, o: VenueObject, layerIndex: number, configId: string): ObjectAttributes {
  const a = new rh.ObjectAttributes();
  a.layerIndex = layerIndex;
  a.name = o.name;
  a.setUserString('om.object_id', o.id);
  a.setUserString('om.category', o.category);
  a.setUserString('om.configuration_id', configId);
  a.setUserString('om.layer', o.layer);
  if (o.parentAssembly) a.setUserString('om.parent_assembly', o.parentAssembly);
  if (o.operatingState) a.setUserString('om.operating_state', o.operatingState);
  for (const [k, v] of Object.entries(o.metadata)) a.setUserString(`om.${k}`, String(v));
  return a;
}

export interface ExportOptions {
  /** Default 'seated'. 'standing' moves every assembly to the end of its path and folds the seats. */
  state?: ExportState;
  /** When given, seats carry their immersion score and grade, and sightlines/targets go on 07_ANALYSIS. */
  analysis?: ImmersionAnalysis;
}

export function buildRhinoDocument(rh: Rhino, model: VenueModel, { state = 'seated', analysis }: ExportOptions = {}) {
  const tr = model.transformation;
  if (state === 'standing' && !tr) throw new Error('This venue has no transformation, so it has no standing state.');
  const doc = new rh.File3dm();
  const settings = doc.settings();
  settings.modelUnitSystem = rh.UnitSystem.Meters;
  settings.modelAbsoluteTolerance = 0.0001;
  settings.modelAngleToleranceDegrees = 0.1;

  // Layers: OM_STUDIO root, then the canonical hierarchy (including layers empty in this round).
  const layerIndex = new Map<string, number>();
  const layerId = new Map<string, string>();
  const addLayer = (name: string, color: [number, number, number], parentKey?: string) => {
    const l = new rh.Layer();
    l.name = name;
    l.color = { r: color[0], g: color[1], b: color[2], a: 255 };
    if (parentKey) l.parentLayerId = layerId.get(parentKey)!;
    const idx = doc.layers().add(l);
    return { idx, id: doc.layers().get(idx).id };
  };
  const root = addLayer(ROOT_LAYER, [0, 0, 0]);
  layerId.set(ROOT_LAYER, root.id);
  for (const spec of LAYERS) {
    const parts = spec.path.split('/');
    const parentKey = parts.length === 1 ? ROOT_LAYER : parts.slice(0, -1).join('/');
    const { idx, id } = addLayer(parts[parts.length - 1], spec.color, parentKey);
    layerIndex.set(spec.path, idx);
    layerId.set(spec.path, id);
  }

  const configId = model.config.id;
  // Sightlines describe seated viewing, so the standing state carries no analysis.
  const standing = state === 'standing' && tr ? posedObjects(model.objects, tr, poseAt(tr, tr.duration)) : null;
  const objects = standing ?? (analysis ? [...model.objects, ...analysisObjects(model, analysis)] : model.objects);
  if (standing) analysis = undefined;
  const countsByLayer: Record<string, number> = {};
  const countsByKind: Record<string, number> = {};
  const instancesPerBlock = new Map<string, number>();

  // Block definitions: geometry sits on the layer of the block's first instance.
  const idefIds = new Map<string, string>();
  for (const block of model.blocks) {
    const first = objects.find((o) => o.geometry.kind === 'blockInstance' && o.geometry.blockId === block.id);
    if (!first) continue;
    const geoms = block.parts.map((p) => toRhinoGeometry(rh, p.geometry));
    const attrs = block.parts.map((p) => {
      const a = new rh.ObjectAttributes();
      a.layerIndex = layerIndex.get(first.layer)!;
      a.name = p.role;
      return a;
    });
    const idx = doc.instanceDefinitions().add(block.name, block.description, '', '', [0, 0, 0], geoms, attrs);
    if (idx < 0) throw new Error(`Failed to add block ${block.name}`);
    idefIds.set(block.id, doc.instanceDefinitions().get(idx).id);
    instancesPerBlock.set(block.name, 0);
  }

  for (const o of objects) {
    const li = layerIndex.get(o.layer);
    if (li === undefined) throw new Error(`Unknown layer ${o.layer}`);
    const attrs = attributesFor(rh, o, li, configId);
    if (standing && tr) {
      const a = tr.memberOf.get(o.id);
      const d = a && tr.assemblies.find((x) => x.id === a)!.travel;
      if (d && (d[0] || d[1] || d[2])) {
        attrs.setUserString('om.operating_state', 'standing');
        attrs.setUserString('om.pose_offset', d.map((v) => +v.toFixed(6)).join(','));
        if (o.category === 'Seat') attrs.setUserString('om.folded', 'yes');
      }
    }
    const seatAnalysis = analysis?.seats.get(o.id);
    if (seatAnalysis) for (const [k, v] of Object.entries(seatAnalysisMetadata(seatAnalysis))) attrs.setUserString(`om.${k}`, String(v));
    if (o.geometry.kind === 'blockInstance') {
      const block = model.blocks.find((b) => b.id === (o.geometry as { blockId: string }).blockId)!;
      // The runtime constructor takes (parentIdefId, xform); the bundled typings omit it.
      const InstanceReference = rh.InstanceReference as unknown as new (idefId: string, xform: InstanceType<Rhino['Transform']>) => InstanceType<Rhino['InstanceReference']>;
      const ref = new InstanceReference(idefIds.get(block.id)!, frameTransform(rh, o.geometry.frame));
      attrs.setUserString('om.block', block.name);
      doc.objects().addInstanceObject(ref, attrs);
      instancesPerBlock.set(block.name, (instancesPerBlock.get(block.name) ?? 0) + 1);
    } else {
      doc.objects().add(toRhinoGeometry(rh, o.geometry), attrs);
    }
    countsByLayer[rhinoLayerPath(o.layer)] = (countsByLayer[rhinoLayerPath(o.layer)] ?? 0) + 1;
    countsByKind[o.geometry.kind] = (countsByKind[o.geometry.kind] ?? 0) + 1;
  }

  const media = model.objects.find((o) => o.id === 'media.ideal')!.geometry as Extract<Geometry, { kind: 'spherePatch' }>;
  const manifest: ExportManifest = {
    schema: EXPORT_SCHEMA,
    configurationId: configId,
    configurationName: model.config.name,
    state,
    generatedAt: new Date().toISOString(),
    units: 'Meters',
    layers: [ROOT_LAYER, ...LAYERS.map((l) => rhinoLayerPath(l.path))],
    objectCount: objects.length,
    countsByLayer,
    countsByKind,
    blocks: [...instancesPerBlock].map(([name, instances]) => ({ name, instances })),
    seatCount: objects.filter((o) => o.category === 'Seat').length,
    led: model.led && {
      productId: model.led.product.id,
      strategy: model.led.strategy,
      count: model.led.count,
      unitTypes: model.led.unitTypes,
      unit: { w: model.led.product.cabinetWidth.value, h: model.led.product.cabinetHeight.value, d: model.led.product.cabinetDepth.value },
      maxDeviation: model.led.maxDeviation,
      coverage: model.led.coverage,
    },
    transformation: tr && {
      duration: +tr.duration.toFixed(3),
      assemblies: tr.assemblies.map((a) => ({ id: a.id, kind: a.kind, members: a.memberIds.length, travel: a.travel.map((v) => +v.toFixed(6)) as [number, number, number], start: +a.start.toFixed(3), duration: +a.duration.toFixed(3) })),
      conflicts: tr.conflicts.length,
      standingArea: +tr.standing.area.toFixed(3),
      standingCapacity: tr.standing.capacity,
    },
    building: model.fit && {
      width: model.config.building.width,
      depth: model.config.building.depth,
      clearHeight: model.config.building.clearHeight,
      fits: model.fit.fits,
      maxRadius: +model.fit.maxRadius.toFixed(4),
      columns: model.fit.columns.length,
      clashes: model.fit.columns.filter((k) => k.status === 'inside' || k.status === 'service').length,
    },
    systems: {
      units: Object.fromEntries(model.systems.systems.map((x) => [x.id, x.count])),
      guardrailLength: +model.systems.fitout.guardrailLength.toFixed(4),
      deckArea: +model.systems.fitout.deckArea.toFixed(3),
      pickPoints: model.systems.pickPoints,
      pickLoadKg: Math.round(model.systems.pickLoad),
      powerW: Math.round(model.systems.totals.power),
      costUsdPlaceholder: Math.round(model.systems.totals.cost),
    },
    immersion: analysis && {
      average: +analysis.average.toFixed(4),
      premiumCount: analysis.premiumCount,
      warningCount: analysis.warningCount,
      gradeCounts: analysis.gradeCounts,
    },
    sphereRadius: model.config.sphere.radius,
    media: { azimuth0: media.azimuth0, azimuth1: media.azimuth1, elevation0: media.elevation0, elevation1: media.elevation1 },
    checkpoints: objects
      .filter((o) => o.id === 'ref.origin' || o.id === 'seat.A.01' || o.id === 'stage.main')
      .map((o) => ({
        id: o.id,
        point:
          o.geometry.kind === 'point'
            ? o.geometry.p
            : o.geometry.kind === 'blockInstance'
              ? o.geometry.frame.origin
              : o.geometry.kind === 'box'
                ? o.geometry.min
                : [0, 0, 0],
      })),
  };

  const strings = doc.strings();
  strings.set('om.schema', EXPORT_SCHEMA);
  strings.set('om.configuration', JSON.stringify(model.config));
  strings.set('om.manifest', JSON.stringify(manifest));
  strings.set('om.coordinate_system', 'Right-handed, Z up, metres. Origin = reference sphere centre = reference eye point. +Y = forward.');
  strings.set('om.disclaimer', 'Conceptual design geometry. Not engineered, certified, or approved by any manufacturer.');

  return { doc, manifest };
}

export function exportRhino(rh: Rhino, model: VenueModel, options: ExportOptions = {}): { bytes: Uint8Array; manifest: ExportManifest } {
  const { doc, manifest } = buildRhinoDocument(rh, model, options);
  const bytes = doc.toByteArray();
  // Free the wasm-side document (embind object).
  (doc as unknown as { delete(): void }).delete();
  return { bytes, manifest };
}
