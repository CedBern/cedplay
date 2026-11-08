# CedPlay 1.12.9 — reconnexion du direct — 8 novembre 2026

## Résultat

Version **1.12.9 / code 57** produite et installée sans désinstallation sur la Hisense HiSmartTV A4 (Android API 28). Les lots A à E sont figés dans `96f74e2`, le correctif natif dans `63adb42`. Le changement de logos commité en parallèle (`3ebf54c`) est préservé et inclus. Aucun push effectué ; les lanceurs et fichiers d'identité hors périmètre restent intacts.

Le direct dispose d'une fenêtre de récupération de **180 secondes**, avec délais de 1,5 / 3,5 / 7 / 15 secondes, puis 15 secondes entre tentatives. Une tentative reste en vol ; le retour d'une connexion peut accélérer une tentative en attente. La pause volontaire ou imposée par Android, le changement de chaîne, le cast, la sortie du lecteur et les erreurs HTTP permanentes arrêtent la reprise. La VOD conserve sa politique de deux tentatives.

`LiveReconnectController` porte la politique avec une horloge et un ordonnanceur injectés. `NativePlayerActivity` conserve un seul ExoPlayer et gère le réseau sur le fil principal ; branche de compatibilité prévue pour API 22/23. Les marqueurs de diagnostic de reconnexion ne contiennent ni URL ni identifiants.

## Preuve avant / après sur la Hisense

Essai contrôlé : flux MPEG-TS synthétique produit localement avec image et tonalité, acheminé par un tunnel ADB. Le serveur ferme la lecture puis répond HTTP 503 pendant **30 secondes**, avant de redevenir disponible. Le Wi-Fi de la TV n'est pas coupé, pour conserver le contrôle ADB.

| Essai | Observation |
|---|---|
| Avant correction, APK de diagnostic 1.12.8 | Après retour du service et 25 secondes supplémentaires, aucune nouvelle requête, zéro flux actif ; écran « Serveur indisponible / Réessayer la lecture » observé. |
| Code final, APK de diagnostic 1.12.9 | Reprise autonome, première image **3 365 ms** après retour du service, lecture signalée active à **4 069 ms**. Un flux actif après reprise, maximum simultané **1** sur le serveur de test. |
| Pause pendant récupération | Pause envoyée après 22 s de coupure ; après retour du service, état Android toujours PAUSED, aucune tentative applicative supplémentaire. Lecture reprend sur demande explicite (état PLAYING). |
| APK release installé ensuite | `dumpsys` confirme **57 / 1.12.9**, minSdk 22, targetSdk 35. Accueil et Direct affichés ; chaîne réelle lancée depuis les favoris et image observée. Un essai : 3 999 ms entre demande native et première image, dont 1 775 ms de préparation. Ce n'est pas une moyenne de démarrage ni une mesure de fluidité. |

Les essais de coupure instrumentés ont été faits dans une APK de diagnostic avec le même code Java final ; l'APK release minifiée a ensuite fait l'objet de l'essai de lancement réel. Le test physique ne démontre pas le retour après désactivation réelle du Wi-Fi, la disponibilité de tous les fournisseurs, ni le nombre de connexions chez un fournisseur réel.

## Vérifications et contre-relecture

- TypeScript app et node : zéro erreur. ESLint complet : zéro erreur, **18 avertissements**.
- Web : **779/779 tests**, 118 fichiers. Build Vite réussi, puis synchronisation Capacitor.
- Java : **30/30 tests**, dont neuf nouveaux pour la fenêtre de récupération, les délais, les annulations, le retour réseau et les codes HTTP.
- Deux défauts du premier candidat ont été reproduits par la contre-relecture puis corrigés : reprise réarmée après une pause décidée par le lecteur ; résolution Stalker nulle laissant une tentative bloquée. Sondes avant/après et callbacks périmés vérifiés, puis rejoués par l'exécutant. Les sondes utilisent les corps actuels extraits de l'activité et simulent les frontières Android ; elles ne remplacent pas une exécution complète de ces cas sur appareil.
- `assembleDebug` réussi. Premier `assembleRelease --offline` bloqué par une dépendance Guava absente du cache ; reprise avec téléchargement autorisé, **assembleRelease réussi**, R8 et lint release compris.
- Signature APK vérifiée et certificat identique à la 1.12.8. Aucun keystore créé ou modifié.

## APK et preuves

`CedPlay-1.12.9.apk` et `CedPlay.apk` : **4 396 428 octets**, SHA-256 `0b7c4af47758f5afd5a754f88a5c6a7379509fba614f719ea2a8928ee293daee`. Deux copies identiques ; ancienne référence 1.12.8 retirée de la racine après vérification du nouvel APK. Certificat SHA-256 : `f3f2371b5e734cdbbfd65530b64c542194df6dc71d8bac0273fcc44facdfa628`.

Preuves locales sous `preuves/reconnexion-direct/` :

- `baseline-1-12-8-outage.json`, `baseline-screen.png` ;
- `final-1-12-9-outage.json`, `final-measurement.json`, `final-screen.png` ;
- `final-pause.json`, journaux natifs associés ;
- `release-web-tests.log`, `release-eslint.log`, `release-web-build.log`, `release-android-online.log`, `release-apk.json` ;
- `review/REVIEW.md`, sondes pause/Stalker et résultats avant/après ;
- `controlled-live.mjs`, `outage-probe.mjs`, `pause-probe.mjs` pour rejouer le scénario.

Le média de test reste dans `preuves/`, hors de `dist/` et des assets APK. Aucun identifiant fournisseur ajouté aux preuves ou au code.

## Limites et suite

Pas d'installation sur téléphone dans cette session. Retour du réseau testé par sondes, pas par coupure Wi-Fi physique ; Stalker et API 22 restent à essayer sur un appareil correspondant. La fluidité prolongée, le rendu Android 15 et la disparition physique du flash en thème clair restent à confirmer. Résilience DVR, migration Media3 et audio logiciel restent des lots séparés.
