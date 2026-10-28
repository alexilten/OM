import { useEffect, useRef, useState } from 'react';
import { SHOW_PRESETS, SOUNDSCAPES, VIDEO_PRESETS } from '../show/presets';
import { getAudio, useShow } from '../show/store';
import { safeSubdivision } from '../show/timing';
import { useStudio } from './store';
import { formatTime } from './TransformPanel';
import { Section, Segmented, Toggle } from './ui/ParamField';

function Slider({ label, value, min, max, step, onChange, tip }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; tip?: string }) {
  return (
    <div className="field">
      <div className="field-head">
        <label title={tip}>{label}</label>
        <span className="unit">{Math.round((value / max) * 100)}%</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  );
}

/** A top-bar button that opens a dropdown panel; closes on an outside click or Escape. */
export function HeaderMenu({ label, value, children, width = 320 }: { label: string; value: string; children: React.ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="hmenu" ref={ref}>
      <button className={`hmenu-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="hmenu-label">{label}</span>
        <span className="hmenu-value">{value}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="hmenu-pop" style={{ width }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Seat for "watch from a seat": the selected one, else the best-scoring, else the middle seat. */
function useShowSeat() {
  const selectedId = useStudio((s) => s.selectedId);
  const seats = useStudio((s) => s.model.seats);
  const analysis = useStudio((s) => s.analysis);
  const selected = seats.find((x) => x.id === selectedId);
  if (selected) return selected;
  if (analysis) {
    let best = seats[0];
    for (const x of seats) if ((analysis.seats.get(x.id)?.score ?? 0) > (analysis.seats.get(best.id)?.score ?? 0)) best = x;
    return best;
  }
  return seats[Math.floor(seats.length / 2)];
}

/** Keeps the binaural preview pointed at the chosen seat and the placed speakers. */
function useSpatialAudio(seat: ReturnType<typeof useShowSeat>) {
  const spatial = useShow((s) => s.spatial);
  const playing = useShow((s) => s.playing);
  const objects = useStudio((s) => s.model.objects);
  useEffect(() => {
    if (!playing) return;
    if (!spatial || !seat) return getAudio().setSpatial(null);
    const byPos = new Map<string, [number, number, number]>();
    for (const o of objects)
      if (o.category === 'Speaker' && o.geometry.kind === 'blockInstance') byPos.set(String(o.metadata.position), o.geometry.frame.origin);
    getAudio().setSpatial({ speakers: [...byPos.values()], eye: seat.eyePoint, facing: seat.facing });
  }, [spatial, playing, seat, objects]);
}

/** Show controls work from any tab: using them opens EXPERIENCE, where the show plays. */
const toShow = () => useStudio.getState().workspace !== 'EXPERIENCE' && useStudio.getState().setWorkspace('EXPERIENCE');

function ShowMenu() {
  const presetId = useShow((s) => s.presetId);
  const applyPreset = useShow((s) => s.applyPreset);
  const current = SHOW_PRESETS.find((p) => p.id === presetId);
  return (
    <HeaderMenu label="Show" value={current?.label ?? 'Custom'} width={340}>
      <div className="show-presets">
        {SHOW_PRESETS.map((p) => (
          <button
            key={p.id}
            className={presetId === p.id ? 'active' : ''}
            onClick={() => {
              toShow();
              applyPreset(p.id);
            }}
            title={p.description}
          >
            <span className="swatches">
              {p.palette.slice(0, 3).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            <strong>{p.label}</strong>
            <span>{p.bpm} BPM</span>
          </button>
        ))}
      </div>
      <p className="hint small">Each preset pairs a generated video look, a synthesised soundscape, a tempo and a lighting palette. Nothing is streamed or licensed: it all renders in your browser.</p>
    </HeaderMenu>
  );
}

function MediaMenu() {
  const s = useShow();
  const input = useRef<HTMLInputElement>(null);
  const value = s.video.kind === 'file' ? s.video.name : (VIDEO_PRESETS.find((v) => s.video.kind === 'preset' && v.id === s.video.id)?.label ?? '');
  return (
    <HeaderMenu label="Media" value={value}>
      <div className="row-label">Content on the sphere</div>
      <select
        value={s.video.kind === 'preset' ? s.video.id : 'file'}
        onChange={(e) => {
          toShow();
          if (e.target.value === 'file') input.current?.click();
          else s.setVideoPreset(e.target.value);
        }}
      >
        {VIDEO_PRESETS.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
        <option value="file">{s.video.kind === 'file' ? `Video: ${s.video.name}` : 'Upload a video…'}</option>
      </select>
      <button className="ghost" onClick={() => input.current?.click()}>
        Upload video
      </button>
      <input
        ref={input}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          toShow();
          s.loadVideo(f);
        }}
      />
      <div className="row-label">Mapping</div>
      <Segmented
        value={s.mapping}
        options={[
          { value: 'canvas', label: 'Fit screen' },
          { value: 'equirect', label: 'Equirect 360' },
          { value: 'dome', label: 'Dome master' },
        ]}
        onChange={s.setMapping}
      />
      <p className="hint">
        {s.mapping === 'canvas'
          ? 'The frame is stretched over the screen’s azimuth and elevation range.'
          : s.mapping === 'equirect'
            ? 'A 2:1 equirectangular (360 × 180°) frame, placed by direction: only the part the screen covers shows.'
            : 'A fisheye dome master: zenith at the centre, horizon on the rim, forward at the bottom.'}
      </p>
      <p className="hint small">Uploads stay in your browser; nothing is sent anywhere.</p>
    </HeaderMenu>
  );
}

function SoundMenu() {
  const s = useShow();
  const seat = useShowSeat();
  const hasSpeakers = useStudio((x) => x.model.objects.some((o) => o.category === 'Speaker'));
  const input = useRef<HTMLInputElement>(null);
  const value = s.audio.kind === 'file' ? s.audio.name : (SOUNDSCAPES.find((a) => s.audio.kind === 'preset' && a.id === s.audio.id)?.label ?? '');
  return (
    <HeaderMenu label="Sound" value={value}>
      <div className="row-label">Source</div>
      <select
        value={s.audio.kind === 'preset' ? s.audio.id : 'file'}
        onChange={(e) => {
          toShow();
          if (e.target.value === 'file') input.current?.click();
          else s.setSoundscape(e.target.value);
        }}
      >
        {SOUNDSCAPES.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
        <option value="file">{s.audio.kind === 'file' ? `Track: ${s.audio.name}` : 'Upload a track…'}</option>
      </select>
      <button className="ghost" onClick={() => input.current?.click()}>
        Upload audio
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          toShow();
          void s.loadAudio(f);
        }}
      />
      {s.busy && <p className="hint">{s.busy}</p>}
      <div className="row-label">Tempo</div>
      <div className="tempo-row">
        <strong>{s.tempo.bpm.toFixed(1)}</strong>
        <span>BPM · {s.tempoSource === 'detected' ? `detected${s.confidence !== null && s.confidence < 1.6 ? ' (low confidence)' : ''}` : s.tempoSource}</span>
        <button onClick={() => s.setBpm(s.tempo.bpm / 2)} title="Half time">
          ½
        </button>
        <button onClick={() => s.setBpm(s.tempo.bpm * 2)} title="Double time">
          ×2
        </button>
        <button onClick={s.tap} title="Tap along to set the tempo">
          Tap
        </button>
      </div>
      <Slider label="Volume" value={s.volume} min={0} max={1} step={0.01} onChange={(volume) => s.set({ volume })} tip="Master level; a limiter keeps peaks under control." />
      <Toggle checked={s.spatial} label={`Hear it from ${seat ? `seat ${seat.row}${seat.number}` : 'a seat'} through the speakers`} onChange={(spatial) => s.set({ spatial })} />
      {s.spatial && !hasSpeakers && <p className="hint">Turn on Immersive audio (Design → Immersion systems) to place speakers to listen through.</p>}
      {s.spatial && hasSpeakers && <p className="hint small">Binaural sketch over headphones from the speaker positions, not an acoustic prediction.</p>}
    </HeaderMenu>
  );
}

function Transport() {
  const playing = useShow((s) => s.playing);
  const time = useShow((s) => s.time);
  const tempo = useShow((s) => s.tempo);
  const toggle = useShow((s) => s.toggle);
  const stop = useShow((s) => s.stop);
  const beat = Math.max(0, Math.floor(((time - tempo.offset) * tempo.bpm) / 60));
  return (
    <div className="transport" title="Audio is the master clock, so the screen, lights and sound stay locked together. Sound starts only when you press Play.">
      <button
        className={`play ${playing ? 'active' : ''}`}
        onClick={() => {
          toShow();
          void toggle();
        }}
        aria-label={playing ? 'Pause' : 'Play the show'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button onClick={stop} aria-label="Stop and rewind">
        ■
      </button>
      <span className="tl-time">{formatTime(time)}</span>
      <span className="beat-dots" aria-label={`Beat ${(beat % 4) + 1} of 4`}>
        {[0, 1, 2, 3].map((k) => (
          <i key={k} className={playing && beat % 4 === k ? 'on' : ''} />
        ))}
      </span>
      <span className="bpm">{tempo.bpm.toFixed(0)} BPM</span>
    </div>
  );
}

/** The show's media and playback live in the top bar, next to the venue preset. */
export function ShowMenus() {
  const seat = useShowSeat();
  useSpatialAudio(seat);
  const error = useShow((s) => s.error);
  return (
    <>
      <ShowMenu />
      <MediaMenu />
      <SoundMenu />
      <Transport />
      {error && (
        <span className="show-error" title={error}>
          ⚠
        </span>
      )}
    </>
  );
}

/** EXPERIENCE left panel: the generative look controls (lights, pulse, haze) and where to watch from. */
export function ShowPanel() {
  const s = useShow();
  const seat = useShowSeat();
  const viewFromSeat = useStudio((x) => x.viewFromSeat);
  const hasLights = useStudio((x) => x.model.objects.some((o) => o.category === 'LightingFixture'));
  const sub = safeSubdivision(s.tempo.bpm, 1);
  return (
    <aside className="panel params show-panel">
      <Section title="Lights & pulse">
        <div className="row-label">Lighting</div>
        <Segmented
          value={s.lights}
          options={[
            { value: 'follow', label: 'Follow screen' },
            { value: 'palette', label: 'Palette' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={(lights) => s.set({ lights })}
        />
        {!hasLights && <p className="hint">Turn on Lighting rigs (Design → Immersion systems) to see beams.</p>}
        <Slider label="Pulse" value={s.pulse} min={0} max={1} step={0.01} onChange={(pulse) => s.set({ pulse })} tip="How hard the beat pushes the screen and the lights." />
        <Slider label="Haze" value={s.haze} min={0} max={1} step={0.01} onChange={(haze) => s.set({ haze })} tip="Beam visibility (stands in for the hazers)." />
        <Slider label="Screen brightness" value={s.intensity} min={0.2} max={1.5} step={0.01} onChange={(intensity) => s.set({ intensity })} />
        <Toggle checked={s.reducedMotion} label="Reduced motion (no beat flashes)" onChange={(reducedMotion) => s.set({ reducedMotion })} />
        <p className="hint small">{sub ? `Beat pulses at ${((s.tempo.bpm / 60) * sub).toFixed(1)} per second, under the 3 flashes per second photosensitivity limit.` : 'The tempo is too fast to pulse safely: beat flashes are off.'}</p>
      </Section>
      <Section title="Watch">
        <button className="primary-wide" onClick={() => seat && viewFromSeat(seat.id)} disabled={!seat}>
          Watch from {seat ? `seat ${seat.row}${seat.number}` : 'a seat'}
        </button>
        <p className="hint small">Select any seat in the viewport to watch from it instead. The preview shows display colour, not calibrated LED brightness.</p>
      </Section>
      <p className="hint small show-note">Pick the show, media and sound from the top bar. Upload your own video or track there too.</p>
      {s.error && <p className="hint error-note">{s.error}</p>}
    </aside>
  );
}
