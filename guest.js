/* Côté invité : choix de la langue, formulaire adapté au pays, chiffrement dans le navigateur,
 * puis un fichier à envoyer à l'organisateur. */
(function () {
  'use strict';
  const App = window.App;
  const { h, $ } = App;

  /** Valide une config venue d'un lien : clé publique de 65 octets obligatoire, le reste est nettoyé. Le mot de passe n'a rien à faire ici. */
  function parseGuestConfig(c) {
    if (!c || c.v !== 1 || typeof c.pk !== 'string') return null;
    try {
      if (Vault.fromB64u(c.pk).length !== 65) return null;
    } catch (e) {
      return null;
    }
    return { v: 1, pk: c.pk, ...App.normalizeConfig(c), acces: '', collecteJeton: '' };
  }

  /** Lit la config dans le fragment d'URL (#g=...). Un fragment n'est jamais envoyé à un serveur. */
  App.readGuestConfig = function () {
    const m = location.hash.match(/^#g=([\w-]+)$/);
    if (!m) return null;
    try {
      return parseGuestConfig(JSON.parse(new TextDecoder().decode(Vault.fromB64u(m[1]))));
    } catch (e) {
      return null;
    }
  };

  /** Lien protégé (#p=...) : l'enveloppe chiffrée par le mot de passe, ou null si le lien est abîmé. */
  App.readAccessLink = function () {
    const m = location.hash.match(/^#p=([\w.-]+)$/);
    return m ? Vault.unpackEnvelope(m[1]) : null;
  };

  /**
   * Porte d'entrée d'un lien protégé. Elle ne dit rien de l'événement (pas de nom, pas de carte) : tout est dans
   * l'enveloppe, lisible seulement avec le mot de passe. Une fois ouvert, le formulaire s'affiche dans la même langue.
   */
  App.renderGate = function (env) {
    const root = $('#app');
    const cacheKey = 'mv-acces:' + env.ct.slice(0, 32);
    const codes = App.LANGS.map((l) => l[0]);
    let lang = (navigator.languages || []).map((l) => l.slice(0, 2).toLowerCase()).find((l) => codes.includes(l)) || 'fr';

    // un rechargement de la page ne redemande pas le mot de passe (cet onglet seulement)
    try {
      const saved = sessionStorage.getItem(cacheKey);
      const cfg = saved && parseGuestConfig(JSON.parse(saved));
      if (cfg) return App.renderGuest(cfg, lang);
    } catch (e) { /* stockage indisponible : on redemande */ }

    function show(typed) {
      const t = App.t(lang);
      document.documentElement.lang = lang;
      document.title = t('gateEyebrow');
      const input = h('input', {
        type: 'text', name: 'acces', required: true, autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
        enterkeyhint: 'go', inputmode: 'text', 'aria-label': t('gateLabel'), value: typed || '',
      });
      const err = h('p', { class: 'error', role: 'alert', hidden: true });
      const btn = h('button', { type: 'submit', class: 'btn primary big' }, t('gateOpen'));
      const fail = (key) => { err.textContent = t(key); err.hidden = false; };

      const form = h('form', { class: 'card gate-form', novalidate: true, onsubmit: async (ev) => {
        ev.preventDefault();
        err.hidden = true;
        if (!Vault.accessSecret(input.value)) { fail('gateWrong'); input.focus(); return; }
        btn.disabled = true;
        btn.textContent = t('gateOpening');
        try {
          const raw = await Vault.openWithPassword(env, input.value);
          const cfg = parseGuestConfig(raw);
          if (!cfg) throw new Error('BAD_FORMAT');
          try { sessionStorage.setItem(cacheKey, JSON.stringify(raw)); } catch (e) { /* tant pis */ }
          App.renderGuest(cfg, lang);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = t('gateOpen');
          fail(e.message === 'BAD_PASSWORD' ? 'gateWrong' : 'gateBroken');
          input.focus();
          input.select();
        }
      } },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('gateLabel')), input, h('span', { class: 'hint' }, t('gateHint'))),
      err, btn);

      root.replaceChildren(h('div', { class: 'wrap narrow' },
        h('div', { class: 'topbar' },
          h('nav', { class: 'langflags', 'aria-label': t('langLabel') }, codes.map((code) => h('button', {
            type: 'button', class: 'flagbtn', lang: code, title: App.langName(code), 'aria-label': App.langName(code),
            'aria-pressed': String(code === lang), onclick: () => { lang = code; show(input.value); },
          }, App.flagSvg(code))))),
        h('header', { class: 'landing big gate' },
          h('div', { class: 'landing-text' },
            App.ornament(),
            h('p', { class: 'eyebrow' }, t('gateEyebrow')),
            h('h1', {}, t('gateTitle')),
            h('span', { class: 'rule', 'aria-hidden': 'true' }),
            h('p', { class: 'lead' }, t('gateIntro')))),
        form));
      window.scrollTo(0, 0);
      if (typed) input.focus();
    }
    show('');
  };

  /** Réduit une photo à 1600 px max, en JPEG. Au passage, les métadonnées (GPS, appareil) disparaissent. */
  async function shrink(file, max = 1600, quality = 0.78) {
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      bmp = await new Promise((res, rej) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); res(img); };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image illisible')); };
        img.src = url;
      });
    }
    const w = bmp.naturalWidth || bmp.width;
    const hgt = bmp.naturalHeight || bmp.height;
    const s = Math.min(1, max / Math.max(w, hgt));
    const c = document.createElement('canvas');
    c.width = Math.round(w * s);
    c.height = Math.round(hgt * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c.toDataURL('image/jpeg', quality);
  }

  // Pays où la boîte automatique est la norme : on la présélectionne.
  const AUTOMATIC = new Set(['US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IL']);
  const capital = (s) => s[0].toUpperCase() + s.slice(1);
  const NUMERIC_POSTAL = new Set(['FR', 'DE', 'IT', 'ES', 'BE', 'LU', 'CH', 'AT', 'DK', 'NO', 'FI', 'AU', 'US']);

  function snapshot(form) {
    const v = {};
    for (const el of form.elements) {
      if (!el.name || el.type === 'file' || el.type === 'button' || el.type === 'submit') continue;
      v[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return v;
  }

  App.renderGuest = function (cfg, preferred) {
    const root = $('#app');
    const st = {
      lang: null, encrypted: null, values: null,
      shots: { recto: '', verso: '' },         // photos : en mémoire, jamais envoyées sauf case cochée
      text: { recto: null, verso: null },      // texte lu sur chaque face (null : pas encore lu)
      prefilled: new Set(),                    // champs remplis par une lecture, tant que l'invité n'y a pas touché
      attach: false,
      phoneTouched: false, licTouched: false, boxTouched: false, step: 0,
    };

    /** Programme de l'événement : en grand sur l'accueil, en liste serrée dans le formulaire. */
    function programmeBlock(lang, compact) {
      if (!cfg.programme.length) return null;
      const t = App.t(lang);
      const day = (d) => new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(App.dt(d));
      if (compact) {
        return h('div', { class: 'callout programme-mini' }, h('strong', {}, t('programme')),
          h('ul', {}, cfg.programme.map((e) => h('li', {}, h('span', { class: 'when' }, day(e.date)), ' · ', e.titre, e.lieu ? ` — ${e.lieu}` : ''))));
      }
      const part = (d, opts) => new Intl.DateTimeFormat(lang, opts).format(App.dt(d));
      return h('section', { class: 'programme' }, h('h2', {}, t('programme')),
        h('ol', { class: 'timeline' }, cfg.programme.map((e) => h('li', { class: 'ev' },
          h('div', { class: 'ev-date' },
            h('span', { class: 'ev-day' }, part(e.date, { day: 'numeric' })),
            h('span', { class: 'ev-month' }, part(e.date, { month: 'short' }).replace('.', '')),
            h('span', { class: 'ev-wd' }, part(e.date, { weekday: 'long' }))),
          h('div', { class: 'ev-body' },
            h('p', { class: 'ev-title' }, e.titre),
            e.lieu ? h('p', { class: 'ev-place' }, e.lieu) : null)))));
    }

    /* ----- 1. langue : drapeaux en haut, la page s'ouvre dans la langue du navigateur ----- */

    function detectLang() {
      if (preferred && cfg.langs.includes(preferred)) return preferred;
      const wanted = (navigator.languages || []).map((l) => l.slice(0, 2).toLowerCase());
      return wanted.find((l) => cfg.langs.includes(l)) || cfg.langs[0];
    }

    /** Barre de drapeaux, collée en haut pendant le défilement ; un seul clic change la langue sans perdre la saisie. */
    function flagBar(current, onPick) {
      if (cfg.langs.length < 2) return null;
      return h('nav', { class: 'langflags', 'aria-label': App.t(current)('langLabel') },
        cfg.langs.map((code) => h('button', {
          type: 'button', class: 'flagbtn', lang: code, title: App.langName(code),
          'aria-label': App.langName(code), 'aria-pressed': String(code === current), onclick: () => onPick(code),
        }, App.flagSvg(code))));
    }

    /* ----- 2. formulaire ----- */

    function showForm() {
      const t = App.t(st.lang);
      document.documentElement.lang = st.lang;
      document.title = `${t('eyebrow')} – ${cfg.nom}`;
      const orgName = cfg.org || t('orgFallback');
      const stay = App.stayDefaults(cfg.programme); // arrivée et retour proposés d'après le programme
      const shortCat = (id) => t('cat.' + id).replace(/ \(.*\)$/, '');

      /* petits constructeurs */
      const field = (label, input, hint) =>
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input,
          hint ? h('span', { class: 'hint' }, hint) : null);
      // libellé et aide modifiables : ils changent avec le pays choisi
      const dynField = (input, label) => {
        const lbl = h('span', { class: 'lbl' }, label || '');
        const hint = h('span', { class: 'hint' });
        return { lbl, hint, input, el: h('label', { class: 'field' }, lbl, input, hint) };
      };
      const text = (name, extra = {}) => h('input', { type: 'text', name, ...extra });
      const select = (name, options, extra = {}) => {
        const el = h('select', { name, ...extra }, options.map(([v, l]) => h('option', { value: v }, l)));
        if (extra.value) el.value = extra.value; // après les options, sinon rien n'est sélectionné
        return el;
      };
      const countryOptions = () => [['', t('countryChoose')], ...App.countryList(st.lang)];

      /* --- vous --- */
      const countrySel = select('pays', countryOptions(), { required: true, autocomplete: 'country' });

      const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next' });
      const emailHint = h('span', { class: 'hint warn', hidden: true });
      email.addEventListener('change', () => {
        const fix = App.suggestEmail(email.value);
        emailHint.hidden = !fix;
        if (fix) {
          emailHint.replaceChildren(t('emailDidYouMean', { x: fix }) + ' ',
            h('button', { type: 'button', class: 'link', onclick: () => { email.value = fix; emailHint.hidden = true; } }, t('emailUse')));
        }
      });

      const dialSel = select('tel_pays', App.countryList(st.lang).map(([c, n]) => [c, `${App.flag(c)} +${App.DIAL[c]} ${n}`]),
        { 'aria-label': t('phoneCountry') });
      // ce qu'on voit : drapeau et indicatif seulement. La vraie liste (avec les noms) s'ouvre au toucher, par-dessus.
      const dialFlag = h('span', { class: 'flag' });
      const dialCode = h('span', { class: 'code' });
      const dialFace = h('span', { class: 'dial-face', 'aria-hidden': 'true' }, dialFlag, dialCode, h('span', { class: 'chev' }, '▾'));
      const isInternational = (v) => /^\s*(\+|00)/.test(v);
      const refreshDial = () => {
        const c = dialSel.value;
        dialFlag.textContent = c ? App.flag(c) : '';
        dialCode.textContent = c ? `+${App.DIAL[c]}` : '';
        tel.placeholder = c ? App.phoneExample(c) : '';
        // le pays change : les chiffres déjà tapés sont regroupés à la mode du nouveau pays
        if (c && tel.value && !isInternational(tel.value)) tel.value = App.formatNationalInput(c, tel.value);
      };
      const tel = h('input', { type: 'tel', name: 'tel', id: 'f-tel', required: true, inputmode: 'tel', autocomplete: 'tel-national',
        enterkeyhint: 'next', maxlength: 24, autocorrect: 'off' });
      const telHint = h('span', { class: 'hint', 'aria-live': 'polite' });
      // aperçu du numéro tel qu'il sera enregistré : on voit tout de suite si l'indicatif et le 0 initial sont bien traités
      const updatePhoneHint = (final) => {
        const v = tel.value.trim();
        telHint.classList.remove('warn');
        telHint.textContent = '';
        if (!v) return;
        const r = App.normalizePhone(dialSel.value, v);
        if (r.ok) telHint.textContent = `✓ ${r.tel}`;
        else if (final) { telHint.textContent = t('errPhone'); telHint.classList.add('warn'); }
      };
      // les chiffres se regroupent au fil de la frappe (06 74 69 44 82, (415) 555-0100) ; le curseur reste derrière le même chiffre
      tel.addEventListener('input', () => {
        const v = tel.value;
        if (!isInternational(v)) {
          const formatted = App.formatNationalInput(dialSel.value, v);
          if (formatted !== v) {
            const digitsBefore = v.slice(0, tel.selectionStart).replace(/\D/g, '').length;
            tel.value = formatted;
            let pos = 0;
            for (let seen = 0; pos < formatted.length && seen < digitsBefore; pos++) if (/\d/.test(formatted[pos])) seen++;
            try { tel.setSelectionRange(pos, pos); } catch (e) { /* champ non sélectionnable : le curseur reste en fin */ }
          }
        }
        updatePhoneHint(false);
      });
      // un numéro tapé en +39… ou 0039… bascule l'indicatif tout seul
      tel.addEventListener('change', () => {
        if (isInternational(tel.value)) {
          const r = App.normalizePhone(dialSel.value, tel.value);
          if (r.ok && App.DIAL[r.iso]) {
            dialSel.value = r.iso;
            refreshDial();
            tel.value = App.formatNational(r.iso, r.tel.replace(/\D/g, '').slice(App.DIAL[r.iso].length));
            st.phoneTouched = true;
          }
        }
        updatePhoneHint(true);
      });

      const addr = text('adresse', {
        id: 'f-addr', required: true, autocapitalize: 'words', enterkeyhint: 'next',
        autocomplete: cfg.adresseAuto ? 'off' : 'street-address', // la liste de suggestions remplace celle du navigateur
        ...(cfg.adresseAuto ? { role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'f-addr-list' } : {}),
      });
      const addrHint = h('span', { class: 'hint' });
      const postalF = dynField(text('cp', { autocomplete: 'postal-code' }));
      const cityF = dynField(text('ville', { required: true, autocomplete: 'address-level2', autocapitalize: 'words' }), t('city'));
      const regionF = dynField(text('region', { autocomplete: 'address-level1', maxlength: 40 }));
      const addrGrid = h('div', { class: 'grid3' });

      /** Libellés, exemple, champs et ordre selon le pays de résidence. */
      function applyAddress(iso) {
        const p = App.addressProfile(iso);
        addrHint.textContent = cfg.adresseAuto
          ? t('addrPrivacy', { provider: App.ADDRESS_PROVIDERS[App.addressProvider(iso)].name }) : '';
        postalF.lbl.textContent = t('postal') + (p.local ? ` (${p.local})` : '');
        postalF.input.placeholder = p.ph || '';
        postalF.input.inputMode = NUMERIC_POSTAL.has(iso) ? 'numeric' : 'text';
        postalF.input.required = !!p.re;
        postalF.hint.textContent = '';
        postalF.hint.classList.remove('warn');
        if (p.region) {
          regionF.lbl.textContent = t('region' + capital(p.region.type));
          regionF.input.placeholder = p.region.ph || '';
          regionF.input.required = !!p.region.required;
        } else {
          regionF.input.value = '';
          regionF.input.required = false;
        }
        const order = p.cityFirst ? [cityF, regionF, postalF] : [postalF, cityF, regionF];
        const shown = order.filter((f) => f !== regionF || p.region);
        addrGrid.className = shown.length === 3 ? 'grid3' : 'grid2';
        addrGrid.replaceChildren(...shown.map((f) => f.el));
      }
      // un code postal qui ne ressemble pas au format du pays : on le dit, sans bloquer
      postalF.input.addEventListener('change', () => {
        const p = App.addressProfile(countrySel.value);
        const v = postalF.input.value.trim();
        const bad = !!(p.re && v && !p.re.test(v));
        postalF.hint.textContent = bad ? t('postalFormat', { ex: p.ph }) : '';
        postalF.hint.classList.toggle('warn', bad);
      });

      /** Suggestions d'adresses sous le champ (motif ARIA « combobox »). Désactivées si l'organisateur les a coupées. */
      function addressSearch() {
        if (!cfg.adresseAuto) return null;
        const list = h('ul', { class: 'suggest', id: 'f-addr-list', role: 'listbox', 'aria-label': t('address'), hidden: true });
        const live = h('span', { class: 'offscreen', 'aria-live': 'polite' });
        const cache = new Map();
        let items = [];
        let active = -1;
        let timer = 0;
        let ctl = null;
        const options = () => [...list.querySelectorAll('[role=option]')];

        const close = () => {
          list.hidden = true;
          addr.setAttribute('aria-expanded', 'false');
          addr.removeAttribute('aria-activedescendant');
          active = -1;
        };
        const mark = (i) => {
          active = i;
          options().forEach((li, k) => { li.classList.toggle('on', k === i); li.setAttribute('aria-selected', String(k === i)); });
          if (i >= 0) {
            const li = options()[i];
            addr.setAttribute('aria-activedescendant', li.id);
            li.scrollIntoView({ block: 'nearest' });
          } else {
            addr.removeAttribute('aria-activedescendant');
          }
        };
        /** Une suggestion remplit l'adresse, le code postal, la ville, la région et, si besoin, le pays. */
        const choose = (s) => {
          if (s.country && s.country !== countrySel.value && App.DIAL[s.country]) { countrySel.value = s.country; syncCountry(); }
          addr.value = s.line1;
          postalF.input.value = s.postcode;
          cityF.input.value = s.city;
          if (s.region && regionF.input.isConnected) regionF.input.value = s.region;
          postalF.input.dispatchEvent(new Event('change'));
          close();
        };
        const show = (res, provider) => {
          items = res;
          list.replaceChildren(
            ...res.map((s, i) => h('li', {
              role: 'option', id: `f-addr-opt-${i}`, 'aria-selected': 'false',
              onmousedown: (e) => e.preventDefault(), // le clic ne doit pas retirer le focus du champ
              onclick: () => choose(s),
            }, h('span', { class: 'sg-main' }, s.line1), h('span', { class: 'sg-sub' }, [s.postcode, s.city].filter(Boolean).join(' ')))),
            h('li', { class: 'src', role: 'presentation' }, App.ADDRESS_PROVIDERS[provider].credit));
          list.hidden = !res.length;
          addr.setAttribute('aria-expanded', String(res.length > 0));
          active = -1;
          live.textContent = res.length ? t('addrCount', { n: res.length }) : '';
          if (res.length) list.scrollIntoView({ block: 'nearest' }); // la liste entière doit être visible, même en bas de l'écran
        };
        async function search(q) {
          const iso = countrySel.value;
          const provider = App.addressProvider(iso);
          const key = `${iso}|${st.lang}|${q.toLowerCase()}`;
          if (cache.has(key)) { show(cache.get(key), provider); return; }
          if (ctl) ctl.abort();
          const mine = (ctl = new AbortController());
          const res = await App.fetchSuggestions(q, iso, st.lang, { signal: mine.signal });
          if (mine.signal.aborted || addr.value.trim() !== q) return; // une saisie plus récente a pris le relais
          cache.set(key, res);
          show(res, provider);
        }
        addr.addEventListener('input', () => {
          clearTimeout(timer);
          const q = addr.value.trim();
          if (q.length < App.ADDRESS_MIN_CHARS) { if (ctl) ctl.abort(); close(); return; }
          timer = setTimeout(() => search(q), 300);
        });
        addr.addEventListener('keydown', (e) => {
          const n = items.length;
          if (list.hidden || !n) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); mark((active + 1) % n); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); mark((active - 1 + n) % n); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
        addr.addEventListener('blur', () => setTimeout(close, 200));
        return [list, live];
      }

      /* --- permis --- */
      const licCountrySel = select('permis_pays', countryOptions(), { required: true });
      const licNumF = dynField(text('permis_numero', { required: true, autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false' }), t('licNumber'));
      const licIssuedF = dynField(h('input', { type: 'date', name: 'permis_delivrance', required: true }), t('licIssued'));
      const licExpiryF = dynField(h('input', { type: 'date', name: 'permis_expiration' }), t('licExpiry'));
      const foreign = h('p', { class: 'callout warn', hidden: true });

      /** Aides et exemple selon le pays qui a délivré le permis. */
      function applyLicence(iso) {
        const fam = App.licenceFamily(iso);
        licNumF.hint.textContent = t('licNumberHint_' + fam);
        licNumF.input.placeholder = App.licencePlaceholder(iso);
        licIssuedF.hint.textContent = t('licIssuedHint_' + fam);
        licExpiryF.hint.textContent = t('licExpiryHint_' + fam);
        const unrecognised = !!iso && !App.PERMIS_RECONNUS.has(iso);
        foreign.hidden = !unrecognised;
        foreign.textContent = unrecognised ? t('licForeignNote', { org: orgName }) : '';
      }

      /* --- permis : photo, lecture sur l'appareil, préremplissage à vérifier --- */
      const licFields = [['numero', licNumF], ['delivrance', licIssuedF], ['expiration', licExpiryF]];
      const scanStatus = h('div', { class: 'scan-status', 'aria-live': 'polite' });
      const clearTag = (field) => { if (field.tag) { field.tag.remove(); field.tag = null; } };
      // dès que l'invité touche à un champ, il l'a vérifié : l'étiquette « lu sur le permis » disparaît
      for (const [, field] of licFields) {
        field.input.addEventListener('input', () => { clearTag(field); st.prefilled.delete(field.input.name); });
      }
      const shown = (key, value) => (key === 'numero' ? value : App.fmtDate(App.dt(value)));
      const addTag = (field, content) => { clearTag(field); field.tag = h('span', { class: 'scan-tag' }, ...content); field.el.append(field.tag); };

      // « Utiliser » : l'invité a tranché, une lecture ultérieure ne retirera plus cette valeur
      const useButton = (field, r) => h('button', { type: 'button', class: 'link', onclick: () => {
        field.input.value = r.value;
        st.prefilled.delete(field.input.name);
        addTag(field, [t('scanRead')]);
      } }, t('scanUse'));

      /**
       * Reporte ce qui a été lu : remplit les champs vides, propose (sans écraser) quand l'invité a déjà saisi autre chose.
       * Une date de carte du modèle européen (champ 4a) n'est que proposée : la date d'obtention est au verso.
       */
      function applyScan(parsed) {
        let n = 0;
        let suggested = 0;
        for (const [key, field] of licFields) {
          const r = parsed[key];
          clearTag(field);
          const input = field.input;
          // une valeur remplie par une lecture précédente que celle-ci ne confirme plus (autre pays, autre photo) est retirée
          if (st.prefilled.has(input.name) && (!r || r.ask)) { input.value = ''; st.prefilled.delete(input.name); }
          if (!r) continue;
          if (r.ask) {
            if (!input.value) {
              suggested++;
              addTag(field, [t('scanCardEu', { value: shown(key, r.value) }), ' ', useButton(field, r)]);
              field.tag.classList.add('diff');
            }
          } else if (!input.value || st.prefilled.has(input.name)) {
            input.value = r.value;
            st.prefilled.add(input.name);
            n++;
            addTag(field, [r.from === 'card' ? t('scanCardNa') : t('scanRead') + (r.conf === 'low' ? ` · ${t('scanLow')}` : '')]);
            if (r.conf === 'low') field.tag.classList.add('low');
          } else if (input.value !== r.value) {
            addTag(field, [t('scanDiffers', { value: shown(key, r.value) }), ' ', useButton(field, r)]);
            field.tag.classList.add('diff');
          }
        }
        // recoupement avec l'identité de l'étape 1 : on prévient, on ne bloque rien
        const same = App.compareIdentity(parsed, { nom: form.elements.nom.value, prenom: form.elements.prenom.value, naissance: form.elements.naissance.value });
        const warns = [];
        if (same.nom === false) warns.push(t('scanNameDiffers', { value: parsed.nom.value }));
        if (same.naissance === false) warns.push(t('scanBirthDiffers', { value: App.fmtDate(App.dt(parsed.naissance.value)) }));
        const lines = [];
        if (n || !suggested) lines.push(h('p', { class: 'hint' + (n ? ' ok' : ' warn') }, n ? t('scanDone', { n }) : t('scanNothing')));
        if (suggested) lines.push(h('p', { class: 'hint ok' }, t('scanSuggested')));
        scanStatus.replaceChildren(...lines, ...warns.map((w) => h('p', { class: 'hint warn' }, w)));
      }

      /**
       * Lit les photos pas encore lues, selon le modèle du permis choisi plus bas (européen, américain, autre), puis
       * reporte ce qui a été trouvé. Relancée quand l'invité change le pays du permis : le texte déjà lu est réutilisé.
       */
      const scanUis = {};
      let reading = false;
      let readAgain = false;
      async function readShots() {
        if (reading) { readAgain = true; return; }
        reading = true;
        try {
          do {
            readAgain = false;
            if (!st.shots.recto && !st.shots.verso) break;
            const iso = licCountrySel.value;
            const fam = iso ? App.licenceFamily(iso) : '';
            if (fam !== 'eu' && fam !== 'na') {
              scanStatus.replaceChildren(h('p', { class: 'hint warn' }, t(fam ? 'scanOther' : 'scanPickCountry')));
              continue;
            }
            for (const side of ['recto', 'verso']) {
              if (!st.shots[side] || st.text[side] !== null) continue;
              const ui = scanUis[side];
              try {
                st.text[side] = await App.scanImage(st.shots[side], (p) => ui.setState(`${p.phase === 'engine' ? t('scanEngine') : t('scanReading')} ${p.pct} %`));
              } catch (e) {
                scanStatus.replaceChildren(h('p', { class: 'hint warn' }, t('scanFail')));
                return;
              } finally {
                ui.setState('');
              }
            }
            applyScan(App.parseLicence({ front: st.text.recto || '', back: st.text.verso || '' }, { family: fam, country: iso }));
          } while (readAgain);
        } finally {
          reading = false;
        }
      }

      async function handleFile(side, file, ui) {
        if (!file) return;
        ui.setState(t('scanPrep'));
        let shot;
        try {
          shot = await shrink(file);
        } catch (e) {
          ui.setState('');
          App.toast(t('photoBad'));
          return;
        }
        st.shots[side] = shot;
        st.text[side] = null; // nouvelle photo : à relire
        ui.showThumb(shot);
        ui.setState('');
        scanStatus.replaceChildren();
        readShots();
      }

      function scanCard(side, label) {
        const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'offscreen', tabindex: '-1', 'aria-hidden': 'true' });
        const picker = h('input', { type: 'file', accept: 'image/*', class: 'offscreen', tabindex: '-1', 'aria-hidden': 'true' });
        const thumb = h('img', { class: 'scan-thumb', alt: '', hidden: true });
        const state = h('p', { class: 'scan-state', 'aria-live': 'polite' });
        const takeLabel = h('span', {}, t('scanTake'));
        const take = h('button', { type: 'button', class: 'btn small primary', onclick: () => camera.click() }, App.icon('camera'), takeLabel);
        const pick = h('button', { type: 'button', class: 'btn small ghost', onclick: () => picker.click() }, t('scanPick'));
        const card = h('div', { class: 'scan-card' }, h('span', { class: 'scan-label' }, label), thumb, state,
          h('div', { class: 'scan-actions' }, take, pick), camera, picker);
        const ui = {
          setState: (text) => { state.textContent = text; card.classList.toggle('busy', !!text); take.disabled = pick.disabled = !!text; },
          showThumb: (src) => { thumb.src = src; thumb.hidden = false; card.classList.add('has'); takeLabel.textContent = t('scanRetake'); },
        };
        const onPick = (e) => { const f = e.target.files[0]; e.target.value = ''; handleFile(side, f, ui); };
        camera.addEventListener('change', onPick);
        picker.addEventListener('change', onPick);
        if (st.shots[side]) ui.showThumb(st.shots[side]);
        scanUis[side] = ui;
        return card;
      }

      /** Mode « non » : rien. « scan » : lecture sans conserver la photo. « optionnel » : case pour la joindre. « requis » : jointe d'office. */
      function scanBlock() {
        if (cfg.photos === 'non') return null;
        let attach = null;
        if (cfg.photos === 'optionnel') {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = st.attach;
          cb.addEventListener('change', () => { st.attach = cb.checked; });
          attach = h('label', { class: 'check' }, cb, h('span', {}, t('scanAttach')));
        }
        const note = cfg.photos === 'requis' ? t('scanRequired') : cfg.photos === 'scan' ? t('scanDiscarded') : null;
        return h('div', { class: 'scan' },
          h('p', { class: 'note' }, t('scanIntro')),
          h('div', { class: 'scan-grid' }, scanCard('recto', t('scanFront')), scanCard('verso', t('scanBack'))),
          scanStatus, attach, note ? h('p', { class: 'hint' }, note) : null);
      }
      const attaches = () => cfg.photos === 'requis' || (cfg.photos === 'optionnel' && st.attach);

      /* --- séjour --- */
      const lieuOptions = (withSame) => [
        withSame ? ['__same', t('placeSame')] : ['', t('placeChoose')],
        ...cfg.lieux.map((l) => [l, l]),
        ['__autre', t('placeOther')],
      ];
      const lieuField = (name, label, withSame) => {
        const sel = select(name, lieuOptions(withSame), { required: !withSame });
        const other = text(name + '_autre', { placeholder: t('placeOtherPh'), hidden: true });
        sel.addEventListener('change', () => {
          other.hidden = sel.value !== '__autre';
          other.required = !other.hidden;
        });
        return h('div', { class: 'stack' }, field(label, sel), other);
      };

      /* --- voiture : suggestion selon personnes, valises, sièges enfant --- */
      const peopleIn = h('input', { type: 'number', name: 'passagers', min: 1, max: 9, value: 2, required: true });
      const bagsIn = h('input', { type: 'number', name: 'bagages', min: 0, max: 20, value: 1 });
      const seatsIn = h('input', { type: 'number', name: 'siege', min: 0, max: 4, value: 0 });
      const catSel = select('categorie', [['auto', t('catAuto')], ...App.CATEGORIES.map(([id]) => [id, t('cat.' + id)])], { value: 'auto' });
      const advice = h('p', { class: 'advice', 'aria-live': 'polite' });

      function updateAdvisor() {
        const pax = Number(peopleIn.value) || 1;
        const bags = Number(bagsIn.value) || 0;
        const sieges = Number(seatsIn.value) || 0;
        const rec = App.recommendCategory(pax, bags, sieges);
        // français : 0 et 1 au singulier ; ailleurs : seulement 1
        const one = (n) => (st.lang === 'fr' ? n < 2 : n === 1);
        const vars = {
          pax, bags, paxWord: t(one(pax) ? 'paxWord1' : 'paxWord'), bagWord: t(one(bags) ? 'bagWord1' : 'bagWord'),
          org: orgName, cat: shortCat(rec.id),
        };
        const chosen = catSel.value;
        let msg;
        let level = '';
        if (chosen === 'auto') {
          msg = rec.why === 'overflow' ? t('advOverflow', vars)
            : t({ fits: 'advFits', seats: 'advSeats', luggage: 'advLuggage', child: 'advChild' }[rec.why], vars);
        } else if (!App.fitsCategory(chosen, pax, bags, sieges)) {
          msg = t('advTooSmall', vars);
          level = 'warn';
        } else if (App.oversizedCategory(chosen, rec.id)) {
          msg = t('advTooBig', vars);
        } else {
          msg = t('advOk', vars);
        }
        advice.textContent = msg;
        advice.className = 'advice ' + level;
      }
      [peopleIn, bagsIn, seatsIn, catSel].forEach((el) => el.addEventListener('input', updateAdvisor));

      const boxSel = select('boite', App.BOITES.map(([id]) => [id, t('box.' + id)]), { value: 'manuelle' });
      const boxF = dynField(boxSel, t('gearbox'));
      boxSel.addEventListener('change', () => { st.boxTouched = true; });
      const applyBox = () => { boxF.hint.textContent = AUTOMATIC.has(countrySel.value) ? t('gearboxHintAuto') : t('gearboxHint'); };

      const sharingBox = h('input', { type: 'checkbox', name: 'partage' });
      const sharingWith = text('partage_avec', { placeholder: t('shareWith'), hidden: true });
      sharingBox.addEventListener('change', () => { sharingWith.hidden = !sharingBox.checked; });

      /* --- le pays de résidence commande le reste, tant que l'invité n'a pas choisi lui-même --- */
      function syncCountry() {
        const c = countrySel.value;
        applyAddress(c);
        applyBox();
        if (!c) return;
        if (!st.phoneTouched) { dialSel.value = c; refreshDial(); updatePhoneHint(false); }
        if (!st.licTouched) { licCountrySel.value = c; applyLicence(c); readShots(); }
        if (!st.boxTouched) boxSel.value = AUTOMATIC.has(c) ? 'auto' : 'manuelle';
      }
      countrySel.addEventListener('change', syncCountry);
      dialSel.addEventListener('change', () => { st.phoneTouched = true; refreshDial(); updatePhoneHint(false); });
      licCountrySel.addEventListener('change', () => { st.licTouched = true; applyLicence(licCountrySel.value); readShots(); });

      /* --- envoi --- */

      const form = h('form', { novalidate: true, autocomplete: 'on' },

        h('fieldset', {}, h('legend', {}, t('s1')),
          h('div', { class: 'grid2' },
            field(t('firstName'), text('prenom', { required: true, autocomplete: 'given-name', autocapitalize: 'words', enterkeyhint: 'next' })),
            field(t('lastName'), text('nom', { required: true, autocomplete: 'family-name', autocapitalize: 'words', enterkeyhint: 'next' }))),
          field(t('birth'), h('input', { type: 'date', name: 'naissance', required: true, autocomplete: 'bday' })),
          field(t('country'), countrySel),
          h('div', { class: 'field' },
            h('label', { class: 'lbl', for: 'f-tel' }, t('phone')),
            h('div', { class: 'phone' }, h('div', { class: 'dial' }, dialFace, dialSel), tel),
            telHint),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, t('email')), email, emailHint),
          h('div', { class: 'field' },
            h('label', { class: 'lbl', for: 'f-addr' }, t('address')),
            h('div', { class: 'combo' }, addr, addressSearch()),
            addrHint),
          addrGrid),

        h('fieldset', {}, h('legend', {}, t('s2')),
          scanBlock(),
          h('div', { class: 'grid2' }, field(t('licCountry'), licCountrySel), licNumF.el),
          h('div', { class: 'grid2' }, licIssuedF.el, licExpiryF.el),
          foreign),

        h('fieldset', {}, h('legend', {}, t('s3')),
          programmeBlock(st.lang, true),
          lieuField('retrait', t('pickup'), false),
          h('div', { class: 'grid2' },
            field(t('arrival'), h('input', { type: 'datetime-local', name: 'arrivee', required: true, value: stay ? stay.arrivee : '' }),
              stay ? t('datesHint') : null),
            field(t('flight'), text('vol', { placeholder: 'AF 7584', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off' }))),
          lieuField('restitution', t('dropoff'), true),
          field(t('returnAt'), h('input', { type: 'datetime-local', name: 'retour', required: true, value: stay ? stay.retour : '' })),
          h('div', { class: 'grid2' }, field(t('people'), peopleIn, t('peopleHint')), field(t('bags'), bagsIn))),

        h('fieldset', {}, h('legend', {}, t('s4')),
          field(t('childSeats'), seatsIn),
          field(t('category'), catSel),
          advice,
          boxF.el,
          field(t('other'), text('options', { placeholder: t('otherPh') })),
          h('label', { class: 'check' }, sharingBox, h('span', {}, t('share'))),
          sharingWith,
          h('p', { class: 'note' }, t('cardHolder'))),

        h('fieldset', {}, h('legend', {}, t('s5')),
          field(t('notes'), h('textarea', { name: 'notes', rows: 2, maxlength: 600 })),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent', required: true }),
            h('span', {}, t('consent', { org: orgName, loueur: cfg.loueur }))),
          ));

      async function finish() {
        status.hidden = true;
        const bad = firstBadStep();
        if (bad !== -1) { st.step = bad; renderStep(true); checkStep(bad); return; }
        const fd = new FormData(form);
        const g = (k) => (fd.get(k) || '').toString().trim();
        const place = (name) => (g(name) === '__autre' ? g(name + '_autre') : g(name));
        const retrait = place('retrait');
        const restitution = g('restitution') === '__same' ? retrait : place('restitution');

        const phone = App.normalizePhone(g('tel_pays'), g('tel'));

        const pax = Number(g('passagers')) || 1;
        const bags = Number(g('bagages')) || 0;
        const sieges = Number(g('siege')) || 0;
        const auto = g('categorie') === 'auto';
        const payload = {
          v: 1,
          id: crypto.randomUUID(),
          submittedAt: new Date().toISOString(),
          langue: st.lang,
          identite: {
            prenom: g('prenom'), nom: g('nom'), naissance: g('naissance'), email: g('email'), tel: phone.tel,
            adresse: g('adresse'), cp: g('cp'), ville: g('ville'), region: g('region'), pays: g('pays'),
          },
          permis: {
            pays: g('permis_pays'), numero: g('permis_numero'),
            delivrance: g('permis_delivrance'), expiration: g('permis_expiration'),
            recto: attaches() ? st.shots.recto : '', verso: attaches() ? st.shots.verso : '',
          },
          trajet: { retrait, arrivee: g('arrivee'), vol: g('vol'), restitution, retour: g('retour'), passagers: pax, bagages: bags },
          vehicule: {
            categorie: auto ? App.recommendCategory(pax, bags, sieges).id : g('categorie'),
            categorieAuto: auto, boite: g('boite'), siege: sieges, options: g('options'),
          },
          partage: { ok: !!fd.get('partage'), avec: g('partage_avec') },
          notes: g('notes'),
        };

        nextBtn.disabled = true;
        nextBtn.textContent = t('encrypting');
        try {
          const env = await Vault.encryptFor(cfg.pk, payload);
          const rnd = Vault.toB64u(crypto.getRandomValues(new Uint8Array(5)));
          st.encrypted = new File([JSON.stringify(env)], `voiture-mariage-${rnd}.txt`, { type: 'text/plain' });
          st.values = snapshot(form); // pour « Modifier mes réponses »
          if (cfg.collecte) {
            nextBtn.textContent = t('sending');
            await deliver();
          }
          showDone();
        } catch (e) {
          status.textContent = t('errEncrypt');
          status.hidden = false;
        } finally {
          nextBtn.disabled = false;
          nextBtn.textContent = cfg.collecte ? t('submitSend') : t('submit');
        }
      }

      /* --- étapes : une section à la fois, avec progression --- */
      const stepEls = [...form.querySelectorAll(':scope > fieldset')];
      const LAST = stepEls.length - 1;
      const stepTitle = (i) => t('s' + (i + 1)).replace(/^\d+\.\s*/, ''); // la numérotation est déjà dans la barre de progression
      stepEls.forEach((el, i) => {
        el.classList.add('step');
        el.querySelector('legend').textContent = stepTitle(i);
      });
      const status = h('p', { class: 'error', role: 'alert', hidden: true });
      const stepLabel = h('span', { class: 'step-label' });
      const bar = h('div', { class: 'bar' }, h('i'));
      const intro = h('div', { class: 'intro' });
      const prevBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => { st.step--; renderStep(true); } }, t('prev'));
      const nextBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => onNext() });

      /** Problèmes propres à une étape (les contrôles natifs sont faits à part). */
      function stepProblems(i) {
        const fd = new FormData(form);
        const g = (k) => (fd.get(k) || '').toString().trim();
        const out = [];
        if (i === 0 && g('tel') && !App.normalizePhone(g('tel_pays'), g('tel')).ok) out.push(t('errPhone'));
        if (i === 1) {
          if (App.dt(g('permis_delivrance')) > new Date()) out.push(t('errLicFuture'));
          if (cfg.photos === 'requis' && !(st.shots.recto && st.shots.verso)) out.push(t('errPhotos'));
        }
        if (i === 2) {
          const arr = App.dt(g('arrivee'));
          const ret = App.dt(g('retour'));
          if (arr && App.yearsBetween(g('naissance'), arr) < 18) out.push(t('errAge'));
          if (arr && ret && ret <= arr) out.push(t('errReturn'));
        }
        return out;
      }
      const stepFields = (i) => [...stepEls[i].querySelectorAll('input, select, textarea')];

      /** Contrôle l'étape affichée : bulle native sur le premier champ en défaut, sinon message d'étape. */
      function checkStep(i) {
        status.hidden = true;
        const bad = stepFields(i).find((el) => !el.checkValidity());
        if (bad) { bad.reportValidity(); return false; }
        const problems = stepProblems(i);
        if (problems.length) { status.textContent = problems.join(' '); status.hidden = false; return false; }
        return true;
      }
      const firstBadStep = () => stepEls.findIndex((_, i) => stepFields(i).some((el) => !el.checkValidity()) || stepProblems(i).length);

      function renderStep(scroll) {
        stepEls.forEach((el, i) => { el.hidden = i !== st.step; });
        intro.hidden = st.step !== 0;
        stepLabel.textContent = `${t('stepOf', { n: st.step + 1, total: LAST + 1 })} · ${stepTitle(st.step)}`;
        bar.style.setProperty('--p', String(((st.step + 1) / (LAST + 1)) * 100));
        prevBtn.hidden = st.step === 0;
        nextBtn.textContent = st.step === LAST ? (cfg.collecte ? t('submitSend') : t('submit')) : t('next');
        status.hidden = true;
        if (scroll) window.scrollTo({ top: st.step === 0 ? 0 : Math.max(0, form.getBoundingClientRect().top + window.scrollY - 150), behavior: 'smooth' });
      }
      function onNext() {
        if (st.step < LAST) {
          if (checkStep(st.step)) { st.step++; renderStep(true); }
        } else {
          finish();
        }
      }
      form.addEventListener('submit', (ev) => { ev.preventDefault(); onNext(); }); // touche Entrée

      /* --- rendu --- */
      const fp = h('code', { class: 'fp' }, '…');
      Vault.fingerprint(cfg.pk).then((f) => { fp.textContent = f; });

      const pickLang = (code) => {
        const y = window.scrollY; // on reste là où on était dans le formulaire
        st.values = snapshot(form);
        st.lang = code;
        showForm();
        window.scrollTo(0, y);
      };

      intro.append(
        App.hero({ big: true, eyebrow: 'Benvenuti in Corsica', title: cfg.nom, lead: t('lead') }),
        programmeBlock(st.lang, false) || '', // append(null) écrirait « null » dans la page
        h('div', { class: 'callout' },
          h('strong', {}, t('privacyLead')), t(cfg.collecte ? 'privacyBodySent' : 'privacyBody', { org: orgName }), cfg.adresseAuto ? ' ' + t('privacyAddr') : '',
          h('details', {},
            h('summary', {}, t('collectedSummary')),
            h('p', {}, t('collectedBody'),
              cfg.retention ? t('retentionDate', { date: App.fmtDate(App.dt(cfg.retention)) }) : t('retentionDefault'),
              cfg.contact ? t('contactRights', { contact: cfg.contact }) : ''),
            h('p', {}, t('fpLabel'), fp, h('br'), h('span', { class: 'hint' }, t('fpHint'))))),
        noticeBlock(t, orgName));

      root.replaceChildren(h('div', { class: 'wrap narrow' },
        h('div', { class: 'topbar' },
          flagBar(st.lang, pickLang),
          h('div', { class: 'progress' }, stepLabel, bar)),
        intro,
        form,
        h('div', { class: 'stepbar' }, status, h('div', { class: 'stepbtns' }, prevBtn, nextBtn))));

      /* --- valeurs initiales, ou celles de la langue précédente --- */
      if (st.values) {
        const v = st.values;
        st.values = null;
        const set = (name) => {
          const el = form.elements[name];
          if (!el || !(name in v)) return;
          if (el.type === 'checkbox') el.checked = v[name]; else el.value = v[name];
        };
        ['pays', 'tel_pays', 'permis_pays', 'boite', 'categorie', 'retrait', 'restitution', 'partage'].forEach(set);
        applyAddress(countrySel.value);
        applyLicence(licCountrySel.value);
        applyBox();
        Object.keys(v).forEach(set);
        for (const n of ['retrait', 'restitution', 'partage']) form.elements[n].dispatchEvent(new Event('change'));
      } else {
        const guess = App.detectRegion();
        if (guess) {
          countrySel.value = guess;
          syncCountry();
        } else {
          applyAddress('');
          applyLicence('');
          applyBox();
        }
      }
      refreshDial();
      updatePhoneHint(false);
      updateAdvisor();
      renderStep(false);
      window.scrollTo(0, 0);
    }

    /** « Et ensuite ? » : une estimation tarifaire suivra. */
    function noticeBlock(t, orgName) {
      return h('div', { class: 'callout notice' },
        h('strong', {}, t('noticeTitle') + ' '),
        t('noticeBody', { org: orgName }));
    }

    /* ----- 3. dossier envoyé, ou fichier prêt ----- */

    /** Durée de conservation demandée au service : jusqu'au lendemain de la date de suppression annoncée aux invités. */
    function retentionTtl() {
      const d = cfg.retention ? App.dt(cfg.retention) : null;
      return d ? Math.max(86400, Math.ceil((d.getTime() - Date.now()) / 1000) + 86400) : undefined;
    }

    /** Dépose le dossier chiffré sur le service de collecte. S'il échoue, le fichier reste le moyen de secours. */
    async function deliver() {
      st.sent = false;
      st.sendFailed = false;
      try {
        await App.collecteSend(cfg.collecte, await st.encrypted.text(), { ttl: retentionTtl() });
        st.sent = true;
      } catch (e) {
        st.sendFailed = true;
      }
    }

    function showDone() {
      const t = App.t(st.lang);
      const orgName = cfg.org || t('orgFallback');
      const file = st.encrypted;
      const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
      const automatic = !!cfg.collecte;
      const retry = h('button', { class: 'btn primary big', onclick: async () => {
        retry.disabled = true;
        retry.textContent = t('sending');
        await deliver();
        showDone();
      } }, t('retrySend'));
      // reçu : plus rien à faire. Pas de service, ou envoi raté : le fichier chiffré à transmettre soi-même.
      const manual = !st.sent;
      const lead = !manual ? t('sentLead', { org: orgName }) : t('doneLead', { org: orgName, contact: cfg.contact ? ` (${cfg.contact})` : '' });
      root.replaceChildren(h('div', { class: 'wrap narrow' },
        App.hero(manual
          ? { eyebrow: t('doneEyebrow'), title: t('doneTitle'), lead }
          : { eyebrow: t('sentEyebrow'), title: t('sentTitle'), lead }),
        st.sendFailed ? h('p', { class: 'callout warn', role: 'alert' }, t('sendFailed', { org: orgName, contact: cfg.contact ? ` (${cfg.contact})` : '' })) : null,
        h('div', { class: 'actions' },
          manual && automatic ? retry : null,
          manual && canShare ? h('button', { class: automatic ? 'btn' : 'btn primary big', onclick: async () => {
            try {
              await navigator.share({ files: [file], title: `${t('eyebrow')} – ${cfg.nom}` });
            } catch (e) { /* annulé par l'utilisateur */ }
          } }, t('send')) : null,
          manual ? h('button', { class: canShare || automatic ? 'btn' : 'btn primary big', onclick: () => App.download(file, file.name) }, t('saveFile'))
            : h('button', { class: 'btn ghost', onclick: () => App.download(file, file.name) }, t('sentCopy'))),
        noticeBlock(t, orgName),
        h('p', { class: 'note' }, t('resendNote')),
        h('p', {}, h('button', { class: 'btn ghost', onclick: showForm }, t('back')))));
      window.scrollTo(0, 0);
    }

    st.lang = detectLang();
    showForm();
  };
})();
