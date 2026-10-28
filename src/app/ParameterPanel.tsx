import { useState } from 'react';
import { M_PER_FT } from '../engine/units';
import { SEATING_PRODUCTS } from '../library/seating';
import type { StageType } from '../engine/types';
import { NumberInput, ParamField, Section, Segmented, Toggle, type FieldSpec } from './ui/ParamField';
import { useStudio } from './store';
import { IssueList } from './IssueList';
import { AnalysisSection, CapacityTarget } from './AnalysisPanel';
import { LedSection } from './LedPanel';
import { TransformSection } from './TransformPanel';

const F = (path: string, label: string, kind: FieldSpec['kind'], min: number, max: number, step: number, tip: string): FieldSpec => ({ path, label, kind, min, max, step, tip });

const MEDIA: FieldSpec[] = [
  F('media.azimuthLeftDeg', 'Left azimuth', 'angle', -180, 0, 1, 'Left edge of the screen, measured from +Y (forward). Negative = audience left.'),
  F('media.azimuthRightDeg', 'Right azimuth', 'angle', 0, 180, 1, 'Right edge of the screen, measured from +Y (forward).'),
  F('media.elevationLowerDeg', 'Lower elevation', 'angle', -60, 45, 0.5, 'Lower screen edge, degrees above the sphere equator (the horizon at the reference eye point).'),
  F('media.elevationUpperDeg', 'Upper elevation', 'angle', 0, 90, 0.5, 'Upper screen edge. 90° closes the screen at the zenith (spherical cap).'),
];
const FLOOR: FieldSpec[] = [
  F('floor.mainFloorElevation', 'Main floor elevation', 'length', -6, -0.5, 0.05, 'Main floor relative to the sphere centre. Moving it never moves the sphere.'),
  F('floor.slabThickness', 'Slab thickness', 'length', 0.1, 1, 0.05, 'Structural floor slab below the main floor (envelope only).'),
];
const SEATING: FieldSpec[] = [
  F('seating.rowCount', 'Rows', 'count', 1, 30, 1, 'Number of seating rows.'),
  F('seating.rowPitch', 'Row pitch', 'length', 0.8, 2.6, 0.01, 'Back-to-back distance between rows. Must exceed seat depth + clearway.'),
  F('seating.riserHeight', 'Riser height', 'length', 0, 0.5, 0.01, 'Height step between rows (seating rake).'),
  F('seating.frontRowRadius', 'Front row radius', 'length', 1, 12, 0.05, 'Plan distance from the seating layout origin to the first row.'),
  F('seating.focusY', 'Layout origin Y', 'length', -6, 12, 0.05, 'Rows are arcs about (0, Y). Seats face this point.'),
  F('seating.sectionAngleDeg', 'Fan angle', 'angle', 20, 300, 1, 'Total plan angle of the seating fan.'),
  F('seating.aisleCount', 'Radial aisles', 'count', 0, 8, 1, 'Aisles splitting the fan into equal blocks.'),
  F('seating.aisleWidth', 'Aisle width', 'length', 0.6, 2.5, 0.05, 'Clear aisle width.'),
  F('seating.screenClearance', 'Screen clearance', 'length', 0, 4, 0.05, 'Minimum plan distance from any seat to the sphere at eye height. Seats inside it are not generated.'),
];
const STAGE: FieldSpec[] = [
  F('stage.width', 'Width', 'length', 1, 24, 0.1, 'Stage width (X).'),
  F('stage.depth', 'Depth', 'length', 1, 14, 0.1, 'Stage depth (Y).'),
  F('stage.height', 'Deck height', 'length', 0, 2, 0.05, 'Deck height above the main floor.'),
  F('stage.centerY', 'Centre Y', 'length', -12, 14, 0.1, 'Stage centre position on the forward axis.'),
];
const ENVELOPE: FieldSpec[] = [
  F('envelope.serviceZone', 'Service zone', 'length', 0, 5, 0.1, 'Plan zone behind the media surface for structure, LED service access and MEP.'),
  F('envelope.overheadClearance', 'Overhead clearance', 'length', 0, 6, 0.1, 'Clearance above the top of the media surface for rigging and structure.'),
];

function SphereSize() {
  const R = useStudio((s) => s.config.sphere.radius);
  const units = useStudio((s) => s.units);
  const setParam = useStudio((s) => s.setParam);
  const k = units === 'm' ? 1 : 1 / M_PER_FT;
  const back = (v: number) => (units === 'm' ? v : v * M_PER_FT);
  return (
    <>
      <ParamField spec={F('sphere.radius', 'Radius', 'length', 4, 30, 0.05, 'Reference sphere radius. Its centre is the world origin and the reference eye point.')} />
      <div className="linked">
        <div>
          <span>Diameter</span>
          <NumberInput value={2 * R * k} step={0.1} onCommit={(v) => setParam('sphere.radius', back(v) / 2)} />
        </div>
        <div>
          <span>Circumference</span>
          <NumberInput value={2 * Math.PI * R * k} step={0.1} onCommit={(v) => setParam('sphere.radius', back(v) / (2 * Math.PI))} />
        </div>
      </div>
    </>
  );
}

function MediaControls() {
  const media = useStudio((s) => s.config.media);
  const setParam = useStudio((s) => s.setParam);
  const [symmetric, setSymmetric] = useState(media.azimuthLeftDeg === -media.azimuthRightDeg);
  return (
    <>
      <div className="coverage">
        <div>
          <strong>{(media.azimuthRightDeg - media.azimuthLeftDeg).toFixed(0)}°</strong>
          <span>horizontal</span>
        </div>
        <div>
          <strong>{(media.elevationUpperDeg - media.elevationLowerDeg).toFixed(1)}°</strong>
          <span>vertical</span>
        </div>
      </div>
      <Toggle
        checked={symmetric}
        label="Symmetric about forward axis"
        onChange={(v) => {
          setSymmetric(v);
          if (v) setParam('media.azimuthLeftDeg', -media.azimuthRightDeg);
        }}
      />
      <ParamField spec={MEDIA[0]} mirror={symmetric ? 'media.azimuthRightDeg' : undefined} />
      <ParamField spec={MEDIA[1]} mirror={symmetric ? 'media.azimuthLeftDeg' : undefined} />
      <ParamField spec={MEDIA[2]} />
      <ParamField spec={MEDIA[3]} />
    </>
  );
}

function SectionControls() {
  const section = useStudio((s) => s.section);
  const setSection = useStudio((s) => s.setSection);
  const R = useStudio((s) => s.config.sphere.radius);
  const floor = useStudio((s) => s.config.floor.mainFloorElevation);
  const range = section.mode === 'horizontal' ? [floor - 0.5, R] : [-R, R];
  return (
    <>
      <Toggle checked={section.enabled} label="Section cut" onChange={(enabled) => setSection({ enabled })} />
      <Segmented
        value={section.mode}
        options={[
          { value: 'longitudinal', label: 'Longitudinal' },
          { value: 'transverse', label: 'Transverse' },
          { value: 'horizontal', label: 'Plan' },
        ]}
        onChange={(mode) => setSection({ mode, enabled: true, offset: mode === 'horizontal' ? 0 : 0 })}
      />
      <div className="field">
        <div className="field-head">
          <label title="Plane position along its axis (m)">Position</label>
          <div className="field-value">
            <NumberInput value={section.offset} step={0.05} onCommit={(offset) => setSection({ offset })} />
            <span className="unit">m</span>
          </div>
        </div>
        <input type="range" min={range[0]} max={range[1]} step={0.05} value={section.offset} onChange={(e) => setSection({ offset: Number(e.target.value) })} />
      </div>
      {section.mode !== 'horizontal' && (
        <div className="field">
          <div className="field-head">
            <label title="Rotate the vertical section plane about Z">Rotation</label>
            <div className="field-value">
              <NumberInput value={section.rotationDeg} step={1} onCommit={(rotationDeg) => setSection({ rotationDeg })} />
              <span className="unit">°</span>
            </div>
          </div>
          <input type="range" min={-90} max={90} step={1} value={section.rotationDeg} onChange={(e) => setSection({ rotationDeg: Number(e.target.value) })} />
        </div>
      )}
      <Toggle checked={section.flip} label="Flip kept side" onChange={(flip) => setSection({ flip })} />
    </>
  );
}

export function ParameterPanel() {
  const config = useStudio((s) => s.config);
  const setParam = useStudio((s) => s.setParam);
  const mediaDisplay = useStudio((s) => s.mediaDisplay);
  const setMediaDisplay = useStudio((s) => s.setMediaDisplay);
  const transform = useStudio((s) => s.workspace === 'TRANSFORM');
  return (
    <aside className="panel right">
      <IssueList />
      {transform && (
        <Section title="Transformation">
          <TransformSection />
        </Section>
      )}
      <Section title="Reference sphere">
        <SphereSize />
      </Section>
      <Section title="Media surface">
        <MediaControls />
        <div className="row-label">Content</div>
        <Segmented
          value={mediaDisplay}
          options={[
            { value: 'calibration', label: 'Calibration grid' },
            { value: 'neutral', label: 'Neutral' },
          ]}
          onChange={setMediaDisplay}
        />
      </Section>
      <Section title="Floor & horizon">
        {FLOOR.map((f) => (
          <ParamField key={f.path} spec={f} />
        ))}
      </Section>
      <Section title="Seating">
        <div className="row-label">Seat product</div>
        <select value={config.seating.productId} onChange={(e) => setParam('seating.productId', e.target.value)}>
          {SEATING_PRODUCTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.manufacturer} {p.model} — {p.category}
            </option>
          ))}
        </select>
        {SEATING.map((f) => (
          <ParamField key={f.path} spec={f} />
        ))}
        <CapacityTarget />
      </Section>
      <Section title="Immersion analysis">
        <AnalysisSection />
      </Section>
      <Section title="Stage" defaultOpen={false}>
        <div className="row-label">Type</div>
        <select value={config.stage.type} onChange={(e) => setParam('stage.type', e.target.value as StageType)}>
          <option value="minimal">Minimal performance platform</option>
          <option value="concert">Concert stage</option>
          <option value="cinematic">Immersive cinematic stage</option>
          <option value="central">Central platform</option>
          <option value="custom">Custom</option>
        </select>
        {STAGE.map((f) => (
          <ParamField key={f.path} spec={f} />
        ))}
      </Section>
      <Section title="LED system" defaultOpen={false}>
        <LedSection />
      </Section>
      {!transform && (
        <Section title="Transformation" defaultOpen={false}>
          <TransformSection />
        </Section>
      )}
      <Section title="Design envelope" defaultOpen={false}>
        {ENVELOPE.map((f) => (
          <ParamField key={f.path} spec={f} />
        ))}
      </Section>
      <Section title="Section">
        <SectionControls />
      </Section>
    </aside>
  );
}
