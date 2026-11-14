## Résolution des réserves de contre-vérification Desktop — 14 novembre 2026 (correctifs GUI/DVR/notifications/EPG + preuves complètes, APK 1.12.63 inchangé)

- **Causes racines isolées et corrigées** (suite au rapport [CONTRE_VERIFICATION_DESKTOP_2026-11-14.md](CONTRE_VERIFICATION_DESKTOP_2026-11-14.md)) :
  1. **Fermeture GUI `CedPlay.exe` et arrêt du serveur (`desktop/CedPlayLauncher.cs`, `desktop/server.mjs`, `desktop/lanServers.mjs`)** : `browser.WaitForExit(1200)` dans `CedPlayLauncher.cs` considérait un code de sortie `0` rapide (< 1,2 s) comme un échec de lancement et affichait un `MessageBox` bloquant avant `finally { SetWindowLifecycle(port, "release"); }` ; de plus, les connexions HTTP `keep-alive` retardaient `server.close()` après `release` et la boucle CLI attendait sur des handles ouverts. Corrigé en ne relançant un autre navigateur que si `ExitCode != 0`, en ajoutant `--disable-background-mode` et `serverProc.WaitForExit(3500)` hors DVR actif, et en fermant les sockets oisifs (`closeIdleConnections` / `closeAllConnections` sous 500 ms) puis `onStop` -> `process.exit(0)`. Binaire `CedPlay.exe` recompilé (**15 872 octets**, SHA-256 `659C1699A2E9CCE4B436D3EF663C055EBE4922F50FA722A99C0AD14586163CE7`).
  2. **Notifications Windows natives & persistance après redémarrage serveur (`desktop/notifications.mjs`, `desktop/config.mjs`, `desktop/localAndDvr.mjs`, `desktopBridge.ts`, `remindersNative.ts`, `useRemindersSync.ts`)** : ajout des notifications WinRT Toast (`ToastNotificationManager` / `ToastText02`, avec journal JSONL opt-in `CEDPLAY_NOTIFICATION_LOG` et désactivation opt-in `CEDPLAY_DISABLE_OS_NOTIFICATIONS=1` pour l'E2E), persistance des rappels EPG dans `desktop-state.json` (`reminders: []`), synchronisation `/api/desktop/reminders/sync` + `GET /api/desktop/reminders`, et déclenchement au démarrage/fin DVR et à l'échéance des rappels EPG même après redémarrage complet du processus serveur.
  3. **Fermeture de `ProgramSheet` pendant l'enregistrement d'un rappel (`application/src/components/ProgramSheet.tsx`)** : `disabled={busy}` retirait le focus hors de `[role="dialog"]` vers `document.body` lors du clic asynchrone sur « Me le rappeler », empêchant `Escape` de fermer la fiche ; remplacé par `aria-disabled={busy}` (garde `if (busy) return` conservée dans `run()`).
  4. **Capture DVR des flux HLS `.m3u8` et mise à jour de l'UI (`desktop/localAndDvr.mjs`, `application/src/components/Recordings.tsx`)** : `-reconnect 1 -reconnect_streamed 1` devant un `.m3u8` faisait bloquer le démuxeur HLS FFmpeg ~18 s (`Error during demuxing: I/O error`) et empêchait la création du fichier `.ts` avant le `SIGKILL` à 4 s lors de l'arrêt ; limité aux flux continus non-HLS (`!/\.m3u8(?:$|[?#])/i.test(url)`), et abonnement SSE `recordingStopped` -> `refresh()` ajouté dans `Recordings.tsx`.
- **Vérifications rejouées après la dernière modification de code** :
  - **Suite serveur Desktop & intégration GUI** (`node --test desktop/desktop.test.mjs desktop/audit-regression.test.mjs`, log [desktop-audit-final-backend.log](preuves/desktop-audit-final-backend.log)) : **20/20 passés** (`0 fail`, `0 skipped`, `13587 ms`), couvrant notamment le test réel de fermeture GUI `WM_CLOSE` sur la fenêtre chargée de `CedPlay.exe` (`CedPlay` quitté code `0` + serveur arrêté), l'envoi WinRT Toast natif Windows, la survie et le déclenchement DVR + rappel EPG après redémarrage complet du serveur, et la capture + arrêt d'un flux HLS live `.m3u8`.
  - **Suite Web / TypeScript / ESLint / Vite** (`corepack pnpm verify`, log [desktop-audit-final-verify.log](preuves/desktop-audit-final-verify.log)) : `tsc` app & node **0 erreur**, `eslint ./src` **0 erreur / 15 avertissements préexistants**, Vitest **164/164 fichiers et 1 242/1 242 tests passés** (dont le test de synchro rappels dans `desktopBridge.test.tsx`), `vite build` propre en `8,53 s`.
  - **Recette E2E Chrome `--app` complète** (`node desktop/e2e-verify.mjs`, log [desktop-audit-final-e2e.log](preuves/desktop-audit-final-e2e.log)) : **exit code 0, 0 erreur console, 0 exception page**, couvrant Xtream, `Découvrir`, rail souris, Direct + Mosaïque, **grille EPG XMLTV complète + fiche programme + rappel « Me le rappeler » synchronisé côté serveur + fermeture `Escape`**, VOD/MKV FFmpeg (`+10s`, 2e audio `fra`, `.fr.srt` + sous-titre embarqué), **DVR par clic UI (`Enregistrer` -> `Arrêter` -> fichier `.ts` > 1 Ko sur disque -> listing UI -> notifications `recordingStarted`/`recordingStopped`)**, podcast RSS/MP3 et Réglages `1920×1080`, avec inspection visuelle de [13-epg-grid.png](preuves/desktop-verification/13-epg-grid.png) et [14-dvr-recordings.png](preuves/desktop-verification/14-dvr-recordings.png).
- **Périmètre non vérifiable localement (à tester manuellement par Céd)** :
  - Abonnement IPTV fournisseur réel, flux externes géolocalisés/TLS réels, appairage QR / synchro LAN téléphone ↔ PC sur Wi-Fi réel et comportement après redémarrage complet du système Windows.

## Résolution E2E Desktop & contre-vérification honnête — 13 novembre 2026 (correctifs source + tests + `preuves/desktop-audit-final-*.log`)

- **Causes isolées et corrigées** (suite au rapport [VERIFICATION_BILAN_DESKTOP_2026-11-13.md](VERIFICATION_BILAN_DESKTOP_2026-11-13.md)) :
  1. **Bug applicatif réel (`DesktopPlayerSurface.tsx` + `DesktopCinemaPlayer.tsx`)** : `DesktopPlayerSurface` ne portait pas `data-remote-self`, si bien que `useRemoteNavigation.ts` (écouteur capture sur `window`) interceptait `ArrowRight`, appelait `stopPropagation()` et déplaçait le focus UI au lieu de laisser `DesktopVodCinemaView` avancer de `+10s`. De plus, l'écouteur `keydown` de `DesktopVodCinemaView` se réenregistrait à chaque tick de position (`currentPosSec`), corrigé via `keyActionsRef`.
  2. **Instabilités du harnais E2E (`desktop/e2e-verify.mjs`)** : port CDP aléatoire susceptible de collision (remplacé par allocation libre OS via `node:net`), événements clavier CDP sans `Page.bringToFront()` ni `code`/`windowsVirtualKeyCode` explicites (`Escape` / `ArrowRight`), et clic sur `Films` pouvant concourir avec le nettoyage `pointer-events` après fermeture du dialogue Mosaïque.
- **Vérifications rejouées après la dernière modification de code** :
  - **Tests serveur Node** (`node --test desktop/desktop.test.mjs desktop/audit-regression.test.mjs`, log [desktop-audit-final-backend.log](preuves/desktop-audit-final-backend.log)) : **16/16 passés** (0 échec, 0 ignoré).
  - **Suite Web / TypeScript / ESLint / Vite** (`corepack pnpm verify`, log [desktop-audit-final-verify.log](preuves/desktop-audit-final-verify.log)) : `tsc` app & node 0 erreur, `eslint ./src` 0 erreur / 15 avertissements préexistants, Vitest **164/164 fichiers et 1 241/1 241 tests passés** (dont le test de non-régression `ArrowRight` + `Escape` avec `useRemoteNavigation` actif dans `desktopAuditPlayers.test.tsx`), `vite build` propre en ~8,8 s.
  - **Recette E2E Chrome `--app`** (`node desktop/e2e-verify.mjs`, log [desktop-audit-final-e2e.log](preuves/desktop-audit-final-e2e.log)) : **5 exécutions consécutives passées** puis **1 rejeu propre** (exit code 0, 0 erreur console, 0 erreur de page), avec inspection visuelle des captures `09-mkv-seek-second-audio.png`, `10-mkv-embedded-subtitle.png` (saut effectif à `0:10`, audio `fra`, sous-titre `.fr.srt` puis piste embarquée `0`), `11-mosaic-two-streams.png` et `12-podcast-playing.png`.
  - **Lancement direct de `CedPlay.exe`** (`SHA-256 FFB91BCD3A71C8EBCD798088219D193EF5137B5A7A3C22731F8CE54502D1405A`) sur ports isolés : `/api/desktop/health` répond `{"ok":true,"desktop":true,"platform":"win32","arch":"x64","ffmpeg":true,"ffprobe":true,...}`, injection `__CEDPLAY_DESKTOP__=true` confirmée, démarrage de Chrome `--app` confirmé.
- **Limites et vérifications manuelles restantes (non prouvées automatiquement)** :
  - Dans un sous-shell sans bureau interactif, Chrome lancé en arrière-plan créait une fenêtre sans titre et la fermeture automatique via `CloseMainWindow()`/`taskkill` n'a pas permis de prouver automatiquement la sortie GUI complète de `CedPlay.exe` dans les 10 s (l'arrêt logique du serveur via `/api/desktop/lifecycle/release` sans DVR actif reste couvert par la suite Node 16/16 ; la fermeture manuelle de la fenêtre `CedPlay.exe` par l'utilisateur reste à confirmer visuellement).
  - Non couverts par l'E2E automatisé et restant à valider sur usages réels : clic DVR depuis l'UI, grille EPG complète en E2E, notifications OS / persistance DVR après redémarrage, abonnement IPTV fournisseur réel, flux externes géolocalisés/TLS réels et appairage QR/LAN téléphone ↔ PC sur Wi-Fi réel.

## Application Desktop Windows complète (« Salle obscure » TVBox + pont système FFmpeg/LAN/DVR) — 13 novembre 2026 (sources + CedPlay.exe Desktop, APK 1.12.63 inchangé)

- **Demande de Céd** : créer une application Desktop utilisable sous Windows visuellement aussi soignée que la version TVBox (« Salle obscure ») avec toutes ses fonctionnalités vérifiées.
- **Architecture livrée (`CedPlay.exe`, `Lancer CedPlay Desktop.cmd`, `desktop/`)** :
  - **Lanceur Windows natif** (`desktop/CedPlayLauncher.cs` → `CedPlay.exe` à la racine + `Lancer CedPlay Desktop.cmd` + script `pnpm desktop`) : démarre silencieusement le serveur local `desktop/server.mjs` (port `4178` par défaut ou port libre), injecte `<script>window.__CEDPLAY_DESKTOP__=true;</script>`, ignore `msedge.exe` lorsqu'il est bloqué par IFEO (`msedge_IFEO.exe`) et ouvre une fenêtre `--app` autonome sous Edge, Chrome ou Brave avec profil isolé (`%LOCALAPPDATA%\CedPlay\DesktopProfile`).
    - **Pont système Windows (`desktop/`)** :
      - `httpBridge.mjs` : requêtes HTTP/HTTPS sans CORS avec `User-Agent` personnalisé et décompression gzip (`/api/desktop/http`), proxy média avec `Range` et réécriture HLS `.m3u8` (`/api/desktop/proxy`), sonde de santé des flux (`/api/desktop/probe-streams`), résolution de portail Stalker/Ministra (`/api/desktop/stalker-resolve`), ouverture navigateur (`/api/desktop/open-external`).
      - `ffmpeg.mjs` : transmuxing/transcodage live vers fMP4 H.264/AAC via `C:\Users\C2k\tools\ffmpeg\ffmpeg.exe` (`/api/desktop/transmux`, copie directe ou repli `libx264`, seek `-ss`, sélection `audioTrack`), sonde `ffprobe` (`/api/desktop/probe-media`, pistes audio et sous-titres texte embarqués), conversion sous-titres `.srt`/`.vtt`/`.ass`/`.ssa` et pistes texte embarquées (`/api/desktop/subtitle?track=`) vers WebVTT UTF-8.
      - `localAndDvr.mjs` : sélecteur de dossier Windows natif (`FolderBrowserDialog`), scan récursif (jusqu'à 2 000 vidéos + sous-titres adjacents), streaming local `Range` (`/api/desktop/local/file`), capture DVR directe et programmations persistantes (`desktop-state.json` sous `%LOCALAPPDATA%\CedPlay\desktop`), maintien du serveur tant qu'un enregistrement DVR actif ou programmé subsiste (`/api/desktop/lifecycle/retain` & `/release`).
      - `lanServers.mjs` + `server.mjs` : serveurs HTTP locaux pour appairage QR et synchronisation LAN avec pont SSE `/api/desktop/events` + garde stricte `Host` et `Origin` localhost (`403` sinon).
    - **Interface Desktop « Salle obscure » (`application/src/`)** :
      - Activation automatique du mode TV + ergonomie Desktop (`html.tv-mode.desktop-mode` dans `useTvMode.ts`, `index.css`) : rail gauche ouvrable au survol souris (et auto-replié après clic souris dans `MainNavigation.tsx`), curseurs pointeur, barres de défilement `.tv-scroll`, raccourci plein écran `F11` (`IPTVPlayer.tsx`).
      - Surcouches et lecteurs HTML5 dédiés : `DesktopPlayerSurface.tsx` (portail Radix au-dessus des modales), `DesktopLivePreview.tsx`, `DesktopCinemaPlayer.tsx` (Direct + guide/zapping/DVR REC, VOD/local + seek avec conservation de la position + sous-titres `.srt`/`.ass`/embarqués + épisode suivant + sélection réelle des pistes audio, sans superposition du spinner `Ouverture du lecteur…`), `DesktopMosaicPlayer.tsx` (2 à 8 flux simultanés), lecture podcast MP3 complète (`Écouter`) et capture DVR directe dans `Recordings.tsx`.
      - Parité des ponts (`desktopBridge.ts`, `desktopMediaAttach.ts`, `XtreamLoginDialog.tsx`, `corsProxy.ts`, `userAgent.ts`, `epg.ts`, `xtreamLive.ts`, `xtreamCatalog.ts`, `stalker.ts`, `bodlav.ts`, `officialDocumentaries.ts`, `subtitles.ts`, `subtitleTranslator.ts`, `podcastFetcher.ts`, `podcastSearch.ts`, `streamCheck.ts`, `tvPairing.ts`, `lanSync.ts`, `nativePlayer.ts`, `useVideoPlayer.ts`).
- **Preuves et vérifications** :
  - `corepack pnpm verify` (`application/`) : TypeScript `tsc` app & node **0 erreur**, `eslint ./src` **0 erreur / 15 avertissements préexistants**, Vitest **164/164** fichiers et **1 240/1 240** tests passés (dont `desktopBridge.test.tsx`, `desktopAuditNavigation.test.tsx`, `desktopAuditParity.test.tsx`, `desktopAuditPlayers.test.tsx`), `vite build` propre en 8,79 s.
  - Tests d'intégration serveur Node (`node --test desktop/desktop.test.mjs desktop/audit-regression.test.mjs`) : **16/16 passés** (injection desktop + gardes `Host`/`Origin` + JSON invalide `400`, `Range`, `.ass`/`.ssa`→WebVTT, sélection piste audio et sous-titres texte embarqués FFmpeg, HTTP gzip + réécriture M3U8, DVR erreur + conservation après `release` jusqu'à fin d'enregistrement programmé, QR/LAN + SSE).
  - Recette E2E réelle complète dans Chrome `--app` (`node desktop/e2e-verify.mjs`) + inspection visuelle des 12 captures (`preuves/desktop-verification/01..12-*.png`) : connexion Xtream locale, `Découvrir` (Bodlav/TV5MONDEplus), rail gauche souris, `Direct` 3 colonnes avec aperçu vidéo H.264, lecteur Cinema plein écran Live, **Mosaïque à 2 flux simultanés au premier plan** (`11-mosaic-two-streams.png`), catalogue `Films` VOD, bibliothèque locale `USB / SD` lisant un `.mkv` AC3 transcodé par FFmpeg avec `.fr.srt`, **seek `+10s` + changement réel vers la 2e piste audio sans remise à zéro** (`09-mkv-seek-second-audio.png`) + **sous-titre embarqué activé et affiché** (`10-mkv-embedded-subtitle.png`), **Écouter / Podcast RSS + décodage MP3 réel + pause/reprise** (`12-podcast-playing.png`), `Plus` et `Réglages` en `1920×1080` (**0 erreur console, 0 exception page**).
  - Test direct du binaire compilé `CedPlay.exe` : `/api/desktop/health` répond `200 OK` (`ffmpeg: true, ffprobe: true`), lancement réel de `chrome.exe --app=http://127.0.0.1:<port>/?desktop=1` avec injection `__CEDPLAY_DESKTOP__=true`, et arrêt propre du processus `CedPlay.exe` + serveur Node après fermeture de la fenêtre sans DVR actif.
  - **Restent à tester manuellement par Céd** : lancement avec son abonnement IPTV fournisseur réel, flux externes géolocalisés/TLS réels, télécommande/appairage QR téléphone ↔ PC sur le Wi-Fi local.

## Durée Android par épisode, stop différé Trakt, personnalisation d’accueil et APK 1.12.59 — 12 novembre 2026

- **Corrections Android & Trakt (finalisées)** :
  1. *Ordre `attachStats` / `playedMs` (`NativePlayerActivity.java`)* : `attachStats(result)` est appelé avant la copie de `totalPlayedMs` et des durées par épisode dans `saveProgress()`, afin que les lectures courtes autour du seuil de 5 s ne perdent pas le dernier segment.
  2. *Durée mesurée par épisode (`NativePlayerActivity.java`, `nativePlayer.ts`)* : `playedMsByMedia` cumule `recordPlayTime` par `mediaId` (avec sauvegarde/restauration dans `visitedProgress`) et `openVod` lit `entry.playedMs` pour chaque épisode enchaîné.
  3. *Stop différé si fermeture pendant un `start` Trakt (`trakt.ts`)* : `maybeScrobbleTrakt` conserve la demande `stop` dans `session.pendingStop` lorsque `session.starting` est vrai et la chaîne sur `session.startPromise` dès la fin du `start`.
- **Personnalisation directement depuis l’accueil** :
  1. *Signature persistée (`discover.ts`, `discoverRecommendations.ts`)* : `saveForYouSignature` / `readForYouSignature` persistent la signature d’historique local + externe pour déclencher le recalcul dès l’accueil après lecture ou synchro Trakt, même après remontage.
  2. *Rattachement Trakt (`idb.ts`, `externalWatch.ts`, `recommendations.ts`)* : `originChannelId` préserve l’identifiant d’origine (`trakt:...`) pour alimenter « Parce que tu as regardé… ».
  3. *Enrichissement TMDB & distinction Bibliothèque / À découvrir (`tasteEnrichment.ts`, `discoverRecommendations.ts`, `useDiscoverRecommendations.ts`, `ContinuePanel.tsx`, `IPTVPlayer.tsx`, `VodLibrary.tsx`)* : utilisation de `tmdbApiKey` dès l’accueil, ajout des suggestions similaires TMDB hors bibliothèque, badges **Bibliothèque** et **À découvrir** sur chaque carte, légendes dynamiques et ouverture de la recherche globale sur les titres à découvrir.
- **Livraison & Preuves** :
  - Version synchronisée en **1.12.59** (`versionCode 107`) dans `package.json`, `build.gradle` et `SettingsPanel.tsx`.
  - `corepack pnpm verify` : `tsc` app/node **0 erreur**, `eslint ./src` **0 erreur / 15 avertissements**, Vitest **149/149** fichiers et **1 148/1 148** tests passés, `vite build` réussi.
  - `cap sync android` + `.\gradlew.bat testDebugUnitTest assembleRelease` : **BUILD SUCCESSFUL in 1m 22s**.
  - APK à la racine : `CedPlay-1.12.59.apk` + copie `CedPlay.apk` (**4 483 051 octets**, SHA-256 `e4aba8f38b0b1dcde7db46a5f7498195416fa02155f3f8e222672ff432d64741`), `CedPlay-1.12.58.apk` supprimé.
  - **Reste à valider sur appareils réels (téléphone et Android TV)** : parcours complet (reprise, changement d’épisode, chaînes privées, logos, guide TV, télécommande), scrobbling Trakt en conditions réelles et mise à jour de l’accueil après lecture/synchro.

## TV : marge de sécurité aux bords et sortie confirmée — 12 novembre 2026 (sources seulement, aucune version, aucune APK)

- **Demande de Céd** : traiter les deux améliorations TV restantes, la marge aux bords de l'écran et le comportement de Retour à la racine. Fait dans ce dossier, par-dessus le WIP 1.12.58, sans changer de numéro de version.
- **Marge** : `.tv-app-shell` garde 32 px à droite et 24 px en bas (16 et 8 à 12 px avant) ; l'horloge passe à 32 px du bord droit et 14 px du haut. Les écrans à hauteur calculée (`TvLiveScreen`, `TvVodScreen`) réservent le bas par `TV_SAFE_BOTTOM = 24` (`src/utils/tvSafeArea.ts`). Le rail de gauche n'est pas touché (icônes à 26 px du bord). Rendu mobile inchangé : seules des règles et des composants TV sont concernés.
- **Retour à la racine** : sur TV, un Retour depuis l'Accueil ne ferme plus l'application d'un coup. Le premier appui affiche « Appuie encore sur Retour pour quitter CedPlay », un second dans les 2,5 s quitte (`src/utils/tvExitGuard.ts`, branché dans `App.tsx`). Sur téléphone, comportement inchangé.
- **Prouvé par les tests et le navigateur** : `tsc -p tsconfig.app.json` 0 erreur ; ESLint 0 erreur sur les fichiers touchés ; `vitest run` complet 1147/1148, le seul échec (`continuePanel.test.tsx`, région « Pour toi » encore en chargement) passe quand le fichier est rejoué seul (82/82 avec les écrans TV et `tvExitGuard`) et ne touche pas ces fichiers. Aperçu `?tv=1` en 960×540 : enveloppe `42px 32px 24px 88px`, écran Direct à 42/32/24/88 px des bords, aucun défilement de page.
- **Vérification complète rejouée ensuite (même jour)** : `pnpm verify` exit 0 (typage, ESLint 0 erreur / 15 avertissements, **1148/1148** tests Web, build réussi) ; suite Android rejouée sans cache **57/57**.
- **Non fait** : APK, essai sur box. Le message de confirmation et la sortie au second appui ne sont prouvés que par le test de la garde, pas sur appareil.

## Tests des corrections de l'appairage par QR code — 12 novembre 2026 (tests seulement, aucune version)

- **Contexte** : une revue du commit `33ac7d8` relevait quatre défauts (mot de passe visible, pas d'expiration, connexions non bornées, confirmation trompeuse). Ils étaient déjà corrigés dans ce dossier depuis la 1.12.54, mais sans test dédié. Céd a demandé d'ajouter ces tests. **Aucun code produit modifié**, trois fichiers de test seulement.
- **Android, `PairingServerTest.java` (10 → 16 tests)** : mot de passe jamais renvoyé au téléphone ; réponse 409 « Envoi non accepté » quand le téléviseur refuse ; second envoi refusé tant que le premier attend ; fermeture seule à l'expiration (durée de vie injectée de 150 ms) ; l'arrêt coupe les connexions ouvertes ; la septième connexion muette est coupée (2 en traitement, 4 en attente).
- **Web** : `tvPairing.test.ts` (+1) vérifie l'accusé de réception `acknowledgePairing` accepté / refusé / saisie inexploitable ; `xtreamLoginDialog.test.tsx` (+2) vérifie le refus d'un second envoi pendant la connexion et l'expiration du QR code à 5 minutes avec « Afficher un nouveau code ».
- **Prouvé par les tests** : `vitest run` sur les deux fichiers Web **24/24** ; `gradlew testDebugUnitTest --tests PairingServerTest` **16/16**, rejoué trois fois (0,92 à 0,96 s) ; `tsc -p tsconfig.app.json` 0 erreur ; ESLint sans remarque sur les deux fichiers. **Non rejoué** : `pnpm verify` complet et la suite Android entière (WIP d'autres chantiers en cours dans l'arbre).
- **Toujours pas fait** : aucun essai réel (QR code scanné par un téléphone, envoi vers la box). Le trafic reste en HTTP simple sur le réseau local.
- **Branche `claude/tv-box-user-experience-5ec02f`** : dépassée, ses trois commits utiles sont repris ici ; ne plus rien en intégrer ni en tirer d'APK.

## Élimination des 4 brèches de concurrence Trakt & Mesure matérielle ExoPlayer — 12 novembre 2026

- **Contexte & Traitement exhaustif de l'audit critique de Céd** :
  1. *Exclusion mutuelle absolue entre `stop` et `start` (`trakt.ts`)* :
     - `shouldStop` vérifie strictement `!session.stop && !session.stopping && !session.starting`.
     - `shouldStart` vérifie strictement `!session.start && !session.starting && !session.stop && !session.stopping`.
     - Si un `stop` a eu lieu ou est en vol, aucun `start` ne peut plus jamais être émis (et vice-versa).
     - Le test unitaire dédié valide l'impossibilité d'émettre un `start` après ou pendant un `stop` à 85% de progression sur des ticks concurrents.
  2. *Suppression atomique et mutex de vidage de la file hors-ligne (`trakt.ts`)* :
     - Remplacement de l'écrasement global par `removePendingTraktScrobble(item.sessionKey, item.action)` qui ne retire que les scrobbles acquittés par le réseau. Tout scrobble ajouté pendant l'attente réseau reste intact dans `localStorage`.
     - Mutex `activeFlushPromise` : les vidages simultanés partagent la même promesse active, éliminant tout doublon réseau.
  3. *Garde stricte sur `traktScrobble === false` (`trakt.ts`)* :
     - `doFlushPendingTraktScrobbles` vérifie explicitement `effectiveSettings?.traktScrobble === false` et sort immédiatement avec 0 émission si le scrobble est désactivé, même lors des événements `online` du navigateur.
  4. *Exclusion stricte des chargements et attentes dans le compteur Web (`VodLibrary.tsx`)* :
     - Suppression de l'affectation `lastPlayingAt = performance.now()` dans `save()`.
     - Seul l'événement DOM `playing` démarre le chronomètre `lastPlayingAt`.
     - Les événements `pause`, `waiting`, `seeking`, `stalled`, `emptied`, `error` coupent immédiatement `lastPlayingAt` via `onStopOrBuffering()`.
     - `flushPlaying()` ne prolonge la mesure que si `!video.paused && !video.ended && video.readyState >= 3`.
  5. *Mesure matérielle ExoPlayer sur Android TV & Mobile (`NativePlayerActivity.java`, `nativePlayer.ts`)* :
     - Intégration de `totalPlayedMs` alimenté par le `PlayTimeMeter` matériel branché sur `onIsPlayingChanged` d'ExoPlayer.
     - Transmis dans l'Intent de résultat (`result.putExtra("playedMs", totalPlayedMs)`) et relayé par le plugin Capacitor (`NativePlayerPlugin.java`).
     - Dans `nativePlayer.ts`, `watchDurationMs` privilégie directement `result.playedMs` : les pauses, chargements, sauts et reprises immédiates ne peuvent plus jamais fausser le temps de visionnage ni déclencher de faux scrobble.
- **Résultats de vérification automatisée (`pnpm verify`)** :
  - TypeScript (`tsc -p tsconfig.app.json` et `tsconfig.node.json`) : **0 erreur**.
  - ESLint (`eslint ./src` sans `--quiet`) : **0 erreur / 15 avertissements** (benchmark historique respecté).
  - Vitest : **1 139 / 1 139 tests passés sur 148 fichiers** (100% vert, +3 tests dédiés).
  - Build Vite : réussi en 8,35 s.

## Durcissement de la concurrence, distinction temps regardé et file hors-ligne Trakt.tv — 12 novembre 2026

- **Contexte & Traitement exhaustif des observations critiques de Céd** :
  1. *Verrous posés avant le premier await (`trakt.ts`)* :
     - Dans `maybeScrobbleTrakt`, `session.stopping = true` ou `session.starting = true` est désormais appliqué de façon **strictement synchrone avant le tout premier `await`** (avant la vérification / le rafraîchissement du jeton `getValidTraktAccessToken`).
     - L'ensemble de la procédure (renouvellement du jeton, construction du payload et requête réseau) s'exécute sous ce verrou, avec libération garantie dans un bloc `finally`.
     - Deux appels survenant simultanément dans le même cycle d'événements voient le second immédiatement neutralisé (`shouldStop` / `shouldStart` évalue `!session.stopping` / `!session.starting` à `false`), éliminant tout doublon en vol.
  2. *Pas de nouvelle tentative après fermeture Android -> Retries et file d'attente hors-ligne (`trakt.ts`, `nativePlayer.ts`)* :
     - `scrobbleTrakt` intègre un mécanisme de retries avec temporisation progressive (jusqu'à 2 réessais) pour absorber les coupures réseau temporaires au moment de la fermeture du lecteur.
     - Si la requête de fermeture (`isClosed: true`, action `stop`) échoue malgré les réessais (ex: appareil hors-ligne), elle est automatiquement persistée dans une file d'attente locale `pendingTraktScrobbles` (`localStorage`).
     - La fonction `flushPendingTraktScrobbles` est automatiquement invoquée au rétablissement de la connexion (`window.addEventListener('online')`), au démarrage de tout nouveau scrobble, et lors de la synchronisation manuelle dans les réglages, garantissant qu'aucun visionnage réel n'est perdu lors d'une fermeture hors-ligne sur Android ou Web.
  3. *Position ≠ temps réellement regardé (`trakt.ts`, `nativePlayer.ts`, `VodLibrary.tsx`)* :
     - Reprendre un film à 40 minutes (`positionMs = 2 400 000 ms`) et fermer immédiatement ne doit pas déclencher de scrobble.
     - `maybeScrobbleTrakt` accepte le paramètre explicite `watchDurationMs`. La condition minimale de 5 secondes (`hasWatchedMin`) s'appuie désormais prioritairement sur ce temps réel de visionnage au cours de la session.
     - Dans le lecteur natif Android (`nativePlayer.ts`), pour un média repris, la progression par rapport à `startPositionMs` est bornée par le temps écoulé réel depuis l'ouverture (`Math.min(sessionElapsedMs, positionAdvance)`).
     - Dans le lecteur Web (`VodLibrary.tsx`), `watchedMs` cumule le temps de lecture effective (événements `playing`, `pause`, `waiting`, `seeking`), garantissant qu'une simple ouverture/fermeture immédiate ne comptabilise aucun temps de visionnage indu.
- **Résultats de vérification automatisée (`pnpm verify`)** :
  - TypeScript (`tsc -p tsconfig.app.json` et `tsconfig.node.json`) : **0 erreur**.
  - ESLint (`eslint ./src` sans `--quiet`) : **0 erreur / 15 avertissements** (benchmark historique respecté).
  - Vitest : **1 136 / 1 136 tests passés sur 148 fichiers** (100% vert, +3 nouveaux tests unitaires pour la concurrence, le temps regardé sur reprise, et la file hors-ligne avec retries).
  - Build Vite : réussi en 8,41 s.

## Correction des 4 défauts résiduels de scrobble & jeton Trakt.tv — 12 novembre 2026

- **Contexte & Analyse rigoureuse des observations de Céd** :
  1. *Suppression de l'annonce fictive pré-lancement Android* (`nativePlayer.ts`) :
     - Élimination intégrale de l'appel anticipé `maybeScrobbleTrakt` à 5 000 / 100 000 ms avant `NativePlayer.openVod`. Aucun faux `start` n'est envoyé pour une vidéo qui échoue ou est annulée immédiatement.
     - À la fermeture du lecteur natif : si `positionMs < 5000` et non terminée, aucun scrobble n'est émis. Si la lecture a été effective (`positionMs >= 5000` ou `completed`), un scrobble `stop` est envoyé avec la progression réelle constatée (`isClosed: true`).
  2. *Renouvellement automatique du jeton pour le scrobble* (`trakt.ts`) :
     - `maybeScrobbleTrakt` appelle désormais `getValidTraktAccessToken` avant toute tentative de scrobble. Si le jeton est expiré ou à moins de 10 min de son expiration, il est renouvelé via `refreshTraktToken` et sauvegardé dans les réglages.
     - En cas d'erreur HTTP 401 survenue pendant le scrobble, `scrobbleTrakt` sollicite le callback `onUnauthorized` qui force un rafraîchissement immédiat via `refresh_token` et réessaie l'envoi une fois avec le nouveau jeton.
  3. *Suppression du repli arbitraire vers la saison 1* (`trakt.ts`) :
     - Dans `scrobbleTrakt`, la ligne `payload.season ?? (payload.episode !== undefined ? 1 : undefined)` a été remplacée par `payload.season`. Si la saison est indéterminée, le scrobble de série est strictement refusé (`return false`) au lieu d'inventer un faux S01E05.
  4. *Résilience aux pannes réseau temporaires* (`trakt.ts`) :
     - `session.start` et `session.stop` ne sont marqués à `true` que si la requête réseau a réussi (`ok === true`).
     - Des verrous temporaires en vol (`starting`, `stopping`) protègent contre les duplications concurrentes et sont réinitialisés en bloc `finally`. Une interruption réseau temporaire ne bloque plus la session : les ticks suivants retentent automatiquement l'action dès que la connexion est rétablie.
- **Résultats de vérification automatisée** :
  - TypeScript (`tsc -p tsconfig.app.json` et `tsconfig.node.json`) : **0 erreur**.
  - ESLint (`eslint ./src` sans `--quiet`) : **0 erreur / 15 avertissements**.
  - Vitest : **1 133 / 1 133 tests passés sur 148 fichiers** (100% vert, 4 nouveaux tests unitaires dédiés à ces 4 cas).
  - Build Vite : réussi en 8,18 s.

## Audit, durcissement et correction intégrale des 7 défauts Trakt.tv & Recommandations d'accueil — 12 novembre 2026

- **Contexte & Traitement exhaustif de la contre-expertise utilisateur** :
  L'audit critique a relevé 7 failles concrètes dans l'implémentation initiale, qui ont toutes été corrigées et prouvées :
  1. *Stabilité de session du lecteur Web (`VodLibrary.tsx`)* :
     - Remplacement de `ts: Date.now()` par un identifiant de session pérenne mémorisé dans un `useRef` (`web:${mediaId}:${startedAt}`), garantissant que le scrobble Trakt `maybeScrobbleTrakt` n'envoie pas de `start`/`stop` en boucle et que la déduplication fonctionne.
  2. *Scrobble en direct et films natifs Android (`nativePlayer.ts`)* :
     - Émission immédiate du scrobble `start` dès l'appel à `openVod` (avant le lancement de l'Activity), et non plus uniquement au retour.
     - Pour les films natifs : extraction correcte du titre (`title`) et attribution du type `'movie'` au lieu de dépendre du contexte d'enchaînement d'épisodes (qui était vide pour les films).
     - Rétablissement de la compatibilité des signatures d'appel `openVod` sans 7e argument superflu (`vodMeta` optionnel), tout en préservant l'extraction des métadonnées enrichies depuis `zap.history`.
  3. *Suppression du fallback aveugle S01E01 et métadonnées structurées (`trakt.ts`, `idb.ts`, `VodLibrary.tsx`)* :
     - `parseSeasonAndEpisode` ne force plus jamais `S01E01` par défaut (retourne `{ season?: number; episode?: number }` strict).
     - `scrobbleTrakt` refuse de scrobbler un épisode si les numéros ne sont pas formellement identifiés.
     - Propagation des numéros réels et typés (`season`, `episode`) et identifiants TMDB à travers l'interface `PlayHistoryEntry` et les contextes de lecture.
  4. *Dissociation TMDB ID de la série vs de l'épisode (`trakt.ts`)* :
     - `traktHistoryToWatchEntries` associe rigoureusement `item.show?.ids?.tmdb` à `tmdbId` (et `item.episode?.ids?.tmdb` à `episodeTmdbId`), éliminant toute pollution du profil de goût ou des recommandations par l'identifiant individuel d'un épisode.
  5. *Gestion explicite des erreurs HTTP Trakt (`trakt.ts`, `SettingsPanel.tsx`)* :
     - Création de la classe d'erreur `TraktError`.
     - `fetchTraktHistory` lève des exceptions typées sur les codes HTTP 401, 403, 5xx ou rupture réseau au lieu de renvoyer une liste vide masquant l'incident.
     - `SettingsPanel` notifie l'utilisateur via toast avec le motif exact de l'échec.
  6. *Activité de `traktSync`, Refresh Token & Expiration (`trakt.ts`, `SettingsPanel.tsx`)* :
     - Implémentation du flux de renouvellement OAuth 2.0 `refreshTraktToken` (`grant_type: refresh_token`).
     - Ajout de `getValidTraktAccessToken` qui déclenche automatiquement le renouvellement si le jeton expire dans moins de 10 minutes.
     - Prise en compte active de la case `traktSync` qui déclenche immédiatement une synchronisation dès son activation.
  7. *Alimentation réelle de l'accueil par les visionnages externes Trakt (`discoverRecommendations.ts`, `ContinuePanel.tsx`)* :
     - `ContinuePanel` charge `externalWatches` depuis IndexedDB et écoute l'événement `'external-watches-updated'`.
     - `discoverRecommendations.ts` utilise les visionnages Trakt comme graines de recommandation (`externalSeeds`) dès que l'historique local Xtream est vide.
     - La rangée « Parce que tu as regardé… » affiche et rattache désormais la source externe Trakt même en l'absence totale de visionnage local.
- **Contrôles et preuves de conformité** :
  - TypeScript (`tsc -p tsconfig.app.json` et `tsconfig.node.json`) : **0 erreur**.
  - ESLint (`eslint ./src` sans `--quiet`) : **0 erreur / 15 avertissements** (benchmark historique respecté).
  - Vitest : **1 129 / 1 129 tests passés sur 148 fichiers de tests** (100% vert, régression `openVod` et `idb` résolue).
  - Build Web Vite : réussi en 11,40 s (`dist/` minifié, aucun média lourd).
  - Vérification complète `pnpm verify` respectée.

## Intégration de la connexion personnelle Trakt.tv (OAuth code appareil, scrobble en direct et synchro d'historique) — 12 novembre 2026

- **Contexte & Fonctionnalités implémentées** :
  1. *Autorisation OAuth code appareil (`TraktAuthDialog.tsx` & `trakt.ts`)* :
     - Conforme RFC 8628 pour téléviseur et mobile depuis le canapé : demande d'un `device_code` et d'un `user_code` lisible.
     - Affichage du code en gros caractères espacés, lien cliquable `trakt.tv/activate`, et QR code vectoriel SVG pur généré localement via `qrcode-generator`.
     - Sondage automatique régulé (intervalle 5s) avec annulation propre `AbortController`.
     - Récupération du profil `@username` et persistance sécurisée des jetons (`traktToken`, `traktRefreshToken`, `traktExpiresAt`).
  2. *Synchronisation de l'historique Trakt vers l'accueil & recommandations* :
     - `fetchTraktHistory` récupère les 50 derniers films et épisodes vus sur Trakt.
     - `traktHistoryToWatchEntries` convertit l'historique en `PlayHistoryEntry` avec `platform: 'trakt'`, `mediaKind: 'movie' | 'series'`, identifiants TMDB, date de visionnage et statut terminé.
     - Intégration transparente dans « Vu ailleurs » (`externalWatches`) et déclenchement de l'événement `'external-watches-updated'` pour nourrir instantanément le profil de goût TMDB et les rangées « Pour toi » et « Parce que tu as regardé… » de l'accueil.
  3. *Scrobble en temps réel pendant la lecture* :
     - `scrobbleTrakt` / `maybeScrobbleTrakt` : actions `start` (dès 5s de lecture stabilisée) et `stop` (lorsque la lecture se termine ou dépasse 80% de progression, marquant le film/épisode comme vu sur Trakt).
     - Raccordé à la fois sur le lecteur Web (`VodLibrary.tsx`) et sur le lecteur natif Android (`nativePlayer.ts`).
     - Gestion des erreurs non bloquante : aucune panne réseau ou expiration de jeton ne peut interrompre la lecture.
  4. *Interface dans `SettingsPanel.tsx` & Sécurité* :
     - Section dédiée « Trakt.tv » avec statut connecté `@username`, bouton de synchronisation manuelle et déconnexion en un clic.
     - Cases à cocher pour activer/désactiver le scrobble en direct et la synchronisation avec les recommandations.
     - Masquage systématique des secrets dans les journaux de modifications et les diagnostics (`redact.ts` : `traktToken`, `traktRefreshToken`, `traktClientSecret`).
     - Migration transparente des réglages `v10 -> v11` (`storage.ts`).
- **Contrôles et preuves de conformité** :
  - TypeScript (`tsc -p tsconfig.app.json` et `tsconfig.node.json`) : **0 erreur**.
  - ESLint (`eslint ./src`) : **0 erreur / 15 avertissements** (benchmark historique respecté).
  - Vitest : **1 124 / 1 124 tests passés sur 148 fichiers de tests** (+17 tests ajoutés : 11 dans `trakt.test.ts`, 3 dans `traktAuthDialog.test.tsx`, 2 dans `settingsPanelTrakt.test.tsx`, 1 dans `storageSettings.test.ts`).
  - Build Web Vite : réussi (`dist/` minifié, aucun média lourd, bundles propres).
  - Tests unitaires Android Gradle : **75 / 75 tâches passées** (`./gradlew testReleaseUnitTest` BUILD SUCCESSFUL en 13s).
  - Chaîne complète `pnpm verify` validée avec succès (code de retour 0).
- **Prochaine étape possible** :
  - Enchaîner sur BetaSeries ou YouTube, ou consolider et packager une nouvelle livraison APK (v1.12.59 / code 107).

## Alimentation automatique des recommandations d’accueil sans visite préalable du catalogue — 12 novembre 2026

- **Contexte & Problématique résolue** :
  - Sur TV comme sur mobile, les recommandations (« Pour toi » et « Parce que tu as regardé… ») n'étaient calculées que depuis `VodLibrary.tsx` lors de la navigation dans les catégories VOD (et sur TV, uniquement si l'entrée « Pour toi » était explicitement ouverte dans la colonne latérale).
  - Au lancement de l'application, l'accueil ne disposait donc d'aucune recommandation tant que l'utilisateur n'avait pas ouvert le catalogue de films ou de séries.
- **Architecture & Implémentation réalisée** :
  1. *Module utilitaire `application/src/utils/discoverRecommendations.ts`* :
     - `historySignature` : signature de récence et d'avancement des visionnages qualifiés (par type `movie` ou `series`).
     - `shouldRefreshRecommendations` : déclenche le recalcul si le cache de recommandations est vide, s'il manque de `sourceId` (pour la rangée « Parce que tu as regardé »), ou si un nouveau titre a été regardé.
     - `watchedCategoryIds` / `resolveTargetCategoryIds` : sélectionne en priorité les catégories des œuvres vues par l'utilisateur (en excluant les catégories adultes), ou à défaut la dernière catégorie visitée / populaire du compte Xtream.
     - `fetchCategoryCandidates` : charge les titres des catégories ciblées par petits lots sans **jamais** émettre de requête globale `get_vod_streams` sans `category_id` (anti-saturation serveur Xtream), et alimente `categoryCatalogCache`.
     - `feedHomeRecommendations` : calcule les recommandations déterministes via `recommendForHistory` (avec scores, justifications lisibles et `sourceId`), puis persiste dans `saveForYouSnapshot` (déclencheur de l'événement `'for-you-updated'`).
  2. *Hook React `application/src/hooks/useDiscoverRecommendations.ts`* :
     - Exécute en arrière-plan le rafraîchissement des recommandations pour les films et les séries dès le montage de l'accueil, avec gestion d'annulation `AbortController`.
  3. *Intégration dans `ContinuePanel.tsx`* :
     - Branché directement dans l'accueil, rendant les rangées « Pour toi » et « Parce que tu as regardé » immédiatement disponibles dès l'ouverture de l'application.
     - L'action « Actualiser » de l'accueil synchronise également les suggestions en complément des flux podcasts.
- **Contrôles et preuves de conformité** :
  - TypeScript (`tsc -p tsconfig.app.json` et `tsconfig.node.json`) : **0 erreur**.
  - ESLint (`eslint ./src`) : **0 erreur / 17 avertissements**.
  - Vitest : **1 107 / 1 107 tests passés** sur 145 fichiers de tests (+8 tests ajoutés : 7 dans `discoverRecommendations.test.ts` et 1 test d'intégration dans `continuePanel.test.tsx`).
  - Build Web Vite : réussi (`dist/` minifié, aucun média lourd).
  - Chaîne complète `pnpm verify` validée avec succès (code de retour 0).
- **Prochaine étape possible** :
  - Développer les connexions personnelles Trakt, BetaSeries et YouTube selon les priorités de Céd.

## Consolidation & validation des 3 nouvelles rangées de l'accueil (Épisodes suivants, Parce que tu as regardé, Mes plateformes) — 12 novembre 2026 (version 1.12.58 / code 106)

- **Contexte & Fonctionnalités ajoutées** :
  1. *Épisodes suivants* (`next-series`) : propose automatiquement la suite disponible chez le fournisseur après un épisode terminé. Gestion via `followedSeries` et `nextSeriesEpisode` (`discoverSeries.ts`), tri strict des saisons/épisodes, exclusion des spéciaux et des épisodes déjà commencés ou vus.
  2. *Parce que tu as regardé…* (`because-watched`) : recommandations rattachées à un visionnage réel via `recommendForHistory` avec traçabilité `sourceId` et justifications contextuelles (« Proche de… », « Même catégorie que… »), sans doublons avec « Pour toi ».
  3. *Mes plateformes* (`platforms`) : raccourcis d'accès direct aux plateformes de streaming favorites (`readMyPlatforms`, `streamingPlatforms`), incluant YouTube si sélectionné. Ouverture native via `NativePlayerBridge.openWeb` (avec packages Android prioritaires) ou onglet navigateur web, et masquage sous verrouillage parental.
- **Levée du blocage des tests (`spawn EPERM`)** :
  - L'erreur `spawn EPERM` constatée lors de l'appel direct à esbuild / Vitest sous Windows est contournée et résolue par l'invocation via `corepack pnpm exec vitest run`.
  - Intégration et validation des 6 tests unitaires supplémentaires (+3 dans `discoverSeries.test.ts`, +2 dans `continuePanel.test.tsx`, +1 dans `discover.test.ts`).
- **Contrôles et preuves de conformité** :
  - TypeScript (`tsc -p tsconfig.app.json` et `tsconfig.node.json`) : **0 erreur**.
  - ESLint (`eslint ./src`) : **0 erreur / 17 avertissements**.
  - Vitest : **1 099 / 1 099 tests passés** sur 144 fichiers de test (durée 54,31 s).
  - Build Web Vite : réussi en 8,03 s (`dist/` minifié, sans sourcemaps).
  - Tests unitaires Android : **75 / 75 tâches Gradle passées** (`./gradlew testReleaseUnitTest` en 13 s).
  - Capacitor : `cap sync android` réussi en 0,458 s.
  - Compilation Release Gradle : `./gradlew assembleRelease` **BUILD SUCCESSFUL** en 26 s.
  - Contrôle matériel physique : aucun appareil connecté sur `adb`.
- **Livraison** : **1.12.58 / code 106**, APK `CedPlay-1.12.58.apk` et copie `CedPlay.apk` à la racine du dépôt (4 471 381 octets, SHA-256 `9fd3d906ad8a1840483202bc64788e924528335fe7f6ac78e368de803630c5ae`).

## Consolidation complète & validation des correctifs d'accueil (TV, thème clair, mobile) — 12 novembre 2026 (version 1.12.58 / code 106)

- **Contexte & Audit** :
  1. *TV, titres longs — risque de chevauchement* : à 960 × 540, le bandeau était fixé à 200 px avec les filtres superposés en haut. Un titre sur deux lignes avec métadonnées risquait de remonter sous les filtres.
     - *Correction vérifiée* : `tv-discover-hero` assoupli avec `min-height: 200px` au lieu de `height: 200px`, et `padding-top: 64px` généralisé sur `tv-discover-hero-copy` pour garantir l'espace réservé aux filtres dans tous les cas (avec ou sans image).
  2. *Thème clair — contraste* : le bandeau combinait des fonds sombres fixes avec des textes dépendants du thème, provoquant un contraste insuffisant en mode clair.
     - *Correction vérifiée* : fond clair adaptatif (`linear-gradient(105deg, hsl(var(--background)) 8%, hsl(var(--secondary)) 100%)`), fond du texte opacifié (`hsl(var(--background) / .94)`), eyebrow en `hsl(var(--primary))` au lieu du saumon `#ffac96`, et hints en `hsl(var(--muted-foreground))`.
  3. *Mobile — sélection des affiches dans le carrousel* : dans `ContinuePanel.tsx`, les deux premières reprises étaient sélectionnées avant le filtrage par présence d'affiche.
     - *Correction vérifiée* : `.filter(item => item.image)` est exécuté *avant* le `.slice(0, 2)`. Si les deux premières reprises n'ont pas d'affiche, les suivantes illustrées prennent place dans le bandeau. Test de régression dédié validé dans `continuePanel.test.tsx`.
- **Résolution du blocage des tests (`spawn EPERM`)** :
  - L'incident `spawn EPERM` rencontré lors des sessions précédentes provenait de l'invocation directe de `pnpm` vs le runtime Node / esbuild sous Windows. Résolu par l'utilisation de `corepack pnpm`.
- **Vérifications et preuves** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : `eslint ./src` (sans `--quiet`) : **0 erreur / 17 avertissements**.
  - Tests unitaires Web : **1093/1093 passés sur 143 fichiers** (durée 51,43 s).
  - Build Vite : minifié, sans maps sources dans `dist/` (7,94 s).
  - Tests unitaires Android : **75/75 tâches Gradle passées** (`./gradlew testReleaseUnitTest` en 12 s).
  - Capacitor : `cap sync android` exécuté avec succès (0,458 s).
  - Compilation Release Gradle : `./gradlew assembleRelease` **BUILD SUCCESSFUL** en 24 s.
  - Matériel physique : aucun appareil connecté sous `adb` au moment du contrôle.
- **Livraison** : **1.12.58 / code 106**, APK `CedPlay-1.12.58.apk` et copie `CedPlay.apk` à la racine du dépôt (4 469 761 octets, SHA-256 `d49ab3c2715de8dc3b563c554582ea83fb78f0d6363c5bfea1be366315bbdea5`).

## Consolidation complète & livraison : Affichage robuste des icônes de chaînes sur la page d'accueil — 12 novembre 2026 (version 1.12.58 / code 106)

- **Contexte & Retours de Céd** : « les icones des chaines ne s'affichent pas sur la page d'accueil »
- **Diagnostic des causes racines** :
  1. *Blocage Chromium / WebView dans les conteneurs horizontaux* : les rangées de l'accueil (`data-discover-rail`) sont en défilement horizontal (`overflow-x-auto`). L'attribut `loading="lazy"` dans `ChannelLogo.tsx` liait l'IntersectionObserver au viewport vertical du document, bloquant ou retardant indéfiniment le chargement des logos des chaînes dans les rails horizontaux.
  2. *Masquage persistant (`opacity-0`)* : l'image démarrait à `loaded = false` avec une classe `opacity-0`. Lorsque l'image était déjà en cache mémoire, l'événement natif `onLoad` ne se re-déclenchait pas systématiquement au montage React, maintenant l'icône totalement invisible et le conteneur en pulsation grise perpétuelle (`animate-pulse`).
  3. *Absence de `referrerPolicy="no-referrer"` et `crossOrigin="anonymous"` dans `ChannelLogo.tsx`* : contrairement aux affiches de films/séries de l'accueil, `ChannelLogo` envoyait le Referer de l'application (`https://localhost/` ou `http://localhost:5178/`), provoquant le rejet 403 Forbidden des serveurs IPTV anti-hotlinking.
  4. *Absence de logo vectoriel de secours dans le Hero TV (`TvDiscoverHero.tsx`)* : lors de la sélection d'une chaîne dans les rangées de l'accueil, si la chaîne n'avait pas d'URL de logo valide ou si le serveur échouait, le Hero n'affichait rien (`data-has-image="false"`), alors que l'application intègre les logos vectoriels officiels de chaînes (`PlatformLogo` : TF1, France TV, M6, Canal+, beIN, etc.).
  5. *Indexation partielle dans `ContinuePanel.tsx`* : `channelById` ne scannait que `playlist.groups`. Si `playlist.groups` était vide ou incomplet alors que `playlist.channels` contenait les chaînes, la recherche de chaîne pour les favoris ou l'historique échouait. De plus, `altVariant` dans `xtreamLive.ts` omettait l'attribut `logo` de la chaîne principale.
- **Périmètre complet implémenté dans 1.12.58** :
  1. **Déblocage immédiat du rendu dans `ChannelLogo.tsx`** :
     - Retrait du `loading="lazy"` bloquant pour les conteneurs horizontaux de l'accueil et chargement direct.
     - Détection synchrone de l'état `complete` (`imgRef.current?.complete && imgRef.current?.naturalWidth > 0`) pour afficher immédiatement les logos déjà en cache mémoire sans attendre d'événement différé.
     - Ajout de `referrerPolicy="no-referrer"` et `crossOrigin="anonymous"` pour immuniser le chargement contre les rejets 403 Forbidden des serveurs IPTV distants.
     - Réinitialisation propre de `imageError` au changement de `src`.
  2. **Intégration du logo vectoriel dans le Hero TV (`TvDiscoverHero.tsx`)** :
     - Prise en charge de `channelName` et repli automatique vers `PlatformLogo` (TF1, M6, France 2/3/4/5, Canal+, beIN SPORTS, Eurosport, etc.) lorsqu'une chaîne est sélectionnée mais ne possède pas de logo distant ou que son URL échoue.
     - Conservation de l'état sans illustration (`data-has-image="false"`) pour les titres et chaînes non catalogués.
  3. **Indexation exhaustive et propagation des logos (`ContinuePanel.tsx`, `xtreamLive.ts`)** :
     - `channelById` indexe désormais prioritairement `playlist.channels` avant de compléter avec `playlist.groups`, garantissant la résolution de chaque chaîne et de ses métadonnées/logos sur l'accueil.
     - `peekProps` transmet `channelName` pour garantir l'identification de la chaîne même lorsque le titre affiché est celui de l'émission EPG en cours.
     - `buildLiveChannel` dans `xtreamLive.ts` propage le `logo` sur la variante alternative `altVariant`.
- **Vérifications et preuves** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : `eslint ./src` (sans `--quiet`) : **0 erreur / 18 avertissements** (benchmark historique respecté).
  - Tests unitaires Web : **1087/1087 passés sur 143 fichiers** (+2 nouveaux tests de régression dans `channelLogo.test.tsx` et `tvDiscoverHero.test.tsx`).
  - Tests unitaires Android : **75/75 tâches Gradle passées** (`./gradlew testReleaseUnitTest` BUILD SUCCESSFUL en 26 s).
  - Build Vite : minifié, sans maps sources dans `dist/` (10,41 s).
  - Capacitor : `pnpm exec cap sync android` exécuté avec succès (0,695 s).
  - Compilation Release Gradle : `./gradlew assembleRelease` **BUILD SUCCESSFUL** en 1m 53s.
- **Livraison** : **1.12.58 / code 106**, APK `CedPlay-1.12.58.apk` et copie `CedPlay.apk` à la racine du dépôt (4 468 003 octets, SHA-256 `5b732904585a873bf042c1322dfcd7e46b4a0d78dfe83f97817d45f0da134b77`). Ancien APK 1.12.57 nettoyé.

## Consolidation complète & livraison : Validation sélection catégories & Déblocage navigation réglages / volume — 11 novembre 2026 (version 1.12.55 / code 103)

- **Contexte & Retours de Céd** :
  1. *Scanner de chaînes* : impossibilité de valider la sélection des catégories pour lancer le contrôle des flux non fonctionnels (bouton absent dans le sélecteur, traversée fastidieuse de dizaines de catégories au D-pad).
  2. *Réglages TV* : la navigation démarrait tout en bas de la boîte de dialogue, et une fois sur le réglage du volume, l'utilisateur était pris au piège (ArrowUp/ArrowDown capturés par le curseur natif au lieu de sortir du réglage).
- **Périmètre complet implémenté dans 1.12.55** :
  1. **Validation directe dans le sélecteur de catégories (`ChannelHealthDialog.tsx`)** :
     - Bouton d'action direct et bien en vue `Vérifier cette sélection (N)` placé directement dans le pied du panneau de catégories, avec rappel en temps réel du nombre de catégories et chaînes sélectionnées.
     - Touche `Entrée` supportée dans le champ de filtre des catégories pour sélectionner immédiatement ou lancer la vérification de la sélection courante.
     - Prise en charge explicite de `tvMode` avec focus automatique dès l'ouverture sur le sélecteur sans défilement parasite (`scrollTop = 0`).
     - Bouton inférieur unifié pour toujours offrir une action principale évidente quel que soit l'historique de scan.
  2. **Déblocage du curseur de volume et navigation naturelle de haut en bas (`useRemoteNavigation.ts`, `SettingsPanel.tsx`)** :
     - Dans `useRemoteNavigation.ts`, les curseurs horizontaux (`input[type="range"]`, `[role="slider"]`) conservent `ArrowLeft`/`ArrowRight` pour ajuster la valeur, mais libèrent impérativement `ArrowUp` et `ArrowDown` pour naviguer vers le réglage précédent ou suivant (`remoteNeighbor`). L'utilisateur n'est plus jamais piégé sur le volume.
     - Dans `SettingsPanel.tsx`, ouverture auto-focusée en haut du dialogue (`scrollTop = 0`), point d'entrée `data-remote-start` sur la première option de lecture (`autoplay`), et mise en valeur visuelle immédiate des rangées (`focus-visible:ring-2 focus-visible:ring-primary`). La navigation se fait naturellement et immédiatement de haut en bas.
     - Sécurisation de `remoteTargets` dans `remoteNavigation.ts` pour tolérer les rects nuls ou partiels sans lever d'exception.
- **Vérifications et preuves** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : **0 erreur / 18 avertissements** (benchmark historique respecté).
  - Tests unitaires ciblés : **52/52 passés sur 5 fichiers** (`channelHealthDialog`, `settingsPanelDiagnostics`, `remoteNavigation`, `streamCheck`, `tvPairing`).
  - Build Vite : minifié, sans maps sources dans `dist/` (8,42 s).
  - Capacitor : `pnpm exec cap sync android` exécuté avec succès.
  - Compilation Release : `./gradlew assembleRelease` **BUILD SUCCESSFUL** en 2m 14s.
- **Livraison** : **1.12.55 / code 103**, APK `CedPlay-1.12.55.apk` et copie `CedPlay.apk` à la racine du dépôt (4 466 575 octets, SHA-256 `a2ad6102f134bc4b26d3b8b6817ee4677cc7007dc2cbfb2d7c7f691f3cc8f53b`). Ancien APK 1.12.54 nettoyé.

## Consolidation complète & livraison : Accueil TV guidé, Appairage QR code, Horloge TV et accès USB/SD — 11 novembre 2026 (version 1.12.54 / code 102)

- **Contexte** : Reprise et finalisation suite à la session ChatGPT ayant intégré les corrections TV de Claude (bloquée sur `spawn EPERM` d'esbuild sans exécution des tests ni production d'APK).
- **Périmètre complet consolidé dans 1.12.54** :
  1. **Accueil TV guidé (`TvStarter.tsx`) et horloge commune (`TvClock.tsx`)** :
     - Écran d'accueil TV vide guidé avec tuiles « Direct », « Connexion » et « Podcasts » (`Par où commencer ?`).
     - Horloge commune intégrée dans l'en-tête en mode TV.
  2. **Connexion & accès USB/SD depuis Films et Séries (`MoviesPanel.tsx`, `VodLibrary.tsx`)** :
     - Message factuel sur l'absence de catalogue si aucun compte Xtream n'est associé à la liste.
     - Actions directes « Connecter un abonnement » et « Lire une clé USB ou une carte SD » accessibles directement depuis Films et depuis Séries.
     - La demande USB depuis Séries est consommée pour ne pas forcer les ouvertures suivantes dans Films.
  3. **Détection Xtream robuste (`xtreamCatalog.ts`)** :
     - Règle de majorité stricte (`matched * 2 > playlist.channels.length`) pour les comptes Xtream inférés depuis les flux, évitant les faux positifs sur listes publiques mixtes.
     - Comptes enregistrés explicitement prioritaires.
  4. **Appairage TV par QR code (`TvPairingCard.tsx`, `tvPairing.ts`, `PairingServer.java`)** :
     - Serveur HTTP local embarqué sur Android (`PairingServer`) avec QR code généré localement pour saisir facilement les identifiants Xtream depuis un smartphone.
     - Résilience sur `acknowledgePairing` (appel optionnel protégé et mock complet de test).
- **Vérifications et preuves** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : **0 erreur / 18 avertissements** (benchmark historique respecté).
  - Tests unitaires Web : **1067/1067 passés sur 142 fichiers** (`corepack pnpm verify` : 100% verts).
  - Tests unitaires Android : **75/75 tâches Gradle passées** (`./gradlew testReleaseUnitTest` : BUILD SUCCESSFUL en 5 s).
  - Build Vite : minifié, sans maps sources dans `dist/` (10,34 s).
  - Capacitor : `pnpm exec cap sync android` exécuté avec succès.
  - Compilation Release : `./gradlew assembleRelease` **BUILD SUCCESSFUL** (APK `CedPlay-1.12.54.apk` de 4 465 277 octets, SHA-256 `8b43ba16dcc24682bbf17b57c701659c6dae56fe741f81027f260f35d025262c`).
- **Livraison** : **1.12.54 / code 102**, APK `CedPlay-1.12.54.apk` et copie `CedPlay.apk` à la racine du dépôt. Ancien APK 1.12.53 nettoyé.

## Consolidation complète & livraison : Refonte & optimisation du tri des chaînes (santé des flux) — 11 novembre 2026 (version 1.12.53 / code 101)

- **Contexte & Objectifs** : Refonte complète de la vérification de santé des flux (`ChannelHealthDialog.tsx` et `streamCheck.ts`) pour répondre aux contraintes des très grandes playlists (~22 000 chaînes) sans bloquer ni saturer les connexions du fournisseur IPTV.
- **Périmètre complet implémenté dans 1.12.53** :
  1. **Sélection par catégories avec recherche et compteurs** : choix fin des groupes à vérifier, recherche textuelle instantanée, boutons rapides « Tout cocher » et « Tout décocher », compteurs de chaînes par groupe et total ciblées. Support également de « Mes favoris » et « Toute la liste ».
  2. **Persistance IndexedDB incrémentale par lot** : sauvegarde immédiate après chaque lot (`saveChannelHealth` sous `channelHealth:${playlistId}`). Les résultats partiels sont conservés en cas d'arrêt, de fermeture ou d'extinction de l'appareil.
  3. **Reprise de scan intelligente** : bouton principal « Vérifier les non testées (N) » ne testant que les flux sans résultat valide. Invalidation automatique si l'URL d'une chaîne change dans la liste.
  4. **Retest ciblé des échecs** : bouton « Retester les échecs (N) » pour vérifier si une panne était temporaire, plus bouton « Retester » individuel par chaîne dans la liste des échecs.
  5. **Régulation de concurrence par serveur (hôte)** : limitation à 2 requêtes simultanées maximum par nom de domaine (`maxPerHost = 2`) pour éviter les bannissements / blocages IP / 429 imposés par les fournisseurs IPTV sur les comptes limités à 1 ou 2 connexions.
  6. **Choix de la playlist dans le dialogue** : sélecteur déroulant si plusieurs listes sont configurées, avec scan et masquage strictement rattachés à la liste choisie.
  7. **Vocabulaire honnête & actions réversibles** : mention claire que le test vérifie la disponibilité réseau/serveur sans garantir le décodage vidéo/son ; états « Répond », « Échec de vérification », « Non vérifiée » ; masquage réversible et bouton « Effacer l'historique ».
- **Vérifications et preuves** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : **0 erreur / 18 avertissements** (benchmark historique respecté).
  - Tests unitaires Web : **1060/1060 passés sur 141 fichiers** (`corepack pnpm verify` : +19 tests unitaires et de régression).
  - Tests unitaires Android : **75/75 tâches Gradle passées** (`./gradlew testReleaseUnitTest`).
  - Build Vite : minifié, sans maps sources dans `dist/` (9,45 s).
  - Capacitor : `pnpm exec cap sync android` exécuté avec succès.
  - Compilation Release : `./gradlew assembleRelease` **BUILD SUCCESSFUL** (APK `CedPlay-1.12.53.apk` de 4 451 536 octets, SHA-256 `a117733e03b3d0c3aec0736ad89810d6aead4c8b7fe27692a784f545d63ee0c9`).
- **Livraison** : **1.12.53 / code 101**, APK `CedPlay-1.12.53.apk` et copie `CedPlay.apk` à la racine du dépôt. Ancien APK 1.12.52 nettoyé.

## 12 novembre 2026 — Intégration ciblée des corrections TV de Claude (sources non livrées)

- Reprise des changements fonctionnels de 04d687f et 7479b2f dans le dossier principal, sans fusionner leurs instantanés de base ni écraser le WIP 1.12.52 (scanner, recherche, hiérarchie vidéo/podcasts).
- Détection Xtream : majorité stricte pour les comptes inférés ; comptes enregistrés prioritaires. Tests ajoutés pour minorité, moitié/moitié, majorité et compte explicite.
- Accueil TV vide : tuiles Direct, connexion et podcasts ; favoris attendus avec l’historique. Horloge commune dans l’en-tête.
- Films et Séries sans compte : message factuel sur l’absence de catalogue associé. Connexion et USB/SD accessibles depuis les deux rubriques ; la demande USB depuis Séries est consommée pour ne pas forcer les visites suivantes dans Films.
- Tests de régression ajoutés/adaptés pour l’accueil et le parcours Séries → USB/SD → Catalogue.
- Vérification : tsc app/node réussis, ESLint 0 erreur / 18 avertissements. pnpm verify bloqué au démarrage de Vitest par esbuild spawn EPERM : aucun test exécuté, build non atteint. Pas de validation navigateur ou appareil, pas de nouvel APK. L’APK 1.12.52 existant ne contient pas ces changements.
- Fiche Second Cerveau et entretien non modifiés : emplacement hors des racines autorisées en écriture de cette session.

# CedPlay — lecteur personnel, reprise du 3 novembre 2026

## Consolidation complète & livraison : Séparation stricte vidéo / podcasts & accueil Découvrir — 11 novembre 2026 (version 1.12.52 / code 100)

- **Contexte** : Reprise et finalisation suite à la session ChatGPT ayant apporté la séparation stricte vidéo / podcasts dans l'accueil Découvrir, restée bloquée sur `spawn EPERM` à l'exécution de Vitest sans build ni APK.
- **Périmètre complet consolidé dans 1.12.52** :
  1. **Séparation vidéo / audio dans « Tout »** : « Reprendre » contient exclusivement les films et séries commencés. Les épisodes de podcast n'y sont plus mêlés.
  2. **Rangée dédiée aux podcasts** : une rangée distincte « Reprendre les podcasts » apparaît après « Pour toi » et « Ma liste », avant les autres rangées audio.
  3. **Filtrage par abonnements actifs** : sur « Tout », la reprise audio est strictement réservée aux podcasts actuellement suivis (`subscribed`). Sans abonnement actif, aucun média audio ne s'affiche sur la page d'accueil.
  4. **Conservation de l'historique d'écoute** : les épisodes commencés restent intégralement mémorisés et accessibles dans le filtre « Podcasts », même en cas de désabonnement.
- **Vérifications et preuves** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : **0 erreur / 18 avertissements** (benchmark historique respecté).
  - Tests unitaires Web : **1041/1041 passés sur 141 fichiers** (`corepack pnpm verify`).
  - Tests unitaires Android : **75/75 tâches Gradle passées** (`./gradlew testReleaseUnitTest`).
  - Build Vite : minifié, sans maps sources dans `dist/` (12,30 s).
  - Capacitor : `pnpm exec cap sync android` exécuté avec succès.
  - Compilation Release : `./gradlew assembleRelease` **BUILD SUCCESSFUL** (APK `CedPlay-1.12.52.apk` de 4 447 034 octets, SHA-256 `496d0662fb86e1f0db4e7e83595f90c94848bf902ad8cb8923b1c6aa2695488e`).
- **Livraison** : **1.12.52 / code 100**, APK `CedPlay-1.12.52.apk` et alias `CedPlay.apk` à la racine du dépôt. Ancien APK 1.12.51 nettoyé.


## Consolidation complète & livraison : Recherche TV, retour direct, veille TV et hiérarchie Découvrir — 11 novembre 2026 (version 1.12.51 / code 99)

- **Contexte** : Reprise et finalisation suite à la session ChatGPT ayant apporté les ajustements fins de recherche et navigation TV (`data-remote-self`, conservation de `searchResumeQuery` après sélection chaîne, gestionnaires D-pad locaux priorisés), qui était restée bloquée sur `spawn EPERM` sans exécution des tests ni production d'APK.
- **Périmètre complet consolidé dans 1.12.51** :
  1. **Recherche unifiée & retour** : sélection d'une chaîne ou d'un élément VOD depuis la recherche préserve la requête active ; au retour (fermeture fiche VOD, lecteur natif ou web), la boîte de dialogue se réouvre avec les résultats intacts. Une nouvelle recherche explicite repart à vide.
  2. **Navigation TV dans le dialogue de recherche** : `data-remote-self` assure que les gestionnaires locaux Haut/Bas agissent avant la navigation géométrique globale. Flèche bas depuis le champ cible directement la recherche récente la plus fraîche (`recent[0]`) ou le premier résultat ; en mode TV, la croix de suppression individuelle est exclue du focus télécommande (`tabIndex={-1}`, `pointer-events-none`).
  3. **Reprise après veille TV** : `NativePlayerActivity` gère les coupures réseau lors de la mise en veille/réveil TV (détection des erreurs transitoires d'E/S et de connectivité, surveillance `ConnectivityManager` active en direct comme en VOD, reprise différée propre dès rétablissement Wi-Fi/Ethernet).
  4. **Hiérarchie de l'accueil Découvrir** : ordre strict sur « Tout » : Direct (`recent-channels`, `live-now`) -> Vidéo (`resume`, `for-you`, `my-list`) -> Podcasts (`new-episodes`, `to-listen`). Sans abonnement podcast, aucune rangée podcast parasite n'apparaît.
- **Vérifications et preuves** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : **0 erreur / 18 avertissements** (inchangé sur le code historique, avertissement `useCallback` résolu).
  - Tests unitaires Web : **1039/1039 passés sur 141 fichiers** (dont les 3 tests de régression de recherche et navigation D-pad).
  - Tests unitaires Android : **75/75 tâches Gradle passées** (`./gradlew testReleaseUnitTest`).
  - Build Vite : minifié, sans maps sources dans `dist/` (7,88 s).
  - Capacitor : `pnpm exec cap sync android` exécuté avec succès.
  - Compilation Release : `./gradlew assembleRelease` **BUILD SUCCESSFUL** (APK `CedPlay-1.12.51.apk` de 4 446 887 octets, SHA-256 `d022af00d78accfd87a145dacdefa7ce3bd3e832c80e996fe7e9d109add43f2c`).
- **Livraison** : **1.12.51 / code 99**, APK `CedPlay-1.12.51.apk` et copie `CedPlay.apk` à la racine du dépôt. Ancien APK 1.12.50 nettoyé.


## Hiérarchie de l'accueil Découvrir : Chaînes récentes d'abord, films & séries ensuite, podcasts en fin — 11 novembre 2026 (version 1.12.50 / code 98)

- **Demande de Céd** : « ce n est pas ce que j ai dit, j ai dit que les podcasts sont le premier qu on voit sur l accueil mais ce srait mieux de voir les chaines recentes, puis les films et series, avant les podcasts je pense »
- **Causes racines** :
  1. `orderRows()` imposait la rangée `resume` (« Reprendre ») tout en haut de l'écran avant toute famille de contenu, et `resumeItems()` y mélangeait les épisodes de podcast par date de mise à jour. Dès lors, le premier élément affiché sous l'en-tête était un épisode de podcast commencé.
  2. `orderRows()` effectuait un entrelacement (round-robin) par rangée entre chaque famille (`present[0]`), ce qui reléguait la rangée `recent-channels` (« Chaînes récentes ») après la rangée de podcast `to-listen` / `new-episodes`, et `my-list` après les podcasts.
  3. `ContinuePanel.tsx` activait `showSelection = feeds.length === 0` sans vérifier le filtre actif : la « Sélection CedPlay » (10 podcasts par défaut) s'imposait donc sur l'accueil `Tout` même pour un utilisateur n'ayant jamais écouté ou suivi de podcast.
- **Correctifs apportés** :
  - **Ordre strict des rangées dans `Tout`** (`src/utils/discover.ts`) :
    1. **Direct** : `recent-channels` (« Chaînes récentes ») puis `live-now` (« Mes chaînes en ce moment »).
    2. **Vidéo** : `resume` (« Reprendre » films & séries), `for-you` (« Pour toi »), `my-list` (« Ma liste »).
    3. **Podcasts** : `new-episodes` (« Nouveaux épisodes »), `to-listen` (« À écouter »).
    Les familles restent groupées sans entrelacement et les podcasts sont toujours relégués en fin de page.
  - **Priorité vidéo dans `Reprendre`** (`resumeItems`) :
    Dans l'accueil `Tout`, les films et séries commencés apparaissent systématiquement avant les épisodes de podcast (les podcasts en cours ne peuvent plus supplanter un film ou une série).
  - **Suggestions par défaut isolées** (`ContinuePanel.tsx`) :
    `showSelection = feeds.length === 0 && filter === 'podcasts'`. La sélection par défaut de 10 podcasts ne s'affiche plus sur l'accueil `Tout` mais uniquement si l'utilisateur filtre explicitement sur « Podcasts ». Si l'utilisateur n'a pas d'abonnements podcast, l'accueil ne contient aucune rangée podcast parasite.
  - **Navigation D-pad et état vide** (`ContinuePanel.tsx`) :
    Suppression du contournement `onlyEmptySelection` ; affichage propre de l'état d'accueil quand aucune reprise ni chaîne n'est enregistrée.
- **Vérifié en local** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : **0 erreur / 18 avertissements** (inchangé sur le code historique).
  - Tests unitaires Web : **1039/1039 passés sur 141 fichiers** (`corepack pnpm test`).
  - Tests unitaires Android : **75/75 tâches Gradle passées** (`./gradlew testReleaseUnitTest`).
  - Build Vite : minifié, sans maps sources dans `dist/` (7,78 s).
  - Compilation Release : `./gradlew assembleRelease` **BUILD SUCCESSFUL** (APK `CedPlay-1.12.50.apk` de 4 446 916 octets, SHA-256 `0a39cf4e070e8f8db5d2e81172d04ecb8e4ad7bcd5ad4d267968c9da82a22834`).
- **Livraison** : **1.12.50 / code 98**, APK `CedPlay-1.12.50.apk` et copie `CedPlay.apk` à la racine du dépôt. Ancien APK `CedPlay-1.12.49.apk` nettoyé.
- **Limites** : vérifié par l'ensemble des suites de tests automatisés (Web + Android) et le build release ; à valider visuellement sur l'écran d'accueil TV de Céd.

## 11 novembre 2026 — Contre-revue et corrections de la recherche 1.12.49 (sources seulement)

- Demande : corriger les deux défauts identifiés dans le travail d'AG.
- `IPTVPlayer.tsx` : la fermeture du dialogue après sélection d'une chaîne conserve désormais `searchResumeQuery` et ne rétablit pas l'ancien onglet pendant l'ouverture du lecteur. La requête est consommée au retour du lecteur ; une nouvelle recherche explicite repart à vide.
- `GlobalSearchDialog.tsx` : `data-remote-self` laisse les gestionnaires locaux Haut/Bas agir avant la navigation géométrique globale. Les autres flèches restent traitées par celle-ci en phase de remontée.
- `openSavedVod` stabilisé avec `useCallback` : suppression de l'avertissement ESLint introduit dans le lot AG (19 -> 18).
- Trois tests de régression ajoutés : recherche -> chaîne -> retour aux résultats -> fermeture/réouverture ; historique avec navigation globale active (Bas, Droite, Haut) ; résultats avec navigation globale active (Bas, Haut). La géométrie simulée place volontairement l'ancienne recherche sous le champ pour détecter le défaut de priorité.
- Validation exécutée : `corepack pnpm verify` passe les deux contrôles TypeScript et ESLint intégral (0 erreur / 18 avertissements). Vitest ne démarre pas : `spawn EPERM` dans le lancement d'esbuild. Les nouveaux tests ne sont donc pas annoncés verts ; l'étape build n'a pas été atteinte. `git diff --check` vérifié séparément.
- Aucun nouvel APK, aucune installation ni recette physique ; les APK 1.12.49/code 97 présents restent ceux d'AG et ne contiennent pas ces corrections. Ne pas annoncer de livraison avant la vérification complète puis reconstruction Android.
- Suivi Second Cerveau non modifié : sa fiche et l'entretien global sont hors des emplacements autorisés en écriture dans cette session. À reporter dans `Où j'en suis` et `Pour reprendre` : corrections source présentes, tests/build et recette TV à terminer ; puis lancer actualiser/verifier/sonder dans un environnement autorisé.


## Navigation retour recherche, focus/croix historique et reprise robuste après veille TV — 11 novembre 2026 (version 1.12.49 / code 97)

- **Demande de Céd** :
  1. « Le premier, c'est quand je fais une recherche, j'ai une liste de résultats. Je clique sur le premier résultat, tout va bien, mais quand je fais retour, je ne reviens pas sur la liste de résultats et ça c'est problématique. »
  2. « Deuxième problème, c'est que ensuite, quand je reviens dans la partie recherche, c'est très bien parce qu'on a l'historique des recherches précédentes. Le problème, c'est qu'on arrive, si on fait la flèche pour descendre, on arrive d'abord sur l'onglet le plus vieux de recherche et en plus on arrive sur la croix pour fermer. Donc souvent quand on va vite, on se retrouve sur la mauvaise recherche alors qu'on voudrait la recherche la plus récente et en plus on élimine cette recherche parce qu'on arrive directement sur la croix. »
  3. « Autre problème aussi, quand j'arrête d'utiliser l'application, en général j'éteins ma télé et quand je la rallume, impossible de reprendre. Je dois sortir et rerentrer plusieurs fois sur l'application et je me demande même si je ne dois pas vider le cache et la mémoire. »
- **Causes racines** :
  1. `IPTVPlayer.tsx` fermait `searchOpen` et réinitialisait la recherche dès la sélection d'un item ; lors du retour (clôture fiche VOD, fermeture lecteur natif ou clic retour web), aucun état de reprise n'était mémorisé.
  2. `GlobalSearchDialog.tsx` n'avait aucun gestionnaire D-pad `onKeyDown` sur l'input (la navigation spatiale choisissait le chip le plus proche du centre) et la croix de fermeture était un `<button>` focusable prenant le focus en premier avant le libellé, validable par OK.
  3. En veille TV (HDMI-CEC / extinction), la box coupe le Wi-Fi/Ethernet. Au réveil (`onResume`), `NativePlayerActivity` tentait une initialisation immédiate alors que le réseau met 3 à 8 s à remonter. L'erreur `PlaybackException` (DNS `UnknownHostException`, timeout socket, etc.) n'était pas reconnue par `isTransientError()`, classant l'erreur en "permanente", annulant `liveReconnect` et affichant l'écran d'erreur. De plus, `canRecoverLive()` refusait la reprise si `player == null`, la VOD était exclue du `ConnectivityManager.NetworkCallback`, et `LivePreview` détruisait `requestUrl` sur erreur.
- **Correctifs apportés** :
  - **Recherche & Retour** : `IPTVPlayer.tsx` mémorise la requête active dans `searchResumeQuery.current`. Dès la fermeture d'une fiche VOD (`onCloseDetails`), la fermeture du lecteur natif ou le retour du lecteur web, la boîte de dialogue se réouvre automatiquement avec la requête et les résultats préservés via `initialQuery`.
  - **Historique & D-pad** : Dans `GlobalSearchDialog.tsx`, la touche `ArrowDown` depuis le champ de recherche descend directement sur le premier résultat ou sur la recherche récente la plus fraîche (`data-recent-search-first` sur `recent[0]`), et `ArrowUp` remonte au champ. En mode TV (`tvMode`), le bouton de suppression individuelle de l'historique est exclu de la navigation télécommande (`tabIndex={-1}` et `pointer-events-none`) pour écarter tout risque de suppression accidentelle.
  - **Reprise après veille TV** :
    - `NativePlayerActivity.java` : extension de `isTransientError()` à `ERROR_CODE_IO_UNSPECIFIED`, `ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED` et à la chaîne d'exceptions réseau (`UnknownHostException`, `ConnectException`, `SocketException`, `SocketTimeoutException`, `NoRouteToHostException`, `SSLException`, `HttpDataSourceException`).
    - `canRecoverLive()` : autorise la récupération si `player == null || player.getPlayWhenReady()`.
    - `startConnectivityMonitoring()` : surveillance réseau activée également en VOD.
    - `postConnectivityChanged()` : déclenche immédiatement la reprise (`initPlayer` / `prepareMedia`) dès la reconnexion réseau (`connected == true`) si le lecteur était en attente ou en erreur.
    - `onResume()` : si le réseau n'est pas encore prêt, affiche la jauge de chargement et temporise la tentative en laissant le rappel de connectivité relancer le flux à chaud dès que le Wi-Fi est opérationnel.
    - `LivePreview.java` : préserve `requestUrl` en cas d'erreur de lecture pour permettre à `resume()` de relancer l'aperçu à la reprise.
    - `TvLiveScreen.tsx` : écoute `online` et `visibilitychange` et tente une relance différée automatique en cas d'erreur transitoire.
- **Vérifié en local** :
  - `tsc -p tsconfig.app.json` et `tsc -p tsconfig.node.json` : **0 erreur**.
  - ESLint : **0 erreur / 19 avertissements** (inchangé sur le code historique).
  - Tests unitaires Web : **1036/1036 passés sur 141 fichiers** (`corepack pnpm test`).
  - Tests unitaires Android : **75/75 tâches Gradle passées** (`./gradlew testReleaseUnitTest`).
  - Build Vite : minifié, sans maps sources dans `dist/` (8,21 s).
  - Compilation Release : `./gradlew assembleRelease` **BUILD SUCCESSFUL** (APK `CedPlay-1.12.49.apk` de 4 446 875 octets, SHA-256 `ac83d09eac6b03c3856f74f92cf0a406b13204cc0ed0fbfaab7592dd741adacf`).
- **Livraison** : **1.12.49 / code 97**, APK `CedPlay-1.12.49.apk` et copie `CedPlay.apk` déployées à la racine du dépôt. Ancien APK `CedPlay-1.12.48.apk` nettoyé.
- **Limites** : vérification complète prouvée sur l'ensemble des suites de tests automatisés (Web + Android) et compilation release locale ; à valider sur flux réel par Céd avec sa télécommande et sa box TV.




## Télécommande TV figée : l'écran Direct rendait 18 900 chaînes d'un coup — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande de Céd** : « je ne peux plus descendre dans ma liste de films et series sur la tv avec la telecommande, probleme deja mentionne et resolu avant ».
- **Reproduction sur la box** (1.12.34/code 82) : l'écran Direct restait un panneau vide (le fallback `Suspense`), la télécommande ne répondait plus (flèches et Retour ignorés) et le processus tournait à **144-178 % CPU**, renderer WebView à 94 % pendant plusieurs minutes. Force-stop et relance : Direct vide de nouveau. Films et Séries seuls fonctionnaient.
- **Cause racine** (instrumentation de la WebView en APK debug + CDP `Debugger.pause`/`Profiler`) : `TvLiveScreen` rendait **18 900 lignes** au deuxième rendu. La hauteur de l'écran était `null` à la première peinture ; la rangée `auto` de `.tv-live` prenait donc la hauteur du contenu, la zone défilante mesurait **1 058 408 px** au lieu de ~400, et le virtualiseur (`@tanstack/react-virtual`) recevait cette hauteur comme fenêtre visible : il retournait *toutes* les chaînes, puis la mesure suivante rectifiait la hauteur — mais le rendu de 18 900 lignes bloquait déjà le thread JS, donc la WebView restait figée. Symptôme dérivé : l'app entière cessait de répondre, Films et Séries compris.
- **Correctif** :
  - `TvLiveScreen.tsx` et `TvVodScreen.tsx` : la hauteur est **estimée dès le premier rendu** depuis l'en-tête déjà monté (`[data-app-header]`, repli 96 px) ; le `useLayoutEffect` existant l'affine ensuite. Plus de première peinture sans hauteur.
  - `index.css` : `grid-template-rows: minmax(0, 1fr)` sur `.tv-live` et `.tv-vod`, pour que la rangée reste bornée à la hauteur de l'écran même si un enfant déborde.
  - Tests : deux cas « borne la hauteur dès le premier rendu » (`tvLiveScreen`, `vodTvScreen`), qui échouent avec `height=null`.
- **Vérifié en local** : tsc app+node 0 erreur ; ESLint **0 erreur / 18 avertissements** ; **1008/1008 Web sur 140 fichiers** ; `vite build` (minifié, sans `.map`) et `assembleRelease` OK.
- **Livraison** : **1.12.35/code 83**, APK `CedPlay-1.12.35.apk` (4 431 524 octets, SHA-256 `bd4b9b1ba2b7…`, certificat `f3f2371b…`), installée sur la **box** et le **Motorola** (`dumpsys` code 83 / 1.12.35 sur les deux) ; `CedPlay-1.12.34.apk` archivée dans `sauvegardes/apk-anterieures-2026-11-09/`.
- **Recette sur la box** (release 1.12.35) : Direct s'affiche (catégories, liste, aperçu) et la liste descend (`preuves/verif-1.12.35-box-direct.png`, `-direct-down.png`) ; Films descend jusqu'à 97/120 puis 120/120 et « Afficher davantage » (`-box-films-mid.png`, `-box-films-down.png`) ; Séries descend de 1/60 à 19/60 puis 60/60 (`-box-series-top-down.png`, `-box-series-down.png`). Avant correctif : panneau vide figé (`preuves/avant-1.12.35-direct-fige.png`).
- **Limites** : recette faite aux `input keyevent` adb (même chemin DOM qu'une télécommande), pas avec la vraie télécommande de Céd ; le signalement parlait de Films/Séries, mais le blocage venait de l'écran Direct qui figeait la WebView — à confirmer par Céd après usage. Rien commité. Prochaine libre **1.12.36/code 84**.

## « Depuis le début » dans le lecteur du direct : le programme en cours relu depuis son début — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande de Céd** : « imagine que je prends une émission live en cours, y a-t-il une fonctionnalité qui permettrait de regarder depuis le début en direct différé ? » puis « oui, go, mais de manière pertinente, pas un simple ajout à la suite des autres options ».
- **Existant** : le catch-up (`/timeshift/` Xtream, `tv_archive` / `catchup-source` M3U) n'était accessible que par le guide (« Depuis le début » dans la fiche programme) ou `Plus › Replay et plateformes`. Rien dans le lecteur.
- **Mise en œuvre** :
  - `catchup.ts` : `timeshiftTemplate()` (modèle `/timeshift/{minutes}/{start}/`, sans programme) ; `catchupUrl()` le remplit comme avant.
  - `nativePlayer.ts` : type `NativeCatchup` et fournisseur branché par l'écran (`setNativeCatchupProvider`) ; `buildNativeZap` joint une archive par chaîne de la fenêtre, alignée sur `urls` ; le plugin écrit ce bloc dans le fichier de zap (7e champ).
  - `IPTVPlayer.tsx` : le fournisseur lit l'index d'archives et l'abonnement ; Xtream envoie le **modèle** (adresse refaite par le lecteur à l'appui, donc jamais périmée), M3U envoie l'adresse déjà calculée, bornée à son programme.
  - `NativePlayerActivity.java` : nouveau mode `archive` (la chaîne ne change pas, `streamUrl` reste le direct pour le retour et la sortie) ; `restartLiveFromStart()` refait l'adresse à l'instant de l'appui, borne la progression au programme, coupe l'enregistrement ; « Revenir au direct » rebascule sur le direct ; fin d'archive = retour automatique au direct ; zap et sortie du lecteur quittent le différé.
  - **Place dans les menus** : sur TV, « Depuis le début » est la **première** commande de la rangée « Lecture », avec l'icône de reprise — il cède sa place à « Revenir au direct » une fois le différé lancé, dans le même emplacement. La rangée « Progression » n'apparaît qu'en VOD et en différé. Sur téléphone, pastille d'icône dans le bandeau, à la place de « Revenir au direct » (les deux ne s'affichent jamais ensemble). L'étiquette devient `● DIFFÉRÉ · n° · chaîne · catégorie`, la ligne du bas `En direct · <programme>`, et le retard chiffré reste au badge du coin (`DIFFÉRÉ −2:06:19`).
  - `Enregistrer` masqué en différé (on ne capture pas le direct qu'on vient de quitter) ; `Relancer le flux` aussi.
- **Vérifié en local** : tsc app+node 0 erreur, ESLint **0 erreur / 18 avertissements**, **1008/1008 Web sur 140 fichiers** (dont un test du modèle timeshift et un test d'alignement de l'archive dans le zap), `vite build` et `assembleRelease` OK. **Test réparé au passage** : `seriesRecording.test.ts` figeait une émission au 9 novembre 2026 à 10 h UTC et `recordingWindow` cale le départ sur l'horloge réelle — il tombait donc chaque jour après 10 h UTC ; l'horloge est désormais figée par `vi.spyOn(Date, 'now')`.
- **Livraison** : **1.12.34/code 82**, APK `CedPlay-1.12.34.apk` (4 431 409 octets, SHA-256 `d91603aa…`, certificat `f3f2371b…`), installée sur la **box** et le **Motorola** (`dumpsys` code 82 / 1.12.34 sur les deux) ; `CedPlay-1.12.33.apk` archivée dans `sauvegardes/apk-anterieures-2026-11-09/`.
- **Recette sur appareil (Motorola)** : `FR: TF1 HD`, programme `Bonjour ! La Matinale TF1` (23:55–03:00) — pastille de reprise visible au direct (`preuves/verif-1.12.34-phone-depuis-le-debut.png`), appui → `● DIFFÉRÉ · 3 · FR: TF1 HD · FR FRANCE`, `reste 3 h 05`, image revenue au début du programme (horloge du flux 06:56), badge `DIFFÉRÉ −2:20:43`, ligne `En direct · Bonjour ! La Matinale TF1` (`preuves/verif-1.12.34-phone-differe.png`) ; « Revenir au direct » → `● DIRECT`, `reste 44 min`, pastille de reprise revenue (`preuves/verif-1.12.34-phone-retour-direct.png`).
- **Limites** : chez ce fournisseur, l'archive est portée par les variantes **HD** (`FR: TF1 HD`, `FRANCE 2 HD`, …), pas par les FHD/4K — `catchup_ready channels=9` sur la fenêtre de 300 chaînes autour de TF1, `current=false` sur les variantes FHD. Au tout début d'un lancement, la reprise automatique de la dernière chaîne peut précéder le chargement de l'index d'archives (lecture de `get_live_streams`) : la pastille apparaît en rouvrant la chaîne. **La rangée TV n'a pas été parcourue sur la box** : la session parallèle utilisait la box en même temps (onglet qui changeait entre deux captures, `dist` reconstruit à sa façon à 02:08 — maps sources embarquées, corrigé en reconstruisant proprement avant la 1.12.34) ; à refaire au calme.
- **Piège de concurrence** : un `vite build` lancé par l'autre session a remplacé `dist` par une construction non minifiée avec `.map` (APK à 6,3 Mo). Toujours vérifier `dist/assets/*.map` et la taille de l'APK après `assembleRelease` ; un APK de ~6,3 Mo signale ce cas, la référence est ~4,43 Mo.
- **Versionnage** : commit `de4e7f9` sur `claude/decouvrir-v1` (toute la lignée 1.12.16 → 1.12.35, y compris le correctif de la télécommande TV et le différé, tests verts), puis **intégration par avance rapide** dans `consolidate/v1.11.4` (même commit, arbre identique). Le WIP antérieur de l'arbre principal est conservé sur la branche `sauvegarde/wip-arbre-principal-2026-11-09` (`fed8796`). Rien n'est poussé. Prochaine libre **1.12.36/code 84**.
- **APK de référence** : `CedPlay-1.12.35.apk` (+ copie `CedPlay.apk`) est désormais **à la racine du dépôt** (`C:\Users\C2k\Documents\ChatGPT\Lecteur IPTV`), comme le veut AGENTS.md ; elle y remplace la 1.12.14 (archivée dans `sauvegardes/apk-anterieures/`). Les livraisons précédentes ne laissaient l'APK que dans le worktree `.claude\worktrees\cedplay-discover-page-981ad3`, dossier masqué — Céd ne la trouvait pas. Toujours recopier l'APK livrée à la racine en fin de session.

## Enregistrer le ralenti d'un direct : bouton REC visible dans le lecteur du téléphone — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande de Céd** : « imagine, je regarde un match et il y a un but : je veux enregistrer le ralenti comment je fais sur le stream de la chaine meme ? » — il ne s'agissait pas de programmer un enregistrement depuis la liste (première interprétation, annulée), mais de capturer le direct en cours de lecture.
- **Constat** : dans le lecteur natif du téléphone, l'enregistrement n'existait que dans **Options → « Enregistrer le direct »** (deux gestes, panneau à refermer), alors que le lecteur TV a son entrée dans le bandeau. Le `Recorder` HLS repart déjà de **3 segments en arrière** (≈ 15-20 s) avant le direct : appuyé juste après l'action, le fichier contient le but et son ralenti. Un flux MPEG-TS, lui, démarre à l'appui.
- **Mise en œuvre** (`NativePlayerActivity.java`, nouveau `res/drawable/ic_player_record.xml`) :
  - pastille **« Enregistrer »** dans le bandeau du bas, au-dessus de « Retour aux chaînes / Parcourir », à portée de pouce, visible avec les commandes ; icône cercle-point ;
  - pendant la capture, la pastille devient **« Arrêter »** sur fond orange ; `updateRecButton()` met à jour libellé, description, style et visibilité ;
  - bouton limité au direct HTTP du téléphone (`!vod && isHttpUrl(streamUrl)`). La TV garde son entrée « Enregistrer » dans le bandeau ; un flux non HTTP n'affiche pas la pastille.
  - Le bouton « Enregistrer » ajouté par erreur sur chaque ligne de la liste (programmation DVR) a été **retiré** ; le correctif de largeur du dialogue d'enregistrement (`grid-cols-1` + `min-w-0` dans `Recordings.tsx`) est conservé : sans lui, le select des chaînes élargissait la grille au-delà du dialogue sur téléphone.
- **Vérifié en local** : tsc app+node 0 erreur, ESLint **0 erreur / 18 avertissements**, **1004/1004 Web sur 140 fichiers**, `vite build` et `assembleRelease` OK.
- **Livraison** : **1.12.33/code 81**, APK `CedPlay-1.12.33.apk` (4 428 473 octets, SHA-256 `3bcb39cb…`, certificat `f3f2371b…`), installée sur la **box** et le **Motorola** (`dumpsys` code 81 / 1.12.33 sur les deux) ; `CedPlay-1.12.32.apk` archivée dans `sauvegardes/apk-anterieures-2026-11-09/`.
- **Recette sur appareil** : Motorola, capture `preuves/verif-1.12.33-phone-recu.png` — pastille « Enregistrer » visible au-dessus de la navigation. Deux appuis ont créé `FR_TF_1_4K_UHD_1794209475325.ts` (67 282 004 octets) et `FR_TF_1_4K_UHD_1794209534037.ts` (132 271 536 octets) dans `/sdcard/Enregistrements` ; le premier, rapatrié puis passé à `ffprobe`, dure **31,997 s** (HEVC 3840×2160 + AAC, MPEG-TS) ; l'arrêt affiche « Enregistrement terminé : … » (capture `preuves/verif-1.12.33-phone-rec-actif.png`). L'état « Arrêter » pendant la capture n'a pas été figé à l'écran (les commandes se masquent vite) ; le libellé est mis à jour par `updateRecButton()` sur le rappel `onRecordStarted`.
- **Limites** : le premier enregistrement demande de choisir un dossier (sélecteur SAF) ; l'enregistreur ouvre une **seconde connexion** au flux, qu'un abonnement limité à une connexion peut couper (le direct a renvoyé un HTTP 406 pendant l'essai) ; le regard arrière de 3 segments n'existe que pour HLS ; rien commité ; prochaine libre **1.12.34/code 82**.

## Étiquette du lecteur : la catégorie remplace le doublon du nom — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande de Céd** (capture du Motorola) : « pourrait on avoir seulement la categorie de la chaine au lieu d un doublon avec le nom de la chaine (sur la premiere ligne) ». Dans le lecteur natif, la première ligne du bandeau affichait `● DIRECT · 5 FR: TF1 +1 FHD · FR FRANCE` et le grand titre juste en dessous répétait `FR: TF1 +1 FHD`.
- **Correctif** (`NativePlayerActivity.java`, `updateInfoBar`) : la ligne devient `● DIRECT · 5 · FR FRANCE`. Le nom de la chaîne n'y est conservé que lorsque le grand titre affiche le **programme** (guide présent) ; sans guide, le grand titre porte le nom, donc l'étiquette ne le répète plus. Le numéro et la catégorie restent. Même correctif appliqué dans l'arbre principal (`consolidate/v1.11.4`, non construit, version inchangée).
- **Vérifié en local** : tsc app+node 0 erreur, ESLint 0 erreur/18 avertissements, **1004/1004 Web sur 140 fichiers**, `vite build` et `assembleRelease` OK.
- **Livraison** : **1.12.32/code 80**, APK `CedPlay-1.12.32.apk` (4 427 219 octets, SHA-256 `36b8842e…`, certificat `f3f2371b…`), installée sur la **box** et le **Motorola** (`dumpsys` code 80 / 1.12.32 sur les deux) ; `CedPlay-1.12.31.apk` archivée dans `sauvegardes/apk-anterieures-2026-11-09/`.
- **Recette sur appareil** : Motorola, capture `preuves/verif-1.12.32-phone-bandeau.png` — `● DIRECT · 5 · FR FRANCE`, puis `FR: TF1 +1 FHD`, plus de doublon. Box, capture `preuves/verif-1.12.32-box-sans-guide.png` — chaîne 6 sans guide : `● DIRECT · 6 · FR FRANCE` puis `FR: TF1 +1 HD` ; avec guide (France 2, capture `preuves/verif-1.12.32-box-avec-guide.png`), l'étiquette garde le nom et le grand titre montre le programme.
- **Limites** : le bandeau de zap (`6 FR: TF1 +1 HD` / `FR FRANCE`) n'a pas été modifié — le nom n'y apparaît qu'une fois. Rien commité.

## Direct mobile : la ligne entière lance la lecture, nom et programme lisibles — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demandes de Céd** : « qui va vraiment utiliser les boutons sur la droite ? play en particulier ? j'ai l'impression qu'intuitivement on va appuyer sur la chaîne pour la voir. En fait, je regrette qu'on ne puisse pas mieux voir le nom de la chaîne écrit et le programme en cours » ; puis « beaucoup de place maintenant à gauche du logo de la chaîne » et « enlève les nombres avant les logos, je ne comprends pas leur logique ».
- **Constat** : sur Android, `handleChannelSelect` ouvre déjà le lecteur natif ExoPlayer — l'éclair « lecteur natif » et le bouton ▶ appelaient donc exactement la même chose que le tap sur la carte. Ces trois boutons (~100 px) vidaient la zone de texte : nom du fournisseur sur deux lignes, programme réduit à « Bonjour ! La M… ». Le numéro du fournisseur (TF1 = 4, France 2 = 8) n'a aucune logique lisible et laissait un grand vide entre le bord de la carte et le logo.
- **Mise en œuvre** (`components/ChannelList.tsx`, `hooks/useRemoteNavigation.ts`, tests) :
  - La carte est le bouton de lecture : un frère `button` en `absolute inset-0` porte `data-channel-play`, `aria-label="Lire <chaîne>"` et l'action. Il est posé **à côté** du cœur, pas autour : le cœur reste un vrai bouton séparé (pas de bouton imbriqué), posé en `relative z-10` au-dessus. Tap sur la ligne, Entrée ou Espace lancent la lecture.
  - Boutons de droite réduits au **cœur** (favori) : seule action que le tap sur la ligne ne fait pas. Éclair et ▶ retirés de la ligne (ils restent dans le menu contextuel).
  - Nom sur toute la largeur disponible ; programme en `text-[13px] text-neutral-300` sur sa propre ligne ; horaire + progression + catégorie sur la ligne suivante (`flex-wrap`, la catégorie passe à la ligne si la place manque) ; « À suivre : … à … » remplace « Next: … at … ».
  - Numéros de chaîne du fournisseur retirés devant le logo. Le numéro de favori reste dans l'onglet Favoris : c'est le raccourci de zap, dans l'ordre de la liste.
  - Télécommande/clavier : Haut/Bas depuis la carte ou le cœur reste au gestionnaire indexé de la liste (virtualisation : `pendingFocus` action -1 = la carte, `requestedRow`) ; `useRemoteNavigation` laisse passer Haut/Bas dans `[data-channel-id]` pour ne pas perdre la ligne suivante hors fenêtre.
- **Vérifié en local** : tsc app+node 0 erreur, ESLint **0 erreur / 18 avertissements**, **1004/1004 Web sur 140 fichiers** (dont 3 nouveaux tests : ligne entière jouable sans play/zap, cœur qui suit d'une chaîne à l'autre, numéro du fournisseur absent), `vite build` et `assembleRelease` OK.
- **Livraison** : **1.12.31/code 79**, APK `CedPlay-1.12.31.apk` (4 427 332 octets, SHA-256 `a40bf548…`, certificat `f3f2371b…`), installée sur la **box** et le **Motorola** (`dumpsys` code 79 / 1.12.31 sur les deux).
- **Recette sur appareil** : Motorola, capture `preuves/livraison-1.12.31-direct.png` — plus de numéro devant le logo, `FR: TF 1 4K UHD` et `Bonjour ! La Matinale TF1` entiers, horaire + progression + `FR FRANCE` sur une ligne, cœur seul à droite. Le tap sur une ligne a ouvert ExoPlayer et le cœur s'ajoute puis se retire sans lancer la lecture : exercé en **1.12.30** (captures `preuves/verif-1.12.30-tap-ligne-lecture.png`, `verif-1.12.30-coeur.png`, `verif-1.12.30-coeur-retire.png`) ; depuis, seule la colonne de numéro a été retirée, le bouton de ligne et le cœur sont inchangés. Box : l'écran Direct TV fonctionne (capture `preuves/livraison-1.12.31-box-direct.png`) ; sa liste garde ses numéros (raccourci de zap de la télécommande, non modifié).
- **Concurrence dans le même arbre** : la session parallèle a livré **1.12.30/code 78** (noms et catégories lisibles, grille mobile) en construisant l'arbre à 00:49, qui contenait déjà la carte jouable de ce lot ; sa section ci-dessous documente cette livraison. La 1.12.31 reprend ce lot tel quel, archive `CedPlay-1.12.30.apk` dans `sauvegardes/apk-anterieures-2026-11-09/` et devient la référence. Prochaine libre après la 1.12.32 (section ci-dessus) : **1.12.33/code 81**.
- **Limites** : la liste TV (`TvLiveScreen`) n'est pas concernée et garde ses numéros (zap numérique) ; l'horaire suit la langue de l'appareil (« 11:55 p.m. » sur le Motorola) ; rien commité.

## Noms de chaînes et de catégories lisibles — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande de Céd** : sur la TV, les noms de chaînes et de catégories sont « très tronqués donc incompréhensibles » ; les noms de chaînes le sont aussi sur mobile.
- **Reproduction** : sur la box, les catégories de Films/Séries affichaient toutes « (VFR) Films - … » et « FR DOCUMENTAIRE » devenait « FR DOCUMEN… » (une seule ligne) ; sur le Motorola, « FR: TF1 +1 FHD » s'affichait « FR: TF… » parce que le badge qualité occupait la largeur et que le nom n'avait pas `flex-1` (le programme était réduit à « Bonjour ! La M… »).
- **Correctifs** :
  - `TvVodScreen.tsx` (Films/Séries) et `TvLiveScreen.tsx` (Direct) : libellés de catégories sur **deux lignes** (`line-clamp-2`, `py-1.5`) ; les catégories Films affichent enfin `(VFR) Films - 2026`, `2025`, `2024`… au lieu d'un préfixe identique tronqué.
  - `TvLiveScreen.tsx` : nom de la chaîne surlignée sur **deux lignes** dans l'aperçu de droite. La liste des chaînes garde sa ligne unique et sa hauteur fixe de 56 px (virtualisation) : une tentative de deux lignes avec `ROW_HEIGHT = 72` décalait les lignes et rognait le texte, elle a été annulée ; le nom complet reste lisible dans l'aperçu au focus.
  - `ChannelList.tsx` : le nom de chaîne passe en `min-w-0 line-clamp-2 break-words`, le badge qualité en `shrink-0` ; le titre du programme et les variantes utilisent aussi `flex-1`. Le titre passe en **grille** `minmax(0,1fr) auto auto` : le nom prend la largeur restante sans pousser les actions ni le badge de groupe hors de la carte.
- **Vérifié en local** : tsc app+node 0 erreur, ESLint **0 erreur / 18 avertissements**, **1003/1003 Web sur 140 fichiers**, `vite build` et `assembleRelease` OK.
- **Livraison** : **1.12.30/code 78**, APK de référence `CedPlay-1.12.30.apk` (4 427 366 octets, SHA-256 `15ca66ab…`, même certificat `f3f2371b…`), installée sur la **box** et le **Motorola** (`dumpsys` code 78 / 1.12.30 sur les deux). Elle a été construite par la session concurrente à 00:49, après le correctif de grille mobile, et reprend donc les correctifs de noms **et** la fiche série TV / la grille à 6 colonnes. Les 1.12.27, 1.12.28 et 1.12.29 sont archivées dans `sauvegardes/apk-anterieures-2026-11-09/`.
- **Recette sur appareil** : box en 1.12.30, catégories Films `(VFR) Films - 2026/2025/2024…` sur deux lignes (capture `preuves/livraison-1.12.30-films-categories.png`) ; Motorola en 1.12.30, `FR: TF1 +1 FHD`, `FR: FRANCE 2 FHD` et le programme complet sur une ou deux lignes, badge de groupe dans la carte (capture `preuves/livraison-1.12.30-mobile-noms-chaines.png`).
- **Non fait** : les autres catégories et les noms extrêmes n'ont pas tous été parcourus ; la liste TV reste sur une ligne (voir ci-dessus) ; rien commité ; prochaine libre **1.12.31/code 79**.

## Fiche série TV : saison, épisodes et options à la télécommande — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande de Céd** : « la navigation tv quand on clique sur une serie pour avoir des details n est pas facile ensuite, on doit parfois descendre, parfois aller sur la droite ».
- **Constat sur la box (1.12.25)** : la fiche s'ouvrait avec le focus en bas, sur « Regarder » de l'épisode 1 ; Haut sautait à la saison (un `<select>` natif), puis à « Ajouter à ma liste », puis à la croix de fermeture. Chaque carte d'épisode empilait ses propres boutons (« Sous-titres », « Regarder », « Depuis le début »), d'où un mélange Bas/Droite variable avec la hauteur des synopsis. Retour depuis la fiche rendait le focus aux rubriques du haut au lieu de l'affiche.
- **Mise en œuvre** :
  - `components/TvSeriesFiche.tsx` (nouveau) : fiche série dédiée télécommande. Ligne « ‹ Saison N › » (Gauche/Droite change de saison), colonne des épisodes (Haut/Bas), colonne des options de l'épisode (Haut/Bas ; Droite entre dans les options, Gauche revient à la liste). Entrée sur le premier épisode ; OK sur un épisode place le focus sur « Regarder » — la lecture ne part pas d'un OK de lecture de liste. Options : Regarder / Reprendre à N min, Depuis le début (seulement si une reprise existe), Sous-titres, Ma Liste. `data-remote-self` : le moteur de navigation global ne s'applique plus dans la fiche, chaque flèche a une seule signification.
  - `components/VodLibrary.tsx` : la fiche série TV garde une hauteur fixe ; le synopsis et la fiche TMDB (texte) restent au-dessus, le navigateur saison/épisodes/options en bas. « Ajouter à ma liste » passe dans les options de l'épisode. Le panneau de sous-titres s'ouvre dans la zone de détails et le focus y entre. `onCloseAutoFocus` replace le focus sur l'affiche de la grille au Retour.
  - `components/TmdbPanel.tsx` : nouveau mode `compact` (texte seul : note, casting, synopsis ; pas de rangées de titres, pas d'offres, pas d'avis) ; aucun appel `/discover` ; masqué quand aucune clé TMDB n'est configurée (il n'aurait affiché qu'un appel à configurer).
  - `index.css` : styles `.tv-fiche` et anneau orange de focus, pour que l'action primaire (blanche) et l'action focalisée restent distinguables depuis le canapé.
- **Vérifié en local** : tsc app+node 0 erreur, ESLint **0 erreur / 18 avertissements**, **1001/1001 Web sur 140 fichiers** (dont 8 tests `TvSeriesFiche`, 1 test de retour à la grille, 1 test d'intégration TV série), `vite build` et `assembleRelease` OK, **41/41 tests Java** (`testReleaseUnitTest`).
- **Recette sur la box `192.168.100.2:5555`** (code 75 / versionName 1.12.27) : fiche « Street Outlaws », « Les Marseillais » et « LEGO Ninjago » ; Bas passe à l'épisode suivant et la colonne d'options affiche le bon épisode ; Droite place le focus sur « Regarder » ; Bas sur « Sous-titres » ; OK sur « Regarder » ouvre **ExoPlayer** et lit l'épisode (LEGO Ninjago) ; Retour referme la fiche et **le focus reste sur l'affiche ouverte**, plus sur les rubriques. Captures `preuves/livraison-1.12.27-fiche-serie.png`, `-fiche-serie-options.png`, `-retour-grille.png` ; avant : `preuves/avant-1.12.27-fiche-serie-*.png`.
- **Concurrence dans le même arbre** : le lot « l'aperçu de droite disparaît, grille à 6 colonnes » a été écrit et documenté en parallèle (section suivante). La **1.12.27/code 75** combine les deux : la grille à 6 colonnes du lot parallèle et la fiche série décrite ici. L'APK de référence a été reconstruite après cette fiche : **4 427 289 octets, SHA-256 `068e071e…`, certificat `f3f2371b…`**, installée sur la box. Les constructions 1.12.26/code 74 (00:11) et 1.12.27 `21b041e0…` (00:13) sont remplacées.
- **Limites** : aucune série multi-saisons dans le compte chargé (le changement de saison n'est prouvé que par les tests, pas sur la box) ; le panneau de sous-titres TV n'a pas été exercé sur la box ; une sortie du lecteur natif a rechargé le WebView (constaté une fois, non attribué à cette fiche) ; rien commité.


## Catalogue TV : la fiche éclair disparaît, la grille passe à 6 colonnes — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande de Céd** : la colonne d'aperçu à droite de Films/Séries est trop coûteuse à atteindre à la télécommande ; tout le monde appuie sur OK pour ouvrir la fiche complète. Retirer la colonne et élargir la grille (choix explicite : **6 colonnes**).
- **Cause mesurée** : dans la grille, `→` avance d'abord dans la ligne ; la colonne de droite ne s'atteignait qu'après avoir parcouru jusqu'à 5 affiches, alors qu'OK ouvre la fiche complète en un appui. Elle occupait 25 % de la largeur (~480 px en 1080p) pour redire ce que la fiche porte déjà.
- **Mise en œuvre** (`TvVodScreen.tsx`, `VodLibrary.tsx`, `index.css`, tests) : deux colonnes seulement (catégories | grille), `COLS = 6`, `grid-cols-6` ; `→` au bord droit ne sort plus de la grille. `InfoPanel` et les props devenues inutiles (`onPlay`, `onToggleWatchlistItem`, `forYouReasons`, `progressLabel`) sont supprimées, remplacées par `progress` : la reprise s'affiche sous l'affiche concernée et la justification « Pour toi » se lit dans la fiche complète. Les écarts de la branche Découvrir sont préservés : pas d'entrée « Toutes les catégories », `focusMainNavigation` pour Haut et Retour depuis les catégories, fiche série TV dédiée.
- **Vérifié localement** : tsc app+node 0 erreur, ESLint **0 erreur / 18 avertissements**, **1000/1000 Web sur 140 fichiers**, `vite build` et `assembleRelease` OK.
- **Livraison** : **1.12.27/code 75**, APK `CedPlay-1.12.27.apk` (4 427 305 octets, SHA-256 `21b041e0…` à sa construction, remplacée depuis par la reconstruction `068e071e…` décrite ci-dessus, même certificat `f3f2371b…`), installée sur la **box `192.168.100.2:5555`** (`dumpsys` code 75 / versionName 1.12.27). Une 1.12.26/code 74 avait été construite et installée par une session concurrente à 00:11 dans le même arbre ; elle contenait déjà une partie de ce lot. La 1.12.27 est la référence et la version installée sur la box.
- **Recette sur la box** (captures `preuves/livraison-1.12.27-*.png`) : Films affiche **6 affiches par ligne**, plus de colonne de droite, repère « OK : fiche » ; OK sur une affiche ouvre la fiche du film avec synopsis ; Séries affiche 6 affiches par ligne et sa fiche TV dédiée (saisons, épisodes, Regarder) s'ouvre par OK. Le catalogue a d'abord répondu « Catalogue indisponible » après l'installation ; « Réessayer » a chargé Films, puis Séries.
- **Non fait / limites** : la reprise de lecture sous une affiche n'a pas été vue sur la box (aucun titre en cours dans la première catégorie ouverte) ; elle est couverte par les tests. La navigation de bout en bout entre toutes les catégories, « Pour toi » et Ma Liste n'a pas été rejouée sur appareil. Rien committé.

## Recherche VOD par catégories, sans télécharger tout le catalogue — 8 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande** : remplacer la recherche films/séries qui chargeait tout le catalogue et ne trouvait pas le film cherché.
- **Mise en œuvre** (`catalogSearch.ts`, `GlobalSearchDialog.tsx`) : la recherche demande d'abord les catégories du fournisseur, puis les parcourt une par une (2 requêtes maximum en parallèle), avec un plafond de 60 catégories et un budget de 20 s. Les résultats s'affichent au fur et à mesure (`onResults`), la progression est visible (`n/N`), et la requête peut être annulée en changeant la saisie. Ordre de priorité : catégorie ouverte dans le catalogue (`cedplay.tvVod:<liste>:<type>`), catégories déjà chargées, catégories générales (IMDb d'abord, puis Top/meilleures), catégories « Films/Cinéma/VOD », puis le reste. Les catégories « test » sont ignorées. Une panne des séries ne masque plus des films déjà trouvés.
- **Vérifié sur la box** : recherche « berceau » → **deux « La Main sur le berceau » (2026 et 2025)** affichés en quelques secondes, puis la fiche du film 2026 s'ouvre depuis « Voir » (captures `preuves/livraison-1.12.25-recherche-berceau.png` et `-recherche-fiche.png`). Plus de requête `get_vod_streams` sans `category_id`, plus de gel de la box.
- **Limite constatée** : une recherche de série (« voice ») n'a affiché que les chaînes en direct, sans résultat de série sur ce compte ; la recherche de séries reste à vérifier (catégories ou budget). La recherche de films est, elle, prouvée sur appareil.
- **Vérifié en local** : tsc app+node 0 erreur, ESLint 0 erreur/18 avertissements, **989/989 Web sur 139 fichiers**, build et `assembleRelease` OK. APK **1.12.25/code 73** (4 425 836 octets, SHA-256 `96487bd6…`, même certificat), installée sur la box et le Motorola.
- **Non commité** : modifications et APK restent dans le worktree Découvrir.

## Films et Séries de nouveau accessibles à la télécommande — 8 novembre 2026 (branche `claude/decouvrir-v1`)

- **Symptôme reproduit sur la box** : l'écran Films restait figé sur « Chargement du catalogue… », la télécommande ne répondait plus, et il était impossible de revenir au menu ou de changer de rubrique. La catégorie « test » du fournisseur encombrait la colonne.
- **Cause racine** : la dernière catégorie mémorisée valait `''` (« Toutes les catégories »). Sur un compte Xtream réel, cette valeur déclenche `get_vod_streams` **sans `category_id`**, donc le téléchargement et le parsing de dizaines de milliers de films en une seule réponse. Le WebView est bloqué pendant plusieurs minutes ; aucun correctif d'interface ne peut répondre tant que ce traitement n'est pas terminé. Le même piège existait pour le pool « Pour toi » et la recherche globale.
- **Correctifs** (`VodLibrary.tsx`, `TvVodScreen.tsx`) : une valeur mémorisée `''` est ignorée et une catégorie réelle est sélectionnée ; l'entrée « Toutes les catégories » est retirée de la colonne TV et du sélecteur mobile ; le pool des recommandations est construit au fil des catégories consultées (`categoryCatalogCache`) au lieu de demander tout le catalogue ; les catégories nommées « test » sont masquées. Une catégorie réelle se charge désormais en quelques secondes.
- **Vérifié sur la box** : liste Xtream de 18 900 chaînes chargée (l'ancienne liste active était « Chaînes gratuites », sans films) ; Films ouvre « (V|FR) IMDb Top 50 », 47 titres, affiches visibles ; la télécommande entre dans la grille, ouvre la fiche et **le film « The Cook » est lu par ExoPlayer** ; Séries ouvre « (S|FR) Programme Tv Série », 16 titres ; Retour depuis la grille → catégories → menu (Découvrir), trois appuis. Captures `preuves/livraison-1.12.18-*.png`.
- **Vérifié en local** : tsc app+node 0 erreur, ESLint 0 erreur/18 avertissements, **987/987 Web sur 139 fichiers**, build OK, `assembleRelease` OK. APK **1.12.18/code 66** (4 424 784 octets, SHA-256 `15109dfe…`, même certificat), installée sur la box et le Motorola.
- **Limite assumée** : la recherche globale de films/séries charge encore tout le catalogue et, sur ce compte, elle n'a pas renvoyé le film cherché (elle n'affiche que les chaînes en direct, sans figer l'app). À remplacer par une recherche par catégorie ou une recherche fournisseur. Aucun scan USB ni appel TMDB réel.
- **Non commité** : modifications et APK restent dans le worktree Découvrir.

## 1.12.17/code 65 installée sur Hisense ; écart des compteurs en cours — 8 novembre 2026 (heure Mexique)

- **Build et signature** : build web standard exécuté par Céd (« built in 8.6s »), `cap sync android` OK ; `assembleRelease`/`testReleaseUnitTest` OK avec cache Gradle temporaire et configuration de signature temporaire pointant sur la clé existante (fichier supprimé à la fin). 983/983 Web précédemment rejoués sur ce code, tsc app/node sans erreur, lint 0 erreur/18 avertissements, 41/41 Java.
- **APK** : 4 425 031 octets ; SHA-256 `98048525df06ab7952e5d1a0dd164536d1b416a9a780ea9b88ef4879375ff445` ; même certificat SHA-256 `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`. Version 1.12.17/code 65 vérifiée dans le manifeste. 73 fichiers de dist conformes octet par octet dans l'APK ; marqueur `data-discover-screen` présent.
- **Installation** : `adb -s 192.168.100.2:5555 install -r` → Success ; `dumpsys package` confirme versionCode 65 / versionName 1.12.17 sur la Hisense. Pas de désinstallation, données conservées. Motorola non mis à jour dans cette passe. La recette des touches sur la box reste à confirmer par Céd ; ne pas présenter le contrôle navigateur comme une recette physique.
- **Fichiers** : `CedPlay-1.12.17.apk` et `CedPlay.apk` dans le worktree ; copie dans `A-installer/CedPlay-1.12.17.apk` du dossier principal. Ancien candidat 1.12.16 retiré uniquement aux deux emplacements vérifiés par son empreinte connue. APK de référence à la racine du dépôt principal inchangée, pas de fusion ni commit.
- **Nouveau signalement** : environ 21 000 chaînes sur mobile contre 16 000 sur TV avec le même abonnement. **Constats de code** : `ChannelList` affiche un total `allChannels.length`, y compris groupes verrouillés ; `TvLiveScreen` compte « Toutes » après filtre parental `allChannels.filter(allowed)`. Les catégories Xtream importées sont aussi mémorisées séparément sur chaque appareil ; `downloadXtreamLive` conserve ces identifiants et n'ajoute pas spontanément les catégories nouvelles. Groupes/chaînes masqués sont également propres à l'appareil. Aucun de ces constats ne prouve à lui seul la cause exacte des 5 000 chaînes d'écart. Aucun compteur exploitable dans les logs natifs consultés. Aucune liste, catégorie importée, préférence parentale ou favoris modifiés pour ce diagnostic. Prochaine vérification : contrôle parental côté TV, puis catégories importées/masquées si nécessaire.


## Régression navigation de Découvrir / Direct — 8 novembre 2026 (heure Mexique), candidat 1.12.17/code 65

- **Signalement réel** : remontée impossible depuis l'accueil, mélange avec le menu, Direct vide/bloqué après navigation. Empreinte des APK installées lue par ADB sur Motorola et Hisense : `38177df9…`, bien le dernier candidat livré. Ce n'est pas une confusion de version installée.
- **Reproduction avant correction** : trois nouveaux tests de parcours (avec `useRemoteNavigation`, les vraies rubriques et le vrai `ContinuePanel`) rouges : carte → filtres → menu, actions de carte → rangée suivante, Retour des filtres vers le menu. L'accueil utilisait uniquement le voisinage géométrique global et n'avait pas de frontière de navigation explicite.
- **Correction accueil** : `data-remote-self` en mode TV et navigation par structure, bornée à chaque rangée. Haut remonte vers les filtres, puis la rubrique ; Bas traverse les actions explicites d'une carte puis les rangées ; Gauche/Droite parcourent les cartes ou leurs actions. Retour des filtres rejoint le menu et consomme l'événement. Les filtres ne sont plus collés au sommet en mode TV. Menu TV opaque et marge de défilement pour empêcher le recouvrement des cartes par le menu.
- **Correction changement de rubrique** : retour du document en haut avant navigation TV, et après changement d'écran ; nouveau calcul de la hauteur après ce retour. Direct bloque le défilement du document et ne doit pas conserver la position héritée d'un accueil long. Focus d'une rubrique : retour en haut et réouverture de l'en-tête. Les événements Retour déjà traités par un écran sont respectés.
- **Tests** : trois reproductions initiales prouvées rouges puis vertes ; ajout d'un aller-retour Découvrir → Direct → Découvrir avec validation explicite par OK, et d'un contrôle d'intégration du retour en haut depuis un accueil défilé. Typage app/node sans erreur ; lint complet sans erreur / 18 avertissements. **983/983 tests Web sur 139 fichiers**, code de sortie 0 (238,06 s, transpilation TypeScript en mémoire, fichiers isolés).
- **Contrôle navigateur réel** : application assemblée pour un aperçu interactif temporaire avec le CLI esbuild (sans sous-processus Node), données de démonstration dans un origin local séparé ; tous les composants d'application sont réels. À 1280 × 720 : descente du menu à la dernière rangée (scrollY 697), remontée par flèches au menu (scrollY 0), Direct validé par OK et ses 8 chaînes visibles ; Bas entre dans les catégories. Après opacification, fond du menu `rgb(12,12,14)` et contenu séparé. Pas de lecture de flux ni de données utilisateur dans l'aperçu ; ce n'est pas une recette physique sur Hisense.
- **Version et attente** : 1.12.17/code 65 synchronisés dans les trois emplacements. Aucun nouvel APK ni installation tant que le build web standard n'est pas régénéré hors session (blocage `spawn EPERM` de Node/esbuild). Céd invité à relancer `corepack pnpm build` dans le dossier application du worktree. Pas de commit, push ou fusion. Le fichier APK 1.12.16 existant n'embarque pas ces corrections de navigation.


## APK 1.12.16 actualisée : Reprendre compact et retour mobile accessible — 8 novembre 2026 (heure Mexique)

- **Déclencheur** : Céd a exécuté le build web hors session et confirmé « built in 8.62s ». `dist` récent contient le gabarit compact. `cap sync android` réussi.
- **Compilation** : cache Gradle temporaire conservé ; première tentative de signature debug refusée car AGP veut écrire `C:/Users/C2k/.android/debug.keystore.lock`. Nouvelle tentative avec une configuration release temporaire (`android/keystore.properties`, ignorée, supprimée en `finally`) pointant sur la **même clé existante**, sans copie ni régénération. `assembleRelease` et `testReleaseUnitTest` : **BUILD SUCCESSFUL (39 s), 41/41 Java**.
- **Validation finale** : typage app/node 0 erreur ; ESLint complet 0 erreur / 18 avertissements ; **978/978 Web sur 138 fichiers** rejoués après les retouches (transpilation TypeScript en mémoire, fichiers isolés ; 289,83 s). Le build web standard de cette session reste bloqué par le lancement d'esbuild ; le build fourni par Céd a été utilisé.
- **APK** : `CedPlay-1.12.16.apk` et copie `CedPlay.apk` à la racine du **worktree Découvrir**, 4 424 303 octets, SHA-256 `38177df9555c60d6584d8953f87aeddb9433bc5a5462f681c9e068641048169b`. Version inchangée **1.12.16/code 64** ; cette APK remplace le précédent candidat du même numéro, empreinte `6d1efcee…`. Certificat SHA-256 `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`, identique à la version installée.
- **Embarquement vérifié** : 73 fichiers de `dist` conformes octet par octet dans l'APK ; marqueurs des cartes compactes 112/128 px dans le JavaScript et libellé natif « Retour aux chaînes » dans le DEX. Aucun média lourd de test dans dist. Fichier temporaire de signature absent à la fin.
- **Non fait** : pas de nouvelle installation ni de recette de ces deux retouches sur appareil ; pas de commit, push ou fusion. Le dossier principal et son APK de référence restent inchangés. Second Cerveau toujours hors droits d'écriture de la session.


## Déblocage de la compilation Android — 8 novembre 2026 (heure Mexique)

- **Demande** : comment finaliser les retouches ergonomiques malgré les permissions du cache Gradle.
- **Résolu pour Java** : lancement de la distribution Gradle 8.11.1 déjà installée, `--gradle-user-home` et `--project-cache-dir` sous TEMP, cache des dépendances existant déclaré en lecture seule (`GRADLE_RO_DEP_CACHE`). Aucune permission du cache habituel modifiée. `:app:compileReleaseJavaWithJavac :app:testReleaseUnitTest --offline --no-daemon` : **BUILD SUCCESSFUL, 41/41 tests, 0 échec, 0 erreur**, y compris compilation du nouveau bouton bas « Retour aux chaînes ».
- **Blocage restant** : `pnpm build` refuse encore le lancement d'esbuild (`spawn EPERM`), même avec son chemin explicite. L'exécutable esbuild répond directement à `--version`, mais Node n'arrive pas à le lancer comme sous-processus dans cette session. Aucun nouvel APK ni cap sync effectué : il faut d'abord régénérer `dist` avec les cartes compactes. Le cache Gradle temporaire est réutilisable.


## Contre-vérification 1.12.16 et retours ergonomie — 8 novembre 2026 (heure Mexique)

- **Contrôle indépendant de la livraison** : APK 4 424 046 octets, SHA-256 `6d1efceebca47d01b4aa4114ea342b5e39379622f49ad143375a68e227d40b64`, manifeste 1.12.16/code 64 ; certificat SHA-256 `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`, identique à la référence du dossier principal. Les 73 fichiers de `dist` correspondent exactement à leur contenu dans l'APK. `adb dumpsys package` confirme code 64/1.12.16 sur Motorola et Hisense ; les deux captures enregistrées confirment le filtre FHD (1 880/21 972) et une image dans le lecteur natif. Aucun nouveau flux lancé pendant ce contrôle.
- **Vérifications** : tsc app/node sans erreur et ESLint complet 0 erreur / 18 avertissements. **978/978 Web, 138 fichiers**, rejoués avec transpilation TypeScript en mémoire et isolation par fichier (228,64 s). `pnpm verify` standard reste bloqué au lancement d'esbuild (`spawn EPERM`) dans cette session ; aucun nouveau build Vite réussi ici.
- **Limites USB relevées** : les fichiers possédés sont convertis en amorces synthétiques `completed`, sans écriture dans l'historique réel ; ils sont exclus des suggestions correspondantes. Sans amorce rapprochée du catalogue, le garde `baseRecommendations.length === 0` empêche aussi l'enrichissement TMDB. Le filtrage film/série avant les 12 titres s'applique aux amorces ; le profil TMDB reçoit l'index complet puis prend les 12 premiers titres, tous types confondus. Aucune correction de ces règles pendant cette contre-vérification.
- **Capture mobile « difforme »** : la première correction alignait les cartes en haut mais laissait l'affiche du film imposer la hauteur de Reprendre. Nouveau gabarit compact commun aux films/séries/podcasts dans cette rangée seulement ; boutons explicites et progression conservés. `ContinuePanel.tsx` et un sélecteur du test existant mis à jour. **22/22 tests ciblés** (accueil et navigation) après changement ; typage et lint sans erreur. Aperçu isolé du composant avec données simulées et CSS Tailwind : à 375 px, deux cartes 267,53 × 163 px ; à 1280 × 720, deux cartes 300 × 179 px, aucun débordement horizontal. Ce contrôle n'est pas une recette sur appareil.
- **Retour mobile depuis le lecteur natif** : rangée de navigation en bas du bandeau de commandes du direct, boutons de hauteur 48 dp : « Retour aux chaînes » ferme le lecteur comme la flèche haute ; « Parcourir » ouvre le panneau de zapping. Mobile seulement ; la TV garde ses commandes. `NativePlayerActivity.java` modifié. Compilation et tests Java tentés mais bloqués avant compilation : accès refusé au verrou du cache Gradle sous `C:/Users/C2k/.gradle`. Aucune preuve sur appareil de ce nouvel accès.
- **État final de cette passe** : version source toujours 1.12.16/code 64 ; aucun nouvel APK, aucune installation, aucun commit ni fusion. L'APK installée précède les deux retouches ergonomiques ci-dessus. La fiche Second Cerveau reste hors des droits d'écriture de cette session.

## Qualité, lecture Android, bandeau podcast, « Pour toi » séries et USB/SD — 8 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demandes de Céd** : le filtre qualité ne sélectionnait rien ; « Lecteur » ne fonctionnait pas sur Android ; un bandeau « Reprendre » de podcast restait en bas ; recommandations pour les films mais pas les séries ; les ajouts USB/Drive comptent-ils pour « Pour toi » ?
- **Qualité** (`channelQuality.ts` nouveau, `xtreamLive.ts`, `stalker.ts`, `ChannelList.tsx`, `TvLiveScreen.tsx`, `GlobalSearchDialog.tsx`) : les imports Xtream et Stalker ne renseignaient pas `Channel.quality`. Une détection partagée lit « 4K/UHD/2160p », « FHD/Full HD/1080p », « HD/720p », « SD/576p/480p » dans le libellé à l'import et en secours à l'affichage. Le filtre ne propose que les qualités présentes (avec les variantes) et `selectChannelQuality` ouvre le flux de la qualité choisie en conservant l'identité de la chaîne (favoris, guide) ; la touche `q` ne parcourt que ces cases.
- **Lecteur** (`IPTVPlayer.tsx`) : le bouton « Lecteur » forçait `setWebSession(true)` même sur Android ; il passe désormais par `handleChannelSelect` (ExoPlayer natif si disponible, lecteur web sinon).
- **Bandeau podcast** (`MiniAudioPlayer.tsx`, `IPTVPlayer.tsx`) : il restait affiché avec « Reprendre » après une pause. Il n'apparaît plus que pendant une lecture active, ou en pause dans l'écran Écouter (`showPaused={activeTab === 'podcasts'}`).
- **Séries** (`recommendations.ts`, `externalWatch.ts`, `tasteEnrichment.ts`, `VodLibrary.tsx`) : `recommendForHistory` reçoit `kind`, l'onglet Séries charge `get_series`, les amorces sont jointes par type, TMDB résout les fiches `tv` (via `seriesId`), le rail « Pour toi » existe sur mobile dans les deux onglets et dans la colonne TV des séries. Chaque série ne pèse qu'une fois même avec plusieurs épisodes vus ; l'historique ancien sans `seriesId` est rapproché par titre ; films et séries homonymes ne se contaminent plus.
- **USB/SD** : porté depuis le WIP de l'arbre principal. Après chaque analyse, `LocalLibrary` enregistre un index dédoublonné dans IndexedDB (`localLibraryWorks`) ; les œuvres possédées servent d'amorces quand elles existent au catalogue et jusqu'à 12 fiches (poids fixe 0,6) nourrissent le profil TMDB. L'index est filtré par type avant la limite de 12.
- **Vérifié** : tsc app+node 0 erreur ; ESLint complet **0 erreur / 18 avertissements** (baseline) ; **978/978 Web sur 138 fichiers** ; `vite build` OK (dist 2,8 Mo, seuls les `.m3u` embarqués, aucun média de test). Tests neufs : 12 cas de détection + sélection de variante, intégration du filtre dans ChannelList, bouton Lecteur natif, bandeau en pause, recommandations séries (dont déduplication et historique ancien), enrichissement TMDB série, index USB/SD et amorces locales.
- **Livré** : version **1.12.16/code 64** (package.json, build.gradle, SettingsPanel), `cap sync android`, `assembleRelease` OK, APK `CedPlay-1.12.16.apk` (4 424 046 octets, SHA-256 `6d1efcee…`, même certificat `f3f2371b…` que 1.12.15), installée sur le Motorola `ZY22MBQQW7` et la box `192.168.100.2:5555` (dumpsys code 64/1.12.16). L'ancienne `CedPlay-1.12.15.apk` a été retirée du worktree. Lancement contrôlé sur le Motorola : l'app reprend sur le lecteur natif (capture du canal 19531).
- **Non prouvé sur appareil** : sélection d'une variante précise, bandeau podcast après pause, rail Séries avec un épisode réel, scan USB/SD et appels TMDB réels. **Constaté sur le Motorola** : le filtre **FHD** (mémorisé) reste actif sur la vraie liste Xtream et affiche **1 880 chaînes sur 21 972** avec le badge FHD (`preuves/livraison-1.12.16-qualite-fhd.png`) ; le bouton **« Lecteur » ouvre ExoPlayer** (canal 19531, vidéo en lecture, `preuves/livraison-1.12.16-lecteur-natif.png`).
- **Coordination** : l'arbre principal (`consolidate/v1.11.4`) porte une implémentation parallèle des mêmes correctifs, plus le WIP offres par pays/abonnements et la bibliothèque locale ; la consolidation devra retenir cette version livrée de la branche Découvrir.

## Densité de Découvrir — 9 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande** : corriger les grands espaces visibles sur les captures mobile et TV ; retirer les consignes de télécommande jugées inutiles.
- **Mobile** : les rangées utilisent `items-start` : une carte podcast garde sa hauteur naturelle, au lieu de s'étirer jusqu'au bas de l'affiche du film voisin. La hauteur de la rangée reste celle de son contenu le plus haut.
- **TV** : suppression du bloc d'information séparé de 150 px et des consignes de touches ; fiche éclair compacte à droite des filtres dans le même bandeau, de hauteur stable. Le focus ne décale pas les rangées.
- **Périmètre** : seul `application/src/components/ContinuePanel.tsx` modifié côté application ; version inchangée 1.12.15/code 63. Dossier principal et APK existantes préservés.
- **Vérification** : typage app/node sans erreur ; ESLint complet sans erreur, 18 avertissements existants. **945/945 tests Web, 135 fichiers, code de sortie 0** avec transpilation TypeScript en mémoire et fichiers isolés (un worker à la fois, 237,49 s). Suite standard et build bloqués au lancement d'esbuild (`spawn EPERM`) ; l'essai de build via API Vite est également bloqué par esbuild. Un premier lancement avec un seul thread partagé avait produit des interférences entre fichiers (924/945) ; le rejeu isolé résout ces échecs sans changement du code produit.
- **Limites** : aperçu précédent sur 5188 inutilisable (erreur du runtime React Refresh), aucun rendu corrigé observé sur appareil, aucun nouvel APK construit. Mise à jour de la fiche externe `Second Cerveau/10 Projets/CedPlay.md` refusée par les permissions d'écriture ; `entretien.py actualiser` sans changement, `verifier` sans erreur et `sonder` exécutés.

## APK 1.12.15/code 63 pour l'essai de Découvrir — 8 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande** : « Oui, construis l'APK » pour l'essai de Découvrir sur téléphone et box.
- **Version** : 1.12.15/code 63 dans `package.json`, `build.gradle` et `SettingsPanel.tsx` (commit `6321619`). Les chemins Capacitor réécrits par `cap sync` dans le worktree (`capacitor.settings.gradle`, `../../../../../application/node_modules`) n'ont pas été committés.
- **Vérifié** : tsc app+node 0 erreur ; ESLint complet 0 erreur / 18 avertissements ; **945/945 Web** (135 fichiers) ; `vite build` OK (seuls les trois `.m3u` dans `dist/`) ; `cap sync android` OK ; `assembleRelease` OK ; **41/41 Java**. `output-metadata.json` : versionCode 63, versionName 1.12.15.
- **APK** : `CedPlay-1.12.15.apk` à la racine du **worktree** (4 422 307 octets, SHA-256 `72003d25fc144bb9595f6bc1768d3f9f6fd1ccf7b6da24ea9fe19c9bbce54a93`), ignorée par git. Certificat SHA-256 `f3f2371b…dfa628`, identique à `CedPlay.apk` (1.12.14) du dossier principal : mise à jour sans désinstallation. L'APK de référence du dossier principal (1.12.14) n'a pas été remplacée tant que la branche n'est pas fusionnée.
- **Installée par adb à 20 h 49** (« Oui, installe-la ») : Motorola edge 70 (`ZY22MBQQW7`) et box Hisense (`192.168.100.2:5555`), 1.12.13/code 61 avant, `install -r` « Success », `dumpsys package` = 1.12.15/code 63 juste après, données gardées.
- **Remplacée à 21 h 42** par la 1.12.16/code 64 d'une autre session travaillant dans ce même worktree (voir les sections au-dessus). Les captures prises à 22 h 03 (Découvrir sur box et téléphone, sans plantage) montrent donc la **1.12.16**, pas la 1.12.15. Observé sur cette 1.12.16 : dans Reprendre sur téléphone, une carte podcast basse voisine une affiche de film haute et laisse un vide dessous.

## Découvrir, première implémentation — 8 novembre 2026 (branche `claude/decouvrir-v1`)

- **Demande** : implémenter la maquette Découvrir validée (organisation fonctionnelle) ; « ▲ » reste une flèche, retrait par bouton explicite ; fiche complète accessible sans appui long ; journal d'usage mesuré sur la lecture effective ; vérifier ce que les lecteurs remontent, notamment sur Android ; puis contrôle téléphone et TV. Pas d'APK, rien publié.
- **Base** : branche `claude/decouvrir-v1` (worktree `cedplay-discover-page-981ad3`) créée depuis `a5c9742`. Premier commit `6bf20cc` = **copie à l'identique du WIP non committé du dossier principal** (pays des offres, abonnements, fiches isolées, 923 tests) pour bâtir dessus ; le dossier principal n'a pas été modifié.
- **Constat lecteurs** : le lecteur vidéo natif ne renvoyait que `stats.durationMs` = durée totale de session, pauses et chargements compris ; le service audio natif ne signalait rien à JS quand la WebView est en arrière-plan ; l'historique (`prunePlayHistory`) garde une entrée par titre et compte le zapping. Aucun ne permettait de compter des jours de lecture effective.
- **Journal d'usage** (`56b7317`, `0fa7cd9`) : Android mesure le temps sur `onIsPlayingChanged` d'ExoPlayer (`PlayTimeMeter`, `UsageJournal`, `UsageJournalStore` en SharedPreferences, relevé en pause d'activité, à la libération du lecteur et toutes les 5 s pour l'audio), par jour et par famille (direct, vidéo, audio), 14 jours gardés, méthodes `getUsageJournal`/`clearUsageJournal`. Le navigateur mesure ses `<video>`/`<audio>` (`attachUsageMeter` : pause, attente, recherche, fin arrêtent la mesure). Les deux journaux s'additionnent. `familyOrder` : jours distincts avec ≥ 2 min par famille sur 14 jours ; ordre par défaut Direct, Vidéo, Podcasts tant que < 3 jours distincts qualifiés, et en cas d'égalité. Effacement : les données de l'app (SharedPreferences + stockage WebView) partent avec « Effacer les données » d'Android ; aucune réinitialisation interne n'existe dans l'app.
- **Écran** (`630207c`, `520de14`) : l'onglet Accueil devient **Découvrir** (`ContinuePanel.tsx` réécrit, moteur pur `utils/discover.ts`). Filtres Tout/Films/Séries/Podcasts collés en haut ; rangées Reprendre (films, épisodes, podcasts mêlés), Mes chaînes en ce moment, Pour toi, Ma liste, Nouveaux épisodes, À écouter ou « Sélection CedPlay » sans émission suivie, Chaînes récentes sans les favoris ; rangées vides masquées ; ordre des familles calculé une fois à l'ouverture. « Terminé » ne retire que des suggestions. Boutons explicites « Fiche » (titres en cours) et « Émission » (épisodes) ; sur TV, fiche éclair à hauteur fixe, Retour = 1re carte puis filtres. Flux suivis relus en arrière-plan toutes les 6 h (`utils/podcastRefresh.ts`), cache gardé en cas d'échec, bouton Actualiser. Le carrousel « À la une » n'est plus affiché (`HeroCarousel.tsx` reste dans le code, inutilisé).
- **Pour toi** : Découvrir affiche le dernier calcul fait par Films (mémorisé par playlist), pour ne pas charger le catalogue Xtream sur l'accueil d'une box. Sur TV, ce calcul n'a lieu qu'à l'ouverture de « Pour toi » dans Films.
- **Non fait dans cette passe** : rangée « Sur tes abonnements » dans Découvrir (elle existe dans la fiche d'un film ; l'ouvrir depuis l'accueil demande une fiche TMDB autonome) ; appui long OK et touche Menu (les boutons explicites couvrent l'accès à la fiche) ; thème des émissions (`itunes:category`).
- **Vérifié** : tsc app+node 0 erreur ; ESLint complet 0 erreur / 18 avertissements (baseline) ; **945/945 Web** (135 fichiers, dont 7 journal, 12 moteur, 3 écran) ; Java : compilation release et **41/41** tests unitaires (6 neufs) ; `vite build` OK (dist 2,8 Mo, seuls les `.m3u` embarqués). Mutation de l'ordre par défaut : 4 tests rouges, puis restauration. Navigateur (dev, port 5188) : 375 px sans débordement horizontal ; TV `?tv=1` en 1280×720 : focus visible, fiche éclair, flèches dans et entre rangées, Retour 3e carte → 1re carte → filtre « Tout ». Vignettes carrées mesurées 198 × 32 px avant correction (le greffon aspect-ratio neutralise `aspect-*`), 200 × 200 après.
- **Non prouvé** : aucun essai sur appareil (pas d'APK) ; mesure Android du temps joué prouvée par tests unitaires seulement ; données de démonstration limitées (favoris et sélection, sans historique VOD ni émission suivie dans le navigateur) ; version toujours 1.12.14/code 62 ; branche non poussée, non fusionnée.

## Contre-vérification des recommandations : trois défauts corrigés — 8 novembre 2026

- **Demande** : la contre-vérification du lot « pays des offres / rangée des abonnements » relève trois défauts non couverts par les 46 tests ciblés : la rangée « Sur mes abonnements » peut contenir de la location ou de l'achat, un titre similaire peut faire lire le film précédent, et un reclic sur le pays déjà choisi efface les abonnements.
- **Abonnement seulement** (`tmdb.ts`) : `/discover` reçoit désormais `with_watch_monetization_types=flatrate`. Sans ce filtre, TMDB rend aussi la location et l'achat, qui ne sont pas des abonnements. La clé de cache passe en `tmdb_discover_v2_…` pour ne pas resservir pendant 6 h les entrées v1 qui en contenaient déjà. La note de la rangée dit maintenant « Titres disponibles en abonnement dans ce pays… ».
- **Fiche d'un titre similaire isolée** (`TmdbPanel.tsx`, `VodLibrary.tsx`) : `TmdbPanel` reçoit l'identité stable de la fiche hôte (`sheetKey` = identifiant catalogue) et prévient le parent du titre qu'il affiche (`onActiveChange`), avec la même garde de clé : la sélection est oubliée dès que la fiche change de film. Pendant qu'un titre TMDB absent de la playlist est affiché, `VodLibrary` masque tout ce qui décrit encore A : titre et logo de plateforme du dialogue (remplacés par B et « Titre recommandé, absent de ta playlist »), synopsis/réalisation/casting du fournisseur, « Ajouter à ma liste », sous-titres, « Regarder », avertissement de format et épisodes. « ← Revenir à … » restaure A avec ses actions.
- **Reclic sur le pays déjà choisi** (`SettingsPanel.tsx`) : le bouton du pays actif ne modifie plus `watchProviderIds` ; seuls les vrais changements de pays remettent la sélection à zéro (les identifiants de fournisseurs sont propres au pays).
- **Vérifié** : tsc app/node 0 erreur ; ESLint complet **0 erreur / 18 avertissements** (baseline) ; **923/923 Web** sur 133 fichiers (2 tests neufs sur le pays, 1 sur l'isolation de la fiche, assertion `flatrate` ajoutée à la découverte) ; `vite build` OK (dist 2,8 Mo, seuls les trois `.m3u` embarqués, aucun média de test). **Chaque nouveau test a été prouvé rouge sur le défaut** : trois mutations temporaires (retrait de `flatrate`, garde `if (false)`, `shownTitle = null`) donnent 3 tests rouges, puis restaurations vérifiées.
- **Non fait / non prouvé** : aucun appel TMDB réel (pas de clé dans la session) ; aucun essai appareil ni web avec un vrai catalogue ; aucun APK ; **version toujours 1.12.14/code 62** ; rien committé (arbre de travail seul). La préférence « abonnement » de la rangée n'est donc prouvée que par le paramètre envoyé (mocks), pas par une réponse TMDB réelle.

## Recommandations utiles : pays des offres, fiches sans sortie TMDB, rangée des abonnements — 8 novembre 2026

- **Demande** : les vignettes « Films similaires » de la fiche renvoyaient au site themoviedb.org ; préférence pour la plateforme de diffusion (selon l'abonnement et le pays) ou pour le film déjà présent dans les listes ; utilisateur français basé au Mexique, donc catalogues différents de la France.
- **Constat de départ** : « Où regarder » existait déjà (`WatchProviders`, table TMDB → app dans `watchAvailability.ts`) mais la région était figée sur la France (`WATCH_REGION = 'FR'`), et un similaire sans correspondance locale ouvrait `themoviedb.org` (`TmdbPanel.tsx`). Les identifiants de fournisseurs sont propres au pays (Disney+ = 2706 au Mexique, 337 en France), vérifié sur les pages TMDB MX.
- **Pays réglable** (`data/watchRegions.ts` nouveau, `storage.ts`, `SettingsPanel.tsx`, `WatchProviders.tsx`) : douze pays proposés, **Mexique par défaut**, libellés « Où regarder au Mexique ». La région entre dans la clé de cache TMDB (`tmdb_providers_<type>_<id>_<pays>`, 12 h) : changer de pays ne relit plus les offres de l'ancien. Les plateformes mexicaines sans tuile dans le Direct (ViX, Claro video, Tubi, DIRECTV GO) ouvrent leur site au lieu de la page TMDB.
- **Plus aucune sortie vers TMDB** (`TmdbPanel.tsx`) : un clic sur un film ou une série similaire ouvre sa fiche dans le panneau (identifiant connu) avec « Où regarder », un bouton « Revenir à … », et le bandeau « Dans ta playlist » quand le titre est déjà dans une liste chargée (ouverture directe du catalogue). `tmdbPageUrl` supprimé. Le synopsis/casting du fournisseur n'est plus masqué à tort sur la fiche ouverte depuis une rangée.
- **Rangée « Sur mes abonnements au Mexique »** (`tmdb.ts`, `WatchSubscriptions.tsx` nouveau) : réglage des plateformes cochées, liste demandée à TMDB pour le pays (`/watch/providers/movie?watch_region=`), puis un seul appel `/discover/{film|tv}?watch_region=&with_watch_providers=&with_genres=` (6 h de cache, aucun appel sans abonnement coché). Aucun identifiant de fournisseur n'est codé en dur, la liste vient toujours du pays choisi.
- **Défaut introduit puis corrigé** : la comparaison « réglages inchangés » de `loadSettingsAsync` était par référence ; le tableau `watchProviderIds` étant neuf à chaque validation, chaque démarrage réécrivait les réglages. Comparaison par valeur pour les tableaux (`sameSettingValue`), test existant de nouveau vert.
- **Vérifié** : tsc app/node 0 erreur ; ESLint complet **0 erreur / 18 avertissements** (tous antérieurs) ; **920/920 Web** (132 fichiers, dont 12 tests ajoutés : pays, découverte, abonnements, fiche sans sortie externe) ; `vite build` sans média de test (dist 2,8 Mo). `pnpm` absent du PATH : étapes lancées avec `node_modules/.bin`.
- **Non fait / non prouvé** : aucun appel TMDB réel (pas de clé dans la session) — les URL et le format des réponses ne sont couverts que par des mocks et par les pages TMDB publiques ; aucun essai appareil, aucun APK, **version inchangée 1.12.14/code 62** ; rien committé (arbre de travail seul) ; le rail d'abonnements n'apparaît qu'après avoir coché des plateformes dans Réglages › Films et séries.
- **À reprendre** : essai avec une vraie clé TMDB au Mexique (ViX/Claro présents, Netflix MX), vérification du rail sur téléphone et box, puis décision de version (1.12.15/code 63 libre) si livraison.
- **Note de coordination** : un cherry-pick concurrent (`a5c9742`, fiche film mobile) a atterri sur `consolidate/v1.11.4` pendant la session ; les fichiers ont été relus après coup, aucun chevauchement avec les modifications laissées en arbre.

## Livraison 1.12.14/code 62 — « Pour toi » sur TV, filtres mobiles sur une ligne — 8 novembre 2026

- **Demande** : « Pour toi » absent de la version TV ; sur mobile, les deux lignes Films/Séries puis Catalogue/USB prennent la place du contenu.
- **TV** (`TvVodScreen.tsx`, `VodLibrary.tsx`) : entrée « Pour toi » dans la colonne de gauche des Films, après Ma Liste ; jusqu'à 20 suggestions (4 rangées de 5), première justification dans la fiche éclair, message si rien à proposer (aucun film vu / préparation / aucune correspondance). Classement et requêtes TMDB lancés seulement quand l'entrée est ouverte. Import « Vu ailleurs » non proposé sur TV.
- **Mobile** (`IPTVPlayer.tsx`, `MoviesPanel.tsx`, `VodLibrary.tsx`) : un seul sélecteur Films · Séries · USB/SD (225 px à 375 px de large) ; catégorie + Ma Liste (icône et nombre) + Actualiser (icône) sur une ligne ; titre « Films »/« Séries » en double retiré. Une reprise de film rouvre le catalogue même si USB/SD était affiché.
- **Défaut relevé par la contre-revue puis corrigé** (`e80a2e2`) : avec « Pour toi » ou Ma Liste affiché, choisir la catégorie déjà retenue (OK, Droite, pause de navigation) était ignoré. Toute catégorie choisie revient au catalogue ; Gauche depuis la grille ramène sur l'entrée de la liste affichée. 4 tests rouges sur le code d'avant, verts après.
- **Vérifié** : tsc app/node 0 erreur ; ESLint complet 0 erreur / 18 avertissements (tous antérieurs) ; **897/897 Web** (129 fichiers) ; vite build 71 fichiers sans média de test ; `cap sync` (chemins réécrits par la jonction `node_modules` remis à l'identique) ; **35/35 Java** ; `assembleRelease`. Navigateur 375 px : une ligne, pas de défilement horizontal, USB/SD ouvre la bibliothèque locale.
- **APK** : `CedPlay-1.12.14.apk` = `CedPlay.apk`, 4 412 270 octets, SHA-256 `dcc4dba885e408dff2e33bc0e96e7cdf6c4ad21a8995f15f9a76bf14feb5328c`, certificat `f3f2371b…` identique à la 1.12.13, 71/71 fichiers web identiques au build. 1.12.13 archivée dans `sauvegardes/apk-1.12.13/`.
- **Non fait** : aucune installation (téléphone, box) ; écran TV jamais vu avec un vrai catalogue Xtream (tests seulement). Branche `claude/recommendations-tv-mobile-layout-27bcd4` (`d9cf270`, `e80a2e2`), intégrée dans `consolidate/v1.11.4` par avance rapide depuis `fc997a0` (aucune modification suivie en cours dans le dossier principal, fichiers non suivis intacts), pas de push.
- Prochaine version libre : **1.12.15/code 63**.

## Livraison 1.12.12/code 60 — panneaux natifs — 8 novembre 2026

- **Intégration** : `consolidate/v1.11.4` avancée en `55b3f6d` (avance rapide sans stash ni checkout global, par `update-ref` + mise à jour des seuls fichiers du commit). `CURRENT_MISSION.md` du dossier principal fusionné à trois voies : section panneaux ajoutée, WIP F1/F2/F3 intact (diff WIP identique à la sauvegarde, en-têtes de blocs exceptés). Constats antérieurs : `INTEGRATION_PANNEAUX_2026-11-08.md`.
- **Défaut trouvé sur Hisense et corrigé** (antérieur au redesign) : panneau d'erreur affiché, ▲ ▼ ◀ zappaient au lieu de déplacer le focus. `handleTvKey` laisse la navigation par défaut au panneau, mais `onKeyDown` interceptait ensuite les flèches pour zapper. Correctif : `onKeyDown` ne zappe plus quand le panneau d'erreur est affiché (`isErrorPanelShown()`).
- **Candidat isolé** : construit depuis la branche `claude/petits-panneaux-charte-f77ef4` (arbre commité, sans le WIP F1/F2/F3). tsc app/node 0 erreur, ESLint 0 erreur/18 avertissements, **799/799 Web**, build web 72 fichiers/2 622 888 octets sans média de test, `cap sync`, **35/35 Java** (`testReleaseUnitTest`), `assembleRelease`. `pnpm` absent du PATH : mêmes étapes avec `node_modules/.bin`. Les chemins réécrits par `cap sync` dans `capacitor.settings.gradle`/`capacitor.build.gradle` (effet de la jonction `node_modules`) ont été remis à l'identique.
- **APK** : `CedPlay-1.12.12.apk` = `CedPlay.apk`, 4 402 361 octets, SHA-256 `e9d85628b485419277743d1ac1a2291e3db6a480183b87c558855f52b364bc80`, certificat `f3f2371b…` identique à la 1.12.11 (clé `~/.android/debug.keystore` existante, non régénérée). Ancienne `CedPlay-1.12.11.apk` déplacée dans `sauvegardes/apk-1.12.11/`.
- **Hisense physique** (version de diagnostic 1.12.12, mêmes sources, pilotée par la WebView ; flux servis depuis le PC par `adb reverse`) : panneau d'erreur sur réponse HTTP 404 réelle, libellés dans le cadre, focus blanc sur « Réessayer », ▼ ▼ ▲ entre les trois boutons sans requête réseau, OK sur « Chaîne suivante » charge la chaîne 2. « Épisode suivant » : carte en bas au centre, titre long sur 2 lignes, compte à rebours et barre, focus « Lire maintenant », ▶ puis OK sur « Rester ici » ferme la carte sans passer à l'épisode 2. Entrées d'essai `essai-panneaux-*` retirées de `shared_prefs/vod.xml` (copie d'avant dans les preuves). Puis **release 1.12.12/code 60 installée sans désinstallation**, accueil et données conservés. Non vérifié en release : ouverture d'une chaîne réelle (touches injectées sans effet sur l'accueil lors de l'essai) ; téléphone non mis à jour. Preuves : `preuves/panneaux-charte/tv/`.
- Prochaine version libre : **1.12.13/code 61** (la réservation 1.12.12 envisagée pour F1/F2/F3 est prise par cette livraison).

## Petits panneaux du lecteur natif — 8 novembre 2026 — base 1.12.11/code 59

- Retour utilisateur (photo Hisense) : panneau « Flux indisponible » hors charte, libellés « Chaîne suivante » / « Ouvrir dans VLC » sortant de boutons tassés. Cause : panneau en `WRAP_CONTENT`, deux boutons à poids 0 dans une rangée trop étroite.
- Refait dans `NativePlayerActivity.java` : panneau d'erreur (largeur max 400 dp, titre « Lecture impossible », icône rouge, message 3 lignes, trois boutons empilés pleine largeur avec icône, libellés sur une ligne coupés par « … ») et panneau « Épisode suivant » (carte max 440 dp en bas au centre, libellé orange, compte à rebours, titre 2 lignes, barre de progression, deux boutons égaux, focus sur « Lire maintenant »). Focus télécommande : pastille blanche, l'orange ne remplit aucun bouton.
- `PlayerOption.java` : gris alignés sur `index.css` (.dark) — carte `#18181C`, élevé `#222228`, piste `#2E2E36` — plus bord `#2A2A31` et erreur `#E5484D`. **Touche tout le lecteur natif** (surfaces un peu plus claires). Icônes ajoutées : `ic_player_alert`, `ic_player_next`, `ic_player_external`.
- Maquette : https://claude.ai/artifact/27TEJBn2s6tRWudV2n19cn
- Vérifié : `:app:compileDebugJavaWithJavac` OK, **35/35 tests Java**. Non fait : `pnpm verify` (aucun fichier Web touché), APK, essai sur Hisense ou téléphone. Branche `claude/petits-panneaux-charte-f77ef4`, pas de push.

## Correction des huit défauts F1/F2 — 8 novembre 2026

- Correctifs en TDD sur la baseline exacte de la contre-vérification : **12 reproductions ajoutées d'abord à la suite produit** (rouges vérifiées : 13 échecs), puis correctifs minimaux, un par cause racine. Rien committé, version inchangée **1.12.11/code 59**.
- Les huit : (1) rail « Pour toi » + bouton « Vu ailleurs » rendus dès l'écran Films hors télécommande (`VodLibrary.tsx`, message d'accueil différencié sans visionnage) ; (2) catalogue complet chargé aussi quand des films importés peuvent amorcer le rail (garde `externalWatches.some(mediaKind !== 'series')` + dépendance `externalWatches`, état déplacé avant l'effet) ; (3) identité du profil = **type + titre + année de la fiche TMDB résolue** (`tasteEnrichment.ts`) ; (4) similaires typés `type:id`, `TmdbDetails.kind` estampillé à la résolution (`tmdb.ts`, `tasteProfile.ts`, `tasteEnrichment.ts`) ; (5) restauration fusionnée par identité éditoriale via `mergeExternalWatches` (`idb.ts`) ; (6) date ISO impossible refusée sans repli `Date.parse` (`2023-02-31` → `null`) ; (7) pointé lu `JJ.MM.AAAA` (séparateur distingué du slash ambigu) ; (8) tous les homonymes gardés avant le filtre d'année (`externalSeeds`). Bonus : dédoublonnage du parseur aligné sur l'identité éditoriale (type inféré = type explicite), la sonde « écartée » de la revue devient verte.
- Sondes de la revue rejouées (lanceur `preuves/revue-f1-f2/corrections/vitest.config.ts`, à exécuter **depuis la racine du dépôt**) : **UI 3/3, moteur 4/4, import 6/7** — `COLD_START importButton:true`, `EXTERNAL_ONLY fullCatalogCalls:1 emptyRail:false`, remakes `sampleSize 2` + deux genres, collision TV/movie `score 0`, troisième homonyme `vod:1:movie:3`. Seul rouge restant : le **P3** « Prime Video → Autre » du résumé, hors des huit défauts, comportement épinglé tel quel par deux tests produit existants.
- Suite complète : **887/887** (129 fichiers = 871 de base + 4 tests F3 de la session concurrente + 12 reproductions), tsc app/node 0 erreur, lint 0 erreur/18 avertissements (aucun sur les fichiers touchés), build Vite OK (index 649,33 kB / 198,37 kB gzip), aucun média lourd dans `dist`. Première validation globale verte incluant les corrections F3 concurrentes.
- **Anomalie signalée** : au démarrage de la session, une restauration de checkpoint (17:01:26, écriture groupée des fichiers WIP) a écrasé un état disque qui portait déjà des correctifs des défauts 2 et 5 (observés à 17:01:25, disparus ensuite ; aucun stash). Correctifs refaits depuis la baseline du rapport ; vérifier l'autre session si elle détient ces états.
- Aucun essai appareil, aucun vrai export Netflix/Prime/YouTube, aucun appel TMDB réel. Prochaine étape : décision de livraison (réservation 1.12.12/code 60) puis recette appareil F1/F2/F3 avec un vrai export.

## Contre-vérification F1/F2 — 8 novembre 2026

- Revue du WIP DeepSeek après HEAD `0839ad1`, sans correctif produit, commit, version, APK ni installation. Rapport : `REVUE_F1_F2_2026-11-08.md`, preuves `preuves/revue-f1-f2/`. Les douze fichiers F1/F2 contrôlés sont restés identiques pendant les exécutions. Du WIP F3 est apparu ensuite : hors périmètre de ce verdict.
- Contrôles annoncés confirmés : tsc app/node 0 erreur ; lint complet 0 erreur/18 avertissements ; **852/852 Web**, 126 fichiers ; build web isolé réussi, 72 fichiers/2 642 250 octets. Pas de remplacement du dist de livraison ni de compilation Android.
- **À corriger avant livraison** : premier import inaccessible sans historique local ; catalogue complet non chargé depuis les imports seuls (rail vide malgré correspondance) ; profil fusionnant remakes/film-série par titre ; IDs des similaires TV confondus avec ceux des films ; restauration réintroduisant des doublons entre plateformes ; date ISO impossible normalisée ; format pointé jour/mois inversé ; jointure rejetant le troisième homonyme avant filtrage de l'année. P3 supplémentaire : libellé générique Prime Video affiché Autre.
- Reproductions réexécutées par le responsable : **14 sondes, 11 rouges/3 témoins verts** ; une rouge sur le parseur de séries écartée car neutralisée par la fusion du dialogue. Huit défauts fonctionnels retenus et un P3. Aucun vrai export, compte TMDB ni appareil testé. F1/F2 restent non commités et exclus de l'APK 1.12.11/code 59 livrée ; ne pas annoncer les lots validés sur la seule suite verte. Corriger puis rejouer les sondes avant d'intégrer F3 ou une nouvelle APK.

## Titres de section dans les chaînes — 8 novembre 2026 — 1.12.11/code 59

- Correction du retour utilisateur après 1.12.10 : la photo désigne le titre fournisseur `FR: -- MUSIQUE / NEWS --` dans la colonne des chaînes, et non une catégorie de la colonne gauche. Reproduction physique sur 1.12.10 : titre premier dans les données source, quatrième après extraction TNT de M6 MUSIC et CSTAR HITS.
- Corrigé : reconnaissance de M6/CStar limitée aux suffixes techniques réels (dont TS, M6 INTER conservé) ; tri automatique par sections, sans franchir les titres fournisseur. Ordres explicites conservés et aucune donnée source réécrite. Régression TV/mobile ajoutée sur les libellés de la photo. Contre-revue indépendante 7/7, avec une régression TS du premier candidat reproduite puis corrigée.
- **Isolation** : construit depuis `d0962d7` + six fichiers de correction/version uniquement, dans `preuves/sections-chaines/candidate/`. Le WIP tiers recommandations/VOD/profil de goûts et ses tests est exclu de l'APK et conservé dans le dossier principal.
- Vérifié sur candidat : typage app/node, lint complet 0 erreur/18 avertissements, **799/799 tests Web**, **35/35 Java**, build/sync et assembleDebug/Release réussis. Sur **Hisense physique** : même groupe musique avant/après ; titre source initialement déplacé en quatrième position, puis premier sur le candidat, ordre des huit premières lignes identique à la source. APK release 59/1.12.11 installée ensuite sans désinstallation ; capture release inspectée, titre MUSIQUE / NEWS bien premier devant M6 Music et NRJ Hits. Téléphone non connecté, pas de push.
- Référence racine et alias identiques : **4 399 296 octets**, SHA-256 `4e7881909929f836a7a467f8fc859df5c0548c7004b0ea425376e43b90d0be33`, même certificat. Rapport `TITRES_SECTIONS_1.12.11_2026-11-08.md`, preuves `preuves/sections-chaines/`.

## Retours d'usage TV — 8 novembre 2026 — 1.12.10/code 58

- Demande : Toutes/Favoris en tête puis ordre fournisseur, relance explicite du flux, zapping depuis le panneau transparent et favori depuis le lecteur. L'ordre manuel des catégories est conservé. Les outils passent après les catégories ; VOD : Toutes puis Ma Liste.
- Corrigé : index du panneau construit une fois, publication cohérente des indices fenêtre/liste complète, sélection et focus conservés, OK sur TV change de chaîne en gardant le panneau, commandes « Relancer le flux » et ajout/retrait favori. Journal privé des mutations de favoris réconcilié avec IndexedDB, y compris les variantes et les actions successives ; aucune clé ni URL fournisseur dans les nouveaux journaux de diagnostic.
- 791/791 tests Web, 35/35 Java, typage app/node, lint complet (0 erreur/18 avertissements), build web, synchronisation Capacitor, assembleDebug et assembleRelease réussis. Quatre défauts P2 du premier candidat reproduits puis corrigés lors des contre-revues (variantes/révisions, alias et focus après publication).
- **Hisense physique** : panneau fermé à la sélection sur 1.12.9, conservé avec focus liste sur le candidat ; Toutes/Favoris en tête ; image réelle après zap. Relance explicite : première image ~2,5 s après la commande sur un essai. Ajout favori depuis lecteur visible dans le filtre natif (3 au lieu de 2), puis retrait ; 47 favoris globaux initiaux retrouvés exactement, ordre compris. Essais instrumentés en diagnostic, puis APK release signée installée sans désinstallation, 58/1.12.10 confirmé, Direct et image de chaîne réelle vérifiés en release. Téléphone absent d'ADB, non mis à jour.
- **TMDB non résolu** : clé actuellement absente des réglages de la Hisense ; trois tests d'intégration clé refusée/panne réseau conservent le catalogue et la lecture. Aucun correctif spéculatif, aucune clé modifiée ; disparition historique à reproduire avec sa configuration. Fluidité prolongée à confirmer à l'usage.
- Référence et alias : 4 399 008 octets, SHA-256 `a0252b916c1f2b5674322858478710e43f7e3b2710f7ded06fd054f3bd631038`, même certificat. Rapport `RETOURS_TV_1.12.10_2026-11-08.md`, preuves `preuves/retour-tv/`. Pas de push.

## 1.12.9 — lots figés et reconnexion du direct, 8 novembre 2026

- Lots A→E figés dans `96f74e2` ; changement concurrent des logos (`3ebf54c`) préservé. Reconnexion native dans `63adb42` : fenêtre 180 s, délais 1,5/3,5/7/15 s plafonnés, une tentative en vol, accélération au retour réseau ; annulation pause effective, zap, cast, sortie et erreur permanente. Politique VOD conservée. Deux défauts de contre-relecture (pause système et Stalker nul en cours de récupération) reproduits puis corrigés.
- **Hisense physique** : ancienne version incapable de repartir après 30 s de coupure HTTP contrôlée ; code final repris seul, première image **3 365 ms** après retour du service, un seul flux simultané sur le serveur synthétique. Pause pendant la récupération respectée, Lecture manuelle opérationnelle. Wi-Fi non coupé. APK release ensuite installée sans désinstallation, **57 / 1.12.9** confirmé ; accueil/Direct affichés et image d'une chaîne réelle observée. Essais instrumentés en diagnostic, lancement réel en release minifiée ; pas de mesure prolongée de fluidité.
- Vérifié : tsc app+node 0 erreur, ESLint complet 0 erreur/18 avertissements, **779/779 Web**, **30/30 Java**, build Vite, cap sync et assembleRelease réussis. Certificat identique à 1.12.8. APK racine `CedPlay-1.12.9.apk` et alias identique, **4 396 428 octets**, SHA-256 `0b7c4af47758f5afd5a754f88a5c6a7379509fba614f719ea2a8928ee293daee` ; ancienne référence retirée après contrôle.
- Rapport : `RECONNEXION_DIRECT_1.12.9_2026-11-08.md`, preuves `preuves/reconnexion-direct/`. Pas de push ni d'installation téléphone. Suite : recette d'usage/retour Wi-Fi réel, puis résilience DVR ; Media3/audio à traiter séparément.

## Contre-vérification de l'audit mobile/TV — 8 novembre 2026

- Rapport complémentaire : `CONTRE_REVUE_AUDIT_MOBILE_TV_2026-11-08.md`. Aucun code produit modifié. L'instantané rouge du nouvel audit est dépassé : **778/778 tests Web**, 118 fichiers, dont 25/25 TV VOD ; sondes indépendantes réglages/thème **4/4**, contrôle parental **3/3** ; cinq cibles locales du relais refusées 403 et service local jamais atteint. Journaux `preuves/revue-lot-d/mobile-tv-*-recheck.log`.
- Android : tests JVM **21/21** et assembleDebug hors ligne confirmés (tâches à jour). La virtualisation BIOS n'est pas nécessaire à cette compilation ; aucun émulateur ni appareil utilisé, aucun APK racine remplacé.
- Lecture native et documentation officielle : deux reprises applicatives du direct confirmées, mais **5 s ne mesure pas le délai réel d'abandon** ; quota DVR Android 15 applicable en arrière-plan, réinitialisé au retour au premier plan ; données des programmations persistantes et réarmement BOOT_COMPLETED déjà présent. M6 reste à reproduire. Correction proposée pour WebView : `server.errorPath`, pas `android.errorPath`. Migration Media3 à isoler avec décision sur minSdk 22, puisque Media3 exige au moins 23 depuis 1.9.
- Priorité proposée : figer les lots actuels, puis reconnexion du direct et DVR avec essais physiques ; migration Media3/audio séparée. Pas de commit, push, montée de version ni installation dans cette passe.

## Corrections de la contre-vérification des lots A→E, 8 novembre 2026

- Suite de `REVUE_LOTS_A_E_2026-11-08.md` : les quatre défauts reproduits sont corrigés, et leurs cas sont intégrés à la suite de tests du produit (les sondes adverses restent isolées sous `preuves/`).
- **P1 verrou parental (`VodLibrary.tsx`)** : nouvel état `categoriesStatus` (`idle`/`loading`/`ready`/`error`). Un ensemble de catégories vide n'est plus une autorisation : après un échec de `get_vod_categories`/`get_series_categories`, Ma Liste n'expose plus aucun titre ; pendant l'attente, la liste reste visible mais `play()` refuse la lecture (y compris les reprises « Continuer » et l'écran TV) tant que le verdict est inconnu. « Réessayer » restaure la liste filtrée. Trois tests ajoutés dans `vodLibrary.test.tsx` (attente, échec puis reprise, reprise refusée).
- **P2 relais de dev** : la garde est extraite dans `proxy-guards.mjs` (déclarations `proxy-guards.d.mts`) et importée par `proxy-server.mjs`. `expandIpv6` décode les adresses en 16 octets : `[::ffff:127.0.0.1]`, normalisée en `[::ffff:7f00:1]` par `new URL`, les formes `::/96`, ULA `fc00::/7` et lien local `fe80::/10` sont refusées ; `/xtream/catalog`, `/xtream/categories` et `/xtream/streams` appliquent la même politique de cible et répondent 403 sur un serveur local. Six tests dans `proxyGuards.test.ts`. Rejeu de `preuves/revue-lot-d/proxy-repro.mjs` : 403 sur les six sondes locales, service local jamais atteint, 200 conservé pour une origine autorisée et pour `https://example.com` via `/proxy`.
- **P2 secours des réglages (`storage.ts`)** : `_loadingPromise` porte désormais la promesse **protégée** (délai 8 s + secours) et la partage entre tous les appelants ; une erreur IndexedDB renvoie le même repli à chacun. Deux tests ajoutés (concurrence sous base suspendue, échec `VersionError`).
- **P2 thème clair (`storage.ts`)** : `getFallbackSettings()` réapplique le miroir `iptv_theme` au repli, donc l'effet d'`App` ne réécrit plus un thème clair en sombre après 8 s. Un test ajouté.
- **Effet de bord corrigé (`TvVodScreen.tsx`)** : le nouveau partage des réglages décale l'ordonnancement des rendus et la restauration d'affiche pouvait laisser le focus sur les catégories ; la ligne mémorisée est maintenant refocalisée explicitement (`restoreFocusRow`). La suite TV complète reste verte (25/25).
- Vérifié après correction : `tsc` app + node 0 erreur, `eslint ./src` complet 0 erreur / 18 avertissements (inchangé), **778/778 tests** sur 118 fichiers (12 nouveaux), `vite build` OK (chunk principal 638,15 kB / 194,20 kB gzip), `dist/` 72 fichiers / 2 616 573 octets. Rejeu des reproductions de la revue : 3/3 (Ma Liste), 4/4 (réglages/thème), relais 403 sur toutes les cibles locales et 200 sur `example.com`.
- Non vérifié : rien de physique dans cette correction. Rien n'est commité (seul `AGENTS.md` reste indexé) et aucun APK n'est produit : la version en place reste **1.12.8 / code 56**. Les lots A→E sont désormais prêts pour la **1.12.9 / code 57**.

## Contre-vérification des lots A à E, priorité lot D — 8 novembre 2026

- Revue demandée du bilan DeepSeek sur l'arbre cumulé après HEAD `0362409`, sans correction de code produit, commit, push, changement de version ou installation. Rapport : `REVUE_LOTS_A_E_2026-11-08.md` ; reproductions isolées : `preuves/revue-lot-d/`.
- Contrôles réexécutés : TypeScript app+node 0 erreur, ESLint complet 0 erreur/18 avertissements, Vitest **766/766** sur 117 fichiers, build web OK (72 fichiers, 2 616 049 octets), tests Android **21/21**, assembleDebug OK, SDK 35/code 56 confirmés. Le lanceur pnpm de cet environnement ayant échoué, les mêmes étapes ont été exécutées avec les outils locaux ; les blocages de sous-processus et de cache Gradle ont été levés dans le contexte autorisé.
- **P1 reproduit, lot A** : dans `VodLibrary`, Ma Liste expose un titre adulte et permet `openVod` sans PIN tant que les catégories sont inconnues (attente ou erreur). Un témoin vert après résolution des catégories et deux tests rouges, dont l'appel réel au pont natif simulé.
- **P2 reproduit, lot D** : `/proxy` bloque `127.0.0.1` mais accepte son équivalent IPv6 `[::ffff:127.0.0.1]` et renvoie le contenu d'un faux service local. Les trois routes Xtream acceptent aussi un serveur loopback. CORS restreint confirmé ; garde anti-SSRF incomplète, développement uniquement.
- **Deux P2 reproduits, lots B/D** : les appelants concurrents des réglages retournent la promesse DB brute, donc le délai/secours ne protège que le premier ; le secours ignore aussi le miroir de thème clair et `App` le réécrit en sombre après 8 s. Quatre sondes rouges indépendantes de la suite existante.
- Deux APK racine identiques, 1.12.8/code 56, 4 607 473 octets ; SHA-256 `f3fafbdfdf6c5cc8aa08a2f2bc3ab18d9f36fea65dbae1be31e97faff2259ad5`. APK livrée encore en SDK 34 et sans miroir de thème ; aucune APK de référence remplacée. `AGENTS.md` reste seul indexé et mentionne encore 763 tests, contrairement aux 766 annoncés. Aucun essai physique pendant cette revue. Corriger ces quatre défauts avant d'intégrer les lots et de produire la 1.12.9/code 57.

## Lot D de l'audit — livraison et hygiène, 8 novembre 2026

- Ferme les trois P1 restants (COR-09 flash de thème, COR-10 relais de dev SSRF/CORS, COR-11 gouvernance des consignes), le P2 des APK à la racine, et traite le SDK cible et la signature (P2-18/P2-19) avec un point assumé sur deux drapeaux Android.
- Modifiés : `index.html` (lit d'abord le miroir `iptv_theme`, repli `iptv_settings`), `App.tsx` et `storage.ts` (`setThemeMirror`/`getThemeMirror`, hors des clés purgées ; le miroir alimente aussi l'état initial, sinon le thème clair repassait en sombre pendant la lecture d'IndexedDB), `proxy-server.mjs` (CORS limité aux origines Vite, 403 sur origine inconnue, `/proxy?url=` refusant loopback/privé/CGNAT y compris via DNS, validation http/https et absence d'identifiants factorisées sur les trois routes Xtream), `proxy.ts` (commentaire corrigé), `package.json` (`verify` sans `--quiet`, script `proxy`), `AGENTS.md` (1.12.8 / code 56 / 766 tests, outillage Android réel, garde du keystore debug, règle « un seul APK de référence ») — **`AGENTS.md` est désormais indexé dans git**, les autres modifications restent dans l'arbre.
- Android : AGP **8.9.1**, Gradle wrapper **8.11.1**, `compileSdk`/`targetSdk` **35**, opt-out temporaire du bord à bord Android 15. `largeHeap` et `FLAG_KEEP_SCREEN_ON` sont **conservés**, avec justification en commentaire : le lecteur web s'exécute dans `MainActivity`, qui n'a pas d'autre moyen de garder l'écran allumé.
- Racine nettoyée : 42 APK supprimés (≈300 Mo) ; ne restent que `CedPlay-1.12.8.apk` et `CedPlay.apk`, recopié depuis la 1.12.8.
- Vérifié : `tsc` app+node 0 erreur, `eslint ./src` complet 0 erreur / 18 avertissements (inchangé), **766/766 tests** sur 117 fichiers (3 nouveaux sur le miroir de thème), `vite build` OK (chunk principal 637,96 kB / 194,15 kB gzip), `dist/` 2,7 Mo. Android : `:app:compileDebugJavaWithJavac` et `:app:assembleDebug` réussis, `aapt2` → `compileSdk 35`, `targetSdk 35`, `versionCode 56`. Relais éprouvé au `curl` (200 origine autorisée, 403 origine inconnue, 403 sur `127.0.0.1`/`localhost`/`192.168.1.1`, 400 sur `ftp://`, 200 sur `example.com`).
- Non vérifié : rendu bord à bord sur un appareil Android 15, disparition du flash de thème sur une installation réelle en thème clair, cycle complet du relais depuis l'application web. Rien n'est commité ni empaqueté : la version en place reste 1.12.8 / code 56, et les APK installées ne contiennent pas les lots C, D et E. Prochaine version logique : 1.12.9 / code 57.

## Lot E de l'audit — couverture des chemins critiques, 8 novembre 2026

- Ferme le P2-20 : les modules critiques sans tests passent de 12–47 % à 100 % des lignes, et un quota IndexedDB plein est désormais couvert par un test.
- Nouveaux fichiers : `src/test/stalker.test.ts` (19), `src/test/streamCheck.test.ts` (12), `src/test/parseWorker.test.ts` (5), `src/test/epgConfig.test.ts` (7). Complétés : `epgUrl.test.ts` (guide servi malgré un quota plein), `textImport.test.ts` (UTF-16 grand-boutiste, plafond d'un guide compressé).
- Corrigé au passage : `stalker.ts` acceptait `ftp://…` en le préfixant `http://`, produisant des adresses `http://ftp//…` ; tout schéma autre que http(s) est maintenant refusé (test rouge avant correctif).
- Vérifié : `tsc` app+node 0 erreur, `eslint ./src` complet 0 erreur / 18 avertissements (inchangé), **763/763 tests** sur 117 fichiers (46 nouveaux), `vite build` OK (chunk principal 637,7 kB / 194,1 kB gzip), `dist/` 2,7 Mo. Couverture globale 85,65 % → **88,82 %** ; `stalker`, `streamCheck`, `parseWorker`, `epgConfig`, `textImport` à 100 % des lignes. Le test de quota a été vérifié par mutation (échec si le `catch` d'écriture EPG est retiré).
- Non vérifié : rien de physique dans ce lot (tests et build locaux uniquement). Le lot E n'est ni commité ni empaqueté : la version en place reste 1.12.8 / code 56 (session Plateformes) et les APK installées ne contiennent ni le lot C ni le lot E.

## Lot C de l'audit — performance TV, 8 novembre 2026

- Corrige le P1 de fluidité du guide et les trois P2 de performance React : l'aperçu natif n'est plus rappelé à chaque événement de défilement, les listes ne paient plus de reflow forcé à la frappe, et les caches mémoire ne grossissent plus à vie.
- Modifiés : `EPGGrid.tsx` (relance de l'aperçu coalescée en `requestAnimationFrame`, frame annulée au démontage), `IPTVPlayer.tsx` (`openSearch`, `showGuide`, `openGroupManager`, `toggleChannelSort` mémoïsés ; `onNativePlay`, `onNativeChannelSelect` et `onRecord` réutilisent les callbacks stables existants), `ChannelList.tsx` (`useLayoutEffect` à dépendances explicites, `restoreRowFocus` mémoïsé, recherche remise à zéro seulement au changement de `playlistId`), `vodPosterCache.ts` (`rememberLoadedPoster`/`rememberFailedPoster`, plafonds 2 000 / 500), `VodPoster.tsx`.
- Vérifié : `tsc` app+node 0 erreur, `eslint ./src` complet 0 erreur / 18 avertissements (inchangé), **717/717 tests** sur 113 fichiers (8 nouveaux, chacun vérifié par mutation : il échoue sur le code d'avant correction), `vite build` OK (chunk principal 637,6 kB / 194,0 kB gzip), `dist/` 2,7 Mo.
- Non vérifié : fluidité réelle du guide et de l'aperçu sur box, frappe dans une liste de ~2 000 chaînes, défilement d'un catalogue VOD de plusieurs milliers d'affiches. Le lot C n'est ni commité ni empaqueté : la version en place est 1.12.8 / code 56 (session Plateformes), l'APK installée sur la Hisense ne le contient pas.

## Lot B de l'audit — démarrage et robustesse, 8 novembre 2026

- Corrige les cinq P1 de robustesse : plus d'écran de chargement éternel si IndexedDB est bloquée, plus de gel du fil principal après un timeout du worker EPG, plafonds et encodage des imports, mémoire du guide réduite, import Xtream borné et annulable.
- Modifiés : `idb.ts` (`blocked`/`blocking`/`terminated`, ouverture bornée à 10 s, échec non mémorisé), `storage.ts` (lecture des réglages bornée à 8 s avec repli synchrone), `epgWorker.ts` (repli synchrone réservé aux guides ≤ 4 M caractères), `epgXmltv.ts` (fenêtre temporelle pendant l'analyse, marge ±48 h), `useEPG.ts` (sources secondaires parsées seulement pour les chaînes sans programme), `textImport.ts` (nouveau : BOM, `encoding=`, repli windows-1252, plafonds 64 Mo / 120 M caractères), `PlaylistLoader.tsx`, `corsProxy.ts`, `m3uParser.ts`, `epg.ts`, `userAgent.ts` (délai 20 s), `xtreamCatalog.ts` (délai + erreur d'identifiants distincte), `xtreamLive.ts` (signal d'annulation), `XtreamLoginDialog.tsx` (annulation à la fermeture).
- Vérifié : `tsc` app+node 0 erreur, `eslint ./src` complet 0 erreur / 18 avertissements, **709/709 tests** sur 110 fichiers (23 nouveaux depuis le lot A), `vite build` OK (chunk principal 636,9 kB / 193,9 kB gzip), `dist/` 2,7 Mo. Le lot B n'est ni commité ni empaqueté : la version 1.12.7 / code 55 a été posée par la session Plateformes, et l'APK 1.12.7 installée sur la Hisense contient le lot A mais pas le lot B.
- Non vérifié : guide réel de plus de 4 M caractères, liste M3U Latin-1 réelle, fermeture du dialogue Xtream pendant un import muet sur appareil. Les guides complémentaires sont encore tous téléchargés ; seule leur analyse est conditionnée aux trous de la source principale.

## Lot A de l'audit — contrôle parental VOD et quota IndexedDB, 8 novembre 2026

- Corrige les deux P0 de l'audit : le contrôle parental couvre désormais le catalogue VOD/séries Xtream, la recherche globale, « Continuer » et les favoris publiés au lanceur Android TV ; le cache EPG est plafonné et purgé, et un échec d'écriture IndexedDB n'est plus présenté comme une panne réseau.
- Nouveaux fichiers : `src/utils/parentalVod.ts` (registre de session des catégories adultes par liste et par type, alimenté seulement après une lecture réussie), `src/hooks/useAdultVodCategories.ts` (verdict fermé tant que les catégories sont inconnues).
- Modifiés : `VodLibrary.tsx` (catégories, titres, Ma liste et « Pour toi » filtrés ; catégorie par défaut jamais verrouillée ; fiche fermée si elle devient interdite), `GlobalSearchDialog.tsx`, `ContinuePanel.tsx`, `MoviesPanel.tsx`, `IPTVPlayer.tsx` (favoris filtrés par `playableChannels`), `epg.ts` (écriture du cache isolée du téléchargement, plafond 12 M caractères), `idb.ts` (`deletePlaylistFromDB` purge 11 familles de clés `meta`), `ChannelList.tsx` (favori non enregistré annulé et signalé).
- Vérifié : `tsc` app+node 0 erreur, `eslint ./src` complet 0 erreur / 18 avertissements (inchangé), **685/685 tests** sur 106 fichiers (13 nouveaux : registre, hook, purge, quota EPG, catégorie adulte masquée dans le catalogue), `vite build` OK, `dist/` 2,7 Mo. Rien n'est encore versionné ni empaqueté : pas de montée en 1.12.7 et aucun APK produit.
- Non vérifié : recette sur appareil avec une catégorie adulte Xtream réelle, et comportement du quota quand IndexedDB est réellement plein.

## Audit intégral 1.12.6 — corrections et améliorations à planifier, 8 novembre 2026

- Rapport : `AUDIT_INTEGRAL_2026-11-08.md` (racine). Aucun code modifié. Base revérifiée sur l'état courant : tsc app+node 0 erreur, `eslint ./src` complet 0 erreur / 18 avertissements, 672/672 tests (102 fichiers), `vite build` 12,6 s et `dist/` 2,7 Mo sans média de test, APK 1.12.6 code 54 (aapt).
- Deux P0 : (1) contrôle parental absent sur tout le VOD/séries Xtream, la recherche VOD, la reprise VOD et les favoris publiés au lanceur Android TV ; (2) caches EPG jamais purgés et échec d'écriture IndexedDB (quota) présenté comme panne réseau, avec perte silencieuse des favoris et réglages.
- Neuf P1 : `getDb()` qui mémorise une ouverture bloquée, re-parse EPG synchrone après timeout worker, M3U/XMLTV sans plafond ni détection d'encodage, XMLTV entièrement en mémoire avant filtrage, fetch web sans timeout sur l'import Xtream, `scroll` non throttlé dans le guide TV, flash sombre en thème clair (`iptv_settings` plus jamais écrit), proxy de dev SSRF/CORS `*`, et `AGENTS.md` non versionné et périmé (1.12.3/code 51/661 tests annoncés).
- 21 P2 documentés (sauvegarde exportant des secrets non re-masqués, mot de passe Xtream pré-rempli, PIN SHA-256 nu, caches non purgés à la suppression d'une liste, DVR perdu après force-stop, URI non validées dans le pont natif, couverture limitée à utils+hooks, 42 APK / 300 Mo à la racine).
- Faux positifs écartés et consignés pour éviter de futures « corrections » : pas de XSS, proxy non embarqué dans l'APK, règles ProGuard OK, APK non versionnés, pas de fuite de listeners, virtualisation en place, warnings `currentPlaylist` d'`IPTVPlayer` sans conséquence.
- Plan proposé en cinq lots (A sécurité fonctionnelle, B démarrage/robustesse, C perf TV, D livraison/hygiène, E couverture). Aucun essai sur appareil ni flux réel dans cette session : la recette physique reste ouverte.

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

## Chaînes : groupes français en tête, TNT et discrétion — 1.12.4 / code 52, 8 novembre 2026

- Demande utilisateur : groupes ou chaînes dont le nom commence par un symbole classés après le z (discrétion), groupes français en tête de liste, généralistes françaises numérotées dans l'ordre de la TNT (Arcom du 6 juin 2025 : 1. TF1 … 25. Chérie 25), puis complément « Adulte en dernier, toujours » : groupes adultes (Adulte, XXX, +18…) après tout le reste.
- Nouveau `src/utils/tntOrdering.ts` : comparateurs de groupes et de chaînes (français d'abord, A–Z ensuite, symboles puis adultes en fin), `tntDisplayName` (préfixe « N. ») et `orderFrenchGroupsForTnt` (généralistes TNT en tête des groupes français, reste en ordre d'origine) ; branché sur `byGroupName`/`byChannelName` (channelCustomization), ChannelList, TvLiveScreen, ListOrganizers et le pipeline `customizedGroups` d'IPTVPlayer ; préfixe « N. » affiché sur mobile uniquement sans numéro personnalisé.
- Aucune donnée réécrite : dérivation à la volée depuis le nom ; l'ordre choisi dans Organiser et le tri A–Z priment ; recherche et guide restent associés par id, la numérotation TV canonique suit le nouvel ordre.
- Vérifié : 661/661 tests Vitest (100 fichiers, +15 dans tntOrdering.test.ts), TypeScript app+node 0 erreur, ESLint complet 0 erreur (18 avertissements préexistants), vite build 9,3 s, cap sync (2 plugins), assembleRelease OK.
- APK `CedPlay-1.12.4.apk` et `CedPlay.apk` à la racine (4 601 149 octets, SHA-256 `85725238e030cb4f3300915db193692b0766ce2f3069ecf4421b65ec0dd1b9f4`, code 52 / 1.12.4 vérifiés par aapt). Commit fonctionnel `c84c95e` puis commit version `5fa1b21` et commit bannière TV `d9c37f8` ; travail concurrent et fichiers non suivis préservés.
- Installation `adb install -r` réussie sans désinstallation ni perte de données sur les deux appareils connectés : Hisense HiSmartTV A4 (`192.168.100.2:5555`) et Motorola Edge 70 (`ZY22MBQQW7`), tous deux confirmés en versionCode 52 / versionName 1.12.4 par dumpsys.
- Vérification visuelle sur la TV Hisense : en-tête allégé de Claude actif sur l'Accueil, passage sur Direct avec groupes français immédiatement en tête de liste (`FR CINEMA`, etc.), chaînes généralistes et thématiques ordonnées avec respect de la TNT Arcom (ex. TF1 Séries Films n° 20 en tête de `FR CINEMA`), aperçu vidéo en direct et lecture plein écran fluides et opérationnels.

## VOD : affiches synchronisées, défilement fluide et cache de catégories — 1.12.5 / code 53, 8 novembre 2026

- Retour utilisateur : défilement des listes de séries et films trop long à charger ; affiches ne se chargeant pas en même temps sur une même ligne (pop-in décalé et asynchrone non qualitatif).
- Diagnostic :
  1. `loading="lazy"` dans les conteneurs virtuels/défilants TV provoquait des chargements asynchrones et décalés sur une même rangée au moment où les cellules entraient dans la vue.
  2. Chaque changement de catégorie VOD déclenchait un aller-retour réseau systématique vers le serveur Xtream (« Chargement du catalogue… ») même pour une catégorie consultée quelques secondes plus tôt.
  3. L'absence de cache mémoire et de préchargement des rangées suivantes laissait des silhouettes vides pendant les déplacements rapides à la télécommande.
- Correctifs apportés :
  1. `vodPosterCache.ts` : cache mémoire global des affiches chargées (`loadedPosterUrls`) et défaillantes (`failedPosterUrls`), préchargement proactif par `new Image().src` (`prefetchPosters`), et cache mémoire des catalogues de catégories (`categoryCatalogCache`) avec TTL de 10 minutes et invalidation lors du rafraîchissement manuel.
  2. `VodPoster.tsx` : composant d'affiche unifié pour le web et la TV avec détection synchrone du cache mémoire (affichage immédiat sans clignotement), squelette animé doux (`animate-pulse bg-neutral-800/60`), transition d'opacité fluide (`transition-opacity duration-300 ease-out`), décodage asynchrone hors thread UI (`decoding="async"`), et repli gracieux avec titre centré sur fond neutre.
  3. `TvVodScreen.tsx` : intégration de `VodPoster` dans la grille TV (`PosterCell`) et le panneau d'informations latéral (`InfoPanel`) ; préchargement automatique en tâche de fond des 20 éléments suivants au fur et à mesure du défilement dans la rangée.
  4. `VodLibrary.tsx` : intégration de `VodPoster` dans la grille mobile et le rail "Pour toi" ; mémorisation instantanée des listes par catégorie dans `categoryCatalogCache` pour un basculement immédiat (0 ms) entre catégories déjà explorées.
- Vérifications locales :
  - 667/667 tests Vitest (101 fichiers, dont 6 nouveaux tests dédiés dans `vodPoster.test.tsx`), TypeScript app+node 0 erreur, ESLint complet 0 erreur (18 avertissements préexistants inchangés).
  - Compilation web Vite (8,99 s) et copie Capacitor (`cap copy android`).
  - Compilation Android (`testReleaseUnitTest` + `assembleRelease` OK, 21 tests Java).
- APK `CedPlay-1.12.5.apk` et `CedPlay.apk` à la racine : 4 601 529 octets, SHA-256 `260C3B7AE8E75EA28D23A70B88BF211F827F989B7DBC846F1A1D828B698B41D4`, code 53 / 1.12.5 vérifiés par aapt.
- Installation et validation physique :
  - `adb install -r` réussi sans désinstallation ni perte de données sur les deux appareils connectés : Hisense HiSmartTV A4 (`192.168.100.2:5555`) et Motorola Edge 70 (`ZY22MBQQW7`).
  - Vérification physique sur la Hisense TV : ouverture de CedPlay sur l'Accueil, basculement vers l'onglet Films, défilement vers le bas dans la grille (`input keyevent 20`) avec affichage synchrone et complet de toutes les affiches de chaque rangée sans pop-in décalé, panneau d'informations latéral immédiatement illustré, et changement instantané de catégorie vers `(V|FR) IMDb Top 50` avec chargement immédiat de toutes les affiches visibles.


## Plateformes : l'application officielle avant le navigateur — 1.12.6 / code 54, 8 novembre 2026

**Demande.** « J'ai un problème quand je veux accéder à mes plateformes de streaming, ça lance la page internet […] J'aimerais que ça renvoie directement à l'application » — les apps officielles (Netflix, TF1+, YouTube…) offrent de meilleures performances et résolutions que leur page web.

**Cause.** `openWeb` côté Java faisait un `ACTION_VIEW` générique sur l'URL https : pour la racine des domaines (netflix.com, tf1.fr…), les filtres App Links des apps officielles ne s'appliquent pas et Android ouvrait le navigateur par défaut.

**Solution (aucune donnée réécrite).**
- `streamingPlatforms.ts` : champ `androidPackages` par plateforme (IDs vérifiés un à un sur le Play Store le 8 novembre 2026 ; variantes TV en second, ex. YouTube `com.google.android.youtube` puis `com.google.android.youtube.tv`, Prime Video `…thirdpartyclient` puis `…livingroom`). OCS partage le paquet myCANAL ; Rakuten TV = `tv.wuaki`, Max = `com.wbd.stream`, TF1+ = `fr.tf1.mytf1`, M6+ = `fr.m6.m6replay`, france.tv = `fr.francetv.pluzz`, Arte = `tv.arte.plus7`, ADN = `fr.anidn`.
- `NativePlayerPlugin.openWeb` (Java) : échelle par paquet candidat — 1) `ACTION_VIEW`+`setPackage` si l'app gère l'URL exacte (App Links), 2) si `allowAppHome`, `getLaunchIntentForPackage` (accueil de l'app), 3) sinon navigateur comme avant. La recherche sur sites officiels (ReplayHub + résultats Replay de la recherche globale) reste en mode strict : jamais de lancement à l'aveugle qui perdrait la requête ; les tuiles de plateformes et les résultats Plateformes de la recherche globale passent `allowAppHome`.
- Manifeste : bloc `<queries>` (visibilité Android 11+) avec requête intent https + les 22 paquets listés ; vérifié dans l'APK final (`aapt dump xmltree`).
- Passation : `nativePlayer.ts openWeb(url, title?, packages?, allowAppHome?)` ; ReplayHub `openExternal(..., packages, allowAppHome)` ; GlobalSearchDialog `handleOpenPlatform(platform)` + nouveau `handleOpenReplay(url, platformId)`.

**Vérification.** tsc app+node 0 erreur ; `eslint ./src` 0 erreur (18 avertissements préexistants) ; vitest **672/672** (102 fichiers ; +4 `streamingPackages.test.ts`, +1 test recherche/paquets dans replayHub.test.tsx, 2 assertions openWeb mises à jour) ; vite build 9,5 s ; cap sync (2 plugins) ; assembleRelease OK. APK **CedPlay-1.12.6.apk** à la racine (4 602 764 octets, SHA-256 `b7e26f68371ffba98e69758a7709e90f343a560ee81fb3283d29be8d68c11342`, aapt `versionCode='54' versionName='1.12.6'`). **Non installée** : pas demandé pour cette version — la partie résolution « l'app s'ouvre et lit » reste à confirmer sur appareil (apps Netflix/TF1+/YouTube installées).

**Session concurrente.** Bump effectué après re-vérification `git status` (1.12.5/code 53 commitée par l'autre session en `6646a40`, rien en vol) ; commits par pathspec explicite ; ses fichiers racine non touchés.

**Installation 1.12.6 (8 novembre 2026, sur demande « sur les 2 »).** `adb install -r CedPlay-1.12.6.apk` réussi sur Motorola Edge 70 (ZY22MBQQW7) et Hisense HiSmartTV A4 (192.168.100.2:5555), sans désinstallation ; `dumpsys package com.lecteur.iptv` : `versionCode=54 versionName=1.12.6` des deux côtés. Reste à confirmer à l'usage : l'ouverture effective des apps officielles (Netflix, YouTube, TF1+) depuis Direct → Plateformes.

## Retours appareil sur l'ouverture des plateformes et corrections TV — 1.12.7 / code 55, 8 novembre 2026

**Retours utilisateur (Motorola)** : Netflix OK, YouTube OK, france.tv OK ; TF1+ et M6+ ouvertes sur le navigateur car les applications ne sont pas encore installées (comportement attendu) ; Prime « ne fonctionne pas », Max « connexion non privée » (page navigateur), Arte renvoie vers le site.

**Diagnostic sur la Hisense (dumpsys)** — trois causes réelles trouvées et corrigées :
1. **Netflix TV = `com.netflix.ninja`** (pas `mediaclient`) : ajouté comme second candidat (la TV et le téléphone partagent www.netflix.com en App Link, la tuile ouvre donc l'app des deux côtés).
2. **Max et Prime TV n'ont que `LEANBACK_LAUNCHER`** : le repli « accueil de l'app » via `getLaunchIntentForPackage` (catégorie LAUNCHER) renvoyait null sur TV — `openWeb` essaie maintenant aussi `getLeanbackLaunchIntentForPackage`.
3. **`www.primevideo.com` et `www.max.com` ne sont PAS des App Links des apps** (dumpsys : Max déclare `play.max.com`/`play.hbomax.com`, Prime déclare `app.primevideo.com`) : l'URL Prime passe à `https://app.primevideo.com` (ouvre l'app directement ; sans app, la page officielle « obtenir l'application »). Max garde www.max.com et s'ouvre à l'accueil via le paquet (`com.wbd.hbomax` ajouté en variante TV).

Sur le téléphone : Prime/Max/Arte semblent **non installées** (le navigateur s'est ouvert) — installer les apps ou me redonner la main adb pour confirmer ; « connexion non privée » sur www.max.com est un incident TLS du réseau du téléphone (depuis le PC, le TLS de max.com est sain).

**Vérification.** 686/686 tests (vitest), tsc app+node 0, ESLint 0 erreur (18 avertissements), vite build 8,9 s, cap sync, assembleRelease OK. APK **CedPlay-1.12.7.apk** (4 605 463 octets, SHA-256 `99bf1cc43b1880e12f99c37a…`, aapt code 55) installée sur la Hisense (dumpsys code 55 / 1.12.7) ; **Motorola débranché** — à installer dès qu'il est reconnecté (`adb install -r CedPlay-1.12.7.apk`).

## Plateformes : L'Équipe ajoutée et 1.12.8 — 8 novembre 2026

**Demande.** « téléphone branché et oui pour l'equipe » — ajout de L'Équipe aux plateformes de streaming et installation sur le téléphone à la reconnexion.

**Ajout.** Plateforme `lequipe` dans `streamingPlatforms.ts` (Sport & Directs, gratuit avec option Premium) avec paquet Android **`lequipe.fr`** — identifiant inhabituel mais officiel (éditeur « L'Equipe 24 / 24 », vérifié Play Store le 8 novembre 2026) ; URL https://www.lequipe.fr, ouverture dans l'app (App Link sur lequipe.fr si l'app la gère, sinon accueil via `allowAppHome`). Logo vectoriel dédié dans `PlatformLogo.tsx` (pastille rouge #E30613, « L'ÉQUIPE » blanc italique), cohérent avec les tuiles existantes ; tuile visible dans Replay → Plateformes (filtre Sport) et dans la recherche globale.

**Vérification.** 709/709 tests Web (inclut le Lot B de l'autre session en cours), tsc app+node 0, ESLint 0 erreur (18 avertissements), vite build 8,7 s, cap sync, assembleRelease OK. APK **CedPlay-1.12.8.apk** (4 607 473 octets, SHA-256 `f3fafbdfdf6c5cc8aa08a2f2…`, aapt `versionCode='56' versionName='1.12.8'`) installée sur la Hisense (dumpsys code 56 / 1.12.8). **Le téléphone n'apparaît pas en adb** (ni avant ni après redémarrage du serveur adb) : vérifier l'autorisation « Débogage USB » sur le Motorola, puis `adb install -r CedPlay-1.12.8.apk`. Comme pour la 1.12.7, l'APK embarque le travail non commité de la session concurrente (ici son Lot B, tests verts).

**Version.** 1.12.8 / code 56 prise par cette livraison — la suivante sera **1.12.9 / code 57** (fiche CedPlay.md harmonisée).

**Installation 1.12.8 terminée (8 novembre 2026).** Le Motorola est réapparu en adb après déblocage du débogage USB côté téléphone : `adb install -r CedPlay-1.12.8.apk` réussi (dumpsys `versionCode=56 versionName=1.12.8`). Les deux appareils (Motorola Edge 70 + Hisense HiSmartTV A4) sont en 1.12.8 — L'Équipe disponible dans Direct → Plateformes sur les deux.

## 2026-11-08 — Logos de chaînes entiers (object-contain) — session plateformes

- **Demande** : « les logos des chaines sont coupés dans leur forme circulaire, on ne peut pas les voir en entier ».
- **Cause** : `ChannelLogo.tsx` rendait l'image avec `object-cover` — l'image est rognée pour remplir le carré, donc tout logo plus large que haut (ou circulaire touches aux bords) perd ses bords. Le bandeau de zap natif (Java) est déjà en `FIT_CENTER`, le lanceur Android TV délègue au système : seul ce composant web rognait.
- **Correctif** (commit `3ebf54c`) : `object-contain` + léger padding (`p-0.5`), commenté dans le code ; test de non-régression dans `channelLogo.test.tsx` qui interdit le retour d'`object-cover`. Vérifié : tsc app+node 0 erreur, ESLint complet 0 erreur / 18 avertissements, **779/779 tests** (118 fichiers), vite build OK.
- **Coordination multi-sessions** : pendant la vérification, l'autre session a bumpé les fichiers de version vers 1.12.9/code 57 (non commité) — réservation prise en direct ; le correctif logos est donc resté hors version propre et est parti dans la livraison 1.12.9 de l'autre session. Preuve d'embarquement : `object-contain rounded-lg p-0.5` trouvé dans `assets/public/assets/index-Dabjfpju.js` de `CedPlay-1.12.9.apk` (aapt code 57 / 1.12.9, compileSdk 35). Prochaine version libre : **1.12.10 / code 58**.
- **Installation** : Hisense déjà en 1.12.9 (essai reconnexion de l'autre session) ; Motorola passé de 1.12.8 à **1.12.9/code 57** par `adb install -r CedPlay-1.12.9.apk` (dumpsys code 57 / 1.12.9 des deux côtés). Recette visuelle des logos (listes Direct, favoris, recherche) à confirmer par l'utilisateur sur les deux appareils.

## 2026-11-08 — Lot F1 : profil de goût TMDB et justifications « Pour toi »

- **Demande** : « penses tu qu il serait possible d avoir un algorithme capable de me faire des suggestions en fonction de ce que j ai vu ? […] mon probleme etant que je regarde aussi des contenus de youtube et autres plateformes de streaming comme hbo max, prime, arte, netflix ». Le moteur v0 existait déjà (`recommendForHistory`, catégorie + mots du titre) ; la session a décomposé le problème en trois couches (journal / profil / catalogue) et en cinq incréments F1→F5. Céd a choisi **F1, sans nouvel import**.
- **Livré (F1)** :
  - `utils/tasteProfile.ts` (nouveau, pur) — construit un profil pondéré par la fraîcheur (demi-vie 30 j, comme le classement local) à partir des fiches TMDB des films vus : genres, réalisateurs (×2), trois premiers comédiens (×0,75), décennies et films **similaires** TMDB. `matchTaste()` renvoie un score et jusqu'à 3 justifications triées : « Proche de « X » » (similaire TMDB) > « Réalisé par X » / « Avec X » > « Genre : X » > « Années XXXX ».
  - `utils/tasteEnrichment.ts` (nouveau) — résout les fiches TMDB avec un budget réseau borné (12 derniers films vus + 12 meilleurs candidats, 3 requêtes simultanées, cache 12 h de `tmdb.ts`) ; l'identifiant `tmdb_id` du fournisseur est réutilisé avant toute recherche par titre (`searchTmdb` + `pickBestMatch`). Un refus d'authentification remonte pour désactiver le profil ; toute autre erreur est avalée fiche par fiche.
  - `utils/recommendations.ts` — `Recommendation` porte désormais `reasons[]` ; sans profil, le classement et le score sont **inchangés** et la justification locale (« Proche de « Fast and Furious 10 » » / « Même catégorie que « X » ») est produite gratuitement. Avec profil, les 40 premiers candidats sont reclassés (`base normalisé + goût normalisé × 1,5`) : un titre expliqué par les genres, la réalisation ou les similaires peut dépasser un titre simplement proche en titre.
  - `components/VodLibrary.tsx` — enrichissement en arrière-plan (le rail reste affiché pendant la résolution, retombe sur le classement local sans clé TMDB ou hors réseau), désactivé en mode télécommande (aucune requête depuis la box), et justification affichée sous l'affiche + en `title` complet au survol.
- **Preuves locales** : tsc app + node 0 erreur, ESLint complet 0 erreur / 18 avertissements (aucun sur les fichiers ajoutés), **824/824 tests** (124 fichiers, dont 25 nouveaux dans `tasteProfile.test.ts`, `tasteRecommendations.test.ts`, `tasteEnrichment.test.ts`), vite build OK (`index` 639,46 kB / 194,60 kB gzip, `VodLibrary` 72,40 kB). **Aucun essai sur appareil ni sur flux réel dans cette session.**
- **Limites assumées** : la couverture dépend de la clé TMDB et de l'exactitude des titres du fournisseur (`pickBestMatch` n'accepte qu'une égalité de titre normalisé, année comprise) ; un titre non reconnu reste recommandable mais sans justification TMDB ; le profil ne voit que la liste Xtream active, donc YouTube/Netflix/Prime/HBO Max **n'alimentent pas encore** le goût — c'est l'objet de F2 (« Vu ailleurs » + import CSV/JSON, `tmdbId` comme clé de jointure).
- **Version** : rien bumpé ni commité par cette session. Pendant la vérification, la session concurrente a déjà monté les trois fichiers de version à **1.12.11 / code 59** (non commité) : le lot F1 partira avec sa livraison. Prochaine version libre à confirmer après elle.

## 2026-11-08 — Lot F2 : « Vu ailleurs », import Netflix / Prime / YouTube

- **Demande** : suite de l'ordre du plan F1→F5, validée par « go f2 ». Objectif : faire entrer YouTube, Netflix, Prime Video, HBO Max et Arte dans le moteur de recommandation sans nouvel abonnement ni source piratée.
- **Livré (F2)** :
  - `utils/externalWatch.ts` (nouveau, pur) — lecture locale des historiques exportés : CSV Netflix / Prime Video (en-têtes tolérants FR/EN, séparateur `,` ou `;`, guillemets et CRLF), JSON YouTube Takeout (préfixe « Watched » / « A regardé », musique et publicités écartées) et formats CSV/JSON génériques avec `tmdbId`. Dates ISO, `MM/JJ/AAAA` (le format réel des exports), `JJ/MM/AAAA` quand le jour dépasse 12, pointé et année seule ; une date impossible (`31/02`) est refusée, jamais décalée. Les épisodes Netflix (`Titre: Season 1: Episode 1`) sont ramenés à leur série. Dédoublonnage inter-plateformes par titre + année + type, plafond 500 visionnages, 32 Mo par fichier.
  - `utils/idb.ts` — `PlayHistoryEntry` gagne `tmdbId` et `platform` (migration additive, clé de jointure TMDB). Nouveau stockage `externalWatches`, **séparé de l'historique de lecture** : ces titres n'ont pas de flux à reprendre et n'apparaissent donc jamais dans « Reprendre ». Sauvegarde/restauration : union par visionnage, réimport idempotent.
  - `utils/tasteEnrichment.ts` — les visionnages importés entrent dans le profil de goût avec un **échantillon équitable par plateforme** (tourniquet, 12 fiches au total) : un historique YouTube de 2 000 clips ne peut plus écraser Netflix et Prime Video. Une série est résolue côté TMDB `tv`, un film côté `movie` ; un film vu ici **et** ailleurs ne compte qu'une fois.
  - `components/ExternalWatchDialog.tsx` (nouveau) — bouton « Vu ailleurs » dans l'en-tête du rail, dialogue avec choix de plateforme, import immédiat, compte par plateforme, effacement en deux temps et rappel que le fichier reste sur l'appareil. Lecture du fichier avec repli `FileReader` pour les WebView anciennes des box.
  - `components/VodLibrary.tsx` — les films vus ailleurs que le catalogue propose aussi servent d'**amorces locales** (jointure `tmdbId` puis titre + année) : le rail fonctionne donc même sans aucun film lancé dans CedPlay. Classement local et enrichissement TMDB sont neutralisés en mode télécommande (aucun calcul ni requête depuis la box). La ligne de compte (« 42 visionnages ailleurs (38 films) · Netflix 30, YouTube 12 ») et le nombre de fiches TMDB réellement ajoutées au profil sont affichés.
- **Preuves locales** : tsc app + node 0 erreur, ESLint complet 0 erreur / 18 avertissements (aucun sur les fichiers ajoutés), **852/852 tests** (126 fichiers ; 28 nouveaux dans `externalWatch.test.ts`, `externalWatchDialog.test.tsx`, plus 4 dans `tasteEnrichment.test.ts` et 1 dans `tasteRecommendations.test.ts`), vite build OK (`index` 640,44 kB / 194,86 kB gzip, `VodLibrary` 86,24 kB). **Aucun essai sur appareil ni avec un vrai export Netflix/Prime/YouTube dans cette session** : les formats sont couverts par des échantillons représentatifs, pas par les fichiers de Céd.
- **Limites assumées** : YouTube Takeout ne dit pas si une vidéo est un film — la résolution TMDB fait le tri, mais quelques clips peuvent occuper des places d'échantillon (d'où le tourniquet) ; une date ambiguë `05/01/2024` est lue à l'américaine (format des exports Netflix/Prime), l'ISO reste la forme sûre ; le rail reste composé de films du catalogue (les séries importées nourrissent le profil mais ne sont jamais recommandées) ; sans correspondance dans le catalogue ni historique local, il n'y a rien à classer — c'est l'objet de F3/F4 (nouveaux catalogues et sources).
- **Version** : rien bumpé ni commité. Les trois fichiers de version restent à l'état de la session concurrente (**1.12.11 / code 59**, non commité).

## 2026-11-08 — Lot F3 : disponibilité légale TMDB et ouverture de l'app officielle

- **Demande** : suite de l'ordre F1 → F2 → F3, validée par « continue sur f3 ». Objectif : dire **où** un titre suggéré se regarde légalement, et ouvrir en un tap l'application officielle de cette plateforme — sans flux tiers ni contournement d'abonnement.
- **Livré (F3)** :
  - `utils/watchAvailability.ts` (nouveau, pur) — lecture de `/movie|tv/{id}/watch/providers` pour la France : abonnement, gratuit, gratuit avec pub, location, achat. Un fournisseur présent dans plusieurs modes n'apparaît qu'une fois (le plus favorable) ; tri abonnement → gratuit → pub → location → achat, puis priorité TMDB ; plafond 8 pastilles. Les noms TMDB sont rapprochés des plateformes CedPlay par le détecteur déjà utilisé pour les listes (`Amazon Prime Video` → Prime Video, `HBO Max` → Max, `Disney Plus` → Disney+) ; un fournisseur inconnu garde son nom TMDB et retombe sur la page d'offres.
  - `utils/tmdb.ts` — `fetchWatchProviders(id, kind, apiKey)` : même cache 12 h IndexedDB et même déduplication en vol que la recherche et la fiche ; `null` quand le pays n'a aucune offre.
  - `components/WatchProviders.tsx` (nouveau) — bloc « Où regarder en France » dans la fiche : pastilles avec logo TMDB et mode d'accès ; clic → recherche du titre sur le site de la plateforme (`netflix.com/search?q=`, Prime, Disney+, YouTube, Crunchyroll, Arte/france.tv/M6+ déjà utilisés par le Replay) ou accueil pour les sites sans chemin stable, ouvert dans l'app officielle par le pont Android livré en 1.12.6 (`openWeb` + `androidPackages` + `allowAppHome`). Fournisseur sans app connue → page TMDB des offres. Sur le Web, ouverture dans un onglet.
  - `components/TmdbPanel.tsx` — bloc inséré dans la fiche enrichie, films **et** séries, donc disponible depuis le rail « Pour toi » comme depuis la grille, sans requête supplémentaire tant que la fiche n'est pas ouverte.
- **Preuves locales** : tsc app + node 0 erreur, ESLint complet 0 erreur / 18 avertissements (aucun sur les fichiers ajoutés), **871/871 tests** (129 fichiers ; 19 nouveaux : `watchAvailability.test.ts` 11, `watchProviders.test.tsx` 6, `watchProvidersFetch.test.ts` 2), vite build OK (`index` 640,44 kB / 194,87 kB gzip, `VodLibrary` 90,82 kB). **Aucun appel à la vraie API TMDB et aucun essai sur appareil** : le contrat de réponse est couvert par des charges représentatives, le point d'entrée et le cache par un transport simulé.
- **Limites assumées** : pays figé à la France ; TMDB ne connaît que les offres qu'il répertorie (un titre absent peut malgré tout être disponible) ; les adresses de recherche ne sont déclarées que pour les sites au chemin stable, les autres ouvrent l'accueil de l'application (jamais un flux) ; pas de pastille dans le rail lui-même pour ne pas multiplier les appels, la disponibilité est lue à l'ouverture de la fiche ; en mode télécommande, seule la fiche ouverte à la demande déclenche l'appel (cache 12 h).
- **État du WIP** : F1, F2 et F3 restent non commités et **non validés pour livraison** — la contre-vérification `REVUE_F1_F2_2026-11-08.md` reproduit **huit défauts** sur F1/F2 (premier import inaccessible à froid, catalogue complet non chargé sans historique local, dédoublonnage du profil par titre seul, similaires de séries promouvant un film sans rapport, doublons inter-plateformes à la restauration, `2023-02-31` accepté, pointé `05.04.2023` inversé, jointure titre/année trop stricte). F3 n'est pas couvert par ce verdict et n'a pas été exécuté sur appareil.
- **Version** : rien bumpé ni commité. Les trois fichiers de version restent à **1.12.11 / code 59**. Prochaine libre : **1.12.12 / code 60**.


## 2026-11-08 — Contre-vérification F3 uniquement

- Rapport : `REVUE_F3_2026-11-08.md`, preuves et lanceurs : `preuves/revue-f3/`.
- Verdict : deux corrections requises avant livraison — identité des offres distribuées perdue (Amazon Channels ouvre le service autonome), attribution JustWatch absente.
- Preuves : TypeScript app+node 0 erreur, ESLint intégral 0 erreur / 18 avertissements, 19/19 tests F3 verts ; sondes supplémentaires 4 rouges / 1 verte. Vitest lancé par API et compilation en processus après EPERM du lanceur standard.
- Aucun code applicatif modifié. F1/F2 laissés à la session DeepSeek ; aucun bump, commit, APK, appel TMDB réel ou essai appareil. Pas de validation de livraison. Suivi Second Cerveau et entretien non modifiés/exécutés dans cette passe (emplacements hors des racines autorisées en écriture).

## 2026-11-08 — Lot F3 : corrections de la contre-vérification

- **Demande** : « voici le retour gpt sur f3 » — corriger les deux défauts relevés dans `REVUE_F3_2026-11-08.md`, F1/F2 étant traités par la session concurrente.
- **Correctif 1 (offres distribuées)** : rapprochement explicite des fournisseurs TMDB dans `utils/watchAvailability.ts` (`TMDB_PROVIDER_PLATFORMS`, noms normalisés casse/accents/`+`). Le détecteur de listes IPTV n'est plus utilisé : il reconnaissait la marque contenue dans le nom et transformait « HBO Max Amazon Channel » en Max. Les suffixes « … Amazon Channel » / « … Apple TV Channel » sont reconnus comme offres **distribuées** : le nom TMDB complet est conservé, le distributeur est exposé (`distributedBy` : Prime Video / Apple TV+) et c'est l'application du distributeur qui s'ouvre, puisque c'est là que l'offre se regarde. `WatchOffer` gagne `displayName` et `distributedBy` ; la pastille affiche par exemple « HBO Max Amazon Channel via Prime Video ». `watchPlatformName()` reste exporté mais renvoie désormais le nom complet d'une offre distribuée ; la fiche et les tests s'appuient sur `displayName`.
- **Correctif 2 (attribution)** : « Données de disponibilité : JustWatch via TMDB » affiché sous le bloc, y compris quand TMDB ne liste aucune pastille mais expose un lien d'offres.
- **Preuves locales** : tests F3 ciblés **23/23** (3 fichiers ; +4 : deux offres Amazon Channel, une offre Apple TV Channel, une attribution, une ouverture du distributeur). Sondes de la revue rejouées : `node preuves/revue-f3/run-adverse.mjs` → **5/5**, les quatre rouges précédents sont verts (destination Prime Video pour les deux Amazon Channel, nom complet conservé pour l'Apple TV Channel, attribution présente). tsc app+node 0 erreur sur les fichiers F3, ESLint intégral 0 erreur / 18 avertissements, vite build OK (`index` 640,44 kB / 194,87 kB gzip, `VodLibrary` 92,58 kB). **Aucun appel réel à TMDB ni essai appareil.**
- **Suite complète non verte, hors périmètre F3** : `vitest run` → 874/887 tests, 13 échecs dans 5 fichiers F1/F2 (`backup`, `externalWatch`, `tasteEnrichment`, `tasteProfile`, `vodLibrary`) et `tsc` app rapporte des erreurs dans `tasteProfile.test.ts` / `tasteEnrichment.test.ts` : ce sont les fichiers en cours de correction par la session concurrente F1/F2, non touchés ici. À rejouer quand elle aura terminé.
- **Version** : rien bumpé ni commité (1.12.11 / code 59). Prochaine libre : 1.12.12 / code 60.


## 2026-11-08 — F3 : corrections contre-validées indépendamment

- Deux défauts de `REVUE_F3_2026-11-08.md` levés : offres distribuées vers le distributeur avec nom complet conservé ; attribution JustWatch dans les deux branches.
- Rejeu indépendant : 23/23 tests F3 et 5/5 sondes adverses verts, sans modification des sondes lors de cette passe.
- F1/F2 non touchés et non évalués ; pas de validation globale de livraison, d’API réelle ou d’appareil testé. Aucun code applicatif modifié, commit, bump ou APK. Rapport actualisé en conservant la revue initiale.


## 2026-11-08 — Panneaux natifs 55b3f6d : vérifiés, intégration bloquée

- Demande : intégrer le commit des panneaux, vérifier Web/Android, construire un APK et recetter sur Hisense.
- Commit directement basé sur la consolidation `0839ad1`. Revue et candidat isolé sous `preuves/panneaux-charte/` ; rapport `INTEGRATION_PANNEAUX_2026-11-08.md`.
- Candidat : TypeScript app/node verts, ESLint 0 erreur / 18 avertissements ; Web 797/799 au passage global (deux erreurs de cwd), fichier concerné rejoué au bon cwd 4/4 vert ; Android application 35/35 et compilation Java release réussies.
- Fusion refusée : `.git/ORIG_HEAD.lock` non inscriptible. Build Vite standard bloqué par `spawn EPERM` esbuild. Aucun forçage, stash du WIP, bump, commit, push, APK livré ou installation. F1/F2/F3 laissés intacts ; le WIP principal reste hors de la validation de ce candidat.
- Hisense et Motorola accessibles en ADB ; Hisense toujours en 1.12.11/code 59. Recette physique des panneaux non effectuée. Second Cerveau et entretien non exécutés ici, hors racines autorisées en écriture.

## 2026-11-08 — F1/F2/F3 intégrés et livrés en 1.12.13 (code 61)

- **Demande** : « glm corrige f1 et f2 […] Il reste à corriger ce point [CSV « Prime Video » affiché « Autre »], valider l'ensemble, puis intégrer et recetter les trois lots pour la 1.12.13/code 61. »
- **Correctif F2 (dernier défaut de `REVUE_F1_F2_2026-11-08.md`)** : `utils/externalWatch.ts` ramène désormais le libellé de la colonne `platform` à l'identifiant canonique. `PLATFORM_ALIASES` accepte les noms commerciaux écrits par les exports (`Prime Video`, `Amazon Prime Video`, `Amazon Prime`, `Disney+`, `HBO Max`, `YouTube Premium`, `Arte TV`…), `watchPlatformId()` normalise casse, accents et `+`, et `platformLabel()` / `externalSummary()` l'appliquent aussi aux sauvegardes antérieures qui gardent `prime video`. Un libellé inconnu reste inchangé et s'affiche « Autre », il n'est pas inventé. `parseWatchImport` stocke donc `prime` (et non `prime video`) : le dédoublonnage inter-plateformes et l'échantillon équitable par plateforme regroupent enfin les deux formes.
- **Preuves locales** : tsc app + node 0 erreur ; ESLint complet **0 erreur / 18 avertissements** (inchangé, tous préexistants) ; `vitest run` **891/891** (129 fichiers, dont 4 nouveaux dans `externalWatch.test.ts` : récapitulatif avec libellé commercial, fusion ancien libellé + identifiant, alias, libellé inconnu laissé intact) ; sondes indépendantes de la revue F1/F2 **14/14** (`preuves/revue-f1-f2/corrections/vitest.config.ts`, le rouge « Prime Video 1 » est vert) ; sondes F3 **5/5** ; vite build OK (`index` 649,68 kB / 198,49 kB gzip, `VodLibrary` 84,96 kB) ; `assembleRelease` BUILD SUCCESSFUL, `output-metadata.json` versionName 1.12.13.
- **Version** : passée à **1.12.13 / code 61** dans les trois emplacements (`package.json`, `build.gradle`, `SettingsPanel.tsx`). Commit **`33a0641`** sur `consolidate/v1.11.4` (staging fichier par fichier), **sans push**. APK de référence à la racine : `CedPlay-1.12.13.apk` (4 411 316 octets, SHA-256 `040bfba829f8273955cdd837978f975fb3213a7672efe2c0688345df7b10f165`) ; 1.12.12 archivée dans `sauvegardes/apk-1.12.12/`.
- **Recette appareil (faite dans cette session, Android réel)** :
  - **Motorola `ZY22MBQQW7`** : APK installée, l'app s'ouvre sur Direct puis sur « Films & séries ». Dialogue « Vu ailleurs » ouvert, CSV de recette `Title,Date,Platform` / `Inception,Prime Video` / `Dune,Disney+` importé via le sélecteur système → récapitulatif lu à l'écran : « **2 visionnages ailleurs (2 films) · Disney+ 1, Prime Video 1** » (plus aucun « Autre »). Le rail « Pour toi, d'après tes visionnages » affiche ensuite des recommandations (Vertiginous, Haps…) avec la même ligne de compte. Réglages → « CedPlay · 1.12.13 · Direct, films et séries ». Captures : `preuves/livraison-1.12.13-phone-*.png`.
  - **Box `192.168.100.2:5555`** : APK installée, `dumpsys package` → versionCode 61 / versionName 1.12.13, l'écran d'accueil TV s'affiche. Capture : `preuves/livraison-1.12.13-box.png`.
  - **F3 non recetté sur appareil** : aucune clé TMDB n'est renseignée sur les deux appareils (champ vide dans les Réglages), et cette session n'a fait aucun appel réel à TMDB. La recette « Où regarder » (pastilles, offre distribuée « HBO Max Amazon Channel via Prime Video », ligne d'attribution JustWatch) reste à faire une fois la clé saisie.
- **Hors périmètre** : `REVUE_F1_F2_2026-11-08.md`, `REVUE_F3_2026-11-08.md`, les dossiers `preuves/revue-*` restent non suivis (comme tout `preuves/`, non versionné). Rien poussé.


## Acces facile au fichier APK - 8 novembre 2026

Copie identique du candidat corrige (SHA-256 38177df9...) dans le dossier principal : A-installer/CedPlay-1.12.16.apk, pour permettre a Ced de retrouver le fichier. Aucun APK de reference remplace et aucune installation effectuee.

## 2026-11-09 - Accès au guide TV depuis Direct

- Signalement : grille des programmes introuvable sur TV. Le bouton Guide TV était placé après tous les groupes fournisseur dans TvLiveScreen.
- Correction : Guide TV en troisième position, après Toutes et Favoris, avant les listes personnelles et groupes. Branchement existant vers EPGGrid conservé.
- Validation : TypeScript app/node OK, ESLint intégral 0 erreur / 18 avertissements via npm run verify (pnpm absent du PATH). Lanceur standard Vitest et build Vite bloqués par spawn EPERM esbuild. Lanceur alternatif du projet : 40/40 tests ciblés verts (Direct TV, ordre des catégories, navigation télécommande, interactions EPG), preuve preuves/tv-guide-tests.log. Test ajouté avec 100 groupes.
- Aucun APK produit ou remplacé, aucune version montée, aucun essai physique ni flux réel. Validation globale et livraison restent à faire ; la TV conserve son ancienne version.
- Second Cerveau et commandes entretien non exécutés : destination hors des racines autorisées en écriture.

## 2026-11-09 - Livraison 1.12.36 (code 84) : Guide TV accessible depuis Direct

- Reprise de la section précédente : la correction était dans l'arbre mais rien n'était compilé (EPERM d'esbuild annoncé). L'EPERM ne se reproduit pas : `vite build` passe en 8,79 s, `vitest run` passe en entier. `pnpm` reste absent du PATH, binaires locaux utilisés.
- Validation complète : `tsc` app et node 0 erreur ; ESLint intégral (`eslint ./src`, sans `--quiet`) 0 erreur / 18 avertissements ; `vitest run` **1009/1009** (140 fichiers) ; `vite build` OK (dist 2,8 Mo, aucun .map) ; `cap sync android` puis `assembleRelease` **BUILD SUCCESSFUL**.
- Version : **1.12.36 / code 84** dans les trois emplacements (`package.json`, `build.gradle`, `SettingsPanel.tsx`). APK 4 431 397 octets, SHA-256 `69a5a19adf8cd8e285a61f36a3334f760013773c2db501cbbee6dc623064c759`, même certificat `f3f2371b…`. Référence à la racine : `CedPlay-1.12.36.apk` + `CedPlay.apk` ; 1.12.35 archivée dans `sauvegardes/apk-1.12.35/`.
- Recette box `192.168.100.2:5555` (Hisense, adb) : `install -r` OK, `dumpsys package` → versionCode 84 / 1.12.36. Direct → colonne de gauche : Toutes, Favoris, **Guide TV** en troisième position (capture `preuves/livraison-1.12.36-box-guide-tv.png`), deux `keyevent 20` depuis Toutes, OK → grille ouverte et chargée en ~10 s (« Guide actualisé · 9 nov., 16:17 », détail du programme TMC, capture `preuves/livraison-1.12.36-box-guide-ouvert.png`). Flèches Bas/Droite déplacent le focus dans le guide (anneau sur « Grille »), Retour ramène au Direct avec la sélection conservée (`preuves/livraison-1.12.36-box-retour-direct.png`) : télécommande vivante.
- Limites : recette aux `input keyevent` adb, pas à la vraie télécommande ; Motorola non connecté lors de cette session, donc non mis à jour (resté en 1.12.35/code 83).

## 2026-11-09 - Livraison 1.12.37 (code 85) : le guide ne rechargera plus 45 Mo à chaque démarrage

- Signalement de Céd après essai de la 1.12.36 : « 15 secondes de chargement pour voir ça ». Deux défauts réels, mesurés sur la box et non supposés.
- **Cause 1, cache jamais écrit** : le guide Xtream de la liste active pèse **45-46 M caractères** (relevé dans IndexedDB : 46 469 862 chars, 3 911 chaînes, 261 548 émissions). `epg.ts` refusait de cacher tout XML au-delà de `MAX_CACHED_XML_CHARS = 12 000 000` : chaque démarrage retéléchargeait et réanalysait tout. `fetchedAt` changeait à chaque ouverture (16:17 puis 16:36), preuve du cache manqué.
- **Correctif cache** : plafond porté à 64 M caractères (cache en IndexedDB, pas en localStorage) ; horodatage de vérification séparé (`epgCache_<id>_checked`) pour ne pas réécrire 45 Mo ; si le contenu retéléchargé est identique, l'horodatage de contenu est conservé et le cache analysé reste valide (zéro re-parse).
- **Chemin chaud** : `peekParsedEPGCache` + `isEPGCacheFresh` + fiche d'index `epgParsedMeta_<id>` permettent de charger l'analyse sans relire les 45 Mo de XML. Mesures sur la box (repères `performance.mark`, build debug) : démarrage 2,8 s -> EPG prêt en **3,2 s** au lieu de 4,5 s (XML lu inutilement).
- **Cause 2, guide illisible** : viewport CSS réel 960×540 (dpr 2). Bandeau TV de 168 px + en-têtes qui passaient à la ligne laissaient une zone défilante de **88 px, soit une seule ligne de chaîne**. Correctif : bandeau retiré du flux (aperçu en superposition), en-têtes non repliés, « Rechercher » en icône sur TV, `ROW_HEIGHT` 64 -> 56. Mesure après : zone défilante **272 px, 4 lignes visibles** (captures `preuves/livraison-1.12.37-box-guide-1s.png`, `-charge.png`).
- **Optimisations** : `normalizePrograms` renvoie la liste triée telle quelle (plus de copie+tri O(n log n) par chaîne) ; filtre de plage par recherche binaire (`hasProgramInRange`) ; déballage du cache sans spread conditionnel ; largeur visible bornée dès la première peinture (la grille rendait les 7 jours au lieu de l'écran).
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1015/1015** (140 fichiers) ; `vite build` OK ; `assembleRelease` OK. Version **1.12.37 / code 85** aux trois emplacements. APK 4 431 535 octets, SHA-256 `55688f3c0c0c53fe31f7c23a172a5b81cf8cb8910dec5a351c9c46feaf9ddb8f`, certificat `f3f2371b…`, installée sur la box (`dumpsys` code 85). Référence à la racine : `CedPlay-1.12.37.apk` + `CedPlay.apk` ; 1.12.36 archivée dans `sauvegardes/apk-1.12.36/`.
- **Recette release sur la box** : Direct -> Favoris -> Bas -> Guide TV -> OK. La coquille du guide (lignes de chaînes) est peinte en **1 s**, complète avec les programmes en **3 s** ; 4 lignes visibles au lieu d'une.
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; Motorola non connecté, reste en 1.12.35/code 83 ; les 3,2 s de lecture du cache analysé (44 Mo) restent le plancher mesuré sur cette box.

## 2026-11-09 - Livraison 1.12.38 (code 86) : aperçu 16:9 et flèche gauche vers les programmes précédents

- Signalement de Céd après essai de la 1.12.37 : « apercu quasiment invisible, navigation sur la gauche impossible pour voir les programmes precedents. mais il faut garder un moyen de pouvoir revenir aux noms des chaines sur la gauche ». Deux défauts reproduits sur la box avant correction.
- **Cause 1, aperçu sans hauteur** : la classe `aspect-video` utilisée par `EPGGrid.tsx` **n'existe pas dans le CSS produit**. Le plugin `@tailwindcss/aspect-ratio` remplace le thème `aspectRatio` par ses valeurs 1..16 et fait disparaître l'entrée `video` ; vérification dans `dist/assets/index-*.css` : aucun `.aspect-video`, seulement `aspect-ratio:2/3` (affiches). Le cadre de 160 px de large n'avait donc aucune hauteur et s'effondrait sur son texte (~16 px). En plus, il était ancré en `top-3` et recouvrait le bouton « Actualiser ».
- **Correctif aperçu** : hauteur portée par un style en ligne `aspectRatio: '16 / 9'` (indépendant du plugin), largeur **256 × 144**, ancré dans la zone de grille **sous l'axe des heures** (wrapper relatif autour du scroller, `top: 48`), et affiché seulement quand une émission est ciblée (plus de rectangle noir inerte à l'ouverture). L'aperçu **s'efface automatiquement quand il recouvrirait l'émission ciblée** (mesure du rectangle de la case après le focus) et revient quand le focus s'en écarte ; le flux natif est arrêté dans ce cas.
- **Cause 2, gauche allait au nom de chaîne** : la colonne des noms est `sticky left-0`. La navigation géométrique préférait ce bouton collé (écart 0) au programme précédent hors écran ; de plus `scrollIntoView(inline: 'nearest')` alignait la **fin** d'une émission longue (5 h), ce qui faisait sauter la grille à 19:00 et laissait le programme précédent sous la colonne. Reproduit : 5 droites puis gauche → focus sur « FR: TF1 +1 FHD » (nom), pas sur l'émission.
- **Correctif navigation** : les noms de chaînes restent **fixes et visibles** à gauche mais sortent du focus télécommande (`tabIndex=-1`) ; gauche/droite parcourent explicitement les émissions de la ligne (`data-program-start`, `data-guide-row`) au lieu de la géométrie ; toute case focalisée est ramenée **à droite de la colonne**, jamais dessous, en alignant son **début** si elle est plus large que la zone visible ; au bord de la frise le focus reste sur place ; `Bas` depuis la barre d'outils du guide entre par l'émission **en cours** de la première ligne visible (`data-guide-entry`), y compris depuis les boutons Liste/Grille/Lecteur qui vivent hors du composant (événement `guide-focus-entry`). Les noms restent cliquables à la souris ; la vue « Liste » reste le moyen de parcourir les chaînes au focus.
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1018/1018** (140 fichiers, 3 tests neufs : gauche ouvre l'émission précédente et pas le nom, gauche au bord reste sur place, Bas depuis la barre entre par l'émission en cours) ; `vite build` OK ; `assembleRelease` **BUILD SUCCESSFUL**.
- **Version** : **1.12.38 / code 86** aux trois emplacements. APK 4 432 501 octets, SHA-256 `ba83cb5690df548d800cb16016393d5806ba342f10e1f39c4e9bf298b3585bef`, certificat `f3f2371b…`, installée sur la box (`dumpsys` code 86). Référence à la racine : `CedPlay-1.12.38.apk` + `CedPlay.apk` ; 1.12.37 archivée dans `sauvegardes/apk-1.12.37/`.
- **Recette box (build final, adb)** : ouverture du guide à `maintenant − 30 min` ; deux `Bas` depuis l'onglet Direct (Liste → entrée) placent le focus sur « New York Unité… 17 h 05 – 17 h 55 » ; `Gauche` → « 16 h 15 – 17 h 05 » entièrement visible à droite des noms de chaînes, aperçu 256×144 en lecture (captures `preuves/livraison-1.12.38-box-guide-entree.png`, `-precedent.png`, `-apercu.png`). Cinq `Droite` amènent le focus sur « Programmes de la nuit » : l'aperçu s'efface pour ne pas masquer l'émission (`-apercu-efface.png`) ; en revenant à gauche il réapparaît et rejoue le flux. Les noms de chaînes restent visibles pendant tout le défilement.
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; Motorola non connecté, reste en 1.12.35/code 83 ; l'aperçu en superposition masque une partie de la grille tant qu'il est visible (il s'efface sur recouvrement, mais ne se déplace pas) ; le défaut global `aspect-video` absent du CSS reste présent pour les autres écrans qui l'utilisent (`LocalLibrary`, `VideoPlayer`, `ReplayHub`) — non corrigé ici pour ne pas changer leurs mises en page sans recette, à traiter séparément.

## 2026-11-09 - Livraison 1.12.39 (code 87) : le texte du guide reste lisible au bord des chaînes

- Question de Céd sur une photo du guide calé sur 19 h 00 : « à quoi se réfèrent les 1 1 1 1 ? ». Ce sont les **débuts d'heure coupés par la colonne des chaînes** : les lignes TF1 affichent « Programmes de la nuit 18 h 45 – 22 h 50 », la colonne recouvre « 18 h » et il reste un fragment qui ressemble à « 1 » ; France 2 affiche « Au bout de l'enquête 18 h 50 – 19 h 40 », dont le « 8 » coupé ressemble à « 3 ». Le titre subit la même coupe (« Programmes » → « grammes »). Aucune donnée n'est fausse : c'est l'affichage qui commence sous la colonne fixe.
- **Choix UX** : plutôt que de masquer le texte (une grande case traversant l'écran deviendrait un bloc vide) ou de laisser un fragment, le **titre et l'heure collent au bord droit de la colonne** tant que le début de l'émission est hors de la vue. Implémentation CSS : wrapper `position: sticky` avec `left = colWidth + 8`, `w-max max-w-full`, et la case n'a plus `overflow-hidden` (les textes ont déjà leur propre troncature). Dès que le début de la case entre dans la vue, le texte reprend sa place ; une case réduite à un mince reste affiche une fin de libellé tronquée avec « … ».
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1019/1019** (140 fichiers, test neuf : le texte est bien dans un wrapper `sticky` à `left: 208px` pour une colonne de 200 px) ; `vite build` OK ; `assembleRelease` OK.
- **Version** : **1.12.39 / code 87** aux trois emplacements. APK 4 432 538 octets, SHA-256 `e5979123be75c8c9155cec79b062188d0fdbbf003dd862bb08962f984f35fa6a`, certificat `f3f2371b…`, installée sur la box (`dumpsys` code 87). Référence à la racine : `CedPlay-1.12.39.apk` + `CedPlay.apk` ; 1.12.38 archivée dans `sauvegardes/apk-1.12.38/`.
- **Recette box** : guide ouvert par l'entrée, focus sur « New York Unité… 17 h 55 – 18 h 45 » (vue calée à 17 h 55) ; la case France 2 commencée à 17 h 21 affiche **« Tout le monde ment 2 · 17 h 21 – 18 h 50 » en entier** au bord droit de la colonne au lieu d'un fragment (capture `preuves/livraison-1.12.39-box-guide-texte-colle.png`).
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; Motorola non connecté, reste en 1.12.35/code 83 ; le collage repose sur `position: sticky` dans une ligne transformée, vérifié sur la WebView de la box mais pas sur le Motorola ; les cases très étroites en bord de vue gardent une fin de libellé tronquée (« … »).



## 2026-11-09 — Audit transversal Web / mobile / tablette / TV

- Rapport : `AUDIT_MULTISUPPORT_2026-11-09.md`. Revue du candidat 1.12.40/code 88 au-dessus de HEAD 9878a41 ; sept fichiers applicatifs déjà modifiés, laissés intacts. Aucun APK produit/installé ni correction applicative.
- TypeScript app/node : succès. ESLint intégral : 0 erreur, 18 avertissements. `npm run verify` (même script que pnpm) bloqué au lancement Vitest par spawn EPERM esbuild ; build séparé bloqué identiquement. Tests Android bloqués par accès refusé au verrou Gradle. Audit dépendances inaccessible (ECONNREFUSED registre). Ne pas annoncer ces contrôles verts.
- adb : seule TV Hisense Android 9 connectée, 1.12.40/code 88. Capture réelle du guide avec aperçu central : `preuves/audit-tv-2026-11-09.png`. Pas de parcours télécommande effectué, ni recette mobile/tablette. Les APK de référence racine restent 1.12.39 et identiques.
- Priorités du rapport : plafonds mémoire après allocation, reprise DVR TS, expiration dataSync Android 15, seuil WebView, réarmement des alarmes. Autres constats : portée incohérente autoReconnect, écran allumé dans les menus, secrets affichés/exportés, erreur persistante ChannelLogo, diagnostic des plantages.
- Second Cerveau et entretien non exécutés : destinations hors des racines autorisées en écriture. Rapport et preuves disponibles dans le dépôt.

## 2026-11-09 - Livraison 1.12.40 (code 88) : l'aperçu vidéo occupe le bandeau du guide

- **Demande de Céd** (photo annotée) : « l'aperçu vidéo en haut au milieu me paraît bien adapté ici. Il occuperait le grand espace vide sans masquer les programmes. À gauche : Liste / Grille / Lecteur. Au centre : aperçu vidéo 16:9. À droite : titre et horaires du programme sélectionné, avec les actions du guide. La date et Maintenant resteraient juste au-dessus de la grille. Il faut garder ce bandeau assez compact. » Puis, après une première version à 144 × 81 : « écran trop petit, idéalement il pourrait occuper un peu plus d'espace pour être vraiment visible sans toucher les bords et en gardant une symétrie verticale avec les éléments à gauche et à droite ».
- **Ce qui change** : l'aperçu quitte la surcouche de la grille (il masquait des cases et devait s'effacer) et devient un cadre 16:9 de **176 × 99** au centre du bandeau. `EPGGrid` reçoit la barre Liste/Grille/Lecteur par une prop `toolbar` : à gauche du bandeau en TV, dans le `CardHeader` de la carte sur téléphone. À droite : fraîcheur du guide + Actualiser, titre, chaîne et horaires de l'émission ciblée (repli sur la chaîne en cours quand aucune case n'a le focus). La date, « Maintenant », la recherche et les réglages restent sur leur ligne au-dessus de la grille. Le cadre garde 4 px de marge en haut et en bas et son centre est aligné sur celui des boutons (gauche) et du texte (droite).
- **Place gagnée** : boutons de la ligne de date à 32 px en TV et padding bas du panneau à 8 px ; les **quatre lignes de chaînes restent entièrement visibles**.
- **Simplification** : plus d'état `previewCovered` ni de mesure de recouvrement ; le pont natif ne reçoit que le rectangle du bandeau. L'aperçu démarre dès que le focus entre dans le guide (repli sur la chaîne en cours) et s'arrête quand une fiche ou la recherche s'ouvre, ou quand le focus quitte le guide.
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1021/1021** (140 fichiers ; deux tests neufs : le bandeau réunit les trois zones et annonce l'émission ciblée, Bas depuis Liste entre par l'émission en cours ; le test d'aperçu vérifie le 16:9 dès l'ouverture) ; `vite build` OK ; `assembleRelease` OK.
- **Version** : **1.12.40 / code 88** aux trois emplacements. APK **4 432 589 octets**, SHA-256 `a0a0414f8fdbd738f6e2b358770f6d6ca8246738987d1144a6759611aec4f960`, certificat `f3f2371b…`, installée sur la box (`dumpsys` code 88 / 1.12.40). Référence à la racine : `CedPlay-1.12.40.apk` + `CedPlay.apk` ; 1.12.39 archivée dans `sauvegardes/apk-1.12.39/`.
- **Recette box** (captures `preuves/livraison-1.12.40-box-guide-bandeau.png` et `-gauche.png`) : Liste/Grille/Lecteur à gauche, aperçu TF1 176 × 99 au centre, « New York Unité Spéciale / FR: TF1 +1 FHD · 17 h 55 – 18 h 45 » à droite, quatre lignes entières dessous ; Gauche ouvre l'émission précédente et met à jour le bandeau ; l'aperçu ne recouvre plus aucune case.
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; Motorola non connecté, reste en 1.12.35/code 83 ; le bandeau sur téléphone n'a pas été parcouru (la barre y reste dans l'en-tête de la carte) ; un premier Bas depuis le bandeau a visé la 3e ligne visible avant de se stabiliser sur la première — à reconfirmer à la télécommande.

## 2026-11-09 - Livraison 1.12.41 (code 89) : focus blanc, émissions à venir et horaires du guide

- **Origine** : proposition extérieure `proposition_ecran_direct_tv.md` (agent Antigravity) relayée par Céd. Trois points seulement ont été retenus, après vérification sur la WebView de la box : le reste (aperçu « héros » à 38 % de la largeur, flou d'arrière-plan, badges dessinés en HTML par-dessus la vidéo) a été écarté — deux lignes de chaînes perdues, flou indisponible avant Android 12, et surtout la vidéo est une `TextureView` native posée **au-dessus** de la WebView : aucun élément HTML ne peut s'y superposer.
- **Focus** : dans le guide, le focus de la télécommande devient **blanc** (`.remote-navigation [data-program-start]:focus`) ; l'orange reste le repère du programme en cours et du bouton « Regarder la chaîne ». Ailleurs, l'anneau de focus orange ne change pas.
- **Émission à venir** : cibler une émission non commencée ne lance plus le direct de la chaîne (le cadre montrait l'image d'un autre programme sous ce titre). Le cadre 176 × 99 affiche une horloge, **« À 20 h 25 »** et « Programme à venir » ; `previewUrl` exclut les émissions futures et l'état manuel repart à zéro quand la chaîne ciblée change.
- **Horaires** : `font-mono` → **`tabular-nums`** dans les cases, le bandeau et l'axe des heures (11 px dans les cases, 12 px sur l'axe) : les chiffres restent alignés en colonne sans l'aspect machine à écrire.
- **Performance** : `programsInRange` (dichotomie sur les émissions triées) remplace le balayage linéaire de chaque ligne à chaque défilement ; les programmations Android sont indexées par URL (`isScheduled`) au lieu de rappeler `findScheduled` pour chaque case affichée.
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1022/1022** (140 fichiers ; test neuf : une émission future n'appelle pas `showPreview` et affiche son heure) ; `vite build` OK ; `assembleRelease` OK.
- **Version** : **1.12.41 / code 89** aux trois emplacements. APK **4 432 759 octets**, SHA-256 `b57420c466977312a90219d2d01d62583cac75702f5d9c0e1a6af27976b10c52`, certificat `f3f2371b…`, installée sur la box (`dumpsys` code 89). Référence à la racine : `CedPlay-1.12.41.apk` + `CedPlay.apk` ; 1.12.40 archivée dans `sauvegardes/apk-1.12.40/`.
- **Recette box** (captures `preuves/livraison-1.12.41-box-guide-focus-blanc.png`, `-emission-future.png`, `-apercu.png`) : anneau blanc sur la case ciblée, « À 20 h 25 / Programme à venir » sur l'émission future de France 2, aperçu du direct toujours en lecture sur l'émission en cours.
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; Motorola non connecté, reste en 1.12.35/code 83 ; après une lecture plein écran de TF1+1, l'aperçu du guide a affiché « Aperçu indisponible » — probable limite de connexions simultanées du fournisseur, non reproduit hors de ce cas ; **3 lignes entières + la 4e coupée** par le bas de la carte à 540 px (contrairement à ce qu'annonçait la 1.12.40), visible sur la capture ; la refonte du bandeau elle-même restait à faire — c'est l'objet de la 1.12.42.

## 2026-11-09 - Livraison 1.12.42 (code 90) : refonte du bandeau du guide TV

- **Demande de Céd** : « ma demande concernait la refonte du haut avec liste / grille / lecteur / pip / nom du programme etc qui est simplement indigne de cette plateforme. » Deux maquettes 960 × 540 ont été soumises (A compact, aperçu 176 × 99, 4 lignes ; B aperçu héros 256 × 144, 3 lignes). Réponse : « super, go. mais attention les lignes des chaines sont ramassees sur elles meme dans la demo. » → **direction A** retenue (elle ne coûte aucune ligne de chaîne), et le tassement venait de la maquette mise à l'échelle : dans l'app les lignes restent à **56 px fixes**.
- **Ce qui change** : le bandeau devient un seul bloc arrondi lu de gauche à droite — sélecteur segmenté **Liste / Grille / Lecteur** (fond orange sur la vue active, anneau de focus blanc par-dessus), aperçu 16:9 176 × 99, puis l'émission ciblée : nom de chaîne en petites capitales, pastille **EN DIRECT** orange (ou « À VENIR » / « Terminé »), heure de dernière actualisation du guide (bouton ↻), titre sur deux lignes, horaires + barre de progression + **« reste 3 h 40 »**. Le libellé « Guide actualisé · 9 nov., 16:43 » et le bouton texte « Actualiser » disparaissent au profit du ↻ horodaté (infobulle = libellé complet). La ligne de date passe en commandes rondes et « Maintenant » en pastille. Sur téléphone, la barre Liste / Grille / Lecteur garde ses trois boutons dans l'en-tête de la carte.
- **Détails** : progression calculée sur l'émission en cours, jamais affichée pour une émission à venir ou terminée ; « reste » arrondi à la minute, en heures/minutes au-delà d'une heure ; aucun badge HTML sur la vidéo (le cadre natif reste une `TextureView` au-dessus de la WebView). Le bouton ↻ garde son nom accessible « Actualiser ».
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1026/1026** (140 fichiers ; le test du bandeau vérifie chaîne, « En direct », horaires et « reste N min » ; le test de l'émission future vérifie la pastille « À venir » et l'absence de « reste ») — ce total inclut les 4 tests `programsInRange` ajoutés avec la 1.12.41 ; `vite build` OK ; `assembleRelease` OK.
- **Version** : **1.12.42 / code 90** aux trois emplacements. APK **4 433 707 octets**, SHA-256 `5b2e9052e649ffb3497e0461cf4165b08522b4097a34ce900f5db8864cb13a76`, certificat `f3f2371b…`, installée sur la box (`dumpsys` versionName 1.12.42). Référence à la racine : `CedPlay-1.12.42.apk` + `CedPlay.apk` ; 1.12.41 archivée dans `sauvegardes/apk-1.12.41/`.
- **Recette box** (captures `preuves/livraison-1.12.42-box-guide-bandeau.png`, `-bandeau-apercu.png`, `-bandeau-avenir.png`, `-bandeau-focus.png`) : bandeau complet à l'ouverture, aperçu en lecture après Bas, bandeau qui suit la chaîne ciblée (TF1+1 → TF1 FHD, titre, « reste 3 h 40 »), émission future de France 2 avec « À VENIR », horloge « À 20 h 25 » et ni progression ni reste, anneau blanc sur la case ciblée et sur le segment actif « Grille ».
- **Lignes de chaînes** : mesurées sur la capture à 112 px physiques, soit **56 px CSS** (quatre séparateurs), identiques à la 1.12.41 : 3 lignes entières + la 4e coupée d'environ 10 px par le bas du panneau. Aucun tassement.
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; Motorola non connecté, reste en 1.12.35/code 83 ; le segment « Lecteur » n'a pas été actionné sur la box (il lance la lecture plein écran, dont la sortie recharge la WebView) — couvert seulement par les tests unitaires ; depuis « Maintenant », Haut atteint le bandeau après un détour par la première ligne ; l'affichage téléphone n'a pas été parcouru.

## 2026-11-09 - Livraison 1.12.43 (code 91) : aperçu à gauche, quatre lignes de guide garanties

- **Retour de Céd sur la 1.12.42** : « trop d'espace a droite de la presentation, alors que la presentation est COLLEE a l ecran, aucune harmonie pour le moment » puis « ecran a gauche comme dans B mais avec une autre disposition du reste car je veux mes 4 lignes de programme (AU MOINS) ». La 1.12.42 empilait segments + aperçu + texte à gauche et laissait un grand vide à droite.
- **Ce qui change** : l'aperçu passe **à gauche** et grandit (176 × 99 → **132 px de haut en 16:9, soit ~234 px de large**) ; la ligne de date disparaît en TV et ses commandes entrent dans le bandeau. Quatre lignes remplissent la largeur : **1)** sélecteur segmenté + heure d'actualisation à droite ; **2)** chaîne + EN DIRECT/À VENIR + navigation de date + Maintenant + recherche + réglages ; **3)** titre sur deux lignes ; **4)** horaires + barre de progression extensible + « reste 3 h 07 ». Plus de zone vide à droite : le bandeau occupe toute la largeur du panneau.
- **Pourquoi 132 px et pas 256 × 144 (B)** : le panneau TV mesure 412 px de haut ; quatre lignes de 56 px + l'axe de 44 px = 268 px, il reste 144 px pour le bandeau et ses marges. Un aperçu de 144 px, son cadre (2 px), son padding (4 px) et la marge (4 px) déborderaient de 10 px et couperaient la quatrième ligne. 132 px est le maximum qui garde **quatre lignes entières** ; `PREVIEW_HEIGHT` porte cette contrainte en commentaire. Pour la même raison, `.live-view-content` perd sa marge basse de 8 px en TV.
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1026/1026** (140 fichiers) ; `vite build` OK ; `assembleRelease` OK.
- **Version** : **1.12.43 / code 91** aux trois emplacements. APK **4 433 753 octets**, SHA-256 `a39d35fa3280658be7eb100b3043814a1618106f57166b9c67ce9ce860935e96`, certificat `f3f2371b…`, installée sur la box. Référence à la racine : `CedPlay-1.12.43.apk` + `CedPlay.apk` ; 1.12.42 archivée dans `sauvegardes/apk-1.12.42/`.
- **Recette box** (captures `preuves/livraison-1.12.43-box-guide-bandeau.png` et `-bandeau-gauche.png`) : aperçu en lecture à gauche, sélecteur, date, recherche et réglages répartis jusqu'au bord droit, quatre lignes entières (la dernière se termine à ~8 px du bas du panneau), focus blanc sur la case, titre et « reste 3 h 07 » à jour.
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; un décalage ponctuel entre la case en focus et le programme annoncé dans le bandeau a été vu une fois juste après l'ouverture du guide, puis plus reproduit (le focus suivant a réaligné les deux) — à reconfirmer ; segment « Lecteur » non actionné sur la box ; affichage téléphone non parcouru ; Motorola reste en 1.12.35/code 83.

## 2026-11-09 - Livraison 1.12.44 (code 92) : sélecteur aligné sur l'aperçu, APK de partage

- **Demande de Céd** : « relève un peu le bloc liste grille lecteur pour le séparer un peu plus du nom du programme et ce sera parfait, il reste un peu d'espace au-dessus, jusqu'au niveau de la limite haute du mini écran. Et après on n'y touche pas. Prépare une APK que je pourrai passer à mes amis. »
- **Ce qui change** : la colonne de droite du bandeau passe de `justify-center` à **`justify-between`** : le sélecteur Liste/Grille/Lecteur et l'heure d'actualisation s'alignent sur le **bord haut de l'aperçu**, les horaires et la progression sur son bord bas, et l'espace gagné sépare la barre de vues du nom du programme. Rien d'autre ne bouge : aperçu 132 px à gauche, quatre lignes de 56 px, date et commandes dans le bandeau.
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1026/1026** (140 fichiers) ; `vite build` OK ; `assembleRelease` OK.
- **Version** : **1.12.44 / code 92** aux trois emplacements. APK **4 433 776 octets**, SHA-256 `752d8cc9e4eacaee3c91129c25edc5a7d2d7bfd0484a5e51b1b8806cb0a8f535`, certificat `f3f2371b…`, `minSdk 22` / `targetSdk 35`, installée sur la box (`versionName 1.12.44`). Référence à la racine : `CedPlay-1.12.44.apk` + `CedPlay.apk` ; 1.12.43 archivée dans `sauvegardes/apk-1.12.43/`.
- **Recette box** (capture `preuves/livraison-1.12.44-box-guide-bandeau.png`) : sélecteur aligné sur le haut de l'aperçu, écart visible avant « FR: TF1 +1 FHD », aperçu en lecture, quatre lignes entières.
- **APK de partage** : c'est `CedPlay.apk` (copie de `CedPlay-1.12.44.apk`). Même clé de signature que toutes les versions livrées (obligatoire pour que la box de Céd se mette à jour sans désinstallation), APK universelle de 4,4 Mo, `minSdk 22` (Android 5.1 et plus), installation hors magasin en autorisant les sources inconnues. Rien d'autre n'est modifié dans le code.
- **Téléphone** : le Motorola `ZY22MBQQW7` était resté en 1.12.35/code 83 ; il a été mis à jour le même soir en **1.12.44/code 92** (installation directe, données conservées) puis lancé : l'écran Direct s'affiche (Liste/Grille/Lecteur, recherche, filtre qualité, liste des chaînes) et le lecteur repart en fenêtre **PiP** quand on quitte la lecture. Capture `preuves/tel-1.12.44-direct.png`.
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; l'APK de partage n'a pas été installée sur un appareil tiers (box et Motorola de Céd seulement).

## 2026-11-09 - Livraison 1.12.45 (code 93) : aperçu collé au bord du cadre

- **Demande de Céd** : « ne pourrait on pas pousser l'écran mini complètement au bord du cadre ? ça fait bizarre avec un petit espace sur la gauche pour le moment. Et le cadre liste / grille / lecteur pourrait être très légèrement baissé. »
- **Ce qui change** : le bandeau perd son padding gauche et vertical (`px-3 py-0.5` → `pr-3`) ; l'aperçu 16:9 touche donc le **bord gauche, le haut et le bas du cadre**, avec `rounded-l-2xl` pour reprendre le rayon du bandeau et `rounded-r-xl` côté contenu — plus de bordure propre (celle du cadre suffit) ni d'ombre interne. Le sélecteur Liste/Grille/Lecteur est **baissé de 4 px** (`pt-1` sur la colonne de droite) et reste séparé du nom du programme par l'espace distribué (`justify-between`). Le bandeau mesure 134 px au lieu de 138 : la grille gagne 4 px et garde **quatre lignes entières**.
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1026/1026** (140 fichiers) ; `vite build` OK ; `assembleRelease` OK.
- **Version** : **1.12.45 / code 93** aux trois emplacements. APK **4 433 719 octets**, SHA-256 `56e7761dfd603df24ca150cb5e089329f67e72886e23aa541f65e4881d85cab7`, certificat `f3f2371b…`, installée sur la box **et sur le Motorola** (`versionName 1.12.45` sur les deux). Référence à la racine : `CedPlay-1.12.45.apk` + `CedPlay.apk` (à jour, c'est le fichier de partage) ; 1.12.44 archivée dans `sauvegardes/apk-1.12.44/`.
- **Recette box** (capture `preuves/livraison-1.12.45-box-guide-bandeau.png`) : aperçu en lecture collé au bord gauche du cadre, sélecteur légèrement descendu, titre et horaires inchangés, quatre lignes entières.
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande ; le rayon natif de l'aperçu reste 12 px alors que le coin gauche du cadre est à 16 px (écart invisible derrière la vidéo) ; l'APK de partage n'a pas été installée sur un appareil tiers.

## 2026-11-09 - Livraison 1.12.46 (code 94) : retour aux résultats de recherche et recherches récentes

- **Demande de Céd** : « je n'ai pas la possibilité de revenir aux résultats de ma recherche après avoir cliqué sur un des résultats. Et ça ne garde pas en mémoire les recherches passées. »
- **Cause** : dans `GlobalSearchDialog`, un résultat film/série appelait `onSelectVod` **puis fermait la fenêtre** ; à la réouverture, un effet remettait `query` à zéro. Résultats, requête et position disparaissaient dès l'ouverture d'une fiche.
- **Ce qui change** :
  - **La recherche survit à l'ouverture d'une fiche** : le clic sur un film ou une série ne ferme plus le dialogue. La fiche s'ouvre par-dessus ; « Retour » la referme et ramène aux résultats, requête et liste intactes. Les chaînes, plateformes et replays continuent de fermer la recherche (on quitte l'écran pour regarder ailleurs).
  - **Recherches récentes** : nouvel utilitaire `src/utils/searchHistory.ts` (localStorage `cedplay_search_history`, clé propre à l'appareil). Les **huit** dernières requêtes sont gardées, dédoublonnées sans tenir compte de la casse, et affichées sous le champ quand il est vide, au-dessus des « Recherches populaires ». Chaque entrée est un bouton qui remet la requête dans le champ ; croix pour la retirer, « Effacer » pour tout vider.
  - Une requête entre dans l'historique **quand elle mène à un résultat** (chaîne, film/série, plateforme, replay, chaîne protégée) et à la fermeture du dialogue ; les saisies d'un seul caractère sont ignorées.
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1034/1034** (141 fichiers, dont 4 tests unitaires d'historique et 4 tests d'interaction : fiche par-dessus la recherche, historique affiché, remise en tête, retrait/effacement) ; `vite build` OK ; `assembleRelease` OK.
- **Version** : **1.12.46 / code 94** aux trois emplacements. APK **4 434 311 octets**, SHA-256 `e7a1701ffc459d7dc14151d6d4b2f1fc3bc3b8f451d7620db4f528668f9fa86d`, certificat `f3f2371b…`, `minSdk 22` / `targetSdk 35`. Référence à la racine : `CedPlay-1.12.46.apk` + `CedPlay.apk` ; 1.12.45 archivée dans `sauvegardes/apk-1.12.45/`, les copies 1.12.41 à 1.12.45 qui traînaient à la racine ont été retirées.
- **Recette sur la box** (release 1.12.46) : recherche « avatar » → 21 puis 42 films/séries ; OK sur le premier résultat ouvre la fiche **par-dessus** les résultats (`preuves/livraison-1.12.46-box-fiche-sur-recherche.png`) ; Retour ramène à la liste avec « avatar » toujours saisi (`preuves/livraison-1.12.46-box-retour-resultats.png`) ; fermeture puis réouverture de la recherche : section « Recherches récentes » avec la puce « avatar » et « Effacer » (`preuves/livraison-1.12.46-box-recherches-recentes.png`) ; OK sur la puce relance la recherche (`preuves/livraison-1.12.46-box-historique-reactive.png`).
- **Limites** : recette aux `input keyevent` adb, pas à la vraie télécommande. Sur la box, la puce s'atteint par Bas (Effacer) puis Bas (puce) — un appui vers le bas depuis le champ tombe d'abord sur « Effacer ». Le **Motorola n'a pas été mis à jour** : il n'était ni branché en USB ni joignable en adb sans fil au moment de la livraison (1.12.45/code 93 reste installé). L'historique vit sur l'appareil et n'est pas inclus dans l'export de sauvegarde.

## 2026-11-09 - Livraison 1.12.47 (code 95) : bandeau TV en barre d'icônes

- **Demande de Céd** : « dans le menu de la chaîne sur TV (une fois le visionnage de la chaîne lancé), c'est très brouillon, la liste est sans fin sur la droite, ça ne va pas. J'avais mentionné que je voulais favori et enregistrer à proximité. Une étoile et un rond rouge suffisent. De même pour recharger, on peut remplacer par la flèche qui s'enroule sur elle-même. Chaîne précédente avec une flèche, chaîne suivante avec une autre flèche. Bref il faut une réorganisation, l'écran est totalement inondé d'options. »
- **Constat sur la box** (1.12.46, capture `preuves/avant-1.12.47-bandeau-tv.png`) : la rangée LECTURE alignait six pastilles de texte (Pause, Chaînes, Relancer le flux, Ajouter aux favoris, Enregistrer, Ouvrir avec…) et débordait à droite, la dernière coupée ; la rangée RÉGLAGES alignait quatre grosses pastilles (Audio Auto, Sous-titres Désactivés, Format Ajusté, Veille Non) sur toute la largeur.
- **Ce qui change** :
  - `PlayerOption` gagne un mode **icône seule** (`iconOnly`) et une **teinte d'icône** fixe (`iconTint`) ; le libellé reste dans l'aide en bas et dans la description d'accessibilité.
  - `TvBand` rend ces pastilles en **48 × 48** avec l'icône centrée (ImageSpan, 26 dp) ; les réglages gardent une valeur à droite de l'icône (pastille élargie, padding 12). La valeur est relue à chaque rafraîchissement, la largeur s'ajuste.
  - **LECTURE (direct)** : ⏮ Depuis le début (archive) · ▶| Revenir au direct (différé) · ⏸ Pause · ‹ chaîne précédente · › chaîne suivante · ☰ Chaînes · ★ favori · ● enregistrer (rond **rouge**) · ↻ relancer le flux · ↗ Ouvrir avec (VLC). L'ordre place **l'étoile et le rond rouge côte à côte**.
  - **RÉGLAGES** : 🔊 valeur · CC valeur · ▭ valeur · niveaux valeur · 🌙 valeur — l'icône remplace le libellé, la valeur reste (« Français », « Aucun », « Ajusté », « Non »).
  - **LECTURE (VOD)** : ⏸ Pause · ☰ Épisodes · › épisode suivant · ⏮ depuis le début · ↗ VLC.
  - « Sous-titres » affiche **Aucun** au lieu de « Désactivés » (plus court, même sens ; la liste garde « Désactivés »).
  - Le bandeau s'ouvre désormais sur **Pause** par défaut (au lieu de « Chaînes »).
  - Treize icônes ajoutées dans `res/drawable` (étoile vide/pleine, flèche circulaire, chevrons, retour au début, carré stop, haut-parleur, sous-titres, format, qualité, lune, compteur).
- **Retirée du bandeau TV** : la pastille « Revenir à ‹chaîne› » (dernière chaîne regardée). Elle reste sur le téléphone (pastille dédiée) et accessible par la touche **LAST_CHANNEL** de la télécommande. Les flèches ‹ › zappent dans la liste, comme CHANNEL_UP/DOWN.
- **Validation** : `tsc` app et node 0 erreur ; ESLint intégral 0 erreur / 18 avertissements ; `vitest run` **1034/1034** (141 fichiers) ; `vite build` et `assembleRelease` OK.
- **Version** : **1.12.47 / code 95** aux trois emplacements. APK **4 444 282 octets**, SHA-256 `b0d07cdb838d27cd304bd73e330a77125dac486fa4c59d9ef54d20ce91bcded8`, certificat `f3f2371b…`, `minSdk 22` / `targetSdk 35`, installée sur la **box**. Référence à la racine : `CedPlay-1.12.47.apk` + `CedPlay.apk` ; 1.12.46 archivée dans `sauvegardes/apk-1.12.46/`.
- **Recette box** (TF1 HD puis France 2/3) : bandeau sur une seule ligne, sans débordement (`preuves/livraison-1.12.47-box-bandeau.png`) ; OK sur l'étoile → étoile **pleine orange** et toast « Chaîne ajoutée aux favoris » (`-box-favori.png`) ; OK sur › → passage à « FR: FRANCE 2 FHD » (n° 8) avec le bandeau qui suit (`-box-zapping.png`) ; OK sur ☰ → liste des chaînes ; Bas depuis Pause → réglage le plus proche, OK ouvre sa liste au-dessus de la pastille (`-box-reglages.png`) ; OK sur le rond rouge → flux d'enregistrement (voir limites).
- **Limites** : le **téléphone n'a pas été mis à jour** — branché mais absent d'`adb devices` (débogage USB non autorisé), il reste en 1.12.45/code 93. Sur la box, l'enregistrement depuis le bandeau affiche « Sélecteur de dossier indisponible » : le dossier de capture se choisit sur le téléphone, comportement antérieur inchangé (le bouton existait déjà). La rangée **VOD** (Progression + icônes) n'a pas été parcourue sur la box. Recette aux `input keyevent` adb, pas à la vraie télécommande ; des appuis y sont parfois perdus, ce qui allonge les vérifications.

## 2026-11-09 - Livraison 1.12.48 (code 96) : dossier d'enregistrement par défaut

- **Demande de Céd** : « fixer un dossier par défaut. Tel connecté. »
- **Contexte** : la box TV (Android 9, API 28) n'a pas d'écran de sélection de dossier SAF (`ACTION_OPEN_DOCUMENT_TREE` absent d'Android TV) ; le bouton REC répondait donc « Sélecteur de dossier indisponible ». Le dossier choisi sur le téléphone restait par ailleurs la seule destination possible.
- **Ce qui change** :
  - Nouvelle classe `RecordingTarget` : le dossier **choisi** (SAF, clé USB/SD) reste prioritaire ; sans choix, les captures vont dans **Films/CedPlay**. Android 10 et plus passe par **MediaStore** (`RELATIVE_PATH`), sans autorisation ; Android 9 et avant écrit directement dans le dossier public après une **autorisation de stockage** demandée une fois au premier REC (repli sur le dossier de l'application si elle est refusée, et les deux dossiers restent listés).
  - `Recorder` écrit désormais via une **cible** (`Target` : SAF, MediaStore ou fichier) au lieu d'un `DocumentFile` : même code pour .ts et HLS.
  - `RecordService` (enregistrements programmés) utilise la même cible : la programmation fonctionne sur la box sans dossier choisi.
  - `NativePlayerPlugin` : `getRecordingsFolder` renvoie toujours un dossier (« Films/CedPlay (par défaut) » quand rien n'est choisi) ; `listRecordings` et `deleteRecording` couvrent les trois destinations. L'écran Réglages › Enregistrements affiche donc le dossier par défaut et n'impose plus le choix.
  - Le lecteur TV ne propose plus le sélecteur de dossier (code mort retiré) : REC démarre directement.
  - Manifeste : `WRITE_EXTERNAL_STORAGE` et `READ_EXTERNAL_STORAGE` avec `maxSdkVersion 28` uniquement.
- **Validation** : `tsc` app et node 0 erreur ; ESLint 0 erreur / 18 avertissements ; `vitest run` **1034/1034** (141 fichiers) ; `vite build`, `cap sync` et `assembleRelease` OK ; compilation Java sans erreur.
- **Version** : **1.12.48 / code 96** aux trois emplacements. APK **4 445 966 octets**, SHA-256 `c2f0dd0ceb5308aff5c0155f5766b350fc3a459434e5423d6ab273c555fd6357`, certificat `f3f2371b…`, installée sur la **box** et le **Motorola** (`versionName 1.12.48` sur les deux). Référence à la racine : `CedPlay-1.12.48.apk` + `CedPlay.apk` ; 1.12.47 archivée dans `sauvegardes/apk-1.12.47/`.
- **Recette box (TF1 HD)** : REC → dialogue système « Allow CedPlay to access photos, media, and files… » (`preuves/livraison-1.12.48-box-permission.png`), Autoriser → toast « Enregistrement démarré : FR_TF1_HD_1794281569214.ts » (`-box-enregistrement.png`), fichier créé dans `/sdcard/Movies/CedPlay/`, **9 345 480 octets**, `ffprobe` : **28,8 s** de MPEG-TS valide ; arrêt par le carré rouge → icône redevenue ronde, toast de fin (`-box-rec-stop.png`).
- **Recette téléphone** : 1.12.48 installée, aucune régression du chemin SAF (le Motorola garde son dossier `/sdcard/Enregistrements` choisi).
- **Limites** : le chemin **MediaStore** (Android 10+, sans dossier choisi) est compilé mais pas exercé sur appareil — le Motorola a déjà un dossier choisi, qui reste prioritaire. Sur la box, le dialogue d'autorisation système s'affiche en anglais une seule fois, au premier enregistrement. Recette aux `input keyevent` adb.


## 11 novembre 2026 — Reprise appairage TV/téléphone et correction du contenu APK 1.12.54

- Sujet confirmé par Céd : connexion TV depuis le téléphone. Chat exact non retrouvé ; reprise depuis les fichiers existants, sans modification du code produit ni du WIP des autres chantiers.
- Vérifications réexécutées : pnpm verify complet, 1067/1067 tests Web (142 fichiers), typage app/node 0 erreur, ESLint 0 erreur/18 avertissements, build OK ; Gradle testReleaseUnitTest OK, 51 tests Java dont 10 PairingServer, aucun échec (75 tâches Gradle).
- Défaut de livraison constaté : la première APK 1.12.54/code 102 (SHA-256 8b43ba16…) embarquait le libellé Réglages 1.12.53. Sources déjà corrigées. Synchronisation Capacitor et assembleRelease rejoués ; 73 fichiers Web embarqués identiques octet par octet au dist vérifié, libellé embarqué 1.12.54 contrôlé.
- APK finale : CedPlay-1.12.54.apk et CedPlay.apk, 4 465 337 octets, SHA-256 4bfcf709d6390d5a8d52a16bce326e3f0364ffe43dbb0099f1457e818b3924c1 ; certificat habituel f3f2371b… vérifié. Cette empreinte remplace celle de la première construction documentée plus haut.
- Aucun appareil ADB connecté : ni installation, ni QR scanné, ni connexion fournisseur réelle. Relecture indépendante sans défaut bloquant démontré ; scénario de confirmation téléphone face à un fournisseur très rapide à éprouver sur appareil.
- Preuves et mode d'emploi : preuves/reprise-appairage-2026-11-11/COMPTE_RENDU.md, journaux et apk-final.json. Aucun commit ni push.


## 11 novembre 2026 — Menu latéral TV translucide, version 1.12.56 / code 104

- Demande de Céd depuis sa photo : remplacer la barre du haut par des icônes latérales permanentes, noms visibles en entrant par Gauche. Rail 76 px, déployé 248 px par-dessus le contenu ; Haut/Bas déplace, OK sélectionne, Droite retrouve le dernier contrôle du panneau actif. Recherche dans le rail, horloge en haut à droite. Mode téléphone conservé.
- Frontières Gauche explicites dans Direct, VOD et Découvrir ; correction issue de revue indépendante pour Gestion des listes (désormais dans le panneau Plus) et conservation du défilement à l’ouverture du menu.
- Validation : 84 tests ciblés, puis **1076/1076 tests Web sur 142 fichiers**, typage app/node sans erreur, ESLint 0 erreur/18 avertissements, build OK. Deux tests de l’ancien en-tête adaptés ; premier journal d’échec conservé. Recette navigateur 960×540 (ouverture/repli, sélection manuelle, Direct, Gestion des listes, recherche) et 390×844 hors mode TV (barre du bas, aucun débordement). Revue indépendante finale : aucun bloqueur concret dans ce périmètre.
- La session parallèle avait livré une 1.12.55 contenant le rail mais pas le dernier correctif de défilement. **1.12.56/code104** synchronisée puis compilée : **4 466 596 octets**, SHA-256 `679b4908be69e5cc1c2fa8d1cc95bd6b42170954a37c197d24826050e55a2209`, copie CedPlay.apk identique ; 73 fichiers dist identiques octet pour octet au contenu embarqué ; libellé et manifeste 1.12.56, certificat habituel vérifiés. Ancienne 1.12.55 préservée dans sauvegardes/apk-1.12.55.
- Aucun appareil ADB connecté, aucune installation ni recette physique de télécommande ; aucune nouvelle preuve de quatre lignes EPG (source absente dans la recette navigateur). Audit statique global UI non vert : 51 signaux sur les sources, consigné sans refonte hors périmètre. DESIGN.md validé : zéro erreur, trois avertissements.
- Preuves : preuves/menu-lateral-tv-2026-11-11/COMPTE_RENDU.md, captures menu-ouvert/menu-replie/telephone, journaux et apk-final.json. Aucun commit ni push. Prochaine version libre : 1.12.57/code105.


## 11 novembre 2026 — Découvrir TV plus compact et visuel, version 1.12.57 / code 105

- Retour de Céd sur la capture : cadres médias trop grands, souhait d’une présentation attirante dans l’esprit HBO Max. Affiches TV 168 → 132 px, pochettes 200 → 136 px, reprise 300 → 224 px et hauteur environ 120 px ; actions conservées, filtres 36 px et espacements 12 px. Nouveau bandeau informatif avec vrai poster/logo/pochette du contenu ciblé : 180 px avec image à 960 × 540, plus compact sans image. Gabarits mobiles et ordre des rangées conservés.
- Revue indépendante : ancien snapshot Pour toi réutilisé lors du passage liste A → B, reproduit puis corrigé par dépendance playlist.id ; nouveau test rouge avant/vert après sur carte, titre et image. Sélection du bandeau résolue uniquement parmi les cartes visibles et autorisées. Aucun autre bloqueur concret dans la revue finale.
- Validation : **1085/1085 Web (143 fichiers)**, 26 tests ciblés, TypeScript app/node 0 erreur, lint 0 erreur/18 avertissements, build et compilation Android réussis. Recette de l’application complète en navigateur 960 × 540 avec données de démonstration isolées : focus, image, filtre et menu ; sans image, bandeau mesuré à 149 px ; mobile 390 × 844 sans bandeau TV ni débordement. Les médias QA ne figurent ni dans dist ni dans APK.
- **APK 1.12.57/code 105**, **4 467 843 octets**, SHA-256 `06336c9dc67e6f8293eb3656961c61fffdb716465a708ed4d2b2172cc2360f40`, copie CedPlay.apk identique. 73 fichiers Web strictement identiques au build vérifié ; libellé, manifeste et certificat habituel contrôlés. 1.12.56 conservée dans sauvegardes/apk-1.12.56.
- Aucun appareil ADB, aucune installation ou recette physique, aucun essai de flux réel. Audit UI statique global non vert : 54 signaux, aucun dans les deux composants du bandeau ; les trois écarts depuis le précédent audit concernent des fixtures de test. Rapport et captures : preuves/decouvrir-visuel-tv-2026-11-11/COMPTE_RENDU.md. DESIGN.md validé : 0 erreur/3 avertissements. Aucun commit ni push. Prochaine version libre : 1.12.58/code 106.

## 12 novembre 2026 — Refonte de l'accueil Découvrir (TV et téléphone), non livrée en APK

- Demande de Céd : accueil « à la manière des plateformes de streaming », d'abord dans le code. Travail fait hors de la machine, sur une copie de `application/` (310 fichiers `src/`), puis réécrit dans le dépôt ; base de départ vérifiée verte avant modification : **1087/1087 Web (143 fichiers)**, lint 0 erreur/18 avertissements.
- TV : Reprendre passe en première rangée dans Tout (`orderRows`). Le bandeau monte jusqu'en haut de l'écran, les filtres se posent dessus ; 200 px à 960 × 540 (270 px au-delà de 600 px de haut), avec le visuel du titre recadré et assombri en arrière-plan, sans flou ni image supplémentaire. Droite depuis le rail arrive sur la première carte et non plus sur les filtres. Fiche, Vu, Retirer ne s'affichent que sous la carte ciblée, place réservée. Focus des cartes en contour clair intérieur : la règle globale `.remote-navigation :focus` le rendait orange.
- Téléphone : `HeroCarousel`, jusque-là inutilisé, devient le bandeau de Découvrir (titres en cours puis Pour toi, quatre au plus, seulement avec affiche, action Fiche). Son avance automatique est retirée.
- Fichiers : `src/utils/discover.ts`, `src/components/ContinuePanel.tsx`, `TvDiscoverHero.tsx`, `HeroCarousel.tsx`, `src/index.css`, tests `discover`, `discoverNavigation`, `continuePanel` ; `DESIGN.md` et `UX-CONTRACT.md` mis à jour.
- Validation sur la copie : TypeScript app/node 0 erreur, lint 0 erreur/17 avertissements, **1092/1092 Web (143 fichiers)** dont 5 nouveaux tests et 4 adaptés au nouvel ordre des rangées, `vite build` réussi. Recette navigateur 960 × 540 avec le banc `tmp/discover-qa` (vues filled, posters, live, noart) et 390 × 780 : aucune vue ne défile à l'arrivée du focus, rangée d'affiches entière sous le bandeau.
- Non fait : `pnpm verify` relancé sur la machine de Céd, compilation Android, APK, version (1.12.58/code 106 inchangés), installation ou recette sur box, thème clair, commit. Restent hors de ce lot : rangées Nouveaux épisodes de séries, « Parce que tu as regardé », YouTube et plateformes, qui demandent les comptes reliés (Trakt, BetaSeries, YouTube).

## 12 novembre 2026 — Corrections après contre-revue de l'accueil Claude

- TV : hauteur minimale de 200/270 px au lieu d'une hauteur fixe ; 64 px réservés aux filtres avec ou sans image. Les titres longs peuvent agrandir le bandeau plutôt que passer sous les filtres.
- Thème clair TV : fond adapté aux variables du thème, surface claire sous les textes, libellé et indications contrastés.
- Mobile : filtrage des reprises sans affiche avant la limite de deux. Test de régression ajouté avec deux reprises sans affiche suivies de trois illustrées ; les deux premières illustrées sont attendues.
- DESIGN.md et UX-CONTRACT.md alignés sur le comportement final.
- Validation : script verify exécuté via npm (pnpm absent du PATH), TypeScript app/node réussi, ESLint complet 0 erreur / 17 avertissements. Vitest bloqué avant exécution par spawn EPERM dans esbuild ; build non atteint. Test ajouté non exécuté. Aucun contrôle visuel navigateur ou physique effectué, aucun APK compilé ni version montée.
- Suivi Second Cerveau et scripts D:\AIOS\outils\entretien.py non exécutés : destinations hors des racines autorisées en écriture dans cette session. Reprendre ce suivi lors d'une session disposant de cet accès.

## 12 novembre 2026 — Suite du plan Claude : compléter l'accueil

- Choix explicite de Céd : compléter l'accueil en priorité, plutôt que finaliser l'APK. Artifact Claude accessible en navigateur mais données derrière connexion ; reprise fondée sur les notes locales et le compte rendu fourni.
- Épisodes suivants : nouvelle rangée Tout/Séries, après un épisode terminé. Au maximum quatre séries connues, get_series_info séquentiels, annulation au changement de contexte. Pas de téléchargement global, pas de date de sortie inventée. Les épisodes commencés, retirés, spéciaux ou sans format ne sont pas proposés ; OK réutilise le parcours de lecture série avec identifiants épisode/série.
- Parce que tu as regardé : le moteur de recommandations conserve l'identifiant du visionnage source. Découvrir regroupe les suggestions de la source locale récente valide, sans doublons avec Pour toi, et réagit aux mises à jour des snapshots. Les anciens snapshots restent affichés dans Pour toi jusqu'au prochain calcul dans Films/Séries.
- Mes plateformes : favoris existants de Replay/Plateformes affichés dans Tout, accès natif officiel ou nouvel onglet Web. YouTube apparaît s'il a été choisi. Rangée masquée sous verrouillage parental ; aucun compte externe connecté et aucun flux personnel YouTube synchronisé.
- Six tests ajoutés (trois fonctions épisodes, trois interactions accueil), assertion de provenance ajoutée au test recommandations existant. Contrats DESIGN.md et UX-CONTRACT.md actualisés.
- Contrôles : TypeScript app/node 0 erreur ; ESLint intégral 0 erreur / 17 avertissements. Verify tenté via npm : Vitest ne démarre pas, spawn EPERM d'esbuild ; les nouveaux tests ne sont pas exécutés, build non atteint. Aucun APK, changement de version, installation, essai fournisseur réel ou recette navigateur/box dans ce lot.
- Restent : validation tests/build et recette TV/mobile ; intégrations authentifiées Trakt/BetaSeries/YouTube et détection de nouveautés par date (non implémentées). Second Cerveau et entretien AIOS non actualisés : hors racines autorisées en écriture.


## 13 novembre 2026 — Rangée Documentaires Bodlav dans Découvrir

- Demande de Céd : une rangée documentaire Bodlav dans Découvrir. Ajout ciblé sur le WIP existant, sans changer la version 1.12.60/code 108 déjà présente.
- Tout et Films : douze documentaires au maximum, avec leurs vraies affiches, titres, années et VOSTFR lorsque fourni. La rangée se place après Ma liste et avant Mes plateformes. OK ouvre la fiche externe Bodlav ; aucune extraction ni lecture vidéo interne.
- Source : découverte dynamique de l'entrée HTTPS depuis bodlav.com, puis lien de la rubrique documentaire, trois requêtes maximum. HTML traité hors DOM applicatif, liens de fiches et affiches validés, corps borné et délais de douze secondes par requête. Cache local validé de six heures, conservé sur panne. Annulation au changement de contexte ; aucun résultat ni écriture tardive après annulation.
- Contrôle parental : rangée, ancien bandeau et requêtes masqués/suspendus tant que le verrou est actif. Aucun chargement dans Séries ou Podcasts. Gabarits et navigation TV existants réutilisés.
- Validation locale : corepack pnpm verify réussi, TypeScript app/node 0 erreur, ESLint intégral 0 erreur / 15 avertissements, 1183/1183 tests Web sur 154 fichiers et build Vite réussi. Les 63 tests ciblés étaient verts ; une erreur de lint dans le type d'un nouveau test a été corrigée avant le passage complet. Aucun média de test lourd dans dist.
- Preuves réelles en navigateur : chargement public de douze titres et douze affiches, seconde lecture depuis cache ; rendu TV, navigation Droite et bandeau, filtres Tout/Films et masquage Séries/verrou ; rendu téléphone dans une fenêtre de contenu 390 × 780. Captures : preuves/bodlav-decouvrir-tv-2026-11-13.png et preuves/bodlav-decouvrir-mobile-2026-11-13.png. Banc isolé avec playlist vide, sans données fournisseur, sur le port local 5183.
- Guardian indépendant : aucun défaut produit actionnable relevé sur les seuls deltas de ce lot ; parseur exécuté sur le HTML réel enregistré, annulation d'une réponse tardive vérifiée sans écriture cache. Aucun APK produit, aucune installation, aucun test sur appareil physique ni validation d'ouverture du navigateur Android. Aucun commit/push.
- Suivi actualisé : fiche CedPlay du Second Cerveau mise à jour, tableaux régénérés ; entretien.py verifier sans erreur documentaire et sonder sans écart de projet. Avertissements transversaux existants conservés.


## 13 novembre 2026 — Recompilation APK 1.12.61, code 109, avec Bodlav

- Demande de Céd : recompiler. L'APK antérieur réellement présent à la racine était 1.12.60/code 108, malgré la fiche et AGENTS.md encore à 1.12.59. Passage cohérent à 1.12.61/code 109 dans package.json, build.gradle et SettingsPanel.tsx ; aucun autre changement fonctionnel dans cette recompilation.
- Vérifications de cette compilation : corepack pnpm verify réussi, TypeScript app/node 0 erreur, ESLint intégral 0 erreur / 15 avertissements, 1183/1183 tests Web sur 154 fichiers, build Vite réussi. cap sync android puis gradlew testDebugUnitTest assembleRelease réussis ; 62/62 tests Android, aucune erreur/échec.
- APK produit : CedPlay-1.12.61.apk et copie CedPlay.apk, 4494655 octets, SHA-256 b5307cb05e7e2c95ca854e7ec91f1f9d392a3136063836185b129d31f576afdc. Application com.lecteur.iptv, minSdk 22, targetSdk 35, versionName 1.12.61/versionCode 109 relus dans l'APK. Signature et alignement vérifiés ; certificat SHA-256 f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628, identique à l'APK 1.12.60.
- Contrôle d'embarquement : les fichiers Web de l'APK sont identiques octet par octet au dist vérifié, et la rangée Documentaires Bodlav est présente dans le bundle. 469 fichiers sources contrôlés inchangés pendant la compilation. Aucun média lourd de test dans dist.
- Références racine mises à jour et ancien APK 1.12.60 supprimé seulement après validation du nouveau. Preuve structurée : preuves/cedplay-1.12.61-build.json ; journaux de compilation dans tmp/bodlav/recompile-*.log. WIP concurrent préservé, aucun commit/push.
- Aucune installation, aucune recette sur téléphone/box, aucun flux IPTV réel ni ouverture du navigateur Android vérifiés dans cette session. Les essais navigateur Bodlav de la session précédente restent distincts de cette compilation.


## 13 novembre 2026 — TV5MONDEplus et ImagoTV, APK 1.12.62 / code 110

- Accord de Céd après proposition des deux plateformes : ajout de rangées Documentaires TV5MONDEplus et Documentaires ImagoTV dans Tout et Films, après Bodlav et avant Mes plateformes. Bodlav garde sa place ; l'avis précédent sur une place en tête n'a pas constitué une demande de déplacement. Aucun flux extrait : OK ouvre la fiche exacte sur le site officiel.
- Accès permanent à la rubrique documentaire de chaque plateforme, même en cas de panne. Sur Android : jusqu'à douze titres/affiches réels par source, catalogue TV5 public et titres Imago complétés depuis les fiches (trois requêtes simultanées, douze candidats maximum). Deux caches validés indépendants de six heures, délais et volumes bornés. Sur Web sans cache : accès aux rubriques uniquement, car absence de CORS ; aucun relais public ajouté. Verrou parental, filtres et changement de contexte retirent immédiatement les cartes et le héros ; annulation sans écriture cache tardive. Actions de premier lancement conservées.
- Conception : module indépendant pour les deux nouvelles sources ; migration de Bodlav écartée pour préserver sa version livrée. Un propriétaire pour utilitaire/hook/UI/tests, revue indépendante en lecture seule : aucun défaut bloquant relevé. Probe indépendant des vrais HTML : douze titres et douze affiches par source, chargeur Imago natif simulé/cache relu, abort TV5 tardif sans écriture. Tests couvrant également annulation durant les trois travailleurs Imago.
- Vérification complète : corepack pnpm verify réussi, TypeScript app/node 0 erreur, ESLint intégral 0 erreur / 15 avertissements existants, **1200/1200 tests Web, 157 fichiers**, Vite réussi. cap sync android et gradlew testDebugUnitTest assembleRelease réussis ; **62/62 tests Android** (tâche Gradle UP-TO-DATE). Sources figées : 389 fichiers inchangés pendant les vérifications et la compilation.
- Recette navigateur isolée avec playlist vide, aucun fournisseur ni secret : vrais catalogues publics enregistrés puis injectés uniquement dans le cache du banc QA. Douze affiches par source visibles, déplacement Droite Fracture américaine → L'École des XV et héros, verrou et filtre Séries retirant les documentaires ; format téléphone 390 × 780. Web sans cache : accès permanents présents. Capture TV preuves/documentaires-officiels-tv-2026-11-13.png et mobile preuves/documentaires-officiels-mobile-2026-11-13.png. Ces captures ne prouvent pas le chargement HTTP depuis Android ni la lecture des films.
- APK racine **CedPlay-1.12.62.apk** et **CedPlay.apk** identiques : 4496504 octets, SHA-256 `49996a6d3e84cee392673792bf9b6799382a6c91f1006449121ee09277e4948a`. Manifeste 1.12.62/code 110, certificat habituel `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`, alignement et contenu Web identique au dist vérifiés ; libellés des trois sources présents et aucun banc QA embarqué. Ancienne APK 1.12.61 supprimée après contrôle. Preuve structurée : preuves/cedplay-1.12.62-build.json ; journaux et snapshots tmp/documentaries/.
- Aucune installation, aucun essai sur téléphone/box, aucune lecture réelle ni disponibilité géographique par titre validée. Aucun commit ni push. Prochaine version libre 1.12.63/code 111.
- Suivi terminé : fiche CedPlay actualisée, entretien.py actualiser sans changement de tableau, verifier sans erreur (20 avertissements transversaux existants), sonder sans écart de projet.


## 13 novembre 2026 — Navigation Réglages TV/mobile, APK 1.12.63 / code 111

- Retour de Céd initialement formulé « version mobile », puis précision TV et photo du rail TV/Plus : priorité réelle à la télécommande. Reproduction isolée 960 × 540 sur le composant d'origine : cinq Bas depuis autoplay arrivent sur Annuler avant la suite des options. Les champs bruts de Réglages/LAN contournaient le composant Input avec activation explicite déjà utilisé dans les connexions/recherche. Aucun téléphone ni box ADB connecté.
- Correction : dix rubriques repliables TV et téléphone, une ouverte à la fois, entrée sur Lecture sans saisie. Le contenu caché reste monté : brouillons des réglages, PIN et champs internes LAN conservés. Bureau large hors TV : toutes rubriques ouvertes. Sur TV, champs de texte/URL/PIN en attente readonly/inputMode none ; OK active la saisie, premier Retour la quitte, deuxième Retour ferme. Déplacement vertical local dans le corps avant d'atteindre les actions ; le pied ne détourne plus Bas. Logique de sauvegarde et contrôles du PIN conservés.
- Téléphone : corps seul défilant, en-tête/actions hors défilement, adaptation à visualViewport et décalage du clavier, champs 16 px et cibles 44 px. Texte courant/aides 14/12 px conservé. Plus TV compacté : titre 20 px, accès 48 px minimum, icônes 30 px et aides 12 px ; huit accès dont la liste en cours visibles à 960 × 540 (dernier bas mesuré 499 px), aucune baisse globale de police Android.
- Tests rouges avant correction conservés : tmp/settings-mobile/tests-before.log (rubriques et champs initiaux), remote-before.log (champs TV éditables au simple focus), footer-before.log (pied interposé). Après correction : 20 tests ciblés verts ; Guardian indépendant 41/41 avec régressions navigation/PIN, aucun défaut bloquant constaté. Vérification complète corepack pnpm verify : **1211/1211 Web sur 160 fichiers**, TypeScript app/node 0 erreur, ESLint complet 0 erreur / 15 avertissements existants, Vite réussi. cap sync android et gradlew testDebugUnitTest assembleRelease réussis ; **62/62 Android** (tâche tests UP-TO-DATE).
- Recette navigateur avec données synthétiques isolées : Plus/entrée Réglages en 960 × 540 et 800 × 450 ; ouverture Lecture + six Bas atteint Listes, arrivée TMDB readonly sans saisie, OK rend éditable, Escape revient en attente et Bas poursuit ; dernières rubriques puis Annuler et Haut vers Avancé accessibles. Téléphone 390 × 780 : aucun champ initial, rubriques et actions ; fenêtre réduite synthétique 390 × 360 : champ accessible après défilement et actions visibles. Cette fenêtre réduite et les tests visualViewport ne prouvent pas un clavier Android physique. Captures preuves/plus-tv-compact-2026-11-13.png, reglages-tv-rubriques-2026-11-13.png, reglages-mobile-rubriques-2026-11-13.png et reglages-mobile-fenetre-reduite-2026-11-13.png.
- **CedPlay-1.12.63.apk** et **CedPlay.apk** identiques : 4497859 octets, SHA-256 `6842e1270fe05f9c3af333fa4e45f976a84177a9af97095558df43f8efbc3c69`. Manifeste 1.12.63/code111, certificat habituel `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`, alignement et contenu Web APK identique au dist vérifiés ; 395 fichiers sources inchangés pendant les vérifications/build, aucun banc QA embarqué. Ancien APK 1.12.62 supprimé après validation. Preuve structurée preuves/cedplay-1.12.63-build.json, journaux tmp/settings-mobile/.
- Aucun essai ni installation physique, aucun clavier natif ou flux réel validés. Aucun commit/push. Prochaine version libre **1.12.64 / code 112**.
- Suivi terminé : fiche CedPlay actualisée, entretien.py actualiser sans modification de tableau ; verifier sans erreur (20 avertissements transversaux existants), sonder sans écart de projet.

## Contre-vérification du bilan Desktop — 13 novembre 2026

- Audit des affirmations du bilan joint, sans modification du code applicatif ni du lanceur. Rapport : VERIFICATION_BILAN_DESKTOP_2026-11-13.md.
- Rejeu : corepack pnpm verify code 0, 1240/1240 tests Web sur 164 fichiers, TypeScript app/node 0 erreur, lint 0 erreur/15 avertissements, build 8,56 s ; tests serveur Desktop 16/16.
- Réserve actuelle : deux rejeux E2E identiques échouent sur « vod player closed » après la sélection du sous-titre embarqué. Un diagnostic isolé bloque aussi sur « tv-vod films ». Cause exacte application/scénario non encore isolée. Ne pas considérer la recette complète comme fiable sur cette seule base.
- Mosaïque deux vidéos, seek MKV et sélection audio/sous-titre embarqué franchis avant l'échec ; podcast historique visible en capture mais non atteint par les deux rejeux actuels. Les anciens journaux finaux étaient restés sur des résultats antérieurs. Preuves : preuves/veracite-desktop*.log et preuves/veracite-desktop/.
- Aucun CedPlay.exe de test résiduel constaté. Verifier AIOS code 0 sans erreur (avertissements présents), sonder code 0 sans écart. Ni abonnement fournisseur, ni appareil TV, ni téléphone Wi-Fi testés ; parité totale non démontrée.

## Contre-vérification du correctif Desktop — 14 novembre 2026

- Nouveau bilan vérifié : journal des cinq passages E2E historiques retrouvé ; deux nouveaux parcours complets consécutifs réussis, codes 0, jusqu'au podcast et sans erreur console/page. Serveur Desktop 16/16.
- Premier `pnpm verify` : échec reproductible du test EPG après minuit (émission précédente hors du jour affiché). Seul le scénario de test `epgGridInteraction.test.tsx` a été corrigé avec une horloge fixe à midi ; 11/11 isolés puis `pnpm verify` complet code 0 : 1 241/1 241 tests, 164 fichiers, typage sans erreur, lint 0 erreur/15 avertissements, build 8,62 s. Aucun code produit modifié pendant cette contre-vérification.
- Probe indépendant contre-rejoué 4/4 : `data-remote-self` corrige bien les flèches ; `keyActionsRef` stabilise l'écouteur, mais son rôle causal dans l'ancien échec d'Échap n'est pas démontré. Aucun processus de test résiduel retrouvé.
- Fermeture GUI de CedPlay.exe, EPG complet/DVR depuis l'interface, notifications/redémarrage Windows et fournisseur/Wi-Fi réels restent non validés. La parité TV box complète reste à démontrer. Aucun APK, version, commit ni push.
- Rapport et preuves : [CONTRE_VERIFICATION_DESKTOP_2026-11-14.md](CONTRE_VERIFICATION_DESKTOP_2026-11-14.md), `preuves/controle-bilan-2026-11-14/`.


## Vérification des nouveaux correctifs Desktop — 14 novembre 2026

- Bilan contrôlé : fermeture réelle WM_CLOSE de CedPlay.exe et arrêt serveur confirmés ; binaire inchangé SHA-256 659C1699A2E9CCE4B436D3EF663C055EBE4922F50FA722A99C0AD14586163CE7. Suite initiale 20/20 serveur.
- Trois oublis reproduits puis corrigés dans config/localAndDvr/server et leurs tests : maintien du serveur pour un rappel seul et attente des notifications ; reçu persistant contre les notifications répétées après resynchronisation, y compris dans un nouveau processus Node ; retrait de reconnect_streamed pour les captures HLS à adresse sans extension. Tests rouges avant correction conservés, puis suite complète 23/23 sans échec ni ignoré.
- Vérification Web finale : corepack pnpm verify code 0, 1242/1242 tests dans 164 fichiers, typage app/node sans erreur, ESLint complet 0 erreur/15 avertissements, build 8,74 s. Aucun code Web modifié ici.
- Recette E2E : un premier parcours complet vert, puis deux échecs initiaux sur Plus. Probe du harnais : aucun événement de clic reçu avant focus explicite ; correction du seul harnais avec Emulation.setFocusEmulationEnabled, puis deux parcours officiels complets consécutifs code 0 (EPG/rappel, DVR UI réel, MKV/audio/sous-titres, mosaïque/podcast). Aucun second clic automatique, échecs conservés.
- Nuances : le test historique de reprise recréait deux objets dans le même processus ; le nouveau test de dédoublonnage lance un vrai nouveau processus Node. WinRT accepte l'appel mais aucune bannière système n'a été observée. Pas de reboot Windows, fournisseur réel, Wi-Fi réel ni mesure de reprise après coupure réseau ; la lecture du fichier DVR et la parité TV box complète restent à valider. Aucun APK, commit ni push.
- Rapport : VERIFICATION_NOUVEAUX_CORRECTIFS_DESKTOP_2026-11-14.md ; preuves/controle-nouveau-bilan-2026-11-14/. Suivi CedPlay et entretien AIOS actualisés à la clôture.


## Livraison APK 1.12.64 / code 112 et publication Git — 14 novembre 2026

- Demande explicite de Céd : APK, commit, push. Consolidation des sources validées depuis HEAD 1.12.48 : évolutions TV/mobile, intégration Desktop et correctifs de la dernière contre-vérification. Version alignée dans package.json, build.gradle et SettingsPanel.tsx.
- Contrôles sur le candidat : corepack pnpm verify code 0, 1242/1242 tests Web (164 fichiers), TypeScript app/node sans erreur, ESLint complet 0 erreur/15 avertissements, build 8,96 s ; suite Desktop 23/23. cap sync android puis gradlew testDebugUnitTest assembleRelease --rerun-tasks réussis, 269 tâches exécutées, 62/62 tests Android sur 11 fichiers XML. Revue indépendante du manifeste : aucun secret, média de test, import manquant ou incohérence de contrat natif démontré.
- CedPlay-1.12.64.apk et CedPlay.apk identiques : 4511839 octets, SHA-256 a5006f7dbd1cb379048cd63250ef61f6e8dbb36987d66ae7d94567fafb5d6708. Manifeste com.lecteur.iptv, minSdk22, targetSdk35, version1.12.64/code112 ; signature et alignement vérifiés, certificat historique f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628 conservé. Les 73 fichiers Web correspondent octet par octet au dist ; deux adaptateurs Cordova vides sont ajoutés normalement par Capacitor. Aucun média lourd de test. Les 533 fichiers sources sont restés inchangés pendant les vérifications et la compilation.
- Les références APK racine et AGENTS sont alignées ; ancien APK 1.12.63 retiré seulement après validation du nouveau. Preuve structurée : preuves/cedplay-1.12.64-build.json ; journaux et manifeste précis : preuves/livraison-1.12.64/.
- Publication demandée sur origin/consolidate/v1.11.4, sans force-push. Le commit effectif et la confirmation distante sont consignés après leur création dans preuves/livraison-1.12.64/publication.json et la fiche CedPlay. Les six fichiers de travail AUDIT_MULTISUPPORT_2026-11-09.md, Claude outputs (trois captures), DESIGN.md et UX-CONTRACT.md restent hors commit et sont préservés.
- Aucune installation ni recette physique de cet APK ; pas de flux fournisseur réel, Wi-Fi QR/LAN ou reboot Windows testés. Les limites du dernier rapport Desktop restent applicables. Prochaine version libre 1.12.65 / code 113.
