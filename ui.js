/* Outils partagés : DOM, stockage local chiffré, dates, CSV, constantes. */
(function () {
  'use strict';
  const App = (window.App = window.App || {});

  /* ---------- DOM ---------- */

  App.$ = (sel, el = document) => el.querySelector(sel);

  /** Construit un nœud. Le texte passe toujours par des nœuds texte, jamais par innerHTML. */
  App.h = function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  let toastTimer;
  App.toast = (msg) => {
    const t = App.$('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  };

  App.copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = App.h('textarea', { class: 'offscreen' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    App.toast('Copié.');
  };

  App.download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = App.h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };

  /* ---------- décor : ornements dorés et carte du golfe d'Ajaccio (SVG inline, recolorés par la feuille de style) ---------- */

  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}, kids = []) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids);
    return e;
  };

  /** Petites icônes : 'camera'. */
  App.icon = (name) => {
    const kids = name === 'camera'
      ? [svgEl('path', { d: 'M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 4h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z' }),
        svgEl('circle', { cx: 12, cy: 13, r: 3.6 })]
      : [];
    return svgEl('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true', focusable: 'false' }, kids);
  };

  /** Petit soleil doré (disque et rayons), signe discret au-dessus du titre. */
  App.ornament = () => {
    const O = App.ORN;
    return svgEl('svg', { 'aria-hidden': 'true', focusable: 'false', viewBox: '0 0 120 44', class: 'orn orn-sun' }, [
      svgEl('path', { d: O.sun.rays }),
      svgEl('circle', { cx: O.sun.disc[0], cy: O.sun.disc[1], r: O.sun.disc[2], class: 'solid' }),
    ]);
  };

  /**
   * Le golfe d'Ajaccio, avec Coti-Chiavari en repère, et la Corse entière en médaillon.
   */
  let mapCount = 0;
  App.mapSvg = () => {
    const G = App.CARTE;
    const C = App.CORSE;
    const id = `terre-${++mapCount}`; // un identifiant par carte : plusieurs peuvent cohabiter sur une page
    const land = (extra) => ({ class: 'isl-land', fill: `url(#${id})`, ...extra });
    const [cx, cy] = G.coti;
    const [ax, ay] = G.ajaccio;
    const [px, py] = G.airport;
    const heart = 'M0 4.5C-9 -1 -6 -9 0 -4.5C6 -9 9 -1 0 4.5Z';
    const seaWaves = [[28, 158], [78, 182], [36, 206], [100, 132], [96, 214]];
    return svgEl('svg', { viewBox: `0 0 ${G.w} ${G.h}`, class: 'landing-map', 'aria-hidden': 'true', focusable: 'false' }, [
      svgEl('defs', {}, [svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, [
        svgEl('stop', { offset: 0, class: 'land-a' }), svgEl('stop', { offset: 0.55, class: 'land-b' }), svgEl('stop', { offset: 1, class: 'land-c' })])]),
      svgEl('rect', { width: G.w, height: G.h, class: 'map-sea' }),
      ...seaWaves.map(([x, y]) => svgEl('path', { d: App.ORN.seaWave, class: 'sea-wave', transform: `translate(${x} ${y})` })),
      svgEl('path', { d: G.land, class: 'isl-foam' }),
      svgEl('path', { d: G.land, ...land() }),
      ...G.islets.map(([x, y, r]) => svgEl('ellipse', { cx: x, cy: y, rx: r, ry: r * 0.7, ...land() })),
      svgEl('path', { d: G.road, class: 'isl-trail' }),
      // aéroport et ville
      svgEl('circle', { cx: px, cy: py, r: 5, class: 'pt' }),
      svgEl('text', { x: px + 9, y: py - 8, class: 'lbl-small' }, ['AJA']),
      svgEl('circle', { cx: ax, cy: ay, r: 6, class: 'pt' }),
      svgEl('text', { x: ax - 4, y: ay + 26, class: 'lbl-city', 'text-anchor': 'end' }, ['Ajaccio']),
      // le mariage
      svgEl('circle', { cx, cy, r: 21, class: 'halo' }),
      svgEl('circle', { cx, cy, r: 12, class: 'disc' }),
      svgEl('path', { d: heart, class: 'heart', transform: `translate(${cx} ${cy + 0.5})` }),
      svgEl('text', { x: cx - 20, y: cy + 6, class: 'lbl-main', 'text-anchor': 'end' }, ['Coti-Chiavari']),
      // la Corse entière, avec la zone en repère
      svgEl('g', { transform: 'translate(14 248)' }, [
        svgEl('circle', { cx: 15, cy: 29, r: 35, class: 'inset-bg' }),
        svgEl('g', { transform: 'translate(2 1.5) scale(0.105)' }, [
          svgEl('path', { d: C.island, class: 'inset-land' }),
          svgEl('circle', { cx: C.here[0], cy: C.here[1], r: 36, class: 'inset-ring' }),
        ]),
      ]),
    ]);
  };

  /** Drapeaux de langue dessinés en SVG : les drapeaux emoji ne s'affichent pas sous Windows. */
  const BANDS = {
    fr: [['#0055a4', 0, 0, 10, 20], ['#ffffff', 10, 0, 10, 20], ['#ef4135', 20, 0, 10, 20]],
    it: [['#009246', 0, 0, 10, 20], ['#ffffff', 10, 0, 10, 20], ['#ce2b37', 20, 0, 10, 20]],
    de: [['#000000', 0, 0, 30, 6.67], ['#dd0000', 0, 6.67, 30, 6.66], ['#ffce00', 0, 13.33, 30, 6.67]],
    es: [['#aa151b', 0, 0, 30, 5], ['#f1bf00', 0, 5, 30, 10], ['#aa151b', 0, 15, 30, 5]],
  };
  App.flagSvg = (code) => {
    const rect = ([fill, x, y, w, h]) => svgEl('rect', { x, y, width: w, height: h, fill });
    const line = (d, stroke, width) => svgEl('path', { d, stroke, 'stroke-width': width, fill: 'none' });
    const kids = code === 'en'
      ? [svgEl('rect', { width: 30, height: 20, fill: '#012169' }),
        line('M0 0L30 20M30 0L0 20', '#ffffff', 4), line('M0 0L30 20M30 0L0 20', '#c8102e', 1.6),
        line('M15 0V20M0 10H30', '#ffffff', 6), line('M15 0V20M0 10H30', '#c8102e', 3.6)]
      : (BANDS[code] || []).map(rect);
    return svgEl('svg', { viewBox: '0 0 30 20', class: 'flag-svg', 'aria-hidden': 'true', focusable: 'false' }, kids);
  };

  /** Titre avec l'esperluette en italique doré : « Luna & Guillaume ». */
  const fancyTitle = (title) => {
    const parts = String(title).split(/\s&\s/);
    const kids = [];
    parts.forEach((p, i) => { if (i) kids.push(' ', App.h('span', { class: 'amp' }, '&'), ' '); kids.push(p); });
    return kids;
  };

  /** Bandeau d'accueil. `big` : couverture centrée de la page invité ; sinon en-tête sobre avec la carte à côté. */
  App.hero = ({ eyebrow, title, lead, extra, big }) =>
    App.h('header', { class: 'landing' + (big ? ' big' : '') },
      App.h('div', { class: 'landing-grid' },
        App.h('div', { class: 'landing-text' },
          big ? App.ornament() : null,
          extra || null,
          eyebrow ? App.h('p', { class: 'eyebrow' }, eyebrow) : null,
          App.h('h1', {}, ...fancyTitle(title)),
          App.h('span', { class: 'rule', 'aria-hidden': 'true' }),
          lead ? App.h('p', { class: 'lead' }, lead) : null),
        App.mapSvg()));

  /** Une seule boîte de dialogue à la fois, retirée de la page dès qu'elle se ferme. */
  App.showDialog = (dlg) => {
    document.querySelectorAll('dialog').forEach((d) => d.remove());
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  };
  App.closeDialog = (dlg) => { dlg.close(); dlg.remove(); };

  /* ---------- Stockage local (IndexedDB) : uniquement du chiffré ou du non sensible ---------- */

  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('mariage-voiture', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta');
      r.result.createObjectStore('env');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));

  const run = (store, mode, fn) => open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  }));

  App.store = {
    get: (s, k) => run(s, 'readonly', (o) => o.get(k)),
    put: (s, k, v) => run(s, 'readwrite', (o) => o.put(v, k)),
    del: (s, k) => run(s, 'readwrite', (o) => o.delete(k)),
    async all(s) {
      const [keys, vals] = await Promise.all([
        run(s, 'readonly', (o) => o.getAllKeys()),
        run(s, 'readonly', (o) => o.getAll()),
      ]);
      return keys.map((key, i) => ({ key, value: vals[i] }));
    },
    async wipe() {
      for (const s of ['meta', 'env']) await run(s, 'readwrite', (o) => o.clear());
    },
  };

  /* ---------- Dates ---------- */

  const p2 = (n) => String(n).padStart(2, '0');

  /** 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:mm' (heure locale) -> Date, ou null. */
  App.dt = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s)) return null;
    const d = new Date(s.length === 10 ? s + 'T00:00' : s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  App.fmtDate = (d) => (d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : '');
  App.fmtDT = (d) => (d ? `${App.fmtDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '');
  App.dayKey = (d) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '');

  /** Années entières écoulées entre `from` (string) et la date `at`. */
  App.yearsBetween = (from, at) => {
    const b = App.dt(from);
    if (!b || !at) return null;
    let y = at.getFullYear() - b.getFullYear();
    const m = at.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && at.getDate() < b.getDate())) y--;
    return y;
  };

  /* ---------- Divers ---------- */

  App.slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  App.dataUrlToBlob = (url) => {
    const [head, b64] = url.split(',');
    const type = (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  };

  /** CSV pour Excel FR : séparateur ;, BOM UTF-8, protection contre l'injection de formules. */
  App.csv = (rows) => {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      const numeric = /^[+-]?[\d\s().-]+$/.test(s);
      if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !numeric)) s = "'" + s;
      return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  };

  /** Nettoie une config venue d'un lien ou d'un fichier : on ne fait confiance à aucun champ. */
  App.normalizeConfig = (c) => ({
    nom: String(c.nom || '').slice(0, 120),
    org: String(c.org || '').slice(0, 80),
    contact: String(c.contact || '').slice(0, 120),
    lieux: (Array.isArray(c.lieux) ? c.lieux : []).map((l) => String(l).trim().slice(0, 100)).filter(Boolean).slice(0, 30),
    photos: ['non', 'scan', 'optionnel', 'requis'].includes(c.photos) ? c.photos : 'scan',
    retention: /^\d{4}-\d{2}-\d{2}$/.test(c.retention || '') ? c.retention : '',
    loueur: String(c.loueur || '').trim().slice(0, 40) || 'Europcar',
    programme: App.normalizeProgramme(c.programme),
    adresseAuto: c.adresseAuto !== false,
    acces: String(c.acces || '').trim().slice(0, 64), // mot de passe d'accès des invités : n'est jamais mis dans le lien en clair
    collecte: App.collecteUrl(c.collecte),            // adresse du service de collecte (publique : dans le lien invités)
    collecteJeton: App.collecteTokenOk(c.collecteJeton) ? String(c.collecteJeton) : '', // jeton de lecture : jamais dans le lien
    langs: (() => {
      const known = ['fr', 'en', 'it', 'de', 'es'];
      const asked = (Array.isArray(c.langs) ? c.langs : []).filter((l, i, a) => known.includes(l) && a.indexOf(l) === i);
      return asked.length ? asked : ['fr'];
    })(),
  });

  /* ---------- Listes ---------- */

  // Noms neutres : ils s'affichent tels quels dans toutes les langues du formulaire.
  App.LIEUX_PAR_DEFAUT = [
    'Ajaccio-Napoléon Bonaparte (AJA)',
    'Ajaccio (port)',
    'Figari-Sud Corse (FSC)',
    'Bastia-Poretta (BIA)',
    'Calvi-Sainte-Catherine (CLY)',
  ];

  App.CATEGORIES = [
    ['citadine', 'Citadine (2 à 4 personnes)'],
    ['eco', 'Économique (4 à 5 personnes)'],
    ['compacte', 'Compacte'],
    ['suv', 'SUV / familiale'],
    ['monospace', 'Monospace 7 places'],
    ['minibus', 'Minibus 9 places'],
    ['cabriolet', 'Cabriolet'],
  ];
  App.categorieLabel = (id) => (App.CATEGORIES.find((c) => c[0] === id) || [, id || ''])[1];

  App.BOITES = [['manuelle', 'Manuelle'], ['auto', 'Automatique'], ['indifferent', 'Peu importe']];
  App.boiteLabel = (id) => (App.BOITES.find((b) => b[0] === id) || [, id || ''])[1];

})();
