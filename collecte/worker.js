/* Boîte aux lettres des dossiers chiffrés : un Cloudflare Worker avec son stockage KV.
 *
 * Il ne reçoit, ne garde et ne rend que des enveloppes déjà chiffrées dans le navigateur de l'invité avec la clé
 * publique de l'organisateur. Il ne possède aucune clé : il ne peut rien lire. Il voit seulement l'heure et la taille
 * de chaque dépôt (et l'adresse IP, comme tout serveur web).
 *
 *   GET    /                  état (public) : { app, v, stockage, lecture }
 *   POST   /envois            dépôt d'une enveloppe (public, ?ttl=secondes) -> 201 { ok, id }
 *   GET    /envois            liste des dépôts (jeton)   -> { envois: [{ id, t, n }], suite }
 *   GET    /envois/<id>       une enveloppe (jeton)
 *   DELETE /envois/<id>       en supprimer une (jeton)
 *   DELETE /envois            en supprimer jusqu'à 40 d'un coup, à répéter tant que `reste` > 0 (jeton)
 *
 * Réglages Cloudflare : un stockage KV relié sous le nom ENVOIS, un secret JETON_LECTURE (le jeton affiché par l'outil).
 * Variable facultative : TAILLE_MAX (octets, 6 Mo par défaut). Pas à pas : collecte/LISEZMOI.md. */

const TAILLE_MAX = 6 * 1024 * 1024;
const TTL_DEFAUT = 120 * 86400;
const TTL_MIN = 3600;            // KV refuse moins de 60 s ; une heure suffit à ne jamais perdre un dépôt par erreur
const TTL_MAX = 400 * 86400;
const LOT_SUPPRESSION = 40;      // peu d'opérations par appel : le plan gratuit limite leur nombre
const B64U = /^[A-Za-z0-9_-]+$/;
const ID = /^\d{13}-[0-9a-f]{12}$/;

const ENTETES = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
  'cache-control': 'no-store',
};
const reponse = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...ENTETES, 'content-type': 'application/json; charset=utf-8' } });
const erreur = (code, status) => reponse({ erreur: code }, status);

/** Ne garde de l'enveloppe que ses cinq champs, si elle a bien la forme de celles de l'outil ; sinon null. */
function enveloppePropre(texte) {
  let e;
  try { e = JSON.parse(texte); } catch (x) { return null; }
  if (!e || typeof e !== 'object' || e.app !== 'mariage-voiture' || e.v !== 1) return null;
  for (const k of ['kid', 'epk', 'iv', 'ct']) if (typeof e[k] !== 'string' || !B64U.test(e[k])) return null;
  if (e.kid.length > 16 || e.epk.length !== 87 || e.iv.length !== 16 || e.ct.length < 24) return null;
  return JSON.stringify({ app: e.app, v: e.v, kid: e.kid, epk: e.epk, iv: e.iv, ct: e.ct });
}

const hache = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** 'ok' | 'refuse' | 'non_configure'. Comparaison sur les empreintes, sans court-circuit. */
async function autorise(request, env) {
  const attendu = env.JETON_LECTURE;
  if (typeof attendu !== 'string' || attendu.length < 16) return 'non_configure';
  const donne = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [a, b] = await Promise.all([hache(donne), hache(attendu)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? 'ok' : 'refuse';
}

const aleatoire = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const chemin = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ENTETES });

    if (chemin === '/' && request.method === 'GET') {
      return reponse({ app: 'mariage-voiture-collecte', v: 1, stockage: !!env.ENVOIS, lecture: typeof env.JETON_LECTURE === 'string' && env.JETON_LECTURE.length >= 16 });
    }
    if (!env.ENVOIS) return erreur('stockage_non_relie', 503);

    /* ----- dépôt : ouvert à tous, mais limité en taille et en forme ----- */
    if (chemin === '/envois' && request.method === 'POST') {
      const max = Number(env.TAILLE_MAX) > 0 ? Number(env.TAILLE_MAX) : TAILLE_MAX;
      if (Number(request.headers.get('content-length')) > max) return erreur('trop_gros', 413);
      const texte = await request.text();
      if (texte.length > max) return erreur('trop_gros', 413);
      const enveloppe = enveloppePropre(texte);
      if (!enveloppe) return erreur('enveloppe_invalide', 400);
      const demande = Math.floor(Number(url.searchParams.get('ttl')));
      const ttl = Math.min(TTL_MAX, Math.max(TTL_MIN, Number.isFinite(demande) && demande > 0 ? demande : TTL_DEFAUT));
      const t = Date.now();
      const id = `${String(t).padStart(13, '0')}-${aleatoire(6)}`;
      await env.ENVOIS.put(`env:${id}`, enveloppe, { expirationTtl: ttl, metadata: { t, n: enveloppe.length } });
      return reponse({ ok: true, id }, 201);
    }

    /* ----- lecture et suppression : jeton de l'organisateur ----- */
    if (chemin === '/envois' || chemin.startsWith('/envois/')) {
      const droit = await autorise(request, env);
      if (droit === 'non_configure') return erreur('jeton_non_configure', 503);
      if (droit !== 'ok') return erreur('refuse', 401);
      const id = chemin.slice('/envois/'.length);

      if (chemin === '/envois' && request.method === 'GET') {
        const page = await env.ENVOIS.list({ prefix: 'env:', cursor: url.searchParams.get('suite') || undefined, limit: 200 });
        return reponse({
          envois: page.keys.map((k) => ({ id: k.name.slice(4), t: (k.metadata || {}).t || null, n: (k.metadata || {}).n || null })),
          suite: page.list_complete ? null : page.cursor,
        });
      }
      if (chemin === '/envois' && request.method === 'DELETE') {
        const page = await env.ENVOIS.list({ prefix: 'env:', limit: LOT_SUPPRESSION });
        for (const k of page.keys) await env.ENVOIS.delete(k.name);
        return reponse({ ok: true, supprimes: page.keys.length, reste: !page.list_complete });
      }
      if (ID.test(id) && request.method === 'GET') {
        const valeur = await env.ENVOIS.get(`env:${id}`);
        return valeur === null ? erreur('introuvable', 404) : new Response(valeur, { headers: { ...ENTETES, 'content-type': 'application/json; charset=utf-8' } });
      }
      if (ID.test(id) && request.method === 'DELETE') {
        await env.ENVOIS.delete(`env:${id}`);
        return reponse({ ok: true });
      }
    }
    return erreur('introuvable', 404);
  },
};
