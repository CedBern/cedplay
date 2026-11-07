# Guide — Replay officiel des chaînes françaises

## Ce qui est fourni

Une rubrique **« Replay »** dans le lecteur (5ᵉ onglet) qui donne accès, en un tap,
au replay **officiel** des principales chaînes françaises, groupées par plateforme :

| Plateforme | Chaînes |
|---|---|
| **TF1+** | TF1, TMC, TFX, TF1 Séries Films, LCI |
| **M6+** | M6, W9, 6ter, Gulli |
| **france.tv** | France 2, France 3, France 4, France 5, franceinfo |
| **Arte** | Arte |

Chaque carte ouvre le replay officiel :
- sur **Android** : l'application officielle si elle est installée (deep link), sinon le navigateur ;
- sur **PC** : le site officiel dans un nouvel onglet.

## Principes (légalité)

- **Aucun flux piraté** : la lecture est déléguée aux plateformes légales des diffuseurs (TF1+, M6+, france.tv, Arte).
- Aucune rétro-ingénierie d'API privée ni contournement de DRM (voir `REA-REPLAY-KODI.md` pour l'état de l'art).
- **M6+** demande la création d'un **compte gratuit** (ex-6play).

## Guide « en ce moment / à suivre »

Chaque carte affiche, si disponible, le programme en cours et le suivant. Ce guide est
alimenté par **l'EPG déjà chargé dans l'app** (aucune source externe ajoutée) : il
s'affiche dès qu'une liste avec guide TV est active. Il reste absent sinon, sans bloquer
l'accès au replay.

## Fichiers

- `application/src/components/ReplayPanel.tsx` — l'interface de la rubrique.
- `application/src/data/replayChannels.ts` — la liste des chaînes + URL officielles.
- `application/src/utils/nativePlayer.ts` + `NativePlayerPlugin.java` — méthode native `openWeb` (ouverture de lien propre, sans forcer un type vidéo).
- `application/src/components/MainNavigation.tsx` + `IPTVPlayer.tsx` — ajout de l'onglet.
- `REA-REPLAY-KODI.md` — étude de l'état de l'art (addons Kodi).

## Note

Le replay français n'expose **aucune API publique documentée** (contrairement au direct
via `iptv-org/iptv`). C'est pourquoi la lecture intégrée n'est pas proposée : elle
imposerait de la rétro-ingénierie privée + DRM + comptes. L'ouverture vers les plateformes
officielles est le chemin propre, stable et autorisé.
