/* Estimation tarifaire : prix public saisi par ligne, remise, part de chaque invité, message dans sa langue.
 * Fonctions pures : rien ici ne touche au DOM. */
(function (root) {
  'use strict';
  const App = (root.App = root.App || {});

  const p2 = (n) => String(n).padStart(2, '0');
  const day = (d) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '');

  /** Deux voitures de même catégorie, mêmes lieux et mêmes jours partagent la même ligne de devis, donc le même prix. */
  App.lineKey = (car) =>
    [car.categorie, car.boite, car.lieuRetrait, car.lieuRetour, day(car.retrait), day(car.retour)].join('|');

  /** Prix public -> prix après remise, à l'euro près. */
  App.discounted = (price, pct) => Math.round(price * (1 - pct / 100));

  /** Part d'un invité dans une voiture partagée, au prorata des personnes qu'il emmène. */
  App.memberShare = (perCar, memberPax, carPax) => (carPax > 0 ? Math.round((perCar * memberPax) / carPax) : perCar);

  /**
   * Message de retour pour un invité, dans sa langue.
   * o : { lang, name, org, perCar, shared, pax, share,
   *       car: { categorie, boite, lieuRetrait, lieuRetour, retrait, retour } }
   */
  App.estimateMessage = (o) => {
    const lang = ['fr', 'en', 'it', 'de', 'es'].includes(o.lang) ? o.lang : 'fr';
    const t = App.t(lang);
    const c = o.car;
    const eur = (n) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
    const date = (d) => (d ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(d) : '');
    const time = (d) => (d ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : '');
    const shortCat = t('cat.' + c.categorie).replace(/ \(.*\)$/, '');
    const one = lang === 'fr' ? o.pax < 2 : o.pax === 1;

    const lines = [
      t('estHello', { name: o.name }), '',
      t('estIntro'), '',
      t('estCar', { cat: shortCat, box: t('box.' + c.boite) }),
      t('estPickup', { place: c.lieuRetrait, date: date(c.retrait), time: time(c.retrait) }),
      t('estReturn', { place: c.lieuRetour, date: date(c.retour), time: time(c.retour) }),
      t('estPrice', { price: eur(o.perCar) }),
    ];
    if (o.shared) {
      lines.push(t('estShare', { persons: `${o.pax} ${t(one ? 'paxWord1' : 'paxWord')}`, share: eur(o.share) }), t('estShared'));
    }
    lines.push('', t('estBasis'), '', t('estClosing'), '', t('estBye'), o.org);
    return lines.join('\n');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = App;
})(typeof window !== 'undefined' ? window : globalThis);
