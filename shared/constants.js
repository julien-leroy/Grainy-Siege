// Constantes partagées entre le serveur (Node) et le client (navigateur).
// Toutes les distances sont exprimées en "cellules" de sable.

export const GRID_W = 420;
export const GRID_H = 170;
export const GROUND_Y = 150; // première ligne de sol (plage compacte)

// Zone constructible élargie (château centré entre 100 et 320, largeur = 220, centre à 210)
export const BUILD_MIN_X = 100;
export const BUILD_MAX_X = 320;

// Catapultes strictement symétriques (24 cellules de chaque côté du château agrandi)
export const CATAPULT_X = 64;
export const LAUNCH_X = 76;
export const LAUNCH_Y = GROUND_Y - 30;
export const CATAPULT_RIGHT_X = GRID_W - CATAPULT_X; // 356
export const LAUNCH_RIGHT_X = GRID_W - LAUNCH_X;     // 344

// Le roi
export const KING_W = 5;
export const KING_H = 8;

// Spray d'eau durcisseur
export const SPRAY_RADIUS = 13;
export const SPRAY_COOLDOWN_MS = 3200;

// Types de cellules
export const T = Object.freeze({
  EMPTY: 0,
  GROUND: 1, // sol de plage, indestructible
  WET: 2, // sable mouillé structurel (pâté)
  DRY: 3, // sable sec, granulaire
  LOOSE: 4, // mottes de sable mouillé effondré (granulaire mais cohésif)
  KING: 5,
  HARD: 6, // sable mouillé durci au spray d'eau (plus sombre, plus résistant aux chocs et porte-à-faux)
});

// Encodage réseau : type sur 3 bits (0..7), niveau d'endommagement (0..3) sur les bits 3-4,
// niveau d'humidité (0 = sec .. 7 = détrempé) sur les bits 5-7 (sable cohésif uniquement)
export const TYPE_MASK = 0b111;
export const DMG_SHIFT = 3;
export const MOIST_SHIFT = 5;

// Humidité (0..255) : le sable fraîchement moulé est mouillé, le spray le détrempe.
export const MOIST_BUILD = 255;
export const MOIST_SPRAY = 255;

export const BUILD_SECONDS = 60;
export const AIM_SECONDS = 45;
export const SHOTS_PER_TURN = 2;
export const BUILD_PLACE_COOLDOWN_MS = 3000;
export const PATE_COOLDOWN_MS = 800;
export const PATTERN_PATE_COOLDOWN_MS = 500; // Cooldown spécifique au pâté après la pose d'un patron
export const DEFENSE_SPRAY_MAX = 1;
export const MAX_AMMO_RESERVE = 3;
export const MAX_DEFENSE_SPRAYS = 3;
export const TICK_RATE = 60;

// Balistique de la catapulte (cellules / tick)
export const BALL_GRAVITY = 0.05;
export const BALL_SPEED_MIN = 1.2;
export const BALL_SPEED_MAX = 4.0;
export const BALL_RADIUS = 3.2;

export const PLAYER_COLORS = [
  '#e4572e', '#2e86ab', '#76b041', '#f3a712', '#a23b72', '#17bebb', '#ff6f91', '#6c5b7b',
];

export function launchVelocity(angle, power) {
  const p = Math.max(0, Math.min(1, power));
  const s = BALL_SPEED_MIN + p * (BALL_SPEED_MAX - BALL_SPEED_MIN);
  return { vx: Math.cos(angle) * s, vy: -Math.sin(angle) * s };
}
