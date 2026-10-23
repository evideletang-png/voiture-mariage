import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const App = createRequire(import.meta.url)('../i18n.js');
const langs = Object.keys(App.I18N);
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('les 5 langues sont là', () => {
  assert.deepEqual(langs.sort(), ['de', 'en', 'es', 'fr', 'it']);
  assert.deepEqual(App.LANGS.map((l) => l[0]).sort(), langs);
});

test('chaque langue a exactement les mêmes clés que le français', () => {
  const ref = Object.keys(App.I18N.fr).sort();
  for (const l of langs) {
    assert.deepEqual(Object.keys(App.I18N[l]).sort(), ref, `clés de ${l}`);
  }
});

test('les variables {x} sont les mêmes dans toutes les langues', () => {
  for (const key of Object.keys(App.I18N.fr)) {
    const ref = placeholders(App.I18N.fr[key]);
    for (const l of langs) {
      assert.equal(placeholders(App.I18N[l][key]), ref, `${l}.${key}`);
    }
  }
});

test('aucun texte vide, aucune apostrophe droite qui casserait un copier-coller', () => {
  for (const l of langs) {
    for (const [k, v] of Object.entries(App.I18N[l])) {
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${l}.${k} vide`);
      assert.ok(!v.includes("'"), `${l}.${k} contient une apostrophe droite`);
    }
  }
});

test('t() remplace les variables et se replie sur l’anglais puis sur la clé', () => {
  const t = App.t('it');
  assert.equal(t('retentionDate', { date: '15/07/2027' }), 'Tutto viene cancellato dopo il 15/07/2027. ');
  assert.equal(App.t('xx')('send'), 'Send the file…');
  assert.equal(App.t('fr')('clé inconnue'), 'clé inconnue');
  assert.equal(App.t('fr')('doneLead', { org: 'Camille' }).includes('{contact}'), true); // variable non fournie : laissée telle quelle
});

test('noms de langues', () => {
  assert.equal(App.langName('de'), 'Deutsch');
});
