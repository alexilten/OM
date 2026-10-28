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

  private hit(at: number, build: (g: GainNode) => void, peak: number, decay: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    g.connect(this.bus!);
    build(g);
  }

  private kick(at: number) {
    this.hit(at, (g) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(150, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.5);
    }, 0.9, 0.45);
  }

  private hat(at: number, gain = 0.12) {
    this.hit(at, (g) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      s.connect(f).connect(g);
      s.start(at, Math.random());
      s.stop(at + 0.1);
    }, gain, 0.06);
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
