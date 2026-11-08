# CedPlay — lecteur personnel, reprise du 3 novembre 2026

## Jeton TMDB accepte - 7 novembre 2026

- Retour utilisateur : long API Read Access Token. Deux defauts reproduits par 10 nouveaux tests : envoi comme cle v3 et troncature a 200 caracteres dans les reglages.
- Jeton envoye dans Authorization, cle courte preservee, stockage jusqu'a 4096 caracteres, aide clarifiee et message pour refus 401. Recoller le jeton complet apres installation : une ancienne troncature est irreversible.
- 493 tests web / 81 fichiers, types/lint/build web, copie Capacitor et APK release OK ; signature et 78 fichiers embarques verifies. Sans appareil ni jeton personnel : acces reel a confirmer.
- APK distincte : CedPlay-TMDB-test.apk (1.10.0/code 27, 8 478 088 octets, SHA-256 ae8de7a7238f0418913df61a10c3ebf3670a89a2c26948949473a6b72ca3ccb5). Correctifs precedents inclus, sans commit ni fusion. Details : preuves/jeton-tmdb-2026-11-07/RAPPORT.md.

## Focus conserve pendant le zapping - 7 novembre 2026

- Retour utilisateur : navigation nettement meilleure ; la fleche suivante perdait sa selection au profit d'Audio. showControls() ne force plus Audio si une commande du bandeau a deja le focus ; meme garde dans l'ecouteur VOD.
- Compilation debug/release et 12 tests Java OK ; signature verifiee, fichiers web identiques a la livraison precedente. Pas d'appareil connecte, maintien du focus a confirmer sur la box.
- APK distincte : CedPlay-focus-zapping-test.apk (1.10.0/code 27, 8 477 778 octets, SHA-256 fb9ed3f9cfbf93153cce1c65ea327d04fac445738e6f410adf652bc52407330a). Sans commit ni fusion. Details : preuves/focus-zapping-2026-11-07/RAPPORT.md.

## Navigation sous les rubriques et vitesse - APK d'essai, 7 novembre 2026

- Bas depuis les rubriques rejoint le contenu. Dans Direct : Rechercher, puis Guide TV et Organiser ; Haut depuis Rechercher retourne a Direct. Quatre nouveaux cas de regression.
- Lecteur VOD Android : toucher l'image pilote aussi le controleur Media3 et synchronise la barre superieure, pour pouvoir rouvrir les reglages de vitesse apres leur masquage.
- Verifie : 483 tests web, 12 tests Java, types/lint/build et APK release. Trois commandes ouvertes aux touches dans le navigateur. Aucun appareil connecte : vitesse et telecommande reelles restent a confirmer.
- APK distincte : CedPlay-navigation-vitesse-test.apk (1.10.0/code 27, 8 477 735 octets, SHA-256 ae00a035dc9b04a7be851d3b0df4cfdc8a6849deea74fb7e13d0d67e22ce975e). Meme signature, anciennes APK conservees. Sans commit ni fusion.
- Details et capture : preuves/navigation-vitesse-2026-11-06/RAPPORT.md.

## Correctifs niveau 3 - APK d'essai, 6 novembre 2026

- Copie Claude, sans commit ni fusion vers main : reponses tardives de l'apercu Stalker invalidees, User-Agent conserve avec chaque programmation DVR et apres redemarrage, saisie Android etendue a neuf chiffres.
- Verifie : 479 tests web, 12 tests Java, TypeScript, lint, build web et APK release. Signature habituelle et 78 fichiers web embarques verifies.
- APK distincte a la racine canonique : CedPlay-niveau3-correctifs-test.apk (1.10.0/code 27, 8 477 542 octets, SHA-256 242f8277c80f6fac99a81c9f844f9eca4318b894b017050eee023ba7f6b97083). Alias precedents conserves.
- Aucun appareil ADB connecte : pas d'installation ni de validation physique. Fluidite et annulation d'un enregistrement actif restent ouvertes. Details : preuves/correctifs-niveau3-2026-11-06/RAPPORT.md.

## Nouveau logo C + E + D et nom CedPlay — 1.8.9 prête, 6 novembre 2026

- Icône choisie sur le canevas de propositions : écran blanc ouvert (C), vide noir avec encoche (E), triangle orange (D) ; fond `#0B0B0C`, accent `#FF5A36`. Source `identite/cedplay/mark.json`, scripts d'export réécrits pour les traits arrondis ; notification blanche sans encoche.
- Nom visible sans accent : **CedPlay** (titre web, nom Android, Capacitor, en-tête, réglages). Identifiants, liens et sauvegardes inchangés. Couleurs violettes de l'interface non modifiées.
- Vérifié : 419 tests, tsc ; APK versionCode 25 / 1.8.9, libellé CedPlay, même clé (f3f2371b…), favicon neuf dans les fichiers web. `CedPlay-1.8.9.apk`, `CedPlay.apk`, alias `Lecteur-IPTV.apk` : 8 566 482 octets, SHA-256 `2b807a05a9461821dd7ff5c01c5dcefaed9d322844034c7985a0e149cabf1bc3`.
- NON installée par l'agent : aucun appareil ADB. Icône sur le lanceur, bannière TV et écran de lancement non vus sur appareil. Sauvegarde d'avant : `sauvegardes/avant-logo-cedplay-2026-11-06`.

## Aperçu vidéo dans l'écran Direct TV — 1.8.8 prête, 6 novembre 2026

- Demande utilisateur (photo TiviMate) : voir la chaîne en petit avant de l'ouvrir en plein écran.
- Android : `LivePreview.java` pose un petit ExoPlayer (TextureView, sans focus) au-dessus de la WebView, au cadre 16:9 réservé par la page. Plugin : `showPreview` / `stopPreview` / `hidePreview`, événement `previewState` (loading, playing, error). Le flux est libéré quand un lecteur plein écran, la mosaïque, la VOD ou un lecteur externe s'ouvre (`launchPlayer`, `playerOpen`) et quand l'appli passe en arrière-plan ; il reprend au retour.
- Page : l'aperçu démarre 600 ms après l'arrêt sur une ligne, se coupe tout de suite au changement de ligne, en parcourant les catégories ou quand le focus quitte l'écran (recherche, réglages, rubriques). Actions en grille 2×2 quand l'aperçu est actif. Réglage Affichage › « Aperçu vidéo dans la liste des chaînes » (actif par défaut).
- Vérifié : 376 tests, tsc, eslint ; mise en page 960x540 sans débordement ; APK versionCode 24 / 1.8.8, même clé (f3f2371b…), SHA-256 2405493cebe3cccd…
- Pas encore essayé sur la box (aucun appareil branché) : position exacte du cadre, son, délai et comportement avec un abonnement limité à une connexion.

## Écran Direct TV dédié — 1.8.7 prête, 5 novembre 2026

- Retour utilisateur : mobile apprécié, navigation TV box / Google TV compliquée. Constat en 960x540 : mise en page mobile tassée, ~5 appuis jusqu'à la 1re chaîne, 3 chaînes visibles, focus sur l'icône ▶.
- Choix de l'utilisateur : écran TV dédié plutôt que nouveaux correctifs. Direct TV en 3 colonnes (catégories | chaînes | aperçu), tabindex itinérant, flèches gérées par l'écran (`data-remote-self`), Retour aperçu → chaînes → catégories. Mobile inchangé.
- Activation : plugin natif `isTelevision` (mode TV, leanback ou sans écran tactile) mis en cache ; Réglages › Affichage › Interface (Auto/TV/Mobile) ; `?tv=1` pour la recette navigateur.
- 370 tests / 69 fichiers, TypeScript/ESLint et builds OK. Navigateur 960x540 et 1280x720 aux flèches : Toutes (1988 chaînes) au PageDown, Guide TV et retour, groupe protégé.
- APK 1.8.7 / code 23, même clé que 1.8.6 (mise à jour sans désinstallation), `isTelevision` présent après R8. SHA-256 6620f9a9a8c982968177b09f864a28d9e7f3713ed590ccc5ca5eac06f465542e. NON installée par l'agent : aucun appareil ADB. Télécommande réelle et détection TV non validées. Accueil et Films & séries sans version TV dédiée.


## Focus télécommande — correctif 1.8.6 prêt, 5 novembre 2026

- Retour utilisateur : difficultés entre lignes et passage par des cadres non cliquables. Trois mécanismes reproduits par des tests en échec avant correction : propagation interrompue, focus conservé sur un cadre, panneaux Radix tabindex=0.
- Flèches générales en capture, cibles limitées aux actions, panneaux tabindex=-1 avec récupération du focus, repère visuel sur la ligne active. Déplacement par index des chaînes conservé.
- 360 tests / 68 fichiers, TypeScript/ESLint et builds OK. Navigateur 960x540 : 60 descentes + 60 remontées sans erreur ; accès direct aux actions, Xtream et Plus vérifiés. Rapport : preuves/focus-tv-1.8.6-2026-11-05/.
- APK 1.8.6 / code 22 prête, signature et fichiers web vérifiés. NON installée par l'agent : aucun appareil ADB connecté. Télécommande réelle et lecture non validées. Mise à jour par-dessus la version actuelle, sans effacement.


## Liste TV coupee — correctif 1.8.5 pret, 5 novembre 2026

- Retour utilisateur : Xtream visible mais liste toujours coupee. Reproduction 1.8.4 a 960x540 : seulement 41 px pour les chaines. Ancienne recette 1280x720 insuffisante.
- Hauteur de liste independante des filtres ; commandes paysage compactes : 240 px et trois cartes entieres a 960x540, 420 px et cinq cartes a 1280x720. Options ouvertes : hauteur conservee ; le panneau peut defiler dans la page.
- 50 descentes et 50 remontees avec cartes visibles ; 357 tests / 68 fichiers, TypeScript/ESLint et builds OK. Rapport et empreinte : preuves/hauteur-tv-1.8.5-2026-11-05/.
- APK 1.8.5 / code 21 livree, signature et fichiers web verifies. NON installee par l'agent : aucun appareil ADB. Recette TV physique et lecture non faites. Prochaine action : mise a jour TV sans desinstallation puis retour utilisateur.


## Navigation TV et accès Xtream corrigés — 1.8.4 prête, 5 novembre 2026

- Télécommande : navigation spatiale générale, focus visible, onglets validés par OK, accès aux chaînes sur ▶, défilement virtualisé conservant sélection et visibilité. Deux défauts supplémentaires reproduits et corrigés pendant les essais : changement de groupe au focus et saut de position dans les longues listes.
- Filtres qualité/groupe désormais propres à chaque liste ; compteur affichées/total, Effacer les filtres et repli de hauteur vh/dvh. Catalogue embarqué vérifié : 2 465 flux regroupés en 1 988 chaînes / huit pays. La cause exacte de la chaîne unique sur la TV n'est pas confirmée sur l'appareil.
- Xtream visible dans l'en-tête, le menu des listes et Plus ; champs accessibles avec Haut/Bas, libellés associés et retour au bouton d'origine après fermeture. Aide de connexion corrigée.
- **357 tests / 68 fichiers**, TypeScript/ESLint sans erreur, builds web/Capacitor/Android réussis. Essai navigateur 1280×720 : 65 descentes + 65 remontées sans saut ni focus hors écran ; cinq largeurs sans débordement. Signature et 39/39 fichiers web dans l'APK vérifiés.
- **1.8.4 / code 20 prête, NON installée** : aucun appareil ADB détecté. Pas de recette physique TV ni de nouvel essai vidéo. `CedPlay-1.8.4.apk`, `CedPlay.apk`, alias `Lecteur-IPTV.apk` : 8 606 312 octets, SHA-256 `f57e3f06588d2aefa1cedb7071af641fe316958297f811c169e2aa3cbfd435f8`.
- Rapport : `preuves/navigation-tv-1.8.4-2026-11-05/RAPPORT.md`. Sauvegarde : `sauvegardes/avant-navigation-tv-1.8.4-2026-11-05/`. Prochaine action : identifier le système de la TV, installer la mise à jour en conservant les données puis vérifier la vraie télécommande, le Direct et Xtream.


## Identité CédPlay intégrée et installée — 1.8.3, 5 novembre 2026

- Nom et logo validés : identité vectorielle et exports reproductibles dans `identite/cedplay/`. En-tête, accueil, chargement, réglages, métadonnées web, favicon, manifest, icônes Android adaptatives/thématiques, lancement, bannière TV, titres natifs et notification DVR actualisés. Fichier de sauvegarde renommé ; format conservé.
- **351 tests / 65 fichiers passants**, TypeScript/ESLint sans erreur, builds web/Capacitor/Android réussis. Affichage web contrôlé sur 320/360/420/1280 px ; nom et icône vérifiés dans Android, accueil et données visibles conservés après mise à jour.
- **1.8.3 / code 19 installée sans effacement**, **8 604 237 octets**, SHA-256 `3ae1405fad5469c5d06d81720b68ce03140975122b87d8ddcb6645c55a72422f`. APK installée identique, **39/39 fichiers web** conformes. Livraisons : `CedPlay.apk`, `CedPlay-1.8.3.apk`, alias `Lecteur-IPTV.apk`.
- Sauvegarde : `sauvegardes/avant-identite-cedplay-1.8.3-2026-11-05/`. Rapport et limites : `preuves/identite-1.8.3-2026-11-05/RAPPORT.md`. Package, stockage, certificat et anciens liens conservés. Aucun nouvel essai vidéo ni recette TV/DVR dans ce lot.


## Installation et lecture vérifiées — 1.8.2, 5 novembre 2026

- Mise à jour en place depuis 1.8.0 vers **1.8.2 / code 18** sur Motorola Edge 70, sans effacement. APK installée récupérée et empreinte identique à la livraison ; données visibles conservées (liste active 22 314 chaînes, Ma liste).
- Échecs initiaux sur mobile avec erreur de résolution réseau ; après activation du Wi-Fi par l'utilisateur, **TF1 HD lue avec image à deux ouvertures**, première image à **3,186 s puis 3,072 s** après la requête d'appui ADB. Retour à la liste, réouverture et retour Android à l'Accueil vérifiés. Application laissée sur Accueil, lecture arrêtée.
- Mesures et limites : `preuves/revue-1.8.2-2026-11-05/RAPPORT.md` (section installation). Aucun FPS ni stabilité longue certifiés. Le DNS mobile, la cloche du guide, le replay fournisseur et les autres recettes longues restent à vérifier.


## Revue des nouveautés — 1.8.2 compilée, 5 novembre 2026

- Relecture des nouveautés présentes en 1.8.1 : navigation à quatre rubriques, accueil, guide continu, replay Xtream, contrôle des liens et raccourcis Android. Sauvegarde d'entrée : `sauvegardes/avant-revue-1.8.2-2026-11-05/`.
- Corrections : résultats de contrôle tardifs isolés après fermeture/relance et changement de liste ; Entrée/Espace sur la cloche du guide ne lance plus la chaîne ; nettoyage réel des écouteurs Retour et liens Android, même après inscription tardive ; positions de reprise replay séparées par liste.
- **351 tests / 65 fichiers passants**, TypeScript et ESLint sans erreur, builds Vite/Capacitor et Android release réussis. Trois familles de régressions reproduites avant correction. Rapport : `preuves/revue-1.8.2-2026-11-05/RAPPORT.md`.
- **APK 1.8.2 / code 18 prête**, 8 589 642 octets, SHA-256 `3bb8f7f9195c5d2bb143d7301506251725018fdcd05533ebec346fe31849e8f4`, signature vérifiée et 33/33 fichiers web conformes. `Lecteur-IPTV.apk` et `LecteurIPTV-1.8.2.apk` identiques.
- **Non installée : téléphone non détecté en USB.** Aucun nouvel essai réel ni mesure de fluidité déclarés. Prochaine action : mise à jour sans effacement, mesure appui/ouverture/première image, Retour et réouverture, replay et cloche du guide.
- Suite proposée : chargement différé des rubriques secondaires ; annulation native des contrôles réseau ; contexte de zapping/guide natif renouvelé progressivement (actuellement 300 chaînes voisines, six programmes à venir).


## Améliorations validées — 1.6.0 installée, 4 novembre 2026

- Suite autorisée de la revue : Continuer avec affiches disponibles, progression, titre d’épisode, Vu et Retirer (position conservée, réapparition à la relance) ; métadonnées d’affiche conservées pour les prochains visionnages et le zapping d’épisodes.
- Recherche dans les catalogues complets films et séries du compte de la liste active, dès deux caractères ; sans accents, fiche exacte, cache mémoire dix minutes, affichage progressif et relance après erreur partielle. Ma liste reste utilisable sans compte lié. Débordement horizontal de recherche reproduit sur téléphone puis corrigé.
- Lecteur Android : compte à rebours de huit secondes après la fin de l’épisode ; Rester ici, Lire maintenant et annulation par Retour ; nettoyage sur libération/arrière-plan/PiP, priorité à la veille. Les trois chemins principaux ont été essayés sur deux vidéos locales de contrôle.
- **209 tests / 43 fichiers**, TypeScript/ESLint sans erreur ; builds Vite/Capacitor et Gradle debug/release réussis. Recherche réelle (18 Vikings, 7 films Interstellar), fiches exactes, deux cartes de reprise et cinq largeurs de recherche contrôlées. Liste initiale rétablie, aucune action Vu/Retirer exercée sur les vrais titres.
- **Release 1.6.0 / code 13 installée sans effacement**, **8 412 305 octets**, SHA-256 `f462d34f18924501d80dcc4f07caa0ef68686721380e52b2efbf05f6012ba390` ; APK installée identique, **22/22 fichiers web** conformes. Accueil final sur Direct, 22 314 chaînes. Sauvegarde : `sauvegardes/avant-1.6.0-2026-11-04/`.
- Rapport et limites : `preuves/ameliorations-1.6.0-2026-11-04/RAPPORT.md`. Restent à tester physiquement : DVR long/alarmes/USB, PiP et Cast. Les anciennes entrées sans image gardent leur pictogramme ; aucune mesure de fluidité ni lecture d’abonnement nouvelle déclarée dans ce lot.

## Revue et stabilisation des nouveautés — 1.5.1 installée, 4 novembre 2026

- Revue du résultat cumulé des nouveautés (Continuer/Ma liste, recherche, sous-titres, audio/gestes/veille, USB/SD, contrôle parental, PiP/Cast, DVR), sans attribution individuelle faute de Git. Sources et APK d’entrée sauvegardés dans `sauvegardes/avant-revue-1.5.1-2026-11-04/`.
- Corrections : sauvegardes avec numéros M3U et restauration en conflit ; ajouts simultanés Ma liste ; ouverture du titre exact et isolation par liste dans la recherche ; reprise de l’épisode précis ; annulation des réponses tardives ; positions de chaque épisode au retour Android ; véritable enchaînement de fin ; sous-titres propres à l’épisode ; erreurs de traduction explicites ; rapprochement Cinemeta strict ; authentification DeepL et téléchargement OpenSubtitles ; ancien cache invalide ignoré ; PIN demandé pour modifier la protection et délai persistant ; DVR excluant les groupes verrouillés ; en-tête mobile ; passation lecture locale ; nettoyage veille et threads DVR.
- DVR : le direct HLS est désormais explicitement refusé, car l’ancien remux supprimait le fichier à l’arrêt. Utiliser la variante MPEG-TS ; dossier de destination accessible exigé avant programmation. Recette longue MPEG-TS/alarmes encore à faire.
- **201 tests / 42 fichiers**, TypeScript et ESLint sans erreur, Vite/Capacitor et Gradle debug/release réussis. Sept régressions reproduites avant correction. Avertissements de build non bloquants conservés ; rapport précis et limites dans `preuves/revue-nouveautes-2026-11-04/RAPPORT.md`.
- Téléphone : trois listes conservées (22 314, 987, 1 988 chaînes), liste initiale rétablie après essai. Aucun filtrage ni effacement. Enchaînement natif observé sur deux vidéos locales ; reprise réelle de Vikings depuis l’ancien historique, position passée de 88 921 à 124 690 ms et ID de série conservé. Affichage contrôlé dans la WebView sur quatre tailles et au format réel du téléphone.
- **APK release finale 1.5.1 / code 12 installée**, **8 409 708 octets**, SHA-256 `b27bea6d8f7f176ee079538308c4315809857d26191970fa1953f4382470ac11`, empreinte installée identique, **22/22 fichiers web** conformes. Variante debug de contrôle remplacée par release, sans désinstallation.
- Suite conseillée : recette DVR/PiP/Cast ; Continuer avec affiches/progression/retrait/vu ; compte à rebours annulable avant épisode suivant ; recherche dans tout le catalogue (actuellement limitée à Ma liste pour les titres VOD). Aucun FPS, audio perçu ni stabilité longue certifiés.

## Ma Liste (Watchlist VOD), Minuteur de veille (Sleep Timer) & Recherche globale unifiée — 4 novembre 2026

- **« Ma Liste » (Watchlist VOD pour Films & Séries)** :
  - **Stockage persistant & synchronisation réactive** : Clé IndexedDB `vod_watchlist` (`src/utils/idb.ts`), avec `getVodWatchlistFromDB()`, `saveVodWatchlistToDB()` et `toggleVodWatchlist()`. Événement `vod-watchlist-updated` pour réactivité instantanée.
  - **Gestion dans le catalogue VOD (`VodLibrary.tsx`)** :
    - Bouton 1-clic « Ajouter à ma liste » / « Dans ma liste » (icône signet) dans la fiche détaillée du film ou de la série.
    - Filtre rapide « Ma Liste (nb) » en en-tête des films et séries pour afficher directement ses favoris en un tap.
    - Badge violet subtil sur l'affiche des cartes sauvegardées dans la grille.
  - **Intégration dans le panneau Continuer (`ContinuePanel.tsx`)** :
    - Section dédiée « ⭐ Ma Liste » affichant les affiches, titres, types (Film/Série) et notes des titres mis de côté, concrétisant la promesse du projet (*Continuer à regarder + Ma Liste*).
- **Minuteur de mise en veille (Sleep Timer)** :
  - Bouton dédié « Veille » dans la barre d'outils du lecteur natif Android (`NativePlayerActivity.java`).
  - Menu de sélection : *15 min*, *30 min*, *45 min*, *60 min*, *90 min*, *Fin de la vidéo* (VOD), ou *Désactiver*.
  - Compte à rebours dynamique affiché sur le bouton (ex. `🌙 15m`, `🌙 14m`) avec mise à jour automatique.
  - Arrêt automatique en douceur (`stop()` + `finish()`) et libération des ressources à l'expiration pour préserver la batterie du smartphone.
  - Option « Fin de la vidéo » : stoppe et ferme automatiquement le lecteur dès que le film ou l'épisode se termine.
- **Recherche globale unifiée (Smart Search)** :
  - Nouveau composant `<GlobalSearchDialog />` (`src/components/GlobalSearchDialog.tsx`) accessible via le bouton « Recherche » dans l'en-tête principal et via le raccourci clavier universel `Ctrl+K` / `Cmd+K`.
  - Recherche instantanée multi-sources simultanée :
    - **Direct** : filtrage en temps réel parmi les chaînes TV avec logos, groupes et zapping immédiat au clic.
    - **Streaming** : 21 plateformes officielles avec ouverture directe en deep link.
    - **Replay** : chaînes du Replay officiel français (TF1+, M6+, france.tv, Arte).
    - **VOD** : titres de « Ma Liste » avec accès direct en un clic.
  - Suggestions populaires intégrées quand le champ est vide.
- **Vérifications & Déploiement** :
  - Tests : **178 tests passants / 39 fichiers** (tests ajoutés : `vodWatchlist.test.ts`, `continuePanel.test.tsx`, `globalSearch.test.tsx`).
  - TypeScript : 0 erreur (`tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json`).
  - Production : Build Vite (8.1s) + Capacitor sync + Gradle `assembleRelease` (23s) OK.
  - APK installé sur Motorola Edge 70 (`ZY22MBQQW7`) : **8 508 564 octets**, SHA-256 `81A7B920FF69E87A0D49D51E47F9AEFC2A05D533FEFAE27565AE5B65C00D4892`.
  - Application lancée sur l'appareil (PID 967 vérifié actif via ADB).

## Audio multi-pistes (VF/VO), Gestes tactiles & Enchaînement séries — 4 novembre 2026

- **Audio multi-pistes & préférence Français automatique** :
  - `setPreferredAudioLanguage("fra")` configuré par défaut dans ExoPlayer sur le direct et la VOD.
  - Bouton dédié « Audio » (bleu `#2563eb`) dans la barre d'outils du lecteur natif (`NativePlayerActivity.java`).
  - Sélecteur de piste avec labels en français (*Français*, *Anglais*, etc.), configuration des canaux (Stéréo, 5.1), codecs, et indicateur visuel de la piste active.
- **Contrôles gestuels tactiles sur mobile** :
  - Glissement vertical gauche = réglage de luminosité de l'écran avec HUD temporaire.
  - Glissement vertical droite = réglage du volume média avec HUD temporaire.
  - Double-tap gauche / droite = saut de 10s en arrière / en avant.
- **Enchaînement automatique & zapping des épisodes de séries** :
  - Zapping ‹ et › étendu aux épisodes de la saison en cours.
  - Passage automatique à l'épisode suivant à la fin du média.


## Logos vectoriels des plateformes de streaming & détection automatique — 4 novembre 2026

- **Logos vectoriels SVG autonomes et intégrés** :
  - Création du composant `<PlatformLogo />` (`src/components/PlatformLogo.tsx`) et du moteur de reconnaissance (`src/utils/platformLogos.ts`).
  - Fonctionne **100 % hors-ligne** (aucune requête réseau, aucun CDN externe, aucun problème CORS ni mixed-content HTTP).
  - Rendu vectoriel haute fidélité pour **23 plateformes et réseaux majeurs** :
    - **SVOD & Cinéma** : Netflix (ruban 3D rouge), Disney+ (arche et typographie), Prime Video (sourire cyan), Max (lettrage géométrique blanc sur bleu royal), Apple TV+ (logo Apple blanc et tv+), Canal+ (rectangle noir et croix), Paramount+ (montagne et étoiles), OCS (lettrage cinéma orange).
    - **Anime** : Crunchyroll (oeil/spirale orange), ADN (origami tricolore).
    - **Gratuit & FAST** : YouTube (badge rouge et triangle de lecture), Twitch (bulle robot violette), Pluto TV (orbites jaune/cyan/magenta), Rakuten TV (R TV cramoisi), Plex (chevron ambre).
    - **TV & Replay** : TF1+ (split TF1 et croix), M6+ (cercle 6 et croix), france.tv (barres de couleurs France Télévisions), Arte (arte orange), Molotov TV (flamme Molotov).
    - **Sport** : DAZN (DAZN jaune sur noir), beIN Sports (violet/orange), Eurosport (cercle d'étoiles et lettrage).
- **Refonte de la rubrique Streaming (`StreamingPanel.tsx`)** :
  - Remplacement des anciens badges texte à 2 lettres par les vrais logos vectoriels officiels grand format (`size="lg"` / 48x48 px).
  - Ajout d'une barre de recherche instantanée (« Rechercher une plateforme… »).
  - Ajout de filtres par catégorie : *Toutes (21)*, *SVOD & Cinéma (8)*, *Gratuit & FAST (5)*, *TV & Replay (5)*, *Anime (2)*, *Sport (1)* avec compteurs dynamiques.
  - Cartes enrichies avec étiquettes de catégorie (`SVOD`, `100 % Gratuit`, `Anime`, etc.), mentions tarifaires claires et bouton d'ouverture directe.
- **Détection et fallback automatique dans les chaînes IPTV (`ChannelLogo.tsx`)** :
  - Si une chaîne IPTV ne fournit pas de logo ou que son URL est brisée / 404 / bloque en mixed-content (courant pour les flux IPTV Netflix, Disney+, Prime, Canal+, Paramount, etc.) :
  - `ChannelLogo` inspecte le nom de la chaîne via `matchStreamingPlatformOrNetwork(name)`.
  - S'il correspond à une plateforme ou réseau connu, il affiche instantanément le logo officiel SVG plutôt qu'un bloc gris neutre avec 3 lettres !
- **Harmonisation dans Replay & VOD (`ReplayPanel.tsx` & `VodLibrary.tsx`)** :
  - Affichage des logos de chaînes/plateformes dans le panneau Replay (TF1+, M6+, france.tv, Arte).
  - Affichage d'un badge avec logo officiel de la plateforme pour les catégories VOD (ex. catégories « NETFLIX », « DISNEY+ », « AMAZON PRIME », etc.).
- **Vérifications et déploiement** :
  - TypeScript : 0 erreur (`tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit`).
  - Vitest : **164 tests / 35 fichiers** 100 % passants (`platformLogos.test.ts`, `streamingPanel.test.tsx`, `channelLogo.test.tsx`).
  - Build Vite + Capacitor sync + Gradle `assembleRelease` OK.
  - **APK mis à jour et installé sur Motorola Edge 70** (`ZY22MBQQW7`) : **6 976 179 octets**, SHA-256 `A4BA4F5BD29AD6B22F067E866C0B2F460BC14891685FEE8F765447030ADC82CC`. `adb install -r` Success.


## Système de sous-titres et traduction automatique (FR prioritaire, EN/ES-MX en repli) — 4 novembre 2026

- **Recherche externe multi-sources** :
  - Détection automatique via identifiant IMDb fiabilisé par Cinemeta (`ttXXXXXXX`) et TMDB.
  - Recherche gratuite sans clé via la passerelle OpenSubtitles v3 (`opensubtitles-v3.strem.io`), compatible avec clé personnelle OpenSubtitles v3 ou SubDL si renseignée dans les Paramètres.
  - Normalisation et classement automatique : **Français** (`fre`/`fra`/`fr`) en priorité absolue, **Anglais** (`eng`) et **Espagnol mexicain / latino** (`spa`/`es-mx`/`es-419`) en second recours.
- **Conversion et traduction automatique vers le Français** :
  - En l'absence de sous-titres français officiels, le système récupère la meilleure piste disponible (VO anglaise ou espagnole) et traduit automatiquement les répliques en français via l'API Google Translate `gtx` (gratuite, instantanée, sans inscription) ou DeepL (si clé renseignée).
  - Préservation scrupuleuse des timecodes (`00:00:00,000 --> 00:00:00,000`), des retours à la ligne et du balisage. Traduction d'un film complet en ~2 à 4 secondes avec barre de progression interactive.
  - Mise en cache locale (IndexedDB) pour que les sous-titres traduits soient conservés et disponibles instantanément aux visionnages suivants sans re-traduction.
- **Synchronisation temporelle (+/-)** :
  - Outil de calage intégré dans le sélecteur : `-1.0s`, `-0.5s`, `0s`, `+0.5s`, `+1.0s` pour compenser les éventuels décalages d'intro des flux IPTV.
- **Intégration double lecteur** :
  - **Android (ExoPlayer)** : `NativePlayerPlugin.java` génère un fichier cache temporaire UTF-8 `.srt` ou transmet l'URL et l'injecte directement dans ExoPlayer via `MediaItem.SubtitleConfiguration`. ExoPlayer configure également `setPreferredTextLanguage("fra")` pour privilégier le français sur les pistes internes et externes.
  - **Web (`WebVodPlayer`)** : injection dynamique d'un `<track kind="subtitles" default />` au format WebVTT.
- **Nouveaux fichiers & modifications** :
  - `utils/subtitleTranslator.ts` (analyse SRT, conversion VTT, calculs millisecondes, shift temporel, traduction par lots).
  - `utils/subtitles.ts` (recherche, résolveur IMDb Cinemeta, normalisation des langues, cache IndexedDB).
  - `components/SubtitleSelector.tsx` (interface avec état en un coup d'œil, bouton 1-clic traduction, barre de progression et réglette de synchro).
  - `utils/storage.ts` (migration paramètres v6 : toggles sous-titres, traduction automatique, clés API facultatives DeepL et OpenSubtitles).
  - `components/SettingsPanel.tsx` (rubrique dédiée Sous-titres & Traduction).
  - `components/VodLibrary.tsx` (intégration dans la fiche film et épisode).
  - `NativePlayerPlugin.java` & `NativePlayerActivity.java` (prise en charge des sous-titres injectés et préférence langue).
  - Tests : `subtitleTranslator.test.ts` (7 tests), `subtitles.test.ts` (3 tests), `nativePlayer.test.ts` (1 test sous-titre), `storageSettings.test.ts` (migration v6).
- **Vérifications** :
  - TypeScript OK (`tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit` sans erreur).
  - Vitest : **134 tests / 29 fichiers** 100 % passants.
  - Build Vite + Capacitor sync + Gradle `assembleRelease` OK.
  - **APK mis à jour et installé sur Motorola Edge 70** : **6 968 792 octets**, SHA-256 `168955DB8023D1C4B45D0367498553C652689AA5A481BC9E484B93C907A1E244`. `adb install -r` Success.

## Rubrique Streaming (plateformes officielles) — 4 novembre 2026

- **Nouvelle rubrique « Streaming »** (6ᵉ onglet) : accès en un tap aux plateformes de streaming officielles — YouTube (gratuit), Netflix, Prime Video, Max (ex HBO Max), Apple TV+, Disney+, Canal+, Paramount+ (abonnement), Twitch (gratuit), Molotov (freemium).
- **Ouverture officielle uniquement** : même mécanisme `openWeb` que le Replay (`ACTION_VIEW` sans forcer un type vidéo) → l'app officielle si installée (deep link), sinon le navigateur. Aucun flux piraté, aucune API privée ni contournement de DRM/d'abonnement.
- **Fichiers** : `StreamingPanel.tsx` (nouveau), `data/streamingPlatforms.ts` (nouveau), onglet dans `MainNavigation.tsx` (passage `grid-cols-5` → `grid-cols-6`) + `IPTVPlayer.tsx`, test `mainNavigation` mis à jour (6 onglets). Guide : `GUIDE-STREAMING.md`.
- **Vérifications** : TypeScript OK, ESLint propre sur les fichiers modifiés, **123 tests / 27 fichiers** OK, build Vite + `cap sync` + `assembleRelease` OK.
- **APK reconstruit et installé** : **6 962 673 octets**, SHA-256 `07DBFAB2F7DE2D69AC65BF49066F7CB148A2724D289CEA5BEC6362F515C948BF`. `adb install -r` Success, app lancée sur le Motorola Edge 70.
- **Non vérifié sur téléphone** : ouverture réelle de chaque plateforme (deep link vers les apps officielles installées) ; à confirmer par l'utilisateur.

## Rubrique Replay officiel intégrée — 4 novembre 2026

- **Nouvelle rubrique « Replay »** (5ᵉ onglet) dans le lecteur : accès en un tap au replay **officiel** des chaînes françaises, groupées par plateforme — TF1+ (TF1, TMC, TFX, TF1 Séries Films, LCI), M6+ (M6, W9, 6ter, Gulli), france.tv (France 2/3/4/5, franceinfo), Arte.
- **Ouverture officielle uniquement** : sur Android, l'app officielle si installée (deep link) sinon le navigateur ; sur PC, le site. Aucun flux piraté, aucune rétro-ingénierie d'API privée ni DRM. M6+ nécessite un compte 6play gratuit.
- **Guide « en ce moment / à suivre »** alimenté par l'EPG déjà présent dans l'app (aucune source externe) ; absent sans liste/guide actif, sans bloquer le replay.
- **Fichiers** : `ReplayPanel.tsx`, `data/replayChannels.ts`, méthode native `openWeb` (`nativePlayer.ts` + `NativePlayerPlugin.java`), onglet dans `MainNavigation.tsx` + `IPTVPlayer.tsx`. Guides : `GUIDE-REPLAY.md`, `REA-REPLAY-KODI.md`.
- **État de l'art Kodi** (demande utilisateur) documenté dans `REA-REPLAY-KODI.md` : la référence « CatchUp TV & More » (GPL v2) confirme que le replay français repose partout sur des API privées (mytf1, 6play/Algolia, `yatta.francetv.fr`, player Arte) + DRM Widevine + comptes, avec des correctifs « Fix replay » à chaque release. Aucune API publique documentée → lecture intégrée écartée.
- **Vérifications** : TypeScript OK, **123 tests / 27 fichiers** OK (test `mainNavigation` mis à jour pour le 5ᵉ onglet), build Vite OK. ESLint : mes fichiers propres (les 4 erreurs `ChannelList`/`XtreamLoginDialog`/`useVideoPlayer` sont préexistantes et non liées).
- **APK reconstruit et installé** (mise à jour en place, données conservées) : **6 961 657 octets**, SHA-256 `2E7F1E38A8FC4A33380F89B60AAA6BC9B836678A346518F56F43D8AC0663D75D`. `assembleRelease` OK, `adb install -r` Success, `base.apk` installé **identique** au racine (pull + SHA-256 comparés). App lancée sur le Motorola Edge 70.
- **Non vérifié sur téléphone** : ouverture réelle du replay (deep link vers les apps officielles) ; à confirmer par l'utilisateur.

## Flux publics légaux intégrés + APK 1.4.2 installé — 4 novembre 2026

- **Playlist publique légale intégrée** : `application/public/flux-legaux.m3u`, **2 465 chaînes** groupées par pays (États-Unis 1 093, Italie 331, Espagne 284, Royaume-Uni 230, Mexique 222, France 212, Belgique 62, Suisse 31). Source : projet open-source `iptv-org/iptv` (flux diffusés publiquement et gratuitement par les diffuseurs — chaînes publiques, d'information, locales). Aucune chaîne payante n'est incluse ; aucune offre pirate utilisée.
- **Bouton « Charger »** ajouté dans `PlaylistLoader.tsx` (accueil et Mes listes) : encart « Chaînes publiques gratuites ». Chargement par le même pipeline que tout import (worker, déduplication, enregistrement, favoris conservés) ; recharger la liste la remplace au lieu de créer un doublon.
- **Maintenance** : sources par pays dans `flux-legaux-source/`, script `merge-flux.mjs` (racine) qui régénère `application/public/flux-legaux.m3u` (`node merge-flux.mjs`). Guide : `GUIDE-FLUX-LEGAUX.md`.
- **Vérifications** : TypeScript OK, **123 tests / 27 fichiers** OK, build Vite OK, `flux-legaux.m3u` présent dans `dist/` et dans les assets Android (`assets/public/`).
- **APK 1.4.2 / code 10** — le `build.gradle` était déjà passé à 1.4.2/10 (le journal précédent s'arrêtait à 1.4.1/9) : **6 959 750 octets**, SHA-256 `6E51104A670F9C166C43F4900669B10F10E3670C8516B94B14ABBCFDF096913B`. Signature v1/v2 valide, même certificat debug `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`.
- **Installé sur le Motorola Edge 70** par `adb install -r` (Success) ; `base.apk` installé **identique octet pour octet** à l'APK racine (pull + SHA-256 comparés). Application lancée.
- **Non vérifié sur téléphone** : lecture réelle des flux publics, guide EPG (aucune source EPG associée à ces chaînes). Les URL publiques sont changeantes (géo-blocage, chaînes non permanentes) : régénérer via `merge-flux.mjs` en cas de flux morts.

## Essais physiques terminés — 1.4.2 installée, 4 novembre 2026

- Compte reconnecté après accord explicite ; liste ramenée à **987 chaînes françaises / 14 groupes**. Copie de l'import complet (22 280 chaînes) conservée dans la base locale sous `beforeFrenchSelection_2026-11-04`. Aucun identifiant dans ce journal.
- **Guide réel chargé**, programmes affichés pour aujourd'hui et la veille ; pas de débordement horizontal du document constaté à 406 px CSS. Des chaînes peuvent rester sans programme fourni/associé ; couverture de chaque chaîne non vérifiée.
- **Direct natif** : image TF1 constatée ; zapping depuis carte puis depuis lecteur web, retour aux chaînes et mémorisation de la chaîne finale constatés (TF1 FHD puis TF1 +1 FHD). Pas de lecture web active au retour de VOD.
- **Film réel** « La Main sur le berceau - 2026 » : fiche fournisseur, image, pause à environ 53 s, position sauvegardée 53 202 ms, reprise et progression à 65 608 ms / durée 6 299 710 ms constatées.
- **Vikings S01E01** : 6 saisons, 9 épisodes en saison 1 ; image réelle, pause à environ 39 s (38 810 ms), reprise et avance +15 s, position finale 88 921 ms / durée 2 799 008 ms constatées. Captures de lecture, pause et reprise disponibles.
- Deux défauts d'affichage corrigés pendant les essais : barre native portrait (titre écrasé et VLC hors écran à cause des largeurs minimales Android) ; en-tête Direct qui cassait son titre sur trois lignes. Boutons natifs à largeur bornée, titre avec ellipse ; commandes Direct sur une seconde ligne mobile. Contrôles visuels réussis.
- **APK release finale 1.4.2 / code 10 installée**, **6 878 652 octets**, SHA-256 `b41a922d0c6e18aeb26d2650cd0a846a0f35e2ef9ec739942cfabb35e24c764d`. Empreinte installée identique, signature v1/v2 et certificat antérieur, **19/19 fichiers web** conformes. Accueil final affiche les 987 chaînes et l'en-tête corrigé ; nouvelle lecture TF1 HD observée sur cette release, puis flux arrêté par Retour.
- Validation : suite 123 tests de stabilisation précédemment réussie ; après le dernier ajustement web, **TypeScript + les 2 tests d'intégration de navigation** rejoués avec succès, Vite/Capacitor/Gradle release réussis. Correctif Java vérifié par compilation release/debug et sur appareil.
- Preuves finales et portée : `preuves/stabilisation-1.4.2/RAPPORT.md`, `apk.json`, `telephone.json`, captures ; preuves film et premier zapping dans `preuves/stabilisation-1.4.1/`. Variante debug remplacée par release, données conservées. Aucun effacement du profil privé.
- Limites : pas d'écoute audio ni mesure FPS/longue stabilité ; fiches TMDB réelles non testées faute de clé ; recommandations pas évaluées qualitativement. Mosaïque huit flux non rejouée pendant cette passe. Prochaine évolution proposée : **Continuer à regarder + Ma liste**, non implémentée ici.

## Reconnexion du compte — 4 novembre 2026, essais physiques à reprendre

- L'utilisateur fournit les accès par capture puis confirme explicitement leur utilisation auprès du serveur indiqué. Les accès ne sont pas recopiés dans ce journal ni dans les rapports.
- Connexion effectuée avec succès depuis le formulaire de l'application : **288 catégories**, import terminé à **22 280 chaînes**, **987 chaînes françaises dans les groupes FR** constatées en lecture de la base applicative. Le périmètre de l'import est donc plus large que la sélection France visée.
- La réduction de cette nouvelle liste aux groupes FR, avec conservation préalable d'une copie locale récupérable de l'import complet, **n'a pas été exécutée** : le contrôle automatique des actions a d'abord été interrompu par une limite d'usage. La nouvelle tentative autorisée par « ok » a trouvé le téléphone absent d'ADB, y compris après relance du service.
- **Variante de contrôle debug 1.4.1/code 9 actuellement dernière installation connue**, temporairement installée pour automatiser la reconnexion ; remettre l'APK release racine en fin d'essais, sans désinstallation ni effacement des données. La preuve d'empreinte release du paragraphe antérieur décrit l'état AVANT cette nouvelle passe.
- Le compte est reconnecté ; **lecture réelle, guide fournisseur, zapping et reprise film/épisode restent non validés** dans cette passe. Téléphone demandé rebranché, déverrouillé et sur IPTV. Les autorisations de connexion et de test déjà données persistent ; ne pas redemander les accès.
- À reprendre : vérifier présence USB et état courant ; conserver une copie de la nouvelle liste, limiter aux groupes FR comme prévu ; essais guide/zapping deux entrées/film/épisode/pause/reprise ; réinstaller release et revérifier l'empreinte. Ne pas supprimer la copie du profil privé.

## Stabilisation Codex 1.4.1 — 4 novembre 2026, installée

- Suite au GO utilisateur : corrections des six premiers constats de la revue, avec maintien des apports Claude/DeepSeek. Guide complet et états explicites/réessai/cache source/renouvellement horaire ; rapprochement TMDB strict et titres numériques préservés ; historique VOD séparé par liste/type et écritures atomiques ; recommandations isolées ; conservation des identifiants lors des réimports/actualisations ; zapping natif commun aux cartes et au lecteur, contexte privé hors message Binder, dernière chaîne renvoyée et mémorisée.
- **123 tests / 27 fichiers**, TypeScript, Vite, synchronisation Capacitor et assemblages Android réussis. Les diagnostics de défaut de la revue restent historiques ; nouveaux tests d'acceptation dans `application/src/test/`.
- APK final **1.4.1 / code 9**, **6 878 496 octets**, SHA-256 `e29ba795e5cfb527fc42846f35e1a0683579b253dc4586ce5635bd851bd4f3f4` ; signature v1/v2, même certificat, **19/19 ressources web** conformes. APK 1.4.0 et sources antérieures sauvegardés dans `sauvegardes/stabilisation-1.4.1-2026-11-04/`.
- Téléphone retrouvé après relance ADB. Le profil principal n'avait plus l'application ; utilisateur confirme « non installée ». **Installation sur profil principal réussie** ; ancienne copie de profil privé conservée, sans déverrouillage. Variante debug utilisée temporairement pour vérifier l'absence de listes ; **release compacte finale réinstallée**, empreinte du fichier installé identique à l'APK racine. Accueil et bouton Connexion Xtream confirmés dans l'interface Android.
- **Essais des flux réels en attente de reconnexion du compte par l'utilisateur sur le téléphone** : profil principal vide, sauvegardes JSON locales limitées aux fixtures de test, non restaurées. Guide de l'abonnement, zapping réel et reprise d'épisode ne sont pas déclarés validés. Clé TMDB réelle non fournie. Ne pas confondre installation et lecture vérifiée.
- Rapport et preuves : `preuves/stabilisation-1.4.1/RAPPORT.md`, `apk.json`, `telephone.json`, `signature.txt`.
- Prochaine action : après connexion/import Xtream, vérifier guide, zapping depuis carte puis lecteur, film et épisode/pause/reprise. **Continuer à regarder + Ma liste** restent la prochaine évolution, non ajoutée à 1.4.1.

## Revue Codex du 4 novembre 2026 — sans modification fonctionnelle

- Revue du résultat cumulé des interventions Claude/DeepSeek ; attribution individuelle non vérifiable sans historique de versions. Rapport : `REVUE_PROJET_2026-11-04.md`.
- Reproduits : **106 tests / 23 fichiers**, TypeScript, Vite isolé et Gradle `assembleRelease` réussis. APK racine **1.4.0/code 8**, **6 875 667 octets**, SHA-256 `491D46DF8F33300B421B1E25DA90914FBFE951DFD2FDBB92E2B2509011EDB3B6`, signature v1/v2 avec même certificat ; **19/19 fichiers web reconstruits** identiques à l'APK.
- **Huit diagnostics locaux séparés** reproduisent des défauts : programme en cours supprimé d'un guide long, passé tronqué malgré la navigation par jour, chargement infini sans source EPG, titres numériques mal normalisés, rapprochement TMDB acceptant une suite, historique VOD mélangé au direct/autres listes/séries, identité des chaînes dépendant du nom de parsing. Leurs assertions confirment des défauts actuels ; elles ne sont pas des tests d'acceptation. Preuves dans `preuves/revue-2026-11-04/`.
- Autres limites lues dans le code : raccourci natif des cartes sans contexte de zapping ; chaîne finale zappée non remontée au web ; cache VOD local au composant ; guide sans renouvellement périodique.
- Téléphone absent d'ADB : aucune nouvelle installation ni validation physique. Code fonctionnel et APK racine conservés.
- Proposition : stabilisation 1.4.1, puis **Continuer à regarder + Ma liste**, épisode suivant, mosaïques enregistrées/PiP. Aucune de ces propositions mise en œuvre pendant la revue.

## État actuel — recommandations et fiches TMDB, 4 novembre 2026 vers 0 h (Mérida)

- **Version 1.4.0 / code 8** (APK racine remplacé, même certificat debug → mise à jour USB en place possible).
- **Recommandations « Pour toi »** : historique VOD enregistré à la lecture (`utils/idb.ts` étendu : kind, nom, catégorie, année), moteur local `utils/recommendations.ts` (même catégorie + titres proches, pondérés par la fraîcheur, titres déjà vus exclus). Rangée « Pour toi » dans l'onglet Films ; le catalogue complet n'est chargé que si des films ont déjà été regardés.
- **Fiches enrichies TMDB** (`utils/tmdb.ts` + `components/TmdbPanel.tsx`) : synopsis français, genres, durée, note spectateurs (★/10 + votes), revenu mondial (≈ entrées au cinéma), réalisation, casting, **films similaires** (clic : catalogue si présent, sinon page TMDB) et **avis spectateurs** (lecture complète avec « Lire plus »). Clé API TMDB gratuite à saisir dans les paramètres (champ dédié). Cache IndexedDB 12 h ; sur Android, requêtes via CapacitorHttp (pas de CORS).
- Rapprochement titre Xtream → TMDB par normalisation stricte (`utils/titleNormalize.ts` : balises de qualité FRENCH/4K/1080p…, accents, année) — un titre mal nommé affiche « Titre introuvable sur TMDB » au lieu d'un mauvais film.
- **Limite assumée** : critiques de presse indisponibles (aucune API gratuite ; AlloCiné sans API publique et protégé) → avis spectateurs TMDB en remplacement ; « entrées au cinéma » France payantes → revenu mondial TMDB en proxy.
- **106/106 tests, 23 fichiers** (nouveaux : titleNormalize, recommendations, tmdb + migration v5 des paramètres), typecheck et build web OK. Bundle principal 606 Ko.
- Fichiers : `utils/titleNormalize.ts`, `utils/recommendations.ts`, `utils/tmdb.ts`, `components/TmdbPanel.tsx` (nouveaux) ; `components/VodLibrary.tsx`, `components/SettingsPanel.tsx`, `components/IPTVPlayer.tsx`, `utils/idb.ts`, `utils/storage.ts` (v5) modifiés.
- **Non vérifié sur téléphone** : APK 1.4.0, fiches TMDB réelles (clé à créer sur themoviedb.org → Paramètres → API), recommandations après quelques visionnages.

## État antérieur — grille des programmes (guide TV), 3 novembre 2026 vers 23 h 30 (Mérida)

- **Version 1.3.0 / code 7** (APK racine remplacé : **6,55 Mo**, SHA-256 `1A51E9C2780B7B3C5E07778FCDD95C241E6F4C1DBB3C8F9E7DA5DCB58D82EDA2`). Même certificat debug → mise à jour USB en place possible. Preuve : `preuves/apk-1.3.0-signature.txt`.
- **Grille des programmes** : bouton « Grille » dans Chaînes en direct (bascule Liste/Grille). Chaînes en lignes, journée complète en colonnes (défilement horizontal), ligne rouge « maintenant », navigation ‹ › par jour (français), boutons « Maintenant » / « Aujourd'hui », clic sur un programme = lecture de la chaîne, chaîne en cours surlignée. Programmes à cheval sur minuit tronqués correctement. Seules les chaînes avec guide sont affichées ; message si aucune donnée. Logique de positionnement extraite dans `utils/epgGrid.ts` (testable, sans DOM).
- **91/91 tests, 21 fichiers** (8 nouveaux cas de positionnement de grille), typecheck et build web OK. Bundle principal 592 Ko (+14 Ko pour la grille).
- Fichiers : `components/EPGGrid.tsx` (nouveau), `utils/epgGrid.ts` (nouveau), `src/test/epgGrid.test.ts` (nouveau), `components/IPTVPlayer.tsx` (bascule Liste/Grille).

## État antérieur — allègement, performance et guide EPG, 3 novembre 2026 vers 23 h (Mérida)

- **Version 1.2.0 / code 6 préparée** (APK racine remplacé : **6 548 132 octets**, SHA-256 `9A45F819B3FC672FCA4C5465C24680AA55886FBB244A5AC374105DBA3BBFA9CC`). Signature v1/v2 valide, **même certificat** que 1.1.1 → mise à jour USB possible sans réinstaller. **19/19 fichiers web** identiques à `dist/` (vérifiés par SHA-256). Preuve : `preuves/apk-1.2.0-signature.txt`.
- **Allègement** : 18 dépendances supprimées (supabase, react-query, react-hook-form, express, cors, http-proxy-middleware, cmdk, vaul, embla, date-fns, next-themes, day-picker, input-otp, resizable-panels, 9 paquets Radix inutilisés, @types/uuid) ; 35 composants `ui/` morts et 6 composants de diagnostic morts supprimés ; `proxy-server.js` hérité supprimé (l'actif est `proxy-server.mjs`). Bundle principal : **1,6 Mo → 578 Ko** ; `hls.js` (599 Ko), `recharts` (404 Ko) et `mpegts.js` (277 Ko) chargés dynamiquement à la demande.
- **Import des listes dans un Web Worker** (`utils/parseWorker.ts`, worker `m3uParserWorker.ts` enfin branché) : plus de gel de l'interface sur les listes de 200 000 chaînes ; repli automatique sur le fil principal si le worker est indisponible.
- **APK release minifié (R8 + shrinkResources)**, signé avec le certificat de débogage : 11,9 Mo → **6,5 Mo**. `Construire l'APK.cmd` produit désormais `assembleRelease` ; scripts passés à `corepack pnpm`.
- **Guide des programmes réel (EPG XMLTV)** : parseur `utils/epgXmltv.ts` (dates XMLTV et ISO, correspondance tvg-id/nom), téléchargement gzip (proxy web ou CapacitorHttp natif) dans `utils/epg.ts`, cache IndexedDB 12 h, hook `useEPG`. Source : `xmltv.php` du compte Xtream lié, sinon adresse XMLTV personnalisée dans les paramètres. Affichage « en ce moment / ensuite » dans la liste des chaînes. Le générateur synthétique est supprimé.
- **Rafraîchissement d'une liste** : bouton ↻ dans « Mes listes » pour les listes importées par URL (identité, favoris et variantes conservés). Réimport d'une source connue = remplacement de la liste existante (plus de doublons).
- **Zapping** : boutons ‹ › et touches PageUp/PageDown dans le lecteur web ; dans le lecteur Android natif, flèches ‹ › dans la barre haute avec passage à la chaîne précédente/suivante (liste ordonnée transmise au plugin).
- **Reprise automatique après coupure réseau** (réglable dans les paramètres, activée par défaut) : le lecteur web relance le dernier flux quand la connexion revient.
- Toasts et libellés anglais restants traduits en français.
- **83/83 tests, 20 fichiers** (dont 9 nouveaux cas EPG/XMLTV), TypeScript, Vite, Capacitor et Gradle `assembleRelease` réussis. État 1.1.1 préservé dans `sauvegardes/avant-allegement-2026-11-03/` et dans les sauvegardes antérieures.
- **Non vérifié sur téléphone** : installation de 1.2.0, EPG réel sur l'abonnement, zapping natif, reprise réseau réelle. À valider sur un créneau téléphone.
- Audit détaillé : `AUDIT_GLOBAL_2026-11-03.md`.

## Historique — version 1.1.1

- **Version 1.1.1 / code 5 installée par mise à jour USB** sur le Motorola Edge 70 ; listes conservées.
- Quatre rubriques sur une seule ligne : **Direct, Films, Séries, Mosaïque**. Icônes et textes, cibles égales, onglet actif violet. Lecteur rattaché au Direct avec retour aux chaînes ; import/export/sauvegarde déplacés dans **Mes listes**, paramètres conservés dans l’en-tête.
- État du lecteur toujours indiqué dans Direct ; toucher Direct depuis le lecteur retourne à la liste. Retour de Mes listes vers la rubrique précédente.
- **88/88 tests, 19 fichiers**, TypeScript, Vite, Capacitor et Gradle réussis. Nouvelle vérification fonctionnelle de la navigation avec lecteurs et catalogues simulés.
- Sur le WebView réel, quatre onglets constatés ; cibles de 92 × 56 px CSS à la largeur du téléphone. Mesures émulées à **320, 360, 768 et 1 280 px** : une rangée, pas de texte coupé ni débordement de l’en-tête. Détails : `preuves/menu-1.1.1-responsive.json`.
- APK racine : **11 910 077 octets**, SHA-256 `39BDD99641965ABD4F8755EB14ED107C634276C5836BFC4D54A792DDF43F6529`. Signature v1/v2 valide, même certificat ; **16/16 fichiers web** identiques à `dist/` ; SHA-256 du `base.apk` installé identique. Preuves : `preuves/apk-1.1.1-signature.txt`, `preuves/menu-1.1.1-apk.json`.
- Audit limité au menu : `AUDIT_DESIGN_2026-11-03.md`. État et APK 1.1.0 préservés dans `sauvegardes/menu-superieur-2026-11-03/`.
- Les vérifications VOD et de lecture prolongée encore ouvertes ci-dessous restent distinctes de cette amélioration du menu. Aucun changement du moteur vidéo dans 1.1.1.

## Historique — mosaïque et VOD, 3 novembre 2026 au soir

- L’utilisateur confirme que le lecteur natif 1.0.2 fonctionne bien. Il autorise ensuite la mosaïque et les films/séries ; son compte affiche déjà huit chaînes dans TiviMate selon son essai.
- **Version 1.1.0 / code 4 installée par USB**, liste de 966 chaînes conservée. Le SHA-256 de l’APK installé correspond exactement à l’APK racine : `E38315756836C661D4BE27339EB52D8730FD62D3FCAF9999F258E1E098FE288F`, **12 331 337 octets**. Signature valide, même certificat, 16/16 ressources web identiques à `dist/`.
- Mosaïque Android **2 à 8 chaînes**, son sélectionné par toucher, agrandissement/grille, erreurs individuelles, arrêt de tous les flux en arrière-plan. **Huit images HD simultanées observées** sur le Motorola Edge 70. Pas de mesure de fluidité longue ni d’écoute par l’agent.
- **Films et Séries raccordés à Xtream** : catégories, recherche, affiches et fiches ; saisons et épisodes. Les accès de la liste restaurée sont retrouvés sans redemander les identifiants. Lecture VOD native en paysage, commandes Media3 et reprise mémorisée ; repli web pour formats compatibles.
- Film avec image observé ; position native sauvegardée relue. Catalogue et six saisons de Vikings observés ; lancement S01E01 et durée 46:39 affichés, mais capture encore en chargement : **lecture continue d’un épisode et parcours tactile complet pause/déplacement/reprise restent à confirmer**.
- **87/87 tests, 18 fichiers**, TypeScript, Vite, Capacitor, Gradle réussis. Relais PC testé avec données locales : catalogue, encodage, Range, redirections. Correction de la requête vidéo du proxy qui n’était pas envoyée (`end()` absent).
- Rapport détaillé et limites : `preuves/MOSAIQUE-VOD-2026-11-03.md`. Sauvegarde complète précédente : `sauvegardes/mosaique-vod-2026-11-04/`.
- Prochaine vérification : sur un créneau téléphone disponible, lecture réelle d’un épisode, pause, déplacement, retour/reprise, puis mosaïque huit images prolongée et Home/retour. Les sections ci-dessous sont l’historique des versions 1.0.x.

## Dernière vérification sur téléphone — 3 novembre 2026, vers 21 h 10 (Mérida)

- **État actuel : version 1.0.2 / code 3 installée sur le Motorola Edge 70, Android 16, par USB.** Mise à jour additive réussie depuis 1.0 puis 1.0.1 ; liste de 966 chaînes toujours visible.
- L'essai de 1.0.1 sur appareil a reproduit un crash à l'ouverture native : `NullPointerException` dans `hideSystemUI`, car `Window.getInsetsController()` était appelé avant la création du décor de fenêtre. Corrigé en créant l'interface avant le plein écran, en obtenant le contrôleur depuis la vue de décor et en réappliquant le masquage après acquisition du focus.
- **1.0.2 : lecture native de TF1 HD avec image observée, Retour à la liste réussi, seconde ouverture native réussie.** Aucun crash fatal dans les journaux du processus corrigé pendant ces essais courts. Le lecteur est laissé en lecture native pour l'essai humain.
- APK racine : **11 816 669 octets**, SHA-256 `CD32E17DB3D6C3DDD95165D77BE5683D79DCDAFA0521ADE266FA5627EDF2A1D8`, signature v1/v2 valide avec le même certificat. APK 1.0.1 conservé dans `sauvegardes/reprise-codex-2026-11-03/Lecteur-IPTV-1.0.1.apk`.
- Rapport actuel : `preuves/ANDROID-SUR-TELEPHONE-2026-11-03.md`. La section de reprise 1.0.1 ci-dessous documente l'état antérieur au branchement du téléphone.
- Non validés : écoute humaine, fluidité continue pendant dix minutes, réseau coupé/rétabli, Home/retour, casque et lecteur externe. VLC n'est pas installé d'après la recherche du paquet `org.videolan.vlc`. Les flux privés ont été utilisés uniquement via la chaîne sélectionnée dans l'application pendant ces essais.

## Contexte retrouvé

Conversation précédente : « Reprendre le lecteur IPTV », identifiant `01a1a2c2-a52f-72f0-9164-ecdbb0135d6f`. Elle était archivée et a été désarchivée pendant cette reprise. La conversation courante est `01a1a2cd-2235-7680-be07-50ee06ce2f9d`.

Le projet personnel inachevé a été retrouvé dans des sauvegardes de G:. Les recherches, chemins originaux et limites figurent dans `BILAN-RECUPERATION-IPTV-2026-11-03.md`. Ne pas recommencer la recherche sur tous les disques.

## Où travailler

- Racine : `C:\Users\C2k\Documents\ChatGPT\Lecteur IPTV`.
- **Copie de travail active : `application/`**, créée à partir des sources préservées.
- `sources-retrouvees/` : copie de récupération intacte, ne pas y développer.
- `version-historique-zip/` et `sauvegardes/` : archives conservées.
- Aucun dépôt Git n’est initialisé à la racine. Le bundle sauvegardé reste disponible ; aucun commit ni push effectué pendant cette reprise.
- Lire aussi les règles communes `D:\AIOS\AGENTS.md` avant une nouvelle tâche.

## Ce qui a été fait

1. Raccordement de la page d’entrée au composant IPTV principal, restauration du panneau de paramètres manquant, correction du contrôle TypeScript réel (`tsc -p`, auparavant le script ne visait pas correctement l’application).
2. Installation avec le verrou pnpm 8 existant, ajout de HLS.js **1.7.4** comme dépendance fixée. Suppression du téléchargement HLS depuis un CDN et du plugin de repérage MGX dans le lancement.
3. Import M3U depuis fichier ou URL simplifié. Suppression des relais publics automatiques, des adresses/identifiants codés dans le chargeur et des journaux de contenu de playlist. Aucun flux privé ni ancien abonnement contacté.
4. Le parsing de fichier reste hors ligne, même si un fichier contient une URL seule. Les exemples inclus pointent désormais vers des médias de contrôle locaux.
5. Cycle de vie vidéo repris : callbacks stables, modification du volume sans destruction HLS, reprises limitées à cinq, annulation lors du zapping/arrêt/démontage, prise en compte de la fin de vidéo, lecture manuelle possible quand autoplay est désactivé.
6. Identifiants de chaînes dérivés de la source, du tvg-id/nom et de l’URL ; stables après réordonnancement. Deux chaînes distinctes peuvent partager une URL vidéo sans partager leurs favoris. Conservation des variantes lors d’une montée en qualité.
7. Favoris affichés pour la liste active ; export avancé lit les favoris actuels. Suppression du double déclenchement du bouton Lecture dans les cartes. Les raccourcis respectent les champs et les dialogues.
8. Paramètres chargés avant la restauration initiale ; choix de la dernière liste par identifiant pour distinguer les listes homonymes. Les listes sauvegardées restent accessibles si la reprise automatique est désactivée.
9. Accueil et quelques commandes francisés ; boutons principaux nommés pour leur usage au clavier.
10. **Sauvegarde et restauration complètes** : export et import JSON validés par schéma strict Zod (`src/utils/backup.ts`, `BackupPanel.tsx`). Restauration additive atomique : les listes existantes et réglages sont préservés, les nouvelles listes sont ajoutées et les favoris sont fusionnés.
11. **Moteur de recherche et filtres fiabilisés** : index inversé avec normalisation Unicode (`\p{L}\p{N}`), support des sous-chaînes, diacritiques, alphabets non latins (arabe, cyrillique…) sans fusion abusive des variantes (`src/utils/channelSearch.ts`, `m3uParser.ts`). Hydratation asynchrone sécurisée empêchant l'écrasement des réglages par défaut.
12. **Virtualisation de l'affichage** : intégration `@tanstack/react-virtual` sur la liste des chaînes (`ChannelList.tsx`) ; sur une liste de 200 000 chaînes, seules 18 lignes DOM sont chargées en mémoire.
13. **Correction de la compilation de production** : résolution de l'écran blanc provoqué par le découpage manuel de chunks (`vite.config.ts`). Validation complète de la version `dist/` en mode `preview`.
14. **Support des flux réels MPEG-TS & Proxy local anti-CORS** :
    - Serveur mandataire local (`application/proxy-server.mjs`) sur `127.0.0.1:5179` : injection transparente du `User-Agent: IPTVSmartersPro`, en-têtes CORS universels, relais en streaming des flux distants et requêtes API.
    - Intégration de `mpegts.js 1.8.2` dans `useVideoPlayer.ts` via import dynamique pour démultiplexer les flux MPEG-TS (H.264 + AAC) en mémoire directement dans la balise vidéo HTML5 (MSE).
15. **Module d'importation directe Xtream Codes** :
    - Dialogue `XtreamLoginDialog.tsx` accessible depuis l'accueil et le chargeur de playlist.
    - Permet la connexion avec serveur, identifiant et mot de passe, l'exploration des catégories (dont filtre rapide "France uniquement") et l'import direct des chaînes sélectionnées dans IndexedDB.
    - Lanceur `Lancer le lecteur.cmd` mis à jour pour démarrer à la fois le proxy (5179) et le serveur web (5178).

## Lancer

- **Version PC (Web + Proxy)** : Double-cliquer sur `Lancer le lecteur.cmd` depuis la racine. Il démarre le proxy local (`proxy-server.mjs` sur le port 5179), lance Vite sur le port 5178 et ouvre le navigateur. Adresse fixe : **http://127.0.0.1:5178/**, accessible sur cet ordinateur uniquement.
- **Application Android (APK)** :
  - Le package compilé est prêt à l'emploi : `Lecteur-IPTV.apk` (à la racine du projet).
  - Pour recompiler l'APK après modification du code : double-cliquer sur `Construire l'APK.cmd`.
  - En mode Android natif (Capacitor), l'application contacte directement le serveur Xtream et lit les flux en direct sans avoir besoin du serveur proxy Node.js local de l'ordinateur, avec gestion du trafic clair (`usesCleartextTraffic`) et détection de réseau.

Pour tester le proxy PC directement : `http://127.0.0.1:5179/status`.

Pour réinstaller les dépendances : `corepack pnpm install`.

## Reprise Codex du 3 novembre 2026 — lecteur Android

État hérité sauvegardé avant modification dans `sauvegardes/reprise-codex-2026-11-03/`, y compris l'ancien APK et cette note. Les anciennes annonces de « résolution définitive », « zéro lag », décodage exclusivement GPU ou équivalence avec TiviMate ne sont pas des résultats mesurés et ne doivent pas être reprises comme preuves.

### Correctifs effectués

- Passation web → Android : destruction de HLS/MPEG-TS, fermeture de la source HTML et annulation des reprises avant l'appel du plugin, depuis tous les boutons et menus. Un verrou partagé bloque doubles clics et lectures asynchrones tardives pendant la délégation.
- Le plugin utilise maintenant le retour d'activité Capacitor. Le verrou est libéré au retour Android ; la lecture web reste arrêtée jusqu'à une action de l'utilisateur. Le bouton Lecture peut reprendre le flux web interrompu.
- ExoPlayer libère ses ressources dès `onPause`, notamment avant VLC et en arrière-plan. Au retour, le direct est recréé. Configuration du focus audio et arrêt lors du débranchement d'un casque.
- Les échecs d'ouverture sont affichés. Les messages personnalisés n'incluent plus les exceptions susceptibles de contenir une URL privée. Validation HTTP/HTTPS et disponibilité du plugin limitée à Android.
- Bouton natif « Réessayer la lecture » après erreur. Libellés « zéro lag » retirés de l'interface.
- Version Android **1.0.1**, `versionCode=2`. Capacitor **6.2.3**, Media3 **1.2.1** conservés.

### Vérifications rejouées sur cet état

- TypeScript application et configuration : **réussi**.
- Vitest : **74/74 tests, 16 fichiers**, dont 10 nouveaux cas de passation et cycle de vie web. Les appels Android y sont simulés.
- Compilation web de production : **réussie** ; synchronisation Capacitor : **réussie**.
- Compilation Java et assemblage Android : **`BUILD SUCCESSFUL`**, `assembleDebug`.
- APK racine : **11 816 595 octets**, signature v1/v2 valide, certificat identique à l'ancien APK. Les **16 fichiers web** de `dist/` ont été comparés par SHA-256 avec ceux embarqués.
- SHA-256 APK : `3773872A78B6DA89E6A38E4552A1DFE2B78BFDD2746636CFF9655F338CE4A02B`.
- Rapport : `preuves/REPRISE-ANDROID-2026-11-03.md` ; sortie signature : `preuves/apk-1.0.1-signature.txt`.

### Ce qui reste non vérifié

- Aucun appareil listé par `adb devices -l`. Installation, retours Android réels, VLC installé/absent, coupure réseau, écran éteint, focus audio et fluidité sur téléphone non testés.
- Aucun flux d'abonnement contacté pendant cette reprise ; pas de mesure de débit, de saccades ou de connexions côté fournisseur.
- Les seuils ExoPlayer (15/50 s, démarrage 2,5 s, reprise 5 s) sont des réglages, pas une garantie de tampon disponible ni d'absence de gel.
- Le lecteur web utilise encore HLS.js ou MPEG-TS selon le format : le format HLS n'établit pas à lui seul le chemin de décodage matériel. Sa variante obtenue en changeant l'extension d'une URL peut être indisponible chez un fournisseur.
- Les modifications antérieures d'interface et le statut des serveurs locaux ne sont pas contre-vérifiés visuellement ou en réseau dans cette passe.

## Limites et prochaine action

Points ouverts pour continuer :
0. **Poursuivre l'essai de l'APK 1.0.2 déjà installé** : lecture native depuis la liste, Retour et seconde ouverture sont vérifiés. Restent son, fluidité longue, ouverture depuis le lecteur web, sélecteur externe, Home/retour et arrêt réseau/réessai. Noter appareil, réseau, format, délai de démarrage et interruptions. Ne pas annoncer de fluidité garantie avant ces observations.
1. **Guide des programmes (EPG / XMLTV)** :
   - Remplacer le générateur synthétique actuel par un parseur XMLTV exploitant l'URL EPG fournie par l'API Xtream (`xmltv.php?username=...&password=...`).
2. **Ergonomie du lecteur et confort de zapping** :
   - Contrôles au clavier étendus en plein écran (flèches, pavé numérique pour numéro de chaîne, OSD automatique).
   - Reconnexion automatique avec backoff exponentiel lors des coupures de réseau.

## Reprise et déblocage démarrage 1.6.1 (4 novembre 2026)

### Diagnostic de la cause du gel de 20s
1. Le bouton ? envoyait vers le lecteur Webview au lieu du lecteur Android natif.
2. Surcharge IPC/Binder critique : avec 22 314 chaînes, buildNativeZap sérialisait 4,3 Mo de données que Capacitor persistait dans savedInstanceState, provoquant TransactionTooLargeException: data parcel size 8578508 bytes et un crash immédiat.
3. Allocations et transferts lourds (plusieurs secondes de freeze JS).

### Correctifs appliqués
- Bouton ? et carte routés directement vers le lecteur Android natif (ExoPlayer).
- Fenêtrage dynamique à 60 chaînes entourant la sélection dans buildNativeZap (charge divisée par 300).
- Purge de call.getData() avant startActivityForResult dans NativePlayerPlugin.java pour éliminer tout risque de TransactionTooLargeException.
- Suppression des allocations superflues et virtualisation forcée pour > 400 chaînes.
- Fausse notification réseau supprimée à l'initialisation.

### Mesures réelles sur téléphone (Motorola Edge 70)
- Lancement de l'activity : **102 ms**.
- Première image vidéo décodée : **2,2 secondes**.
- TF1 HD et TF1 4K UHD testés avec succès et fluidité matérielle.
- Retour arrière et rétention de sélection vérifiés.
- 320/320 tests Vitest passés. APK déployé et disponible à la racine (Lecteur-IPTV.apk).


---

## Consolidation, audit intégral et livraison 1.11.11 (7 novembre 2026)

### État canonique actuel
- **Branche consolidée** : `consolidate/v1.11.4` (commits `3fd7cd0` et `1a5cda0`)
- **Version livrée** : **CedPlay 1.11.11** (`versionCode=40`) — APK racine : `CedPlay-1.11.11.apk` (**4 579 467 octets**, soit −48 % par rapport aux 8,71 Mo précédents après retrait des médias de vérification de `public/`).
- **Rapport complet** : [AUDIT_INTEGRAL_2026-11-07.md](AUDIT_INTEGRAL_2026-11-07.md).
- **Fiche de suivi Second Cerveau** : [CedPlay.md](C:/Users/C2k/Documents/Second%20Cerveau/10%20Projets/CedPlay.md).

### Évolutions intégrées depuis la 1.6.1 (05/11 → 07/11)
1. **Navigation TV, EPG, Replay, Podcasts (`1.8.x` → `1.11.7`)** :
   - Ergonomie télécommande 3 colonnes, bandeau de zapping avec logo, rafale P+/P-, horloge EPG, replay M3U et enregistrement depuis le guide, fiches TMDb enrichies.
   - Module Podcasts complet : service audio natif Media3, reprise position + vitesse, mini-lecteur, recherche par nom, pochettes et suggestions au démarrage.
2. **Lot A — Performance chaude et fiabilité (`1.11.8` / code 37)** :
   - Recalcul des recommandations VOD optimisé : **4 200–7 700 ms → 287 ms** (premier calcul) / **~140 ms** (suivants) sur 20 000 films × 50 visionnages ; plus aucun recalcul pendant la lecture.
   - Réglages paresseux (`IPTVPlayer`) et sous-titres VOD lus depuis IndexedDB (`VodLibrary`).
   - Garde `resumed`/PiP sur `reconnectLive` et remontée des interruptions d'enregistrement (`onRecordInterrupted`).
3. **Lot B — Fluidité perçue (`1.11.9` / code 38)** :
   - Index `HashMap` O(1) des numéros de chaîne en natif (`rebuildNumberIndex`).
   - Lecture de `zaplist.tsv` hors du thread UI (`adoptFullListAsync` + `publishFullList`).
   - Mémoïsation réelle des cartes `ChannelList` et des cellules `ProgramCell` de l'EPG ; écriture de progression podcasts bridée à 5 s.
4. **Lot C + corrections de revue — Sécurité et hygiène (`1.11.10` → `1.11.11` / code 40)** :
   - Masquage des secrets (`tmdbApiKey`, `deeplApiKey`, `openSubtitlesApiKey`, `subdlApiKey`, `parentalPin`) dans le journal des réglages et les Diagnostics (`redact.ts`).
   - Activation d'une CSP partielle dans `index.html`.
   - Hachage SHA-256 salé du PIN parental (`pinHash.ts`), migration silencieuse au déverrouillage, plafond de stockage porté à 128 caractères (`MAX_PARENTAL_PIN_LENGTH`), règle stricte « champ vide = code inchangé, champ rempli = 4 à 8 chiffres ».
   - Passage par `CapacitorHttp.request()` sur les derniers chemins natifs sujets au CORS (respect de la méthode `HEAD`).

### Vérifications reproduites le 07/11/2026
- `tsc -p tsconfig.app.json --noEmit` et `tsc -p tsconfig.node.json --noEmit` : **0 erreur**
- `eslint ./src` : **0 erreur**
- `vitest run` : **544/544 tests réussis** (89 fichiers)
- `vite build`, `cap sync android`, `./gradlew assembleRelease` : **0 erreur** (`CedPlay-1.11.11.apk`, code 40, 0 média de test embarqué).

### Ce qui reste à valider / prochaines actions
1. **Recette sur appareil réel (box Android TV et téléphone)** : installer `CedPlay-1.11.11.apk` et vérifier le chargement asynchrone de la liste complète, la saisie de numéro O(1), le PIN parental haché et les appels Xtream/M3U via `CapacitorHttp`.
2. **Hygiène Git et fichiers** : après validation de la `1.11.11`, fusionner `consolidate/v1.11.4` dans `main`, archiver/supprimer les anciens APK à la racine et nettoyer les 3 worktrees `.claude/worktrees/*`.
3. **Suite fonctionnelle éventuelle (Lot D)** : rappels EPG en notification système (`AlarmManager`), sous-titres du direct web, épisode suivant automatique web, préréglages de mosaïques.


## Réparation de l'encodage du suivi — 7 novembre 2026

- Ancien contenu récupéré depuis Git : le fichier mélangeait une partie UTF-8 et une fin Windows-1252 avant sa relecture globale en Windows-1252. Toutes les entrées ajoutées depuis sont conservées à l'identique.
- Fichier réécrit intégralement en UTF-8, sans caractère de remplacement ni caractère de contrôle parasite ; deux noms `buildNativeZap` altérés par un caractère de contrôle dans l'historique sont restaurés.
- Pour les prochaines écritures : lecture et écriture explicitement en UTF-8 ; ne jamais utiliser l'encodage implicite de Windows PowerShell pour ce fichier.
- Sauvegardes brutes et contrôles : `preuves/reparation-encodage-2026-11-07/RAPPORT.md`. Aucun code applicatif ni APK modifié, aucun test sur appareil effectué.


## Livraison consolidée 1.11.12 / code 41 — 7 novembre 2026

- Réparation UTF-8 du suivi commitée dans `c8eb862` ; corrections podcasts intégrées par `05b3320` (branche Claude jusqu'à `f8201d3`). Version synchronisée dans les trois emplacements.
- Vérifié : TypeScript app + node, ESLint complet (0 erreur, 18 avertissements), 562/562 tests (89 fichiers, deux processus maximum après un échec de délai sur le dialogue Xtream dans la première suite), build web, synchronisation Capacitor et APK release. Aucun test ni délai modifié.
- APK racine `CedPlay-1.11.12.apk` : 4581561 octets ; SHA-256 `1249ccf3747948c9c85eb0e2d0c09d72769a22d2fb72542db20afde03cb3fe97`. Même certificat que la 1.11.11 ; 72 fichiers web comparés octet par octet dans l'APK, sources applicatives inchangées pendant le build. Ancienne 1.11.11 conservée.
- Rapport, manifeste et logs : `preuves/livraison-1.11.12-2026-11-07/RAPPORT.md`.
- Aucun essai appareil ni installation effectué. Prochaine recette : cycle PIN complet, recherche podcasts, lien collé et abonnement Acast.


## Navigation TV, recherche sur OK et chaînes gratuites — 7 novembre 2026

- Retour utilisateur : menus TV encore moins fluides que TiviMate, recherche qui retient les flèches, liste gratuite peu visible et absente au premier lancement.
- Rubriques parcourues par index sans mesurer toutes les cartes ; focus des contrôles sans scan global ; zoom/transitions TV retirés. Position Films/Séries sauvegardée après 300 ms de pause et à la sortie.
- Recherche TV (globale/podcasts/lien) activée par OK ; flèches libres au repos ; Retour quitte d'abord la saisie. Dialogue Radix couvert pour éviter sa fermeture au premier Retour.
- Première installation : sélection gratuite embarquée puis Direct, sans lecture. Accès permanent Plus → Chaînes gratuites et menu des listes. Listes personnelles préservées, suppression de la sélection respectée.
- Nouveau catalogue vérifié de 12 chaînes, dont 9 mexicaines issues des lecteurs officiels et de SPR/MXPlus. L'ancien catalogue communautaire non vérifié reste sur disque et les listes importées ne sont pas changées.
- Vérifié : 571/571 tests (89 fichiers), tsc app+node OK, eslint src 0 erreur/18 avertissements existants, web/Capacitor/assembleRelease OK. 359 sources inchangées pendant la construction, 74 fichiers web conformes dans l'APK, même certificat habituel.
- APK CedPlay-1.11.13.apk / code 42 : 4 584 860 octets ; SHA-256 0d61688848c7edad9b615587b058cea4d90f0840aa35eb9daf55cecef3c35667. Pas installée, rien poussé. Navigateur de contrôle désactivé ; aucun FPS/temps par appui ni comparaison physique avec TiviMate. Rapport : preuves/tv-navigation-gratuites-2026-11-07/RAPPORT.md.


## Choix des catégories Xtream à la télécommande — 7 novembre 2026

- Retour utilisateur : impossible de choisir au réimport pour récupérer tous les pays.
- Étape de catégories dédiée, focus sur Tout, tous les pays cochés au départ ; France uniquement explicite. Lignes accessibles aux flèches par index ; OK coche/décoche et ignore les répétitions. Le checkbox Radix précédent empêchait Entrée.
- Champs TV sur OK, Retour quitte d'abord la saisie. Mode transmis à tous les points d'accès Xtream ; connexion/protocole et catégories séparés, identifiants conservés au retour.
- Vérifié : tests de reproduction en échec avant correction, puis 9 tests ciblés et 574/574 tests complets (89 fichiers), tsc app+node et ESLint src (0 erreur/18 avertissements existants). Test du réimport adapté à l'étape protocole sans changer les assertions de persistance.
- Build web / cap sync / assembleRelease OK ; 359 sources inchangées, 73 fichiers web conformes, même certificat habituel. APK CedPlay-1.11.14.apk / code 43 : 4583354 octets, SHA-256 80c563a4237c91dd6c344fb853cf089c54f6ead1694a14da2bb0a2094a05cae5.
- Pas installée, pas d'essai télécommande physique ni de mesure de fluidité. Aucune modification automatique des données privées. Rapport : preuves/xtream-selection-tv-2026-11-07/RAPPORT.md.


## Bouton Importer inaccessible dans les catégories Xtream — 7 novembre 2026

- Photo utilisateur sur TV : 289 catégories, focus FR ENFANT, bouton vert inaccessible. Le parcours linéaire de 1.11.14 faisait descendre Droite vers la catégorie suivante et exigeait de traverser la liste entière. La recette précédente ne couvrait que la sortie en fin de liste.
- Correction : Droite depuis toute catégorie rejoint Importer, Haut depuis les actions retrouve la même catégorie ; Gauche rejoint les filtres, Bas depuis les filtres revient à la catégorie visitée. Navigation horizontale entre les deux boutons du bas. Si Importer est désactivé, sortie vers Changer de compte puis retour possible.
- Reproduction exacte à 289 catégories en échec avant correction, verte ensuite ; 10 tests ciblés, 575/575 tests complets (89 fichiers), tsc app+node OK et ESLint src 0 erreur/18 avertissements existants. Build web/Capacitor/assembleRelease et signature OK.
- APK CedPlay-1.11.15.apk / code 44 : 4583603 octets, SHA-256 76b57ad82361bef0832890db876d4eae21aee87eed348e60cac67af6c50b6014. 359 sources inchangées et 73 fichiers web conformes. Anciennes APK conservées, données privées non modifiées à distance, pas de push.
- Défaut observé sur TV par l'utilisateur ; correction encore non essayée sur sa télécommande. Rapport : preuves/xtream-bouton-importer-2026-11-07/RAPPORT.md.


## En-tête TV, classement A–Z et catalogues gratuits — 7 novembre 2026

- Retour utilisateur : rubriques chevauchant logo/liste, deux catalogues gratuits, chaînes en échec, tri absent et soupçon VPN. En-tête : colonnes bornées et rubriques défilantes, texte de liste tronqué, sans badge TV.
- Tri A–Z mémorisé par liste, visible dans Direct et Organiser, incluant les chaînes ajoutées après actualisation ; ordre global Toutes/guide/zapping cohérent, favoris conservés. Noms et identifiants/adresses/numéros explicites non réécrits.
- Ancien catalogue communautaire 1988/2465 désormais distingué visuellement de la sélection officielle de 12 chaînes ; entrée gratuite non dupliquée dans le menu, anciennes listes préservées. Correction TV UNAM sans ?DVR ; rechargement via Plus → Chaînes gratuites avec ids/favoris conservés.
- Contrôle des 12 manifestes et segments puis ffprobe : pistes H264/AAC reconnues pour les 12 depuis ce poste avec le User-Agent du lecteur. Pas d'essai de stabilité, écoute ou lecture sur box.
- NordVPN : utilisateur signale mêmes échecs sans VPN puis avec Paris et Bordeaux (TF1/M6/France TV). Pas de preuve de blocage VPN ; aucun flux privé ni VPN de l'utilisateur testé. Ne pas confondre les anciens relais avec sa liste privée.
- Vérifié : 581/581 tests (89 fichiers), tsc app+node OK, ESLint src 0 erreur/18 avertissements ; web/Capacitor/assembleRelease et signature OK. 359 sources inchangées, 73 fichiers web conformes. APK CedPlay-1.11.16.apk / code 45 : 4584483 octets ; SHA-256 557b77ef831d4dca0949236975e972970fbc54571b5f7cea0229ab72de5d673a.
- Pas installée ; géométrie réelle de l'en-tête non mesurée (navigateur de contrôle désactivé). Rapport : preuves/entete-tri-flux-2026-11-07/RAPPORT.md. Aucun push.


## Catalogue gratuit sourcé et entretenu — 7 novembre 2026

- Plus → Chaînes gratuites : sources officielles consultables par pays, dates de contrôle et tri A–Z. Ouvrir / actualiser charge l'unique sélection officielle ; consulter les sources ne remplace pas une liste personnelle. Filtre pays de consultation seulement.
- 13 chaînes dont 10 mexicaines : TV de Puebla ajoutée depuis SPR/MXPlus (H264 720p / AAC reconnus). Les 13 manifestes et échantillons média répondent depuis le poste, sans essai box ni diagnostic privé/VPN.
- Script public-catalogue.py : JSON source unique, génération M3U et contrôle borné avec dates, conservation des échecs sans suppression automatique. Sources et logos officiels ; pas d'import communautaire massif.
- Test isolé insuffisant repéré : capture globale des flèches en conflit avec le dialogue. Reproduction rouge avec useRemoteNavigation monté, correction data-remote-self puis test vert, y compris accès au bouton depuis le milieu de 289 sources.
- Vérifié : 587/587 tests (90 fichiers), tsc app+node OK, ESLint complet 0 erreur/18 avertissements ; web/Capacitor/assembleRelease et même signature. 364 sources inchangées et 74 fichiers web conformes. APK 1.11.17 / code 46 : 4587575 octets, SHA-256 e8981e0c84b583a2f9058fb4b2b6736d039e884b2916e1d3b7f1d77531d13428.
- Pas d'installation ni de recette physique ou mesure de géométrie. Radios et chapitres/transcriptions non ajoutés dans ce lot. Rapport : preuves/catalogue-gratuit-2026-11-07/RAPPORT.md. Aucun push.


## Lot D et Replay consolidés — 7 novembre 2026

- Demande utilisateur « FAIS LE » : reprise du lot bloqué dans le worktree, commit puis réintégration sur la base 1.11.17. Lot D `f8805d1`, Replay `47808dd` (travail Claude `5fce9d7`), tests finaux `5af2c18` ; branche consolidate/v1.11.4, aucun push.
- Mosaïques protégées au chargement/lancement et saisie sur OK (nom et recherche) ; rappels Android après autorisation avec erreurs de plugin encaissées et reprise au premier plan ; dispositions remappées à la restauration, registre natif non exporté/restauré. Sous-titres HLS et épisode suivant du lecteur web intégrés. Refonte Replay avec horloge, heure de Paris, focus et sauvegarde de Mes plateformes.
- Vérifié : 630/630 tests (94 fichiers), 19 tests Java ; tsc app+node et ESLint complet 0 erreur/18 avertissements existants ; build web/Capacitor/assembleRelease OK. 22 tests finaux mosaïque/rappels relancés après correction du typage du mock.
- APK CedPlay-1.12.0.apk / code 48 : 4604701 octets ; SHA-256 5b24de883b164475bc68ecf3ea72b1380931282247ba957863a6baf2d6ac9aa2. Même certificat habituel, 73 fichiers web conformes et 326 sources inchangées. Ancienne 1.12.0/code 47 conservée dans les preuves.
- Aucun essai appareil, installation, mesure de fluidité ou test privé/VPN. Recette restante : notification refus/accord/appui à froid, mosaïque protégée, Replay réel et télécommande, sous-titres/enchaînement web. Rapport : preuves/lot-d-replay-1.12.0-2026-11-07/RAPPORT.md.

## Version unifiée installée pour recette - 7 novembre 2026

- L'utilisateur confirme vouloir tout ensemble pour tester : consolidation 59c1b84 conservée avec Lot D + Replay, version 1.12.0/code 48. Aucune branche 1.11.18 séparée créée.
- APK existante contrôlée : 4604701 octets, SHA-256 5b24de883b164475bc68ecf3ea72b1380931282247ba957863a6baf2d6ac9aa2 ; signature valide et certificat habituel. Aucun nouveau build produit.
- Mise à jour ADB avec install -r réussie sur le Motorola Edge 70 connecté ; dumpsys confirme 1.12.0/code 48. Aucune désinstallation ni suppression de données demandée.
- Vérifications rejouées : TypeScript app + node OK ; ESLint complet 0 erreur/18 avertissements. Vitest et build bloqués au démarrage par spawn EPERM (esbuild) dans cette session ; les 630 tests et le build réussis restent ceux du rapport de livraison précédent, pas une validation reproduite ici.
- Aucun appareil TV connecté et aucune lecture Replay réelle validée. Prochaine action : recette utilisateur de Replay avec liste compatible, navigation télécommande, mosaïques, rappels et enchaînement web.
- Fiche Second Cerveau et entretien non actualisés : emplacement hors des racines autorisées en écriture de cette session.

## Suppression de la petite sélection et retour du grand catalogue - 7 novembre 2026

- Demande utilisateur : supprimer la sélection de 13 chaînes qui avait relégué son catalogue de plus de 1 000 chaînes.
- Retirés : sélection M3U/JSON de 13 chaînes, dialogue de sources, utilitaire, scripts et tests liés à cette fonctionnalité supprimée. Le catalogue flux-legaux.m3u reste embarqué (2 465 entrées, 1 988 chaînes après dédoublonnage selon le test de référence).
- Chaînes gratuites utilise désormais flux-legaux.m3u au premier lancement et dans l'importeur. Plus ouvre directement le grand catalogue, réutilisant une liste historique déjà enregistrée pour conserver son identité et ses favoris. Le libellé Ancien catalogue communautaire et le renvoi vers la petite sélection sont supprimés.
- Remplacement au démarrage limité à la liste intégrée cedplay-public-v1 de 12 ou 13 chaînes ; les listes personnelles ne sont pas migrées. Régressions ajoutées pour la ressource réellement chargée et le remplacement au démarrage ; tests de navigation adaptés à l'accès direct.
- Vérifié dans cette session : TypeScript app et node sans erreur ; ESLint complet sans erreur, 18 avertissements existants. Vitest et build web tentés, bloqués au démarrage par spawn EPERM dans esbuild. Ces changements ne sont pas annoncés comme une livraison validée.
- Aucun nouvel APK produit ni installé : le téléphone reste sur l'APK 1.12.0/code 48 précédente. Pas de recette physique du correctif, pas de commit/push.
- Fiche Second Cerveau et entretien non actualisés : emplacement hors des racines autorisées en écriture de cette session.

## Livraison 1.12.1 / code 49 - 7 novembre 2026

- Session ZCode (GLM) : reprise des modifications non committées de l'arbre principal (retrait de la petite sélection, retour du grand catalogue « Chaînes gratuites » via flux-legaux.m3u embarqué), relues intégralement avant reprise.
- Le `spawn EPERM` sur esbuild qui bloquait la session précédente ne s'est jamais reproduit ici : esbuild n'a pas de shim `node_modules/.bin/` sous pnpm (dépendance transitique de vite) et tous les outils passent depuis le shell de cette session.
- Version montée 1.12.1 / code 49 aux trois emplacements (package.json, build.gradle, pied SettingsPanel).
- Vérifié sur l'arbre principal : tsc app+node 0 erreur ; ESLint complet 0 erreur / 18 avertissements existants ; vitest 625/625 (93 fichiers — un fichier de moins, retrait des tests de la sélection supprimée) ; vite build 9,1 s (dist 2,7 Mo, flux-legaux.m3u embarqué, plus aucun fichier de la petite sélection) ; cap sync (2 plugins) ; assembleRelease OK.
- APK CedPlay-1.12.1.apk à la racine : 4 599 277 octets ; SHA-256 da30eda12a7d617f79e79043255862fd2e37bcfb421a578c1879d091343cef44 ; versionCode 49 / versionName 1.12.1 confirmés par aapt dump badging. La 1.12.0/code 48 reste à la racine pour référence.
- Installation adb réussie : `adb install -r` sur le Motorola Edge 70 (ZY22MBQQW7) sans désinstallation ; dumpsys confirme versionCode 49 / versionName 1.12.1. Premier passage sans appareil (téléphone déconnecté, rebranché entre-temps ; redémarrage du serveur adb sans effet sur la détection).
- Commit 1.12.1 sur consolidate/v1.11.4 (modifications application + ce journal ; AGENTS.md et export-raster.ps1 laissés hors git).

## Régressions Hisense, style et bandeau unifiés — 8 novembre 2026

- Retour utilisateur : fermetures au défilement et reprise d'une chaîne depuis l'accueil avec écran noir/son. Quatre discussions Codex archivées retrouvées, restaurées et rattachées au projet.
- Diagnostic sur vraie Hisense HiSmartTV A4 / Android 9 / WebView 138 : version réellement installée 1.11.15/code 44. OOM V8 confirmé au transfert du guide (XML 45 278 280 caractères ; 18 900 chaînes ; sortie 256 952 programmes pour 3 911 chaînes). Le plantage se produit aussi au repos dans l'accueil.
- Correction : transfert et cache EPG compacts versionnés, textes partagés, buffers transférables, worker libéré avant reconstruction et annulation réelle au changement de liste. API et programmes conservés ; ancien cache ignoré sans suppression. Essai TV : même guide chargé/cache enregistré, heap principal observé vers 206 Mo, processus vivant. Défilement : suppression de 5 380 rendus inutiles de catégories sur vingt appuis (test rouge puis vert à zéro).
- Commits locaux : correctif 385c10d ; style Claude c786ab4 intégré par 7fa52a9 sans conflit ; bandeau natif TV remonté (48 dp gauche, 32 dp haut, téléphone inchangé) be78c17. Les modifications concurrentes des bannières Android et du script d'identité restent intactes, hors de cette livraison. Aucun push.
- Validation finale unifiée : 645/645 tests (99 fichiers), 19/19 tests Java, typage application+configuration sans erreur, ESLint complet 0 erreur/18 avertissements, web/Capacitor/assembleRelease OK. Copie de build isolée, sans sondes ni délai artificiel, 70 fichiers web conformes à l'APK.
- APK CedPlay-1.12.2.apk / code 50 : 4 600 843 octets, SHA-256 9e47ebe3542541af3a824b6c76ff0c9e00a48e83589c912b495a2feed59a605f, même certificat. Installée sur la Hisense par adb install -r ; version et absence de DEBUGGABLE confirmées. Aucune désinstallation ni suppression de données. Motorola non mis à jour dans cette session.
- Recette physique finale : accueil avec guide visible, Direct trois colonnes, 18 900 chaînes, vingt appuis jusqu'à 21/50 et processus stable sans nouvel OOM observé. Reprise live instrumentée : première image vers 10,35 s ; son démarrant 154 ms avant image. Les dix secondes de son seul ne sont pas reproduites dans cet essai, mais le délai total reste long. La fluidité perçue, les autres flux et la stabilité longue restent à confirmer ; pas de promesse de zéro lag.
- Rapport et limites : preuves/diagnostic-tv/RAPPORT.md. Le repli sans worker et le pic potentiel d'export de sauvegarde restent des parcours distincts non corrigés ici.
- Dernier contrôle de l’APK normale sur Hisense : première image vers 8,67 s (préparation 8 274 ms), démarrage encore long. Bandeau nom/programme vu au coin supérieur gauche après zap, position TV validée physiquement. Fiche Second Cerveau actualisée ; entretien actualiser/verifier/sonder réussi, sans erreur ni écart de projet.

## Push demandé et analyse du démarrage direct — 8 novembre 2026

- Push demandé explicitement puis réussi vers origin/consolidate/v1.11.4 : commit produit et recette 6ca6eefe6115498a24da4f63776e27b8bfca5269 confirmé par ls-remote. main inchangée ; WIP concurrent non ajouté.
- Question suivante sur les 8,7 s : lecture des traces et de PlayerOptions/NativePlayerActivity, sans modification du lecteur ni des réglages. Dernier essai normal : préparation 8 274 ms ; profil Normal actuel = seuil de lancement 1 200 ms, Petit = 800 ms. Ces seuils ne permettent pas d’attribuer les 8,7 s au seul tampon. Essai instrumenté précédent : initialisation du décodeur vidéo 150 ms ; réseau, découverte des pistes et attente de données encore non séparés. Les zaps précédents de chaînes différentes ne constituent pas une comparaison de la même chaîne.
- Pour décider d’une optimisation : décomposer ouverture réseau/pistes/tampon/première image, répéter sur la même chaîne, puis comparer Normal/Petit et vérifier les coupures. Aucun gain de démarrage supplémentaire revendiqué.

## Démarrage direct ramené de 8,6 s à 2,8 s — 1.12.3 / code 51, 8 novembre 2026

- Comparaison instrumentée des tampons Normale et Petite sur la Hisense (10 reprises alternées de la même chaîne depuis l'accueil, 20 s de lecture par essai, réglage Normale restauré) : moyenne 8 629 ms (Normale) contre 8 602 ms (Petite), 0 coupure et 0 erreur. Le tampon n'est pas la cause du délai ; le réglage par défaut Normale est conservé.
- Sonde de démarrage (`startup-probe-run1.log`) : le flux et les décodeurs matériel vidéo (379 ms) et audio (49 ms) sont prêts dès 2,9 s, mais `publishFullList` bloquait le thread UI pendant 8 234 ms dans `rebuildNumberIndex()` à cause de 37 800 compilations regex (`matches` + `replaceFirst`) sur les 18 900 chaînes de la liste de zapping.
- Correctif 1.12.3 (code 51) dans `ChannelNumberInput` et `NativePlayerActivity` : normalisation sans regex et construction de `numberIndex` hors thread UI dans l'exécuteur de `adoptFullListAsync` avant publication. Intégration complète de l'en-tête TV allégé de Claude (`721c01f` de `.claude/worktrees/ecouter-ui` : barre supérieure sur une seule ligne sans sélecteur de liste, onglets agrandis 17 px / icônes 19 px, icône `••• Plus`, gestion de listes regroupée dans Plus), dont la session précédente (`be78c17`) n'avait repris que la partie Java. Deux nouveaux tests unitaires Java (`21/21` tests Android, `645/645` tests Vitest sur 99 fichiers, TypeScript app+node 0 erreur, ESLint complet 0 erreur/18 avertissements).
- APK `CedPlay-1.12.3.apk` (code 51, 4 601 004 octets, SHA-256 `4423e2021f0e881bd20ed204d9704fe087d2728065f11540ca8a8468c0cd9b19`, même certificat, 72 entrées `assets/public` conformes, construite depuis l'arbre isolé sans le WIP concurrent) installée par `adb install -r` sur la Hisense HiSmartTV A4 et sur le Motorola Edge 70 sans effacement ; nouvel en-tête TV vérifié à l'écran sur la Hisense.
- Mesures après correctif sur la Hisense (`post-fix-1.12.3.log`, 4 reprises avec liste complète de 18 900 chaînes) : `zap_full_list` tombe de 8 434 ms à 271–435 ms (moyenne 318 ms) ; la première image (`activity_to_frame_ms`) passe de 8 629 ms à 3 434, 2 818, 2 661 et 2 559 ms (moyenne 2,87 s, `prepare_ms` moyen 2,67 s, 0 coupure, 0 erreur). Détails : `preuves/diagnostic-tv/RAPPORT.md`.
