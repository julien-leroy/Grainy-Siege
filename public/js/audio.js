// ==============================================================================
// MOTEUR AUDIO & SOUND DESIGN SYNTHÉTISÉ (WEB AUDIO API) — "GRAINY SIEGE"
// 100% procédural, 0 fichier externe, son 3D de plage, physique du sable,
// musique mignonne de construction avec timer accélérant + sifflet,
// et musique de guerre mignonne de combat balistique.
// ==============================================================================

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let muted = localStorage.getItem('sc-muted') === '1';
let noiseBuf = null;
let seagullTimer = null;
let chargeAudio = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  // Master Gain
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.72;
  master.connect(ctx.destination);

  // Sous-bus FX & Musique
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 1.0;
  sfxGain.connect(master);

  musicGain = ctx.createGain();
  musicGain.gain.value = 0.24;
  musicGain.connect(master);

  // Tampon de bruit blanc pour le vent, les vagues et le sable
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
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.72, ctx.currentTime, 0.05);
  return muted;
}

// Bruit blanc filtré (pour le sable, vent, vagues, explosions)
function noise(dur, { type = 'lowpass', freq = 800, q = 0.7, gain = 0.5, attack = 0.005, freqEnd = null, delay = 0, dest = null } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(10, freqEnd), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(dest || sfxGain || master);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

// Tonalité synthétique (sinus, triangle, carré, dent de scie)
function tone(freq, dur, { type = 'sine', gain = 0.3, freqEnd = null, delay = 0, dest = null } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(10, freqEnd), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(dest || sfxGain || master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Ambiance de fond : Ressac maritime doux et mouettes lointaines
function startAmbience() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 460;
  const g = ctx.createGain();
  g.gain.value = 0.04;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(f).connect(g).connect(master);
  src.start();
  lfo.start();

  if (!seagullTimer) {
    seagullTimer = setInterval(() => {
      if (!ctx || ctx.state !== 'running' || muted || Math.random() > 0.35) return;
      const base = 1350 + Math.random() * 400;
      tone(base, 0.28, { type: 'sine', gain: 0.022, freqEnd: base * 0.72 });
      if (Math.random() > 0.4) {
        tone(base * 1.08, 0.24, { type: 'sine', gain: 0.018, freqEnd: base * 0.68, delay: 0.32 });
      }
    }, 9500);
  }
}

// ==============================================================================
// SOUND DESIGN : PHYSIQUE DU SABLE, ARMES & ACTIONS
// ==============================================================================

export const sfx = {
  // 1. Pose d'un pâté ou démoulage de seau de sable mouillé ("floup-tchak")
  place() {
    // Aspiration / démoulage
    tone(260, 0.12, { type: 'triangle', freqEnd: 55, gain: 0.38 });
    // Tassement de sable humide sourd
    noise(0.22, { type: 'bandpass', freq: 650, freqEnd: 180, q: 1.1, gain: 0.52 });
    // Résonance grave du sol
    tone(85, 0.18, { type: 'sine', freqEnd: 42, gain: 0.4 });
  },
  pat() {
    this.place();
  },

  // 2. Chuchotement de grains de sable qui glissent / coulent
  sandSlide(intensity = 1) {
    const gain = Math.min(0.35, 0.12 + intensity * 0.08);
    noise(0.25, { type: 'bandpass', freq: 1750, freqEnd: 950, q: 0.75, gain, attack: 0.02 });
  },

  // 3. Éboulis / craquements de sable sec
  sandCrumble() {
    noise(0.35, { type: 'bandpass', freq: 2400, freqEnd: 450, q: 0.85, gain: 0.32, attack: 0.01 });
    tone(140, 0.16, { type: 'triangle', freqEnd: 50, gain: 0.18 });
  },

  // 4. Pelle / Cuillère : raclement de sable doux pour creuser ("shhh-krrk")
  dig() {
    noise(0.24, { type: 'bandpass', freq: 2100, freqEnd: 750, q: 1.2, gain: 0.38, attack: 0.01 });
    noise(0.18, { type: 'highpass', freq: 2800, gain: 0.16, delay: 0.04 });
    tone(175, 0.14, { type: 'sine', freqEnd: 85, gain: 0.18 });
  },

  // 5. Outil Aplatir : lissage et compactage doux au rasoir ("fssht-tok")
  flatten() {
    noise(0.28, { type: 'bandpass', freq: 1600, freqEnd: 520, q: 0.9, gain: 0.34, attack: 0.01 });
    tone(210, 0.08, { type: 'triangle', freqEnd: 110, gain: 0.22 });
    tone(120, 0.12, { type: 'sine', freqEnd: 60, gain: 0.28, delay: 0.03 });
  },

  // 6. Spray d'eau durcisseur : "Pssshhh" cristallin et rafraîchissant
  spray() {
    noise(0.40, { type: 'bandpass', freq: 3600, freqEnd: 2100, q: 1.3, gain: 0.38, attack: 0.015 });
    noise(0.26, { type: 'highpass', freq: 5200, gain: 0.22, attack: 0.01 });
    for (let i = 0; i < 4; i++) {
      const f = 980 + Math.random() * 650;
      tone(f, 0.065, { type: 'sine', freqEnd: f * 1.35, gain: 0.07, delay: 0.03 + i * 0.05 });
    }
  },

  // 7. Effondrement d'une tour / pan de mur
  collapse() {
    noise(0.65, { type: 'bandpass', freq: 1100, freqEnd: 280, q: 0.7, gain: 0.42, attack: 0.03 });
    tone(95, 0.35, { freqEnd: 38, gain: 0.32 });
    setTimeout(() => {
      noise(0.45, { type: 'bandpass', freq: 1600, freqEnd: 420, q: 0.6, gain: 0.22 });
    }, 120);
  },

  // 8. SIFFLET D'ARBITRE / DE MAÎTRE NAGEUR (Fin de la construction)
  // Deux oscillateurs aigus battant ensemble avec modulation LFO pour la roulette du sifflet
  whistle() {
    if (!ensure()) return;
    const now = ctx.currentTime;
    const blasts = [
      { start: 0.00, dur: 0.11 }, // Coup 1
      { start: 0.18, dur: 0.11 }, // Coup 2
      { start: 0.36, dur: 0.65 }, // Grand coup final d'arrêt
    ];

    for (const b of blasts) {
      const t = now + b.start;
      const dur = b.dur;

      // LFO pour le trille de la bille du sifflet (~32 Hz)
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(32, t);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(140, t);
      lfo.connect(lfoGain);

      // Osc 1 : Fréquence principale
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(2620, t);
      lfoGain.connect(osc1.frequency);

      // Osc 2 : Fréquence décalée pour battement acoustique aigu
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(2780, t);
      lfoGain.connect(osc2.frequency);

      // Bruit d'air soufflé
      const airSrc = ctx.createBufferSource();
      airSrc.buffer = noiseBuf;
      airSrc.loop = true;
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = 'bandpass';
      airFilter.frequency.setValueAtTime(2700, t);
      airFilter.Q.value = 6.0;

      // Enveloppe d'amplitude percutante
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.48, t + 0.015);
      env.gain.setValueAtTime(0.48, t + dur - 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc1.connect(env);
      osc2.connect(env);
      airSrc.connect(airFilter).connect(env);
      env.connect(sfxGain || master);

      osc1.start(t);
      osc2.start(t);
      airSrc.start(t);
      lfo.start(t);

      osc1.stop(t + dur + 0.02);
      osc2.stop(t + dur + 0.02);
      airSrc.stop(t + dur + 0.02);
      lfo.stop(t + dur + 0.02);
    }
  },

  // 9. Dégâts et événements du Roi
  danger() {
    tone(620, 0.08, { type: 'sawtooth', freqEnd: 460, gain: 0.16 });
    tone(540, 0.10, { type: 'sawtooth', freqEnd: 390, gain: 0.16, delay: 0.09 });
  },
  king() {
    tone(587, 0.11, { type: 'triangle', gain: 0.22 });
    tone(880, 0.18, { type: 'triangle', gain: 0.20, delay: 0.08 });
    tone(1175, 0.22, { type: 'sine', gain: 0.16, delay: 0.16 });
  },
  kingDead() {
    tone(392, 0.22, { type: 'sawtooth', gain: 0.16 });
    tone(349, 0.22, { type: 'sawtooth', gain: 0.16, delay: 0.22 });
    tone(311, 0.22, { type: 'sawtooth', gain: 0.16, delay: 0.44 });
    tone(261, 0.65, { type: 'sawtooth', gain: 0.18, delay: 0.66, freqEnd: 185 });
  },

  // 10. Catapulte et Tirs : Sound design dynamique de tension (torsion du bois, cordes de chanvre, cliquets)
  startCharge(initialPower = 0) {
    if (!ensure()) return;
    this.stopCharge();

    const t = ctx.currentTime;

    // Bus local de la charge
    const chargeBus = ctx.createGain();
    chargeBus.gain.setValueAtTime(0.001, t);
    chargeBus.gain.linearRampToValueAtTime(0.38, t + 0.08);
    chargeBus.connect(sfxGain || master);

    // 1. Torsion sourde du bois de la catapulte (Sub-rumble + résonance de châssis)
    const woodOsc = ctx.createOscillator();
    woodOsc.type = 'triangle';
    woodOsc.frequency.setValueAtTime(65, t);

    const woodFilter = ctx.createBiquadFilter();
    woodFilter.type = 'lowpass';
    woodFilter.frequency.setValueAtTime(140, t);
    woodFilter.Q.setValueAtTime(2.2, t);

    const woodGain = ctx.createGain();
    woodGain.gain.setValueAtTime(0.28, t);
    woodOsc.connect(woodFilter).connect(woodGain).connect(chargeBus);

    // 2. Tension aiguë des cordes de chanvre (Tension strain / creak qui monte en hauteur)
    const ropeOsc = ctx.createOscillator();
    ropeOsc.type = 'sawtooth';
    ropeOsc.frequency.setValueAtTime(120, t);

    // LFO de tremblement/vibration mécanique sous la contrainte (vibrato de force)
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(7, t);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(14, t);
    lfo.connect(lfoGain).connect(ropeOsc.frequency);

    const ropeFilter = ctx.createBiquadFilter();
    ropeFilter.type = 'bandpass';
    ropeFilter.frequency.setValueAtTime(450, t);
    ropeFilter.Q.setValueAtTime(4.0, t);

    const ropeGain = ctx.createGain();
    ropeGain.gain.setValueAtTime(0.16, t);
    ropeOsc.connect(ropeFilter).connect(ropeGain).connect(chargeBus);

    // 3. Frottement granulaire des fibres de bois & cordes (Bruit filtré qui crisse)
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(750, t);
    noiseFilter.Q.setValueAtTime(3.0, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.04, t);
    noiseSrc.connect(noiseFilter).connect(noiseGain).connect(chargeBus);

    // Démarrer les générateurs
    woodOsc.start(t);
    ropeOsc.start(t);
    lfo.start(t);
    noiseSrc.start(t);

    chargeAudio = {
      bus: chargeBus,
      woodOsc,
      woodFilter,
      woodGain,
      ropeOsc,
      ropeFilter,
      ropeGain,
      lfo,
      lfoGain,
      noiseSrc,
      noiseFilter,
      noiseGain,
      lastRatchetTick: 0,
    };

    this.setChargePower(initialPower);
  },

  setChargePower(power) {
    if (!chargeAudio || !ctx) return;
    const p = Math.max(0, Math.min(1, power));
    const t = ctx.currentTime;

    // Fréquence du bois qui grimpe sous la charge (65Hz -> 160Hz)
    const woodFreq = 65 + p * 95;
    chargeAudio.woodOsc.frequency.setTargetAtTime(woodFreq, t, 0.04);
    chargeAudio.woodFilter.frequency.setTargetAtTime(120 + p * 180, t, 0.04);
    chargeAudio.woodGain.gain.setTargetAtTime(0.24 + p * 0.16, t, 0.04);

    // Fréquence de la corde tendue qui siffle et monte (120Hz -> 390Hz)
    const ropeFreq = 120 + p * 270;
    chargeAudio.ropeOsc.frequency.setTargetAtTime(ropeFreq, t, 0.03);
    chargeAudio.ropeFilter.frequency.setTargetAtTime(420 + p * 1150, t, 0.03);
    chargeAudio.ropeGain.gain.setTargetAtTime(0.12 + p * 0.22, t, 0.03);

    // Tremblement qui s'accélère à haute tension (LFO 7Hz -> 19Hz)
    chargeAudio.lfo.frequency.setTargetAtTime(7 + p * 12, t, 0.04);
    chargeAudio.lfoGain.gain.setTargetAtTime(10 + p * 25, t, 0.04);

    // Bruit de frottement qui s'amplifie avec la contrainte
    chargeAudio.noiseFilter.frequency.setTargetAtTime(650 + p * 1250, t, 0.04);
    chargeAudio.noiseGain.gain.setTargetAtTime(0.03 + p * 0.09, t, 0.04);

    // Crans de crémaillère (ratchet) périodiques dont le tempo s'adapte à la force
    const nowMs = performance.now();
    const interval = Math.max(85, 230 - p * 130);
    if (nowMs - chargeAudio.lastRatchetTick > interval) {
      chargeAudio.lastRatchetTick = nowMs;
      const clickPitch = 420 + p * 380;
      tone(clickPitch, 0.022, { type: 'square', freqEnd: clickPitch * 0.65, gain: 0.035 + p * 0.035 });
    }
  },

  stopCharge() {
    if (!chargeAudio || !ctx) return;
    const ca = chargeAudio;
    chargeAudio = null;
    const t = ctx.currentTime;
    try {
      ca.bus.gain.cancelScheduledValues(t);
      ca.bus.gain.setValueAtTime(ca.bus.gain.value, t);
      ca.bus.gain.linearRampToValueAtTime(0.001, t + 0.05);

      setTimeout(() => {
        try {
          ca.woodOsc.stop();
          ca.ropeOsc.stop();
          ca.lfo.stop();
          ca.noiseSrc.stop();
          ca.bus.disconnect();
        } catch (_) {}
      }, 60);
    } catch (_) {}
  },
  fire() {
    // Détente mécanique du bras en bois
    tone(240, 0.14, { type: 'square', gain: 0.12, freqEnd: 80 });
    // Souffle d'éjection
    noise(0.48, { type: 'bandpass', freq: 420, freqEnd: 2400, q: 1.1, gain: 0.42, attack: 0.03 });
  },
  winch(progress = 0.5) {
    const f = 160 + progress * 240;
    tone(f, 0.045, { type: 'sawtooth', freqEnd: f + 30, gain: 0.05 + progress * 0.05 });
  },
  ratchet(pitch = 750) {
    tone(pitch, 0.025, { type: 'square', freqEnd: pitch * 0.7, gain: 0.06 });
  },

  // 11. Impacts balistiques
  impact(strength = 1) {
    noise(0.65 + strength * 0.25, { freq: 880, freqEnd: 110, gain: 0.68 });
    tone(74, 0.45, { freqEnd: 32, gain: 0.55 });
    // Éclaboussure de sable meuble
    setTimeout(() => noise(0.9, { type: 'bandpass', freq: 2600, q: 0.5, gain: 0.16, attack: 0.12 }), 90);
  },
  grenadeLand() {
    noise(0.28, { type: 'bandpass', freq: 3000, freqEnd: 850, gain: 0.32, attack: 0.02 });
    tone(520, 0.08, { type: 'triangle', freqEnd: 240, gain: 0.16 });
  },
  grenadeTick(fuseLeft = 60) {
    const pitch = 950 + (120 - fuseLeft) * 8;
    tone(pitch, 0.035, { type: 'square', gain: 0.08 });
  },
  grenadeExplosion() {
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

  // 12. Fin de partie et jingles
  win() {
    [523, 659, 784, 1047, 1318].forEach((f, i) =>
      tone(f, 0.38, { type: 'triangle', gain: 0.22, delay: i * 0.10 }),
    );
  },
  go() {
    tone(523, 0.12, { type: 'triangle', gain: 0.22 });
    tone(784, 0.26, { type: 'triangle', gain: 0.22, delay: 0.1 });
  },
  tick() {
    tone(1150, 0.04, { type: 'square', gain: 0.05 });
  },

  // Sorts divins
  deluge() {
    noise(1.8, { type: 'bandpass', freq: 2800, freqEnd: 800, gain: 0.5, attack: 0.1 });
    [440, 554, 659, 880, 1108].forEach((f, i) =>
      tone(f, 0.85, { type: 'sine', gain: 0.18, delay: i * 0.11 }),
    );
  },
  solarStorm() {
    noise(2.2, { type: 'lowpass', freq: 1200, freqEnd: 200, gain: 0.75, attack: 0.05 });
    tone(95, 1.2, { type: 'sawtooth', freqEnd: 32, gain: 0.45 });
  },
};

// ==============================================================================
// MUSIQUE PROCÉDURALE MIGNONNE : CHANTIER (AVEC ACCÉLÉRATION) & COMBAT
// ==============================================================================

class MusicEngine {
  constructor() {
    this.currentMode = null; // 'build' | 'battle' | null
    this.timerId = null;
    this.tempo = 104; // BPM de base en construction
    this.step = 0;
    this.nextNoteTime = 0;
    this.remainingSec = 30;
    this.whistlePlayed = false;

    // Gamme pentatonique majeure mignonne (Do Majeur : C4, D4, E4, G4, A4, C5, D5, E5, G5)
    this.cuteScale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99];

    // Lignes mélodiques mignonnes (indice dans cuteScale, -1 = silence)
    this.buildMelody = [
      0, 2, 4, 3,  5, 3, 2, 0,
      1, 3, 5, 4,  6, 5, 4, 2,
      5, 4, 3, 5,  7, 6, 5, 4,
      3, 2, 1, 3,  5, 4, 2, 0
    ];

    this.buildBass = [
      130.81, 130.81, 196.00, 196.00, // C3, G3
      146.83, 146.83, 220.00, 220.00, // D3, A3
      174.61, 174.61, 130.81, 130.81, // F3, C3
      196.00, 196.00, 246.94, 246.94  // G3, B3
    ];

    // Musique de guerre mignonne (Marche de petits soldats de sable)
    // Gamme Fa Majeur (Fa, Sol, La, Sib, Do, Ré, Mi, Fa)
    this.battleFanfare = [
      349.23, 349.23, 440.00, 523.25,  698.46, 659.25, 587.33, 523.25, // F4, F4, A4, C5, F5, E5, D5, C5
      466.16, 523.25, 440.00, 392.00,  349.23, 392.00, 440.00, 523.25, // Bb4, C5, A4, G4, F4, G4, A4, C5
      587.33, 587.33, 523.25, 466.16,  523.25, 440.00, 392.00, 349.23,
      392.00, 440.00, 523.25, 698.46,  698.46, -1,     698.46, -1
    ];

    this.battleBass = [
      87.31, 130.81, 87.31, 130.81, // F2, C3, F2, C3
      116.54, 174.61, 87.31, 130.81, // Bb2, F3, F2, C3
      116.54, 130.81, 87.31, 130.81,
      130.81, 174.61, 87.31, 174.61
    ];
  }

  startBuild() {
    this.stopAll();
    this.currentMode = 'build';
    this.tempo = 104;
    this.step = 0;
    this.remainingSec = 30;
    this.whistlePlayed = false;
    this.nextNoteTime = ensure() ? ctx.currentTime + 0.05 : 0;
    this.scheduleLoop();
  }

  updateBuildTimer(sec) {
    this.remainingSec = Math.max(0, sec);
    if (this.currentMode !== 'build') return;

    // ACCÉLÉRATION DANS LES 10 DERNIÈRES SECONDES
    if (sec <= 10) {
      const urgency = (10 - sec) / 10; // 0 à 1
      this.tempo = 104 + urgency * 82; // Accélère de 104 jusqu'à 186 BPM !
    } else {
      this.tempo = 104;
    }

    // Déclenchement du sifflet au moment exact où le chronomètre arrive à zéro
    if (sec === 0 && !this.whistlePlayed) {
      this.whistlePlayed = true;
      this.stopBuild(true);
    }
  }

  stopBuild(playWhistle = false) {
    if (this.currentMode === 'build') {
      this.currentMode = null;
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      if (playWhistle) {
        sfx.whistle();
      }
    }
  }

  startBattle() {
    this.stopAll();
    this.currentMode = 'battle';
    this.tempo = 116; // Tempo militaire joyeux
    this.step = 0;
    this.nextNoteTime = ensure() ? ctx.currentTime + 0.05 : 0;
    this.scheduleLoop();
  }

  stopBattle() {
    if (this.currentMode === 'battle') {
      this.currentMode = null;
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
    }
  }

  stopAll() {
    this.currentMode = null;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  scheduleLoop() {
    if (!this.currentMode || !ctx) return;

    // Horloge à anticipation Web Audio (Lookahead scheduler)
    const scheduleAheadTime = 0.12;
    while (this.nextNoteTime < ctx.currentTime + scheduleAheadTime) {
      if (this.currentMode === 'build') {
        this.playBuildStep(this.nextNoteTime, this.step);
      } else if (this.currentMode === 'battle') {
        this.playBattleStep(this.nextNoteTime, this.step);
      }

      // Intervalle entre deux croches (8th notes)
      const secondsPerBeat = 60.0 / this.tempo;
      const stepDuration = secondsPerBeat * 0.5;
      this.nextNoteTime += stepDuration;
      this.step = (this.step + 1) % 32;
    }

    this.timerId = setTimeout(() => this.scheduleLoop(), 40);
  }

  // Étape de la musique de construction mignonne (Marimba + Tic-tac + Basse)
  playBuildStep(time, step) {
    const isQuarter = step % 2 === 0;
    const isDownbeat = step % 4 === 0;

    // 1. TIC-TAC RYTHMIQUE DU CHRONO :
    // Shaker / bloc de bois qui fait le tic-tac permanent du timer
    const isUrgent = this.remainingSec <= 10;
    const tickPitch = isUrgent ? (1350 + (10 - this.remainingSec) * 45) : (isDownbeat ? 1200 : 920);
    const tickGain = isUrgent ? 0.055 : 0.035;

    // Tic-tac doux à chaque croche
    tone(tickPitch, 0.025, { type: 'sine', gain: tickGain, dest: musicGain, delay: time - ctx.currentTime });

    // En phase d'urgence (< 5s), double tic-tac précipité
    if (isUrgent && this.remainingSec <= 5 && !isQuarter) {
      tone(tickPitch * 1.25, 0.018, { type: 'square', gain: 0.04, dest: musicGain, delay: time - ctx.currentTime + 0.04 });
    }

    // 2. BASSE RONDE ET REBONDISSANTE
    if (isQuarter) {
      const bassIdx = Math.floor(step / 2) % this.buildBass.length;
      const bassFreq = this.buildBass[bassIdx];
      tone(bassFreq, 0.22, { type: 'triangle', gain: 0.12, dest: musicGain, delay: time - ctx.currentTime });
    }

    // 3. MÉLODIE KALIMBA / MARIMBA MIGNONNE
    const noteIdx = this.buildMelody[step];
    if (noteIdx >= 0) {
      const noteFreq = this.cuteScale[noteIdx];
      // Note principale perlée
      tone(noteFreq, 0.16, { type: 'sine', gain: 0.14, dest: musicGain, delay: time - ctx.currentTime });
      // Harmonique de marimba en bois
      tone(noteFreq * 2, 0.07, { type: 'triangle', gain: 0.04, dest: musicGain, delay: time - ctx.currentTime });
    }
  }

  // Étape de la musique de guerre mignonne de combat (Marche de petits soldats)
  playBattleStep(time, step) {
    const isQuarter = step % 2 === 0;
    const isDownbeat = step % 4 === 0;

    // 1. CAISSE CLAIRE MILITAIRE ENFANTINE (Petit roulement de tambour)
    const snareMarchSteps = [0, 2, 3, 4, 6, 7];
    if (snareMarchSteps.includes(step % 8)) {
      const isAccent = (step % 8 === 0) || (step % 8 === 4);
      noise(0.065, {
        type: 'bandpass',
        freq: 3200,
        q: 2.2,
        gain: isAccent ? 0.16 : 0.09,
        dest: musicGain,
        delay: time - ctx.currentTime
      });
    }

    // 2. TUBA / GROSSE BASSE MARTIALE JOYEUSE (Poum - Tchak)
    if (isQuarter) {
      const bIdx = Math.floor(step / 2) % this.battleBass.length;
      const bFreq = this.battleBass[bIdx];
      tone(bFreq, 0.24, { type: 'triangle', gain: 0.15, dest: musicGain, delay: time - ctx.currentTime });
      tone(bFreq * 0.5, 0.18, { type: 'sine', gain: 0.12, dest: musicGain, delay: time - ctx.currentTime });
    }

    // 3. FANFARE HÉROÏQUE MIGNONNE (Flûte / Cuivres de jouet)
    const melFreq = this.battleFanfare[step];
    if (melFreq > 0) {
      // Flûte / clairon éclatant
      tone(melFreq, 0.18, { type: 'triangle', gain: 0.16, dest: musicGain, delay: time - ctx.currentTime });
      tone(melFreq * 1.5, 0.08, { type: 'sine', gain: 0.05, dest: musicGain, delay: time - ctx.currentTime });
    }
  }
}

export const music = new MusicEngine();
