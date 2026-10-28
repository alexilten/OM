import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Frame, Geometry, VenueObject } from '../../engine/types';
import { getVideoPreset, hexToRgb } from '../../show/presets';
import { SHOW_FRAGMENT, SHOW_VERTEX } from '../../show/shaders';
import { getAudio, getVideo, live, useShow } from '../../show/store';
import { beatPhase, pulse as pulseOf, safeSubdivision } from '../../show/timing';
import { useStudio } from '../store';
import { frameMatrix, spherePatchGeometry } from './threeGeometry';

const MODES = { canvas: 0, equirect: 1, dome: 2 } as const;

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

/** The media surface playing the show: a generated look or a video, mapped by azimuth and elevation. */
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

  useFrame((_, dt) => {
    const s = useShow.getState();
    const u = material.uniforms;
    // The audio clock drives everything while playing; when stopped the looks keep drifting slowly.
    idle.current += dt;
    const t = s.playing ? getAudio().time() : idle.current;
    const sub = s.reducedMotion ? 0 : safeSubdivision(s.tempo.bpm, 1);
    const ph = beatPhase(t, s.tempo);
    const beat = s.playing && sub ? pulseOf(ph.phase) * s.pulse : 0;
    const bands = s.playing ? getAudio().bands() : { bass: 0, mid: 0, high: 0, rms: 0 };
    live.time = t;
    live.beat = ph.beat;
    live.bar = Math.floor(ph.beat / 4);
    live.pulse = beat;
    live.bands = bands;
    u.uTime.value = s.reducedMotion ? t * 0.3 : t;
    u.uBeat.value = beat;
    u.uBar.value = live.bar;
    u.uBass.value = bands.bass * s.pulse;
    u.uMid.value = bands.mid;
    u.uHigh.value = bands.high;
    u.uIntensity.value = s.intensity;
    u.uMode.value = MODES[s.mapping];
    u.uBounds.value.set(g.azimuth0, g.azimuth1, g.elevation0, g.elevation1);
    const pal = s.palette.map(hexToRgb);
    [u.uPalette0, u.uPalette1, u.uPalette2].forEach((p, i) => (p.value as THREE.Color).setRGB(...pal[i % pal.length]));
    if (videoTex) {
      u.uUseVideo.value = true;
      u.uVideo.value = videoTex;
      sample(performance.now());
    } else {
      u.uUseVideo.value = false;
      u.uLook.value = getVideoPreset(s.video.kind === 'preset' ? s.video.id : 'nebula')?.look ?? 0;
      // Generated looks: zone colours come from the palette, rotating one step per bar.
      for (let z = 0; z < 8; z++) live.zones[z] = pal[(z + live.bar) % pal.length];
      live.average = [0, 1, 2].map((k) => pal.reduce((a, c) => a + c[k], 0) / pal.length) as [number, number, number];
    }
    if (s.playing && Math.abs(t - s.time) > 0.1) useShow.setState({ time: t });
  });

  return <mesh geometry={geo} material={material} />;
}

/** Beams from every lighting fixture, coloured by the screen zone in front of them and pulsed on the beat. */
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

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const s = useShow.getState();
    const on = s.lights !== 'off';
    const az0 = (mb.azimuthLeftDeg * Math.PI) / 180;
    const az1 = (mb.azimuthRightDeg * Math.PI) / 180;
    const pal = s.palette.map(hexToRgb);
    fixtures.forEach((o, i) => {
      const f = (o.geometry as { frame: Frame }).frame;
      const length = seatView && o.metadata.rig === 'base ring' ? 0 : o.metadata.rig === 'base ring' ? 6 : 9;
      m.copy(bases[i]).multiply(new THREE.Matrix4().makeScale(length, length, length));
      mesh.setMatrixAt(i, m);
      const az = Math.atan2(f.origin[0], f.origin[1]);
      const zone = Math.max(0, Math.min(7, Math.floor(((az - az0) / (az1 - az0)) * 8)));
      const c = s.lights === 'palette' ? pal[(i + live.bar) % pal.length] : live.zones[zone];
      // Beam visibility grows with haze; the pulse never flashes faster than the safe subdivision.
      const k = on ? (0.05 + 0.25 * s.haze) * (0.45 + 0.9 * live.pulse + 0.4 * live.bands.bass) * s.intensity * (seatView ? 0.35 : 1) : 0;
      color.setRGB(c[0] * k, c[1] * k, c[2] * k);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (!fixtures.length) return null;
  return <instancedMesh key={fixtures.length} ref={ref} args={[geo, mat, fixtures.length]} frustumCulled={false} />;
}
