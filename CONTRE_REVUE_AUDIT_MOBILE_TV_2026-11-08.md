# Contre-vérification de l'audit mobile/TV — 8 novembre 2026

Périmètre : `AUDIT_INTEGRAL_2026-11-08_MOBILE-TV.md` confronté au dépôt canonique, HEAD `0362409` et travail non commité. Aucun code produit modifié, commit, push, remplacement d'APK racine ni installation. Le rapport d'origine reste intact. Lecture native indépendante par un second agent, puis contrôle des points principaux dans le fil exécutant.

## État vérifié maintenant

- Suite Web : **778/778**, 118 fichiers, dont les 25 tests `vodTvScreen`. Journal `preuves/revue-lot-d/mobile-tv-web-recheck.log` (53,55 s). Le rouge M1 appartient à un instantané antérieur ; `TvVodScreen.tsx:252-265,330-335` contient désormais la refocalisation explicite.
- Sondes adverses existantes : **4/4** réglages/thème et **3/3** verrou parental, via les configurations isolées sous `preuves/revue-lot-d/`. Journaux `mobile-tv-theme-recheck.log` et `mobile-tv-parental-recheck.log`. Le titre reste visible pendant l'attente des catégories, mais sa lecture est refusée ; après erreur il est caché. Ces tests ne prouvent pas un masquage pendant toute l'attente.
- Relais : sonde `node preuves/revue-lot-d/proxy-repro.mjs`, code de sortie 0. Cinq cibles locales refusées 403 (IPv4, IPv6 mappée, trois routes Xtream), faux service local jamais atteint ; origine inconnue refusée 403, contrôle d'origine autorisée 200. Journal `mobile-tv-proxy-recheck.log`. Ce rejeu ne démontre pas l'absence de toute SSRF, notamment par changement de résolution DNS entre validation et connexion.
- Android : `gradlew.bat :app:testDebugUnitTest :app:assembleDebug --offline` réussit en 2 s, tâches à jour ; résultats XML **21 tests, zéro échec/erreur**. Journal `mobile-tv-android-recheck.log`. JDK 17 et SDK locaux, aucun émulateur nécessaire. Aucun APK de livraison produit avec les nouveaux assets Web : pas de `cap sync` ni de remplacement des APK racine.
- TypeScript, lint et build Web n'ont pas été relancés dans cette passe : résultats antérieurs documentés dans `CURRENT_MISSION.md`, distincts du rejeu présent.

## Conclusions du rapport à corriger ou nuancer

| Point | Conclusion de la contre-vérification |
|---|---|
| M1, test rouge | Dépassé sur l'arbre actuel : suite complète verte. Cela ne prouve pas la navigation sur télécommande physique. |
| M2, abandon en 5 s | Deux reprises applicatives confirmées (`NativePlayerActivity.java:117,2031-2051`), délais 1,5 et 3,5 s. Leur somme ne mesure pas la durée avant abandon : délais HTTP 15 s (`1941-1942`), tentatives internes Media3 et quota réinitialisé en `STATE_READY` (`1992`). Absence de relance native sur retour réseau constatée par lecture ; coupure réelle non rejouée. |
| M3, audio logiciel | Aucune extension FFmpeg configurée ; `setEnableDecoderFallback(true)` dans `PlayerOptions.java:94` ne remplace pas une extension absente. Risque selon codecs et appareil, aucune chaîne muette reproduite ici. |
| M4, Media3 | Version locale 1.2.1 confirmée (`app/build.gradle:71-74`), stable officielle 1.11.1 confirmée. La proposition omet une décision de compatibilité : minSdk local 22, Media3 impose au moins 23 depuis 1.9. Ne pas traiter la migration comme un simple changement de numéro compatible avec tous les appareils actuels. |
| M5, DVR | Exception réseau TS termine la capture (`Recorder.java:202-223`), sans reconnexion. Toute microcoupure ne provoque pas nécessairement cette exception. L'interruption peut être notifiée (`RecordService.java:107-113`) : « perte silencieuse » n'est pas systématique. Service dataSync sans `onTimeout` confirmé. Quota Android 15 de six heures en arrière-plan, réinitialisé au retour de l'utilisateur au premier plan, pas plafond quotidien absolu. |
| M6, programmations | Données conservées dans SharedPreferences (`ScheduleStore.java:20-26`). Réarmement absent de `NativePlayerPlugin.load`, mais présent dans `BootReceiver:14-16`. Android 15 émet BOOT_COMPLETED à la sortie de l'état arrêté par action utilisateur ; perte après relance non démontrée. Ne pas confondre alarmes système annulées et données supprimées. |
| M7, veille | Aucun `setWakeMode` dans les lecteurs cités ; priorité pertinente pour le service audio. Coupure écran éteint non reproduite. La vidéo native est volontairement libérée en arrière-plan hors PiP (`NativePlayerActivity.java:2254-2277`) : ne pas appliquer le même raisonnement à tous les lecteurs. |
| M8, écran allumé | Drapeau global confirmé dans `MainActivity.java:15-19`, menus compris. Aucun marquage OLED observé. Un retrait exige de couvrir le lecteur Web et les aperçus actifs. |
| M9, WebView | Écart entre seuil Capacitor 60 et cible Vite incluant Chrome 87 confirmé, panne concrète non reproduite. Correction proposée invalide telle qu'écrite : `errorPath` appartient à **server**, pas à android (déclarations Capacitor installées, lignes 423-506). Sans errorPath, Capacitor ne fournit pas de page d'erreur par défaut. |
| M10, diagnostic | Pas de collecteur global de plantages applicatif confirmé. Des diagnostics de lecture persistants/exportables et Logcat existent déjà ; « aucune trace exploitable » est trop absolu. Absence d'autofocus du bouton ErrorBoundary confirmée, inaccessibilité télécommande non démontrée : la navigation globale reste active et traite les boutons. |

Les affirmations « aucune faille exploitable », « 45 % du bundle évitables » et « 6 à 8 jours » ne sont pas des garanties obtenues par les vérifications présentes. Les tailles de sources de dépendances ne donnent pas leur part exacte dans le bundle final. Le PIN et l'export des secrets restent des sujets distincts, non clos par les tests verts.

## Suite proposée

1. Figer les changements existants et terminer leur validation/organisation par lots avant toute version ; le test rouge ne bloque plus cet arbre.
2. Traiter la reconnexion du direct comme un changement ciblé, avec test de coupure puis retour réseau sur Hisense et sans multiplier les connexions fournisseur.
3. Traiter la résilience DVR et l'expiration du service Android 15 ; recette séparée.
4. Isoler la migration Media3 et l'audio logiciel : compatibilité Android minimale, adaptation des API, signature et essais zapping/PiP/aperçu/mosaïque/AC3.

Il n'est pas justifié d'imposer toutes les nouvelles fonctionnalités du rapport à une seule version 1.12.9. Aucun essai physique n'a été effectué dans cette contre-revue.

## Sources primaires consultées

- [Versions Media3](https://developer.android.com/jetpack/androidx/releases/media3) : stable 1.11.1 et relèvement minSdk à 23 dès 1.9.
- [Durée des services au premier plan](https://developer.android.com/develop/background-work/services/fgs/timeout) : conditions du quota et remise à zéro.
- [Android 15, état arrêté](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state) : annulation des PendingIntent et BOOT_COMPLETED à la sortie.
- Déclarations et code réellement installés de Capacitor 6 et Vite 5 dans `application/node_modules/`, pour `server.errorPath` et la cible Chrome 87.
