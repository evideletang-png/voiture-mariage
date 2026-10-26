# Collecte automatique : mise en place pas à pas

Facultatif. Sans cela, chaque invité vous envoie un fichier chiffré que vous importez. Avec cela, le formulaire dépose le dossier, **déjà chiffré dans le téléphone de l'invité**, sur un petit service Cloudflare à vous. Il apparaît tout seul dans l'onglet **Invités** de l'outil.

Durée : une dizaine de minutes, une seule fois. Coût : zéro (plan gratuit de Cloudflare, très au-dessus de ce qu'il faut pour un mariage).

## Ce que le service voit, ce qu'il ne voit pas

La liste exacte de ce qui est stocké est aussi affichée dans l'outil (*Réglages* › « Collecte automatique ») et aux invités, dans leur langue (accueil du formulaire, puis avant la case d'accord). Elle suit vos réglages : les photos du permis n'y figurent que si vous les exigez ou si l'invité peut les joindre.

- Il ne détient **aucune clé** : il ne peut lire ni les identités, ni les permis, ni les trajets. Il garde des enveloppes opaques.
- Il voit l'heure de chaque dépôt, sa taille et l'adresse IP de l'expéditeur, comme tout serveur web.
- **Déposer** est ouvert à toute personne qui connaît l'adresse du service (c'est le principe : les invités n'ont pas de compte). Le service n'accepte que des enveloppes de la bonne forme, de 6 Mo au plus. Quelqu'un qui connaîtrait l'adresse pourrait y déposer du bruit : ce serait du chiffré sans valeur, que votre outil écarte comme illisible. Le mot de passe des invités reste un filtre, pas une serrure.
- **Lire et supprimer** demandent le **jeton de lecture**, que seuls votre outil et le service connaissent. Il n'est pas dans le lien invités.
- Les dépôts sont effacés automatiquement à la date de suppression que vous avez fixée dans les réglages (120 jours à défaut), et vous pouvez vider le service à la main.

## Mise en place

Les intitulés ci-dessous peuvent varier un peu : Cloudflare modifie son tableau de bord de temps en temps. L'outil affiche le même pas à pas (onglet **Réglages**, carte « Collecte automatique »).

1. **Compte.** Créez un compte gratuit sur [cloudflare.com](https://dash.cloudflare.com/sign-up).
2. **Espace de stockage.** Dans le tableau de bord : *Stockage et bases de données* › *KV* › *Créer un espace de noms*. Nom : `envois-mariage`.
3. **Le service.** *Calcul* › *Workers et Pages* › *Créer* › *Créer un Worker*. Gardez le modèle « Hello World », nommez-le `mariage-voiture`, déployez. Puis *Modifier le code* : effacez tout et collez le contenu de [`worker.js`](worker.js) (dans l'outil : *Réglages* › « Copier le code du service »). Déployez.
4. **Relier le stockage.** Dans le Worker, onglet *Liaisons* › *Ajouter* › *Espace de noms KV*. Nom de la variable : **`ENVOIS`** (exactement). Espace : `envois-mariage`.
5. **Le jeton.** Onglet *Variables et secrets* › *Ajouter*. Type **Secret**, nom **`JETON_LECTURE`**, valeur : le jeton affiché dans l'outil (*Réglages* › « Jeton de lecture »). Déployez.
6. **L'adresse.** Copiez l'adresse du Worker, du type `https://mariage-voiture.votre-compte.workers.dev`. Collez-la dans l'outil (*Réglages* › « Adresse du service »), cliquez **Tester** : vous devez lire « Service joignable, jeton accepté ». Puis **Enregistrer**.
7. **Le nouveau lien.** L'adresse du service est dans le lien invités : l'enregistrer change le lien. Renvoyez-le aux invités (avec le mot de passe, comme avant). Ceux qui ont déjà l'ancien lien continuent d'envoyer un fichier, que vous importez comme avant.

Variante en ligne de commande : `wrangler.toml` est fourni (voir les commentaires en tête de fichier).

## Ce qui change au quotidien

- **Invité.** Dernière étape : « Chiffrer et envoyer ». Il voit « C'est bien reçu, merci ! ». Il peut garder une copie chiffrée. Si l'envoi échoue (pas de réseau), il voit un avertissement, un bouton « Réessayer l'envoi » et le fichier à vous transmettre comme avant : rien n'est perdu.
- **Vous.** À l'ouverture de l'outil, puis toutes les 2 minutes tant qu'il est ouvert, il récupère les nouveaux dépôts, les déchiffre dans votre navigateur et les range comme des fichiers importés. Un bouton « Actualiser » force la vérification. Un dépôt peut mettre jusqu'à une minute à apparaître (délai de propagation du stockage Cloudflare).
- **Un invité qui renvoie** ses réponses remplace sa version précédente, comme avec les fichiers.
- **Supprimer un dossier** dans l'outil supprime aussi sa copie chiffrée sur le service.
- **Les dépôts déjà récupérés** sont mémorisés (leur identifiant seulement) : un dossier que vous avez supprimé ne revient pas. Sur un autre navigateur ou ordinateur, avec votre fichier de clé, l'outil récupère tout ce que le service garde encore : c'est aussi une sauvegarde.
- **Importer des fichiers** reste possible à tout moment.

## Si ça ne marche pas

| Message dans l'outil | Cause probable |
|---|---|
| « Le service ne répond pas… » | Adresse mal copiée, Worker non déployé, ou adresse qui ne finit pas par `.workers.dev` (voir plus bas) |
| « Le service refuse le jeton » | Le secret `JETON_LECTURE` n'est pas identique au jeton de l'outil (ou a été changé après « Nouveau jeton ») |
| « …il manque son stockage KV (nom ENVOIS) ou son secret JETON_LECTURE » | Étape 4 ou 5 oubliée ou mal nommée (majuscules comprises) ; pensez à déployer après |
| « …ce n'est pas le service de collecte » | L'adresse pointe vers autre chose que votre Worker |
| Le formulaire invité propose le fichier au lieu de « Reçu » | L'envoi a échoué : réseau de l'invité, ou service hors d'état (limite du jour atteinte, voir plus bas) |

## Limites du plan gratuit

Environ 1 000 dépôts par jour et 100 000 lectures par jour, 1 Go de stockage : sans rapport avec quelques dizaines d'invités. Les dossiers avec photos de permis pèsent 1 à 3 Mo chiffrés.

## Votre propre nom de domaine

La politique de sécurité de la page n'autorise que `https://*.workers.dev`. Si vous mettez le service derrière votre domaine (`collecte.exemple.fr`), ajoutez-le dans `connect-src`, à deux endroits : la balise `<meta http-equiv="Content-Security-Policy">` de `index.html` et le fichier `_headers`.

## Tout supprimer

Dans l'outil : *Réglages* › **Vider le service** (supprime tous les dépôts), puis videz l'adresse et enregistrez (les invités reviennent au fichier). Dans Cloudflare : supprimez le Worker et l'espace de noms KV.

## Pour les curieux : l'interface du service

| Appel | Accès | Rôle |
|---|---|---|
| `GET /` | public | état : `{ app, v, stockage, lecture }` |
| `POST /envois?ttl=secondes` | public | dépôt d'une enveloppe (texte JSON), 6 Mo au plus |
| `GET /envois` | jeton | liste `{ envois: [{ id, t, n }], suite }` |
| `GET /envois/<id>` | jeton | une enveloppe |
| `DELETE /envois/<id>` | jeton | la supprimer |
| `DELETE /envois` | jeton | en supprimer jusqu'à 40 ; à répéter tant que `reste` est vrai |

Le jeton se transmet en `Authorization: Bearer …`. Le code (`worker.js`, une centaine de lignes) vérifie la forme des enveloppes, plafonne la taille, borne la durée de vie et compare le jeton sans court-circuit. Il est testé dans `test/collecte.test.mjs`.
