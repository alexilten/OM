import { Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { toDeg } from '../../engine/coordinates';
import { mediaBounds } from '../../engine/media';
import { sectionPlane, sphereSection } from '../../engine/section';
import type { Geometry, VenueObject, Vec3 } from '../../engine/types';
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
};

const lineColor = (o: VenueObject) => {
  if (o.id === 'ref.axis.x') return '#d64545';
  if (o.id === 'ref.axis.y') return '#3a9a4a';
  if (o.id === 'ref.axis.z') return '#2e6fd6';
  if (o.layer.startsWith('01_MEDIA')) return COLORS.edge;
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

function Solid({ o, color, geo }: { o: VenueObject; color: string; geo: THREE.BufferGeometry }) {
  const selected = useStudio((s) => s.selectedId === o.id);
  const onClick = useSelect();
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} castShadow receiveShadow onClick={onClick(o.id)}>
      <meshStandardMaterial color={selected ? COLORS.seatSelected : color} roughness={0.85} metalness={0.02} />
    </mesh>
  );
}

function Instances({ objects, geometry, color }: { objects: VenueObject[]; geometry: THREE.BufferGeometry; color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const base = new THREE.Color(color);
    const hi = new THREE.Color(COLORS.seatSelected);
    objects.forEach((o, i) => {
      mesh.setMatrixAt(i, frameMatrix((o.geometry as Extract<Geometry, { kind: 'blockInstance' }>).frame));
      mesh.setColorAt(i, o.id === selectedId ? hi : base);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [objects, selectedId, color]);
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

function EyePoints({ objects }: { objects: VenueObject[] }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(objects.flatMap((o) => (o.geometry as Extract<Geometry, { kind: 'point' }>).p), 3));
    return g;
  }, [objects]);
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

export function VenueScene() {
  const model = useStudio((s) => s.model);
  const vis = useStudio((s) => s.layerVisible);
  const shown = (o: VenueObject) => isLayerVisible(vis, o.layer);

  const byBlock = useMemo(() => {
    const m = new Map<string, VenueObject[]>();
    for (const o of model.objects) if (o.geometry.kind === 'blockInstance') m.set(o.geometry.blockId, [...(m.get(o.geometry.blockId) ?? []), o]);
    return m;
  }, [model]);
  const blockGeos = useMemo(() => new Map(model.blocks.map((b) => [b.id, blockGeometry(b)])), [model.blocks]);
  useEffect(() => () => blockGeos.forEach((g) => g.dispose()), [blockGeos]);

  const solids = useMemo(
    () =>
      model.objects
        .filter((o) => o.geometry.kind === 'box' || o.geometry.kind === 'annularSector')
        .map((o) => ({
          o,
          geo: o.geometry.kind === 'box' ? boxGeometry(o.geometry.min, o.geometry.max) : annularSectorGeometry(o.geometry as Extract<Geometry, { kind: 'annularSector' }>),
          color: o.category === 'Floor' ? COLORS.floor : o.category === 'Stage' ? COLORS.stage : COLORS.tier,
        })),
    [model],
  );
  const lines = useMemo(
    () => model.objects.filter((o) => ['line', 'polyline', 'circle', 'latitudeArc', 'meridianArc'].includes(o.geometry.kind)).map((o) => ({ o, pts: curvePoints(o.geometry) })),
    [model],
  );
  const media = model.objects.find((o) => o.id === 'media.ideal')!;
  const eyes = useMemo(() => model.objects.filter((o) => o.category === 'EyePoint'), [model]);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {shown(model.objects.find((o) => o.id === 'ref.sphere')!) && <ReferenceSphere R={model.config.sphere.radius} />}
      {shown(media) && <MediaSurface o={media} />}
      {solids.filter(({ o }) => shown(o)).map(({ o, geo, color }) => (
        <Solid key={o.id} o={o} geo={geo} color={color} />
      ))}
      {[...byBlock].map(([blockId, objs]) => {
        const visible = objs.filter(shown);
        if (!visible.length) return null;
        return <Instances key={blockId} objects={visible} geometry={blockGeos.get(blockId)!} color={blockId.includes('.led.') ? COLORS.led : COLORS.seat} />;
      })}
      {lines.filter(({ o }) => shown(o)).map(({ o, pts }) => (
        <Line key={o.id} points={pts} color={lineColor(o)} lineWidth={o.layer.includes('Envelope') ? 0.8 : 1.5} dashed={o.layer.includes('Envelope') || o.id === 'ref.floorline'} dashSize={0.5} gapSize={0.3} />
      ))}
      {shown(model.objects.find((o) => o.id === 'ref.origin')!) && (
        <mesh onClick={(e) => (e.stopPropagation(), useStudio.getState().select('ref.origin'))}>
          <sphereGeometry args={[0.12, 24, 16]} />
          <meshBasicMaterial color="#111" />
        </mesh>
      )}
      {eyes.length > 0 && isLayerVisible(vis, '07_ANALYSIS/Eye_Points') && <EyePoints objects={eyes} />}
      <SectionOverlay />
    </group>
  );
}
