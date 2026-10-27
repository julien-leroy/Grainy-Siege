// ==============================================================================
// BACKGROUND DU SITE "GRAINY SIEGE" — PARALLAX CIEL, MER, NUAGES & OISEAUX
// Décor léger et poétique pour le Menu Principal & Salon
// Ne tourne QUE quand le menu est affiché (0% CPU pendant la game)
// ==============================================================================

export class SiteBackground {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.active = true;
    this.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };

    // Nuages légers qui circulent
    this.clouds = [
      { x: -0.1, y: 0.12, scale: 1.1, speed: 0.015, alpha: 0.85 },
      { x: 0.35, y: 0.22, scale: 0.8, speed: 0.022, alpha: 0.75 },
      { x: 0.75, y: 0.08, scale: 1.3, speed: 0.012, alpha: 0.90 },
      { x: 1.15, y: 0.28, scale: 0.65, speed: 0.028, alpha: 0.65 },
    ];

    // Oiseaux discrets qui traversent le ciel avec parcimonie
    this.birds = [
      { x: 0.2, y: 0.32, speed: 0.045, phase: 0, scale: 1.0 },
      { x: 0.24, y: 0.29, speed: 0.046, phase: 1.2, scale: 0.85 },
      { x: 0.85, y: 0.18, speed: 0.038, phase: 2.5, scale: 0.9 },
    ];

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.mouse.targetX = (e.clientX / window.innerWidth - 0.5) * 20;
      this.mouse.targetY = (e.clientY / window.innerHeight - 0.5) * 12;
    });

    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    if (!this.canvas) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
  }

  setActive(active) {
    this.active = active;
    if (active) {
      this.lastTime = performance.now();
      requestAnimationFrame(this.loop);
    }
  }

  loop(now) {
    if (!this.active) return;
    const dt = Math.min(100, now - this.lastTime);
    this.lastTime = now;

    // Lissage du mouvement de la souris (parallax doux)
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.05;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.05;

    this.render(now, dt);
    requestAnimationFrame(this.loop);
  }

  render(now, dt) {
    const { ctx, width, height, dpr } = this;
    ctx.save();
    ctx.scale(dpr, dpr);

    const horizonY = height * 0.68;
    const shoreY = height * 0.78;

    // 1) Ciel dégradé d'été chaleureux
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#38bdf8');   // bleu ciel radieux
    skyGrad.addColorStop(0.55, '#93c5fd'); // transition azur
    skyGrad.addColorStop(0.85, '#fde68a'); // lueur dorée au-dessus de la mer
    skyGrad.addColorStop(1, '#fed7aa');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, horizonY);

    // Soleil d'ambiance doux
    const sunX = width * 0.80 + this.mouse.x * 0.4;
    const sunY = height * 0.20 + this.mouse.y * 0.4;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 180);
    sunGlow.addColorStop(0, 'rgba(255, 253, 230, 0.95)');
    sunGlow.addColorStop(0.25, 'rgba(254, 240, 138, 0.45)');
    sunGlow.addColorStop(0.7, 'rgba(253, 224, 71, 0.12)');
    sunGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, width, horizonY);

    // 2) Nuages doux et volumineux qui défilent
    for (const c of this.clouds) {
      c.x += (c.speed * dt) / 1000;
      if (c.x > 1.25) c.x = -0.25;

      const cx = c.x * width + this.mouse.x * (c.scale * 0.5);
      const cy = c.y * horizonY + this.mouse.y * (c.scale * 0.3);
      this.drawCloud(ctx, cx, cy, c.scale, c.alpha);
    }

    // 3) Oiseaux élégants avec battements d'ailes
    for (const b of this.birds) {
      b.x += (b.speed * dt) / 1000;
      if (b.x > 1.2) b.x = -0.2;

      const bx = b.x * width + this.mouse.x * 0.8;
      const by = b.y * horizonY + Math.sin(now * 0.002 + b.phase) * 6 + this.mouse.y * 0.5;
      const flap = Math.sin(now * 0.008 + b.phase) * 5;
      this.drawGull(ctx, bx, by, b.scale, flap);
    }

    // 4) Mer turquoise avec reflets
    const seaGrad = ctx.createLinearGradient(0, horizonY, 0, shoreY);
    seaGrad.addColorStop(0, '#0284c7');
    seaGrad.addColorStop(0.4, '#0ea5e9');
    seaGrad.addColorStop(1, '#38bdf8');
    ctx.fillStyle = seaGrad;
    ctx.fillRect(0, horizonY, width, shoreY - horizonY);

    // Lignes de ressac et reflets d'eau
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      const wy = horizonY + 8 + i * 16;
      const waveOffset = Math.sin(now * 0.002 + i) * 20;
      ctx.beginPath();
      ctx.moveTo(0, wy);
      ctx.bezierCurveTo(width * 0.3 + waveOffset, wy - 3, width * 0.7 - waveOffset, wy + 3, width, wy);
      ctx.stroke();
    }

    // 5) Rivage et Plage de sable doré chaud
    const sandGrad = ctx.createLinearGradient(0, shoreY, 0, height);
    sandGrad.addColorStop(0, '#fde047');
    sandGrad.addColorStop(0.35, '#f59e0b');
    sandGrad.addColorStop(1, '#d97706');
    ctx.fillStyle = sandGrad;
    ctx.fillRect(0, shoreY, width, height - shoreY);

    // Écume blanche au contact de l'eau
    const foamY = shoreY;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(0, foamY);
    for (let x = 0; x <= width; x += 40) {
      const fy = foamY + Math.sin(x * 0.02 + now * 0.003) * 3;
      ctx.lineTo(x, fy);
    }
    ctx.lineTo(width, foamY + 6);
    ctx.lineTo(0, foamY + 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  drawCloud(ctx, x, y, scale, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';

    const r = 24 * scale;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x - r * 0.9, y + r * 0.2, r * 0.75, 0, Math.PI * 2);
    ctx.arc(x + r * 0.85, y + r * 0.15, r * 0.8, 0, Math.PI * 2);
    ctx.arc(x + r * 1.5, y + r * 0.35, r * 0.6, 0, Math.PI * 2);
    ctx.arc(x - r * 1.5, y + r * 0.35, r * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Ombrage inférieur doux
    ctx.fillStyle = 'rgba(226, 232, 240, 0.45)';
    ctx.beginPath();
    ctx.arc(x, y + r * 0.35, r * 0.75, 0, Math.PI);
    ctx.fill();

    ctx.restore();
  }

  drawGull(ctx, x, y, scale, flap) {
    ctx.save();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const w = 9 * scale;
    ctx.beginPath();
    // Aile gauche
    ctx.moveTo(x - w, y + flap);
    ctx.quadraticCurveTo(x - w * 0.4, y - 4 * scale, x, y);
    // Aile droite
    ctx.quadraticCurveTo(x + w * 0.4, y - 4 * scale, x + w, y + flap);
    ctx.stroke();

    ctx.restore();
  }
}

// Initialisation dès que le DOM est prêt
export let siteBgInstance = null;
function initSiteBg() {
  if (!siteBgInstance && typeof document !== 'undefined') {
    const el = document.getElementById('site-bg-canvas');
    if (el) {
      siteBgInstance = new SiteBackground('site-bg-canvas');
      window.siteBgInstance = siteBgInstance;
    }
  }
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSiteBg);
  } else {
    initSiteBg();
  }
}

