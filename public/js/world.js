// Copie locale (côté navigateur) d'un monde de sable reçu du serveur.
import { GRID_W, GRID_H, TYPE_MASK } from '/shared/constants.js';

const N = GRID_W * GRID_H;

function toUint8Array(buf) {
  if (!buf) return new Uint8Array(0);
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (buf.data && Array.isArray(buf.data)) return new Uint8Array(buf.data);
  if (buf.buffer instanceof ArrayBuffer) {
    return new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength || buf.length);
  }
  return new Uint8Array(buf);
}

export class ClientWorld {
  constructor(pid) {
    this.pid = pid;
    this.cells = new Uint8Array(N);
    this.parts = new Int16Array(0);
    this.ball = null;
    this.prevBall = null;
    this.ballT = 0;
    this.king = null;
    this.version = 0;
    this.receivedAt = 0;
    // sol par défaut, pour un affichage immédiat
    for (let i = 150 * GRID_W; i < N; i++) this.cells[i] = 1;
  }

  apply(msg) {
    const rle = toUint8Array(msg.rle);
    let o = 0;
    for (let k = 0; k < rle.length; k += 2) {
      const v = rle[k];
      const n = rle[k + 1];
      this.cells.fill(v, o, o + n);
      o += n;
    }
    const rawParts = toUint8Array(msg.parts);
    this.parts = new Int16Array(rawParts.buffer, rawParts.byteOffset, rawParts.byteLength >> 1);
    const now = performance.now();
    if (msg.ball) {
      this.prevBall = this.ball ? { ...this.ball } : { ...msg.ball };
      this.ball = msg.ball;
      this.ballDt = Math.min(80, Math.max(16, now - this.ballT));
      this.ballT = now;
    } else {
      this.ball = null;
      this.prevBall = null;
    }
    this.king = msg.king;
    this.version++;
    this.receivedAt = now;
  }

  ballPosition(now) {
    if (!this.ball) return null;
    const a = this.prevBall || this.ball;
    const b = this.ball;
    const dt = Math.max(16, this.ballDt || 33);
    const t = Math.max(0, Math.min(1.2, (now - this.ballT) / dt));
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      r: b.r,
      spike: !!b.spike,
      grenade: !!b.grenade,
      landed: !!b.landed,
      fuseTicks: b.fuseTicks || 0,
    };
  }

  isSolid = (x, y) => {
    if (x < 0 || x >= GRID_W || y >= GRID_H) return true;
    if (y < 0) return false;
    const t = this.cells[y * GRID_W + x] & TYPE_MASK;
    return t !== 0 && t !== 5; // 5 = T.KING
  };

  cellType = (x, y) => {
    if (x < 0 || x >= GRID_W || y >= GRID_H) return 1;
    if (y < 0) return 0;
    return this.cells[y * GRID_W + x] & TYPE_MASK;
  };

  flatten(cx, cy, width = 16) {
    const x0 = Math.max(0, Math.floor(cx - width / 2));
    const x1 = Math.min(GRID_W - 1, Math.ceil(cx + width / 2));
    const targetY = Math.max(0, Math.min(150, Math.round(cy)));
    for (let x = x0; x <= x1; x++) {
      for (let y = Math.max(0, targetY - 6); y < targetY; y++) {
        const i = y * GRID_W + x;
        const t = this.cells[i] & TYPE_MASK;
        if (t !== 0 && t !== 1 && t !== 5) {
          this.cells[i] = 0;
        }
      }
      const i = targetY * GRID_W + x;
      if ((this.cells[i] & TYPE_MASK) === 0) {
        this.cells[i] = 2 | (5 << 5); // WET moist 5
      }
    }
    this.version++;
  }

  dig(cx, cy, radius = 5) {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(GRID_W - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(150, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius) continue;
        const i = y * GRID_W + x;
        const t = this.cells[i] & TYPE_MASK;
        if (t !== 0 && t !== 1 && t !== 5) {
          this.cells[i] = 0;
        }
      }
    }
    this.version++;
  }
}
