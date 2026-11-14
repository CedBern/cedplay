# Contre-vérification du bilan Desktop du 13 novembre 2026

Actualisation du 14 novembre : les correctifs ultérieurs ont été contre-vérifiés et deux nouveaux E2E complets passent. Voir [le nouveau rapport](CONTRE_VERIFICATION_DESKTOP_2026-11-14.md). Le présent document conserve les résultats et réserves observés avant ces correctifs.

Le bilan est largement confirmé pour les tests locaux. Son affirmation d'une recette E2E complète et fiable n'est pas confirmée par le rejeu actuel. Aucun code applicatif ni lanceur modifié pendant cette contre-vérification.

| Affirmation | Verdict actuel |
|---|---|
| 1 240 tests Web, 164 fichiers | Confirmé par `corepack pnpm verify`, code 0. Typage app/node sans erreur, lint sans erreur avec 15 avertissements. Build réussi en 8,56 s lors du rejeu. Le journal correspondant à la durée historique de 8,79 s n'a pas été retrouvé dans les preuves examinées. |
| 16 tests serveur Desktop | Confirmé par le rejeu de `desktop.test.mjs` et `audit-regression.test.mjs`, 16/16. |
| Recette E2E complète, code 0 | Non reproduit : deux lancements inchangés échouent sur `Timeout attente UI: vod player closed`, après sélection du sous-titre embarqué. Un diagnostic isolé échoue aussi sur `Timeout attente UI: tv-vod films` avant d'atteindre la sonde clavier. L'échec actuel du contrôle est prouvé ; sa cause exacte dans l'application ou l'automatisation reste à isoler. |
| Mosaïque et MKV multilingue | Les deux rejeux principaux franchissent les contrôles des deux vidéos décodées, de l'accessibilité au premier plan, de la position après +10 s, de `audioTrack=1` et de l'affichage du sous-titre embarqué. Aucune écoute humaine du son. |
| Podcast complet | La capture historique 12 existe et montre le lecteur en cours. Les deux rejeux principaux bloquent avant cette étape : aucune nouvelle validation E2E complète du podcast dans ce contrôle. |
| 12 captures | Les 12 captures historiques existent et ont été préservées avant rejeu. Les captures 09, 10, 11 et 12 ont été inspectées à nouveau. Une capture seule ne prouve ni la langue sonore ni la fluidité prolongée. |
| Lancement et arrêt de CedPlay.exe | Le binaire existe et conserve le SHA-256 FFB91BCD3A71C8EBCD798088219D193EF5137B5A7A3C22731F8CE54502D1405A du précédent contrôle de lancement dans ce chat. Aucun processus de test résiduel trouvé. L'ouverture et la fermeture de sa vraie fenêtre n'ont pas été rejouées ici ; les fichiers de l'ancien test de lancement ont été supprimés. |
| Nettoyage | `preuves/desktop-launcher-smoke` et l'ancien `failure.png` étaient absents avant rejeu. Le rejeu a recréé une capture d'échec. |
| Suivi et AIOS | Les deux fiches contenaient le bilan annoncé. `entretien.py verifier` : code 0, aucune erreur, avertissements documentaires présents. `sonder` : code 0, aucun écart. Cela ne valide pas le produit. |

Les tests serveur utilisent FFmpeg sur des médias synthétiques et couvrent le maintien du DVR après `release`. Le parcours E2E ne lance pas d'enregistrement depuis l'interface et ne vérifie pas l'affichage d'un guide EPG complet, malgré sa ligne finale de succès générale.

La parité totale avec la TV box reste non démontrée : deux flux de mosaïque courts seulement, aucun abonnement fournisseur, téléphone Wi-Fi, appareil Android TV ou lecture longue durée. Les rappels système après fermeture et la reprise du planificateur après redémarrage Windows ne sont pas couverts par les notifications Android actuelles.

Trois liens du texte joint commencent par `file:///C2k/Documents/...` et sont mal formés : captures 09, 10 et 12.

## Preuves conservées

- `preuves/veracite-desktop-verify.log` : suite applicative complète.
- `preuves/veracite-desktop-backend.log` : 16 tests serveur.
- `preuves/veracite-desktop-e2e-essai1.log` et `preuves/veracite-desktop-e2e-essai2.log` : deux échecs identiques du scénario original.
- `preuves/veracite-desktop/diagnostic-escape.log` : diagnostic isolé, échec de navigation avant la sonde clavier.
- `preuves/veracite-desktop/captures-avant-rejeu/` : copies des 12 captures historiques.
- `preuves/veracite-desktop/empreintes.json` : empreintes du scénario E2E, du lanceur source, du binaire et de la surface de lecture, identiques avant/après.

Le journal préexistant `desktop-audit-final-verify.log` décrivait encore 1 239 tests et 16 avertissements ; `desktop-audit-final-e2e.log` décrivait encore un ancien échec RSS. Ils ne documentaient donc pas le succès ultérieur revendiqué. Les nouveaux journaux permettent de distinguer les résumés documentaires des preuves d'exécution.
