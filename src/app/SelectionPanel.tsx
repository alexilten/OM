import type { Vec3 } from '../engine/types';
import { DEFAULT_ANALYSIS, GRADES, METRIC_INFO, type ImmersionMetricKey, type SeatAnalysis } from '../engine/immersion';
import { formatLength } from '../engine/units';
import { useStudio } from './store';

const fmt = (p: Vec3, u: 'm' | 'ft') => p.map((v) => formatLength(v, u, 3)).join(', ');

export function SelectionPanel() {
  const id = useStudio((s) => s.selectedId);
  const model = useStudio((s) => s.model);
  const units = useStudio((s) => s.units);
  const select = useStudio((s) => s.select);
  const viewFromSeat = useStudio((s) => s.viewFromSeat);
  const fov = useStudio((s) => s.fov);
  const setFov = useStudio((s) => s.setFov);
  const analysis = useStudio((s) => s.analysis);
  if (!id) return null;
  const o = model.objects.find((x) => x.id === id);
  if (!o) return null;
  const seat = model.seats.find((s) => s.id === id);
  return (
    <div className="selection">
      <div className="selection-head">
        <div>
          <div className="eyebrow">{o.category}</div>
          <div className="title">{seat ? `Row ${seat.row} · Seat ${seat.number}` : o.name.replace(/_/g, ' ')}</div>
        </div>
        <button className="ghost" onClick={() => select(null)}>
          ✕
        </button>
      </div>
      <dl>
        <dt>Layer</dt>
        <dd>{o.layer.replace('/', ' / ')}</dd>
        {seat && (
          <>
            <dt>Seat position</dt>
            <dd>{fmt(seat.position, units)}</dd>
            <dt>Eye point</dt>
            <dd>{fmt(seat.eyePoint, units)}</dd>
            <dt>Distance to origin</dt>
            <dd>{formatLength(seat.distanceFromOrigin, units)}</dd>
            <dt>Clearance to sphere</dt>
            <dd>{formatLength(seat.screenClearance, units)}</dd>
          </>
        )}
        {!seat &&
          Object.entries(o.metadata).map(([k, v]) => (
            <div key={k} className="kv">
              <dt>{k.replace(/_/g, ' ')}</dt>
              <dd>{typeof v === 'number' ? +v.toFixed(4) : v}</dd>
            </div>
          ))}
        {seat && (
          <>
            <dt>Product</dt>
            <dd>
              {o.metadata.manufacturer} {o.metadata.model}
            </dd>
          </>
        )}
      </dl>
      {seat && (
        <>
          <button className="primary block" onClick={() => viewFromSeat(seat.id)}>
            VIEW FROM THIS SEAT
          </button>
          <div className="field compact">
            <div className="field-head">
              <label title="Simulated perspective is an approximation of human vision; wide angles distort.">Camera FOV (vertical)</label>
              <span>{fov}°</span>
            </div>
            <input type="range" min={30} max={110} step={1} value={fov} onChange={(e) => setFov(Number(e.target.value))} />
          </div>
          {analysis?.seats.get(seat.id) && <SeatScore a={analysis.seats.get(seat.id)!} units={units} />}
        </>
      )}
    </div>
  );
}

const KEYS = Object.keys(METRIC_INFO) as ImmersionMetricKey[];

function measurement(k: ImmersionMetricKey, v: number, units: 'm' | 'ft') {
  if (!Number.isFinite(v)) return k === 'sightline' ? 'clear' : '—';
  const unit = METRIC_INFO[k].unit;
  if (unit === '%') return `${Math.round(v * 100)}%`;
  if (unit === 'm') return formatLength(v, units, 2);
  return `${v.toFixed(0)}°`;
}

/** Every number behind the seat's score: measurement, sub-score, normalised weight, contribution. */
function SeatScore({ a, units }: { a: SeatAnalysis; units: 'm' | 'ft' }) {
  const weights = useStudio((s) => s.config.analysis?.weights ?? DEFAULT_ANALYSIS.weights);
  const model = useStudio((s) => s.model);
  const select = useStudio((s) => s.select);
  const total = KEYS.reduce((t, k) => t + weights[k], 0) || 1;
  const grade = GRADES.find((g) => g.grade === a.grade)!;
  const blocker = a.blockingSeatId ? model.seats.find((s) => s.id === a.blockingSeatId) : undefined;
  return (
    <div className="seat-score">
      <div className="score-head">
        <span className="grade-chip" style={{ background: grade.color }}>
          {a.grade}
        </span>
        <strong>{a.score.toFixed(2)}</strong>
        <span className="hint small">immersion score</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
            <th>Score</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {KEYS.map((k) => (
            <tr key={k} title={METRIC_INFO[k].help}>
              <td>{METRIC_INFO[k].label}</td>
              <td>{measurement(k, a.measurements[k], units)}</td>
              <td>
                <span className="bar">
                  <i style={{ width: `${a.subScores[k] * 100}%` }} />
                </span>
                {a.subScores[k].toFixed(2)}
              </td>
              <td>{Math.round((weights[k] / total) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {blocker && (
        <p className="hint small">
          Sightline limited by{' '}
          <button className="link" onClick={() => select(blocker.id)}>
            row {blocker.row} seat {blocker.number}
          </button>
          .
        </p>
      )}
      {a.warnings.map((w) => (
        <div key={w} className="issue warning">
          {w}
        </div>
      ))}
    </div>
  );
}
