// Simulation de sable : automate cellulaire + sable mouillé cohésif + séchage.
//
//  - Le sable SEC et les MOTTES (granulaires) tombent avec une vraie vitesse (gravité
//    accumulée), glissent en diagonale et forment des tas.
//  - Le sable MOUILLÉ (WET) est cohésif : tant qu'une cellule est reliée (4-voisinage)
//    à du sable mouillé qui repose sur le sol, elle tient. Un morceau qui n'est relié à
//    rien tombe D'UN SEUL TENANT (corps rigide) : une tour lâchée en l'air retombe en tour,
//    en perdant juste quelques miettes à l'atterrissage.
//  - Chaque cellule a une HUMIDITÉ (0..255). Pendant la construction tout reste mouillé.
//    Pendant la bataille le sable sèche lentement depuis les faces exposées à l'air, puis
//    le séchage gagne l'intérieur. Le sable sec ne tombe pas tout seul, mais il est
//    FRAGILE : un choc bref (boulet, chute de sable) le fait voler en éclats.
//  - Le Spray d'eau ré-humidifie (détrempe) une zone : le sable redevient résistant.
//  - Si du sable s'effondre sur le Roi, il est enseveli !
import {
  GRID_W, GRID_H, GROUND_Y, T, KING_W, KING_H, DMG_SHIFT, MOIST_SHIFT, MOIST_BUILD, MOIST_SPRAY,
  BALL_GRAVITY, BALL_RADIUS, SPRAY_RADIUS, BUILD_MIN_X, BUILD_MAX_X,
} from '../shared/constants.js';
import { SHAPE_BY_ID, getShape, isNearKing, dropPosition, kingDropPosition, spawnPosition } from '../shared/shapes.js';
import { CONFIG } from './config.js';

const W = GRID_W;
const H = GRID_H;
const N = W * H;
const { EMPTY, GROUND, WET, DRY, LOOSE, KING, HARD } = T;
const MAX_PARTICLES = 1800;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 5 formes aléatoires de reposoirs / talus surélevés pour le Roi
export const PEDESTAL_SHAPES = [
  // 0 : Le Tertre Rond (Dune arrondie douce)
  {
    name: 'Dune Arrondie',
    height: 6,
    build: (setCell, cx, groundY) => {
      const rows = [
        [-8, 8],
        [-7, 7],
        [-6, 6],
        [-5, 5],
        [-4, 4],
        [-3, 3], // sommet où repose le Roi
      ];
      for (let dy = 0; dy < rows.length; dy++) {
        const y = groundY - 1 - dy;
        const [x0, x1] = rows[dy];
        for (let x = cx + x0; x <= cx + x1; x++) setCell(x, y);
      }
      return { kingX: cx - 2, kingY: groundY - 6 - KING_H };
    },
  },
  // 1 : La Ziggourat Royale (3 gradins réguliers)
  {
    name: 'Ziggourat à Gradins',
    height: 6,
    build: (setCell, cx, groundY) => {
      const tiers = [
        { dy0: 0, dy1: 1, w: 10 },
        { dy0: 2, dy1: 3, w: 7 },
        { dy0: 4, dy1: 5, w: 4 },
      ];
      for (const t of tiers) {
        for (let dy = t.dy0; dy <= t.dy1; dy++) {
          const y = groundY - 1 - dy;
          for (let x = cx - t.w; x <= cx + t.w; x++) setCell(x, y);
        }
      }
      return { kingX: cx - 2, kingY: groundY - 6 - KING_H };
    },
  },
  // 2 : Le Promontoire Rampé (Rampe à gauche, aplomb à droite)
  {
    name: 'Promontoire Rampé',
    height: 7,
    build: (setCell, cx, groundY) => {
      const rows = [
        [-11, 5],
        [-9, 5],
        [-7, 5],
        [-5, 5],
        [-4, 4],
        [-3, 4],
        [-2, 3], // plateforme surélevée
      ];
      for (let dy = 0; dy < rows.length; dy++) {
        const y = groundY - 1 - dy;
        const [x0, x1] = rows[dy];
        for (let x = cx + x0; x <= cx + x1; x++) setCell(x, y);
      }
      return { kingX: cx - 1, kingY: groundY - 7 - KING_H };
    },
  },
  // 3 : Le Bastion Fortifié (Podium central + contreforts latéraux)
  {
    name: 'Bastion Fortifié',
    height: 6,
    build: (setCell, cx, groundY) => {
      // Contreforts latéraux bas
      for (let dy = 0; dy < 3; dy++) {
        const y = groundY - 1 - dy;
        for (let x = cx - 11; x <= cx - 7; x++) setCell(x, y);
        for (let x = cx + 7; x <= cx + 11; x++) setCell(x, y);
      }
      // Podium central
      for (let dy = 0; dy < 6; dy++) {
        const y = groundY - 1 - dy;
        for (let x = cx - 5; x <= cx + 5; x++) setCell(x, y);
      }
      return { kingX: cx - 2, kingY: groundY - 6 - KING_H };
    },
  },
  // 4 : Le Monticule Rocailleux (Socle naturel étagé)
  {
    name: 'Monticule Rocailleux',
    height: 6,
    build: (setCell, cx, groundY) => {
      const rows = [
        [-10, 9],
        [-9, 8],
        [-8, 7],
        [-6, 6],
        [-4, 5],
        [-3, 4],
      ];
      for (let dy = 0; dy < rows.length; dy++) {
        const y = groundY - 1 - dy;
        const [x0, x1] = rows[dy];
        for (let x = cx + x0; x <= cx + x1; x++) setCell(x, y);
      }
      return { kingX: cx - 1, kingY: groundY - 6 - KING_H };
    },
  },
];

const isGranular = (t) => t === DRY || t === LOOSE;
const isStructural = (t) => t === WET || t === HARD;
const isSand = (t) => t === WET || t === HARD || t === DRY || t === LOOSE;
// Fragilité face aux chocs : le sable détrempé encaisse, le sable sec casse net.
const brittle = (m) => 0.3 + 1.1 * (1 - m / 255);
// Dégâts accumulés au-delà desquels la cellule se désagrège.
const breakAt = (m) => 60 + 165 * (m / 255);

export class SandWorld {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.type = new Uint8Array(N);
    this.vel = new Float32Array(N);
    this.damage = new Uint8Array(N);
    this.moist = new Float32Array(N);
    this.moistTmp = new Float32Array(N);
    this.bodyId = new Uint16Array(N);
    this.dist = new Uint16Array(N);
    this.run = new Uint16Array(N);
    this.buckets = [];
    this.bodyTag = 1;
    this.support = new Uint8Array(N);
    this.isBridge = new Uint8Array(N);
    this.queue = new Int32Array(N);
    this.bodies = [];
    this.nextBodyId = 1;
    this.particles = [];
    this.ball = null;
    this.king = null;
    this.armed = false; // en phase de bataille : le moindre ensevelissement élimine définitivement
    this.buildVulnerable = true; // ensevelir son Roi déclenche sa perte (géré à la fin du chrono)
    this.drying = false; // le sable sèche (phase de bataille uniquement)
    this.wind = 0;
    this.ballScale = 1;
    this.structDirty = true;
    this.tick = 0;
    this.quietTicks = 0;
    this.version = 0;
    this.events = [];
    this.rng = mulberry32(seed);
    this.stats = { placed: 0, sprayed: 0, failedCells: 0 };
    for (let y = GROUND_Y; y < H; y++) for (let x = 0; x < W; x++) this.type[y * W + x] = GROUND;
    this.initKingPedestal();
  }

  initKingPedestal(pedestalType = -1, cx = 210, withDunes = false) {
    if (withDunes) return this.initBeachDunes(pedestalType, cx);
    if (this.king) this.clearKingCells();
    const idx = (pedestalType >= 0 && pedestalType < PEDESTAL_SHAPES.length)
      ? pedestalType
      : Math.floor(this.rng() * PEDESTAL_SHAPES.length);
    const p = PEDESTAL_SHAPES[idx];
    this.pedestalType = idx;
    const setCell = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= GROUND_Y) return;
      const i = y * W + x;
      this.type[i] = WET;
      this.vel[i] = 0;
      this.damage[i] = 0;
      this.moist[i] = MOIST_BUILD;
    };
    const { kingX, kingY } = p.build(setCell, cx, GROUND_Y);
    this.king = { x: kingX, y: kingY, vy: 0, fallStart: -1, hits: 0, dead: false, cause: null };
    this.writeKingCells();
    this.version++;
    this.structDirty = true;
    return { pedestalType: idx, kingX, kingY };
  }

  // Plage aléatoire avec dunes douces sur toute la zone de construction et petits talus
  initBeachDunes(pedestalType = -1, cx = 210) {
    if (this.king) this.clearKingCells();
    const idx = (pedestalType >= 0 && pedestalType < PEDESTAL_SHAPES.length)
      ? pedestalType
      : Math.floor(this.rng() * PEDESTAL_SHAPES.length);
    this.pedestalType = idx;
    const setCell = (x, y) => {
      if (x < 0 || x >= W || y < 0 || y >= GROUND_Y) return;
      const i = y * W + x;
      this.type[i] = WET;
      this.vel[i] = 0;
      this.damage[i] = 0;
      this.moist[i] = MOIST_BUILD;
    };

    // 1) Plage aléatoire avec dunes douces sur toute la zone de construction (BUILD_MIN_X à BUILD_MAX_X)
    const zoneW = BUILD_MAX_X - BUILD_MIN_X; // 220
    const phase1 = this.rng() * Math.PI * 2;
    const phase2 = this.rng() * Math.PI * 2;
    const freq1 = 2.4 + this.rng() * 1.2;
    const freq2 = 5.2 + this.rng() * 1.8;

    for (let x = BUILD_MIN_X; x <= BUILD_MAX_X; x++) {
      const u = (x - BUILD_MIN_X) / zoneW; // 0..1
      const env = Math.sin(u * Math.PI); // Raccord doux aux bords
      const wave1 = Math.sin(u * Math.PI * 2 * freq1 + phase1);
      const wave2 = Math.sin(u * Math.PI * 2 * freq2 + phase2) * 0.45;
      const duneH = Math.max(0, Math.round(env * (2.2 + wave1 * 1.5 + wave2 * 0.8)));
      for (let dy = 0; dy < duneH; dy++) {
        setCell(x, GROUND_Y - 1 - dy);
      }
    }

    // 2) Petits talus naturels supplémentaires disséminés sur la plage
    const mounds = [
      { x: Math.round(BUILD_MIN_X + zoneW * 0.22 + (this.rng() - 0.5) * 20), w: 6 + Math.round(this.rng() * 3), h: 3 + Math.round(this.rng() * 2) },
      { x: Math.round(cx + (this.rng() - 0.5) * 16), w: 8 + Math.round(this.rng() * 3), h: 4 + Math.round(this.rng() * 2) },
      { x: Math.round(BUILD_MIN_X + zoneW * 0.78 + (this.rng() - 0.5) * 20), w: 6 + Math.round(this.rng() * 3), h: 3 + Math.round(this.rng() * 2) },
    ];

    for (const m of mounds) {
      for (let dy = 0; dy < m.h; dy++) {
        const mw = Math.round(m.w * (1 - dy / (m.h + 0.5)));
        for (let x = m.x - mw; x <= m.x + mw; x++) {
          let topY = GROUND_Y - 1;
          while (topY > 0 && this.type[topY * W + x] === WET) topY--;
          setCell(x, topY);
        }
      }
    }

    // 3) Placement du Roi sur la dune / promontoire central stable
    let kingTargetX = Math.round(cx - KING_W / 2);
    kingTargetX = Math.max(BUILD_MIN_X + 6, Math.min(BUILD_MAX_X - KING_W - 6, kingTargetX));
    let highestSandY = GROUND_Y;
    for (let kx = kingTargetX; kx < kingTargetX + KING_W; kx++) {
      let y = GROUND_Y - 1;
      while (y > 0 && this.type[y * W + kx] === WET) y--;
      if (y + 1 < highestSandY) highestSandY = y + 1;
    }
    // Palier d'assise sous les pieds du Roi
    for (let kx = kingTargetX - 1; kx <= kingTargetX + KING_W; kx++) {
      for (let y = highestSandY; y < GROUND_Y; y++) {
        setCell(kx, y);
      }
    }
    const kingX = kingTargetX;
    const kingY = highestSandY - KING_H;

    this.king = { x: kingX, y: kingY, vy: 0, fallStart: -1, hits: 0, dead: false, cause: null };
    this.writeKingCells();
    this.version++;
    this.structDirty = true;
    return { pedestalType: idx, kingX, kingY };
  }

  isNearKing(x, y) {
    const k = this.king;
    if (!k) return false;
    return isNearKing(x, y, k);
  }

  isSolid = (x, y) => {
    if (x < 0 || x >= W || y >= H) return true;
    if (y < 0) return false;
    const t = this.type[y * W + x];
    return t !== EMPTY && t !== KING;
  };

  // ------------------------------------------------------------------ construction
  cellType = (x, y) => {
    if (x < 0 || x >= W || y >= H) return GROUND;
    if (y < 0) return EMPTY;
    return this.type[y * W + x];
  };

  /**
   * Remplit le moule `shapeId` de sable mouillé.
   *  - mode 'spawn' (gameplay, défaut) : le moule est rempli LÀ OÙ le joueur clique
   *    (seules les cellules vides) ; s'il n'est relié à rien il tombera d'un seul tenant.
   *  - mode 'drop' (bots, outils, tests) : le moule est directement posé sur l'appui
   *    sous le curseur (ancien comportement).
   *  - flipped : inversion gauche-droite du patron
   *  - Safe zone : interdiction de coller du sable contre le Roi.
   */
  stamp(shapeId, cx, cy, mode = 'spawn', flipped = false) {
    if (mode === true) mode = 'spawn';
    if (mode === false) mode = 'drop';
    const shape = getShape(shapeId, flipped);
    if (!shape) return null;
    const pos = mode === 'drop'
      ? dropPosition(this.isSolid, shape, cx, cy, false)
      : spawnPosition(this.cellType, shape, cx, cy, this.king);
    if (!pos.valid) return null;
    const { w, h, mask } = shape;
    const m0 = this.drying ? MOIST_BUILD * 0.85 : MOIST_BUILD;
    let placedCells = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        const gx = pos.left + x;
        const gy = pos.top + y;
        if (gx < 0 || gx >= W || gy < 0 || gy >= GROUND_Y) continue;
        if (this.isNearKing(gx, gy)) continue; // Safe zone du Roi respectée
        const i = gy * W + gx;
        if (this.type[i] !== EMPTY) continue;
        this.type[i] = WET;
        this.vel[i] = 0;
        this.damage[i] = 0;
        this.bodyId[i] = 0;
        // légère variation naturelle d'humidité d'un grain à l'autre
        this.moist[i] = m0 - this.rng() * 10;
        placedCells++;
      }
    }
    if (placedCells === 0) return null;
    this.stats.placed++;
    this.structDirty = true;
    this.version++;
    this.quietTicks = 0;
    return { left: pos.left, top: pos.top, valid: true, flipped: !!flipped };
  }

  /**
   * Arrose le sable avec un spray d'eau autour de (cx, cy) :
   *  - le sable cohésif est DÉTREMPÉ (humidité max) : il redevient résistant aux chocs ;
   *  - les fissures sont en partie colmatées ;
   *  - les grains secs / mottes au repos touchés par l'eau redeviennent du sable moulable.
   */
  spray(cx, cy, radius = SPRAY_RADIUS) {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(W - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(GROUND_Y - 1, Math.ceil(cy + radius));
    let hardened = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const i = y * W + x;
        const t = this.type[i];
        if (!isSand(t)) continue;
        // bords du jet plus diffus : un peu moins d'eau
        const edge = d > radius * 0.72;
        const target = edge ? MOIST_SPRAY - 40 - this.rng() * 30 : MOIST_SPRAY;
        if (isStructural(t)) {
          if (this.moist[i] < target) this.moist[i] = target;
          this.damage[i] = this.damage[i] >> 2;
          this.type[i] = HARD;
          hardened++;
        } else if (this.vel[i] === 0 && !edge) {
          this.type[i] = HARD;
          this.moist[i] = target;
          this.damage[i] = 0;
          hardened++;
        }
      }
    }
    if (hardened > 0) {
      this.stats.sprayed++;
      this.structDirty = true;
      this.version++;
      this.quietTicks = 0;
    }
    return { x: Math.round(cx), y: Math.round(cy), radius, hardened };
  }

  placeKing(cx, cy) {
    if (this.king) this.clearKingCells();
    const pos = kingDropPosition(this.isSolid, KING_W, KING_H, cx, cy);
    if (!pos.valid) {
      if (this.king) this.writeKingCells();
      return null;
    }
    this.king = { x: pos.left, y: pos.top, vy: 0, fallStart: -1, hits: 0, dead: false, cause: null };
    this.writeKingCells();
    this.version++;
    this.quietTicks = 0;
    this.structDirty = true;
    return pos;
  }

  clearKingCells() {
    const k = this.king;
    if (!k) return;
    for (let y = 0; y < KING_H; y++)
      for (let x = 0; x < KING_W; x++) {
        const i = (k.y + y) * W + k.x + x;
        if (this.type[i] === KING) this.type[i] = EMPTY;
      }
  }

  writeKingCells() {
    const k = this.king;
    if (!k) return;
    for (let y = 0; y < KING_H; y++)
      for (let x = 0; x < KING_W; x++) this.type[(k.y + y) * W + k.x + x] = KING;
  }

  killKing(cause) {
    const k = this.king;
    if (!k || k.dead) return;
    if (!this.armed && !this.buildVulnerable) return;
    k.dead = true;
    k.cause = cause;
    this.events.push({ type: 'kingDead', cause, x: k.x + KING_W / 2, y: k.y });
  }

  kingHit(speed) {
    const k = this.king;
    if (!k || k.dead || speed < 0.5) return;
    if (!this.armed && !this.buildVulnerable) return;
    k.hits++;
    this.events.push({ type: 'kingDanger', hits: k.hits, max: CONFIG.kingBuryGrains, x: k.x + KING_W / 2, y: k.y });
    if (k.hits >= CONFIG.kingBuryGrains) this.killKing('enseveli');
  }

  /**
   * Truelle / Aplatir : égalise le sable autour de cx à la hauteur cy
   */
  flatten(cx, cy, width = 16) {
    const x0 = Math.max(BUILD_MIN_X, Math.floor(cx - width / 2));
    const x1 = Math.min(BUILD_MAX_X - 1, Math.ceil(cx + width / 2));
    const targetY = Math.max(0, Math.min(GROUND_Y - 1, Math.round(cy)));
    let changed = 0;
    for (let x = x0; x <= x1; x++) {
      for (let y = Math.max(0, targetY - 6); y < targetY; y++) {
        const i = y * W + x;
        if (isSand(this.type[i])) {
          this.type[i] = EMPTY;
          this.vel[i] = 0;
          changed++;
        }
      }
      const i = targetY * W + x;
      if (this.type[i] === EMPTY) {
        this.type[i] = WET;
        this.moist[i] = MOIST_BUILD;
        this.vel[i] = 0;
        this.damage[i] = 0;
        changed++;
      }
    }
    if (changed > 0) {
      this.structDirty = true;
      this.version++;
      this.quietTicks = 0;
    }
    return { x: cx, y: cy, changed };
  }

  /**
   * Pelle / Cuillère : retire / creuse le sable sur un rayon
   */
  dig(cx, cy, radius = 5) {
    const x0 = Math.max(BUILD_MIN_X, Math.floor(cx - radius));
    const x1 = Math.min(BUILD_MAX_X - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(GROUND_Y - 1, Math.ceil(cy + radius));
    let removed = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue;
        const i = y * W + x;
        if (isSand(this.type[i])) {
          this.type[i] = EMPTY;
          this.vel[i] = 0;
          this.damage[i] = 0;
          removed++;
        }
      }
    }
    if (removed > 0) {
      this.structDirty = true;
      this.version++;
      this.quietTicks = 0;
    }
    return { x: cx, y: cy, removed };
  }

  /**
   * Assèchement total (Bonus Sécheresse)
   */
  dryAll() {
    for (let i = 0; i < N; i++) {
      if (isSand(this.type[i])) {
        this.moist[i] = 0;
        if (this.type[i] === HARD) this.type[i] = WET;
        this.damage[i] = Math.min(255, this.damage[i] + 45);
      }
    }
    this.structDirty = true;
    this.version++;
    this.quietTicks = 0;
  }

  /**
   * Humidification totale (Bonus Pluie Royale)
   */
  wetAll() {
    for (let i = 0; i < N; i++) {
      if (isSand(this.type[i])) {
        this.moist[i] = MOIST_SPRAY;
        this.type[i] = HARD;
        this.damage[i] = 0;
      }
    }
    this.structDirty = true;
    this.version++;
    this.quietTicks = 0;
  }

  launch(x, y, vx, vy, spike = false, grenade = false, iron = false, acid = false) {
    const isSand = !spike && !grenade && !iron && !acid;
    const ballType = acid ? 'acid' : grenade ? 'grenade' : spike ? 'spike' : iron ? 'iron' : 'sand';
    this.ball = {
      x,
      y,
      vx,
      vy,
      r: BALL_RADIUS * this.ballScale * (spike ? 1.4 : grenade ? 0.78 : acid ? 0.95 : 1),
      age: 0,
      spike,
      grenade,
      iron,
      acid,
      sand: isSand,
      type: ballType,
      landed: false,
      fuseTicks: 0,
    };
    this.quietTicks = 0;
  }

  // ------------------------------------------------------------------ boucle
  get sleeping() {
    return this.quietTicks > 180 && !this.ball && this.particles.length === 0 && !this.structDirty && !this.drying;
  }

  step() {
    if (this.sleeping) return;
    this.tick++;
    let activity = 0;
    activity += this.stepGrains();
    activity += this.stepParticles();
    if (this.ball) {
      this.stepBall();
      activity++;
    }
    activity += this.stepKing();
    if (this.structDirty && this.tick % CONFIG.structureInterval === 0) {
      const failed = this.analyzeStructure();
      activity += failed;
    }
    if (this.drying && this.tick % 6 === 0) {
      this.stepDrying();
    }
    if (activity > 0) {
      this.version++;
      this.quietTicks = 0;
    } else {
      this.quietTicks++;
    }
  }

  stepDrying() {
    if (!this.drying) return;
    const { type, moist, moistTmp } = this;
    moistTmp.set(moist);
    const D = 0.10; // Diffusion capillaire naturelle entre grains voisins
    for (let y = 0; y < GROUND_Y; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const t = type[i];
        if (!isStructural(t)) continue;
        let m = moist[i];
        let exposedFaces = 0;
        let sumDelta = 0;
        let nbCount = 0;

        if (y > 0) {
          const nt = type[i - W];
          if (nt === EMPTY) exposedFaces++;
          else if (isStructural(nt)) { sumDelta += moist[i - W] - m; nbCount++; }
        }
        if (y + 1 < GROUND_Y) {
          const nt = type[i + W];
          if (nt === EMPTY) exposedFaces++;
          else if (isStructural(nt)) { sumDelta += moist[i + W] - m; nbCount++; }
        } else {
          // Contact direct avec le sol de plage saturé d'eau de mer (capillarité de base)
          sumDelta += (220 - m);
          nbCount++;
        }
        if (x > 0) {
          const nt = type[i - 1];
          if (nt === EMPTY) exposedFaces++;
          else if (isStructural(nt)) { sumDelta += moist[i - 1] - m; nbCount++; }
        }
        if (x + 1 < W) {
          const nt = type[i + 1];
          if (nt === EMPTY) exposedFaces++;
          else if (isStructural(nt)) { sumDelta += moist[i + 1] - m; nbCount++; }
        }

        // Taux d'évaporation équilibré et progressif :
        // Le sable durci (HARD) conserve son humidité 2.6x plus longtemps que le sable mouillé (WET)
        if (exposedFaces > 0) {
          const baseRate = t === HARD ? 0.06 : 0.16;
          const faceMultiplier = 0.75 + exposedFaces * 0.25;
          m -= baseRate * faceMultiplier;
        }

        // Diffusion capillaire vers / depuis les grains voisins
        if (nbCount > 0) m += sumDelta * D;

        // Plancher d'humidité réaliste
        if (m < 20) m = 20;
        moistTmp[i] = m;
      }
    }
    moist.set(moistTmp);
  }

  get settled() {
    return this.quietTicks > 20 && !this.ball && this.particles.length === 0;
  }

  moveCell(from, to, v) {
    this.type[to] = this.type[from];
    this.vel[to] = v;
    this.damage[to] = 0;
    this.type[from] = EMPTY;
    this.vel[from] = 0;
    this.damage[from] = 0;
    // si on retire un appui sous du sable mouillé/durci, il faut revérifier la structure
    if (from >= W && isStructural(this.type[from - W])) this.structDirty = true;
  }

  stepGrains() {
    const { type, vel, rng } = this;
    const g = CONFIG.grainGravity;
    const vmax = CONFIG.grainMaxSpeed;
    let moved = 0;
    for (let y = H - 2; y >= 0; y--) {
      const ltr = ((y + this.tick) & 1) === 0;
      for (let k = 0; k < W; k++) {
        const x = ltr ? k : W - 1 - k;
        const i = y * W + x;
        const t = type[i];
        if (t !== DRY && t !== LOOSE) continue;

        // 1) chute libre
        let v = vel[i] + g;
        if (v > vmax) v = vmax;
        const steps = Math.max(1, v | 0);
        let cur = i;
        let cy = y;
        let n = 0;
        while (n < steps && cy + 1 < H && type[cur + W] === EMPTY) {
          cur += W;
          cy++;
          n++;
        }
        if (n === steps) {
          this.moveCell(i, cur, v);
          moved++;
          continue;
        }
        if (n > 0) {
          this.moveCell(i, cur, v);
          moved++;
        }

        // 2) atterrissage
        let ct = t;
        if (cy + 1 < H) {
          const below = cur + W;
          const bt = type[below];
          const falling = vel[cur] > 0.45 || n > 0;
          if (falling) {
            if (bt === KING) {
              this.kingHit(v);
              type[cur] = EMPTY;
              vel[cur] = 0;
              this.damage[cur] = 0;
              this.structDirty = true;
              continue;
            } else if (isStructural(bt) && v > 2) {
              const factor = bt === HARD ? 0.45 : 1;
              this.damage[below] = Math.min(255, this.damage[below] + v * CONFIG.impactDamage * factor);
              this.structDirty = true;
            }
            if (ct === LOOSE && v > 2.5 && rng() < CONFIG.looseCrumbleChance) {
              type[cur] = DRY;
              ct = DRY;
            }
          }
        } else {
          vel[cur] = 0;
          continue;
        }

        // 3) glissement diagonal (talus)
        const cx = cur % W;
        const d = rng() < 0.5 ? -1 : 1;
        let slid = false;
        for (let s = 0; s < 2 && !slid; s++) {
          const dx = s === 0 ? d : -d;
          const nx = cx + dx;
          if (nx < 0 || nx >= W) continue;
          if (type[cur + dx] !== EMPTY || type[cur + W + dx] !== EMPTY) continue;
          if (ct === LOOSE) {
            const deep = cy + 2 >= H || type[cur + 2 * W + dx] === EMPTY;
            if (!deep || rng() > CONFIG.looseSlideChance) continue;
          }
          this.moveCell(cur, cur + W + dx, Math.min(v, 1.5) * 0.5);
          moved++;
          slid = true;
        }
        if (!slid) vel[cur] = 0;
      }
    }
    return moved;
  }

  spawnParticle(x, y, vx, vy, kind) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ x, y, vx, vy, kind });
  }

  settleParticle(px, py, kind, speed) {
    let x = Math.floor(px);
    let y = Math.floor(py);
    if (x < 0 || x >= W) return;
    if (y < 0) y = 0;
    if (y >= H) return;
    let i = y * W + x;
    let guard = 0;
    while (this.type[i] !== EMPTY && y > 0 && guard++ < 40) {
      y--;
      i -= W;
    }
    if (this.type[i] !== EMPTY) return;
    this.type[i] = kind;
    this.vel[i] = Math.min(CONFIG.grainMaxSpeed, speed);
    this.damage[i] = 0;
  }

  stepParticles() {
    const ps = this.particles;
    if (!ps.length) return 0;
    const { type } = this;
    const g = CONFIG.grainGravity * 0.8;
    let w = 0;
    for (let r = 0; r < ps.length; r++) {
      const p = ps[r];
      p.vy += g;
      p.vx *= 0.99;
      p.vx += this.wind * 4;
      const sp = Math.max(Math.abs(p.vx), Math.abs(p.vy));
      const ss = Math.max(1, Math.ceil(sp));
      let alive = true;
      for (let s = 0; s < ss; s++) {
        const nx = p.x + p.vx / ss;
        const ny = p.y + p.vy / ss;
        const cx = Math.floor(nx);
        const cy = Math.floor(ny);
        if (cx < 0 || cx >= W || cy >= H) {
          alive = false;
          break;
        }
        if (cy >= 0) {
          const ct = type[cy * W + cx];
          if (ct !== EMPTY) {
            if (p.isAcid) {
              if (ct === KING) {
                this.kingHit(2.0);
              } else if (isSand(ct)) {
                const j = cy * W + cx;
                type[j] = EMPTY;
                this.vel[j] = 0;
                this.damage[j] = 0;
                // Ronge également un grain de sable adjacent
                const adjs = [[0, 1], [1, 0], [-1, 0], [0, -1]];
                for (const [adx, ady] of adjs) {
                  const ax = cx + adx;
                  const ay = cy + ady;
                  if (ax >= 0 && ax < W && ay >= 0 && ay < H && isSand(type[ay * W + ax])) {
                    const aj = ay * W + ax;
                    type[aj] = EMPTY;
                    this.vel[aj] = 0;
                    this.damage[aj] = 0;
                    break;
                  }
                }
              }
              alive = false;
              break;
            }
            if (ct === KING) {
              this.kingHit(Math.hypot(p.vx, p.vy));
              alive = false;
              break;
            }
            if (isStructural(ct) && sp > 2.5) {
              const j = cy * W + cx;
              const factor = ct === HARD ? 0.45 : 1;
              this.damage[j] = Math.min(255, this.damage[j] + sp * 6 * factor);
            }
            this.settleParticle(p.x, p.y, p.kind, Math.max(0, p.vy));
            alive = false;
            break;
          }
        }
        p.x = nx;
        p.y = ny;
      }
      if (alive) ps[w++] = p;
    }
    ps.length = w;
    this.structDirty = true;
    return ps.length + 1;
  }

  stepBall() {
    const b = this.ball;
    b.age++;

    // Si la grenade a touché le sol ou le château : compte à rebours de 2 secondes (120 ticks à 60 TPS)
    if (b.landed) {
      b.fuseTicks++;
      // Décélération et stabilisation au sol
      b.vx *= 0.85;
      b.vy = Math.min(b.vy + BALL_GRAVITY * 1.5, 1.2);
      b.x += b.vx;
      b.y += b.vy;
      const hit = this.ballContact(b);
      if (hit) {
        b.vx = 0;
        b.vy = 0;
      }

      // Émission d'étincelles et fumée de mèche
      if (b.fuseTicks % 6 === 0) {
        this.spawnParticle(b.x + (this.rng() - 0.5) * 2, b.y - b.r, (this.rng() - 0.5) * 0.8, -0.7 - this.rng() * 0.7, DRY);
        this.events.push({ type: 'grenadeTick', x: b.x, y: b.y, fuseLeft: Math.max(0, 120 - b.fuseTicks) });
      }

      // Explosion après exactement 2.0 secondes
      if (b.fuseTicks >= 120) {
        this.grenadeExplosion(b.x, b.y, b.r);
        this.ball = null;
        return;
      }
      return;
    }

    b.vy += BALL_GRAVITY;
    b.vx += this.wind;
    const ss = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / 0.4));
    for (let s = 0; s < ss; s++) {
      b.x += b.vx / ss;
      b.y += b.vy / ss;
      const hit = this.ballContact(b);
      if (hit) {
        if (b.grenade) {
          // La grenade touche le sol/château : s'enclenche avec un compte à rebours de 2.0s !
          b.landed = true;
          b.fuseTicks = 0;
          b.vx *= 0.35;
          b.vy = -Math.abs(b.vy) * 0.25;
          this.events.push({ type: 'grenadeLand', x: b.x, y: b.y });
          return;
        }

        if (b.acid) {
          // Fiole d'acide corrosif : ne fait pas de dégâts aux murs, mais libère des pixels d'acide qui rongent le sable !
          for (let k = 0; k < 50; k++) {
            const ang = (this.rng() - 0.5) * 1.8 - Math.PI / 2;
            const spd = 0.8 + this.rng() * 2.8;
            this.particles.push({
              x: b.x + (this.rng() - 0.5) * 2,
              y: b.y + (this.rng() - 0.5) * 2,
              vx: Math.cos(ang) * spd + b.vx * 0.15,
              vy: Math.sin(ang) * spd,
              kind: 'acid',
              isAcid: true,
            });
          }
          if (hit === KING) {
            this.killKing('acide');
            this.events.push({ type: 'kingHit', x: b.x, y: b.y });
          }
          this.events.push({ type: 'acidSplash', x: b.x, y: b.y });
          this.ball = null;
          this.structDirty = true;
          return;
        }

        if (hit === KING) {
          this.killKing('touché');
          this.events.push({ type: 'kingHit', x: b.x, y: b.y });
        }
        const isSpike = Boolean(b.spike);
        const isIron = Boolean(b.iron);
        const isSand = !isSpike && !isIron;
        this.impact(b.x, b.y, b.vx, b.vy, b.r, isSpike, isIron, isSand);
        this.ball = null;
        return;
      }
    }
    if (b.x > W + 20 || b.x < -40 || b.y > H + 10 || b.age > 900) {
      this.events.push({ type: 'miss', x: b.x, y: b.y });
      this.ball = null;
    }
  }

  ballContact(b) {
    const r = b.r;
    const x0 = Math.floor(b.x - r);
    const x1 = Math.ceil(b.x + r);
    const y0 = Math.floor(b.y - r);
    const y1 = Math.ceil(b.y + r);
    let found = 0;
    for (let y = y0; y <= y1; y++) {
      if (y < 0) continue;
      if (y >= H) return GROUND;
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= W) continue;
        const dx = x + 0.5 - b.x;
        const dy = y + 0.5 - b.y;
        if (dx * dx + dy * dy > r * r) continue;
        const t = this.type[y * W + x];
        if (t === KING) return KING;
        if (t !== EMPTY) found = t;
      }
    }
    return found;
  }

  impact(x, y, vx, vy, ballR, isSpike = false, isIron = false, isSandBall = true) {
    const { type, damage, rng } = this;
    const speed = Math.hypot(vx, vy);
    const spikeRMult = isSpike ? 1.20 : 1.0;
    const R = Math.min(CONFIG.craterMax * 1.5, (CONFIG.craterBase + speed * CONFIG.craterPerSpeed) * spikeRMult) * this.ballScale;
    const R2 = R * (isSpike ? CONFIG.shockFactor * 1.08 : CONFIG.shockFactor);
    const x0 = Math.max(0, Math.floor(x - R2));
    const x1 = Math.min(W - 1, Math.ceil(x + R2));
    const y0 = Math.max(0, Math.floor(y - R2));
    const y1 = Math.min(H - 1, Math.ceil(y + R2));
    const nx = vx / (speed || 1);
    const ny = vy / (speed || 1);

    if (isSpike && this.king) {
      const kDist = Math.hypot(this.king.x + KING_W / 2 - x, this.king.y + KING_H / 2 - y);
      if (kDist <= R * 1.05) {
        this.killKing('touché');
        this.events.push({ type: 'kingHit', x, y });
      }
    }

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * W + cx;
        const t = type[i];
        if (!isSand(t)) continue;
        const dx = cx + 0.5 - x;
        const dy = cy + 0.5 - y;
        const d = Math.hypot(dx, dy);
        if (d > R2) continue;
        // Le boulet à pointes pénètre le sable durci (HARD) avec un rayon modéré
        const craterRadius = isSpike
          ? (t === HARD ? R * 0.75 : R * 0.98)
          : (t === HARD ? R * 0.62 : R);
        if (d <= craterRadius * (0.85 + rng() * 0.3)) {
          type[i] = EMPTY;
          this.vel[i] = 0;
          damage[i] = 0;
          if (rng() < (isSpike ? 0.75 : CONFIG.ejectaRatio)) {
            const inv = 1 / (d || 1);
            const kick = (0.6 + rng() * 1.6) * (0.5 + speed * 0.35) * (isSpike ? 1.15 : 1.0);
            this.spawnParticle(
              cx + 0.5, cy + 0.5,
              dx * inv * kick + nx * speed * 0.3 + (rng() - 0.5) * 0.6,
              dy * inv * kick * 0.6 - (0.8 + rng() * 1.5) + ny * speed * 0.15,
              rng() < 0.3 ? LOOSE : DRY,
            );
          }
        } else if (isStructural(t)) {
          const f = Math.max(0, 1 - (d - craterRadius) / (R2 - craterRadius));
          const resist = isSpike ? 0.85 : (t === HARD ? 0.48 : 1);
          const isDry = this.moist[i] < 60; // Sable structuré asséché
          const dryMult = isDry ? 2.6 : 1.0;
          const spikeDmgMult = isSpike ? 1.4 : 1.0;
          damage[i] = Math.min(255, damage[i] + f * CONFIG.shockDamage * resist * dryMult * spikeDmgMult * (0.6 + rng() * 0.8));
          if (t === HARD && (damage[i] > 175 || (isSpike && rng() < 0.35))) {
            type[i] = WET;
          }
          const looseChance = isSpike
            ? Math.min(0.85, f * 1.15)
            : (isDry ? Math.min(0.96, f * 0.96) : (f * CONFIG.shockLooseChance * resist));
          if (rng() < looseChance) {
            type[i] = isDry && rng() < 0.55 ? DRY : LOOSE;
            this.vel[i] = 0;

            // Poussée latérale directe par le boulet de canon : éjecte le sable sec vers le côté
            if (isDry && Math.abs(nx) > 0.2) {
              const pushX = cx + (nx > 0 ? 1 : -1);
              if (pushX >= 0 && pushX < W && type[cy * W + pushX] === EMPTY && rng() < 0.7) {
                type[cy * W + pushX] = rng() < 0.5 ? DRY : LOOSE;
                this.vel[cy * W + pushX] = Math.abs(vx) * 0.45;
                type[i] = EMPTY;
              }
            }

            // Fissuration profonde et rupture de cohésion (amplifiée pour le boulet à pointes)
            if ((isDry || isSpike) && rng() < (isSpike ? 0.90 : 0.75)) {
              const fissureLen = (isSpike ? 6 : 4) + Math.floor(rng() * 5);
              const dirY = rng() < 0.35 ? 1 : -1;
              const dirX = nx > 0 ? 1 : (nx < 0 ? -1 : (rng() < 0.5 ? -1 : 1));
              let fy = cy + dirY;
              let fx = cx + dirX;
              for (let fl = 0; fl < fissureLen && fy >= 0 && fy < GROUND_Y && fx >= 0 && fx < W; fl++, fy += dirY) {
                if (rng() < 0.4) fx += (rng() < 0.5 ? -1 : 1);
                const fi = fy * W + fx;
                if (isStructural(type[fi])) {
                  damage[fi] = Math.min(255, damage[fi] + (isSpike ? 150 : 115));
                  if (rng() < 0.85) {
                    type[fi] = rng() < 0.5 ? DRY : LOOSE;
                    this.vel[fi] = 0.5;
                  }
                }
              }
            }
          }
        } else if (rng() < 0.25 * (1 - d / R2)) {
          type[i] = EMPTY;
          this.spawnParticle(cx + 0.5, cy + 0.5, dx * 0.15 + (rng() - 0.5), -0.5 - rng() * 1.5, t);
        }
      }
    }
    // Le boulet de sable s'éparpille et dépose du sable au point d'impact
    // Le boulet en fer ou à pointes ne génère pas de sable additionnel
    if (isSandBall) {
      const lump = Math.round(Math.PI * ballR * ballR * 0.8);
      for (let k = 0; k < lump; k++) {
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * ballR;
        this.spawnParticle(
          x - nx * ballR + Math.cos(a) * rr, y - ny * ballR + Math.sin(a) * rr,
          vx * 0.15 + Math.cos(a) * rng() * 0.8, vy * 0.05 - rng() * 1.2,
          rng() < 0.5 ? LOOSE : DRY,
        );
      }
    }
    this.events.push({ type: 'impact', x, y, r: R, speed, isSpike });
    this.structDirty = true;
    this.quietTicks = 0;
  }

  /**
   * Détonation massive de la Grenade après 2.0 secondes :
   * Cratère géant, souffle puissant éjectant le sable sur les côtés,
   * destruction structurelle et vulnérabilité du Roi au souffle direct.
   */
  grenadeExplosion(x, y, ballR) {
    const { type, damage, rng } = this;
    const R = Math.min(18, 14 * this.ballScale);
    const R2 = R * 1.35;
    const x0 = Math.max(0, Math.floor(x - R2));
    const x1 = Math.min(W - 1, Math.ceil(x + R2));
    const y0 = Math.max(0, Math.floor(y - R2));
    const y1 = Math.min(H - 1, Math.ceil(y + R2));

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = cy * W + cx;
        const t = type[i];
        if (!isSand(t)) continue;
        const dx = cx + 0.5 - x;
        const dy = cy + 0.5 - y;
        const d = Math.hypot(dx, dy);
        if (d > R2) continue;

        // Cratère central et souffle dévastateur modéré
        if (d <= R * 0.75) {
          type[i] = EMPTY;
          this.vel[i] = 0;
          damage[i] = 0;

          // Éjection modérée du sable sur les côtés
          const sideSign = dx >= 0 ? 1 : -1;
          const lateralSpeed = (1.5 + rng() * 2.5) * (1 - d / R2);
          const verticalSpeed = -0.3 - rng() * 1.0;
          this.spawnParticle(
            cx + 0.5, cy + 0.5,
            sideSign * lateralSpeed + (rng() - 0.5) * 0.4,
            verticalSpeed,
            rng() < 0.6 ? LOOSE : DRY,
          );
        } else if (isStructural(t)) {
          // Onde de choc extérieure : endommage le sable structurel
          const f = Math.max(0, 1 - (d - R * 0.75) / (R2 - R * 0.75));
          damage[i] = Math.min(255, damage[i] + f * 95 * (0.8 + rng() * 0.4));
          if (damage[i] > 140 || rng() < f * 0.45) {
            type[i] = LOOSE;
            this.vel[i] = (dx >= 0 ? 1 : -1) * (0.8 + rng() * 1.4);
          }
        }
      }
    }

    // Le Roi est vulnérable uniquement si la grenade explose à proximité immédiate
    if (this.king) {
      const kDist = Math.hypot(this.king.x + KING_W / 2 - x, this.king.y + KING_H / 2 - y);
      if (kDist <= R * 0.85) {
        this.killKing('explosion');
        this.events.push({ type: 'kingHit', x, y });
      }
    }

    // Paquets d'éjectas latéraux modérés projetés à gauche et à droite
    for (let k = 0; k < 12; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const vx = side * (1.8 + rng() * 2.2);
      const vy = -0.5 - rng() * 1.4;
      this.spawnParticle(x + side * (1.5 + rng() * 2), y - rng() * 3, vx, vy, rng() < 0.5 ? LOOSE : DRY);
    }

    this.events.push({ type: 'grenadeExplosion', x, y, r: R });
    this.structDirty = true;
    this.quietTicks = 0;
  }

  stepKing() {
    const k = this.king;
    if (!k) return 0;

    // Vérifier si le Roi a du sable (mouillé, durci, granulaire ou sec) sur la tête ou qui l'écrase
    let sandTouchingHead = 0;
    const aboveY = k.y - 1;
    if (aboveY >= 0) {
      for (let x = 0; x < KING_W; x++) {
        const t = this.type[aboveY * W + k.x + x];
        if (t !== EMPTY && t !== GROUND && t !== KING) sandTouchingHead++;
      }
    }
    // Dégâts réguliers si du sable (mouillé, durci ou sec) repose sur la tête du Roi
    if (sandTouchingHead > 0 && this.tick % 8 === 0) {
      this.kingHit(1.2);
      if (aboveY >= 0) {
        for (let x = 0; x < KING_W; x++) {
          const idx = aboveY * W + k.x + x;
          const t = this.type[idx];
          if (t !== EMPTY && t !== GROUND && t !== KING) {
            this.type[idx] = EMPTY;
            this.vel[idx] = 0;
            this.damage[idx] = 0;
            this.structDirty = true;
          }
        }
      }
    }

    const by = k.y + KING_H;
    let supported = by >= H;
    if (!supported) {
      for (let x = 0; x < KING_W; x++) {
        if (this.type[by * W + k.x + x] !== EMPTY) {
          supported = true;
          break;
        }
      }
    }
    if (supported) {
      if (k.fallStart >= 0) {
        const fall = k.y - k.fallStart;
        if (fall > CONFIG.kingFallDeath) this.killKing('chute');
        k.fallStart = -1;
        k.vy = 0;
        this.events.push({ type: 'kingLand', fall });
      }

      // Déplacement autonome d'idle dans sa salle de sable si libre et solide sous ses pieds
      if (!k.dead && !this.drying) {
        k.idleTimer = (k.idleTimer || 0) + 1;
        if (k.idleTimer >= 200) {
          k.idleTimer = Math.floor(this.rng() * 60);
          const dir = this.rng() < 0.5 ? -1 : 1;
          const targetX = k.x + dir;
          if (targetX >= BUILD_MIN_X && targetX + KING_W <= BUILD_MAX_X) {
            let freeCol = true;
            const checkX = dir > 0 ? k.x + KING_W : k.x - 1;
            for (let y = 0; y < KING_H; y++) {
              const t = this.type[(k.y + y) * W + checkX];
              if (t !== EMPTY) { freeCol = false; break; }
            }
            let solidBelow = false;
            for (let x = 0; x < KING_W; x++) {
              const t = this.type[(k.y + KING_H) * W + targetX + x];
              if (t !== EMPTY) { solidBelow = true; break; }
            }
            if (freeCol && solidBelow) {
              this.clearKingCells();
              k.x = targetX;
              this.writeKingCells();
              this.structDirty = true;
              this.quietTicks = 0;
              return 1;
            }
          }
        }
      }
      return 0;
    }
    if (k.fallStart < 0) k.fallStart = k.y;
    k.vy = Math.min(CONFIG.grainMaxSpeed, k.vy + CONFIG.grainGravity);
    const steps = Math.max(1, k.vy | 0);
    this.clearKingCells();
    for (let s = 0; s < steps; s++) {
      const ny = k.y + KING_H;
      if (ny >= H) break;
      let free = true;
      for (let x = 0; x < KING_W; x++) if (this.type[ny * W + k.x + x] !== EMPTY) free = false;
      if (!free) break;
      k.y++;
    }
    this.writeKingCells();
    this.structDirty = true;
    return 1;
  }

  // ------------------------------------------------------------------ structure
  analyzeStructure() {
    const { type, vel, dist, damage, run } = this;
    const c = CONFIG;
    const isBuilding = !this.drying;
    const strength = Math.max(1, c.strength | 0);
    const INF = 65535;
    dist.fill(INF);
    const buckets = this.buckets;
    for (let d = 0; d <= strength; d++) {
      if (!buckets[d]) buckets[d] = [];
      else buckets[d].length = 0;
    }
    // sources : sable mouillé/durci posé sur le sol ou du sable granulaire compacté au repos (le Roi ne supporte pas de sable !)
    for (let i = 0; i < N - W; i++) {
      if (!isStructural(type[i])) continue;
      const b = i + W;
      const bt = type[b];
      if (bt === GROUND || (isGranular(bt) && vel[b] === 0)) {
        const d0 = damage[i] >> 1;
        if (d0 <= strength && d0 < dist[i]) {
          dist[i] = d0;
          buckets[d0].push(i);
        }
      }
    }
    // Détection des portées horizontales formant un pont (supportées aux deux extrémités avec un vide sous le milieu)
    const isBridge = this.isBridge;
    isBridge.fill(0);
    for (let y = 0; y < GROUND_Y - 1; y++) {
      let x = 0;
      while (x < W) {
        const i = y * W + x;
        if (!isStructural(type[i])) { x++; continue; }
        let e = x;
        while (e < W && isStructural(type[y * W + e])) e++;
        const spanLen = e - x;
        if (spanLen >= 8) {
          let supL = false;
          let supR = false;
          const checkW = Math.min(4, Math.floor(spanLen / 3));
          for (let k = 0; k < checkW; k++) {
            if (isStructural(type[(y + 1) * W + (x + k)])) supL = true;
            if (isStructural(type[(y + 1) * W + (e - 1 - k)])) supR = true;
          }
          if (supL && supR) {
            let hasGap = false;
            for (let k = x + checkW; k < e - checkW; k++) {
              if (!isStructural(type[(y + 1) * W + k])) {
                hasGap = true;
                break;
              }
            }
            if (hasGap) {
              for (let k = x; k < e; k++) isBridge[y * W + k] = 1;
            }
          }
        }
        x = e;
      }
    }
    // Propager isBridge verticalement sur l'épaisseur du tablier du pont
    for (let y = GROUND_Y - 2; y >= 1; y--) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (isBridge[i] && isStructural(type[i - W])) {
          isBridge[i - W] = 1;
        }
      }
    }

    // propagation (Dial) :
    // Les ponts supportés aux deux extrémités bénéficient d'un coût latéral réduit.
    // Les porte-à-faux non supportés dans le vide se détachent normalement.
    const costUp = c.costUp;
    const costDU = c.costDiagUp;
    const costS = c.costSide;
    const costDD = c.costDiagDown;
    const costD = c.costDown;

    const relax = (j, baseCost, prevDist) => {
      const tj = type[j];
      if (!isStructural(tj)) return;
      let effectiveBaseCost = baseCost;
      if (baseCost === costS) {
        effectiveBaseCost = isBridge[j] ? (isBuilding ? 1 : 3) : (isBuilding ? Math.min(baseCost, 8) : baseCost);
      } else if (baseCost === costDU || baseCost === costDD) {
        effectiveBaseCost = isBridge[j] ? 2 : baseCost;
      }
      const stepCost = tj === HARD ? Math.max(1, Math.round(effectiveBaseCost * 0.52)) : effectiveBaseCost;
      // En bataille, le sable qui sèche (moist < 50) subit une forte pénalité et devient cassant
      const dryPenalty = this.drying && (this.moist[j] < 50) ? Math.round((50 - this.moist[j]) * 0.85) : 0;
      const nd = prevDist + stepCost + (damage[j] >> 1) + dryPenalty;
      if (nd <= strength && nd < dist[j]) {
        dist[j] = nd;
        buckets[nd].push(j);
      }
    };
    for (let d = 0; d <= strength; d++) {
      const bucket = buckets[d];
      for (let q = 0; q < bucket.length; q++) {
        const i = bucket[q];
        if (dist[i] !== d) continue;
        const x = i % W;
        const hasL = x > 0;
        const hasR = x < W - 1;
        const hasU = i >= W;
        const hasD = i < N - W;
        if (hasU) {
          relax(i - W, costUp, d);
          if (hasL) relax(i - W - 1, costDU, d);
          if (hasR) relax(i - W + 1, costDU, d);
        }
        if (hasL) relax(i - 1, costS, d);
        if (hasR) relax(i + 1, costS, d);
        if (hasD) {
          relax(i + W, costD, d);
          if (hasL) relax(i + W - 1, costDD, d);
          if (hasR) relax(i + W + 1, costDD, d);
        }
      }
    }

    // largeur des rangées structurelles
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        const i = y * W + x;
        if (!isStructural(type[i])) {
          x++;
          continue;
        }
        let e = x;
        while (e < W && isStructural(type[y * W + e])) e++;
        const len = e - x;
        for (let k = x; k < e; k++) run[y * W + k] = len;
        x = e;
      }
    }

    const fails = [];
    const crush = [];
    for (let x = 0; x < W; x++) {
      let load = 0;
      for (let y = 0; y < GROUND_Y; y++) {
        const i = y * W + x;
        const t = type[i];
        if (isSand(t)) load++;
        else load = 0;
        if (!isStructural(t)) continue;
        if (dist[i] === INF) {
          fails.push(i);
          continue;
        }
        const mult = t === HARD ? 1.75 : 1.0;
        const dryFactor = this.moist[i] < 60 ? (0.42 + (this.moist[i] / 60) * 0.58) : 1.0;
        // Les ponts supportés aux deux bouts ne s'effondrent pas sous leur propre poids en construction
        const bridgeCapMult = isBridge[i] ? (isBuilding ? 10.0 : 1.8) : (isBuilding ? 3.0 : 1.0);
        const cap = c.loadPerWidth * mult * Math.min(run[i], c.loadWidthCap) * (1 - damage[i] / 420) * dryFactor * bridgeCapMult;
        if (load > cap) crush.push(i);
      }
    }

    let compTag = (this.bodyTag = ((this.bodyTag + 1) & 0x7fff) || 1);
    const { bodyId, queue, moist } = this;
    const failsSet = new Uint8Array(N);
    for (let k = 0; k < fails.length; k++) failsSet[fails[k]] = 1;

    for (let k = 0; k < fails.length; k++) {
      const start = fails[k];
      if (bodyId[start] === compTag) continue;

      let qh = 0, qt = 0;
      queue[qt++] = start;
      bodyId[start] = compTag;
      const compCells = [];
      let touchesSupported = false;
      let blockedBelow = false;
      let hitKing = false;

      while (qh < qt) {
        const cur = queue[qh++];
        compCells.push(cur);
        const cx = cur % W;
        const cy = (cur / W) | 0;

        const checkNb = (nb) => {
          if (nb < 0 || nb >= N) return;
          const nt = type[nb];
          if (isStructural(nt) && !failsSet[nb] && dist[nb] !== INF) {
            touchesSupported = true;
          }
        };
        if (cy > 0) checkNb(cur - W);
        if (cy + 1 < GROUND_Y) checkNb(cur + W);
        if (cx > 0) checkNb(cur - 1);
        if (cx < W - 1) checkNb(cur + 1);

        const belowY = cy + 1;
        if (belowY >= GROUND_Y) {
          blockedBelow = true;
        } else {
          const belowIdx = cur + W;
          const bt = type[belowIdx];
          if (bt !== EMPTY && !failsSet[belowIdx]) {
            if (bt === KING) {
              hitKing = true;
              this.kingHit(2.5);
              type[cur] = EMPTY;
              vel[cur] = 0;
              this.damage[cur] = 0;
              this.structDirty = true;
              continue;
            } else {
              blockedBelow = true;
            }
          }
        }

        if (cy > 0 && failsSet[cur - W] && bodyId[cur - W] !== compTag) {
          bodyId[cur - W] = compTag;
          queue[qt++] = cur - W;
        }
        if (belowY < GROUND_Y && failsSet[cur + W] && bodyId[cur + W] !== compTag) {
          bodyId[cur + W] = compTag;
          queue[qt++] = cur + W;
        }
        if (cx > 0 && failsSet[cur - 1] && bodyId[cur - 1] !== compTag) {
          bodyId[cur - 1] = compTag;
          queue[qt++] = cur - 1;
        }
        if (cx < W - 1 && failsSet[cur + 1] && bodyId[cur + 1] !== compTag) {
          bodyId[cur + 1] = compTag;
          queue[qt++] = cur + 1;
        }
      }

      if (hitKing) {
        // Le bloc de sable mouillé s'écrase sur le Roi : il éclate en mottes (LOOSE) et inflige de lourds dégâts d'impact
        for (let c = 0; c < compCells.length; c++) {
          const idx = compCells[c];
          type[idx] = LOOSE;
          vel[idx] = 1.0;
          damage[idx] = 0;
        }
      } else if (touchesSupported) {
        // Rupture de cisaillement d'un porte-à-faux dans le vide : se détache en mottes de sable mouillé (LOOSE)
        // Ne se transforme JAMAIS en sable sec spontané !
        for (let c = 0; c < compCells.length; c++) {
          const idx = compCells[c];
          type[idx] = LOOSE;
          vel[idx] = 0;
          damage[idx] = 0;
        }
      } else if (blockedBelow) {
        // Atterrissage au sol ou sur une structure : reste du sable mouillé solide !
        for (let c = 0; c < compCells.length; c++) {
          const idx = compCells[c];
          if (type[idx] === EMPTY) continue;
          vel[idx] = 0;
          damage[idx] = 0;
        }
      } else {
        if (!isBuilding) {
          // Pendant le combat : un bloc de construction non maintenu par du sable au sol tombe avec la physique du sable !
          for (let c = 0; c < compCells.length; c++) {
            const idx = compCells[c];
            type[idx] = (this.moist[idx] < 60) ? DRY : LOOSE;
            vel[idx] = 0.6 + this.rng() * 0.9;
            damage[idx] = 0;
          }
        } else {
          // À la construction : chute libre d'un seul bloc (atterrissage intact)
          compCells.sort((a, b) => b - a);
          for (let c = 0; c < compCells.length; c++) {
            const idx = compCells[c];
            const dest = idx + W;
            type[dest] = type[idx];
            vel[dest] = 0;
            damage[dest] = damage[idx];
            moist[dest] = moist[idx];

            type[idx] = EMPTY;
            vel[idx] = 0;
            damage[idx] = 0;
            moist[idx] = 0;
          }
        }
        this.structDirty = true;
        this.version++;
      }
    }
    for (const i of crush) {
      let j = i;
      for (let k = 0; k < 6 && j >= 0; k++, j -= W) {
        if (!isStructural(type[j])) break;
        type[j] = this.rng() < 0.45 ? DRY : LOOSE;
        vel[j] = 0;
        damage[j] = 0;
      }
    }
    const failed = fails.length + crush.length;
    this.stats.failedCells += failed;
    // En construction, la simple translation d'un bloc en l'air ne déclenche pas d'éboulement bruyant
    if (failed > 18 && !isBuilding) {
      this.events.push({ type: 'collapse', count: failed });
    }
    this.structDirty = failed > 0 || this.particles.length > 0;
    return failed;
  }

  // ------------------------------------------------------------------ sérialisation
  encode() {
    const { type, damage } = this;
    const out = new Uint8Array(N * 2);
    let o = 0;
    let prev = -1;
    let runLen = 0;
    for (let i = 0; i < N; i++) {
      let code = type[i];
      if (code === WET || code === HARD) {
        const d = damage[i];
        const lvl = d > 150 ? 3 : d > 90 ? 2 : d > 35 ? 1 : 0;
        const moistLvl = Math.min(7, Math.max(0, (this.moist[i] / 36.5) | 0));
        code |= (lvl << DMG_SHIFT) | (moistLvl << MOIST_SHIFT);
      }
      if (code === prev && runLen < 255) {
        runLen++;
      } else {
        if (runLen) {
          out[o++] = prev;
          out[o++] = runLen;
        }
        prev = code;
        runLen = 1;
      }
    }
    out[o++] = prev;
    out[o++] = runLen;
    return Buffer.from(out.slice(0, o));
  }

  encodeParticles() {
    const ps = this.particles;
    const arr = new Int16Array(ps.length * 2);
    for (let k = 0; k < ps.length; k++) {
      arr[k * 2] = Math.round(ps[k].x * 8);
      arr[k * 2 + 1] = Math.round(ps[k].y * 8);
    }
    return Buffer.from(arr.buffer.slice(0, arr.byteLength));
  }

  snapshot() {
    return {
      rle: this.encode(),
      parts: this.encodeParticles(),
      ball: this.ball
        ? {
          x: this.ball.x,
          y: this.ball.y,
          r: this.ball.r,
          spike: !!this.ball.spike,
          grenade: !!this.ball.grenade,
          iron: !!this.ball.iron,
          acid: !!this.ball.acid,
          sand: !!this.ball.sand,
          type: this.ball.type || (this.ball.acid ? 'acid' : this.ball.grenade ? 'grenade' : this.ball.spike ? 'spike' : this.ball.iron ? 'iron' : 'sand'),
          landed: !!this.ball.landed,
          fuseTicks: this.ball.fuseTicks || 0,
        }
        : null,
      king: this.king
        ? { x: this.king.x, y: this.king.y, dead: this.king.dead, hits: this.king.hits, maxHits: CONFIG.kingBuryGrains }
        : null,
    };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ outils (MCP / tests)
  countTypes() {
    const c = { wet: 0, hard: 0, dry: 0, loose: 0 };
    for (let i = 0; i < N; i++) {
      const t = this.type[i];
      if (t === WET) c.wet++;
      else if (t === HARD) c.hard++;
      else if (t === DRY) c.dry++;
      else if (t === LOOSE) c.loose++;
    }
    return c;
  }

  highestPoint() {
    for (let y = 0; y < GROUND_Y; y++)
      for (let x = 0; x < W; x++) if (isSand(this.type[y * W + x])) return GROUND_Y - y;
    return 0;
  }

  toAscii({ x0 = 96, x1 = W, sx = 2, sy = 3, rows = 30 } = {}) {
    const chars = { [EMPTY]: ' ', [GROUND]: '=', [WET]: '#', [HARD]: '@', [DRY]: '.', [LOOSE]: ':', [KING]: 'K' };
    const lines = [];
    const yStart = Math.max(0, GROUND_Y + sy - rows * sy);
    for (let y = yStart; y < GROUND_Y + sy; y += sy) {
      let line = '';
      for (let x = x0; x < x1; x += sx) {
        let best = EMPTY;
        for (let dy = 0; dy < sy; dy++)
          for (let dx = 0; dx < sx; dx++) {
            const t = this.type[(y + dy) * W + x + dx];
            if (t === KING) best = KING;
            else if (best !== KING && t === HARD) best = HARD;
            else if (best !== KING && best !== HARD && t === WET) best = WET;
            else if (best !== KING && !isStructural(best) && (t === LOOSE || t === DRY)) best = t;
            else if (best === EMPTY && t === GROUND) best = GROUND;
          }
        line += chars[best];
      }
      lines.push(line.replace(/\s+$/, ''));
    }
    return lines.join('\n');
  }
}
