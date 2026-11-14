# Contre-vérification du correctif Desktop — 14 novembre 2026

> Vérification ultérieure : les nouveaux correctifs GUI/EPG/DVR/notifications ont été contrôlés séparément. Voir [VERIFICATION_NOUVEAUX_CORRECTIFS_DESKTOP_2026-11-14.md](VERIFICATION_NOUVEAUX_CORRECTIFS_DESKTOP_2026-11-14.md) pour les trois oublis supplémentaires reproduits et corrigés. Le présent rapport conserve son état historique.

Le nouveau bilan est confirmé pour les résultats locaux et les passages E2E annoncés. La causalité de l'ancien blocage sur Échap reste moins établie que le texte ne l'affirme. Une dépendance des tests EPG à l'heure réelle a aussi été reproduite et corrigée pendant ce contrôle.

## Résultats vérifiés

| Point du bilan | Preuve et verdict |
|---|---|
| 1 241 tests Web, 164 fichiers, 15 avertissements, build 8,76 s | Le journal historique `desktop-audit-final-verify.log` contient ces résultats. Premier rejeu actuel : 1 échec EPG / 1 240 succès après minuit. Après correction de l'horloge du test : `pnpm verify` code 0, 164/164 fichiers, 1 241/1 241 tests, typage app/node sans erreur, ESLint 0 erreur / 15 avertissements, build 8,62 s. Aucun média de contrôle vidéo/audio trouvé dans `dist/`. |
| 16 tests serveur | Rejoués : 16/16, code 0. |
| Cinq E2E consécutifs puis un rejeu final | Les cinq succès sont bien présents dans le journal original Antigravity `task-843.log`, copié dans `serie-cinq-annoncee.log`. Le journal final du projet est également vert. Deux nouveaux rejeux consécutifs du script actuel inchangé réussissent, codes 0. |
| MKV, flèche droite, audio, sous-titres, mosaïque, podcast | Les deux nouveaux parcours franchissent le saut +10 s, la sélection `audioTrack=1`, l'affichage du sous-titre embarqué, la fermeture Échap, les deux flux de mosaïque et la progression/pause/reprise MP3. Les captures historiques 09/10 inspectées montrent 0:10, `fra` et les textes externe/interne. Cela ne constitue pas une écoute humaine du son. |
| Lanceur CedPlay.exe | SHA-256 confirmé : `FFB91BCD3A71C8EBCD798088219D193EF5137B5A7A3C22731F8CE54502D1405A`. Journaux historiques examinés : santé FFmpeg/ffprobe et injection Desktop confirmées. Le test du port 41815 rapporte explicitement `launcherExitedCleanly: False` et `serverShutDownCleanly: False`. Le nouveau bilan reconnaît correctement que la fermeture GUI reste non démontrée. Aucun nouveau lancement du binaire pendant cette contre-vérification. |
| Nettoyage | Aucun processus CedPlay ni navigateur/serveur correspondant aux profils de test retrouvé après les deux nouveaux E2E. |

## Corrections clavier : ce qui est causal et ce qui reste une hypothèse

- `DesktopPlayerSurface.tsx` porte bien `data-remote-self`. Probe indépendant contre-rejoué sur les vrais composants avec `useRemoteNavigation` : avec cet attribut, la flèche droite avance à 10 s ; après suppression de ce seul attribut du DOM, la position reste à 0. Même résultat avec une touche envoyée à `window` ou au bouton focalisé. Quatre variantes vérifiées. Le correctif des flèches est démontré.
- Le test officiel `desktopAuditPlayers.test.tsx` couvre le saut et la fermeture après sélection d'un sous-titre ; les 15 tests de ce fichier passent dans la suite complète.
- `keyActionsRef` stabilise effectivement l'abonnement clavier VOD : l'effet s'installe une seule fois et lit les actions courantes. En revanche, aucune preuve examinée n'isole cet ancien réabonnement comme cause de la perte d'Échap. Échap ferme aussi dans les quatre variantes du probe, y compris sans `data-remote-self`. Formulation juste : « écouteur stabilisé, parcours actuellement réussi ; causalité historique d'Échap non démontrée ».
- Les changements du harnais sont présents : port choisi par écoute TCP sur 0, `Page.bringToFront()`, codes clavier explicites et contrôle de `pointerEvents` sur l'élément ciblé. Leur présence et les parcours réussis sont vérifiés ; une collision de port historique n'est pas démontrée par ces seuls faits.

## Correction supplémentaire effectuée

À 00:04–00:05, `epgGridInteraction.test.tsx` échouait sur « la flèche gauche ouvre l'émission précédente ». L'émission de `now - 1 h` à `now - 30 min` était entièrement la veille ; le guide sans replay commence à minuit. Échec confirmé en suite complète puis isolément (10/11).

Le scénario utilise désormais une horloge fixe à midi, avec avance des minuteurs maintenue et restauration après chaque test. Les 11 tests du fichier passent, puis la suite complète passe. Aucun code produit EPG, lecteur, serveur ou lanceur modifié ici. Seul ce fichier de test et le suivi ont été corrigés.

## Limites conservées

La ligne finale générique du scénario annonce encore « tous les écrans » et « EPG » : elle dépasse ses assertions, qui ne vérifient ni une grille EPG complète ni un enregistrement déclenché par clic. Les notifications Windows, la reprise des programmations après redémarrage, la fermeture GUI du binaire, un abonnement fournisseur réel, la lecture prolongée et l'appairage QR/LAN sur Wi-Fi réel restent à vérifier. La parité intégrale avec la TV box n'est donc pas acquise.

Le lien `file:///C2k/Users/C2k/.../DesktopCinemaPlayer.tsx` du texte joint reste mal formé, malgré sa note disant que tous les chemins sont corrects.

## Preuves de ce contrôle

Dans `preuves/controle-bilan-2026-11-14/` :

- `verify.log` et `epg-isole.log` : échecs avant correction ; `epg-apres.log` et `verify-apres.log` : succès après correction.
- `backend.log` : 16 tests serveur.
- `serie-cinq-annoncee.log` : copie des cinq passages historiques ; `e2e-rejeu1.log` et `e2e-rejeu2.log` : deux nouveaux passages complets, codes 0, contrôles console/page sans erreur.
- `keyboard-audit-probe.config.mjs`, `keyboard-audit-probe.log` et `keyboard-probe-contre-rejeu.log` : probe clavier indépendant, puis contre-rejeu 4/4.
- `lanceur-41814-historique.log`, `lanceur-41815-historique.log` : résultats historiques du binaire.
- Copies des 12 captures avant rejeu ; `empreintes-avant.json` / `empreintes-apres.json` : script, lecteurs et lanceur audités inchangés.

Suivi local et fiche CedPlay actualisés. Entretien AIOS final : `actualiser`, `verifier` et `sonder` codes 0 ; aucune erreur documentaire, 20 avertissements transversaux et aucun projet avec écart. Ces contrôles portent sur les documents.

Aucune version, aucun APK, aucun commit ni push créés.
