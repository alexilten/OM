import { useEffect, useState } from 'react';
import { OM_300_FLAGSHIP } from '../../engine/defaults';
import { fromDisplay, toDisplay } from '../../engine/units';
import { getPath, useStudio } from '../store';

export type FieldKind = 'length' | 'angle' | 'count' | 'value';

export interface FieldSpec {
  path: string;
  label: string;
  kind: FieldKind;
  min: number;
  max: number;
  step: number;
  tip: string;
  /** Unit label for kind 'value' (speeds, times). */
  unit?: string;
}

const unitLabel = (spec: FieldSpec, units: 'm' | 'ft') => (spec.kind === 'length' ? units : spec.kind === 'angle' ? '°' : (spec.unit ?? ''));

export function NumberInput({ value, onCommit, step, invalid }: { value: number; onCommit: (v: number) => void; step: number; invalid?: boolean }) {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  const [text, setText] = useState(value.toFixed(digits));
  useEffect(() => setText(value.toFixed(digits)), [value, digits]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v)) onCommit(v);
    else setText(value.toFixed(digits));
  };
  return (
    <input
      className={`num ${invalid ? 'invalid' : ''}`}
      value={text}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(value.toFixed(digits));
      }}
    />
  );
}

/** `mirror`: another path kept at the negated value (symmetric azimuths). */
export function ParamField({ spec, mirror }: { spec: FieldSpec; mirror?: string }) {
  const value = useStudio((s) => getPath(s.config, spec.path) as number);
  const units = useStudio((s) => s.units);
  const setParams = useStudio((s) => s.setParams);
  const setParam = (path: string, v: number) => setParams(mirror ? [[path, v], [mirror, -v]] : [[path, v]]);
  const resetParam = useStudio((s) => s.resetParam);
  const invalid = useStudio((s) => s.issues.some((i) => i.severity === 'error' && i.path === spec.path));
  const def = getPath(OM_300_FLAGSHIP, spec.path) as number;

  const isLen = spec.kind === 'length';
  const show = (v: number) => (isLen ? toDisplay(v, units) : v);
  const store = (v: number) => (isLen ? fromDisplay(v, units) : spec.kind === 'count' ? Math.round(v) : v);
  const { min, max } = spec;
  const step = isLen && units === 'ft' ? Math.max(spec.step / 0.3048, 0.01) : spec.step;

  return (
    <div className={`field ${invalid ? 'has-error' : ''}`}>
      <div className="field-head">
        <label title={spec.tip}>{spec.label}</label>
        <div className="field-value">
          <NumberInput value={show(value)} step={step} invalid={invalid} onCommit={(v) => setParam(spec.path, store(v))} />
          <span className="unit">{unitLabel(spec, units)}</span>
          <button className={`reset ${value === def ? 'hidden' : ''}`} title={`Reset to ${show(def).toFixed(2)}`} onClick={() => (mirror ? setParam(spec.path, def) : resetParam(spec.path))}>
            ↺
          </button>
        </div>
      </div>
      <input
        type="range"
        min={show(min)}
        max={show(max)}
        step={step}
        value={Math.min(show(max), Math.max(show(min), show(value)))}
        onChange={(e) => setParam(spec.path, store(Number(e.target.value)))}
      />
    </div>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="panel-section">
      <button className="section-title" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className={`chev ${open ? 'open' : ''}`}>›</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span>{label}</span>
    </label>
  );
}
