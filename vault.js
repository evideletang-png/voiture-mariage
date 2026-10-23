/* Chiffrement dans le navigateur (WebCrypto), sans dépendance.
 *
 * Invité  : génère une clé éphémère, dérive une clé AES-256-GCM avec la clé
 *           publique de l'organisateur (ECDH P-256 + HKDF-SHA256), chiffre, jette la clé.
 * Organisateur : sa clé privée n'existe qu'enveloppée par une phrase de passe
 *           (PBKDF2-SHA256 600 000 tours + AES-256-GCM).
 */
(function (root) {
  'use strict';

  const subtle = () => root.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const KDF_ITERATIONS = 600000;
  const ACCESS_ITERATIONS = 300000; // mot de passe d'accès des invités : ils ouvrent la page depuis un téléphone
  const ACCESS_AAD = 'mariage-voiture/acces';
  const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
  const INFO = 'mariage-voiture/v1';

  function toB64u(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64u(str) {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const random = (n) => root.crypto.getRandomValues(new Uint8Array(n));

  /** Empreinte courte d'une clé publique, à comparer à voix haute ou par SMS. */
  async function fingerprint(publicKeyB64u) {
    const digest = new Uint8Array(await subtle().digest('SHA-256', fromB64u(publicKeyB64u)));
    const hex = Array.from(digest.subarray(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
    return hex.toUpperCase().match(/.{4}/g).join(' ');
  }

  async function passphraseKey(passphrase, salt, iterations) {
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 5000000) {
      throw new Error('BAD_KEYFILE');
    }
    const base = await subtle().importKey(
      'raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function passphraseProblem(p) {
    if (p.length < 14) return 'Au moins 14 caractères (une phrase de 4 mots au hasard fait très bien l’affaire).';
    if (new Set(p).size < 6) return 'Trop répétitif.';
    return null;
  }

  /** Crée la paire de clés. La clé privée n'est renvoyée qu'enveloppée. */
  async function createOrganizerKey(passphrase) {
    const pair = await subtle().generateKey(CURVE, true, ['deriveBits']);
    const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
    const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
    const salt = random(16);
    const iv = random(12);
    const key = await passphraseKey(passphrase, salt, KDF_ITERATIONS);
    const ct = new Uint8Array(
      await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: pub }, key, pkcs8));
    pkcs8.fill(0);
    return {
      publicKey: toB64u(pub),
      wrapped: {
        v: 1, kdf: 'PBKDF2-SHA256', iter: KDF_ITERATIONS,
        salt: toB64u(salt), iv: toB64u(iv), ct: toB64u(ct),
      },
    };
  }

  /** Renvoie la clé privée (non exportable) ou lève BAD_PASSPHRASE. */
  async function unlockOrganizerKey(org, passphrase) {
    const w = org.wrapped;
    const key = await passphraseKey(passphrase, fromB64u(w.salt), w.iter);
    let pkcs8;
    try {
      pkcs8 = await subtle().decrypt(
        { name: 'AES-GCM', iv: fromB64u(w.iv), additionalData: fromB64u(org.publicKey) },
        key, fromB64u(w.ct));
    } catch (e) {
      throw new Error('BAD_PASSPHRASE');
    }
    const priv = await subtle().importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']);
    new Uint8Array(pkcs8).fill(0);
    return priv;
  }

  async function sessionKey(sharedBits, epk, rpk) {
    const hk = await subtle().importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    const label = enc.encode(INFO);
    const info = new Uint8Array(label.length + epk.length + rpk.length);
    info.set(label, 0);
    info.set(epk, label.length);
    info.set(rpk, label.length + epk.length);
    return subtle().deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info },
      hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /** Chiffre un objet pour le détenteur de la clé publique. */
  async function encryptFor(publicKeyB64u, obj) {
    const rpk = fromB64u(publicKeyB64u);
    const recipient = await subtle().importKey('raw', rpk, CURVE, false, []);
    const eph = await subtle().generateKey(CURVE, false, ['deriveBits']);
    const epk = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
    const bits = await subtle().deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256);
    const key = await sessionKey(bits, epk, rpk);
    const iv = random(12);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return {
      app: 'mariage-voiture', v: 1,
      kid: (await fingerprint(publicKeyB64u)).replace(/ /g, '').slice(0, 8),
      epk: toB64u(epk), iv: toB64u(iv), ct: toB64u(ct),
    };
  }

  /** Déchiffre une enveloppe. Lève NOT_FOR_THIS_KEY si ce n'est pas la bonne clé ou si le fichier est altéré. */
  async function decryptEnvelope(privateKey, publicKeyB64u, env) {
    if (!env || env.app !== 'mariage-voiture' || env.v !== 1 ||
        typeof env.epk !== 'string' || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
      throw new Error('BAD_FORMAT');
    }
    try {
      const epk = fromB64u(env.epk);
      const sender = await subtle().importKey('raw', epk, CURVE, false, []);
      const bits = await subtle().deriveBits({ name: 'ECDH', public: sender }, privateKey, 256);
      const key = await sessionKey(bits, epk, fromB64u(publicKeyB64u));
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64u(env.iv) }, key, fromB64u(env.ct));
      return JSON.parse(dec.decode(plain));
    } catch (e) {
      throw new Error('NOT_FOR_THIS_KEY');
    }
  }

  /**
   * Ce que l'invité tape sur un téléphone n'est jamais identique au caractère près : majuscules automatiques, espaces,
   * tirets oubliés. On compare donc sans casse, espaces ni tirets. Un code généré (32 symboles en majuscules) ne perd rien.
   */
  function accessSecret(password) {
    return String(password == null ? '' : password).normalize('NFKC').toUpperCase().replace(/[\s\-_.]+/g, '');
  }

  /** Enveloppe -> texte compact pour un fragment d'URL : version.tours.sel.nonce.chiffré (rien de plus). */
  function packEnvelope(env) {
    return [env.v, env.iter, env.salt, env.iv, env.ct].join('.');
  }

  /** Texte -> enveloppe, ou null si le lien est abîmé. */
  function unpackEnvelope(text) {
    const parts = String(text).split('.');
    if (parts.length !== 5 || parts[0] !== '1' || !/^\d{1,8}$/.test(parts[1]) || !parts.slice(2).every((x) => /^[\w-]+$/.test(x))) return null;
    return { v: 1, kdf: 'PBKDF2-SHA256', iter: Number(parts[1]), salt: parts[2], iv: parts[3], ct: parts[4] };
  }

  /**
   * Enveloppe un objet avec un mot de passe (PBKDF2 + AES-256-GCM). Sert au lien invités : sans le mot de passe,
   * le lien ne dit rien de l'événement ni de la clé publique. Le mot de passe n'est ni stocké ni envoyé.
   */
  async function sealWithPassword(obj, password) {
    const salt = random(16);
    const iv = random(12);
    const secret = accessSecret(password);
    if (!secret) throw new Error('EMPTY_PASSWORD');
    const key = await passphraseKey(secret, salt, ACCESS_ITERATIONS);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(ACCESS_AAD) }, key, enc.encode(JSON.stringify(obj)));
    return { v: 1, kdf: 'PBKDF2-SHA256', iter: ACCESS_ITERATIONS, salt: toB64u(salt), iv: toB64u(iv), ct: toB64u(ct) };
  }

  /** Ouvre une enveloppe : l'objet, ou BAD_PASSWORD (mauvais mot de passe ou contenu altéré), ou BAD_FORMAT. */
  async function openWithPassword(env, password) {
    if (!env || env.v !== 1 || typeof env.salt !== 'string' || typeof env.iv !== 'string' || typeof env.ct !== 'string' || !Number.isInteger(env.iter)) {
      throw new Error('BAD_FORMAT');
    }
    const key = await passphraseKey(accessSecret(password), fromB64u(env.salt), env.iter); // BAD_KEYFILE si le nombre de tours est absurde
    try {
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64u(env.iv), additionalData: enc.encode(ACCESS_AAD) }, key, fromB64u(env.ct));
      return JSON.parse(dec.decode(plain));
    } catch (e) {
      throw new Error('BAD_PASSWORD');
    }
  }

  /** Mot de passe lisible pour le ZIP : 4 × 4 caractères sur 32 symboles = 80 bits. */
  function randomCode(groups = 4, size = 4) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symboles : pas de biais avec & 31
    const chars = Array.from(random(groups * size), (b) => alphabet[b & 31]);
    const out = [];
    for (let g = 0; g < groups; g++) out.push(chars.slice(g * size, (g + 1) * size).join(''));
    return out.join('-');
  }

  const Vault = {
    KDF_ITERATIONS, toB64u, fromB64u, fingerprint, passphraseProblem,
    createOrganizerKey, unlockOrganizerKey, encryptFor, decryptEnvelope, randomCode, sealWithPassword, openWithPassword, accessSecret, packEnvelope, unpackEnvelope,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Vault;
  else root.Vault = Vault;
})(typeof window !== 'undefined' ? window : globalThis);
