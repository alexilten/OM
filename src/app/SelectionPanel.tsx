import type { Vec3 } from '../engine/types';
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
          <p className="hint small">Immersion scoring and sightline analysis arrive in Round 02.</p>
        </>
      )}
    </div>
  );
}
