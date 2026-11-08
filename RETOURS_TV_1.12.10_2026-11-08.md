# CedPlay 1.12.10 — retours d'usage sur TV — 8 novembre 2026

## Portée et résultat

APK **1.12.10 / code 58** produite et installée sur la Hisense HiSmartTV A4 (API 28), sans désinstallation. Le téléphone n'est pas connecté à ADB et reste hors de cette installation. Aucun push.

| Retour | Changement |
|---|---|
| Catégories et filtres relégués derrière le tri numérique et les outils | Direct TV : Toutes, Favoris, autres filtres et catégories dans l'ordre de la liste, puis outils. Ordre manuel conservé. Mobile et organisateur reviennent aussi à l'ordre source par défaut. VOD TV : Toutes puis Ma Liste, catégories source et outils. |
| Impossible de relancer le flux depuis le lecteur | Commande TV « Relancer le flux » dans les commandes de lecture. Elle reconnecte la chaîne actuelle et annule le zap différé. Elle est distincte de « Revenir au direct ». |
| Zapping depuis le panneau transparent lent ou incohérent | Index des groupes construit une fois, hors UI pour la liste complète ; aucun parcours du catalogue à chaque filtre. Adoption atomique des indices et catégories, conservation de la sélection parcourue et du focus. OK garde le panneau ouvert sur TV ; droite depuis la liste ou Retour le ferme. |
| Favori disponible seulement avant d'ouvrir la chaîne | Commande TV Ajouter/Retirer des favoris dans le lecteur et filtre Favoris dans son panneau. Mutations immédiatement journalisées dans le stockage privé Android, puis réconciliées avec IndexedDB sans supprimer les favoris des autres listes. |
| TMDB aurait fait disparaître le catalogue | **Non reproduit, reste ouvert.** Clé absente des réglages de la TV lors du contrôle en lecture seule. Aucun secret lu dans les sorties ou modifié. Trois intégrations sur clé refusée/panne réseau confirment catalogue fournisseur et lecture maintenus. Aucun correctif produit spéculatif ajouté à TMDB. |

Les numéros des chaînes restent utilisables ; cette correction concerne l'ordre des catégories. Le contrôle parental reste fermé quand les catégories adultes sont inconnues.

## Vérification sur Hisense

- Avant : la 1.12.9 ferme le panneau après sélection d'une autre chaîne (`baseline-panel-result.json`, une ListView avant, zéro après).
- Après : le candidat de diagnostic garde le panneau et le focus dans la liste ; image réelle observée après le changement de chaîne (`panel-result-final.json`, `panel-selected.png`). Toutes et Favoris sont visibles en tête, sur la page et dans le panneau natif.
- Relance manuelle par télécommande : marqueur `manual_live_reload`, puis première image environ **2 515 ms** après ce marqueur (compteur interne `zap_ms=2562`). Mesure d'un seul essai sur une chaîne réelle, pas une moyenne ni une promesse de démarrage.
- Favori posé depuis le lecteur : nombre global **47 → 48**, filtre de la liste courante **2 → 3**, chaîne présente dans le panneau natif Favoris. Retrait depuis le lecteur puis retour à la page : **47** favoris, égalité exacte avec la liste initiale, ordre compris (`favorites-before.json`, `favorites-added.json`, `favorites-restored.json`, `favorites-filter.png`). La synchronisation peut attendre le retour de la WebView ; le journal Android conserve alors l'action.
- Version release installée ensuite ; `dumpsys` confirme **58 / 1.12.10**, minSdk 22, cible 35. Accueil et Direct affichés avec les filtres attendus ; chaîne réelle lancée depuis Favoris et image observée (`release-playing.png`). Les essais détaillés ci-dessus utilisent l'APK de diagnostic avec le même code final.

Des extractions UI Android ont temporairement renvoyé une racine nulle pendant les transitions ; ces essais ne servent pas de preuve positive. Captures et extractions réussies sont nommées `*-final` ou décrites ci-dessus. La touche Menu de cette Hisense ouvre son propre menu système : les essais utilisent les commandes de CedPlay et la croix directionnelle.

## Tests locaux et contre-revues

- Typage application et configuration : zéro erreur. ESLint complet sans quiet : zéro erreur, **18 avertissements existants**.
- **791/791 tests Web**, 121 fichiers ; build Vite et synchronisation Capacitor réussis. Chunk principal 639,15 kB / 194,46 kB gzip, avertissement de taille conservé.
- **35/35 tests Java**, dont cinq pour l'index du panneau ; assembleDebug et assembleRelease réussis, minification et lint release compris.
- Reproduction avant optimisation : 100 filtrages d'un catalogue de 20 000 chaînes effectuent **2 000 000 lectures** ; après indexation : **zéro** relecture. Il s'agit d'un compteur d'opérations, pas d'une mesure de fluidité physique.
- Quatre P2 du premier candidat trouvés par deux contre-revues indépendantes puis corrigés : identifiant secondaire d'une variante acquitté sans apparaître dans les favoris ; ordre JSON des mutations gagnant sur leur chronologie ; index d'URL périmé après substitution de variante ; sélection/focus écrasés à l'arrivée de la liste complète.
- Les sondes finales passent : `native-favorites-probe.cjs` 2/2 et `publish_probe.py`/`PublishProbe.java` (vraie méthode et vrai index avec frontières Android/UI simulées). Elles complètent les essais physiques, sans les remplacer.

Étapes exécutées avec les outils locaux de node_modules : tsc app, tsc node, eslint ./src, vitest run, vite build, puis Capacitor sync. Gradle : testDebugUnitTest, assembleDebug et assembleRelease. Journaux sous `preuves/retour-tv/` ; les reproductions natives avant/après et rapports Guardian sont dans `native/` et `review/`.

## APK et limites

`CedPlay-1.12.10.apk` et `CedPlay.apk` sont identiques : **4 399 008 octets**, SHA-256 **a0252b916c1f2b5674322858478710e43f7e3b2710f7ded06fd054f3bd631038**. Certificat identique à la 1.12.9 : SHA-256 `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`. Aucun keystore créé ou changé ; ancienne référence racine retirée après vérification.

Restent à vérifier : fluidité prolongée avec de nombreuses chaînes, problème historique TMDB avec la configuration qui le déclenche, recette téléphone. Cette livraison ne traite pas les autres lots de l'audit (DVR, migration Media3/audio, export des secrets, Android 15). L'ancienne conclusion rouge 777/778 ne décrit pas cette version.
