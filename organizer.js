/* Côté organisateur : clé, déverrouillage, import des fichiers chiffrés, alertes, regroupement en voitures. */
(function () {
  'use strict';
  const App = window.App;
  const { h, $, store } = App;

  const DEFAULT_SETTINGS = { seuilJeune: 26, seuilPermis: 2, capacite: 5 };
  const AUTO_LOCK_MS = 10 * 60 * 1000;

  const state = (App.state = {
    org: null,            // { publicKey, wrapped, config } : tout ça est public ou enveloppé
    priv: null,           // clé privée (non exportable), uniquement en mémoire
    guests: [],           // dossiers déchiffrés, uniquement en mémoire
    assign: {},           // gk -> { car, principal } : en mémoire, chiffré sur disque (les clés dérivent des noms)
    settings: { ...DEFAULT_SETTINGS },
    prix: { remise: null, prix: {} },  // prix publics saisis par ligne de devis : rien de personnel
    tab: 'invites',
    stage: null,
    filter: '',
    onlyAlerts: false,
    noStorage: false,
  });

  const mem = new Map(); // enveloppes si IndexedDB est indisponible (navigation privée)
  let lockTimer;

  /* ---------- persistance ---------- */

  App.savePrix = () => save('prix', state.prix);
  const save = (k, v) => (state.noStorage ? Promise.resolve() : store.put('meta', k, v).catch(() => { state.noStorage = true; }));
  const envAll = async () => (state.noStorage ? [...mem].map(([key, value]) => ({ key, value })) : store.all('env'));
  const envPut = async (k, v) => { if (state.noStorage) mem.set(k, v); else await store.put('env', k, v); };
  const envDel = async (k) => { if (state.noStorage) mem.delete(k); else await store.del('env', k); };

  async function saveAssign() {
    if (state.noStorage || !state.org) return;
    try {
      await store.put('meta', 'assign', await Vault.encryptFor(state.org.publicKey, state.assign));
    } catch (e) { state.noStorage = true; }
  }

  async function loadAssign() {
    state.assign = {};
    try {
      const env = await store.get('meta', 'assign');
      const data = env && env.app === 'mariage-voiture' ? await Vault.decryptEnvelope(state.priv, state.org.publicKey, env) : null;
      if (data && typeof data === 'object' && !Array.isArray(data)) state.assign = data;
    } catch (e) { /* pas d'affectations enregistrées */ }
  }

  /* ---------- verrouillage ---------- */

  function touch() {
    clearTimeout(lockTimer);
    if (state.priv) lockTimer = setTimeout(lock, AUTO_LOCK_MS);
  }

  function lock() {
    clearTimeout(lockTimer);
    state.priv = null;
    state.guests = [];
    state.assign = {};
    state.stage = null;
    document.querySelectorAll('dialog').forEach((d) => d.remove()); // une fiche ouverte ne doit pas survivre au verrouillage
    render();
  }

  /* ---------- nettoyage des données reçues ---------- */

  const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : '');
  const num = (v, min, max) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  };
  const jpeg = (v) => (typeof v === 'string' && v.length < 4000000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) ? v : '');

  function sanitize(p) {
    if (!p || p.v !== 1) throw new Error('BAD_PAYLOAD');
    const i = p.identite || {}, pe = p.permis || {}, t = p.trajet || {}, v = p.vehicule || {}, pa = p.partage || {};
    return {
      id: str(p.id, 64),
      submittedAt: str(p.submittedAt, 40),
      langue: str(p.langue, 5),
      identite: {
        prenom: str(i.prenom, 80), nom: str(i.nom, 80), naissance: str(i.naissance, 10),
        email: str(i.email, 120), tel: str(i.tel, 40), adresse: str(i.adresse, 200),
        cp: str(i.cp, 12), ville: str(i.ville, 80), region: str(i.region, 40), pays: str(i.pays, 8),
      },
      permis: {
        pays: str(pe.pays, 8), numero: str(pe.numero, 40), delivrance: str(pe.delivrance, 10),
        expiration: str(pe.expiration, 10), recto: jpeg(pe.recto), verso: jpeg(pe.verso),
      },
      trajet: {
        retrait: str(t.retrait, 100), arrivee: str(t.arrivee, 16), vol: str(t.vol, 30),
        restitution: str(t.restitution, 100), retour: str(t.retour, 16),
        passagers: num(t.passagers, 1, 9), bagages: num(t.bagages, 0, 20),
      },
      vehicule: {
        categorie: str(v.categorie, 20), boite: str(v.boite, 20),
        categorieAuto: v.categorieAuto === true, siege: num(v.siege, 0, 4), options: str(v.options, 300),
      },
      partage: { ok: pa.ok === true, avec: str(pa.avec, 200) },
      notes: str(p.notes, 600),
    };
  }

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const guestKey = (p) => [p.identite.nom, p.identite.prenom, p.identite.naissance].map(norm).join('|');
  const fullName = (g) => `${g.identite.prenom} ${g.identite.nom}`.trim() || '(sans nom)';

  /* ---------- alertes ---------- */

  function alertsFor(g) {
    const s = state.settings;
    const out = [];
    const arr = App.dt(g.trajet.arrivee);
    const ret = App.dt(g.trajet.retour);
    const age = App.yearsBetween(g.identite.naissance, arr);
    if (!arr || !ret) out.push({ lvl: 'bad', txt: 'Dates manquantes' });
    else if (ret <= arr) out.push({ lvl: 'bad', txt: 'Retour avant l’arrivée' });
    const prog = state.org.config.programme || [];
    if (prog.length && arr && ret) {
      if (App.dayKey(arr) > prog[0].date) out.push({ lvl: 'warn', txt: 'Arrive après le début du programme' });
      if (App.dayKey(ret) < prog[prog.length - 1].date) out.push({ lvl: 'warn', txt: 'Repart avant la fin du programme' });
    }
    if (age == null) out.push({ lvl: 'bad', txt: 'Naissance manquante' });
    else if (age < 18) out.push({ lvl: 'bad', txt: `Mineur (${age} ans)` });
    else if (age < s.seuilJeune) out.push({ lvl: 'warn', txt: `Jeune conducteur (${age} ans)` });
    const yrs = App.yearsBetween(g.permis.delivrance, arr);
    if (yrs == null) out.push({ lvl: 'bad', txt: 'Date de permis manquante' });
    else if (yrs < s.seuilPermis) out.push({ lvl: 'warn', txt: `Permis de ${yrs} an${yrs > 1 ? 's' : ''}` });
    const exp = App.dt(g.permis.expiration);
    if (exp && ret && exp < ret) out.push({ lvl: 'bad', txt: 'Permis expiré avant le retour' });
    if (g.permis.pays && !App.PERMIS_RECONNUS.has(g.permis.pays)) out.push({ lvl: 'warn', txt: 'Permis hors UE/EEE/CH/UK : à vérifier' });
    if (!g.permis.numero) out.push({ lvl: 'warn', txt: 'N° de permis manquant' });
    if (state.org.config.photos === 'requis' && !(g.permis.recto && g.permis.verso)) {
      out.push({ lvl: 'warn', txt: 'Photos du permis manquantes' });
    }
    return out;
  }
  App.alertsFor = alertsFor;

  /* ---------- voitures ---------- */

  function carsModel() {
    const groups = new Map();
    const solos = [];
    for (const g of state.guests) {
      const label = (state.assign[g.gk] || {}).car;
      if (label) {
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(g);
      } else {
        solos.push({ label: '', members: [g] });
      }
    }
    const raw = [...solos, ...[...groups].map(([label, members]) => ({ label, members }))];
    const cars = raw.map(buildCar);
    cars.sort((a, b) => ((a.retrait || 0) - (b.retrait || 0)) || a.name.localeCompare(b.name));
    cars.forEach((c, i) => { c.code = 'V' + String(i + 1).padStart(2, '0'); });
    return cars;
  }
  App.carsModel = carsModel;

  function buildCar({ label, members }) {
    const arrival = (g) => App.dt(g.trajet.arrivee) || new Date(8640000000000000);
    const flagged = members.find((m) => (state.assign[m.gk] || {}).principal);
    const principal = flagged || [...members].sort((a, b) => arrival(a) - arrival(b))[0];
    const ordered = [principal, ...members.filter((m) => m !== principal)];
    const arrivals = ordered.map((m) => App.dt(m.trajet.arrivee)).filter(Boolean);
    const returns = ordered.map((m) => App.dt(m.trajet.retour)).filter(Boolean);
    const retrait = arrivals.length ? new Date(Math.min(...arrivals)) : null;
    const retour = returns.length ? new Date(Math.max(...returns)) : null;
    const sum = (f) => ordered.reduce((n, m) => n + f(m), 0);
    const warnings = [];
    if (new Set(ordered.map((m) => m.trajet.retrait)).size > 1) warnings.push('Lieux de retrait différents');
    if (new Set(ordered.map((m) => m.trajet.restitution)).size > 1) warnings.push('Lieux de restitution différents');
    if (new Set(arrivals.map(App.dayKey)).size > 1) warnings.push('Jours d’arrivée différents');
    if (new Set(returns.map(App.dayKey)).size > 1) warnings.push('Jours de retour différents');
    if (new Set(ordered.map((m) => m.vehicule.categorie)).size > 1) warnings.push('Catégories différentes');
    if (new Set(ordered.map((m) => m.vehicule.boite)).size > 1) warnings.push('Boîtes différentes');
    const passagers = sum((m) => m.trajet.passagers);
    const bagages = sum((m) => m.trajet.bagages);
    const sieges = sum((m) => m.vehicule.siege);
    let categorie = principal.vehicule.categorie;
    const need = App.recommendCategory(passagers, bagages, sieges);
    if (need.why === 'overflow') {
      warnings.push('Trop de monde ou de bagages pour une voiture : prévoir de scinder');
    } else if (!App.fitsCategory(categorie, passagers, bagages, sieges)) {
      warnings.push(`Catégorie relevée en ${App.categorieLabel(need.id).replace(/ \(.*\)/, '')} (capacité)`);
      categorie = need.id;
    }
    const jeunes = ordered.filter((m) => {
      const a = App.yearsBetween(m.identite.naissance, retrait);
      return a != null && a < state.settings.seuilJeune;
    }).length;
    const recents = ordered.filter((m) => {
      const y = App.yearsBetween(m.permis.delivrance, retrait);
      return y != null && y < state.settings.seuilPermis;
    }).length;
    return {
      label, members: ordered, principal, retrait, retour,
      lieuRetrait: principal.trajet.retrait,
      lieuRetour: principal.trajet.restitution,
      categorie,
      boite: principal.vehicule.boite,
      passagers, bagages, sieges,
      jeunes, recents, warnings,
      name: label ? `Voiture ${label}` : fullName(principal),
    };
  }

  const setAssign = (g, patch) => {
    const next = { ...(state.assign[g.gk] || {}), ...patch };
    if (!next.car) delete state.assign[g.gk]; else state.assign[g.gk] = next;
  };

  async function autoGroup() {
    const cap = state.settings.capacite;
    const buckets = new Map();
    for (const g of state.guests) {
      if (!g.partage.ok || (state.assign[g.gk] || {}).car) continue;
      const k = [g.trajet.retrait, g.trajet.restitution, App.dayKey(App.dt(g.trajet.arrivee)), App.dayKey(App.dt(g.trajet.retour))].join('|');
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(g);
    }
    const used = Object.values(state.assign).map((a) => parseInt(a.car, 10)).filter(Number.isFinite);
    let next = (used.length ? Math.max(...used) : 0) + 1;
    let made = 0;
    for (const list of buckets.values()) {
      list.sort((a, b) => (App.dt(a.trajet.arrivee) || 0) - (App.dt(b.trajet.arrivee) || 0));
      const cars = [];
      for (const g of list) {
        const room = cars.find((c) => c.load + g.trajet.passagers <= cap);
        if (room) { room.members.push(g); room.load += g.trajet.passagers; } else cars.push({ members: [g], load: g.trajet.passagers });
      }
      for (const c of cars) {
        if (c.members.length < 2) continue;
        for (const g of c.members) setAssign(g, { car: String(next) });
        next++; made++;
      }
    }
    await saveAssign();
    App.toast(made ? `${made} voiture(s) regroupée(s).` : 'Rien à regrouper avec ces réglages.');
    render();
  }

  /* ---------- chargement / import ---------- */

  async function loadGuests() {
    const rows = await envAll().catch(() => []);
    const byKey = new Map();
    let bad = 0;
    for (const { key, value } of rows) {
      try {
        const p = sanitize(await Vault.decryptEnvelope(state.priv, state.org.publicKey, value));
        p.gk = guestKey(p);
        const prev = byKey.get(p.gk);
        if (!prev) { p.envKeys = [key]; byKey.set(p.gk, p); }
        else if (p.submittedAt > prev.submittedAt) { p.envKeys = [...prev.envKeys, key]; byKey.set(p.gk, p); }
        else prev.envKeys.push(key);
      } catch (e) { bad++; }
    }
    state.guests = [...byKey.values()];
    state.badEnvelopes = bad;
  }

  async function importFiles(files) {
    const before = new Map(state.guests.map((g) => [g.gk, g.submittedAt]));
    const existing = new Set((await envAll()).map((r) => r.key));
    let dup = 0, bad = 0;
    for (const f of files) {
      try {
        if (f.size > 12e6) throw new Error('TOO_BIG');
        const env = JSON.parse(await f.text());
        await Vault.decryptEnvelope(state.priv, state.org.publicKey, env);
        const key = Vault.toB64u(await crypto.subtle.digest('SHA-256', Vault.fromB64u(env.ct)));
        if (existing.has(key)) { dup++; continue; }
        await envPut(key, { app: env.app, v: env.v, kid: env.kid, epk: env.epk, iv: env.iv, ct: env.ct });
        existing.add(key);
      } catch (e) { bad++; }
    }
    await loadGuests();
    const fresh = state.guests.filter((g) => !before.has(g.gk)).length;
    const updated = state.guests.filter((g) => before.has(g.gk) && before.get(g.gk) !== g.submittedAt).length;
    App.toast(`${fresh} nouveau(x) · ${updated} mis à jour · ${dup} déjà importé(s) · ${bad} illisible(s)`);
    state.tab = 'invites';
    render();
  }

  async function removeGuest(g) {
    for (const k of g.envKeys) await envDel(k);
    delete state.assign[g.gk];
    await saveAssign();
    await loadGuests();
  }

  /* ---------- config & lien ---------- */

  const linkCache = { sig: '', link: '' };

  /** Sans mot de passe : #g=<config>. Avec : #p=<config chiffrée par le mot de passe>. Le mot de passe lui-même n'est jamais dans le lien. */
  async function guestLink(org) {
    const c = org.config;
    const body = { v: 1, pk: org.publicKey, nom: c.nom, org: c.org, contact: c.contact, lieux: c.lieux, photos: c.photos, retention: c.retention, loueur: c.loueur, programme: c.programme, adresseAuto: c.adresseAuto, langs: c.langs };
    const base = location.href.split('#')[0];
    const sig = JSON.stringify([base, body, c.acces]);
    if (linkCache.sig === sig) return linkCache.link; // même lien tant que rien ne change (le chiffrement en produit un nouveau à chaque appel)
    const link = c.acces
      ? base + '#p=' + Vault.packEnvelope(await Vault.sealWithPassword(body, c.acces))
      : base + '#g=' + Vault.toB64u(new TextEncoder().encode(JSON.stringify(body)));
    linkCache.sig = sig;
    linkCache.link = link;
    return link;
  }

  function configForm(cfg) {
    const field = (label, input, hint) =>
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
    const nom = h('input', { type: 'text', required: true, maxlength: 120, value: cfg.nom, placeholder: 'Luna & Guillaume' });
    const org = h('input', { type: 'text', required: true, maxlength: 80, value: cfg.org, placeholder: 'Votre prénom' });
    const contact = h('input', { type: 'text', maxlength: 120, value: cfg.contact, placeholder: 'vous@exemple.fr ou 06 …' });
    const lieux = h('textarea', { rows: 6 });
    lieux.value = cfg.lieux.join('\n');
    const photos = h('select', {}, [['scan', 'Lecture sur le téléphone, photo non conservée (recommandé)'], ['optionnel', 'Lecture, et photos à joindre si l’invité le veut'], ['requis', 'Lecture, et photos obligatoires dans le dossier'], ['non', 'Rien : saisie à la main']]
      .map(([v, l]) => h('option', { value: v }, l)));
    photos.value = cfg.photos;
    const retention = h('input', { type: 'date', value: cfg.retention });
    const adresseAuto = h('input', { type: 'checkbox' });
    adresseAuto.checked = cfg.adresseAuto !== false;
    const programme = h('textarea', { rows: 3, placeholder: '2027-05-30 | Mariage | Jardin de Coti' });
    programme.value = App.programmeText(cfg.programme);
    const loueur = h('input', { type: 'text', maxlength: 40, value: cfg.loueur, placeholder: 'Europcar' });
    const acces = h('input', { type: 'text', maxlength: 64, value: cfg.acces || '', placeholder: 'ABCD-EFGH-JKLM', autocomplete: 'off', 'aria-label': 'Mot de passe d’accès des invités', ...PASS_ATTRS });
    const accesNew = h('button', { type: 'button', class: 'btn', onclick: () => { acces.value = Vault.randomCode(3, 4); acces.setCustomValidity(''); } }, 'Générer');
    const langBoxes = App.LANGS.map(([code, name]) => {
      const cb = h('input', { type: 'checkbox', value: code });
      cb.checked = cfg.langs.includes(code);
      return { cb, el: h('label', { class: 'check inline' }, cb, h('span', {}, name)) };
    });
    const nodes = [
      field('Nom de l’événement', nom, 'Affiché en haut du formulaire.'),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Mot de passe des invités'),
        h('div', { class: 'row access' }, acces, accesNew),
        h('span', { class: 'hint' }, 'À communiquer aux participants avec le lien. Sans lui, le lien n’ouvre qu’une page vide : l’événement et votre clé publique n’y sont lisibles qu’avec ce mot de passe. Casse, espaces et tirets sans importance. Laissez vide pour un lien ouvert.')),
      h('div', { class: 'grid2' },
        field('Votre nom', org),
        field('Comment vous joindre', contact, 'Les invités y renvoient leur fichier.')),
      field('Programme', programme, 'Une ligne par rendez-vous : date (AAAA-MM-JJ) | titre | lieu. Affiché aux invités dans leur langue ; sert aussi à proposer l’arrivée (la veille du premier) et le retour (le lendemain du dernier). Le titre peut être bilingue, comme sur le faire-part.'),
      field('Lieux de retrait / restitution proposés', lieux, 'Un par ligne. À vérifier avec l’agence : toutes ne sont pas ouvertes en Corse, ni tous les jours.'),
      h('div', { class: 'grid2' },
        field('Scan du permis', photos, 'La lecture se fait sur le téléphone de l’invité et remplit numéro et dates, qu’il vérifie. Un devis n’a pas besoin des photos : moins vous en gardez, moins vous en risquez.'),
        field('Supprimer les données après le', retention, 'Rappel affiché aux invités et à vous.')),
      field('Loueur', loueur, 'Nom affiché aux invités.'),
      h('label', { class: 'check' }, adresseAuto, h('span', {},
        h('strong', {}, 'Recherche d’adresse intelligente. '),
        'L’invité voit des suggestions pendant qu’il tape. Ce qu’il écrit dans le champ adresse (et seulement lui) est envoyé à la Géoplateforme (IGN) pour la France, à Photon (OpenStreetMap) ailleurs. Décochez pour que rien ne quitte la page.')),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Langues du formulaire invité'),
        h('div', { class: 'row' }, langBoxes.map((l) => l.el)),
        h('span', { class: 'hint' }, 'Avec plusieurs langues, l’invité choisit la sienne en arrivant. Les menus de pays et les indications du permis suivent la langue et le pays.')),
    ];
    const read = () => {
      const prog = App.parseProgramme(programme.value);
      programme.setCustomValidity(prog.errors.length
        ? `Ligne${prog.errors.length > 1 ? 's' : ''} ${prog.errors.join(', ')} : le format attendu est AAAA-MM-JJ | titre | lieu.` : '');
      acces.setCustomValidity(acces.value.trim() && Vault.accessSecret(acces.value).length < 6 ? 'Au moins 6 caractères (hors espaces et tirets).' : '');
      if (![nom, org, acces, programme].every((i) => i.reportValidity())) return null;
      const seen = new Set();
      const list = lieux.value.split('\n').map((l) => l.trim()).filter((l) => l && !seen.has(l) && seen.add(l));
      return App.normalizeConfig({
        nom: nom.value, org: org.value, contact: contact.value, lieux: list, photos: photos.value, retention: retention.value,
        loueur: loueur.value, programme: prog.entries, adresseAuto: adresseAuto.checked, acces: acces.value, langs: langBoxes.filter((l) => l.cb.checked).map((l) => l.cb.value),
      });
    };
    return { nodes, read };
  }

  /* ---------- vues : création, sauvegarde, verrouillage ---------- */

  function shell(...kids) {
    return h('div', { class: 'wrap narrow' }, ...kids);
  }

  /** Case « Afficher » : bascule un ou plusieurs champs de phrase de passe entre points et texte clair. */
  const PASS_ATTRS = { spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }; // pas de correction automatique sur une phrase de passe
  function revealToggle(...inputs) {
    const cb = h('input', { type: 'checkbox', onchange: () => inputs.forEach((i) => { i.type = cb.checked ? 'text' : 'password'; }) });
    return h('label', { class: 'check inline reveal' }, cb, h('span', {}, 'Afficher la phrase de passe'));
  }

  function viewSetup() {
    const form = configForm({
      nom: '', org: '', contact: '', lieux: App.LIEUX_PAR_DEFAUT, photos: 'scan', retention: '',
      programme: App.normalizeProgramme([
        { date: '2027-05-30', titre: 'Mariage · Wedding', lieu: 'Jardin de Coti' },
        { date: '2027-05-31', titre: 'Journée plage · Beach party', lieu: 'Mare E Sole' },
      ]),
      loueur: 'Europcar', adresseAuto: true, acces: Vault.randomCode(3, 4), langs: ['fr', 'en', 'it', 'de', 'es'],
    });
    const pass1 = h('input', { type: 'password', required: true, autocomplete: 'new-password', minlength: 14, ...PASS_ATTRS });
    const pass2 = h('input', { type: 'password', required: true, autocomplete: 'new-password', ...PASS_ATTRS });
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const btn = h('button', { type: 'submit', class: 'btn primary big' }, 'Créer ma clé et le lien invités');
    const fail = (m) => { err.textContent = m; err.hidden = false; };

    const el = h('form', { novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const cfg = form.read();
      if (!cfg) return;
      const problem = Vault.passphraseProblem(pass1.value);
      if (problem) return fail(problem);
      if (pass1.value !== pass2.value) return fail('Les deux phrases ne sont pas identiques.');
      btn.disabled = true;
      btn.textContent = 'Création de la clé…';
      await new Promise((r) => setTimeout(r, 40));
      try {
        const { publicKey, wrapped } = await Vault.createOrganizerKey(pass1.value);
        const org = { app: 'mariage-voiture-cle', v: 1, publicKey, wrapped, config: cfg, createdAt: new Date().toISOString() };
        state.org = org;
        await save('org', org);
        state.priv = await Vault.unlockOrganizerKey(org, pass1.value);
        pass1.value = pass2.value = '';
        state.guests = [];
        state.assign = {};
        state.stage = 'backup';
        state.backedUp = false;
        touch();
        render();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Créer ma clé et le lien invités';
        fail('Impossible de créer la clé dans ce navigateur (il faut une page en HTTPS ou localhost).');
      }
    } },
      h('fieldset', {}, h('legend', {}, 'L’événement'), form.nodes),
      h('fieldset', {}, h('legend', {}, 'Votre phrase de passe'),
        h('p', { class: 'note' }, 'Elle protège la clé qui ouvre les dossiers. Personne ne peut la retrouver pour vous : si vous la perdez, les dossiers sont perdus. Quatre mots au hasard, c’est bien.'),
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Phrase de passe'), pass1),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Encore une fois'), pass2)),
        revealToggle(pass1, pass2),
        err, btn));

    return shell(
      App.hero({
        big: true, eyebrow: 'Organisateur', title: 'Voitures du mariage',
        lead: 'Recueillez les permis et les trajets de vos invités sans que rien ne circule en clair, puis préparez la demande pour le loueur.',
      }),
      state.noStorage ? h('p', { class: 'callout warn' }, 'Ce navigateur bloque le stockage local (navigation privée ?). Vous pourrez travailler, mais tout sera perdu à la fermeture de l’onglet.') : null,
      el,
      importKeyBlock(),
      h('p', { class: 'note' }, 'Vous êtes invité ? Ouvrez le lien que l’organisateur vous a envoyé, pas cette page.'));
  }

  function importKeyBlock() {
    const input = h('input', { type: 'file', accept: '.json,application/json', class: 'offscreen', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const k = JSON.parse(await f.text());
        const w = k.wrapped || {};
        if (k.app !== 'mariage-voiture-cle' || k.v !== 1 || Vault.fromB64u(k.publicKey).length !== 65 ||
            !['salt', 'iv', 'ct'].every((x) => typeof w[x] === 'string') || !Number.isInteger(w.iter)) throw new Error('BAD');
        state.org = { app: k.app, v: 1, publicKey: k.publicKey, wrapped: { v: 1, kdf: w.kdf, iter: w.iter, salt: w.salt, iv: w.iv, ct: w.ct },
          config: App.normalizeConfig(k.config || {}), createdAt: String(k.createdAt || '') };
        await save('org', state.org);
        state.priv = null;
        render();
      } catch (err) {
        App.toast('Ce fichier n’est pas un fichier de clé valide.');
      }
    } });
    return h('p', { class: 'note' }, 'Vous avez déjà un fichier de clé ? ',
      h('label', { class: 'linklike' }, 'Le charger', input));
  }

  function downloadKeyFile() {
    App.download(new Blob([JSON.stringify(state.org, null, 2)], { type: 'application/json' }), 'cle-organisateur-mariage.json');
  }

  function viewBackup() {
    const next = h('button', { class: 'btn primary big', disabled: !state.backedUp, onclick: () => {
      state.stage = null; state.tab = 'parametres'; render();
    } }, 'Continuer');
    return shell(
      App.hero({
        eyebrow: 'Étape importante', title: 'Gardez votre fichier de clé',
        lead: 'Il contient votre clé, verrouillée par votre phrase de passe. Sans lui (ou sans ce navigateur), impossible de rouvrir les dossiers reçus.',
      }),
      h('ul', { class: 'checklist' },
        h('li', {}, 'Rangez-le dans un endroit à vous : gestionnaire de mots de passe, clé USB, coffre en ligne.'),
        h('li', {}, 'Ne l’envoyez à personne. Il est protégé, mais autant qu’il reste privé.'),
        h('li', {}, 'Notez votre phrase de passe ailleurs que dans ce fichier.')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { downloadKeyFile(); state.backedUp = true; next.disabled = false; } }, 'Télécharger mon fichier de clé'),
        next));
  }

  function viewLock() {
    const pass = h('input', { type: 'password', required: true, autocomplete: 'current-password', ...PASS_ATTRS });
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const btn = h('button', { type: 'submit', class: 'btn primary big' }, 'Déverrouiller');
    const form = h('form', { onsubmit: async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Vérification…';
      await new Promise((r) => setTimeout(r, 40));
      try {
        state.priv = await Vault.unlockOrganizerKey(state.org, pass.value);
        pass.value = '';
        await loadAssign();
        await loadGuests();
        touch();
        render();
      } catch (e) {
        err.textContent = e.message === 'BAD_PASSPHRASE' ? 'Phrase de passe incorrecte.' : 'Fichier de clé invalide.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Déverrouiller';
        pass.select();
      }
    } },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Phrase de passe'), pass),
      revealToggle(pass),
      err, btn);
    return shell(
      App.hero({ eyebrow: 'Verrouillé', title: state.org.config.nom || 'Voitures du mariage' }),
      form,
      importKeyBlock(),
      h('p', {}, h('button', { class: 'btn ghost small danger', onclick: wipeAll }, 'Tout effacer de ce navigateur')));
  }

  async function wipeAll() {
    if (!confirm('Effacer la clé et tous les dossiers de ce navigateur ? Sans votre fichier de clé, c’est définitif.')) return;
    try { await store.wipe(); } catch (e) { /* rien à effacer */ }
    mem.clear();
    Object.assign(state, { org: null, priv: null, guests: [], assign: {}, prix: { remise: null, prix: {} }, stage: null });
    render();
    App.toast('Tout est effacé.');
  }

  /* ---------- tableau de bord ---------- */

  function viewDashboard() {
    const cfg = state.org.config;
    const blocking = state.guests.filter((g) => alertsFor(g).some((a) => a.lvl === 'bad')).length;
    const tabs = [['invites', 'Invités'], ['voitures', 'Voitures'], ['export', 'Export'], ['parametres', 'Réglages']];
    const expired = cfg.retention && new Date() > new Date(cfg.retention + 'T23:59:59');
    return h('div', { class: 'wrap' },
      h('header', { class: 'top' },
        h('div', { class: 'brand' },
          h('img', { class: 'mark', src: 'icone.svg', alt: '' }),
          h('div', {},
          h('h1', {}, cfg.nom),
          h('p', { class: 'muted' }, `${state.guests.length} dossier${state.guests.length > 1 ? 's' : ''}`,
            blocking ? ` · ${blocking} à corriger` : '',
            state.badEnvelopes ? ` · ${state.badEnvelopes} fichier(s) illisible(s)` : ''))),
        h('button', { class: 'btn ghost', onclick: lock }, 'Verrouiller')),
      expired ? h('p', { class: 'callout warn' }, `La date de suppression (${App.fmtDate(App.dt(cfg.retention))}) est passée. `,
        h('button', { class: 'btn small danger', onclick: wipeAll }, 'Tout effacer')) : null,
      state.noStorage ? h('p', { class: 'callout warn' }, 'Stockage local indisponible : fermer l’onglet efface tout. Gardez les fichiers reçus.') : null,
      h('nav', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) =>
        h('button', { role: 'tab', 'aria-selected': String(state.tab === id), class: state.tab === id ? 'on' : '',
          onclick: () => { state.tab = id; render(); } }, label))),
      h('section', {},
        state.tab === 'invites' ? tabInvites()
          : state.tab === 'voitures' ? tabVoitures()
          : state.tab === 'export' ? App.viewExport()
          : tabReglages()));
  }

  const badge = (a) => h('span', { class: 'badge ' + a.lvl }, a.txt);

  function tabInvites() {
    const fileInput = h('input', { type: 'file', multiple: true, class: 'offscreen', accept: '.txt,.json,text/plain,application/json',
      onchange: (e) => importFiles([...e.target.files]) });
    const drop = h('div', { class: 'drop',
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); importFiles([...e.dataTransfer.files]); } },
      h('label', { class: 'btn primary' }, 'Importer les fichiers reçus', fileInput),
      h('span', { class: 'muted' }, ' ou déposez-les ici. Les doublons sont ignorés, un nouvel envoi du même invité remplace l’ancien.'));

    const search = h('input', { type: 'search', placeholder: 'Rechercher…', 'aria-label': 'Rechercher', value: state.filter,
      oninput: (e) => { state.filter = e.target.value; fill(); } });
    const only = h('input', { type: 'checkbox', onchange: (e) => { state.onlyAlerts = e.target.checked; fill(); } });
    only.checked = state.onlyAlerts;

    const tbody = h('tbody');
    const carCode = new Map();
    for (const c of carsModel()) for (const m of c.members) carCode.set(m.gk, c);

    function fill() {
      const q = norm(state.filter);
      const rows = state.guests
        .filter((g) => !q || norm(fullName(g) + g.trajet.retrait + g.identite.email).includes(q))
        .filter((g) => !state.onlyAlerts || alertsFor(g).length)
        .sort((a, b) => (App.dt(a.trajet.arrivee) || 0) - (App.dt(b.trajet.arrivee) || 0));
      tbody.replaceChildren(...rows.map((g) => {
        const arr = App.dt(g.trajet.arrivee);
        const al = alertsFor(g);
        const label = (state.assign[g.gk] || {}).car || '';
        const carInput = h('input', { class: 'car', value: label, maxlength: 6, 'aria-label': `Voiture de ${fullName(g)}`, placeholder: '—',
          onchange: async (e) => { setAssign(g, { car: e.target.value.trim(), principal: false }); await saveAssign(); render(); } });
        return h('tr', {},
          h('td', {}, h('button', { class: 'link', onclick: () => openDetail(g) }, fullName(g))),
          h('td', {}, App.yearsBetween(g.identite.naissance, arr) ?? '?'),
          h('td', {}, g.trajet.retrait, h('br'), h('span', { class: 'muted' }, App.fmtDT(arr))),
          h('td', {}, App.fmtDT(App.dt(g.trajet.retour))),
          h('td', {}, g.trajet.passagers),
          h('td', {}, App.categorieLabel(g.vehicule.categorie).replace(/ \(.*\)/, ''), g.partage.ok ? h('span', { class: 'badge ok' }, 'partage') : null),
          h('td', {}, al.map(badge)),
          h('td', {}, carInput, carCode.has(g.gk) ? h('span', { class: 'muted code' }, carCode.get(g.gk).code) : null));
      }));
      if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 8, class: 'empty' },
        state.guests.length ? 'Aucun résultat.' : 'Aucun dossier pour l’instant. Importez les fichiers que vos invités vous envoient.')));
    }
    fill();

    return h('div', {}, drop,
      h('div', { class: 'toolbar' }, search, h('label', { class: 'check inline' }, only, h('span', {}, 'Seulement ceux avec une alerte'))),
      h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Invité', 'Âge', 'Retrait', 'Retour', 'Pers.', 'Catégorie', 'Alertes', 'Voiture'].map((t) => h('th', {}, t)))),
        tbody)));
  }

  function openDetail(g) {
    const dlg = h('dialog', { class: 'detail' });
    const dl = h('dl', {});
    const add = (k, v) => { if (v) dl.append(h('dt', {}, k), h('dd', {}, v)); };
    const i = g.identite, p = g.permis, t = g.trajet, v = g.vehicule;
    add('Naissance', App.fmtDate(App.dt(i.naissance)));
    add('E-mail', i.email);
    add('Téléphone', i.tel);
    add('Adresse', [i.adresse, [i.cp, i.ville, i.region].filter(Boolean).join(' '), App.paysLabel(i.pays)].filter(Boolean).join(', '));
    add('Langue', g.langue ? App.langName(g.langue) : '');
    add('Permis', `${App.paysLabel(p.pays)} · n° ${p.numero || '?'}`);
    add('Obtenu le', App.fmtDate(App.dt(p.delivrance)));
    add('Expire le', App.fmtDate(App.dt(p.expiration)));
    add('Retrait', `${t.retrait} · ${App.fmtDT(App.dt(t.arrivee))}`);
    add('Vol / ferry', t.vol);
    add('Retour', `${t.restitution} · ${App.fmtDT(App.dt(t.retour))}`);
    add('Voyageurs', `${t.passagers} personne(s), ${t.bagages} valise(s), ${v.siege} siège(s) enfant`);
    add('Voiture', `${App.categorieLabel(v.categorie)}${v.categorieAuto ? ' (suggérée par l’outil)' : ''} · ${App.boiteLabel(v.boite)}`);
    add('À signaler', v.options);
    add('Partage', g.partage.ok ? (g.partage.avec ? `Oui, avec ${g.partage.avec}` : 'Oui') : '');
    add('Message', g.notes);
    add('Envoyé le', g.submittedAt ? App.fmtDT(new Date(g.submittedAt)) : '');
    const photos = [['Recto', p.recto], ['Verso', p.verso]].filter(([, src]) => src);
    dlg.append(
      h('h2', {}, fullName(g)),
      h('div', {}, alertsFor(g).map(badge)),
      dl,
      photos.length ? h('div', { class: 'photos' }, photos.map(([l, src]) => h('figure', {}, h('img', { src, alt: `Permis ${l.toLowerCase()}` }), h('figcaption', {}, l)))) : '',
      h('div', { class: 'actions' },
        h('button', { class: 'btn danger', onclick: async () => {
          if (!confirm(`Supprimer définitivement le dossier de ${fullName(g)} ?`)) return;
          App.closeDialog(dlg); await removeGuest(g); render();
        } }, 'Supprimer ce dossier'),
        h('button', { class: 'btn', onclick: () => App.closeDialog(dlg) }, 'Fermer')));
    App.showDialog(dlg);
  }

  function tabVoitures() {
    const cars = carsModel();
    const cap = h('input', { type: 'number', min: 2, max: 9, value: state.settings.capacite, 'aria-label': 'Places par voiture', class: 'num',
      onchange: async (e) => { state.settings.capacite = num(e.target.value, 2, 9); await save('settings', state.settings); } });
    return h('div', {},
      h('p', { class: 'note' }, 'Chaque invité a sa voiture, sauf si vous les regroupez. Le loueur facture par véhicule : regrouper fait baisser la note.'),
      h('div', { class: 'toolbar' },
        h('label', { class: 'check inline' }, h('span', {}, 'Places par voiture'), cap),
        h('button', { class: 'btn', onclick: autoGroup }, 'Regrouper ceux qui acceptent de partager'),
        h('button', { class: 'btn ghost', onclick: async () => {
          if (!confirm('Défaire tous les regroupements ?')) return;
          state.assign = {}; await saveAssign(); render();
        } }, 'Tout dégrouper')),
      cars.length ? cars.map(carCard) : h('p', { class: 'empty' }, 'Aucun dossier pour l’instant.'));
  }

  function carCard(c) {
    const meta = [
      `${App.fmtDT(c.retrait)} → ${App.fmtDT(c.retour)}`,
      c.lieuRetrait === c.lieuRetour ? c.lieuRetrait : `${c.lieuRetrait} → ${c.lieuRetour}`,
      `${App.categorieLabel(c.categorie).replace(/ \(.*\)/, '')}, ${App.boiteLabel(c.boite).toLowerCase()}`,
      `${c.passagers} pers.`,
    ];
    return h('article', { class: 'card' },
      h('header', {}, h('strong', {}, `${c.code} · ${c.name}`), c.members.length > 1 ? h('span', { class: 'muted' }, ` ${c.members.length} conducteurs`) : null),
      h('p', { class: 'muted' }, meta.join(' · ')),
      c.warnings.length ? h('p', {}, c.warnings.map((w) => badge({ lvl: 'warn', txt: w }))) : null,
      h('ul', { class: 'members' }, c.members.map((m, idx) => h('li', {},
        c.members.length > 1 ? h('button', { class: 'star' + (idx === 0 ? ' on' : ''), title: 'Conducteur principal (titulaire de la carte bancaire)',
          'aria-pressed': String(idx === 0), onclick: async () => {
            for (const o of c.members) setAssign(o, { principal: o === m });
            await saveAssign();
            render();
          } }, '★') : null,
        h('button', { class: 'link', onclick: () => openDetail(m) }, fullName(m)),
        alertsFor(m).map(badge),
        c.members.length > 1 ? h('button', { class: 'btn ghost small', onclick: async () => { setAssign(m, { car: '', principal: false }); await saveAssign(); render(); } }, 'Sortir') : null))));
  }

  function tabReglages() {
    const org = state.org;
    const linkBox = h('input', { type: 'text', readonly: true, value: '…', 'aria-label': 'Lien à envoyer aux invités', onfocus: (e) => e.target.select() });
    const copyLink = h('button', { class: 'btn', disabled: true, onclick: () => App.copy(linkBox.value) }, 'Copier');
    guestLink(org).then((link) => { linkBox.value = link; copyLink.disabled = false; })
      .catch(() => { linkBox.value = ''; App.toast('Le lien n’a pas pu être fabriqué : rechargez la page.'); });
    const fp = h('code', { class: 'fp' }, '…');
    Vault.fingerprint(org.publicKey).then((f) => { fp.textContent = f; });
    const s = state.settings;
    const numInput = (key, min, max) => h('input', { type: 'number', class: 'num', min, max, value: s[key],
      onchange: async (e) => { s[key] = num(e.target.value, min, max); await save('settings', s); } });
    const cfgForm = configForm(org.config);

    return h('div', {},
      h('section', { class: 'card' },
        h('h2', {}, 'Lien à envoyer aux invités'),
        location.protocol === 'file:' ? h('p', { class: 'callout warn' }, 'Cette page est ouverte depuis un fichier : le lien ne fonctionnera pas chez vos invités. Mettez le dossier de l’outil en ligne (voir LISEZMOI) puis rouvrez-le depuis son adresse.') : null,
        h('div', { class: 'row' }, linkBox, copyLink),
        org.config.acces
          ? h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Mot de passe à communiquer avec le lien'),
            h('div', { class: 'row' }, h('code', { class: 'secret' }, org.config.acces), h('button', { class: 'btn', onclick: () => App.copy(org.config.acces) }, 'Copier')),
            h('span', { class: 'hint' }, 'Mieux vaut l’envoyer dans un second message, ou par un autre canal que le lien. Modifiable dans « Événement » ci-dessous : vous obtenez alors un nouveau lien à renvoyer (l’ancien continue d’ouvrir le formulaire pour ceux qui l’ont).'))
          : h('p', { class: 'callout warn' }, 'Aucun mot de passe : toute personne qui reçoit ce lien peut ouvrir le formulaire. Ajoutez-en un dans « Événement » ci-dessous.'),
        h('p', { class: 'note' }, 'Tout est dans le lien, après le #. Cette partie n’est jamais envoyée au serveur qui héberge la page' + (org.config.acces ? ', et elle est chiffrée par le mot de passe.' : '.')),
        h('p', {}, 'Empreinte de votre clé : ', fp),
        h('p', { class: 'note' }, 'Écrivez-la dans votre message d’invitation. Un invité qui voit une autre empreinte sur son formulaire a reçu un lien modifié : qu’il vous prévienne.')),
      h('section', { class: 'card' },
        h('h2', {}, 'Seuils d’alerte'),
        h('p', { class: 'note' }, 'Les conditions varient selon l’agence et la catégorie de voiture : confirmez-les avec Europcar, puis ajustez ici.'),
        h('div', { class: 'row' },
          h('label', { class: 'check inline' }, h('span', {}, 'Jeune conducteur : moins de'), numInput('seuilJeune', 18, 30), h('span', {}, 'ans')),
          h('label', { class: 'check inline' }, h('span', {}, 'Permis récent : moins de'), numInput('seuilPermis', 0, 10), h('span', {}, 'ans')))),
      h('section', { class: 'card' },
        h('h2', {}, 'Événement'),
        h('form', { novalidate: true, onsubmit: async (ev) => {
          ev.preventDefault();
          const cfg = cfgForm.read();
          if (!cfg) return;
          state.org = { ...org, config: cfg };
          await save('org', state.org);
          App.toast((cfg.acces || '') !== (org.config.acces || '') ? 'Enregistré. Le lien et le mot de passe ont changé : renvoyez-les.' : 'Enregistré. Le lien invités a changé : renvoyez-le.');
          render();
        } }, cfgForm.nodes, h('button', { type: 'submit', class: 'btn primary' }, 'Enregistrer'))),
      h('section', { class: 'card' },
        h('h2', {}, 'Sécurité'),
        h('ul', { class: 'checklist' },
          h('li', {}, 'Les dossiers sont chiffrés dans le navigateur de chaque invité avec votre clé publique. Messagerie, hébergeur et réseau ne voient que du chiffré.'),
          h('li', {}, 'Ici, les dossiers sont déchiffrés en mémoire seulement. Sur disque, il n’y a que les fichiers chiffrés. L’outil se verrouille seul après 10 minutes sans activité.')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: downloadKeyFile }, 'Télécharger à nouveau mon fichier de clé'),
          h('button', { class: 'btn danger', onclick: wipeAll }, 'Tout effacer de ce navigateur'))));
  }

  /* ---------- rendu ---------- */

  let lastView;
  function render() {
    const root = $('#app');
    let name, view;
    if (!state.org) { name = 'setup'; view = viewSetup(); }
    else if (!state.priv) { name = 'lock'; view = viewLock(); }
    else if (state.stage === 'backup') { name = 'backup'; view = viewBackup(); }
    else { name = 'dash:' + state.tab; view = viewDashboard(); }
    const y = window.scrollY;
    root.replaceChildren(view);
    window.scrollTo(0, name === lastView ? y : 0); // on garde la position quand on modifie une voiture
    lastView = name;
  }

  App.bootOrganizer = async function () {
    try {
      state.org = (await store.get('meta', 'org')) || null;
      state.settings = { ...DEFAULT_SETTINGS, ...((await store.get('meta', 'settings')) || {}) };
      state.prix = { remise: null, prix: {}, ...((await store.get('meta', 'prix')) || {}) };
    } catch (e) {
      state.noStorage = true;
    }
    ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, touch, true));
    render();
  };
})();
