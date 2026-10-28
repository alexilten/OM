import { useEffect } from 'react';
import type { TransformationModel } from '../engine/kinetics';
import { useStudio } from './store';
import { ParamField, Segmented, Toggle, type FieldSpec } from './ui/ParamField';

const FIELDS: FieldSpec[] = [
  { path: 'transformation.nestOffset', label: 'Nest offset', kind: 'length', min: 0.05, max: 0.6, step: 0.01, tip: 'How far short of the row in front each wagon stops when nested (radial).' },
  { path: 'transformation.deckThickness', label: 'Deck thickness', kind: 'length', min: 0.04, max: 0.2, step: 0.005, tip: 'Structural depth of each wagon deck.' },
  { path: 'transformation.foldedSeatHeight', label: 'Folded seat height', kind: 'length', min: 0.1, max: 0.5, step: 0.01, tip: 'Seat height above its deck when folded flat for nesting.' },
  { path: 'transformation.wagonSpeed', label: 'Wagon speed', kind: 'value', unit: 'm/s', min: 0.02, max: 0.3, step: 0.01, tip: 'Travel speed of the telescopic wagons.' },
  { path: 'transformation.stageSpeed', label: 'Stage lift speed', kind: 'value', unit: 'm/s', min: 0.01, max: 0.2, step: 0.01, tip: 'Vertical speed of the stage lift.' },
  { path: 'transformation.clearanceHoldS', label: 'Clearance hold', kind: 'value', unit: 's', min: 0, max: 300, step: 5, tip: 'Interlock time: the house is confirmed empty before anything moves.' },
  { path: 'transformation.foldS', label: 'Seat fold time', kind: 'value', unit: 's', min: 0, max: 120, step: 5, tip: 'Time for every seat to fold flat before the wagons move.' },
];

export const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Where on the timeline a time falls: one of the two end states, or in transit. */
export function stateAt(tr: TransformationModel | undefined, t: number): 'seated' | 'standing' | 'transit' {
  if (!tr || t <= 0) return 'seated';
  return t >= tr.duration ? 'standing' : 'transit';
}

export function TransformSection() {
  const tr = useStudio((s) => s.config.transformation);
  const model = useStudio((s) => s.model.transformation);
  const setParam = useStudio((s) => s.setParam);
  const setTransformT = useStudio((s) => s.setTransformT);
  const select = useStudio((s) => s.select);
  return (
    <>
      <Toggle checked={tr.enabled} label="Transformable venue" onChange={(v) => setParam('transformation.enabled', v)} />
      {tr.enabled && (
        <>
          <div className="row-label">Seating</div>
          <Segmented
            value={tr.seating}
            options={[
              { value: 'telescopic', label: 'Telescopic wagons' },
              { value: 'fixed', label: 'Fixed' },
            ]}
            onChange={(v) => setParam('transformation.seating', v)}
          />
          <div className="row-label">Stage</div>
          <Segmented
            value={tr.stage}
            options={[
              { value: 'lift', label: 'Lift to floor' },
              { value: 'fixed', label: 'Fixed' },
            ]}
            onChange={(v) => setParam('transformation.stage', v)}
          />
          {FIELDS.filter((f) => tr.seating === 'telescopic' || !/nest|deck|folded|wagon|foldS/.test(f.path))
            .filter((f) => tr.stage === 'lift' || f.path !== 'transformation.stageSpeed')
            .map((f) => (
              <ParamField key={f.path} spec={f} />
            ))}
        </>
      )}
      {model && (
        <>
          <div className="coverage three">
            <div>
              <strong>{formatTime(model.duration)}</strong>
              <span>seated → standing</span>
            </div>
            <div>
              <strong>{model.assemblies.filter((a) => a.duration > 0).length}</strong>
              <span>moving assemblies</span>
            </div>
            <div>
              <strong>{model.standing.capacity}</strong>
              <span>standing ({Math.round(model.standing.area)} m²)</span>
            </div>
          </div>
          {model.conflicts.length > 0 ? (
            <div className="conflicts">
              <div className="row-label">{model.conflicts.length} conflicts</div>
              <ul>
                {model.conflicts.slice(0, 12).map((c, i) => (
                  <li
                    key={i}
                    onClick={() => {
                      setTransformT((c.t0 + c.t1) / 2);
                      select(c.a);
                    }}
                    title="Jump to this moment"
                  >
                    <span className="at">{formatTime(c.t0)}</span>
                    {c.message}
                  </li>
                ))}
              </ul>
              {model.conflicts.length > 12 && <p className="hint small">…and {model.conflicts.length - 12} more.</p>}
            </div>
          ) : (
            <p className="hint ok-note">No collisions: every path keeps clear of the other assemblies and the screen.</p>
          )}
          <p className="hint small">Machinery is conceptual: wagons, lifts and drives are not engineered. Paths are straight and shown on 04_TRANSFORMATION.</p>
        </>
      )}
    </>
  );
}

/** Advances the timeline while playing; mounted once. */
function usePlayback() {
  const playing = useStudio((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const { transformT, playRate, model, setTransformT, play } = useStudio.getState();
      const d = model.transformation?.duration ?? 0;
      const t = transformT + (playing * playRate * (now - last)) / 1000;
      last = now;
      setTransformT(t);
      if ((playing > 0 && t >= d) || (playing < 0 && t <= 0)) play(0);
      else raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

const STEP_SHORT: Record<string, string> = { interlock: 'Clear house', fold: 'Fold seats', move: 'Nest wagons', lift: 'Lower stage' };
const STEP_COLOR: Record<string, string> = { interlock: '#9aa0a6', fold: '#b48ead', move: '#1f5fbf', lift: '#e4572e' };

export function Timeline() {
  usePlayback();
  const tr = useStudio((s) => s.model.transformation);
  const t = useStudio((s) => s.transformT);
  const playing = useStudio((s) => s.playing);
  const rate = useStudio((s) => s.playRate);
  const play = useStudio((s) => s.play);
  const setT = useStudio((s) => s.setTransformT);
  const setRate = useStudio((s) => s.setPlayRate);
  if (!tr) return <div className="timeline empty">Turn on “Transformable venue” in the panel to animate seated ↔ standing.</div>;
  const d = tr.duration || 1;
  const pct = (x: number) => `${(x / d) * 100}%`;
  const state = stateAt(tr, t);
  const audienceClear = t >= tr.steps[0].duration;
  // Steps that run in parallel (wagons and stage lift) get their own lane.
  const lanes = tr.steps.map((s, i) => (tr.steps.slice(0, i).some((p) => p.start < s.start + s.duration - 1e-9 && s.start < p.start + p.duration - 1e-9) ? 1 : 0));
  const laneCount = Math.max(...lanes) + 1;
  return (
    <div className="timeline">
      <div className="tl-controls">
        <button className={state === 'seated' ? 'active' : ''} onClick={() => (play(0), setT(0))} title="Jump to the seated state">
          Seated
        </button>
        <button onClick={() => play(playing === -1 ? 0 : -1)} title="Play back towards seated">
          {playing === -1 ? '❚❚' : '◀'}
        </button>
        <button onClick={() => play(playing === 1 ? 0 : 1)} title="Play towards standing">
          {playing === 1 ? '❚❚' : '▶'}
        </button>
        <button className={state === 'standing' ? 'active' : ''} onClick={() => (play(0), setT(tr.duration))} title="Jump to the standing state">
          Standing
        </button>
        <span className="tl-time">
          {formatTime(t)} / {formatTime(tr.duration)}
        </span>
        <select value={rate} onChange={(e) => setRate(Number(e.target.value))} title="Playback speed">
          {[1, 5, 10, 30].map((r) => (
            <option key={r} value={r}>
              ×{r}
            </option>
          ))}
        </select>
        <span className={`tl-state ${state}`}>
          {state === 'transit' ? (audienceClear ? 'In transit · house empty' : 'Clearing the house · nothing moves') : state === 'seated' ? `Seated · ${useStudio.getState().model.seats.length} seats` : `Standing · ${tr.standing.capacity} people`}
        </span>
      </div>
      <div className="tl-track">
        {tr.steps.map((s, i) => (
          <div key={s.id} className="tl-step" style={{ left: pct(s.start), width: pct(s.duration), top: `${(lanes[i] * 100) / laneCount}%`, height: `${100 / laneCount}%`, background: STEP_COLOR[s.kind] }} title={`${s.label}: ${formatTime(s.start)}–${formatTime(s.start + s.duration)}`}>
            <span>{STEP_SHORT[s.kind]}</span>
          </div>
        ))}
        {tr.conflicts.map((c, i) => (
          <i key={i} className="tl-conflict" style={{ left: pct(c.t0), width: `max(2px, ${pct(c.t1 - c.t0)})` }} title={c.message} />
        ))}
        <input type="range" min={0} max={tr.duration} step={0.1} value={t} onChange={(e) => (play(0), setT(Number(e.target.value)))} aria-label="Transformation time" />
        <div className="tl-head" style={{ left: pct(t) }} />
      </div>
    </div>
  );
}
