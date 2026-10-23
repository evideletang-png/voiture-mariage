(function () {
  'use strict';
  const App = window.App;
  const root = App.$('#app');

  function fatal(title, msg) {
    root.replaceChildren(App.h('div', { class: 'wrap narrow' },
      App.h('h1', {}, title), App.h('p', { class: 'callout warn' }, msg)));
  }

  if (!window.crypto || !window.crypto.subtle) {
    return fatal('Page non sécurisée',
      'Le chiffrement n’est disponible que sur une page en HTTPS (ou localhost). Ouvrez l’adresse complète, en https://.');
  }

  if (location.hash.startsWith('#p=')) {
    const env = App.readAccessLink();
    if (env) App.renderGate(env);
    else fatal('Lien incomplet', 'Ce lien est incomplet ou abîmé. Redemandez-le à l’organisateur et copiez-le en entier.');
  } else if (location.hash.startsWith('#g=')) {
    const cfg = App.readGuestConfig();
    if (cfg) App.renderGuest(cfg);
    else fatal('Lien incomplet', 'Ce lien est incomplet ou abîmé. Redemandez-le à l’organisateur et copiez-le en entier.');
  } else {
    App.bootOrganizer();
  }

  window.addEventListener('hashchange', () => location.reload());
})();
