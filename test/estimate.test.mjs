import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../i18n.js');
const App = require('../estimate.js');

const car = (over = {}) => ({
  categorie: 'eco', boite: 'manuelle',
  lieuRetrait: 'Bastia-Poretta (BIA)', lieuRetour: 'Bastia-Poretta (BIA)',
  retrait: new Date('2027-06-11T14:30'), retour: new Date('2027-06-14T10:00'),
  ...over,
});
const base = (over = {}) => ({
  lang: 'fr', name: 'Zoé', org: 'Camille',
  perCar: 800, shared: false, pax: 2, share: 800, car: car(), ...over,
});

test('remise : arrondie à l’euro, 0 ne change rien', () => {
  assert.equal(App.discounted(1000, 20), 800);
  assert.equal(App.discounted(333, 20), 266);
  assert.equal(App.discounted(333, 0), 333);
  assert.equal(App.discounted(199.99, 20), 160);
});

test('part d’une voiture partagée : au prorata des personnes', () => {
  assert.equal(App.memberShare(600, 3, 6), 300);
  assert.equal(App.memberShare(500, 2, 2), 500);
  assert.equal(App.memberShare(100, 1, 3), 33);
  assert.equal(App.memberShare(100, 1, 0), 100);
});

test('même ligne de devis = même clé ; un autre jour = autre clé', () => {
  assert.equal(App.lineKey(car()), App.lineKey(car({ retrait: new Date('2027-06-11T18:00') })));
  assert.notEqual(App.lineKey(car()), App.lineKey(car({ retour: new Date('2027-06-15T10:00') })));
  assert.notEqual(App.lineKey(car()), App.lineKey(car({ categorie: 'suv' })));
});

test('message français : prix, lieux, dates, signature', () => {
  const m = App.estimateMessage(base());
  assert.match(m, /^Bonjour Zoé,/);
  assert.match(m, /800\s€/);
  assert.match(m, /indicative/);
  assert.match(m, /Bastia-Poretta \(BIA\)/);
  assert.match(m, /11 juin 2027 à partir de 14:30/);
  assert.match(m, /14 juin 2027 avant 10:00/);
  assert.match(m, /Économique \(Manuelle\)/);
  assert.ok(m.endsWith('Camille'));
  assert.ok(!m.includes('partagée'));
});

test('voiture partagée : la part et la mention, sans nommer personne', () => {
  const m = App.estimateMessage(base({ shared: true, pax: 1, share: 267, perCar: 800 }));
  assert.match(m, /Votre part \(1 pers\.\)/);
  assert.match(m, /267\s€/);
  assert.match(m, /partagée avec d’autres invités/);
});

test('le message ne laisse rien deviner de la remise ni des tarifs du loueur', () => {
  const words = /remise|discount|sconto|rabatt|descuento|europcar|tarif|rate|tariff|prix public|%/i;
  for (const lang of ['fr', 'en', 'it', 'de', 'es']) {
    for (const shared of [false, true]) {
      const m = App.estimateMessage(base({ lang, shared, pax: 2, share: 400 }));
      assert.ok(!words.test(m), `${lang} : ${m.match(words)}`);
    }
  }
});

test('les textes du formulaire invité ne parlent ni de remise ni de tarif du loueur', () => {
  const words = /remise|discount|sconto|rabatt|descuento|rates|tariff|%/i; // « estimation tarifaire » reste permis : c'est l'annonce voulue
  for (const lang of ['fr', 'en', 'it', 'de', 'es']) {
    for (const [k, v] of Object.entries(App.I18N[lang])) {
      if (k.startsWith('est')) continue; // messages d'estimation, testés ci-dessus
      assert.ok(!words.test(v.replace(/\{\w+\}/g, '')), `${lang}.${k} : ${v}`);
    }
  }
});

test('chaque langue : message complet, aucune variable oubliée, langue de repli', () => {
  for (const lang of ['fr', 'en', 'it', 'de', 'es']) {
    const m = App.estimateMessage(base({ lang, shared: true, pax: 2, share: 400 }));
    assert.ok(!/[{}]/.test(m), `${lang} : variable non remplacée`);
    assert.match(m, /800/, lang);
    assert.match(m, /400/, lang);
    assert.ok(m.includes('Zoé') && m.endsWith('Camille'), lang);
  }
  assert.match(App.estimateMessage(base({ lang: 'en' })), /^Hello Zoé,/);
  assert.match(App.estimateMessage(base({ lang: 'de' })), /Abholung: Bastia-Poretta \(BIA\), am 11\. Juni 2027 ab 14:30 Uhr/);
  assert.match(App.estimateMessage(base({ lang: 'xx' })), /^Bonjour/);
});
