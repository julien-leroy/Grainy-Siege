// ==============================================================================
// EFFET DE SABLE TOMBANT — "GRAINY SIEGE" & SOUS-TITRE (TYPO MIGNONNE)
// Animation douce de 3 secondes complètes : les grains de sable doré coulent
// du ciel et s'empilent pour former le titre et sous-titre en typo arrondie.
// ==============================================================================

export class SandTextEffect {
  constructor() {
    this.container = document.getElementById('sand-text-wrapper');
    this.canvas = document.getElementById('sand-text-canvas');
    this.headings = document.getElementById('brand-headings');
    if (!this.container || !this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.strayGrains = [];
    this.startTime = 0;
    this.totalDuration = 3000; // 3 secondes en entier
    this.allSettled = false;
    this.revealed = false;
    this.running = true;

    // Palette de grains de sable méditerranéens (chaud, doré, ambre, reflets)
    this.colors = [
      '#fff4a3', // éclat de soleil doré
      '#fcd34d', // sable chaud vif
      '#fbbf24', // or dunaire
      '#f59e0b', // sable ambré
      '#d97706', // ombre de relief
      '#b45309'  // grain mouillé
    ];

    this.init();
  }

  async init() {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (e) {
        // Fallback silencieux
      }
    }

    this.resize();
    this.buildParticles();

    // Interaction : survol ou clic redéclenche une douce pluie de sable
    if (this.container) {
      this.container.addEventListener('pointerenter', () => this.sprinkle(30));
      this.container.addEventListener('click', () => this.sprinkle(50));
    }

    const logo = document.querySelector('.brand-logo');
    if (logo) {
      logo.addEventListener('pointerenter', () => this.sprinkle(30));
      logo.addEventListener('click', () => this.sprinkle(50));
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
    this.height = Math.max(80, Math.floor(rect.height || 88));

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  buildParticles() {
    this.particles = [];
    this.strayGrains = [];
    this.allSettled = false;
    this.revealed = false;
    this.startTime = performance.now();

    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;

    offCtx.scale(this.dpr, this.dpr);

    // Tailles harmonieuses et mignonnes adaptées à la largeur
    let titleSize = 44;
    let subSize = 14;
    if (this.width < 380) {
      titleSize = 32;
      subSize = 11;
    } else if (this.width < 450) {
      titleSize = 38;
      subSize = 12.5;
    }

    const titleText = 'Grainy Siege';
    const subText = 'battle royal de construction de chateau de sable';

    // Rendu du texte avec la police mignonne arrondie
    offCtx.fillStyle = '#000000';
    offCtx.textBaseline = 'top';

    offCtx.font = `700 ${titleSize}px 'Fredoka', 'Quicksand', -apple-system, sans-serif`;
    const titleY = 4;
    offCtx.fillText(titleText, 0, titleY);

    offCtx.font = `600 ${subSize}px 'Fredoka', 'Quicksand', -apple-system, sans-serif`;
    const subY = titleY + titleSize + 6;
    offCtx.fillText(subText, 0, subY);

    const imgData = offCtx.getImageData(0, 0, off.width, off.height);
    const data = imgData.data;

    // Pas d'échantillonnage de sable
    const step = this.dpr >= 2 ? 3 : 2;

    for (let py = 0; py < off.height; py += step) {
      for (let px = 0; px < off.width; px += step) {
        const idx = (py * off.width + px) * 4;
        const alpha = data[idx + 3];

        if (alpha > 90) {
          const targetX = px / this.dpr;
          const targetY = py / this.dpr;
          const isTitle = targetY < subY;

          // Répartition sur 3 secondes complètes :
          // - Titre : commence à 0ms, s'étale jusqu'à 1500ms
          // - Sous-titre : commence à 1000ms, s'étale jusqu'à 2400ms
          // - Tous les grains atterrissent avant 2800ms
          let delay;
          if (isTitle) {
            delay = (targetX / this.width) * 900 + Math.random() * 600;
          } else {
            delay = 1000 + (targetX / this.width) * 900 + Math.random() * 500;
          }

          const startX = targetX + (Math.random() - 0.5) * 16;
          const startY = -10 - Math.random() * 60;

          this.particles.push({
            tx: targetX,
            ty: targetY,
            x: startX,
            y: startY,
            vx: (Math.random() - 0.5) * 0.3,
            vy: 1.2 + Math.random() * 1.6,
            gravity: 0.18 + Math.random() * 0.06,
            color: this.colors[Math.floor(Math.random() * this.colors.length)],
            radius: 1.2 + Math.random() * 0.8,
            delay,
            settled: false,
            isTitle
          });
        }
      }
    }

    // Quelques grains de sable en lévitation/cascade douce
    for (let i = 0; i < 20; i++) {
      this.strayGrains.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vy: 1.0 + Math.random() * 1.5,
        vx: (Math.random() - 0.5) * 0.4,
        color: this.colors[Math.floor(Math.random() * this.colors.length)],
        radius: 1.0 + Math.random() * 0.6,
        alpha: 0.35 + Math.random() * 0.35
      });
    }
  }

  sprinkle(count = 35) {
    if (!this.width) return;
    for (let i = 0; i < count; i++) {
      this.strayGrains.push({
        x: Math.random() * (this.width * 0.85),
        y: -10 - Math.random() * 30,
        vy: 1.5 + Math.random() * 2.2,
        vx: (Math.random() - 0.5) * 0.6,
        color: this.colors[Math.floor(Math.random() * this.colors.length)],
        radius: 1.2 + Math.random() * 0.8,
        alpha: 0.65 + Math.random() * 0.35
      });
    }
  }

  loop(now) {
    if (!this.running) return;

    const elapsed = now - this.startTime;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    let settledCount = 0;
    const total = this.particles.length;

    // Déplacement et dessin des grains de sable
    for (let i = 0; i < total; i++) {
      const p = this.particles[i];

      if (elapsed < p.delay) {
        continue;
      }

      if (!p.settled) {
        p.vy += p.gravity;
        if (p.vy > 4.2) p.vy = 4.2;
        p.y += p.vy;
        p.x += Math.sin(p.y * 0.06) * 0.3;

        if (p.y >= p.ty) {
          p.settled = true;
          p.x = p.tx;
          p.y = p.ty;
        }
      } else {
        settledCount++;
      }

      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grains ambiants légers
    for (let i = this.strayGrains.length - 1; i >= 0; i--) {
      const s = this.strayGrains[i];
      s.y += s.vy;
      s.x += s.vx;

      if (s.y > this.height + 10) {
        if (elapsed > this.totalDuration) {
          this.strayGrains.splice(i, 1);
          continue;
        } else {
          s.y = -10;
          s.x = Math.random() * this.width;
        }
      }

      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Révélation et éclat final à 3 secondes
    if (elapsed >= 2600 && !this.revealed) {
      this.revealed = true;
      if (this.headings) {
        this.headings.classList.add('sand-revealed');
      }
    }

    // Éclat de soleil doré final balayant le texte à l'achèvement des 3 secondes (2700ms - 3000ms)
    if (elapsed >= 2700 && elapsed <= 3400) {
      const prog = (elapsed - 2700) / 700;
      const gleamX = prog * (this.width + 120) - 60;
      const grad = ctx.createLinearGradient(gleamX - 35, 0, gleamX + 35, 0);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      grad.addColorStop(0.5, 'rgba(255, 248, 200, 0.45)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    if (elapsed > this.totalDuration + 500 && this.strayGrains.length === 0) {
      this.allSettled = true;
    }

    ctx.restore();

    if (this.allSettled) {
      // Économie 0% CPU une fois stabilisé
      setTimeout(() => requestAnimationFrame(this.loop), 1000);
    } else {
      requestAnimationFrame(this.loop);
    }
  }
}

// Initialisation dès que le DOM est prêt
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
