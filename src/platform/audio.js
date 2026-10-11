// Synthesized sound effects (Web Audio, no files). Every voice (sine/triangle partials, a low-passed
// sawtooth for the fanfare, filtered noise) is shaped by an envelope that starts and ends at exactly 0
// (no clicks); everything goes through a master gain + compressor, so overlapping sounds never clip.
// iOS: the AudioContext is created lazily in unlock(), which must run inside pointerup / touchend / click /
// keydown (pointerdown and touchstart do not grant activation there). navigator.audioSession.type =
// 'ambient' keeps the silent switch working and mixes with the user's music.
// Nothing touches window at import time and nothing throws.

const MASTER = 0.6;
const COMP_MAKEUP = 1.45; // small-signal gain of the compressor below (its automatic makeup gain, measured)
const COMP_PREDELAY = 0.006; // the compressor's built-in look-ahead
const BYPASS_S = 0.25; // dry path at bus start-up, see createMasterBus()
const RELEASE = 0.012; // final linear fade to exact zero
const LOOKAHEAD = 0.006; // schedule slightly ahead so attacks are never cut
const GRACE_MS = 400; // sounds requested right after unlock() while the context is still starting
const STUCK_MS = 2500; // a resume() pending this long (e.g. after a phone call) → new context on next gesture
const MAX_PITCH_HZ = 2400;

/** Names accepted by play(). */
export const SOUND_NAMES = Object.freeze(['pick', 'place', 'clear', 'perfect', 'invalid', 'deal', 'gameover', 'newbest', 'click']);

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const clampInt = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);

const noiseBuffers = new WeakMap();

function noiseBuffer(c) {
  let buf = noiseBuffers.get(c);
  if (!buf) {
    buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = buf.getChannelData(0);
    let s = 0x9e3779b9; // xorshift32: deterministic, so renders are reproducible
    for (let i = 0; i < d.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = (s >>> 0) / 2147483648 - 1;
    }
    noiseBuffers.set(c, buf);
  }
  return buf;
}

/** 0 → peak (linear attack) → exponential decay to -60 dB → linear fade to 0. Returns the end time. */
function envelope(param, t0, peak, attack, decay) {
  const a = Math.max(attack, 0.0015);
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + a);
  param.exponentialRampToValueAtTime(peak * 0.001, t0 + a + decay);
  param.linearRampToValueAtTime(0, t0 + a + decay + RELEASE);
  return t0 + a + decay + RELEASE;
}

/** One sound instance: its voices feed `out`, which is disconnected once every voice has ended. */
function voiceGroup(c, dest, volume) {
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(dest);
  let live = 0;
  return {
    c,
    out,
    add(src, nodes) {
      live++;
      src.onended = () => {
        nodes.forEach((n) => n.disconnect());
        if (--live === 0) out.disconnect();
      };
    },
  };
}

/** Oscillator voice with an optional exponential pitch glide and optional lowpass. */
function tone(v, t0, { type = 'sine', f, f2, glide = 0.05, peak, attack = 0.004, decay, detune = 0, lp = 0 }) {
  const { c } = v;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t0 + glide);
  if (detune) osc.detune.setValueAtTime(detune, t0);
  const g = c.createGain();
  g.gain.value = 0;
  const end = envelope(g.gain, t0, peak, attack, decay);
  const nodes = [osc, g];
  let head = osc;
  if (lp) {
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = lp;
    flt.Q.value = 0.5;
    osc.connect(flt);
    head = flt;
    nodes.push(flt);
  }
  head.connect(g);
  g.connect(v.out);
  osc.start(t0);
  osc.stop(end + 0.005);
  v.add(osc, nodes);
  return end;
}

/** Filtered-noise voice; the filter frequency can sweep from f to f2 over the whole envelope. */
function hiss(v, t0, { filter = 'bandpass', f, f2, q = 1, peak, attack = 0.002, decay, offset = 0 }) {
  const { c } = v;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const flt = c.createBiquadFilter();
  flt.type = filter;
  flt.Q.value = q;
  const g = c.createGain();
  g.gain.value = 0;
  const end = envelope(g.gain, t0, peak, attack, decay);
  flt.frequency.setValueAtTime(f, t0);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, end);
  src.connect(flt);
  flt.connect(g);
  g.connect(v.out);
  src.start(t0, offset);
  src.stop(end + 0.005);
  v.add(src, [src, flt, g]);
  return end;
}

/** Glassy pluck: pure fundamental plus brighter partials that die away faster. */
function pluck(v, t, f, peak, decay = 0.55) {
  const end = tone(v, t, { f, peak, attack: 0.003, decay });
  tone(v, t, { f: f * 2, peak: peak * 0.32, attack: 0.002, decay: decay * 0.4, detune: 4 });
  tone(v, t, { f: f * 3, peak: peak * 0.12, attack: 0.002, decay: decay * 0.2 });
  tone(v, t, { f: f * 4.2, peak: peak * 0.05, attack: 0.0015, decay: decay * 0.09 });
  return end;
}

/** Soft rounded tone for the game-over phrase: slower attack, few harmonics. */
function mellow(v, t, f, peak, decay) {
  const end = tone(v, t, { f, peak, attack: 0.014, decay });
  tone(v, t, { f: f * 2, peak: peak * 0.2, attack: 0.012, decay: decay * 0.5 });
  tone(v, t, { f: f * 3, peak: peak * 0.06, attack: 0.01, decay: decay * 0.3 });
  tone(v, t, { type: 'triangle', f, peak: peak * 0.25, attack: 0.02, decay: decay * 0.8, detune: 5, lp: 1500 });
  return end;
}

/** Bright, rounded "brass": sawtooth through a lowpass that opens on the attack, plus a sine body. */
function brass(v, t, f, peak, decay) {
  const { c } = v;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f, t);
  const flt = c.createBiquadFilter();
  flt.type = 'lowpass';
  flt.Q.value = 0.7;
  flt.frequency.setValueAtTime(f * 1.2, t);
  flt.frequency.exponentialRampToValueAtTime(Math.min(f * 5, 4500), t + 0.035);
  flt.frequency.exponentialRampToValueAtTime(f * 1.6, t + decay);
  const g = c.createGain();
  g.gain.value = 0;
  const end = envelope(g.gain, t, peak, 0.008, decay);
  osc.connect(flt);
  flt.connect(g);
  g.connect(v.out);
  osc.start(t);
  osc.stop(end + 0.005);
  v.add(osc, [osc, flt, g]);
  tone(v, t, { f, peak: peak * 0.6, attack: 0.008, decay });
  return end;
}

/** Each sound schedules its voices at time t and returns its end time. */
const SOUNDS = {
  // Picking a piece up: a soft upward "tuck".
  pick(v, t) {
    return Math.max(
      tone(v, t, { f: 600, f2: 900, glide: 0.035, peak: 0.19, attack: 0.003, decay: 0.07 }),
      tone(v, t, { f: 1200, f2: 1800, glide: 0.035, peak: 0.032, attack: 0.002, decay: 0.035 }),
      hiss(v, t, { f: 3000, q: 1.2, peak: 0.04, attack: 0.001, decay: 0.012, offset: 0.21 })
    );
  },

  // Dropping a piece: woody "thock" (falling body + knock + short noise strike). The knock and the
  // strike carry it on phone speakers, the body adds weight on headphones.
  place(v, t) {
    return Math.max(
      tone(v, t, { f: 340, f2: 160, glide: 0.06, peak: 0.28, attack: 0.002, decay: 0.13 }),
      tone(v, t, { type: 'triangle', f: 880, f2: 700, glide: 0.03, peak: 0.32, attack: 0.0015, decay: 0.07 }),
      tone(v, t, { f: 1950, peak: 0.08, attack: 0.0015, decay: 0.03 }),
      hiss(v, t, { f: 2200, q: 0.9, peak: 0.24, attack: 0.001, decay: 0.02, offset: 0.05 })
    );
  },

  // Line clear: glassy pop + plucked arpeggio, one note per line (up to 6), a little brighter and
  // louder for bigger clears; +1 semitone per combo step (opts.streak), capped at +12.
  clear(v, t, opts) {
    const lines = clampInt(opts.lines, 1, 6, 1);
    const shift = clampInt(opts.streak, 0, 12, 0);
    const steps = [0, 7, 12, 16, 19, 24].slice(0, lines);
    const peak = 0.22 + 0.015 * (lines - 1);
    let end = tone(v, t, { f: 1700, f2: 520, glide: 0.03, peak: 0.08, attack: 0.001, decay: 0.035 });
    steps.forEach((s, i) => {
      let note = 72 + shift + s; // C5 upwards
      while (hz(note) > MAX_PITCH_HZ) note -= 12;
      end = Math.max(end, pluck(v, t + i * 0.055, hz(note), peak * Math.pow(0.86, i)));
    });
    if (lines >= 3) {
      end = Math.max(end, hiss(v, t + 0.04, { filter: 'highpass', f: 5000, q: 0.5, peak: 0.012 * lines, attack: 0.03, decay: 0.35, offset: 0.37 }));
    }
    return end;
  },

  // Perfect / all clear: warm pad, sparkling upward arpeggio, little twinkles.
  perfect(v, t) {
    let end = 0;
    [72, 76, 79].forEach((n) => {
      end = Math.max(end, tone(v, t, { f: hz(n), peak: 0.07, attack: 0.03, decay: 0.75 }));
    });
    [79, 84, 88, 91, 96].forEach((n, i) => {
      end = Math.max(end, pluck(v, t + i * 0.05, hz(n), 0.2 * Math.pow(0.84, i), 0.42));
    });
    [[0.3, 93], [0.37, 100], [0.44, 96], [0.52, 103]].forEach(([dt, n]) => {
      end = Math.max(end, tone(v, t + dt, { f: hz(n), peak: 0.035, attack: 0.002, decay: 0.16 }));
    });
    return end;
  },

  // Failed drop over the board: one soft, low, rounded bump (voiced high enough for phone speakers).
  invalid(v, t) {
    return Math.max(
      tone(v, t, { type: 'triangle', f: 260, f2: 180, glide: 0.1, peak: 0.36, attack: 0.008, decay: 0.17, lp: 1200 }),
      tone(v, t, { f: 520, f2: 360, glide: 0.1, peak: 0.21, attack: 0.008, decay: 0.11 }),
      tone(v, t, { f: 780, f2: 540, glide: 0.1, peak: 0.05, attack: 0.008, decay: 0.07 })
    );
  },

  // New tray: airy whoosh with three bubbly pops (60 ms apart, like the pop-in animation).
  deal(v, t) {
    let end = hiss(v, t, { f: 500, f2: 2600, q: 0.8, peak: 0.12, attack: 0.07, decay: 0.16, offset: 0.3 });
    [660, 830, 990].forEach((f, i) => {
      end = Math.max(end, tone(v, t + 0.03 + i * 0.06, { f: f * 0.8, f2: f, glide: 0.025, peak: 0.19, attack: 0.003, decay: 0.07 }));
    });
    return end;
  },

  // No space left: gentle descending G5 – E5 – C5, a soft low C under the last note.
  gameover(v, t) {
    return Math.max(
      mellow(v, t, hz(79), 0.16, 0.5),
      mellow(v, t + 0.28, hz(76), 0.16, 0.5),
      mellow(v, t + 0.56, hz(72), 0.18, 0.95),
      tone(v, t + 0.56, { f: hz(60), peak: 0.08, attack: 0.02, decay: 0.8 })
    );
  },

  // New best score: bright ascending fanfare (C5 E5 G5 → C-major chord), under 1.2 s.
  newbest(v, t) {
    let end = 0;
    [[0, 72], [0.085, 76], [0.17, 79]].forEach(([dt, n]) => {
      end = Math.max(end, brass(v, t + dt, hz(n), 0.17, 0.2));
    });
    [72, 76, 79, 84].forEach((n) => {
      end = Math.max(end, brass(v, t + 0.255, hz(n), n === 84 ? 0.13 : 0.1, 0.8));
    });
    [[0.38, 96], [0.46, 100], [0.54, 103]].forEach(([dt, n]) => {
      end = Math.max(end, tone(v, t + dt, { f: hz(n), peak: 0.035, attack: 0.002, decay: 0.18 }));
    });
    return end;
  },

  // UI button: tiny tick.
  click(v, t) {
    return Math.max(
      tone(v, t, { f: 1500, f2: 1150, glide: 0.02, peak: 0.22, attack: 0.0015, decay: 0.035 }),
      hiss(v, t, { filter: 'highpass', f: 3500, q: 0.7, peak: 0.045, attack: 0.001, decay: 0.012, offset: 0.11 })
    );
  },
};

/**
 * Master bus: gain → compressor → ctx.destination. Returns the input GainNode.
 * The compressor starts fully clamped and recovers over its release time (~0.15 s), which would swallow
 * the first sound after unlock, so for the first BYPASS_S the bus feeds a level-matched, latency-matched
 * dry path and then crossfades to the compressor.
 * @param {BaseAudioContext} ctx
 * @returns {GainNode}
 */
export function createMasterBus(ctx) {
  const input = ctx.createGain();
  input.gain.value = MASTER;
  // Near-transparent for a single sound, a soft limiter when several overlap.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 6;
  comp.ratio.value = 12;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  const wet = ctx.createGain();
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = COMP_PREDELAY;
  const dry = ctx.createGain();
  const t = ctx.currentTime;
  const x = t + BYPASS_S;
  dry.gain.setValueAtTime(COMP_MAKEUP, t);
  dry.gain.setValueAtTime(COMP_MAKEUP, x);
  dry.gain.linearRampToValueAtTime(0, x + 0.05);
  wet.gain.setValueAtTime(0, t);
  wet.gain.setValueAtTime(0, x);
  wet.gain.linearRampToValueAtTime(1, x + 0.05);
  input.connect(comp);
  comp.connect(wet);
  wet.connect(ctx.destination);
  input.connect(delay);
  delay.connect(dry);
  dry.connect(ctx.destination);
  return input;
}

/**
 * Schedules one sound on any BaseAudioContext (an OfflineAudioContext too, for rendering tests).
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} destination
 * @param {string} name one of SOUND_NAMES
 * @param {{ lines?: number, streak?: number, volume?: number }} [opts]
 *   clear: lines cleared (1–6 notes) and combo step (+1 semitone each, max +12); volume 0..1 for any sound
 * @param {number} [when] start time (default: now + a few ms)
 * @returns {number} the sound's length in seconds (0 for an unknown name)
 */
export function scheduleSound(ctx, destination, name, opts, when) {
  const fn = Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : null;
  if (!fn) return 0;
  const o = opts || {};
  const volume = Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : 1;
  const t0 = Number.isFinite(when) ? when : ctx.currentTime + LOOKAHEAD;
  return fn(voiceGroup(ctx, destination, volume), t0, o) - t0;
}

/**
 * Creates the app's sound player. Unlock listeners (pointerup / touchend / click / keydown, capture phase)
 * are installed on window here, so audio unlocks on the first real gesture even if the app forgets.
 * @returns {{ unlock(): void, play(name: string, opts?: object): boolean, muted: boolean, readonly state: string }}
 */
export function createAudio() {
  let ctx = null;
  let bus = null;
  let muted = false;
  let primed = false;
  let unlockedAt = -Infinity;
  let resumeSince = 0;
  const lastStart = Object.create(null);
  const hasWindow = typeof window !== 'undefined';
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const quiet = (p) => {
    if (p && typeof p.catch === 'function') p.catch(() => {});
  };

  const setSession = () => {
    try {
      const s = navigator.audioSession;
      if (s && s.type !== 'ambient') s.type = 'ambient';
    } catch {
      // not supported
    }
  };

  const create = () => {
    const AC = hasWindow ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return false;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new AC();
      } catch {
        ctx = null;
        return false;
      }
    }
    bus = createMasterBus(ctx);
    primed = false;
    resumeSince = 0;
    return true;
  };

  const resume = () => {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') {
      resumeSince = 0;
      return;
    }
    if (!resumeSince) resumeSince = now();
    try {
      const c = ctx;
      const p = c.resume();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          if (ctx === c) resumeSince = 0;
        }, () => {});
      }
    } catch {
      // ignore
    }
  };

  const unlock = () => {
    try {
      if (muted) return;
      setSession();
      if (ctx && (ctx.state === 'closed' || (ctx.state !== 'running' && resumeSince && now() - resumeSince > STUCK_MS))) {
        try {
          quiet(ctx.close()); // stuck after an interruption: start over (we are inside a gesture)
        } catch {
          // ignore
        }
        ctx = null;
      }
      if (!ctx && !create()) return;
      unlockedAt = now();
      resume();
      if (!primed) {
        primed = true;
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start(0);
      }
    } catch {
      // ignore
    }
  };

  const play = (name, opts) => {
    try {
      if (muted || !ctx || ctx.state === 'closed') return false;
      const running = ctx.state === 'running';
      if (!running && now() - unlockedAt > GRACE_MS) return false; // suspended / interrupted: drop, don't queue
      if (running) resumeSince = 0;
      const t = ctx.currentTime;
      if (lastStart[name] !== undefined && Math.abs(t - lastStart[name]) < 0.025) return false;
      lastStart[name] = t;
      if (running) return scheduleSound(ctx, bus, name, opts, t + LOOKAHEAD) > 0;
      // The context is still starting (just unlocked): queue the sound behind a gate that is cut if it does
      // not start soon, so a context stuck in 'interrupted' never plays stale sounds much later.
      const gate = ctx.createGain();
      gate.connect(bus);
      const c = ctx;
      const dur = scheduleSound(ctx, gate, name, opts, t + LOOKAHEAD);
      setTimeout(() => {
        if (c.state !== 'running') gate.disconnect();
        else setTimeout(() => gate.disconnect(), (dur + 0.2) * 1000);
      }, GRACE_MS);
      return dur > 0;
    } catch {
      return false;
    }
  };

  const setMuted = (value) => {
    const v = !!value;
    if (v === muted) return;
    muted = v;
    try {
      if (!ctx) {
        const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
        if (!v && (!ua || ua.isActive)) unlock(); // unmuted from a tap: start right away
        return;
      }
      const g = bus.gain;
      const t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(v ? 0 : MASTER, t + 0.03);
      if (v) {
        setTimeout(() => {
          if (muted && ctx && ctx.state === 'running') quiet(ctx.suspend()); // save battery while muted
        }, 80);
      } else {
        unlock();
      }
    } catch {
      // ignore
    }
  };

  if (hasWindow) {
    setSession();
    try {
      for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
        window.addEventListener(type, unlock, { capture: true, passive: true });
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && ctx && !muted) resume();
      });
    } catch {
      // ignore
    }
  }

  return {
    /** Creates/resumes the AudioContext; call from pointerup / touchend / click / keydown handlers. */
    unlock,
    /** Plays a sound now; silently does nothing while muted or while audio is not running. */
    play,
    get muted() {
      return muted;
    },
    set muted(v) {
      setMuted(v);
    },
    /** 'none' before the first unlock, else the AudioContext state. */
    get state() {
      return ctx ? ctx.state : 'none';
    },
  };
}
