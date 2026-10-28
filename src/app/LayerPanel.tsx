import { useMemo, useState } from 'react';
import { LAYERS, TOP_LEVEL_LAYERS } from '../engine/layers';
import { isLayerVisible, useStudio } from './store';
import { ProjectPanel } from './VenuePanel';

export function LayerPanel({ onCompare }: { onCompare: () => void }) {
  const model = useStudio((s) => s.model);
  const vis = useStudio((s) => s.layerVisible);
  const toggle = useStudio((s) => s.toggleLayer);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '01_MEDIA': true, '02_AUDIENCE': true });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const o of model.objects) {
      c[o.layer] = (c[o.layer] ?? 0) + 1;
      const top = o.layer.split('/')[0];
      c[top] = (c[top] ?? 0) + 1;
    }
    return c;
  }, [model]);

  return (
    <aside className="panel left">
      <ProjectPanel onCompare={onCompare} />
      <div className="panel-heading">Layers</div>
      <div className="layer-tree">
        {TOP_LEVEL_LAYERS.map((top) => {
          const children = LAYERS.filter((l) => l.path.startsWith(`${top}/`) && counts[l.path]);
          const color = LAYERS.find((l) => l.path === top)!.color;
          return (
            <div key={top} className={`layer-group ${counts[top] ? '' : 'empty'}`}>
              <div className="layer-row top">
                <button className="expander" onClick={() => setExpanded({ ...expanded, [top]: !expanded[top] })} disabled={!children.length}>
                  {children.length ? (expanded[top] ? '▾' : '▸') : ''}
                </button>
                <span className="swatch" style={{ background: `rgb(${color.join(',')})` }} />
                <span className="name">{top.replace(/^\d\d_/, '')}</span>
                <span className="count">{counts[top] ?? 0}</span>
                <button className={`eye ${vis[top] === false ? 'off' : ''}`} onClick={() => toggle(top)} title="Show / hide">
                  {vis[top] === false ? '○' : '●'}
                </button>
              </div>
              {expanded[top] &&
                children.map((l) => (
                  <div key={l.path} className="layer-row child">
                    <span className="name">{l.path.split('/')[1].replace(/_/g, ' ')}</span>
                    <span className="count">{counts[l.path]}</span>
                    <button className={`eye ${isLayerVisible(vis, l.path) ? '' : 'off'}`} onClick={() => toggle(l.path)} title="Show / hide">
                      {isLayerVisible(vis, l.path) ? '●' : '○'}
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
      <p className="hint small">Empty layers are created in the Rhino file so the hierarchy is stable across rounds.</p>
    </aside>
  );
}
