import { useRef, useState } from 'react';
import { exportRhinoFile, openConfiguration, saveConfiguration } from './fileActions';
import { Segmented } from './ui/ParamField';
import { useStudio, type Workspace } from './store';
import { stateAt } from './TransformPanel';

const WORKSPACES: { id: Workspace; round?: string }[] = [
  { id: 'DESIGN' },
  { id: 'EXPERIENCE', round: 'Round 05' },
  { id: 'TRANSFORM' },
  { id: 'ANALYZE' },
  { id: 'EXPORT', round: 'Round 06' },
];

export function TopBar() {
  const config = useStudio((s) => s.config);
  const model = useStudio((s) => s.model);
  const invalid = useStudio((s) => s.invalid);
  const units = useStudio((s) => s.units);
  const setUnits = useStudio((s) => s.setUnits);
  const setParam = useStudio((s) => s.setParam);
  const loadConfig = useStudio((s) => s.loadConfig);
  const workspace = useStudio((s) => s.workspace);
  const setWorkspace = useStudio((s) => s.setWorkspace);
  // The export follows the timeline: standing only when the scrubber sits at the standing end.
  const exportState = useStudio((s) => (stateAt(s.model.transformation, s.transformT) === 'standing' ? 'standing' : 'seated'));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 4000);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">OM</span>
        <span className="product">STUDIO</span>
      </div>
      <nav className="workspaces">
        {WORKSPACES.map((w) => (
          <button key={w.id} className={w.id === workspace ? 'active' : ''} disabled={!!w.round} title={w.round ? `Arrives in ${w.round}` : undefined} onClick={() => setWorkspace(w.id)}>
            {w.id}
          </button>
        ))}
      </nav>
      <div className="project">
        <input className="project-name" value={config.name} onChange={(e) => setParam('name', e.target.value)} aria-label="Project name" />
      </div>
      <div className="actions">
        {status && <span className="status">{status}</span>}
        <Segmented
          value={units}
          options={[
            { value: 'm', label: 'm' },
            { value: 'ft', label: 'ft' },
          ]}
          onChange={setUnits}
        />
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          Open
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              loadConfig(await openConfiguration(f));
              flash(`Opened ${f.name}`);
            } catch (err) {
              flash(`Could not open: ${(err as Error).message}`);
            }
          }}
        />
        <button className="ghost" onClick={() => saveConfiguration(config)}>
          Save
        </button>
        <button
          className="primary"
          disabled={busy || invalid}
          title={invalid ? 'Fix the configuration errors first' : `Export the ${exportState} state as a Rhino 3DM file`}
          onClick={async () => {
            setBusy(true);
            try {
              // Export the analysis only when it belongs to the current model (it lags edits by ~150 ms).
              const { analysis } = useStudio.getState();
              const m = await exportRhinoFile(model, analysis && analysis.seats.size === model.seats.length ? analysis : undefined, exportState);
              flash(`Exported ${m.state} state · ${m.objectCount} objects · ${m.seatCount} seats`);
            } catch (err) {
              flash(`Export failed: ${(err as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Exporting…' : exportState === 'standing' ? 'EXPORT RHINO · STANDING' : 'EXPORT RHINO'}
        </button>
      </div>
    </header>
  );
}
