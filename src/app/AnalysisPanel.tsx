import { useState } from 'react';
import { DEFAULT_ANALYSIS, GRADES, METRIC_INFO, type ImmersionMetricKey } from '../engine/immersion';
import { fitCapacity } from '../engine/capacity';
import { useStudio } from './store';
import { NumberInput, Toggle } from './ui/ParamField';

const KEYS = Object.keys(METRIC_INFO) as ImmersionMetricKey[];

export function GradeLegend() {
  return (
    <div className="grade-legend">
      {GRADES.map((g) => (
        <span key={g.grade}>
          <i style={{ background: g.color }} />
          {g.grade}
        </span>
      ))}
    </div>
  );
}

export function AnalysisSection() {
  const analysis = useStudio((s) => s.analysis);
  const heatmap = useStudio((s) => s.heatmap);
  const setHeatmap = useStudio((s) => s.setHeatmap);
  const weights = useStudio((s) => s.config.analysis?.weights ?? DEFAULT_ANALYSIS.weights);
  const setParam = useStudio((s) => s.setParam);
  const seatCount = useStudio((s) => s.model.seats.length);
  const total = KEYS.reduce((a, k) => a + weights[k], 0) || 1;
  return (
    <>
      <Toggle checked={heatmap} label="Immersion heatmap" onChange={setHeatmap} />
      {analysis && (
        <>
          <div className="coverage three">
            <div>
              <strong>{analysis.average.toFixed(2)}</strong>
              <span>average score</span>
            </div>
            <div>
              <strong>{analysis.premiumCount}</strong>
              <span>premium seats ({seatCount ? Math.round((analysis.premiumCount / seatCount) * 100) : 0}%)</span>
            </div>
            <div>
              <strong>{analysis.warningCount}</strong>
              <span>with warnings</span>
            </div>
          </div>
          <div className="grade-bar" title="Seats per grade">
            {GRADES.map((g) => {
              const n = analysis.gradeCounts[g.grade];
              return n ? <span key={g.grade} style={{ flex: n, background: g.color }} title={`${g.grade}: ${n}`} /> : null;
            })}
          </div>
          <GradeLegend />
        </>
      )}
      <div className="row-label">Weights</div>
      {KEYS.map((k) => (
        <div key={k} className="weight-row">
          <label title={METRIC_INFO[k].help}>{METRIC_INFO[k].label}</label>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={weights[k]}
            onChange={(e) => setParam(`analysis.weights.${k}`, Number(e.target.value))}
            aria-label={`${METRIC_INFO[k].label} weight`}
          />
          <span className="pct">{Math.round((weights[k] / total) * 100)}%</span>
        </div>
      ))}
      <button className="ghost small" onClick={() => setParam('analysis', DEFAULT_ANALYSIS)}>
        Reset weights
      </button>
      <p className="hint small">
        A transparent design heuristic, not a validated standard. Each metric maps to 0–1 by a published ramp (see the seat panel); weights are normalised.
      </p>
    </>
  );
}

export function CapacityTarget() {
  const config = useStudio((s) => s.config);
  const loadConfig = useStudio((s) => s.loadConfig);
  const seats = useStudio((s) => s.model.seats.length);
  const [target, setTarget] = useState(300);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="capacity">
      <div className="field-head">
        <label title="Searches row count and fan angle for the layout with the best average immersion that reaches this capacity.">Target capacity</label>
        <div className="field-value">
          <NumberInput value={target} step={1} onCommit={(v) => setTarget(Math.round(v))} />
          <button
            className="ghost small"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setMsg(null);
              // Let the button repaint before the ~1 s search.
              setTimeout(() => {
                const r = fitCapacity(config, target, config.analysis ?? DEFAULT_ANALYSIS);
                if (r.ok && r.config) loadConfig(r.config);
                setMsg({ ok: r.ok, text: r.message });
                setBusy(false);
              }, 30);
            }}
          >
            {busy ? 'Fitting…' : 'Fit'}
          </button>
        </div>
      </div>
      <div className="hint small">Currently {seats} seats.</div>
      {msg && <div className={`issue ${msg.ok ? 'info' : 'warning'}`}>{msg.text}</div>}
    </div>
  );
}
