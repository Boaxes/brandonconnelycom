/**
 * Synthesised underwater ambience. No audio files: filtered noise for the
 * water, a slow low drone, and occasional vocalisations when large animals
 * are near (a rough orca-ish chirp and a low whale moan). Off by default.
 */
export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lp: BiquadFilterNode | null = null;
  private nextCall = 0;
  private running = false;

  start() {
    if (this.running) return;
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = (this.ctx = this.ctx ?? new AC());
    if (ctx.state === 'suspended') ctx.resume();
    this.running = true;
    const master = (this.master = ctx.createGain());
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2.5);

    // water: brown-ish noise through a wobbling low-pass
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = (this.lp = ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.55;
    noise.connect(lp).connect(ng).connect(master);
    noise.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 160;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();

    // drone
    const drone = ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 46;
    const dg = ctx.createGain();
    dg.gain.value = 0.12;
    const drone2 = ctx.createOscillator();
    drone2.type = 'triangle';
    drone2.frequency.value = 69.3;
    const dg2 = ctx.createGain();
    dg2.gain.value = 0.04;
    drone.connect(dg).connect(master);
    drone2.connect(dg2).connect(master);
    drone.start();
    drone2.start();
    this.nextCall = ctx.currentTime + 6;
  }

  stop() {
    if (!this.running || !this.ctx || !this.master) return;
    this.running = false;
    const m = this.master;
    m.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.2);
    setTimeout(() => m.disconnect(), 1400);
    this.master = null;
  }

  /** depth01: 0 surface .. 1 bottom. near: closest large animal kind + distance. */
  update(depthFromTop01: number, near: { key: string; dist: number } | null) {
    if (!this.running || !this.ctx || !this.lp || !this.master) return;
    const ctx = this.ctx;
    const deeper = 1 - Math.min(1, Math.max(0, depthFromTop01));
    this.lp.frequency.setTargetAtTime(280 + deeper * 300, ctx.currentTime, 0.5);
    if (near && ctx.currentTime > this.nextCall && near.dist < 45) {
      if (near.key === 'orca' || near.key === 'dolphin' || near.key === 'porpoise') this.orcaCall(near.dist);
      else if (near.key === 'humpback') this.whaleMoan(near.dist);
      else if (near.key === 'seal' || near.key === 'sealion') this.sealGrunt(near.dist);
      this.nextCall = ctx.currentTime + 7 + Math.random() * 12;
    }
  }

  private voice(dist: number, base: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const amp = base * Math.max(0.15, 1 - dist / 50);
    g.gain.value = 0;
    g.connect(this.master!);
    return { g, amp, t: ctx.currentTime };
  }

  private orcaCall(dist: number) {
    const ctx = this.ctx!;
    const { g, amp, t } = this.voice(dist, 0.16);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 4;
    o.connect(f).connect(g);
    const start = 900 + Math.random() * 600;
    o.frequency.setValueAtTime(start, t);
    o.frequency.exponentialRampToValueAtTime(start * 2.2, t + 0.35);
    o.frequency.exponentialRampToValueAtTime(start * 1.3, t + 0.9);
    g.gain.linearRampToValueAtTime(amp, t + 0.08);
    g.gain.linearRampToValueAtTime(0, t + 1.0);
    o.start(t);
    o.stop(t + 1.05);
  }

  private whaleMoan(dist: number) {
    const ctx = this.ctx!;
    const { g, amp, t } = this.voice(dist, 0.28);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.connect(g);
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 1.6);
    o.frequency.exponentialRampToValueAtTime(150, t + 3.4);
    g.gain.linearRampToValueAtTime(amp, t + 0.6);
    g.gain.linearRampToValueAtTime(0, t + 3.6);
    o.start(t);
    o.stop(t + 3.7);
  }

  private sealGrunt(dist: number) {
    const ctx = this.ctx!;
    const { g, amp, t } = this.voice(dist, 0.1);
    const o = ctx.createOscillator();
    o.type = 'square';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    o.connect(f).connect(g);
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(90, t + 0.4);
    g.gain.linearRampToValueAtTime(amp, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.45);
    o.start(t);
    o.stop(t + 0.5);
  }
}
