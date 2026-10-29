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
  }

  get channel() {
    return `room:${this.code}`;
  }

  // ---------------------------------------------------------------- joueurs
  addPlayer({ name, socket, isBot = false }) {
    if (this.players.size >= MAX_PLAYERS) throw new Error('La salle est pleine');
    if (this.phase !== 'lobby') throw new Error('La partie a déjà commencé');
    const id = `p${nextId++}`;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
    const p = {
      id,
      name: String(name || 'Joueur').slice(0, 18),
      color,
      isBot,
      socket: socket || null,
      connected: !!socket || isBot,
      world: new SandWorld((this.rng() * 2 ** 32) >>> 0),
      alive: true,
      lastPlace: 0,
      lastSpray: 0,
      defenseSpraysLeft: DEFENSE_SPRAY_MAX,
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

  addBot() {
    const n = [...this.players.values()].filter((p) => p.isBot).length;
    return this.addPlayer({ name: botName(n), isBot: true });
  }

  reattach(playerId, socket) {
    const p = this.players.get(playerId);
    if (!p || p.isBot) return null;
    if (p.socket && p.socket.id !== socket.id) p.socket.disconnect(true);
    p.socket = socket;
    p.connected = true;
    socket.join(this.channel);
    p.sentFast = -1;
    p.sentSlow = -1;
    this.dirtyState = true;
    this.sendAllWorlds(socket);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    const prevOrderIdx = this.order.indexOf(id);
    const wasShooter = this.turn && this.turn.shooterId === id;
    const wasTarget = this.turn && this.turn.targetId === id;

    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.hostId === id) {
      const h = [...this.players.values()].find((x) => !x.isBot && x.connected);
      this.hostId = h ? h.id : null;
    }
    this.dirtyState = true;
    this.say(`🚪 ${p.name} a quitté la partie.`);

    // Si la partie est en cours (phase active de jeu)
    if (this.phase === 'battle') {
      const alive = this.alivePlayers();
      if (alive.length <= 1) {
        return this.finish(alive[0]?.id || null);
      }

      // Recalcul des tours de combat si le joueur qui quitte était impliqué
      if (wasShooter) {
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
    } else if (this.phase === 'build' || this.phase === 'settle') {
      const alive = this.alivePlayers();
      if (alive.length <= 1) {
        return this.finish(alive[0]?.id || null);
      }
    }

    this.broadcastState();
  }

  disconnect(socket) {
    for (const p of this.players.values()) {
      if (p.socket && p.socket.id === socket.id) {
        p.connected = false;
        p.socket = null;
        if (this.phase === 'lobby') this.removePlayer(p.id);
        else if (this.hostId === p.id) {
          const h = [...this.players.values()].find((x) => !x.isBot && x.connected);
          if (h) this.hostId = h.id;
        }
        this.dirtyState = true;
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
      p.ammoStock = 0;
      p.sentFast = -1;
      p.sentSlow = -1;
      p.moulds = { ...this.mouldStock };
      p.hasSpikeBall = false;
      p.hasGrenade = false;
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
      p.world.drying = true;
      p.defenseSpraysLeft = 0; // Gagnera +1 dose de spray dès son premier tour de défense
      p.ammoStock = 0;         // Gagnera +2 boulets dès son premier tour d'attaque
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
    if (prevShooterId && this.turn) {
      const prevShooter = this.players.get(prevShooterId);
      if (prevShooter) {
        prevShooter.ammoStock = this.turn.shotsLeft;
      }
    }

    let idx = prevShooterId ? this.order.indexOf(prevShooterId) : -1;
    let shooter = null;
    for (let k = 1; k <= this.order.length; k++) {
      const cand = this.players.get(this.order[(idx + k) % this.order.length]);
      if (cand && cand.alive) {
        if ((idx + k) >= this.order.length && prevShooterId) this.round++;
        shooter = cand;
        break;
      }
    }
    const target = this.defaultTarget(shooter.id);
    if (!target) return this.finish(shooter.id);

    // Chaque tour de défense octroie +1 dose de spray en réserve (on garde les sprays non utilisés, max 3) !
    target.defenseSpraysLeft = Math.min(MAX_DEFENSE_SPRAYS, (target.defenseSpraysLeft || 0) + 1);

    const wind = (this.rng() * 2 - 1) * CONFIG.windMax;

    // Chaque tour d'attaque octroie +2 boulets de canon (on garde tous les boulets non tirés, max 3) !
    shooter.ammoStock = Math.min(MAX_AMMO_RESERVE, (shooter.ammoStock || 0) + 2 + (shooter.bonusAmmo || 0));
    shooter.bonusAmmo = 0;
    const initialShots = shooter.ammoStock;

    const attackDuration = shooter.connected ? AIM_SECONDS * 1000 : 3000;
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

  relayAim(playerId, aim) {
    const t = this.turn;
    if (this.phase !== 'battle' || !t || t.state !== 'aim' || t.shooterId !== playerId) return;
    t.aim = { angle: +aim.angle || 0, power: +aim.power || 0, side: aim.side || t.catapultSide || 'left' };
    if (aim.side === 'left' || aim.side === 'right') t.catapultSide = aim.side;
    this.io.to(this.channel).except(this.players.get(playerId)?.socket?.id || '').emit('aim', t.aim);
  }

  fire(playerId, { angle, power, side }) {
    const t = this.turn;
    if (this.phase !== 'battle' || !t || t.state !== 'aim' || t.shooterId !== playerId) return false;
    if (t.shotsLeft <= 0) return false;
    if (side === 'left' || side === 'right') t.catapultSide = side;
    const catSide = t.catapultSide || 'left';
    const shooter = this.players.get(playerId);
    const target = this.players.get(t.targetId);
    if (!target) return false;
    const a = Math.max(0.05, Math.min(1.52, Number(angle) || 0.7));
    const pw = Math.max(0.08, Math.min(1, Number(power) || 0.5));
    const w = target.world;
    w.wind = t.wind;
    w.ballScale = 1 + this.round * CONFIG.ballGrowthPerRound;
    const isAcid = !!shooter?.hasAcidBall;
    const isGrenade = !!shooter?.hasGrenade;
    const isSpike = !!shooter?.hasSpikeBall;
    const isIron = !!shooter?.hasIronBall;
    if (shooter) {
      shooter.hasAcidBall = false;
      shooter.hasGrenade = false;
      shooter.hasSpikeBall = false;
      shooter.hasIronBall = false;
    }
    const launchX = catSide === 'right' ? (GRID_W - LAUNCH_X) : LAUNCH_X;
    const v = launchVelocity(a, pw);
    if (catSide === 'right') v.vx = -v.vx; // Tire de droite à gauche !
    w.launch(launchX, LAUNCH_Y, v.vx, v.vy, isSpike, isGrenade, isIron, isAcid);
    t.shotsLeft--;
    shooter.ammoStock = t.shotsLeft;
    t.state = 'flight';
    t.firedAt = Date.now();
    t.aim = { angle: a, power: pw, side: catSide };
    const ammoType = isAcid ? 'acid' : isGrenade ? 'grenade' : isSpike ? 'heavySpikeBall' : isIron ? 'iron' : 'sand';
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
    this.phase = 'lobby';
    this.turn = null;
    this.winnerId = null;
    this.round = 0;
    this.drops = [];
    this.lastDropSpawn = 0;
    this.log = [];
    for (const p of [...this.players.values()]) {
      if (!p.isBot && !p.connected) this.removePlayer(p.id);
      else {
        p.world = new SandWorld((this.rng() * 2 ** 32) >>> 0);
        const pedestalType = Math.floor(this.rng() * 5);
        const kx = Math.round(210 + (this.rng() - 0.5) * 16);
        p.world.initBeachDunes(pedestalType, kx);
        p.alive = true;
        p.placed = 0;
        p.lastPlace = 0;
        p.lastSpray = 0;
        p.defenseSpraysLeft = 1;
        p.ammoStock = 0;
        p.sentFast = -1;
        p.sentSlow = -1;
        p.moulds = null;
        p.hasSpikeBall = false;
        p.hasGrenade = false;
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
   * Utilisable pendant la phase de construction ('build') OU pendant la bataille ('battle')
   * (En bataille : UNIQUEMENT pour le défenseur ciblé, et UNIQUEMENT sur le château).
   */
  spray(playerId, { x, y }) {
    if (this.phase !== 'build' && this.phase !== 'battle' && this.phase !== 'settle') return null;
    const p = this.players.get(playerId);
    if (!p || !p.alive) return null;
    const nx = Number(x);
    const ny = Number(y);

    if (this.phase === 'battle') {
      // Accessible UNIQUEMENT pendant que le joueur se défend !
      if (!this.turn || this.turn.targetId !== playerId) {
        return { ok: false, error: 'Spray disponible uniquement quand tu te défends !' };
      }
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

    for (const p of this.players.values()) p.world.step();

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
          p.alive = false;
          this.dirtyState = true;
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
      const settled = target.world.settled;
      if ((dt > RESOLVE_MIN_MS && settled && !anyDead) || (anyDead && dt > 2400) || dt > RESOLVE_MAX_MS) {
        for (const p of this.players.values()) {
          if (p.alive && p.world.king?.dead) p.alive = false;
        }
        const alive = this.alivePlayers();
        if (anyDead || alive.length <= 1) {
          this.nextTurn(t.shooterId);
          return;
        }
        if (t.shotsLeft > 0 && now < t.attackPhaseEndsAt) {
          t.state = 'aim';
          t.endsAt = t.attackPhaseEndsAt;
          this.dirtyState = true;
          this.say(`☄️ Boulet armé ! Il te reste ${t.shotsLeft} tir(s) dans cette phase !`);
          if (shooter?.isBot) {
            t.botFireAt = now + 1200 + this.rng() * 800;
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

  applyBonus(playerId, d, chosenTargetId) {
    d.collected = true;
    this.dirtyState = true;
    const p = this.players.get(playerId);
    const t = this.turn;

    if (d.type === 'ammo') {
      if (t && t.shooterId === playerId) {
        t.shotsLeft = Math.min(MAX_AMMO_RESERVE, t.shotsLeft + 1);
        t.shotsTotal = Math.max(t.shotsTotal, t.shotsLeft);
        p.ammoStock = Math.min(MAX_AMMO_RESERVE, (p.ammoStock || 0) + 1);
        this.say(`🎯 ${p.name} récolte : +1 BOULET D'ATTAQUE IMMÉDIAT !`);
      } else {
        p.bonusAmmo = Math.min(MAX_AMMO_RESERVE, (p.bonusAmmo || 0) + 1);
        this.say(`🎯 ${p.name} récolte : +1 BOULET D'ATTAQUE pour son prochain tour !`);
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
      p.hasSpikeBall = true;
      this.say(`💣 ARSENAL ! ${p.name} prépare un BOULET D'ACIER À POINTES ultra destructeur !`);
      this.io.to(this.channel).emit('fx', { type: 'heavySpikeBall', pid: p.id });
    } else if (d.type === 'iron' || d.type === 'ironBall') {
      p.hasIronBall = true;
      this.say(`⚔️ ARSENAL ! ${p.name} arme un BOULET EN FER MASSIF (impact net sans ajout de sable) !`);
      this.io.to(this.channel).emit('fx', { type: 'ironBallEquipped', pid: p.id });
    } else if (d.type === 'acid' || d.type === 'acidBall') {
      p.hasAcidBall = true;
      this.say(`🧪 CHIMIE ROYALE ! ${p.name} arme une FIOLE D'ACIDE CORROSIF !`);
      this.io.to(this.channel).emit('fx', { type: 'acidEquipped', pid: p.id });
    } else if (d.type === 'grenade') {
      p.hasGrenade = true;
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
        if (sub < 0.28) {
          type = 'grenade';
        } else if (sub < 0.54) {
          type = 'heavySpikeBall';
        } else if (sub < 0.78) {
          type = 'acid'; // Fiole d'acide rongeur
        } else if (sub < 0.89) {
          type = 'wetAll'; // Rare légendaire : arrose et durcit tout
        } else {
          type = 'dryOpponent'; // Rare légendaire : assèche tout le château adverse
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
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: p.isBot,
      connected: p.connected,
      alive: p.alive,
      kingPlaced: !!k,
      kingHits: k ? k.hits : 0,
      placed: p.placed,
      sprayReadyIn: Math.max(0, (p.lastSpray + SPRAY_COOLDOWN_MS) - now),
      defenseSpraysLeft: p.defenseSpraysLeft ?? 0,
      moulds: p.moulds || null,
      hasSpikeBall: !!p.hasSpikeBall,
      hasGrenade: !!p.hasGrenade,
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
