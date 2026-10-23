import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Vault = createRequire(import.meta.url)('../vault.js');

const PASS = 'cheval bleu maquis ocean 42';

test('aller-retour complet, y compris un gros payload (photos)', async () => {
  const org = await Vault.createOrganizerKey(PASS);
  const priv = await Vault.unlockOrganizerKey(org, PASS);
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(900000);
  const payload = { v: 1, identite: { nom: 'Léandri', prenom: 'Zoé' }, permis: { recto: photo } };

  const env = await Vault.encryptFor(org.publicKey, payload);
  const back = await Vault.decryptEnvelope(priv, org.publicKey, env);
  assert.deepEqual(back, payload);
});

test('la clé publique et l’enveloppe ne laissent rien lire en clair', async () => {
  const org = await Vault.createOrganizerKey(PASS);
  const env = await Vault.encryptFor(org.publicKey, { nom: 'Santoni', permis: '12AB34567' });
  const blob = JSON.stringify(env) + JSON.stringify(org);
  assert.ok(!blob.includes('Santoni'));
  assert.ok(!blob.includes('12AB34567'));
});

test('deux chiffrements du même contenu donnent deux enveloppes différentes', async () => {
  const org = await Vault.createOrganizerKey(PASS);
  const a = await Vault.encryptFor(org.publicKey, { x: 1 });
  const b = await Vault.encryptFor(org.publicKey, { x: 1 });
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.epk, b.epk);
});

test('mauvaise phrase de passe : BAD_PASSPHRASE', async () => {
  const org = await Vault.createOrganizerKey(PASS);
  await assert.rejects(Vault.unlockOrganizerKey(org, PASS + ' '), /BAD_PASSPHRASE/);
});

test('enveloppe destinée à une autre clé : refusée', async () => {
  const a = await Vault.createOrganizerKey(PASS);
  const b = await Vault.createOrganizerKey(PASS);
  const privB = await Vault.unlockOrganizerKey(b, PASS);
  const env = await Vault.encryptFor(a.publicKey, { x: 1 });
  await assert.rejects(Vault.decryptEnvelope(privB, b.publicKey, env), /NOT_FOR_THIS_KEY/);
});

test('enveloppe modifiée (un octet) : refusée', async () => {
  const org = await Vault.createOrganizerKey(PASS);
  const priv = await Vault.unlockOrganizerKey(org, PASS);
  const env = await Vault.encryptFor(org.publicKey, { x: 1 });
  const bytes = Vault.fromB64u(env.ct);
  bytes[0] ^= 1;
  await assert.rejects(
    Vault.decryptEnvelope(priv, org.publicKey, { ...env, ct: Vault.toB64u(bytes) }),
    /NOT_FOR_THIS_KEY/);
});

test('la clé enveloppée est liée à la clé publique (échange de clé publique refusé)', async () => {
  const a = await Vault.createOrganizerKey(PASS);
  const b = await Vault.createOrganizerKey(PASS);
  await assert.rejects(
    Vault.unlockOrganizerKey({ publicKey: b.publicKey, wrapped: a.wrapped }, PASS),
    /BAD_PASSPHRASE/);
});

test('fichier de clé avec nombre de tours absurde : refusé sans calcul', async () => {
  const org = await Vault.createOrganizerKey(PASS);
  const evil = { ...org, wrapped: { ...org.wrapped, iter: 999999999 } };
  await assert.rejects(Vault.unlockOrganizerKey(evil, PASS), /BAD_KEYFILE/);
});

test('empreinte stable et lisible', async () => {
  const org = await Vault.createOrganizerKey(PASS);
  const f1 = await Vault.fingerprint(org.publicKey);
  const f2 = await Vault.fingerprint(org.publicKey);
  assert.equal(f1, f2);
  assert.match(f1, /^([0-9A-F]{4} ){4}[0-9A-F]{4}$/);
});

test('base64url sur des octets quelconques', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) & 255);
  const s = Vault.toB64u(bytes);
  assert.ok(!/[+/=]/.test(s));
  assert.deepEqual(Vault.fromB64u(s), bytes);
});

test('mot de passe ZIP : format et unicité', () => {
  const a = Vault.randomCode();
  assert.match(a, /^([A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/);
  assert.notEqual(a, Vault.randomCode());
});

test('contrôle de la phrase de passe', () => {
  assert.ok(Vault.passphraseProblem('court'));
  assert.ok(Vault.passphraseProblem('aaaaaaaaaaaaaaaaaaaa'));
  assert.equal(Vault.passphraseProblem(PASS), null);
});

test('mot de passe d’accès : aller-retour, mauvais mot de passe, contenu altéré', async () => {
  const cfg = { nom: 'Luna & Guillaume', pk: 'BAAA', lieux: ['AJA'] };
  const env = await Vault.sealWithPassword(cfg, 'K7M2-9QXD-4TRB');
  assert.deepEqual(await Vault.openWithPassword(env, 'K7M2-9QXD-4TRB'), cfg);
  await assert.rejects(Vault.openWithPassword(env, 'K7M2-9QXD-4TRC'), /BAD_PASSWORD/);
  await assert.rejects(Vault.openWithPassword(env, ''), /BAD_PASSWORD/);
  await assert.rejects(Vault.sealWithPassword(cfg, ' - '), /EMPTY_PASSWORD/);
  const bytes = Vault.fromB64u(env.ct);
  bytes[3] ^= 1;
  await assert.rejects(Vault.openWithPassword({ ...env, ct: Vault.toB64u(bytes) }, 'K7M2-9QXD-4TRB'), /BAD_PASSWORD/);
});

test('mot de passe d’accès : rien de lisible dans l’enveloppe, sel et nonce différents à chaque fois', async () => {
  const a = await Vault.sealWithPassword({ nom: 'Luna & Guillaume' }, 'mot-de-passe');
  const b = await Vault.sealWithPassword({ nom: 'Luna & Guillaume' }, 'mot-de-passe');
  assert.ok(!JSON.stringify(a).includes('Luna'));
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.ct, b.ct);
});

test('mot de passe d’accès : enveloppe malformée ou nombre de tours absurde refusés', async () => {
  const env = await Vault.sealWithPassword({ x: 1 }, 'abc');
  await assert.rejects(Vault.openWithPassword(null, 'abc'), /BAD_FORMAT/);
  await assert.rejects(Vault.openWithPassword({ ...env, ct: 5 }, 'abc'), /BAD_FORMAT/);
  await assert.rejects(Vault.openWithPassword({ ...env, iter: 999999999 }, 'abc'), /BAD_KEYFILE/);
});

test('mot de passe d’accès : majuscules, espaces et tirets ne comptent pas (saisie sur téléphone)', async () => {
  const env = await Vault.sealWithPassword({ ok: 1 }, 'K7M2-9QXD-4TRB');
  for (const typed of ['k7m2-9qxd-4trb', ' K7M2 9QXD 4TRB ', 'k7m29qxd4trb']) {
    assert.deepEqual(await Vault.openWithPassword(env, typed), { ok: 1 }, typed);
  }
  assert.equal(Vault.accessSecret('Coti 2027'), 'COTI2027');
});

test('lien : l’enveloppe tient dans un fragment compact et revient identique', async () => {
  const env = await Vault.sealWithPassword({ nom: 'Luna & Guillaume', lieux: ['AJA', 'BIA'] }, 'maquis');
  const text = Vault.packEnvelope(env);
  assert.match(text, /^1\.300000\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(Vault.unpackEnvelope(text), env);
  assert.deepEqual(await Vault.openWithPassword(Vault.unpackEnvelope(text), 'MAQUIS'), { nom: 'Luna & Guillaume', lieux: ['AJA', 'BIA'] });
  for (const bad of ['', '1.2.3', '2.300000.a.b.c', '1.abc.a.b.c', '1.300000.a.b.c.d', '1.300000.a b.c.d', '1.300000..b.c']) {
    assert.equal(Vault.unpackEnvelope(bad), null, bad);
  }
});
