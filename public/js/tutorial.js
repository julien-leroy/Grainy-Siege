// ==============================================================================
// TUTORIEL ANIMÉ "GIF" — 5 ÉTAPES ESSENTIELLES DU JEU
// 1) Construction & Abri (Ponts solides en sable mouillé)
// 2) Séchage au soleil & Risque d'éboulement sous le poids
// 3) Spray d'eau défensif qui durcit et stoppe l'éboulement
// 4) Catapulte : Cadran d'angle et jauge de puissance
// 5) Bonus parachutés en mer (+1 Boulet / +1 Spray)
// ==============================================================================

const STEPS = [
  {
    id: 'construct',
    badge: '🏰 RÈGLE 1',
    tab: '🏰 1. Bâtir l\'Abri',
    title: '🏰 1. Construis un abri solide sans écraser le Roi',
    desc: 'Bâtis deux tours et pose un pont ou une arche par-dessus ! Tant que le sable mouillé est relié à du sable mouillé, les ponts restent durs et solides sans casser pendant toute la construction.',
    duration: 5400,
  },
  {
    id: 'drying',
    badge: '☀️ RÈGLE 2',
    tab: '☀️ 2. Séchage',
    title: '☀️ 2. En bataille, le sable sèche au soleil et peut s\'effondrer',
    desc: 'Dès que le combat débute, le soleil assèche progressivement le sable de l\'extérieur vers l\'intérieur. Devenu sec et friable, un pont ou une structure trop lourde risque de céder sous son poids en éboulis !',
    duration: 5400,
  },
  {
    id: 'spray',
    badge: '💦 RÈGLE 3',
    tab: '💦 3. Spray',
    title: '💦 3. Le Spray d\'eau stoppe net l\'éboulement en durcissant le sable',
    desc: 'En défense, vise une zone fragilisée ou fissurée avec ton Spray [E ou Clic droit] ! L\'eau imprègne le sable sec et le transforme instantanément en roche (sable HARD), stoppant net l\'effondrement !',
    duration: 5400,
  },
  {
    id: 'catapult',
    badge: '☄️ RÈGLE 4',
    tab: '☄️ 4. Catapulte',
    title: '☄️ 4. Règle l\'angle au cadran et dose la puissance à la jauge',
    desc: 'Fais pivoter le cadran pour régler l\'angle de tir. Maintiens le bouton TIRER ou la barre d\'espace pour bander la catapulte avec la jauge oscillante, puis relâche au moment idéal pour faire feu !',
    duration: 5400,
  },
  {
    id: 'bonus',
    badge: '🎁 RÈGLE 5',
    tab: '🎁 5. Bonus',
    title: '🎁 5. Pulvérise les caisses parachutées dans la mer pour des bonus',
    desc: 'Des colis de ravitaillement flottent régulièrement dans l\'eau de mer ! Ajuste ton tir pour détruire une caisse au boulet et gagner des munitions (+1 Boulet ☄️) ou du spray défensif (+1 Spray 💦) !',
    duration: 5600,
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

    // 1) Ciel & Mer d'ambiance
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.75);
    sky.addColorStop(0, '#38bdf8');
    sky.addColorStop(0.65, '#bae6fd');
    sky.addColorStop(1, '#fef08a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Mer à l'horizon
    const seaY = h * 0.70;
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, seaY, w, 6);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(0, seaY + 3, w, 2);

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
    } else if (this.stepIndex === 2) {
      this.drawStepSpray(elapsed, w, groundY, now);
    } else if (this.stepIndex === 3) {
      this.drawStepCatapult(elapsed, w, groundY, now);
    } else {
      this.drawStepBonus(elapsed, w, groundY, now);
    }

    // Particules volantes
    this.updateAndDrawParticles(ctx);

    ctx.restore();
  }

  // ---------------------------------------------------------------- Étape 1 : Construction & Abri (Pont solide)
  drawStepProtect(elapsed, w, groundY) {
    const { ctx } = this;
    const kx = w * 0.5;
    const ky = groundY - 18;

    const tPillars = Math.max(0, Math.min(1, (elapsed - 800) / 800));
    const tBridge = Math.max(0, Math.min(1, (elapsed - 2200) / 800));
    const isSolid = elapsed > 3400;

    // Deux tours
    if (tPillars > 0) {
      const pilH = 42 * tPillars;
      this.drawSandBlock(kx - 48, groundY - pilH, 20, pilH, 'wet');
      this.drawSandBlock(kx + 28, groundY - pilH, 20, pilH, 'wet');

      if (tPillars < 1 && Math.random() < 0.3) {
        this.addPuff(kx - 38, groundY - pilH, '#fde047');
        this.addPuff(kx + 38, groundY - pilH, '#fde047');
      }
    }

    // Pont reliant les deux tours
    if (tBridge > 0) {
      const bridgeW = 96;
      const bridgeH = 14;
      const bx = kx - 48;
      const by = groundY - 42 - 8 * (1 - tBridge);
      ctx.save();
      ctx.globalAlpha = tBridge;
      this.drawSandBlock(bx, by, bridgeW, bridgeH, 'wet');
      ctx.restore();

      if (tBridge >= 0.95 && elapsed < 3200 && Math.random() < 0.25) {
        this.addPuff(kx, by, '#fde047');
      }
    }

    // Le Roi sous le pont
    const kingBob = isSolid ? Math.sin(elapsed * 0.012) * 3 : 0;
    this.drawKingSprite(kx - 6, ky - kingBob, '#e4572e');

    // Infobulles animées
    if (elapsed < 1200) {
      this.drawSpeechBubble(kx, ky - 18, '👑 Protège-moi sous un pont !', '#1e293b');
    } else if (elapsed >= 1200 && elapsed < 2400) {
      this.drawArrowDown(kx - 38, groundY - 50, 'Tour 1');
      this.drawArrowDown(kx + 38, groundY - 50, 'Tour 2');
    } else if (elapsed >= 2400 && elapsed < 3600) {
      this.drawSpeechBubble(kx, groundY - 62, '🌉 Le pont tient sans casser !', '#0369a1');
    } else {
      ctx.fillStyle = '#16a34a';
      ctx.font = '800 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✔ PONT ROBUSTE EN SABLE MOUILLÉ ! 🏰', kx, groundY - 64);

      if (Math.random() < 0.35) {
        this.particles.push({
          x: kx + (Math.random() - 0.5) * 80,
          y: groundY - 20 - Math.random() * 45,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -Math.random() * 1.2,
          color: '#facc15',
          life: 1,
          size: 2.5,
        });
      }
    }
  }

  // ---------------------------------------------------------------- Étape 2 : Séchage & Éboulement
  drawStepDrying(elapsed, w, groundY, now) {
    const { ctx } = this;
    const kx = w * 0.5;
    const ky = groundY - 18;

    const dryRatio = Math.min(1, elapsed / 2200);
    const collapseTime = elapsed >= 2400;

    // Soleil brûlant
    const sunX = w * 0.82;
    const sunY = 32;
    const sunPulse = 18 + Math.sin(now * 0.007) * 3;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, sunPulse * 1.8);
    sunGrad.addColorStop(0, '#fef08a');
    sunGrad.addColorStop(0.5, '#f59e0b');
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunPulse * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Rayons chauds
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(sunX - 10, sunY + 12);
    ctx.lineTo(kx + 20, groundY - 45);
    ctx.stroke();
    ctx.setLineDash([]);

    // Deux piliers
    this.drawSandBlock(kx - 48, groundY - 42, 20, 42, 'wet');
    this.drawSandBlock(kx + 28, groundY - 42, 20, 42, 'wet');

    // Pont qui sèche
    const bridgeW = 96;
    const bridgeH = 14;
    const bx = kx - 48;
    const by = groundY - 42;

    if (!collapseTime) {
      // Cœur mouillé
      this.drawSandBlock(bx, by, bridgeW, bridgeH, 'wet');
      // Couche de sable sec en surface
      const borderThick = Math.round(dryRatio * 6);
      ctx.fillStyle = 'rgba(254, 240, 138, 0.9)';
      ctx.fillRect(bx, by, bridgeW, borderThick);
      // Fissure qui apparaît au milieu du pont
      if (dryRatio > 0.6) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(kx - 3, by);
        ctx.lineTo(kx + 2, by + bridgeH);
        ctx.stroke();
      }
    } else {
      // Éboulement au milieu du pont !
      this.drawSandBlock(bx, by, 28, bridgeH, 'wet');
      this.drawSandBlock(bx + bridgeW - 28, by, 28, bridgeH, 'wet');

      // Grains et mottes qui tombent au sol
      if (Math.random() < 0.6) {
        this.particles.push({
          x: kx + (Math.random() - 0.5) * 24,
          y: by + Math.random() * bridgeH,
          vx: (Math.random() - 0.5) * 1.8,
          vy: 1.5 + Math.random() * 2.5,
          color: Math.random() < 0.6 ? '#fde047' : '#d97706',
          life: 0.8,
          size: 2.2 + Math.random() * 2,
        });
      }
      this.shake = 1.2;
    }

    // Le Roi inquiet sous la fissure
    this.drawKingSprite(kx - 6, ky, '#e4572e');

    if (elapsed < 2400) {
      ctx.fillStyle = '#d97706';
      ctx.font = '700 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☀️ Le soleil assèche le sable ➔ Craquelures !', kx, by - 16);
    } else {
      ctx.fillStyle = '#dc2626';
      ctx.font = '800 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚠️ ÉBOULIS ! LE SABLE SEC CÈDE SOUS LE POIDS !', kx, by - 16);
    }
  }

  // ---------------------------------------------------------------- Étape 3 : Spray d'eau qui stoppe l'éboulement
  drawStepSpray(elapsed, w, groundY, now) {
    const { ctx } = this;
    const kx = w * 0.5;
    const ky = groundY - 18;

    const by = groundY - 42;
    const bridgeW = 96;
    const bridgeH = 14;
    const bx = kx - 48;

    const sprayActive = elapsed >= 1200 && elapsed < 3200;
    const isHardened = elapsed >= 3000;

    // Deux piliers
    this.drawSandBlock(kx - 48, groundY - 42, 20, 42, isHardened ? 'hard' : 'wet');
    this.drawSandBlock(kx + 28, groundY - 42, 20, 42, isHardened ? 'hard' : 'wet');

    // Pont stabilisé ou en cours de consolidation
    this.drawSandBlock(bx, by, bridgeW, bridgeH, isHardened ? 'hard' : 'wet');

    if (sprayActive) {
      const sprayX = kx - 55;
      const sprayY = by - 30;

      // Fiole de spray
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(sprayX, sprayY, 14, 20);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(sprayX + 3, sprayY - 6, 8, 6);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(sprayX + 8, sprayY - 10, 10, 4);

      // Jet d'eau bleu pulvérisé sur le pont
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.8;
      for (let g = 0; g < 10; g++) {
        const gx = sprayX + 16 + Math.random() * 55;
        const gy = sprayY - 6 + Math.random() * 34;
        ctx.beginPath();
        ctx.arc(gx, gy, 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.shake = 0.8;
    }

    // Le Roi rassuré
    this.drawKingSprite(kx - 6, ky, '#e4572e');

    if (elapsed < 1200) {
      ctx.fillStyle = '#ea580c';
      ctx.font = '700 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚠️ Fissure active ➔ Utilise ton Spray [E] !', kx, by - 16);
    } else if (elapsed >= 1200 && elapsed < 3000) {
      ctx.fillStyle = '#0284c7';
      ctx.font = '800 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('💦 LE SPRAY RÉHYDRATE LE SABLE !', kx, by - 24);
    } else {
      ctx.fillStyle = '#15803d';
      ctx.font = '800 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🛡️ SABLE "HARD" : ÉBOULEMENT STOPPÉ NET !', kx, by - 16);

      if (Math.random() < 0.35) {
        this.particles.push({
          x: bx + Math.random() * bridgeW,
          y: by + Math.random() * bridgeH,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -Math.random() * 0.9,
          color: '#38bdf8',
          life: 0.9,
          size: 2.4,
        });
      }
    }
  }

  // ---------------------------------------------------------------- Étape 4 : Catapulte (Cadran & Puissance)
  drawStepCatapult(elapsed, w, groundY, now) {
    const { ctx } = this;
    const catX = 40;
    const catY = groundY - 18;

    const aimTime = elapsed < 2600;
    const fireTime = elapsed >= 2600;

    // Catapulte
    this.drawCatapultSprite(catX, catY, fireTime);

    // Cadran d'angle interactif (à côté de la catapulte)
    const dialX = catX + 68;
    const dialY = catY - 24;
    const dialR = 26;

    ctx.save();
    // Fond du cadran
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(dialX, dialY, dialR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Aiguille d'angle
    const angleOsc = (45 + Math.sin(now * 0.004) * 20) * (Math.PI / 180);
    const needleLen = dialR - 5;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(dialX, dialY);
    ctx.lineTo(dialX + Math.cos(angleOsc) * needleLen, dialY - Math.sin(angleOsc) * needleLen);
    ctx.stroke();

    ctx.fillStyle = '#fde047';
    ctx.font = '800 8.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round((angleOsc * 180) / Math.PI)}°`, dialX, dialY + dialR + 10);
    ctx.restore();

    // Jauge de puissance sous le cadran
    const powerBarW = 95;
    const powerBarH = 12;
    const px = dialX + 40;
    const py = dialY - 6;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(px, py, powerBarW, powerBarH);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px, py, powerBarW, powerBarH);

    // Oscillation de puissance
    const powRatio = 0.2 + (Math.sin(now * 0.005) * 0.5 + 0.5) * 0.8;
    const fillGrad = ctx.createLinearGradient(px, 0, px + powerBarW, 0);
    fillGrad.addColorStop(0, '#38bdf8');
    fillGrad.addColorStop(0.5, '#facc15');
    fillGrad.addColorStop(1, '#ef4444');
    ctx.fillStyle = fillGrad;
    ctx.fillRect(px + 1, py + 1, (powerBarW - 2) * powRatio, powerBarH - 2);

    ctx.fillStyle = '#fff';
    ctx.font = '800 8.5px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`⚡ PUISSANCE ${Math.round(powRatio * 100)}%`, px, py - 4);

    // Trajectoire balistique lors du tir
    if (fireTime) {
      const t = Math.min(1, (elapsed - 2600) / 1400);
      const bx = catX + 24 + t * (w - catX - 45);
      const by = catY - 20 - Math.sin(t * Math.PI) * 75 + t * 25;

      // Boulet
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fill();

      // Traînée
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (aimTime) {
      ctx.fillStyle = '#b45309';
      ctx.font = '800 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('📐 Tourne le cadran & maintiens pour bander la catapulte !', w * 0.55, 24);
    } else {
      ctx.fillStyle = '#ea580c';
      ctx.font = '800 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☄️ RELÂCHE POUR TIRER ! LE BOULET EST PROPULSÉ !', w * 0.52, 24);
    }
  }

  // ---------------------------------------------------------------- Étape 5 : Bonus Parachutés en Mer
  drawStepBonus(elapsed, w, groundY, now) {
    const { ctx } = this;
    const seaY = groundY - 8;

    // Vagues d'eau
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, seaY, w * 0.65, groundY - seaY + 30);

    for (let vx = 0; vx < w * 0.65; vx += 24) {
      const vy = seaY + Math.sin(now * 0.005 + vx * 0.1) * 2;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(vx, vy, 14, 2);
    }

    // Catapulte à droite qui vise vers la mer
    const catX = w - 45;
    const catY = groundY - 18;
    const fired = elapsed >= 1600;
    this.drawCatapultSprite(catX - 20, catY, fired);

    // Caisse parachutée
    const crateX = w * 0.28;
    const fallT = Math.min(1, elapsed / 1400);
    const crateY = 30 + fallT * (seaY - 42) + Math.sin(now * 0.004) * 2;
    const hasHit = elapsed >= 2700;

    if (!hasHit) {
      // Parachute
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(crateX + 11, crateY - 10, 16, Math.PI, 0, false);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Cordes du parachute
      ctx.strokeStyle = '#94a3b8';
      ctx.beginPath();
      ctx.moveTo(crateX - 5, crateY - 10);
      ctx.lineTo(crateX + 4, crateY + 2);
      ctx.moveTo(crateX + 27, crateY - 10);
      ctx.lineTo(crateX + 18, crateY + 2);
      ctx.stroke();

      // Caisse en bois
      ctx.fillStyle = '#b45309';
      ctx.fillRect(crateX, crateY, 22, 20);
      ctx.fillStyle = '#78350f';
      ctx.strokeRect(crateX, crateY, 22, 20);
      // Ruban jaune
      ctx.fillStyle = '#fde047';
      ctx.fillRect(crateX + 8, crateY, 6, 20);
      ctx.fillRect(crateX, crateY + 7, 22, 6);

      // Icône cadeau
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎁', crateX + 11, crateY + 15);
    } else {
      // Éclaboussure et explosion de la caisse
      if (elapsed < 2800) {
        this.shake = 4;
        for (let k = 0; k < 18; k++) {
          this.particles.push({
            x: crateX + 11,
            y: seaY,
            vx: (Math.random() - 0.5) * 4,
            vy: -2 - Math.random() * 3.5,
            color: Math.random() < 0.6 ? '#38bdf8' : '#fde047',
            life: 0.9,
            size: 2.4 + Math.random() * 2,
          });
        }
      }

      // Badge bonus qui s'envole vers le ciel
      const bonusRise = Math.min(30, (elapsed - 2700) * 0.035);
      ctx.fillStyle = '#facc15';
      ctx.font = '800 12.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎁 +1 BOULET (AMMO) OBTENU !', crateX + 11, seaY - 15 - bonusRise);
    }

    // Tir du boulet vers la caisse
    if (fired && !hasHit) {
      const t = (elapsed - 1600) / 1100;
      const bx = (catX - 20) + t * (crateX + 11 - (catX - 20));
      const by = (catY - 20) - Math.sin(t * Math.PI) * 60 + t * (seaY - (catY - 20));

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (elapsed < 1600) {
      ctx.fillStyle = '#0284c7';
      ctx.font = '800 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎁 Une caisse de ravitaillement flotte dans la mer !', w * 0.5, 24);
    } else if (elapsed >= 1600 && elapsed < 2700) {
      ctx.fillStyle = '#ea580c';
      ctx.font = '800 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☄️ TIR DE PRÉCISION VERS LA MER !', w * 0.5, 24);
    } else {
      ctx.fillStyle = '#16a34a';
      ctx.font = '800 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✔ BONUS RÉCUPÉRÉ ! +1 AMMO ☄️ OU +1 SPRAY 💦', w * 0.5, 24);
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

  drawKingSprite(x, y, color = '#e4572e') {
    const { ctx } = this;
    const s = 2.2;
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

    // Pointe vers le bas
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
