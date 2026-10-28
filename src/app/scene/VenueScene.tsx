import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { spherePoint, toDeg } from '../../engine/coordinates';
import { mediaBounds } from '../../engine/media';
import { sectionPlane, sphereSection } from '../../engine/section';
import { GRADES } from '../../engine/immersion';
import { poseAt, type Pose, type TransformationModel } from '../../engine/kinetics';
import type { Geometry, VenueObject, Vec3 } from '../../engine/types';
import { ledUnitColor } from '../ledColors';
import { isLayerVisible, useStudio } from '../store';
import { annularSectorGeometry, blockGeometry, boxGeometry, calibrationTexture, curvePoints, frameMatrix, sphereGraticule, spherePatchGeometry } from './threeGeometry';

const COLORS = {
  floor: '#ecebe7',
  tier: '#d9d6cf',
  stage: '#3b3d42',
  seat: '#3a3f4a',
  seatSelected: '#e4572e',
  led: '#1c1f24',
  graticule: '#b9c2cc',
  edge: '#1f5fbf',
  envelope: '#9aa0a6',
  eye: '#d7263d',
  section: '#e4572e',
  column: '#bdb7aa',
  building: '#8a8f98',
  circulation: '#e8a33d',
};

const COLUMN_COLORS: Record<string, string> = { clear: COLORS.column, circulation: COLORS.circulation, service: '#e4572e', inside: '#d73027' };

const lineColor = (o: VenueObject) => {
  if (o.id === 'ref.axis.x') return '#d64545';
  if (o.id === 'ref.axis.y') return '#3a9a4a';
  if (o.id === 'ref.axis.z') return '#2e6fd6';
  if (o.layer.startsWith('01_MEDIA')) return COLORS.edge;
  if (o.category === 'Circulation') return COLORS.circulation;
  if (o.category === 'BuildingEnvelope') return COLORS.building;
  if (o.layer.includes('Envelope')) return COLORS.envelope;
  return '#7d8a96';
};

function useSelect() {
  const select = useStudio((s) => s.select);
  return (id: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(id);
  };
}

function MediaSurface({ o }: { o: VenueObject }) {
  const g = o.geometry as Extract<Geometry, { kind: 'spherePatch' }>;
  const display = useStudio((s) => s.mediaDisplay);
  const onClick = useSelect();
  const geo = useMemo(() => spherePatchGeometry(g.radius, g.azimuth0, g.azimuth1, g.elevation0, g.elevation1), [g.radius, g.azimuth0, g.azimuth1, g.elevation0, g.elevation1]);
  const tex = useMemo(
    () => (display === 'calibration' ? calibrationTexture(toDeg(g.azimuth0), toDeg(g.azimuth1), toDeg(g.elevation0), toDeg(g.elevation1)) : null),
    [display, g.azimuth0, g.azimuth1, g.elevation0, g.elevation1],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => tex?.dispose(), [tex]);
  return (
    <mesh geometry={geo} onClick={onClick(o.id)}>
      {tex ? (
        <meshBasicMaterial map={tex} side={THREE.DoubleSide} toneMapped={false} />
      ) : (
        <meshStandardMaterial color="#f7f8fa" side={THREE.DoubleSide} roughness={0.9} />
      )}
    </mesh>
  );
}

/** Where the transformation has moved an object, or undefined when it has not moved. */
type OffsetOf = (id: string) => Vec3 | undefined;

function useOffsets(tr: TransformationModel | undefined, pose: Pose | null): OffsetOf {
  return useMemo(() => (id: string) => {
    if (!tr || !pose) return undefined;
    const a = tr.memberOf.get(id);
    const d = a ? pose.offsets.get(a) : undefined;
    return d && (d[0] || d[1] || d[2]) ? d : undefined;
  }, [tr, pose]);
}

function Solid({ o, color, geo, offset, opacity = 1 }: { o: VenueObject; color: string; geo: THREE.BufferGeometry; offset?: Vec3; opacity?: number }) {
  const selected = useStudio((s) => s.selectedId === o.id);
  const onClick = useSelect();
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} position={offset} castShadow receiveShadow onClick={onClick(o.id)}>
      <meshStandardMaterial color={selected ? COLORS.seatSelected : color} roughness={0.85} metalness={0.02} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} />
    </mesh>
  );
}

/** `foldScale`: local Z scale of each instance (seats folding flat for nesting); 1 = unfolded. */
function Instances({ objects, geometry, color, offsetOf, foldScale = 1 }: { objects: VenueObject[]; geometry: THREE.BufferGeometry; color: string; offsetOf: OffsetOf; foldScale?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  const heatmap = useStudio((s) => s.heatmap);
  const analysis = useStudio((s) => s.analysis);
  const ledColor = useStudio((s) => s.ledColor);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const base = new THREE.Color(color);
    const hi = new THREE.Color(COLORS.seatSelected);
    const gradeColor = new Map(GRADES.map((g) => [g.grade, new THREE.Color(g.color)]));
    const cache = colorCache();
    const fold = new THREE.Matrix4().makeScale(1, 1, foldScale);
    const move = new THREE.Matrix4();
    objects.forEach((o, i) => {
      const m = frameMatrix((o.geometry as Extract<Geometry, { kind: 'blockInstance' }>).frame);
      if (foldScale !== 1) m.multiply(fold);
      const d = offsetOf(o.id);
      if (d) m.premultiply(move.makeTranslation(d[0], d[1], d[2]));
      mesh.setMatrixAt(i, m);
      const a = heatmap ? analysis?.seats.get(o.id) : undefined;
      const led = o.category.startsWith('LED') ? ledUnitColor(o.metadata, ledColor) : undefined;
      mesh.setColorAt(i, o.id === selectedId ? hi : a ? gradeColor.get(a.grade)! : led ? cache(led) : base);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [objects, selectedId, color, heatmap, analysis, ledColor, offsetOf, foldScale]);
  return (
    <instancedMesh
      key={objects.length}
      ref={ref}
      args={[geometry, undefined, objects.length]}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) select(objects[e.instanceId].id);
      }}
    >
      <meshStandardMaterial roughness={0.7} metalness={0.05} />
    </instancedMesh>
  );
}

const colorCache = () => {
  const m = new Map<string, THREE.Color>();
  return (hex: string) => m.get(hex) ?? m.set(hex, new THREE.Color(hex)).get(hex)!;
};

/** Spherical LED tiles (families 04–05) as one merged mesh; a 3 × 3 grid per tile. */
const TILE_SEG = 3;
const TILE_TRIS = TILE_SEG * TILE_SEG * 2;

function LedTiles({ objects }: { objects: VenueObject[] }) {
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  const ledColor = useStudio((s) => s.ledColor);
  const geo = useMemo(() => {
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    for (const o of objects) {
      const g = o.geometry as Extract<Geometry, { kind: 'spherePatch' }>;
      // 5 mm in front of the ideal surface so the tiles do not z-fight with it.
      const R = g.radius - 0.005;
      const start = pos.length / 3;
      for (let j = 0; j <= TILE_SEG; j++)
        for (let i = 0; i <= TILE_SEG; i++) {
          const p = spherePoint(R, g.azimuth0 + ((g.azimuth1 - g.azimuth0) * i) / TILE_SEG, g.elevation0 + ((g.elevation1 - g.elevation0) * j) / TILE_SEG);
          pos.push(...p);
          nor.push(-p[0] / R, -p[1] / R, -p[2] / R);
        }
      const row = TILE_SEG + 1;
      for (let j = 0; j < TILE_SEG; j++)
        for (let i = 0; i < TILE_SEG; i++) {
          const a = start + j * row + i;
          idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx);
    return g;
  }, [objects]);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => {
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const cache = colorCache();
    const per = (TILE_SEG + 1) ** 2;
    objects.forEach((o, t) => {
      const c = o.id === selectedId ? cache(COLORS.seatSelected) : cache(ledUnitColor(o.metadata, ledColor) ?? COLORS.led);
      for (let v = 0; v < per; v++) col.setXYZ(t * per + v, c.r, c.g, c.b);
    });
    col.needsUpdate = true;
  }, [geo, objects, selectedId, ledColor]);
  return (
    <mesh
      geometry={geo}
      onClick={(e) => {
        e.stopPropagation();
        if (e.faceIndex != null) select(objects[Math.floor(e.faceIndex / TILE_TRIS)].id);
      }}
    >
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.6} metalness={0.05} />
    </mesh>
  );
}

function EyePoints({ objects, offsetOf }: { objects: VenueObject[]; offsetOf: OffsetOf }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const at = (o: VenueObject) => {
      const p = (o.geometry as Extract<Geometry, { kind: 'point' }>).p;
      const d = offsetOf(o.id);
      return d ? [p[0] + d[0], p[1] + d[1], p[2] + d[2]] : p;
    };
    g.setAttribute('position', new THREE.Float32BufferAttribute(objects.flatMap(at), 3));
    return g;
  }, [objects, offsetOf]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <points geometry={geo}>
      <pointsMaterial color={COLORS.eye} size={0.12} sizeAttenuation />
    </points>
  );
}

function ReferenceSphere({ R }: { R: number }) {
  const lines = useMemo(() => sphereGraticule(R), [R]);
  return (
    <group>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color={COLORS.graticule} lineWidth={0.6} transparent opacity={0.55} />
      ))}
    </group>
  );
}

function SectionOverlay() {
  const section = useStudio((s) => s.section);
  const config = useStudio((s) => s.model.config);
  const res = useMemo(() => {
    if (!section.enabled) return null;
    const plane = sectionPlane(section);
    const cut = sphereSection(plane, mediaBounds(config.sphere.radius, config.media));
    // Nudge overlay 2 cm into the kept half-space so the clipping plane never hides it.
    const n = plane.normal;
    const push = (p: Vec3): Vec3 => [p[0] - n[0] * 0.02, p[1] - n[1] * 0.02, p[2] - n[2] * 0.02];
    return { full: cut.full.map(push), media: cut.media.map((r) => r.map(push)) };
  }, [section, config]);
  if (!res) return null;
  return (
    <group>
      {res.full.length > 1 && <Line points={res.full} color={COLORS.section} lineWidth={1} dashed dashSize={0.4} gapSize={0.25} />}
      {res.media.map((run, i) => run.length > 1 && <Line key={i} points={run} color={COLORS.section} lineWidth={4} />)}
    </group>
  );
}

/** Sightline from the selected seat's eye to the stage focus, plus the blocking seat's eye when one limits it. */
function SeatSightline() {
  const id = useStudio((s) => s.selectedId);
  const model = useStudio((s) => s.model);
  const analysis = useStudio((s) => s.analysis);
  const seat = id ? model.seats.find((x) => x.id === id) : undefined;
  const a = seat ? analysis?.seats.get(seat.id) : undefined;
  if (!seat || !a || !analysis) return null;
  const blocker = a.blockingSeatId ? model.seats.find((x) => x.id === a.blockingSeatId) : undefined;
  const color = GRADES.find((g) => g.grade === a.grade)!.color;
  return (
    <group>
      <Line points={[seat.eyePoint, analysis.focusPoint]} color={color} lineWidth={2.5} />
      <mesh position={analysis.focusPoint}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {blocker && (
        <mesh position={blocker.eyePoint}>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshBasicMaterial color={COLORS.eye} />
        </mesh>
      )}
    </group>
  );
}

export function VenueScene() {
  const model = useStudio((s) => s.model);
  const vis = useStudio((s) => s.layerVisible);
  const shown = (o: VenueObject) => isLayerVisible(vis, o.layer);
  const tr = model.transformation;
  const t = useStudio((s) => s.transformT);
  const pose = useMemo(() => (tr && t > 0 ? poseAt(tr, t) : null), [tr, t]);
  const offsetOf = useOffsets(tr, pose);

  const byBlock = useMemo(() => {
    const m = new Map<string, VenueObject[]>();
    for (const o of model.objects) if (o.geometry.kind === 'blockInstance') m.set(o.geometry.blockId, [...(m.get(o.geometry.blockId) ?? []), o]);
    return m;
  }, [model]);
  const blockGeos = useMemo(() => new Map(model.blocks.map((b) => [b.id, blockGeometry(b)])), [model.blocks]);
  useEffect(() => () => blockGeos.forEach((g) => g.dispose()), [blockGeos]);
  // Folded seats shrink towards the folded height (a display effect; exports keep the block).
  const foldScaleOf = (geo: THREE.BufferGeometry) => {
    if (!pose?.fold || !tr) return 1;
    geo.computeBoundingBox();
    const h = geo.boundingBox!.max.z;
    const folded = Math.min(1, model.config.transformation.foldedSeatHeight / h);
    return 1 - pose.fold * (1 - folded);
  };

  const solids = useMemo(
    () =>
      model.objects
        .filter((o) => o.geometry.kind === 'box' || o.geometry.kind === 'annularSector')
        .map((o) => ({
          o,
          geo: o.geometry.kind === 'box' ? boxGeometry(o.geometry.min, o.geometry.max) : annularSectorGeometry(o.geometry as Extract<Geometry, { kind: 'annularSector' }>),
          color: o.category === 'Floor' ? COLORS.floor : o.category === 'Stage' ? COLORS.stage : o.category === 'Column' ? COLUMN_COLORS[String(o.metadata.fit_status)] : COLORS.tier,
        })),
    [model],
  );
  const lines = useMemo(
    () => model.objects.filter((o) => ['line', 'polyline', 'circle', 'latitudeArc', 'meridianArc'].includes(o.geometry.kind)).map((o) => ({ o, pts: curvePoints(o.geometry) })),
    [model],
  );
  const media = model.objects.find((o) => o.id === 'media.ideal')!;
  const eyes = useMemo(() => model.objects.filter((o) => o.category === 'EyePoint'), [model]);
  const tiles = useMemo(() => model.objects.filter((o) => o.category === 'LEDTile'), [model]);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {shown(model.objects.find((o) => o.id === 'ref.sphere')!) && <ReferenceSphere R={model.config.sphere.radius} />}
      {shown(media) && <MediaSurface o={media} />}
      {solids.filter(({ o }) => shown(o)).map(({ o, geo, color }) => (
        // Clear columns are ghosted so they do not hide the venue; clashing ones stay solid.
        <Solid key={o.id} o={o} geo={geo} color={color} offset={offsetOf(o.id)} opacity={o.category === 'Column' && o.metadata.fit_status === 'clear' ? 0.25 : 1} />
      ))}
      {[...byBlock].map(([blockId, objs]) => {
        const visible = objs.filter(shown);
        if (!visible.length) return null;
        const led = blockId.includes('.led.');
        const geo = blockGeos.get(blockId)!;
        return <Instances key={blockId} objects={visible} geometry={geo} color={led ? COLORS.led : COLORS.seat} offsetOf={offsetOf} foldScale={led ? 1 : foldScaleOf(geo)} />;
      })}
      {tiles.length > 0 && shown(tiles[0]) && <LedTiles objects={tiles} />}
      {lines.filter(({ o }) => shown(o)).map(({ o, pts }) => (
        <Line key={o.id} points={pts} color={lineColor(o)} lineWidth={o.layer.includes('Envelope') ? 0.8 : 1.5} dashed={(o.layer.includes('Envelope') && o.category !== 'BuildingEnvelope') || o.category === 'Circulation' || o.id === 'ref.floorline'} dashSize={0.5} gapSize={0.3} />
      ))}
      {shown(model.objects.find((o) => o.id === 'ref.origin')!) && (
        <mesh onClick={(e) => (e.stopPropagation(), useStudio.getState().select('ref.origin'))}>
          <sphereGeometry args={[0.12, 24, 16]} />
          <meshBasicMaterial color="#111" />
        </mesh>
      )}
      {eyes.length > 0 && isLayerVisible(vis, '07_ANALYSIS/Eye_Points') && <EyePoints objects={eyes} offsetOf={offsetOf} />}
      <SectionOverlay />
      <SeatSightline />
    </group>
  );
}
