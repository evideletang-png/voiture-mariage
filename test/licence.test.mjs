import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const App = createRequire(import.meta.url)('../licence.js');
const TODAY = new Date('2026-10-23T12:00:00');
const read = (front, back) => App.parseLicence({ front, back }, { today: TODAY });
const val = (r, k) => (r[k] ? r[k].value : null);
const conf = (r, k) => (r[k] ? r[k].conf : null);

// textes inventés, dans la mise en page d'un permis français récent (aucun vrai document)
const FRONT = `RÉPUBLIQUE FRANÇAISE
PERMIS DE CONDUIRE
1. DELETANG
2. EVI MARIE
3. 03/09/1995 TOURS (37)
4a. 12/03/2015 4c. PRÉFET D'INDRE-ET-LOIRE
4b. 12/03/2030
5. 123456789012
7. signature`;
const BACK = `9. AM A1 A2 A B1 B BE
10. 11. 12.
B 12.03.15 12.03.30
`;

test('recto et verso propres : tous les champs, confiance haute', () => {
  const r = read(FRONT, BACK);
  assert.equal(val(r, 'numero'), '123456789012');
  assert.equal(val(r, 'naissance'), '1995-09-03');
  assert.equal(val(r, 'delivrance'), '2015-03-12');
  assert.equal(val(r, 'expiration'), '2030-03-12');
  assert.equal(val(r, 'nom'), 'DELETANG');
  assert.equal(val(r, 'prenom'), 'EVI');
  for (const k of ['numero', 'naissance', 'delivrance', 'expiration']) assert.equal(conf(r, k), 'high', k);
});

test('la date d’obtention vient du verso (champ 10), pas du recto, quand la carte est un renouvellement', () => {
  const front = FRONT.replace('4a. 12/03/2015', '4a. 02/06/2022').replace('4b. 12/03/2030', '4b. 02/06/2037');
  const r = read(front, 'B 18.04.13 18.04.28');
  assert.equal(val(r, 'delivrance'), '2013-04-18');
  assert.equal(val(r, 'expiration'), '2037-06-02');
});

test('recto seul : la délivrance de la carte sert de repli, avec confiance basse', () => {
  const r = read(FRONT, '');
  assert.equal(val(r, 'delivrance'), '2015-03-12');
  assert.equal(conf(r, 'delivrance'), 'low');
  assert.equal(val(r, 'numero'), '123456789012');
});

test('bruit de lecture : O pour 0, espaces, repères abîmés', () => {
  const noisy = `1. DELETANG
2. EVI
3. O3/O9/1995
4a 12 03 2015
4b. 12.O3.2030
5. 123 456 789 012`;
  const r = read(noisy, '');
  assert.equal(val(r, 'naissance'), '1995-09-03');
  assert.equal(val(r, 'delivrance'), '2015-03-12');
  assert.equal(val(r, 'expiration'), '2030-03-12');
  assert.equal(val(r, 'numero'), '123456789012');
});

test('repères illisibles : trois dates rangées par ordre chronologique, confiance basse', () => {
  const r = read(`DELETANG EVI
12/03/2030 03/09/1995
12/03/2015
123456789012`, '');
  assert.equal(val(r, 'naissance'), '1995-09-03');
  assert.equal(val(r, 'delivrance'), '2015-03-12');
  assert.equal(val(r, 'expiration'), '2030-03-12');
  assert.equal(conf(r, 'expiration'), 'low');
  assert.equal(val(r, 'numero'), '123456789012');
  assert.equal(conf(r, 'numero'), 'low');
});

test('permis britannique : numéro à 16 caractères', () => {
  const r = read(`1. MORGAN
2. JOHN
3. 05.02.1975
4a. 01.06.2019
4b. 31.05.2029
5. MORGA753116SM9IJ`, 'B 01.06.19 31.05.29');
  assert.equal(val(r, 'numero'), 'MORGA753116SM9IJ');
  assert.equal(val(r, 'delivrance'), '2019-06-01');
});

test('catégories voisines : B1 et BE ne sont pas prises pour B', () => {
  const r = read(FRONT, 'B1 01.01.10 01.01.25\nBE 02.02.12 02.02.27\nB 03.03.14 03.03.29');
  assert.equal(val(r, 'delivrance'), '2014-03-03');
});

test('dates impossibles et dates futures écartées', () => {
  const r = read('3. 31/02/1990\n4a. 12/03/2030\n5. 123456789012', '');
  assert.equal(val(r, 'naissance'), null);
  assert.equal(val(r, 'delivrance'), null, 'une délivrance dans le futur n’a pas de sens');
});

test('texte vide ou illisible : rien d’inventé, aucune exception', () => {
  for (const [f, b] of [['', ''], ['@@@ ### !!!', '???'], [undefined, undefined]]) {
    const r = read(f, b);
    assert.deepEqual(Object.values(r).filter(Boolean), []);
  }
  assert.doesNotThrow(() => App.parseLicence());
});

test('recoupement avec l’identité saisie', () => {
  const scan = read(FRONT, BACK);
  assert.deepEqual(App.compareIdentity(scan, { nom: 'Deletang', prenom: 'Evi', naissance: '1995-09-03' }), { nom: true, prenom: true, naissance: true });
  assert.equal(App.compareIdentity(scan, { nom: 'Santoni', prenom: 'Evi', naissance: '1995-09-04' }).nom, false);
  assert.equal(App.compareIdentity(scan, { nom: 'Santoni', prenom: 'Evi', naissance: '1995-09-04' }).naissance, false);
  assert.equal(App.compareIdentity(scan, { nom: 'Délétang', prenom: 'Evi', naissance: '' }).nom, true, 'accents ignorés');
  assert.equal(App.compareIdentity(scan, { nom: 'Deletangs', prenom: 'Evi' }).nom, true, 'une faute de lecture tolérée');
  assert.equal(App.compareIdentity(read('', ''), { nom: 'X' }).nom, null, 'rien lu : pas de verdict');
});
