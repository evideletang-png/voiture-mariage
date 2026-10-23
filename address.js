/* Suggestions d'adresses pendant la saisie.
 *
 * Deux services publics, sans clé :
 *   - France : le géocodeur de la Géoplateforme (IGN), qui sert la Base Adresse Nationale
 *     (l'ancienne API api-adresse.data.gouv.fr est annoncée comme obsolète depuis le 31 janvier 2026) ;
 *   - reste du monde : Photon (données OpenStreetMap), conçu pour la saisie semi-automatique.
 * Seul ce que l'invité tape dans le champ adresse part vers ces services, sans cookie ni référent.
 * Tout le reste du formulaire reste chiffré dans la page. La lecture des réponses est pure et testée. */
(function (root) {
  'use strict';
  const App = (root.App = root.App || {});

  const FRANCE = new Set(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT']);
  // pays où l'on écrit « 5 rue Descartes » plutôt que « Hauptstraße 5 »
  const NUMBER_FIRST = new Set(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT', 'LU', 'GB', 'IE', 'US', 'CA', 'AU', 'NZ']);
  const PHOTON_LANGS = new Set(['fr', 'de', 'en']); // les seules langues que Photon accepte
  const MIN_CHARS = 4;
  const MAX_RESULTS = 6;

  App.ADDRESS_PROVIDERS = {
    geopf: { name: 'Géoplateforme (IGN)', host: 'https://data.geopf.fr', credit: 'Base Adresse Nationale · Licence Ouverte' },
    photon: { name: 'Photon (OpenStreetMap)', host: 'https://photon.komoot.io', credit: '© OpenStreetMap contributors' },
  };

  App.addressProvider = (iso) => (FRANCE.has(iso) ? 'geopf' : 'photon');

  App.suggestUrl = (provider, query, lang) => {
    const q = encodeURIComponent(String(query).trim());
    if (provider === 'geopf') return `${App.ADDRESS_PROVIDERS.geopf.host}/geocodage/search?q=${q}&limit=${MAX_RESULTS}&autocomplete=1`;
    const l = PHOTON_LANGS.has(lang) ? `&lang=${lang}` : '';
    return `${App.ADDRESS_PROVIDERS.photon.host}/api/?q=${q}&limit=10${l}&layer=house&layer=street`;
  };

  const joinLine = (iso, street, number) => (!number ? street : NUMBER_FIRST.has(iso) ? `${number} ${street}` : `${street} ${number}`);

  /** Région à reporter seulement là où le formulaire en demande une. */
  const regionOf = (iso, p) => (['US', 'CA', 'AU'].includes(iso) ? p.state : ['GB', 'IE', 'IT', 'ES'].includes(iso) ? p.county : '') || '';

  /** Réponse brute d'un service -> [{ line1, postcode, city, region, country, label }]. */
  App.parseSuggestions = (provider, json, { iso = '' } = {}) => {
    const features = json && Array.isArray(json.features) ? json.features : [];
    const out = [];
    const seen = new Set();
    for (const f of features) {
      const p = (f && f.properties) || {};
      let s = null;
      if (provider === 'geopf') {
        if (!['housenumber', 'street', 'locality'].includes(p.type) || !p.name) continue;
        s = { line1: String(p.name), postcode: p.postcode || '', city: p.city || '', region: '', country: FRANCE.has(iso) ? iso : 'FR' };
      } else {
        const street = p.street || (p.type === 'street' ? p.name : '');
        const country = String(p.countrycode || '').toUpperCase();
        if (!street) continue;
        if (iso && country && country !== iso) continue;
        s = { line1: joinLine(country, street, p.housenumber), postcode: p.postcode || '', city: p.city || p.county || '', region: regionOf(country, p), country };
      }
      s.label = `${s.line1}, ${[s.postcode, s.city].filter(Boolean).join(' ')}`.replace(/,\s*$/, '');
      if (seen.has(s.label)) continue;
      seen.add(s.label);
      out.push(s);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  };

  /** Interroge le service adapté au pays. Renvoie [] au moindre souci : la saisie à la main reste toujours possible. */
  App.fetchSuggestions = async (query, iso, lang, opts = {}) => {
    const q = String(query || '').trim();
    if (q.length < MIN_CHARS) return [];
    const provider = App.addressProvider(iso);
    const doFetch = opts.fetch || root.fetch;
    try {
      const res = await doFetch(App.suggestUrl(provider, q, lang), {
        signal: opts.signal, headers: { Accept: 'application/json' }, referrerPolicy: 'no-referrer', credentials: 'omit',
      });
      if (!res.ok) return [];
      return App.parseSuggestions(provider, await res.json(), { iso });
    } catch (e) {
      return [];
    }
  };
  App.ADDRESS_MIN_CHARS = MIN_CHARS;

  if (typeof module !== 'undefined' && module.exports) module.exports = App;
})(typeof window !== 'undefined' ? window : globalThis);
