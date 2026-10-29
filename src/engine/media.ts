/**
 * Reference sphere + spherical media surface (subsystems 1–2 of the master plan).
 * The sphere centre is fixed at the world origin; nothing here reads the floor or seating, so
 * moving the floor or re-cropping the screen can never translate the sphere.
 */
import { AXIS_Z, toRad, WORLD_ORIGIN } from './coordinates';
import type { MediaSurfaceDefinition, Metric, VenueConfiguration, VenueObject } from './types';

export interface MediaBounds {
  R: number;
  /** Torus ring radius (0 = sphere). */
  ring: number;
  az0: number;
  az1: number;
  el0: number;
  el1: number;
}

/** Torus ring radius of a configuration (0 for the sphere form). */
export const ringOf = (c: VenueConfiguration) => c.sphere.ringRadius ?? 0;

export function mediaBounds(radius: number, m: MediaSurfaceDefinition, ring = 0): MediaBounds {
  return {
    R: radius,
    ring,
    az0: toRad(m.azimuthLeftDeg),
    az1: toRad(m.azimuthRightDeg),
    el0: toRad(m.elevationLowerDeg),
    el1: toRad(m.elevationUpperDeg),
  };
}

/** Exact area of the patch: R Δθ [a Δφ + R (sin φ1 − sin φ0)] (a = 0 on the sphere). */
export const patchArea = (b: MediaBounds) => b.R * (b.az1 - b.az0) * (b.ring * (b.el1 - b.el0) + b.R * (Math.sin(b.el1) - Math.sin(b.el0)));

/** Widest horizontal arc length of the patch (at the latitude closest to the equator). */
export function patchMaxWidth(b: MediaBounds): number {
  const el = b.el0 <= 0 && b.el1 >= 0 ? 0 : Math.min(Math.abs(b.el0), Math.abs(b.el1));
  return (b.ring + b.R * Math.cos(el)) * (b.az1 - b.az0);
}

/**
 * Horizontal radius of the screen surface at height z: the sphere, or the outer side of the torus
 * (ring + √(R² − z²)). Outside the tube's height range it is the ring radius (0 on the sphere).
 */
export const sphereRadiusAt = (R: number, z: number, ring = 0) => (Math.abs(z) >= R ? ring : ring + Math.sqrt(R * R - z * z));

export function referenceObjects(c: VenueConfiguration): VenueObject[] {
  const R = c.sphere.radius;
  const ring = ringOf(c);
  const f = c.floor.mainFloorElevation;
  const axisLen = R * 0.25;
  return [
    { id: 'ref.origin', name: 'World_Origin', layer: '00_REFERENCE/World_Origin', category: 'Datum', geometry: { kind: 'point', p: WORLD_ORIGIN }, metadata: { note: 'Sphere centre = reference eye point' } },
    { id: 'ref.axis.x', name: 'Axis_X', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'line', a: WORLD_ORIGIN, b: [axisLen, 0, 0] }, metadata: { axis: 'X (audience right)' } },
    { id: 'ref.axis.y', name: 'Axis_Y', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'line', a: WORLD_ORIGIN, b: [0, axisLen, 0] }, metadata: { axis: 'Y (forward / performance)' } },
    { id: 'ref.axis.z', name: 'Axis_Z', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'line', a: WORLD_ORIGIN, b: [0, 0, axisLen] }, metadata: { axis: 'Z (up)' } },
    { id: 'ref.sphere', name: 'Reference_Sphere', layer: '00_REFERENCE/Reference_Sphere', category: 'ReferenceSphere', geometry: { kind: 'sphere', center: WORLD_ORIGIN, radius: R, ...(ring ? { ring } : {}) }, metadata: ring ? { form: 'torus', tube_radius_m: R, ring_radius_m: ring, outer_diameter_m: 2 * (ring + R) } : { radius_m: R, diameter_m: 2 * R } },
    { id: 'ref.equator', name: 'Equator_Horizon', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'circle', center: WORLD_ORIGIN, normal: AXIS_Z, radius: ring + R }, metadata: { elevation_m: 0, note: 'Sphere equator = nominal horizon at the reference eye point' } },
    { id: 'ref.floorline', name: 'Floor_Sphere_Intersection', layer: '00_REFERENCE/Datums', category: 'Datum', geometry: { kind: 'circle', center: [0, 0, f], normal: AXIS_Z, radius: sphereRadiusAt(R, f, ring) }, metadata: { elevation_m: f } },
  ];
}

export function mediaObjects(c: VenueConfiguration): VenueObject[] {
  const b = mediaBounds(c.sphere.radius, c.media, ringOf(c));
  const r = b.ring ? { ring: b.ring } : {};
  const meta = {
    radius_m: b.R,
    ...(b.ring ? { ring_radius_m: b.ring } : {}),
    azimuth_left_deg: c.media.azimuthLeftDeg,
    azimuth_right_deg: c.media.azimuthRightDeg,
    elevation_lower_deg: c.media.elevationLowerDeg,
    elevation_upper_deg: c.media.elevationUpperDeg,
    area_m2: +patchArea(b).toFixed(4),
    representation: b.ring ? 'exact rational NURBS (torus patch)' : 'exact rational NURBS (sphere patch)',
  };
  const edge = '01_MEDIA/Ideal_Spherical_Surface';
  return [
    { id: 'media.ideal', name: 'Ideal_Media_Surface', layer: edge, category: 'IdealMediaSurface', geometry: { kind: 'spherePatch', radius: b.R, azimuth0: b.az0, azimuth1: b.az1, elevation0: b.el0, elevation1: b.el1, ...r }, metadata: meta },
    { id: 'media.edge.lower', name: 'Media_Edge_Lower', layer: edge, category: 'MediaEdge', geometry: { kind: 'latitudeArc', radius: b.R, elevation: b.el0, azimuth0: b.az0, azimuth1: b.az1, ...r }, metadata: {} },
    { id: 'media.edge.upper', name: 'Media_Edge_Upper', layer: edge, category: 'MediaEdge', geometry: { kind: 'latitudeArc', radius: b.R, elevation: b.el1, azimuth0: b.az0, azimuth1: b.az1, ...r }, metadata: {} },
    { id: 'media.edge.left', name: 'Media_Edge_Left', layer: edge, category: 'MediaEdge', geometry: { kind: 'meridianArc', radius: b.R, azimuth: b.az0, elevation0: b.el0, elevation1: b.el1, ...r }, metadata: {} },
    { id: 'media.edge.right', name: 'Media_Edge_Right', layer: edge, category: 'MediaEdge', geometry: { kind: 'meridianArc', radius: b.R, azimuth: b.az1, elevation0: b.el0, elevation1: b.el1, ...r }, metadata: {} },
  ];
}

export function mediaMetrics(c: VenueConfiguration): Metric[] {
  const b = mediaBounds(c.sphere.radius, c.media, ringOf(c));
  const R = b.R;
  const torus: Metric[] = b.ring
    ? [
        { key: 'sphere.ring', label: 'Torus ring radius', value: b.ring, unit: 'm', quality: 'exact', group: 'Geometry' },
        { key: 'sphere.opening', label: 'Top opening diameter', value: 2 * (b.ring + R * Math.cos(b.el1)), unit: 'm', quality: 'exact', group: 'Geometry' },
      ]
    : [];
  return [
    { key: 'sphere.radius', label: b.ring ? 'Tube radius' : 'Sphere radius', value: R, unit: 'm', quality: 'exact', group: 'Geometry' },
    { key: 'sphere.diameter', label: b.ring ? 'Torus outer diameter' : 'Sphere diameter', value: 2 * (b.ring + R), unit: 'm', quality: 'exact', group: 'Geometry' },
    { key: 'sphere.circumference', label: 'Equatorial circumference', value: 2 * Math.PI * (b.ring + R), unit: 'm', quality: 'exact', group: 'Geometry' },
    ...torus,
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
