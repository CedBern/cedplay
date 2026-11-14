# Vérification des nouveaux correctifs Desktop — 14 novembre 2026

Le bilan joint est étayé pour les correctifs annoncés et ses résultats locaux. Il ne suffisait cependant pas à conclure que toutes les réserves locales étaient levées : trois oublis ont été reproduits puis corrigés pendant cette contre-vérification.

## Ce qui est confirmé

- `CedPlay.exe` : 15 872 octets, SHA-256 `659C1699A2E9CCE4B436D3EF663C055EBE4922F50FA722A99C0AD14586163CE7`, identique au bilan. Le test lance réellement ce binaire dans un profil isolé, ferme une fenêtre visible titrée CedPlay par `WM_CLOSE`, puis exige une sortie code 0 et un serveur inaccessible. Ce scénario sans DVR est passé avant et après les corrections ci-dessous.
- Suite serveur initiale rejouée : **20/20**, zéro échec/ignoré (`backend-autorise.log`).
- `pnpm verify` initial puis final : **1 242/1 242 tests Web, 164 fichiers**, TypeScript app/node sans erreur, ESLint complet **0 erreur / 15 avertissements**. Dernier build : **8,74 s** (`verify-apres.log`). Aucun code Web n'a été modifié pendant cette contre-vérification.
- Le parcours E2E étendu comporte de vraies assertions sur la grille XMLTV, le rappel synchronisé, les commandes DVR par clic, un fichier `.ts` supérieur à 1 Ko et les hooks de notification. Un premier parcours complet a réussi ; les captures EPG et DVR ont été inspectées. Le résultat des rejeux est détaillé plus bas.

## Oublis reproduits et corrigés

1. **Rappel seul perdu à la fermeture.** Avec un rappel futur et aucun DVR, `release` répondait `backgroundWork:false` et arrêtait le serveur avant l'échéance, bien que le rappel reste sauvegardé. Le service maintient désormais le serveur pour les rappels et les notifications en cours ; l'arrêt attend leur fin. Test ajouté : échec `false !== true` avant, réussite après.
2. **Notifications répétées pour le même rappel.** Le navigateur pouvait resynchroniser un rappel encore présent en IndexedDB après son déclenchement ; le serveur le déclenchait immédiatement de nouveau. Probe borné : **4 événements et 4 hooks en moins de 400 ms**. Le serveur enregistre désormais un reçu `{id, startTime}` avant l'émission, le recharge après redémarrage et ignore les doublons pendant la fenêtre de grâce de 90 secondes. Test ajouté : **2 notifications au lieu de 1 avant**, une seule après resynchronisation et lancement d'un **nouveau processus Node**. Le reçu est conservé avant l'appel Windows ; cette protection contre les répétitions ne garantit pas la livraison visuelle si Windows refuse l'affichage.
3. **DVR HLS à adresse sans extension.** La correction annoncée reconnaissait uniquement `.m3u8`. Les mêmes données à `/live/103` ne produisaient aucun fichier. Le test paramétré passe désormais pour les deux adresses après retrait de `-reconnect_streamed`, en conservant `-reconnect` et le délai maximal. La reprise après coupure d'un flux continu n'a pas été mesurée.

Modifications produit de cette session : `desktop/config.mjs`, `desktop/localAndDvr.mjs`, `desktop/server.mjs` et tests dans `desktop/audit-regression.test.mjs`. Le binaire et le lanceur C# n'ont pas été modifiés. Revue indépendante ciblée : aucun défaut indispensable supplémentaire démontré.

Après corrections, suite serveur complète : **23/23**, zéro échec/ignoré, **19 912 ms**, incluant fermeture GUI réelle, WinRT, DVR `.m3u8` et sans extension, rappel seul après fermeture et dédoublonnage dans un nouveau processus (`backend-apres.log`).

## Portée exacte des preuves

- Le test historique nommé « full server restart » recrée deux objets serveur dans **le même processus Node** : il prouve la relecture sur disque, pas un redémarrage du processus. Le nouveau test de dédoublonnage lance bien un processus différent ; il ne couvre pas à lui seul toute la reprise DVR après redémarrage de Windows.
- WinRT est appelé réellement sans erreur remontée. Les tests de scénarios DVR/rappels désactivent les notifications OS et vérifient le journal des hooks. Aucune bannière Windows visible ni interaction avec une notification n'a été observée.
- L'E2E vérifie la présence du fichier enregistré ; il ne relit pas cet enregistrement. Les flux sont des fixtures locales, pas un abonnement fournisseur.
- Deux rejeux après correction se sont bloqués dès l'ouverture initiale de **Plus** (`Timeout attente UI: more panel initial`), sans erreur de page, avant les scénarios DVR/rappels. Échecs et capture conservés. Une copie de diagnostic a constaté **zéro événement de clic reçu**, puis des événements `pointerdown`, `mousedown`, `mouseup`, `click` et ouverture de Plus après activation de l'émulation de focus Chrome. Le harnais officiel `desktop/e2e-verify.mjs` active désormais ce focus une fois à la connexion CDP, sans réessayer les clics. **Deux rejeux complets consécutifs du harnais officiel ainsi corrigé ont réussi (codes 0, aucune erreur console/page)**. Ce sont des parcours avec focus émulé ; ils ne prouvent pas une interaction manuelle Windows.
- Restent à valider : fournisseur IPTV, flux externes et comportement lors de coupures réseau, appairage QR/LAN sur Wi-Fi réel, affichage des notifications et redémarrage complet de Windows. La parité totale avec la TV box reste non démontrée.

## Preuves

Dossier de cette session : [preuves/controle-nouveau-bilan-2026-11-14](preuves/controle-nouveau-bilan-2026-11-14/).

- `empreintes-avant.json`, `empreintes-apres.json` : état des sources et du binaire.
- `rappel-fermeture-avant.log`, `rappel-boucle-avant.log` et probes indépendants dans `agent-lifecycle/` et `agent-reminders/`.
- `regressions-avant.log`, `regressions-apres.log`, `hls-avant.log` : échecs avant et succès ciblés après.
- `backend-autorise.log`, `backend-apres.log`, `verify-autorise.log`, `verify-apres.log`.
- `e2e-premier.log`, `e2e-apres.log`, `e2e-second-rejeu.log`, `epg-premier.png`, `dvr-premier.png`, `echec-plus.png` ; `diagnostic-clic.log`, `diagnostic-focus.log`, `e2e-focus-rejeu1.log`, `e2e-focus-rejeu2.log`.

Les premiers essais en bac à sable ont été bloqués par `spawn EPERM` ; les contrôles ont été rejoués dans un contexte autorisé. Aucun média lourd de test dans `dist`. Aucun APK, commit ni push. Suivi local et fiche CedPlay actualisés ; entretien `actualiser`, `verifier`, `sonder` : codes 0, aucune erreur documentaire ni écart de projet, avertissements transversaux conservés. Résultats consignés dans ce même dossier de preuves.
