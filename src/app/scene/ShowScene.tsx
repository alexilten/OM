import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Frame, Geometry, VenueObject } from '../../engine/types';
import { blendLooks, lookAt } from '../../show/cues';
import { evaluateMatrix, luminance, warmth } from '../../show/modulation';
import { getVideoPreset } from '../../show/presets';
import { FlashGuard, guardRed } from '../../show/safety';
import { SHOW_FRAGMENT, SHOW_VERTEX } from '../../show/shaders';
import { getAudio, getVideo, live, panelLook, useShow } from '../../show/store';
import { beatPhase, pulse as pulseOf, safeSubdivision } from '../../show/timing';
import { useStudio } from '../store';
import { frameMatrix, spherePatchGeometry } from './threeGeometry';

const MODES = { canvas: 0, equirect: 1, dome: 2 } as const;
const lookId = (id: string) => getVideoPreset(id)?.look ?? 0;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Samples the playing video into 8 azimuth zones (about 10× a second) for the lights. */
function useVideoSampler() {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 16;
    return c;
  }, []);
  const last = useRef(0);
  return (now: number) => {
    const v = getVideo();
    if (!v || v.readyState < 2 || now - last.current < 100) return;
    last.current = now;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, 32, 16);
    const px = ctx.getImageData(0, 0, 32, 16).data;
    const avg: [number, number, number] = [0, 0, 0];
    for (let z = 0; z < 8; z++) {
      const c: [number, number, number] = [0, 0, 0];
      for (let x = z * 4; x < z * 4 + 4; x++)
        for (let y = 0; y < 16; y++) {
          const i = (y * 32 + x) * 4;
          c[0] += px[i] / 255 / 64;
          c[1] += px[i + 1] / 255 / 64;
          c[2] += px[i + 2] / 255 / 64;
        }
      live.zones[z] = c;
      avg[0] += c[0] / 8;
      avg[1] += c[1] / 8;
      avg[2] += c[2] / 8;
    }
    live.average = avg;
  };
}

/**
 * The media surface playing the show, and the show's per-frame driver: clock, beat, cue look and
 * modulation are computed here once and shared through `live` with the beams, haze and seats.
 */
export function ShowSurface({ o }: { o: VenueObject }) {
  const g = o.geometry as Extract<Geometry, { kind: 'spherePatch' }>;
  const geo = useMemo(() => spherePatchGeometry(g.radius, g.azimuth0, g.azimuth1, g.elevation0, g.elevation1), [g.radius, g.azimuth0, g.azimuth1, g.elevation0, g.elevation1]);
  const source = useShow((s) => s.video);
  const videoTex = useMemo(() => {
    const v = source.kind === 'file' ? getVideo() : null;
    if (!v) return null;
    const t = new THREE.VideoTexture(v);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [source]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHOW_VERTEX,
        fragmentShader: SHOW_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uBeat: { value: 0 },
          uBar: { value: 0 },
          uBass: { value: 0 },
          uMid: { value: 0 },
          uHigh: { value: 0 },
          uIntensity: { value: 1 },
          uLook: { value: 0 },
          uLook2: { value: 0 },
          uMix: { value: 1 },
          uMode: { value: 0 },
          uUseVideo: { value: false },
          uVideo: { value: null },
          uBounds: { value: new THREE.Vector4() },
          uPalette0: { value: new THREE.Color() },
          uPalette1: { value: new THREE.Color() },
          uPalette2: { value: new THREE.Color() },
        },
      }),
    [],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => videoTex?.dispose(), [videoTex]);
  const sample = useVideoSampler();
  const idle = useRef(0);
  const lookTime = useRef(0);
  const lastBeat = useRef(-1);
  const guard = useMemo(() => new FlashGuard(), []);

  useFrame((_, dt) => {
    const s = useShow.getState();
    const u = material.uniforms;
    // The audio clock drives everything while playing; when stopped the looks keep drifting slowly.
    idle.current += dt;
    const t = s.playing ? getAudio().time() : s.time;
    const barPos = ((t - s.tempo.offset) * s.tempo.bpm) / 240;

    // Look: the cue list while it runs, otherwise the panel.
    const cue = s.cuesOn ? lookAt(s.cues, Math.max(0, barPos)) : null;
    const look = cue ?? { cueIndex: -1, ...blendLooks(panelLook(s), panelLook(s), 1) };
    live.look = look;
    if (cue && cue.cueIndex !== s.cueIndex) useShow.setState({ cueIndex: cue.cueIndex });

    const sub = s.reducedMotion ? 0 : safeSubdivision(s.tempo.bpm, 1);
    const ph = beatPhase(t, s.tempo);
    const beat = s.playing && sub ? pulseOf(ph.phase) * look.pulse : 0;
    const barPulse = s.playing && sub && ph.inBar === 0 ? pulseOf(ph.phase, 3) : 0;
    const bands = s.playing ? getAudio().bands() : { bass: 0, mid: 0, high: 0, rms: 0 };

    // Modulation from the beat, the audio bands and the screen colour.
    const mod = evaluateMatrix(s.matrix, { beat, bar: barPulse, bass: bands.bass, mid: bands.mid, high: bands.high, rms: bands.rms, brightness: luminance(live.average), warmth: warmth(live.average) });
    live.mod = mod;
    // Strobe: a white hit on a new beat while the strobe route is above half, through the flash guard.
    if (s.playing && !s.reducedMotion && ph.beat !== lastBeat.current) {
      lastBeat.current = ph.beat;
      if (mod['lights.strobe'] > 0.5 && guard.allow(t)) live.strobe = 1;
    }
    live.strobe = Math.max(0, live.strobe - dt * 12);

    lookTime.current += dt * (s.reducedMotion ? 0.3 : 1) * Math.max(0.1, 1 + mod['screen.speed']);
    live.time = s.playing ? t : idle.current;
    live.beat = ph.beat;
    live.bar = Math.floor(ph.beat / 4);
    live.barPos = barPos;
    live.pulse = beat;
    live.bands = bands;

    u.uTime.value = lookTime.current;
    u.uBeat.value = beat;
    u.uBar.value = live.bar;
    u.uBass.value = bands.bass * look.pulse;
    u.uMid.value = bands.mid;
    u.uHigh.value = bands.high;
    u.uIntensity.value = look.intensity * Math.max(0, 1 + 0.5 * mod['screen.brightness']);
    u.uMode.value = MODES[s.mapping];
    u.uBounds.value.set(g.azimuth0, g.azimuth1, g.elevation0, g.elevation1);
    const pal = look.palette;
    [u.uPalette0, u.uPalette1, u.uPalette2].forEach((p, i) => (p.value as THREE.Color).setRGB(...pal[i % pal.length]));
    if (videoTex) {
      u.uUseVideo.value = true;
      u.uVideo.value = videoTex;
      sample(performance.now());
    } else {
      u.uUseVideo.value = false;
      u.uLook.value = lookId(look.video);
      u.uLook2.value = lookId(look.fromVideo);
      u.uMix.value = look.mix;
      // Generated looks: zone colours come from the palette, rotating one step per bar.
      for (let z = 0; z < 8; z++) live.zones[z] = pal[(z + live.bar) % pal.length];
      live.average = [0, 1, 2].map((k) => pal.reduce((a, c) => a + c[k], 0) / pal.length) as [number, number, number];
    }
    if (s.playing && Math.abs(t - s.time) > 0.1) useShow.setState({ time: t });
  });

  return <mesh geometry={geo} material={material} />;
}

/** Beams from every lighting fixture, coloured by the screen zone in front of them, pulsed and swept by the matrix. */
export function ShowBeams() {
  const objects = useStudio((s) => s.model.objects);
  const mb = useStudio((s) => s.model.config.media);
  // From a seat the floor wash beams would sit between the eye and the screen: show only the overhead rigs.
  const seatView = useStudio((s) => !!s.seatView);
  const fixtures = useMemo(() => objects.filter((o) => o.category === 'LightingFixture' && o.geometry.kind === 'blockInstance'), [objects]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    // Unit cone: apex at the origin, opening along +Y to length 1, radius 0.18 (a ~20° beam).
    const c = new THREE.ConeGeometry(0.18, 1, 20, 1, true);
    c.rotateX(Math.PI);
    c.translate(0, 0.5, 0);
    return c;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }), []);
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  const bases = useMemo(() => fixtures.map((o) => frameMatrix((o.geometry as { frame: Frame }).frame)), [fixtures]);
  const color = useMemo(() => new THREE.Color(), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const sweep = useMemo(() => new THREE.Matrix4(), []);
  const scale = useMemo(() => new THREE.Matrix4(), []);

  useFrame(() => {
    const mesh = ref.current;
    const look = live.look;
    if (!mesh || !look) return;
    const on = look.lights !== 'off';
    const az0 = (mb.azimuthLeftDeg * Math.PI) / 180;
    const az1 = (mb.azimuthRightDeg * Math.PI) / 180;
    const haze = clamp01(look.haze + 0.5 * live.mod.haze);
    const sweepAmt = 0.35 * Math.max(0, live.mod['lights.sweep']);
    fixtures.forEach((o, i) => {
      const f = (o.geometry as { frame: Frame }).frame;
      const base = o.metadata.rig === 'base ring';
      const length = seatView && base ? 0 : base ? 6 : 9;
      // Sweep about the fixture's local Z (pan); neighbours move in opposite directions.
      sweep.makeRotationZ(sweepAmt * Math.sin(live.time * 0.8 + i * 0.7) * (i % 2 ? 1 : -1));
      m.copy(bases[i]).multiply(sweep).multiply(scale.makeScale(length, length, length));
      mesh.setMatrixAt(i, m);
      const az = Math.atan2(f.origin[0], f.origin[1]);
      const zone = Math.max(0, Math.min(7, Math.floor(((az - az0) / (az1 - az0)) * 8)));
      const raw = look.lights === 'palette' ? look.palette[(i + live.bar) % look.palette.length] : live.zones[zone];
      // A beat-pulsed colour is a flash: saturated red is softened (WCAG 2.3.1 red-flash guidance).
      const c = live.pulse > 0.05 ? guardRed(raw) : raw;
      // Beam visibility grows with haze; the pulse never flashes faster than the safe subdivision.
      const k = on ? (0.05 + 0.25 * haze) * (0.45 + 0.9 * live.pulse + 0.4 * live.bands.bass) * look.intensity * Math.max(0, 1 + live.mod['lights.intensity']) * (seatView ? 0.35 : 1) : 0;
      const w = on ? live.strobe * 0.6 : 0;
      color.setRGB(c[0] * k + w, c[1] * k + w, c[2] * k + w);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (!fixtures.length) return null;
  return <instancedMesh key={fixtures.length} ref={ref} args={[geo, mat, fixtures.length]} frustumCulled={false} />;
}

/** A low haze layer in the bowl (Atmospherics system): glows with the screen colour, thicker with haze. */
export function HazeVolume() {
  const R = useStudio((s) => s.model.config.sphere.radius);
  const floor = useStudio((s) => s.model.config.floor.mainFloorElevation);
  const atmos = useStudio((s) => s.model.config.systems.atmospherics.enabled);
  const H = 3.5;
  const geo = useMemo(() => {
    const c = new THREE.CylinderGeometry(R * 0.92, R * 0.92, H, 48, 1, true);
    c.rotateX(Math.PI / 2);
    return c;
  }, [R]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, toneMapped: false }), []);
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  useFrame(() => {
    const look = live.look;
    if (!look) return;
    const k = 0.08 * clamp01(look.haze + 0.5 * live.mod.haze) * look.intensity;
    mat.color.setRGB(live.average[0] * k, live.average[1] * k, live.average[2] * k);
  });
  if (!atmos) return null;
  return <mesh geometry={geo} material={mat} position={[0, 0, floor + H / 2]} />;
}

/** Haptic seats (Haptics system): a glow under each seat that follows the haptics route. */
export function HapticGlow() {
  const seats = useStudio((s) => s.model.seats);
  const on = useStudio((s) => s.model.config.systems.haptics.enabled);
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.CircleGeometry(0.32, 16), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    seats.forEach((x, i) => mesh.setMatrixAt(i, m.makeTranslation(x.position[0], x.position[1], x.position[2] + 0.02)));
    mesh.instanceMatrix.needsUpdate = true;
  }, [seats, on]);
  useFrame(() => {
    mat.opacity = Math.max(0, live.mod.haptics) * 0.9;
  });
  if (!on || !seats.length) return null;
  return <instancedMesh key={seats.length} ref={ref} args={[geo, mat, seats.length]} frustumCulled={false} />;
}

/** Light spilling from the screen onto the room: a soft fill in the content's average colour. */
export function ScreenSpill() {
  const ref = useRef<THREE.HemisphereLight>(null);
  useFrame(() => {
    const l = ref.current;
    const look = live.look;
    if (!l || !look) return;
    l.color.setRGB(live.average[0], live.average[1], live.average[2]);
    l.intensity = 0.3 * look.intensity * (1 + 0.3 * live.pulse);
  });
  return <hemisphereLight ref={ref} args={['#ffffff', '#000000', 0.5]} position={[0, 0, 1]} />;
}
