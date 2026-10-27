// Les moules à pâtés de sable. Partagé client/serveur.
// Chaque forme est un masque binaire w×h (1 = sable).
import { BUILD_MIN_X, BUILD_MAX_X, GRID_H, GROUND_Y } from './constants.js';

function make(id, label, desc, w, h, fn) {
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (fn(x, y, w, h)) {
        mask[y * w + x] = 1;
        count++;
      }
    }
  }
  return { id, label, desc, w, h, mask, count };
}

// Créneaux : merlons de largeur mw séparés de gaps de largeur gw, sur ch lignes
function crenel(x, y, w, ch, mw, gw) {
  if (y >= ch) return true;
  const period = mw + gw;
  const total = Math.floor((w + gw) / period) * period - gw;
  const off = Math.floor((w - total) / 2);
  const xx = x - off;
  if (xx < 0 || xx >= total) return false;
  return xx % period < mw;
}

export const SHAPES = [
  // 0) Pâté de sable : motte organique asymétrique façonnée rapidement à la main (0.8s)
  make('pate', 'Pâté', 'Petite motte organique tassée à la main', 7, 5, (x, y) => {
    const rows = [
      [2, 4], // sommet arrondi
      [1, 5],
      [0, 6],
      [0, 5], // flanc asymétrique
      [1, 4], // base
    ];
    const r = rows[y];
    return r && x >= r[0] && x <= r[1];
  }),

  // 1) Seau classique : tronc de cône renversé + créneaux
  make('seau', 'Seau', 'Le grand classique bien tassé', 26, 24, (x, y, w, h) => {
    const t = y / (h - 1);
    const half = 10.5 + t * 2.5;
    if (Math.abs(x - (w - 1) / 2) > half) return false;
    if (y < 4) return x >= 2 && x <= 23 && crenel(x - 2, y, 22, 4, 4, 2);
    return true;
  }),

  // 2) Arche royale : grande voûte pour abriter le Roi dessous !
  make('arche', 'Arche', 'Voûte idéale pour abriter le Roi', 35, 20, (x, y, w, h) => {
    const cx = (w - 1) / 2;
    const r = 11.5;
    const dx = x - cx;
    const dy = y - (h - 1);
    if (dx * dx + dy * dy < r * r) return false;
    if (y < 3) return crenel(x, y, w, 3, 3, 2);
    return true;
  }),

  // 3) Bunker Dôme : coque semi-circulaire creuse qui dévie les boulets
  make('dome', 'Bunker', 'Dôme creux blindé au-dessus du Roi', 34, 18, (x, y, w, h) => {
    const cx = (w - 1) / 2;
    const dx = x - cx;
    const dy = y - (h - 1);
    const rOut = 16.8;
    const rIn = 9.2;
    const d2 = dx * dx + dy * dy * 1.15;
    return d2 <= rOut * rOut && d2 >= rIn * rIn;
  }),

  // 4) Tour de garde : haute et élancée avec meurtrière centrale
  make('tour', 'Tour', 'Haute tour à créneaux et meurtrière', 12, 32, (x, y, w) => {
    if (y < 3) return crenel(x, y, w, 3, 2, 2);
    if (y >= 11 && y <= 16 && (x === 5 || x === 6)) return false;
    return true;
  }),

  // 5) Rempart crénelé : mur épais de défense frontale
  make('mur', 'Rempart', 'Muraille crénelée contre les tirs tendus', 41, 10, (x, y, w) => {
    if (y < 3) return crenel(x, y, w, 3, 3, 2);
    return true;
  }),

  // 6) Bouclier incliné : rampe épaisse côté catapulte pour encaisser les boulets
  make('rampe', 'Glacis', 'Rampe inclinée anti-boulets', 26, 20, (x, y, w, h) => {
    const minY = Math.floor((1 - x / (w - 1)) * (h - 4));
    return y >= minY;
  }),

  // 7) Pont / Dalle : poutre horizontale pour fermer un toit entre deux piliers
  make('dalle', 'Pont', 'Dalle horizontale pour couvrir deux tours', 36, 5, (x, y, w) => {
    if (y === 0) return crenel(x, y, w, 1, 4, 2);
    return true;
  }),

  // 8) Pyramide / Toit pointu : Chapeau de château
  make('cone', 'Pyramide', 'Toit pointu qui répartit la charge', 24, 16, (x, y, w, h) => {
    const half = ((y + 1) / h) * (w / 2);
    return Math.abs(x - (w - 1) / 2) <= half;
  }),

  // 9) Petit bloc : brique rapide pour boucher un trou ou faire un pilier
  make('cube', 'Pavé', 'Bloc compact passe-partout', 14, 14, () => true),

  // 10) Donjon fortifié : grande forteresse à créneaux et doubles meurtrières
  make('donjon', 'Donjon', 'Grand fort blindé avec créneaux et meurtrières', 24, 28, (x, y, w) => {
    if (y < 4) return crenel(x, y, w, 4, 3, 2);
    if (y >= 10 && y <= 16 && (x === 6 || x === 7 || x === 16 || x === 17)) return false;
    return true;
  }),

  // 11) Escalier / Bastion à gradins
  make('escalier', 'Bastion', 'Gradins étagés pour terrasses défensives', 24, 18, (x, y) => {
    const tier = Math.floor(x / 8); // 0, 1, 2
    const minTierY = (2 - tier) * 6;
    return y >= minTierY;
  }),

  // 12) Châtelet / Porte fortifiée avec voûte de passage
  make('porte', 'Châtelet', 'Porte royale fortifiée avec voûte', 32, 22, (x, y, w) => {
    const cx = (w - 1) / 2;
    const dx = Math.abs(x - cx);
    if (dx <= 6 && y >= 8) return false;
    if (y < 3) return crenel(x, y, w, 3, 3, 2);
    return true;
  }),

  // 13) Colonne romaine de soutènement
  make('colonne', 'Pilier', 'Colonne robuste pour soutenir les toitures', 8, 24, (x, y, w, h) => {
    if (y < 3 || y >= h - 3) return true;
    return x >= 1 && x <= 6;
  }),

  // 14) Barbacane / Tourelle arrondie en encorbellement
  make('barbacane', 'Barbacane', 'Tourelle arrondie pour fortifier un angle', 18, 18, (x, y, w) => {
    const cx = (w - 1) / 2;
    const cy = (w - 1) / 2;
    const dx = x - cx;
    const dy = y - cy;
    if (y < 3) return crenel(x, y, w, 3, 2, 2);
    return dx * dx + dy * dy <= 72;
  }),
];

export const SHAPE_BY_ID = Object.fromEntries(SHAPES.map((s) => [s.id, s]));

export function overlaps(isSolid, shape, left, top) {
  const { w, h, mask } = shape;
  for (let y = 0; y < h; y++) {
    const gy = top + y;
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (gy < 0) continue;
      if (gy >= GRID_H || isSolid(left + x, gy)) return true;
    }
  }
  return false;
}

export function getFlippedShape(shape) {
  if (!shape) return shape;
  if (shape._flippedVersion) return shape._flippedVersion;
  const { id, label, desc, w, h, mask, count } = shape;
  const flippedMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      flippedMask[y * w + (w - 1 - x)] = mask[y * w + x];
    }
  }
  const flipped = { id, label: `${label} 🔄`, desc, w, h, mask: flippedMask, count, flipped: true };
  shape._flippedVersion = flipped;
  flipped._flippedVersion = shape;
  return flipped;
}

export function getShape(shapeId, flipped = false) {
  const base = SHAPE_BY_ID[shapeId];
  if (!base) return null;
  return flipped ? getFlippedShape(base) : base;
}

export function isNearKing(gx, gy, king) {
  if (!king) return false;
  // Safe zone : interdiction de coller du sable contre le Roi (1 cellule de marge sur les côtés et au-dessus)
  return gx >= king.x - 1 && gx <= king.x + 5 && gy >= king.y - 1 && gy < king.y + 8;
}

/**
 * Placement « au curseur » (gameplay) : le moule est rempli de sable mouillé exactement
 * là où le joueur clique (seules les cellules vides sont remplies), puis la gravité fait
 * le reste : le bloc tombe d'un seul tenant tant qu'il n'est relié à rien.
 * Le moule ne peut PAS entrer dans la safe zone protégée du Roi.
 */
export function spawnPosition(cellType, shape, cx, cy, king = null) {
  let left = Math.round(cx - shape.w / 2);
  left = Math.max(BUILD_MIN_X, Math.min(BUILD_MAX_X - shape.w, left));
  let top = Math.round(cy - shape.h / 2);
  top = Math.max(0, Math.min(GROUND_Y - shape.h, top));
  const { w, h, mask } = shape;
  let free = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const gx = left + x;
      const gy = top + y;
      if (king && typeof king === 'object' && isNearKing(gx, gy, king)) {
        return { left, top, valid: false, nearKing: true, free: 0 };
      }
      const t = cellType(gx, gy);
      if (t === 0) free++;
    }
  }
  return { left, top, valid: free > 0, free };
}

/**
 * Calcule où un pâté posé sous le curseur (cx, cy) se place :
 * - On respecte la hauteur du curseur ! Si la forme est posée dans une cavité,
 *   entre deux murs ou au-dessus du Roi (ex: une arche qui l'entoure sans le toucher),
 *   elle ne saute PAS tout en haut du château : elle descend uniquement jusqu'au
 *   premier appui sous le curseur.
 * - Si le curseur mord légèrement dans le sol ou un bloc existant, on la remonte
 *   juste de quelques cellules pour dégager le chevauchement.
 */
export function dropPosition(isSolid, shape, cx, cy, freePlace = true) {
  let left = Math.round(cx - shape.w / 2);
  left = Math.max(BUILD_MIN_X, Math.min(BUILD_MAX_X - shape.w, left));
  let top = Math.round(cy - shape.h / 2);
  top = Math.max(0, Math.min(GROUND_Y - shape.h, top));

  if (overlaps(isSolid, shape, left, top)) {
    // Si ça chevauche du sable ou le sol, on remonte jusqu'à un appui libre
    while (top > -shape.h && overlaps(isSolid, shape, left, top)) top--;
  } else {
    // Sinon on descend jusqu'au sol ou au premier appui sous le curseur
    while (top + shape.h < GRID_H && !overlaps(isSolid, shape, left, top + 1)) top++;
  }
  const valid = top >= 0 && top + shape.h <= GRID_H;
  return { left, top, valid };
}

export function kingDropPosition(isSolid, kw, kh, cx, cy) {
  const box = { w: kw, h: kh, mask: new Uint8Array(kw * kh).fill(1) };
  let left = Math.round(cx - kw / 2);
  left = Math.max(BUILD_MIN_X, Math.min(BUILD_MAX_X - kw, left));
  let top = Math.round(cy - kh / 2);
  top = Math.max(2, Math.min(GROUND_Y - kh, top));

  // Si l'endroit visé est libre, le Roi descend se poser sur la surface juste en dessous (ou le sol)
  if (!overlaps(isSolid, box, left, top)) {
    while (top + kh < GROUND_Y && !overlaps(isSolid, box, left, top + 1)) top++;
    return { left, top, valid: true };
  }
  // Sinon on remonte jusqu'au premier espace libre au-dessus du curseur
  while (top > 2 && overlaps(isSolid, box, left, top)) top--;
  return { left, top, valid: !overlaps(isSolid, box, left, top) };
}
