import { LayerPanel } from './LayerPanel';
import { MetricsPanel } from './MetricsPanel';
import { ParameterPanel } from './ParameterPanel';
import { SelectionPanel } from './SelectionPanel';
import { useStudio, type ViewName } from './store';
import { TopBar } from './TopBar';
import { Viewport } from './Viewport';

const VIEWS: { name: ViewName; label: string; title: string }[] = [
  { name: 'iso', label: 'Iso', title: 'Isometric' },
  { name: 'top', label: 'Top', title: 'Plan' },
  { name: 'front', label: 'Front', title: 'Looking forward (+Y)' },
  { name: 'side', label: 'Side', title: 'From the right (+X)' },
  { name: 'audience', label: 'Origin eye', title: 'Reference eye point at the sphere centre' },
];

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
  return (
    <div className="app">
      <TopBar />
      <main className="workspace">
        <LayerPanel />
        <div className="viewport">
          <Viewport />
          <ViewToolbar />
          <MetricsPanel />
          <SelectionPanel />
          <div className="coords-legend">
            <span className="x">X</span> right · <span className="y">Y</span> forward · <span className="z">Z</span> up · origin = sphere centre
          </div>
        </div>
        <ParameterPanel />
      </main>
    </div>
  );
}
