// Generative ambience: slow pads with bells, plucks and arpeggios per wing,
// plus footsteps and a portal whoosh. Everything is synthesized live.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const MOODS = {
  lobby: {
    chords: [[48, 55, 59, 64, 67], [45, 52, 57, 60, 64], [41, 48, 55, 57, 64], [43, 50, 55, 59, 62]],
    dur: 8.5, cutoff: 1500, pad: 0.045,
    bell: { rate: 0.55, notes: [72, 74, 76, 79, 81, 83, 84, 88], ratio: 3.5, decay: 3.2, gain: 0.045 },
  },
  gallery: {
    chords: [[38, 50, 57, 62, 65], [34, 46, 53, 58, 62], [41, 53, 57, 60, 65], [36, 48, 55, 60, 64]],
    dur: 9, cutoff: 1100, pad: 0.045,
    pluck: { every: 0.62, chance: 0.7, gain: 0.03 },
  },
  eyes: {
    chords: [[38, 45, 50, 57, 62], [39, 46, 51, 55, 62], [38, 45, 53, 57, 60], [37, 44, 50, 56, 61]],
    dur: 12, cutoff: 650, pad: 0.055,
    bell: { rate: 0.3, notes: [86, 89, 93, 96, 98], ratio: 1.0, decay: 6, gain: 0.022, slow: true },
  },
  familiars: {
    chords: [[52, 59, 63, 66, 71], [49, 56, 61, 64, 68], [45, 52, 57, 61, 64], [47, 54, 59, 63, 66]],
    dur: 8, cutoff: 2300, pad: 0.035,
    arp: { step: 0.3, gain: 0.022 },
    bell: { rate: 0.2, notes: [83, 86, 88, 90, 95], ratio: 2, decay: 1.4, gain: 0.025 },
  },
  bedroom: {
    chords: [[53, 60, 64, 67, 69], [52, 59, 62, 67, 71], [50, 57, 60, 65, 69], [48, 55, 59, 62, 67]],
    dur: 7, cutoff: 1300, pad: 0.035,
    bell: { rate: 1.6, notes: [77, 79, 81, 84, 86, 88, 91], ratio: 5.1, decay: 1.1, gain: 0.04 },
  },
};

const SURFACES = {
  marble: { f: 2300, q: 1.3, g: 0.2, d: 0.08, wet: 0.5 },
  wood: { f: 480, q: 1.4, g: 0.34, d: 0.12, wet: 0.2 },
  stone: { f: 850, q: 1.1, g: 0.22, d: 0.1, wet: 0.6 },
  void: { f: 1500, q: 0.8, g: 0.09, d: 0.07, wet: 0.35 },
  carpet: { f: 260, q: 0.7, g: 0.2, d: 0.11, wet: 0.05 },
};

export class MuseumAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.mood = 'lobby';
    this.chordIndex = 0;
    this.timer = null;
  }

  get started() {
    return !!this.ctx;
  }

  start(mood = 'lobby') {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.mood = mood;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.85, ctx.currentTime + 3);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(4.2, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(this.master);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.7;
    this.dry.connect(this.master);

    this.noise = this.noiseBuffer();
    this.roomTone();
    this.nextChordAt = ctx.currentTime + 0.3;
    this.timer = setInterval(() => this.schedule(), 200);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  setMood(mood) {
    if (!MOODS[mood] || mood === this.mood) return;
    this.mood = mood;
    this.chordIndex = 0;
    if (this.ctx) this.nextChordAt = Math.min(this.nextChordAt, this.ctx.currentTime + 0.6);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.85, t + 0.6);
  }

  send(node, dry, wet) {
    const d = this.ctx.createGain();
    d.gain.value = dry;
    const w = this.ctx.createGain();
    w.gain.value = wet;
    node.connect(d).connect(this.dry);
    node.connect(w).connect(this.reverb);
  }

  impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noiseBuffer() {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * 2, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  roomTone() {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, rate * 4, rate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.dry);
    src.start();
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    while (this.nextChordAt < ctx.currentTime + 0.6) {
      const mood = MOODS[this.mood];
      const chord = mood.chords[this.chordIndex % mood.chords.length];
      this.chordIndex++;
      this.playChord(chord, this.nextChordAt, mood);
      this.nextChordAt += mood.dur;
    }
  }

  playChord(chord, t0, mood) {
    for (const m of chord) this.pad(mtof(m), t0, mood.dur, mood.pad, mood.cutoff);
    const span = mood.dur;
    if (mood.bell) {
      for (let t = 0.4; t < span; t += 0.25) {
        if (Math.random() < mood.bell.rate * 0.25) {
          const notes = mood.bell.notes;
          this.bell(mtof(notes[Math.floor(Math.random() * notes.length)]), t0 + t + Math.random() * 0.1, mood.bell);
        }
      }
    }
    if (mood.pluck) {
      for (let t = 0.3; t < span; t += mood.pluck.every) {
        if (Math.random() < mood.pluck.chance) this.pluck(mtof(chord[1 + Math.floor(Math.random() * (chord.length - 1))] + 12), t0 + t, mood.pluck.gain);
      }
    }
    if (mood.arp) {
      const seq = [...chord.slice(1), ...chord.slice(1).reverse()].map((m) => m + 12);
      let i = 0;
      for (let t = 0; t < span - 0.2; t += mood.arp.step, i++) this.blip(mtof(seq[i % seq.length]), t0 + t, mood.arp.gain);
    }
  }

  pad(freq, t0, dur, gain, cutoff) {
    const ctx = this.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + 2.4);
    env.gain.setValueAtTime(gain, t0 + dur);
    env.gain.linearRampToValueAtTime(0.0001, t0 + dur + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.5;
    const oscs = [
      ['sine', 1, 1],
      ['triangle', 1.004, 0.6],
      ['sawtooth', 0.997, 0.12],
    ].map(([type, detune, level]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(lp);
      o.start(t0);
      o.stop(t0 + dur + 4.2);
      return o;
    });
    lp.connect(env);
    this.send(env, 0.55, 0.6);
    return oscs;
  }

  bell(freq, t, { ratio, decay, gain, slow }) {
    const ctx = this.ctx;
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * ratio;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 1.4, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + decay * 0.4);
    mod.connect(modGain).connect(car.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + (slow ? 1.2 : 0.005));
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    car.connect(env).connect(pan);
    this.send(pan, 0.35, 0.9);
    car.start(t);
    mod.start(t);
    car.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
  }

  pluck(freq, t, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 0.8 - 0.4;
    o.connect(lp).connect(env).connect(pan);
    this.send(pan, 0.5, 0.5);
    o.start(t);
    o.stop(t + 0.75);
  }

  blip(freq, t, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(env);
    this.send(env, 0.45, 0.6);
    o.start(t);
    o.stop(t + 0.3);
  }

  step(surface) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const s = SURFACES[surface] || SURFACES.marble;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = s.f * (0.9 + Math.random() * 0.2);
    bp.Q.value = s.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(s.g, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + s.d);
    src.connect(bp).connect(env);
    this.send(env, 0.8, s.wet);
    src.start(t, Math.random() * 1.5, s.d + 0.05);
  }

  whoosh() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(3800, t + 1.0);
    bp.frequency.exponentialRampToValueAtTime(600, t + 2.0);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.22, t + 0.8);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    src.connect(bp).connect(env);
    this.send(env, 0.6, 0.8);
    src.start(t);
    src.stop(t + 2.2);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(990, t + 1.0);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.03, t + 0.7);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(og);
    this.send(og, 0.3, 0.9);
    o.start(t);
    o.stop(t + 1.7);
  }

  chime() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.bell(mtof(84), t, { ratio: 3.5, decay: 2.2, gain: 0.03 });
    this.bell(mtof(91), t + 0.09, { ratio: 3.5, decay: 2.2, gain: 0.022 });
  }
}
