/**
 * LED preview band (Round 01 stand-in for the Round 03 panelization engine).
 *
 * Flat cabinets of true size are placed tangent to the sphere at their centres, in a few rows
 * around one latitude. Adjacent cabinets meet at their front edges along the latitude and the
 * meridian; corners stand proud of the ideal surface, which is reported as deviation. Nothing is
 * stretched to fit.
 */
import { getLedProduct } from '../library/led';
import { spherePoint, toDeg, toRad } from './coordinates';
import { mediaBounds } from './media';
import type { BlockDefinition, Frame, Issue, LedProduct, Metric, VenueConfiguration, VenueObject } from './types';

export const ledBlockId = (productId: string) => `block.led.${productId}`;

export function ledBlock(p: LedProduct): BlockDefinition {
  const w = p.cabinetWidth.value;
  const h = p.cabinetHeight.value;
  const d = p.cabinetDepth.value;
  return {
    id: ledBlockId(p.id),
    name: `LED_${p.manufacturer}_${p.model}`.replace(/[^A-Za-z0-9_]+/g, '_'),
    description: `${p.manufacturer} ${p.model} cabinet envelope ${(w * 1000).toFixed(0)} × ${(h * 1000).toFixed(0)} × ${(d * 1000).toFixed(0)} mm. Local origin = front face centre, +Z = display normal (towards audience).`,
    parts: [
      { role: 'led-face', geometry: { kind: 'box', min: [-w / 2, -h / 2, -0.004], max: [w / 2, h / 2, 0] } },
      { role: 'led-body', geometry: { kind: 'box', min: [-w / 2, -h / 2, -d], max: [w / 2, h / 2, -0.004] } },
    ],
    metadata: {
      manufacturer: p.manufacturer,
      product_family: p.productFamily,
      model: p.model,
      cabinet_w_m: w,
      cabinet_h_m: h,
      cabinet_d_m: d,
      pixel_pitch_mm: +(p.pixelPitch.value * 1000).toFixed(3),
      dims_status: p.cabinetWidth.status,
      revision: p.revision,
    },
  };
}

export interface LedPreviewResult {
  objects: VenueObject[];
  blocks: BlockDefinition[];
  metrics: Metric[];
  issues: Issue[];
}

export function generateLedPreview(c: VenueConfiguration): LedPreviewResult {
  const empty: LedPreviewResult = { objects: [], blocks: [], metrics: [], issues: [] };
  if (!c.ledPreview.enabled) return empty;
  const p = getLedProduct(c.ledPreview.productId)!;
  const b = mediaBounds(c.sphere.radius, c.media);
  const R = b.R;
  const w = p.cabinetWidth.value;
  const h = p.cabinetHeight.value;
  const block = ledBlock(p);
  const objects: VenueObject[] = [];

  const dEl = 2 * Math.atan(h / 2 / R);
  const center = toRad(c.ledPreview.bandElevationDeg);
  const n = c.ledPreview.bandRows;
  let count = 0;
  for (let j = 0; j < n; j++) {
    const el = center + (j - (n - 1) / 2) * dEl;
    if (el - dEl / 2 < b.el0 - 1e-9 || el + dEl / 2 > b.el1 + 1e-9) continue;
    const rho = R * Math.cos(el);
    const dAz = 2 * Math.atan(w / 2 / rho);
    const k = Math.floor((b.az1 - b.az0) / dAz + 1e-9);
    const mid = (b.az0 + b.az1) / 2;
    for (let i = 0; i < k; i++) {
      const az = mid + (i - (k - 1) / 2) * dAz;
      const o = spherePoint(R, az, el);
      const zAxis: Frame['zAxis'] = [-o[0] / R, -o[1] / R, -o[2] / R];
      const xAxis: Frame['xAxis'] = [Math.cos(az), -Math.sin(az), 0];
      const yAxis: Frame['yAxis'] = [
        zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1],
        zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2],
        zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0],
      ];
      count++;
      objects.push({
        id: `led.r${j}.c${String(i).padStart(3, '0')}`,
        name: `LED_R${j}_C${i}`,
        layer: '01_MEDIA/LED_Cabinets',
        category: 'LEDCabinet',
        geometry: { kind: 'blockInstance', blockId: block.id, frame: { origin: o, xAxis, yAxis, zAxis } },
        parentAssembly: 'led.preview',
        operatingState: 'all',
        metadata: { product_id: p.id, band_row: j, column: i, azimuth_deg: +toDeg(az).toFixed(4), elevation_deg: +toDeg(el).toFixed(4) },
      });
    }
  }

  // Tangent-plane cabinet: its corners stand off the sphere by sqrt(R² + (w/2)² + (h/2)²) − R.
  const deviation = Math.sqrt(R * R + (w / 2) ** 2 + (h / 2) ** 2) - R;
  const jointAngle = toDeg(2 * Math.atan(w / 2 / R));
  const issues: Issue[] = [];
  if (p.family === '01-faceted' || p.family === '02-single-axis-curved') {
    issues.push({
      severity: 'warning',
      code: 'led-compound',
      message: `${p.model} curves about one axis only. A sphere needs ≈${jointAngle.toFixed(2)}° between cabinets in both directions; the second direction relies on custom mounting (unverified).`,
      path: 'ledPreview.productId',
    });
  }
  if (p.curveConcaveDeg && jointAngle > p.curveConcaveDeg.value)
    issues.push({ severity: 'error', code: 'led-curvature', message: `Required joint angle ${jointAngle.toFixed(2)}° exceeds ${p.model}'s ${p.curveConcaveDeg.value}° concave limit. Increase the radius or choose smaller modules.`, path: 'sphere.radius' });

  const px = p.pixelsX.value * p.pixelsY.value;
  const metrics: Metric[] = [
    { key: 'led.product', label: 'LED system (preview band)', value: `${p.manufacturer} ${p.model}`, quality: p.cabinetWidth.status === 'manufacturer' ? 'derived' : 'conceptual', group: 'LED' },
    { key: 'led.cabinets', label: 'Cabinets in preview band', value: count, unit: 'count', quality: 'exact', group: 'LED' },
    { key: 'led.pixels', label: 'Pixels in preview band', value: count * px, unit: 'px', quality: 'derived', group: 'LED' },
    { key: 'led.pitch', label: 'Pixel pitch', value: +(p.pixelPitch.value * 1000).toFixed(3), unit: '', quality: p.pixelPitch.status === 'manufacturer' ? 'exact' : 'conceptual', group: 'LED' },
    { key: 'led.weight', label: 'Cabinet weight (band, excl. structure)', value: count * p.weightKg.value, unit: 'kg', quality: 'estimate', group: 'LED' },
    { key: 'led.power', label: 'Max power (band)', value: count * p.powerMaxW.value, unit: 'W', quality: 'estimate', group: 'LED' },
    { key: 'led.deviation', label: 'Max corner deviation from sphere', value: deviation, unit: 'm', quality: 'exact', group: 'LED' },
    { key: 'led.joint', label: 'Inter-cabinet angle required', value: jointAngle, unit: 'deg', quality: 'exact', group: 'LED' },
  ];
  return { objects, blocks: [block], metrics, issues };
}
