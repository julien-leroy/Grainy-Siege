// ==============================================================================
// TUTORIEL ANIMÉ "GIF" — 3 RÈGLES D'OR DU JEU
// 1) Protéger le Roi (Abri & voûte sans ensevelir)
// 2) Séchage du sable au soleil & Spray d'eau durcisseur
// 3) Impact balistique du boulet & résistance des remparts
// ==============================================================================

const STEPS = [
  {
    id: 'protect',
    badge: '👑 RÈGLE 1',
    tab: '👑 Protéger le Roi',
    title: '👑 1. Construis un abri solide sans écraser le Roi',
    desc: 'Pose des piliers solides de chaque côté, puis une arche ou un toit par-dessus. Le Roi peut bouger librement dessous : tant qu\'aucun sable effondré ne lui tombe sur la tête, il reste en vie !',
    duration: 5200,
  },
  {
    id: 'drying',
    badge: '☀️ RÈGLE 2',
    tab: '☀️ Séchage & Spray',
    title: '☀️ 2. Le sable sèche au soleil : utilise le Spray d\'eau !',
    desc: 'Au contact de l\'air, le sable mouillé s\'assèche de l\'extérieur vers l\'intérieur et devient friable. En défense, arrose avec ton Spray 💦 pour le détremper et le durcir (sable HARD résistant aux chocs) !',
    duration: 5400,
  },
  {
    id: 'cannon',
    badge: '☄️ RÈGLE 3',
    tab: '☄️ Boulets & Châteaux',
    title: '☄️ 3. Les boulets pulvérisent le sable par onde de choc',
    desc: 'Un tir de catapulte creuse un cratère et projette le sable sec à l\'impact. Un mur épais ou durci au spray amortit l\'onde de choc et empêche le boulet d\'atteindre ton Roi !',
    duration: 5200,
  },
];

export class TutorialGIF {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.stepIndex = 0;
    this.stepStartTime = performance.now();
    this.particles = [];
    this.shake = 0;
    this.active = true;
    this.running = true;

    this.initUI();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setActive(active) {
    this.active = active;
    if (active && !this.running) {
      this.running = true;
      this.stepStartTime = performance.now();
      requestAnimationFrame(this.loop);
    }
  }

  initUI() {
    this.tabs = document.querySelectorAll('.tuto-tab-btn');
    this.progressBar = document.getElementById('tuto-progress-fill');
    this.titleEl = document.getElementById('tuto-caption-title');
    this.descEl = document.getElementById('tuto-caption-text');
    this.badgeEl = document.getElementById('tuto-badge-step');
    this.prevBtn = document.getElementById('tuto-prev-btn');
    this.nextBtn = document.getElementById('tuto-next-btn');

    this.tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => {
        this.setStep(idx);
      });
    });

    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => {
        this.setStep((this.stepIndex - 1 + STEPS.length) % STEPS.length);
      });
    }

    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => {
        this.setStep((this.stepIndex + 1) % STEPS.length);
      });
    }

    this.updateCaption();
  }

  setStep(idx) {
    this.stepIndex = idx;
    this.stepStartTime = performance.now();
    this.particles = [];
    this.shake = 0;
    this.tabs.forEach((t, i) => t.classList.toggle('active', i === idx));
    this.updateCaption();
  }

  updateCaption() {
    const s = STEPS[this.stepIndex];
    if (this.titleEl) this.titleEl.textContent = s.title;
    if (this.descEl) this.descEl.textContent = s.desc;
    if (this.badgeEl) this.badgeEl.textContent = s.badge;
  }

  loop(now) {
    if (!this.active) {
      this.running = false;
      return;
    }
    const s = STEPS[this.stepIndex];
    const elapsed = now - this.stepStartTime;
    const progress = Math.min(1, elapsed / s.duration);

    if (this.progressBar) {
      this.progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
    }

    if (elapsed >= s.duration) {
      this.setStep((this.stepIndex + 1) % STEPS.length);
    }

    this.render(elapsed, now);
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- Rendu Canvas
  render(elapsed, now) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();

    // Effet de secousse
    if (this.shake > 0) {
      const sx = (Math.random() - 0.5) * this.shake;
      const sy = (Math.random() - 0.5) * this.shake;
      ctx.translate(sx, sy);
      this.shake *= 0.88;
      if (this.shake < 0.2) this.shake = 0;
    }

    // 1) Ciel & Soleil d'ambiance
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.75);
    sky.addColorStop(0, '#38bdf8');
    sky.addColorStop(0.65, '#bae6fd');
    sky.addColorStop(1, '#fef08a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Mer à l'horizon
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, h * 0.70, w, 6);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, h * 0.70 + 3, w, 2);

    // 2) Plage de sable compacte
    const groundY = h * 0.74;
    const sandGrad = ctx.createLinearGradient(0, groundY, 0, h);
    sandGrad.addColorStop(0, '#fde047');
    sandGrad.addColorStop(0.3, '#f59e0b');
    sandGrad.addColorStop(1, '#d97706');
    ctx.fillStyle = sandGrad;
    ctx.fillRect(0, groundY, w, h - groundY);

    // Ligne de crête de la plage
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    // 3) Scénario selon l'étape active
    if (this.stepIndex === 0) {
      this.drawStepProtect(elapsed, w, groundY);
    } else if (this.stepIndex === 1) {
      this.drawStepDrying(elapsed, w, groundY, now);
    } else {
      this.drawStepCannon(elapsed, w, groundY, now);
    }

    // Particules volantes
    this.updateAndDrawParticles(ctx);

    ctx.restore();
  }

  // ---------------------------------------------------------------- Étape 1 : Protéger le Roi
  drawStepProtect(elapsed, w, groundY) {
    const { ctx } = this;
    const kx = w * 0.5;
    const ky = groundY - 18;

    // Phase 1 (0..1.2s) : Le Roi est seul sur la plage
    // Phase 2 (1.2..2.5s) : Deux piliers latéraux s'érigent
    // Phase 3 (2.5..4.0s) : Une arche protectrice relie les piliers en toit
    // Phase 4 (4.0..5.2s) : Victoire & coche verte

    const tPillars = Math.max(0, Math.min(1, (elapsed - 1200) / 700));
    const tRoof = Math.max(0, Math.min(1, (elapsed - 2500) / 700));
    const isSuccess = elapsed > 3800;

    // Piliers latéraux
    if (tPillars > 0) {
      const pilH = 34 * tPillars;
      // Pilier Gauche
      this.drawSandBlock(kx - 42, groundY - pilH, 18, pilH, 'wet');
      // Pilier Droit
      this.drawSandBlock(kx + 24, groundY - pilH, 18, pilH, 'wet');

      if (tPillars < 1 && Math.random() < 0.3) {
        this.addPuff(kx - 33, groundY - pilH, '#fde047');
        this.addPuff(kx + 33, groundY - pilH, '#fde047');
      }
    }

    // Arche / Toit
    if (tRoof > 0) {
      const roofY = groundY - 34 - 14 * tRoof;
      const roofAlpha = tRoof;
      ctx.save();
      ctx.globalAlpha = roofAlpha;
      this.drawArchRoof(kx, groundY - 34, 84, 18);
      ctx.restore();

      if (tRoof >= 0.95 && elapsed < 3300 && Math.random() < 0.2) {
        this.addPuff(kx, groundY - 48, '#fde047');
      }
    }

    // Le Roi sous son abri
    const kingBob = isSuccess ? Math.sin(elapsed * 0.012) * 3 : 0;
    this.drawKingSprite(kx - 6, ky - kingBob, '#e4572e');

    // Infobulles animées
    if (elapsed < 1200) {
      this.drawSpeechBubble(kx, ky - 18, '👑 Place mon abri !', '#1e293b');
    } else if (elapsed >= 1200 && elapsed < 2500) {
      this.drawArrowDown(kx - 33, groundY - 45, 'Pilier');
      this.drawArrowDown(kx + 33, groundY - 45, 'Pilier');
    } else if (elapsed >= 2500 && elapsed < 3800) {
      this.drawSpeechBubble(kx, groundY - 60, 'Voûte sans m\'écraser !', '#0369a1');
    } else {
      // Succès
      ctx.fillStyle = '#16a34a';
      ctx.font = '800 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✔ ROI EN SÉCURITÉ ! 👑', kx, groundY - 62);

      // Particules dorées qui scintillent
      if (Math.random() < 0.35) {
        this.particles.push({
          x: kx + (Math.random() - 0.5) * 60,
          y: groundY - 20 - Math.random() * 40,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -Math.random() * 1.2,
          color: '#facc15',
          life: 1,
          size: 2.5,
        });
      }
    }
  }

  // ---------------------------------------------------------------- Étape 2 : Séchage & Spray
  drawStepDrying(elapsed, w, groundY, now) {
    const { ctx } = this;
    const cx = w * 0.5;
    const cy = groundY - 50;

    // 0..2.2s : Le soleil sèche la muraille de l'extérieur vers l'intérieur
    // 2.2..3.8s : Le Spray arrose et durcit en HARD
    // 3.8..5.4s : La forteresse est impénétrable

    const dryRatio = Math.min(1, elapsed / 2200);
    const sprayRatio = Math.max(0, Math.min(1, (elapsed - 2200) / 1000));
    const isHard = elapsed >= 3200;

    // Soleil brillant en haut à droite
    const sunX = w * 0.82;
    const sunY = 32;
    const sunPulse = 16 + Math.sin(now * 0.006) * 3;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, sunPulse * 1.8);
    sunGrad.addColorStop(0, '#fef08a');
    sunGrad.addColorStop(0.5, '#f59e0b');
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunPulse * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Rayons de soleil chauds vers le château
    if (elapsed < 2400) {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(sunX - 10, sunY + 12);
      ctx.lineTo(cx + 25, cy - 10);
      ctx.moveTo(sunX - 25, sunY + 8);
      ctx.lineTo(cx - 15, cy - 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Dessin du Donjon
    const towerW = 68;
    const towerH = 50;
    const tx = cx - towerW / 2;
    const ty = groundY - towerH;

    // Cœur mouillé
    ctx.fillStyle = isHard ? '#78350f' : '#b45309';
    ctx.fillRect(tx, ty, towerW, towerH);

    // Créneaux
    for (let c = 0; c < 4; c++) {
      ctx.fillRect(tx + c * 18, ty - 8, 12, 8);
    }

    // Couche de séchage externe (sable clair qui s'épaissit vers l'intérieur)
    if (!isHard && dryRatio > 0.1) {
      const borderThick = Math.round(dryRatio * 14);
      ctx.fillStyle = 'rgba(254, 240, 138, 0.92)'; // jaune sable sec
      // Bords gauche et droit secs
      ctx.fillRect(tx, ty, borderThick, towerH);
      ctx.fillRect(tx + towerW - borderThick, ty, borderThick, towerH);
      // Toit sec
      ctx.fillRect(tx, ty, towerW, borderThick);
      for (let c = 0; c < 4; c++) {
        ctx.fillRect(tx + c * 18, ty - 8, 12, 8);
      }
    }

    // Action du Spray
    if (sprayRatio > 0 && elapsed < 3600) {
      const sprayX = cx - 45 + sprayRatio * 20;
      const sprayY = ty - 25;

      // Dessin de la fiole de spray
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(sprayX, sprayY, 14, 20);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(sprayX + 3, sprayY - 6, 8, 6);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(sprayX + 8, sprayY - 10, 10, 4);

      // Jet de gouttes d'eau
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      for (let g = 0; g < 8; g++) {
        const gx = sprayX + 16 + Math.random() * 45;
        const gy = sprayY - 8 + Math.random() * 38;
        ctx.beginPath();
        ctx.arc(gx, gy, 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.shake = 1;
    }

    // Texte pédagogique
    if (elapsed < 2200) {
      ctx.fillStyle = '#d97706';
      ctx.font = '700 11.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☀️ Séchage extérieur ➔ Devient friable !', cx, ty - 16);
    } else if (elapsed >= 2200 && elapsed < 3500) {
      ctx.fillStyle = '#0284c7';
      ctx.font = '800 12.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💦 JET DE SPRAY DURCISSEUR !', cx, ty - 28);
    } else {
      ctx.fillStyle = '#1e3a8a';
      ctx.font = '800 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🛡️ SABLE "HARD" : RÉSISTE AUX CHOCS !', cx, ty - 16);

      // Éclats bleus brillants
      if (Math.random() < 0.35) {
        this.particles.push({
          x: tx + Math.random() * towerW,
          y: ty + Math.random() * towerH,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -Math.random() * 0.8,
          color: '#38bdf8',
          life: 0.9,
          size: 2.2,
        });
      }
    }
  }

  // ---------------------------------------------------------------- Étape 3 : Choc des Boulets
  drawStepCannon(elapsed, w, groundY, now) {
    const { ctx } = this;
    const targetX = w * 0.65;
    const targetY = groundY - 40;
    const catX = 35;
    const catY = groundY - 18;

    // 0..1.4s : Visée & catapultage
    // 1.4..2.4s : Boulet en vol parabolique
    // 2.4..5.2s : Impact, cratère, secousse & particules

    // Catapulte à gauche
    this.drawCatapultSprite(catX, catY, elapsed > 1300);

    // Forteresse cible avec Roi derrière
    const wallW = 32;
    const wallH = 55;
    const wallX = targetX;
    const wallY = groundY - wallH;

    // Roi abrité derrière la muraille
    const kingX = wallX + wallW + 12;
    const kingY = groundY - 18;
    this.drawKingSprite(kingX, kingY, '#e4572e');

    // Muraille de protection
    const hasImpacted = elapsed >= 2400;
    ctx.fillStyle = '#92400e';
    ctx.fillRect(wallX, wallY, wallW, wallH);

    // Cratère d'impact après le choc
    if (hasImpacted) {
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(wallX + 4, targetY, 9, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
    }

    // Trajectoire et boulet de canon
    if (elapsed >= 1400 && elapsed < 2400) {
      const t = (elapsed - 1400) / 1000;
      const bx = catX + 18 + t * (wallX - catX - 18);
      const arcH = Math.sin(t * Math.PI) * 75;
      const by = catY - 20 - arcH + t * (targetY - (catY - 20));

      // Traînée
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.stroke();

      // Boulet de fer
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.arc(bx - 1.5, by - 1.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Déclenchement de l'impact à 2.4s
    if (elapsed >= 2400 && elapsed < 2460) {
      this.shake = 9;
      // Projections de sable
      for (let k = 0; k < 22; k++) {
        const angle = Math.PI + (Math.random() - 0.5) * 1.6;
        const sp = 2 + Math.random() * 4.5;
        this.particles.push({
          x: wallX + 4,
          y: targetY,
          vx: Math.cos(angle) * sp,
          vy: Math.sin(angle) * sp,
          color: Math.random() < 0.5 ? '#f59e0b' : '#78350f',
          life: 1.2,
          size: 2.2 + Math.random() * 2,
        });
      }
    }

    // Messages pédagogiques
    if (elapsed < 1400) {
      ctx.fillStyle = '#b45309';
      ctx.font = '700 11.5px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('☄️ Ajustement de l\'angle & puissance...', catX + 5, catY - 35);
    } else if (elapsed >= 1400 && elapsed < 2400) {
      ctx.fillStyle = '#ea580c';
      ctx.font = '800 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☄️ TIR EN VOL !', w * 0.42, 28);
    } else {
      ctx.fillStyle = '#15803d';
      ctx.font = '800 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💥 LE REMPART ABSORBE L\'ONDE DE CHOC !', w * 0.5, 24);

      ctx.fillStyle = '#047857';
      ctx.font = '700 11px sans-serif';
      ctx.fillText('Le Roi derrière est 100% protégé ✔', kingX + 5, kingY - 14);
    }
  }

  // ---------------------------------------------------------------- Sprites graphiques
  drawSandBlock(x, y, w, h, kind = 'wet') {
    const { ctx } = this;
    ctx.fillStyle = kind === 'hard' ? '#78350f' : '#b45309';
    ctx.fillRect(x, y, w, h);

    // Texture brique
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(x, y + h - 2, w, 2);
  }

  drawArchRoof(cx, cy, w, h) {
    const { ctx } = this;
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h, w, h, [8, 8, 0, 0]);
    ctx.fill();

    // Voûte creusée dessous
    ctx.fillStyle = '#bae6fd';
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.28, Math.PI, 0, false);
    ctx.fill();

    // Bordure brique
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.28, Math.PI, 0, false);
    ctx.stroke();
  }

  drawKingSprite(x, y, color = '#e4572e') {
    const { ctx } = this;
    const s = 2.2;
    // Sprite pixel art du roi
    const P = {
      Y: '#ffd13b', // couronne
      S: '#f4cbb0', // visage
      E: '#2b1d10', // yeux
      C: color,     // cape
      W: '#f7f3ea', // col blanc
      D: '#4a3524', // bottes
    };
    const sprite = [
      'Y.Y.Y',
      'YyYyY',
      'SSSSS',
      'SESES',
      'CWWWC',
      'CCcCC',
      'cCCCc',
      '.D.D.',
    ];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 5; c++) {
        const ch = sprite[r][c];
        if (ch === '.') continue;
        ctx.fillStyle = P[ch] || '#ffd13b';
        ctx.fillRect(x + c * s, y + r * s, s, s);
      }
    }
  }

  drawCatapultSprite(x, y, fired = false) {
    const { ctx } = this;
    // Roues
    ctx.fillStyle = '#451a03';
    ctx.beginPath();
    ctx.arc(x + 4, y + 6, 5, 0, Math.PI * 2);
    ctx.arc(x + 22, y + 6, 5, 0, Math.PI * 2);
    ctx.fill();

    // Châssis en bois
    ctx.fillStyle = '#78350f';
    ctx.fillRect(x, y, 26, 6);

    // Montant vertical
    ctx.fillRect(x + 12, y - 16, 4, 16);

    // Bras de catapulte
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x + 14, y - 6);
    if (fired) {
      ctx.lineTo(x + 24, y - 26);
    } else {
      ctx.lineTo(x - 2, y - 18);
    }
    ctx.stroke();
  }

  drawSpeechBubble(x, y, text, color = '#1e293b') {
    const { ctx } = this;
    ctx.font = '700 11px sans-serif';
    const textW = ctx.measureText(text).width;
    const pad = 6;
    const bw = textW + pad * 2;
    const bh = 18;
    const bx = x - bw / 2;
    const by = y - bh - 6;

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();
    ctx.stroke();

    // Petite pointe vers le bas
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x - 4, by + bh);
    ctx.lineTo(x + 4, by + bh);
    ctx.lineTo(x, by + bh + 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, by + 13);
  }

  drawArrowDown(x, y, label) {
    const { ctx } = this;
    ctx.strokeStyle = '#0284c7';
    ctx.fillStyle = '#0284c7';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y);
    ctx.lineTo(x - 3, y - 4);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 3, y - 4);
    ctx.stroke();

    if (label) {
      ctx.font = '800 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y - 13);
    }
  }

  addPuff(x, y, color = '#fde047') {
    for (let k = 0; k < 4; k++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -Math.random() * 1.5,
        color,
        life: 0.8,
        size: 2 + Math.random() * 2.5,
      });
    }
  }

  updateAndDrawParticles(ctx) {
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.life -= 0.025;
      if (p.life <= 0) continue;
      this.particles[w++] = p;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    this.particles.length = w;
  }
}

// Initialisation dès que le DOM est prêt
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    window.tutoInstance = new TutorialGIF('tuto-canvas');
  });
}
