import { useState } from 'react';
import type { Metric } from '../engine/types';
import { formatArea, formatLength } from '../engine/units';
import { useStudio } from './store';

const MM_KEYS = new Set(['led.deviation', 'led.gap', 'led.overlap', 'led.step']);
const QUALITY_LABEL = { exact: 'exact', derived: 'derived', estimate: 'est.', conceptual: 'concept' } as const;

function formatMetric(m: Metric, units: 'm' | 'ft'): string {
  if (typeof m.value === 'string') return m.unit === 'm' && units === 'm' ? `${m.value} m` : m.value;
  switch (m.unit) {
    case 'm':
      return MM_KEYS.has(m.key) ? `${(m.value * 1000).toFixed(1)} mm` : formatLength(m.value, units);
    case 'm2':
      return formatArea(m.value, units);
    case 'deg':
      return `${m.value.toFixed(m.value % 1 ? 2 : 0)}°`;
    case 'kg':
      return `${(m.value / 1000).toFixed(2)} t`;
    case 'W':
      return `${(m.value / 1000).toFixed(1)} kW`;
    case 'px':
      return `${(m.value / 1e6).toFixed(1)} MP`;
    case 'count':
      return m.value.toLocaleString();
    default:
      return m.key === 'led.pitch' ? `${m.value} mm` : String(m.value);
  }
}

const GROUPS: Metric['group'][] = ['Audience', 'Media', 'Geometry', 'LED', 'Transformation', 'Architecture'];
const HEADLINE = ['aud.seats', 'media.hcoverage', 'media.area', 'sphere.diameter'];

export function MetricsPanel() {
  const metrics = useStudio((s) => s.model.metrics);
  const units = useStudio((s) => s.units);
  const analysis = useStudio((s) => s.analysis);
  const [open, setOpen] = useState(false);
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  return (
    <div className={`metrics ${open ? 'open' : ''}`}>
      <div className="metrics-headline">
        {HEADLINE.map((k) => {
          const m = byKey.get(k)!;
          return (
            <div key={k} className="headline">
              <strong>{formatMetric(m, units)}</strong>
              <span>{m.label}</span>
            </div>
          );
        })}
        {analysis && (
          <div className="headline" title="Average immersion score (design heuristic) and seats at or above the premium threshold">
            <strong>
              {analysis.average.toFixed(2)} · {analysis.premiumCount}
            </strong>
            <span>Immersion avg · premium</span>
          </div>
        )}
        <button className="ghost" onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'All metrics'}
        </button>
      </div>
      {open && (
        <div className="metrics-body">
          {GROUPS.map((g) => (
            <div key={g} className="metric-group">
              <div className="metric-group-title">{g}</div>
              {metrics
                .filter((m) => m.group === g)
                .map((m) => (
                  <div key={m.key} className="metric">
                    <span className="label">{m.label}</span>
                    <span className="value">{formatMetric(m, units)}</span>
                    <span className={`quality ${m.quality}`}>{QUALITY_LABEL[m.quality]}</span>
                  </div>
                ))}
            </div>
          ))}
          <p className="hint small">“est.” and “concept” values are not engineering results. Standing capacity is not a certified occupancy.</p>
        </div>
      )}
    </div>
  );
}
