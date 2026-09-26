/**
 * All audio, on two buses the visitor controls separately, both on at the start of every visit:
 *   - background: the water, a seamless loop that runs the whole time
 *   - effects: everything that happens — the book, pages, the zoom, logging a species, animal calls
 * Each sound is a recording from /sounds/<name>.mp3 (listed in /sounds/manifest.json; CC0 from
 * Freesound, see the credits), with a small synthesised stand-in used
 * only if a file fails to load. Browsers keep audio locked until the first click or key press anywhere;
 * `unlock()` is wired to that.
 */
export type Sfx = 'pickup' | 'open' | 'close' | 'page' | 'discover' | 'lower' | 'raise' | 'click' | 'zoom';
export type Call = 'orca' | 'humpback' | 'sealion';

export class Sound {
  ambienceOn = true;
  sfxOn = true;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private amb!: GainNode;
  private sfx!: GainNode;
  /** calls pass through this: muffled a little, as heard through water */
  private water!: BiquadFilterNode;
  private buffers = new Map<string, AudioBuffer>();
  private ambStarted = false;
  private noiseBuf: AudioBuffer | null = null;
  /** resolves once the recordings are loaded (or have failed) */
  ready: Promise<void> = Promise.resolve();

  /** Call from a user gesture (any click or key). Creates the context, loads the recordings, starts the water. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0;
    this.amb.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.sfx.connect(this.master);
    this.water = ctx.createBiquadFilter();
    this.water.type = 'lowpass';
    this.water.frequency.value = 2400;
    this.water.Q.value = 0.5;
    this.water.connect(this.sfx);
    this.noiseBuf = this.makeNoise(2);
    // the water starts once the recordings are in (or have failed), so it's the real loop from the start
    this.ready = this.loadRecordings().finally(() => this.startAmbience());
    if (ctx.state === 'suspended') void ctx.resume();
  }

  setAmbience(on: boolean) {
    this.ambienceOn = on;
    if (!this.ctx || !this.ambStarted) return;
    const t = this.ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t);
    this.amb.gain.setValueAtTime(this.amb.gain.value, t);
    this.amb.gain.setTargetAtTime(on ? 0.55 : 0, t, on ? 0.6 : 0.15);
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.cancelScheduledValues(t);
    this.sfx.gain.setValueAtTime(this.sfx.gain.value, t);
    this.sfx.gain.setTargetAtTime(on ? 1 : 0, t, 0.05);
  }

  private async loadRecordings() {
    const ctx = this.ctx!;
    try {
      const base = import.meta.env.BASE_URL + 'sounds/';
      const res = await fetch(base + 'manifest.json');
      if (!res.ok) return;
      const names: string[] = await res.json();
      await Promise.all(names.map(async (n) => {
        try {
          const r = await fetch(base + n + '.mp3');
          if (!r.ok) return;
          this.buffers.set(n, await ctx.decodeAudioData(await r.arrayBuffer()));
        } catch { /* keep the synth stand-in */ }
      }));
    } catch { /* no recordings: synth only */ }
  }

  /** Play a recording if there is one (with a little pitch variation); false if there isn't. */
  private sample(name: string, bus: AudioNode, gain = 1, rate = 1, when = 0): boolean {
    const b = this.buffers.get(name);
    if (!b || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus);
    src.start(this.ctx.currentTime + when);
    return true;
  }

  // ---------------------------------------------------------------- effects

  play(name: Sfx) {
    if (!this.ctx || !this.sfxOn) return;
    if (name === 'page' && Math.random() < 0.5 && this.sample('page2', this.sfx)) return;
    if (name === 'discover' && this.sample('discover', this.sfx, 0.9)) {
      // the pencil note, then a soft two-note ping
      this.sample('ping', this.sfx, 0.5, 1, 0.55);
      return;
    }
    if (this.sample(name, this.sfx)) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'pickup': this.thump(t, 90, 0.5); this.rustle(t + 0.05, 0.35, 1800, 0.25); break;
      case 'open': this.creak(t, 0.5); this.rustle(t + 0.2, 0.3, 2400, 0.2); break;
      case 'close': this.thump(t, 120, 0.4); break;
      case 'page': this.rustle(t, 0.28, 3200, 0.35); this.rustle(t + 0.12, 0.18, 5200, 0.15); break;
      case 'lower': this.rustle(t, 0.4, 900, 0.2); break;
      case 'raise': this.rustle(t, 0.35, 1400, 0.2); break;
      case 'discover': this.chime(t); break;
      case 'click': this.tick(t); break;
      case 'zoom': this.detent(t, 1); break;
    }
  }

  private zoomAt = 0;
  /** A lens ring turning one click, higher as it zooms in. Throttled so a trackpad doesn't buzz. */
  zoom(level: number, zoomingIn: boolean) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime;
    if (t - this.zoomAt < 0.07) return;
    this.zoomAt = t;
    const rate = 0.85 + (level - 1) * 0.12 + (zoomingIn ? 0.05 : 0);
    if (this.sample('zoom', this.sfx, 0.8, rate)) return;
    this.detent(t, rate);
  }

  private detent(t: number, rate: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoise(0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600 * rate;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 0.05);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 520 * rate;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.025, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g2).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.1);
  }

  private makeNoise(seconds: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** filtered noise swish: paper, cloth */
  private rustle(t: number, dur: number, freq: number, amp: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq * 0.6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.4, t + dur * 0.6);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private thump(t: number, freq: number, amp: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.3);
  }

  private creak(t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(95, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.08);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private chime(t: number) {
    const ctx = this.ctx!;
    [[784, 0], [1175, 0.11], [1568, 0.22]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.16, t + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + d + 1.4);
      o.connect(g).connect(this.sfx);
      o.start(t + d);
      o.stop(t + d + 1.5);
    });
  }

  private tick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.08);
  }

  // ---------------------------------------------------------------- ambience and animal calls

  private startAmbience() {
    if (this.ambStarted || !this.ctx) return;
    this.ambStarted = true;
    const ctx = this.ctx;
    this.amb.gain.setValueAtTime(0, ctx.currentTime);
    this.amb.gain.setTargetAtTime(this.ambienceOn ? 0.55 : 0, ctx.currentTime, 1.5);
    const loop = this.buffers.get('ambience-loop');
    if (loop) {
      const src = ctx.createBufferSource();
      src.buffer = loop;
      src.loop = true;
      src.connect(this.amb);
      src.start();
      return;
    }
    // water: brown-ish noise through a wobbling low-pass, and a low drone
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.55;
    noise.connect(lp).connect(ng).connect(this.amb);
    noise.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    for (const [f, a, type] of [[46, 0.12, 'sine'], [69.3, 0.04, 'triangle']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(this.amb);
      o.start();
    }
  }

  // ---------------------------------------------------------------- the opening

  /** Out of silence: a low drone swells and the diver's breathing comes in (on the background bus). */
  opener() {
    if (!this.ctx) return;
    this.sample('drone', this.amb, 1.1, 1);
    this.sample('breath', this.amb, 0.75, 1, 0.8);
  }

  /** The torch switching on. */
  torchClick() {
    if (!this.ctx || !this.sfxOn) return;
    if (!this.sample('torch', this.sfx, 0.9)) this.tick(this.ctx.currentTime);
  }

  /** The sea lion startling and darting off. */
  sealionDart() {
    if (!this.ctx || !this.sfxOn) return;
    this.sample('sealion-dart', this.water, 0.9);
  }

  /** An animal call (on the effects bus, through the water); `dist` in metres softens it. */
  call(kind: Call, dist = 10) {
    if (!this.ctx || !this.sfxOn) return;
    const amp = Math.max(0.25, 1 - dist / 40);
    if (kind === 'sealion') {
      // a bark, sometimes followed by a growl
      if (this.sample('sealion', this.water, 0.8 * amp, 0.92)) {
        if (Math.random() < 0.5) this.sample('sealion-growl', this.water, 0.6 * amp, 0.95, 0.9);
        return;
      }
    } else if (this.sample(kind, this.water, amp)) return;
    const t = this.ctx.currentTime;
    if (kind === 'orca') {
      for (let i = 0; i < 3; i++) this.whistle(t + i * (0.7 + Math.random() * 0.5), 900 + Math.random() * 700, 0.14 * amp);
    } else if (kind === 'humpback') {
      this.moan(t, 0.3 * amp);
      this.moan(t + 3.2, 0.22 * amp, 1.35);
    } else {
      this.grunt(t, 0.12 * amp);
    }
  }

  private whistle(t: number, start: number, amp: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500;
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(this.water);
    o.frequency.setValueAtTime(start, t);
    o.frequency.exponentialRampToValueAtTime(start * 2.2, t + 0.35);
    o.frequency.exponentialRampToValueAtTime(start * 1.3, t + 0.9);
    g.gain.linearRampToValueAtTime(amp, t + 0.08);
    g.gain.linearRampToValueAtTime(0, t + 1.0);
    o.start(t);
    o.stop(t + 1.05);
  }

  private moan(t: number, amp: number, k = 1) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g).connect(this.water);
    o.frequency.setValueAtTime(110 * k, t);
    o.frequency.exponentialRampToValueAtTime(240 * k, t + 1.6);
    o.frequency.exponentialRampToValueAtTime(150 * k, t + 3.4);
    g.gain.linearRampToValueAtTime(amp, t + 0.6);
    g.gain.linearRampToValueAtTime(0, t + 3.6);
    o.start(t);
    o.stop(t + 3.7);
  }

  private grunt(t: number, amp: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(this.water);
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(90, t + 0.4);
    g.gain.linearRampToValueAtTime(amp, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.45);
    o.start(t);
    o.stop(t + 0.5);
  }
}

export const sound = new Sound();
