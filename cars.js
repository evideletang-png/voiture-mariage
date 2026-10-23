/* Choix de la catégorie de voiture d'après le nombre de personnes, de valises et de sièges enfant.
 * Règles simples et lisibles : on prend la plus petite catégorie où tout le monde et tous les bagages tiennent
 * (sur les routes de montagne corses, un gabarit inutile est un handicap autant qu'un surcoût). */
(function (root) {
  'use strict';
  const App = (root.App = root.App || {});

  // seats : places. full : grosses valises quand toutes les places sont prises.
  // spare : grosses valises quand au moins 2 places restent libres (banquette rabattue, 3e rangée repliée).
  const CAP = {
    citadine: { seats: 4, full: 1, spare: 2 },
    eco: { seats: 5, full: 2, spare: 3 },
    compacte: { seats: 5, full: 2, spare: 3 },
    suv: { seats: 5, full: 3, spare: 4 },
    monospace: { seats: 7, full: 1, spare: 4 },
    minibus: { seats: 9, full: 3, spare: 6 },
    cabriolet: { seats: 4, full: 1, spare: 1 },
  };
  const ORDER = ['citadine', 'eco', 'compacte', 'suv', 'monospace', 'minibus'];

  /** Une catégorie suffit-elle pour ce groupe ? Les sièges enfant (et la poussette qui va avec) comptent pour une valise. */
  function fits(id, pax, bags, sieges) {
    const c = CAP[id];
    if (!c) return false;
    const need = bags + (sieges > 0 ? 1 : 0);
    const room = pax <= c.seats - 2 ? c.spare : c.full;
    return pax <= c.seats && need <= room;
  }

  /** { id, why } : why = fits | seats | luggage | child | overflow. */
  function recommend(pax, bags, sieges) {
    const found = ORDER.find((id) => fits(id, pax, bags, sieges));
    if (!found) return { id: 'minibus', why: 'overflow' };
    const seatsOnly = ORDER.find((id) => pax <= CAP[id].seats);
    const withoutChild = ORDER.find((id) => fits(id, pax, bags, 0));
    let why = 'fits';
    if (found !== withoutChild) why = 'child';
    else if (found !== seatsOnly) why = 'luggage';
    else if (found !== 'citadine') why = 'seats';
    return { id: found, why };
  }

  /** Vrai si la catégorie choisie est nettement plus grande que nécessaire. */
  const oversized = (chosen, recommended) =>
    ORDER.includes(chosen) && ORDER.indexOf(chosen) - ORDER.indexOf(recommended) >= 2;

  App.fitsCategory = fits;
  App.recommendCategory = recommend;
  App.oversizedCategory = oversized;

  if (typeof module !== 'undefined' && module.exports) module.exports = App;
})(typeof window !== 'undefined' ? window : globalThis);
