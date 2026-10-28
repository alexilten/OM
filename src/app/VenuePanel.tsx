import { useEffect, useMemo, useState } from 'react';
import { analyzeFit } from '../engine/building';
import { analyzeImmersion } from '../engine/immersion';
import { tryGenerateVenue } from '../engine/model';
import { buildPreset, matchesPreset, PERFORMANCE_PRESETS, SIZE_PRESETS, VENUE_PRESETS } from '../engine/presets';
import type { VenueConfiguration } from '../engine/types';
import { formatLength } from '../engine/units';
import { formatTime } from './TransformPanel';
import { useStudio } from './store';
import { ParamField, Segmented, Toggle, type FieldSpec } from './ui/ParamField';

// ─── Project: alternatives ──────────────────────────────────────────────────

export function ProjectPanel({ onCompare }: { onCompare: () => void }) {
  const project = useStudio((s) => s.project);
  const select = useStudio((s) => s.selectAlternative);
  const duplicate = useStudio((s) => s.duplicateActive);
  const remove = useStudio((s) => s.deleteAlternative);
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="project-panel">
      <div className="panel-heading">Alternatives</div>
      <ul className="alternatives">
        {project.alternatives.map((a) => (
          <li key={a.id} className={a.id === project.activeId ? 'active' : ''} onClick={() => select(a.id)}>
            <span className="alt-name">{a.name}</span>
            {project.alternatives.length > 1 &&
              (confirm === a.id ? (
                <button
                  className="alt-delete confirm"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(a.id);
                    setConfirm(null);
                  }}
                  onMouseLeave={() => setConfirm(null)}
                >
                  Delete?
                </button>
              ) : (
                <button
                  className="alt-delete"
                  title="Delete this alternative"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirm(a.id);
                  }}
                >
                  ×
                </button>
              ))}
          </li>
        ))}
      </ul>
      <div className="alt-actions">
        <button className="ghost" onClick={duplicate} title="Copy the current alternative to try a change">
          Duplicate
        </button>
        <button className="ghost" onClick={onCompare} disabled={project.alternatives.length < 2} title={project.alternatives.length < 2 ? 'Duplicate or add a preset to have something to compare' : 'Compare every alternative side by side'}>
          Compare
        </button>
      </div>
      <p className="hint small">Saved in this browser as you work. Save downloads the current alternative; Open adds a file as a new one.</p>
    </div>
  );
}

// ─── Presets ────────────────────────────────────────────────────────────────

export function PresetSection() {
  const config = useStudio((s) => s.config);
  const applyPreset = useStudio((s) => s.applyPreset);
  const addPreset = useStudio((s) => s.addPreset);
  const [size, setSize] = useState(config.preset?.size ?? 'om-300');
  const [perf, setPerf] = useState(config.preset?.performance ?? 'cinematic');
  useEffect(() => {
    if (config.preset) {
      setSize(config.preset.size);
      setPerf(config.preset.performance);
    }
  }, [config.id, config.preset]);
  const edited = config.preset && !matchesPreset(config);
  const sizeInfo = SIZE_PRESETS.find((p) => p.id === size)!;
  const perfInfo = PERFORMANCE_PRESETS.find((p) => p.id === perf)!;
  return (
    <>
      <div className="row-label">Named venues</div>
      <div className="venue-presets">
        {VENUE_PRESETS.map((v) => (
          <button
            key={v.id}
            className={config.preset?.size === v.size && config.preset?.performance === v.performance ? 'current' : ''}
            onClick={() => {
              setSize(v.size);
              setPerf(v.performance);
              applyPreset(v.size, v.performance, v.name);
            }}
            title={`Apply ${v.name} to this alternative`}
          >
            {v.name}
          </button>
        ))}
      </div>
      <div className="row-label">Size</div>
      <Segmented value={size} options={SIZE_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={setSize} />
      <p className="hint">
        {sizeInfo.description} R = {sizeInfo.radius} m, about {sizeInfo.target} seats.
      </p>
      <div className="row-label">Performance</div>
      <select value={perf} onChange={(e) => setPerf(e.target.value)}>
        {PERFORMANCE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <p className="hint">{perfInfo.description}</p>
      <div className="alt-actions">
        <button className="primary-soft" onClick={() => applyPreset(size, perf)} title="Replace this alternative's design with the preset (the building stays)">
          Apply here
        </button>
        <button className="ghost" onClick={() => addPreset(size, perf)} title="Keep this alternative and add the preset as a new one">
          Add as alternative
        </button>
      </div>
      {config.preset && (
        <p className="hint small">
          Started from {SIZE_PRESETS.find((p) => p.id === config.preset!.size)?.label} · {PERFORMANCE_PRESETS.find((p) => p.id === config.preset!.performance)?.label}
          {edited ? ', edited since.' : '.'} Presets are starting points, not guaranteed capacities; all five use the same engine.
        </p>
      )}
    </>
  );
}

// ─── Building fit ───────────────────────────────────────────────────────────

const BUILDING: FieldSpec[] = [
  { path: 'building.width', label: 'Clear width (X)', kind: 'length', min: 15, max: 80, step: 0.5, tip: 'Inside width between wall faces.' },
  { path: 'building.depth', label: 'Clear depth (Y)', kind: 'length', min: 15, max: 80, step: 0.5, tip: 'Inside depth between wall faces.' },
  { path: 'building.clearHeight', label: 'Clear height', kind: 'length', min: 6, max: 40, step: 0.1, tip: 'Structural floor to the underside of the roof structure.' },
  { path: 'building.floorElevation', label: 'Structural floor', kind: 'length', min: -10, max: 0, step: 0.05, tip: 'Top of the existing floor, relative to the sphere centre.' },
  { path: 'building.offsetX', label: 'Venue offset X', kind: 'length', min: -20, max: 20, step: 0.25, tip: 'Building centre relative to the sphere centre, across.' },
  { path: 'building.offsetY', label: 'Venue offset Y', kind: 'length', min: -20, max: 20, step: 0.25, tip: 'Building centre relative to the sphere centre, front–back.' },
  { path: 'building.circulationWidth', label: 'Circulation walkway', kind: 'length', min: 0, max: 5, step: 0.1, tip: 'Clear walkway kept between the design envelope and the walls.' },
];
const COLUMNS: FieldSpec[] = [
  { path: 'building.columns.spacingX', label: 'Column spacing X', kind: 'length', min: 3, max: 40, step: 0.5, tip: 'Centre-to-centre spacing across.' },
  { path: 'building.columns.spacingY', label: 'Column spacing Y', kind: 'length', min: 3, max: 40, step: 0.5, tip: 'Centre-to-centre spacing front–back.' },
  { path: 'building.columns.size', label: 'Column size', kind: 'length', min: 0.2, max: 2, step: 0.05, tip: 'Square column section.' },
];

export function BuildingSection() {
  const config = useStudio((s) => s.config);
  const fit = useStudio((s) => s.model.fit);
  const units = useStudio((s) => s.units);
  const setParam = useStudio((s) => s.setParam);
  const b = config.building;
  // Which size presets would fit this building with the current performance arrangement.
  const sizes = useMemo(
    () =>
      b.enabled
        ? SIZE_PRESETS.map((p) => {
            const c = buildPreset(p.id, config.preset?.performance ?? 'cinematic', config);
            return { p, fits: analyzeFit(c).fits };
          })
        : [],
    [config, b.enabled],
  );
  return (
    <>
      <Toggle checked={b.enabled} label="Place in an existing building" onChange={(v) => setParam('building.enabled', v)} />
      {b.enabled && (
        <>
          {fit && (
            <div className={`fit-summary ${fit.fits ? 'ok' : 'bad'}`}>
              <strong>{fit.fits ? 'Fits' : 'Does not fit'}</strong>
              <span>Largest sphere this building takes: R = {formatLength(fit.maxRadius, units)}</span>
            </div>
          )}
          {fit && (
            <ul className="fit-checks">
              {fit.checks.map((k) => (
                <li key={k.key} className={k.ok ? 'ok' : k.blocking ? 'bad' : 'warn'}>
                  <i>{k.ok ? '✓' : k.blocking ? '✕' : '!'}</i>
                  <div>
                    <span>{k.label}</span>
                    <small>{k.detail}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {fit && fit.maxRadius > 3 && Math.abs(fit.maxRadius - config.sphere.radius) > 0.05 && (
            <button className="ghost" onClick={() => setParam('sphere.radius', Math.floor(fit.maxRadius * 10) / 10)} title="Set the sphere radius to the largest this building takes">
              Fit sphere to building (R = {formatLength(Math.floor(fit.maxRadius * 10) / 10, units, 1)})
            </button>
          )}
          {sizes.length > 0 && (
            <div className="size-fits">
              {sizes.map(({ p, fits }) => (
                <span key={p.id} className={fits ? 'ok' : 'bad'}>
                  {p.label} {fits ? 'fits' : 'does not fit'}
                </span>
              ))}
            </div>
          )}
          {BUILDING.map((f) => (
            <ParamField key={f.path} spec={f} />
          ))}
          <div className="row-label">Columns</div>
          <Segmented
            value={b.columns.layout}
            options={[
              { value: 'none', label: 'None' },
              { value: 'perimeter', label: 'Perimeter' },
              { value: 'grid', label: 'Grid' },
            ]}
            onChange={(v) => setParam('building.columns.layout', v)}
          />
          {b.columns.layout !== 'none' && COLUMNS.map((f) => <ParamField key={f.path} spec={f} />)}
          <p className="hint small">Geometric feasibility only: not structural, fire, egress, accessibility or code review.</p>
        </>
      )}
    </>
  );
}

// ─── Compare ────────────────────────────────────────────────────────────────

interface Row {
  c: VenueConfiguration;
  seats?: number;
  standing?: number;
  premium?: number;
  average?: number;
  led?: number;
  transform?: number;
  fits?: boolean;
  error?: string;
}

function summarize(c: VenueConfiguration): Row {
  const r = tryGenerateVenue(c);
  if (!r.model) return { c, error: r.issues.find((i) => i.severity === 'error')?.message ?? 'Invalid' };
  const m = r.model;
  const a = analyzeImmersion(m, c.analysis);
  return {
    c,
    seats: m.seats.length,
    standing: Number(m.metrics.find((x) => x.key === 'aud.standing')?.value ?? 0),
    premium: a.premiumCount,
    average: a.average,
    led: m.led?.count,
    transform: m.transformation?.duration,
    fits: m.fit?.fits,
  };
}

export function CompareView({ onClose }: { onClose: () => void }) {
  const project = useStudio((s) => s.project);
  const select = useStudio((s) => s.selectAlternative);
  const units = useStudio((s) => s.units);
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    setRows(null);
    // Each alternative regenerates in ~0.1–0.3 s; let the overlay paint first.
    const t = setTimeout(() => setRows(project.alternatives.map(summarize)), 30);
    return () => clearTimeout(t);
  }, [project.alternatives]);
  const best = (key: keyof Row) => (rows ? Math.max(...rows.map((r) => (typeof r[key] === 'number' ? (r[key] as number) : -Infinity))) : NaN);
  const cell = (r: Row, key: keyof Row, text: string) => <td className={typeof r[key] === 'number' && r[key] === best(key) && rows!.length > 1 ? 'best' : ''}>{text}</td>;
  return (
    <div className="compare-overlay" onClick={onClose}>
      <div className="compare" onClick={(e) => e.stopPropagation()}>
        <div className="compare-head">
          <div>
            <div className="eyebrow">Project</div>
            <div className="title">Compare alternatives</div>
          </div>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {!rows ? (
          <p className="hint">Regenerating {project.alternatives.length} alternatives…</p>
        ) : (
          <div className="compare-scroll">
            <table>
              <thead>
                <tr>
                  <th>Alternative</th>
                  <th>Sphere R</th>
                  <th>Seats</th>
                  <th title="At or above the premium immersion threshold">Premium</th>
                  <th title="Average immersion score (design heuristic)">Immersion</th>
                  <th title="Conceptual standing capacity, not occupancy">Standing</th>
                  <th>LED units</th>
                  <th>Seated → standing</th>
                  <th>Building</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.c.id}
                    className={r.c.id === project.activeId ? 'current' : ''}
                    onClick={() => {
                      select(r.c.id);
                      onClose();
                    }}
                  >
                    <td className="name">{r.c.name}</td>
                    <td>{formatLength(r.c.sphere.radius, units, 1)}</td>
                    {r.error ? (
                      <td colSpan={7} className="bad">
                        {r.error}
                      </td>
                    ) : (
                      <>
                        {cell(r, 'seats', String(r.seats))}
                        {cell(r, 'premium', String(r.premium))}
                        {cell(r, 'average', r.average!.toFixed(2))}
                        {cell(r, 'standing', String(r.standing))}
                        <td>{r.led?.toLocaleString() ?? 'off'}</td>
                        <td>{r.transform !== undefined ? formatTime(r.transform) : 'fixed'}</td>
                        <td className={r.fits === undefined ? '' : r.fits ? 'ok' : 'bad'}>{r.fits === undefined ? 'none' : r.fits ? 'fits' : 'does not fit'}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint small">Every alternative is regenerated from its saved configuration with the same engine. Click a row to open it. Highlighted: the highest value in each column.</p>
          </div>
        )}
      </div>
    </div>
  );
}
