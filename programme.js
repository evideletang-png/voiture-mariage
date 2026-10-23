/* Programme de l'événement : une ligne par rendez-vous (date | titre | lieu).
 * Sert à l'accueil invité et à proposer des dates d'arrivée et de retour. Fonctions pures. */
(function (root) {
  'use strict';
  const App = (root.App = root.App || {});

  const p2 = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const MAX = 8;

  /** 'AAAA-MM-JJ' réellement existant (2027-02-31 est refusé). */
  const isDate = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T00:00');
    return !Number.isNaN(d.getTime()) && iso(d) === s;
  };

  /** Liste quelconque -> liste propre, triée par date. */
  App.normalizeProgramme = (list) =>
    (Array.isArray(list) ? list : [])
      .map((e) => ({
        date: e && isDate(e.date) ? e.date : '',
        titre: String((e && e.titre) || '').trim().slice(0, 80),
        lieu: String((e && e.lieu) || '').trim().slice(0, 80),
      }))
      .filter((e) => e.date && e.titre)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, MAX);

  /** Texte saisi par l'organisateur -> { entries, errors } ; errors = numéros des lignes illisibles. */
  App.parseProgramme = (text) => {
    const entries = [];
    const errors = [];
    String(text || '').split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const [date, titre, ...rest] = line.split('|').map((x) => x.trim());
      if (!isDate(date) || !titre) errors.push(i + 1);
      else entries.push({ date, titre, lieu: rest.join(' | ') });
    });
    return { entries: App.normalizeProgramme(entries), errors };
  };

  App.programmeText = (entries) =>
    (entries || []).map((e) => (e.lieu ? `${e.date} | ${e.titre} | ${e.lieu}` : `${e.date} | ${e.titre}`)).join('\n');

  /** Dates proposées : la veille du premier rendez-vous à midi, le lendemain du dernier à 10 h. */
  App.stayDefaults = (programme) => {
    if (!programme || !programme.length) return null;
    const first = new Date(programme[0].date + 'T00:00');
    const last = new Date(programme[programme.length - 1].date + 'T00:00');
    first.setDate(first.getDate() - 1);
    last.setDate(last.getDate() + 1);
    return { arrivee: `${iso(first)}T12:00`, retour: `${iso(last)}T10:00` };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = App;
})(typeof window !== 'undefined' ? window : globalThis);
