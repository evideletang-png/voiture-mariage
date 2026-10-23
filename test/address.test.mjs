import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const App = createRequire(import.meta.url)('../address.js');
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('France : le géocodeur de la Géoplateforme, les autres pays : Photon', () => {
  assert.equal(App.addressProvider('FR'), 'geopf');
  assert.equal(App.addressProvider('RE'), 'geopf');
  assert.equal(App.addressProvider('US'), 'photon');
  assert.equal(App.addressProvider(''), 'photon');
});

test('URL : requête encodée, langues acceptées par Photon seulement, aucun jeton', () => {
  const fr = App.suggestUrl('geopf', '5 rue Descartes, Tours', 'fr');
  assert.match(fr, /^https:\/\/data\.geopf\.fr\/geocodage\/search\?q=5%20rue%20Descartes%2C%20Tours&limit=6&autocomplete=1$/);
  assert.match(App.suggestUrl('photon', 'via roma 12', 'de'), /&lang=de&/);
  assert.ok(!/lang=/.test(App.suggestUrl('photon', 'via roma 12', 'it')), 'it et es ne sont pas acceptées par Photon');
  assert.ok(!/key|token/i.test(fr));
});

test('Géoplateforme : numéro, rue, code postal, ville ; les communes seules sont écartées', () => {
  const list = App.parseSuggestions('geopf', fixture('geopf-tours.json'), { iso: 'FR' });
  assert.deepEqual(list[0], { line1: '5 Rue Descartes', postcode: '37000', city: 'Tours', region: '', country: 'FR', label: '5 Rue Descartes, 37000 Tours' });
  assert.ok(list.length >= 3);
  assert.ok(list.every((s) => s.line1 && s.postcode && s.city));
  const none = App.parseSuggestions('geopf', { features: [{ properties: { type: 'municipality', name: 'Tours', postcode: '37000', city: 'Tours' } }] });
  assert.deepEqual(none, []);
});

test('Géoplateforme : une rue sans numéro est proposée telle quelle (corse comprise)', () => {
  const list = App.parseSuggestions('geopf', fixture('geopf-ajaccio.json'), { iso: 'FR' });
  assert.equal(list[0].line1, 'Cours Napoléon');
  assert.equal(list[0].postcode, '20000');
  assert.equal(list[0].city, 'Ajaccio');
});

test('Photon, États-Unis : numéro devant, État reporté, résultats en double fusionnés', () => {
  const list = App.parseSuggestions('photon', fixture('photon-us.json'), { iso: 'US' });
  assert.equal(list[0].line1, '1 Market Street');
  assert.equal(list[0].city, 'San Francisco');
  assert.equal(list[0].region, 'California');
  assert.equal(list[0].country, 'US');
  assert.equal(new Set(list.map((s) => s.label)).size, list.length);
});

test('Photon, Allemagne : le numéro vient après la rue', () => {
  const list = App.parseSuggestions('photon', fixture('photon-de.json'), { iso: 'DE' });
  assert.equal(list[0].line1, 'Hauptstraße 5');
  assert.equal(list[0].country, 'DE');
  assert.equal(list[0].region, '');
});

test('Photon, Italie : « Via Roma 12 », province reportée', () => {
  const list = App.parseSuggestions('photon', fixture('photon-it.json'), { iso: 'IT' });
  assert.equal(list[0].line1, 'Via Roma 12');
  assert.equal(list[0].country, 'IT');
});

test('un autre pays que celui choisi est écarté ; sans pays choisi, tout passe', () => {
  assert.deepEqual(App.parseSuggestions('photon', fixture('photon-us.json'), { iso: 'FR' }), []);
  assert.ok(App.parseSuggestions('photon', fixture('photon-us.json'), { iso: '' }).length > 0);
});

test('réponses bizarres : jamais d’exception', () => {
  for (const bad of [null, undefined, {}, { features: 'x' }, { features: [null, {}, { properties: null }] }, []]) {
    assert.deepEqual(App.parseSuggestions('photon', bad, { iso: 'US' }), []);
    assert.deepEqual(App.parseSuggestions('geopf', bad, { iso: 'FR' }), []);
  }
});

test('fetchSuggestions : trop court, erreur réseau, mauvais statut -> liste vide ; requête sobre', async () => {
  let call;
  const ok = async (url, opts) => { call = { url, opts }; return { ok: true, json: async () => fixture('geopf-tours.json') }; };
  assert.deepEqual(await App.fetchSuggestions('5 r', 'FR', 'fr', { fetch: ok }), []);
  assert.equal(call, undefined, 'aucune requête sous 4 caractères');
  const list = await App.fetchSuggestions('5 rue descartes', 'FR', 'fr', { fetch: ok });
  assert.equal(list[0].line1, '5 Rue Descartes');
  assert.equal(call.opts.referrerPolicy, 'no-referrer');
  assert.equal(call.opts.credentials, 'omit');
  assert.deepEqual(await App.fetchSuggestions('5 rue descartes', 'FR', 'fr', { fetch: async () => { throw new Error('hors ligne'); } }), []);
  assert.deepEqual(await App.fetchSuggestions('5 rue descartes', 'FR', 'fr', { fetch: async () => ({ ok: false }) }), []);
});
