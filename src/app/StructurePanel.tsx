import { SHIPPING, STRUCTURE_SYSTEMS, TIERS } from '../library/catalog';
import { useStudio } from './store';
import { money } from './SystemsPanel';
import { ParamField, Toggle, type FieldSpec } from './ui/ParamField';

const FIELDS: FieldSpec[] = [
  { path: 'structure.ribSpacing', label: 'Rib spacing', kind: 'length', min: 1, max: 6, step: 0.1, tip: 'Target distance between ribs along the equator; ribs stay evenly spaced across the screen.' },
  { path: 'structure.ringSpacing', label: 'Ring spacing', kind: 'length', min: 1, max: 6, step: 0.1, tip: 'Target distance between ring girders measured along a rib.' },
  { path: 'structure.mountGap', label: 'LED mounting gap', kind: 'length', min: 0, max: 0.4, step: 0.01, tip: 'Gap between the back of the LED and the front of the ribs (brackets and adjustment).' },
  { path: 'structure.maxSegment', label: 'Shipping segment', kind: 'length', min: 2, max: 13.5, step: 0.1, tip: 'Longest piece shipped and lifted in one go; every member is split into equal segments no longer than this.' },
];

const TIER_LABEL = Object.fromEntries(TIERS.map((t) => [t.id, t.label]));
const SHIP_LABEL: Record<string, string> = { ...Object.fromEntries(SHIPPING.map((s) => [s.id, s.label])), oversize: 'Oversize' };
const CARRIER_LABEL: Record<string, string> = { 'pick-beam': 'Pick beams behind the screen', crown: 'Crown grid in the oculus', ring: 'Ring girders (arrays in bays)', roof: 'Building roof', unsupported: 'Nothing (unsupported)' };

export function StructureSection() {
  const st = useStudio((s) => s.config.structure);
  const summary = useStudio((s) => s.model.structure);
  const setParam = useStudio((s) => s.setParam);
  const sys = STRUCTURE_SYSTEMS.find((x) => x.id === st.system);
  const carriers = new Map<string, { n: number; load: number }>();
  for (const p of summary?.picks ?? []) {
    const k = carriers.get(p.carrier) ?? { n: 0, load: 0 };
    carriers.set(p.carrier, { n: k.n + 1, load: k.load + p.load });
  }
  const heaviest = summary ? Math.max(...summary.segments.map((x) => x.weight)) : 0;
  return (
    <>
      <Toggle checked={st.enabled} label="Support structure" onChange={(v) => setParam('structure.enabled', v)} />
      {st.enabled && (
        <>
          <div className="row-label">System</div>
          <select value={st.system} onChange={(e) => setParam('structure.system', e.target.value)}>
            {STRUCTURE_SYSTEMS.map((x) => (
              <option key={x.id} value={x.id}>
                {TIER_LABEL[x.tier]}: {x.name}
              </option>
            ))}
          </select>
          {sys && <p className="hint">{sys.description}</p>}
          {FIELDS.map((f) => (
            <ParamField key={f.path} spec={f} />
          ))}
          <Toggle checked={st.walkways} label="Service walkways" onChange={(v) => setParam('structure.walkways', v)} />
        </>
      )}
      {summary && (
        <>
          <div className="coverage three">
            <div>
              <strong>{summary.ribs} × {summary.rings}</strong>
              <span>ribs × rings</span>
            </div>
            <div>
              <strong>{summary.segments.length}</strong>
              <span>segments · {summary.splices} splices</span>
            </div>
            <div>
              <strong>{(summary.steelWeight / 1000).toFixed(1)} t</strong>
              <span>structure</span>
            </div>
            <div>
              <strong>{((summary.hungLoad + summary.ledLoad) / 1000).toFixed(1)} t</strong>
              <span>LED + hung load</span>
            </div>
            <div>
              <strong>{(Math.max(...summary.ribReactions) / 1000).toFixed(1)} t</strong>
              <span>max rib reaction</span>
            </div>
            <div>
              <strong>{money(summary.cost)}</strong>
              <span>{summary.installDays} days to erect</span>
            </div>
          </div>
          <div className="row-label">Logistics</div>
          <p className="hint">
            {Object.entries(summary.shipping)
              .map(([k, n]) => `${n} × ${SHIP_LABEL[k] ?? k}`)
              .join(' · ')}
            . Heaviest piece {Math.round(heaviest)} kg; {summary.cranePicks} lifts; {Math.round(summary.walkwayLength)} m of service walkway.
          </p>
          <div className="row-label">Pick-up schedule</div>
          <table className="pick-table">
            <tbody>
              {[...carriers].map(([k, v]) => (
                <tr key={k} className={k === 'unsupported' ? 'bad' : ''}>
                  <td>{CARRIER_LABEL[k]}</td>
                  <td>{v.n}</td>
                  <td>{(v.load / 1000).toFixed(1)} t</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint small">Conceptual structure: sections, weights and costs are placeholders and loads are summed, not analysed. Ribs follow the media surface, so changing the radius or screen extent regenerates every piece.</p>
        </>
      )}
    </>
  );
}
