import { useEffect, useRef, useState } from 'react';
import { barTime, showLength, type Cue } from '../show/cues';
import { MOD_CURVES, MOD_SOURCES, MOD_TARGETS, type ModRoute } from '../show/modulation';
import { SHOW_PRESETS, SOUNDSCAPES, VIDEO_PRESETS } from '../show/presets';
import { MAX_CLIP_SECONDS, recordingSupported, startRecording, type Recording } from '../show/record';
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
        {VIDEO_PRESETS.filter((v) => !v.legacy || (s.video.kind === 'preset' && v.id === s.video.id)).map((v) => (
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
        {SOUNDSCAPES.filter((a) => !a.legacy || (s.audio.kind === 'preset' && a.id === s.audio.id)).map((a) => (
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
      <CueName />
      <RecordButton />
    </div>
  );
}

function CueName() {
  const name = useShow((s) => (s.cuesOn && s.playing ? s.cues[s.cueIndex]?.name : null));
  return name ? <span className="cue-name">{name}</span> : null;
}

let recording: Recording | null = null;

/** Records the viewport and the mix (up to 30 s) into a clip to download. */
function RecordButton() {
  const on = useShow((s) => s.recording);
  const clip = useShow((s) => s.clip);
  if (!recordingSupported()) return null;
  const toggle = async () => {
    const s = useShow.getState();
    if (on) {
      recording?.stop();
      return;
    }
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
    if (!canvas) return;
    toShow();
    if (!s.playing) await s.toggle();
    s.setRecording(true);
    recording = startRecording(canvas, getAudio().recordStream(), (blob, ext, seconds) => {
      recording = null;
      const name = `${(s.presetId ?? 'om-show').replace(/[^a-z0-9-]+/gi, '-')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
      useShow.getState().setRecording(false);
      useShow.getState().setClip({ url: URL.createObjectURL(blob), name, seconds });
    });
  };
  return (
    <>
      <button className={`rec ${on ? 'active' : ''}`} onClick={() => void toggle()} title={on ? 'Stop recording' : `Record a clip of the viewport with sound (up to ${MAX_CLIP_SECONDS} s)`} aria-label={on ? 'Stop recording' : 'Record clip'}>
        {on ? '■' : '●'}
      </button>
      {clip && !on && (
        <a className="clip-link" href={clip.url} download={clip.name} title="Download the recorded clip">
          Clip {clip.seconds.toFixed(0)} s ↓
        </a>
      )}
    </>
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
      <Section title="Cues">
        <CueList />
      </Section>
      <Section title="Modulation" defaultOpen={false}>
        <Matrix />
      </Section>
      <Section title="Watch">
        <button className="primary-wide" onClick={() => seat && viewFromSeat(seat.id)} disabled={!seat}>
          Watch from {seat ? `seat ${seat.row}${seat.number}` : 'a seat'}
        </button>
        <p className="hint small">Select any seat in the viewport to watch from it instead. The preview shows display colour, not calibrated LED brightness.</p>
      </Section>
      <p className="hint small show-note">Pick the show, media and sound from the top bar. Upload your own video or track there too. The show is saved with this alternative.</p>
      {s.missing && <p className="hint error-note">{s.missing}</p>}
      {s.error && <p className="hint error-note">{s.error}</p>}
    </aside>
  );
}

const videoLabel = (id: string) => VIDEO_PRESETS.find((v) => v.id === id)?.label ?? id;

function CueRow({ c, active }: { c: Cue; active: boolean }) {
  const { updateCue, removeCue, captureCue, jumpToCue } = useShow.getState();
  return (
    <div className={`cue-row ${active ? 'active' : ''}`}>
      <input className="cue-title" value={c.name} onChange={(e) => updateCue(c.id, { name: e.target.value })} aria-label="Cue name" />
      <label title="Start bar">
        bar
        <input type="number" min={0} max={999} value={c.bar + 1} onChange={(e) => updateCue(c.id, { bar: Math.max(0, Math.round(Number(e.target.value)) - 1) })} />
      </label>
      <label title="Crossfade from the previous cue, in bars">
        fade
        <input type="number" min={0} max={32} step={0.5} value={c.fadeBars} onChange={(e) => updateCue(c.id, { fadeBars: Math.max(0, Number(e.target.value)) })} />
      </label>
      <div className="cue-look" title={`${videoLabel(c.look.video)} · pulse ${Math.round(c.look.pulse * 100)}% · haze ${Math.round(c.look.haze * 100)}%`}>
        <span className="swatches">
          {c.look.palette.slice(0, 3).map((x, k) => (
            <i key={k} style={{ background: x }} />
          ))}
        </span>
        <span>{videoLabel(c.look.video)}</span>
      </div>
      <div className="cue-actions">
        <button onClick={() => void jumpToCue(c.id)} title="Jump to this cue">
          ▶
        </button>
        <button onClick={() => captureCue(c.id)} title="Store the current look (sliders, palette, look) in this cue">
          Store
        </button>
        <button onClick={() => removeCue(c.id)} title="Delete cue" aria-label="Delete cue">
          ✕
        </button>
      </div>
    </div>
  );
}

function CueList() {
  const cues = useShow((s) => s.cues);
  const cuesOn = useShow((s) => s.cuesOn);
  const cueIndex = useShow((s) => s.cueIndex);
  const set = useShow((s) => s.set);
  const addCue = useShow((s) => s.addCue);
  return (
    <>
      <Toggle checked={cuesOn} label="Run the cue list" onChange={(v) => set({ cuesOn: v })} />
      <div className="cue-list">
        {cues.map((c, i) => (
          <CueRow key={c.id} c={c} active={cuesOn && i === cueIndex} />
        ))}
      </div>
      <button className="ghost" onClick={addCue}>
        Add cue
      </button>
      <p className="hint small">
        {cues.length ? `The list loops every ${showLength(cues)} bars. ` : ''}While cues run, the sliders and the Media menu edit the cue playing now; Store copies the current look into any cue.
      </p>
    </>
  );
}

function RouteRow({ r }: { r: ModRoute }) {
  const { updateRoute, removeRoute } = useShow.getState();
  return (
    <div className="route-row">
      <div className="route-line">
        <select value={r.source} onChange={(e) => updateRoute(r.id, { source: e.target.value as ModRoute['source'] })} aria-label="Source">
          {MOD_SOURCES.map((x) => (
            <option key={x.id} value={x.id} title={x.tip}>
              {x.label}
            </option>
          ))}
        </select>
        <span className="arrow">→</span>
        <select value={r.target} onChange={(e) => updateRoute(r.id, { target: e.target.value as ModRoute['target'] })} aria-label="Target">
          {MOD_TARGETS.map((x) => (
            <option key={x.id} value={x.id} title={x.tip}>
              {x.label}
            </option>
          ))}
        </select>
        <button onClick={() => removeRoute(r.id)} aria-label="Remove route" title="Remove route">
          ✕
        </button>
      </div>
      <div className="route-line">
        <input type="range" min={-1} max={1} step={0.05} value={r.amount} onChange={(e) => updateRoute(r.id, { amount: Number(e.target.value) })} aria-label="Amount" />
        <span className="amount">
          {r.amount > 0 ? '+' : ''}
          {Math.round(r.amount * 100)}%
        </span>
        <select value={r.curve} onChange={(e) => updateRoute(r.id, { curve: e.target.value as ModRoute['curve'] })} aria-label="Curve">
          {MOD_CURVES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Matrix() {
  const matrix = useShow((s) => s.matrix);
  const addRoute = useShow((s) => s.addRoute);
  return (
    <>
      <div className="route-list">
        {matrix.map((r) => (
          <RouteRow key={r.id} r={r} />
        ))}
      </div>
      <button className="ghost" onClick={addRoute}>
        Add route
      </button>
      <p className="hint small">Each route sends a source (beat, audio band or screen colour) to a target. Strobe hits stay under 3 per second whatever the routing.</p>
    </>
  );
}

/** Bottom of the viewport in EXPERIENCE: the cues across the loop, with the playhead; click to jump. */
export function CueRuler() {
  const cues = useShow((s) => s.cues);
  const cuesOn = useShow((s) => s.cuesOn);
  const time = useShow((s) => s.time);
  const tempo = useShow((s) => s.tempo);
  const cueIndex = useShow((s) => s.cueIndex);
  const seek = useShow((s) => s.seek);
  if (!cuesOn || !cues.length) return null;
  const len = showLength(cues);
  const bar = Math.max(0, ((time - tempo.offset) * tempo.bpm) / 240);
  const loop = Math.floor(bar / len);
  const head = ((bar % len) / len) * 100;
  return (
    <div className="cue-ruler" title="Click to jump">
      <div
        className="cue-track"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          void seek(barTime(loop * len + ((e.clientX - r.left) / r.width) * len, tempo));
        }}
      >
        {cues.map((c, i) => {
          const end = cues[i + 1]?.bar ?? len;
          return (
            <div key={c.id} className={`cue-block ${i === cueIndex ? 'active' : ''}`} style={{ left: `${(c.bar / len) * 100}%`, width: `${((end - c.bar) / len) * 100}%`, background: `linear-gradient(90deg, ${c.look.palette.slice(0, 3).join(', ')})` }}>
              {c.fadeBars > 0 && <i className="fade" style={{ width: `${(Math.min(c.fadeBars, end - c.bar) / (end - c.bar)) * 100}%` }} />}
              <span>{c.name}</span>
            </div>
          );
        })}
        <div className="cue-head" style={{ left: `${head}%` }} />
      </div>
      <div className="cue-bars">
        <span>bar {Math.floor(bar % len) + 1} of {len}</span>
        <span>{loop > 0 ? `loop ${loop + 1}` : ''}</span>
      </div>
    </div>
  );
}

