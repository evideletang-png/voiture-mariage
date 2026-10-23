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

test('recto seul : la date de la carte (4a) n’est que proposée, jamais donnée pour la date d’obtention', () => {
  const r = read(FRONT, '');
  assert.equal(val(r, 'delivrance'), '2015-03-12');
  assert.equal(conf(r, 'delivrance'), 'low');
  assert.equal(r.delivrance.from, 'card');
  assert.equal(r.delivrance.ask, true, 'à proposer, pas à reporter d’office');
  assert.equal(val(r, 'numero'), '123456789012');
});

test('verso lu : la date d’obtention est ferme, sans marque « carte »', () => {
  const r = read(FRONT, BACK);
  assert.equal(r.delivrance.ask, undefined);
  assert.equal(r.delivrance.from, undefined);
});

test('verso illisible (ligne B introuvable) : on retombe sur la proposition du recto', () => {
  const r = read(FRONT, 'tache de gras\n9. AM A B\n');
  assert.equal(r.delivrance.ask, true);
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

/* ---------- États-Unis, Canada : étiquettes, dates mois/jour ---------- */

// textes inventés, aucune vraie carte
const US = { family: 'na', country: 'US' };
const readNa = (front, opts = US, back = '') => App.parseLicence({ front, back }, { today: TODAY, ...opts });
const US_FRONT = `DRIVER LICENSE
DL D1234567
EXP 03/20/2029
LN SMITH
FN JOHN QUINCY
DOB 03/15/1990
ISS 03/20/2023
CLASS C`;

test('États-Unis : DOB, ISS, EXP lues en mois/jour, le numéro et les noms derrière leur étiquette', () => {
  const r = readNa(US_FRONT);
  assert.equal(val(r, 'naissance'), '1990-03-15');
  assert.equal(val(r, 'expiration'), '2029-03-20');
  assert.equal(val(r, 'numero'), 'D1234567');
  assert.equal(val(r, 'nom'), 'SMITH');
  assert.equal(val(r, 'prenom'), 'JOHN');
});

test('États-Unis : 03/09/1990 est le 9 mars, pas le 3 septembre (le défaut d’avant, sur le modèle européen)', () => {
  const front = 'DL D1234567 EXP 09/05/2029\nDOB 03/09/1990\nISS 09/05/2023';
  assert.equal(val(readNa(front), 'naissance'), '1990-03-09');
  assert.equal(val(readNa(front), 'delivrance'), '2023-09-05');
  assert.equal(val(read(front, ''), 'naissance'), '1990-09-03', 'lecture européenne : jour/mois');
});

test('États-Unis : ISS seule = date de la carte, repère « carte » mais pas de « à proposer » (pas de verso à consulter)', () => {
  const r = readNa(US_FRONT);
  assert.equal(val(r, 'delivrance'), '2023-03-20');
  assert.equal(conf(r, 'delivrance'), 'low');
  assert.equal(r.delivrance.from, 'card');
  assert.equal(r.delivrance.ask, undefined);
});

test('États-Unis : une date de première délivrance l’emporte sur ISS (ORIG ISS, ORIGINAL ISSUE, 1ST ISSUED)', () => {
  for (const label of ['ORIG ISS', 'ORIGINAL ISSUE:', '1ST ISSUED', 'FIRST ISSUED']) {
    const r = readNa(`DOB 03/09/1990\n${label} 04/11/2008\nISS 09/05/2023\nEXP 09/05/2031`);
    assert.equal(val(r, 'delivrance'), '2008-04-11', label);
    assert.equal(conf(r, 'delivrance'), 'high', label);
    assert.equal(r.delivrance.from, undefined, label);
    assert.equal(val(r, 'expiration'), '2031-09-05', label);
  }
});

test('États-Unis : « First name » n’est pas pris pour une date de première délivrance', () => {
  const r = readNa('FIRST NAME JOHN\nLAST NAME SMITH\nDOB 03/15/1990\nISS 03/20/2023');
  assert.equal(val(r, 'prenom'), 'JOHN');
  assert.equal(val(r, 'nom'), 'SMITH');
  assert.equal(r.delivrance.from, 'card');
});

test('États-Unis : rien devant une étiquette absente, rien d’inventé', () => {
  const r = readNa('01/02/2003 12/05/2024 03/04/2030\nSMITH JOHN');
  assert.deepEqual(Object.values(r).filter(Boolean), []);
});

test('Canada : AAAA/MM/JJ lu tel quel, JJ/MM ou MM/JJ ambigus laissés vides, un jour > 12 tranche', () => {
  const CA = { family: 'na', country: 'CA' };
  const iso = readNa('Licence No. A1234-56789-01234\nDOB 1990/03/09\nISSUED 2023/09/05\nEXPIRY 2031/09/05', CA);
  assert.equal(val(iso, 'naissance'), '1990-03-09');
  assert.equal(val(iso, 'expiration'), '2031-09-05');
  assert.equal(val(iso, 'numero'), 'A12345678901234');
  const amb = readNa('DOB 03/09/1990\nISS 15/09/2023\nEXP 09/05/2031', CA);
  assert.equal(val(amb, 'naissance'), null, '03/09 : on ne devine pas');
  assert.equal(val(amb, 'delivrance'), '2023-09-15', '15/09 : forcément jour/mois');
  assert.equal(val(amb, 'expiration'), null);
});

test('Canada : mois en lettres (09 MAR 1990, MAR 15 2023, 15-MAR-2031)', () => {
  const r = readNa('DOB 09 MAR 1990\nISS MAR 15 2023\nEXP 15-MAR-2031', { family: 'na', country: 'CA' });
  assert.equal(val(r, 'naissance'), '1990-03-09');
  assert.equal(val(r, 'delivrance'), '2023-03-15');
  assert.equal(val(r, 'expiration'), '2031-03-15');
});

test('États-Unis : bruit de lecture (O pour 0) et texte vide sans exception', () => {
  const r = readNa('DOB O3/15/1990\nEXP O3/2O/2029');
  assert.equal(val(r, 'naissance'), '1990-03-15');
  assert.equal(val(r, 'expiration'), '2029-03-20');
  assert.doesNotThrow(() => readNa(undefined));
  assert.deepEqual(Object.values(readNa('')).filter(Boolean), []);
});

test('autres pays : aucune date devinée, quelle que soit la photo', () => {
  for (const text of [US_FRONT, FRONT]) {
    const r = App.parseLicence({ front: text, back: BACK }, { today: TODAY, family: 'other', country: 'AU' });
    assert.deepEqual(Object.values(r).filter(Boolean), []);
  }
});

test('modèle par défaut : européen (les appels sans option gardent leur comportement)', () => {
  assert.equal(val(App.parseLicence({ front: FRONT, back: BACK }, { today: TODAY }), 'delivrance'), '2015-03-12');
});
