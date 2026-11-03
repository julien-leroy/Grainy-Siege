// Logique d'une partie (salle) : lobby → construction → bataille → fin.
import { SandWorld, mulberry32 } from './sandsim.js';
import { CONFIG } from './config.js';
import { makeBuildPlan, botShot, botName } from './bot.js';
import {
  BUILD_SECONDS, AIM_SECONDS, PLAYER_COLORS, LAUNCH_X, LAUNCH_Y, GROUND_Y, BUILD_MIN_X, BUILD_MAX_X,
  SPRAY_COOLDOWN_MS, launchVelocity, BUILD_PLACE_COOLDOWN_MS, PATE_COOLDOWN_MS, PATTERN_PATE_COOLDOWN_MS, SHOTS_PER_TURN, DEFENSE_SPRAY_MAX,
  MAX_AMMO_RESERVE, MAX_DEFENSE_SPRAYS, GRID_W, KING_W, KING_H,
} from '../shared/constants.js';

const SETTLE_MS = 3200;
const PLACE_COOLDOWN_MS = BUILD_PLACE_COOLDOWN_MS;
const MAX_PLAYERS = 8;
const RESOLVE_MIN_MS = 400;
const RESOLVE_MAX_MS = 9000;

const VALID_AMMO_TYPES = ['sand', 'iron', 'acid', 'heavySpikeBall', 'grenade'];

let nextId = 1;

export class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map();
    this.order = [];
    this.phase = 'lobby';
    this.hostId = null;
    this.endsAt = 0;
    this.turn = null;
    this.winnerId = null;
    this.tickCount = 0;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    this.dirtyState = true;
    this.log = [];
    this.drops = [];
    this.nextDropId = 1;
    this.lastDropSpawn = 0;
    this.isTraining = false;
    this.trainingMode = null; // 'build_defense' | 'shoot' | null
  }

  get channel() {
    return `room:${this.code}`;
  }

  ensureAmmoInventory(p) {
    if (!p.ammoInventory || typeof p.ammoInventory !== 'object') {
      p.ammoInventory = { sand: 0, iron: 0, acid: 0, heavySpikeBall: 0, grenade: 0 };
    }
    for (const k of VALID_AMMO_TYPES) {
      if (typeof p.ammoInventory[k] !== 'number' || Number.isNaN(p.ammoInventory[k])) {
        p.ammoInventory[k] = 0;
      }
    }
    if (!p.selectedAmmo || !VALID_AMMO_TYPES.includes(p.selectedAmmo)) {
      p.selectedAmmo = 'sand';
    }
    return p.ammoInventory;
  }

  totalAmmo(p) {
    if (!p) return 0;
    const inv = this.ensureAmmoInventory(p);
    return inv.sand + inv.iron + inv.acid + inv.heavySpikeBall + inv.grenade;
  }

  pickAvailableAmmo(p) {
    if (!p) return 'sand';
    const inv = this.ensureAmmoInventory(p);
    for (const k of ['grenade', 'heavySpikeBall', 'acid', 'iron', 'sand']) {
      if (inv[k] > 0) return k;
    }
    return 'sand';
  }

  syncAmmoFlags(p) {
    if (!p) return;
    const inv = this.ensureAmmoInventory(p);
    p.hasIronBall = inv.iron > 0;
    p.hasAcidBall = inv.acid > 0;
    p.hasSpikeBall = inv.heavySpikeBall > 0;
    p.hasGrenade = inv.grenade > 0;
    p.ammoStock = this.totalAmmo(p);
  }

  // ---------------------------------------------------------------- joueurs
  addPlayer({ name, socket, isBot = false }) {
    if (this.players.size >= MAX_PLAYERS) throw new Error('La salle est pleine');
    if (this.phase !== 'lobby') {
      return this.addSpectator({ name, socket });
    }
    const id = `p${nextId++}`;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
    const p = {
      id,
      name: String(name || 'Joueur').slice(0, 18),
      color,
      isBot,
      isSpectator: false,
      socket: socket || null,
      connected: !!socket || isBot,
      world: new SandWorld((this.rng() * 2 ** 32) >>> 0),
      alive: true,
      lastPlace: 0,
      lastSpray: 0,
      defenseSpraysLeft: DEFENSE_SPRAY_MAX,
      ammoInventory: { sand: 0, iron: 0, acid: 0, heavySpikeBall: 0, grenade: 0 },
      selectedAmmo: 'sand',
      ammoStock: 0,
      placed: 0,
      plan: null,
      sentFast: -1,
      sentSlow: -1,
    };
    this.players.set(id, p);
    if (!this.hostId && !isBot) this.hostId = id;
    if (socket) socket.join(this.channel);
    this.say(`${p.name} rejoint la plage`);
    this.dirtyState = true;
    return p;
  }

  addSpectator({ name, socket }) {
    const id = `spec_${nextId++}`;
    const p = {
      id,
      name: String(name || 'Spectateur').slice(0, 18),
      color: '#94a3b8',
      isBot: false,
      isSpectator: true,
      socket: socket || null,
      connected: !!socket,
      world: new SandWorld(0),
      alive: false,
      lastPlace: 0,
      lastSpray: 0,
      defenseSpraysLeft: 0,
      placed: 0,
      plan: null,
      sentFast: -1,
      sentSlow: -1,
    };
    this.players.set(id, p);
    if (socket) socket.join(this.channel);
    this.say(`👀 ${p.name} observe la bataille en spectateur`);
    this.dirtyState = true;
    return p;
  }

  addBot() {
    const n = [...this.players.values()].filter((p) => p.isBot).length;
    return this.addPlayer({ name: botName(n), isBot: true });
  }

  reattach(playerId, socket) {
    const p = this.players.get(playerId);
    if (!p || p.isBot) return null;
    if (p.socket && p.socket.id !== socket.id) {
      try { p.socket.disconnect(true); } catch (_) {}
    }
    p.socket = socket;
    p.connected = true;
    socket.join(this.channel);
    p.sentFast = -1;
    p.sentSlow = -1;
    this.dirtyState = true;
    this.sendAllWorlds(socket);
    return p;
  }

  leavePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;

    if (this.phase === 'lobby') {
      return this.removePlayer(id);
    }

    // En cours de partie : son roi meurt, son socket est libéré, la partie continue pour les autres
    p.alive = false;
    if (p.world && p.world.king) {
      p.world.king.dead = true;
      p.world.king.cause = 'abandon';
    }
    p.connected = false;
    if (p.socket) {
      try {
        p.socket.leave(this.channel);
        p.socket.leave(this.code);
      } catch (_) {}
      p.socket = null;
    }

    if (this.hostId === id) {
      const h = [...this.players.values()].find((x) => !x.isBot && x.connected);
      this.hostId = h ? h.id : null;
    }

    this.dirtyState = true;
    this.say(`💀 ${p.name} a quitté la bataille (Roi éliminé).`);
    this.io.to(this.channel).emit('fx', { type: 'kingHit', pid: p.id, hits: 8, dead: true, reason: 'abandon' });

    // Vérifier les survivants
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      return this.finish(alive[0]?.id || null);
    }

    // Si on est en combat et que le joueur était impliqué dans le tour
    if (this.phase === 'battle' && this.turn) {
      const wasShooter = this.turn.shooterId === id;
      const wasTarget = this.turn.targetId === id;
      if (wasShooter) {
        const prevOrderIdx = this.order.indexOf(id);
        const prevShooter = this.order.length > 0
          ? this.order[(prevOrderIdx - 1 + this.order.length) % this.order.length]
          : null;
        this.nextTurn(prevShooter);
      } else if (wasTarget) {
        const newTarget = this.defaultTarget(this.turn.shooterId);
        if (newTarget) {
          this.turn.targetId = newTarget.id;
          this.dirtyState = true;
          this.forceFocusSend();
          this.say(`🎯 Cible réajustée : ${newTarget.name} !`);
        } else {
          this.nextTurn(this.turn.shooterId);
        }
      }
    }

    this.broadcastState();
  }

  removePlayer(id) {
    if (this.phase !== 'lobby') {
      return this.leavePlayer(id);
    }

    const p = this.players.get(id);
    if (!p) return;

    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.hostId === id) {
      const h = [...this.players.values()].find((x) => !x.isBot && x.connected);
      this.hostId = h ? h.id : null;
    }
    this.dirtyState = true;
    this.say(`🚪 ${p.name} a quitté le salon.`);
    this.broadcastState();
  }

  disconnect(socket) {
    for (const p of this.players.values()) {
      if (p.socket && p.socket.id === socket.id) {
        if (this.phase === 'lobby') {
          this.removePlayer(p.id);
        } else {
          this.leavePlayer(p.id);
        }
      }
    }
  }

  get humansConnected() {
    return [...this.players.values()].some((p) => !p.isBot && p.connected);
  }

  alivePlayers() {
    return this.order.map((id) => this.players.get(id)).filter((p) => p && p.alive);
  }

  say(msg) {
    this.log.push({ t: Date.now(), msg });
    if (this.log.length > 30) this.log.shift();
    this.io.to(this.channel).emit('log', msg);
  }

  // ---------------------------------------------------------------- phases
  start(byId) {
    if (this.phase !== 'lobby' && this.phase !== 'over') throw new Error('Déjà en cours');
    if (byId && byId !== this.hostId) throw new Error("Seul l'hôte peut lancer la partie");
    if (this.players.size < 2) throw new Error('Il faut au moins 2 joueurs (ajoute un bot !)');
    this.isTraining = false;
    this.trainingMode = null;
    // Moules standards TOUJOURS disponibles :
    // - Pâté illimité (sculpture manuelle rapide)
    // - Seau classique (x2)
    // - Arche royale (x2)
    // + Une sélection aléatoire de 3 à 4 patrons de spécialité (quantité 1 à 3 chacun).
    // Tous les joueurs d'une même manche reçoivent exactement les mêmes patrons et stocks !
    const specialtyPool = [
      'tour', 'mur', 'rampe', 'dalle', 'dome', 'cone', 'cube',
      'donjon', 'escalier', 'porte', 'colonne', 'barbacane',
      'citadelle', 'aqueduc', 'bastion', 'colosse',
    ];
    for (let i = specialtyPool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [specialtyPool[i], specialtyPool[j]] = [specialtyPool[j], specialtyPool[i]];
    }
    const numSpecialties = 5 + Math.floor(this.rng() * 3); // 5 à 7 patrons de spécialité
    const stock = {
      pate: 999, // Pâté de base illimité
      seau: 2,   // Standard
      arche: 2,  // Standard
      tour: 0, mur: 0, rampe: 0, dalle: 0, dome: 0, cone: 0, cube: 0,
      donjon: 0, escalier: 0, porte: 0, colonne: 0, barbacane: 0,
      citadelle: 0, aqueduc: 0, bastion: 0, colosse: 0,
    };
    for (let k = 0; k < numSpecialties; k++) {
      const shapeId = specialtyPool[k];
      stock[shapeId] = 1 + Math.floor(this.rng() * 3); // 1 à 3 quantité
    }
    this.mouldStock = stock;

    this.drops = [];
    this.nextDropId = 1;
    this.lastDropSpawn = 0;
    this.winnerId = null;
    this.turn = null;
    this.round = 0;
    this.log = [];

    for (const p of this.players.values()) {
      p.world = new SandWorld((this.rng() * 2 ** 32) >>> 0);
      // Plage aléatoire organique avec petites dunes et talus sur toute la zone de construction
      const pedestalType = Math.floor(this.rng() * 5);
      const kx = Math.round(210 + (this.rng() - 0.5) * 16);
      p.world.initBeachDunes(pedestalType, kx);
      p.alive = true;
      p.placed = 0;
      p.lastPlace = 0;
      p.lastSpray = 0;
      p.defenseSpraysLeft = 0;
      p.ammoInventory = { sand: 0, iron: 0, acid: 0, heavySpikeBall: 0, grenade: 0 };
      p.selectedAmmo = 'sand';
      p.ammoStock = 0;
      p.sentFast = -1;
      p.sentSlow = -1;
      p.moulds = { ...this.mouldStock };
      p.hasSpikeBall = false;
      p.hasGrenade = false;
      p.hasIronBall = false;
      p.hasAcidBall = false;
      p.bonusAmmo = 0;
      p.plan = p.isBot ? makeBuildPlan(this.rng, BUILD_SECONDS * 1000, p.world.king?.x ?? 210) : null;
    }
    this.order = [...this.players.keys()];
    this.phase = 'build';
    this.phaseStart = Date.now();
    this.endsAt = Date.now() + BUILD_SECONDS * 1000;
    this.say('🏖️ Nouvelle manche ! Bâtissez votre château autour du Roi !');
    this.dirtyState = true;
    this.sendAllWorlds();
    this.io.to(this.channel).emit('fx', { type: 'phase', phase: 'build', intro: 'build' });
  }

  buildInstantCastle(p) {
    p.world = new SandWorld((this.rng() * 2 ** 32) >>> 0);
    const pedestalType = Math.floor(this.rng() * 5);
    const kx = Math.round(210 + (this.rng() - 0.5) * 16);
    p.world.initBeachDunes(pedestalType, kx);
    const plan = makeBuildPlan(this.rng, BUILD_SECONDS * 1000, p.world.king?.x ?? kx);
    for (const a of plan) {
      if (a.shape === 'king') p.world.placeKing(a.x, a.y);
      else if (a.shape === 'spray') p.world.spray(a.x, a.y);
      else p.world.stamp(a.shape, a.x, a.y, false);
    }
    p.world.drying = false;
    for (let k = 0; k < 25; k++) p.world.step();
    p.world.drainEvents();
    p.world.armed = true;
    if (p.world.king) {
      p.world.king.dead = false;
      p.world.king.hits = 0;
    }
    p.alive = true;
    p.sentFast = -1;
    p.sentSlow = -1;
  }

  startTraining(byId, mode = 'build_defense') {
    if (this.players.size < 2) {
      this.addBot();
    }
    this.isTraining = true;
    this.trainingMode = mode === 'shoot' ? 'shoot' : 'build_defense';

    const stock = {
      pate: 999,
      seau: 99, arche: 99, tour: 99, mur: 99, rampe: 99, dalle: 99, dome: 99, cone: 99, cube: 99,
      donjon: 99, escalier: 99, porte: 99, colonne: 99, barbacane: 99,
      citadelle: 99, aqueduc: 99, bastion: 99, colosse: 99,
    };
    this.mouldStock = stock;
    this.drops = [];
    this.nextDropId = 1;
    this.lastDropSpawn = 0;
    this.winnerId = null;
    this.turn = null;
    this.round = 0;
    this.log = [];

    for (const p of this.players.values()) {
      p.world = new SandWorld((this.rng() * 2 ** 32) >>> 0);
      const pedestalType = Math.floor(this.rng() * 5);
      const kx = Math.round(210 + (this.rng() - 0.5) * 16);
      p.world.initBeachDunes(pedestalType, kx);
      p.alive = true;
      p.placed = 0;
      p.lastPlace = 0;
      p.lastSpray = 0;
      p.defenseSpraysLeft = MAX_DEFENSE_SPRAYS;
      p.ammoInventory = { sand: 0, iron: 0, acid: 0, heavySpikeBall: 0, grenade: 0 };
      p.selectedAmmo = 'sand';
      p.ammoStock = 0;
      p.sentFast = -1;
      p.sentSlow = -1;
      p.moulds = { ...this.mouldStock };
      p.hasSpikeBall = false;
      p.hasGrenade = false;
      p.hasIronBall = false;
      p.hasAcidBall = false;
      p.bonusAmmo = 0;
      p.plan = null;
    }

    this.order = [...this.players.keys()];

    if (this.trainingMode === 'shoot') {
      for (const p of this.players.values()) {
        if (p.isBot) this.buildInstantCastle(p);
      }
      this.startBattle();
      this.say('🎯 Entraînement au Tir ! Boulets illimités : clique sur une icône sous la catapulte pour choisir ton boulet !');
    } else {
      for (const p of this.players.values()) {
        if (p.isBot) p.plan = makeBuildPlan(this.rng, 45000, p.world.king?.x ?? 210);
      }
      this.phase = 'build';
      this.phaseStart = Date.now();
      this.endsAt = Date.now() + 300 * 1000; // 5 minutes de construction libre
      this.say('🏗️ Entraînement Construction & Défense ! Bâtis ton château puis clique sur "Lancer l\'attaque IA" !');
      this.dirtyState = true;
      this.sendAllWorlds();
      this.io.to(this.channel).emit('fx', { type: 'phase', phase: 'build', intro: 'build' });
    }
    this.broadcastState();
  }

  finishBuildTraining(playerId) {
    if (!this.isTraining || this.phase !== 'build') return false;
    for (const p of this.players.values()) {
      if (p.isBot) {
        this.buildInstantCastle(p);
      }
    }
    this.startBattle();
    this.say('⚔️ Assaut de l\'IA lancé ! Utilise tes sprays d\'eau pour défendre ton château !');
    this.broadcastState();
    return true;
  }

  resetTrainingTarget(playerId) {
    if (!this.isTraining) return false;
    const bot = [...this.players.values()].find((p) => p.isBot);
    if (!bot) return false;
    this.buildInstantCastle(bot);
    if (this.turn) {
      this.turn.targetId = bot.id;
      this.turn.state = 'aim';
    }
    this.say('🔄 Nouveau château cible généré !');
    this.dirtyState = true;
    this.sendAllWorlds();
    this.broadcastState();
    return true;
  }

  endBuild() {
    this.phase = 'settle';
    this.endsAt = Date.now() + SETTLE_MS;
    for (const p of this.players.values()) {
      if (!p.world.king) {
        p.world.initBeachDunes(0, 210);
        this.say(`Le Roi de ${p.name} a été posé d'office sur son reposoir`);
      }
    }
    this.say('⏳ Le sable se tasse… les châteaux tiendront-ils debout ?');
    this.dirtyState = true;
  }

  startBattle() {
    this.phase = 'battle';
    this.drops = [];
    this.lastDropSpawn = Date.now() + 3000;
    for (const p of this.players.values()) {
      p.world.armed = true;
      p.world.drying = false; // Ne sèche que quand le château est affiché à l'écran (cible du tour)
      p.defenseSpraysLeft = (this.isTraining && this.trainingMode === 'build_defense' && !p.isBot) ? MAX_DEFENSE_SPRAYS : 0;
      p.ammoInventory = { sand: 0, iron: 0, acid: 0, heavySpikeBall: 0, grenade: 0 };
      p.selectedAmmo = 'sand';
      p.ammoStock = 0;
      if (p.world.king && !p.world.king.dead) p.world.king.hits = 0;
    }
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      return this.finish(alive[0]?.id || null);
    }
    // L'ordre de tir est mélangé, avec priorité au joueur humain en solo / bot
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    const human = this.order.find((id) => !this.players.get(id)?.isBot);
    if (human) {
      this.order = [human, ...this.order.filter((id) => id !== human)];
    }
    this.round = 0;
    this.nextTurn(null);
    this.io.to(this.channel).emit('fx', { type: 'phase', phase: 'battle', intro: 'battle' });
  }

  nextTurn(prevShooterId) {
    const alive = this.alivePlayers();
    if (alive.length <= 1) return this.finish(alive[0]?.id || null);

    // Conserver les boulets restants non tirés par le tireur précédent !
    if (prevShooterId && this.turn && !(this.isTraining && this.trainingMode === 'shoot')) {
      const prevShooter = this.players.get(prevShooterId);
      if (prevShooter) {
        this.syncAmmoFlags(prevShooter);
      }
    }

    let shooter = null;
    let target = null;

    if (this.isTraining && this.trainingMode === 'build_defense') {
      // En mode entraînement construction/défense : seule l'IA attaque en continu !
      const bot = alive.find((p) => p.isBot);
      const human = alive.find((p) => !p.isBot);
      if (bot && human) {
        shooter = bot;
        target = human;
        if (prevShooterId) this.round++;
      }
    } else if (this.isTraining && this.trainingMode === 'shoot') {
      // En mode entraînement au tir : seul le joueur humain tire avec munitions illimitées !
      const human = alive.find((p) => !p.isBot);
      let bot = alive.find((p) => p.isBot);
      if (!bot) {
        bot = [...this.players.values()].find((p) => p.isBot);
        if (bot) this.buildInstantCastle(bot);
      }
      if (human && bot) {
        shooter = human;
        target = bot;
      }
    }

    if (!shooter) {
      let idx = prevShooterId ? this.order.indexOf(prevShooterId) : -1;
      for (let k = 1; k <= this.order.length; k++) {
        const cand = this.players.get(this.order[(idx + k) % this.order.length]);
        if (cand && cand.alive) {
          if ((idx + k) >= this.order.length && prevShooterId) this.round++;
          shooter = cand;
          break;
        }
      }
      target = this.defaultTarget(shooter.id);
    }
    if (!target) return this.finish(shooter.id);

    // Chaque tour de défense octroie +1 dose de spray en réserve (on garde les sprays non utilisés, max 5) !
    target.defenseSpraysLeft = Math.min(MAX_DEFENSE_SPRAYS, (target.defenseSpraysLeft || 0) + 1);

    const wind = (this.rng() * 2 - 1) * CONFIG.windMax;

    let initialShots = 2;
    if (this.isTraining && this.trainingMode === 'shoot' && !shooter.isBot) {
      shooter.ammoInventory = { sand: 99, iron: 99, acid: 99, heavySpikeBall: 99, grenade: 99 };
      if (!shooter.selectedAmmo || !VALID_AMMO_TYPES.includes(shooter.selectedAmmo)) {
        shooter.selectedAmmo = 'sand';
      }
      this.syncAmmoFlags(shooter);
      initialShots = 999;
    } else {
      // Chaque tour d'attaque octroie +2 boulets de sable (on garde tous les boulets non tirés, max 5 au total) !
      const inv = this.ensureAmmoInventory(shooter);
      const curTotal = this.totalAmmo(shooter);
      const addSand = Math.max(0, Math.min(MAX_AMMO_RESERVE - curTotal, SHOTS_PER_TURN + (shooter.bonusAmmo || 0)));
      inv.sand += addSand;
      shooter.bonusAmmo = 0;
      if ((inv[shooter.selectedAmmo] || 0) <= 0) {
        shooter.selectedAmmo = this.pickAvailableAmmo(shooter);
      }
      this.syncAmmoFlags(shooter);
      initialShots = shooter.ammoStock;
    }

    const isUnlimitedShoot = this.isTraining && this.trainingMode === 'shoot' && !shooter.isBot;
    const attackDuration = isUnlimitedShoot ? 3600 * 1000 : (shooter.connected ? AIM_SECONDS * 1000 : 3000);
    const attackPhaseEndsAt = Date.now() + attackDuration;
    this.turn = {
      shooterId: shooter.id,
      targetId: target.id,
      state: 'aim',
      wind,
      attackPhaseEndsAt,
      endsAt: attackPhaseEndsAt,
      botFireAt: shooter.isBot ? Date.now() + 1800 + this.rng() * 1600 : 0,
      botSprayAt: target.isBot ? Date.now() + 900 + this.rng() * 1400 : 0,
      aim: null,
      deaths: [],
      shotsLeft: initialShots,
      shotsTotal: initialShots,
      catapultSide: 'left',
      infiniteAmmo: isUnlimitedShoot,
    };
    // Relancer de nouveaux bonus parachutés pour ce tour de tir
    this.drops = [];
    this.lastDropSpawn = Date.now();
    this.spawnDrop(this.lastDropSpawn);
    this.say(`🎯 Au tour de ${shooter.name} de viser le château de ${target.name} !`);
    this.dirtyState = true;
    this.forceFocusSend();
  }

  defaultTarget(shooterId) {
    const idx = this.order.indexOf(shooterId);
    for (let k = 1; k < this.order.length; k++) {
      const p = this.players.get(this.order[(idx + k) % this.order.length]);
      if (p && p.alive && p.id !== shooterId) return p;
    }
    return null;
  }

  chooseTarget(playerId, targetId) {
    const t = this.turn;
    if (this.phase !== 'battle' || !t || t.state !== 'aim' || t.shooterId !== playerId) return;
    const target = this.players.get(targetId);
    if (!target || !target.alive || target.id === playerId) return;
    t.targetId = targetId;
    this.dirtyState = true;
    this.forceFocusSend();
  }

  chooseCatapultSide(playerId, side) {
    const t = this.turn;
    if (this.phase !== 'battle' || !t || t.state !== 'aim' || t.shooterId !== playerId) return;
    if (side !== 'left' && side !== 'right') return;
    t.catapultSide = side;
    this.dirtyState = true;
    this.io.to(this.channel).emit('fx', { type: 'catapultSide', side, pid: playerId });
  }

  selectAmmo(playerId, type) {
    if (!VALID_AMMO_TYPES.includes(type)) return false;
    const p = this.players.get(playerId);
    if (!p) return false;
    const inv = this.ensureAmmoInventory(p);
    const isUnlimitedShoot = this.isTraining && this.trainingMode === 'shoot' && !p.isBot;
    if (!isUnlimitedShoot && (inv[type] || 0) <= 0) return false;
    p.selectedAmmo = type;
    this.dirtyState = true;
    this.broadcastState();
    return true;
  }

  relayAim(playerId, aim) {
    const t = this.turn;
    if (this.phase !== 'battle' || !t || t.state !== 'aim' || t.shooterId !== playerId) return;
    t.aim = { angle: +aim.angle || 0, power: +aim.power || 0, side: aim.side || t.catapultSide || 'left' };
    if (aim.side === 'left' || aim.side === 'right') t.catapultSide = aim.side;
    this.io.to(this.channel).except(this.players.get(playerId)?.socket?.id || '').emit('aim', t.aim);
  }

  fire(playerId, arg1 = {}, arg2, arg3) {
    const opts = typeof arg1 === 'number'
      ? { angle: arg1, power: arg2, side: arg3 }
      : (arg1 || {});
    const { angle, power, side, ammoType: requestedAmmo } = opts;
    const t = this.turn;
    if (this.phase !== 'battle' || !t || t.state !== 'aim' || t.shooterId !== playerId) return false;
    if (t.shotsLeft <= 0) return false;
    if (side === 'left' || side === 'right') t.catapultSide = side;
    const catSide = t.catapultSide || 'left';
    const shooter = this.players.get(playerId);
    const target = this.players.get(t.targetId);
    if (!target || !shooter) return false;
    const a = Math.max(0.05, Math.min(1.52, Number(angle) || 0.7));
    const pw = Math.max(0.08, Math.min(1, Number(power) || 0.5));
    const w = target.world;
    w.wind = t.wind;
    w.ballScale = 1 + this.round * CONFIG.ballGrowthPerRound;

    const inv = this.ensureAmmoInventory(shooter);
    const isUnlimitedShoot = this.isTraining && this.trainingMode === 'shoot' && !shooter.isBot;

    if (!isUnlimitedShoot) {
      // Rétrocompatibilité si un test unitaire active directement hasGrenade / hasSpikeBall / etc. ou shotsLeft
      if (shooter.hasGrenade && inv.grenade <= 0) { inv.grenade = 1; shooter.selectedAmmo = 'grenade'; }
      if (shooter.hasSpikeBall && inv.heavySpikeBall <= 0) { inv.heavySpikeBall = 1; shooter.selectedAmmo = 'heavySpikeBall'; }
      if (shooter.hasIronBall && inv.iron <= 0) { inv.iron = 1; shooter.selectedAmmo = 'iron'; }
      if (shooter.hasAcidBall && inv.acid <= 0) { inv.acid = 1; shooter.selectedAmmo = 'acid'; }
      const totalNow = this.totalAmmo(shooter);
      if (totalNow < t.shotsLeft) {
        inv.sand += (t.shotsLeft - totalNow);
      }
    }

    let chosenAmmo = shooter.selectedAmmo || 'sand';
    if (requestedAmmo && VALID_AMMO_TYPES.includes(requestedAmmo)) {
      if (isUnlimitedShoot || (inv[requestedAmmo] || 0) > 0) {
        chosenAmmo = requestedAmmo;
        shooter.selectedAmmo = requestedAmmo;
      }
    }
    if (!isUnlimitedShoot && (inv[chosenAmmo] || 0) <= 0) {
      chosenAmmo = this.pickAvailableAmmo(shooter);
    }

    const isAcid = chosenAmmo === 'acid';
    const isGrenade = chosenAmmo === 'grenade';
    const isSpike = chosenAmmo === 'heavySpikeBall';
    const isIron = chosenAmmo === 'iron';

    if (!isUnlimitedShoot) {
      inv[chosenAmmo] = Math.max(0, (inv[chosenAmmo] || 0) - 1);
      t.shotsLeft = Math.max(0, t.shotsLeft - 1);
      this.syncAmmoFlags(shooter);
      if ((inv[shooter.selectedAmmo] || 0) <= 0) {
        shooter.selectedAmmo = this.pickAvailableAmmo(shooter);
      }
    } else {
      t.shotsLeft = 999;
      shooter.ammoStock = 999;
    }

    const launchX = catSide === 'right' ? (GRID_W - LAUNCH_X) : LAUNCH_X;
    const v = launchVelocity(a, pw);
    if (catSide === 'right') v.vx = -v.vx; // Tire de droite à gauche !
    w.launch(launchX, LAUNCH_Y, v.vx, v.vy, isSpike, isGrenade, isIron, isAcid);
    t.state = 'flight';
    t.firedAt = Date.now();
    t.aim = { angle: a, power: pw, side: catSide };
    const ammoType = chosenAmmo;
    this.io.to(this.channel).emit('fx', { type: 'fire', pid: target.id, angle: a, power: pw, side: catSide, isSpike, isGrenade, isIron, isAcid, ammoType });
    this.dirtyState = true;
    return true;
  }

  finish(winnerId) {
    this.phase = 'over';
    this.winnerId = winnerId;
    this.turn = null;
    const w = this.players.get(winnerId);
    this.say(w ? `🏆 ${w.name} remporte la bataille de sable !` : 'Match nul… la mer a tout emporté.');
    this.io.to(this.channel).emit('fx', { type: 'win', winnerId });
    this.dirtyState = true;
  }

  backToLobby(byId) {
    if (this.phase !== 'over' && this.phase !== 'lobby' && !this.isTraining) {
      // La partie est en cours : quitter individuellement sans interrompre la partie des autres
      return this.leavePlayer(byId);
    }
    this.isTraining = false;
    this.trainingMode = null;
    this.phase = 'lobby';
    this.turn = null;
    this.winnerId = null;
    this.round = 0;
    this.drops = [];
    this.lastDropSpawn = 0;
    this.log = [];
    for (const p of [...this.players.values()]) {
      if (!p.isBot && !p.connected) {
        this.players.delete(p.id);
        this.order = this.order.filter((x) => x !== p.id);
      } else {
        p.world = new SandWorld((this.rng() * 2 ** 32) >>> 0);
        const pedestalType = Math.floor(this.rng() * 5);
        const kx = Math.round(210 + (this.rng() - 0.5) * 16);
        p.world.initBeachDunes(pedestalType, kx);
        p.alive = true;
        p.isSpectator = false;
        p.placed = 0;
        p.lastPlace = 0;
        p.lastSpray = 0;
        p.defenseSpraysLeft = 1;
        p.ammoInventory = { sand: 0, iron: 0, acid: 0, heavySpikeBall: 0, grenade: 0 };
        p.selectedAmmo = 'sand';
        p.ammoStock = 0;
        p.sentFast = -1;
        p.sentSlow = -1;
        p.moulds = null;
        p.hasSpikeBall = false;
        p.hasGrenade = false;
        p.hasIronBall = false;
        p.hasAcidBall = false;
        p.bonusAmmo = 0;
      }
    }
    const requester = byId ? this.players.get(byId) : null;
    this.say(`🛑 ${requester ? requester.name : 'Un joueur'} a arrêté la partie. Retour au salon !`);
    this.dirtyState = true;
    this.sendAllWorlds();
  }

  // ---------------------------------------------------------------- actions de construction & défense
  place(playerId, { shape, x, y, flipped }) {
    console.log(`[PLACE_REQUEST] playerId=${playerId}, phase=${this.phase}, shape=${shape}, x=${x}, y=${y}, flipped=${flipped}`);
    if (this.phase !== 'build') {
      console.log(`[PLACE_REJECTED] phase is not build (${this.phase})`);
      return null;
    }
    const p = this.players.get(playerId);
    if (!p || !p.alive) {
      console.log(`[PLACE_REJECTED] player not found or dead (p=${!!p}, alive=${p?.alive})`);
      return null;
    }
    const now = Date.now();
    const shapeStr = String(shape);
    const isPate = shapeStr === 'pate';
    const requiredCooldown = isPate ? PATE_COOLDOWN_MS : PLACE_COOLDOWN_MS;

    // Cooldowns séparés et indépendants :
    // - Pâté : cooldown de la main (800ms)
    // - Cooldown de 500ms sur le pâté juste après la pose d'un patron pour éviter l'enchaînement involontaire
    // - Moules / patrons : remplissage du seau (3000ms)
    if (isPate && p.pateCooldownUntil && now < p.pateCooldownUntil) {
      console.log(`[PLACE_REJECTED] pate pattern cooldown (${now} < ${p.pateCooldownUntil})`);
      return null;
    }

    let lastTime = isPate ? (p.lastPatePlace || 0) : (p.lastMouldPlace || 0);
    if (p.lastPlace !== undefined && p.lastPlace < lastTime) {
      lastTime = p.lastPlace;
      if (isPate) p.lastPatePlace = p.lastPlace;
      else p.lastMouldPlace = p.lastPlace;
    }

    if (now - lastTime < requiredCooldown) {
      console.log(`[PLACE_REJECTED] cooldown (${now - lastTime} < ${requiredCooldown})`);
      return null;
    }
    if (p.moulds && p.moulds[shapeStr] !== undefined && !isPate) {
      if (p.moulds[shapeStr] <= 0) {
        console.log(`[PLACE_REJECTED] mould stock depleted (${shapeStr}=${p.moulds[shapeStr]})`);
        return null;
      }
    }
    const pos = p.world.stamp(shapeStr, Number(x), Number(y), true, !!flipped);
    console.log(`[PLACE_RESULT] stamp returned:`, pos);
    if (pos) {
      if (isPate) {
        p.lastPatePlace = now;
      } else {
        p.lastMouldPlace = now;
        p.pateCooldownUntil = now + PATTERN_PATE_COOLDOWN_MS;
      }
      p.lastPlace = now;
      p.placed++;
      if (p.moulds && p.moulds[shapeStr] !== undefined && !isPate) {
        p.moulds[shapeStr]--;
      }
      this.dirtyState = true;
      p.socket?.emit('fx', { type: 'place', pid: p.id, shape: shapeStr, flipped: !!flipped, ...pos });
    }
    return pos;
  }

  flatten(playerId, { x, y }) {
    if (this.phase !== 'build') return null;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return null;
    const now = Date.now();
    if (now - (p.lastPlace || 0) < 350) return null;
    p.lastPlace = now;
    const res = p.world.flatten(Number(x), Number(y));
    if (res) {
      this.dirtyState = true;
      p.socket?.emit('fx', { type: 'flatten', pid: p.id, x: res.x, y: res.y });
    }
    return res;
  }

  dig(playerId, { x, y }) {
    if (this.phase !== 'build') return null;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return null;
    const now = Date.now();
    if (now - (p.lastPlace || 0) < 350) return null;
    p.lastPlace = now;
    const res = p.world.dig(Number(x), Number(y));
    if (res) {
      this.dirtyState = true;
      p.socket?.emit('fx', { type: 'dig', pid: p.id, x: res.x, y: res.y });
    }
    return res;
  }

  placeKing(playerId, { x, y }) {
    if (this.phase !== 'build') return null;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return null;
    const nx = Number(x);
    const ny = Number(y);
    if (nx < BUILD_MIN_X + 2 || nx > BUILD_MAX_X - KING_W - 2) return null;
    const pos = p.world.placeKing(nx, ny);
    if (pos) {
      this.dirtyState = true;
      p.socket?.emit('fx', { type: 'kingPlaced', pid: p.id, ...pos });
      this.io.to(this.channel).emit('fx', { type: 'kingMoved', pid: p.id, ...pos });
    }
    return pos;
  }

  /**
   * Spray d'eau durcisseur :
   * Utilisable pendant la phase de construction ('build') OU à tout moment pendant la bataille ('battle')
   * sur son propre château tant qu'il reste des sprays disponibles.
   */
  spray(playerId, { x, y }) {
    if (this.phase !== 'build' && this.phase !== 'battle' && this.phase !== 'settle') return null;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return null;
    const nx = Number(x);
    const ny = Number(y);

    if (this.phase === 'battle') {
      // Accessible UNIQUEMENT dans la zone de construction / château !
      if (nx < BUILD_MIN_X || nx > BUILD_MAX_X || ny > GROUND_Y) {
        return { ok: false, error: 'Le spray doit être appliqué sur le château !' };
      }
      if (p.defenseSpraysLeft <= 0) {
        return { ok: false, error: 'Plus de spray de défense disponible !' };
      }
    }

    const now = Date.now();
    const elapsed = now - p.lastSpray;
    if (elapsed < SPRAY_COOLDOWN_MS) {
      return { ok: false, cooldownMs: SPRAY_COOLDOWN_MS - elapsed, error: 'Spray en recharge' };
    }

    if (this.phase === 'battle') {
      p.defenseSpraysLeft--;
    }

    const res = p.world.spray(nx, ny);
    p.lastSpray = now;
    this.dirtyState = true;
    this.io.to(this.channel).emit('world', this.worldPayload(p));
    p.sentFast = p.world.version;
    p.sentSlow = p.world.version;
    this.io.to(this.channel).emit('fx', {
      type: 'spray',
      pid: p.id,
      x: res.x,
      y: res.y,
      radius: res.radius,
      hardened: res.hardened,
      nextSprayAt: now + SPRAY_COOLDOWN_MS,
      defenseSpraysLeft: p.defenseSpraysLeft,
    });
    return { ok: true, ...res, cooldownMs: SPRAY_COOLDOWN_MS, defenseSpraysLeft: p.defenseSpraysLeft };
  }

  // ---------------------------------------------------------------- boucle (60 Hz)
  tick() {
    this.tickCount++;
    const now = Date.now();

    // Le château ne sèche que lorsqu'il est affiché sur l'écran à partir du lancement des combats (cible du tour)
    const activeTargetId = (this.phase === 'battle' && this.turn) ? this.turn.targetId : null;
    for (const p of this.players.values()) {
      p.world.drying = Boolean(activeTargetId && p.id === activeTargetId);
      p.world.step();
    }

    if (this.phase === 'build') {
      const elapsed = now - this.phaseStart;
      for (const p of this.players.values()) {
        if (!p.plan || !p.alive) continue;
        while (p.plan.length && p.plan[0].at <= elapsed) {
          const a = p.plan.shift();
          if (a.shape === 'king') p.world.placeKing(a.x, a.y);
          else if (a.shape === 'spray') p.world.spray(a.x, a.y);
          else p.world.stamp(a.shape, a.x, a.y, false); // mode drop pour les bots : construction stable
        }
      }
      if (now >= this.endsAt) this.endBuild();
    } else if (this.phase === 'settle') {
      if (now >= this.endsAt) this.startBattle();
    } else if (this.phase === 'battle') {
      this.tickBattle(now);
    }

    // événements visuels / sonores
    for (const p of this.players.values()) {
      const evs = p.world.drainEvents();
      for (const e of evs) {
        if (e.type === 'kingDead') {
          const how = { enseveli: 'enseveli sous son propre sable', touché: 'touché de plein fouet', chute: 'tombé de son château', explosion: 'pulvérisé par une grenade !' }[e.cause] || e.cause;
          this.dirtyState = true;
          if (this.isTraining && this.trainingMode === 'shoot' && p.isBot) {
            this.say(`🎯 Roi cible ${how} ! Construction d'un nouveau château cible…`);
            this.buildInstantCastle(p);
            this.sendAllWorlds();
          } else {
            p.alive = false;
            this.say(`😱 Le Roi de ${p.name} est ${how} !`);
            const alive = this.alivePlayers();
            if (alive.length <= 1) {
              this.finish(alive[0]?.id || null);
            } else if (this.phase === 'battle') {
              this.turn?.deaths.push(p.id);
              if (this.turn && (this.turn.targetId === p.id || this.turn.shooterId === p.id)) {
                this.nextTurn(this.turn.shooterId);
              }
            }
          }
        }
        this.io.to(this.channel).emit('fx', { ...e, pid: p.id });
      }
    }

    if (this.tickCount % 2 === 0) this.broadcastWorlds();
    if (this.dirtyState || this.tickCount % 30 === 0) this.broadcastState();
  }

  tickBattle(now) {
    const t = this.turn;
    if (!t) return;
    const shooter = this.players.get(t.shooterId);
    const target = this.players.get(t.targetId);
    if (!shooter || !target) {
      this.nextTurn(shooter ? t.shooterId : null);
      return;
    }

    // Gestion des bonus parachutés qui descendent vers la mer (taux réduit : 1 seul colis max à la fois, délai 22s)
    if (now - this.lastDropSpawn > 22000 && this.drops.filter((d) => !d.collected && !d.sunk).length < 1) {
      this.lastDropSpawn = now;
      this.spawnDrop(now);
    }

    // Chute et flottaison au milieu de la mer (y = 115, entre l'horizon 96 et le rivage 138)
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.collected || d.sunk) {
        this.drops.splice(i, 1);
        this.dirtyState = true;
        continue;
      }
      if (!d.inWater) {
        d.y += d.vy;
        const seaMidY = 115;
        if (d.y >= seaMidY) {
          d.y = seaMidY;
          d.inWater = true;
          d.waterTouchAt = now;
          this.dirtyState = true;
          this.io.to(this.channel).emit('fx', { type: 'dropSplash', x: d.x, y: d.y });
        } else if (this.tickCount % 5 === 0) {
          this.dirtyState = true;
        }
      } else {
        // Flotte 2 secondes puis coule dans l'eau
        if (now - d.waterTouchAt > 2000) {
          d.sunk = true;
          this.dirtyState = true;
          this.io.to(this.channel).emit('fx', { type: 'dropSunk', x: d.x, y: d.y });
        }
      }
    }

    // Si la cible est un bot qui se défend, il utilise son spray pour durcir son dôme/arche
    if (target.isBot && t.botSprayAt && now >= t.botSprayAt && target.world.king) {
      t.botSprayAt = 0;
      this.spray(target.id, { x: target.world.king.x + 2, y: target.world.king.y - 6 });
    }

    if (t.state === 'aim') {
      if (shooter?.isBot && now >= t.botFireAt) {
        this.fire(shooter.id, botShot(target.world, this.rng, 0.72 + this.round * 0.04));
      } else if (now >= t.endsAt) {
        this.say(`${shooter?.name || '?'} a laissé passer son tour`);
        this.nextTurn(t.shooterId);
      }
    } else if (t.state === 'flight') {
      // Collision en vol : le boulet de catapulte touche un bonus en l'air AVANT l'eau !
      if (target.world.ball) {
        const b = target.world.ball;
        for (const d of this.drops) {
          if (d.collected || d.inWater || d.sunk) continue;
          const dist = Math.hypot(d.x - b.x, d.y - b.y);
          if (dist <= d.r + b.r + 3) {
            this.applyBonus(shooter.id, d, null);
          }
        }
      }

      if (!target.world.ball) {
        t.state = 'resolve';
        t.resolveStart = now;
        this.dirtyState = true;
      }
    } else if (t.state === 'resolve') {
      const dt = now - t.resolveStart;
      const anyDead = [...this.players.values()].some((p) => p.alive && p.world.king?.dead);
      const isIntermediateShot = t.shotsLeft > 0 && now < t.attackPhaseEndsAt && !anyDead;
      // Entre deux tirs : attente rapide et raisonnable (~650ms après impact) pour re-tirer sans attendre
      // Dernier tir : on laisse ~1.8 seconde pour bien admirer les dégâts sur le château
      const waitTime = isIntermediateShot ? 650 : 1800;

      if (dt >= waitTime) {
        for (const p of this.players.values()) {
          if (p.alive && p.world.king?.dead) {
            if (this.isTraining && this.trainingMode === 'shoot' && p.isBot) {
              this.buildInstantCastle(p);
              this.sendAllWorlds();
            } else {
              p.alive = false;
            }
          }
        }
        const alive = this.alivePlayers();
        if ((!this.isTraining || this.trainingMode !== 'shoot') && (anyDead || alive.length <= 1)) {
          this.nextTurn(t.shooterId);
          return;
        }
        if (t.shotsLeft > 0 && now < t.attackPhaseEndsAt) {
          t.state = 'aim';
          t.endsAt = t.attackPhaseEndsAt;
          this.dirtyState = true;
          if (!t.infiniteAmmo) {
            this.say(`☄️ Boulet armé ! Il te reste ${t.shotsLeft} tir(s) dans cette phase !`);
          }
          if (shooter?.isBot) {
            t.botFireAt = now + 800 + this.rng() * 600;
          }
        } else {
          this.nextTurn(t.shooterId);
        }
      }
    }
  }

  collectBonus(playerId, dropId, chosenTargetId = null) {
    if (this.phase !== 'battle') return false;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return false;
    const d = this.drops.find((drop) => drop.id === dropId && !drop.collected && !drop.inWater && !drop.sunk);
    if (!d) return false;
    return this.applyBonus(playerId, d, chosenTargetId);
  }

  addAmmoBonus(p, ammoKey) {
    const inv = this.ensureAmmoInventory(p);
    const isUnlimitedShoot = this.isTraining && this.trainingMode === 'shoot' && !p.isBot;
    if (isUnlimitedShoot) {
      inv[ammoKey] = 99;
      p.selectedAmmo = ammoKey;
      this.syncAmmoFlags(p);
      return;
    }
    // Synchroniser si un test a modifié directement p.ammoStock
    const specialTotal = inv.iron + inv.acid + inv.heavySpikeBall + inv.grenade;
    if (typeof p.ammoStock === 'number' && this.totalAmmo(p) !== p.ammoStock) {
      inv.sand = Math.max(0, p.ammoStock - specialTotal);
    }
    const curTotal = this.totalAmmo(p);
    if (curTotal < MAX_AMMO_RESERVE) {
      inv[ammoKey] = (inv[ammoKey] || 0) + 1;
    } else if (ammoKey !== 'sand' && inv.sand > 0) {
      // Si la réserve est pleine (5/5) avec du sable standard, convertir 1 sable en ce boulet spécial
      inv.sand--;
      inv[ammoKey] = (inv[ammoKey] || 0) + 1;
    }
    if ((inv[ammoKey] || 0) > 0) {
      // Sélectionner automatiquement le dernier bonus de boulet récupéré !
      p.selectedAmmo = ammoKey;
    }
    this.syncAmmoFlags(p);
    if (this.turn && this.turn.shooterId === p.id) {
      this.turn.shotsLeft = this.totalAmmo(p);
      this.turn.shotsTotal = Math.max(this.turn.shotsTotal, this.turn.shotsLeft);
    }
  }

  applyBonus(playerId, d, chosenTargetId) {
    d.collected = true;
    this.dirtyState = true;
    const p = this.players.get(playerId);
    const t = this.turn;

    if (d.type === 'ammo') {
      this.addAmmoBonus(p, 'sand');
      if (t && t.shooterId === playerId) {
        this.say(`🎯 ${p.name} récolte : +1 BOULET DE SABLE IMMÉDIAT !`);
      } else {
        this.say(`🎯 ${p.name} récolte : +1 BOULET DE SABLE en réserve !`);
      }
    } else if (d.type === 'spray') {
      p.defenseSpraysLeft = Math.min(MAX_DEFENSE_SPRAYS, (p.defenseSpraysLeft || 0) + 1);
      this.say(`💦 ${p.name} récolte : +1 DOSE DE SPRAY DÉFENSIF EN RÉSERVE !`);
      this.io.to(this.channel).emit('fx', { type: 'bonusSpray', pid: p.id, defenseSpraysLeft: p.defenseSpraysLeft });
    } else if (d.type === 'wetAll') {
      p.world.wetAll();
      p.lastSpray = 0;
      p.defenseSpraysLeft = Math.min(MAX_DEFENSE_SPRAYS, (p.defenseSpraysLeft || 0) + 1);
      this.say(`🌊 DÉLUGE BÉNI ! Le château de ${p.name} est totalement arrosé et durci !`);
      this.io.to(this.channel).emit('fx', { type: 'wetAll', pid: p.id, defenseSpraysLeft: p.defenseSpraysLeft });
    } else if (d.type === 'heavySpikeBall') {
      this.addAmmoBonus(p, 'heavySpikeBall');
      this.say(`💣 ARSENAL ! ${p.name} prépare un BOULET D'ACIER À POINTES ultra destructeur !`);
      this.io.to(this.channel).emit('fx', { type: 'heavySpikeBall', pid: p.id });
    } else if (d.type === 'iron' || d.type === 'ironBall') {
      this.addAmmoBonus(p, 'iron');
      this.say(`⚔️ ARSENAL ! ${p.name} arme un BOULET EN FER MASSIF (impact sur sable mouillé) !`);
      this.io.to(this.channel).emit('fx', { type: 'ironBallEquipped', pid: p.id });
    } else if (d.type === 'acid' || d.type === 'acidBall') {
      this.addAmmoBonus(p, 'acid');
      this.say(`🧪 CHIMIE ROYALE ! ${p.name} arme une FIOLE D'ACIDE CORROSIF !`);
      this.io.to(this.channel).emit('fx', { type: 'acidEquipped', pid: p.id });
    } else if (d.type === 'grenade') {
      this.addAmmoBonus(p, 'grenade');
      this.say(`🧨 ARSENAL LOURD ! ${p.name} arme une GRENADE À RETARDEMENT DE 2 SECONDES !`);
      this.io.to(this.channel).emit('fx', { type: 'grenadeEquipped', pid: p.id });
    } else if (d.type === 'dryOpponent') {
      let victim = chosenTargetId ? this.players.get(chosenTargetId) : null;
      if (!victim || !victim.alive || victim.id === playerId) {
        victim = this.alivePlayers().find((x) => x.id !== playerId);
      }
      if (victim) {
        victim.world.dryAll();
        this.say(`☀️ SÉCHERESSE APOCALYPTIQUE ! Le château de ${victim.name} a été asséché d'un coup par ${p.name} !`);
        this.io.to(this.channel).emit('fx', { type: 'dryAll', pid: victim.id });
      }
    }

    this.io.to(this.channel).emit('fx', {
      type: 'bonus',
      bonusType: d.type,
      x: d.x,
      y: d.y,
      pid: p.id,
      pname: p.name,
      pcolor: p.color,
    });
    return true;
  }

  spawnDrop(now = Date.now()) {
    const rand = this.rng();
    let type;
    const currentRound = this.round + 1;
    if (currentRound < 5) {
      // Tours 1 à 4 : boulet fer (35%), réserve boulet (35%), dose de spray de renfort (30%)
      const sub = rand;
      if (sub < 0.35) type = 'iron';
      else if (sub < 0.70) type = 'ammo';
      else type = 'spray';
    } else {
      // Tour 5 et + : apparition des bonus lourds (grenade, boulet pointes, acide, et les 2 légendaires rares)
      const rareChance = Math.min(0.75, 0.40 + (currentRound - 5) * 0.08);
      if (rand < rareChance) {
        const sub = rand / rareChance;
        if (sub < 0.30) {
          type = 'grenade';
        } else if (sub < 0.58) {
          type = 'heavySpikeBall';
        } else if (sub < 0.84) {
          type = 'acid'; // Fiole d'acide rongeur
        } else if (sub < 0.96) {
          type = 'wetAll'; // Rare légendaire : arrose et durcit tout
        } else {
          type = 'dryOpponent'; // Ultra-rare légendaire (4% des largages rares) : assèche tout le château adverse
        }
      } else {
        const sub = (rand - rareChance) / (1 - rareChance);
        if (sub < 0.38) type = 'iron';
        else if (sub < 0.72) type = 'ammo';
        else type = 'spray';
      }
    }
    const x = 85 + this.rng() * 160;
    const drop = {
      id: `drop_${this.nextDropId++}`,
      type,
      x,
      y: 6,
      vy: 0.11,
      r: 5.0, // Proportionnel au parachute agrandi
      inWater: false,
      waterTouchAt: 0,
      sunk: false,
      collected: false,
    };
    this.drops.push(drop);
    this.dirtyState = true;
    const typeLabels = {
      ammo: '☄️ +1 Tir en réserve',
      iron: '⚔️ Boulet en fer massif (impact net)',
      acid: '🧪 Fiole d\'acide corrosif (ronge le sable)',
      spray: '💦 +1 Dose de Spray en réserve',
      dryOpponent: '☀️ LÉGENDAIRE : Sécheresse Apocalyptique',
      wetAll: '🌊 LÉGENDAIRE : Déluge Béni Royal',
      heavySpikeBall: '💣 Boulet d\'acier à pointes (fissures)',
      grenade: '🧨 RARE : Grenade à retardement',
    };
    this.say(`🎈 Un colis parachuté (${typeLabels[type]}) descend en mer ! Vise-le au canon ☄️ !`);
    return drop;
  }

  broadcastChat(player, text) {
    const entry = {
      type: 'chat',
      pid: player.id,
      name: player.name,
      color: player.color,
      text,
      t: Date.now(),
    };
    this.io.to(this.channel).emit('chat', entry);
    this.log.push({ t: Date.now(), msg: `💬 [${player.name}] ${text}` });
    if (this.log.length > 50) this.log.shift();
  }

  // ---------------------------------------------------------------- réseau
  focusIds() {
    if (this.phase === 'battle' && this.turn) return [this.turn.targetId];
    return null;
  }

  forceFocusSend() {
    for (const p of this.players.values()) p.sentFast = -1;
  }

  worldPayload(p) {
    return { pid: p.id, ...p.world.snapshot() };
  }

  broadcastWorlds() {
    const isBuild = this.phase === 'build';
    const slow = this.tickCount % (isBuild ? 4 : 20) === 0;
    const focus = this.focusIds();
    const sockets = [...this.players.values()].filter((p) => p.socket).map((p) => p.socket);
    for (const p of this.players.values()) {
      const w = p.world;
      const active = w.ball || w.particles.length > 0;
      const changed = w.version !== p.sentFast || active;
      const isFocus = focus ? focus.includes(p.id) : false;
      if (isFocus) {
        if (changed) {
          this.io.to(this.channel).emit('world', this.worldPayload(p));
          p.sentFast = w.version;
          p.sentSlow = w.version;
        }
        continue;
      }
      if (isBuild && (changed || slow)) {
        // En phase de construction, diffuser à toute la plage pour voir les fantômes en direct !
        this.io.to(this.channel).emit('world', this.worldPayload(p));
        p.sentFast = w.version;
        p.sentSlow = w.version;
        continue;
      }
      if (!focus && p.socket && changed) {
        p.socket.emit('world', this.worldPayload(p));
        p.sentFast = w.version;
      }
      if (slow && w.version !== p.sentSlow) {
        const payload = this.worldPayload(p);
        for (const s of sockets) if (s !== p.socket || focus) s.emit('world', payload);
        p.sentSlow = w.version;
      }
    }
  }

  sendAllWorlds(socket) {
    for (const p of this.players.values()) {
      const payload = this.worldPayload(p);
      if (socket) socket.emit('world', payload);
      else this.io.to(this.channel).emit('world', payload);
    }
  }

  publicState() {
    const now = Date.now();
    let nextShooterId = null;
    let nextTargetId = null;
    let nextShooter = null;
    let nextTarget = null;
    let turnOrder = [];
    if (this.turn) {
      const aliveIds = this.order.filter((id) => this.players.get(id)?.alive);
      turnOrder = aliveIds.map((id) => {
        const p = this.players.get(id);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          isShooter: p.id === this.turn.shooterId,
          isTarget: p.id === this.turn.targetId,
        };
      });
      if (aliveIds.length >= 2) {
        const curIdx = aliveIds.indexOf(this.turn.shooterId);
        if (curIdx >= 0) {
          nextShooterId = aliveIds[(curIdx + 1) % aliveIds.length] || null;
          if (nextShooterId) {
            const ns = this.players.get(nextShooterId);
            const nt = this.defaultTarget(nextShooterId);
            nextTargetId = nt?.id || null;
            if (ns) nextShooter = { id: ns.id, name: ns.name, color: ns.color };
            if (nt) nextTarget = { id: nt.id, name: nt.name, color: nt.color };
          }
        }
      }
    }

    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      isTraining: !!this.isTraining,
      trainingMode: this.trainingMode || null,
      mouldStock: this.mouldStock || null,
      remaining: this.endsAt ? Math.max(0, this.endsAt - now) : 0,
      players: this.order.length
        ? [...new Set([...this.order, ...this.players.keys()])].map((id) => this.players.get(id)).filter(Boolean).map((p) => this.publicPlayer(p, now))
        : [...this.players.values()].map((p) => this.publicPlayer(p, now)),
      turn: this.turn
        ? {
          shooterId: this.turn.shooterId,
          targetId: this.turn.targetId,
          nextShooterId,
          nextTargetId,
          nextShooter,
          nextTarget,
          turnOrder,
          state: this.turn.state,
          wind: this.turn.wind / (CONFIG.windMax || 1),
          round: this.round + 1,
          remaining: Math.max(0, this.turn.endsAt - now),
          shotsLeft: this.turn.shotsLeft,
          shotsTotal: this.turn.shotsTotal,
          catapultSide: this.turn.catapultSide || 'left',
          infiniteAmmo: !!this.turn.infiniteAmmo,
        }
        : null,
      winnerId: this.winnerId,
      drops: this.drops.filter((d) => !d.collected && !d.sunk).map((d) => ({
        id: d.id,
        type: d.type,
        x: d.x,
        y: d.y,
        r: d.r,
        inWater: d.inWater,
        waterTouchAt: d.waterTouchAt,
        sunk: d.sunk,
      })),
    };
  }

  publicPlayer(p, now = Date.now()) {
    const k = p.world.king;
    const inv = this.ensureAmmoInventory(p);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: p.isBot,
      isSpectator: !!p.isSpectator,
      connected: p.connected,
      alive: p.alive,
      kingPlaced: !!k,
      kingHits: k ? k.hits : 0,
      placed: p.placed,
      sprayReadyIn: Math.max(0, (p.lastSpray + SPRAY_COOLDOWN_MS) - now),
      defenseSpraysLeft: p.defenseSpraysLeft ?? 0,
      moulds: p.moulds || null,
      ammoInventory: { ...inv },
      selectedAmmo: p.selectedAmmo || 'sand',
      ammoStock: p.ammoStock || 0,
      hasSpikeBall: !!p.hasSpikeBall || inv.heavySpikeBall > 0,
      hasGrenade: !!p.hasGrenade || inv.grenade > 0,
      hasIronBall: !!p.hasIronBall || inv.iron > 0,
      hasAcidBall: !!p.hasAcidBall || inv.acid > 0,
      bonusAmmo: p.bonusAmmo || 0,
    };
  }

  broadcastState() {
    this.dirtyState = false;
    this.io.to(this.channel).emit('room', this.publicState());
  }

  // ---------------------------------------------------------------- introspection (API / MCP)
  describe({ ascii = false } = {}) {
    const s = this.publicState();
    s.players = s.players.map((pp) => {
      const p = this.players.get(pp.id);
      const w = p.world;
      const out = {
        ...pp,
        cells: w.countTypes(),
        height: w.highestPoint(),
        king: w.king ? { x: w.king.x, y: w.king.y, dead: w.king.dead, cause: w.king.cause, hits: w.king.hits, altitude: GROUND_Y - (w.king.y + 8) } : null,
        sleeping: w.sleeping,
      };
      if (ascii) out.ascii = w.toAscii();
      return out;
    });
    s.log = this.log.map((l) => l.msg);
    return s;
  }
}
