/**
 * Canonical OM layer hierarchy. The viewport layer panel and the Rhino export both read this list,
 * so a layer exists in the .3dm even when it is empty in the current round.
 */
export interface LayerSpec {
  path: string; // "01_MEDIA/LED_Cabinets"
  color: [number, number, number];
}

const tree: [string, [number, number, number], string[]][] = [
  ['00_REFERENCE', [120, 120, 120], ['World_Origin', 'Sphere_Center', 'Reference_Sphere', 'Datums', 'Design_Envelope']],
  ['01_MEDIA', [30, 90, 200], ['Ideal_Spherical_Surface', 'LED_Cabinets', 'LED_Modules', 'LED_Structure', 'LED_Mounting', 'Service_Clearances', 'Proscenium']],
  ['02_AUDIENCE', [200, 120, 40], ['Seating_Banks', 'Seating_Tiers', 'Seating_Blocks', 'Seats', 'Aisles', 'Guardrails', 'Accessibility', 'Audience_Reference']],
  ['03_STAGE', [60, 60, 60], ['Main_Stage', 'Stage_Decking', 'Stage_Risers', 'Stage_Lifts', 'Scenic_Elements']],
  ['04_TRANSFORMATION', [150, 60, 170], ['Movable_Platforms', 'Seating_Mechanisms', 'Stage_Mechanisms', 'Movement_Envelopes', 'Storage_Volumes']],
  ['05_TECHNICAL', [40, 150, 120], ['Audio', 'Lighting', 'Rigging', 'AV_Equipment', 'Electrical', 'Technical_Access']],
  ['06_ARCHITECTURE', [160, 160, 150], ['Floor', 'Walls', 'Ceiling', 'Structure', 'Circulation', 'Building_Envelope']],
  ['07_ANALYSIS', [220, 40, 60], ['Eye_Points', 'Sightline_Rays', 'Viewing_Targets', 'Screen_Clearances', 'Mechanical_Clearances', 'FX_Safety_Volumes']],
  ['08_PRESENTATION', [100, 100, 100], ['Audience_People', 'Cameras', 'Presentation_Objects']],
];

export const ROOT_LAYER = 'OM_STUDIO';

export const LAYERS: LayerSpec[] = tree.flatMap(([group, color, children]) => [
  { path: group, color },
  ...children.map((c) => ({ path: `${group}/${c}`, color })),
]);

export const TOP_LEVEL_LAYERS = tree.map(([g]) => g);

export const topLevelOf = (path: string) => path.split('/')[0];

/** Rhino full path for an OM layer path, e.g. "OM_STUDIO::01_MEDIA::LED_Cabinets". */
export const rhinoLayerPath = (path: string) => [ROOT_LAYER, ...path.split('/')].join('::');
