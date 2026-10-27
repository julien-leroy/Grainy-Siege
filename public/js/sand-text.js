// ==============================================================================
// TITRE "GRAINY SIEGE" EN PIXEL ART AVEC CHUTE DE CARRÉS DE SABLE
// Des carrés de sable (comme dans le moteur physique du jeu) tombent du haut
// pour s'empiler et sculpter le titre en pixel art avec contour haute lisibilité.
// ==============================================================================

export class SandTitlePixelArt {
  constructor() {
    this.canvas = document.getElementById('sand-title-canvas');
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.grains = [];
    this.strayGrains = [];
    this.sparkles = [];
    this.allSettled = false;
    this.startTime = 0;
    this.running = true;

    this.init();
  }

  async init() {
    // S'assurer que les polices (Silkscreen / Press Start 2P) sont bien chargées
    if (document.fonts) {
      try {
        await Promise.allSettled([
          document.fonts.load("700 14px 'Silkscreen'"),
          document.fonts.load("700 14px 'Press Start 2P'")
        ]);
      } catch (e) {
        // Fallback
      }
    }

    this.setupGrid();

    // Réactivité au clic et au survol pour faire pleuvoir des carrés de sable
    if (this.canvas) {
      this.canvas.addEventListener('pointerenter', () => this.dropSandShower(30));
      this.canvas.addEventListener('click', () => this.dropSandShower(60));
    }

    const logo = document.querySelector('.brand-logo');
    if (logo) {
      logo.addEventListener('pointerenter', () => this.dropSandShower(30));
      logo.addEventListener('click', () => this.dropSandShower(50));
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.setupGrid();
      }, 150);
    });

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupGrid() {
    if (!this.canvas) return;
    const parent = this.canvas.parentElement;
    const availableWidth = parent ? Math.min(parent.clientWidth || 520, 540) : 500;

    // Taille des carrés de sable (comme dans le moteur physique du jeu : 4px ou 3px selon écran)
    this.grainSize = availableWidth < 400 ? 3 : 4;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    // Hauteur adaptée à la grille de carrés
    this.canvasCssWidth = availableWidth;
    this.canvasCssHeight = this.grainSize === 3 ? 54 : 64;

    this.canvas.width = Math.floor(this.canvasCssWidth * this.dpr);
    this.canvas.height = Math.floor(this.canvasCssHeight * this.dpr);
    this.canvas.style.width = `${this.canvasCssWidth}px`;
    this.canvas.style.height = `${this.canvasCssHeight}px`;

    this.ctx.imageSmoothingEnabled = false;

    // Rasterisation du texte dans un canvas tampon pour obtenir la grille exacte
    const cols = Math.floor(this.canvasCssWidth / this.grainSize);
    const rows = Math.floor(this.canvasCssHeight / this.grainSize);

    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;

    offCtx.imageSmoothingEnabled = false;
    offCtx.fillStyle = '#000';

    const text = 'GRAINY SIEGE';
    const targetWidthCols = cols - 4;
    let fontSize = this.grainSize === 3 ? 12 : 14;
    offCtx.font = `700 ${fontSize}px 'Silkscreen', 'Press Start 2P', monospace`;
    while (offCtx.measureText(text).width > targetWidthCols && fontSize > 8) {
      fontSize--;
      offCtx.font = `700 ${fontSize}px 'Silkscreen', 'Press Start 2P', monospace`;
    }

    offCtx.textBaseline = 'middle';
    offCtx.textAlign = 'left';
    const textY = Math.floor(rows / 2);
    offCtx.fillText(text, 2, textY);

    const imgData = offCtx.getImageData(0, 0, cols, rows);
    const data = imgData.data;

    // Grille 2D des pixels occupés
    const grid = [];
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c < cols; c++) {
        const idx = (r * cols + c) * 4;
        grid[r][c] = data[idx + 3] > 80;
      }
    }

    // Palette de sable haute lisibilité
    // - Contour sombre très contrasté (#241407) pour faire ressortir le texte
    // - Dégradé de sable doré méditerranéen (#fff29d, #f6cb57, #e2a42b, #b27014)
    this.grains = [];
    const now = performance.now();
    this.startTime = now;
    this.allSettled = false;

    // Trouver le min/max de lignes pour le dégradé vertical
    let minRow = rows, maxRow = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c]) {
          if (r < minRow) minRow = r;
          if (r > maxRow) maxRow = r;
        }
      }
    }
    const textHeight = Math.max(1, maxRow - minRow);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid[r][c]) continue;

        // Détection de contour (voisin vide)
        let isBorder = false;
        if (
          r === 0 || r === rows - 1 || c === 0 || c === cols - 1 ||
          !grid[r - 1][c] || !grid[r + 1][c] || !grid[r][c - 1] || !grid[r][c + 1]
        ) {
          isBorder = true;
        }

        let color;
        if (isBorder) {
          color = '#251508'; // Contour sombre pixel-art très net
        } else {
          const ratio = (r - minRow) / textHeight;
          if (ratio < 0.22) {
            color = '#fff3a3'; // Éclat de soleil supérieur
          } else if (ratio < 0.55) {
            color = '#f6cb58'; // Sable doré chaud
          } else if (ratio < 0.85) {
            color = '#e2a42b'; // Sable dunaire ambré
          } else {
            color = '#b27014'; // Ombre de sable mouillé
          }
        }

        const targetX = c * this.grainSize;
        const targetY = r * this.grainSize;

        // Délai de chute : les grains du bas se détachent d'abord pour atterrir en premier,
        // empilant le sable du bas vers le haut comme un château de sable
        const colDelay = (c / cols) * 600;
        const rowDelay = (1 - (r - minRow) / textHeight) * 280;
        const delay = colDelay + rowDelay + Math.random() * 180;
        const startY = -this.grainSize - Math.random() * 50;

        this.grains.push({
          targetX,
          targetY,
          x: targetX,
          y: startY,
          vy: 2.0 + Math.random() * 2.2,
          gravity: 0.35,
          color,
          isBorder,
          delay,
          settled: false
        });
      }
    }

    // Grains parasites de sable qui débordent et tombent comme du vrai sable
    this.strayGrains = [];
    for (let i = 0; i < 20; i++) {
      this.strayGrains.push({
        x: Math.random() * this.canvasCssWidth,
        y: -10 - Math.random() * 50,
        vy: 2.0 + Math.random() * 2.5,
        color: Math.random() > 0.4 ? '#f6cb58' : '#e2a42b'
      });
    }
  }

  dropSandShower(count = 35) {
    if (!this.canvasCssWidth) return;
    for (let i = 0; i < count; i++) {
      this.strayGrains.push({
        x: Math.random() * (this.canvasCssWidth * 0.85),
        y: -10 - Math.random() * 30,
        vy: 2.2 + Math.random() * 3.0,
        color: ['#fff3a3', '#f6cb58', '#e2a42b', '#251508'][Math.floor(Math.random() * 4)]
      });
    }
  }

  loop(now) {
    if (!this.running) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.canvasCssWidth, this.canvasCssHeight);

    const elapsed = now - this.startTime;
    let settledCount = 0;
    const total = this.grains.length;
    const size = this.grainSize;

    // Chute et dessin des carrés de sable
    for (let i = 0; i < total; i++) {
      const g = this.grains[i];

      if (elapsed < g.delay) {
        continue;
      }

      if (!g.settled) {
        g.vy += g.gravity;
        if (g.vy > 6.0) g.vy = 6.0;
        g.y += g.vy;

        if (g.y >= g.targetY) {
          g.y = g.targetY;
          g.settled = true;
        }
      } else {
        settledCount++;
      }

      ctx.fillStyle = g.color;
      // Dessin au carré pixel parfait
      ctx.fillRect(Math.round(g.x), Math.round(g.y), size, size);
    }

    // Grains de sable ambiants qui s'échappent en pluie légère
    for (let i = this.strayGrains.length - 1; i >= 0; i--) {
      const s = this.strayGrains[i];
      s.y += s.vy;

      if (s.y > this.canvasCssHeight + 10) {
        if (this.allSettled) {
          this.strayGrains.splice(i, 1);
          continue;
        } else {
          s.y = -10;
          s.x = Math.random() * this.canvasCssWidth;
        }
      }

      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), size, size);
    }

    // Étincelles pixel art discrètes une fois le titre formé
    if (total > 0 && settledCount === total) {
      if (!this.allSettled) {
        this.allSettled = true;
      }

      // Petite brillance pixel art toutes les ~3.5 secondes
      const cycle = (now % 3500);
      if (cycle < 600 && total > 20) {
        const pIdx = Math.floor((cycle / 600) * total);
        const refGrain = this.grains[pIdx];
        if (refGrain && !refGrain.isBorder) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(Math.round(refGrain.x), Math.round(refGrain.y), size, size);
        }
      }
    }

    ctx.restore();

    requestAnimationFrame(this.loop);
  }
}

// Initialisation au chargement
export let sandTitleInstance = null;
export function initSandTitle() {
  if (typeof document === 'undefined') return;
  if (!sandTitleInstance) {
    sandTitleInstance = new SandTitlePixelArt();
    window.sandTitleInstance = sandTitleInstance;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSandTitle);
  } else {
    initSandTitle();
  }
}
