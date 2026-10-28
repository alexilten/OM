import { GradeLegend } from './AnalysisPanel';
import { LayerPanel } from './LayerPanel';
import { LedLegend } from './LedPanel';
import { MetricsPanel } from './MetricsPanel';
import { ParameterPanel } from './ParameterPanel';
import { SelectionPanel } from './SelectionPanel';
import { useStudio, type ViewName } from './store';
import { TopBar } from './TopBar';
import { ShowPanel } from './ShowPanel';
import { Timeline } from './TransformPanel';
import { CompareView } from './VenuePanel';
import { useState } from 'react';
import { Viewport } from './Viewport';

const VIEWS: { name: ViewName; label: string; title: string }[] = [
  { name: 'iso', label: 'Iso', title: 'Isometric' },
  { name: 'top', label: 'Top', title: 'Plan' },
  { name: 'front', label: 'Front', title: 'Looking forward (+Y)' },
  { name: 'side', label: 'Side', title: 'From the right (+X)' },
  { name: 'audience', label: 'Origin eye', title: 'Reference eye point at the sphere centre' },
];

function HeatLegend() {
  const heatmap = useStudio((s) => s.heatmap);
  const ledColor = useStudio((s) => s.ledColor);
  if (!heatmap && ledColor === 'product') return null;
  return (
    <div className="heat-legend">
      {heatmap && (
        <>
          <div className="row-label">Immersion score by seat</div>
          <GradeLegend />
        </>
      )}
      {ledColor !== 'product' && (
        <>
          <div className="row-label">{ledColor === 'deviation' ? 'LED deviation from the ideal sphere' : 'LED joints (widest gap or step)'}</div>
          <LedLegend />
        </>
      )}
    </div>
  );
}

function ViewToolbar() {
  const request = useStudio((s) => s.requestView);
  const seatView = useStudio((s) => s.seatView);
  const seat = useStudio((s) => (seatView ? s.model.seats.find((x) => x.id === seatView.seatId) : undefined));
  return (
    <div className="view-toolbar">
      {VIEWS.map((v) => (
        <button key={v.name} title={v.title} onClick={() => request(v.name)}>
          {v.label}
        </button>
      ))}
      {seat && <span className="seat-badge">Seat {seat.row}{seat.number} eye point</span>}
    </div>
  );
}

export function App() {
  const transform = useStudio((s) => s.workspace === 'TRANSFORM');
  const show = useStudio((s) => s.workspace === 'EXPERIENCE');
  const [compare, setCompare] = useState(false);
  return (
    <div className="app">
      <TopBar />
      <main className="workspace">
        {show ? <ShowPanel /> : <ParameterPanel />}
        <div className={`viewport ${transform ? 'transform-mode' : ''}`}>
          <Viewport />
          <ViewToolbar />
          <MetricsPanel />
          <SelectionPanel />
          <HeatLegend />
          {transform && <Timeline />}
          <div className="coords-legend">
            <span className="x">X</span> right · <span className="y">Y</span> forward · <span className="z">Z</span> up · origin = sphere centre
          </div>
        </div>
        <LayerPanel onCompare={() => setCompare(true)} />
      </main>
      {compare && <CompareView onClose={() => setCompare(false)} />}
    </div>
  );
}
