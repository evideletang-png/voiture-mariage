/* Exports pour le loueur :
 *   1. une demande de devis SANS donnée personnelle (partageable par e-mail ordinaire) ;
 *   2. un dossier nominatif dans un ZIP chiffré AES-256, mot de passe à envoyer par un autre canal.
 */
(function () {
  'use strict';
  const App = window.App;
  const { h } = App;

  const short = (id) => App.categorieLabel(id).replace(/ \(.*\)/, '');
  const hhmm = (d) => (d ? App.fmtDT(d).slice(11) : '');

  /** Regroupe les voitures identiques (même catégorie, mêmes lieux, mêmes jours). */
  function quoteLines(cars) {
    const map = new Map();
    for (const c of cars) {
      const k = App.lineKey(c);
      const e = map.get(k) || { key: k, n: 0, car: c, from: c.retrait, to: c.retour, drivers: 0, jeunes: 0, recents: 0, pers: 0, bagages: 0, sieges: 0 };
      e.n++;
      if (c.retrait && (!e.from || c.retrait < e.from)) e.from = c.retrait;
      if (c.retour && (!e.to || c.retour > e.to)) e.to = c.retour;
      e.drivers += c.members.length;
      e.jeunes += c.jeunes;
      e.recents += c.recents;
      e.pers += c.passagers;
      e.bagages += c.bagages;
      e.sieges += c.sieges;
      map.set(k, e);
    }
    return [...map.values()].sort((a, b) => (a.from || 0) - (b.from || 0));
  }

  function quoteText(cars) {
    const { org } = App.state;
    const s = App.state.settings;
    const lines = quoteLines(cars);
    const drivers = cars.reduce((n, c) => n + c.members.length, 0);
    const jeunes = cars.reduce((n, c) => n + c.jeunes, 0);
    const recents = cars.reduce((n, c) => n + c.recents, 0);
    const out = [
      'Bonjour,', '',
      `J’organise un mariage en Corse (${org.config.nom}) et je souhaite un devis pour ${cars.length} véhicule${cars.length > 1 ? 's' : ''}, en réservation groupée :`, '',
      ...lines.map((l) => `• ${l.n} × ${short(l.car.categorie)}, boîte ${App.boiteLabel(l.car.boite).toLowerCase()} – retrait ${l.car.lieuRetrait} le ${App.fmtDate(l.from)} dès ${hhmm(l.from)}, restitution ${l.car.lieuRetour} le ${App.fmtDate(l.to)} avant ${hhmm(l.to)}`),
      '',
      `Conducteurs : ${drivers}` +
        (jeunes ? `, dont ${jeunes} de moins de ${s.seuilJeune} ans` : '') +
        (recents ? `, dont ${recents} avec moins de ${s.seuilPermis} ans de permis` : '') + '.',
      '',
      'Pouvez-vous m’indiquer, pour chaque ligne : le tarif, la caution, le kilométrage inclus, les frais de conducteur jeune et de conducteur additionnel, les conditions d’annulation, ainsi que toute remise possible pour une réservation groupée ? Je vous transmettrai l’identité des conducteurs séparément, de façon sécurisée, une fois le devis accepté.',
      '', 'Cordialement,', [org.config.org, org.config.contact].filter(Boolean).join(' – '),
    ];
    return out.join('\n');
  }

  function quoteCsv(cars) {
    const rows = [['Nb véhicules', 'Catégorie', 'Boîte', 'Retrait – lieu', 'Retrait – date', 'Retrait – dès', 'Restitution – lieu',
      'Restitution – date', 'Restitution – avant', 'Conducteurs', 'Conducteurs jeunes', 'Permis récents', 'Personnes', 'Valises', 'Sièges enfant']];
    for (const l of quoteLines(cars)) {
      rows.push([l.n, short(l.car.categorie), App.boiteLabel(l.car.boite), l.car.lieuRetrait, App.fmtDate(l.from), hhmm(l.from),
        l.car.lieuRetour, App.fmtDate(l.to), hhmm(l.to), l.drivers, l.jeunes, l.recents, l.pers, l.bagages, l.sieges]);
    }
    return App.csv(rows);
  }

  function dossierCsv(cars, opts) {
    const head = ['Voiture', 'Rôle', 'Nom', 'Prénom', 'Naissance'];
    if (opts.contact) head.push('E-mail', 'Téléphone', 'Langue', 'Adresse', 'Code postal', 'Ville', 'Région', 'Pays');
    if (opts.permis) head.push('Permis – pays', 'Permis – numéro', 'Permis – obtenu le', 'Permis – expire le');
    head.push('Retrait – lieu', 'Retrait – date/heure', 'N° vol/ferry', 'Restitution – lieu', 'Restitution – date/heure',
      'Catégorie', 'Boîte', 'Personnes', 'Valises', 'Sièges enfant', 'À signaler');
    const rows = [head];
    for (const c of cars) {
      c.members.forEach((m, idx) => {
        const i = m.identite, p = m.permis;
        const row = [c.code, idx === 0 ? 'Principal' : 'Additionnel', i.nom, i.prenom, App.fmtDate(App.dt(i.naissance))];
        if (opts.contact) row.push(i.email, i.tel, m.langue ? App.langName(m.langue) : '', i.adresse, i.cp, i.ville, i.region, App.paysLabel(i.pays));
        if (opts.permis) row.push(App.paysLabel(p.pays), p.numero, App.fmtDate(App.dt(p.delivrance)), App.fmtDate(App.dt(p.expiration)));
        row.push(c.lieuRetrait, App.fmtDT(c.retrait), m.trajet.vol, c.lieuRetour, App.fmtDT(c.retour),
          short(c.categorie), App.boiteLabel(c.boite), idx === 0 ? c.passagers : '', idx === 0 ? c.bagages : '', idx === 0 ? c.sieges : '', m.vehicule.options);
        rows.push(row);
      });
    }
    return App.csv(rows);
  }

  async function loadZip() {
    if (window.zip) return window.zip;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/zip-no-worker.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('NO_ZIP'));
      document.head.append(s);
    });
    return window.zip;
  }

  async function buildDossier(cars, opts) {
    const zip = await loadZip();
    zip.configure({ useWebWorkers: false });
    const password = Vault.randomCode();
    const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'), { password, encryptionStrength: 3, zipCrypto: false });
    await writer.add('reservations.csv', new zip.TextReader(dossierCsv(cars, opts)));
    let photos = 0;
    if (opts.photos) {
      for (const c of cars) {
        for (const m of c.members) {
          for (const [side, src] of [['recto', m.permis.recto], ['verso', m.permis.verso]]) {
            if (!src) continue;
            const name = `permis/${c.code}-${App.slug(m.identite.nom).toUpperCase()}-${App.slug(m.identite.prenom)}-${side}.jpg`;
            await writer.add(name, new zip.BlobReader(App.dataUrlToBlob(src)));
            photos++;
          }
        }
      }
    }
    return { blob: await writer.close(), password, photos };
  }

  /* ---------- estimation tarifaire ---------- */

  const eur = (n) => new Intl.NumberFormat('fr', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const fullName = (m) => `${m.identite.prenom} ${m.identite.nom}`.trim() || '(sans nom)';
  const DEFAULT_REMISE = 20;
  const langOf = (m) => (['fr', 'en', 'it', 'de', 'es'].includes(m.langue) ? m.langue : 'fr');

  function estimateCard(cars) {
    const st = App.state;
    const px = st.prix;
    const cfg = st.org.config;
    const lines = quoteLines(cars);
    const remise = () => (px.remise == null ? DEFAULT_REMISE : px.remise); // jamais montrée aux invités
    const perCar = (key) => (px.prix[key] == null ? null : App.discounted(px.prix[key], remise()));

    /* --- prix par ligne de devis --- */
    const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
    const rows = lines.map((l) => {
      const label = `${l.n} × ${short(l.car.categorie)}, ${App.boiteLabel(l.car.boite).toLowerCase()} · ${l.car.lieuRetrait}` +
        `${l.car.lieuRetour !== l.car.lieuRetrait ? ' → ' + l.car.lieuRetour : ''} · ${App.fmtDate(l.from)} → ${App.fmtDate(l.to)}`;
      const input = h('input', { type: 'number', class: 'price', min: 0, step: 1, value: px.prix[l.key] ?? '', placeholder: '€',
        'aria-label': `Prix public pour une voiture : ${label}` });
      const per = h('td', { class: 'amount' });
      const total = h('td', { class: 'amount' });
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (input.value === '' || !(v >= 0)) delete px.prix[l.key]; else px.prix[l.key] = v;
        refreshNumbers();
      });
      input.addEventListener('change', async () => { await App.savePrix(); refreshGuests(); });
      return { l, label, input, per, total, el: h('tr', {}, h('td', {}, label), h('td', { class: 'amount' }, input, ' €'), per, total) };
    });

    function refreshNumbers() {
      let pub = 0, disc = 0, missing = 0;
      for (const r of rows) {
        const price = px.prix[r.l.key];
        if (price == null) { r.per.textContent = '—'; r.total.textContent = '—'; missing++; continue; }
        const d = App.discounted(price, remise());
        r.per.textContent = eur(d);
        r.total.textContent = eur(d * r.l.n);
        pub += price * r.l.n;
        disc += d * r.l.n;
      }
      summary.textContent = missing === rows.length
        ? 'Saisissez au moins un prix pour voir le total.'
        : `Total estimé : ${eur(disc)} (prix public ${eur(pub)}, remise de ${remise()} % : ${eur(pub - disc)} d’économie)` +
          (missing ? ` · ${missing} ligne${missing > 1 ? 's' : ''} sans prix` : '');
    }

    const remiseIn = h('input', { type: 'number', class: 'num', min: 0, max: 60, value: remise(), 'aria-label': 'Remise en pourcentage',
      onchange: async (ev) => {
        px.remise = Math.min(60, Math.max(0, Math.round(Number(ev.target.value)) || 0));
        ev.target.value = px.remise;
        await App.savePrix();
        refreshNumbers();
        refreshGuests();
      } });

    /* --- un message par invité, dans sa langue --- */
    const members = cars.flatMap((c) => c.members.map((m) => ({ c, m })));
    const subjectFor = (m) => App.t(langOf(m))('estSubject');
    function messageFor(c, m) {
      const per = perCar(App.lineKey(c));
      if (per == null) return null;
      return App.estimateMessage({
        lang: langOf(m), name: m.identite.prenom, org: cfg.org, car: c, perCar: per,
        shared: c.members.length > 1, pax: m.trajet.passagers, share: App.memberShare(per, m.trajet.passagers, c.passagers),
      });
    }

    function mail(m, body) {
      const to = /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(m.identite.email) ? m.identite.email : '';
      const a = h('a', { href: `mailto:${to}?subject=${encodeURIComponent(subjectFor(m))}&body=${encodeURIComponent(body)}` });
      document.body.append(a);
      a.click();
      a.remove();
    }

    function openMessage(c, m) {
      const ta = h('textarea', { class: 'quote', rows: 16, 'aria-label': `Message pour ${fullName(m)}` });
      ta.value = messageFor(c, m);
      const dlg = h('dialog', { class: 'detail' },
        h('h2', {}, `Message pour ${fullName(m)}`),
        h('p', { class: 'muted' }, `${App.langName(langOf(m))} · modifiable avant l’envoi`),
        ta,
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => App.copy(ta.value) }, 'Copier'),
          h('button', { class: 'btn', onclick: () => mail(m, ta.value) }, 'Ouvrir dans ma messagerie'),
          h('button', { class: 'btn ghost', onclick: () => App.closeDialog(dlg) }, 'Fermer')));
      App.showDialog(dlg);
    }

    const gbody = h('tbody');
    function refreshGuests() {
      gbody.replaceChildren(...members.map(({ c, m }) => {
        const per = perCar(App.lineKey(c));
        const shared = c.members.length > 1;
        const share = per == null ? null : App.memberShare(per, m.trajet.passagers, c.passagers);
        return h('tr', {},
          h('td', {}, fullName(m)),
          h('td', {}, App.langName(langOf(m))),
          h('td', {}, c.code),
          h('td', { class: 'amount' }, per == null ? '—' : shared ? `${eur(share)} (voiture : ${eur(per)})` : eur(per)),
          h('td', {}, h('button', { class: 'btn small', disabled: per == null, onclick: () => openMessage(c, m) }, 'Message…')));
      }));
    }

    function copyAll() {
      const parts = members.map(({ c, m }) => {
        const msg = messageFor(c, m);
        return msg && `À : ${fullName(m)} <${m.identite.email}> · ${App.langName(langOf(m))}\nObjet : ${subjectFor(m)}\n\n${msg}`;
      }).filter(Boolean);
      if (!parts.length) return App.toast('Aucun prix saisi.');
      App.copy(parts.join('\n\n────────────\n\n'));
    }

    function downloadCsv() {
      const out = [['Nb véhicules', 'Catégorie', 'Boîte', 'Retrait – lieu', 'Retrait – date', 'Restitution – lieu', 'Restitution – date',
        'Prix public / voiture', 'Remise %', 'Prix estimé / voiture', 'Total estimé']];
      for (const r of rows) {
        const price = px.prix[r.l.key];
        const d = price == null ? '' : App.discounted(price, remise());
        out.push([r.l.n, short(r.l.car.categorie), App.boiteLabel(r.l.car.boite), r.l.car.lieuRetrait, App.fmtDate(r.l.from),
          r.l.car.lieuRetour, App.fmtDate(r.l.to), price ?? '', remise(), d, d === '' ? '' : d * r.l.n]);
      }
      App.download(new Blob([App.csv(out)], { type: 'text/csv;charset=utf-8' }), 'estimation-tarifaire.csv');
    }

    refreshNumbers();
    refreshGuests();

    return h('section', { class: 'card' },
      h('h2', {}, '2. Estimation tarifaire'),
      h('p', { class: 'note' }, 'Relevez sur le site Europcar, ou dans sa réponse au devis, le prix public d’une voiture pour chaque ligne (dates comprises). L’outil applique votre remise (que les invités ne voient jamais), calcule la part de chacun et prépare un message dans leur langue : seul le prix final y figure.'),
      h('div', { class: 'row' }, h('label', { class: 'check inline' }, h('span', {}, 'Remise appliquée'), remiseIn, h('span', {}, '%'))),
      h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Ligne de devis', 'Prix public / voiture', 'Après remise / voiture', 'Total ligne'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.map((r) => r.el)))),
      summary,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: downloadCsv }, 'Tableau (CSV)')),
      h('h3', {}, 'Messages aux invités'),
      h('p', { class: 'note' }, 'Une voiture partagée se répartit au prorata des personnes de chacun. Chaque message reste modifiable avant l’envoi.'),
      h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Invité', 'Langue', 'Voiture', 'Estimation', ''].map((t) => h('th', {}, t)))),
        gbody)),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: copyAll }, 'Copier tous les messages')));
  }

  App.viewExport = function () {
    const cars = App.carsModel();
    if (!cars.length) return h('p', { class: 'empty' }, 'Importez d’abord des dossiers.');

    const blocking = App.state.guests.filter((g) => App.alertsFor(g).some((a) => a.lvl === 'bad'));
    const text = quoteText(cars);
    const subject = `Demande de devis – ${cars.length} véhicule${cars.length > 1 ? 's' : ''} – ${App.state.org.config.nom}`;
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

    const opts = { contact: true, permis: true, photos: false };
    const box = (key, label, hint) => {
      const cb = h('input', { type: 'checkbox', onchange: (e) => { opts[key] = e.target.checked; } });
      cb.checked = opts[key];
      return h('label', { class: 'check' }, cb, h('span', {}, label, hint ? h('span', { class: 'hint' }, ' ' + hint) : null));
    };

    const result = h('div');
    const build = h('button', { class: 'btn primary', onclick: async () => {
      build.disabled = true;
      build.textContent = 'Chiffrement…';
      try {
        const { blob, password, photos } = await buildDossier(cars, opts);
        App.download(blob, 'dossier-reservation.zip');
        result.replaceChildren(
          h('div', { class: 'callout' },
            h('p', {}, h('strong', {}, 'dossier-reservation.zip'), ` téléchargé (${cars.length} voiture${cars.length > 1 ? 's' : ''}${photos ? `, ${photos} photo${photos > 1 ? 's' : ''}` : ''}).`),
            h('p', {}, 'Mot de passe, affiché une seule fois :'),
            h('div', { class: 'row' }, h('code', { class: 'secret' }, password), h('button', { class: 'btn', onclick: () => App.copy(password) }, 'Copier')),
            h('ul', { class: 'checklist' },
              h('li', {}, 'Envoyez le ZIP par e-mail, et le mot de passe par un autre canal : SMS ou appel. Jamais dans le même message.'),
              h('li', {}, 'ZIP AES-256 : 7-Zip, WinRAR et Keka l’ouvrent. Certains outils intégrés à Windows ou macOS non : demandez à l’agence ce qu’elle sait lire, ou si elle a un canal sécurisé.'),
              h('li', {}, 'Supprimez le ZIP de vos téléchargements et de vos messages envoyés une fois la réservation confirmée.'))));
      } catch (e) {
        result.replaceChildren(h('p', { class: 'error' }, e.message === 'NO_ZIP'
          ? 'Le module ZIP (dossier vendor) est introuvable : vérifiez que tout le dossier de l’outil est en ligne.'
          : 'Impossible de créer le ZIP : ' + e.message));
      } finally {
        build.disabled = false;
        build.textContent = 'Créer le dossier chiffré';
      }
    } }, 'Créer le dossier chiffré');

    return h('div', {},
      h('section', { class: 'card' },
        h('h2', {}, '1. Demande de devis'),
        h('p', { class: 'note' }, 'Aucun nom, aucun permis : ce texte peut partir par e-mail ordinaire. Il suffit au loueur pour chiffrer.'),
        h('textarea', { class: 'quote', rows: 14, readonly: true, 'aria-label': 'Texte de la demande de devis' }, text),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => App.copy(text) }, 'Copier le texte'),
          h('a', { class: 'btn', href: mailto }, 'Ouvrir dans ma messagerie'),
          h('button', { class: 'btn', onclick: () => App.download(new Blob([quoteCsv(cars)], { type: 'text/csv;charset=utf-8' }), 'devis-voitures.csv') }, 'Tableau (CSV)'))),
      estimateCard(cars),
      h('section', { class: 'card' },
        h('h2', {}, '3. Dossier de réservation (nominatif)'),
        h('p', { class: 'note' }, 'À envoyer seulement quand le devis est accepté. Un tableau avec une ligne par conducteur, dans un ZIP chiffré.'),
        blocking.length ? h('p', { class: 'callout warn' }, `${blocking.length} dossier${blocking.length > 1 ? 's ont' : ' a'} une alerte rouge : ${blocking.map((g) => `${g.identite.prenom} ${g.identite.nom}`).join(', ')}. Corrigez ou retirez-les avant d’envoyer.`) : null,
        box('contact', 'Coordonnées', '(e-mail, téléphone, adresse)'),
        box('permis', 'Données du permis', '(pays, numéro, dates)'),
        box('photos', 'Photos du permis', '(à n’inclure que si le loueur les demande)'),
        h('div', { class: 'actions' }, build),
        result));
  };
})();
