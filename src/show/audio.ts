/**
 * Show audio (Round 08): one AudioContext is the show's master clock. Plays an uploaded file or a
 * synthesised soundscape through a master gain and a limiter, and exposes band energies for the
 * visuals. Soundscapes are scheduled on the beat grid with a short lookahead, so they stay in time.
 */
import { detectBpm, type Tempo } from './timing';

export interface Bands {
  bass: number;
  mid: number;
  high: number;
  rms: number;
}

type Voice = { stop: (at: number) => void };

const PENTATONIC = [0, 2, 4, 7, 9];

/** Section of the preset cue arc (Round 11, 44 bars; see cues.ts `presetCues`): the soundscapes build, drop and break with the cues. */
export type ArcPart = 'intro' | 'build' | 'drop' | 'break' | 'final' | 'outro';
export const ARC_BARS = 44;
export function partAt(bar: number): ArcPart {
  const b = ((Math.floor(bar) % ARC_BARS) + ARC_BARS) % ARC_BARS;
  return b < 8 ? 'intro' : b < 16 ? 'build' : b < 24 ? 'drop' : b < 28 ? 'break' : b < 36 ? 'final' : 'outro';
}
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class ShowAudio {
  readonly ctx: AudioContext;
  private master: GainNode;
  private analyser: AnalyserNode;
  private freq: Uint8Array<ArrayBuffer>;
  private bus: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private voices: Voice[] = [];
  private timer: number | null = null;
  private noise: AudioBuffer;
  private startedAt = 0;
  private pausedAt = 0;
  playing = false;
  private spatial: { speakers: [number, number, number][]; eye: [number, number, number]; facing: [number, number, number] } | null = null;
  private panners: PannerNode[] = [];
  private tap: MediaStreamAudioDestinationNode | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    // Limiter: keeps peaks under control whatever the source (hearing safety, no clipping).
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.master.connect(limiter).connect(this.analyser).connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // Pink-ish noise (Voss-McCartney style running sum).
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** The limited master mix as a MediaStream, for clip recording. */
  recordStream(): MediaStream {
    if (!this.tap) {
      this.tap = this.ctx.createMediaStreamDestination();
      this.analyser.connect(this.tap);
    }
    return this.tap.stream;
  }

  /** Show time in seconds (the master clock). */
  time() {
    return this.playing ? this.ctx.currentTime - this.startedAt : this.pausedAt;
  }

  bands(): Bands {
    this.analyser.getByteFrequencyData(this.freq);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const avg = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(this.freq.length - 1, Math.ceil(hi / binHz));
      let s = 0;
      for (let i = a; i <= b; i++) s += this.freq[i];
      return s / ((b - a + 1) * 255);
    };
    const bass = avg(20, 150);
    const mid = avg(150, 2000);
    const high = avg(2000, 10000);
    return { bass, mid, high, rms: (bass + mid + high) / 3 };
  }

  async decode(file: File): Promise<{ buffer: AudioBuffer; tempo: Tempo & { confidence: number } }> {
    const buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    // Mono mix of up to 90 s for tempo detection.
    const n = Math.min(buffer.length, buffer.sampleRate * 90);
    const mono = new Float32Array(n);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += ch[i] / buffer.numberOfChannels;
    }
    return { buffer, tempo: detectBpm(mono, buffer.sampleRate) };
  }

  stop() {
    this.pausedAt = this.time();
    this.playing = false;
    const t = this.ctx.currentTime;
    this.source?.stop();
    this.source = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.voices.forEach((v) => v.stop(t));
    this.voices = [];
    if (this.bus) {
      const bus = this.bus;
      bus.gain.setTargetAtTime(0, t, 0.05);
      setTimeout(() => bus.disconnect(), 400);
    }
    this.bus = null;
  }

  /** Starts playback from `from` seconds: a decoded file, or a soundscape on the tempo grid. */
  async play(src: { buffer: AudioBuffer } | { soundscape: string; tempo: Tempo }, from = this.pausedAt) {
    this.stop();
    await this.ctx.resume();
    this.bus = this.ctx.createGain();
    this.route();
    this.startedAt = this.ctx.currentTime - from;
    this.playing = true;
    if ('buffer' in src) {
      const s = this.ctx.createBufferSource();
      s.buffer = src.buffer;
      s.loop = true;
      s.connect(this.bus);
      s.start(0, from % src.buffer.duration);
      this.source = s;
      return;
    }
    this.startSoundscape(src.soundscape, src.tempo);
  }

  /**
   * Binaural preview from a seat: the mix feeds one HRTF panner per array position (up to 16), heard
   * from the seat's eye point and facing. A sketch of the image, not an acoustic prediction. Null
   * plays the mix straight to the output.
   */
  setSpatial(spatial: ShowAudio['spatial']) {
    this.spatial = spatial;
    if (this.bus) this.route();
  }

  private route() {
    const bus = this.bus!;
    bus.disconnect();
    this.panners.forEach((p) => p.disconnect());
    this.panners = [];
    const sp = this.spatial;
    if (!sp || !sp.speakers.length) {
      bus.connect(this.master);
      return;
    }
    const step = Math.max(1, Math.ceil(sp.speakers.length / 16));
    const chosen = sp.speakers.filter((_, i) => i % step === 0);
    const l = this.ctx.listener;
    // Engine (Z up) → Web Audio (Y up): x → x, z → y, y → -z.
    const w = (p: [number, number, number]) => [p[0], p[2], -p[1]] as const;
    const [ex, ey, ez] = w(sp.eye);
    const [fx, fy, fz] = w(sp.facing);
    if (l.positionX) {
      l.positionX.value = ex;
      l.positionY.value = ey;
      l.positionZ.value = ez;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(ex, ey, ez);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
    const gain = this.ctx.createGain();
    gain.gain.value = 1.6 / Math.sqrt(chosen.length);
    bus.connect(gain);
    for (const s of chosen) {
      const p = new PannerNode(this.ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 6, rolloffFactor: 1 });
      const [x, y, z] = w(s);
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
      gain.connect(p).connect(this.master);
      this.panners.push(p);
    }
  }

  seekTo(t: number) {
    this.pausedAt = Math.max(0, t);
  }

  // ─── Soundscapes ──────────────────────────────────────────────────────────

  private osc(type: OscillatorType, freq: number, gain: number, dest: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(gain, this.ctx.currentTime, 1.5);
    o.connect(g).connect(dest);
    o.start();
    this.voices.push({ stop: (at) => (g.gain.setTargetAtTime(0, at, 0.1), o.stop(at + 1)) });
    return o;
  }

  private noiseSource(dest: AudioNode, gain: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start();
    this.voices.push({ stop: (at) => (g.gain.setTargetAtTime(0, at, 0.1), s.stop(at + 1)) });
    return g;
  }

  private lfo(param: AudioParam, rate: number, depth: number) {
    const o = this.ctx.createOscillator();
    o.frequency.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    this.voices.push({ stop: (at) => o.stop(at + 1) });
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7, dest: AudioNode = this.bus!) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  private hit(at: number, build: (g: GainNode) => void, peak: number, decay: number, dest: AudioNode = this.bus!) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    g.connect(dest);
    build(g);
    return g;
  }

  private kick(at: number, dest: AudioNode = this.bus!) {
    return this.hit(at, (g) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(150, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.5);
    }, 0.9, 0.45, dest);
  }

  private hat(at: number, gain = 0.12, decay = 0.06) {
    this.hit(at, (g) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      s.connect(f).connect(g);
      s.start(at, Math.random());
      s.stop(at + decay + 0.05);
    }, gain, decay);
  }

  private bell(at: number, freq: number, gain = 0.12) {
    this.hit(at, (g) => {
      for (const [mult, amp] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) {
        const o = this.ctx.createOscillator();
        o.frequency.value = freq * mult;
        const a = this.ctx.createGain();
        a.gain.value = amp;
        o.connect(a).connect(g);
        o.start(at);
        o.stop(at + 3);
      }
    }, gain, 2.5);
  }

  private pluck(at: number, freq: number, gain = 0.25) {
    this.hit(at, (g) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1200, at);
      f.frequency.exponentialRampToValueAtTime(150, at + 0.2);
      o.connect(f).connect(g);
      o.start(at);
      o.stop(at + 0.3);
    }, gain, 0.25);
  }

  // ─── Round 11 instruments ─────────────────────────────────────────────────

  private irs = new Map<number, AudioBuffer>();

  /** A send into a convolution reverb with a generated impulse (decaying stereo noise, −60 dB at `seconds`). */
  private reverb(seconds: number, wet = 0.8) {
    let ir = this.irs.get(seconds);
    if (!ir) {
      const sr = this.ctx.sampleRate;
      ir = this.ctx.createBuffer(2, Math.floor(sr * seconds), sr);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / d.length);
      }
      this.irs.set(seconds, ir);
    }
    const send = this.ctx.createGain();
    const conv = this.ctx.createConvolver();
    conv.buffer = ir;
    const out = this.ctx.createGain();
    out.gain.value = wet;
    send.connect(conv).connect(out).connect(this.bus!);
    return send;
  }

  /** Soft-clip distortion (normalised tanh curve) into `dest`. */
  private drive(amount: number, dest: AudioNode = this.bus!) {
    const ws = this.ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh((i / (n - 1) * 2 - 1) * amount) / Math.tanh(amount);
    ws.curve = curve;
    ws.oversample = '2x';
    ws.connect(dest);
    return ws;
  }

  /** A feedback delay (darkened on each repeat) into `dest`; returns its input. */
  private echo(time: number, feedback: number, dest: AudioNode = this.bus!) {
    const input = this.ctx.createGain();
    const d = this.ctx.createDelay(2);
    d.delayTime.value = time;
    const fb = this.ctx.createGain();
    fb.gain.value = feedback;
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3000;
    input.connect(d).connect(tone).connect(fb).connect(d);
    tone.connect(dest);
    return input;
  }

  /** A gain stage whose level the arrangement sets per section. */
  private stem(dest: AudioNode, level = 0) {
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(dest);
    return g;
  }

  /** The brass wall: detuned saws in octaves, driven, through a low-pass that snaps open and sinks. */
  private braam(at: number, freq: number, dur: number, dest: AudioNode, gain = 0.45) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.06);
    g.gain.setTargetAtTime(gain * 0.55, at + 0.25, 0.6);
    g.gain.setTargetAtTime(0, at + dur, 0.35);
    g.connect(dest);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(90, at);
    lp.frequency.exponentialRampToValueAtTime(1600, at + 0.18);
    lp.frequency.exponentialRampToValueAtTime(260, at + dur);
    lp.connect(g);
    const pre = this.ctx.createGain();
    pre.gain.value = 0.35;
    pre.connect(this.drive(2.5, lp));
    for (const [m, d] of [[0.5, -9], [0.5, 9], [1, -14], [1, 0], [1, 14], [1.5, 5], [2, -6]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq * m;
      o.detune.value = d;
      o.connect(pre);
      o.start(at);
      o.stop(at + dur + 2);
    }
  }

  /** Trailer hit: a sub drop dry, a noise crack into the reverb. */
  private impact(at: number, verb: AudioNode, gain = 0.9) {
    this.hit(at, (g) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(110, at);
      o.frequency.exponentialRampToValueAtTime(26, at + 1.4);
      o.connect(g);
      o.start(at);
      o.stop(at + 3.2);
    }, gain, 3);
    this.hit(at, (g) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(5000, at);
      f.frequency.exponentialRampToValueAtTime(200, at + 1.2);
      s.connect(f).connect(g);
      s.start(at, Math.random());
      s.stop(at + 1.6);
    }, gain * 0.8, 1.4, verb);
  }

  /** A drum skin: a pitch-dropping sine with a noise slap. Returns the envelope, for reverb sends. */
  private tom(at: number, freq: number, gain = 0.6, decay = 0.7) {
    return this.hit(at, (g) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(freq * 1.8, at);
      o.frequency.exponentialRampToValueAtTime(freq, at + 0.06);
      o.connect(g);
      o.start(at);
      o.stop(at + decay + 0.1);
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq * 6;
      const a = this.ctx.createGain();
      a.gain.setValueAtTime(0.5, at);
      a.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
      s.connect(f).connect(a).connect(g);
      s.start(at, Math.random());
      s.stop(at + 0.1);
    }, gain, decay);
  }

  /** Metal: a two-operator FM strike at an inharmonic ratio, high-passed. */
  private clank(at: number, gain = 0.2, dest: AudioNode = this.bus!) {
    return this.hit(at, (g) => {
      const f0 = 170 + Math.random() * 90;
      const c = this.ctx.createOscillator();
      c.frequency.value = f0;
      const m = this.ctx.createOscillator();
      m.frequency.value = f0 * 3.53;
      const idx = this.ctx.createGain();
      idx.gain.setValueAtTime(f0 * 5, at);
      idx.gain.exponentialRampToValueAtTime(f0 * 0.1, at + 0.25);
      m.connect(idx).connect(c.frequency);
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 350;
      c.connect(hp).connect(g);
      for (const o of [c, m]) (o.start(at), o.stop(at + 0.4));
    }, gain, 0.3, dest);
  }

  /** Snare: band-passed noise over a short tone. */
  private snare(at: number, gain = 0.4, dest: AudioNode = this.bus!) {
    return this.hit(at, (g) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1900;
      f.Q.value = 0.7;
      s.connect(f).connect(g);
      s.start(at, Math.random());
      s.stop(at + 0.3);
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(240, at);
      o.frequency.exponentialRampToValueAtTime(170, at + 0.05);
      const a = this.ctx.createGain();
      a.gain.value = 0.6;
      o.connect(a).connect(g);
      o.start(at);
      o.stop(at + 0.15);
    }, gain, 0.22, dest);
  }

  /** Clap: three quick noise bursts and a short tail. */
  private clap(at: number, gain = 0.35, dest: AudioNode = this.bus!) {
    let tail: GainNode | null = null;
    for (const [dt, d] of [[0, 0.02], [0.011, 0.02], [0.023, 0.18]]) {
      tail = this.hit(at + dt, (g) => {
        const s = this.ctx.createBufferSource();
        s.buffer = this.noise;
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1300;
        f.Q.value = 1.2;
        s.connect(f).connect(g);
        s.start(at + dt, Math.random());
        s.stop(at + dt + d + 0.05);
      }, gain, d, dest);
    }
    return tail!;
  }

  /** A clock tick (`hi` for the tick, low for the tock). */
  private tick(at: number, hi: boolean, gain = 0.1, dest: AudioNode = this.bus!) {
    return this.hit(at, (g) => {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hi ? 3100 : 2300;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1500;
      o.connect(f).connect(g);
      o.start(at);
      o.stop(at + 0.04);
    }, gain, 0.025, dest);
  }

  /** A struck string (felt piano): two slightly detuned triangles with a long decay. */
  private piano(at: number, freq: number, gain = 0.18, dest: AudioNode = this.bus!) {
    return this.hit(at, (g) => {
      for (const d of [-4, 4]) {
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq;
        o.detune.value = d;
        o.connect(g);
        o.start(at);
        o.stop(at + 4.2);
      }
    }, gain, 4, dest);
  }

  /** A short note through a filter envelope (bass and arp lines). */
  private note(at: number, freq: number, dest: AudioNode, opts: { type?: OscillatorType; gain?: number; decay?: number; cutoff?: number } = {}) {
    const { type = 'sawtooth', gain = 0.25, decay = 0.2, cutoff = 1800 } = opts;
    return this.hit(at, (g) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 6;
      f.frequency.setValueAtTime(cutoff, at);
      f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff / 8), at + decay);
      o.connect(f).connect(g);
      o.start(at);
      o.stop(at + decay + 0.1);
    }, gain, decay, dest);
  }

  /** Reverse swell: filtered noise and a tone that rise into `end`, then cut. */
  private riser(end: number, dur: number, freq: number, dest: AudioNode, gain = 0.3) {
    const start = Math.max(this.ctx.currentTime, end - dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, end - 0.02);
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(dest);
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(250, start);
    f.frequency.exponentialRampToValueAtTime(6000, end);
    s.connect(f).connect(g);
    s.start(start, Math.random());
    s.stop(end + 0.05);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, start);
    o.frequency.exponentialRampToValueAtTime(freq * 4, end);
    const a = this.ctx.createGain();
    a.gain.value = 0.15;
    o.connect(a).connect(g);
    o.start(start);
    o.stop(end + 0.05);
  }

  /**
   * Shepard-Risset rise: octave-spaced sines that climb for ever under a fixed bell of loudness, so
   * the pitch seems to rise without arriving. Call `update(at)` on the step grid.
   */
  private shepard(base: number, octavesPerSec: number, dest: AudioNode) {
    const K = 7;
    const g = this.stem(dest);
    const voices = Array.from({ length: K }, () => {
      const o = this.ctx.createOscillator();
      const a = this.ctx.createGain();
      a.gain.value = 0;
      o.connect(a).connect(g);
      o.start();
      return { o, a, x: -1 };
    });
    this.voices.push({ stop: (at) => voices.forEach((v) => v.o.stop(at + 1)) });
    const t0 = this.ctx.currentTime;
    const update = (at: number) => {
      const p = (at - t0) * octavesPerSec;
      voices.forEach((v, i) => {
        const x = (((i + p) % K) + K) % K;
        const f = base * 2 ** x;
        const w = Math.exp(-((x - K / 2) ** 2) / 3) / Math.sqrt(K);
        if (x < v.x || v.x < 0) {
          v.o.frequency.setValueAtTime(f, at);
          v.a.gain.setValueAtTime(w, at);
        } else {
          v.o.frequency.linearRampToValueAtTime(f, at);
          v.a.gain.linearRampToValueAtTime(w, at);
        }
        v.x = x;
      });
    };
    update(t0);
    return { level: g, update };
  }

  /** A sustained pipe-organ voice (additive drawbars); `set` retunes it at a time. */
  private organ(freq: number, gain: number, dest: AudioNode) {
    const g = this.stem(dest, gain);
    const parts = [[1, 1], [2, 0.55], [3, 0.3], [4, 0.28], [6, 0.12], [8, 0.1]].map(([m, a]) => ({ m, o: this.osc('sine', freq * m, a, g) }));
    return { set: (at: number, f: number) => parts.forEach((p) => p.o.frequency.setValueAtTime(f * p.m, at)) };
  }

  /** A voice: a vibrato saw through three vowel formants; `vowel(at, v)` morphs oo (0) to ah (1). */
  private vocal(freq: number, gain: number, dest: AudioNode) {
    const OO = [300, 870, 2240];
    const AH = [730, 1090, 2440];
    const sum = this.ctx.createGain();
    const fs = OO.map((f, i) => {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 6;
      const a = this.ctx.createGain();
      a.gain.value = [4, 2.5, 1.2][i];
      sum.connect(bp).connect(a).connect(dest);
      return bp;
    });
    const o = this.osc('sawtooth', freq, gain, sum, (Math.random() - 0.5) * 12);
    this.lfo(o.frequency, 4.4 + Math.random() * 0.8, freq * 0.007);
    return {
      o,
      vowel: (at: number, v: number) => fs.forEach((f, i) => f.frequency.setTargetAtTime(OO[i] + (AH[i] - OO[i]) * v, at, 1.2)),
    };
  }

  /** The call: a low formant voice that sinks a fifth, slowly, like something vast answering. */
  private call(at: number, dur: number, dest: AudioNode) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.5, at + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, at + dur);
    g.connect(dest);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(midi(33), at);
    o.frequency.exponentialRampToValueAtTime(midi(26), at + dur);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(400, at);
    f.frequency.exponentialRampToValueAtTime(250, at + dur);
    const a = this.ctx.createGain();
    a.gain.value = 3;
    o.connect(f).connect(a).connect(g);
    o.start(at);
    o.stop(at + dur + 0.1);
  }

  /** Runs `onBeat(time, beatIndex, step)` for every 16th note slightly ahead of time. */
  private schedule(tempo: Tempo, onStep: (at: number, step: number) => void) {
    const spb = 60 / tempo.bpm / 4;
    let next = Math.ceil((this.time() - tempo.offset) / spb);
    const tick = () => {
      const horizon = this.time() + 0.12;
      while (tempo.offset + next * spb < horizon) {
        const at = this.startedAt + tempo.offset + next * spb;
        if (at >= this.ctx.currentTime - 0.01) onStep(Math.max(at, this.ctx.currentTime), next);
        next++;
      }
    };
    tick();
    this.timer = window.setInterval(tick, 25);
  }

  private startSoundscape(id: string, tempo: Tempo) {
    const bus = this.bus!;
    const root = 38; // D2
    // Round 11 soundscapes follow the preset cue arc (see cues.ts `presetCues`), bar by bar.
    const verb = this.reverb(5);
    const arc = (step: number) => {
      const bar = Math.floor(step / 16);
      return { bar: ((bar % ARC_BARS) + ARC_BARS) % ARC_BARS, s: step % 16, part: partAt(bar) };
    };
    const set = (g: GainNode, v: number, at: number, tau = 0.8) => g.gain.setTargetAtTime(v, at, tau);
    const spb = 60 / tempo.bpm / 4;
    const barSec = spb * 16;
    if (id === 'leviathan') {
      // Monolith: a sub that never stops, a brass wall on every bar of the drop, a Shepard climb.
      const drone = this.stem(this.drive(1.6), 0.5);
      const lp = this.filter('lowpass', 220, 1.5, drone);
      this.lfo(lp.frequency, 0.04, 90);
      for (const [n, d] of [[26, 0], [38, -10], [38, 10], [45, 0]]) this.osc('sawtooth', midi(n), 0.12, lp, d);
      this.osc('sine', midi(26), 0.35, bus);
      const climb = this.shepard(28, 1 / 10, verb);
      const choir = this.stem(verb);
      const v = [62, 69, 74].map((n) => this.vocal(midi(n), 0.05, choir));
      const walls = [38, 38, 34, 36];
      this.schedule(tempo, (at, step) => {
        const { bar, s, part } = arc(step);
        climb.update(at);
        if (s !== 0 && s % 4 !== 0 && s !== 2 && s !== 14) return;
        if (s === 0) {
          set(drone, part === 'break' ? 0.25 : 0.5, at);
          set(climb.level, part === 'build' ? 0.05 + 0.03 * (bar - 8) : 0, at, 1.5);
          set(choir, part === 'final' ? 0.5 : part === 'break' ? 0.3 : 0, at, 2);
          v.forEach((x) => x.vowel(at, bar % 2));
          if (bar === 16 || bar === 28) this.impact(at, verb);
          if (part === 'drop' || part === 'final') this.braam(at, midi(walls[bar % 4]), barSec * 0.85, bus);
          if (bar === 36) this.braam(at, midi(38), barSec * 2, verb, 0.6);
          if (bar === 15 || bar === 27) this.riser(at + barSec, barSec, midi(50), bus);
        }
        if (part === 'build' && (s === 0 || s === 2)) this.tom(at, 48, 0.5 + 0.03 * (bar - 8)).connect(verb);
        if ((part === 'drop' || part === 'final') && (s === 8 || s === 12 || s === 14)) this.tom(at, s === 14 ? 70 : 52, 0.55).connect(verb);
      });
      return;
    }
    if (id === 'horizon') {
      // Event horizon: a cathedral organ in D minor, a clock that never stops, a rise that never lands.
      const organ = this.stem(verb, 0.4);
      const dry = this.stem(bus, 0.25);
      organ.connect(dry);
      const chords = [[50, 53, 57, 26], [46, 50, 53, 22], [53, 57, 60, 29], [48, 52, 55, 24]];
      const voices = chords[0].map((n) => this.organ(midi(n), 0.09, organ));
      const climb = this.shepard(40, 1 / 12, verb);
      this.osc('sine', midi(26), 0.2, bus);
      this.schedule(tempo, (at, step) => {
        const { bar, s, part } = arc(step);
        climb.update(at);
        if (s === 0) {
          if (bar % 2 === 0) chords[(bar / 2) % 4].forEach((n, i) => voices[i].set(at, midi(n + (part === 'final' && i < 3 ? 12 : 0))));
          set(organ, { intro: 0.35, build: 0.5, drop: 1, break: 0.15, final: 1.2, outro: 0.25 }[part], at, part === 'drop' ? 0.05 : 1.5);
          set(climb.level, part === 'build' ? 0.06 + 0.02 * (bar - 8) : part === 'final' ? 0.04 : 0, at, 1);
          if (bar === 16 || bar === 28) this.impact(at, verb);
          if (bar === 15 || bar === 27) this.riser(at + barSec, barSec, midi(57), bus, 0.25);
          if (part === 'final' && bar % 2 === 0) this.braam(at, midi(38), barSec * 1.6, verb, 0.35);
        }
        // The clock: tick-tock on eighths, louder as time runs out, absent only at the very end.
        if (s % 2 === 0 && part !== 'outro') this.tick(at, s % 4 === 0, part === 'build' ? 0.06 + 0.01 * (bar - 8) : 0.07);
        if ((part === 'drop' || part === 'final') && (s === 0 || s === 8)) this.tom(at, 44, 0.7, 1.2).connect(verb);
        if (part === 'break' && s === 0) this.piano(at, midi(74 + [0, 3, 7, 5][bar % 4]), 0.12).connect(verb);
      });
      return;
    }
    if (id === 'machine') {
      // Machine heart: crushed drums, a distorted phrygian bass, metal; a lonely piano in the hole.
      const crush = this.drive(4, bus);
      const bassLp = this.filter('lowpass', 400, 4, this.drive(6, bus));
      const metal = this.reverb(1.6, 0.5);
      const riff = [0, 0, 12, 0, 1, 0, 0, 13, 0, 0, 12, 0, 3, 0, 1, 0];
      const keys = [62, 65, 69, 64, 62, 60, 57, 58];
      this.schedule(tempo, (at, step) => {
        const { bar, s, part } = arc(step);
        const full = part === 'drop' || part === 'final';
        if (s === 0) bassLp.frequency.setTargetAtTime(part === 'build' ? 300 + 150 * (bar - 8) : full ? 1800 : 300, at, 0.5);
        if (part === 'break' || part === 'intro' || part === 'outro') {
          if (s % 8 === 0 && Math.random() < (part === 'break' ? 1 : 0.5)) this.piano(at, midi(keys[(bar * 2 + s / 8) % 8]), 0.16).connect(verb);
          if (part === 'intro' && s === 0) this.kick(at, crush);
          if (part !== 'break' && (s === 6 || s === 14) && Math.random() < 0.6) this.clank(at, 0.12, metal);
          return;
        }
        if (s % 4 === 0) this.kick(at, crush);
        if (full || bar >= 12) this.note(at, midi(26 + riff[s]), bassLp, { gain: riff[s] ? 0.3 : 0.4, decay: 0.12, cutoff: 2400 });
        if (full && (s === 4 || s === 12)) this.snare(at, 0.45, crush).connect(verb);
        if (part === 'build' && bar >= 12) {
          const roll = bar === 15 ? 1 : bar === 14 ? 2 : 4;
          if (s % roll === 0) this.snare(at, 0.15 + 0.3 * (bar - 12 + s / 16) / 4, crush);
        }
        if (bar === 15 && s === 0) this.riser(at + barSec, barSec, midi(38), bus, 0.3);
        this.hat(at, s % 2 ? 0.05 : 0.1 + Math.random() * 0.05, s === 14 ? 0.2 : 0.04);
        if ((s === 3 || s === 10 || s === 15) && Math.random() < (full ? 0.8 : 0.4)) this.clank(at, 0.2, metal);
        if (full && s === 0 && bar % 4 === 0) this.braam(at, midi(38), barSec * 0.9, crush, 0.25);
      });
      return;
    }
    if (id === 'glam') {
      // Starman: glam stomp; gated saw stabs, octave bass, and a delayed square arp in the sky.
      const sky = this.echo(spb * 3, 0.45, verb);
      sky.connect(bus);
      const pad = this.stem(this.filter('lowpass', 1400, 0.8), 0);
      const prog = [[38, 0, 4, 7], [45, 0, 4, 7], [47, 0, 3, 7], [43, 0, 4, 7]];
      const padVoices = [0, 1, 2].map(() => this.osc('sawtooth', 220, 0.05, pad, 0));
      this.schedule(tempo, (at, step) => {
        const { bar, s, part } = arc(step);
        const [r, ...ch] = prog[bar % 4];
        if (s === 0) {
          padVoices.forEach((o, i) => o.frequency.setTargetAtTime(midi(r + 24 + ch[i]), at, 0.02));
          set(pad, { intro: 0.6, build: 0.5, drop: 0.25, break: 0.8, final: 0.35, outro: 0.6 }[part], at, 1);
          if (bar === 16 || bar === 28) this.impact(at, verb, 0.7);
          if (bar === 15 || bar === 27) this.riser(at + barSec, barSec * 2, midi(50), bus, 0.3);
        }
        const full = part === 'drop' || part === 'final';
        const stomp = full || (part === 'build' && bar >= 12);
        if (stomp && (s % 4 === 0 || (part === 'build' && bar === 15 && s % 2 === 0))) this.kick(at);
        if (full && (s === 4 || s === 12)) this.clap(at, 0.4, bus).connect(verb);
        if (part !== 'outro' && s % 2 === 0) this.hat(at, s % 4 === 2 ? 0.1 : 0.04, s % 4 === 2 ? 0.12 : 0.04);
        if (stomp && s % 2 === 0) this.note(at, midi(r - 12 + (s % 4 ? 12 : 0)), bus, { gain: 0.3, decay: 0.18, cutoff: 900 });
        if (full && s % 4 === 2) for (const c of ch) this.note(at, midi(r + 12 + c), verb, { gain: 0.09, decay: 0.15, cutoff: 3000 }).connect(bus);
        if (part !== 'intro' || bar >= 4) {
          const up = [0, 1, 2, 3, 2, 1][s % 6];
          const n = r + 24 + [0, ...ch, 12][up];
          this.note(at, midi(n + (part === 'final' ? 12 : 0)), sky, { type: 'square', gain: full ? 0.08 : 0.05, decay: 0.1, cutoff: 4000 });
        }
      });
      return;
    }
    if (id === 'sandstorm') {
      // Sand sea: wind, a throat-voice drone, war drums, a wailing voice in phrygian dominant.
      const windBp = this.filter('bandpass', 600, 1.2);
      const wind = this.noiseSource(windBp, 0.4);
      this.lfo(windBp.frequency, 0.06, 450);
      const throat = this.stem(bus, 0.6);
      const growl = [this.vocal(midi(26), 0.12, throat), this.vocal(midi(38), 0.06, throat)];
      this.osc('sine', midi(26), 0.3, bus);
      const lead = this.stem(verb);
      const wail = this.vocal(midi(62), 0.1, lead);
      const scale = [0, 1, 4, 5, 7, 8, 10, 12];
      const pattern: Record<number, number> = { 0: 40, 3: 40, 6: 55, 8: 40, 10: 55, 11: 55, 14: 70 };
      this.schedule(tempo, (at, step) => {
        const { bar, s, part } = arc(step);
        const full = part === 'drop' || part === 'final';
        if (s === 0) {
          growl.forEach((x) => x.vowel(at, bar % 4 < 2 ? 0.1 : 0.8));
          set(wind, { intro: 0.4, build: 0.6, drop: 0.8, break: 0.3, final: 0.9, outro: 0.5 }[part], at, 2);
          set(lead, part === 'break' || part === 'final' ? 0.9 : 0, at, 1.5);
          if (bar === 16 || bar === 28) this.impact(at, verb);
          if (full && bar % 2 === 0) this.braam(at, midi(bar % 4 ? 39 : 38), barSec * 1.6, bus, 0.4);
          if (bar === 15 || bar === 27) this.riser(at + barSec, barSec, midi(45), bus, 0.3);
        }
        if (s % 8 === 0) {
          wail.o.frequency.setTargetAtTime(midi(62 + scale[Math.floor(Math.random() * scale.length)]), at, 0.12);
          wail.vowel(at, Math.random());
        }
        const drum = pattern[s];
        if (drum && (full || (part === 'build' && (s === 0 || s === 8 || bar >= 12)))) this.tom(at, drum, drum === 40 ? 0.8 : 0.5, 0.9).connect(verb);
        if (part === 'intro' && s === 0 && bar % 2 === 0) this.tom(at, 40, 0.5, 1.2).connect(verb);
      });
      return;
    }
    if (id === 'glyph') {
      // Logogram: a cluster of voices in fog, a bowed sub, and something vast that calls back.
      const cluster = this.stem(verb, 0.5);
      const voices = [50, 52, 53, 57, 60].map((n) => this.vocal(midi(n), 0.035, cluster));
      const bow = this.stem(this.filter('lowpass', 180, 1), 0.5);
      this.osc('sawtooth', midi(26), 0.2, bow);
      this.lfo(bow.gain, 0.07, 0.3);
      this.schedule(tempo, (at, step) => {
        const { bar, s, part } = arc(step);
        if (s !== 0 && s !== 10) return;
        const full = part === 'drop' || part === 'final';
        if (full) this.tom(at, 36, 0.7, 2).connect(verb);
        if (s) return;
        voices.forEach((v, i) => v.vowel(at, (bar + i) % 3 / 2));
        set(cluster, { intro: 0.5, build: 0.7, drop: 0.6, break: 0.9, final: 1, outro: 0.4 }[part], at, 2);
        if (bar % 4 === 0) this.call(at, barSec * 0.8, verb);
        if (bar === 16 || bar === 28) this.impact(at, verb);
        if (bar % 8 === 7) this.riser(at + barSec, barSec, midi(38), verb, 0.25);
        if (part === 'final' && bar % 2 === 0) this.braam(at, midi(38), barSec * 1.5, verb, 0.3);
      });
      return;
    }
    if (id === 'drone') {
      const lp = this.filter('lowpass', 500, 1.2);
      this.lfo(lp.frequency, 0.05, 250);
      for (const [n, d] of [[root, -7], [root, 7], [root + 7, 0], [root + 12, 4]]) this.osc('sawtooth', midi(n), 0.06, lp, d);
      this.schedule(tempo, (at, step) => step % 16 === 0 && this.kick(at));
      return;
    }
    if (id === 'bells') {
      const air = this.filter('bandpass', 1800, 0.6);
      this.lfo(air.frequency, 0.07, 900);
      this.noiseSource(air, 0.25);
      this.osc('triangle', midi(root + 12), 0.05, bus);
      this.schedule(tempo, (at, step) => {
        if (step % 4 === 0 && Math.random() < 0.7) this.bell(at, midi(root + 36 + PENTATONIC[Math.floor(Math.random() * 5)] + 12 * Math.floor(Math.random() * 2)));
      });
      return;
    }
    if (id === 'swell') {
      const surf = this.filter('lowpass', 700, 0.5);
      const g = this.noiseSource(surf, 0.5);
      this.lfo(g.gain, 0.09, 0.45);
      this.lfo(surf.frequency, 0.09, 400);
      this.osc('sine', midi(root - 12), 0.25, bus);
      return;
    }
    if (id === 'pulse') {
      const pad = this.filter('lowpass', 900, 1);
      this.lfo(pad.frequency, 1 / ((60 / tempo.bpm) * 16), 500);
      for (const n of [root + 12, root + 15, root + 19]) this.osc('sawtooth', midi(n), 0.025, pad, 6);
      const bassline = [0, 0, 12, 0, 10, 0, 12, 7];
      this.schedule(tempo, (at, step) => {
        if (step % 4 === 0) this.kick(at);
        if (step % 4 === 2) this.hat(at, 0.16);
        else if (step % 2 === 1) this.hat(at, 0.05);
        if (step % 2 === 0) this.pluck(at, midi(root + bassline[(step / 2) % 8]), 0.22);
      });
      return;
    }
    if (id === 'choir') {
      const verb = this.filter('lowpass', 2200, 0.5);
      const chords = [[root + 24, root + 28, root + 31], [root + 22, root + 26, root + 29], [root + 19, root + 24, root + 28]];
      const formant = this.filter('bandpass', 800, 2, verb);
      for (const n of chords[0]) {
        const o = this.osc('triangle', midi(n), 0.05, formant, 0);
        this.lfo(o.frequency, 5, 2);
      }
      this.schedule(tempo, (at, step) => step % 64 === 0 && this.bell(at, midi(root + 48), 0.04));
      return;
    }
    // Pink-noise sweep: bursts that pan around the room (stereo preview of the speaker rings).
    const pan = this.ctx.createStereoPanner();
    pan.connect(bus);
    this.lfo(pan.pan, 0.125, 1);
    this.noiseSource(pan, 0.35);
  }
}
