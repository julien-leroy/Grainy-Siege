// IA avec 3 niveaux de difficulté associés à l'âge :
// - 👶 5 ans (Facile) : petit château simple, tir imprécis.
// - 🧒 12 ans (Moyen) : plus gros château, cherche les bonus en l'air, meilleure précision.
// - 👷‍♂️ 36 ans, Ingénieur chez Vinci (Difficile) : forteresse de génie civil massivement mouillée (T.HARD),
//   visée stratégique plongeante au-dessus du Roi pour l'ensevelir vite sous une pluie de sable !
import {
  GROUND_Y, KING_W, KING_H, LAUNCH_X, LAUNCH_Y, BALL_GRAVITY, GRID_W, GRID_H, launchVelocity,
} from '../shared/constants.js';

export const BOT_PROFILES = {
  '5yo': {
    id: '5yo',
    ageLabel: '5 ans',
    difficultyLabel: 'Facile',
    names: ['Timothée', 'Titouan', 'Enzo', 'Louka', 'Corentin', 'Mathéo', 'Antonin', 'Jules-Arthur'],
    taglines: [
      '5 ans, caca dans sa couche',
      '4 ans, confond ses pieds et ses mains',
      '5 ans, mange du sable au goûter',
      '3 ans et demi, pleure quand la vague arrive',
      '5 ans, tourne en rond les yeux fermés',
    ],
    skill: 0.68,
  },
  '12yo': {
    id: '12yo',
    ageLabel: '12 ans',
    difficultyLabel: 'Moyen',
    names: ['Kévin', 'Dylan', 'Bryan', 'Jordan', 'Killian', 'Rayan', 'Brandon', 'Maxence'],
    taglines: [
      '11 ans, joueur roblox',
      '13 ans, fait du skate',
      '12 ans, a une érection',
      '15 ans, la technique de la main dans la poche',
      '12 ans, écoute Jul en cachette',
      '14 ans, fume des allumettes',
    ],
    skill: 0.88,
  },
  '36yo': {
    id: '36yo',
    ageLabel: '36 ans, Ingénieur chez Vinci',
    difficultyLabel: 'Difficile',
    names: ['Jean-Eudes', 'Thierry', 'Hubert', 'Didier', 'Gonzague', 'Bertrand', 'Patrice', 'Alain-Michel'],
    taglines: [
      '42 ans, technicien btp',
      '32 ans, ingénieur en thermodynamique',
      '36 ans, conducteur de travaux autoroutiers',
      '38 ans, expert résistance des matériaux',
      '45 ans, chef de chantier chez Bouygues',
      '36 ans, Ingénieur chez Vinci',
    ],
    skill: 0.99,
  },
};

export function getBotName(difficulty = '5yo', i = 0) {
  const profile = BOT_PROFILES[difficulty] || BOT_PROFILES['5yo'];
  const name = profile.names[i % profile.names.length];
  const taglines = profile.taglines || [];
  const tag = taglines.length > 0 ? taglines[i % taglines.length] : profile.ageLabel;
  return `${name} (${tag})`;
}

// Rétrocompatibilité botName
export function botName(i) {
  return getBotName('5yo', i);
}

// ------------------------------------------------------------------ Modèles de châteaux selon la difficulté
// 1) 5 ans : petit château amateur d'enfant, quelques pièces posées rapidement
const TEMPLATES_5YO = [
  (kx) => [
    ['arche', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 18],
    ['tour', kx - 24, GROUND_Y - 14],
    ['tour', kx + 24, GROUND_Y - 14],
    ['pate', kx, GROUND_Y - 26],
  ],
  (kx) => [
    ['seau', kx - 14, GROUND_Y - 10],
    ['seau', kx + 14, GROUND_Y - 10],
    ['arche', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 18],
    ['pate', kx - 28, GROUND_Y - 4],
    ['pate', kx + 28, GROUND_Y - 4],
  ],
];

// 2) 12 ans : plus gros château, double donjon, rampes et bonne couche de spray
const TEMPLATES_12YO = [
  (kx) => [
    ['arche', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 18],
    ['donjon', kx - 32, GROUND_Y - 14],
    ['donjon', kx + 32, GROUND_Y - 14],
    ['spray', kx - 32, GROUND_Y - 14],
    ['spray', kx + 32, GROUND_Y - 14],
    ['rampe', kx - 56, GROUND_Y - 10],
    ['barbacane', kx + 52, GROUND_Y - 9],
    ['spray', kx - 56, GROUND_Y - 10],
  ],
  (kx) => [
    ['dome', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 16],
    ['colonne', kx - 26, GROUND_Y - 12],
    ['colonne', kx + 26, GROUND_Y - 12],
    ['spray', kx - 26, GROUND_Y - 12],
    ['spray', kx + 26, GROUND_Y - 12],
    ['mur', kx - 48, GROUND_Y - 6],
    ['mur', kx + 48, GROUND_Y - 6],
    ['cone', kx - 26, GROUND_Y - 32],
    ['cone', kx + 26, GROUND_Y - 32],
  ],
];

// 3) 36 ans, Ingénieur chez Vinci : forteresse de génie civil ultra optimisée, massivement arrosée (T.HARD)
const TEMPLATES_VINCI = [
  (kx) => [
    // Fondation & Arche de protection du Roi
    ['arche', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 18],
    // Dôme supérieur anti-perforation
    ['dome', kx, GROUND_Y - 26],
    ['spray', kx, GROUND_Y - 26],
    // Contreforts et bastions latéraux
    ['bastion', kx - 36, GROUND_Y - 14],
    ['bastion', kx + 36, GROUND_Y - 14],
    ['spray', kx - 36, GROUND_Y - 14],
    ['spray', kx + 36, GROUND_Y - 14],
    // Rampes obliques extérieures brise-impact (déviation cinétique)
    ['rampe', kx - 64, GROUND_Y - 10],
    ['rampe', kx + 60, GROUND_Y - 10],
    ['spray', kx - 64, GROUND_Y - 10],
    ['spray', kx + 60, GROUND_Y - 10],
    // Murs de crête protecteurs
    ['mur', kx - 20, GROUND_Y - 36],
    ['mur', kx + 20, GROUND_Y - 36],
    ['spray', kx, GROUND_Y - 36],
  ],
  (kx) => [
    // Double bunker voûté
    ['arche', kx, GROUND_Y - 12],
    ['spray', kx, GROUND_Y - 16],
    ['dalle', kx, GROUND_Y - 22],
    ['spray', kx, GROUND_Y - 22],
    // Colosses et tours d'angle
    ['colosse', kx - 38, GROUND_Y - 16],
    ['colosse', kx + 38, GROUND_Y - 16],
    ['spray', kx - 38, GROUND_Y - 16],
    ['spray', kx + 38, GROUND_Y - 16],
    // Glacis incliné double flanc
    ['barbacane', kx - 62, GROUND_Y - 10],
    ['barbacane', kx + 58, GROUND_Y - 10],
    ['spray', kx - 62, GROUND_Y - 10],
    ['spray', kx + 58, GROUND_Y - 10],
    // Toiture blindée durcie
    ['cone', kx - 38, GROUND_Y - 38],
    ['cone', kx + 38, GROUND_Y - 38],
    ['spray', kx, GROUND_Y - 28],
  ],
];

export function makeBuildPlan(rng, buildMs, kingX = 210, difficulty = '5yo') {
  const kx = Math.round(kingX);
  let pool = TEMPLATES_5YO;
  if (difficulty === '36yo') pool = TEMPLATES_VINCI;
  else if (difficulty === '12yo') pool = TEMPLATES_12YO;

  const tpl = pool[Math.floor(rng() * pool.length)](kx);
  const plan = [];
  let t = 1200 + rng() * 1000;
  const spacing = Math.min(3600, (buildMs - 5000) / tpl.length);
  for (const [shape, x, y] of tpl) {
    const jitter = (shape === 'arche' || shape === 'dome' || shape === 'spray') ? 0 : Math.round((rng() - 0.5) * 2);
    plan.push({ at: t, shape, x: x + jitter, y });
    t += spacing * (0.8 + rng() * 0.4);
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

/**
 * Calcul du tir du bot selon son âge / niveau de difficulté :
 * - 5yo : tir imprécis vers le Roi
 * - 12yo : plus précis, et cherche à toucher les bonus parachutés en vol
 * - 36yo (Vinci) : visée stratégique plongeante au-dessus du Roi adverse pour l'ensevelir vite sous le sable !
 */
export function botShot(world, rng, difficultyOrSkill = '5yo', shooter = null, drops = []) {
  let difficulty = '5yo';
  let skill = 0.72;

  if (typeof difficultyOrSkill === 'number') {
    skill = difficultyOrSkill;
    difficulty = skill >= 0.95 ? '36yo' : skill >= 0.82 ? '12yo' : '5yo';
  } else if (typeof difficultyOrSkill === 'string') {
    difficulty = difficultyOrSkill;
    const profile = BOT_PROFILES[difficulty] || BOT_PROFILES['5yo'];
    skill = profile.skill;
  }

  const k = world.king;
  let tx = k ? k.x + KING_W / 2 : 210;
  let ty = k ? k.y + KING_H / 2 : GROUND_Y - 10;
  let requestedAmmo = null;

  // 1. Bot 12 ans : cherche activement les caisses de bonus en l'air si possible !
  if (difficulty === '12yo' && Array.isArray(drops) && drops.length > 0) {
    const airborne = drops.find((d) => !d.collected && !d.inWater && !d.sunk && d.y < GROUND_Y - 16);
    if (airborne && rng() < 0.75) {
      tx = airborne.x;
      ty = airborne.y;
    }
  }

  // 2. Bot 36 ans (Ingénieur chez Vinci) :
  // Vise stratégiquement à la verticale au-dessus du Roi (tx, ty - 14) pour créer une avalanche de sable
  // qui ensevelit le Roi adverse de façon chirurgicale !
  if (difficulty === '36yo' && k && !k.dead) {
    tx = k.x + KING_W / 2;
    ty = Math.max(GROUND_Y - 45, k.y - 14); // Impact juste au-dessus du toit du Roi
  }

  // Choix intelligent des munitions si le bot possède des bonus
  if (shooter && shooter.ammoInventory) {
    const inv = shooter.ammoInventory;
    if (difficulty === '36yo') {
      if ((inv.grenade || 0) > 0) requestedAmmo = 'grenade';
      else if ((inv.acid || 0) > 0) requestedAmmo = 'acid';
      else if ((inv.iron || 0) > 0) requestedAmmo = 'iron';
      else if ((inv.heavySpikeBall || 0) > 0) requestedAmmo = 'heavySpikeBall';
    } else if (difficulty === '12yo') {
      if ((inv.iron || 0) > 0 && rng() < 0.6) requestedAmmo = 'iron';
      else if ((inv.acid || 0) > 0 && rng() < 0.6) requestedAmmo = 'acid';
      else if ((inv.grenade || 0) > 0 && rng() < 0.6) requestedAmmo = 'grenade';
    }
  }

  const s = solveShot(tx, ty, world.wind);
  const noise = (1 - skill) * 0.25;

  return {
    angle: Math.max(0.1, Math.min(1.5, s.angle + (rng() - 0.5) * noise)),
    power: Math.max(0.1, Math.min(1, s.power + (rng() - 0.5) * noise * 0.8)),
    ammoType: requestedAmmo,
  };
}
