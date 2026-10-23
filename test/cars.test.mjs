import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const App = require('../cars.js');
require('../contact.js');

const rec = (pax, bags, sieges = 0) => App.recommendCategory(pax, bags, sieges);

test('un couple avec une valise : la citadine suffit', () => {
  assert.deepEqual(rec(2, 1), { id: 'citadine', why: 'fits' });
  assert.deepEqual(rec(2, 2), { id: 'citadine', why: 'fits' });
});

test('à 3 ou 4 avec des valises, on monte en économique', () => {
  assert.equal(rec(4, 2).id, 'eco');
  assert.equal(rec(3, 3).id, 'eco');
});

test('5 personnes : économique, raison « places »', () => {
  assert.deepEqual(rec(5, 2), { id: 'eco', why: 'seats' });
});

test('beaucoup de valises : le SUV, raison « bagages »', () => {
  assert.deepEqual(rec(4, 3), { id: 'suv', why: 'luggage' });
});

test('sièges enfant : comptent pour une valise et le disent', () => {
  assert.deepEqual(rec(2, 2, 1), { id: 'eco', why: 'child' });
  assert.deepEqual(rec(2, 1, 1), { id: 'citadine', why: 'fits' });
});

test('6 ou 7 personnes : monospace ; 8 ou 9 : minibus', () => {
  assert.equal(rec(6, 1).id, 'monospace');
  assert.equal(rec(7, 1).id, 'monospace');
  assert.equal(rec(7, 3).id, 'minibus');
  assert.equal(rec(9, 3).id, 'minibus');
});

test('trop de monde avec trop de bagages : on le signale', () => {
  assert.deepEqual(rec(9, 6), { id: 'minibus', why: 'overflow' });
});

test('la recommandation est toujours une catégorie qui convient (sauf débordement)', () => {
  for (let pax = 1; pax <= 9; pax++) {
    for (let bags = 0; bags <= 6; bags++) {
      for (const sieges of [0, 1, 2]) {
        const r = rec(pax, bags, sieges);
        if (r.why !== 'overflow') assert.ok(App.fitsCategory(r.id, pax, bags, sieges), `${pax}/${bags}/${sieges}`);
      }
    }
  }
});

test('choix de l’invité : trop juste ou trop grand', () => {
  assert.equal(App.fitsCategory('citadine', 4, 2, 0), false);
  assert.equal(App.fitsCategory('cabriolet', 2, 1, 0), true);
  assert.equal(App.fitsCategory('inconnue', 2, 1, 0), false);
  assert.equal(App.oversizedCategory('minibus', 'citadine'), true);
  assert.equal(App.oversizedCategory('compacte', 'eco'), false);
  assert.equal(App.oversizedCategory('cabriolet', 'citadine'), false);
});

test('adresse : exemples et champs propres à chaque pays', () => {
  assert.equal(App.addressProfile('US').region.required, true);
  assert.equal(App.addressProfile('US').cityFirst, true);
  assert.equal(App.addressProfile('FR').region, undefined);
  assert.ok(App.addressProfile('FR').re.test('37000'));
  assert.ok(!App.addressProfile('FR').re.test('3700'));
  assert.ok(App.addressProfile('GB').re.test('SW1A 1AA'));
  assert.ok(App.addressProfile('CA').re.test('K1A 0B1'));
  assert.deepEqual(App.addressProfile('ZZ'), {});
});

test('permis : famille selon le pays de délivrance', () => {
  assert.equal(App.licenceFamily('FR'), 'eu');
  assert.equal(App.licenceFamily('GB'), 'eu');
  assert.equal(App.licenceFamily('US'), 'na');
  assert.equal(App.licenceFamily('CA'), 'na');
  assert.equal(App.licenceFamily('AU'), 'other');
});
