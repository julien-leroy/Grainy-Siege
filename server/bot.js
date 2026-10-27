// IA simple pour remplir une partie : construit un joli château varié (avec arches, bunkers, spray)
// et tire à la catapulte avec une précision imparfaite.
import {
  GROUND_Y, KING_W, KING_H, LAUNCH_X, LAUNCH_Y, BALL_GRAVITY, GRID_W, GRID_H, launchVelocity,
} from '../shared/constants.js';

const BOT_NAMES = ['Crabe Royal', 'Mouette Futée', 'Bernard l\'Ermite', 'Pelle & Râteau', 'Capitaine Seau', 'Sir Coquillage', 'Oursin Piquant', 'Méduse Turbo'];

export function botName(i) {
  return BOT_NAMES[i % BOT_NAMES.length];
}

const TEMPLATES = [
  // 1) Forteresse sous Arche + Piliers latéraux + Dôme blindé + Spray
  (kx) => [
    ['king', kx, GROUND_Y - 5],
    ['cube', kx - 14, GROUND_Y - 8],
    ['cube', kx + 14, GROUND_Y - 8],
    ['arche', kx, GROUND_Y - 14],
    ['spray', kx, GROUND_Y - 18],
    ['tour', kx - 28, GROUND_Y - 16],
    ['tour', kx + 28, GROUND_Y - 16],
    ['rampe', kx - 48, GROUND_Y - 10],
    ['dalle', kx, GROUND_Y - 26],
    ['spray', kx - 28, GROUND_Y - 16],
    ['cone', kx, GROUND_Y - 38],
  ],
  // 2) Bunker Dôme avec double glacis et remparts
  (kx) => [
    ['king', kx, GROUND_Y - 5],
    ['cube', kx - 20, GROUND_Y - 8],
    ['cube', kx + 20, GROUND_Y - 8],
    ['dalle', kx, GROUND_Y - 14],
    ['dome', kx, GROUND_Y - 22],
    ['spray', kx, GROUND_Y - 22],
    ['rampe', kx - 52, GROUND_Y - 10],
    ['tour', kx - 38, GROUND_Y - 16],
    ['spray', kx - 38, GROUND_Y - 18],
    ['cone', kx, GROUND_Y - 36],
  ],
  // 3) Citadelle haute avec le Roi au 1er étage sous une arche
  (kx) => [
    ['cube', kx - 16, GROUND_Y - 8],
    ['cube', kx + 16, GROUND_Y - 8],
    ['dalle', kx, GROUND_Y - 16],
    ['spray', kx, GROUND_Y - 16],
    ['king', kx, GROUND_Y - 24],
    ['tour', kx - 26, GROUND_Y - 24],
    ['tour', kx + 26, GROUND_Y - 24],
    ['arche', kx, GROUND_Y - 30],
    ['spray', kx, GROUND_Y - 32],
    ['rampe', kx - 54, GROUND_Y - 10],
  ],
];

export function makeBuildPlan(rng, buildMs) {
  const kx = 180 + Math.floor(rng() * 65);
  const tpl = TEMPLATES[Math.floor(rng() * TEMPLATES.length)](kx);
  const plan = [];
  let t = 1400 + rng() * 1200;
  const spacing = Math.min(4200, (buildMs - 7000) / tpl.length);
  for (const [shape, x, y] of tpl) {
    plan.push({ at: t, shape, x: x + Math.round((rng() - 0.5) * 4), y });
    t += spacing * (0.75 + rng() * 0.5);
  }
  return plan;
}

/** Cherche (angle, puissance) pour atteindre (tx, ty) en tenant compte du vent. */
export function solveShot(tx, ty, wind) {
  let best = { angle: Math.PI / 4, power: 0.5, err: Infinity };
  for (let a = 10; a <= 80; a += 1) {
    const angle = (a * Math.PI) / 180;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const v = launchVelocity(angle, p);
      let x = LAUNCH_X, y = LAUNCH_Y, vx = v.vx, vy = v.vy;
      let err = Infinity;
      for (let s = 0; s < 700; s++) {
        vy += BALL_GRAVITY;
        vx += wind;
        x += vx;
        y += vy;
        const d = Math.hypot(x - tx, y - ty);
        if (d < err) err = d;
        if (y > GROUND_Y || x > GRID_W + 10 || y > GRID_H) break;
      }
      if (err < best.err) best = { angle, power: p, err };
    }
  }
  return best;
}

export function botShot(world, rng, skill = 0.75) {
  const k = world.king;
  const tx = k ? k.x + KING_W / 2 : 200;
  const ty = k ? k.y + KING_H / 2 : GROUND_Y - 10;
  const s = solveShot(tx, ty, world.wind);
  const noise = (1 - skill) * 0.25;
  return {
    angle: s.angle + (rng() - 0.5) * noise,
    power: Math.max(0, Math.min(1, s.power + (rng() - 0.5) * noise * 0.8)),
  };
}
