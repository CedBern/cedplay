# Contre-vérification du bilan des lots A à E — 8 novembre 2026

Revue demandée après le bilan du lot D attribué à DeepSeek. Arbre examiné : dépôt canonique, branche `consolidate/v1.11.4`, HEAD `0362409`, avec les modifications non commitées. L'attribution de chaque modification à une IA n'est pas démontrable par ce diff cumulé. Le lot D a été examiné en priorité, avec une recherche bornée des régressions critiques des autres lots.

**Verdict : contrôles généraux confirmés, mais quatre défauts reproduits empêchent de considérer les lots comme entièrement validés. Aucun correctif produit appliqué dans cette revue.**

## 1. P1 — Ma Liste permet une lecture adulte avant la résolution des catégories

- Localisation : `application/src/components/VodLibrary.tsx:196-198`, avec catégories initialement vides à la ligne 125 et ensemble des catégories adultes dérivé à la ligne 158.
- Condition : contrôle parental activé, session verrouillée, titre adulte enregistré dans Ma Liste, chargement des catégories lent ou en erreur.
- Cause : un ensemble de catégories adultes vide est traité comme une autorisation. Le filtre ne distingue pas « catégories inconnues » de « aucune catégorie adulte ».
- Reproduction : rendre le vrai composant `VodLibrary`, suspendre `get_vod_categories`, ouvrir Ma Liste puis le titre et appuyer sur Regarder. L'appel `NativePlayerBridge.openVod` est observé sans PIN. Si la requête échoue, le titre reste également exposé. Les comptes, titres et adresses utilisés sont fictifs.
- Témoin : une fois les catégories résolues avec la catégorie adulte identifiée, le même titre est bien masqué.
- Exigence à rétablir : refuser l'ouverture tant que le verdict parental de la liste et du type de catalogue est inconnu ; tester aussi l'échec réseau et la reprise.

Depuis `application/` :

```powershell
node node_modules/vitest/vitest.mjs run --config ../preuves/revue-lot-d/vitest-other.config.ts
```

Résultat revérifié : **1 témoin vert, 2 tests rouges**, dont l'appel natif de lecture. Source : `preuves/revue-lot-d/other-lots-repro.test.tsx`, résultat `other-recheck.log`.

## 2. P2 — La protection du relais contre les cibles locales est incomplète

- Localisation : `application/proxy-server.mjs:51-53` pour les adresses IPv4 représentées en IPv6 ; routes Xtream à partir de la ligne 243 et `fetchWithRetry` à partir de la ligne 105.
- `new URL` normalise `[::ffff:127.0.0.1]` en `[::ffff:7f00:1]`. Le filtre ne reconnaît que la forme avec IPv4 décimale pointée et accepte donc cette adresse locale.
- Reproduction sur un faux service HTTP local éphémère : `/proxy` renvoie **403** pour `127.0.0.1`, mais **200** et le contenu du service pour `[::ffff:127.0.0.1]`.
- Les routes `/xtream/catalog`, `/xtream/categories` et `/xtream/streams` renvoient aussi **200** avec un serveur `127.0.0.1` de test : elles utilisent la validation de syntaxe, sans la garde de cible privée.
- Le CORS restreint est confirmé : origine inconnue **403**, origine Vite autorisée **200**. Le défaut ne rétablit pas le CORS `*` ; il invalide l'annonce d'un refus complet des cibles privées. Portée : relais de développement, absent de l'APK livrée.
- Exigence à rétablir : même politique de cible sur toutes les routes, traitement canonique des adresses IPv6, tests de non-régression. La sûreté face à un changement DNS entre validation et connexion n'est pas démontrée par cette revue.

Depuis la racine :

```powershell
node preuves/revue-lot-d/proxy-repro.mjs
```

Résultats revérifiés et enregistrés : `preuves/revue-lot-d/proxy-repro-output.jsonl`. Le script ne contacte que son faux service local ; aucun équipement du réseau ni fournisseur réel n'est sondé.

## 3. P2 — Le secours des réglages ne protège que le premier appelant

- Localisation : `application/src/utils/storage.ts:206`, mémorisation de la promesse brute à la ligne 247, traitement du délai et des erreurs aux lignes 249-267.
- Le premier appel bénéficie de `Promise.race` et du secours ; les suivants retournent directement la promesse IndexedDB brute.
- Sonde avec DB suspendue : après **8 001 ms**, seul le premier appel est terminé, au lieu des deux.
- Sonde avec `VersionError` : statuts **`fulfilled`, `rejected`**, au lieu de deux retours de secours.
- Ce n'est pas une concurrence artificielle sans consommateur : `App.tsx:23` et `IPTVPlayer.tsx:168` lancent chacun cette lecture au montage. L'effet de `App` ne traite pas un rejet.
- Exigence à rétablir : partager la promesse déjà protégée, et vérifier que tous les appelants reçoivent le même secours et la même borne.

## 4. P2 — Le repli des réglages écrase le thème clair du miroir

- Localisation : `application/src/utils/storage.ts:264`, puis `application/src/App.tsx:23-29`.
- Sonde sur le vrai `App` avec la page de contenu neutralisée : `iptv_theme=light`, absence de réglages hérités, IndexedDB suspendu. L'état initial est bien clair, ce qui confirme une partie du correctif COR-09.
- Après **8 001 ms**, le repli retourne les valeurs par défaut sombres ; le DOM passe à `dark=true` et le miroir devient **`dark`**, malgré sa valeur initiale `light`.
- Exigence à rétablir : conserver le thème du miroir dans le secours et tester le démarrage en mode dégradé. Cette reproduction concerne une base bloquée ; elle ne prétend pas reproduire un flash en fonctionnement normal sur téléphone.

Depuis `application/`, reproduction des constats 3 et 4 :

```powershell
node node_modules/vitest/vitest.mjs run --config ../preuves/revue-lot-d/vitest-theme.config.mjs
```

Résultat revérifié : **4 tests rouges** dans `theme-timeout.test.ts` et `app-theme-fallback.test.ts` ; sortie `preuves/revue-lot-d/theme-recheck.log`.

## Contrôles généraux et éléments du bilan confirmés

- TypeScript application et configuration : **0 erreur**.
- ESLint complet `./src`, sans `--quiet` : **0 erreur / 18 avertissements**.
- Suite Web existante : **766/766 tests, 117 fichiers**, tous verts. Les sondes adverses ci-dessus sont isolées sous `preuves/`, donc absentes de ce total.
- Build Vite : réussi, gros module annoncé **637,96 kB / 194,15 kB gzip** ; `dist/` : **72 fichiers, 2 616 049 octets**, aucun média lourd de test observé.
- Android : `:app:testDebugUnitTest` **21/21**, `:app:assembleDebug` réussi ; `aapt2` confirme compileSdk/targetSdk **35**, minSdk **22**, code **56**, version **1.12.8**. AGP **8.9.1**, Gradle **8.11.1** ; opt-out bord à bord et drapeaux conservés présents dans le code.
- La commande `pnpm verify` du dépôt contient bien `eslint ./src`. Le lanceur pnpm fourni dans cet environnement a échoué avant les contrôles (version incompatible et tentative de résolution réseau). Les étapes équivalentes ont été exécutées directement avec les outils déjà installés. Les refus initiaux `spawn EPERM` et le verrou Gradle ont été levés par l'exécution autorisée ; ils ne sont pas comptés comme des défauts produit. JUnit manquant en cache a ensuite été résolu par Gradle.
- `AGENTS.md` est indexé, pas commité ; petite dérive restante : le fichier indique **763 tests**, contre **766** dans le bilan et dans la suite réellement exécutée.
- Deux APK seulement à la racine : `CedPlay-1.12.8.apk` et `CedPlay.apk`, chacune **4 607 473 octets**, empreinte identique **f3fafbdfdf6c5cc8aa08a2f2bc3ab18d9f36fea65dbae1be31e97faff2259ad5**. La suppression historique de 42 fichiers/~300 Mo n'a pas été revérifiée rétrospectivement.
- L'APK livrée reste en targetSdk **34**, sans `iptv_theme` dans son `assets/public/index.html` : le lot D n'y est effectivement pas intégré. Le build debug de contrôle ne constitue pas une livraison des lots.
- La garde documentaire du keystore est présente. Son existence dans `AGENTS.md` ne prouve pas qu'une sauvegarde hors machine a été réalisée ; aucune clé créée ou régénérée pendant cette revue.

## Limites et suite

Aucun essai sur TV ou téléphone dans cette session, aucune installation, aucun gain de fluidité ou de lecture revendiqué. Android 15 réel, rendu du thème sur appareil et parcours complet du relais dans le navigateur restent à essayer.

Corriger d'abord le verrou parental, puis les trois autres défauts ; intégrer ces cas aux tests du produit et relancer les contrôles. Ensuite seulement envisager le commit des lots et la livraison **1.12.9 / code 57**. Aucun commit, push, changement de version ou remplacement de l'APK de référence effectué par cette revue. Le WIP des autres IA est conservé.
