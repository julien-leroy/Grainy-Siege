// Client principal : connexion Socket.IO, construction libre autour du Roi,
// spray d'eau durcisseur (pendant la construction ET quand on se défend),
// visée à la catapulte (glisser-relâcher ou curseurs), confettis et boucle 60 FPS.
import { SHAPES, SHAPE_BY_ID, dropPosition, kingDropPosition, spawnPosition, getFlippedShape } from '/shared/shapes.js';
import {
  T, TYPE_MASK, GRID_W, GRID_H, KING_W, KING_H, LAUNCH_X, LAUNCH_Y, CATAPULT_X, GROUND_Y,
  BUILD_MIN_X, BUILD_MAX_X, SPRAY_COOLDOWN_MS, SHOTS_PER_TURN, BUILD_PLACE_COOLDOWN_MS, PATE_COOLDOWN_MS, DEFENSE_SPRAY_MAX,
} from '/shared/constants.js';
import { ClientWorld } from './world.js';
import { Renderer, drawThumb } from './renderer.js';
import { sfx, unlock, isMuted, toggleMute } from './audio.js';

const $ = (id) => document.getElementById(id);

const canvas = $('scene');
const renderer = new Renderer(canvas);
const socket = window.io();

// État local
const worlds = new Map(); // pid -> ClientWorld
const demoWorld = new ClientWorld('demo');
let roomState = null;
let myId = sessionStorage.getItem('sc-pid') || null;
let myCode = sessionStorage.getItem('sc-code') || null;
let viewedPid = null; // quel château affiche-t-on en grand ?

let activeTool = 'pate'; // par défaut le pâté de sable maniable pour sculpter librement !
let nextSprayAvailableAt = 0;
const KING_GHOST = { w: KING_W, h: KING_H, mask: new Uint8Array(KING_W * KING_H).fill(1) };

const pointer = { x: 200, y: 110, inside: false, down: false };
let lastClientX = null;
let lastClientY = null;
const aim = {
  angle: (45 * Math.PI) / 180,
  power: 0.65,
  dragging: false,
  pullX: LAUNCH_X,
  pullY: LAUNCH_Y,
};
let remoteAim = null;
let lastSecondTick = -1;
let myCatapultSide = 'left';

function updateCatapultSwitchButton() {
  const switchBtn = $('catapult-switch-btn');
  if (!switchBtn) return;
  const inBattle = roomState?.phase === 'battle';
  const isShooter = inBattle && roomState?.turn?.shooterId === myId && roomState.turn.state === 'aim';
  switchBtn.classList.toggle('hidden', !inBattle || !isShooter);
  switchBtn.classList.toggle('side-left', myCatapultSide === 'left');
  switchBtn.classList.toggle('side-right', myCatapultSide === 'right');
  const arrEl = $('catapult-switch-arrow');
  if (arrEl) {
    arrEl.textContent = myCatapultSide === 'left' ? '▶' : '◀';
  }

  const hud = $('catapult-hud');
  if (hud) {
    hud.classList.toggle('side-left', myCatapultSide === 'left');
    hud.classList.toggle('side-right', myCatapultSide === 'right');
    const nameEl = $('hud-cat-name');
    if (nameEl) {
      nameEl.textContent = myCatapultSide === 'left' ? 'CATAPULTE OUEST' : 'CATAPULTE EST';
    }
    if (typeof updateDialSectorAndNeedle === 'function') {
      updateDialSectorAndNeedle(aim.angle, myCatapultSide);
    }
  }
}

function setCatapultSide(side) {
  if (side !== 'left' && side !== 'right') return;
  myCatapultSide = side;
  if (roomState?.turn && roomState.turn.shooterId === myId) {
    roomState.turn.catapultSide = side;
  }
  const btnL = $('btn-side-left');
  const btnR = $('btn-side-right');
  if (btnL) btnL.classList.toggle('active', side === 'left');
  if (btnR) btnR.classList.toggle('active', side === 'right');
  sfx.ratchet(850);
  socket.emit('chooseCatapultSide', { side });
  socket.emit('aim', { angle: aim.angle, power: aim.power, side });
  updateCatapultSwitchButton();
}

// Petit château de démonstration sur l'écran d'accueil
function seedDemoCastle() {
  const w = demoWorld;
  const arche = SHAPE_BY_ID.arche;
  const seau = SHAPE_BY_ID.seau;
  const cone = SHAPE_BY_ID.cone;
  const stampLocal = (shape, left, top, type = 2) => {
    if (!shape) return;
    for (let y = 0; y < shape.h; y++) {
      for (let x = 0; x < shape.w; x++) {
        if (shape.mask[y * shape.w + x]) {
          w.cells[(top + y) * GRID_W + (left + x)] = type;
        }
      }
    }
  };
  stampLocal(arche, 218, GROUND_Y - arche.h, 6);
  stampLocal(seau, 222, GROUND_Y - arche.h - seau.h, 2);
  stampLocal(cone, 223, GROUND_Y - arche.h - seau.h - cone.h, 2);
  stampLocal(seau, 182, GROUND_Y - seau.h, 2);
  stampLocal(seau, 262, GROUND_Y - seau.h, 2);
  w.king = { x: 233, y: GROUND_Y - KING_H, dead: false, hits: 0, maxHits: 8 };
  w.version++;
}
// Pas de simulation ni de château chargé en arrière-plan au lancement : 0% CPU !
// seedDemoCastle();

// ------------------------------------------------------------------ Initialisation UI
function initTools() {
  const toolsRow = $('atelier-tools-row');
  const mouldsGrid = $('tool-list');
  if (toolsRow) toolsRow.innerHTML = '';
  if (mouldsGrid) mouldsGrid.innerHTML = '';

  // 1. Outils de modelage au-dessus des patrons de sable
  const manipulationTools = [
    { id: 'retirer', label: 'Creuser 🥄', desc: 'Retire du sable sur une petite surface [X]', key: 'X', isDig: true },
    { id: 'aplatir', label: 'Aplatir 🔨', desc: 'Nivèle et tasse le sable pour faire une surface plane [F]', key: 'F', isFlatten: true },
    { id: 'spray', label: 'Spray 💦', desc: 'Arrose et durcit le sable (cooldown 3s) [E]', key: 'E', isSpray: true },
    { id: 'flip', label: 'Inverser 🔄', desc: 'Retourne le patron horizontalement [R]', key: 'R', isFlip: true },
  ];

  // 2. Patrons et moules de construction
  const mouldTools = SHAPES.map((s, idx) => ({
    id: s.id,
    label: s.label,
    desc: s.desc,
    key: String(idx + 1),
    shape: s,
  }));

  const createBtn = (t, container) => {
    const btn = document.createElement('button');
    btn.className = `tool-btn${t.isFlip ? ' flip-tool' : ''}${t.isSpray ? ' spray-tool' : ''}${t.id === activeTool ? ' active' : ''}`;
    btn.dataset.tool = t.id;
    btn.title = t.desc || t.label;

    const icon = document.createElement('canvas');
    icon.width = 40;
    icon.height = 28;
    drawToolIcon(icon, t);

    const lbl = document.createElement('span');
    lbl.className = 'tool-label';
    lbl.textContent = t.label;

    const key = document.createElement('span');
    key.className = 'tool-key';
    key.textContent = `[${t.key}]`;

    btn.append(icon, lbl, key);
    btn.addEventListener('click', () => {
      if (btn.classList.contains('depleted')) return;
      if (t.isFlip) {
        toggleMouldFlip();
        return;
      }
      selectTool(t.id);
    });
    container.appendChild(btn);
  };

  if (toolsRow) {
    for (const t of manipulationTools) createBtn(t, toolsRow);
  }
  if (mouldsGrid) {
    for (const t of mouldTools) createBtn(t, mouldsGrid);
  }

  const toggleBtn = $('toggle-build-sidebar');
  if (toggleBtn && !toggleBtn._init) {
    toggleBtn._init = true;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dock = $('build-dock');
      dock.classList.toggle('collapsed');
      const isCollapsed = dock.classList.contains('collapsed');
      toggleBtn.textContent = isCollapsed ? '▶' : '◀';
      toggleBtn.title = isCollapsed ? 'Déplier l\'inventaire' : 'Réduire l\'inventaire';
    });
  }

  const buildDock = $('build-dock');
  if (buildDock && !buildDock._initEvents) {
    buildDock._initEvents = true;
    buildDock.addEventListener('pointerdown', (e) => e.stopPropagation());
    buildDock.addEventListener('click', (e) => e.stopPropagation());
  }

  updateToolStocks();
}

let isMouldFlipped = false;
function toggleMouldFlip() {
  isMouldFlipped = !isMouldFlipped;
  sfx.ratchet();
  const btn = document.querySelector('.tool-btn[data-tool="flip"]');
  if (btn) btn.classList.toggle('active', isMouldFlipped);
  const px = pointer?.x || 210;
  const py = pointer?.y || 120;
  renderer.popup(px, py - 8, isMouldFlipped ? '🔄 Patron inversé (Miroir)' : '🔄 Patron normal', '#c084fc');
}

function updateToolStocks() {
  const me = roomState?.players?.find((p) => p.id === myId);
  const stocks = me?.moulds || roomState?.mouldStock;
  for (const btn of document.querySelectorAll('.tool-btn')) {
    const id = btn.dataset.tool;
    if (id === 'flip' || id === 'spray' || id === 'aplatir' || id === 'retirer') {
      btn.classList.remove('depleted');
      btn.style.display = '';
      if (id === 'flip') btn.classList.toggle('active', isMouldFlipped);
      const badge = btn.querySelector('.tool-stock');
      if (badge) badge.remove();
      continue;
    }
    let badge = btn.querySelector('.tool-stock');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tool-stock';
      btn.appendChild(badge);
    }
    // Le pâté de base est toujours disponible
    if (id === 'pate') {
      badge.textContent = '∞';
      badge.classList.remove('depleted');
      btn.classList.remove('depleted');
      btn.style.display = '';
      continue;
    }
    const count = stocks ? (stocks[id] ?? 0) : 0;
    if (count <= 0) {
      badge.textContent = 'x0';
      badge.classList.add('depleted');
      btn.classList.add('depleted');
      btn.style.display = 'none'; // Masquer pour éliminer le scroll !
      if (activeTool === id) selectTool('pate');
    } else {
      badge.textContent = `x${count}`;
      badge.classList.remove('depleted');
      btn.classList.remove('depleted');
      btn.style.display = '';
    }
  }
}

function drawToolIcon(c, t) {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (t.isFlip) {
    g.fillStyle = '#a855f7';
    g.fillRect(8, 12, 11, 4);
    g.beginPath();
    g.moveTo(8, 8);
    g.lineTo(2, 14);
    g.lineTo(8, 20);
    g.closePath();
    g.fill();
    g.fillStyle = '#c084fc';
    g.fillRect(21, 12, 11, 4);
    g.beginPath();
    g.moveTo(32, 8);
    g.lineTo(38, 14);
    g.lineTo(32, 20);
    g.closePath();
    g.fill();
    return;
  }
  if (t.isSpray) {
    g.fillStyle = '#0284c7';
    g.fillRect(10, 11, 12, 14);
    g.fillStyle = '#38bdf8';
    g.fillRect(13, 6, 6, 5);
    g.fillRect(18, 7, 6, 3);
    g.fillStyle = '#7dd3fc';
    for (const [dx, dy] of [[26, 6], [30, 4], [29, 9], [33, 7], [27, 12]]) {
      g.fillRect(dx, dy, 2, 2);
    }
    return;
  }
  if (t.isFlatten) {
    // Truelle de maçon / Aplatir
    g.fillStyle = '#facc15';
    g.fillRect(6, 15, 28, 4);
    g.fillStyle = '#b45309';
    g.fillRect(16, 7, 8, 8);
    g.fillStyle = '#78350f';
    g.fillRect(18, 4, 4, 3);
    return;
  }
  if (t.isDig) {
    // Pelle / Cuillère pour creuser
    g.fillStyle = '#ef4444';
    g.beginPath();
    g.arc(20, 16, 7, 0, Math.PI);
    g.fill();
    g.fillStyle = '#94a3b8';
    g.fillRect(18, 6, 4, 10);
    g.fillStyle = '#64748b';
    g.fillRect(16, 4, 8, 2);
    return;
  }
  const { w, h, mask } = t.shape;
  const scale = Math.min((c.width - 4) / w, (c.height - 4) / h);
  const ox = (c.width - w * scale) / 2;
  const oy = (c.height - h * scale) / 2;
  g.fillStyle = '#c4a068';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        g.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
  }
}

function selectTool(id) {
  activeTool = id;
  for (const b of document.querySelectorAll('.tool-btn')) {
    b.classList.toggle('active', b.dataset.tool === id);
  }
}

// ------------------------------------------------------------------ Lobby & Connexion
const nameInput = $('name-input');
const codeInput = $('code-input');
nameInput.value = localStorage.getItem('sc-name') || '';

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('room')) {
  codeInput.value = urlParams.get('room').toUpperCase().slice(0, 4);
}

function getPlayerName() {
  const n = nameInput.value.trim() || `Plagiste ${Math.floor(10 + Math.random() * 89)}`;
  localStorage.setItem('sc-name', n);
  return n;
}

function showLobbyError(msg) {
  const el = $('lobby-error');
  if (!msg) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

$('create-btn').addEventListener('click', () => {
  unlock();
  resetAllGameData();
  showLobbyError(null);
  socket.emit('create', { name: getPlayerName() }, (res) => {
    if (!res?.ok) return showLobbyError(res?.error || 'Erreur');
    onJoinedRoom(res.code, res.playerId);
  });
});

$('join-btn').addEventListener('click', () => {
  unlock();
  resetAllGameData();
  showLobbyError(null);
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return showLobbyError('Entre le code à 4 lettres de la plage');
  socket.emit('join', { code, name: getPlayerName() }, (res) => {
    if (!res?.ok) return showLobbyError(res?.error || 'Salle introuvable');
    onJoinedRoom(res.code, res.playerId);
  });
});

$('solo-btn').addEventListener('click', () => {
  unlock();
  resetAllGameData();
  showLobbyError(null);
  socket.emit('create', { name: getPlayerName() }, (res) => {
    if (!res?.ok) return showLobbyError(res?.error || 'Erreur');
    onJoinedRoom(res.code, res.playerId);
    socket.emit('addBot', {}, () => {
      socket.emit('start', {});
    });
  });
});

$('add-bot-btn').addEventListener('click', () => {
  unlock();
  socket.emit('addBot', {});
});

$('start-btn').addEventListener('click', () => {
  unlock();
  resetAllGameData();
  socket.emit('start', {}, (res) => {
    if (res && !res.ok) toast(res.error);
  });
});

$('replay-btn').addEventListener('click', () => {
  unlock();
  resetAllGameData();
  socket.emit('start', {});
});

$('back-lobby-btn').addEventListener('click', () => {
  unlock();
  resetAllGameData();
  const overModal = $('over-modal');
  if (overModal) overModal.classList.add('hidden');
  $('lobby-modal').classList.remove('hidden');
  stopGameLoop();
  socket.emit('lobby', {});
});

const leaveBtn = $('leave-room-btn');
if (leaveBtn) {
  leaveBtn.addEventListener('click', () => {
    unlock();
    resetAllGameData();
    sessionStorage.removeItem('sc-pid');
    sessionStorage.removeItem('sc-code');
    myId = null;
    myCode = null;
    roomState = null;
    socket.emit('leave', {});
    $('room-view').classList.add('hidden');
    $('welcome-view').classList.remove('hidden');
    $('lobby-modal').classList.remove('hidden');
    $('hud').classList.add('hidden');
    stopGameLoop();
  });
}


$('room-pill').addEventListener('click', () => {
  if (!roomState) return;
  const link = `${location.origin}/?room=${roomState.code}`;
  navigator.clipboard?.writeText(link);
  toast(`🔗 Lien d'invitation copié : ${link}`);
});

$('spray-quick-btn').addEventListener('click', () => {
  unlock();
  if (roomState?.phase === 'build') {
    selectTool('spray');
    toast('💦 Outil Spray sélectionné : clique sur ton château pour le durcir !');
  } else {
    toast('💦 Clique directement sur ton château pour arroser et durcir le sable !');
  }
});

function updateMuteBtn() {
  $('mute-btn').textContent = isMuted() ? '🔇' : '🔊';
}
updateMuteBtn();
$('mute-btn').addEventListener('click', () => {
  unlock();
  toggleMute();
  updateMuteBtn();
});

function resetAllGameData() {
  worlds.clear();
  if (demoWorld && demoWorld.cells) {
    demoWorld.cells.fill(0);
    for (let i = 150 * GRID_W; i < GRID_W * GRID_H; i++) demoWorld.cells[i] = 1;
    demoWorld.version++;
  }
  renderer.drawnKey = null;
  renderer.trail = null;
  renderer.popups = [];
  lastPlaceAttempt = 0;
  nextPlaceAllowedAt = 0;
  nextSprayAvailableAt = 0;
  aim.dragging = false;
  aim.power = 0.5;
  aim.angle = (45 * Math.PI) / 180;
  isCharging = false;
  chargeStartTime = 0;
  currentChargePower = 0.5;
  remoteAim = null;

  const overModal = $('over-modal');
  if (overModal) overModal.classList.add('hidden');
  const targetModal = $('target-choice-modal');
  if (targetModal) targetModal.classList.add('hidden');
  const powerBar = $('power-gauge-bar');
  if (powerBar) powerBar.style.width = '0%';
  const powerValText = $('power-val');
  if (powerValText) powerValText.textContent = '0';
  const bucketFillEl = $('bucket-status-fill');
  if (bucketFillEl) bucketFillEl.style.width = '100%';
  const bucketLabelEl = $('bucket-status-label');
  if (bucketLabelEl) bucketLabelEl.textContent = 'Seau plein & prêt';
  const flowEl = $('timeline-flow');
  if (flowEl) flowEl.innerHTML = '';
  const timelineEl = $('battle-timeline');
  if (timelineEl) timelineEl.classList.add('hidden');
  const strip = $('players-strip');
  if (strip) strip.innerHTML = '';
}

async function onJoinedRoom(code, playerId) {
  resetAllGameData();
  stopGameLoop();
  $('hud').classList.add('hidden');
  myId = playerId;
  myCode = code;
  sessionStorage.setItem('sc-pid', playerId);
  sessionStorage.setItem('sc-code', code);
  $('welcome-view').classList.add('hidden');
  $('room-view').classList.remove('hidden');
  $('lobby-code').textContent = code;

  try {
    const r = await fetch(`/api/join-info?code=${encodeURIComponent(code)}`);
    const info = await r.json();
    $('qr-box').innerHTML = info.qrSvg || '';
    $('join-url-text').textContent = info.url || '';
  } catch {}
}

socket.on('connect', () => {
  if (myCode && myId) {
    socket.emit('join', { code: myCode, playerId: myId, name: getPlayerName() }, (res) => {
      if (res?.ok) onJoinedRoom(res.code, res.playerId);
      else {
        sessionStorage.removeItem('sc-pid');
        sessionStorage.removeItem('sc-code');
      }
    });
  }
});

// ------------------------------------------------------------------ Réception réseau
socket.on('world', (msg) => {
  let w = worlds.get(msg.pid);
  if (!w) {
    w = new ClientWorld(msg.pid);
    worlds.set(msg.pid, w);
  }
  w.apply(msg);
  refreshThumb(msg.pid);
});

socket.on('room', (state) => {
  const prevPhase = roomState?.phase;
  roomState = state;
  for (const p of state.players) {
    if (!worlds.has(p.id)) worlds.set(p.id, new ClientWorld(p.id));
  }
  const me = state.players.find((p) => p.id === myId);
  if (me && me.sprayReadyIn > 0) {
    nextSprayAvailableAt = Math.max(nextSprayAvailableAt, performance.now() + me.sprayReadyIn);
  }
  if (prevPhase !== state.phase) {
    if (state.phase === 'build') {
      resetAllGameData();
      for (const p of state.players) {
        worlds.set(p.id, new ClientWorld(p.id));
      }
      viewedPid = myId;
      selectTool('pate');
      playIntroSequence('build');
    } else if (state.phase === 'battle') {
      playIntroSequence('battle');
    }
  }
  syncUI();
});

let introTimeoutIds = [];
function playIntroSequence(kind) {
  introTimeoutIds.forEach(clearTimeout);
  introTimeoutIds = [];

  const overlay = $('intro-overlay');
  const bucketSvg = $('intro-bucket-svg');
  const catapultIcon = $('intro-catapult-icon');
  const title = $('intro-title');
  const subtitle = $('intro-subtitle');
  const bar = $('intro-progress-bar-fill');
  const sandRect = $('intro-sand-rect');
  const sandEllipse = $('intro-sand-ellipse');
  const sandStream = $('intro-sand-stream');

  if (!overlay || !title || !subtitle || !bar) return;

  overlay.classList.remove('hidden');
  title.classList.remove('big-step');

  if (kind === 'build') {
    if (bucketSvg) bucketSvg.classList.remove('hidden');
    if (catapultIcon) catapultIcon.classList.add('hidden');

    // Étape 1 : PRÊTS ?
    title.textContent = 'PRÊTS ?';
    subtitle.textContent = 'Préparation du seau de sable...';
    bar.style.width = '15%';
    if (sandRect) sandRect.setAttribute('y', '138');
    if (sandEllipse) sandEllipse.setAttribute('cy', '138');
    if (sandStream) sandStream.setAttribute('opacity', '0');
    sfx.place();

    // Étape 2 : FEU… (remplissage du seau)
    introTimeoutIds.push(setTimeout(() => {
      title.textContent = 'FEU…';
      subtitle.textContent = 'Remplissage du seau de sable mouillé !';
      bar.style.width = '65%';
      if (sandRect) sandRect.setAttribute('y', '50');
      if (sandEllipse) sandEllipse.setAttribute('cy', '50');
      if (sandStream) sandStream.setAttribute('opacity', '1');
      sfx.place();
    }, 900));

    // Étape 3 : CONSTRUISEZ !
    introTimeoutIds.push(setTimeout(() => {
      title.textContent = 'CONSTRUISEZ !';
      title.classList.add('big-step');
      subtitle.textContent = 'Chaque pâté protège le Roi sans l\'écraser !';
      bar.style.width = '100%';
      if (sandStream) sandStream.setAttribute('opacity', '0');
      sfx.go();
      if (typeof window.confetti === 'function') {
        window.confetti({ particleCount: 35, spread: 60, origin: { y: 0.5 } });
      }
    }, 1850));

    // Fin
    introTimeoutIds.push(setTimeout(() => {
      overlay.classList.add('hidden');
    }, 2900));
  } else if (kind === 'battle') {
    if (bucketSvg) bucketSvg.classList.add('hidden');
    if (catapultIcon) catapultIcon.classList.remove('hidden');

    // Étape 1 : PRÊTS ?
    title.textContent = 'PRÊTS ?';
    subtitle.textContent = 'La catapulte est sur le sable...';
    bar.style.width = '20%';
    sfx.winch(0.2);

    // Étape 2 : FEU…
    introTimeoutIds.push(setTimeout(() => {
      title.textContent = 'FEU…';
      subtitle.textContent = '1 boulet par tour ! Récolte les caisses bonus 🎁 parachutées !';
      bar.style.width = '65%';
      sfx.fire();
    }, 900));

    // Étape 3 : TIREZ !
    introTimeoutIds.push(setTimeout(() => {
      title.textContent = 'TIREZ !';
      title.classList.add('big-step');
      subtitle.textContent = 'Visez le château ou le Roi adverse !';
      bar.style.width = '100%';
      sfx.go();
    }, 1850));

    // Fin
    introTimeoutIds.push(setTimeout(() => {
      overlay.classList.add('hidden');
    }, 2900));
  }
}

socket.on('aim', (a) => {
  remoteAim = a;
  if (a?.side && roomState?.turn) {
    roomState.turn.catapultSide = a.side;
  }
});

socket.on('log', (msg) => {
  toast(msg);
  addLogMessage(msg);
});

socket.on('chat', (entry) => {
  addChatMessage(entry);
});

socket.on('fx', (e) => {
  const activePid = viewedPid || myId;
  if (e.type === 'catapultSide') {
    if (roomState?.turn) roomState.turn.catapultSide = e.side;
  } else if (e.type === 'place') {
    if (e.pid !== myId) {
      sfx.place();
      renderer.puff(e.left + 10, e.top + 10, 6, 10);
      renderer.addPouringBucket(e.left + 10, e.top + 6);
    }
  } else if (e.type === 'spray') {
    if (e.pid === activePid || e.pid === myId) {
      sfx.spray();
      renderer.waterMist(e.x, e.y, e.radius);
      renderer.popup(e.x, e.y - 6, '💦 Sable durci !', '#38bdf8');
    }
    if (e.pid === myId) {
      nextSprayAvailableAt = performance.now() + SPRAY_COOLDOWN_MS;
    }
  } else if (e.type === 'collapse') {
    if (e.pid === activePid) {
      sfx.collapse();
      renderer.shake = Math.min(10, 3 + e.count * 0.05);
    }
  } else if (e.type === 'kingDanger') {
    if (e.pid === activePid || e.pid === myId) {
      sfx.danger();
      renderer.popup(e.x, e.y - 8, `⚠️ Roi enseveli (${e.hits}/${e.max}) !`, '#fbbf24');
    }
  } else if (e.type === 'king') {
    sfx.king();
    const w = worlds.get(e.pid);
    if (w) {
      if (w.king) {
        for (let y = 0; y < KING_H; y++) {
          for (let x = 0; x < KING_W; x++) {
            const idx = (w.king.y + y) * GRID_W + w.king.x + x;
            if ((w.cells[idx] & TYPE_MASK) === T.KING) w.cells[idx] = 0;
          }
        }
      }
      w.king = { x: e.left, y: e.top, dead: false, hits: 0, maxHits: 8 };
      for (let y = 0; y < KING_H; y++) {
        for (let x = 0; x < KING_W; x++) {
          const idx = (e.top + y) * GRID_W + e.left + x;
          w.cells[idx] = T.KING;
        }
      }
      w.version++;
      renderer.drawnKey = null;
    }
    renderer.puff(e.left + 2, e.top + 6, 5, 10, '255,230,140');
    renderer.popup(e.left + 2, e.top - 3, '👑 Roi posé !', '#fde047');
  } else if (e.type === 'fire') {
    sfx.fire();
    renderer.catapult.loaded = false;
    renderer.catapult.target = 0.55;
    setTimeout(() => {
      renderer.catapult.target = 2.95;
      renderer.catapult.loaded = true;
    }, 900);
  } else if (e.type === 'impact') {
    sfx.impact(Math.min(1.5, (e.speed || 2) / 3));
    renderer.shake = Math.min(18, 5 + (e.r || 5) * 1.3);
    renderer.puff(e.x, e.y, e.r || 6, 24);
  } else if (e.type === 'miss') {
    sfx.miss();
  } else if (e.type === 'grenadeLand') {
    sfx.grenadeLand();
    renderer.puff(e.x, e.y, 6, 12, '255,200,80');
    renderer.popup(e.x, e.y - 6, '💣 Goupille lâchée ! 2.0s', '#facc15');
  } else if (e.type === 'grenadeTick') {
    sfx.grenadeTick(e.fuseLeft);
  } else if (e.type === 'grenadeExplosion') {
    sfx.grenadeExplosion();
    renderer.shake = Math.min(35, 18 + (e.r || 22) * 0.9);
    renderer.puff(e.x, e.y, (e.r || 22) * 1.5, 60, '255,100,30');
    renderer.waterMist(e.x, e.y, e.r || 22);
    renderer.popup(e.x, e.y - 12, '💥 BOOOOOM ! GRENADE !', '#ef4444');
  } else if (e.type === 'grenadeEquipped') {
    renderer.popup(CATAPULT_X + 15, GROUND_Y - 20, '💣 GRENADE ÉQUIPÉE !', '#4ade80');
  } else if (e.type === 'kingDead') {
    sfx.kingDead();
    renderer.shake = 18;
    renderer.puff(e.x, e.y, 10, 28, '240,84,45');
    renderer.popup(e.x, e.y - 8, '💀 ROI ÉLIMINÉ !', '#ef4444');
  } else if (e.type === 'win') {
    sfx.win();
    fireVictoryConfetti();
  } else if (e.type === 'bonus') {
    sfx.win();
    let msg = '🎁 BONUS OBTENU !';
    let color = '56,189,248';
    if (e.bonusType === 'ammo') {
      msg = '☄️ +1 BOULET DE CANON EN RÉSERVE !';
      color = '255,120,40';
    } else if (e.bonusType === 'spray') {
      msg = '💦 +1 DOSE DE SPRAY DÉFENSIF EN RÉSERVE !';
      color = '56,189,248';
    } else if (e.bonusType === 'heavySpikeBall') {
      msg = '💣 BOULET D\'ACIER À PICS ARMÉ POUR LE PROCHAIN TIR !';
      color = '148,163,184';
    } else if (e.bonusType === 'grenade') {
      msg = '🧨 GRENADE EXPLOSIVE ARMÉE (EXPLOSION RETARDÉE 2s) !';
      color = '74,222,128';
    } else if (e.bonusType === 'wetAll') {
      msg = '🌊 DÉLUGE BÉNI : CHÂTEAU FORTIFIÉ !';
      color = '56,189,248';
    } else if (e.bonusType === 'dryOpponent') {
      msg = '☀️ SÉCHERESSE APOCALYPTIQUE SUR LE CHÂTEAU ADVERSE !';
      color = '245,158,11';
    }
    renderer.puff(e.x, e.y, 8, 24, color);
    renderer.popup(e.x, e.y - 8, msg, '#fef08a');
    if (e.pid === myId && typeof window.confetti === 'function') {
      window.confetti({ particleCount: 50, spread: 60, origin: { y: 0.65 } });
    }
  } else if (e.type === 'bonusSpray') {
    sfx.spray();
    renderer.puff(e.x, e.y, 8, 20, '56,189,248');
    renderer.waterMist(e.x, e.y, 16);
    renderer.popup(e.x, e.y - 8, '💦 +1 Spray Défensif en réserve !', '#38bdf8');
  } else if (e.type === 'flatten') {
    if (e.pid === activePid) {
      sfx.place();
      renderer.puff(e.x, e.y, 6, 14, '240,215,160');
      renderer.popup(e.x, e.y - 6, '🔨 Sol aplati !', '#60a5fa');
    }
  } else if (e.type === 'dig') {
    if (e.pid === activePid) {
      sfx.collapse();
      renderer.puff(e.x, e.y, 8, 14, '210,180,140');
      renderer.popup(e.x, e.y - 6, '🥄 Creusé !', '#ef4444');
    }
  } else if (e.type === 'dryAll') {
    sfx.solarStorm();
    renderer.triggerSolarStormFX();
  } else if (e.type === 'wetAll') {
    sfx.deluge();
    renderer.triggerDelugeFX();
  } else if (e.type === 'dropSplash') {
    sfx.miss();
    renderer.puff(e.x, e.y, 6, 16, '186,230,253');
  } else if (e.type === 'dropSunk') {
    renderer.puff(e.x, e.y, 4, 8, '147,197,253');
  } else if (e.type === 'phase') {
    sfx.go();
    if (e.intro) {
      playIntroSequence(e.intro);
    }
  }
});

function fireVictoryConfetti() {
  if (typeof window.confetti !== 'function') return;
  window.confetti({ particleCount: 90, spread: 75, origin: { y: 0.6 } });
  setTimeout(() => {
    window.confetti({ particleCount: 65, angle: 60, spread: 55, origin: { x: 0 } });
    window.confetti({ particleCount: 65, angle: 120, spread: 55, origin: { x: 1 } });
  }, 350);
}

// ------------------------------------------------------------------ Synchronisation de l'interface
function syncUI() {
  const s = roomState;
  if (!s) return;

  if (s.phase === 'lobby') {
    stopGameLoop();
    $('hud').classList.add('hidden');
    $('welcome-view').classList.add('hidden');
    $('room-view').classList.remove('hidden');
    $('over-modal').classList.add('hidden');
  } else {
    $('hud').classList.remove('hidden');
    startGameLoop();
  }

  $('room-pill').textContent = `🏖️ PLAGE ${s.code}`;

  const phaseLabels = {
    lobby: 'SALON',
    build: '🧱 CONSTRUCTION (1 MIN)',
    settle: '⏳ TASSEMENT DU SABLE',
    battle: '☄️ BATAILLE DE CATAPULTE',
    over: '🏆 FIN DE PARTIE',
  };
  $('phase-pill').textContent = phaseLabels[s.phase] || s.phase.toUpperCase();

  const isHost = s.hostId === myId;
  const me = s.players.find((p) => p.id === myId);

  // Bouton Spray dans le HUD (visible en build & battle)
  $('spray-quick-btn').classList.toggle('hidden', s.phase !== 'build' && s.phase !== 'battle');

  // Modale Lobby
  $('lobby-modal').classList.toggle('hidden', s.phase !== 'lobby');
  if (s.phase === 'lobby') {
    $('roster-count').textContent = String(s.players.length);
    $('add-bot-btn').classList.toggle('hidden', !isHost || s.players.length >= 8);
    $('start-btn').classList.toggle('hidden', !isHost);
    $('start-btn').disabled = s.players.length < 2;
    $('wait-host-msg').classList.toggle('hidden', isHost);

    const ul = $('roster-list');
    ul.innerHTML = '';
    for (const p of s.players) {
      const li = document.createElement('li');
      li.className = 'roster-item';
      const left = document.createElement('span');
      left.innerHTML = `<span class="color-dot" style="background:${p.color}"></span> ${escapeHtml(p.name)} ${p.id === s.hostId ? '👑' : ''} ${p.isBot ? '🤖' : ''}`;
      li.appendChild(left);
      if (isHost && p.isBot) {
        const kick = document.createElement('button');
        kick.className = 'kick-btn';
        kick.textContent = 'Retirer';
        kick.addEventListener('click', () => socket.emit('kick', { id: p.id }));
        li.appendChild(kick);
      }
      ul.appendChild(li);
    }
  }

  // Choix du château affiché en grand
  if (s.phase === 'build' || s.phase === 'settle') {
    if (!viewedPid || !s.players.some((p) => p.id === viewedPid)) {
      viewedPid = myId || s.players[0]?.id;
    }
  } else if (s.phase === 'battle' && s.turn) {
    viewedPid = s.turn.targetId;
  }

  // Bandeau d'instruction (tooltip détachée au-dessus de la scène)
  const banner = $('banner-msg');
  if (banner) {
    banner.classList.toggle('in-battle', s.phase === 'battle');
    if (s.phase === 'build') {
      if (!me?.alive) {
        banner.textContent = '💀 Ton Roi a été enseveli pendant la construction !';
      } else {
        banner.textContent = '🧱 Bâtis autour de ton Roi 👑 et durcis ton sable au Spray 💦 !';
      }
    } else if (s.phase === 'settle') {
      banner.textContent = '⏳ Voyons si les châteaux résistent à la gravité…';
    } else if (s.phase === 'battle' && s.turn) {
      const shooter = s.players.find((p) => p.id === s.turn.shooterId);
      const target = s.players.find((p) => p.id === s.turn.targetId);
      if (s.turn.shooterId === myId) {
        banner.textContent = `🎯 À ton tour ! Tire sur le château de ${target?.name || ''}`;
      } else if (s.turn.targetId === myId) {
        banner.textContent = `🛡️ ${shooter?.name || '?'} te vise ! Clique sur ton château pour arroser et durcir le sable 💦 !`;
      } else {
        banner.textContent = `👀 ${shooter?.name || '?'} vise le château de ${target?.name || '?'}`;
      }
    } else if (s.phase === 'over') {
      const w = s.players.find((p) => p.id === s.winnerId);
      banner.textContent = w ? `🏆 ${w.name} remporte la partie !` : 'Match nul !';
    }
  }

  // Dock de construction
  $('build-dock').classList.toggle('hidden', s.phase !== 'build');
  if (s.phase === 'build' && me) {
    const kw = $('king-warning');
    if (!me.alive) {
      kw.className = 'dock-hint danger';
      kw.innerHTML = '💀 <strong>Ton Roi a été enseveli sous un effondrement !</strong>';
    } else if (me.kingHits > 0) {
      kw.className = 'dock-hint danger';
      kw.innerHTML = `⚠️ <strong>Attention !</strong> Ton Roi commence à être enseveli (${me.kingHits}/8 grains) ! Dégage-le à la cuillère [X] !`;
    } else {
      kw.className = 'dock-hint placed';
      kw.innerHTML = '👑 <strong>Ton Roi est sur la plage !</strong> Pose une Arche ou un Bunker par-dessus sans l\'écraser.';
    }
  }

  // Bouton rouge pour arrêter la partie et revenir au salon
  const quitBtn = $('quit-game-btn');
  if (quitBtn) {
    const inGame = s && s.phase !== 'lobby';
    quitBtn.classList.toggle('hidden', !inGame);
  }

  // Contrôles de bataille directement sur la catapulte et bouton de switch latéral
  const inBattle = s.phase === 'battle' && s.turn;
  const isMyTurn = inBattle && s.turn.shooterId === myId && s.turn.state === 'aim';
  const isDefending = inBattle && s.turn.targetId === myId;

  $('catapult-hud')?.classList.toggle('hidden', !isMyTurn);
  $('defender-controls').classList.toggle('hidden', !inBattle || isMyTurn);
  $('wind-pill').classList.toggle('hidden', !inBattle);

  // Bouton latéral de bascule de catapulte (au centre sur le bord où se trouve la catapulte opposée)
  updateCatapultSwitchButton();

  if (inBattle) {
    const wVal = Math.round((s.turn.wind || 0) * 10);
    const arrow = wVal > 0 ? '→'.repeat(Math.min(3, Math.ceil(wVal / 3))) : wVal < 0 ? '←'.repeat(Math.min(3, Math.ceil(-wVal / 3))) : 'calme';
    $('wind-pill').textContent = `💨 Vent : ${arrow} (${wVal > 0 ? '+' : ''}${wVal})`;

    // Mettre à jour l'indicateur des boules de catapulte disponibles
    const shotsBallsEl = $('shots-balls');
    if (shotsBallsEl && s.turn) {
      const left = s.turn.shotsLeft ?? 1;
      const total = s.turn.shotsTotal ?? 1;
      shotsBallsEl.innerHTML = '';
      for (let i = 1; i <= total; i++) {
        const span = document.createElement('span');
        span.className = `shot-ball ${i <= left ? 'available' : 'used'}`;
        const isGrenadeShot = (i === (total - left + 1)) && me?.hasGrenade;
        span.textContent = isGrenadeShot ? '💣' : '☄️';
        span.title = i <= left ? (isGrenadeShot ? 'Grenade explosive retardée prête' : `Tir ${i} prêt`) : `Tir ${i} déjà tiré`;
        shotsBallsEl.appendChild(span);
      }
    }

    const triggerLabelEl = $('trigger-label');
    const triggerBoltEl = document.querySelector('.power-bolt') || document.querySelector('.trigger-bolt');
    if (triggerLabelEl && triggerBoltEl) {
      if (me?.hasGrenade) {
        triggerBoltEl.textContent = '💣';
        if (!isCharging) triggerLabelEl.textContent = 'LANCER LA GRENADE (2s)';
      } else {
        triggerBoltEl.textContent = '⚡';
        if (!isCharging) triggerLabelEl.textContent = 'MAINTENIR POUR DOSER';
      }
    }

    if (!isMyTurn) {
      const shooter = s.players.find((p) => p.id === s.turn.shooterId);
      if (isDefending) {
        const leftSprays = me?.defenseSpraysLeft ?? 1;
        $('spectator-msg').innerHTML = leftSprays > 0
          ? `🛡️ <strong>Tu te défends !</strong> Clique sur ton château ou [E] pour <strong>arroser et durcir ton sable 💦</strong> (${leftSprays} spray disponible pour cette phase de défense) !`
          : '🛡️ <strong>Tu te défends !</strong> Spray déjà utilisé ce tour ! Protège ton Roi !';
      } else {
        $('spectator-msg').innerHTML =
          s.turn.state === 'aim'
            ? `🎯 <strong>${escapeHtml(shooter?.name || 'Le joueur')}</strong> ajuste sa catapulte…`
            : '☄️ <strong>Boulet en vol !</strong>';
      }
    }
    const shooter = s.players.find((p) => p.id === s.turn.shooterId);
    if (shooter) renderer.catapult.color = shooter.color;

    if (s.turn?.catapultSide && s.turn.shooterId !== myId) {
      myCatapultSide = s.turn.catapultSide;
    }
  }

  // Modale de fin de partie / Élimination immédiate
  const isEliminated = me && !me.alive && (s.phase === 'build' || s.phase === 'settle' || s.phase === 'battle');
  const isGameOver = s.phase === 'over';
  $('over-modal').classList.toggle('hidden', !isGameOver && !isEliminated);
  if (isGameOver || isEliminated) {
    if (isGameOver) {
      const w = s.players.find((p) => p.id === s.winnerId);
      const isWinner = s.winnerId === myId;
      $('winner-title').textContent = isWinner
        ? '🏆 VICTOIRE ! Tu règnes sur la plage !'
        : (w ? `💀 DÉFAITE ! ${w.name} remporte la partie !` : 'Match nul !');
      $('winner-subtitle').textContent = isWinner
        ? 'Ton Roi a survécu à tous les tirs et ton château a triomphé !'
        : (w ? `${w.name} a vaincu ton château de sable.` : 'Tous les Rois ont été ensevelis sous le sable.');
      $('replay-btn').classList.toggle('hidden', !isHost);
      $('back-lobby-btn').classList.remove('hidden');
    } else if (isEliminated) {
      $('winner-title').textContent = '💀 TON ROI A PÉRI ! DÉFAITE';
      $('winner-subtitle').textContent = 'Ton Roi a été enseveli sous le sable ou détruit. La partie est terminée pour toi !';
      $('replay-btn').classList.add('hidden');
      $('back-lobby-btn').classList.remove('hidden');
    }
  }

  // Fresque illustrée de bataille & Ordre des tours avec icônes Catapulte / Roi colorées
  const timelineEl = $('battle-timeline');
  const flowEl = $('timeline-flow');
  if (timelineEl && flowEl) {
    if (s.phase === 'battle' && s.turn && s.players.length >= 2) {
      timelineEl.classList.remove('hidden');
      const curShooter = s.players.find((p) => p.id === s.turn.shooterId);
      const curTarget = s.players.find((p) => p.id === s.turn.targetId);
      const isMyShot = s.turn.shooterId === myId;
      const isMyDefense = s.turn.targetId === myId;

      let html = `
        <div class="timeline-step current ${isMyShot ? 'is-me-shooter' : isMyDefense ? 'is-me-target' : ''}">
          <span class="timeline-badge-label">⚡ ROUND ${s.turn.round || 1}</span>
          <div class="fresque-duo">
            <div class="fresque-card shooter" style="border-color:${curShooter?.color || '#ccc'}; background: linear-gradient(135deg, ${curShooter?.color || '#ccc'}22, rgba(0,0,0,0.5))">
              <span class="fresque-role">🎯 TIREUR</span>
              <span class="fresque-name"><span class="color-dot" style="background:${curShooter?.color || '#ccc'}"></span> ${escapeHtml(curShooter?.name || '?')} ${isMyShot ? '<strong>(TOI)</strong>' : ''}</span>
            </div>
            <div class="fresque-vs">
              <span class="fresque-arrow-icon">☄️ ➔</span>
            </div>
            <div class="fresque-card target" style="border-color:${curTarget?.color || '#ccc'}; background: linear-gradient(135deg, ${curTarget?.color || '#ccc'}22, rgba(0,0,0,0.5))">
              <span class="fresque-role">🛡️ CIBLE</span>
              <span class="fresque-name"><span class="color-dot" style="background:${curTarget?.color || '#ccc'}"></span> ${escapeHtml(curTarget?.name || '?')} ${isMyDefense ? '<strong>(TOI)</strong>' : ''}</span>
            </div>
          </div>
        </div>
      `;

      // 1. Ordre complet des tours des joueurs avec leurs couleurs
      const turnOrder = s.turn.turnOrder || s.players.filter((p) => p.alive).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isShooter: p.id === s.turn.shooterId,
      }));
      if (turnOrder.length > 0) {
        html += `<div class="turn-order-seq" title="Ordre de passage des bâtisseurs">`;
        turnOrder.forEach((p, idx) => {
          if (idx > 0) html += `<span class="order-arrow">➔</span>`;
          html += `<span class="order-pill ${p.isShooter ? 'active-shooter' : ''}" style="--c:${p.color}; border-color:${p.color};"><span class="color-dot" style="background:${p.color}"></span> ${escapeHtml(p.name)}</span>`;
        });
        html += `</div>`;
      }

      // 2. Encadré Prochain Tour avec Catapulte colorée + ⚔️ + Roi coloré
      const nextShooter = s.turn.nextShooter || (s.turn.nextShooterId ? s.players.find((p) => p.id === s.turn.nextShooterId) : null);
      const nextTarget = s.turn.nextTarget || (s.turn.nextTargetId ? s.players.find((p) => p.id === s.turn.nextTargetId) : null);
      if (nextShooter && nextTarget) {
        html += `
          <div class="next-fight-box">
            <span class="next-fight-tag">⚔️ PROCHAIN TOUR :</span>
            <div class="next-fighter shooter" style="--c:${nextShooter.color}">
              <span class="fighter-badge-icon" style="--c:${nextShooter.color}" title="Catapulte de ${escapeHtml(nextShooter.name)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="${nextShooter.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 19h16M6 19l4-8h4l4 8M10 11l-3-6 2-1 4 7M12 11V5"/>
                  <circle cx="6" cy="4" r="2.2" fill="${nextShooter.color}"/>
                </svg>
              </span>
              <span style="color:${nextShooter.color}">${escapeHtml(nextShooter.name)}</span>
            </div>
            <span class="next-fight-clash">⚔️</span>
            <div class="next-fighter defender" style="--c:${nextTarget.color}">
              <span class="fighter-badge-icon" style="--c:${nextTarget.color}" title="Roi de ${escapeHtml(nextTarget.name)}">
                <svg viewBox="0 0 24 24" fill="${nextTarget.color}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round">
                  <path d="M5 18h14v2H5v-2zm14-8l-3.5 4.5-3.5-6-3.5 6L5 10v6h14v-6z"/>
                  <circle cx="5" cy="8" r="1.5" fill="#facc15"/>
                  <circle cx="12" cy="6" r="1.5" fill="#facc15"/>
                  <circle cx="19" cy="8" r="1.5" fill="#facc15"/>
                </svg>
              </span>
              <span style="color:${nextTarget.color}">${escapeHtml(nextTarget.name)}</span>
            </div>
          </div>
        `;
      }

      flowEl.innerHTML = html;
    } else {
      timelineEl.classList.add('hidden');
    }
  }

  updateToolStocks();
  renderPlayersStrip();
}

function renderPlayersStrip() {
  const strip = $('players-strip');
  if (!roomState || roomState.phase === 'lobby') {
    strip.classList.add('hidden');
    return;
  }
  strip.classList.remove('hidden');
  strip.innerHTML = '';

  for (const p of roomState.players) {
    const card = document.createElement('div');
    const isTarget = roomState.phase === 'battle' && roomState.turn?.targetId === p.id;
    const isShooter = roomState.phase === 'battle' && roomState.turn?.shooterId === p.id;
    card.className = `player-card${isTarget ? ' active-target' : ''}${isShooter ? ' active-shooter' : ''}${!p.alive ? ' dead' : ''}`;
    card.dataset.pid = p.id;

    const thumb = document.createElement('canvas');
    thumb.className = 'player-thumb';
    thumb.width = 60;
    thumb.height = 34;
    thumb.id = `thumb-${p.id}`;
    const w = worlds.get(p.id);
    if (w) drawThumb(thumb, w, p.color);

    const meta = document.createElement('div');
    meta.className = 'player-meta';
    const status = !p.alive
      ? '💀 Roi enseveli'
      : roomState.phase === 'build'
        ? `🧱 ${p.placed} blocs`
        : isShooter
          ? '🎯 Tireur'
          : isTarget
            ? '🛡️ Ciblé'
            : '👑 En vie';

    meta.innerHTML = `
      <div class="player-name"><span class="color-dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</div>
      <div class="player-status">${status}</div>
    `;

    card.append(thumb, meta);
    card.addEventListener('click', () => {
      if (roomState.phase === 'battle' && roomState.turn?.shooterId === myId && roomState.turn.state === 'aim') {
        if (p.alive && p.id !== myId) socket.emit('chooseTarget', { targetId: p.id });
      } else {
        viewedPid = p.id;
      }
    });
    strip.appendChild(card);
  }
}

function refreshThumb(pid) {
  if (!roomState) return;
  const p = roomState.players.find((x) => x.id === pid);
  const c = $(`thumb-${pid}`);
  const w = worlds.get(pid);
  if (p && c && w) drawThumb(c, w, p.color);
}

// ------------------------------------------------------------------ Contrôles Souris / Tactile / Clavier
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  unlock();
  const cell = renderer.toCell(e.clientX, e.clientY);
  trySprayAt(cell.x, cell.y);
});

canvas.addEventListener('pointermove', (e) => {
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  const cell = renderer.toCell(e.clientX, e.clientY);
  pointer.x = cell.x;
  pointer.y = cell.y;
  pointer.inside = true;

  if (aim.draggingCatapult) {
    const isRight = (roomState?.turn?.catapultSide || myCatapultSide) === 'right';
    const catX = isRight ? (GRID_W - (CATAPULT_X + 6)) : (CATAPULT_X + 6);
    const catY = GROUND_Y - 14;
    setAngleFromCoords(cell.x, cell.y, catX, catY, isRight);
  } else if (aim.dragging) {
    aim.pullX = cell.x;
    aim.pullY = cell.y;
    updateSlingshot(cell.x, cell.y);
  } else if (pointer.down && roomState?.phase === 'build' && activeTool !== 'spray') {
    tryPlaceAtPointer();
  }
});

canvas.addEventListener('pointerleave', () => {
  pointer.inside = false;
});

function openTargetChoiceModal(dropId, opponents) {
  const modal = $('target-choice-modal');
  const list = $('target-choice-list');
  const cancelBtn = $('target-choice-cancel-btn');
  if (!modal || !list) return;

  list.innerHTML = '';
  for (const opp of opponents) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary bonus-target-btn';
    btn.style.borderColor = opp.color;
    btn.innerHTML = `<span class="color-dot" style="background:${opp.color}"></span> ${escapeHtml(opp.name)}`;
    btn.addEventListener('click', () => {
      socket.emit('collectBonus', { dropId, targetPlayerId: opp.id });
      modal.classList.add('hidden');
      sfx.collapse();
      renderer.popup(150, 60, `☀️ Tu as choisi d'assécher ${opp.name} !`, '#f59e0b');
    });
    list.appendChild(btn);
  }

  cancelBtn.onclick = () => {
    modal.classList.add('hidden');
  };

  modal.classList.remove('hidden');
}

function tryCollectBonusAt(cx, cy) {
  if (roomState?.phase !== 'battle' || !roomState?.drops?.length) return false;
  for (const d of roomState.drops) {
    if (d.collected || d.inWater || d.sunk) continue;
    const dist = Math.hypot(cx - d.x, cy - d.y);
    if (dist <= (d.r + 7)) {
      if (d.type === 'dryOpponent') {
        const opponents = roomState.players.filter((p) => p.alive && p.id !== myId);
        if (opponents.length === 1) {
          socket.emit('collectBonus', { dropId: d.id, targetPlayerId: opponents[0].id });
        } else if (opponents.length > 1) {
          openTargetChoiceModal(d.id, opponents);
          return true;
        } else {
          socket.emit('collectBonus', { dropId: d.id });
        }
      } else {
        socket.emit('collectBonus', { dropId: d.id });
      }
      renderer.puff(d.x, d.y, 6, 16, d.type === 'heavySpikeBall' ? '148,163,184' : d.type === 'ammo' ? '255,100,50' : '56,189,248');
      sfx.king();
      return true;
    }
  }
  return false;
}

canvas.addEventListener('pointerdown', (e) => {
  unlock();
  const cell = renderer.toCell(e.clientX, e.clientY);
  pointer.x = cell.x;
  pointer.y = cell.y;

  // Clic droit = Spray d'eau immédiat !
  if (e.button === 2) {
    trySprayAt(cell.x, cell.y);
    return;
  }

  pointer.down = true;

  if (roomState?.phase === 'build') {
    viewedPid = myId;
    tryPlaceAtPointer();
  } else if (roomState?.phase === 'battle') {
    // Si on est le tireur en phase de visée : interaction directe sur la catapulte active (gauche ou droite)
    if (roomState.turn?.shooterId === myId && roomState.turn?.state === 'aim') {
      const isRight = (roomState.turn.catapultSide || myCatapultSide) === 'right';
      const catX = isRight ? (GRID_W - (CATAPULT_X + 6)) : (CATAPULT_X + 6);
      const catY = GROUND_Y - 14;
      const dist = Math.hypot(cell.x - catX, cell.y - catY);

      if (dist <= 42) {
        // Clic direct sur la catapulte pour régler l'angle en glissant !
        aim.draggingCatapult = true;
        setAngleFromCoords(cell.x, cell.y, catX, catY, isRight);
      } else {
        const isNearCat = isRight ? (cell.x > BUILD_MAX_X - 10) : (cell.x < BUILD_MIN_X + 10);
        if (isNearCat) {
          aim.dragging = true;
          aim.pullX = cell.x;
          aim.pullY = cell.y;
          updateSlingshot(cell.x, cell.y);
        }
      }
    } else if (roomState.turn?.targetId === myId) {
      // Si on SE DÉFEND pendant que l'adversaire nous vise ou tire : clic = Spray d'eau durcisseur !
      trySprayAt(cell.x, cell.y);
    }
  } else if (!roomState || roomState.phase === 'lobby') {
    renderer.popup(cell.x, cell.y - 6, '🏰 Clique sur "Jouer" pour commencer la construction !', '#fde047');
  }
});

window.addEventListener('pointerup', () => {
  pointer.down = false;
  if (aim.draggingCatapult) {
    aim.draggingCatapult = false;
  }
  if (aim.dragging) {
    aim.dragging = false;
    fireCatapult();
  }
});

function updateSlingshot(cx, cy) {
  const isRight = (roomState?.turn?.catapultSide || myCatapultSide) === 'right';
  const launchX = isRight ? (GRID_W - LAUNCH_X) : LAUNCH_X;
  const catapultX = isRight ? (GRID_W - CATAPULT_X) : CATAPULT_X;

  let dx = isRight ? (cx - launchX) : (LAUNCH_X - cx);
  let dy = cy - LAUNCH_Y;
  if (dx < 4) {
    dx = isRight ? (catapultX - cx) : (cx - catapultX);
    dy = GROUND_Y - 12 - cy;
  }
  const dist = Math.hypot(dx, dy);
  const rawAngle = Math.atan2(Math.max(4, dy), Math.max(4, dx));
  aim.angle = Math.max((8 * Math.PI) / 180, Math.min((82 * Math.PI) / 180, rawAngle));
  aim.power = Math.max(0.08, Math.min(1, dist / 95));
  syncAimSliders();
  socket.emit('aim', { angle: aim.angle, power: aim.power, side: myCatapultSide });
}

function trySprayAt(cx, cy) {
  const now = performance.now();
  if (roomState?.phase === 'battle') {
    const me = roomState?.players.find((p) => p.id === myId);
    if (me && me.defenseSpraysLeft <= 0) {
      renderer.popup(cx, cy - 4, '🛡️ Plus de spray disponible ! (touche un colis 🎁 au canon)', '#f87171');
      return;
    }
  }
  if (now < nextSprayAvailableAt) {
    const rem = ((nextSprayAvailableAt - now) / 1000).toFixed(1);
    renderer.popup(cx, cy - 4, `⏳ Spray (${rem}s)`, '#94a3b8');
    return;
  }
  socket.emit('spray', { x: cx, y: cy }, (res) => {
    if (res && !res.ok) {
      if (res.error) renderer.popup(cx, cy - 4, `⚠️ ${res.error}`, '#f87171');
      if (res.cooldownMs) nextSprayAvailableAt = performance.now() + res.cooldownMs;
    }
  });
}

let lastPlaceAttempt = 0;
let nextPlaceAllowedAt = 0;
function tryPlaceAtPointer() {
  const now = performance.now();
  if (activeTool === 'spray') {
    trySprayAt(pointer.x, pointer.y);
    return;
  }

  // Avertir si le joueur clique trop à gauche dans la zone catapulte/mer
  if (pointer.x < BUILD_MIN_X) {
    renderer.popup(Math.max(pointer.x, 25), pointer.y - 6, '👉 Zone de château à droite !', '#fde047');
    return;
  }

  // Outil Truelle / Aplatir
  if (activeTool === 'aplatir') {
    if (now < nextPlaceAllowedAt) {
      const rem = ((nextPlaceAllowedAt - now) / 1000).toFixed(1);
      renderer.popup(pointer.x, pointer.y - 6, `⏳ Truelle (${rem}s)`, '#94a3b8');
      return;
    }
    lastPlaceAttempt = now;
    nextPlaceAllowedAt = now + 400;
    sfx.place();
    renderer.puff(pointer.x, pointer.y, 6, 14, '240,215,160');
    renderer.popup(pointer.x, pointer.y - 6, '🔨 Aplati !', '#60a5fa');
    socket.emit('flatten', { x: pointer.x, y: pointer.y });
    const activePid = viewedPid || myId;
    const w = (activePid && worlds.get(activePid)) || demoWorld;
    if (w && w.flatten) {
      w.flatten(pointer.x, pointer.y, 16);
      renderer.drawnKey = null;
    }
    return;
  }

  // Outil Pelle / Cuillère (retirer)
  if (activeTool === 'retirer') {
    if (now < nextPlaceAllowedAt) {
      const rem = ((nextPlaceAllowedAt - now) / 1000).toFixed(1);
      renderer.popup(pointer.x, pointer.y - 6, `⏳ Pelle (${rem}s)`, '#94a3b8');
      return;
    }
    lastPlaceAttempt = now;
    nextPlaceAllowedAt = now + 400;
    sfx.collapse();
    renderer.puff(pointer.x, pointer.y, 8, 14, '210,180,140');
    renderer.popup(pointer.x, pointer.y - 6, '🥄 Creusé !', '#ef4444');
    socket.emit('dig', { x: pointer.x, y: pointer.y });
    const activePid = viewedPid || myId;
    const w = (activePid && worlds.get(activePid)) || demoWorld;
    if (w && w.dig) {
      w.dig(pointer.x, pointer.y, 5);
      renderer.drawnKey = null;
    }
    return;
  }

  const toolToUse = activeTool;
  const isPate = toolToUse === 'pate';
  const cooldownMs = isPate ? PATE_COOLDOWN_MS : BUILD_PLACE_COOLDOWN_MS;

  // Vérifier le cooldown de remplissage (0.8s pour le pâté manuel, 3.0s pour les moules)
  if (now < nextPlaceAllowedAt) {
    const rem = ((nextPlaceAllowedAt - now) / 1000).toFixed(1);
    renderer.popup(pointer.x, pointer.y - 6, isPate ? `⏳ Main (${rem}s)` : `⏳ Seau (${rem}s)`, '#94a3b8');
    return;
  }

  // Vérifier le stock de moules disponible
  const me = roomState?.players?.find((p) => p.id === myId);
  if (!isPate && me?.moulds && me.moulds[toolToUse] !== undefined && me.moulds[toolToUse] <= 0) {
    renderer.popup(pointer.x, pointer.y - 6, '❌ Moule épuisé pour cette partie !', '#ef4444');
    return;
  }

  const activePid = viewedPid || myId;
  const w = (activePid && worlds.get(activePid)) || demoWorld;
  const baseShape = SHAPE_BY_ID[toolToUse];
  if (!baseShape || !w) return;
  const shape = isMouldFlipped ? getFlippedShape(baseShape) : baseShape;

  const pos = spawnPosition(w.cellType, shape, pointer.x, pointer.y, w.king);
  if (!pos || !pos.valid) {
    // Feedback rouge immédiat sans consommer de stock ni remplacer par un pâté !
    renderer.quickRedFlash(pointer.x - shape.w / 2, pointer.y - shape.h / 2, shape.w, shape.h);
    if (pos?.nearKing) {
      renderer.popup(pointer.x, pointer.y - 6, '👑 Safe zone du Roi ! Laisse-lui de la place !', '#fbbf24');
    } else {
      renderer.popup(pointer.x, pointer.y - 6, '❌ Emplacement invalide !', '#ef4444');
    }
    return;
  }

  // Pose validée !
  lastPlaceAttempt = now;
  nextPlaceAllowedAt = now + cooldownMs;

  sfx.place();
  if (isPate) {
    renderer.puff(pointer.x, pointer.y, 3, 8, '235,215,170');
    renderer.addHandScoop(pointer.x, pointer.y, me?.color || '#38bdf8');
  } else {
    renderer.puff(pointer.x, pointer.y, 4, 12, '235,215,170');
    renderer.addPouringBucket(pointer.x, pointer.y, me?.color || '#38bdf8');
  }

  // Application optimiste locale
  for (let y = 0; y < shape.h; y++) {
    for (let x = 0; x < shape.w; x++) {
      if (!shape.mask[y * shape.w + x]) continue;
      const gx = pos.left + x;
      const gy = pos.top + y;
      if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GROUND_Y) {
        const i = gy * GRID_W + gx;
        if ((w.cells[i] & TYPE_MASK) === 0) {
          w.cells[i] = T.WET | (5 << 5);
        }
      }
    }
  }
  w.version++;
  renderer.drawnKey = null;

  // Décrémentation locale optimiste du stock (SEULEMENT si la pose est valide)
  if (me?.moulds && me.moulds[toolToUse] > 0) {
    me.moulds[toolToUse]--;
    updateToolStocks();
  }

  // Envoi officiel du bon moule sélectionné (toolToUse) avec l'état de miroir (flipped) au serveur !
  socket.emit('place', { shape: toolToUse, x: pointer.x, y: pointer.y, flipped: isMouldFlipped });
}

// ------------------------------------------------------------------ Cadran 90° & Catapulte Immersive
const angleSlider = $('angle-slider');
const powerSlider = $('power-slider');
const dialCard = $('hud-dial-card');
const dialSvg = $('angle-dial-svg');
let lastRatchetDeg = 45;

function updateDialSectorAndNeedle(angleRad, side = 'left') {
  const isRight = side === 'right';
  const ox = isRight ? 86 : 14;
  const oy = 86;
  const R = 72;

  const dialSector = $('dial-sector');
  const dialArc = $('dial-arc');
  const dialPivot = $('dial-pivot');
  const dialRay45 = $('dial-ray-45');
  const dialRay30 = $('dial-ray-30');
  const dialRay60 = $('dial-ray-60');
  const dialNeedle = $('dial-needle');
  const dialKnob = $('dial-knob');
  const dialTxt0 = $('dial-txt-0');
  const dialTxt45 = $('dial-txt-45');
  const dialTxt90 = $('dial-txt-90');

  if (dialSector) {
    if (isRight) {
      dialSector.setAttribute('d', `M ${ox} ${oy} L 14 ${oy} A ${R} ${R} 0 0 1 ${ox} 14 Z`);
    } else {
      dialSector.setAttribute('d', `M ${ox} ${oy} L 86 ${oy} A ${R} ${R} 0 0 0 ${ox} 14 Z`);
    }
  }

  if (dialArc) {
    if (isRight) {
      dialArc.setAttribute('d', `M 14 ${oy} A ${R} ${R} 0 0 1 ${ox} 14`);
    } else {
      dialArc.setAttribute('d', `M 86 ${oy} A ${R} ${R} 0 0 0 ${ox} 14`);
    }
  }

  if (dialPivot) {
    dialPivot.setAttribute('cx', String(ox));
    dialPivot.setAttribute('cy', String(oy));
  }

  const sign = isRight ? -1 : 1;
  const setRay = (el, deg) => {
    if (!el) return;
    const r = (deg * Math.PI) / 180;
    const rx = ox + sign * Math.cos(r) * R;
    const ry = oy - Math.sin(r) * R;
    el.setAttribute('x1', String(ox));
    el.setAttribute('y1', String(oy));
    el.setAttribute('x2', rx.toFixed(1));
    el.setAttribute('y2', ry.toFixed(1));
  };

  setRay(dialRay45, 45);
  setRay(dialRay30, 30);
  setRay(dialRay60, 60);

  // Aiguille et curseur au bout de l'aiguille
  const nx = ox + sign * Math.cos(angleRad) * R;
  const ny = oy - Math.sin(angleRad) * R;
  if (dialNeedle) {
    dialNeedle.setAttribute('x1', String(ox));
    dialNeedle.setAttribute('y1', String(oy));
    dialNeedle.setAttribute('x2', nx.toFixed(1));
    dialNeedle.setAttribute('y2', ny.toFixed(1));
  }
  if (dialKnob) {
    dialKnob.setAttribute('cx', nx.toFixed(1));
    dialKnob.setAttribute('cy', ny.toFixed(1));
  }

  if (dialTxt0) {
    dialTxt0.setAttribute('x', isRight ? '6' : '82');
    dialTxt0.setAttribute('y', '96');
  }
  if (dialTxt45) {
    dialTxt45.setAttribute('x', isRight ? '24' : '68');
    dialTxt45.setAttribute('y', '30');
  }
  if (dialTxt90) {
    dialTxt90.setAttribute('x', isRight ? '84' : '4');
    dialTxt90.setAttribute('y', '16');
  }
}

function syncAimSliders() {
  const deg = (aim.angle * 180) / Math.PI;
  const pct = Math.round(aim.power * 100);
  if (angleSlider) angleSlider.value = String(Math.round(deg));
  if (powerSlider) powerSlider.value = String(pct);

  const angleVal = $('angle-val');
  if (angleVal) angleVal.textContent = deg.toFixed(1);

  // Mettre à jour le cadran 90° interactif
  updateDialSectorAndNeedle(aim.angle, myCatapultSide);
}

function changeAngleStep(deltaDeg) {
  unlock();
  let deg = (aim.angle * 180) / Math.PI + deltaDeg;
  if (deg < 6) deg = 6;
  if (deg > 84) deg = 84;
  aim.angle = (deg * Math.PI) / 180;
  syncAimSliders();
  sfx.ratchet(640 + deg * 5);
  socket.emit('aim', { angle: aim.angle, power: aim.power, side: myCatapultSide });
}

$('btn-angle-down')?.addEventListener('click', (e) => {
  e.preventDefault();
  changeAngleStep(-2.5);
});
$('btn-angle-up')?.addEventListener('click', (e) => {
  e.preventDefault();
  changeAngleStep(2.5);
});

// Bouton de changement de catapulte latéral (au centre sur le bord de l'écran)
$('catapult-switch-btn')?.addEventListener('click', () => {
  unlock();
  const nextSide = myCatapultSide === 'left' ? 'right' : 'left';
  setCatapultSide(nextSide);
});

// Interaction avec le cadran 90° (clic / glisser de l'aiguille dans le quart de cercle)
let isDraggingDial = false;

function setAngleFromDialEvent(e) {
  const svg = $('angle-dial-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const isRight = myCatapultSide === 'right';
  const originX = isRight ? (rect.width * 0.86) : (rect.width * 0.14);
  const originY = rect.height * 0.86;
  const dx = isRight ? (originX - px) : (px - originX);
  const dy = originY - py; // axe Y vers le haut
  let rad = Math.atan2(Math.max(0.01, dy), Math.max(0.01, dx));
  let deg = (rad * 180) / Math.PI;
  if (deg < 6) deg = 6;
  if (deg > 84) deg = 84;

  if (Math.abs(deg - lastRatchetDeg) >= 2.0) {
    sfx.ratchet(640 + deg * 5);
    lastRatchetDeg = deg;
  }

  aim.angle = (deg * Math.PI) / 180;
  syncAimSliders();
  socket.emit('aim', { angle: aim.angle, power: aim.power, side: myCatapultSide });
}

// Interaction directe sur la catapulte en coordonnées de sable
function setAngleFromCoords(cx, cy, catX, catY, isRight) {
  const dx = isRight ? (catX - cx) : (cx - catX);
  const dy = catY - cy; // Y inversé (vers le haut)
  let rad = Math.atan2(Math.max(2, dy), Math.max(2, dx));
  let deg = (rad * 180) / Math.PI;
  if (deg < 6) deg = 6;
  if (deg > 84) deg = 84;

  if (Math.abs(deg - lastRatchetDeg) >= 2.0) {
    sfx.ratchet(640 + deg * 5);
    lastRatchetDeg = deg;
  }

  aim.angle = (deg * Math.PI) / 180;
  syncAimSliders();
  socket.emit('aim', { angle: aim.angle, power: aim.power, side: myCatapultSide });
}

if (dialCard) {
  dialCard.addEventListener('pointerdown', (e) => {
    unlock();
    isDraggingDial = true;
    try { dialCard.setPointerCapture(e.pointerId); } catch (_) {}
    setAngleFromDialEvent(e);
  });

  dialCard.addEventListener('pointermove', (e) => {
    if (isDraggingDial) setAngleFromDialEvent(e);
  });

  const endDialDrag = () => {
    isDraggingDial = false;
  };
  dialCard.addEventListener('pointerup', endDialDrag);
  dialCard.addEventListener('pointercancel', endDialDrag);
}

if (angleSlider) {
  angleSlider.addEventListener('input', () => {
    aim.angle = (Number(angleSlider.value) * Math.PI) / 180;
    syncAimSliders();
    socket.emit('aim', { angle: aim.angle, power: aim.power, side: myCatapultSide });
  });
}

// Déclencheur Catapulte : MAINTENIR POUR BANDER, RELÂCHER POUR FAIRE FEU !
let isCharging = false;
let chargeStartTime = 0;
let chargeRafId = null;
let currentChargePower = 0.55;
let lastWinchTick = 0;
const fireTriggerBtn = $('fire-trigger-btn');
const powerBar = $('power-gauge-bar');
const powerValText = $('power-val');
const triggerLabel = $('trigger-label');

function startCharging() {
  if (isCharging) return;
  if (
    roomState?.phase !== 'battle' ||
    roomState.turn?.shooterId !== myId ||
    roomState.turn?.state !== 'aim'
  ) return;

  unlock();
  isCharging = true;
  chargeStartTime = performance.now();
  currentChargePower = 0.15;
  if (fireTriggerBtn) fireTriggerBtn.classList.add('charging');
  if (triggerLabel) triggerLabel.textContent = '⚡ DOSAGE EN COURS...';
  sfx.winch(0.15);
  lastWinchTick = performance.now();

  function chargeLoop(now) {
    if (!isCharging) return;
    const elapsed = now - chargeStartTime;

    // Oscillation fluide et continue (ping-pong) : 1800ms pour monter au max, 1800ms pour redescendre (doux et dosable !)
    const halfCycle = 1800;
    const fullCycle = halfCycle * 2;
    const cycleProgress = (elapsed % fullCycle) / fullCycle;
    // Vague triangulaire : monte de 0 à 1 puis redescend de 1 à 0
    const wave = cycleProgress <= 0.5 ? (cycleProgress * 2) : (2 - cycleProgress * 2);

    const minP = 0.15;
    const maxP = 1.0;
    currentChargePower = minP + wave * (maxP - minP);

    const pct = Math.round(currentChargePower * 100);
    if (powerBar) powerBar.style.width = `${pct}%`;
    if (powerValText) powerValText.textContent = String(pct);
    aim.power = currentChargePower;
    socket.emit('aim', { angle: aim.angle, power: aim.power, side: myCatapultSide });

    if (now - lastWinchTick > 140) {
      sfx.winch(currentChargePower);
      lastWinchTick = now;
    }
    chargeRafId = requestAnimationFrame(chargeLoop);
  }
  chargeRafId = requestAnimationFrame(chargeLoop);
}

function releaseAndFire() {
  if (!isCharging) return;
  isCharging = false;
  if (chargeRafId) cancelAnimationFrame(chargeRafId);
  if (fireTriggerBtn) fireTriggerBtn.classList.remove('charging');
  if (triggerLabel) triggerLabel.textContent = 'MAINTENIR POUR DOSER';

  const elapsed = performance.now() - chargeStartTime;
  // Si le joueur a cliqué brièvement (<160ms), puissance minimale décente de 0.40
  const effectivePower = elapsed < 160 ? Math.max(0.40, currentChargePower) : currentChargePower;
  aim.power = effectivePower;
  fireCatapult();

  setTimeout(() => {
    if (!isCharging) {
      if (powerBar) powerBar.style.width = '0%';
      if (powerValText) powerValText.textContent = '0';
    }
  }, 450);
}

if (fireTriggerBtn) {
  fireTriggerBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    unlock();
    try { fireTriggerBtn.setPointerCapture(e.pointerId); } catch (_) {}
    startCharging();
  });
  fireTriggerBtn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    releaseAndFire();
  });
  fireTriggerBtn.addEventListener('pointercancel', () => {
    releaseAndFire();
  });
}

// Relâchement global n'importe où sur l'écran pour garantir le déclenchement immédiat du tir
window.addEventListener('pointerup', () => {
  if (isCharging) releaseAndFire();
});
window.addEventListener('mouseup', () => {
  if (isCharging) releaseAndFire();
});
window.addEventListener('touchend', () => {
  if (isCharging) releaseAndFire();
});

function fireCatapult() {
  if (roomState?.phase !== 'battle') return;
  if (roomState.turn?.shooterId !== myId) {
    renderer.popup(CATAPULT_X + 15, GROUND_Y - 20, '⏳ Attends ton tour de tir !', '#f87171');
    return;
  }
  if (roomState.turn?.state !== 'aim') {
    renderer.popup(CATAPULT_X + 15, GROUND_Y - 20, '☄️ Boulet déjà en cours de vol !', '#f87171');
    return;
  }
  if (!aim.power || aim.power < 0.25) aim.power = 0.60;
  sfx.fire();
  renderer.catapult.loaded = false;
  renderer.catapult.target = 0.55;
  setTimeout(() => {
    renderer.catapult.target = 2.95;
    renderer.catapult.loaded = true;
  }, 900);
  socket.emit('fire', { angle: aim.angle, power: aim.power, side: myCatapultSide }, (res) => {
    if (res && !res.ok && res.error) {
      renderer.popup(CATAPULT_X + 15, GROUND_Y - 20, `⚠️ ${res.error}`, '#f87171');
    }
  });
}

// Bouton rouge d'arrêt de partie immédiat
const quitGameBtn = $('quit-game-btn');
if (quitGameBtn) {
  quitGameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    unlock();
    if (confirm('🛑 Arrêter la partie et revenir au salon pour tous les joueurs ?')) {
      socket.emit('lobby');
    }
  });
}

const fireBtn = $('fire-btn');
if (fireBtn) {
  fireBtn.addEventListener('click', () => {
    unlock();
    fireCatapult();
  });
}

const sideLeftBtn = $('btn-side-left');
if (sideLeftBtn) {
  sideLeftBtn.addEventListener('click', () => {
    unlock();
    setCatapultSide('left');
  });
}
const sideRightBtn = $('btn-side-right');
if (sideRightBtn) {
  sideRightBtn.addEventListener('click', () => {
    unlock();
    setCatapultSide('right');
  });
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key >= '1' && e.key <= '9') {
    const s = SHAPES[Number(e.key) - 1];
    if (s) selectTool(s.id);
  } else if (e.key.toLowerCase() === 'e') {
    selectTool('spray');
  } else if (e.key.toLowerCase() === 'r') {
    toggleMouldFlip();
  } else if (e.key.toLowerCase() === 'c') {
    if (roomState?.phase === 'battle') setCatapultSide(myCatapultSide === 'left' ? 'right' : 'left');
  } else if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'a') {
    if (roomState?.phase === 'battle') setCatapultSide('left');
  } else if (e.key.toLowerCase() === 'd') {
    if (roomState?.phase === 'battle') setCatapultSide('right');
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    if (roomState?.phase === 'battle') {
      e.preventDefault();
      changeAngleStep(2.5);
    }
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    if (roomState?.phase === 'battle') {
      e.preventDefault();
      changeAngleStep(-2.5);
    }
  } else if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) startCharging();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    releaseAndFire();
  }
});

// ------------------------------------------------------------------ Notifications rapides
function toast(msg) {
  const box = $('toast-log');
  const item = document.createElement('div');
  item.className = 'toast-item';
  item.textContent = msg;
  box.appendChild(item);
  setTimeout(() => item.remove(), 4600);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------ Chat translucide & Historique de combat
let unreadChatCount = 0;
function incrementUnread() {
  unreadChatCount++;
  const badge = $('chat-unread-badge');
  if (badge) {
    badge.textContent = String(unreadChatCount);
    badge.classList.remove('hidden');
  }
}

function clearUnread() {
  unreadChatCount = 0;
  const badge = $('chat-unread-badge');
  if (badge) {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }
}

function addLogMessage(msg) {
  const container = $('chat-messages');
  if (!container) return;
  const el = document.createElement('div');
  const isBonus = msg.includes('colis') || msg.includes('BOULET') || msg.includes('GRENADE') || msg.includes('récolte') || msg.includes('SÉCHERESSE') || msg.includes('BÉNÉDICTION');
  el.className = `chat-msg ${isBonus ? 'bonus' : 'system'}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<span class="chat-msg-time">${time}</span> <span class="chat-msg-text">${escapeHtml(msg)}</span>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  if ($('game-chat-dock')?.classList.contains('collapsed')) {
    incrementUnread();
  }
}

function addChatMessage({ name, color, text, t }) {
  const container = $('chat-messages');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'chat-msg';
  const time = new Date(t || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<span class="chat-msg-time">${time}</span> <span class="chat-msg-name" style="color:${color || '#38bdf8'}">${escapeHtml(name)}:</span> <span class="chat-msg-text">${escapeHtml(text)}</span>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  if ($('game-chat-dock')?.classList.contains('collapsed')) {
    incrementUnread();
  }
}

function setupChat() {
  const dock = $('game-chat-dock');
  const toggleBtn = $('chat-toggle-size-btn');
  const header = $('chat-header');
  const form = $('chat-form');
  const input = $('chat-input');

  if (!dock) return;

  const toggle = () => {
    dock.classList.toggle('collapsed');
    const isCollapsed = dock.classList.contains('collapsed');
    if (toggleBtn) toggleBtn.textContent = isCollapsed ? '▲' : '▼';
    if (!isCollapsed) clearUnread();
  };

  header?.addEventListener('click', (e) => {
    if (e.target.closest('#chat-toggle-size-btn')) return;
    toggle();
  });
  toggleBtn?.addEventListener('click', toggle);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = input.value.trim();
    if (!val) return;
    socket.emit('chat', { message: val });
    input.value = '';
  });
}

// ------------------------------------------------------------------ Boucle de rendu (60 FPS)
let lastFrame = performance.now();
let gameLoopRunning = false;
let rafId = null;

export function startGameLoop() {
  if (gameLoopRunning) return;
  gameLoopRunning = true;
  lastFrame = performance.now();
  const sceneEl = $('scene');
  if (sceneEl) sceneEl.classList.remove('hidden');
  const siteBg = $('site-bg');
  if (siteBg) siteBg.classList.add('hidden');
  const chatDock = $('game-chat-dock');
  if (chatDock) chatDock.classList.remove('hidden');
  if (window.siteBgInstance) window.siteBgInstance.setActive(false);
  if (window.tutoInstance) window.tutoInstance.setActive(false);
  rafId = requestAnimationFrame(frame);
}

export function stopGameLoop() {
  gameLoopRunning = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  const sceneEl = $('scene');
  if (sceneEl) sceneEl.classList.add('hidden');
  const siteBg = $('site-bg');
  if (siteBg) siteBg.classList.remove('hidden');
  const chatDock = $('game-chat-dock');
  if (chatDock) chatDock.classList.add('hidden');
  if (window.siteBgInstance) window.siteBgInstance.setActive(true);
  if (window.tutoInstance) window.tutoInstance.setActive(true);
}

function frame(now) {
  if (!gameLoopRunning) return;
  const dt = Math.min(50, now - lastFrame);
  lastFrame = now;

  const phase = roomState?.phase || 'lobby';
  const isShooter = phase === 'battle' && roomState?.turn?.shooterId === myId;
  const curCatSide = isShooter ? myCatapultSide : (roomState?.turn?.catapultSide || 'left');

  // Gestion dynamique de la caméra :
  // En construction : château centré sur l'écran (centre 210) avec zoom doux
  // En combat : déplacement panoramique 21:9 cinématographique
  //   - Catapulte Gauche : cible 152 (catapulte à gauche, château sur la moitié droite)
  //   - Catapulte Droite : cible 268 (château sur la moitié gauche, catapulte à droite)
  if (phase === 'build') {
    renderer.setCameraTarget(210, GROUND_Y - 45, 1.18);
  } else if (phase === 'battle') {
    if (curCatSide === 'right') {
      renderer.setCameraTarget(268, GROUND_Y - 42, 1.0);
    } else {
      renderer.setCameraTarget(152, GROUND_Y - 42, 1.0);
    }
  } else {
    renderer.setCameraTarget(210, GROUND_Y - 45, 1.0);
  }

  renderer.begin(dt);

  // Mettre à jour les coordonnées du curseur si la caméra glisse sous la souris
  if (pointer.inside && lastClientX !== null && lastClientY !== null) {
    const updatedCell = renderer.toCell(lastClientX, lastClientY);
    pointer.x = updatedCell.x;
    pointer.y = updatedCell.y;
  }

  renderer.drawBackground(now);

  // Mise à jour du badge Spray (cooldown + décompte restant en bataille)
  const sprayRemaining = Math.max(0, nextSprayAvailableAt - now);
  const sprayReadyFraction = Math.min(1, 1 - sprayRemaining / SPRAY_COOLDOWN_MS);
  const sprayBtn = $('spray-quick-btn');
  const sprayTxt = $('spray-status-txt');
  const mePlayer = roomState?.players?.find((p) => p.id === myId);
  const spraysLeftCount = roomState?.phase === 'battle' ? (mePlayer?.defenseSpraysLeft ?? 0) : '∞';

  if (sprayRemaining > 0) {
    sprayBtn.classList.add('cooldown');
    sprayTxt.textContent = `${(sprayRemaining / 1000).toFixed(1)}s`;
  } else if (roomState?.phase === 'battle' && spraysLeftCount <= 0) {
    sprayBtn.classList.add('cooldown');
    sprayTxt.textContent = 'ÉPUISÉ (0)';
  } else {
    sprayBtn.classList.remove('cooldown');
    sprayTxt.textContent = roomState?.phase === 'battle' ? `PRÊT (${spraysLeftCount})` : 'PRÊT';
  }

  // Chronomètre
  const timerBox = $('timer-box');
  if (roomState && (phase === 'build' || (phase === 'battle' && roomState.turn?.state === 'aim'))) {
    const ms = phase === 'build' ? roomState.remaining : roomState.turn.remaining;
    const sec = Math.ceil(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    $('timer-value').textContent = `${m}:${String(s).padStart(2, '0')}`;
    timerBox.classList.remove('hidden');
    timerBox.classList.toggle('urgent', sec <= 10);
    if (sec <= 5 && sec > 0 && sec !== lastSecondTick) {
      lastSecondTick = sec;
      sfx.tick();
    }
  } else {
    timerBox.classList.add('hidden');
  }

  // Monde à dessiner
  const activePid = viewedPid || myId;
  const activePlayer = roomState?.players.find((p) => p.id === activePid);
  const world = (activePid && worlds.get(activePid)) || demoWorld;

  if (phase === 'build') {
    renderer.drawBuildZone(0.65);
    // Afficher les châteaux des autres bâtisseurs en direct en transparence en arrière-plan !
    if (roomState?.players) {
      for (const p of roomState.players) {
        if (p.id !== myId) {
          const wOther = worlds.get(p.id);
          if (wOther) renderer.drawGhostCastle(wOther, p.color, p.name);
        }
      }
    }
  }

  // Colis et caisses de bonus parachutés en arrière-plan (visibles uniquement pour le tireur actif)
  if (phase === 'battle' && roomState?.drops && roomState.turn?.shooterId === myId) {
    renderer.drawDrops(roomState.drops, now);
  }

  const slingPull = aim.dragging ? { x: aim.pullX, y: aim.pullY } : null;
  const isAimingShooter = isShooter && roomState?.turn?.state === 'aim';
  const ammoType = mePlayer?.hasGrenade ? 'grenade' : (mePlayer?.hasSpikeBall ? 'heavySpikeBall' : 'normal');

  renderer.drawCatapult(
    dt,
    phase === 'build' ? 0.35 : 1,
    slingPull,
    curCatSide,
    isAimingShooter ? aim : (remoteAim || null),
    isCharging,
    currentChargePower,
    ammoType,
  );

  // Ancrage dynamique du HUD de tir selon la Catapulte active (gauche / droite)
  const hud = $('catapult-hud');
  if (hud && !hud.classList.contains('hidden')) {
    hud.classList.toggle('side-left', curCatSide === 'left');
    hud.classList.toggle('side-right', curCatSide === 'right');
  }

  renderer.drawWorld(world, {
    color: activePlayer?.color || '#e4572e',
    t: now,
    highlightKing: true,
    showSafeZone: phase === 'build',
  });

  // Inscriptions et runes des bonus actifs gravées directement dans le sable de plage sous le château
  const activeBonuses = [];
  if (phase === 'battle' && activePlayer) {
    if (activePlayer.hasGrenade) {
      activeBonuses.push({ icon: '💣', label: "GRENADE EXPLOSIVE ARMÉE (2s)", color: '#4ade80' });
    }
    if (activePlayer.hasSpikeBall) {
      activeBonuses.push({ icon: '💣', label: "BOULET D'ACIER À POINTES ARMÉ", color: '#f87171' });
    }
    const reserveShots = roomState.turn?.shooterId === activePid
      ? (roomState.turn.shotsLeft - 1)
      : (activePlayer.bonusAmmo || 0);
    if (reserveShots > 0) {
      activeBonuses.push({ icon: '☄️', label: `+${reserveShots} BOULET${reserveShots > 1 ? 'S' : ''} EN RÉSERVE`, color: '#fde047' });
    }
    if (activePlayer.defenseSpraysLeft > 0) {
      activeBonuses.push({ icon: '💦', label: `${activePlayer.defenseSpraysLeft} SPRAY${activePlayer.defenseSpraysLeft > 1 ? 'S' : ''} DE RENFORT`, color: '#38bdf8' });
    }
  }
  if (activeBonuses.length > 0) {
    renderer.drawActiveSandBonuses(activeBonuses, now);
  }

  // Ratio de remplissage du seau (3.0s cooldown)
  const placeElapsed = now - lastPlaceAttempt;
  const placeCooldownRatio = Math.min(1.0, placeElapsed / BUILD_PLACE_COOLDOWN_MS);

  // Seau de plage physique animé sur le sable à gauche
  if (phase === 'build') {
    renderer.drawBeachBucket(placeCooldownRatio, now);
  }

  // Mettre à jour l'indicateur de remplissage du seau dans la sidebar
  const bucketFillEl = $('bucket-status-fill');
  const bucketLabelEl = $('bucket-status-label');
  if (bucketFillEl && bucketLabelEl) {
    if (placeCooldownRatio < 1.0) {
      const pct = Math.round(placeCooldownRatio * 100);
      bucketFillEl.style.width = `${pct}%`;
      bucketLabelEl.textContent = `Remplissage... ${pct}%`;
    } else {
      bucketFillEl.style.width = '100%';
      bucketLabelEl.textContent = 'Seau plein & prêt';
    }
  }

  // Fantôme du moule ou curseur Spray en phase de construction
  if (phase === 'build' && pointer.inside && activePid === myId) {
    if (activeTool === 'spray') {
      renderer.drawSprayCursor(pointer.x, pointer.y, sprayReadyFraction);
    } else if (activeTool === 'aplatir') {
      renderer.drawFlattenCursor(pointer.x, pointer.y);
    } else if (activeTool === 'retirer') {
      renderer.drawDigCursor(pointer.x, pointer.y);
    } else {
      const baseShape = SHAPE_BY_ID[activeTool];
      if (baseShape) {
        const shape = isMouldFlipped ? getFlippedShape(baseShape) : baseShape;
        const pos = spawnPosition(world.cellType, shape, pointer.x, pointer.y, world.king);
        renderer.drawGhost(shape, pos, pos.valid, false, placeCooldownRatio);
      }
    }
  }

  // Curseur de Spray quand on SE DÉFEND en phase de bataille
  if (phase === 'battle' && pointer.inside && roomState?.turn?.targetId === myId) {
    renderer.drawSprayCursor(pointer.x, pointer.y, sprayReadyFraction);
  }

  // Aperçu de trajectoire en phase de bataille (gauche ou droite)
  if (phase === 'battle' && roomState?.turn?.state === 'aim') {
    if (roomState.turn.shooterId === myId) {
      renderer.drawTrajectory(aim.angle, aim.power, 0.45, 0, myCatapultSide);
    } else if (remoteAim) {
      renderer.drawTrajectory(remoteAim.angle, remoteAim.power, 0.28, 0, curCatSide);
    }
  }

  renderer.drawFx(dt);
  rafId = requestAnimationFrame(frame);
}

initTools();
setupChat();
syncAimSliders();
stopGameLoop();
