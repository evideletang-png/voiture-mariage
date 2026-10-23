import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const App = createRequire(import.meta.url)('../programme.js');

const TEXTE = `2027-05-31 | Journée plage · Beach party | Mare E Sole
2027-05-30 | Mariage · Wedding | Jardin de Coti`;

test('lecture du texte : triée par date, lieu facultatif', () => {
  const { entries, errors } = App.parseProgramme(TEXTE + '\n2027-06-01 | Brunch');
  assert.deepEqual(errors, []);
  assert.deepEqual(entries.map((e) => e.date), ['2027-05-30', '2027-05-31', '2027-06-01']);
  assert.equal(entries[0].lieu, 'Jardin de Coti');
  assert.equal(entries[2].lieu, '');
});

test('lignes illisibles signalées, lignes vides ignorées', () => {
  const { entries, errors } = App.parseProgramme('\n2027-02-31 | Mariage | X\n\npas une date | Fête\n2027-05-30 |\n2027-05-30 | Mariage');
  assert.deepEqual(errors, [2, 4, 5]);
  assert.equal(entries.length, 1);
});

test('aller-retour texte -> liste -> texte', () => {
  const { entries } = App.parseProgramme(TEXTE);
  assert.equal(App.programmeText(entries), '2027-05-30 | Mariage · Wedding | Jardin de Coti\n2027-05-31 | Journée plage · Beach party | Mare E Sole');
});

test('normalisation : données douteuses, longueurs, plafond de 8 rendez-vous', () => {
  assert.deepEqual(App.normalizeProgramme('pas une liste'), []);
  assert.deepEqual(App.normalizeProgramme([null, {}, { date: '2027-13-01', titre: 'x' }, { date: '2027-05-30' }]), []);
  const long = App.normalizeProgramme([{ date: '2027-05-30', titre: 'T'.repeat(200), lieu: 'L'.repeat(200) }]);
  assert.equal(long[0].titre.length, 80);
  assert.equal(long[0].lieu.length, 80);
  const many = Array.from({ length: 20 }, (_, i) => ({ date: `2027-05-${String(i + 1).padStart(2, '0')}`, titre: 'x' }));
  assert.equal(App.normalizeProgramme(many).length, 8);
});

test('dates proposées : veille du premier, lendemain du dernier (même en fin de mois)', () => {
  const { entries } = App.parseProgramme(TEXTE);
  assert.deepEqual(App.stayDefaults(entries), { arrivee: '2027-05-29T12:00', retour: '2027-06-01T10:00' });
  assert.deepEqual(App.stayDefaults([{ date: '2027-01-01', titre: 'x', lieu: '' }]), { arrivee: '2026-12-31T12:00', retour: '2027-01-02T10:00' });
  assert.equal(App.stayDefaults([]), null);
});
