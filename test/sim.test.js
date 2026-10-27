import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SandWorld } from '../server/sandsim.js';
import { GROUND_Y, LAUNCH_X, LAUNCH_Y, launchVelocity, GRID_W } from '../shared/constants.js';

function run(world, ticks) {
  for (let t = 0; t < ticks; t++) world.step();
}

test('un seau posé sur le sol tient debout', () => {
  const w = new SandWorld(1);
  w.stamp('seau', 200, 100);
  run(w, 240);
  const c = w.countTypes();
  assert.ok(c.wet > 400, `il devrait rester du sable mouillé (${c.wet})`);
  assert.ok(w.highestPoint() >= 20);
});

test('on peut poser une arche ou un dôme par-dessus le Roi sans l\'écraser', () => {
  const w = new SandWorld(10);
  w.placeKing(200, GROUND_Y - 8);
  const pos = w.stamp('arche', 200, GROUND_Y - 10, true);
  assert.ok(pos && pos.valid, 'l\'arche doit pouvoir se poser autour du Roi');
  run(w, 180);
  assert.equal(w.king.dead, false, 'le Roi sous l\'arche doit être en vie');
});

test('le spray d\'eau durcit le sable (T.HARD) et renforce un porte-à-faux', () => {
  const w = new SandWorld(11);
  w.stamp('seau', 200, 120);
  const res = w.spray(200, 138);
  assert.ok(res.hardened > 50, `le spray doit durcir des cellules (${res.hardened})`);
  const c = w.countTypes();
  assert.ok(c.hard > 50, 'des cellules T.HARD doivent exister');
});

test('une colonne fine trop haute s\'effondre sous son poids', () => {
  const w = new SandWorld(2);
  // 5 tours empilées
  for (let k = 0; k < 5; k++) w.stamp('tour', 200, 0, false);
  const before = w.highestPoint();
  run(w, 600);
  assert.ok(w.highestPoint() < before, `devrait s'affaisser (${before} → ${w.highestPoint()})`);
});

test('une dalle en porte-à-faux trop long se détache', () => {
  const w = new SandWorld(3);
  w.stamp('tour', 150, 100, false);
  const top = GROUND_Y - w.highestPoint();
  w.stamp('dalle', 168, top - 6, false);
  run(w, 400);
  const c = w.countTypes();
  assert.ok(c.loose + c.dry > 40, 'une partie du porte-à-faux doit tomber');
});

test('le roi est enseveli quand le sable lui tombe dessus (même pendant la construction)', () => {
  const w = new SandWorld(4);
  w.placeKing(200, 140);
  // Même sans w.armed = true, buildVulnerable est actif !
  for (let k = 0; k < 40; k++) w.spawnParticle(200 + (k % 5) - 2, 60 - k, 0, 0, 3);
  run(w, 200);
  assert.equal(w.king.dead, true);
  assert.equal(w.king.cause, 'enseveli');
});

test('un boulet creuse un cratère', () => {
  const w = new SandWorld(5);
  w.stamp('seau', 140, 100, false);
  w.stamp('seau', 140, 60, false);
  run(w, 120);
  const before = w.countTypes().wet;
  w.launch(110, GROUND_Y - 30, 4, -0.2);
  run(w, 400);
  const after = w.countTypes().wet;
  assert.ok(after < before - 50, `le château doit être endommagé (${before} → ${after})`);
});

test('la vitesse de lancement dépend de la puissance', () => {
  const a = launchVelocity(Math.PI / 4, 0);
  const b = launchVelocity(Math.PI / 4, 1);
  assert.ok(Math.hypot(b.vx, b.vy) > Math.hypot(a.vx, a.vy));
  assert.ok(LAUNCH_X > 0 && LAUNCH_Y > 0);
});

test('une tour lâchée dans les airs chute d\'un bloc et atterrit debout', () => {
  const w = new SandWorld(42);
  // Poser une tour en l'air au-dessus du sol (mode spawn = clic libre)
  w.stamp('tour', 180, 80, true);
  const startWet = w.countTypes().wet;
  assert.ok(startWet > 100, 'la tour doit être créée');
  // Faire tourner la physique : elle descend ensemble jusqu\'au sol
  run(w, 300);
  const endWet = w.countTypes().wet;
  assert.ok(endWet >= startWet * 0.85, 'la tour doit atterrir majoritairement intacte');
  assert.ok(w.highestPoint() >= 15, 'la tour doit rester debout');
});

test('le séchage progressif en bataille diminue l\'humidité en surface', () => {
  const w = new SandWorld(77);
  w.stamp('seau', 200, 130, false);
  run(w, 20);
  let surfaceIdx = -1;
  for (let y = 120; y < 150 && surfaceIdx === -1; y++) {
    for (let x = 190; x < 210; x++) {
      const idx = y * GRID_W + x;
      if (w.type[idx] === 2 && w.type[idx - GRID_W] === 0) {
        surfaceIdx = idx;
        break;
      }
    }
  }
  assert.ok(surfaceIdx !== -1, 'doit trouver une cellule de surface');
  const initialMoist = w.moist[surfaceIdx];
  assert.ok(initialMoist > 150, 'doit être mouillé initialement');
  w.drying = true;
  run(w, 240);
  const laterMoist = w.moist[surfaceIdx];
  assert.ok(laterMoist < initialMoist, `l'humidité de surface doit diminuer (${initialMoist} -> ${laterMoist})`);
});

test('un pont posé entre deux tours reste totalement en sable mouillé sans s\'effondrer', () => {
  const w = new SandWorld(1);
  w.stamp('tour', 135, 100, false);
  w.stamp('tour', 175, 100, false);
  run(w, 50);
  const top = GROUND_Y - w.highestPoint();
  w.stamp('dalle', 155, top - 3, true);
  run(w, 100);
  const c = w.countTypes();
  assert.equal(c.dry, 0, 'aucun sable sec ne doit apparaître sur le pont');
  assert.ok(c.wet > 800, 'le pont et les tours doivent rester intégralement en sable mouillé');
});


