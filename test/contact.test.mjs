import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const App = createRequire(import.meta.url)('../contact.js');

test('numéro français saisi en national, en +33 ou en 0033 : même résultat', () => {
  for (const s of ['06 74 69 44 82', '+33 6 74 69 44 82', '0033 6 74 69 44 82', '0674694482']) {
    assert.deepEqual(App.normalizePhone('FR', s), { ok: true, tel: '+33 674694482', iso: 'FR' }, s);
  }
});

test('un +39 tapé alors que le pays choisi est la France bascule sur l’Italie', () => {
  assert.deepEqual(App.normalizePhone('FR', '+39 333 1234567'), { ok: true, tel: '+39 3331234567', iso: 'IT' });
});

test('Italie : le 0 initial d’un fixe est conservé', () => {
  assert.equal(App.normalizePhone('IT', '06 1234567').tel, '+39 061234567');
  assert.equal(App.normalizePhone('IT', '333 1234567').tel, '+39 3331234567');
});

test('Amérique du Nord : parenthèses et 1 initial acceptés', () => {
  assert.equal(App.normalizePhone('US', '(415) 555-0100').tel, '+1 4155550100');
  assert.equal(App.normalizePhone('US', '1 415 555 0100').tel, '+1 4155550100');
  assert.equal(App.normalizePhone('CA', '+1 604 555 0100').tel, '+1 6045550100');
});

test('numéros trop courts, trop longs ou illisibles : refusés', () => {
  assert.equal(App.normalizePhone('FR', '12').ok, false);
  assert.equal(App.normalizePhone('FR', '').ok, false);
  assert.equal(App.normalizePhone('FR', '+999 123456').ok, false);
  assert.equal(App.normalizePhone('FR', '0'.repeat(20)).ok, false);
});

test('indicatifs partagés : le pays « principal » est proposé', () => {
  assert.equal(App.splitInternational('14155550100').iso, 'US');
  assert.equal(App.splitInternational('447911123456').iso, 'GB');
  assert.equal(App.splitInternational('79161234567').iso, 'RU');
});

test('liste de pays localisée', () => {
  assert.ok(App.countryList('fr').some(([c, n]) => c === 'DE' && n === 'Allemagne'));
  assert.ok(App.countryList('de').some(([c, n]) => c === 'FR' && n === 'Frankreich'));
  assert.ok(App.countryList('en').length > 200);
  assert.equal(App.paysLabel('IT'), 'Italie');
});

test('chaque pays de la liste a un indicatif et un drapeau', () => {
  for (const [c] of App.countryList('en')) {
    assert.match(App.DIAL[c], /^\d{1,3}$/, c);
    assert.equal([...App.flag(c)].length, 2, c);
  }
});

test('permis : UE/EEE/CH/GB reconnus, le reste signalé', () => {
  for (const c of ['FR', 'IT', 'DE', 'CH', 'GB', 'NO']) assert.ok(App.PERMIS_RECONNUS.has(c), c);
  for (const c of ['US', 'CA', 'AU', 'CN']) assert.ok(!App.PERMIS_RECONNUS.has(c), c);
});

test('faute de frappe dans le domaine de l’e-mail', () => {
  assert.equal(App.suggestEmail('zoe@gmial.com'), 'zoe@gmail.com');
  assert.equal(App.suggestEmail('zoe@hotmial.fr'), 'zoe@hotmail.fr');
  assert.equal(App.suggestEmail('zoe@gmail.com'), null);
  assert.equal(App.suggestEmail('zoe@mon-entreprise.fr'), null);
  assert.equal(App.suggestEmail('pas-un-mail'), null);
});
