/**
 * Display tessellation of engine geometry. These meshes are disposable views of the model —
 * nothing here feeds back into the configuration or the CAD export.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { spherePoint } from '../../engine/coordinates';
import type { BlockDefinition, Frame, Geometry, Vec3 } from '../../engine/types';

/** Spherical patch with UVs in (azimuth, elevation) space; normals point at the origin. */
export function spherePatchGeometry(R: number, az0: number, az1: number, el0: number, el1: number): THREE.BufferGeometry {
  const segU = Math.max(8, Math.ceil(((az1 - az0) * 180) / Math.PI / 1.5));
  const segV = Math.max(4, Math.ceil(((el1 - el0) * 180) / Math.PI / 1.5));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    const el = el0 + (el1 - el0) * v;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const p = spherePoint(R, az0 + (az1 - az0) * u, el);
      pos.push(...p);
      nor.push(-p[0] / R, -p[1] / R, -p[2] / R);
      uv.push(u, v);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++)
    for (let i = 0; i < segU; i++) {
      const a = j * row + i;
      // Wound so the front face looks towards the origin.
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function boxGeometry(min: Vec3, max: Vec3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  return g;
}

export function annularSectorGeometry(g: Extract<Geometry, { kind: 'annularSector' }>): THREE.BufferGeometry {
  const [cx, cy] = g.center;
  const shape = new THREE.Shape();
  const steps = Math.max(8, Math.ceil(((g.angle1 - g.angle0) * 180) / Math.PI / 2));
  const at = (r: number, a: number) => new THREE.Vector2(cx + r * Math.sin(a), cy - r * Math.cos(a));
  shape.moveTo(...at(g.outerRadius, g.angle0).toArray());
  for (let k = 1; k <= steps; k++) shape.lineTo(...at(g.outerRadius, g.angle0 + ((g.angle1 - g.angle0) * k) / steps).toArray());
  for (let k = steps; k >= 0; k--) shape.lineTo(...at(g.innerRadius, g.angle0 + ((g.angle1 - g.angle0) * k) / steps).toArray());
  const geo = new THREE.ExtrudeGeometry(shape, { depth: g.zTop - g.zBottom, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, g.zBottom);
  return geo;
}

export function frameMatrix(f: Frame): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    f.xAxis[0], f.yAxis[0], f.zAxis[0], f.origin[0],
    f.xAxis[1], f.yAxis[1], f.zAxis[1], f.origin[1],
    f.xAxis[2], f.yAxis[2], f.zAxis[2], f.origin[2],
    0, 0, 0, 1,
  );
}

export function blockGeometry(b: BlockDefinition): THREE.BufferGeometry {
  const parts = b.parts.map((p) => {
    if (p.geometry.kind !== 'box') throw new Error('Block parts must be boxes in Round 01');
    return boxGeometry(p.geometry.min, p.geometry.max);
  });
  return mergeGeometries(parts, false)!;
}

/** Sampled points for curve-like geometry (for line rendering). */
export function curvePoints(g: Geometry, steps = 128): Vec3[] {
  switch (g.kind) {
    case 'line':
      return [g.a, g.b];
    case 'polyline':
      return g.closed ? [...g.points, g.points[0]] : g.points;
    case 'circle':
      return Array.from({ length: steps + 1 }, (_, i) => {
        const t = (i / steps) * Math.PI * 2;
        return [g.center[0] + g.radius * Math.cos(t), g.center[1] + g.radius * Math.sin(t), g.center[2]] as Vec3;
      });
    case 'latitudeArc':
      return Array.from({ length: steps + 1 }, (_, i) => spherePoint(g.radius, g.azimuth0 + ((g.azimuth1 - g.azimuth0) * i) / steps, g.elevation));
    case 'meridianArc':
      return Array.from({ length: steps + 1 }, (_, i) => spherePoint(g.radius, g.azimuth, g.elevation0 + ((g.elevation1 - g.elevation0) * i) / steps));
    default:
      return [];
  }
}

/** Latitude / longitude wireframe of the reference sphere. */
export function sphereGraticule(R: number, stepDeg = 15): Vec3[][] {
  const lines: Vec3[][] = [];
  const d = Math.PI / 180;
  for (let el = -90 + stepDeg; el < 90; el += stepDeg)
    lines.push(Array.from({ length: 145 }, (_, i) => spherePoint(R, (i / 144) * Math.PI * 2, el * d)));
  for (let az = 0; az < 360; az += stepDeg)
    lines.push(Array.from({ length: 73 }, (_, i) => spherePoint(R, az * d, -Math.PI / 2 + (i / 72) * Math.PI)));
  return lines;
}

/** Calibration texture spanning the patch: 10° grid, 30° majors, horizon (φ = 0) and centre line (θ = 0). */
export function calibrationTexture(az0Deg: number, az1Deg: number, el0Deg: number, el1Deg: number): THREE.CanvasTexture {
  const W = 4096;
  const H = Math.max(512, Math.min(4096, Math.round((W * (el1Deg - el0Deg)) / (az1Deg - az0Deg)) * 2));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0d1b2e');
  grad.addColorStop(1, '#1d3550');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const x = (az: number) => ((az - az0Deg) / (az1Deg - az0Deg)) * W;
  const y = (el: number) => H - ((el - el0Deg) / (el1Deg - el0Deg)) * H;
  ctx.font = `${Math.round(H / 40)}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  for (let az = Math.ceil(az0Deg / 10) * 10; az <= az1Deg; az += 10) {
    const major = az % 30 === 0;
    ctx.strokeStyle = az === 0 ? '#f5b041' : major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = az === 0 ? 6 : major ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x(az), 0);
    ctx.lineTo(x(az), H);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`${az}°`, x(az) + 8, y(Math.max(el0Deg, 0)) - 10);
    }
  }
  for (let el = Math.ceil(el0Deg / 10) * 10; el <= el1Deg; el += 10) {
    const major = el % 30 === 0;
    ctx.strokeStyle = el === 0 ? '#f5b041' : major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = el === 0 ? 6 : major ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y(el));
    ctx.lineTo(W, y(el));
    ctx.stroke();
    if (major && el !== 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`${el}°`, x(0) + 8, y(el) - 10);
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
