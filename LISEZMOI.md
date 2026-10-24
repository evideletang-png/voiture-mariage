# Voitures du mariage

Outil pour recueillir les infos de location de voiture de vos invités (identité, permis, trajet), puis préparer la demande de devis et la réservation pour le loueur (Europcar en Corse).

Il n'y a **pas de serveur** : tout se passe dans les navigateurs. Les dossiers sont chiffrés chez l'invité, et seul l'organisateur peut les ouvrir.

## Mise en ligne (une fois)

Les invités ont besoin d'une adresse HTTPS. Le plus simple : déposer **tout ce dossier** sur [Netlify Drop](https://app.netlify.com/drop), Cloudflare Pages ou GitHub Pages. Netlify et Cloudflare appliquent `_headers` (politique de sécurité renforcée) ; GitHub Pages l'ignore, la politique dans `index.html` reste active.

Pour tester chez vous : `python3 serve.py` dans ce dossier, puis http://localhost:8765 (Ctrl + C pour arrêter). `serve.py` ne garde rien en cache, donc un rechargement montre toujours la dernière version, et il n'écoute que votre ordinateur.

À ne pas faire : ouvrir `index.html` par double-clic. Le lien invité ne marcherait pas chez les autres (non testé non plus en `file://`).

## Déroulé

1. **Vous** ouvrez l'adresse, remplissez l'événement, choisissez une phrase de passe, téléchargez le fichier de clé et rangez-le.
2. Onglet **Réglages** : copiez le lien invités, le mot de passe qui l'accompagne et notez l'empreinte de clé. Envoyez les trois aux invités, le mot de passe de préférence dans un second message.
3. **Chaque invité** ouvre le lien, saisit le mot de passe, choisit sa langue, remplit le formulaire, puis son navigateur produit un fichier `.txt` chiffré qu'il vous envoie (partage direct sur mobile, e-mail, WhatsApp…).
4. **Vous** déverrouillez l'outil et importez les fichiers (onglet Invités). Les alertes signalent jeunes conducteurs, permis récents ou expirés, dates incohérentes.
5. Onglet **Voitures** : regroupez ceux qui partagent. Le loueur facture par véhicule.
6. Onglet **Export** :
   - la *demande de devis* ne contient aucune donnée personnelle : elle part par e-mail ordinaire ;
   - l'*estimation tarifaire* : vous saisissez le prix public Europcar d'une voiture pour chaque ligne du devis, l'outil applique votre remise (20 % au départ, réglable) et calcule le total par ligne et la part de chaque invité dans une voiture partagée. Il prépare un message par invité, dans sa langue, modifiable avant l'envoi. Ce message ne contient que le prix final : ni remise, ni prix public, ni nom du loueur. La remise et les prix restent dans votre navigateur ;
   - le *dossier de réservation* est un ZIP AES-256 : envoyez le mot de passe par SMS ou téléphone, jamais dans le même message.

## Apparence

- Style contemporain dans l'esprit du faire-part : fond ivoire, or en accent (progression, boutons, filets), titres en Cormorant Garamond léger avec l'esperluette en italique doré, texte en Inter. Les couleurs sont en tête de `style.css` ; l'or de texte est assombri pour rester lisible. Mode sombre inclus.
- Les polices sont dans `fonts/` et servies par le site lui-même (licence SIL OFL, fichiers de licence joints) : rien n'est chargé chez un tiers, la politique de sécurité n'autorise que le site lui-même.
- Le formulaire invité se remplit **en 5 étapes** (vous, permis, séjour, voiture, fin) avec une barre de progression, un bouton « Continuer » toujours à portée de pouce, des contrôles étape par étape, et la possibilité de revenir en arrière. La page d'accueil (couverture, programme, confidentialité) s'affiche au début de la première étape.
- Le visuel d'accueil montre le golfe d'Ajaccio, l'aéroport (AJA) et Coti-Chiavari, lieu du mariage, avec la Corse entière en médaillon. Tout est dessiné en SVG (`carte.js`, généré) : aucune image distante.
- Les lieux de retrait proposés par défaut commencent par Ajaccio ; modifiez-les dans les réglages.

## Pensé pour le smartphone

Champs pleine largeur, cibles tactiles de 48 px, polices de 16 px (pas de zoom automatique sur iPhone), clavier adapté à chaque champ (téléphone, e-mail, chiffres pour les codes postaux, majuscules pour les noms et les numéros de permis ou de vol), correction automatique coupée sur les champs où elle gêne. Vérifié sur un affichage émulé à 375 px ; à essayer sur un vrai téléphone avant d'envoyer le lien.

## Mot de passe des invités

Un mot de passe est proposé à la création (3 groupes de 4 caractères au hasard, 60 bits) ; vous pouvez le changer ou le retirer (Réglages > Événement).

- **Ce que voit quelqu'un qui a le lien sans le mot de passe** : une page « Invitation privée », sans nom d'événement, sans carte. Le nom, le programme, vos coordonnées et votre clé publique sont chiffrés dans le lien (PBKDF2 300 000 tours + AES-256-GCM) : sans le mot de passe, ils sont illisibles, et personne ne peut fabriquer de dossier à votre intention.
- **Sur téléphone** : majuscules, espaces et tirets ne comptent pas (`k7m2 9qxd 4trb` ouvre `K7M2-9QXD-4TRB`). La langue choisie sur cette page est gardée pour le formulaire, et un rechargement de l'onglet ne redemande pas le mot de passe.
- **Le mot de passe n'est jamais dans le lien**, ni dans les dossiers.
- **Un seul mot de passe pour tous** : il filtre qui ouvre le formulaire, il ne protège pas les dossiers (eux le sont par votre clé, quoi qu'il arrive). Si vous le changez, le lien change aussi ; l'ancien lien continue d'ouvrir le formulaire chez ceux qui ont l'ancien mot de passe.
- **Choisissez-le long.** Quelqu'un qui obtient le lien peut tester des mots de passe sur son propre ordinateur, sans limite de tentatives : un mot courant tomberait vite, un code généré, non.
- **Il est enregistré en clair dans les réglages de l'événement**, donc dans le fichier de clé que vous téléchargez (la clé privée, elle, reste verrouillée par votre phrase de passe). Gardez ce fichier pour vous.

## Ce que le formulaire fait pour des invités internationaux

- **Programme** : les rendez-vous de l'événement (réglage « Programme », une ligne `AAAA-MM-JJ | titre | lieu`) s'affichent sur l'accueil et dans la partie « séjour », avec les dates dans la langue de l'invité. Le titre peut être bilingue (« Mariage · Wedding »). Préremplis : mariage le 30 mai 2027 au Jardin de Coti, journée plage le 31 à Mare E Sole.
- **Dates proposées** : l'arrivée est préremplie la veille du premier rendez-vous (12 h), le retour le lendemain du dernier (10 h), avec une phrase qui dit de les ajuster. Côté organisateur, une alerte signale les arrivées après le début du programme et les départs avant sa fin.
- **Langue** : français, anglais, italien, allemand, espagnol. Une barre de drapeaux reste collée en haut de la page ; le formulaire s'ouvre directement dans la langue du navigateur, et un clic sur un drapeau change tout, sans perdre ce qui est saisi ni la position dans la page. Vous décidez des langues proposées (réglages).
- **Pays de résidence** : il commande le reste tant que l'invité ne choisit pas lui-même. Il présélectionne l'indicatif du téléphone, le pays du permis et, pour les pays où l'automatique est la norme (États-Unis, Canada, Australie…), la boîte automatique.
- **Téléphone** : indicatif compact (drapeau + code, la liste complète s'ouvre au toucher) collé à un numéro en pleine largeur, avec un exemple grisé du bon format pour le pays (`06 12 34 56 78`, `(415) 555-0100`…) et un aperçu du numéro tel qu'il sera enregistré (`✓ +33 6 74 69 44 82`). **Les chiffres s'espacent au fil de la frappe** à la mode du pays (`06 74 69 44 82`, `07911 123456`, `0151 12345678`, `333 123 4567`, `(415) 555-0100`…), le curseur restant derrière le même chiffre ; le 0 de tête n'est affiché que si l'invité l'a tapé. Règles d'espacement écrites à la main pour FR, GB, DE, AT, CH, IT, ES, PT, BE, NL, LU, IE, AU, DK, SE, NO, PL, US et CA (certains fixes ou numéros spéciaux peuvent s'espacer autrement) ; ailleurs, groupes de 3 chiffres. Numéro enregistré au format international espacé (`+33 6 74 69 44 82`) : c'est ce que vous retrouvez dans les exports. Un numéro tapé en `+39…` ou `0039…` bascule l'indicatif tout seul ; `+33 (0)6…` est accepté. Le 0 initial est retiré à l'enregistrement, sauf en Italie. Changer l'indicatif regroupe les chiffres déjà tapés.
- **Adresse** : libellés, exemple et champs du pays. Les États-Unis, le Canada et l'Australie demandent l'État ou la province ; Royaume-Uni et Irlande placent la ville avant le code postal. Un code postal qui n'a pas la forme attendue est signalé, sans bloquer.
- **Recherche d'adresse** : pendant la saisie, une liste de suggestions propose des adresses réelles ; un clic remplit l'adresse, le code postal, la ville, la région et le pays. France : le géocodeur de la Géoplateforme (IGN, Base Adresse Nationale) ; ailleurs : Photon (données OpenStreetMap). Sans clé ni compte. **Seul ce que l'invité tape dans le champ adresse part vers ces services**, sans cookie ni référent, et une mention le lui dit sous le champ ainsi que dans la note de confidentialité. Réglage « Recherche d'adresse intelligente » : décochez-le et plus rien ne quitte la page. Ce sont des services publics gratuits, sans garantie de disponibilité : s'ils tombent, la saisie à la main fonctionne comme avant.
- **Scan du permis** : l'invité photographie son permis, recto puis verso (« Prendre en photo » ouvre l'appareil du téléphone). **La lecture se fait sur l'appareil** (Tesseract.js en WebAssembly, fichiers dans `vendor/tesseract/`) : la photo n'est envoyée nulle part. La lecture dépend du **pays qui a délivré le permis** (celui choisi dans le formulaire ; si l'invité le change, les photos déjà lues sont relues sans nouvelle analyse). **Modèle européen** (UE, Royaume-Uni, Suisse, Monaco…) : numéro (champ 5), date d'obtention (champ 10 du verso, ligne B) et expiration (4b). La date de **délivrance de la carte** (4a, au recto) n'est pas la date d'obtention : si le verso n'est pas lu, elle est seulement *proposée* (« Le recto donne la date de la carte… », bouton « Utiliser »), jamais mise d'office. **États-Unis et Canada** : pas de champs numérotés, la lecture repère les étiquettes `DOB`, `ISS`, `EXP`, `DL`/`DLN`, `LN`/`FN`, et une éventuelle première délivrance (`ORIG ISS`, `ORIGINAL ISSUE`, `1ST ISSUED`). Les dates américaines sont lues mois/jour/année ; au Canada, une date ambiguë (03/09/1990) est laissée vide, seules AAAA/MM/JJ, `15 MAR 2023` ou un jour supérieur à 12 sont tranchées. Sans date de première délivrance, c'est la date `ISS` de la carte qui est reportée, avec la mention qu'elle peut dater d'un renouvellement. Mises en page des États et provinces non testées sur de vraies cartes. **Autres pays** : aucune lecture, aucune date devinée, la photo n'est même pas analysée (message à l'invité). Les valeurs lues sont reportées avec l'étiquette « Lu sur le permis · à vérifier » ; ce que l'invité avait déjà saisi n'est jamais écrasé (on propose seulement « Utiliser »). Le nom et la date de naissance lus sont recoupés avec l'étape 1 : une différence est signalée, sans rien bloquer. Réglage « Scan du permis » : *lecture sans conserver la photo* (recommandé), *photos à joindre si l'invité le veut*, *photos obligatoires*, ou *rien (saisie à la main)*. Environ 4 Mo téléchargés au premier scan, 1 à 15 secondes de lecture selon le téléphone.
- **Permis** : numéro, dates et aides suivent le pays de délivrance (numérotation européenne des champs, mentions « ISS » / « EXP » nord-américaines…). Un permis hors UE/EEE/Suisse/Royaume-Uni déclenche une note à l'invité et une alerte pour vous.
- **E-mail** : une faute courante (`gmial.com`) est signalée avec une correction en un clic.
- **Voiture** : la catégorie est choisie « pour moi » par défaut, d'après le nombre de personnes, de grosses valises et de sièges enfant (règles dans `cars.js`). L'invité voit pourquoi, et un avertissement s'il choisit trop juste ou trop grand. Côté organisateur, une voiture partagée est recalculée sur la somme des passagers et des bagages : la catégorie est relevée si elle ne suffit plus.
- **Et ensuite ?** : un encart annonce qu'une estimation tarifaire suivra. Rien d'autre : aucun prix, taux ou remise n'apparaît côté invité (ni dans le formulaire, ni dans le lien, ni dans les messages).

## Ce qui est protégé, et ce qui ne l'est pas

| Protégé | Comment |
|---|---|
| Lien invités (nom de l'événement, clé publique) | Enveloppe chiffrée par le mot de passe des invités ; la page d'accès ne montre rien |
| Contenu en transit (e-mail, WhatsApp, hébergeur) | Chiffré chez l'invité : ECDH P-256 + HKDF + AES-256-GCM, clé éphémère par envoi |
| Sur le disque de l'organisateur | Seuls des fichiers chiffrés sont stockés. La clé privée est enveloppée par la phrase de passe (PBKDF2 600 000 tours + AES-GCM) |
| Mémoire | Déchiffré uniquement pendant la session ; verrouillage automatique après 10 min |
| Exfiltration par la page | Politique CSP : pas de script externe ; seules requêtes autorisées : les suggestions d'adresses vers `data.geopf.fr` et `photon.komoot.io` (désactivables) |
| Photos du permis | Lues sur le téléphone, jamais envoyées (sauf si l'invité coche « Joindre » ou si vous les exigez, et alors chiffrées avec le dossier) ; réduites et débarrassées de leurs métadonnées (GPS) |
| Fichier CSV | Cellules neutralisées contre l'injection de formules |

Limites à connaître :

- **La lecture du permis demande d'assouplir un peu la politique de sécurité** : `'wasm-unsafe-eval'` (le moteur est du WebAssembly), `worker-src 'self'` et `connect-src 'self'` (pour lire le moteur et le modèle sur le site). Aucun hôte extérieur n'est ajouté. Ne mettez rien d'autre que cet outil sur le même site.
- **Une lecture peut se tromper** (reflet, hologramme, photo floue) : c'est pourquoi tout est à vérifier et rien n'est bloquant. Testée ici sur des cartes factices, pas sur de vrais permis : essayez avec le vôtre avant d'envoyer le lien.
- **Le lien est le point de confiance.** Qui modifie le lien ou la page peut substituer sa propre clé. D'où l'empreinte : comparez-la.
- **Un hébergeur compromis** pourrait servir un JavaScript piégé. Prenez un hébergeur que vous contrôlez, et n'y mettez pas d'autre code.
- **Phrase de passe ou fichier de clé perdus = dossiers perdus.** C'est voulu. Une case « Afficher la phrase de passe » (création et déverrouillage) évite les fautes de frappe ; la correction automatique est coupée sur ces champs.
- **Le ZIP AES-256** se lit avec 7-Zip, WinRAR, Keka. Certains outils intégrés à Windows et macOS ne l'ouvrent pas : demandez à l'agence.
- Un poste de l'organisateur infecté lit tout ce qu'il déverrouille. Aucun outil n'y change rien.

## Données et RGPD, l'essentiel

- Collectez le minimum. Un devis n'a pas besoin des permis ; la réservation, peu souvent des photos. Réglage « Photos du permis » : facultatives, obligatoires ou désactivées.
- Fixez une date de suppression (réglages) et utilisez « Tout effacer » ensuite. Supprimez aussi les fichiers reçus et le ZIP envoyé.
- Dites aux invités qui voit quoi et jusqu'à quand : le formulaire le fait.

## Tarifs en direct

L'outil ne les récupère pas. Europcar n'expose pas de prix publics par API : leur [portail développeurs](https://developers.europcar-mobility-group.com/) décrit des modèles de partenariat (agrégateur, compte entreprise…) qui passent par un accord commercial. Lire leur site par programme serait fragile et probablement contraire à leurs conditions. En pratique : relevez les prix de leur site pour chaque ligne du devis (catégorie, lieu, dates) et saisissez-les dans la grille de l'onglet Export, qui applique votre remise.

## À confirmer avec Europcar

Conditions d'âge, ancienneté de permis, surcoût jeune conducteur et caution varient selon l'agence et la catégorie. Les seuils d'alerte (26 ans, 2 ans de permis) sont des réglages, pas des règles Europcar. Demandez aussi quelle agence couvre quel aéroport, à quelles heures, et par quel canal sécurisé ils acceptent les pièces d'identité.

## Fichiers

- `index.html`, `style.css` : page ; `carte.js`, `icone.svg`, `fonts/` : décor et polices
- `vault.js` : chiffrement ; `serve.py` : petit serveur de test sans cache
- `estimate.js` : remise, part par invité, message d'estimation
- `contact.js` : pays, indicatifs, téléphone, adresse par pays, e-mail ; `address.js` : suggestions d'adresses ; `licence.js` : lecture des champs du permis ; `scan.js` : lecture du texte sur la photo ; `vendor/tesseract/` : moteur et modèle français (Apache-2.0 / MIT, licences jointes) ; `cars.js` : choix de la catégorie ; `i18n.js` : les 5 langues ; `programme.js` : programme et dates proposées
- `ui.js`, `guest.js`, `organizer.js`, `export.js`, `main.js` : interface
- `test/` : `node --test test/*.test.mjs` (chiffrement et mot de passe d'accès, téléphone, adresse, voiture, permis, cohérence des traductions)
- `vendor/zip-no-worker.min.js` : zip.js 2.7.57 (BSD-3), chargé uniquement à l'export du ZIP
- `_headers` : en-têtes de sécurité (Netlify / Cloudflare)
