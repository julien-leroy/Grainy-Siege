// Rendu de la scène de plage : ciel, mer, voiliers, mouettes, sable (pixel art éclairé),
// sable durci au spray (T.HARD), roi expressif, catapulte avec élastique de visée,
// gouttelettes de spray et textes flottants.
import {
  GRID_W, GRID_H, GROUND_Y, T, TYPE_MASK, DMG_SHIFT, MOIST_SHIFT, KING_W, KING_H, CATAPULT_X, LAUNCH_X, LAUNCH_Y,
  BUILD_MIN_X, BUILD_MAX_X, BALL_GRAVITY, SPRAY_RADIUS, launchVelocity, CATAPULT_RIGHT_X, LAUNCH_RIGHT_X,
} from '/shared/constants.js';
import { SAFE_ZONE_PAD_X, SAFE_ZONE_PAD_Y } from '/shared/shapes.js';

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
    this.collectedBonuses = [];
    this.shake = 0;
    this.flashLife = 0;
    this.flashColor = '#fff';
    this.catapults = {
      left: { angle: 2.95, target: 2.95, color: '#c0392b', loaded: true },
      right: { angle: 2.95, target: 2.95, color: '#2563eb', loaded: true },
    };
    this.catapult = this.catapults.left;
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
    this.sprites = {
      catapultBase: this._loadSprite('/assets/sprites/catapult_base.png'),
      catapultArm: this._loadSprite('/assets/sprites/catapult_arm.png'),
      bucketPour: this._loadSprite('/assets/sprites/bucket_pour.png'),
      bucketLift: this._loadSprite('/assets/sprites/bucket_lift.png'),
      pateHold: this._loadSprite('/assets/sprites/pate_hold.png'),
      patePlace: this._loadSprite('/assets/sprites/pate_place.png'),
      parachuteBag: this._loadSprite('/assets/sprites/parachute_bag.png'),
      parachuteSunk: this._loadSprite('/assets/sprites/parachute_sunk.png'),
      ballSand: this._loadSprite('/assets/sprites/ball_sand.png'),
      ballDark: this._loadSprite('/assets/sprites/ball_dark.png'),
      ballMetal: this._loadSprite('/assets/sprites/ball_metal.png'),
      bomb: this._loadSprite('/assets/sprites/bomb.png'),
      ballSpike: this._loadSprite('/assets/sprites/ball_spike.png'),
      bonusRainCloud: this._loadSprite('/assets/sprites/bonus_rain_cloud.png'),
      bonusSun: this._loadSprite('/assets/sprites/bonus_sun.png'),
      potionFlask: this._loadSprite('/assets/sprites/ball_poison.png'),
      ballPoison: this._loadSprite('/assets/sprites/ball_poison.png'),
      toolSpray: this._loadSprite('/assets/sprites/tool_spray.png'),
      toolTrowel: this._loadSprite('/assets/sprites/tool_trowel.png'),
      toolSpoon: this._loadSprite('/assets/sprites/tool_spoon.png'),
      boatSmall: this._loadSprite('/assets/sprites/boat_small.png'),
      boatLarge: this._loadSprite('/assets/sprites/boat_large.png'),
      seagull1: this._loadSprite('/assets/sprites/seagull_1.png'),
      seagull2: this._loadSprite('/assets/sprites/seagull_2.png'),
      seagull3: this._loadSprite('/assets/sprites/seagull_3.png'),
    };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _loadSprite(src) {
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    img.src = src;
    return img;
  }

  _getBonusSprite(type) {
    if (!this.sprites) return null;
    switch (type) {
      case 'sand':
        return this.sprites.ballSand;
      case 'iron':
      case 'ironBall':
        return this.sprites.ballMetal || this.sprites.ballDark;
      case 'heavySpikeBall':
      case 'spike':
        return this.sprites.ballSpike;
      case 'grenade':
        return this.sprites.bomb;
      case 'acid':
      case 'acidBall':
        return this.sprites.potionFlask;
      case 'ammo':
        return this.sprites.ballMetal || this.sprites.ballDark;
      case 'spray':
        return this.sprites.toolSpray || this.sprites.potionFlask;
      case 'wetAll':
        return this.sprites.bonusRainCloud;
      case 'dryOpponent':
        return this.sprites.bonusSun;
      default:
        return this.sprites.potionFlask || this.sprites.ballMetal;
    }
  }

  get width() {
    return this.canvas.width;
  }

  get height() {
    return this.canvas.height;
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

  setCameraTarget(targetX = GRID_W / 2, targetY = GROUND_Y - 45, targetZoom = 1.0) {
    this.camera.targetX = targetX;
    this.camera.targetY = targetY;
    this.camera.targetZoom = targetZoom;
  }

  updateCamera(dt) {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    // Sable rehaussé : réserve un plateau élégant de 86px en bas pour les commandes et munitions
    const bottomDeckHeight = 86 * this.dpr;
    const topMargin = 50 * this.dpr;
    const fitW = cw / (GRID_W * 1.02);
    const fitH = (ch - bottomDeckHeight - topMargin) / (GRID_H * 1.04);
    const baseS = Math.min(fitW, fitH);
    const s = baseS;
    const ox = (cw - GRID_W * s) / 2;
    const oy = (ch - bottomDeckHeight) - GROUND_Y * s;
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
    const bottomDeckHeight = 86 * this.dpr;
    const topMargin = 50 * this.dpr;
    const fitW = cw / (GRID_W * 1.02);
    const fitH = (ch - bottomDeckHeight - topMargin) / (GRID_H * 1.04);
    const baseS = Math.min(fitW, fitH);
    const s = baseS;
    const ox = (cw - GRID_W * s) / 2;
    const oy = (ch - bottomDeckHeight) - GROUND_Y * s;
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

    // mouettes animées dans le ciel (corps parfaitement centré et stable)
    const gullSprites = [this.sprites?.seagull1, this.sprites?.seagull2, this.sprites?.seagull3].filter(
      (s) => s && s.complete && s.naturalWidth > 0
    );
    for (const g of this.gulls) {
      const gx = (((g.x + t * g.v * 0.0005) % 1.15) - 0.08) * cw;
      const gy = g.y * hy + Math.sin(t * 0.002 + g.phase) * 4 * this.dpr;
      if (gullSprites.length === 3) {
        const frameIdx = Math.floor((t * 0.007 + g.phase * 2) % 3);
        const spr = gullSprites[frameIdx];
        const gw = 22 * this.dpr;
        const gh = gw * (spr.naturalHeight / spr.naturalWidth);
        ctx.drawImage(spr, gx - gw / 2, gy - gh / 2, gw, gh);
      } else {
        ctx.strokeStyle = 'rgba(45,65,85,0.55)';
        ctx.lineWidth = 1.6 * this.dpr;
        const flap = Math.sin(t * 0.009 + g.phase) * 3.5 * this.dpr;
        const w = 6 * this.dpr;
        ctx.beginPath();
        ctx.moveTo(gx - w, gy + flap);
        ctx.quadraticCurveTo(gx - w * 0.4, gy - 3 * this.dpr, gx, gy);
        ctx.quadraticCurveTo(gx + w * 0.4, gy - 3 * this.dpr, gx + w, gy + flap);
        ctx.stroke();
      }
    }

    // Grand galion majestueux à l'horizon (flotte fièrement à la surface sans couler)
    const bLarge = this.sprites?.boatLarge;
    if (bLarge && bLarge.complete && bLarge.naturalWidth > 0) {
      const largeX = (((0.18 + t * 0.000002) % 1.1) - 0.05) * cw;
      const largeBob = Math.sin(t * 0.001) * 1.5 * this.dpr;
      const lw = 38 * this.dpr;
      const lh = lw * (bLarge.naturalHeight / bLarge.naturalWidth);
      ctx.drawImage(bLarge, largeX - lw / 2, hy - lh * 0.96 + largeBob, lw, lh);
    }

    // mer
    const sea = ctx.createLinearGradient(0, hy, 0, shoreY);
    sea.addColorStop(0, '#1e78b0');
    sea.addColorStop(0.55, '#33a3c7');
    sea.addColorStop(1, '#6ed6d9');
    ctx.fillStyle = sea;
    ctx.fillRect(0, hy, cw, shoreY - hy + 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = Math.max(1, s * 0.5);

    // Vagues de mer et petit bateau sur la 3ème ligne de vagues (plus proche de la caméra)
    const bSmall = this.sprites?.boatSmall;
    const boatX = (((0.62 + t * 0.000006) % 1.1) - 0.05) * cw;

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

      // Dessin du petit bateau naviguant sur la 3ème rangée de vague (k = 2)
      if (k === 2) {
        ctx.save();
        ctx.globalAlpha = 1;
        const waveBob = Math.sin(boatX * 0.012 / this.dpr + ph) * amp;
        const boatY = yy + waveBob;

        if (bSmall && bSmall.complete && bSmall.naturalWidth > 0) {
          const sw = 28 * this.dpr;
          const sh = sw * (bSmall.naturalHeight / bSmall.naturalWidth);
          // Légère gîte du voilier avec la vague
          const tilt = Math.cos(boatX * 0.012 / this.dpr + ph) * 0.06;
          ctx.translate(boatX, boatY);
          ctx.rotate(tilt);
          ctx.drawImage(bSmall, -sw / 2, -sh * 0.94, sw, sh);
        } else {
          ctx.fillStyle = '#fff9f0';
          ctx.beginPath();
          ctx.moveTo(boatX, boatY - 16 * this.dpr);
          ctx.lineTo(boatX + 11 * this.dpr, boatY - 2 * this.dpr);
          ctx.lineTo(boatX, boatY - 2 * this.dpr);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#e4572e';
          ctx.beginPath();
          ctx.moveTo(boatX - 1 * this.dpr, boatY - 14 * this.dpr);
          ctx.lineTo(boatX - 8 * this.dpr, boatY - 2 * this.dpr);
          ctx.lineTo(boatX - 1 * this.dpr, boatY - 2 * this.dpr);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#5a3a1e';
          ctx.fillRect(boatX - 10 * this.dpr, boatY - 2 * this.dpr, 22 * this.dpr, 3.5 * this.dpr);
        }
        ctx.restore();
      }
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
    this.catapult = (this.catapults && this.catapults[activeSide]) || this.catapults?.left;

    // Dessiner UNIQUEMENT la catapulte active : pas besoin d'avoir les deux catapultes en même temps chargées sur l'écran !
    this._drawSingleCatapult(dt, alpha, slingPull, activeSide, true, aimInfo, isCharging, chargePower, ammoType);
  }

  _drawSingleCatapult(dt, alpha, slingPull, side, isActive, aimInfo, isCharging, chargePower, ammoType) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const isRight = side === 'right';
    const c = (this.catapults && this.catapults[side]) || this.catapult;
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
    ctx.ellipse(X(CATAPULT_X - 6), Y(GROUND_Y - 0.5), 10 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(X(CATAPULT_X + 18), Y(GROUND_Y - 0.5), 10 * s, 3.2 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Dessin des sprites de la catapulte : base fixe + bras articulé
    const baseImg = this.sprites?.catapultBase;
    const armImg = this.sprites?.catapultArm;

    // Déflexion du bras si mise sous tension (isCharging)
    let armAngle = c.angle;
    if (isActive && isCharging && c.loaded) {
      const flex = (chargePower || 0) * 0.22;
      armAngle = Math.min(3.1, c.angle + flex);
    }

    const tx = px + Math.cos(armAngle) * L;
    const ty = py - Math.sin(armAngle) * L;

    // Câble de tension reliant le treuil au bras lors de la charge
    if (isActive && isCharging) {
      const winchX = px - 9;
      const winchY = GROUND_Y - 7;
      const tensionVibe = Math.sin(performance.now() * 0.08) * 0.6 * s;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.8 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(X(winchX), Y(winchY));
      ctx.lineTo(X(tx * 0.7 + px * 0.3), Y(ty * 0.7 + py * 0.3) + tensionVibe);
      ctx.stroke();
    }

    // A. Dessin du bras de propulsion articulé (catapult_arm)
    if (armImg && armImg.complete && armImg.naturalWidth > 0) {
      const armScale = 23 / 712.9;
      const aw = 937 * armScale * s;
      const ah = 391 * armScale * s;
      const pivotScreenX = 824 * armScale * s;
      const pivotScreenY = 316 * armScale * s;
      const naturalArmAngle = Math.atan2(-179, -690); // ~ -2.8876 rad

      ctx.save();
      ctx.translate(X(px), Y(py));
      if (isRight) ctx.scale(-1, 1);
      ctx.rotate(-armAngle - naturalArmAngle);
      ctx.drawImage(armImg, -pivotScreenX, -pivotScreenY, aw, ah);
      ctx.restore();
    } else {
      // Fallback si le sprite charge encore
      ctx.strokeStyle = '#854e24';
      ctx.lineWidth = 3.2 * s;
      ctx.beginPath();
      ctx.moveTo(X(px - Math.cos(armAngle) * 6), Y(py + Math.sin(armAngle) * 6));
      ctx.lineTo(X(tx), Y(ty));
      ctx.stroke();
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(X(tx), Y(ty), 4.4 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    // B. Dessin du châssis base fixe (catapult_base)
    if (baseImg && baseImg.complete && baseImg.naturalWidth > 0) {
      const baseScale = 14 / 356;
      const bw = 962 * baseScale * s;
      const bh = 568 * baseScale * s;
      const gearScreenX = 642 * baseScale * s;
      const gearScreenY = 208 * baseScale * s;

      ctx.save();
      ctx.translate(X(px), Y(py));
      if (isRight) ctx.scale(-1, 1);
      ctx.drawImage(baseImg, -gearScreenX, -gearScreenY, bw, bh);
      ctx.restore();
    }

    // C. Munition dans le godet (sable de base, ou munition spéciale : fer, grenade, pointes, acide)
    if (c.loaded) {
      const isSpike = ammoType === 'heavySpikeBall' || ammoType === 'spike';
      const isGrenade = ammoType === 'grenade';
      const isAcid = ammoType === 'acid' || ammoType === 'acidBall';
      const isIron = ammoType === 'iron' || ammoType === 'ironBall';
      const isSand = !isSpike && !isGrenade && !isAcid && !isIron;

      const bRad = (isGrenade ? 2.5 : isSpike ? 3.4 : isAcid ? 3.0 : 2.7) * s;
      const ballX = X(tx);
      const ballY = Y(ty - 1.2);

      const spr = isAcid
        ? this.sprites?.potionFlask
        : isGrenade
          ? this.sprites?.bomb
          : isSpike
            ? this.sprites?.ballSpike
            : isIron
              ? (this.sprites?.ballMetal || this.sprites?.ballDark)
              : this.sprites?.ballSand;

      if (spr && spr.complete && spr.naturalWidth > 0) {
        const bw = bRad * 2.2;
        const bh = bw * (spr.naturalHeight / spr.naturalWidth);
        ctx.drawImage(spr, ballX - bw / 2, ballY - bh * (isAcid ? 0.65 : 0.55), bw, bh);
      } else if (isGrenade) {
        ctx.fillStyle = '#15803d';
        ctx.beginPath();
        ctx.arc(ballX, ballY, bRad, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#052e16';
        ctx.lineWidth = 1.1 * this.dpr;
        ctx.stroke();
      } else if (isSpike) {
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
      }
    }

    // D. Rivet d'axe central en bronze poli reliant le bras à la base
    ctx.fillStyle = '#ca8a04';
    ctx.beginPath();
    ctx.arc(X(px), Y(py), 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(X(px), Y(py), 1.1 * s, 0, Math.PI * 2);
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

      // Repère discret de l'angle sélectionné sur l'arc gradué
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.8 * this.dpr;
      ctx.beginPath();
      ctx.arc(knobX, knobY, 1.8 * this.dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#fef08a';
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
    const blinkCycle = (t + (king.x || 0) * 179) % 3800;
    const isBlinking = !dead && (blinkCycle < 140 || (blinkCycle > 260 && blinkCycle < 360 && ((king.x || 0) % 2 === 0)));
    const eyeLine = dead ? 'EsEsE' : (isBlinking ? 'SSSSS' : 'SESES');
    const sprite = dead
      ? ['Y.Y.Y', 'yYyYy', 'SSSSS', eyeLine, 'CWWWC', 'CCcCC', 'cCCCc', 'D...D']
      : ['Y.Y.Y', 'YyYyY', 'SSSSS', eyeLine, 'CWWWC', 'CCcCC', 'cCCCc', '.D.D.'];
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

    // Safe zone élargie et protégée du Roi pendant la phase de construction
    if (showSafeZone && world.king && !world.king.dead) {
      const k = world.king;
      const szX = ox + (k.x - SAFE_ZONE_PAD_X) * s;
      const szY = oy + (k.y - SAFE_ZONE_PAD_Y) * s;
      const szW = (KING_W + SAFE_ZONE_PAD_X * 2) * s;
      const szH = (KING_H + SAFE_ZONE_PAD_Y + 1) * s;
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.005);

      ctx.save();
      // Fond doré translucide
      ctx.fillStyle = `rgba(251, 191, 36, ${0.14 + pulse * 0.08})`;
      ctx.fillRect(szX, szY, szW, szH);
      // Bordure en pointillés dorés
      ctx.setLineDash([4 * this.dpr, 3 * this.dpr]);
      ctx.strokeStyle = `rgba(251, 191, 36, ${0.7 + pulse * 0.3})`;
      ctx.lineWidth = 1.4 * this.dpr;
      ctx.strokeRect(szX, szY, szW, szH);

      // Petite couronne au sommet de la safe zone
      ctx.font = `${Math.max(9, Math.round(9 * (s / 4)))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('👑', szX + szW / 2, szY - 2 * s);
      ctx.restore();
    }

    this.drawKing(world.king, color, t, highlightKing);

    // éjectas et grains de sable (normaux et grains verts d'acide corrosif)
    const p = world.parts;
    if (p.length) {
      for (let k = 0; k < p.length; k += 2) {
        const rawY = p[k + 1];
        const isAcid = rawY < 0;
        const py = isAcid ? (-rawY - 1) / 8 : rawY / 8;
        const px = p[k] / 8;
        if (isAcid) {
          // Grains d'acide vert corrosif avec éclat toxique et micro-vapeur d'évaporation
          const flicker = (k + Math.floor(t * 0.025)) % 3;
          ctx.fillStyle = flicker === 0 ? '#4ade80' : flicker === 1 ? '#22c55e' : '#16a34a';
          ctx.fillRect(ox + px * s - 0.2 * s, oy + py * s - 0.2 * s, s * 1.4, s * 1.4);
          if (k % 4 === 0) {
            ctx.fillStyle = 'rgba(74, 222, 128, 0.35)';
            ctx.fillRect(ox + (px - 0.5) * s, oy + (py - 0.5) * s, s * 2.0, s * 2.0);
          }
        } else {
          ctx.fillStyle = '#e6c88e';
          ctx.fillRect(ox + px * s, oy + py * s, s, s);
        }
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
      if (b.acid || b.type === 'acid') {
        // FIOLE D'ACIDE CORROSIF
        const flaskSpr = this.sprites?.potionFlask;
        const fr = b.r * s;
        if (flaskSpr && flaskSpr.complete && flaskSpr.naturalWidth > 0) {
          ctx.save();
          ctx.translate(gx, gy);
          const rot = (b.vx || b.vy) ? Math.atan2(b.vy || 0, b.vx || 1) + Math.PI / 2 : (b.age || 0) * 0.15;
          ctx.rotate(rot);
          const fw = fr * 2.5;
          const fh = fw * (flaskSpr.naturalHeight / flaskSpr.naturalWidth);
          ctx.drawImage(flaskSpr, -fw / 2, -fh / 2, fw, fh);
          ctx.restore();
        } else {
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(gx, gy, fr, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (b.grenade || b.type === 'grenade') {
        // GRENADE MILITAIRE À MÈCHE / MINUTERIE RETARDÉE
        const grR = b.r * s;
        const bombSpr = this.sprites?.bomb;

        if (bombSpr && bombSpr.complete && bombSpr.naturalWidth > 0) {
          ctx.save();
          ctx.translate(gx, gy);
          if (!b.landed) {
            const rot = (b.vx || b.vy) ? Math.atan2(b.vy || 0, b.vx || 1) + Math.PI / 2 : (b.age || 0) * 0.1;
            ctx.rotate(rot);
          }
          const bw = grR * 2.4;
          const bh = bw * (bombSpr.naturalHeight / bombSpr.naturalWidth);
          ctx.drawImage(bombSpr, -bw / 2, -bh * 0.55, bw, bh);
          ctx.restore();
        } else {
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
          ctx.lineWidth = 0.65 * this.dpr;
          ctx.beginPath();
          ctx.moveTo(gx - grR * 0.75, gy);
          ctx.lineTo(gx + grR * 0.75, gy);
          ctx.moveTo(gx, gy - grR * 0.75);
          ctx.lineTo(gx, gy + grR * 0.75);
          ctx.stroke();

          // Tête détonateur métallique
          ctx.fillStyle = '#94a3b8';
          ctx.fillRect(gx - 0.9 * s, gy - grR - 1.8 * s, 1.8 * s, 1.8 * s);
          // Goupille ronde dorée
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 0.85 * this.dpr;
          ctx.beginPath();
          ctx.arc(gx + 1.5 * s, gy - grR - 1.0 * s, 0.9 * s, 0, Math.PI * 2);
          ctx.stroke();
        }

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
      } else if (b.spike || b.type === 'spike') {
        // Boulet d'acier lourd avec des pics acérés !
        const spikeSpr = this.sprites?.ballSpike;
        if (spikeSpr && spikeSpr.complete && spikeSpr.naturalWidth > 0) {
          ctx.save();
          ctx.translate(gx, gy);
          ctx.rotate((b.age || 0) * 0.15);
          const size = b.r * s * 2.6;
          ctx.drawImage(spikeSpr, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else {
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
        }
      } else if (b.iron || b.type === 'iron') {
        // Boulet en fer poli (impact net sans ajouter de sable)
        const metalSpr = this.sprites?.ballMetal || this.sprites?.ballDark;
        if (metalSpr && metalSpr.complete && metalSpr.naturalWidth > 0) {
          ctx.save();
          ctx.translate(gx, gy);
          ctx.rotate((b.age || 0) * 0.08);
          const size = b.r * s * 2.3;
          ctx.drawImage(metalSpr, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else {
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(gx, gy, b.r * s, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Boulet de sable granulaire (boulet de base classique)
        const sandSpr = this.sprites?.ballSand;
        if (sandSpr && sandSpr.complete && sandSpr.naturalWidth > 0) {
          ctx.save();
          ctx.translate(gx, gy);
          ctx.rotate((b.age || 0) * 0.07);
          const size = b.r * s * 2.3;
          ctx.drawImage(sandSpr, -size / 2, -size / 2, size, size);
          ctx.restore();
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

  // ---------------------------------------------------------------- Jauge de recharges de spray sous le château (Mode Défense)
  drawDefenseSprayStock(spraysLeft, maxSprays = 3, cooldownRatio = 1, t = 0) {
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const centerX = ox + ((BUILD_MIN_X + BUILD_MAX_X) / 2) * s;
    const centerY = oy + (GROUND_Y + 10) * s;

    ctx.save();
    const badgeW = 260 * this.dpr;
    const badgeH = 26 * this.dpr;
    const r = 13 * this.dpr;
    const left = centerX - badgeW / 2;
    const top = centerY - badgeH / 2;

    ctx.shadowColor = spraysLeft > 0 ? 'rgba(56, 189, 248, 0.45)' : 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = spraysLeft > 0 ? 12 * this.dpr : 4 * this.dpr;

    const grad = ctx.createLinearGradient(left, top, left + badgeW, top + badgeH);
    grad.addColorStop(0, 'rgba(8, 47, 73, 0.94)');
    grad.addColorStop(0.5, 'rgba(12, 74, 110, 0.92)');
    grad.addColorStop(1, 'rgba(3, 105, 161, 0.94)');
    ctx.fillStyle = grad;

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, top, badgeW, badgeH, r);
    else ctx.rect(left, top, badgeW, badgeH);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = spraysLeft > 0 ? 'rgba(56, 189, 248, 0.85)' : 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1.8 * this.dpr;
    ctx.stroke();

    const fontSize = Math.max(10, Math.round(11 * this.dpr));
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('💦 SPRAY DÉFENSE :', left + 14 * this.dpr, centerY);

    const dropletsX = left + 130 * this.dpr;
    for (let i = 0; i < maxSprays; i++) {
      const dx = dropletsX + i * 20 * this.dpr;
      const isAvailable = i < spraysLeft;
      if (isAvailable) {
        ctx.font = `${Math.round(13 * this.dpr)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('💧', dx, centerY);
      } else {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.beginPath();
        ctx.arc(dx, centerY, 5 * this.dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1 * this.dpr;
        ctx.stroke();
      }
    }

    ctx.textAlign = 'right';
    ctx.font = `700 ${Math.max(9, Math.round(9.5 * this.dpr))}px system-ui, sans-serif`;
    if (spraysLeft > 0) {
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`(${spraysLeft} prêt${spraysLeft > 1 ? 's' : ''}) Clic château !`, left + badgeW - 12 * this.dpr, centerY);
    } else {
      ctx.fillStyle = '#f87171';
      ctx.fillText('Épuisé (Touche 🎁 en vol)', left + badgeW - 12 * this.dpr, centerY);
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

      const pBagSpr = this.sprites?.parachuteBag;
      const bonusSpr = this._getBonusSprite(d.type);

      if (pBagSpr && pBagSpr.complete && pBagSpr.naturalWidth > 0) {
        const pw = 22.0 * s;
        const ph = pw * (pBagSpr.naturalHeight / pBagSpr.naturalWidth);
        const iconSize = 7.5 * s;

        // Positionnement Y du centre de la panse du sac
        const bagCenterY = 2.75 * s;

        if (!inWater) {
          // En vol : balancement très doux et naturel avec le vent
          const sway = Math.sin(t * 0.0025 + d.x * 0.3) * 0.09;
          ctx.translate(cx, cy);
          ctx.rotate(sway);

          // Dessin du parachute complet avec son sac
          ctx.drawImage(pBagSpr, -pw / 2, -ph * 0.74, pw, ph);

          // Icône du bonus dessinée bien nette directement au centre du sac noué
          if (bonusSpr && bonusSpr.complete && bonusSpr.naturalWidth > 0) {
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
            ctx.shadowBlur = 4 * this.dpr;
            const iw = iconSize;
            const ih = iw * (bonusSpr.naturalHeight / bonusSpr.naturalWidth);
            ctx.drawImage(bonusSpr, -iw / 2, bagCenterY - ih / 2, iw, ih);
            ctx.restore();
          } else {
            const icon = d.type === 'grenade' ? '💣' : d.type === 'heavySpikeBall' ? '💣' : d.type === 'dryOpponent' ? '☀️' : d.type === 'wetAll' ? '💦' : '☄️';
            ctx.font = `bold ${Math.max(8, Math.round(6 * s))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icon, 0, bagCenterY);
          }
        } else {
          // Bonus coulé dans la mer (non récupéré par le joueur)
          ctx.translate(cx, cy);

          const pSunkSpr = this.sprites?.parachuteSunk;
          if (pSunkSpr && pSunkSpr.complete && pSunkSpr.naturalWidth > 0) {
            const sw = 23.0 * s;
            const sh = sw * (pSunkSpr.naturalHeight / pSunkSpr.naturalWidth);
            ctx.save();
            const waterTilt = Math.sin(t * 0.003 + d.x * 0.5) * 0.05;
            ctx.rotate(waterTilt);
            ctx.drawImage(pSunkSpr, -sw / 2, -sh * 0.86, sw, sh);
            ctx.restore();
          } else {
            // Fallback si sprite non chargé
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.lineWidth = Math.max(1, 1.2 * this.dpr);
            ctx.beginPath();
            ctx.ellipse(0, bagCenterY, 9 * s, 2.8 * s, 0, 0, Math.PI * 2);
            ctx.stroke();

            ctx.save();
            const waterTilt = Math.sin(t * 0.003 + d.x * 0.5) * 0.08;
            ctx.rotate(waterTilt);
            ctx.drawImage(pBagSpr, -pw / 2, -ph * 0.74, pw, ph);
            ctx.restore();
          }

          // Petites bulles d'eau qui remontent
          ctx.fillStyle = 'rgba(224, 242, 254, 0.85)';
          ctx.beginPath();
          ctx.arc(-3.5 * s, -1.8 * s, 1.1 * s, 0, Math.PI * 2);
          ctx.arc(3.8 * s, -2.6 * s, 0.8 * s, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (!inWater) {
        // Fallback procédural si sprite en cours de chargement
        const sway = Math.sin(t * 0.0025 + d.x * 0.3) * 0.09;
        ctx.translate(cx, cy);
        ctx.rotate(sway);

        const chuteW = 12.0 * s;
        const chuteH = 7.8 * s;
        const chuteY = -13.0 * s;
        const ringY = -2.5 * s;

        // 1) Suspentes fines en soie
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = Math.max(1, 0.75 * this.dpr);
        ctx.beginPath();
        ctx.moveTo(-chuteW, chuteY);
        ctx.lineTo(0, ringY);
        ctx.moveTo(-chuteW * 0.33, chuteY);
        ctx.lineTo(0, ringY);
        ctx.moveTo(chuteW * 0.33, chuteY);
        ctx.lineTo(0, ringY);
        ctx.moveTo(chuteW, chuteY);
        ctx.lineTo(0, ringY);
        ctx.stroke();

        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(0, ringY, 0.8 * s, 0, Math.PI * 2);
        ctx.fill();

        const primaryColor = d.type === 'grenade' ? '#15803d' : d.type === 'heavySpikeBall' ? '#475569' : d.type === 'dryOpponent' ? '#ea580c' : d.type === 'wetAll' ? '#0284c7' : '#dc2626';
        ctx.beginPath();
        ctx.ellipse(0, chuteY, chuteW, chuteH, 0, Math.PI, 0, false);
        ctx.quadraticCurveTo(chuteW * 0.66, chuteY - 0.7 * s, chuteW * 0.33, chuteY);
        ctx.quadraticCurveTo(0, chuteY - 0.7 * s, -chuteW * 0.33, chuteY);
        ctx.quadraticCurveTo(-chuteW * 0.66, chuteY - 0.7 * s, -chuteW, chuteY);
        ctx.closePath();

        const canopyGrad = ctx.createRadialGradient(0, chuteY - chuteH * 0.3, 0.8 * s, 0, chuteY, chuteW);
        canopyGrad.addColorStop(0, '#ffffff');
        canopyGrad.addColorStop(0.38, primaryColor);
        canopyGrad.addColorStop(1, '#0f172a');
        ctx.fillStyle = canopyGrad;
        ctx.fill();

        this._drawCrate(0, 0.5 * s, s, d.type);
      } else {
        // Fallback procédural dans l'eau
        ctx.translate(cx, cy);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = Math.max(1, 1 * this.dpr);
        ctx.beginPath();
        ctx.ellipse(0, 2.2 * s, 5.5 * s, 1.5 * s, 0, 0, Math.PI * 2);
        ctx.stroke();

        this._drawCrate(0, 0.5 * s, s, d.type);
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
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pr) || pr <= 0) continue;
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
    this.drawCollectedBonuses(performance.now());

    // Effet de flash d'écran (pour les bonus légendaires)
    if (this.flashLife > 0) {
      this.flashLife -= 0.025 * f;
      ctx.save();
      ctx.fillStyle = this.flashColor;
      ctx.globalAlpha = Math.max(0, Math.min(0.55, this.flashLife * 0.55));
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
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
    const pourImg = this.sprites?.bucketPour;
    const liftImg = this.sprites?.bucketLift;

    for (let i = 0; i < this.pouringBuckets.length; i++) {
      const b = this.pouringBuckets[i];
      const elapsed = now - b.start;
      const p = elapsed / b.duration;
      if (p >= 1) continue;
      this.pouringBuckets[w++] = b;

      const targetX = ox + b.x * s;
      const targetY = oy + b.y * s;

      if (pourImg && pourImg.complete && pourImg.naturalWidth > 0 && liftImg && liftImg.complete && liftImg.naturalWidth > 0) {
        ctx.save();
        if (p < 0.48) {
          // Phase 1 : Verse le sable depuis le seau (bucket_pour)
          const t = p / 0.48;
          const alpha = Math.min(1, t * 3.5);
          const bob = Math.sin(t * Math.PI * 5) * 1.8 * s;
          const spriteW = 32 * s;
          const spriteH = (819 / 786) * spriteW;
          const drawX = targetX - spriteW * 0.72;
          const drawY = targetY - spriteH * 1.12 + bob;

          ctx.globalAlpha = alpha;
          ctx.drawImage(pourImg, drawX, drawY, spriteW, spriteH);

          // Particules de sable animées qui s'écoulent
          ctx.fillStyle = '#fde047';
          for (let g = 0; g < 4; g++) {
            const gt = ((now * 0.008 + g * 0.25) % 1);
            const gx = targetX + (Math.sin(g * 3 + now * 0.01) * 3.5 * s);
            const gy = targetY - 4 * s + gt * 7 * s;
            ctx.beginPath();
            ctx.arc(gx, gy, (1.2 + (g % 2) * 0.6) * s, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Phase 2 : Démoule et soulève le seau vers le haut (bucket_lift)
          const t = (p - 0.48) / 0.52;
          const alpha = t > 0.8 ? (1 - t) / 0.2 : 1.0;
          const liftY = Math.pow(t, 1.2) * -22 * s;
          const spriteW = 32 * s;
          const spriteH = (842 / 783) * spriteW;
          const drawX = targetX - spriteW * 0.46;
          const drawY = targetY - spriteH * 1.08 + liftY;

          ctx.globalAlpha = Math.max(0, alpha);
          ctx.drawImage(liftImg, drawX, drawY, spriteW, spriteH);
        }
        ctx.restore();
      } else {
        // Fallback procedural si chargement
        let angle = 0;
        let alpha = 1;
        let offsetY = -28 * s;
        let offsetX = -10 * s;

        if (p < 0.28) {
          const t = p / 0.28;
          const ease = 1 - Math.pow(1 - t, 3);
          angle = ease * 1.15;
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
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(angle);
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.arc(0, 0, 9 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.restore();
      }
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
    const holdImg = this.sprites?.pateHold;
    const placeImg = this.sprites?.patePlace;

    for (let i = 0; i < this.handScoops.length; i++) {
      const h = this.handScoops[i];
      const elapsed = now - h.start;
      const p = elapsed / h.duration;
      if (p >= 1) continue;
      this.handScoops[w++] = h;

      const targetX = ox + h.x * s;
      const targetY = oy + h.y * s;

      if (holdImg && holdImg.complete && holdImg.naturalWidth > 0 && placeImg && placeImg.complete && placeImg.naturalWidth > 0) {
        ctx.save();
        if (p < 0.45) {
          // Phase 1 : Descend avec la poignée de sable (pate_hold) - un peu plus haut et à gauche
          const t = p / 0.45;
          const alpha = Math.min(1, t * 3.5);
          const dropY = (1 - t) * -14 * s;
          const spriteW = 26 * s;
          const spriteH = (423 / 566) * spriteW;
          const drawX = targetX - spriteW * 0.68;
          const drawY = targetY - spriteH * 1.05 + dropY;

          ctx.globalAlpha = alpha;
          ctx.drawImage(holdImg, drawX, drawY, spriteW, spriteH);

          // Grains de sable qui tombent de la main
          ctx.fillStyle = '#facc15';
          for (let g = 0; g < 3; g++) {
            const gy = targetY - 2 * s + ((now * 0.01 + g * 0.3) % 1) * 5 * s;
            const gx = targetX + (g - 1) * 2.5 * s;
            ctx.beginPath();
            ctx.arc(gx, gy, 1.1 * s, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Phase 2 : Tapote et façonne le pâté (pate_place) - un peu plus haut et à gauche
          const t = (p - 0.45) / 0.55;
          const tap = Math.sin(t * Math.PI * 4) * 2.2 * s;
          const alpha = t > 0.75 ? (1 - t) / 0.25 : 1.0;
          const spriteW = 27 * s;
          const spriteH = (290 / 529) * spriteW;
          const drawX = targetX - spriteW * 0.70;
          const drawY = targetY - spriteH * 0.82 + tap;

          ctx.globalAlpha = Math.max(0, alpha);
          ctx.drawImage(placeImg, drawX, drawY, spriteW, spriteH);
        }
        ctx.restore();
      } else {
        // Fallback procedural si chargement
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
        ctx.fillStyle = '#f4cbb0';
        ctx.beginPath();
        ctx.ellipse(hx, hy, 5.5 * s, 4 * s, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    this.handScoops.length = w;
  }

  // ---------------------------------------------------------------- seau animé dans l'atelier
  drawAtelierBucket(canvasEl, fillRatio, now) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);

    const isReady = fillRatio >= 1.0;
    const cx = w / 2;
    const cy = h * 0.84;
    const s = w / 32;

    ctx.save();

    // 1. Ombre portée douce
    ctx.fillStyle = 'rgba(78, 48, 16, 0.24)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 9.5 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Anse du seau
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.arc(cx, cy - 8 * s, 8 * s, Math.PI * 0.9, Math.PI * 2.1);
    ctx.stroke();

    // 3. Corps du seau (bleu marin dégradé)
    const bucketGrad = ctx.createLinearGradient(cx - 8 * s, cy - 14 * s, cx + 8 * s, cy);
    bucketGrad.addColorStop(0, '#38bdf8');
    bucketGrad.addColorStop(0.5, '#0284c7');
    bucketGrad.addColorStop(1, '#075985');

    ctx.fillStyle = bucketGrad;
    ctx.strokeStyle = '#0c4a6e';
    ctx.lineWidth = 1.4 * s;
    ctx.beginPath();
    ctx.moveTo(cx - 8 * s, cy - 14 * s);
    ctx.lineTo(cx + 8 * s, cy - 14 * s);
    ctx.lineTo(cx + 6 * s, cy - 1 * s);
    ctx.lineTo(cx - 6 * s, cy - 1 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 4. Sable qui monte à l'intérieur
    const sandHeight = Math.min(1.0, Math.max(0.08, fillRatio)) * 11 * s;
    const sandTopY = cy - 2.5 * s - sandHeight;

    const sandGrad = ctx.createLinearGradient(cx, sandTopY, cx, cy);
    sandGrad.addColorStop(0, '#fef08a');
    sandGrad.addColorStop(0.5, '#eab308');
    sandGrad.addColorStop(1, '#ca8a04');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - 7.5 * s, cy - 13.5 * s);
    ctx.lineTo(cx + 7.5 * s, cy - 13.5 * s);
    ctx.lineTo(cx + 5.8 * s, cy - 1.5 * s);
    ctx.lineTo(cx - 5.8 * s, cy - 1.5 * s);
    ctx.closePath();
    ctx.clip();

    ctx.fillStyle = sandGrad;
    ctx.fillRect(cx - 9 * s, sandTopY, 18 * s, cy - sandTopY + 2 * s);
    ctx.restore();

    // 5. Rebord supérieur du seau
    ctx.fillStyle = '#0284c7';
    ctx.strokeStyle = '#0c4a6e';
    ctx.lineWidth = 1.3 * s;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 14 * s, 8.2 * s, 2.4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 6. Grains ou éclat si prêt
    if (!isReady) {
      ctx.fillStyle = '#fde047';
      const gt = (now * 0.005) % 1;
      ctx.beginPath();
      ctx.arc(cx + Math.sin(now * 0.01) * 2 * s, cy - 18 * s + gt * 5.5 * s, 1.2 * s, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const pulse = Math.sin(now * 0.006) * 0.25 + 0.75;
      ctx.fillStyle = `rgba(254, 240, 138, ${pulse})`;
      ctx.beginPath();
      ctx.arc(cx + 4.5 * s, cy - 14 * s, 2 * s, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
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

  // ---------------------------------------------------------------- Affichage bien visible des bonus récupérés (2s)
  addCollectedBonus(x, y, type, playerName = '', playerColor = '') {
    const validX = Number.isFinite(x) ? x : 150;
    const validY = Number.isFinite(y) ? y : 80;
    const info = this.getBonusDisplayInfo(type);
    this.collectedBonuses.push({
      x: validX,
      y: validY,
      type,
      title: info.title,
      icon: info.icon,
      subtitle: playerName ? `Récupéré par ${playerName}` : 'Bonus Récupéré !',
      color: info.color,
      bgColor: info.bgColor,
      playerColor: playerColor || info.color,
      startTime: performance.now(),
      duration: 3200,
    });
  }

  getBonusDisplayInfo(type) {
    switch (type) {
      case 'ammo':
        return {
          icon: '☄️',
          title: '+1 BOULET D\'ATTAQUE',
          color: '#f97316',
          bgColor: 'rgba(234, 88, 12, 0.95)',
        };
      case 'spray':
        return {
          icon: '💦',
          title: '+1 SPRAY DÉFENSIF',
          color: '#38bdf8',
          bgColor: 'rgba(2, 132, 199, 0.95)',
        };
      case 'grenade':
        return {
          icon: '🧨',
          title: 'GRENADE (MÈCHE 2s)',
          color: '#4ade80',
          bgColor: 'rgba(21, 128, 61, 0.95)',
        };
      case 'heavySpikeBall':
        return {
          icon: '💣',
          title: 'BOULET D\'ACIER À POINTES',
          color: '#e2e8f0',
          bgColor: 'rgba(51, 65, 85, 0.95)',
        };
      case 'wetAll':
        return {
          icon: '🌊',
          title: 'DÉLUGE BÉNI : CHÂTEAU FORTIFIÉ',
          color: '#67e8f9',
          bgColor: 'rgba(8, 145, 178, 0.95)',
        };
      case 'iron':
      case 'ironBall':
        return {
          icon: '⚔️',
          title: 'BOULET EN FER (IMPACT NET)',
          color: '#cbd5e1',
          bgColor: 'rgba(51, 65, 85, 0.95)',
        };
      case 'acid':
      case 'acidBall':
        return {
          icon: '🧪',
          title: 'FIOLE D\'ACIDE (RONGE LE SABLE)',
          color: '#4ade80',
          bgColor: 'rgba(20, 83, 45, 0.95)',
        };
      case 'dryOpponent':
        return {
          icon: '☀️',
          title: 'SÉCHERESSE APOCALYPTIQUE',
          color: '#facc15',
          bgColor: 'rgba(202, 138, 4, 0.95)',
        };
      default:
        return {
          icon: '🎁',
          title: 'BONUS OBTENU !',
          color: '#facc15',
          bgColor: 'rgba(45, 20, 5, 0.95)',
        };
    }
  }

  drawCollectedBonuses(now) {
    if (!this.collectedBonuses || !this.collectedBonuses.length) return;
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0) return;

    let w = 0;
    for (let i = 0; i < this.collectedBonuses.length; i++) {
      const b = this.collectedBonuses[i];
      const elapsed = now - b.startTime;
      if (elapsed >= b.duration) continue;
      this.collectedBonuses[w++] = b;

      const progress = elapsed / b.duration; // 0.0 à 1.0 (durée 2000ms)

      // Animation d'entrée élastique sur les premiers 15% (300ms)
      let scale = 1.0;
      if (progress < 0.15) {
        const tIn = progress / 0.15;
        scale = Math.sin(tIn * Math.PI * 0.5) * 1.15;
      }

      // Fondu d'apparition (0..0.08) et de disparition (0.80..1.0)
      let alpha = 1.0;
      if (progress < 0.08) {
        alpha = progress / 0.08;
      } else if (progress > 0.80) {
        alpha = Math.max(0, (1 - progress) / 0.20);
      }

      // Dérive très légère vers le haut
      const floatY = progress * 14 * s;
      const validX = Number.isFinite(b.x) ? b.x : 150;
      const validY = Number.isFinite(b.y) ? b.y : 80;
      const bx = ox + validX * s;
      const by = oy + validY * s - floatY;

      if (!Number.isFinite(bx) || !Number.isFinite(by)) continue;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

      // Anneau lumineux d'impact / choc d'obtention
      if (progress < 0.40) {
        const ringProg = progress / 0.40;
        const ringR = (10 + ringProg * 40) * s;
        if (Number.isFinite(ringR) && ringR > 0) {
          ctx.beginPath();
          ctx.arc(bx, by, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = b.color;
          ctx.lineWidth = Math.max(1.5, 3.5 * (1 - ringProg) * this.dpr);
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha * (1 - ringProg) * 0.75));
          ctx.stroke();
          ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        }
      }

      // Dimensions du grand badge bien visible
      const badgeW = 230 * this.dpr;
      const badgeH = 50 * this.dpr;
      const rad = 14 * this.dpr;

      // Positionnement centré au-dessus du point de récupération
      const left = Math.max(10, Math.min(cw - badgeW - 10, bx - badgeW / 2));
      const top = Math.max(10, Math.min(ch - badgeH - 10, by - badgeH - 12 * s));

      if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(badgeW) || !Number.isFinite(badgeH)) {
        ctx.restore();
        continue;
      }

      ctx.translate(left + badgeW / 2, top + badgeH / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(left + badgeW / 2), -(top + badgeH / 2));

      // Ombre portée puissante et lueur colorée
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 18 * this.dpr;
      ctx.shadowOffsetY = 4 * this.dpr;

      // Fond dégradé du badge
      const grad = ctx.createLinearGradient(left, top, left + badgeW, top + badgeH);
      grad.addColorStop(0, 'rgba(15, 23, 42, 0.95)');
      grad.addColorStop(0.35, b.bgColor);
      grad.addColorStop(1, 'rgba(15, 23, 42, 0.98)');
      ctx.fillStyle = grad;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(left, top, badgeW, badgeH, rad);
      } else {
        ctx.rect(left, top, badgeW, badgeH);
      }
      ctx.fill();

      // Bordure stylisée avec couleur du bonus
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2.8 * this.dpr;
      ctx.stroke();

      // Pastille circulaire pour l'icône à gauche
      const iconCircleR = badgeH * 0.38;
      const iconCx = left + iconCircleR + 8 * this.dpr;
      const iconCy = top + badgeH / 2;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.arc(iconCx, iconCy, iconCircleR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.stroke();

      // Icône du bonus (Sprite ou Émoji)
      const spr = this._getBonusSprite(b.type);
      if (spr && spr.complete && spr.naturalWidth > 0) {
        const isz = iconCircleR * 1.6;
        const ih = isz * (spr.naturalHeight / spr.naturalWidth);
        ctx.drawImage(spr, iconCx - isz / 2, iconCy - ih / 2, isz, ih);
      } else {
        ctx.font = `${Math.round(20 * this.dpr)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.icon, iconCx, iconCy);
      }

      // Titre en gros et gras
      const textLeft = iconCx + iconCircleR + 10 * this.dpr;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      ctx.font = `900 ${Math.round(12.5 * this.dpr)}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 4 * this.dpr;
      ctx.fillText(b.title, textLeft, top + badgeH * 0.46);

      // Sous-titre ("Récupéré par ..." en jaune d'or)
      ctx.font = `800 ${Math.round(10.5 * this.dpr)}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = '#fde047';
      ctx.shadowBlur = 2 * this.dpr;
      ctx.fillText(b.subtitle, textLeft, top + badgeH * 0.82);

      ctx.restore();
    }
    this.collectedBonuses.length = w;
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

  drawGhost(shape, pos, ok, isKing = false, cooldownRatio = 1.0, playerColor = '#e4572e', isPate = false) {
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

    // Animation du seau qui se remplit au-dessus du motif (UNIQUEMENT pour les patrons, jamais pour le pâté !)
    if (isCooling && !isPate && shape?.id !== 'pate') {
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
