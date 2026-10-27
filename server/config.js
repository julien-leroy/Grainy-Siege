// Paramètres physiques réglables à chaud (via l'API /api/config ou le serveur MCP).
export const DEFAULT_CONFIG = Object.freeze({
  grainGravity: 0.22, // accélération des grains (cellules/tick²)
  grainMaxSpeed: 5, // vitesse max des grains
  looseSlideChance: 0.3, // probabilité qu'une motte mouillée glisse en diagonale
  looseCrumbleChance: 0.55, // probabilité qu'une motte qui tombe vite s'effrite en sable sec
  impactDamage: 14, // dégâts infligés au sable mouillé par un grain qui le percute (×vitesse)

  // Cohésion du sable mouillé : coût du transport de la "tenue" d'une cellule à sa voisine
  costUp: 1, // cellule posée sur une cellule tenue (compression : très solide)
  costDiagUp: 12,
  costSide: 11, // permet aux ponts de tenir entre deux piliers (0 grain sec) tout en détachant les porte-à-faux dans le vide
  costDiagDown: 14,
  costDown: 16, // cellule suspendue sous une autre
  strength: 200, // tenue maximale : au-delà la cellule se détache

  // Charge : une cellule supporte loadPerWidth × (largeur de la rangée, plafonnée)
  loadPerWidth: 12,
  loadWidthCap: 10,
  structureInterval: 3, // ticks entre deux analyses de structure

  // Catapulte
  craterBase: 3.5,
  craterPerSpeed: 1.0,
  craterMax: 11,
  shockFactor: 2.3, // rayon de l'onde de choc = cratère × shockFactor
  shockDamage: 190,
  shockLooseChance: 0.45,
  ejectaRatio: 0.65,
  windMax: 0.0045,
  ballGrowthPerRound: 0.08,

  // Le roi : résistant aux petits éboulis (10 grains nécessaires)
  kingBuryGrains: 10, // grains qui lui tombent dessus avant qu'il soit enseveli
  kingFallDeath: 34, // chute mortelle (en cellules)
});

export const CONFIG = { ...DEFAULT_CONFIG };

export function updateConfig(patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (k in DEFAULT_CONFIG && typeof v === 'number' && Number.isFinite(v)) CONFIG[k] = v;
  }
  return { ...CONFIG };
}

export function resetConfig() {
  Object.assign(CONFIG, DEFAULT_CONFIG);
  return { ...CONFIG };
}
