// Sons synthétisés à la volée (Web Audio) : ressac de la plage, mouettes au loin,
// bruits de sable humide, spray d'eau ("pssshh"), effondrements, catapulte et fanfare.
let ctx = null;
let master = null;
let muted = localStorage.getItem('sc-muted') === '1';
let noiseBuf = null;
let seagullTimer = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.72;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startAmbience();
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('sc-muted', muted ? '1' : '0');
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.72, ctx.currentTime, 0.05);
  return muted;
}

function noise(dur, { type = 'lowpass', freq = 800, q = 0.7, gain = 0.5, attack = 0.005, freqEnd = null, delay = 0 } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, { type = 'sine', gain = 0.3, freqEnd = null, delay = 0 } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function startAmbience() {
  // Ressac doux des vagues
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 480;
  const g = ctx.createGain();
  g.gain.value = 0.045;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.035;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(f).connect(g).connect(master);
  src.start();
  lfo.start();

  // Petits cris de mouettes occasionnels au loin
  if (!seagullTimer) {
    seagullTimer = setInterval(() => {
      if (!ctx || ctx.state !== 'running' || muted || Math.random() > 0.38) return;
      const base = 1350 + Math.random() * 400;
      tone(base, 0.28, { type: 'sine', gain: 0.025, freqEnd: base * 0.72 });
      if (Math.random() > 0.4) {
        tone(base * 1.08, 0.24, { type: 'sine', gain: 0.02, freqEnd: base * 0.68, delay: 0.34 });
      }
    }, 9000);
  }
}

export const sfx = {
  // Pose d'un pâté de sable mouillé : bruit de succion du seau + tassement grave
  place() {
    noise(0.19, { type: 'bandpass', freq: 620, freqEnd: 280, q: 0.9, gain: 0.48 });
    tone(125, 0.14, { freqEnd: 58, gain: 0.36 });
    tone(290, 0.06, { type: 'triangle', freqEnd: 420, gain: 0.12, delay: 0.03 });
  },
  pat() {
    this.place();
  },
  // Spray d'eau durcisseur : "Pssshhh" haute fréquence + petites gouttes cristallines
  spray() {
    noise(0.38, { type: 'bandpass', freq: 3400, freqEnd: 1900, q: 1.4, gain: 0.36, attack: 0.02 });
    noise(0.24, { type: 'highpass', freq: 4800, gain: 0.2, attack: 0.01 });
    for (let i = 0; i < 4; i++) {
      const f = 900 + Math.random() * 700;
      tone(f, 0.07, { type: 'sine', freqEnd: f * 1.35, gain: 0.08, delay: 0.04 + i * 0.06 });
    }
  },
  // Effondrement / glissement de sable
  collapse() {
    noise(0.55, { type: 'bandpass', freq: 950, freqEnd: 320, q: 0.6, gain: 0.28, attack: 0.04 });
    tone(85, 0.3, { freqEnd: 44, gain: 0.22 });
  },
  // Alerte : du sable tombe sur le Roi !
  danger() {
    tone(580, 0.09, { type: 'sawtooth', freqEnd: 440, gain: 0.14 });
    tone(520, 0.11, { type: 'sawtooth', freqEnd: 380, gain: 0.14, delay: 0.1 });
  },
  king() {
    tone(587, 0.11, { type: 'triangle', gain: 0.22 });
    tone(880, 0.18, { type: 'triangle', gain: 0.2, delay: 0.08 });
    tone(1175, 0.22, { type: 'sine', gain: 0.15, delay: 0.16 });
  },
  fire() {
    noise(0.52, { type: 'bandpass', freq: 380, freqEnd: 2300, q: 1.2, gain: 0.38, attack: 0.04 });
    tone(190, 0.14, { type: 'square', gain: 0.08, freqEnd: 85 });
  },
  impact(strength = 1) {
    noise(0.7 + strength * 0.3, { freq: 920, freqEnd: 120, gain: 0.72 });
    tone(74, 0.48, { freqEnd: 34, gain: 0.58 });
    setTimeout(() => noise(1.1, { type: 'bandpass', freq: 2800, q: 0.5, gain: 0.14, attack: 0.18 }), 110);
  },
  grenadeLand() {
    noise(0.3, { type: 'bandpass', freq: 3200, freqEnd: 800, gain: 0.35, attack: 0.02 });
    tone(520, 0.08, { type: 'triangle', freqEnd: 240, gain: 0.18 });
  },
  grenadeTick(fuseLeft = 60) {
    const pitch = 950 + (120 - fuseLeft) * 8;
    tone(pitch, 0.035, { type: 'square', gain: 0.08 });
  },
  grenadeExplosion() {
    // Énorme explosion sourde et dévastatrice
    noise(1.5, { freq: 1400, freqEnd: 55, gain: 0.95 });
    tone(58, 0.9, { freqEnd: 22, gain: 0.85 });
    setTimeout(() => {
      noise(1.8, { type: 'bandpass', freq: 3600, freqEnd: 400, q: 0.4, gain: 0.35, attack: 0.08 });
      tone(42, 0.6, { freqEnd: 18, gain: 0.5 });
    }, 90);
  },
  miss() {
    noise(0.55, { type: 'bandpass', freq: 1200, freqEnd: 280, gain: 0.16 });
    tone(240, 0.25, { type: 'sine', freqEnd: 110, gain: 0.12 });
  },
  kingDead() {
    tone(392, 0.22, { type: 'sawtooth', gain: 0.15 });
    tone(349, 0.22, { type: 'sawtooth', gain: 0.15, delay: 0.22 });
    tone(311, 0.22, { type: 'sawtooth', gain: 0.15, delay: 0.44 });
    tone(261, 0.65, { type: 'sawtooth', gain: 0.16, delay: 0.66, freqEnd: 185 });
  },
  win() {
    [523, 659, 784, 1047, 1318].forEach((f, i) =>
      tone(f, 0.38, { type: 'triangle', gain: 0.2, delay: i * 0.11 }),
    );
  },
  tick() {
    tone(1150, 0.045, { type: 'square', gain: 0.05 });
  },
  go() {
    tone(523, 0.12, { type: 'triangle', gain: 0.22 });
    tone(784, 0.26, { type: 'triangle', gain: 0.22, delay: 0.1 });
  },
  // Cliquet d'inclinomètre en laiton ou retournement de patron
  ratchet(pitch = 750) {
    tone(pitch, 0.025, { type: 'square', freqEnd: pitch * 0.7, gain: 0.06 });
  },
  // Treuil & corde de catapult sous tension
  winch(progress = 0.5) {
    const f = 160 + progress * 240;
    tone(f, 0.045, { type: 'sawtooth', freqEnd: f + 30, gain: 0.05 + progress * 0.05 });
  },
  // Bonus Légendaire : Déluge Divin (onde céleste et cascade cristalline)
  deluge() {
    noise(1.8, { type: 'bandpass', freq: 2800, freqEnd: 800, gain: 0.5, attack: 0.1 });
    [440, 554, 659, 880, 1108].forEach((f, i) =>
      tone(f, 0.85, { type: 'sine', gain: 0.18, delay: i * 0.11 }),
    );
  },
  // Bonus Légendaire : Sécheresse Apocalyptique / Tempête Solaire (souffle ardent et grondement)
  solarStorm() {
    noise(2.2, { type: 'lowpass', freq: 1200, freqEnd: 200, gain: 0.75, attack: 0.05 });
    tone(95, 1.2, { type: 'sawtooth', freqEnd: 32, gain: 0.45 });
  },
};

