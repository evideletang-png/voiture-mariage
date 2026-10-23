/* Pays, téléphone et e-mail : tout ce qui relie les champs de coordonnées entre eux.
 * Aucune donnée distante : les noms de pays viennent d'Intl.DisplayNames, dans la langue de l'invité. */
(function (root) {
  'use strict';
  const App = (root.App = root.App || {});

  // Indicatifs téléphoniques par pays (ISO 3166-1 alpha-2). Le plan nord-américain partage « 1 ».
  const RAW = 'AD376 AE971 AF93 AG1 AI1 AL355 AM374 AO244 AR54 AS1 AT43 AU61 AW297 AX358 AZ994 BA387 BB1 BD880 BE32 ' +
    'BF226 BG359 BH973 BI257 BJ229 BL590 BM1 BN673 BO591 BQ599 BR55 BS1 BT975 BW267 BY375 BZ501 CA1 CC61 CD243 CF236 ' +
    'CG242 CH41 CI225 CK682 CL56 CM237 CN86 CO57 CR506 CU53 CV238 CW599 CX61 CY357 CZ420 DE49 DJ253 DK45 DM1 DO1 DZ213 ' +
    'EC593 EE372 EG20 EH212 ER291 ES34 ET251 FI358 FJ679 FK500 FM691 FO298 FR33 GA241 GB44 GD1 GE995 GF594 GG44 GH233 ' +
    'GI350 GL299 GM220 GN224 GP590 GQ240 GR30 GT502 GU1 GW245 GY592 HK852 HN504 HR385 HT509 HU36 ID62 IE353 IL972 IM44 ' +
    'IN91 IQ964 IR98 IS354 IT39 JE44 JM1 JO962 JP81 KE254 KG996 KH855 KI686 KM269 KN1 KP850 KR82 KW965 KY1 KZ7 LA856 ' +
    'LB961 LC1 LI423 LK94 LR231 LS266 LT370 LU352 LV371 LY218 MA212 MC377 MD373 ME382 MF590 MG261 MH692 MK389 ML223 ' +
    'MM95 MN976 MO853 MP1 MQ596 MR222 MS1 MT356 MU230 MV960 MW265 MX52 MY60 MZ258 NA264 NC687 NE227 NF672 NG234 NI505 ' +
    'NL31 NO47 NP977 NR674 NU683 NZ64 OM968 PA507 PE51 PF689 PG675 PH63 PK92 PL48 PM508 PR1 PS970 PT351 PW680 PY595 ' +
    'QA974 RE262 RO40 RS381 RU7 RW250 SA966 SB677 SC248 SD249 SE46 SG65 SH290 SI386 SJ47 SK421 SL232 SM378 SN221 SO252 ' +
    'SR597 SS211 ST239 SV503 SX1 SY963 SZ268 TC1 TD235 TG228 TH66 TJ992 TK690 TL670 TM993 TN216 TO676 TR90 TT1 TV688 ' +
    'TW886 TZ255 UA380 UG256 US1 UY598 UZ998 VA39 VC1 VE58 VG1 VI1 VN84 VU678 WF681 WS685 XK383 YE967 YT262 ZA27 ZM260 ZW263';

  const DIAL = {};
  for (const m of RAW.matchAll(/([A-Z]{2})(\d+)/g)) DIAL[m[1]] = m[2];
  App.DIAL = DIAL;

  // Quand plusieurs pays partagent un indicatif, on propose celui-ci en premier.
  const PREFER = ['US', 'GB', 'IT', 'FI', 'NO', 'AU', 'FR', 'MA', 'RU', 'GP', 'RE', 'CW'];
  const DIAL_TO_ISO = {};
  for (const iso of [...PREFER, ...Object.keys(DIAL).sort()]) {
    if (!(DIAL[iso] in DIAL_TO_ISO)) DIAL_TO_ISO[DIAL[iso]] = iso;
  }

  // Pays où le 0 initial fait partie du numéro (il ne faut pas l'enlever).
  const KEEP_ZERO = new Set(['IT', 'VA', 'SM', 'BJ', 'CI']);

  // Permis reconnus sans formalité particulière : UE, EEE, Suisse, Royaume-Uni. Les autres sont signalés.
  App.PERMIS_RECONNUS = new Set(('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE ' +
    'IS LI NO CH GB').split(' '));

  /* ----- pays ----- */

  const displayNames = {};
  function names(lang) {
    if (!(lang in displayNames)) {
      try { displayNames[lang] = new Intl.DisplayNames([lang], { type: 'region' }); } catch (e) { displayNames[lang] = null; }
    }
    return displayNames[lang];
  }

  App.countryName = (code, lang = 'fr') => {
    try { return (names(lang) && names(lang).of(code)) || code || ''; } catch (e) { return code || ''; }
  };
  App.paysLabel = (code) => App.countryName(code, 'fr');

  App.countryList = (lang) => Object.keys(DIAL)
    .map((c) => [c, App.countryName(c, lang)])
    .sort((a, b) => a[1].localeCompare(b[1], lang));

  App.flag = (code) => String.fromCodePoint(...[...code].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65));

  /** Pays déduit des réglages du navigateur (fr-FR -> FR), ou ''. */
  App.detectRegion = () => {
    const langs = (root.navigator && root.navigator.languages) || [];
    for (const l of langs) {
      const m = /-([A-Za-z]{2})\b/.exec(l);
      if (m && DIAL[m[1].toUpperCase()]) return m[1].toUpperCase();
    }
    return '';
  };

  /* ----- adresse : libellés, exemples et contrôles propres à chaque pays ----- */

  const ADDRESS = {
    FR: { ph: '75011', re: /^\d{5}$/ },
    DE: { local: 'PLZ', ph: '10115', re: /^\d{5}$/ },
    IT: { local: 'CAP', ph: '00184', re: /^\d{5}$/, region: { type: 'province', ph: 'RM' } },
    ES: { ph: '28013', re: /^\d{5}$/, region: { type: 'province', ph: 'Madrid' } },
    PT: { ph: '1000-001', re: /^\d{4}-\d{3}$/ },
    BE: { ph: '1000', re: /^\d{4}$/ },
    LU: { ph: '1111', re: /^\d{4}$/ },
    NL: { ph: '1012 AB', re: /^\d{4} ?[A-Za-z]{2}$/ },
    CH: { ph: '8001', re: /^\d{4}$/ },
    AT: { ph: '1010', re: /^\d{4}$/ },
    SE: { ph: '111 22', re: /^\d{3} ?\d{2}$/ },
    DK: { ph: '1050', re: /^\d{4}$/ },
    NO: { ph: '0150', re: /^\d{4}$/ },
    FI: { ph: '00100', re: /^\d{5}$/ },
    PL: { ph: '00-001', re: /^\d{2}-\d{3}$/ },
    GR: { ph: '105 57', re: /^\d{3} ?\d{2}$/ },
    GB: { local: 'Postcode', ph: 'SW1A 1AA', re: /^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$/, cityFirst: true, region: { type: 'county', ph: 'Kent' } },
    IE: { local: 'Eircode', ph: 'D02 X285', re: /^[A-Za-z]\d{2} ?[A-Za-z0-9]{4}$/, cityFirst: true, region: { type: 'county', ph: 'Cork' } },
    US: { local: 'ZIP', ph: '94103', re: /^\d{5}(-\d{4})?$/, cityFirst: true, region: { type: 'state', required: true, ph: 'CA' } },
    CA: { ph: 'K1A 0B1', re: /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, cityFirst: true, region: { type: 'province', required: true, ph: 'ON' } },
    AU: { local: 'Postcode', ph: '2000', re: /^\d{4}$/, cityFirst: true, region: { type: 'state', required: true, ph: 'NSW' } },
  };

  /** { local, ph, re, cityFirst, region: { type, required, ph } } ; objet vide pour un pays non décrit. */
  App.addressProfile = (iso) => ADDRESS[iso] || {};

  /* ----- permis : « eu » = modèle européen à champs numérotés, « na » = États-Unis / Canada, « other » ----- */

  const EU_MODEL = new Set([...App.PERMIS_RECONNUS, 'MC', 'AD', 'SM', 'VA']);
  App.licenceFamily = (iso) => (EU_MODEL.has(iso) ? 'eu' : iso === 'US' || iso === 'CA' ? 'na' : 'other');
  App.licencePlaceholder = (iso) => ({ FR: '123456789012', GB: 'MORGA753116SM9IJ' })[iso] || '';

  /* ----- téléphone ----- */

  /** '33674694482' -> { iso: 'FR', dial: '33', national: '674694482' }, ou null. */
  function splitInternational(digits) {
    for (const len of [3, 2, 1]) {
      const dial = digits.slice(0, len);
      if (dial in DIAL_TO_ISO) return { iso: DIAL_TO_ISO[dial], dial, national: digits.slice(len) };
    }
    return null;
  }
  App.splitInternational = splitInternational;

  /**
   * Normalise un numéro saisi avec le pays choisi.
   * Accepte « 06 74… », « +33 6 74… » ou « 0033 6 74… ». Renvoie { ok, tel: '+33 674694482', iso }.
   */
  App.normalizePhone = (iso, input) => {
    const raw = String(input || '').trim();
    let digits = raw.replace(/\D/g, '');
    let dial = DIAL[iso];
    let country = iso;
    if (raw.startsWith('+') || raw.startsWith('00')) {
      if (raw.startsWith('00')) digits = digits.slice(2);
      const hit = splitInternational(digits);
      if (!hit) return { ok: false };
      ({ dial, iso: country } = hit);
      digits = hit.national;
    } else {
      if (!dial) return { ok: false };
      if (dial === '1' && digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
      else if (digits[0] === '0' && !KEEP_ZERO.has(iso)) digits = digits.slice(1);
    }
    const ok = digits.length >= 4 && dial.length + digits.length <= 15;
    return { ok, tel: ok ? `+${dial} ${digits}` : '', iso: country };
  };

  /* ----- e-mail ----- */

  const DOMAINS = ['gmail.com', 'hotmail.com', 'hotmail.fr', 'hotmail.it', 'hotmail.es', 'hotmail.co.uk', 'outlook.com',
    'outlook.fr', 'yahoo.com', 'yahoo.fr', 'yahoo.it', 'yahoo.es', 'yahoo.de', 'yahoo.co.uk', 'orange.fr', 'free.fr',
    'sfr.fr', 'wanadoo.fr', 'laposte.net', 'icloud.com', 'me.com', 'live.com', 'live.fr', 'msn.com', 'proton.me',
    'protonmail.com', 'gmx.com', 'gmx.de', 'web.de', 't-online.de', 'libero.it', 'virgilio.it', 'alice.it', 'tiscali.it',
    'bluewin.ch', 'telenet.be', 'skynet.be', 'ziggo.nl', 'btinternet.com'];

  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  /** 'zoe@gmial.com' -> 'zoe@gmail.com'. null si le domaine est connu ou trop différent. */
  App.suggestEmail = (addr) => {
    const at = String(addr || '').trim().lastIndexOf('@');
    if (at < 1) return null;
    const local = addr.trim().slice(0, at);
    const domain = addr.trim().slice(at + 1).toLowerCase();
    if (domain.length < 5 || DOMAINS.includes(domain)) return null;
    let best = null, bestD = 3;
    for (const c of DOMAINS) {
      const dist = distance(domain, c);
      if (dist < bestD) { best = c; bestD = dist; }
    }
    return best ? `${local}@${best}` : null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = App;
})(typeof window !== 'undefined' ? window : globalThis);
