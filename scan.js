/* Lecture de texte sur une photo, entièrement dans le navigateur (Tesseract.js compilé en WebAssembly).
 * Le moteur et le modèle français sont dans vendor/tesseract : rien n'est téléchargé chez un tiers, et la photo
 * n'est envoyée nulle part. Rien n'est chargé tant que l'invité n'a pas photographié son permis. */
(function () {
  'use strict';
  const App = window.App;

  const BASE = 'vendor/tesseract';
  const IDLE_MS = 45000; // le moteur occupe de la mémoire : on le libère après une pause
  let workerPromise = null;
  let idleTimer = 0;
  let onProgress = null;
  let engineLoaded = false;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('SCRIPT'));
    document.head.append(s);
  });

  async function getWorker() {
    clearTimeout(idleTimer);
    if (!workerPromise) {
      workerPromise = (async () => {
        if (!window.Tesseract) await loadScript(`${BASE}/tesseract.min.js`);
        const worker = await window.Tesseract.createWorker('fra', 1, {
          workerPath: `${BASE}/worker.min.js`,
          corePath: `${BASE}/core`,
          langPath: `${BASE}/lang`,
          workerBlobURL: false, // le moteur est lu depuis le site lui-même, pas depuis un blob
          logger: (m) => { if (onProgress) onProgress(m); },
        });
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        return worker;
      })().catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  /** Niveaux de gris et contraste étiré : aide la lecture des cartes ternes ou sous-exposées. */
  function prepare(source) {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g]++;
    }
    const total = c.width * c.height;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
    const span = Math.max(40, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Photo (data URL JPEG) -> texte reconnu. progress({ phase: 'engine' | 'read', pct }) pour informer l'invité. */
  App.scanImage = async (dataUrl, progress) => {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('IMAGE'));
      i.src = dataUrl;
    });
    let loading = !engineLoaded; // « chargement du lecteur » seulement la première fois
    onProgress = (m) => {
      if (!progress) return;
      if (m.status === 'recognizing text') progress({ phase: 'read', pct: Math.round((m.progress || 0) * 100) });
      else if (loading) progress({ phase: 'engine', pct: Math.round((m.progress || 0) * 100) });
    };
    if (progress) progress({ phase: loading ? 'engine' : 'read', pct: 0 });
    const worker = await getWorker();
    loading = false;
    engineLoaded = true;
    try {
      const { data } = await worker.recognize(prepare(img));
      return data.text || '';
    } finally {
      onProgress = null;
      idleTimer = setTimeout(App.scanRelease, IDLE_MS);
    }
  };

  App.scanRelease = async () => {
    clearTimeout(idleTimer);
    const p = workerPromise;
    workerPromise = null;
    if (!p) return;
    try { await (await p).terminate(); } catch (e) { /* déjà arrêté */ }
  };
})();
