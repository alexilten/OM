/**
 * Reference sphere + spherical media surface (subsystems 1–2 of the master plan).
 * The sphere centre is fixed at the world origin; nothing here reads the floor or seating, so
 * moving the floor or re-cropping the screen can never translate the sphere.
 */
import { AXIS_Z, toRad, WORLD_ORIGIN } from './coordinates';
import type { MediaSurfaceDefinition, Metric, VenueConfiguration, VenueObject } from './types';

export interface MediaBounds {
  R: number;
  az0: number;
  az1: number;
  el0: number;
  el1: number;
}

export function mediaBounds(radius: number, m: MediaSurfaceDefinition): MediaBounds {
  return {
    R: radius,
    az0: toRad(m.azimuthLeftDeg),
    az1: toRad(m.azimuthRightDeg),
    el0: toRad(m.elevationLowerDeg),
    el1: toRad(m.elevationUpperDeg),
  };
}

/** Exact area of the patch: R² Δθ (sin φ1 − sin φ0). */
export const patchArea = (b: MediaBounds) => b.R * b.R * (b.az1 - b.az0) * (Math.sin(b.el1) - Math.sin(b.el0));

/** Widest horizontal arc length of the patch (at the latitude closest to the equator). */
export function patchMaxWidth(b: MediaBounds): number {
  const el = b.el0 <= 0 && b.el1 >= 0 ? 0 : Math.min(Math.abs(b.el0), Math.abs(b.el1));
  return b.R * Math.cos(el) * (b.az1 - b.az0);
}

/** Horizontal radius of the sphere at height z (0 outside the sphere). */
export const sphereRadiusAt = (R: number, z: number) => (Math.abs(z) >= R ? 0 : Math.sqrt(R * R - z * z));

export function referenceObjects(c: VenueConfiguration): VenueObject[] {
  const R = c.sphere.radius;
  const f = c.floor.mainFloorElevation;
  const axisLen = R * 0.25;
  return [
    { id: 'ref.origin', name: 'World_Origin', layer: '00_REFERENCE/World_Origin', category: 'Datum', geometry: { kind: 'point', p: WORLD_ORIGIN }, metadata: { note: 'Sphere centre = reference eye point' } },
    { id: 'ref.axis.x', name: 'Axis_X', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'line', a: WORLD_ORIGIN, b: [axisLen, 0, 0] }, metadata: { axis: 'X (audience right)' } },
    { id: 'ref.axis.y', name: 'Axis_Y', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'line', a: WORLD_ORIGIN, b: [0, axisLen, 0] }, metadata: { axis: 'Y (forward / performance)' } },
    { id: 'ref.axis.z', name: 'Axis_Z', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'line', a: WORLD_ORIGIN, b: [0, 0, axisLen] }, metadata: { axis: 'Z (up)' } },
    { id: 'ref.sphere', name: 'Reference_Sphere', layer: '00_REFERENCE/Reference_Sphere', category: 'ReferenceSphere', geometry: { kind: 'sphere', center: WORLD_ORIGIN, radius: R }, metadata: { radius_m: R, diameter_m: 2 * R } },
    { id: 'ref.equator', name: 'Equator_Horizon', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'circle', center: WORLD_ORIGIN, normal: AXIS_Z, radius: R }, metadata: { elevation_m: 0, note: 'Sphere equator = nominal horizon at the reference eye point' } },
    { id: 'ref.floorline', name: 'Floor_Sphere_Intersection', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'circle', center: [0, 0, f], normal: AXIS_Z, radius: sphereRadiusAt(R, f) }, metadata: { elevation_m: f } },
  ];
}

export function mediaObjects(c: VenueConfiguration): VenueObject[] {
  const b = mediaBounds(c.sphere.radius, c.media);
  const meta = {
    radius_m: b.R,
    azimuth_left_deg: c.media.azimuthLeftDeg,
    azimuth_right_deg: c.media.azimuthRightDeg,
    elevation_lower_deg: c.media.elevationLowerDeg,
    elevation_upper_deg: c.media.elevationUpperDeg,
    area_m2: +patchArea(b).toFixed(4),
    representation: 'exact rational NURBS (sphere patch)',
  };
  const edge = '01_MEDIA/Ideal_Spherical_Surface';
  return [
    { id: 'media.ideal', name: 'Ideal_Media_Surface', layer: edge, category: 'IdealMediaSurface', geometry: { kind: 'spherePatch', radius: b.R, azimuth0: b.az0, azimuth1: b.az1, elevation0: b.el0, elevation1: b.el1 }, metadata: meta },
    { id: 'media.edge.lower', name: 'Media_Edge_Lower', layer: edge, category: 'MediaEdge', geometry: { kind: 'latitudeArc', radius: b.R, elevation: b.el0, azimuth0: b.az0, azimuth1: b.az1 }, metadata: {} },
    { id: 'media.edge.upper', name: 'Media_Edge_Upper', layer: edge, category: 'MediaEdge', geometry: { kind: 'latitudeArc', radius: b.R, elevation: b.el1, azimuth0: b.az0, azimuth1: b.az1 }, metadata: {} },
    { id: 'media.edge.left', name: 'Media_Edge_Left', layer: edge, category: 'MediaEdge', geometry: { kind: 'meridianArc', radius: b.R, azimuth: b.az0, elevation0: b.el0, elevation1: b.el1 }, metadata: {} },
    { id: 'media.edge.right', name: 'Media_Edge_Right', layer: edge, category: 'MediaEdge', geometry: { kind: 'meridianArc', radius: b.R, azimuth: b.az1, elevation0: b.el0, elevation1: b.el1 }, metadata: {} },
  ];
}

export function mediaMetrics(c: VenueConfiguration): Metric[] {
  const b = mediaBounds(c.sphere.radius, c.media);
  const R = b.R;
  return [
    { key: 'sphere.radius', label: 'Sphere radius', value: R, unit: 'm', quality: 'exact', group: 'Geometry' },
    { key: 'sphere.diameter', label: 'Sphere diameter', value: 2 * R, unit: 'm', quality: 'exact', group: 'Geometry' },
    { key: 'sphere.circumference', label: 'Equatorial circumference', value: 2 * Math.PI * R, unit: 'm', quality: 'exact', group: 'Geometry' },
    { key: 'media.hcoverage', label: 'Horizontal coverage', value: c.media.azimuthRightDeg - c.media.azimuthLeftDeg, unit: 'deg', quality: 'exact', group: 'Media' },
    { key: 'media.vcoverage', label: 'Vertical coverage', value: c.media.elevationUpperDeg - c.media.elevationLowerDeg, unit: 'deg', quality: 'exact', group: 'Media' },
    { key: 'media.width', label: 'Screen width (max arc)', value: patchMaxWidth(b), unit: 'm', quality: 'exact', group: 'Media' },
    { key: 'media.height', label: 'Screen height (meridian arc)', value: R * (b.el1 - b.el0), unit: 'm', quality: 'exact', group: 'Media' },
    { key: 'media.area', label: 'Screen surface area', value: patchArea(b), unit: 'm2', quality: 'exact', group: 'Media' },
    { key: 'media.bottomZ', label: 'Lower edge elevation', value: R * Math.sin(b.el0), unit: 'm', quality: 'exact', group: 'Media' },
    { key: 'media.topZ', label: 'Upper edge elevation', value: R * Math.sin(b.el1), unit: 'm', quality: 'exact', group: 'Media' },
    { key: 'geometry.horizonAboveFloor', label: 'Horizon above main floor', value: -c.floor.mainFloorElevation, unit: 'm', quality: 'exact', group: 'Geometry' },
  ];
}
