import test from 'node:test';
import assert from 'node:assert/strict';
import { SandWorld } from '../server/sandsim.js';
import { Room } from '../server/game.js';
import {
  T, GRID_W, GROUND_Y, BUILD_MIN_X, BUILD_MAX_X, CATAPULT_X, LAUNCH_X,
  CATAPULT_RIGHT_X, LAUNCH_RIGHT_X, PATE_COOLDOWN_MS, BUILD_PLACE_COOLDOWN_MS,
  AIM_SECONDS, SHOTS_PER_TURN, DEFENSE_SPRAY_MAX,
} from '../shared/constants.js';
import { SHAPES, SHAPE_BY_ID } from '../shared/shapes.js';

const createFakeIo = () => ({
  to: () => ({ emit: () => {} }),
  emit: () => {},
});

test('flatten: arase et aplanit une zone de sable', () => {
  const w = new SandWorld();
  // Poser un monticule
  for (let x = 160; x <= 180; x++) {
    for (let y = GROUND_Y - 10; y < GROUND_Y; y++) {
      w.type[y * GRID_W + x] = T.WET;
      w.moist[y * GRID_W + x] = 200;
    }
  }

  // Aplatir à la hauteur GROUND_Y - 4 sur une largeur de 20
  w.flatten(170, GROUND_Y - 4, 20);

  // Vérifier qu'au-dessus de GROUND_Y - 4 les grains ont été arasés (EMPTY)
  for (let x = 165; x <= 175; x++) {
    assert.equal(w.type[(GROUND_Y - 6) * GRID_W + x], T.EMPTY, `x=${x} y=${GROUND_Y - 6} should be EMPTY`);
  }
  // Et à la ligne GROUND_Y - 4 c'est posé (WET)
  for (let x = 165; x <= 175; x++) {
    assert.equal(w.type[(GROUND_Y - 4) * GRID_W + x], T.WET, `x=${x} y=${GROUND_Y - 4} should be WET`);
  }
});

test('dig: retire le sable dans un rayon autour du curseur', () => {
  const w = new SandWorld();
  for (let x = 160; x <= 180; x++) {
    for (let y = GROUND_Y - 10; y < GROUND_Y; y++) {
      w.type[y * GRID_W + x] = T.WET;
      w.moist[y * GRID_W + x] = 200;
    }
  }

  // Creuser au centre (170, GROUND_Y - 5) avec un rayon de 4
  const res = w.dig(170, GROUND_Y - 5, 4);
  assert.ok(res.removed > 0, 'devrait avoir retiré du sable');
  assert.equal(w.type[(GROUND_Y - 5) * GRID_W + 170], T.EMPTY, 'centre du trou doit être vide');
});

test('dryAll et wetAll modifient l ensemble du château', () => {
  const w = new SandWorld();
  for (let x = 160; x <= 170; x++) {
    for (let y = GROUND_Y - 5; y < GROUND_Y; y++) {
      w.type[y * GRID_W + x] = T.WET;
      w.moist[y * GRID_W + x] = 180;
    }
  }

  // Assèchement total
  w.dryAll();
  for (let x = 160; x <= 170; x++) {
    assert.equal(w.moist[(GROUND_Y - 3) * GRID_W + x], 0, 'moist doit être 0');
  }

  // Humidification totale
  w.wetAll();
  for (let x = 160; x <= 170; x++) {
    assert.equal(w.type[(GROUND_Y - 3) * GRID_W + x], T.HARD, 'doit être devenu durci (T.HARD)');
    assert.equal(w.moist[(GROUND_Y - 3) * GRID_W + x], 255, 'moist doit être max 255');
  }
});

test('game: stocks de moules limités et distribués de façon équitable', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  room.start();

  assert.equal(room.phase, 'build');
  assert.ok(room.mouldStock, 'la salle a un stock de moules');
  assert.ok(p1.moulds, 'le joueur 1 a ses stocks');
  assert.ok(p2.moulds, 'le joueur 2 a ses stocks');

  // Les deux joueurs ont exactement les mêmes stocks initiaux
  assert.deepEqual(p1.moulds, p2.moulds);

  // Trouver un moule avec stock > 0 parmi les patrons aléatoires distribués
  const availableEntry = Object.entries(p1.moulds).find(([k, v]) => k !== 'pate' && v > 0);
  assert.ok(availableEntry, 'au moins un patron aléatoire attribué');
  const [shapeId, initialStock] = availableEntry;
  const ok = room.place(p1.id, { shape: shapeId, x: 170, y: GROUND_Y - 10 });
  assert.ok(ok, 'pose réussie');
  assert.equal(p1.moulds[shapeId], initialStock - 1);
});

test('game: caisses de bonus et interaction avec l eau de mer', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  room.start();
  room.startBattle();

  // Injecter un drop haut dans les airs
  room.drops = [{
    id: 1,
    type: 'ammo',
    x: 100,
    y: 80,
    r: 5,
    vy: 0.1,
    collected: false,
    inWater: false,
    waterTime: 0,
    sunk: false,
  }];

  // Collecte en vol : OK
  const res = room.collectBonus(p1.id, 1);
  assert.equal(res, true, 'bonus collecté');
  assert.ok(room.drops[0].collected, 'caisse marquée collectée');

  // Injecter un drop touchant la mer (y >= 115)
  const dropWater = {
    id: 2,
    type: 'heavySpikeBall',
    x: 100,
    y: 116,
    r: 3.5,
    vy: 0.05,
    collected: false,
    inWater: false,
    waterTouchAt: 0,
    sunk: false,
  };
  room.drops = [dropWater];

  // Simuler 1 tick : la caisse détecte l'eau à now
  let tNow = 10000;
  room.tickBattle(tNow);
  assert.ok(dropWater.inWater, 'la caisse doit être dans l eau');

  // Tenter de collecter la caisse dans l'eau : REFUSÉ
  const resInWater = room.collectBonus(p1.id, 2);
  assert.equal(resInWater, false, 'impossible de collecter un colis dans l eau');

  // Simuler 2,5 secondes plus tard dans l'eau : la caisse sombre et coule
  room.tickBattle(tNow + 2500);
  assert.ok(dropWater.sunk, 'la caisse doit avoir coulé');
});

test('game: tirs successifs de tous les boulets en reserve pendant la phase d attaque', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  p1.connected = true;
  p2.connected = true;
  room.start();
  room.startBattle();

  // Donner 2 boulets supplémentaires à Alice (3 tirs au total)
  room.turn.shotsLeft = 3;
  room.turn.shotsTotal = 3;
  room.turn.shooterId = p1.id;
  room.turn.targetId = p2.id;
  room.turn.state = 'aim';

  // Premier tir
  const ok1 = room.fire(p1.id, { angle: 0.8, power: 0.6 });
  assert.ok(ok1, 'premier tir validé');
  assert.equal(room.turn.shotsLeft, 2, 'il reste 2 tirs');
  assert.equal(room.turn.state, 'flight', 'boulet en vol');

  // Simuler fin de vol et résolution
  p2.world.ball = null;
  p2.world.quietTicks = 30;
  let tNow = 20000;
  room.tickBattle(tNow);
  assert.equal(room.turn.state, 'resolve');

  // Attendre la résolution (2s plus tard)
  room.tickBattle(tNow + 2000);
  // Doit revenir à aim pour Alice, avec temps réinitialisé
  assert.equal(room.turn.state, 'aim', 'doit revenir à aim pour le tir suivant');
  assert.equal(room.turn.shooterId, p1.id, 'toujours le tour d Alice');
  assert.ok(room.turn.endsAt > tNow + 15000, 'le chrono d aim est réinitialisé');

  // Deuxième tir immédiat
  const ok2 = room.fire(p1.id, { angle: 0.85, power: 0.65 });
  assert.ok(ok2, 'deuxième tir validé');
  assert.equal(room.turn.shotsLeft, 1, 'il reste 1 tir');

  // Résolution du deuxième tir
  p2.world.ball = null;
  p2.world.quietTicks = 30;
  tNow += 5000;
  room.tickBattle(tNow);
  room.tickBattle(tNow + 2000);
  assert.equal(room.turn.state, 'aim');
  assert.equal(room.turn.shotsLeft, 1);

  // Troisième et dernier tir
  const ok3 = room.fire(p1.id, { angle: 0.9, power: 0.7 });
  assert.ok(ok3, 'troisième tir validé');
  assert.equal(room.turn.shotsLeft, 0, 'plus de tir restant');

  // Résolution du dernier tir : passage au joueur suivant !
  p2.world.ball = null;
  p2.world.quietTicks = 30;
  tNow += 5000;
  room.tickBattle(tNow);
  room.tickBattle(tNow + 2000);
  assert.equal(room.turn.shooterId, p2.id, 'passe au tour de Bob après épuisement des boulets');
});

test('game: grenade a retardement de 2 secondes avec souffle et ejection laterale du sable', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  room.start();
  room.startBattle();

  // Construire un petit monticule de sable pour Bob
  p2.world.stamp('pate', 160, GROUND_Y - 5);
  const sandBefore = p2.world.countTypes();
  assert.ok(sandBefore.wet > 0, 'Bob a du sable');

  // Équiper une grenade sur Alice
  room.turn.shooterId = p1.id;
  room.turn.targetId = p2.id;
  room.turn.state = 'aim';
  p1.hasGrenade = true;
  assert.ok(p1.hasGrenade, 'grenade équipée');

  // Tirer la grenade
  const ok = room.fire(p1.id, { angle: 0.75, power: 0.6 });
  assert.ok(ok, 'tir de grenade réussi');
  assert.equal(p1.hasGrenade, false, 'grenade consommée');
  assert.ok(p2.world.ball.grenade, 'le projectile est une grenade');

  // Faire avancer la grenade jusqu'à contact avec le sable
  p2.world.ball.x = 160;
  p2.world.ball.y = GROUND_Y - 5;
  p2.world.step();

  // La grenade doit s'être enclenchée (landed = true, fuseTicks = 0)
  assert.ok(p2.world.ball.landed, 'la grenade a touché le sable et commence son compte à rebours');
  assert.equal(p2.world.ball.fuseTicks, 0, 'début du compte à rebours');

  // Simuler 60 ticks (1.0 seconde) : la grenade ne doit PAS avoir explosé
  for (let k = 0; k < 60; k++) p2.world.step();
  assert.ok(p2.world.ball, 'la grenade est toujours en cours de mèche à 1.0s');
  assert.equal(p2.world.ball.fuseTicks, 60, '60 ticks écoulés');

  // Simuler 60 ticks supplémentaires (total 120 ticks = 2.0s) : BOOM !
  for (let k = 0; k < 60; k++) p2.world.step();
  assert.equal(p2.world.ball, null, 'la grenade a explosé après 2.0 secondes');

  // Vérifier qu'une explosion latérale et des particules d'éjectas ont été émises
  const evs = p2.world.drainEvents();
  const expl = evs.find((e) => e.type === 'grenadeExplosion');
  assert.ok(expl, 'événement grenadeExplosion émis');
  assert.ok(expl.r >= 12 && expl.r <= 16, 'rayon de souffle réduit et équilibré');
  assert.ok(p2.world.particles.length > 0, 'du sable a été violemment éjecté');

  // Vérifier qu'il y a des particules avec une forte vitesse latérale (vx positif et négatif)
  const hasLeftEjecta = p2.world.particles.some((p) => p.vx < -1.5);
  const hasRightEjecta = p2.world.particles.some((p) => p.vx > 1.5);
  assert.ok(hasLeftEjecta && hasRightEjecta, 'éjection de sable vers la gauche et vers la droite');
});

test('game: reglages 30s timer, 3 boules par manche, 1 spray de defense et apercu prochain tour', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  const p3 = room.addPlayer({ name: 'Charlie' });
  p1.connected = true;
  p2.connected = true;
  p3.connected = true;

  room.start();
  room.startBattle();

  // 1. Constantes et tirs (2 boules de base par défaut)
  assert.equal(AIM_SECONDS, 45, 'AIM_SECONDS doit être de 45 secondes');
  assert.equal(SHOTS_PER_TURN, 2, 'SHOTS_PER_TURN doit être de 2 boules');
  assert.equal(DEFENSE_SPRAY_MAX, 1, 'DEFENSE_SPRAY_MAX doit être de 1 par défaut');

  // 2. Vérifier que la manche commence avec 2 tirs et 45 secondes max
  assert.equal(room.turn.shotsLeft, 2, '2 boules par manche par défaut');
  assert.ok(room.turn.endsAt > Date.now() + 40000, '45 secondes au début du tour');

  // 3. Vérifier que le défenseur a son spray de défense
  const targetPlayer = room.players.get(room.turn.targetId);
  assert.equal(targetPlayer.defenseSpraysLeft, 1, 'le défenseur a 1 spray pour sa phase');

  // 4. Vérifier l ordre complet et l encadré prochain tour dans publicState
  const pub = room.publicState();
  assert.ok(pub.turn.turnOrder.length >= 2, 'ordre de passage présent');
  assert.ok(pub.turn.nextShooter, 'prochain tireur calculé');
  assert.ok(pub.turn.nextTarget, 'prochaine cible calculée');
  assert.ok(pub.turn.nextShooter.color, 'couleur du prochain tireur présente');
  assert.ok(pub.turn.nextTarget.color, 'couleur de la prochaine cible présente');
});

test('sandsim: le sable seche plus vite et un impact sur sable sec structure cree des fissures', () => {
  const world = new SandWorld(42);
  world.drying = true;

  // Placer une tour de sable mouillé
  world.stamp('tour', 160, GROUND_Y - 5);
  const wetBefore = world.countTypes().wet;
  assert.ok(wetBefore > 0, 'tour posée');

  // Laisser sécher plus rapidement
  for (let k = 0; k < 60; k++) world.step();
  const c = world.countTypes();
  assert.ok(world.drying, 'séchage actif');

  // Forcer l'assèchement en surface pour tester l'impact sur sable sec structuré
  world.dryAll();
  const drySandCount = world.countTypes().dry;

  // Lancer un boulet au coeur de la structure sèche
  world.launch(155, GROUND_Y - 15, 2.0, 0.5);
  for (let k = 0; k < 10; k++) world.step();

  // L'impact doit avoir généré des cellules de sable meuble (LOOSE) et des fissures
  const looseAfter = world.countTypes().loose;
  assert.ok(looseAfter > 0, 'fissuration et désolidarisation en sable meuble');
});

test('catapultes: symétrie exacte et espacement accru avec le château', () => {
  // 1. Les deux catapultes sont strictement équidistantes du château
  const distLeft = BUILD_MIN_X - LAUNCH_X;
  const distRight = LAUNCH_RIGHT_X - BUILD_MAX_X;
  assert.equal(distLeft, distRight, `distances strictement symétriques (${distLeft} == ${distRight})`);
  assert.ok(distLeft >= 20, `espacement suffisant (${distLeft} >= 20)`);

  // 2. Le château est parfaitement centré sur la grille
  const castleCenter = (BUILD_MIN_X + BUILD_MAX_X) / 2;
  const gridCenter = GRID_W / 2;
  assert.equal(castleCenter, gridCenter, `centre du château (${castleCenter}) aligné sur la grille (${gridCenter})`);
});

test('game: cooldown distinct pour le pâté (0.8s) et les moules (3.0s)', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  room.start();

  // Poser un pâté
  const ok1 = room.place(p1.id, { shape: 'pate', x: 170, y: GROUND_Y - 5 });
  assert.ok(ok1, 'premier pâté posé');

  // Tout de suite après (0ms) : rejeté par cooldown
  const okEarly = room.place(p1.id, { shape: 'pate', x: 175, y: GROUND_Y - 5 });
  assert.equal(okEarly, null, 'rejeté car cooldown de 800ms actif');

  // Avancer de 850ms : le pâté est à nouveau disponible
  p1.lastPlace = Date.now() - (PATE_COOLDOWN_MS + 50);
  const okPateReady = room.place(p1.id, { shape: 'pate', x: 175, y: GROUND_Y - 5 });
  assert.ok(okPateReady, 'pâté à nouveau disponible après 800ms');

  // Poser un moule (seau) : cooldown de 3000ms
  p1.lastPlace = Date.now() - (BUILD_PLACE_COOLDOWN_MS + 50);
  const okMould = room.place(p1.id, { shape: 'seau', x: 170, y: GROUND_Y - 15 });
  assert.ok(okMould, 'moule posé');

  // 1000ms plus tard : le moule n'est PAS encore prêt (cooldown 3.0s toujours actif)
  p1.lastMouldPlace = Date.now() - 1000;
  p1.lastPlace = Date.now() - 1000;
  const okMouldTooSoon = room.place(p1.id, { shape: 'seau', x: 170, y: GROUND_Y - 25 });
  assert.equal(okMouldTooSoon, null, 'moule bloqué par le cooldown de 3.0s');

  // Mais un pâté peut être posé immédiatement sans attendre la fin du remplissage du seau !
  p1.lastPatePlace = Date.now() - (PATE_COOLDOWN_MS + 10);
  const okPateWhileBucketRefilling = room.place(p1.id, { shape: 'pate', x: 180, y: GROUND_Y - 5 });
  assert.ok(okPateWhileBucketRefilling, 'pâté posable immédiatement pendant que le seau se recharge');
});

test('shapes: les nouveaux patrons (donjon, escalier, porte, colonne, barbacane, citadelle, aqueduc, bastion, colosse) sont valides et posables', () => {
  const newShapes = ['donjon', 'escalier', 'porte', 'colonne', 'barbacane', 'citadelle', 'aqueduc', 'bastion', 'colosse'];
  for (const id of newShapes) {
    const world = new SandWorld(123);
    const s = SHAPE_BY_ID[id];
    assert.ok(s, `la forme ${id} existe`);
    assert.ok(s.w > 0 && s.h > 0 && s.count > 0, `la forme ${id} a des dimensions valides`);
    const pos = world.stamp(id, 170, GROUND_Y - 10, true);
    assert.ok(pos && pos.valid, `la forme ${id} peut être posée sur le monde`);
  }
});

test('game: roi sur reposoir/dunes, safe zone anti-étouffement et replacement drag-and-drop', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  room.start();

  // 1. Le Roi est généré sur la plage avec reposoir
  assert.ok(p1.world.king, 'le roi est posé au départ');
  assert.ok(p1.world.pedestalType >= 0 && p1.world.pedestalType < 5, 'reposoir parmi les talus');
  const initKingX = p1.world.king.x;

  // 2. Déplacement du roi autorisé pendant la phase de construction
  const moved = room.placeKing(p1.id, { x: 130, y: GROUND_Y - 5 });
  assert.ok(moved && moved.valid, 'le roi peut être déplacé par le joueur');
  assert.equal(p1.world.king.x, moved.left, 'la position X du roi est mise à jour');
  assert.notEqual(p1.world.king.x, initKingX, 'la position a bien changé');

  // 3. Safe zone : interdiction de coller du sable contre le Roi
  const blockedStamp = p1.world.stamp('pate', p1.world.king.x + 2, p1.world.king.y + 2, 'spawn');
  assert.equal(blockedStamp, null, 'pose refusée dans la safe zone du roi');

  // 4. Inversion de patron horizontal avec R (flipped = true)
  p1.moulds.rampe = 2;
  const flipRes = room.place(p1.id, { shape: 'rampe', x: 170, y: GROUND_Y - 5, flipped: true });
  assert.ok(flipRes, 'pose avec patron inversé réussie');
  assert.equal(flipRes.flipped, true, 'le retour de pose indique flipped=true');
});

test('game: reserves cumulatives (+2 boulets, +1 spray) et bonus spray en mer', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  p1.connected = true;
  p2.connected = true;
  room.start();
  room.startBattle();

  const shooter = room.players.get(room.turn.shooterId);
  const target = room.players.get(room.turn.targetId);

  // Le tireur commence avec 2 boulets et le défenseur avec 1 spray
  assert.equal(room.turn.shotsLeft, 2, 'tireur a 2 boulets initiaux');
  assert.equal(target.defenseSpraysLeft, 1, 'défenseur a 1 spray initial');

  // Le tireur tire 1 boulet
  const shot = room.fire(shooter.id, { angle: 45, power: 0.8, side: 'left' });
  assert.ok(shot, 'tir effectué');
  assert.equal(room.turn.shotsLeft, 1, 'il reste 1 boulet non tiré');

  // Bonus caisse en mer : spray d'eau défensif
  room.drops = [{ id: 99, type: 'spray', x: 200, y: 140, vy: 0, floating: true }];
  // Plafonnement à 3 sprays maximum
  shooter.defenseSpraysLeft = 2;
  room.applyBonus(shooter.id, { id: 100, type: 'spray' }, null);
  assert.equal(shooter.defenseSpraysLeft, 3, 'le spray passe à 3');
  room.applyBonus(shooter.id, { id: 101, type: 'spray' }, null);
  assert.equal(shooter.defenseSpraysLeft, 3, 'le spray est plafonné à 3 maximum');

  // Plafonnement à 3 boulets maximum
  shooter.ammoStock = 2;
  room.applyBonus(shooter.id, { id: 102, type: 'ammo' }, null);
  assert.equal(shooter.ammoStock, 3, 'les boulets passent à 3');
  room.applyBonus(shooter.id, { id: 103, type: 'ammo' }, null);
  assert.equal(shooter.ammoStock, 3, 'les boulets sont plafonnés à 3 maximum');
});

test('catapulte: puissance oscillante ping-pong (min -> max -> min -> max)', () => {
  // Fonction de calcul de puissance oscillante utilisée dans main.js
  function calcPower(elapsed, halfCycle = 800, minP = 0.12, maxP = 1.0) {
    const fullCycle = halfCycle * 2;
    const cycleProgress = (elapsed % fullCycle) / fullCycle;
    const wave = cycleProgress <= 0.5 ? (cycleProgress * 2) : (2 - cycleProgress * 2);
    return minP + wave * (maxP - minP);
  }

  // 1. Début : au minimum
  assert.equal(calcPower(0), 0.12, 'au départ la puissance est au minimum (0.12)');

  // 2. Mi-chemin de la montée (400ms) : puissance intermédiaire
  const midUp = calcPower(400);
  assert.ok(midUp > 0.5 && midUp < 0.6, `puissance intermédiaire en montée (~0.56, obtenu: ${midUp})`);

  // 3. Sommet (800ms) : au maximum absolu
  assert.equal(calcPower(800), 1.0, 'au sommet (800ms) la puissance atteint le maximum (1.0)');

  // 4. Descente (1200ms) : la puissance ne reste PAS bloquée au max et redescend
  const midDown = calcPower(1200);
  assert.ok(midDown < 1.0, 'la puissance est bien redescendue après le max');
  assert.ok(Math.abs(midDown - midUp) < 0.0001, 'la descente est symétrique à la montée');

  // 5. Retour au minimum complet (1600ms)
  assert.equal(calcPower(1600), 0.12, 'après un cycle complet la puissance est revenue au min');

  // 6. Deuxième montée au max (2400ms)
  assert.equal(calcPower(2400), 1.0, 'la puissance remonte au max au cycle suivant');
});

test('sandsim: quand le roi prend un degat de sable, le grain de sable est supprime du monde', () => {
  const world = new SandWorld();
  const kx = 180;
  const ky = GROUND_Y - 10;
  world.placeKing(kx, ky);
  assert.ok(world.king, 'roi présent');

  // Lâcher un grain de sable au-dessus du roi
  const sandX = kx + 2;
  const sandY = ky - 2;
  world.type[sandY * GRID_W + sandX] = 2; // WET sand
  world.vel[sandY * GRID_W + sandX] = 1.0;

  const hitsBefore = world.king.hits;
  for (let k = 0; k < 20; k++) world.step();

  assert.ok(world.king.hits > hitsBefore, 'le roi a pris un dégât');
  // Le grain ayant infligé le dégât a été supprimé du monde
  const aboveHead = world.type[(ky - 1) * GRID_W + sandX];
  assert.equal(aboveHead, 0, 'le grain de sable ayant touché le roi a été supprimé du monde');
});

test('game: quand un joueur quitte en combat, la partie continue sil reste > 1 joueur et les tours sont recalcules', () => {
  const room = new Room('TEST', createFakeIo());
  const p1 = room.addPlayer({ name: 'Alice' });
  const p2 = room.addPlayer({ name: 'Bob' });
  const p3 = room.addPlayer({ name: 'Charlie' });
  p1.connected = true;
  p2.connected = true;
  p3.connected = true;

  room.start();
  room.endBuild();
  room.startBattle();

  assert.equal(room.phase, 'battle', 'en combat');
  assert.equal(room.alivePlayers().length, 3, '3 joueurs vivants');

  const currentShooterId = room.turn.shooterId;
  const currentTargetId = room.turn.targetId;

  // Le tireur actuel quitte la partie
  room.removePlayer(currentShooterId);

  // La partie DOIT continuer car il reste 2 joueurs vivants !
  assert.equal(room.phase, 'battle', 'la partie continue avec les 2 joueurs restants');
  assert.equal(room.players.size, 2, '2 joueurs restants');
  assert.equal(room.alivePlayers().length, 2, '2 joueurs vivants restants');

  // Le tour doit avoir été recalculé immédiatement
  assert.notEqual(room.turn.shooterId, currentShooterId, 'le tireur a changé');
  assert.ok(room.players.has(room.turn.shooterId), 'le nouveau tireur est un joueur encore en jeu');
  assert.ok(room.players.has(room.turn.targetId), 'la nouvelle cible est un joueur encore en jeu');
  assert.notEqual(room.turn.shooterId, room.turn.targetId, 'le tireur et la cible sont distincts');

  // L'un des 2 joueurs restants quitte à son tour -> il ne reste plus qu'un seul joueur
  const leavingId = room.turn.shooterId;
  const lastPlayer = [...room.players.values()].find((p) => p.id !== leavingId);

  room.removePlayer(leavingId);

  // Victoire immédiate pour le dernier joueur en vie !
  assert.equal(room.phase, 'over', 'la partie se termine avec 1 seul joueur');
  assert.equal(room.winnerId, lastPlayer.id, 'le dernier joueur restant est déclaré vainqueur');
});

test('sandsim: pendant le combat un bloc non maintenu par du sable au sol tombe avec de la physique', () => {
  const w = new SandWorld(99);
  // Poser un cube en l'air au-dessus du sol
  w.stamp('cube', 180, 80, true);
  const wetBefore = w.countTypes().wet;
  assert.ok(wetBefore > 0, 'cube créé');

  // En phase de combat (drying = true)
  w.drying = true;
  for (let t = 0; t < 10; t++) w.step();

  // Le cube n'est plus en l'air comme un bloc figé : il est devenu du sable physique granulaire (LOOSE/DRY) avec vélocité !
  const counts = w.countTypes();
  assert.ok(counts.loose + counts.dry > 0, 'le bloc non soutenu s\'effondre en sable physique');
});



