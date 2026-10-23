/* Lecture d'un permis de conduire à partir du texte reconnu sur ses photos (recto, verso).
 *
 * Le modèle du permis dépend du pays qui l'a délivré (option `family`, voir App.licenceFamily) :
 *   « eu »    permis au format européen, dont les champs sont numérotés (France depuis 2013, UE, Royaume-Uni, Suisse…)
 *             recto : 1 nom · 2 prénoms · 3 naissance · 4a délivrance de la carte · 4b expiration · 5 numéro
 *             verso : tableau des catégories, avec en 10 la date d'obtention de la catégorie et en 11 son expiration
 *   « na »    États-Unis et Canada : pas de champs numérotés, des étiquettes (DOB, ISS, EXP…) qui varient selon l'État ;
 *             les dates américaines s'écrivent mois/jour/année
 *   « other » aucun modèle connu : rien n'est deviné
 * Les photos de téléphone donnent un texte approximatif : on cherche d'abord les repères (confiance « haute »), puis,
 * pour le modèle européen seulement, on se rabat sur l'ordre des dates (confiance « basse »). La date de la carte
 * (4a, ISS) n'est pas la date d'obtention : elle est marquée `from: 'card'`, et pour le modèle européen `ask: true`
 * (à proposer, pas à reporter d'office, puisque la vraie date est au verso). Rien n'est jamais pris pour acquis :
 * l'invité vérifie chaque champ. Fonctions pures, testées sans aucune image. */
(function (root) {
  'use strict';
  const App = (root.App = root.App || {});

  // jj/mm/aaaa, jj.mm.aa, jj mm aaaa… avec les confusions courantes de la reconnaissance (O pour 0, I ou l pour 1)
  const DIGIT = '[0-9OIl]';
  const DATE_SRC = `(${DIGIT}{1,2})\\s*[./\\- ]\\s*(${DIGIT}{1,2})\\s*[./\\- ]\\s*(${DIGIT}{4}|${DIGIT}{2})`;
  const num = (s) => Number(String(s).replace(/[Oo]/g, '0').replace(/[Il]/g, '1'));
  const p2 = (n) => String(n).padStart(2, '0');

  /** Année sur 2 chiffres -> sur 4 : « past » pour une date déjà passée, « future » pour une échéance. */
  const fullYear = (raw, kind, today) => {
    if (String(raw).length === 4) return num(raw);
    const yy = num(raw);
    const cur = today.getFullYear() % 100;
    return kind === 'future' ? 2000 + yy : yy <= cur ? 2000 + yy : 1900 + yy;
  };

  const toIso = (d, m, y, kind, today) => {
    const day = num(d), month = num(m), year = fullYear(y, kind, today);
    if (!(year >= 1900 && year <= 2100) || month < 1 || month > 12 || day < 1) return null;
    if (day > new Date(year, month, 0).getDate()) return null;
    return `${year}-${p2(month)}-${p2(day)}`;
  };

  /** Toutes les dates valides d'un texte, dans l'ordre de lecture. */
  const allDates = (text, kind, today) => {
    const out = [];
    const re = new RegExp(DATE_SRC, 'g');
    let m;
    while ((m = re.exec(text))) {
      const iso = toIso(m[1], m[2], m[3], kind, today);
      if (iso) out.push({ iso, index: m.index });
    }
    return out;
  };

  /** Première date qui suit un repère (« 4a », « 3. »…). */
  const dateAfter = (text, markerSrc, kind, today) => {
    const m = new RegExp(`(?:^|[^0-9A-Za-z])${markerSrc}\\s*${DATE_SRC}`, 'i').exec(text);
    return m ? toIso(m[1], m[2], m[3], kind, today) : null;
  };

  const clean = (t) => String(t || '').replace(/[|_¦]/g, ' ').replace(/\r/g, '').replace(/[ \t]+/g, ' ');

  const found = (value, conf) => (value ? { value, conf } : null);

  const lineAfter = (text, marker) => {
    const m = new RegExp(`(?:^|\\n)[^\\n0-9A-Za-z]*${marker}\\s*[.:)]\\s*([^\\n]{2,70})`, 'i').exec(text);
    if (!m) return null;
    return m[1].split(/\s+\d{1,2}[a-z]?\s*[.:)]/)[0].replace(/[^A-Za-zÀ-ÿ'’\- ,]/g, ' ').replace(/\s+/g, ' ').trim() || null;
  };

  const emptyResult = () => ({ numero: null, delivrance: null, expiration: null, naissance: null, nom: null, prenom: null });

  /* ----- modèle européen ----- */

  const parseEurope = (front, back, today) => {
    const F = clean(front);
    const B = clean(back);
    const res = emptyResult();

    /* --- recto : repères numérotés --- */
    let dob = dateAfter(F, '3\\s*[.:)]', 'past', today);
    let issue4a = dateAfter(F, '4\\s*a[.:)]?', 'past', today);
    let expiry4b = dateAfter(F, '4\\s*b[.:)]?', 'future', today);
    let conf = { dob: 'high', issue: 'high', expiry: 'high' };

    // repli : trois dates ou plus au recto = naissance, délivrance, expiration dans l'ordre chronologique
    if (!dob || !issue4a || !expiry4b) {
      const sorted = [...new Set(allDates(F, 'past', today).map((d) => d.iso))].sort();
      if (sorted.length >= 3) {
        if (!dob) { dob = sorted[0]; conf.dob = 'low'; }
        if (!issue4a) { issue4a = sorted[sorted.length - 2]; conf.issue = 'low'; }
        if (!expiry4b) { expiry4b = sorted[sorted.length - 1]; conf.expiry = 'low'; }
      }
    }
    if (expiry4b && issue4a && expiry4b < issue4a) { expiry4b = null; }

    // numéro : champ 5, puis repli sur 12 chiffres d'affilée (permis français)
    const mNum = /(?:^|[^0-9A-Za-z])5\s*[.:)]\s*([A-Za-z0-9][A-Za-z0-9 \-]{5,30})/.exec(F);
    if (mNum) {
      const token = mNum[1].split(/\s+\d{1,2}[A-Za-z]?\s*[.:)]/)[0].replace(/[ \-]/g, '').toUpperCase();
      if (/^[A-Z0-9]{6,20}$/.test(token) && /\d/.test(token)) res.numero = found(token, 'high');
    }
    if (!res.numero) {
      const twelve = /(?<![0-9])\d{12}(?![0-9])/.exec(F.replace(/(\d)[ ](?=\d)/g, '$1'));
      if (twelve) res.numero = found(twelve[0], 'low');
    }

    res.naissance = found(dob, conf.dob);
    res.nom = found(lineAfter(F, '1'), 'high');
    const firstNames = lineAfter(F, '2');
    res.prenom = found(firstNames ? firstNames.split(/[ ,]/)[0] : null, 'high');

    /* --- verso : ligne de la catégorie B (10 = obtention, 11 = expiration) --- */
    const rowB = new RegExp(`(?:^|\\n)[^\\nA-Za-z0-9]*B\\s+${DATE_SRC}(?:\\s+${DATE_SRC})?`).exec(B);
    let issue10 = null;
    let expiry11 = null;
    if (rowB) {
      issue10 = toIso(rowB[1], rowB[2], rowB[3], 'past', today);
      if (rowB[4]) expiry11 = toIso(rowB[4], rowB[5], rowB[6], 'future', today);
    }

    /* --- assemblage --- */
    const todayIso = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
    if (issue10 && issue10 <= todayIso) res.delivrance = found(issue10, 'high');
    // la carte peut dater d'un renouvellement ou d'un remplacement : c'est une proposition, la vraie date est au verso
    else if (issue4a && issue4a <= todayIso) res.delivrance = { ...found(issue4a, 'low'), from: 'card', ask: true };
    const expiry = expiry4b || expiry11;
    if (expiry && (!res.delivrance || expiry > res.delivrance.value)) {
      res.expiration = found(expiry, expiry4b ? conf.expiry : 'low');
    }
    return res;
  };

  /* ----- États-Unis et Canada : des étiquettes, pas de champs numérotés ----- */

  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

  /**
   * Première date au début de `s` : AAAA-MM-JJ, 15 MAR 1990, MAR 15 1990, puis X/Y/AAAA. Aux États-Unis c'est mois/jour ;
   * ailleurs (Canada) l'ordre varie : on ne tranche que si un des deux nombres dépasse 12, sinon on ne devine pas.
   */
  function naDate(s, country, kind, today) {
    const str = String(s).replace(/,/g, ' ');
    let m = new RegExp(`^\\s*(${DIGIT}{4})\\s*[./\\-]\\s*(${DIGIT}{1,2})\\s*[./\\-]\\s*(${DIGIT}{1,2})(?!\\d)`).exec(str);
    if (m) return toIso(m[3], m[2], m[1], kind, today);
    m = /^\s*(\d{1,2})\s*[./\- ]?\s*([A-Za-z]{3})[A-Za-z]*\.?\s*[./\- ]?\s*(\d{4})/.exec(str);
    if (m && MONTHS[m[2].toUpperCase()]) return toIso(m[1], MONTHS[m[2].toUpperCase()], m[3], kind, today);
    m = /^\s*([A-Za-z]{3})[A-Za-z]*\.?\s*[./\- ]?\s*(\d{1,2})\s*[./\- ]?\s*(\d{4})/.exec(str);
    if (m && MONTHS[m[1].toUpperCase()]) return toIso(m[2], MONTHS[m[1].toUpperCase()], m[3], kind, today);
    m = new RegExp(`^\\s*(${DIGIT}{1,2})\\s*[./\\- ]\\s*(${DIGIT}{1,2})\\s*[./\\- ]\\s*(${DIGIT}{4}|${DIGIT}{2})(?!\\d)`).exec(str);
    if (!m) return null;
    const a = num(m[1]);
    const b = num(m[2]);
    if (country === 'US') return toIso(b, a, m[3], kind, today);
    if (a > 12 && b <= 12) return toIso(a, b, m[3], kind, today);
    if (b > 12 && a <= 12) return toIso(b, a, m[3], kind, today);
    return null;
  }

  // « ORIG ISS », « 1ST ISSUED »… doivent être lues avant « ISS » (on efface chaque étiquette une fois lue)
  const NA_LABEL = {
    orig: '(?:ORIG(?:INAL)?\\.?[ \\t]*(?:ISS(?:UE|UED)?\\.?)?|ORG\\.?[ \\t]*ISS|(?:1ST|FIRST)[ \\t]*(?:ISS(?:UE|UED)?|LICEN[SC]ED))(?:[ \\t]+DATE)?',
    dob: '(?:DOB|D\\.O\\.B\\.?|DATE[ \\t]+OF[ \\t]+BIRTH|BIRTH[ \\t]*DATE|BORN|DATE[ \\t]+DE[ \\t]+NAISSANCE)',
    exp: "(?:EXP(?:IRES?|IRY|IRATION)?|VALID[ \\t]+(?:UNTIL|THRU)|DATE[ \\t]+D['’]EXPIRATION)(?:[ \\t]+DATE)?",
    iss: '(?:ISS(?:UE|UED)?)(?:[ \\t]+DATE)?',
  };
  const NA_NUMBER = "(?:DLN|DL|LIC(?:ENSE|ENCE)?[ \\t]*(?:NO|NUM(?:BER)?|#)|DRIVER['’]?S?[ \\t]+LICEN[SC]E[ \\t]*(?:NO|NUM(?:BER)?|#)|ID[ \\t]*(?:NO|#))";
  const NA_STOP = new Set(['LN', 'FN', 'DOB', 'ISS', 'EXP', 'SEX', 'CLASS', 'DL', 'DLN', 'DD', 'HGT', 'WGT', 'EYES', 'HAIR', 'END', 'REST', 'ORG']);

  const parseNorthAmerica = (front, back, country, today) => {
    const res = emptyResult();
    let text = `${clean(front)}\n${clean(back)}`;
    const todayIso = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;

    /** Première date lisible qui suit l'étiquette ; l'étiquette est ensuite effacée pour qu'une autre ne la reprenne pas. */
    const labelled = (labelSrc, kind) => {
      const re = new RegExp(`(?:^|[^A-Za-z0-9])(?:${labelSrc})(?![A-Za-z])[ \\t]*[:.#\\-]?[ \\t]*([^\\n]{0,30})`, 'gi');
      let m;
      while ((m = re.exec(text))) {
        const iso = naDate(m[1], country, kind, today);
        if (iso) {
          const end = m.index + m[0].length - m[1].length;
          text = text.slice(0, m.index) + ' '.repeat(end - m.index) + text.slice(end);
          return iso;
        }
      }
      return null;
    };
    const orig = labelled(NA_LABEL.orig, 'past');
    const dob = labelled(NA_LABEL.dob, 'past');
    const exp = labelled(NA_LABEL.exp, 'future');
    const iss = labelled(NA_LABEL.iss, 'past');

    res.naissance = found(dob, 'high');
    if (orig && orig <= todayIso && (!dob || orig > dob)) res.delivrance = found(orig, 'high');
    else if (iss && iss <= todayIso) res.delivrance = { ...found(iss, 'low'), from: 'card' }; // souvent un renouvellement
    if (exp && (!res.delivrance || exp > res.delivrance.value)) res.expiration = found(exp, 'high');

    // numéro : seulement derrière une étiquette (DL, DLN, LIC NO…), le format change d'un État à l'autre
    const mNum = new RegExp(`(?:^|[^A-Za-z0-9])${NA_NUMBER}(?![A-Za-z])[ \\t]*[:.#]?[ \\t]*([A-Za-z0-9][A-Za-z0-9\\-]*(?: \\d[A-Za-z0-9\\-]*)*)`, 'i').exec(text);
    if (mNum) {
      const token = mNum[1].replace(/[ \-]/g, '').toUpperCase();
      if (/^[A-Z0-9]{5,20}$/.test(token) && /\d/.test(token)) res.numero = found(token, 'high');
    }

    // noms : seulement derrière LN / FN ou « Last name » / « First name »
    const nameAfter = (labelSrc) => {
      const m = new RegExp(`(?:^|[^A-Za-z0-9])(?:${labelSrc})(?![A-Za-z])[ \\t]*[:.]?[ \\t]+([A-Za-z][A-Za-z'’\\-]*(?: [A-Za-z][A-Za-z'’\\-]*){0,3})`, 'i').exec(text);
      if (!m) return null;
      const words = [];
      for (const w of m[1].split(' ')) { if (NA_STOP.has(w.toUpperCase())) break; words.push(w); }
      return words.join(' ') || null;
    };
    res.nom = found(nameAfter('LN|LAST[ \\t]+NAME|SURNAME|FAMILY[ \\t]+NAME'), 'high');
    const given = nameAfter('FN|FIRST[ \\t]+NAME|GIVEN[ \\t]+NAMES?');
    res.prenom = found(given ? given.split(' ')[0] : null, 'high');
    return res;
  };

  /**
   * { front, back } (textes reconnus) -> { numero, delivrance, expiration, naissance, nom, prenom },
   * chaque entrée valant null ou { value, conf: 'high' | 'low', from?: 'card', ask?: true }. Dates en AAAA-MM-JJ.
   * Options : family = 'eu' (défaut) | 'na' | 'other' ; country = code ISO du pays du permis (« US » : dates mois/jour).
   */
  App.parseLicence = ({ front = '', back = '' } = {}, { today = new Date(), family = 'eu', country = '' } = {}) => {
    if (family === 'other') return emptyResult();
    if (family === 'na') return parseNorthAmerica(front, back, country, today);
    return parseEurope(front, back, today);
  };

  /* ----- recoupement avec ce que l'invité a tapé ----- */

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  const near = (a, b) => {
    if (!a || !b) return null;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
    let diff = 0;
    for (let i = 0, j = 0; i < a.length && j < b.length; i++, j++) {
      if (a[i] !== b[j]) { diff++; if (a.length > b.length) j--; else if (b.length > a.length) i--; }
      if (diff > 1) return false;
    }
    return true;
  };

  /** true = concordant, false = différent, null = pas assez d'éléments pour juger. */
  App.compareIdentity = (scan, typed) => ({
    nom: near(norm(scan.nom && scan.nom.value), norm(typed.nom)),
    prenom: near(norm(scan.prenom && scan.prenom.value), norm(typed.prenom)),
    naissance: scan.naissance && typed.naissance ? scan.naissance.value === typed.naissance : null,
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = App;
})(typeof window !== 'undefined' ? window : globalThis);
