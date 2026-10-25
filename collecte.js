/* Collecte automatique : dépôt des dossiers chiffrés sur un petit service en ligne (voir collecte/worker.js) et
 * récupération par l'organisateur. Le service ne reçoit que des enveloppes déjà chiffrées avec la clé publique de
 * l'organisateur : il ne peut rien lire. Facultatif : sans adresse de service dans les réglages, rien de tout cela n'est utilisé. */
(function (root) {
  'use strict';
  const App = (root.App = root.App || {});

  const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

  /** Adresse du service : https seulement (http pour un essai sur cet ordinateur), sans identifiants, requête ni fragment. '' si invalide. */
  App.collecteUrl = (s) => {
    try {
      const u = new URL(String(s || '').trim());
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return '';
      if (u.username || u.password || !/^[a-z0-9.-]+$/i.test(u.hostname)) return '';
      return (u.origin + u.pathname.replace(/\/+$/, '')).slice(0, 200);
    } catch (e) {
      return '';
    }
  };

  /** Jeton de lecture : 192 bits au hasard, que seul l'organisateur (et le Worker, qui le garde en secret) connaît. */
  const toB64u = (bytes) => {
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return root.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  App.collecteNewToken = () => toB64u(root.crypto.getRandomValues(new Uint8Array(24)));
  App.collecteTokenOk = (t) => TOKEN.test(String(t || ''));

  const CODES = { 400: 'BAD_ENVELOPE', 401: 'REFUSED', 404: 'NOT_FOUND', 413: 'TOO_BIG', 503: 'NOT_CONFIGURED' };

  /**
   * Un appel au service. Lève une Error dont le message est un code : NETWORK (injoignable, délai dépassé), REFUSED (jeton),
   * NOT_CONFIGURED (secret ou stockage manquant côté Cloudflare), TOO_BIG, BAD_ENVELOPE, NOT_FOUND, HTTP_<n>.
   */
  async function call(base, path, { method = 'GET', token, body, timeout = 60000, fetch: f } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await (f || root.fetch.bind(root))(base + path, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'text/plain;charset=UTF-8' } : {}), // type « simple » : pas de requête préalable pour le dépôt
        },
        body,
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (e) {
      throw new Error('NETWORK');
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* corps vide ou illisible */ }
    if (!res.ok) throw new Error(CODES[res.status] || `HTTP_${res.status}`);
    if (data === null) throw new Error('BAD_RESPONSE');
    return data;
  }

  const seg = (id) => encodeURIComponent(id);

  /** Dépose une enveloppe (texte JSON). `ttl` : durée de conservation demandée, en secondes. Renvoie l'identifiant. */
  App.collecteSend = async (base, text, { ttl, fetch } = {}) => {
    const q = Number.isFinite(ttl) && ttl > 0 ? `?ttl=${Math.floor(ttl)}` : '';
    const r = await call(base, `/envois${q}`, { method: 'POST', body: text, fetch });
    if (!r.ok) throw new Error('BAD_RESPONSE');
    return r.id;
  };

  /** État du service, sans jeton : { app, v, stockage, lecture }. Sert au bouton « Tester ». */
  App.collectePing = async (base, { fetch } = {}) => {
    const r = await call(base, '/', { timeout: 15000, fetch });
    if (r.app !== 'mariage-voiture-collecte') throw new Error('NOT_A_SERVICE');
    return r;
  };

  /** Tous les dépôts : [{ id, t, n }], page après page. */
  App.collecteList = async (base, token, { fetch } = {}) => {
    const out = [];
    let suite = '';
    for (let page = 0; page < 200; page++) {
      const r = await call(base, `/envois${suite ? `?suite=${encodeURIComponent(suite)}` : ''}`, { token, timeout: 30000, fetch });
      if (!Array.isArray(r.envois)) throw new Error('BAD_RESPONSE');
      out.push(...r.envois);
      if (!r.suite) break;
      suite = r.suite;
    }
    return out;
  };

  App.collecteGet = (base, token, id, { fetch } = {}) => call(base, `/envois/${seg(id)}`, { token, fetch });
  App.collecteRemove = async (base, token, id, { fetch } = {}) => { await call(base, `/envois/${seg(id)}`, { method: 'DELETE', token, fetch }); };

  /** Vide le service, par lots. Renvoie le nombre de dépôts supprimés. */
  App.collectePurge = async (base, token, { fetch, onProgress } = {}) => {
    let total = 0;
    for (let i = 0; i < 500; i++) {
      const r = await call(base, '/envois', { method: 'DELETE', token, fetch });
      total += r.supprimes || 0;
      if (onProgress) onProgress(total);
      if (!r.reste) break;
    }
    return total;
  };

  /** Phrase pour l'organisateur à partir du code d'erreur. */
  App.collecteErrorText = (code) => ({
    NETWORK: 'Le service ne répond pas (adresse, connexion, ou politique de sécurité de la page).',
    REFUSED: 'Le service refuse le jeton : le secret JETON_LECTURE de Cloudflare doit être identique au jeton affiché ici.',
    NOT_CONFIGURED: 'Le service répond, mais il manque son stockage KV (nom ENVOIS) ou son secret JETON_LECTURE.',
    NOT_A_SERVICE: 'Cette adresse répond, mais ce n’est pas le service de collecte.',
    TOO_BIG: 'Dossier trop volumineux pour le service.',
    BAD_ENVELOPE: 'Le service a refusé le dossier (format inattendu).',
    NOT_FOUND: 'Introuvable sur le service.',
  })[code] || 'Réponse inattendue du service.';

  if (typeof module !== 'undefined' && module.exports) module.exports = App;
})(typeof window !== 'undefined' ? window : globalThis);
