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
  // 1) Forteresse Voûtée Royale : Arche au centre + Tours de flanc + Glacis incliné
  (kx) => [
    ['arche', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 20],
    ['tour', kx - 26, GROUND_Y - 16],
    ['tour', kx + 26, GROUND_Y - 16],
    ['spray', kx - 26, GROUND_Y - 16],
    ['spray', kx + 26, GROUND_Y - 16],
    ['rampe', kx - 45, GROUND_Y - 10],
    ['barbacane', kx + 41, GROUND_Y - 9],
    ['spray', kx - 45, GROUND_Y - 10],
    ['spray', kx + 41, GROUND_Y - 9],
  ],
  // 2) Bunker Dôme Blindé : Dôme au centre + Donjons latéraux + Pente anti-boulets
  (kx) => [
    ['dome', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 16],
    ['donjon', kx - 34, GROUND_Y - 14],
    ['donjon', kx + 34, GROUND_Y - 14],
    ['spray', kx - 34, GROUND_Y - 14],
    ['spray', kx + 34, GROUND_Y - 14],
    ['rampe', kx - 59, GROUND_Y - 10],
    ['barbacane', kx + 55, GROUND_Y - 9],
    ['spray', kx - 59, GROUND_Y - 10],
  ],
  // 3) Citadelle Royale : Arche centrale + Murs crénelés + Colonnes + Chapeaux pointus
  (kx) => [
    ['arche', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 18],
    ['colonne', kx - 25, GROUND_Y - 12],
    ['colonne', kx + 25, GROUND_Y - 12],
    ['spray', kx - 25, GROUND_Y - 12],
    ['spray', kx + 25, GROUND_Y - 12],
    ['mur', kx - 46, GROUND_Y - 5],
    ['mur', kx + 46, GROUND_Y - 5],
    ['spray', kx - 46, GROUND_Y - 5],
    ['spray', kx + 46, GROUND_Y - 5],
    ['cone', kx - 25, GROUND_Y - 32],
    ['cone', kx + 25, GROUND_Y - 32],
  ],
  // 4) Bastion Lourd : Colonnes + Dalle + Arche + Glacis double
  (kx) => [
    ['arche', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 18],
    ['donjon', kx - 33, GROUND_Y - 14],
    ['tour', kx + 27, GROUND_Y - 16],
    ['spray', kx - 33, GROUND_Y - 14],
    ['spray', kx + 27, GROUND_Y - 16],
    ['rampe', kx - 58, GROUND_Y - 10],
    ['rampe', kx + 46, GROUND_Y - 10],
    ['spray', kx - 58, GROUND_Y - 10],
    ['spray', kx + 46, GROUND_Y - 10],
  ],
];

export function makeBuildPlan(rng, buildMs, kingX = 210) {
  const kx = Math.round(kingX);
  const tpl = TEMPLATES[Math.floor(rng() * TEMPLATES.length)](kx);
  const plan = [];
  let t = 1400 + rng() * 1200;
  const spacing = Math.min(4200, (buildMs - 7000) / tpl.length);
  for (const [shape, x, y] of tpl) {
    const jitter = (shape === 'arche' || shape === 'dome') ? 0 : Math.round((rng() - 0.5) * 2);
    plan.push({ at: t, shape, x: x + jitter, y });
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
