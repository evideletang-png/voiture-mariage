import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const App = createRequire(import.meta.url)('../collecte.js');
const worker = (await import('../collecte/worker.js')).default;
const Vault = createRequire(import.meta.url)('../vault.js');

/* ---------- faux stockage KV : liste triée, métadonnées, durée de vie ---------- */

function fakeKV() {
  const rows = new Map();
  return {
    rows,
    async put(key, value, opts = {}) { rows.set(key, { value, ttl: opts.expirationTtl, metadata: opts.metadata }); },
    async get(key) { return rows.has(key) ? rows.get(key).value : null; },
    async delete(key) { rows.delete(key); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const names = [...rows.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? names.findIndex((n) => n > cursor) : 0;
      const slice = from < 0 ? [] : names.slice(from, from + limit);
      const done = from < 0 || from + limit >= names.length;
      return { keys: slice.map((name) => ({ name, metadata: rows.get(name).metadata })), list_complete: done, cursor: done ? undefined : slice[slice.length - 1] };
    },
  };
}

const TOKEN = 'jeton-de-lecture-assez-long-0123456789';
const makeEnv = (extra = {}) => ({ ENVOIS: fakeKV(), JETON_LECTURE: TOKEN, ...extra });
const call = (env, path, init = {}) => worker.fetch(new Request(`https://collecte.example.workers.dev${path}`, init), env);
const auth = { authorization: `Bearer ${TOKEN}` };

const b64 = (n) => Buffer.from(new Uint8Array(n).fill(7)).toString('base64url');
const enveloppe = (extra = {}) => ({ app: 'mariage-voiture', v: 1, kid: 'ABCD1234', epk: b64(65), iv: b64(12), ct: b64(300), ...extra });
const depose = (env, e = enveloppe(), query = '') => call(env, `/envois${query}`, { method: 'POST', body: JSON.stringify(e), headers: { 'content-type': 'text/plain;charset=UTF-8' } });

/* ---------- le Worker ---------- */

test('état public : dit si le stockage et le jeton sont en place, sans rien révéler', async () => {
  const r = await call(makeEnv(), '/');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { app: 'mariage-voiture-collecte', v: 1, stockage: true, lecture: true });
  const sans = await (await call({ ENVOIS: fakeKV() }, '/')).json();
  assert.equal(sans.lecture, false);
  assert.equal((await call({}, '/')).status, 200);
  assert.equal((await call({}, '/envois', { method: 'POST', body: '{}' })).status, 503, 'stockage non relié');
});

test('dépôt : ouvert sans jeton, enveloppe recopiée champ par champ, durée de vie bornée', async () => {
  const env = makeEnv();
  const r = await depose(env, enveloppe({ intrus: 'x'.repeat(50), nom: 'Zoé' }), '?ttl=864000');
  assert.equal(r.status, 201);
  const { ok, id } = await r.json();
  assert.equal(ok, true);
  assert.match(id, /^\d{13}-[0-9a-f]{12}$/);
  const row = env.ENVOIS.rows.get(`env:${id}`);
  assert.deepEqual(Object.keys(JSON.parse(row.value)), ['app', 'v', 'kid', 'epk', 'iv', 'ct'], 'rien d’autre n’est gardé');
  assert.equal(row.ttl, 864000);
  assert.equal(row.metadata.n, row.value.length);
  const defaut = await (await depose(env)).json();
  assert.equal(env.ENVOIS.rows.get(`env:${defaut.id}`).ttl, 120 * 86400);
  for (const [q, want] of [['?ttl=10', 3600], ['?ttl=99999999999', 400 * 86400], ['?ttl=abc', 120 * 86400], ['?ttl=-5', 120 * 86400]]) {
    const { id: i } = await (await depose(env, enveloppe(), q)).json();
    assert.equal(env.ENVOIS.rows.get(`env:${i}`).ttl, want, q);
  }
});

test('dépôt : formes refusées (pas du JSON, mauvaise appli, champs absents ou trop courts, caractères hors base64url)', async () => {
  const env = makeEnv();
  for (const bad of [
    'pas du json', '[]', 'null', JSON.stringify({ ...enveloppe(), app: 'autre' }), JSON.stringify({ ...enveloppe(), v: 2 }),
    JSON.stringify({ ...enveloppe(), epk: b64(64) }), JSON.stringify({ ...enveloppe(), iv: b64(11) }), JSON.stringify({ ...enveloppe(), ct: 'abc' }),
    JSON.stringify({ ...enveloppe(), kid: 'x'.repeat(40) }), JSON.stringify({ ...enveloppe(), ct: '<script>'.padEnd(30, 'a') }),
    JSON.stringify({ app: 'mariage-voiture', v: 1 }),
  ]) {
    const r = await call(env, '/envois', { method: 'POST', body: bad });
    assert.equal(r.status, 400, bad.slice(0, 40));
    assert.equal((await r.json()).erreur, 'enveloppe_invalide');
  }
  assert.equal(env.ENVOIS.rows.size, 0);
});

test('dépôt : taille plafonnée (par défaut 6 Mo, réglable par TAILLE_MAX)', async () => {
  const env = makeEnv({ TAILLE_MAX: '2000' });
  assert.equal((await depose(env, enveloppe({ ct: b64(5000) }))).status, 413);
  assert.equal((await depose(env, enveloppe({ ct: b64(300) }))).status, 201);
  const gros = makeEnv();
  assert.equal((await depose(gros, enveloppe({ ct: b64(4 * 1024 * 1024) }))).status, 201, '4 Mo chiffrés (5,6 Mo en base64) passent : bien plus que deux photos réduites');
  assert.equal((await depose(gros, enveloppe({ ct: b64(5 * 1024 * 1024) }))).status, 413);
});

test('lecture et suppression : refusées sans le bon jeton, et sans jeton configuré', async () => {
  const env = makeEnv();
  const { id } = await (await depose(env)).json();
  for (const [path, init] of [['/envois', {}], [`/envois/${id}`, {}], [`/envois/${id}`, { method: 'DELETE' }], ['/envois', { method: 'DELETE' }]]) {
    assert.equal((await call(env, path, init)).status, 401, `${init.method || 'GET'} ${path} sans jeton`);
    assert.equal((await call(env, path, { ...init, headers: { authorization: 'Bearer faux' } })).status, 401, 'mauvais jeton');
    assert.equal((await call(env, path, { ...init, headers: { authorization: `Bearer ${TOKEN}x` } })).status, 401, 'jeton presque bon');
  }
  assert.equal(env.ENVOIS.rows.size, 1, 'rien n’a été supprimé');
  const sans = { ENVOIS: env.ENVOIS };
  const r = await call(sans, '/envois', { headers: auth });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).erreur, 'jeton_non_configure');
  assert.equal((await call({ ...sans, JETON_LECTURE: 'court' }, '/envois', { headers: { authorization: 'Bearer court' } })).status, 503, 'jeton trop court = non configuré');
});

test('lecture : liste (avec heure et taille), lecture d’un dépôt, suppression, introuvable', async () => {
  const env = makeEnv();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await (await depose(env, enveloppe({ ct: b64(100 + i) }))).json()).id);
  const liste = await (await call(env, '/envois', { headers: auth })).json();
  assert.deepEqual(liste.envois.map((e) => e.id).sort(), [...ids].sort());
  assert.equal(liste.suite, null);
  assert.ok(liste.envois.every((e) => e.t > 1.7e12 && e.n > 100));
  const un = await call(env, `/envois/${ids[0]}`, { headers: auth });
  assert.equal(un.status, 200);
  assert.equal((await un.json()).app, 'mariage-voiture');
  assert.equal((await call(env, '/envois/0000000000000-aaaaaaaaaaaa', { headers: auth })).status, 404);
  assert.equal((await call(env, '/envois/../../etc', { headers: auth })).status, 404, 'identifiant mal formé');
  assert.equal((await call(env, `/envois/${ids[0]}`, { method: 'DELETE', headers: auth })).status, 200);
  assert.equal((await call(env, `/envois/${ids[0]}`, { headers: auth })).status, 404);
  assert.equal(env.ENVOIS.rows.size, 2);
});

test('vider le service : par lots de 40, à répéter tant qu’il en reste', async () => {
  const env = makeEnv();
  for (let i = 0; i < 95; i++) await depose(env);
  let appels = 0, total = 0, r;
  do {
    r = await (await call(env, '/envois', { method: 'DELETE', headers: auth })).json();
    total += r.supprimes;
    appels++;
  } while (r.reste && appels < 10);
  assert.equal(total, 95);
  assert.equal(appels, 3);
  assert.equal(env.ENVOIS.rows.size, 0);
});

test('en-têtes CORS : requête préalable acceptée, rien ne se met en cache', async () => {
  const pre = await call(makeEnv(), '/envois', { method: 'OPTIONS', headers: { 'access-control-request-method': 'GET' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const r = await call(makeEnv(), '/envois', { headers: auth });
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await call(makeEnv(), '/nimporte-quoi')).status, 404);
});

/* ---------- le client, contre ce Worker ---------- */

const clientFetch = (env) => (url, init = {}) => worker.fetch(new Request(url, init), env);
const BASE = 'https://collecte.example.workers.dev';

test('client : dépôt, liste, lecture, suppression et vidage contre le vrai code du Worker', async () => {
  const env = makeEnv();
  const fetch = clientFetch(env);
  const ping = await App.collectePing(BASE, { fetch });
  assert.deepEqual([ping.stockage, ping.lecture], [true, true]);
  const texte = JSON.stringify(enveloppe());
  const id = await App.collecteSend(BASE, texte, { ttl: 5000.7, fetch });
  assert.equal(env.ENVOIS.rows.get(`env:${id}`).ttl, 5000);
  await App.collecteSend(BASE, texte, { fetch });
  const liste = await App.collecteList(BASE, TOKEN, { fetch });
  assert.equal(liste.length, 2);
  assert.equal((await App.collecteGet(BASE, TOKEN, id, { fetch })).ct, enveloppe().ct);
  await App.collecteRemove(BASE, TOKEN, id, { fetch });
  assert.equal((await App.collecteList(BASE, TOKEN, { fetch })).length, 1);
  assert.equal(await App.collectePurge(BASE, TOKEN, { fetch }), 1);
});

test('client : la liste suit les pages du service', async () => {
  const env = makeEnv();
  const fetch = clientFetch(env);
  for (let i = 0; i < 5; i++) await App.collecteSend(BASE, JSON.stringify(enveloppe()), { fetch });
  const petit = (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/envois' && !init.method) { u.searchParams.set('limit', '2'); }
    return fetch(url, init);
  };
  // le faux KV rend tout d'un coup ; on simule des pages de 2 en enveloppant la liste
  const kv = env.ENVOIS;
  const vraieListe = kv.list.bind(kv);
  kv.list = (o) => vraieListe({ ...o, limit: 2 });
  assert.equal((await App.collecteList(BASE, TOKEN, { fetch: petit })).length, 5);
});

test('client : les erreurs du service deviennent des codes lisibles', async () => {
  const env = makeEnv();
  const fetch = clientFetch(env);
  const code = async (p) => { try { await p; } catch (e) { return e.message; } return 'OK'; };
  assert.equal(await code(App.collecteList(BASE, 'mauvais-jeton-0123456789', { fetch })), 'REFUSED');
  assert.equal(await code(App.collecteList(BASE, TOKEN, { fetch: clientFetch({ ENVOIS: env.ENVOIS }) })), 'NOT_CONFIGURED');
  assert.equal(await code(App.collecteSend(BASE, 'pas une enveloppe', { fetch })), 'BAD_ENVELOPE');
  assert.equal(await code(App.collecteSend(BASE, JSON.stringify(enveloppe({ ct: b64(5 * 1024 * 1024) })), { fetch })), 'TOO_BIG');
  assert.equal(await code(App.collecteGet(BASE, TOKEN, '0000000000000-aaaaaaaaaaaa', { fetch })), 'NOT_FOUND');
  assert.equal(await code(App.collectePing(BASE, { fetch: async () => { throw new TypeError('Failed to fetch'); } })), 'NETWORK');
  assert.equal(await code(App.collectePing(BASE, { fetch: async () => new Response('{"app":"autre"}', { status: 200 }) })), 'NOT_A_SERVICE');
  assert.equal(await code(App.collectePing(BASE, { fetch: async () => new Response('<html>', { status: 200 }) })), 'BAD_RESPONSE');
  assert.equal(await code(App.collectePing(BASE, { fetch: async () => new Response('{}', { status: 502 }) })), 'HTTP_502');
  for (const c of ['NETWORK', 'REFUSED', 'NOT_CONFIGURED', 'NOT_A_SERVICE', 'TOO_BIG', 'BAD_ENVELOPE', 'NOT_FOUND', 'AUTRE']) assert.ok(App.collecteErrorText(c).length > 10);
});

test('client : le dépôt part en texte simple (pas de requête préalable) et sans jeton ; le jeton ne part que pour lire', async () => {
  const seen = [];
  const fetch = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ ok: true, id: '1700000000000-aaaaaaaaaaaa', envois: [], suite: null }), { status: 201 }); };
  await App.collecteSend(BASE, '{}', { fetch });
  assert.equal(seen[0].init.headers['content-type'], 'text/plain;charset=UTF-8');
  assert.equal(seen[0].init.headers.authorization, undefined);
  assert.equal(seen[0].init.credentials, 'omit');
  assert.equal(seen[0].init.referrerPolicy, 'no-referrer');
  await App.collecteList(BASE, TOKEN, { fetch });
  assert.equal(seen[1].init.headers.authorization, `Bearer ${TOKEN}`);
});

/* ---------- adresse et jeton ---------- */

test('adresse du service : https seulement (http pour un essai local), sans identifiants ni requête', () => {
  assert.equal(App.collecteUrl('https://mariage.moi.workers.dev/'), 'https://mariage.moi.workers.dev');
  assert.equal(App.collecteUrl('  https://mariage.moi.workers.dev/collecte/?a=1#x '), 'https://mariage.moi.workers.dev/collecte');
  assert.equal(App.collecteUrl('http://localhost:8787'), 'http://localhost:8787');
  for (const bad of ['', null, undefined, 'mariage.moi.workers.dev', 'http://mariage.moi.workers.dev', 'ftp://x.dev', 'javascript:alert(1)', 'https://u:p@x.dev', 'https://', 'https://exa mple.com', 'https://x.dev/' + 'a'.repeat(300)]) {
    const r = App.collecteUrl(bad);
    assert.ok(r === '' || r.length <= 200, String(bad).slice(0, 30));
    if (bad !== 'https://x.dev/' + 'a'.repeat(300)) assert.equal(r, '', String(bad).slice(0, 30));
  }
});

test('jeton de lecture : 32 caractères au hasard, tous différents', () => {
  const tokens = new Set(Array.from({ length: 50 }, () => App.collecteNewToken()));
  assert.equal(tokens.size, 50);
  for (const t of tokens) { assert.equal(t.length, 32); assert.ok(App.collecteTokenOk(t)); }
  assert.equal(App.collecteTokenOk('court'), false);
  assert.equal(App.collecteTokenOk('a'.repeat(20) + '!'), false);
});

/* ---------- avec une vraie enveloppe de l'outil ---------- */

test('une vraie enveloppe de l’outil est acceptée telle quelle par le Worker', async () => {
  const { publicKey } = await Vault.createOrganizerKey('une phrase de passe assez longue pour le test');
  const env = await Vault.encryptFor(publicKey, { prenom: 'Zoé', permis: { numero: '123456789012' } });
  const w = makeEnv();
  const r = await depose(w, env);
  assert.equal(r.status, 201, JSON.stringify(await r.clone().json()));
  const { id } = await r.json();
  const rendu = await (await call(w, `/envois/${id}`, { headers: auth })).json();
  assert.deepEqual(rendu, env, 'ce que le Worker rend est exactement ce qui est entré');
  assert.ok(!JSON.stringify([...w.ENVOIS.rows.values()]).includes('Zoé'), 'rien de lisible dans le stockage');
});
