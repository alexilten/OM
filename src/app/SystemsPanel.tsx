import { AUDIO_PRODUCTS, catalogFor, getAudioProduct, getSystem, SEAT_TIER, SYSTEMS, TIERS, type CatalogCategory } from '../library/catalog';
import { SEATING_PRODUCTS } from '../library/seating';
import type { FitoutDefinition, SystemId, Tier } from '../engine/types';
import { useStudio } from './store';
import { Segmented, Toggle } from './ui/ParamField';

const FITOUT: { key: keyof FitoutDefinition; category: CatalogCategory; label: string }[] = [
  { key: 'riserDeck', category: 'riser-deck', label: 'Riser decks' },
  { key: 'guardrail', category: 'guardrail', label: 'Guardrails' },
  { key: 'seatAccessory', category: 'seat-accessory', label: 'Seat accessories' },
];

const TIER_LABEL = Object.fromEntries(TIERS.map((t) => [t.id, t.label])) as Record<Tier, string>;

export const money = (usd: number) => (usd >= 1e6 ? `$${(usd / 1e6).toFixed(2)} M` : `$${Math.round(usd / 1000).toLocaleString()} k`);

/** Seat product, fit-out items and system tiers for one package; systems keep their on/off and density. */
function packageEntries(tier: Tier, systems: Record<SystemId, unknown>, rowPitch: number): [string, unknown][] {
  const seat = SEATING_PRODUCTS.find((p) => SEAT_TIER[p.id] === tier);
  // A larger seat needs its row pitch, or the rows would overlap.
  const pitch = seat ? Math.max(rowPitch, seat.depth.value + seat.minClearway.value) : rowPitch;
  return [
    ...(seat ? [['seating.productId', seat.id] as [string, unknown], ['seating.rowPitch', pitch === rowPitch ? rowPitch : Math.max(pitch, seat.preferredRowPitch.value)] as [string, unknown]] : []),
    ...FITOUT.map(({ key, category }) => [`fitout.${key}`, catalogFor(category).find((i) => i.tier === tier)!.id] as [string, unknown]),
    ...Object.keys(systems).map((id) => [`systems.${id}.tier`, tier] as [string, unknown]),
  ];
}

export function FitoutSection() {
  const config = useStudio((s) => s.config);
  const summary = useStudio((s) => s.model.systems);
  const setParam = useStudio((s) => s.setParam);
  const setParams = useStudio((s) => s.setParams);
  const seatTier = SEAT_TIER[config.seating.productId];
  const tiers = [seatTier, ...FITOUT.map(({ key }) => catalogFor(FITOUT.find((f) => f.key === key)!.category).find((i) => i.id === config.fitout[key])?.tier), ...SYSTEMS.map((s) => config.systems[s.id].tier)];
  const current = tiers.every((t) => t === tiers[0]) ? tiers[0] : undefined;
  return (
    <>
      <div className="row-label">Package (seats, fit-out and every system tier)</div>
      <Segmented value={(current ?? '') as Tier} options={TIERS.map((t) => ({ value: t.id, label: t.label }))} onChange={(t) => setParams(packageEntries(t, config.systems, config.seating.rowPitch))} />
      <p className="hint small">Seat: {SEATING_PRODUCTS.find((p) => p.id === config.seating.productId)?.model} ({seatTier ? TIER_LABEL[seatTier] : 'unrated'}). Change it under Seating; a larger seat widens the row pitch.</p>
      {FITOUT.map(({ key, category, label }) => {
        const item = catalogFor(category).find((i) => i.id === config.fitout[key]);
        return (
          <div key={key} className="catalog-pick">
            <div className="row-label">{label}</div>
            <select value={config.fitout[key]} onChange={(e) => setParam(`fitout.${key}`, e.target.value)}>
              {catalogFor(category).map((i) => (
                <option key={i.id} value={i.id}>
                  {TIER_LABEL[i.tier]}: {i.name}
                </option>
              ))}
            </select>
            {item && (
              <p className="hint">
                {item.description} <span className={`badge ${item.cost.status}`}>${item.cost.value.toLocaleString()} / {item.unit === 'm2' ? 'm²' : item.unit}</span>
              </p>
            )}
          </div>
        );
      })}
      <div className="coverage three">
        <div>
          <strong>{Math.round(summary.fitout.deckArea)} m²</strong>
          <span>riser deck</span>
        </div>
        <div>
          <strong>{summary.fitout.guardrailLength.toFixed(1)} m</strong>
          <span>guardrail</span>
        </div>
        <div>
          <strong>{money(summary.fitout.cost)}</strong>
          <span>fit-out (placeholder)</span>
        </div>
      </div>
    </>
  );
}

export function SystemsSection() {
  const systems = useStudio((s) => s.config.systems);
  const summary = useStudio((s) => s.model.systems);
  const setParam = useStudio((s) => s.setParam);
  const audio = getAudioProduct(systems.audio.product ?? '');
  return (
    <>
      {SYSTEMS.map((spec) => {
        const s = systems[spec.id];
        const result = summary.systems.find((x) => x.id === spec.id);
        return (
          <div key={spec.id} className={`system-card ${s.enabled ? '' : 'off'}`}>
            <div className="system-head">
              <Toggle checked={s.enabled} label={spec.label} onChange={(v) => setParam(`systems.${spec.id}.enabled`, v)} />
              {result && (
                <span className="system-total" title="Units · power · placeholder cost">
                  {result.count.toLocaleString()} · {(result.power / 1000).toFixed(1)} kW · {money(result.cost)}
                </span>
              )}
            </div>
            {s.enabled && (
              <>
                <Segmented value={s.tier} options={TIERS.map((t) => ({ value: t.id, label: t.label }))} onChange={(t) => setParam(`systems.${spec.id}.tier`, t)} />
                <p className="hint">{getSystem(spec.id).tiers[s.tier].description}</p>
                {spec.id === 'audio' && (
                  <>
                    <div className="row-label">Array product</div>
                    <select value={s.product} onChange={(e) => setParam('systems.audio.product', e.target.value)}>
                      {AUDIO_PRODUCTS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    {audio && (
                      <p className="hint">
                        {audio.note} <span className={`badge ${audio.main.weight.status}`}>{audio.main.weight.status === 'manufacturer' ? 'datasheet' : audio.main.weight.status}</span>
                      </p>
                    )}
                  </>
                )}
                <div className="field-head">
                  <label title="Density multiplier on the tier's unit counts">Density</label>
                  <span className="unit">×{s.scale.toFixed(2)}</span>
                </div>
                <input type="range" min={0.5} max={2} step={0.05} value={s.scale} onChange={(e) => setParam(`systems.${spec.id}.scale`, Number(e.target.value))} aria-label={`${spec.label} density`} />
                {spec.id === 'lighting' && (
                  <>
                    <div className="field-head">
                      <label title="The overhead rig is one circular truss set into the slice just above the screen's top edge. It follows the radius and the top edge; this lowers it onto the screen.">Crown ring below top edge</label>
                      <span className="unit">{(s.crownDropDeg ?? 0).toFixed(0)}°</span>
                    </div>
                    <input type="range" min={0} max={20} step={1} value={s.crownDropDeg ?? 0} onChange={(e) => setParam('systems.lighting.crownDropDeg', Number(e.target.value))} aria-label="Crown ring below top edge" />
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
      <div className="coverage three">
        <div>
          <strong>{(summary.totals.power / 1000).toFixed(0)} kW</strong>
          <span>systems + fit-out</span>
        </div>
        <div>
          <strong>{summary.pickPoints}</strong>
          <span>pick-ups · {(summary.pickLoad / 1000).toFixed(1)} t hung</span>
        </div>
        <div>
          <strong>{money(summary.totals.cost)}</strong>
          <span>total (placeholder)</span>
        </div>
      </div>
      <p className="hint small">
        Units are placed by simple rules on 05_TECHNICAL layers so they can be counted, costed and hung from the Round 07 structure. Not a lighting or acoustic design: coverage comes from the manufacturers' tools. Overhead rigs hide {(summary.occlusion * 100).toFixed(1)} % of the screen.
      </p>
    </>
  );
}
