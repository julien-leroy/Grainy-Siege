// Rendu de la scène de plage : ciel, mer, voiliers, mouettes, sable (pixel art éclairé),
// sable durci au spray (T.HARD), roi expressif, catapulte avec élastique de visée,
// gouttelettes de spray et textes flottants.
import {
  GRID_W, GRID_H, GROUND_Y, T, TYPE_MASK, DMG_SHIFT, MOIST_SHIFT, KING_W, KING_H, CATAPULT_X, LAUNCH_X, LAUNCH_Y,
  BUILD_MIN_X, BALL_GRAVITY, SPRAY_RADIUS, launchVelocity, CATAPULT_RIGHT_X, LAUNCH_RIGHT_X,
} from '/shared/constants.js';

const SUB = 2; // sous-pixels par cellule (grain plus fin)
const HORIZON = 96;
const SHORE = 138;

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const PALETTE = {
  [T.WET]: [198, 162, 104],
  [T.HARD]: [166, 130, 76], // sable gorgé d'eau, plus dense et foncé
  [T.DRY]: [238, 213, 158],
  [T.LOOSE]: [216, 182, 124],
};

function hexToRgb(hex) {
  const n = parseInt((hex || '#e4572e').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sand = document.createElement('canvas');
    this.sand.width = GRID_W * SUB;
    this.sand.height = GRID_H * SUB;
    this.sandCtx = this.sand.getContext('2d');
    this.sandImg = this.sandCtx.createImageData(this.sand.width, this.sand.height);
    this.shadow = document.createElement('canvas');
    this.shadow.width = GRID_W;
    this.shadow.height = GRID_H;
    this.shadowCtx = this.shadow.getContext('2d');
    this.shadowImg = this.shadowCtx.createImageData(GRID_W, GRID_H);
    this.drawnKey = null;
    this.fx = [];
    this.popups = [];
    this.pouringBuckets = [];
    this.handScoops = [];
    this.redFlashes = [];
    this.shake = 0;
    this.flashLife = 0;
    this.flashColor = '#fff';
    this.catapult = { angle: 2.95, target: 2.95, color: '#c0392b', loaded: true };
    this.catapultSide = 'left';
    this.catapultSlide = 0; // 0 = gauche, 1 = droite
    this.camera = {
      currentX: GRID_W / 2,
      currentY: GROUND_Y - 45,
      currentZoom: 1.0,
      targetX: GRID_W / 2,
      targetY: GROUND_Y - 45,
      targetZoom: 1.0,
    };
    this.clouds = Array.from({ length: 6 }, (_, i) => ({
      x: Math.random(), y: 0.08 + Math.random() * 0.3, s: 0.6 + Math.random() * 0.9, v: 0.004 + Math.random() * 0.006, k: i,
    }));
    this.gulls = Array.from({ length: 4 }, (_, i) => ({
      x: Math.random(), y: 0.14 + Math.random() * 0.25, v: 0.015 + Math.random() * 0.012, phase: i * 1.7,
    }));
    this.groundPattern = this.makeGroundPattern();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  makeGroundPattern() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const img = g.createImageData(64, 64);
    for (let i = 0; i < 64 * 64; i++) {
      const n = (hash(i % 64, (i / 64) | 0) - 0.5) * 18;
      img.data[i * 4] = 206 + n;
      img.data[i * 4 + 1] = 171 + n;
      img.data[i * 4 + 2] = 114 + n * 0.8;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return this.ctx.createPattern(c, 'repeat');
  }

  setCameraTarget(targetX, targetY = GROUND_Y - 45, targetZoom = 1.0) {
    this.camera.targetX = targetX;
    this.camera.targetY = targetY;
    this.camera.targetZoom = targetZoom;
  }

  updateCamera(dt) {
    const f = Math.min(1, 0.006 * dt);
    this.camera.currentX += (this.camera.targetX - this.camera.currentX) * f;
    this.camera.currentY += (this.camera.targetY - this.camera.currentY) * f;
    this.camera.currentZoom += (this.camera.targetZoom - this.camera.currentZoom) * f;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const baseS = Math.min(cw / (GRID_W * 1.0), ch / (GRID_H * 1.05));
    const s = baseS * this.camera.currentZoom;
    const ox = cw / 2 - this.camera.currentX * s;
    const oy = (ch - 18 * this.dpr) - GROUND_Y * s;
    this.view = { s, ox, oy };
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const baseS = Math.min(cw / (GRID_W * 1.0), ch / (GRID_H * 1.05));
    const s = baseS * (this.camera ? this.camera.currentZoom : 1.0);
    const ox = cw / 2 - (this.camera ? this.camera.currentX : GRID_W / 2) * s;
    const oy = (ch - 18 * this.dpr) - GROUND_Y * s;
    this.view = { s, ox, oy };
    this.drawnKey = null;
  }

  toCell(clientX, clientY) {
    const { s, ox, oy } = this.view;
    return { x: (clientX * this.dpr - ox) / s, y: (clientY * this.dpr - oy) / s };
  }

  toScreen(x, y) {
    const { s, ox, oy } = this.view;
    return { x: (ox + x * s) / this.dpr, y: (oy + y * s) / this.dpr };
  }

  // ---------------------------------------------------------------- sable → image
  paintSand(world) {
    const key = `${world.pid}:${world.version}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const cells = world.cells;
    const data = this.sandImg.data;
    const sh = this.shadowImg.data;
    const SW = GRID_W * SUB;
    data.fill(0);
    sh.fill(0);
    for (let y = 0; y < GROUND_Y; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        const code = cells[i];
        const t = code & TYPE_MASK;
        if (t === T.EMPTY || t === T.GROUND || t === T.KING) continue;
        const moistLvl = (t === T.WET || t === T.HARD) ? ((code >> MOIST_SHIFT) & 7) : 4;
        let baseR, baseG, baseB;
        if (t === T.DRY) {
          [baseR, baseG, baseB] = PALETTE[T.DRY];
        } else if (t === T.LOOSE) {
          [baseR, baseG, baseB] = PALETTE[T.LOOSE];
        } else if (t === T.HARD || moistLvl >= 6) {
          // Sable gorgé d'eau / spray : brun sombre et saturé
          const f = (moistLvl - 5) / 2;
          baseR = Math.round(172 - f * 26);
          baseG = Math.round(136 - f * 28);
          baseB = Math.round(82 - f * 24);
        } else if (moistLvl <= 2) {
          // Sable asséché en surface : teinte claire et poudreuse
          const f = (2 - moistLvl) / 2;
          baseR = Math.round(198 + f * 34);
          baseG = Math.round(162 + f * 42);
          baseB = Math.round(104 + f * 42);
        } else {
          // Sable mouillé normal
          [baseR, baseG, baseB] = PALETTE[T.WET];
        }

        const up = y > 0 ? cells[i - GRID_W] & TYPE_MASK : 0;
        const down = cells[i + GRID_W] & TYPE_MASK;
        const left = x > 0 ? cells[i - 1] & TYPE_MASK : 1;
        const right = x < GRID_W - 1 ? cells[i + 1] & TYPE_MASK : 1;
        let light = 0;
        if (up === T.EMPTY) light += (t === T.HARD || moistLvl >= 6) ? 28 : 22;
        if (left === T.EMPTY) light += 9;
        if (right === T.EMPTY) light -= 14;
        if (down === T.EMPTY) light -= 26;
        const dmg = (t === T.WET || t === T.HARD) ? ((code >> DMG_SHIFT) & 3) : 0;
        light -= dmg * 10;
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            const px = x * SUB + sx;
            const py = y * SUB + sy;
            const hN = hash(px, py);
            let n = (hN - 0.5) * (t === T.DRY ? 26 : (t === T.HARD || moistLvl >= 6) ? 14 : 18) + light;
            if (t === T.DRY && hN > 0.93) n += 18;
            // Reflet spéculaire d'eau sur le sable durci / saturé
            if ((t === T.HARD || moistLvl >= 6) && sy === 0 && up === T.EMPTY) n += 24;
            if ((t === T.HARD || moistLvl >= 6) && hN > 0.91) n += 20;
            if (dmg && hash(px * 7 + 3, py * 5 + 1) < dmg * 0.095) n -= 48;
            if (sy === 0 && up === T.EMPTY && t === T.WET && moistLvl < 6) n += 10;
            const o = (py * SW + px) * 4;
            data[o] = Math.min(255, Math.max(0, baseR + n));
            data[o + 1] = Math.min(255, Math.max(0, baseG + n * 0.92));
            data[o + 2] = Math.min(255, Math.max(0, baseB + n * ((t === T.HARD || moistLvl >= 6) ? 0.88 : 0.75)));
            data[o + 3] = 255;
          }
        }
        sh[i * 4 + 3] = 75;
      }
    }
    this.sandCtx.putImageData(this.sandImg, 0, 0);
    this.shadowCtx.putImageData(this.shadowImg, 0, 0);
  }

  // ---------------------------------------------------------------- décor
  drawBackground(t) {
    const { ctx } = this;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const { s, ox, oy } = this.view;
    const hy = oy + HORIZON * s;
    const shoreY = oy + SHORE * s;
    const groundY = oy + GROUND_Y * s;

    const sky = ctx.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, '#4ea8de');
    sky.addColorStop(0.62, '#9ed8f5');
    sky.addColorStop(1, '#fae8c8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cw, hy + 1);

    // soleil + rayons doux
    const sx = cw * 0.16;
    const sy = Math.max(hy * 0.24, 56 * this.dpr);
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, 150 * this.dpr);
    sun.addColorStop(0, 'rgba(255,252,225,1)');
    sun.addColorStop(0.18, 'rgba(255,240,185,0.95)');
    sun.addColorStop(0.22, 'rgba(255,232,165,0.38)');
    sun.addColorStop(1, 'rgba(255,232,165,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(sx - 160 * this.dpr, sy - 160 * this.dpr, 320 * this.dpr, 320 * this.dpr);

    // nuages
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    for (const c of this.clouds) {
      const x = (((c.x + t * c.v * 0.001) % 1.2) - 0.1) * cw;
      const y = c.y * hy;
      const r = 26 * c.s * this.dpr;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 2.2, r * 0.7, 0, 0, Math.PI * 2);
      ctx.ellipse(x - r * 0.9, y + r * 0.1, r * 1.1, r * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(x + r * 0.6, y - r * 0.35, r * 1.2, r * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // mouettes animées dans le ciel
    ctx.strokeStyle = 'rgba(45,65,85,0.55)';
    ctx.lineWidth = 1.6 * this.dpr;
    for (const g of this.gulls) {
      const gx = (((g.x + t * g.v * 0.0005) % 1.15) - 0.08) * cw;
      const gy = g.y * hy + Math.sin(t * 0.002 + g.phase) * 4 * this.dpr;
      const flap = Math.sin(t * 0.009 + g.phase) * 3.5 * this.dpr;
      const w = 6 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(gx - w, gy + flap);
      ctx.quadraticCurveTo(gx - w * 0.4, gy - 3 * this.dpr, gx, gy);
      ctx.quadraticCurveTo(gx + w * 0.4, gy - 3 * this.dpr, gx + w, gy + flap);
      ctx.stroke();
    }

    // petit voilier à l'horizon
    const boatX = (((0.65 + t * 0.000004) % 1.1) - 0.05) * cw;
    const boatY = hy - 1 * this.dpr;
    ctx.fillStyle = '#fff9f0';
    ctx.beginPath();
    ctx.moveTo(boatX, boatY - 14 * this.dpr);
    ctx.lineTo(boatX + 9 * this.dpr, boatY - 2 * this.dpr);
    ctx.lineTo(boatX, boatY - 2 * this.dpr);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e4572e';
    ctx.beginPath();
    ctx.moveTo(boatX - 1 * this.dpr, boatY - 12 * this.dpr);
    ctx.lineTo(boatX - 7 * this.dpr, boatY - 2 * this.dpr);
    ctx.lineTo(boatX - 1 * this.dpr, boatY - 2 * this.dpr);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5a3a1e';
    ctx.fillRect(boatX - 8 * this.dpr, boatY - 2 * this.dpr, 18 * this.dpr, 3 * this.dpr);

    // mer
    const sea = ctx.createLinearGradient(0, hy, 0, shoreY);
    sea.addColorStop(0, '#1e78b0');
    sea.addColorStop(0.55, '#33a3c7');
    sea.addColorStop(1, '#6ed6d9');
    ctx.fillStyle = sea;
    ctx.fillRect(0, hy, cw, shoreY - hy + 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = Math.max(1, s * 0.5);
    for (let k = 0; k < 7; k++) {
      const yy = hy + ((k + 0.5) / 7) ** 1.6 * (shoreY - hy);
      const amp = (1 + k * 0.6) * this.dpr;
      const ph = t * 0.0006 * (1 + k * 0.15) + k * 1.7;
      ctx.beginPath();
      for (let x = 0; x <= cw; x += 18 * this.dpr) {
        const y = yy + Math.sin(x * 0.012 / this.dpr + ph) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = 0.25 + k * 0.06;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // reflets du soleil
    ctx.fillStyle = 'rgba(255,255,240,0.6)';
    for (let k = 0; k < 26; k++) {
      const yy = hy + hash(k, 3) * (shoreY - hy) * 0.6;
      const xx = sx + (hash(k, 9) - 0.5) * 160 * this.dpr * (1 + (yy - hy) / (shoreY - hy));
      const a = 0.5 + 0.5 * Math.sin(t * 0.003 + k * 2.1);
      ctx.globalAlpha = a * 0.7;
      ctx.fillRect(xx, yy, 10 * this.dpr * a + 2, 1.5 * this.dpr);
    }
    ctx.globalAlpha = 1;

    // estran mouillé + écume qui va et vient
    const swash = (Math.sin(t * 0.0009) * 0.5 + 0.5) * 5 * s;
    const wetSand = ctx.createLinearGradient(0, shoreY, 0, groundY);
    wetSand.addColorStop(0, '#b99868');
    wetSand.addColorStop(1, '#cfb07c');
    ctx.fillStyle = wetSand;
    ctx.fillRect(0, shoreY, cw, groundY - shoreY + 1);
    ctx.fillStyle = 'rgba(111,211,214,0.75)';
    ctx.beginPath();
    ctx.moveTo(0, shoreY);
    for (let x = 0; x <= cw; x += 12 * this.dpr) {
      ctx.lineTo(x, shoreY + swash + Math.sin(x * 0.02 / this.dpr + t * 0.002) * 1.5 * this.dpr);
    }
    ctx.lineTo(cw, shoreY);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath();
    for (let x = 0; x <= cw; x += 12 * this.dpr) {
      const y = shoreY + swash + Math.sin(x * 0.02 / this.dpr + t * 0.002) * 1.5 * this.dpr;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // sol de plage + petits coquillages et étoile de mer décoratifs
    ctx.save();
    ctx.fillStyle = this.groundPattern;
    if (this.groundPattern && typeof DOMMatrix !== 'undefined' && typeof this.groundPattern.setTransform === 'function') {
      const m = new DOMMatrix().translate(ox, groundY).scale(s / SUB, s / SUB);
      this.groundPattern.setTransform(m);
    }
    ctx.fillRect(0, groundY, cw, ch - groundY);
    ctx.restore();
    const lip = ctx.createLinearGradient(0, groundY, 0, groundY + 6 * s);
    lip.addColorStop(0, 'rgba(255,240,200,0.48)');
    lip.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = lip;
    ctx.fillRect(0, groundY, cw, 6 * s);

    // étoile de mer et coquillages sur le premier plan
    this.drawShells(ox, groundY, s);
  }

  drawShells(ox, groundY, s) {
    const { ctx } = this;
    // étoile de mer à gauche
    const sx = ox + 68 * s;
    const sy = groundY + 9 * s;
    ctx.save();
    ctx.fillStyle = '#e06d53';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 === 0 ? 3.2 : 1.4) * s;
      const a = (i * Math.PI) / 5 - 0.3;
      const px = sx + Math.cos(a) * r;
      const py = sy + Math.sin(a) * r * 0.7;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // coquillages blancs/roses
    for (const [cx, cy, col] of [[135, 8, '#f7ede2'], [218, 11, '#f5cac3'], [265, 7, '#f7ede2']]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(ox + cx * s, groundY + cy * s, 1.8 * s, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawBuildZone(alpha) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const x = ox + BUILD_MIN_X * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(25,55,75,0.09)';
    ctx.fillRect(0, oy, x, GROUND_Y * s);
    ctx.setLineDash([6 * this.dpr, 6 * this.dpr]);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.6 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(x, oy + 20 * s);
    ctx.lineTo(x, oy + GROUND_Y * s);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- catapultes (Gauche et Droite)
  getCatapultScreenPos(side = 'left') {
    const isRight = side === 'right';
    const px = isRight ? (GRID_W - (CATAPULT_X + 6)) : (CATAPULT_X + 6);
    const py = GROUND_Y - 14;
    const pt = this.toScreen(px, py);
    return {
      x: pt.x,
      y: pt.y,
      s: this.view.s / this.dpr,
    };
  }

  drawCatapult(dt, alpha = 1, slingPull = null, activeSide = 'left', aimInfo = null, isCharging = false, chargePower = 0, ammoType = 'normal') {
    const targetSlide = activeSide === 'right' ? 1.0 : 0.0;
    this.catapultSlide += (targetSlide - this.catapultSlide) * Math.min(1, 0.01 * dt);
    this.catapultSide = activeSide;

    // Dessiner les 2 catapultes : active avec pleine opacité, inactive plus effacée
    const sides = ['left', 'right'];
    for (const side of sides) {
      const isActive = side === activeSide;
      const catAlpha = isActive ? alpha : (alpha * 0.38);
      this._drawSingleCatapult(dt, catAlpha, isActive ? slingPull : null, side, isActive, aimInfo, isCharging, chargePower, ammoType);
    }

    // Effet de glissé fluide : lueur dorée qui glisse sur le rivage d'une catapulte à l'autre
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    if (Math.abs(targetSlide - this.catapultSlide) > 0.01) {
      const currentX = ox + (CATAPULT_X + this.catapultSlide * (CATAPULT_RIGHT_X - CATAPULT_X)) * s;
      ctx.save();
      ctx.fillStyle = 'rgba(254, 240, 138, 0.55)';
      ctx.beginPath();
      ctx.ellipse(currentX, oy + (GROUND_Y + 0.5) * s, 22 * s, 3.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawSingleCatapult(dt, alpha, slingPull, side, isActive, aimInfo, isCharging, chargePower, ammoType) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const isRight = side === 'right';
    const c = this.catapult;
    const speed = c.target < c.angle ? 0.045 : 0.007;
    c.angle += (c.target - c.angle) * Math.min(1, speed * dt);

    const X = (x) => ox + (isRight ? (GRID_W - x) : x) * s;
    const Y = (y) => oy + y * s;
    const px = CATAPULT_X + 6; // 30
    const py = GROUND_Y - 14;  // Pivot plus haut et imposant
    const L = 23;              // Longueur de bras accrue pour un effet grandiose

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Grande ombre portée réaliste sous la catapulte sur le sable
    ctx.fillStyle = 'rgba(60, 36, 16, 0.28)';
    ctx.beginPath();
    ctx.ellipse(X(px), Y(GROUND_Y + 0.8), 24 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Halo d'emphase chaleureux sous la catapulte active
    if (isActive && alpha > 0.4) {
      const pulseHalo = Math.sin(performance.now() * 0.004) * 0.06;
      ctx.fillStyle = `rgba(250, 204, 21, ${0.22 + pulseHalo})`;
      ctx.beginPath();
      ctx.ellipse(X(px), Y(GROUND_Y + 0.8), 28 * s, 5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Buttes de sable meuble entourant les patins au sol (intégration dans la plage)
    ctx.fillStyle = '#dfb57c';
    ctx.beginPath();
    ctx.ellipse(X(CATAPULT_X - 12), Y(GROUND_Y - 0.5), 10 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(X(CATAPULT_X + 12), Y(GROUND_Y - 0.5), 10 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Roues géantes à rayons cerclées de fer forgé (2 avant, 2 arrière)
    const drawWheel = (wx, wy, r) => {
      // Pneu en fer sombre
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(X(wx), Y(wy), r, 0, Math.PI * 2);
      ctx.fill();
      // Jante en bois massif
      ctx.fillStyle = '#5c3818';
      ctx.beginPath();
      ctx.arc(X(wx), Y(wy), r * 0.82, 0, Math.PI * 2);
      ctx.fill();
      // Rayons en bois
      ctx.strokeStyle = '#3d2410';
      ctx.lineWidth = 1.4 * this.dpr;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(X(wx), Y(wy));
        ctx.lineTo(X(wx) + Math.cos(a) * r * 0.78, Y(wy) + Math.sin(a) * r * 0.78);
        ctx.stroke();
      }
      // Moyeu central en bronze riveté
      ctx.fillStyle = '#ca8a04';
      ctx.beginPath();
      ctx.arc(X(wx), Y(wy), r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(X(wx), Y(wy), r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      // Clous de fer sur la jante
      ctx.fillStyle = '#cbd5e1';
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + 0.2;
        ctx.beginPath();
        ctx.arc(X(wx) + Math.cos(a) * r * 0.9, Y(wy) + Math.sin(a) * r * 0.9, 0.7 * this.dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    drawWheel(CATAPULT_X - 12, GROUND_Y - 4, 4.8 * s);
    drawWheel(CATAPULT_X + 12, GROUND_Y - 4, 4.8 * s);

    // 4. Châssis en poutres de chêne massif renforcées de fer
    // Poutre inférieure de roulement
    ctx.fillStyle = '#452610';
    ctx.fillRect(Math.min(X(CATAPULT_X - 16), X(CATAPULT_X + 16)), Y(GROUND_Y - 6), 32 * s, 3.5 * s);
    // Biseau supérieur en bois clair
    ctx.fillStyle = '#784620';
    ctx.fillRect(Math.min(X(CATAPULT_X - 15), X(CATAPULT_X + 15)), Y(GROUND_Y - 6), 30 * s, 1.2 * s);
    // Renforts métalliques d'extrémités
    ctx.fillStyle = '#334155';
    ctx.fillRect(Math.min(X(CATAPULT_X - 16), X(CATAPULT_X - 13)), Y(GROUND_Y - 6.5), 3 * s, 4.5 * s);
    ctx.fillRect(Math.min(X(CATAPULT_X + 13), X(CATAPULT_X + 16)), Y(GROUND_Y - 6.5), 3 * s, 4.5 * s);

    // 5. Treuil arrière à corde de torsion épaisse
    const winchX = px - 9;
    const winchY = GROUND_Y - 7;
    // Tambour en bois
    ctx.fillStyle = '#3d2410';
    ctx.fillRect(Math.min(X(winchX - 2.5), X(winchX + 2.5)), Y(winchY - 2.5), 5 * s, 5 * s);
    // Spires de corde de chanvre
    ctx.strokeStyle = '#d4a373';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.moveTo(X(winchX - 2), Y(winchY));
    ctx.lineTo(X(winchX + 2), Y(winchY));
    ctx.stroke();
    // Roue crantée à rochet
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(X(winchX), Y(winchY), 2.8 * s, 0, Math.PI * 2);
    ctx.fill();

    // 6. Montants verticaux en A (superstructure imposante)
    // Montant arrière
    ctx.strokeStyle = '#5a3518';
    ctx.lineWidth = 3.6 * s;
    ctx.beginPath();
    ctx.moveTo(X(px - 7), Y(GROUND_Y - 5));
    ctx.lineTo(X(px), Y(py));
    ctx.stroke();

    // Montant avant
    ctx.strokeStyle = '#6b401e';
    ctx.lineWidth = 3.6 * s;
    ctx.beginPath();
    ctx.moveTo(X(px + 7), Y(GROUND_Y - 5));
    ctx.lineTo(X(px), Y(py));
    ctx.stroke();

    // Traverse horizontale de renfort
    ctx.strokeStyle = '#7c4c24';
    ctx.lineWidth = 2.4 * s;
    ctx.beginPath();
    ctx.moveTo(X(px - 4.5), Y(py + 6));
    ctx.lineTo(X(px + 4.5), Y(py + 6));
    ctx.stroke();

    // Goussets métalliques d'angle rivetés
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(X(px), Y(py - 1.5));
    ctx.lineTo(X(px - 3.5), Y(py + 3.5));
    ctx.lineTo(X(px + 3.5), Y(py + 3.5));
    ctx.closePath();
    ctx.fill();

    // Butoir rembourré en cuir / corde à l'avant
    ctx.strokeStyle = '#854d0e';
    ctx.lineWidth = 2.8 * s;
    ctx.beginPath();
    ctx.moveTo(X(px + 3), Y(py + 2));
    ctx.lineTo(X(px + 9), Y(py - 9));
    ctx.stroke();
    // Coussin d'arrêt
    ctx.fillStyle = '#b45309';
    ctx.beginPath();
    ctx.arc(X(px + 9), Y(py - 9), 2.2 * s, 0, Math.PI * 2);
    ctx.fill();

    // 7. Bras articulé balistique (Grand mangonneau d'assaut)
    // Déflexion du bras si mise sous tension (isCharging)
    let armAngle = c.angle;
    if (isActive && isCharging && c.loaded) {
      // Flexion du bras vers l'arrière sous l'effort du treuil (vers 3.1 rad)
      const flex = (chargePower || 0) * 0.22;
      armAngle = Math.min(3.1, c.angle + flex);
    }

    const tx = px + Math.cos(armAngle) * L;
    const ty = py - Math.sin(armAngle) * L;

    // Câble de tension reliant le treuil au bras lors de la charge
    if (isActive && isCharging) {
      const tensionVibe = Math.sin(performance.now() * 0.08) * 0.6 * s;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.8 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(X(winchX), Y(winchY));
      ctx.lineTo(X(tx * 0.7 + px * 0.3), Y(ty * 0.7 + py * 0.3) + tensionVibe);
      ctx.stroke();
    }

    // Poutre du bras (chêne renforcé)
    ctx.strokeStyle = '#854e24';
    ctx.lineWidth = 3.2 * s;
    ctx.beginPath();
    ctx.moveTo(X(px - Math.cos(armAngle) * 6), Y(py + Math.sin(armAngle) * 6));
    ctx.lineTo(X(tx), Y(ty));
    ctx.stroke();

    // Contrepoids arrière en pierre cerclée de fer
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(X(px - Math.cos(armAngle) * 6), Y(py + Math.sin(armAngle) * 6), 3.2 * s, 0, Math.PI * 2);
    ctx.fill();

    // Cerclages de fer sur le bras
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.6 * this.dpr;
    for (let f = 0.3; f <= 0.8; f += 0.25) {
      const bx = px + Math.cos(armAngle) * L * f;
      const by = py - Math.sin(armAngle) * L * f;
      ctx.beginPath();
      ctx.arc(X(bx), Y(by), 2 * s, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cuillère de tir en fer forgé riveté (large et imposante)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(X(tx), Y(ty), 4.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 1.8 * s;
    ctx.stroke();

    // Munition installée dans la cuillère (chargée et prête)
    if (c.loaded) {
      const bRad = 3.4 * s;
      const ballX = X(tx);
      const ballY = Y(ty - 1.8);

      if (ammoType === 'grenade') {
        // Grenade explosive militaire prête dans le godet
        ctx.fillStyle = '#15803d';
        ctx.beginPath();
        ctx.arc(ballX, ballY, bRad, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#052e16';
        ctx.lineWidth = 1.4 * this.dpr;
        ctx.stroke();
        // Mèche qui crépite
        ctx.fillStyle = Math.sin(performance.now() * 0.03) > 0 ? '#ef4444' : '#facc15';
        ctx.beginPath();
        ctx.arc(ballX, ballY - bRad - 1.2 * s, 1.2 * s, 0, Math.PI * 2);
        ctx.fill();
      } else if (ammoType === 'heavySpikeBall') {
        // Boulet d'acier à pointes acérées
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(ballX, ballY, bRad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#cbd5e1';
        for (let sp = 0; sp < 6; sp++) {
          const sa = (sp * Math.PI) / 3;
          ctx.beginPath();
          ctx.arc(ballX + Math.cos(sa) * bRad * 1.2, ballY + Math.sin(sa) * bRad * 1.2, 1 * s, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Boulet classique en pierre dorée polie avec reflet éclatant
        const bGrad = ctx.createRadialGradient(ballX - bRad * 0.35, ballY - bRad * 0.35, bRad * 0.1, ballX, ballY, bRad);
        bGrad.addColorStop(0, '#fef08a');
        bGrad.addColorStop(0.5, '#eab308');
        bGrad.addColorStop(1, '#854d0e');
        ctx.fillStyle = bGrad;
        ctx.beginPath();
        ctx.arc(ballX, ballY, bRad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.beginPath();
        ctx.arc(ballX - bRad * 0.3, ballY - bRad * 0.3, bRad * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Pivot central d'acier avec bague de serrage et clavette
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(X(px), Y(py), 2.2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.arc(X(px), Y(py), 1 * s, 0, Math.PI * 2);
    ctx.fill();

    // ====================================================================
    // INTERFACE BALISTIQUE DIRECTEMENT SUR LA CATAPULTE
    // ====================================================================
    if (isActive && alpha > 0.5 && aimInfo) {
      const arcR = 27 * s;
      const minRad = (8 * Math.PI) / 180;
      const maxRad = (82 * Math.PI) / 180;

      // 1. Arc-rapporteur balistique en laiton monté sur le pivot
      ctx.save();
      ctx.lineWidth = 2.4 * this.dpr;
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
      ctx.beginPath();
      if (!isRight) {
        ctx.arc(X(px), Y(py), arcR, -maxRad, -minRad, false);
      } else {
        ctx.arc(X(px), Y(py), arcR, Math.PI + minRad, Math.PI + maxRad, false);
      }
      ctx.stroke();

      // Graduations lumineuses tous les 15 degrés
      ctx.strokeStyle = '#facc15';
      ctx.fillStyle = '#fef08a';
      ctx.font = `800 ${Math.round(6.5 * this.dpr)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const majorAngles = [15, 30, 45, 60, 75];
      for (const deg of majorAngles) {
        const rad = (deg * Math.PI) / 180;
        const tickDirX = isRight ? -Math.cos(rad) : Math.cos(rad);
        const tickDirY = -Math.sin(rad);

        const x1 = X(px) + tickDirX * (arcR - 2.5 * s);
        const y1 = Y(py) + tickDirY * (arcR - 2.5 * s);
        const x2 = X(px) + tickDirX * (arcR + 2.5 * s);
        const y2 = Y(py) + tickDirY * (arcR + 2.5 * s);

        ctx.lineWidth = (deg === 45) ? 2 * this.dpr : 1.2 * this.dpr;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Afficher l'angle sur les repères clés (30°, 45°, 60°)
        if (deg === 30 || deg === 45 || deg === 60) {
          const txLabel = X(px) + tickDirX * (arcR + 6.5 * s);
          const tyLabel = Y(py) + tickDirY * (arcR + 6.5 * s);
          ctx.fillText(`${deg}°`, txLabel, tyLabel);
        }
      }

      // Poignée / Curseurs d'angle interactif sur l'arc
      const curRad = aimInfo.angle;
      const curDirX = isRight ? -Math.cos(curRad) : Math.cos(curRad);
      const curDirY = -Math.sin(curRad);
      const knobX = X(px) + curDirX * arcR;
      const knobY = Y(py) + curDirY * arcR;

      // Halo et bouton de préhension
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.8 * this.dpr;
      ctx.beginPath();
      ctx.arc(knobX, knobY, 4 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Guide balistique pointillé projeté vers le château
      const guideLen = 38 * s;
      const gx1 = X(LAUNCH_X);
      const gy1 = Y(LAUNCH_Y);
      const gx2 = gx1 + (isRight ? -Math.cos(curRad) : Math.cos(curRad)) * guideLen;
      const gy2 = gy1 - Math.sin(curRad) * guideLen;
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
      ctx.lineWidth = 1.8 * this.dpr;
      ctx.setLineDash([4 * this.dpr, 3 * this.dpr]);
      ctx.beginPath();
      ctx.moveTo(gx1, gy1);
      ctx.lineTo(gx2, gy2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(gx2, gy2, 2.5 * this.dpr, 0, Math.PI * 2);
      ctx.fill();

      // Flèche indicatrice au-dessus du bras
      const degText = `${((curRad * 180) / Math.PI).toFixed(1)}°`;
      const badgeX = X(tx) + (isRight ? -8 * s : 8 * s);
      const badgeY = Y(ty) - 8 * s;

      ctx.fillStyle = 'rgba(20, 14, 8, 0.88)';
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(badgeX - 16 * this.dpr, badgeY - 8 * this.dpr, 32 * this.dpr, 16 * this.dpr, 5 * this.dpr);
      } else {
        ctx.rect(badgeX - 16 * this.dpr, badgeY - 8 * this.dpr, 32 * this.dpr, 16 * this.dpr);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fef08a';
      ctx.font = `900 ${Math.round(8 * this.dpr)}px 'Courier New', monospace`;
      ctx.fillText(degText, badgeX, badgeY + 1 * this.dpr);

      // 2. Jauge dynamique de tension oscillante (quand on bande la catapulte)
      if (isCharging) {
        const pct = Math.round(chargePower * 100);
        const meterW = 28 * s;
        const meterH = 5 * s;
        const meterX = X(px) - meterW / 2;
        const meterY = Y(py - 24);

        // Fond du cadre de jauge
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5 * this.dpr;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(meterX, meterY, meterW, meterH, 4 * this.dpr);
        } else {
          ctx.rect(meterX, meterY, meterW, meterH);
        }
        ctx.fill();
        ctx.stroke();

        // Remplissage oscillant
        const fillW = Math.max(0, (meterW - 2 * this.dpr) * chargePower);
        const fillGrad = ctx.createLinearGradient(meterX, meterY, meterX + meterW, meterY);
        fillGrad.addColorStop(0, '#eab308');
        fillGrad.addColorStop(0.6, '#ea580c');
        fillGrad.addColorStop(1, '#ef4444');
        ctx.fillStyle = fillGrad;
        ctx.fillRect(meterX + 1 * this.dpr, meterY + 1 * this.dpr, fillW, meterH - 2 * this.dpr);

        // Texte pourcentage
        ctx.fillStyle = '#fff';
        ctx.font = `900 ${Math.round(8.5 * this.dpr)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`⚡ ${pct}%`, X(px), meterY - 4 * s);
      }

      ctx.restore();
    }

    // Élastique de visée balistique manuel (slingshot)
    if (slingPull) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.8 * this.dpr;
      ctx.setLineDash([4 * this.dpr, 4 * this.dpr]);
      ctx.beginPath();
      ctx.moveTo(X(LAUNCH_X), Y(LAUNCH_Y));
      ctx.lineTo(ox + slingPull.x * s, oy + slingPull.y * s);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Étiquette élégante gravée au sol pour repérer la catapulte
    if (isActive && alpha > 0.5) {
      ctx.font = `900 ${Math.round(8 * this.dpr)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fde047';
      ctx.fillText(isRight ? 'CATAPULTE DROITE (D)' : 'CATAPULTE GAUCHE (Q)', X(px), Y(GROUND_Y + 7));
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------- roi
  drawKing(king, color, t, highlight) {
    if (!king) return;
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const [cr, cg, cb] = hexToRgb(color);
    const dead = king.dead;
    const P = {
      Y: dead ? '#9a8f6a' : '#ffd13b',
      y: dead ? '#7c7356' : '#d49b16',
      S: dead ? '#b9b0a0' : '#f4cbb0',
      E: '#2b1d10',
      C: dead ? '#777' : color,
      c: dead ? '#555' : `rgb(${cr * 0.7 | 0},${cg * 0.7 | 0},${cb * 0.7 | 0})`,
      W: '#f7f3ea',
      D: '#4a3524',
    };
    const sprite = dead
      ? ['Y.Y.Y', 'yYyYy', 'SSSSS', 'EsEsE', 'CWWWC', 'CCcCC', 'cCCCc', 'D...D']
      : ['Y.Y.Y', 'YyYyY', 'SSSSS', 'SESES', 'CWWWC', 'CCcCC', 'cCCCc', '.D.D.'];
    for (let y = 0; y < KING_H; y++) {
      for (let x = 0; x < KING_W; x++) {
        let ch = sprite[y][x];
        if (ch === '.') continue;
        if (ch === 's') ch = 'S';
        ctx.fillStyle = P[ch];
        ctx.fillRect(Math.floor(ox + (king.x + x) * s), Math.floor(oy + (king.y + y) * s), Math.ceil(s), Math.ceil(s));
      }
    }
    if (!dead && Math.sin(t * 0.004) > 0.85) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(ox + (king.x + 2) * s, oy + (king.y + 1) * s, s * 0.6, s * 0.6);
    }

    // Jauge d'ensevelissement si du sable commence à lui tomber dessus !
    const maxHits = king.maxHits || 8;
    if (!dead && king.hits > 0) {
      const ratio = Math.min(1, king.hits / maxHits);
      const bw = 12 * s;
      const bh = 1.8 * s;
      const bx = ox + (king.x + KING_W / 2) * s - bw / 2;
      const by = oy + (king.y - 3.5) * s;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = ratio > 0.6 ? '#ef4444' : '#f59e0b';
      ctx.fillRect(bx, by, bw * (1 - ratio), bh);
    }

    if (highlight) {
      const bob = Math.sin(t * 0.006) * 1.5;
      const cx = ox + (king.x + KING_W / 2) * s;
      const ty = oy + (king.y - 5.5 + bob) * s;
      ctx.fillStyle = dead ? '#ef4444' : '#fff';
      ctx.beginPath();
      ctx.moveTo(cx - 2.3 * s, ty - 2.6 * s);
      ctx.lineTo(cx + 2.3 * s, ty - 2.6 * s);
      ctx.lineTo(cx, ty);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- monde complet
  drawWorld(world, { color = '#e4572e', t, highlightKing = false, showSafeZone = false }) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    this.paintSand(world);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.shadow, ox + 1.6 * s, oy + 0.9 * s, GRID_W * s, GRID_H * s);
    ctx.drawImage(this.sand, ox, oy, GRID_W * s, GRID_H * s);

    // Safe zone protégée du Roi pendant la phase de construction
    if (showSafeZone && world.king && !world.king.dead) {
      const k = world.king;
      const szX = ox + (k.x - 1) * s;
      const szY = oy + (k.y - 1) * s;
      const szW = (KING_W + 2) * s;
      const szH = (KING_H + 1) * s;
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.005);

      ctx.save();
      ctx.fillStyle = `rgba(251, 191, 36, ${0.12 + pulse * 0.08})`;
      ctx.fillRect(szX, szY, szW, szH);
      ctx.setLineDash([3 * this.dpr, 3 * this.dpr]);
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.6 + pulse * 0.3})`;
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.strokeRect(szX, szY, szW, szH);
      ctx.restore();
    }

    this.drawKing(world.king, color, t, highlightKing);

    // éjectas
    const p = world.parts;
    if (p.length) {
      ctx.fillStyle = '#e6c88e';
      for (let k = 0; k < p.length; k += 2) {
        ctx.fillRect(ox + (p[k] / 8) * s, oy + (p[k + 1] / 8) * s, s, s);
      }
    }
    // boulet
    const b = world.ballPosition(performance.now());
    if (b) {
      if (!this.trail || this.trail.pid !== world.pid) this.trail = { pid: world.pid, pts: [] };
      this.trail.pts.push({ x: b.x, y: b.y });
      if (this.trail.pts.length > 18) this.trail.pts.shift();
      for (let k = 0; k < this.trail.pts.length; k++) {
        const q = this.trail.pts[k];
        ctx.fillStyle = `rgba(240,220,170,${(k / this.trail.pts.length) * 0.38})`;
        ctx.beginPath();
        ctx.arc(ox + q.x * s, oy + q.y * s, b.r * s * (k / this.trail.pts.length) * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      const gx = ox + b.x * s;
      const gy = oy + b.y * s;
      const grad = ctx.createRadialGradient(gx - b.r * s * 0.4, gy - b.r * s * 0.4, b.r * s * 0.1, gx, gy, b.r * s);
      if (b.grenade) {
        // GRENADE MILITAIRE À MÈCHE / MINUTERIE RETARDÉE
        const grR = b.r * s;
        // Corps vert olive militaire
        ctx.fillStyle = '#14532d';
        ctx.beginPath();
        ctx.arc(gx, gy, grR, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.4 * this.dpr;
        ctx.strokeStyle = '#052e16';
        ctx.stroke();

        // Quadrillage de grenade quadrillée (ananas)
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 0.8 * this.dpr;
        ctx.beginPath();
        ctx.moveTo(gx - grR * 0.75, gy);
        ctx.lineTo(gx + grR * 0.75, gy);
        ctx.moveTo(gx, gy - grR * 0.75);
        ctx.lineTo(gx, gy + grR * 0.75);
        ctx.stroke();

        // Tête détonateur métallique
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(gx - 1.2 * s, gy - grR - 2.4 * s, 2.4 * s, 2.4 * s);
        // Goupille ronde dorée
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1 * this.dpr;
        ctx.beginPath();
        ctx.arc(gx + 2.2 * s, gy - grR - 1.4 * s, 1.2 * s, 0, Math.PI * 2);
        ctx.stroke();

        // Si la grenade a touché le sol (landed) : mèche qui crépite et décompte animé 2.0s
        if (b.landed) {
          const fuseTicks = b.fuseTicks || 0;
          const timeLeftSec = Math.max(0, (120 - fuseTicks) / 60).toFixed(1);
          const flash = Math.sin(t * 0.05) > 0;

          // Voyant LED rouge / étincelle clignotante
          ctx.fillStyle = flash ? '#ef4444' : '#fee2e2';
          ctx.beginPath();
          ctx.arc(gx, gy - grR - 3.2 * s, 1.6 * s, 0, Math.PI * 2);
          ctx.fill();

          // Fumée de mèche qui monte
          ctx.fillStyle = 'rgba(226, 232, 240, 0.65)';
          ctx.beginPath();
          ctx.arc(gx + Math.sin(t * 0.01) * 1.5 * s, gy - grR - (4 + Math.random() * 2) * s, 1.8 * s, 0, Math.PI * 2);
          ctx.fill();

          // Bulle compte à rebours au-dessus : "💣 1.8s"
          ctx.font = `900 ${Math.round(8.5 * this.dpr)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = flash ? '#ef4444' : '#facc15';
          ctx.fillText(`💣 ${timeLeftSec}s`, gx, gy - grR - 6.5 * s);
        }
      } else if (b.spike) {
        // Boulet d'acier lourd avec des pics acérés !
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(gx, gy, b.r * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.6 * this.dpr;
        ctx.strokeStyle = '#94a3b8';
        ctx.stroke();

        // Pics métalliques autour du boulet
        const spikeCount = 8;
        ctx.fillStyle = '#cbd5e1';
        for (let k = 0; k < spikeCount; k++) {
          const a = (k / spikeCount) * Math.PI * 2 + (b.age || 0) * 0.1;
          const sx1 = gx + Math.cos(a - 0.22) * b.r * s * 0.9;
          const sy1 = gy + Math.sin(a - 0.22) * b.r * s * 0.9;
          const sx2 = gx + Math.cos(a + 0.22) * b.r * s * 0.9;
          const sy2 = gy + Math.sin(a + 0.22) * b.r * s * 0.9;
          const tipX = gx + Math.cos(a) * b.r * s * 1.55;
          const tipY = gy + Math.sin(a) * b.r * s * 1.55;
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(tipX, tipY);
          ctx.lineTo(sx2, sy2);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        const grad = ctx.createRadialGradient(
          gx - b.r * s * 0.35, gy - b.r * s * 0.35, b.r * s * 0.15,
          gx, gy, b.r * s,
        );
        grad.addColorStop(0, '#fef08a');
        grad.addColorStop(0.5, '#eab308');
        grad.addColorStop(1, '#854d0e');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(gx, gy, b.r * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.8 * this.dpr;
        ctx.strokeStyle = '#451a03';
        ctx.stroke();

        // Reflet lumineux
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(gx - b.r * s * 0.35, gy - b.r * s * 0.35, b.r * s * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.trail) {
      this.trail = null;
    }
  }

  // ---------------------------------------------------------------- Inscriptions et runes des bonus gravées dans le sable
  drawActiveSandBonuses(bonuses, t) {
    if (!bonuses || !bonuses.length) return;
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const baseGroundY = oy + (GROUND_Y + 7.5) * s;
    const centerX = ox + 160 * s;

    ctx.save();
    const itemH = 15 * this.dpr;
    const padX = 10 * this.dpr;
    const fontSize = Math.max(10, Math.round(9.5 * this.dpr));
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const totalW = bonuses.reduce((acc, b) => {
      const textMetrics = ctx.measureText(`${b.icon} ${b.label}`);
      return acc + textMetrics.width + padX * 2 + 10 * this.dpr;
    }, -10 * this.dpr);

    let curX = centerX - totalW / 2;
    const curY = baseGroundY;

    for (const b of bonuses) {
      const fullText = `${b.icon} ${b.label}`;
      const textW = ctx.measureText(fullText).width;
      const cardW = textW + padX * 2;
      const cardX = curX;
      const cardY = curY;
      const r = 5 * this.dpr;

      // 1. Dépression creusée dans le sable (ombre supérieure et biseau lumineux inférieur)
      ctx.fillStyle = 'rgba(120, 75, 25, 0.22)';
      ctx.beginPath();
      ctx.roundRect(cardX, cardY - itemH / 2, cardW, itemH, r);
      ctx.fill();

      // Biseau de soleil sur le bord inférieur (effet de relief de sillon gravé dans le sable)
      ctx.strokeStyle = 'rgba(255, 245, 210, 0.55)';
      ctx.lineWidth = 1 * this.dpr;
      ctx.beginPath();
      ctx.roundRect(cardX, cardY - itemH / 2 + 1, cardW, itemH, r);
      ctx.stroke();

      // Ombre creuse intérieure
      ctx.strokeStyle = 'rgba(70, 38, 10, 0.45)';
      ctx.beginPath();
      ctx.roundRect(cardX, cardY - itemH / 2, cardW, itemH, r);
      ctx.stroke();

      // 2. Texte gravé en creux dans le sable :
      const tx = cardX + cardW / 2;
      const ty = cardY;

      // Ombre portée profonde au fond du sillon
      ctx.fillStyle = 'rgba(60, 32, 10, 0.75)';
      ctx.fillText(fullText, tx + 0.8 * this.dpr, ty + 0.8 * this.dpr);

      // Reflet clair de la crête du sable
      ctx.fillStyle = 'rgba(255, 250, 230, 0.85)';
      ctx.fillText(fullText, tx - 0.5 * this.dpr, ty - 0.5 * this.dpr);

      // Teinte principale gravée (or/sable cuivré vibrant)
      ctx.fillStyle = b.color || '#9a5e24';
      ctx.fillText(fullText, tx, ty);

      // Petite étincelle runique pulsante
      const sparkleA = Math.sin(t * 0.005 + cardX * 0.1) * 0.5 + 0.5;
      if (sparkleA > 0.4) {
        ctx.fillStyle = `rgba(254, 240, 138, ${sparkleA})`;
        ctx.beginPath();
        const sx = cardX + cardW - 4 * this.dpr;
        const sy = cardY - itemH / 2 + 3 * this.dpr;
        ctx.arc(sx, sy, 1.5 * this.dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      curX += cardW + 10 * this.dpr;
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------- Caisses de bonus parachutées (Party Game)
  // ---------------------------------------------------------------- Caisses de bonus parachutées (Arrière-plan marin)
  drawDrops(drops, t) {
    if (!drops || !drops.length) return;
    const { ctx } = this;
    const { s, ox, oy } = this.view;

    for (const d of drops) {
      if (d.collected || d.sunk) continue;
      const inWater = !!d.inWater;
      const waterBob = inWater ? Math.sin(t * 0.005 + d.x * 0.6) * 1.5 * s : 0;
      const cx = ox + d.x * s;
      const cy = oy + (d.y * s) + waterBob;

      ctx.save();

      if (!inWater) {
        // En vol : balancement très doux et naturel avec le vent en arrière-plan
        const sway = Math.sin(t * 0.0025 + d.x * 0.3) * 0.09;
        ctx.translate(cx, cy);
        ctx.rotate(sway);

        const chuteW = 8.5 * s;
        const chuteH = 5.5 * s;
        const chuteY = -9.5 * s;
        const ringY = -1.8 * s;

        // 1) Suspentes fines en soie - 100% symétriques autour de x = 0
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = Math.max(1, 0.75 * this.dpr);
        ctx.beginPath();
        // 4 suspentes reliant les festons du dôme à l'anneau central
        ctx.moveTo(-chuteW, chuteY);
        ctx.lineTo(0, ringY);
        ctx.moveTo(-chuteW * 0.33, chuteY);
        ctx.lineTo(0, ringY);
        ctx.moveTo(chuteW * 0.33, chuteY);
        ctx.lineTo(0, ringY);
        ctx.moveTo(chuteW, chuteY);
        ctx.lineTo(0, ringY);
        ctx.stroke();

        // Anneau de suspension métallique au centre
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(0, ringY, 0.8 * s, 0, Math.PI * 2);
        ctx.fill();

        // 2) Toile du parachute 100% symétrique avec festons découpés au bas
        const primaryColor = d.type === 'grenade' ? '#15803d' : d.type === 'heavySpikeBall' ? '#475569' : d.type === 'dryOpponent' ? '#ea580c' : d.type === 'wetAll' ? '#0284c7' : '#dc2626';
        const stripeColor = '#fef08a';

        // Contour du dôme hémisphérique symétrique avec festons au bord inférieur
        ctx.beginPath();
        // Demi-ellipse supérieure de -chuteW à +chuteW passant par (0, chuteY - chuteH)
        ctx.ellipse(0, chuteY, chuteW, chuteH, 0, Math.PI, 0, false);
        // Festons symétriques du bas (3 festons : droite, centre, gauche)
        // 1. Feston droit : de +chuteW à +chuteW * 0.33
        ctx.quadraticCurveTo(chuteW * 0.66, chuteY - 0.7 * s, chuteW * 0.33, chuteY);
        // 2. Feston central : de +chuteW * 0.33 à -chuteW * 0.33
        ctx.quadraticCurveTo(0, chuteY - 0.7 * s, -chuteW * 0.33, chuteY);
        // 3. Feston gauche : de -chuteW * 0.33 à -chuteW
        ctx.quadraticCurveTo(-chuteW * 0.66, chuteY - 0.7 * s, -chuteW, chuteY);
        ctx.closePath();

        // Dégradé radial centré sur l'axe x=0
        const canopyGrad = ctx.createRadialGradient(0, chuteY - chuteH * 0.3, 0.8 * s, 0, chuteY, chuteW);
        canopyGrad.addColorStop(0, '#ffffff');
        canopyGrad.addColorStop(0.38, primaryColor);
        canopyGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = canopyGrad;
        ctx.fill();

        // Fuseau central à rayures jaune/doré parfaitement symétrique
        ctx.fillStyle = stripeColor;
        ctx.beginPath();
        ctx.moveTo(0, chuteY - chuteH);
        ctx.quadraticCurveTo(chuteW * 0.18, chuteY - chuteH * 0.3, chuteW * 0.33, chuteY);
        ctx.quadraticCurveTo(0, chuteY - 0.7 * s, -chuteW * 0.33, chuteY);
        ctx.quadraticCurveTo(-chuteW * 0.18, chuteY - chuteH * 0.3, 0, chuteY - chuteH);
        ctx.closePath();
        ctx.fill();

        // Petit chapeau / évent d'aération au sommet du dôme
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.ellipse(0, chuteY - chuteH, 1.8 * s, 0.7 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        // Coutures symétriques des fuseaux
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.38)';
        ctx.lineWidth = Math.max(1, 0.8 * this.dpr);
        ctx.beginPath();
        ctx.moveTo(0, chuteY - chuteH);
        ctx.quadraticCurveTo(chuteW * 0.18, chuteY - chuteH * 0.3, chuteW * 0.33, chuteY);
        ctx.moveTo(0, chuteY - chuteH);
        ctx.quadraticCurveTo(-chuteW * 0.18, chuteY - chuteH * 0.3, -chuteW * 0.33, chuteY);
        ctx.stroke();

        this._drawCrate(0, 0.5 * s, s, d.type);
      } else {
        // Dans l'eau au milieu de la mer (immersion douce)
        ctx.translate(cx, cy);

        // Parachute dégonflé flottant sur l'eau
        ctx.save();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.beginPath();
        ctx.ellipse(-5 * s, 1.2 * s, 5.5 * s, 1.8 * s, -0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Ondulations d'eau autour de la caisse
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = Math.max(1, 1 * this.dpr);
        ctx.beginPath();
        ctx.ellipse(0, 2.2 * s, 5.5 * s, 1.5 * s, 0, 0, Math.PI * 2);
        ctx.stroke();

        this._drawCrate(0, 0.5 * s, s, d.type);

        // Petites bulles d'eau discrètes
        ctx.fillStyle = 'rgba(224, 242, 254, 0.8)';
        ctx.beginPath();
        ctx.arc(-2 * s, -2.5 * s, 0.8 * s, 0, Math.PI * 2);
        ctx.arc(2.5 * s, -3.2 * s, 0.6 * s, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  _drawCrate(x, y, s, type) {
    const { ctx } = this;
    const size = 5.6 * s;
    const r = 1.2 * s;

    // Ombre sous la caisse
    ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y + size * 0.52, size * 0.55, size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Fond bois noble de la caisse
    const crateGrad = ctx.createLinearGradient(x - size * 0.5, y - size * 0.5, x + size * 0.5, y + size * 0.5);
    if (type === 'grenade') {
      crateGrad.addColorStop(0, '#15803d');
      crateGrad.addColorStop(1, '#052e16');
    } else if (type === 'heavySpikeBall') {
      crateGrad.addColorStop(0, '#64748b');
      crateGrad.addColorStop(1, '#334155');
    } else if (type === 'dryOpponent') {
      crateGrad.addColorStop(0, '#d97706');
      crateGrad.addColorStop(1, '#92400e');
    } else if (type === 'wetAll') {
      crateGrad.addColorStop(0, '#0284c7');
      crateGrad.addColorStop(1, '#075985');
    } else {
      crateGrad.addColorStop(0, '#b45309');
      crateGrad.addColorStop(1, '#78350f');
    }
    ctx.fillStyle = crateGrad;

    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x - size * 0.5, y - size * 0.5, size, size, r);
    } else {
      ctx.rect(x - size * 0.5, y - size * 0.5, size, size);
    }
    ctx.fill();

    // Sangles de cargaison croisées
    ctx.strokeStyle = 'rgba(254, 240, 138, 0.85)';
    ctx.lineWidth = Math.max(1, 0.9 * this.dpr);
    ctx.beginPath();
    // Sangle verticale
    ctx.moveTo(x, y - size * 0.5);
    ctx.lineTo(x, y + size * 0.5);
    // Sangle horizontale
    ctx.moveTo(x - size * 0.5, y);
    ctx.lineTo(x + size * 0.5, y);
    ctx.stroke();

    // Coins métalliques
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = Math.max(1, 0.8 * this.dpr);
    ctx.strokeRect(x - size * 0.5, y - size * 0.5, size, size);

    // Icône discrète
    const icon = type === 'grenade' ? '💣' : type === 'heavySpikeBall' ? '💣' : type === 'dryOpponent' ? '☀️' : type === 'wetAll' ? '💦' : '☄️';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(7, Math.round(4.5 * s))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x, y);
  }

  // ---------------------------------------------------------------- effets (poussière, gouttes d'eau, popups)
  puff(x, y, r, n = 14, color = '235,215,170') {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.02 + Math.random() * 0.06;
      this.fx.push({
        x, y, vx: Math.cos(a) * sp * r, vy: Math.sin(a) * sp * r * 0.6 - 0.05, r: r * (0.3 + Math.random() * 0.4), life: 1, decay: 0.014 + Math.random() * 0.01, color,
      });
    }
  }

  waterMist(x, y, radius = SPRAY_RADIUS) {
    // 1) Grand nuage de brume vaporeuse
    this.fx.push({
      x, y, vx: 0, vy: -0.04, r: radius * 1.35, life: 1, decay: 0.038, color: '180, 230, 255', isMist: true,
    });
    this.fx.push({
      x: x + (Math.random() - 0.5) * 4, y: y - 2, vx: 0, vy: -0.06, r: radius * 0.95, life: 0.9, decay: 0.042, color: '210, 245, 255', isMist: true,
    });
    // 2) Micro-gouttelettes d'eau pulvérisées
    for (let k = 0; k < 48; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * radius;
      const sp = 0.08 + Math.random() * 0.24;
      this.fx.push({
        x: x + Math.cos(a) * d * 0.5,
        y: y + Math.sin(a) * d * 0.5,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.16,
        r: 0.75 + Math.random() * 1.6,
        life: 1,
        decay: 0.018 + Math.random() * 0.016,
        color: Math.random() > 0.35 ? '64, 196, 235' : '225, 248, 255',
        isDroplet: true,
      });
    }
  }

  popup(x, y, text, color = '#fff') {
    this.popups.push({ x, y, text, color, life: 1 });
  }

  drawFx(dt) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const f = dt / 16.7;
    let w = 0;
    for (const p of this.fx) {
      p.x += p.vx * f;
      p.y += p.vy * f;
      if (p.isDroplet) {
        p.vy += 0.012 * f; // gravité sur les gouttelettes d'eau
        p.vx *= 0.97;
      } else {
        p.vx *= 0.96;
        p.vy = p.vy * 0.96 - 0.003 * f;
      }
      p.r *= 1 + (p.isMist ? 0.018 : 0.006) * f;
      p.life -= p.decay * f;
      if (p.life <= 0) continue;
      this.fx[w++] = p;

      const px = ox + p.x * s;
      const py = oy + p.y * s;
      const pr = p.r * s;
      if (p.isMist) {
        const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
        g.addColorStop(0, `rgba(${p.color},${p.life * 0.42})`);
        g.addColorStop(0.65, `rgba(${p.color},${p.life * 0.22})`);
        g.addColorStop(1, `rgba(${p.color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(${p.color},${p.life * (p.isDroplet ? 0.85 : 0.55)})`;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.fx.length = w;

    // Textes flottants (popups)
    let pw = 0;
    ctx.save();
    ctx.font = `800 ${Math.round(13 * this.dpr)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    for (const pop of this.popups) {
      pop.y -= 0.18 * f;
      pop.life -= 0.018 * f;
      if (pop.life <= 0) continue;
      this.popups[pw++] = pop;
      const sx = ox + pop.x * s;
      const sy = oy + pop.y * s;
      ctx.globalAlpha = Math.min(1, pop.life * 1.3);
      ctx.strokeStyle = 'rgba(30,20,10,0.75)';
      ctx.lineWidth = 3 * this.dpr;
      ctx.strokeText(pop.text, sx, sy);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, sx, sy);
    }
    this.popups.length = pw;

    // Rendu des seaux, des mains sculptantes et des retours rouges
    this.drawPouringBuckets(performance.now());
    this.drawHandScoops(performance.now());
    this.drawRedFlashes(performance.now());

    // Effet de flash d'écran (pour les bonus légendaires)
    if (this.flashLife > 0) {
      this.flashLife -= 0.025 * f;
      ctx.save();
      ctx.fillStyle = this.flashColor;
      ctx.globalAlpha = Math.max(0, Math.min(0.55, this.flashLife * 0.55));
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
  }

  // Bonus Légendaire : Déluge Divin
  triggerDelugeFX() {
    this.shake = 16;
    this.flashColor = '#38bdf8';
    this.flashLife = 1.0;
    for (let i = 0; i < 90; i++) {
      const x = BUILD_MIN_X + Math.random() * (BUILD_MAX_X - BUILD_MIN_X);
      const y = Math.random() * (GROUND_Y - 30);
      this.fx.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 0.4,
        vy: 0.25 + Math.random() * 0.6,
        r: 1.2 + Math.random() * 2.2,
        life: 1.2,
        decay: 0.012 + Math.random() * 0.01,
        color: Math.random() > 0.4 ? '56, 189, 248' : '224, 242, 254',
        isDroplet: true,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.waterMist(BUILD_MIN_X + (i / 5) * (BUILD_MAX_X - BUILD_MIN_X), GROUND_Y - 20, 24);
    }
    this.popup(210, 80, '🌊 DÉLUGE BÉNI : CHÂTEAU FORTIFIÉ !', '#38bdf8');
  }

  // Bonus Légendaire : Sécheresse Apocalyptique
  triggerSolarStormFX() {
    this.shake = 22;
    this.flashColor = '#f59e0b';
    this.flashLife = 1.1;
    for (let i = 0; i < 110; i++) {
      const x = BUILD_MIN_X + Math.random() * (BUILD_MAX_X - BUILD_MIN_X);
      const y = GROUND_Y - Math.random() * 60;
      this.fx.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -0.2 - Math.random() * 0.8,
        r: 1.5 + Math.random() * 2.5,
        life: 1.1,
        decay: 0.014 + Math.random() * 0.012,
        color: Math.random() > 0.3 ? '245, 158, 11' : '254, 240, 138',
      });
    }
    this.popup(210, 80, '☀️ SÉCHERESSE APOCALYPTIQUE : CHÂTEAU ASSÉCHÉ !', '#f59e0b');
  }

  addPouringBucket(x, y, color = '#38bdf8') {
    this.pouringBuckets.push({
      x,
      y,
      start: performance.now(),
      duration: 3000,
      color: color || '#38bdf8',
    });
  }

  drawPouringBuckets(now) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    let w = 0;
    for (let i = 0; i < this.pouringBuckets.length; i++) {
      const b = this.pouringBuckets[i];
      const elapsed = now - b.start;
      const p = elapsed / b.duration;
      if (p >= 1) continue;
      this.pouringBuckets[w++] = b;

      const targetX = ox + b.x * s;
      const targetY = oy + b.y * s;

      let angle = 0;
      let alpha = 1;
      let offsetY = -28 * s;
      let offsetX = -10 * s;

      if (p < 0.28) {
        const t = p / 0.28;
        const ease = 1 - Math.pow(1 - t, 3);
        angle = ease * 1.15; // incline jusqu'à ~66°
        alpha = Math.min(1, t * 1.5);
        offsetY = (-38 + ease * 12) * s;
        offsetX = (-16 + ease * 8) * s;
      } else if (p < 0.78) {
        angle = 1.15 + Math.sin((p - 0.28) * 20) * 0.05;
        offsetY = -26 * s;
        offsetX = -8 * s;
      } else {
        const t = (p - 0.78) / 0.22;
        angle = 1.15 * (1 - t);
        alpha = 1 - t;
        offsetY = (-26 - t * 10) * s;
        offsetX = -8 * s;
      }

      const bx = targetX + offsetX;
      const by = targetY + offsetY;

      ctx.save();
      ctx.globalAlpha = alpha;

      // 1. Coulée de sable mouillé quand le seau est penché
      if (p >= 0.20 && p <= 0.82) {
        const pourStrength = Math.sin(((p - 0.20) / 0.62) * Math.PI);
        const lipX = bx + Math.cos(angle) * (6 * s) + Math.sin(angle) * (10 * s);
        const lipY = by + Math.sin(angle) * (6 * s) - Math.cos(angle) * (2 * s);

        ctx.save();
        const grad = ctx.createLinearGradient(lipX, lipY, targetX, targetY);
        grad.addColorStop(0, '#fef08a');
        grad.addColorStop(0.35, '#facc15');
        grad.addColorStop(0.8, '#eab308');
        grad.addColorStop(1, '#ca8a04');

        ctx.fillStyle = grad;
        ctx.beginPath();
        const beamW = (3.5 + pourStrength * 3.5) * s;
        ctx.moveTo(lipX - 2 * s, lipY);
        ctx.lineTo(lipX + 3 * s, lipY + 1 * s);
        ctx.lineTo(targetX + beamW, targetY);
        ctx.lineTo(targetX - beamW, targetY);
        ctx.closePath();
        ctx.fill();

        // Grains de sable animés qui chutent le long de la coulée
        ctx.fillStyle = '#fef08a';
        for (let g = 0; g < 5; g++) {
          const gt = ((now * 0.006 + g * 0.24) % 1);
          const gx = lipX + (targetX - lipX) * gt + (Math.sin(g * 5 + now * 0.01) * 3 * s);
          const gy = lipY + (targetY - lipY) * gt;
          ctx.beginPath();
          ctx.arc(gx, gy, (1.2 + g % 2) * s, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 2. Bras & Mains tenant le seau
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(angle);

      // Bras gauche (manche / anse)
      ctx.fillStyle = '#f4cbb0';
      ctx.beginPath();
      ctx.ellipse(-14 * s, -6 * s, 5 * s, 3.2 * s, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.ellipse(-19 * s, -9 * s, 4.5 * s, 3.8 * s, 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Bras droit (soutient le fond du seau penché)
      ctx.fillStyle = '#f4cbb0';
      ctx.beginPath();
      ctx.ellipse(9 * s, 10 * s, 4.5 * s, 3 * s, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.ellipse(14 * s, 14 * s, 4.2 * s, 3.5 * s, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // 3. Corps du seau
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(0, -6 * s, 9 * s, Math.PI * 0.85, Math.PI * 2.15);
      ctx.stroke();

      const bGrad = ctx.createLinearGradient(-8 * s, -6 * s, 8 * s, 10 * s);
      bGrad.addColorStop(0, '#38bdf8');
      bGrad.addColorStop(0.55, '#0284c7');
      bGrad.addColorStop(1, '#0369a1');

      ctx.fillStyle = bGrad;
      ctx.strokeStyle = '#082f49';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(-9 * s, -4 * s);
      ctx.lineTo(9 * s, -4 * s);
      ctx.lineTo(6.5 * s, 11 * s);
      ctx.lineTo(-6.5 * s, 11 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Rebord supérieur extérieur
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.ellipse(0, -4 * s, 9.5 * s, 2.8 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Intérieur du seau avec sable qui se vide
      if (p < 0.6) {
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.ellipse(0, -4 * s, 7.5 * s, 2 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      ctx.restore();
    }
    this.pouringBuckets.length = w;
  }

  // ---------------------------------------------------------------- main sculptante animée (pâté 0.8s)
  addHandScoop(x, y, color = '#38bdf8') {
    this.handScoops.push({
      x,
      y,
      start: performance.now(),
      duration: 800,
      color: color || '#38bdf8',
    });
  }

  drawHandScoops(now) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    let w = 0;
    for (let i = 0; i < this.handScoops.length; i++) {
      const h = this.handScoops[i];
      const elapsed = now - h.start;
      const p = elapsed / h.duration;
      if (p >= 1) continue;
      this.handScoops[w++] = h;

      const targetX = ox + h.x * s;
      const targetY = oy + h.y * s;

      let lift = 0;
      let alpha = 1;
      let tap = 0;

      if (p < 0.3) {
        const t = p / 0.3;
        lift = (1 - t) * 18 * s;
        alpha = Math.min(1, t * 2);
      } else if (p < 0.7) {
        const t = (p - 0.3) / 0.4;
        tap = Math.sin(t * Math.PI * 4) * 3.5 * s;
      } else {
        const t = (p - 0.7) / 0.3;
        lift = t * 24 * s;
        alpha = 1 - t;
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      const hx = targetX + 4 * s;
      const hy = targetY - 6 * s - lift + tap;

      ctx.fillStyle = h.color;
      ctx.beginPath();
      ctx.ellipse(hx + 14 * s, hy - 14 * s, 6 * s, 4 * s, -0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f4cbb0';
      ctx.beginPath();
      ctx.ellipse(hx + 9 * s, hy - 9 * s, 5 * s, 3.5 * s, -0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e8be9e';
      ctx.beginPath();
      ctx.ellipse(hx, hy, 5.5 * s, 4 * s, -0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#dbb090';
      for (let f = 0; f < 4; f++) {
        ctx.beginPath();
        ctx.arc(hx - 3 * s + f * 2.2 * s, hy + 2.5 * s, 1.8 * s, 0, Math.PI * 2);
        ctx.fill();
      }

      if (p >= 0.3 && p <= 0.7 && Math.abs(tap) > 1.8 * s) {
        ctx.fillStyle = '#fde047';
        for (let g = 0; g < 4; g++) {
          const gx = targetX + (Math.sin(g * 2.3 + now * 0.05) * 5 * s);
          const gy = targetY - (g * 1.2 * s);
          ctx.beginPath();
          ctx.arc(gx, gy, 0.9 * s, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }
    this.handScoops.length = w;
  }

  // ---------------------------------------------------------------- retour visuel rouge (pose invalide)
  quickRedFlash(x, y, w = 10, h = 8) {
    this.redFlashes.push({
      x,
      y,
      w,
      h,
      start: performance.now(),
      duration: 450,
    });
  }

  drawRedFlashes(now) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    let w = 0;
    for (let i = 0; i < this.redFlashes.length; i++) {
      const f = this.redFlashes[i];
      const elapsed = now - f.start;
      const p = elapsed / f.duration;
      if (p >= 1) continue;
      this.redFlashes[w++] = f;

      const alpha = (1 - p);
      const rx = ox + f.x * s;
      const ry = oy + f.y * s;
      const rw = f.w * s;
      const rh = f.h * s;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.8 * this.dpr;
      ctx.strokeRect(rx, ry, rw, rh);

      const cx = rx + rw / 2;
      const cy = ry + rh / 2;
      const cr = Math.min(rw, rh) * 0.35;
      ctx.beginPath();
      ctx.moveTo(cx - cr, cy - cr);
      ctx.lineTo(cx + cr, cy + cr);
      ctx.moveTo(cx + cr, cy - cr);
      ctx.lineTo(cx - cr, cy + cr);
      ctx.stroke();

      ctx.restore();
    }
    this.redFlashes.length = w;
  }

  // ---------------------------------------------------------------- seau de plage animé
  drawBeachBucket(placeCooldownRatio, now) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;

    // Position sur le sable entre la catapulte gauche et la zone de château (BUILD_MIN_X = 85)
    const bx = 56;
    const by = GROUND_Y;
    const sx = ox + bx * s;
    const sy = oy + by * s;

    const fillRatio = Math.min(1.0, Math.max(0.08, placeCooldownRatio));
    const isReady = placeCooldownRatio >= 1.0;

    ctx.save();

    // 1. Ombre portée sur le sable chaud
    ctx.fillStyle = 'rgba(44, 30, 18, 0.28)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 11 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Anse du seau en arrière-plan
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.8 * s;
    ctx.beginPath();
    ctx.arc(sx, sy - 8 * s, 8.5 * s, Math.PI * 0.9, Math.PI * 2.1);
    ctx.stroke();

    // 3. Corps du seau posé sur le sable
    const bucketGrad = ctx.createLinearGradient(sx - 8 * s, sy - 14 * s, sx + 8 * s, sy);
    bucketGrad.addColorStop(0, '#38bdf8');
    bucketGrad.addColorStop(0.5, '#0284c7');
    bucketGrad.addColorStop(1, '#075985');

    ctx.fillStyle = bucketGrad;
    ctx.strokeStyle = '#0c4a6e';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.moveTo(sx - 8.5 * s, sy - 14 * s);
    ctx.lineTo(sx + 8.5 * s, sy - 14 * s);
    ctx.lineTo(sx + 6.2 * s, sy - 1 * s);
    ctx.lineTo(sx - 6.2 * s, sy - 1 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Liseré brillant vertical sur le flanc
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(sx - 5.5 * s, sy - 13 * s);
    ctx.lineTo(sx - 3.5 * s, sy - 13 * s);
    ctx.lineTo(sx - 2.8 * s, sy - 2 * s);
    ctx.lineTo(sx - 4.5 * s, sy - 2 * s);
    ctx.closePath();
    ctx.fill();

    // 4. Contenu de sable qui monte à l'intérieur
    const sandHeight = fillRatio * 11 * s;
    const sandTopY = sy - 3 * s - sandHeight;

    const sandGrad = ctx.createLinearGradient(sx, sandTopY, sx, sy);
    sandGrad.addColorStop(0, '#fef08a');
    sandGrad.addColorStop(0.5, '#eab308');
    sandGrad.addColorStop(1, '#ca8a04');

    ctx.save();
    // Clip à l'intérieur du seau
    ctx.beginPath();
    ctx.moveTo(sx - 8 * s, sy - 13.5 * s);
    ctx.lineTo(sx + 8 * s, sy - 13.5 * s);
    ctx.lineTo(sx + 6 * s, sy - 1.5 * s);
    ctx.lineTo(sx - 6 * s, sy - 1.5 * s);
    ctx.closePath();
    ctx.clip();

    ctx.fillStyle = sandGrad;
    ctx.fillRect(sx - 9 * s, sandTopY, 18 * s, sy - sandTopY + 2 * s);
    ctx.restore();

    // 5. Rebord supérieur du seau
    ctx.fillStyle = '#0284c7';
    ctx.strokeStyle = '#0c4a6e';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.ellipse(sx, sy - 14 * s, 8.8 * s, 2.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 6. Si le seau est en plein remplissage (< 1.0) : pelle animée qui verse du sable
    if (!isReady) {
      const shovelBob = Math.sin(now * 0.008) * 1.5 * s;
      const shX = sx + 7 * s;
      const shY = sy - 20 * s + shovelBob;

      // Petite pelle / cuillère en bois
      ctx.save();
      ctx.translate(shX, shY);
      ctx.rotate(-0.4);
      ctx.fillStyle = '#b45309';
      ctx.fillRect(-2 * s, -12 * s, 3 * s, 12 * s);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5 * s, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#fde047';
      ctx.fillRect(-3 * s, -1 * s, 6 * s, 3 * s);
      ctx.restore();

      // Filet de sable tombant de la pelle dans le seau
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.moveTo(shX - 2 * s, shY + 2 * s);
      ctx.lineTo(shX + 1 * s, shY + 2 * s);
      ctx.lineTo(sx + 1 * s, sandTopY);
      ctx.lineTo(sx - 1 * s, sandTopY);
      ctx.closePath();
      ctx.fill();

      // Grains qui éclaboussent à l'arrivée dans le seau
      const sparkT = (now * 0.01) % (Math.PI * 2);
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(sx + Math.cos(sparkT) * 3 * s, sandTopY - 1 * s, 1.2 * s, 0, Math.PI * 2);
      ctx.arc(sx + Math.sin(sparkT) * 2.5 * s, sandTopY - 2 * s, 1 * s, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 7. Si le seau est PLEIN (100%) : Dôme de sable bombé + petit drapeau victorieux
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 14 * s, 7.5 * s, 3.8 * s, 0, Math.PI, Math.PI * 2);
      ctx.fill();

      // Petit drapeau rouge sur cure-dent
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 15 * s);
      ctx.lineTo(sx, sy - 24 * s);
      ctx.stroke();

      // Fanion triangulaire rouge qui flotte au vent
      const flap = Math.sin(now * 0.007) * 1.5 * s;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 24 * s);
      ctx.lineTo(sx + 7 * s + flap, sy - 21 * s);
      ctx.lineTo(sx, sy - 18 * s);
      ctx.closePath();
      ctx.fill();

      // Étoiles de brillance scintillantes
      const starPhase = (now * 0.005) % 1;
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(8 * this.dpr)}px sans-serif`;
      ctx.fillText('✨', sx - 11 * s, sy - 18 * s - starPhase * 4 * s);
    }

    // Badge textuel sous le seau
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.round(8.5 * this.dpr)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    if (isReady) {
      ctx.fillStyle = '#166534';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5 * this.dpr;
      ctx.strokeText('SEAU PRÊT', sx, sy + 7 * s);
      ctx.fillStyle = '#22c55e';
      ctx.fillText('SEAU PRÊT', sx, sy + 7 * s);
    } else {
      const pct = Math.round(fillRatio * 100);
      ctx.fillStyle = '#78350f';
      ctx.fillText(`${pct}%`, sx, sy + 7 * s);
    }

    ctx.restore();
  }

  drawGhost(shape, pos, ok, isKing = false, cooldownRatio = 1.0, playerColor = '#e4572e') {
    if (!pos) return;
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    ctx.save();

    // Rendu haute fidélité du Roi avec texture officielle pixel-art et couleur du joueur
    if (isKing) {
      ctx.globalAlpha = ok ? 0.88 : 0.42;
      this.drawKing({ x: pos.left, y: pos.top }, playerColor, performance.now(), true);
      ctx.restore();
      return;
    }

    const isCooling = cooldownRatio < 1.0;
    ctx.fillStyle = !ok
      ? 'rgba(239, 68, 68, 0.5)'
      : isCooling
        ? 'rgba(234, 179, 8, 0.35)'
        : 'rgba(255, 255, 255, 0.48)';
    const { w, h, mask } = shape;
    for (let y = 0; y < h; y++) {
      let run = -1;
      for (let x = 0; x <= w; x++) {
        const on = x < w && mask[y * w + x];
        if (on && run < 0) run = x;
        if (!on && run >= 0) {
          ctx.fillRect(ox + (pos.left + run) * s, oy + (pos.top + y) * s, (x - run) * s, s + 0.5);
          run = -1;
        }
      }
    }

    // Animation du seau qui se remplit au-dessus du motif
    if (isCooling) {
      const bx = ox + (pos.left + w / 2) * s;
      const by = oy + (pos.top - 14) * s;
      const bw = 16 * this.dpr;
      const bh = 14 * this.dpr;

      ctx.save();
      // Cadre seau
      ctx.fillStyle = 'rgba(2, 132, 199, 0.85)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(bx - bw / 2, by - bh / 2);
      ctx.lineTo(bx + bw / 2, by - bh / 2);
      ctx.lineTo(bx + bw * 0.35, by + bh / 2);
      ctx.lineTo(bx - bw * 0.35, by + bh / 2);
      ctx.closePath();
      ctx.stroke();

      // Sable qui monte à l'intérieur
      ctx.save();
      ctx.clip();
      const fillH = bh * cooldownRatio;
      ctx.fillStyle = '#facc15';
      ctx.fillRect(bx - bw / 2, by + bh / 2 - fillH, bw, fillH);
      ctx.restore();

      // Anse du seau
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.beginPath();
      ctx.arc(bx, by - bh / 2, bw * 0.4, Math.PI, 0);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }

  drawGhostCastle(world, color, name) {
    if (!world || !world.cells) return;
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const cells = world.cells;
    const [cr, cg, cb] = hexToRgb(color);

    // Optimisation haute performance : rendu hors-écran mis en cache, recalculé UNIQUEMENT quand world.version change
    if (!world._ghostCanvas || world._ghostVersion !== world.version) {
      if (!world._ghostCanvas) {
        world._ghostCanvas = document.createElement('canvas');
        world._ghostCanvas.width = GRID_W;
        world._ghostCanvas.height = GROUND_Y;
      }
      const gCtx = world._ghostCanvas.getContext('2d');
      gCtx.clearRect(0, 0, GRID_W, GROUND_Y);
      const imgData = gCtx.createImageData(GRID_W, GROUND_Y);
      const data = imgData.data;
      for (let y = 0; y < GROUND_Y; y++) {
        const row = y * GRID_W;
        for (let x = 0; x < GRID_W; x++) {
          const type = cells[row + x] & TYPE_MASK;
          if (type !== 0 && type !== 1 && type !== 5) {
            const idx = (y * GRID_W + x) * 4;
            data[idx] = cr;
            data[idx + 1] = cg;
            data[idx + 2] = cb;
            data[idx + 3] = 160;
          }
        }
      }
      gCtx.putImageData(imgData, 0, 0);
      world._ghostVersion = world.version;
    }

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(world._ghostCanvas, ox, oy, GRID_W * s, GROUND_Y * s);

    // Roi fantôme de l'autre joueur avec opacité très basse (0.14) et cercle en tirets pour ne JAMAIS le confondre avec le sien
    if (world.king && !world.king.dead) {
      const k = world.king;
      ctx.globalAlpha = 0.14;
      this.drawKing(k, color, performance.now(), false);

      // Cercle en tirets très discret autour du roi fantôme
      ctx.save();
      ctx.setLineDash([2 * this.dpr, 3 * this.dpr]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 * this.dpr;
      ctx.beginPath();
      ctx.arc(ox + (k.x + KING_W / 2) * s, oy + (k.y + KING_H / 2) * s, 6.5 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Nom très discret et transparent sans couronne dorée trompeuse
      ctx.globalAlpha = 0.25;
      ctx.font = `600 ${Math.round(7.5 * this.dpr)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(`${name || 'Adversaire'} (fantôme)`, ox + (k.x + KING_W / 2) * s, oy + (k.y - 4) * s);
    }
    ctx.restore();
  }

  drawSprayCursor(cx, cy, readyFraction = 1) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const sx = ox + cx * s;
    const sy = oy + cy * s;
    const r = SPRAY_RADIUS * s;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = readyFraction >= 1 ? 'rgba(56, 189, 248, 0.22)' : 'rgba(148, 163, 184, 0.16)';
    ctx.fill();
    ctx.lineWidth = 2 * this.dpr;
    ctx.strokeStyle = readyFraction >= 1 ? 'rgba(14, 165, 233, 0.9)' : 'rgba(255, 255, 255, 0.5)';
    ctx.setLineDash([5 * this.dpr, 4 * this.dpr]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (readyFraction < 1) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3 * this.dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * readyFraction);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3 * this.dpr;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFlattenCursor(cx, cy) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const sx = ox + cx * s;
    const sy = oy + cy * s;
    const w = 16 * s;
    ctx.save();
    ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2 * this.dpr;
    ctx.fillRect(sx - w / 2, sy - 2 * s, w, 4 * s);
    ctx.strokeRect(sx - w / 2, sy - 2 * s, w, 4 * s);
    ctx.font = `bold ${Math.max(10, Math.round(10 * this.dpr))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fef08a';
    ctx.fillText('🔨 Aplatir', sx, sy - 4 * s);
    ctx.restore();
  }

  drawDigCursor(cx, cy) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const sx = ox + cx * s;
    const sy = oy + cy * s;
    const r = 5 * s;
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.8 * this.dpr;
    ctx.setLineDash([4 * this.dpr, 3 * this.dpr]);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `bold ${Math.max(10, Math.round(10 * this.dpr))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fca5a5';
    ctx.fillText('🥄 Creuser', sx, sy - r - 2);
    ctx.restore();
  }

  drawTrajectory(angle, power, fraction = 0.42, wind = 0, side = 'left') {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const v = launchVelocity(angle, power);
    const isRight = side === 'right';
    let x = isRight ? (GRID_W - LAUNCH_X) : LAUNCH_X;
    let y = LAUNCH_Y;
    let vx = isRight ? -v.vx : v.vx;
    let vy = v.vy;
    const flight = (2 * -vy) / BALL_GRAVITY;
    const steps = Math.max(12, flight * fraction);
    ctx.save();
    for (let k = 0; k < steps; k++) {
      vy += BALL_GRAVITY;
      vx += wind;
      x += vx;
      y += vy;
      if (k % 4 === 0) {
        const a = 1 - k / steps;
        ctx.globalAlpha = a * 0.92;
        ctx.fillStyle = isRight ? '#fef08a' : '#fff';
        ctx.beginPath();
        ctx.arc(ox + x * s, oy + y * s, (0.75 + a * 0.85) * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  begin(dt) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * this.shake * this.dpr, (Math.random() - 0.5) * this.shake * this.dpr);
      this.shake *= Math.pow(0.88, dt / 16.7);
    }
  }
}

// Miniature d'un château (cartes des joueurs)
export function drawThumb(canvas, world, color) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const x0 = BUILD_MIN_X - 30;
  const y0 = 40;
  const sw = GRID_W - x0;
  const shh = GROUND_Y + 4 - y0;
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let py = 0; py < H; py++) {
    const cy = Math.floor(y0 + (py / H) * shh);
    for (let px = 0; px < W; px++) {
      const cx = Math.floor(x0 + (px / W) * sw);
      const code = world.cells[cy * GRID_W + cx];
      const t = code & TYPE_MASK;
      const o = (py * W + px) * 4;
      let c;
      if (t === T.EMPTY) c = cy < HORIZON ? [190, 228, 245] : cy < SHORE ? [92, 180, 210] : [200, 170, 120];
      else if (t === T.GROUND) c = [203, 168, 112];
      else if (t === T.KING) c = world.king?.dead ? [90, 90, 90] : hexToRgb(color);
      else c = PALETTE[t] || PALETTE[T.WET];
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
