// ==============================================================================
// EFFET DE SABLE TOMBANT — "GRAINY SIEGE" & SOUS-TITRE (TECHNIQUE PHYSIQUE DE SABLE)
// De véritables grains de sable doré tombent du ciel, oscillent au vent, rebondissent
// doucement et s'empilent pour sculpter le titre et sous-titre en sable pur.
// Durée totale : 3 secondes avec balayage solaire final et grains ambiants.
// Les balises <h1> et <h2> restent présentes en sémantique pure pour le SEO.
// ==============================================================================

export class SandTextEffect {
  constructor() {
    this.container = document.getElementById('sand-text-wrapper') || document.getElementById('sand-text-container');
    this.canvas = document.getElementById('sand-text-canvas');
    if (!this.container || !this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.ambientGrains = [];
    this.startTime = null;
    this.totalDuration = 3000; // 3.0 secondes
    this.allSettled = false;
    this.running = true;

    // Palette authentique de grains de sable de plage méditerranéenne
    this.colors = [
      '#fff6aa', // Éclat de soleil doré
      '#fde047', // Sable jaune chaud dunaire
      '#facc15', // Or dunaire éclatant
      '#f59e0b', // Sable ambré naturel
      '#eab308', // Ocre de plage
      '#d97706', // Sable d'ambre soutenu
      '#b45309', // Ombre de relief / grain mouillé
      '#92400e'  // Grain fin de contraste
    ];

    this.init();
  }

  async init() {
    // S'assurer que les polices web sont chargées avant d'échantillonner les glyphes
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (e) {
        // Fallback silencieux
      }
    }

    this.resize();
    this.buildParticles();

    // Interaction : survol ou clic déclenche une pluie de grains de sable interactifs
    if (this.container) {
      this.container.addEventListener('pointerenter', () => this.sprinkleGrains(50));
      this.container.addEventListener('click', () => this.sprinkleGrains(100));
    }

    const logo = document.querySelector('.brand-logo');
    if (logo) {
      logo.addEventListener('pointerenter', () => this.sprinkleGrains(40));
      logo.addEventListener('click', () => this.sprinkleGrains(90));
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.resize();
        this.buildParticles();
      }, 150);
    });

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    if (!this.container || !this.canvas) return;
    const rect = this.container.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(300, Math.floor(rect.width || 480));
    this.height = Math.max(82, Math.floor(rect.height || 90));

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  buildParticles() {
    this.particles = [];
    this.ambientGrains = [];
    this.allSettled = false;
    this.startTime = performance.now();

    // Rendu hors-écran pour rasteriser la forme exacte des lettres
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;

    offCtx.scale(this.dpr, this.dpr);

    // Tailles harmonieuses de police
    let titleFontSize = 44;
    let subFontSize = 13.5;
    if (this.width < 380) {
      titleFontSize = 32;
      subFontSize = 11;
    } else if (this.width < 460) {
      titleFontSize = 38;
      subFontSize = 12.5;
    }

    const titleText = 'Grainy Siege';
    const subText = 'battle royal de construction de chateau de sable';

    offCtx.fillStyle = '#000000';
    offCtx.textBaseline = 'top';

    // Titre en belle police arrondie
    offCtx.font = `700 ${titleFontSize}px 'Fredoka', 'Quicksand', cursive, -apple-system, sans-serif`;
    const titleY = 4;
    offCtx.fillText(titleText, 0, titleY);

    // Sous-titre
    offCtx.font = `700 ${subFontSize}px 'Nunito', 'Fredoka', -apple-system, sans-serif`;
    const subY = titleY + titleFontSize + 6;
    offCtx.fillText(subText, 0, subY);

    // Échantillonnage des pixels pour créer les grains de sable
    const imgData = offCtx.getImageData(0, 0, off.width, off.height);
    const data = imgData.data;

    // Pas d'échantillonnage serré pour une définition nette des lettres de sable
    const step = this.dpr >= 2 ? 3 : 2;

    for (let py = 0; py < off.height; py += step) {
      for (let px = 0; px < off.width; px += step) {
        const idx = (py * off.width + px) * 4;
        const alpha = data[idx + 3];

        if (alpha > 100) {
          const targetX = px / this.dpr;
          const targetY = py / this.dpr;
          const isTitle = targetY < subY;

          // Délais progressifs sur 3 secondes complètes :
          // Le titre coule d'abord de gauche à droite (0ms à 1400ms)
          // Puis le sous-titre se remplit (900ms à 2300ms)
          let delay;
          if (isTitle) {
            delay = (targetX / this.width) * 950 + Math.random() * 550;
          } else {
            delay = 850 + (targetX / this.width) * 900 + Math.random() * 550;
          }

          const startX = targetX + (Math.random() - 0.5) * 20;
          const startY = -12 - Math.random() * 70;

          this.particles.push({
            tx: targetX,
            ty: targetY,
            x: startX,
            y: startY,
            vx: (Math.random() - 0.5) * 0.4,
            vy: 0.8 + Math.random() * 1.6,
            gravity: 0.14 + Math.random() * 0.05,
            delay,
            color: this.colors[Math.floor(Math.random() * this.colors.length)],
            radius: 1.15 + Math.random() * 0.85,
            settled: false,
            bounces: 0,
            phase: Math.random() * Math.PI * 2,
            isTitle
          });
        }
      }
    }

    // Grains de sable ambiants qui continuent de couler doucement
    for (let i = 0; i < 30; i++) {
      this.ambientGrains.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vy: 0.7 + Math.random() * 1.3,
        vx: (Math.random() - 0.5) * 0.3,
        color: this.colors[Math.floor(Math.random() * this.colors.length)],
        radius: 1.0 + Math.random() * 0.7,
        alpha: 0.25 + Math.random() * 0.4
      });
    }
  }

  sprinkleGrains(count = 50) {
    if (!this.width) return;
    for (let i = 0; i < count; i++) {
      this.ambientGrains.push({
        x: Math.random() * (this.width * 0.9),
        y: -10 - Math.random() * 35,
        vy: 1.2 + Math.random() * 2.2,
        vx: (Math.random() - 0.5) * 0.7,
        color: this.colors[Math.floor(Math.random() * this.colors.length)],
        radius: 1.1 + Math.random() * 0.9,
        alpha: 0.6 + Math.random() * 0.35
      });
    }
  }

  loop(now) {
    if (!this.running) return;

    if (!this.startTime) this.startTime = now;
    const elapsed = now - this.startTime;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    let settledCount = 0;
    const total = this.particles.length;

    // Mise à jour de la physique et dessin des grains de sable formant le texte
    for (let i = 0; i < total; i++) {
      const p = this.particles[i];

      if (elapsed < p.delay) {
        continue;
      }

      if (!p.settled) {
        p.vy += p.gravity;
        if (p.vy > 4.2) p.vy = 4.2;
        p.y += p.vy;
        p.x += Math.sin(p.y * 0.08 + p.phase) * 0.3;

        // Atterrissage doux sur la coordonnée cible du texte
        if (p.y >= p.ty) {
          if (p.bounces < 1 && Math.abs(p.vy) > 0.8) {
            p.bounces++;
            p.vy = -p.vy * 0.22;
            p.y = p.ty;
          } else {
            p.settled = true;
            p.x = p.tx;
            p.y = p.ty;
          }
        }
      } else {
        settledCount++;
      }

      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grains de sable ambiants (chute douce en arrière-plan)
    for (let i = this.ambientGrains.length - 1; i >= 0; i--) {
      const g = this.ambientGrains[i];
      g.y += g.vy;
      g.x += g.vx;

      if (g.y > this.height + 15) {
        if (elapsed > this.totalDuration + 2000) {
          this.ambientGrains.splice(i, 1);
          continue;
        } else {
          g.y = -10;
          g.x = Math.random() * this.width;
        }
      }

      ctx.save();
      ctx.globalAlpha = g.alpha;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Éclat de soleil doré subtil traversant les lettres de sable à la fin des 3 secondes (2600ms - 3400ms)
    if (elapsed >= 2600 && elapsed <= 3400) {
      const prog = (elapsed - 2600) / 800;
      const gleamX = prog * (this.width + 120) - 60;
      const grad = ctx.createLinearGradient(gleamX - 35, 0, gleamX + 35, 0);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      grad.addColorStop(0.5, 'rgba(255, 248, 190, 0.42)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    if (settledCount === total && elapsed > this.totalDuration + 1000 && this.ambientGrains.length === 0) {
      this.allSettled = true;
    }

    ctx.restore();

    if (this.allSettled) {
      // Économie CPU : rafraîchissement au ralenti une fois stabilisé
      setTimeout(() => requestAnimationFrame(this.loop), 1000);
    } else {
      requestAnimationFrame(this.loop);
    }
  }
}

// Initialisation dès que le document est prêt
export let sandTextInstance = null;
export function initSandText() {
  if (typeof document === 'undefined') return;
  if (!sandTextInstance) {
    sandTextInstance = new SandTextEffect();
    window.sandTextInstance = sandTextInstance;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSandText);
  } else {
    initSandText();
  }
}
