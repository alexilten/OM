import { STRATEGY_LABEL, strategyFor, type LedSummary } from '../engine/led';
import { getLedProduct, LED_PRODUCTS } from '../library/led';
import { formatLength } from '../engine/units';
import { DEVIATION_GRADIENT, DEVIATION_SCALE_MM, JOINT_CLASSES } from './ledColors';
import { isLayerVisible, useStudio } from './store';
import { NumberInput, ParamField, Segmented, Toggle, type FieldSpec } from './ui/ParamField';

const BAND: FieldSpec[] = [
  { path: 'led.bandElevationDeg', label: 'Band elevation', kind: 'angle', min: -20, max: 60, step: 0.5, tip: 'Centre latitude of the band of units.' },
  { path: 'led.bandRows', label: 'Band rows', kind: 'count', min: 1, max: 20, step: 1, tip: 'Unit rows in the band.' },
];

const STATUS_LABEL: Record<string, string> = { manufacturer: 'manufacturer data', secondary: 'secondary source', placeholder: 'placeholder data', conceptual: 'concept' };

const mm = (m: number) => `${(m * 1000).toFixed(m < 0.01 ? 1 : 0)} mm`;
const k = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString());

export function LedLegend() {
  const mode = useStudio((s) => s.ledColor);
  if (mode === 'deviation')
    return (
      <div className="led-legend">
        <span className="ramp" style={{ background: DEVIATION_GRADIENT }} />
        <span className="ends">
          <span>0 mm</span>
          <span>≥ {DEVIATION_SCALE_MM} mm from the sphere</span>
        </span>
      </div>
    );
  if (mode === 'joints')
    return (
      <div className="grade-legend">
        {JOINT_CLASSES.map((c) => (
          <span key={c.key}>
            <i style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    );
  return null;
}

function Comparison({ rows, current, units }: { rows: LedSummary[]; current: string; units: 'm' | 'ft' }) {
  const setParam = useStudio((s) => s.setParam);
  const R = useStudio((s) => s.config.sphere.radius);
  return (
    <div className="led-compare">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th title="Units on the screen">Units</th>
            <th title="Share of the ideal screen covered">Cover</th>
            <th title="Largest distance of a face from the sphere">Dev.</th>
            <th title="Meets its curvature limit at this radius">Fits</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const curvatureOk = r.minRadius <= R;
            return (
              <tr key={r.product.id} className={r.product.id === current ? 'current' : ''} onClick={() => setParam('led.productId', r.product.id)} title={`Use ${r.product.manufacturer} ${r.product.model}`}>
                <td className="name">
                  <span className="fam">{r.product.family.slice(0, 2)}</span>
                  {r.product.model}
                </td>
                <td>{k(r.count)}</td>
                <td>{(r.coverage * 100).toFixed(1)}%</td>
                <td>{mm(r.maxDeviation)}</td>
                <td className={curvatureOk ? 'ok' : 'bad'} title={curvatureOk ? '' : `Needs R ≥ ${formatLength(r.minRadius, units, 1)}`}>
                  {curvatureOk ? '✓' : `R ≥ ${formatLength(r.minRadius, units, 1)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint small">Click a row to switch product. Family 04–05 tiles are cut to the sphere, so they show no deviation but need a new tile type for every row.</p>
    </div>
  );
}

export function LedSection() {
  const led = useStudio((s) => s.config.led);
  const setParam = useStudio((s) => s.setParam);
  const summary = useStudio((s) => s.model.led);
  const comparison = useStudio((s) => s.ledComparison);
  const units = useStudio((s) => s.units);
  const R = useStudio((s) => s.config.sphere.radius);
  const ledColor = useStudio((s) => s.ledColor);
  const setLedColor = useStudio((s) => s.setLedColor);
  const setLedVisible = useStudio((s) => s.setLedVisible);
  const visible = useStudio((s) => isLayerVisible(s.layerVisible, '01_MEDIA/LED_Cabinets') || isLayerVisible(s.layerVisible, '01_MEDIA/LED_Modules'));
  const p = getLedProduct(led.productId)!;
  const tiles = strategyFor(p) === 'spherical-tiles';

  return (
    <>
      <Toggle checked={led.enabled} label="Generate LED system" onChange={(v) => setParam('led.enabled', v)} />
      <Toggle checked={visible} label="Show units in the viewport" onChange={setLedVisible} />
      <select value={led.productId} onChange={(e) => setParam('led.productId', e.target.value)}>
        {LED_PRODUCTS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.family.slice(0, 2)} · {x.manufacturer} {x.model}
          </option>
        ))}
      </select>
      <div className="led-facts">
        <span className={`badge ${p.cabinetWidth.status}`}>{STATUS_LABEL[p.cabinetWidth.status]}</span>
        <span>
          {(p.cabinetWidth.value * 1000).toFixed(0)} × {(p.cabinetHeight.value * 1000).toFixed(0)} mm · {(p.pixelPitch.value * 1000).toFixed(2)} mm pitch
        </span>
        <span className="strategy">{STRATEGY_LABEL[strategyFor(p)]}</span>
      </div>

      <div className="row-label">Extent</div>
      <Segmented
        value={led.extent}
        options={[
          { value: 'full', label: 'Full screen' },
          { value: 'band', label: 'Band' },
        ]}
        onChange={(v) => setParam('led.extent', v)}
      />
      {led.extent === 'band' && BAND.map((f) => <ParamField key={f.path} spec={f} />)}
      {!tiles && (
        <>
          <div className="row-label">Placement</div>
          <Segmented
            value={led.placement}
            options={[
              { value: 'tangent', label: 'Tangent' },
              { value: 'balanced', label: 'Balanced' },
            ]}
            onChange={(v) => setParam('led.placement', v)}
          />
        </>
      )}
      <div className="field">
        <div className="field-head">
          <label title="Design joint between neighbouring units. Rings keep at least this opening everywhere.">Joint gap</label>
          <div className="field-value">
            <NumberInput value={led.jointGap * 1000} step={0.1} onCommit={(v) => setParam('led.jointGap', Math.max(0, v) / 1000)} />
            <span className="unit">mm</span>
          </div>
        </div>
        <input type="range" min={0} max={10} step={0.5} value={led.jointGap * 1000} onChange={(e) => setParam('led.jointGap', Number(e.target.value) / 1000)} />
      </div>

      {summary && (
        <>
          <div className="coverage three led-stats">
            <div>
              <strong>{k(summary.count)}</strong>
              <span>{tiles ? `tiles · ${summary.unitTypes} types` : 'units · 1 type'}</span>
            </div>
            <div>
              <strong>{(summary.coverage * 100).toFixed(1)}%</strong>
              <span>screen covered</span>
            </div>
            <div>
              <strong>{mm(summary.maxDeviation)}</strong>
              <span>max deviation</span>
            </div>
            <div>
              <strong>{k(summary.resolutionH)}</strong>
              <span>× {k(summary.resolutionV)} px (widest row × rows)</span>
            </div>
            <div>
              <strong>{(summary.weightKg / 1000).toFixed(1)} t</strong>
              <span>units only</span>
            </div>
            <div>
              <strong>{(summary.powerMaxW / 1000).toFixed(0)} kW</strong>
              <span>max, {(summary.powerAvgW / 1000).toFixed(0)} kW average</span>
            </div>
          </div>
          {!tiles && (
            <p className="hint">
              Widest joint {mm(summary.maxGap)}, largest face step {mm(summary.maxStep)}, hinge {summary.maxJointH.toFixed(2)}° in rows and {summary.maxJointV.toFixed(2)}° between rows. Uncovered: {mm(summary.topStrip)} at the top, up to {mm(summary.sideStrip)} at row ends.
            </p>
          )}
          {tiles && summary.tileRange && (
            <p className="hint">
              Tiles run {mm(summary.tileRange.wMin)}–{mm(summary.tileRange.wMax)} wide and {mm(summary.tileRange.hMin)} tall; every row is its own type, made for R = {formatLength(R, units)}.
            </p>
          )}
        </>
      )}

      <div className="row-label">Colour units by</div>
      <Segmented
        value={ledColor}
        options={[
          { value: 'product', label: 'Product' },
          { value: 'deviation', label: 'Deviation' },
          { value: 'joints', label: 'Joints' },
        ]}
        onChange={setLedColor}
      />
      <LedLegend />

      {comparison && (
        <>
          <div className="row-label">All products on this screen</div>
          <Comparison rows={comparison} current={led.productId} units={units} />
        </>
      )}
    </>
  );
}
