# Audit intégral CedPlay — mobile et TV — 8 novembre 2026 (contre-audit indépendant)

Périmètre : `application/` (Web/React + Capacitor), `application/android/` (24 classes Java, manifeste, Gradle). Version annoncée **1.12.8 / code 56**.
Instantané de l'arbre de travail pris entre **16 h 05 et 16 h 30 UTC**. **Pendant l'audit, d'autres agents modifiaient encore** `storage.ts`, `VodLibrary.tsx`, `proxy-server.mjs`, `proxy-guards.mjs` et leurs tests. Les lots A à E et ces corrections ne sont pas commités.
Nature : audit en lecture seule. Je n'ai modifié aucun fichier de code. Ce rapport complète `AUDIT_INTEGRAL_2026-11-08.md` et `REVUE_LOTS_A_E_2026-11-08.md` sans les remplacer.

Objectif fixé : un lecteur qui **rivalise avec les meilleurs de sa catégorie** et dont la **fiabilité ne souffre aucune faille**. L'audit cherche donc deux choses : les défauts, et l'écart avec ce qu'un utilisateur exigeant attend d'un lecteur IPTV haut de gamme.

---

## 1. Verdict

**Le socle est de très bon niveau. Je n'ai trouvé aucun défaut critique.** Le typage est strict (`exactOptionalPropertyTypes`), le code ne contient ni XSS ni journal de secrets, et les listes sont virtualisées. Le lecteur natif est déjà riche : reprise du direct, AFR, profils de tampon, repli de décodeur et prise en compte de `max_connections` dans la mosaïque. Le périmètre fonctionnel est d'ailleurs plus large que celui de la plupart des lecteurs du marché.

L'objectif « fiabilité sans faille » n'est **pas encore atteint**, pour trois familles de raisons.

1. **La résilience de lecture s'arrête trop tôt.** Le lecteur fait 2 reprises en environ 5 s, puis affiche un écran d'erreur. Il ne surveille pas le retour du réseau. Il n'a aucun décodeur audio logiciel (AC3/E-AC3/DTS). Le DVR s'arrête dès la première coupure, et le service d'enregistrement n'est pas adapté à la limite des 6 h/24 h d'Android 15. Media3 date de décembre 2023.
2. **Aucune panne n'est observable.** Aucun gestionnaire de plantage n'existe, ni natif ni JS (erreurs non attrapées, promesses rejetées). Un utilisateur qui rencontre un problème ne peut rien transmettre d'exploitable.
3. **Le processus de livraison est fragile.** Il n'y a pas de CI. Cinq lots ne sont pas commités. Plusieurs agents écrivent dans le même arbre en même temps. Résultat : **la suite de tests est rouge sur l'arbre actuel** (1 test, voir M1).

**Verdict : GO CONDITIONNEL** pour une version 1.12.9 « fiabilité ». Les conditions sont fermées et listées au §6 : M1 à M10, environ 6 à 8 jours de travail. Les points 🟡 et les améliorations du §5 servent à « se hisser au niveau des meilleurs », mais ne bloquent pas la livraison.

### Note par axe

| Axe | Note | Commentaire |
|---|---|---|
| Sécurité et vie privée | 4/5 | Rien d'exploitable à distance. Une dette P2 reste ouverte : mots de passe Xtream, PIN, sauvegarde |
| Code, architecture, tests | 4/5 | 0 erreur de typage, 777/778 tests. Deux « classes-dieux » (3 687 et 1 308 lignes) |
| **Moteur de lecture et résilience** | **3/5** | Bonnes bases. Reprise trop courte, pas d'audio logiciel, Media3 ancien |
| DVR et programmations | 3/5 | Coupure = fin d'enregistrement. Pas de limite Android 15 gérée. Programmations perdues après arrêt forcé |
| Expérience TV (télécommande) | 4/5 | Touches avancées gérées, bandeau, lanceur, rangées d'accueil. Écran toujours allumé, retour qui quitte sans confirmation |
| Expérience mobile | 4/5 | PiP, Cast, podcasts. Pas de mode réseau en veille pour l'audio |
| Performance | 4/5 | Démarrage déjà ramené à 2,8 s. Bundle principal de 638 kB, dont environ 45 % évitables |
| Données et persistance | 4/5 | Lots A et B solides. Corrections de la revue en cours dans l'arbre |
| Observabilité | **2/5** | Télémétrie de lecture présente, aucune capture de plantage |
| Ops et livraison | **2/5** | Pas de CI, travail non commité, agents concurrents, suite rouge |
| Compilation Android et appareil réel | non instrumenté | Ni SDK Android ni appareil dans cet environnement (voir §8) |

---

## 2. Preuves d'exécution

Les commandes ont été rejouées sur une copie de l'arbre, avec Node 22 et pnpm 8.15 (`--frozen-lockfile`).

| Contrôle | Résultat |
|---|---|
| `tsc -p tsconfig.app.json --noEmit` | 0 erreur (263 fichiers `src/` analysés, ce qui prouve que la commande a vraiment tourné) |
| `tsc -p tsconfig.node.json --noEmit` | 0 erreur |
| `eslint ./src` (sans `--quiet`) | 0 erreur, 18 avertissements (conforme à `AGENTS.md`) |
| `vitest run` | 118 fichiers, **778 tests, 777 verts, 1 rouge** (voir M1). Deux autres échecs venaient de mon environnement (`flux-legaux.m3u` non copié) ; ils sont verts une fois le fichier présent |
| `vite build` | OK : chunk principal **638,15 kB / 194,19 kB gzip**, `dist/` = 2,7 Mo, 64 fichiers |
| `pnpm audit` | 34 avis (18 high, 15 moderate, 1 low), voir m4 |
| Java | Lecture intégrale des points sensibles (lecteur, DVR, services, pont). Compilation non rejouée |

> Piège rencontré, à retenir : un `vite build` lancé avec `NODE_ENV=development` dans l'environnement embarque la version **de développement** de React (chunk de 951 kB). La mesure de taille n'est valable que sans cette variable. Les tests, eux, exigent `NODE_ENV=development`.

---

## 3. État des constats précédents (re-testés, pas recopiés)

| Constat | État observé dans l'arbre courant |
|---|---|
| Revue §1 — Ma Liste lisible avant la résolution des catégories | **Correction en cours** : statut `idle/loading/ready/error` et refus de lecture tant que l'état n'est pas `ready` (`VodLibrary.tsx:126-129`, `:412-417`). Tests `vodLibrary` verts. Pendant le chargement, les titres adultes de Ma Liste restent **visibles** (seule la lecture est bloquée, `:204`) : à décider |
| Revue §2 — relais : IPv6 mappé et routes Xtream | **Correction en cours** : `proxy-guards.mjs` (`expandIpv6`, `assertPublicTarget`), `proxyGuards.test.ts` vert. Sondes de la revue non rejouées |
| Revue §3/§4 — secours des réglages et thème | **Correction en cours** : `storage.ts:248-284`, 20 tests `storageSettings` verts |
| P2-01 sauvegarde avec secrets | **Ouvert** : `idb.ts:126-140` exporte les mots de passe Xtream en clair |
| P2-02 mot de passe Xtream pré-rempli | **Ouvert** : `XtreamLoginDialog.tsx:65`, `:97` (`xtream_last_pass`) |
| P2-03 clés API affichées | **Ouvert** : `SettingsPanel.tsx:140,149,153` (`type="text"`) |
| P2-04 `subdlApiKey` inutilisé | **Ouvert** : `storage.ts:44,81`, transmis par `VodLibrary.tsx:693`, jamais consommé |
| P2-05 PIN SHA-256 et verrouillage en mémoire | **Ouvert** : `pinHash.ts:20`, `ParentalPinDialog.tsx:21-35` (un redémarrage remet les essais à zéro) |
| P2-06 `ChannelLogo` sans `referrerPolicy` | **Ouvert** |
| P2-15 programmations non reposées au lancement | **Ouvert** : `rescheduleAll` n'est appelé que par `BootReceiver.java:16` |
| P2-16 service audio au premier plan sans média | **Ouvert** : `NativePlayerPlugin.java:1006-1016` |
| P2-17 URI arbitraire sur `playLocal` / `deleteRecording` | **Ouvert** : `NativePlayerPlugin.java:538-554`, `:629-640` |

---

## 4. Constats

### 🟠 M1 — Suite de tests rouge sur l'arbre courant (restauration de position VOD TV)
- **Axe** : tests et expérience TV
- **Emplacement** : `src/test/vodTvScreen.test.tsx:269-281` (« restaure une affiche mémorisée au-delà de la première page de 60 titres »), code `TvVodScreen.tsx:247-262` et `VodLibrary.tsx`
- **Constat** : le test échoue de façon déterministe (3 exécutions sur 3, isolé ou en suite). Après la restauration du titre 85, `document.activeElement` vaut `null` au lieu de la tuile `data-tv-row="84"`. Les 24 autres tests du fichier passent. La revue de ce matin annonçait 766/766 verts ; il y a maintenant 778 tests, et ce cas est rouge sur les deux instantanés de `VodLibrary.tsx` que j'ai pris pendant que l'autre agent l'éditait.
- **Risque** : à la télécommande, revenir dans Films ou Séries après un titre éloigné laisse le focus nulle part. L'utilisateur doit appuyer plusieurs fois avant que quelque chose réagisse. Surtout, `pnpm verify` est rouge : aucune livraison ne devrait partir dans cet état.
- **Recommandation** : terminer et commiter le travail en cours sur `VodLibrary.tsx`, puis rejouer le test. Si l'échec persiste, `requestFocus()` est appelé avant que la limite d'affichage étendue ait rendu la tuile 85 : il faut redemander le focus après le rendu (`useLayoutEffect` qui dépend de `limit`). Effort **S**.
- **Statut** : ouvert, à confirmer après stabilisation du travail en cours.

### 🟠 M2 — La lecture native abandonne en environ 5 secondes et ne revient pas avec le réseau
- **Axe** : moteur de lecture
- **Emplacement** : `NativePlayerActivity.java:117` (`AUTO_RETRY_MAX = 2`), `:2031-2053` (`onPlayerError`), `:2005-2012` (fin de direct). Aucun `ConnectivityManager.NetworkCallback` dans les 24 classes.
- **Constat** : sur une erreur transitoire (réseau, délai dépassé, 5xx), le lecteur fait 2 reprises (1,5 s puis 3,5 s), puis libère le lecteur et affiche « Réessayer ». Si le Wi-Fi revient 20 s plus tard, rien ne se relance.
- **Risque** : c'est la panne la plus fréquente en IPTV (coupure du fournisseur, box qui renégocie le Wi-Fi, saturation un soir de match). Pour l'utilisateur, l'application « lâche » là où un lecteur haut de gamme reprend seul.
- **Recommandation** : pour le **direct**, des reprises sans plafond avec un délai qui grandit (1, 2, 4, 8, puis 15 s au maximum), un message discret « Reconnexion… » et un arrêt seulement à la demande de l'utilisateur ou après environ 3 minutes. Pour la VOD, garder un plafond mais reprendre à la position courante. Ajouter un `registerDefaultNetworkCallback` qui relance immédiatement à `onAvailable`. Ne pas reprendre sur 401/403/404 (abonnement), comme aujourd'hui. Effort **M**.

### 🟠 M3 — Aucun décodeur audio logiciel : son muet sur AC3 / E-AC3 / DTS selon l'appareil
- **Axe** : moteur de lecture, compatibilité
- **Emplacement** : `android/app/build.gradle` (dépendances Media3 : `exoplayer`, `ui`, `hls`, `session` seulement) et `PlayerOptions.renderers` (`DefaultRenderersFactory` sans extensions)
- **Constat** : aucune extension `decoder-ffmpeg` (ou équivalent) et aucun mode `EXTENSION_RENDERER_MODE_PREFER/ON`. Le décodage audio dépend entièrement des codecs de l'appareil.
- **Risque** : les chaînes HD européennes et beaucoup de VOD utilisent AC3/E-AC3. Selon le téléphone ou la box, le résultat est une image sans son ou une erreur « Format incompatible avec cette box ». Les lecteurs de référence règlent ce cas avec un décodeur logiciel embarqué. *À confirmer sur appareil* : lire un flux AC3 sur le téléphone de test.
- **Recommandation** : embarquer l'extension FFmpeg de Media3 (audio uniquement, licence LGPL compatible avec un APK personnel) et passer `setExtensionRendererMode(EXTENSION_RENDERER_MODE_ON)`. Le matériel reste prioritaire et le logiciel prend le relais. Prévoir une option « Sortie audio : passthrough / décodé » pour les barres de son. Effort **M** (compilation de l'extension ou binaire prêt à l'emploi).

### 🟠 M4 — Media3 1.2.1 (décembre 2023) : neuf versions de retard
- **Axe** : moteur de lecture, maintenance
- **Emplacement** : `android/app/build.gradle` (les quatre artefacts `androidx.media3:*:1.2.1`)
- **Constat** : la branche 1.11 est publiée (1.11.1 en septembre 2026). Depuis la 1.2.1 se sont accumulés de nombreux correctifs HLS/TS, de reprise du direct, de sélection de pistes et de plantages (par exemple un plantage de `SampleQueue` au seek, corrigé en 1.10.1).
- **Risque** : des défauts déjà corrigés en amont restent présents, et plus l'écart grandit, plus la mise à jour coûte cher.
- **Recommandation** : passer à la dernière 1.11.x, compiler, puis faire une recette sur box et téléphone (zapping, aperçu, PiP, Cast, mosaïque, DVR HLS). Le faire **avant** M3 pour que l'extension FFmpeg soit à la même version. Effort **M**.

### 🟠 M5 — DVR : une coupure termine l'enregistrement, et Android 15 peut tuer le service
- **Axe** : DVR, fiabilité
- **Emplacement** : `Recorder.java:186-230` (`recordTs`), `RecordService.java:78-119` (`START_NOT_STICKY`, pas de `onTimeout`), `variables.gradle` (`targetSdkVersion = 35`)
- **Constat** :
  1. Pour un flux TS, une seule exception de lecture fait sortir de la boucle : l'enregistrement s'arrête (« interrompu »). Il n'y a pas de reconnexion. Le chemin HLS, lui, tolère des segments perdus (`MAX_FAILURES`).
  2. Le passage à `targetSdk 35` (lot D) soumet les services `dataSync` à la **limite Android 15 de 6 h par 24 h**. `RecordService` n'implémente pas `onTimeout(int, int)`. À l'échéance, le système exige un arrêt immédiat, sinon le service est tué en erreur.
  3. L'espace libre n'est pas vérifié avant ni pendant la capture.
- **Risque** : un match de 2 h programmé ressort tronqué à la première micro-coupure. Plusieurs enregistrements dans la journée peuvent faire tomber le service. Ce sont des pertes silencieuses, découvertes après coup.
- **Recommandation** : (1) dans `recordTs`, reconnecter en boucle tant que `running` reste vrai, avec un délai croissant et un plafond de temps cumulé hors ligne (par exemple 2 min), en écrivant à la suite du même fichier ; (2) implémenter `onTimeout` pour clore le fichier proprement et notifier ; (3) vérifier l'espace libre au départ, puis toutes les minutes. Effort **M**.

### 🟠 M6 — Les programmations ne survivent pas à un arrêt forcé
- **Axe** : DVR
- **Emplacement** : `ScheduleStore.rescheduleAll` est appelé seulement par `BootReceiver.java:16`, `NativePlayerPlugin.load()` (`:989`) ne le fait pas
- **Constat et risque** : Android efface les alarmes lors d'un arrêt forcé, d'un nettoyage par un « booster » de box ou d'une optimisation de batterie agressive. Les enregistrements programmés ne se déclenchent alors plus, sans aucun message.
- **Recommandation** : appeler `ScheduleStore.rescheduleAll(getContext())` dans `NativePlayerPlugin.load()` (l'opération est idempotente). Effort **S**.

### 🟠 M7 — Lecteurs sans « mode réveil réseau » : coupures écran éteint
- **Axe** : moteur de lecture (mobile)
- **Emplacement** : aucun `setWakeMode` dans `AudioPlaybackService.java:255`, `NativePlayerActivity.java:1950`, `LivePreview.java:155` ni `MosaicPlayerActivity.java:168`
- **Risque** : un podcast écran éteint, ou un PiP quand le téléphone passe en veille, peut s'arrêter après quelques minutes quand le Wi-Fi s'endort (point 6 du §9 de l'audit du matin, confirmé dans le code).
- **Recommandation** : `.setWakeMode(C.WAKE_MODE_NETWORK)` sur le lecteur audio et sur le lecteur natif (la permission `WAKE_LOCK` est déjà déclarée). Effort **S**.

### 🟠 M8 — Écran maintenu allumé en permanence, menus compris
- **Axe** : expérience TV et mobile
- **Emplacement** : `MainActivity.java:19` (`FLAG_KEEP_SCREEN_ON` sans condition)
- **Constat** : le choix est assumé dans le commentaire, parce que le lecteur web n'a pas d'autre moyen de garder l'écran allumé.
- **Risque** : sur un téléviseur, l'économiseur d'écran et le mode ambiant ne se déclenchent jamais tant que CedPlay est au premier plan. Une grille de guide fixe pendant des heures sur un écran **OLED** crée un vrai risque de marquage. Sur téléphone, la batterie se vide si l'app reste ouverte sur un menu.
- **Recommandation** : ajouter au pont natif une méthode `setKeepScreenOn(boolean)` appelée par le lecteur web sur `playing`/`pause`/`ended`/démontage, puis retirer le drapeau global. Effort **S**.

### 🟠 M9 — WebView trop ancienne : écran noir sans explication
- **Axe** : compatibilité TV
- **Emplacement** : `capacitor.config.ts` (ni `android.minWebViewVersion` ni `android.errorPath`) ; Capacitor 6 : `Bridge.DEFAULT_ANDROID_WEBVIEW_VERSION = 60`
- **Constat** : Capacitor n'affiche sa page d'erreur que sous Chromium 60. Le bundle Vite (cible ES2020 par défaut) exige environ Chromium 80 à 87. Entre les deux, l'application démarre sur un écran vide.
- **Risque** : c'est le profil exact des box Android TV non certifiées Google, dont la WebView système n'est jamais mise à jour. Pour l'utilisateur, l'app « ne marche pas » et aucun diagnostic n'est possible.
- **Recommandation** : `android: { minWebViewVersion: 87, errorPath: 'webview-obsolete.html' }`, avec une page statique en ES5 qui explique comment mettre à jour « Android System WebView ». Fixer aussi explicitement `build.target` dans `vite.config.ts` pour que le seuil reste aligné. Effort **S**.

### 🟠 M10 — Aucune capture de plantage, natif comme JS
- **Axe** : observabilité
- **Emplacement** : aucun `Thread.setDefaultUncaughtExceptionHandler`, `window.onerror` ni écouteur `unhandledrejection` dans le dépôt. `ErrorBoundary.tsx` écrit seulement dans la console, ne place pas le focus sur « Réessayer » (inaccessible à la télécommande sans pointeur) et ne propose pas de rechargement complet. `proguard-rules.pro` ne conserve pas `SourceFile,LineNumberTable`.
- **Risque** : sans mesure, la « fiabilité sans faille » ne peut pas être démontrée. Sur la box, une erreur JS asynchrone disparaît sans trace, et un plantage natif ne laisse qu'une pile obfusquée par R8.
- **Recommandation** : un **journal local** suffit pour un APK personnel, sans service tiers ni données sortantes :
  1. côté natif, un gestionnaire global qui écrit la pile (horodatage, version, modèle, sans URL) dans un fichier tournant, puis rend la main au gestionnaire par défaut ;
  2. côté web, `window.onerror` et `unhandledrejection` envoyés vers `globalTelemetryLogger`, en passant par `redact` ;
  3. `ErrorBoundary` : `autoFocus` sur « Réessayer », bouton « Recharger CedPlay » et écriture dans la télémétrie ;
  4. Réglages → Diagnostic : « Exporter le journal » ;
  5. `-keepattributes SourceFile,LineNumberTable` et archivage du `mapping.txt` avec chaque APK.

  Effort **M**.

### 🟡 m1 — Dette de sécurité P2 encore ouverte
Les points P2-01 à P2-06, P2-16 et P2-17 sont tous re-vérifiés et ouverts (§3). Le plus visible : une sauvegarde partagée contient les **mots de passe Xtream en clair**. Le plus significatif pour la promesse du produit : le verrouillage du PIN est remis à zéro à chaque redémarrage, donc un PIN à 4 chiffres reste devinable par un enfant patient. Recommandation : case « inclure les identifiants » décochée par défaut, persistance de `attempts`/`lockUntil` et PBKDF2. Effort **M** pour l'ensemble.

### 🟡 m2 — Deux « classes-dieux »
`NativePlayerActivity.java` compte 3 687 lignes (190 Ko) et mélange UI, zapping, sous-titres, PiP, Cast, AFR, reprise et télémétrie. `IPTVPlayer.tsx` compte 1 308 lignes (82 Ko). Chaque correctif touche un fichier dont personne n'a une vue complète, et les agents concurrents s'y marchent dessus. Recommandation : extraire progressivement `LiveReconnector` (M2), `SubtitleController`, `ZapController`, `PlayerUiController` côté natif, et `usePlaylistRefresh`, `useReminders`, `useStartupRestore` côté React. Effort **L**, au fil de l'eau.

### 🟡 m3 — Bundle principal de 638 kB (194 kB gzip), dont environ 45 % évitables
D'après la carte des sources du chunk : `react-router` + `@remix-run/router` pèsent environ 300 kB de source pour **une seule route**, et `zod` environ 146 kB alors qu'il ne sert qu'à l'import de sauvegarde et aux réglages. Sur une box Amlogic d'entrée de gamme, ces kilo-octets se paient en temps d'analyse JS au démarrage. Recommandation : retirer `react-router` (une route plus la 404), charger `zod` à la demande. Effort **S/M**.

### 🟡 m4 — `pnpm audit` : 34 avis
Ils concernent presque tous l'outillage de build (tailwind/postcss, glob, minimatch, brace-expansion, nanoid). Côté exécution, il reste `@remix-run/router` (redirection ouverte, non exploitable ici, et la dépendance disparaît avec m3) et `zod` (mémoire sur une entrée surdimensionnée, ce qui renvoie à P2-14 : borner la taille d'une sauvegarde avant `JSON.parse`). Effort **S**.

### 🟡 m5 — Détails de télécommande
- Le **Retour depuis l'Accueil quitte l'application sans confirmation** (`App.tsx:57`). Sur TV, l'usage attendu est « Appuyez de nouveau sur Retour pour quitter ».
- Les touches **CHAÎNE +/–** ne sont gérées que dans le lecteur natif, pas dans les écrans web (liste du direct, guide).
- Mosaïque à 8 lecteurs : beaucoup de box n'ont que 2 à 4 décodeurs matériels. Le repli logiciel existe, mais la recette réelle reste à faire.

### 🟡 m6 — Dérives documentaires et hygiène
- `AGENTS.md` annonce **763** tests, il y en a **778** ; le texte « 21/21 Android » n'a pas été revérifié ici.
- La racine contient **~35 captures `test_screen_*.png` (≈ 17 Mo)**, des scripts ponctuels (`fix_video_player.js`, `update_*.js`, `insert_ratio_button.js`) et trois copies du code source (`sources-retrouvees/`, `version-historique-zip/`, quatre worktrees). Le risque : qu'un agent corrige la mauvaise copie.
- `android:windowOptOutEdgeToEdgeEnforcement` est une solution temporaire qui ne fonctionnera plus avec `targetSdk 36`.

### 🟢 Points forts à préserver
- `tsconfig` d'une rigueur rare (`strict`, `exactOptionalPropertyTypes`, `noUnused*`) et 0 erreur.
- Reprise automatique du direct « en retard sur la fenêtre » et après une pause (`isBehindLive`, `reconnectLive`), avec des messages d'erreur traduits par code HTTP qui n'affichent jamais l'URL.
- AFR propre (multiples exacts, pas de 24 Hz hors films), profils de tampon plafonnés en octets, repli de décodeur.
- Mosaïque qui lit `max_connections` et `active_cons` du fournisseur et prévient avant de dépasser la limite. C'est un détail de niveau professionnel.
- Rafraîchissement automatique des listes avec réconciliation (favoris et identité conservés, jamais pendant une lecture déléguée).
- Couverture des touches de télécommande dans le lecteur natif (CH+/–, GUIDE, LAST_CHANNEL, pavé numérique, PAGE_UP/DOWN).
- Contrôle parental VOD et relais de dev en cours de correction, avec des tests de non-régression.

### Règle à inscrire dans `AGENTS.md` (garde-fou découvert)
**Ne jamais modifier `server.androidScheme` (`'http'`) dans `capacitor.config.ts`.** L'origine de la WebView en dépend : changer le schéma rend **invisibles toutes les données IndexedDB et localStorage** (listes, favoris, réglages, progression) sur chaque appareil déjà installé. Le dommage est irréversible et ne se voit pas en test sur une installation neuve.

---

## 5. Se hisser au niveau des meilleurs (améliorations, non bloquantes)

Ce classement reflète l'impact ressenti par l'utilisateur, à effort égal.

| # | Amélioration | Pourquoi | Effort |
|---|---|---|---|
| A1 | **Configuration par QR code** : la TV affiche un QR, le téléphone envoie l'adresse M3U ou les identifiants Xtream | Saisir un mot de passe Xtream à la télécommande est la pire étape de l'installation sur TV | M |
| A2 | **Recherche vocale** sur TV (`SpeechRecognizer` / intention de recherche Android TV) | Aucun code vocal aujourd'hui ; c'est le geste naturel sur Google TV | M |
| A3 | **Timeshift local du direct** (tampon disque de 30 à 60 min) | Aujourd'hui, une pause longue perd le direct (`liveLostWhilePaused`) | L |
| A4 | Indicateur de **qualité de flux en direct** dans l'overlay (débit, tampon, images perdues) | Les données existent déjà (`RebufferTracker`, bilan de session) | S |
| A5 | **Préchargement de la chaîne suivante ou précédente** au zapping | Zapping quasi instantané ; `zap_ms` est déjà mesuré, l'amélioration se prouverait chiffres à l'appui | M |
| A6 | Choix **passthrough / décodé** pour l'audio (suite de M3) | Barres de son et amplificateurs Dolby | S |
| A7 | Synchronisation téléphone ↔ TV des favoris et de la progression (réseau local ou fichier partagé) | Aujourd'hui, seulement par sauvegarde manuelle | L |

---

## 6. Plan de correction proposé (version 1.12.9 « fiabilité »)

| Lot | Contenu | Effort | Condition de sortie |
|---|---|---|---|
| **F0 — Stabiliser** | Finir le travail en cours, **commiter les lots A à E par lot**, M1 vert | 0,5 j | `pnpm verify` vert sur un arbre propre (`git status` vide) |
| **F1 — Résilience de lecture** | M2, M6, M7, M8 | 1,5 j | Coupure Wi-Fi de 30 s pendant un direct : reprise seule. Écran éteint 10 min en podcast : lecture continue |
| **F2 — Moteur** | M4 puis M3 (+ A6) | 2 j | Recette AC3/E-AC3 sur téléphone et box, zapping, PiP, Cast, mosaïque |
| **F3 — DVR** | M5 (+ P2-16, P2-17) | 1 j | Enregistrement TS avec coupure simulée : un seul fichier continu. `onTimeout` déclenché à la main via `adb` |
| **F4 — Observabilité et compatibilité** | M10, M9 | 1 j | Plantage provoqué → journal exportable. Pile lisible avec `mapping.txt` |
| **F5 — Dette** | m1, m3, m4, m5, m6 | 1,5 j | Audit de sécurité P2 clos, chunk principal < 400 kB |

**Garde-fou de processus, à poser dès F0** : un hook `pre-commit` (ou un script `pnpm ship`) qui refuse un commit si `pnpm verify` est rouge, et **une branche par agent**. Pendant cet audit, quatre fichiers ont changé sous mes yeux. Sans branches séparées, deux agents peuvent se défaire mutuellement leurs correctifs, et c'est exactement ce que M1 laisse soupçonner.

---

## 7. Checklist go / no-go 1.12.9

**Bloquants**
- [ ] Arbre propre, lots commités, `pnpm verify` vert (M1)
- [ ] Reprise automatique du direct, y compris au retour du réseau (M2)
- [ ] Programmations reposées au lancement (M6)
- [ ] `setWakeMode` sur les lecteurs (M7)
- [ ] Écran allumé seulement pendant la lecture (M8)
- [ ] Page d'erreur WebView obsolète (M9)
- [ ] Journal de plantage local et exportable (M10)
- [ ] DVR TS qui se reconnecte et gère `onTimeout` (M5)
- [ ] Media3 à jour et audio logiciel (M3, M4), avec recette sur appareil

**Souhaitables**
- [ ] Dette P2 close (m1)
- [ ] Bundle allégé (m3)
- [ ] Double appui sur Retour pour quitter, CH+/– dans les écrans web (m5)
- [ ] Racine nettoyée et `AGENTS.md` à jour, avec la règle `androidScheme` (m6)

---

## 8. Limites de cet audit

- **Pas de compilation Android ni de tests JVM** : aucun SDK Android dans l'environnement d'audit, et la machine virtuelle locale de l'ordinateur n'a pas démarré (virtualisation désactivée dans le BIOS). L'axe compilation Android est donc **non instrumenté**. Les constats Java viennent de la lecture du code.
- **Aucun essai sur appareil ni sur flux réel** : les comportements décrits en M2, M3, M5, M7, M8 et M9 sont établis par le code. Leur gravité ressentie reste à mesurer sur la box et le téléphone.
- **Arbre en mouvement** : l'instantané a été pris pendant que d'autres agents travaillaient. Les points marqués « correction en cours » sont jugés sur l'état de 16 h 30 UTC.
- **Sondes adverses de la revue non rejouées** : les fichiers sous `preuves/revue-lot-d/` n'ont pas été copiés.
- Le positionnement par rapport aux autres lecteurs se fonde sur les attentes générales de la catégorie, pas sur un banc d'essai comparatif instrumenté. Un audit dédié (`benchmark-niche`) le préciserait.

Source de version Media3 : notes de publication AndroidX (Media3 1.11.1 en septembre 2026 ; 1.10.1 du 12 mai 2026 qui corrige notamment un plantage de `SampleQueue` au seek).
