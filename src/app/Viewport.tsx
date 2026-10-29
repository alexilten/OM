import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { sectionPlane } from '../engine/section';
import type { Vec3 } from '../engine/types';
import { VenueScene } from './scene/VenueScene';
import { useStudio, type ViewName } from './store';

/** Engine (Z-up) → Three.js (Y-up). Matches the -90° X rotation of the scene group. */
const toThree = (p: Vec3) => new THREE.Vector3(p[0], p[2], -p[1]);

function presetView(name: ViewName, R: number): { pos: Vec3; target: Vec3 } {
  switch (name) {
    case 'top':
      return { pos: [0, -0.01, 3.4 * R], target: [0, 0, 0] };
    case 'front':
      return { pos: [0, -2.7 * R, 0.25 * R], target: [0, 0, 0.1 * R] };
    case 'side':
      return { pos: [2.8 * R, 0, 0.3 * R], target: [0, 0, 0] };
    case 'audience':
      return { pos: [0, 0, 0], target: [0, 1, 0] };
    case 'iso':
    case 'reset':
    default:
      return { pos: [-1.0 * R, -2.3 * R, 1.3 * R], target: [0, 1.5, -1] };
  }
}

function CameraRig() {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const view = useStudio((s) => s.view);
  const seatView = useStudio((s) => s.seatView);
  const model = useStudio((s) => s.model);
  const fov = useStudio((s) => s.fov);
  const anim = useRef<{ fromP: THREE.Vector3; toP: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null>(null);

  const go = (pos: Vec3, target: Vec3) => {
    if (!controls) return;
    anim.current = { fromP: camera.position.clone(), toP: toThree(pos), fromT: controls.target.clone(), toT: toThree(target), t: 0 };
  };

  useEffect(() => {
    const v = presetView(view.name, model.config.sphere.radius + (model.config.sphere.ringRadius ?? 0));
    go(v.pos, v.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.nonce, controls]);

  useEffect(() => {
    if (!seatView) return;
    const seat = model.seats.find((s) => s.id === seatView.seatId);
    if (!seat) return;
    const e = seat.eyePoint;
    go(e, [e[0] + seat.facing[0], e[1] + seat.facing[1], e[2]]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatView, model]);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }, [fov, camera]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + dt / 0.8);
    const k = 1 - Math.pow(1 - a.t, 3);
    camera.position.lerpVectors(a.fromP, a.toP, k);
    controls.target.lerpVectors(a.fromT, a.toT, k);
    // Eye-point views orbit about a target 1 m ahead; keep the camera from sitting on it.
    controls.update();
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

function Clipping() {
  const { gl } = useThree();
  const section = useStudio((s) => s.section);
  useEffect(() => {
    if (!section.enabled) {
      gl.clippingPlanes = [];
      return;
    }
    const p = sectionPlane(section);
    // Engine keeps n·p ≤ d; Three keeps n'·p' + c ≥ 0.
    const n = toThree(p.normal).negate();
    gl.clippingPlanes = [new THREE.Plane(n, p.d)];
  }, [gl, section]);
  return null;
}

export function Viewport() {
  const R = useStudio((s) => s.model.config.sphere.radius + (s.model.config.sphere.ringRadius ?? 0));
  const floorZ = useStudio((s) => s.model.config.floor.mainFloorElevation);
  const select = useStudio((s) => s.select);
  // The show is watched in a dark room: dim the work lights so the screen and beams carry the scene.
  const show = useStudio((s) => s.workspace === 'EXPERIENCE');
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, localClippingEnabled: true, preserveDrawingBuffer: true }}
      camera={{ fov: 50, near: 0.05, far: 2000, position: [-20, 16, 24] }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={[show ? '#05060a' : '#f2f3f5']} />
      <hemisphereLight args={['#ffffff', '#d9d4cc', show ? 0.12 : 1.1]} />
      <directionalLight
        position={[-R, 2.2 * R, R]}
        intensity={show ? 0.08 : 1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-R * 1.4}
        shadow-camera-right={R * 1.4}
        shadow-camera-top={R * 1.4}
        shadow-camera-bottom={-R * 1.4}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[R, R, -R]} intensity={show ? 0.05 : 0.35} />
      <VenueScene />
      <Grid
        position={[0, floorZ - 0.32, 0]}
        args={[200, 200]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#d5d8dc"
        sectionSize={5}
        sectionThickness={0.9}
        sectionColor="#c3c7cd"
        fadeDistance={R * 7}
        fadeStrength={1.2}
        infiniteGrid
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxDistance={R * 8} minDistance={0.2} />
      <CameraRig />
      <Clipping />
    </Canvas>
  );
}
