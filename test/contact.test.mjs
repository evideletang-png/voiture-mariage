import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const App = createRequire(import.meta.url)('../contact.js');

test('numéro français saisi en national, en +33 ou en 0033 : même résultat', () => {
  for (const s of ['06 74 69 44 82', '+33 6 74 69 44 82', '0033 6 74 69 44 82', '0674694482']) {
    assert.deepEqual(App.normalizePhone('FR', s), { ok: true, tel: '+33 6 74 69 44 82', iso: 'FR' }, s);
  }
});

test('un +39 tapé alors que le pays choisi est la France bascule sur l’Italie', () => {
  assert.deepEqual(App.normalizePhone('FR', '+39 333 1234567'), { ok: true, tel: '+39 333 123 4567', iso: 'IT' });
});

test('Italie : le 0 initial d’un fixe est conservé', () => {
  assert.equal(App.normalizePhone('IT', '06 1234567').tel, '+39 06 1234567');
  assert.equal(App.normalizePhone('IT', '333 1234567').tel, '+39 333 123 4567');
});

test('Amérique du Nord : parenthèses et 1 initial acceptés', () => {
  assert.equal(App.normalizePhone('US', '(415) 555-0100').tel, '+1 415 555 0100');
  assert.equal(App.normalizePhone('US', '1 415 555 0100').tel, '+1 415 555 0100');
  assert.equal(App.normalizePhone('CA', '+1 604 555 0100').tel, '+1 604 555 0100');
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

test('numéro enregistré : chiffres regroupés à la mode du pays (+33 6 74 69 44 82, +44 7911 123456, +34 612 34 56 78)', () => {
  assert.equal(App.normalizePhone('GB', '07911 123456').tel, '+44 7911 123456');
  assert.equal(App.normalizePhone('ES', '612345678').tel, '+34 612 34 56 78');
  assert.equal(App.normalizePhone('DE', '0151 12345678').tel, '+49 151 12345678');
  assert.equal(App.normalizePhone('CH', '079 123 45 67').tel, '+41 79 123 45 67');
  assert.equal(App.normalizePhone('NL', '06 12345678').tel, '+31 6 12345678');
  assert.equal(App.normalizePhone('BE', '0470 12 34 56').tel, '+32 470 12 34 56');
  assert.equal(App.normalizePhone('AU', '0412 345 678').tel, '+61 412 345 678');
  assert.equal(App.normalizePhone('BR', '11 91234 5678').tel, '+55 119 123 456 78', 'pays sans règle : groupes de 3');
});

test('« +33 (0)6 74… » : le 0 entre parenthèses est écarté, sauf en Italie où il fait partie du numéro', () => {
  assert.equal(App.normalizePhone('FR', '+33 (0)6 74 69 44 82').tel, '+33 6 74 69 44 82');
  assert.equal(App.normalizePhone('FR', '+39 06 1234567').tel, '+39 06 1234567');
});

test('saisie en direct : le numéro s’espace au fil de la frappe, sans espace en fin de chaîne', () => {
  const f = (iso, raw) => App.formatNationalInput(iso, raw);
  assert.equal(f('FR', '0674694482'), '06 74 69 44 82');
  assert.equal(f('FR', '06 74 69'), '06 74 69');
  for (const [raw, want] of [['0', '0'], ['06', '06'], ['067', '06 7'], ['0674', '06 74'], ['06746', '06 74 6']]) assert.equal(f('FR', raw), want, raw);
  assert.equal(f('FR', '674694482'), '6 74 69 44 82', 'pas de 0 ajouté si l’invité ne l’a pas tapé');
  assert.equal(f('GB', '07911123456'), '07911 123456');
  assert.equal(f('DE', '015112345678'), '0151 12345678');
  assert.equal(f('IT', '3331234567'), '333 123 4567');
  assert.equal(f('IT', '061234567'), '06 1234567', 'le 0 d’un fixe italien est conservé');
  assert.equal(f('ES', '612345678'), '612 34 56 78');
  assert.equal(f('CH', '0791234567'), '079 123 45 67');
  assert.equal(f('JP', '09012345678'), '0901 234 5678', 'pays sans règle : groupes de 3');
  assert.equal(f('FR', ''), '');
  assert.equal(f('FR', 'abc'), '');
});

test('saisie en direct : numéros nord-américains en (415) 555-0100', () => {
  const f = (raw) => App.formatNationalInput('US', raw);
  for (const [raw, want] of [['4', '(4'], ['415', '(415'], ['4155', '(415) 5'], ['415555', '(415) 555'], ['4155550', '(415) 555-0'], ['4155550100', '(415) 555-0100'], ['14155550100', '1 (415) 555-0100'], ['1', '1']]) {
    assert.equal(f(raw), want, raw);
  }
  assert.equal(App.formatNationalInput('CA', '6045550100'), '(604) 555-0100');
});

test('la mise en forme est stable : la reformater ne change plus rien, et garde les mêmes chiffres', () => {
  for (const iso of ['FR', 'GB', 'DE', 'IT', 'ES', 'US', 'CH', 'NL', 'BE', 'JP']) {
    for (const raw of ['0123456789', '0712345678', '3331234567', '4155550100', '123456789012']) {
      const once = App.formatNationalInput(iso, raw);
      assert.equal(App.formatNationalInput(iso, once), once, `${iso} ${raw}`);
      assert.equal(once.replace(/\D/g, ''), raw.replace(/\D/g, '').slice(0, 15), `${iso} ${raw}`);
      assert.ok(!/\s$/.test(once) && !/^\s/.test(once), `${iso} ${raw}`);
    }
  }
});

test('exemple de numéro par pays, dans le bon format', () => {
  assert.equal(App.phoneExample('FR'), '06 12 34 56 78');
  assert.equal(App.phoneExample('US'), '(415) 555-0100');
  assert.equal(App.phoneExample('GB'), '07911 123456');
  assert.equal(App.phoneExample('BR'), '');
});

test('international tapé puis basculé en national : le 0 de tête est remis là où on l’écrit', () => {
  assert.equal(App.formatNational('FR', '674694482'), '06 74 69 44 82');
  assert.equal(App.formatNational('IT', '3331234567'), '333 123 4567');
  assert.equal(App.formatNational('GB', '7911123456'), '07911 123456');
});
